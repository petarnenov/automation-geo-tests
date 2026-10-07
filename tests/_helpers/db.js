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
const { spawnSync } = require('child_process');
const { loadEnv } = require('./env');
const { resolveDbDsn } = require('./db-dsn');

const WORKER = path.join(__dirname, 'db-worker.js');

/** Known driver errors → what to do about them on this machine. */
const HINTS = [
  [
    /DPI-1047|DPI-1072|libclntsh/,
    'Oracle Instant Client not loadable: install it and set ORACLE_CLIENT_LIB in .env.local (make doctor)',
  ],
  [
    /NJS-533|Network Encryption|Data Integrity/i,
    'the DB requires thick mode: set ORACLE_CLIENT_LIB to the Instant Client directory in .env.local',
  ],
  [/ORA-01017/, 'wrong GEO_DB_USER / GEO_DB_PASSWORD in .env.local'],
  [/ORA-12514|NJS-518/, 'unknown service name: check GEO_DB_DSN in .env.local'],
  [
    /ORA-12541|ORA-12170|NJS-50[0-9]|NJS-51[0-9]|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND/,
    'DB not reachable: run make tunnel (OCI envs) and check GEO_DB_DSN in .env.local',
  ],
  [/GEO_DB_USER/, 'set GEO_DB_USER and GEO_DB_PASSWORD in .env.local'],
];

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
  const res = spawnSync(process.execPath, [WORKER], {
    input: JSON.stringify({ dsn, task, args }),
    env,
    timeout,
  });
  const stderr = String(res.stderr || '').trim();
  if (res.status === 0) {
    if (stderr) process.stderr.write(`${stderr}\n`);
    return JSON.parse(res.stdout.toString('utf8'));
  }
  // Surface the driver's own message (ORA-/DPI-/NJS-) instead of a bare
  // "Command failed": it is what tells a broken setup apart from a bad query.
  const reason =
    res.error && /** @type {any} */ (res.error).code === 'ETIMEDOUT'
      ? `no answer from ${dsn} within ${timeout / 1000}s (ETIMEDOUT)`
      : stderr.replace(/^\[db-worker\] /, '') ||
        (res.error ? res.error.message : `worker exited with ${res.status ?? res.signal}`);
  const hint = (HINTS.find(([re]) => re.test(reason)) || [])[1];
  const mode = lib ? `thick, ORACLE_CLIENT_LIB=${lib}` : 'thin';
  throw new Error(
    `DB ${task} on ${dsn} (${mode}) failed: ${reason}` + (hint ? `\n  → ${hint}` : '')
  );
}

/**
 * Open a connection and run SELECT 1, to fail fast before a run. Returns null
 * when the DB answers, else the error message (with a hint when known).
 *
 * @param {{dsn?: string, timeout?: number}} [opts]
 * @returns {string|null}
 */
function dbPing(opts) {
  try {
    dbRun('query', { sql: 'SELECT 1 FROM dual' }, { timeout: 20_000, ...opts });
    return null;
  } catch (err) {
    return err.message;
  }
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

module.exports = { dbRun, dbQuery, dbExec, dbPing };
