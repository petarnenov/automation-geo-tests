// @ts-check
/**
 * Runtime seed for the Billing Runs grid used by the @regression billing-runs specs.
 *
 * qa4 lacks billing runs in the states these specs assert (a partial-re-run
 * carrying the '*' marker, an In-Progress run with an error message, a
 * Completed client-target run). Each spec seeds the row it needs at start via
 * this helper, which runs tests/_helpers/seed-billing-run.js through the
 * DB worker (./db.js). The seed is idempotent — it deletes any prior row with
 * the same distinctive name first — so re-runs don't accumulate and a DB
 * refresh is recovered on the next run.
 */

const { dbRun } = require('./db');
const { DB_DSN } = require('./qa3');

/**
 * Seed one billing run so it renders in the grid's default date window.
 *
 * @param {object} opts
 * @param {string} opts.name           distinctive tmplt_name / run name
 * @param {number} opts.status         billing_status: 2=Completed, 3=In Progress
 * @param {number} [opts.firmCd=44]    isolated, active firm
 * @param {number} [opts.published=0]  published flag (0='N')
 * @param {string|null} [opts.errorJson=null]   error_json value (null -> NULL)
 * @param {string|null} [opts.targetJson=null]  target_json override (null -> clone template)
 * @param {boolean} [opts.partialReRun=false]   add a PARTIAL_RE_RUN=1 history row
 *   so BILLINGS_VW.partial_re_run becomes 1 (the '*' status marker)
 */
function seedBillingRun({
  name,
  status,
  firmCd = 44,
  published = 0,
  errorJson = null,
  targetJson = null,
  partialReRun = false,
}) {
  dbRun(
    'seedBillingRun',
    { name, status, firmCd, published, errorJson, targetJson, partialReRun },
    { dsn: DB_DSN }
  );
}

module.exports = { seedBillingRun };
