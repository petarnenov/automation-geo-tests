#!/usr/bin/env node
// @ts-check
/**
 * Check that this machine can run the suite: Node, npm packages, the
 * Playwright browser, node-oracledb (thin or thick) for the DB helpers, .env.local, the
 * AIO token and, when configured, the Oracle client and the DB tunnel.
 *
 *   node scripts/doctor.js
 *
 * Exits 0 when everything is in place, 1 otherwise. Each failure names the
 * command that fixes it — `make setup` for anything installable, a manual
 * step for credentials.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const ENV_LOCAL = path.join(REPO_ROOT, '.env.local');
/** Credentials every run needs; the rest of .env.example is optional. */
const REQUIRED_ENV = [
  'TIM1_USERNAME',
  'TIM1_PASSWORD',
  'GEO_DB_USER',
  'GEO_DB_PASSWORD',
  'GEO_TEST_USER_PASSWORD',
];

const tty = process.stdout.isTTY;
const green = (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);

/** @typedef {{ok: boolean, detail: string, fix?: string}} Result */

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return { ok: res.status === 0, out: `${res.stdout || ''}${res.stderr || ''}`.trim() };
}

/** @param {string|undefined} p */
function expandHome(p) {
  return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** @returns {Result} */
function checkNode() {
  const range = require('../package.json').engines.node;
  const major = Number(process.versions.node.split('.')[0]);
  const [min, max] = (range.match(/\d+/g) || []).map(Number);
  const ok = major >= min && (max === undefined || major < max);
  return {
    ok,
    detail: `v${process.versions.node} (needs ${range})`,
    fix: 'sh scripts/check-node.sh (prints the install commands for this OS)',
  };
}

/** @returns {Result} */
function checkPackages() {
  const installed = path.join(REPO_ROOT, 'node_modules', '.package-lock.json');
  if (!fs.existsSync(installed)) {
    return { ok: false, detail: 'node_modules missing', fix: 'make setup' };
  }
  const lock = path.join(REPO_ROOT, 'package-lock.json');
  if (fs.statSync(lock).mtimeMs > fs.statSync(installed).mtimeMs) {
    return { ok: false, detail: 'package-lock.json is newer than node_modules', fix: 'make setup' };
  }
  const ls = run('npm', ['ls', '--depth=0']);
  return ls.ok
    ? { ok: true, detail: 'installed, matches package-lock.json' }
    : {
        ok: false,
        detail: ls.out.split('\n').find((l) => /ERR|missing|invalid/.test(l)) || 'npm ls failed',
        fix: 'make setup',
      };
}

/** @returns {Result} */
function checkBrowser() {
  try {
    const exe = require('playwright-core').chromium.executablePath();
    return fs.existsSync(exe)
      ? { ok: true, detail: exe }
      : {
          ok: false,
          detail: 'Chromium for this Playwright version not downloaded',
          fix: 'make setup',
        };
  } catch (err) {
    return { ok: false, detail: `playwright-core not loadable: ${err.message}`, fix: 'make setup' };
  }
}

/**
 * node-oracledb loads, and when ORACLE_CLIENT_LIB is set, thick mode starts the
 * way tests/_helpers/db-worker.js starts it (Instant Client on LD_LIBRARY_PATH).
 *
 * @returns {Result}
 */
function checkOracledb() {
  const lib = expandHome(process.env.ORACLE_CLIENT_LIB);
  const env = { ...process.env };
  if (lib)
    env.LD_LIBRARY_PATH = [lib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  const probe =
    "const o = require('oracledb');" +
    "if (process.env.ORACLE_CLIENT_LIB) { o.initOracleClient(process.platform === 'linux' ? {} : { libDir: process.env.ORACLE_CLIENT_LIB });" +
    '  console.log(`oracledb ${o.versionString}, thick, client ${o.oracleClientVersionString}`); }' +
    'else console.log(`oracledb ${o.versionString}, thin`);';
  const res = spawnSync(process.execPath, ['-e', probe], { cwd: REPO_ROOT, env, encoding: 'utf8' });
  if (res.status === 0) return { ok: true, detail: res.stdout.trim() };
  const err =
    (res.stderr || '').split('\n').find((l) => /Error|DPI-|NJS-/.test(l)) || 'failed to load';
  return /Cannot find module/.test(err)
    ? { ok: false, detail: 'oracledb package missing', fix: 'make setup' }
    : {
        ok: false,
        detail: err.trim(),
        fix: 'install Oracle Instant Client or fix ORACLE_CLIENT_LIB in .env.local',
      };
}

/** @returns {Result} */
function checkEnvLocal() {
  if (!fs.existsSync(ENV_LOCAL)) {
    return { ok: false, detail: '.env.local missing', fix: 'make setup, then fill in .env.local' };
  }
  const empty = REQUIRED_ENV.filter((k) => !(process.env[k] || '').trim());
  return empty.length
    ? { ok: false, detail: `empty: ${empty.join(', ')}`, fix: 'fill these in .env.local' }
    : { ok: true, detail: `${REQUIRED_ENV.length} required credentials set` };
}

/** @returns {Result} */
function checkAioToken() {
  if ((process.env.AIO_TOKEN || '').trim()) return { ok: true, detail: 'AIO_TOKEN (.env.local)' };
  return {
    ok: false,
    detail: 'no AIO_TOKEN in .env.local',
    fix: 'generate a token in Jira (AIO Tests -> My Settings -> API Token), set AIO_TOKEN=<token> in .env.local',
  };
}

/** Only when .env.local points at an Instant Client (OCI DBs, thick mode). @returns {Result|null} */
function checkOracleClient() {
  const lib = expandHome(process.env.ORACLE_CLIENT_LIB);
  if (!lib) return null;
  const ok = fs.existsSync(lib) && fs.readdirSync(lib).some((f) => f.startsWith('libclntsh.so'));
  return ok
    ? { ok: true, detail: lib }
    : {
        ok: false,
        detail: `no libclntsh.so in ${lib}`,
        fix: 'install Oracle Instant Client there or fix ORACLE_CLIENT_LIB in .env.local',
      };
}

/** Only when .env.local configures the DB tunnel. @returns {Result|null} */
function checkTunnel() {
  if (!process.env.DB_TUNNEL_HOST) return null;
  if (!run('ssh', ['-V']).ok)
    return { ok: false, detail: 'ssh not found', fix: 'sudo apt install openssh-client' };
  const missing = ['DB_TUNNEL_KEY', 'DB_TUNNEL_CERT']
    .filter((k) => process.env[k])
    .filter((k) => !fs.existsSync(/** @type {string} */ (expandHome(process.env[k]))));
  return missing.length
    ? {
        ok: false,
        detail: `file not found: ${missing.map((k) => `${k}=${process.env[k]}`).join(', ')}`,
        fix: 'fix the path in .env.local',
      }
    : { ok: true, detail: `ssh ok, key files present (${process.env.DB_TUNNEL_HOST})` };
}

function main() {
  require('../tests/_helpers/env').loadEnv();

  /** @type {[string, () => Result|null][]} */
  const checks = [
    ['Node', checkNode],
    ['npm packages', checkPackages],
    ['Playwright browser', checkBrowser],
    ['Oracle driver', checkOracledb],
    ['.env.local', checkEnvLocal],
    ['AIO token', checkAioToken],
    ['Oracle client', checkOracleClient],
    ['DB tunnel', checkTunnel],
  ];

  const failed = [];
  console.log(bold('Doctor'));
  for (const [name, check] of checks) {
    const res = check();
    if (!res) continue;
    console.log(`  ${res.ok ? green('✔') : red('✘')} ${name.padEnd(20)} ${res.detail}`);
    if (!res.ok) failed.push({ name, ...res });
  }

  if (!failed.length) {
    console.log(green('  all good\n'));
    return 0;
  }
  console.log(`\n${red(bold('Not ready'))} — fix and re-run ${bold('make doctor')}:`);
  for (const f of failed) console.log(`  ${f.name.padEnd(20)} ${bold(f.fix || '')}`);
  console.log('');
  return 1;
}

process.exitCode = main();
