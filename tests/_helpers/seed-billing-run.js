// @ts-check
/**
 * Idempotent runtime seed for the Billing Runs grid (@regression billing-runs
 * specs). Runs inside ./db-worker.js; call it through billing-seed.js.
 *
 * Clones a known in-window, single-run, one-history template billing and
 * overrides the fields a given spec needs, so a Completed/In-Progress/
 * partial-re-run master row appears in BILLINGS_VW inside the grid's default
 * date window (15th of prev month -> today, on CREATED_DATE). Each call first
 * DELETEs any prior row with the same distinctive tmplt_name (children ->
 * parents), so re-runs never accumulate and a qa4 DB refresh is auto-recovered
 * on the next run.
 */

// Clone template: a single-run, one-history, Completed, in-window billing
// (validated against BILLINGS_VW).
const SRC_BILLING = '019F5A1B781D7B4884180BBD083B9969';
const SRC_RUN = '019F5A1B78307A2E8BCF06C81998B0F5';
const SRC_HIST = '019F5B08D9D67FD5AAD7033A995800D1';

/**
 * @param {import('oracledb').Connection} conn
 * @param {string} sql
 * @param {any} [binds]
 */
async function one(conn, sql, binds = []) {
  const res = await conn.execute(sql, binds);
  return res.rows && res.rows[0] ? /** @type {any[]} */ (res.rows[0]) : null;
}

/**
 * Return [billing, run, history] ids to clone.
 *
 * The hardcoded SRC_* ids are qa4 rows; on any other env (qabis1, fresh
 * clones) they don't exist and the INSERT ... SELECT would silently clone
 * nothing. Fall back to any single-run template billing (BILLINGS_VW, the
 * grid's source, only shows tmplt_id IS NOT NULL) plus any history row --
 * the history clone gets its run id overridden, so its origin is irrelevant.
 *
 * @param {import('oracledb').Connection} conn
 */
async function resolveSources(conn) {
  const [count] = await one(conn, 'SELECT COUNT(*) FROM billing_tbl WHERE billing_id=:1', [
    SRC_BILLING,
  ]);
  if (count) return [SRC_BILLING, SRC_RUN, SRC_HIST];
  const row = await one(
    conn,
    `SELECT br.billing_id, br.billing_run_id
       FROM billing_run_tbl br
       JOIN billing_tbl b ON b.billing_id=br.billing_id
      WHERE b.tmplt_id IS NOT NULL
        AND br.billing_id IN (SELECT billing_id FROM billing_run_tbl
                               GROUP BY billing_id HAVING COUNT(*)=1)
        AND ROWNUM=1`
  );
  if (!row) throw new Error('seed_billing_run: no single-run template billing to clone');
  const hist = await one(conn, 'SELECT billing_history_id FROM billing_history_tbl WHERE ROWNUM=1');
  return [row[0], row[1], hist ? hist[0] : null];
}

/** @param {import('oracledb').Connection} conn */
async function newId(conn) {
  return (await one(conn, 'SELECT RAWTOHEX(SYS_GUID()) FROM dual'))[0];
}

/**
 * @param {import('oracledb').Connection} conn
 * @param {{name: string, status: number, firmCd?: number, published?: number,
 *   errorJson?: string|null, targetJson?: string|null, partialReRun?: boolean}} opts
 */
async function seedBillingRun(
  conn,
  {
    name,
    status,
    firmCd = 44,
    published = 0,
    errorJson = null,
    targetJson = null,
    partialReRun = false,
  }
) {
  // --- idempotent cleanup by distinctive name (children -> parents) ---
  await conn.execute(
    `DELETE FROM billing_history_tbl WHERE billing_run_id IN (
       SELECT br.billing_run_id FROM billing_run_tbl br
       JOIN billing_tbl b ON b.billing_id=br.billing_id
       WHERE b.tmplt_name=:1)`,
    [name]
  );
  await conn.execute(
    `DELETE FROM billing_run_tbl WHERE billing_id IN (
       SELECT billing_id FROM billing_tbl WHERE tmplt_name=:1)`,
    [name]
  );
  await conn.execute('DELETE FROM billing_tbl WHERE tmplt_name=:1', [name]);
  await conn.commit();

  const [srcBilling, srcRun, srcHist] = await resolveSources(conn);
  const nb = await newId(conn);
  const nr = await newId(conn);

  await conn.execute(
    `INSERT INTO billing_tbl
     SELECT :nb,:nm,description,from_date,to_date,SYSTIMESTAMP,created_by,approved_date,approved_by,
            :fc,ready_flag,approved_flag,billing_export_type,billing_status_type,prorate_from_date,
            prorate_to_date,target_firm_cd,target_account_group_id,target_entity_id,target_account_id,
            override_flag,billing_period_type,target_advisor_id,target_type_cd,tmplt_id,:tn,start_bill_msg,finished_flag
     FROM billing_tbl WHERE billing_id=:src`,
    { nb, nm: name, fc: firmCd, tn: name, src: srcBilling }
  );

  // In Progress (3) runs keep finish_date NULL; Completed (2) get SYSTIMESTAMP.
  await conn.execute(
    `INSERT INTO billing_run_tbl
     SELECT :nr,billing_type_cd,:fc,SYSTIMESTAMP,
            CASE WHEN :st=3 THEN NULL ELSE SYSTIMESTAMP END,
            accounts_to_be_billed,created_by,description,:nm,:nb,target_firm_cd,target_account_group_id,
            target_entity_id,target_account_id,override_flag,execute_date,billing_export_id,target_advisor_id,
            target_type_cd,submitted_by,0,0,:pub,0,files_to_export_json,:st,
            NVL(:tj,target_json),:ej
     FROM billing_run_tbl WHERE billing_run_id=:src`,
    {
      nr,
      fc: firmCd,
      st: status,
      nm: name,
      nb,
      pub: published,
      tj: targetJson || null,
      ej: errorJson || null,
      src: srcRun,
    }
  );

  // partial_re_run=1 exists nowhere on qa4; it derives from BILLING_HISTORY_TBL.
  // Give the run ONLY partial_re_run=1 history rows so BILLINGS_VW (which GROUPs
  // BY partial_re_run) yields exactly one master row with the '*' marker.
  if (partialReRun) {
    const nh = await newId(conn);
    await conn.execute(
      `INSERT INTO billing_history_tbl
       SELECT :nh,account_id,billing_account_id,begin_date,end_date,billing_type_cd,amount,
              billing_account_transaction_id,:fc,:nr,calculation_log,billing_report,num_days,proration,
              SYSDATE,billing_specification_id,1
       FROM billing_history_tbl WHERE billing_history_id=:src`,
      { nh, fc: firmCd, nr, src: srcHist }
    );
  }

  await conn.commit();
  process.stderr.write(
    `seeded billing run '${name}' status=${status} published=${published} ` +
      `partial=${partialReRun} firm=${firmCd}\n`
  );
}

module.exports = { seedBillingRun };
