// @ts-check
/**
 * Oracle DSN resolution for the direct-DB helpers. Kept free of Playwright
 * imports so tooling (scripts/run-suite.js) can show which DB a run targets.
 */

const { cfg } = require('./config');

// Oracle DSN for the direct-DB helpers (MFA disable, password-expiry seeding,
// audit probes). A wrong DSN makes the UPDATEs silently no-op — see
// docs/tim1-shim.md — so the DSN must track whichever env appUnderTest.url
// points at. Resolution order:
//   1. GEO_DB_DSN env var (explicit override, always wins)
//   2. derived from the app host: qa4's long-lived DB is at 192.168.1.42
//      (the `dbhost` alias); qa5+ each sit on their own `<env>db.geowealth.int` clone
//      (confirmed via the Deploy Environment flyway log, e.g. qa7 →
//      qa7db.geowealth.int:1521/orcl12vm). See project_qa7_db_mismatch /
//      project_qa5_db_dsn memories.
function resolveDbDsn() {
  if (process.env.GEO_DB_DSN) return process.env.GEO_DB_DSN;
  const host = (() => {
    try {
      return new URL(cfg.appUnderTest.url).hostname;
    } catch {
      return '';
    }
  })();
  // qabis1 (and its legacy -eol alias) sits in the OCI VCN; the PDB is only
  // reachable through a tunnel, but never fall back to qa4's DB for it.
  const bis = (host.match(/^(qabis\d+)(-eol)?\./i) || [])[1];
  if (bis)
    return `qadb.datasn.qa.oraclevcn.com:1521/${bis.toLowerCase()}pdb.datasn.qa.oraclevcn.com`;
  const env = (host.match(/^(qa\d+)\./i) || [])[1];
  if (/^qa4$/i.test(env || '')) return '192.168.1.42:1521/ORCL12VM';
  if (!env) throw new Error(`resolveDbDsn: unknown env host "${host}" — set GEO_DB_DSN explicitly`);
  return `${env.toLowerCase()}db.geowealth.int:1521/orcl12vm`;
}

module.exports = { resolveDbDsn };
