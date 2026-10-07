#!/usr/bin/env node
// @ts-check
/**
 * One-shot Oracle worker behind ./db.js. Reads `{dsn, task, args}` as JSON on
 * stdin, opens one connection, runs the task and prints its JSON result on
 * stdout (logs go to stderr). Run as a child process so the helpers that call
 * it can stay synchronous, and so LD_LIBRARY_PATH is in place before Node
 * starts — node-oracledb thick mode on Linux only finds the Instant Client
 * through the library search path, never through initOracleClient({libDir}).
 *
 * Thick mode (needed for the OCI DBs, which enforce Native Network
 * Encryption) is switched on when ORACLE_CLIENT_LIB is set; otherwise thin.
 */

const oracledb = require('oracledb');

/** @type {Record<string, (conn: import('oracledb').Connection, args: any) => Promise<any>>} */
const TASKS = {
  /** SELECT → array of row arrays. */
  async query(conn, { sql, binds = [] }) {
    const res = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_ARRAY });
    return res.rows;
  },
  /** DML, committed → rows affected. */
  async exec(conn, { sql, binds = [] }) {
    const res = await conn.execute(sql, binds, { autoCommit: true });
    return res.rowsAffected;
  },
  seedBillingRun: (conn, args) => require('./seed-billing-run').seedBillingRun(conn, args),
};

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { dsn, task, args } = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  if (process.env.ORACLE_CLIENT_LIB) {
    oracledb.initOracleClient(
      process.platform === 'linux' ? {} : { libDir: process.env.ORACLE_CLIENT_LIB }
    );
  }
  const conn = await oracledb.getConnection({
    user: process.env.GEO_DB_USER,
    password: process.env.GEO_DB_PASSWORD,
    connectString: dsn,
  });
  try {
    const result = await TASKS[task](conn, args);
    process.stdout.write(JSON.stringify(result === undefined ? null : result));
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[db-worker] ${err.message}\n`);
  process.exit(1);
});
