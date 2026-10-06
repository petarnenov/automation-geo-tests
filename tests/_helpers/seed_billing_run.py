#!/usr/bin/env python3
"""Idempotent runtime seed for the Billing Runs grid (@pepi billing-runs specs).

Clones a known in-window, single-run, one-history template billing and overrides
the fields a given spec needs, so a Completed/In-Progress/partial-re-run master
row appears in BILLINGS_VW inside the grid's default date window (15th of prev
month -> today, on CREATED_DATE). Each call first DELETEs any prior row with the
same distinctive tmplt_name (children -> parents), so re-runs never accumulate
and a qa4 DB refresh is auto-recovered on the next run.

Parameters come from env vars (JSON passed this way to avoid shell quoting):
  GEO_DB_DSN         Oracle DSN (default 192.168.1.42:1521/ORCL12VM)
  SEED_NAME          distinctive tmplt_name / run name (required)
  SEED_FIRM          firm_cd (default 44 - isolated, active)
  SEED_STATUS        billing_status: 2=Completed, 3=In Progress (required)
  SEED_PUBLISHED     published flag 0/1 (default 0 = 'N')
  SEED_ERROR_JSON    error_json value, empty -> NULL
  SEED_TARGET_JSON   target_json override, empty -> clone template's
  SEED_PARTIAL       '1' -> add a BILLING_HISTORY_TBL row with PARTIAL_RE_RUN=1
                     (the only way BILLINGS_VW.partial_re_run becomes 1)
"""
import os
import oracledb

oracledb.defaults.fetch_lobs = False

# Clone template: a single-run, one-history, Completed, in-window billing
# (validated against BILLINGS_VW).
SRC_BILLING = '019F5A1B781D7B4884180BBD083B9969'
SRC_RUN = '019F5A1B78307A2E8BCF06C81998B0F5'
SRC_HIST = '019F5B08D9D67FD5AAD7033A995800D1'

dsn = os.environ.get('GEO_DB_DSN', '192.168.1.42:1521/ORCL12VM')
name = os.environ['SEED_NAME']
firm = int(os.environ.get('SEED_FIRM', '44'))
status = int(os.environ['SEED_STATUS'])
published = int(os.environ.get('SEED_PUBLISHED', '0'))
error_json = os.environ.get('SEED_ERROR_JSON') or None
target_json = os.environ.get('SEED_TARGET_JSON') or None
partial = os.environ.get('SEED_PARTIAL', '0') == '1'

c = oracledb.connect(user=os.environ['GEO_DB_USER'], password=os.environ['GEO_DB_PASSWORD'], dsn=dsn)
cur = c.cursor()


def resolve_sources():
    """Return (billing, run, history) ids to clone.

    The hardcoded SRC_* ids are qa4 rows; on any other env (qabis1, fresh
    clones) they don't exist and the INSERT ... SELECT would silently clone
    nothing. Fall back to any single-run template billing (BILLINGS_VW, the
    grid's source, only shows tmplt_id IS NOT NULL) plus any history row --
    the history clone gets its run id overridden, so its origin is irrelevant.
    """
    cur.execute("SELECT COUNT(*) FROM billing_tbl WHERE billing_id=:1", [SRC_BILLING])
    if cur.fetchone()[0]:
        return SRC_BILLING, SRC_RUN, SRC_HIST
    cur.execute(
        """SELECT br.billing_id, br.billing_run_id
             FROM billing_run_tbl br
             JOIN billing_tbl b ON b.billing_id=br.billing_id
            WHERE b.tmplt_id IS NOT NULL
              AND br.billing_id IN (SELECT billing_id FROM billing_run_tbl
                                     GROUP BY billing_id HAVING COUNT(*)=1)
              AND ROWNUM=1"""
    )
    row = cur.fetchone()
    if not row:
        raise SystemExit('seed_billing_run: no single-run template billing to clone')
    cur.execute("SELECT billing_history_id FROM billing_history_tbl WHERE ROWNUM=1")
    hist = cur.fetchone()
    return row[0], row[1], hist[0] if hist else None


def newid():
    cur.execute("SELECT RAWTOHEX(SYS_GUID()) FROM dual")
    return cur.fetchone()[0]


# --- idempotent cleanup by distinctive name (children -> parents) ---
cur.execute(
    """DELETE FROM billing_history_tbl WHERE billing_run_id IN (
         SELECT br.billing_run_id FROM billing_run_tbl br
         JOIN billing_tbl b ON b.billing_id=br.billing_id
         WHERE b.tmplt_name=:1)""",
    [name],
)
cur.execute(
    """DELETE FROM billing_run_tbl WHERE billing_id IN (
         SELECT billing_id FROM billing_tbl WHERE tmplt_name=:1)""",
    [name],
)
cur.execute("DELETE FROM billing_tbl WHERE tmplt_name=:1", [name])
c.commit()

SRC_BILLING, SRC_RUN, SRC_HIST = resolve_sources()
nb, nr = newid(), newid()

cur.execute(
    """
INSERT INTO billing_tbl
SELECT :nb,:nm,description,from_date,to_date,SYSTIMESTAMP,created_by,approved_date,approved_by,
       :fc,ready_flag,approved_flag,billing_export_type,billing_status_type,prorate_from_date,
       prorate_to_date,target_firm_cd,target_account_group_id,target_entity_id,target_account_id,
       override_flag,billing_period_type,target_advisor_id,target_type_cd,tmplt_id,:tn,start_bill_msg,finished_flag
FROM billing_tbl WHERE billing_id=:src
""",
    dict(nb=nb, nm=name, fc=firm, tn=name, src=SRC_BILLING),
)

# In Progress (3) runs keep finish_date NULL; Completed (2) get SYSTIMESTAMP.
cur.execute(
    """
INSERT INTO billing_run_tbl
SELECT :nr,billing_type_cd,:fc,SYSTIMESTAMP,
       CASE WHEN :st=3 THEN NULL ELSE SYSTIMESTAMP END,
       accounts_to_be_billed,created_by,description,:nm,:nb,target_firm_cd,target_account_group_id,
       target_entity_id,target_account_id,override_flag,execute_date,billing_export_id,target_advisor_id,
       target_type_cd,submitted_by,0,0,:pub,0,files_to_export_json,:st,
       NVL(:tj,target_json),:ej
FROM billing_run_tbl WHERE billing_run_id=:src
""",
    dict(nr=nr, fc=firm, st=status, nm=name, nb=nb, pub=published, tj=target_json, ej=error_json, src=SRC_RUN),
)

# partial_re_run=1 exists nowhere on qa4; it derives from BILLING_HISTORY_TBL.
# Give the run ONLY partial_re_run=1 history rows so BILLINGS_VW (which GROUPs BY
# partial_re_run) yields exactly one master row with the '*' marker.
if partial:
    nh = newid()
    cur.execute(
        """
INSERT INTO billing_history_tbl
SELECT :nh,account_id,billing_account_id,begin_date,end_date,billing_type_cd,amount,
       billing_account_transaction_id,:fc,:nr,calculation_log,billing_report,num_days,proration,
       SYSDATE,billing_specification_id,1
FROM billing_history_tbl WHERE billing_history_id=:src
""",
        dict(nh=nh, fc=firm, nr=nr, src=SRC_HIST),
    )

c.commit()
print(f"seeded billing run '{name}' status={status} published={published} partial={partial} firm={firm}")
c.close()
