// @ts-check
/**
 * Synchronous direct-DB access for the helpers (MFA patches, password-change
 * ageing, billing-run seeds, audit counts...). Each call runs ./db-worker.js
 * as a child process with node-oracledb — see there for why it is a child.
 *
 * Credentials come from GEO_DB_USER / GEO_DB_PASSWORD (.env.local); the DSN
 * defaults to resolveDbDsn() (GEO_DB_DSN or derived from the app URL).
 *
 * Dates: DATE / TIMESTAMP columns come back as ISO strings (JSON), so callers
 * wanting epoch ms do `Date.parse(value)`.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const { loadEnv } = require('./env');
const { resolveDbDsn } = require('./db-dsn');

const WORKER = path.join(__dirname, 'db-worker.js');

/**
 * @param {string} task  a key of TASKS in db-worker.js
 * @param {any} args
 * @param {{dsn?: string, timeout?: number}} [opts]
 */
function dbRun(task, args, { dsn = resolveDbDsn(), timeout = 30_000 } = {}) {
  loadEnv();
  const lib = process.env.ORACLE_CLIENT_LIB;
  const env = { ...process.env };
  if (lib) {
    env.LD_LIBRARY_PATH = [lib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  }
  const out = execFileSync(process.execPath, [WORKER], {
    input: JSON.stringify({ dsn, task, args }),
    env,
    timeout,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return JSON.parse(out.toString('utf8'));
}

/**
 * Run a SELECT; returns the rows as arrays.
 *
 * @param {string} sql
 * @param {any[]|Record<string, any>} [binds]  positional (:1) or named (:name)
 * @param {{dsn?: string, timeout?: number}} [opts]
 * @returns {any[][]}
 */
function dbQuery(sql, binds = [], opts) {
  return dbRun('query', { sql, binds }, opts);
}

/**
 * Run one DML statement and commit; returns rows affected.
 *
 * @param {string} sql
 * @param {any[]|Record<string, any>} [binds]  positional (:1) or named (:name)
 * @param {{dsn?: string, timeout?: number}} [opts]
 * @returns {number}
 */
function dbExec(sql, binds = [], opts) {
  return dbRun('exec', { sql, binds }, opts);
}

module.exports = { dbRun, dbQuery, dbExec };
