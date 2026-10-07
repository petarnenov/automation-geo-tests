#!/usr/bin/env node
// @ts-check
/**
 * Operator entry point behind the Makefile.
 *
 *   node scripts/run-suite.js config            show the current configuration
 *   node scripts/run-suite.js run [pw args...]  confirm, run, then confirm the AIO post
 *
 * `run` lists what would execute (count, app, DB, AIO cycle, the status and
 * comment greens will get) and asks before starting — default No. Playwright
 * then runs with AIO posting forced off; the reporter saves the green results
 * it would have sent, and the operator is asked whether to post them —
 * default Yes. Exit code is Playwright's.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const { cfg } = require('../tests/_helpers/config');
const { resolveDbDsn } = require('../tests/_helpers/db-dsn');
const { loadToken, request, TOKEN_FILE } = require('./aio-client');
const { PENDING_FILE, loadAioConfig, commentFor, postTestRuns } = require('./aio-post');
const { tunnelStatus, ensureTunnel } = require('./db-tunnel');

const REPO_ROOT = path.join(__dirname, '..');
const PLAYWRIGHT = path.join(REPO_ROOT, 'node_modules', '.bin', 'playwright');
// sitecustomize.py there switches oracledb to thick mode when ORACLE_CLIENT_LIB
// is set (needed for the OCI DBs); without that var it does nothing.
const PY_HELPERS = path.join(REPO_ROOT, 'tests', '_helpers', 'py');

const bold = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

function dbInfo() {
  try {
    const dsn = resolveDbDsn();
    const source = process.env.GEO_DB_DSN ? 'GEO_DB_DSN' : 'derived from app URL';
    return `${dsn}  (${source})`;
  } catch (err) {
    return `UNRESOLVED: ${err.message}`;
  }
}

/** Cycle title from AIO, or a note why it could not be fetched. */
async function cycleTitle(aio) {
  try {
    const cycle = await request(
      loadToken(),
      'GET',
      `/project/${aio.projectKey}/testcycle/${aio.cycleKey}/detail`
    );
    return `"${cycle.title}"` + (cycle.folder ? `, folder ${cycle.folder.name}` : '');
  } catch (err) {
    return `(title unavailable: ${err.message.split('\n')[0]})`;
  }
}

function loadMapping(aio) {
  if (!fs.existsSync(aio.mappingFile)) return null;
  const rows = JSON.parse(fs.readFileSync(aio.mappingFile, 'utf8'));
  return new Set(rows.map((r) => Number(String(r.testrail_case_id).replace(/^C/i, ''))));
}

async function printConfig() {
  const aio = loadAioConfig();
  const mapping = loadMapping(aio);
  const tokenSource = process.env.AIO_TOKEN
    ? 'AIO_TOKEN'
    : fs.existsSync(TOKEN_FILE)
      ? TOKEN_FILE
      : 'MISSING';
  const posting =
    process.env.AIO_REPORT_RESULTS === '1' ? 'auto (AIO_REPORT_RESULTS=1)' : 'ask after run';

  const rows = [
    ['App URL', cfg.appUnderTest.url],
    ['App user', cfg.appUnderTest.username],
    ['DB DSN', dbInfo()],
    ['DB user', process.env.GEO_DB_USER || 'MISSING (GEO_DB_USER)'],
    ['DB tunnel', await tunnelStatus()],
    ['Oracle client', process.env.ORACLE_CLIENT_LIB || 'thin mode (ORACLE_CLIENT_LIB unset)'],
    ['AIO project', aio.projectKey],
    ['AIO cycle', `${aio.cycleKey} ${await cycleTitle(aio)}`],
    ['AIO token', tokenSource],
    [
      'AIO mapping',
      mapping ? `${path.relative(REPO_ROOT, aio.mappingFile)} (${mapping.size} cases)` : 'MISSING',
    ],
    ['Reported', process.env.AIO_REPORT_ALL === '1' ? 'all results' : 'green results only'],
    ['Green status', aio.statusNames.passed],
    ['Green comment', commentFor('passed')],
    ['AIO posting', posting],
    ['Label filter', `@${cfg.playwright.labelFilter}`],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(`  ${k.padEnd(width)}  ${v}`);
  return { aio, mapping };
}

/** Run `playwright test --list` with the same args and parse what it would run. */
function listTests(args) {
  const res = spawnSync(PLAYWRIGHT, ['test', '--list', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, AIO_REPORT_RESULTS: '0' },
  });
  const out = `${res.stdout}${res.stderr}`;
  const total = out.match(/Total: (\d+) tests? in (\d+) files?/);
  if (!total) {
    if (/No tests found/.test(out)) return { tests: 0, files: 0, caseIds: [] };
    throw new Error(`playwright --list failed:\n${out.slice(-1500)}`);
  }
  const caseIds = [...out.matchAll(/›[^\n]*?\bC(\d+)\b/g)].map((m) => Number(m[1]));
  return { tests: Number(total[1]), files: Number(total[2]), caseIds };
}

/**
 * @param {string} question
 * @param {boolean} defaultYes
 */
async function confirm(question, defaultYes) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  if (!process.stdin.isTTY) {
    console.log(`${question} ${hint} → ${defaultYes ? 'Yes' : 'No'} (no terminal, default)`);
    return defaultYes;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${bold(question)} ${hint} `, resolve));
  rl.close();
  const a = String(answer).trim().toLowerCase();
  if (!a) return defaultYes;
  return ['y', 'yes', 'д', 'да'].includes(a);
}

async function run(args) {
  console.log(bold('\nConfiguration'));
  const { aio, mapping } = await printConfig();

  const listed = listTests(args);
  const unique = [...new Set(listed.caseIds)];
  const mapped = mapping ? unique.filter((id) => mapping.has(id)).length : 0;
  console.log(bold('\nRun'));
  console.log(`  Tests         ${listed.tests} in ${listed.files} files`);
  console.log(`  AIO-mapped    ${mapped} of ${unique.length} case ids`);
  console.log(`  Args          ${args.length ? args.join(' ') : '(none)'}`);
  console.log(
    `  Greens get    ${aio.statusNames.passed} + "${commentFor('passed')}" in ${aio.cycleKey}\n`
  );

  if (listed.tests === 0) {
    console.log('Nothing to run.');
    return 0;
  }
  if (!(await confirm(`Run ${listed.tests} tests?`, false))) {
    console.log('Cancelled.');
    return 0;
  }

  if (!(await ensureTunnel())) {
    console.error('DB tunnel is down, not running. Check DB_TUNNEL_* in .env.local.');
    return 1;
  }

  fs.rmSync(PENDING_FILE, { force: true });
  const code = await new Promise((resolve) => {
    const child = spawn(PLAYWRIGHT, ['test', ...args], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      // Posting is the operator's call after the run, never the reporter's.
      env: {
        ...process.env,
        AIO_REPORT_RESULTS: '0',
        AIO_PENDING_FILE: PENDING_FILE,
        PYTHONPATH: [PY_HELPERS, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      },
    });
    child.on('exit', (c, signal) => resolve(c ?? (signal ? 1 : 0)));
  });

  if (!fs.existsSync(PENDING_FILE)) {
    console.log('\nNo results to post to AIO.');
    return code;
  }
  const pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
  if (!pending.testRuns.length) {
    console.log('\nNo results to post to AIO.');
    return code;
  }
  const byStatus = pending.testRuns.reduce((acc, r) => {
    acc[r.testRunStatus] = (acc[r.testRunStatus] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byStatus)
    .map(([s, n]) => `${n} ${s}`)
    .join(', ');
  console.log(bold('\nAIO'));
  console.log(`  Ready         ${summary} → ${pending.cycleKey}`);
  console.log(`  Comment       "${commentFor('passed')}"\n`);

  if (await confirm(`Post ${pending.testRuns.length} result(s) to ${pending.cycleKey}?`, true)) {
    await postTestRuns(pending.testRuns, {
      projectKey: pending.projectKey,
      cycleKey: pending.cycleKey,
    });
  } else {
    console.log(
      `Not posted. Later: node scripts/aio-post.js ${path.relative(REPO_ROOT, PENDING_FILE)}`
    );
  }
  return code;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'config') {
    await printConfig();
    return 0;
  }
  if (cmd === 'run') return run(rest);
  console.error('Usage: run-suite.js config | run [playwright args...]');
  return 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message);
    process.exit(1);
  }
);
