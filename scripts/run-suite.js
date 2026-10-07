#!/usr/bin/env node
// @ts-check
/**
 * Operator entry point behind the Makefile.
 *
 *   node scripts/run-suite.js config            show the current configuration
 *   node scripts/run-suite.js run [pw args...]  confirm, run, then confirm the AIO post
 *   node scripts/run-suite.js run --random N [pw args...]
 *                                               same, on N tests picked at random
 *
 * `run` lists what would execute (count, app, DB, AIO cycle, the status and
 * comment greens will get) and asks before starting — default No. Playwright
 * then runs with AIO posting forced off; the reporter saves the green results
 * it would have sent, and the operator is asked whether to post them —
 * default Yes. Exit code is Playwright's.
 */

const crypto = require('crypto');
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
    [
      'Run as',
      aio.assignee.accountId
        ? `${aio.assignee.name} (${aio.assignee.key}, ${aio.assignee.accountId})`
        : `chosen at make test from: ${Object.keys(aio.assignees).join(', ')}`,
    ],
    ['Green status', aio.statusNames.passed],
    ['Green comment', commentFor('passed', aio.assignee.name || '<Run as>')],
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
  // "  [chromium] › billing-runs/C25020.spec.js:34:1 › @regression C25020 ..."
  const entries = [...out.matchAll(/^\s*\[[^\]]+\] › (\S+?):(\d+):\d+ › (.+)$/gm)].map((m) => ({
    file: m[1],
    // Paths in the listing are relative to testDir; the CLI wants them from the root.
    location: `tests/${m[1]}:${m[2]}`,
    title: m[3],
  }));
  return { tests: Number(total[1]), files: Number(total[2]), entries };
}

/** Case ids (the Cxxxxx in titles) of the listed tests. */
const caseIdsOf = (entries) =>
  entries
    .map((e) => (e.title.match(/\bC(\d+)\b/) || [])[1])
    .filter(Boolean)
    .map(Number);

/**
 * Pick n of the listed tests uniformly at random.
 *
 * @template T
 * @param {T[]} items
 * @param {number} n
 * @returns {T[]}
 */
function pickRandom(items, n) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
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
  const a = (await ask(`${bold(question)} ${hint} `)).toLowerCase();
  if (!a) return defaultYes;
  return ['y', 'yes', 'д', 'да'].includes(a);
}

/** @param {string} prompt */
async function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  return String(answer).trim();
}

/**
 * Who the run is for: the assignee and the name in the comment of every
 * reported result. There is no default — the operator picks from
 * aio.config.json `assignees`, or passes RUN_AS (make test RUNAS=...).
 *
 * @returns {Promise<boolean>} false when nobody valid was chosen
 */
async function chooseRunAs() {
  const { assignees, assignee } = loadAioConfig();
  const keys = Object.keys(assignees);
  if (assignee.accountId) {
    process.env.RUN_AS = assignee.key;
    return true;
  }
  if (process.env.RUN_AS) {
    console.error(`RUN_AS "${process.env.RUN_AS}" is not in aio.config.json (${keys.join(', ')}).`);
    return false;
  }
  if (!process.stdin.isTTY) {
    console.error(`No terminal to ask who runs the suite. Pass RUNAS=<${keys.join('|')}>.`);
    return false;
  }

  console.log(bold('\nRun as'));
  keys.forEach((k, i) => console.log(`  ${i + 1}) ${assignees[k].name.padEnd(22)} ${k}`));
  for (;;) {
    const n = Number(await ask(`${bold('Choose')} [1-${keys.length}] `));
    if (Number.isInteger(n) && n >= 1 && n <= keys.length) {
      process.env.RUN_AS = keys[n - 1];
      return true;
    }
    console.log(`  Enter a number from 1 to ${keys.length}.`);
  }
}

async function run(argv) {
  let args = argv;
  let randomN = 0;
  if (args[0] === '--random') {
    randomN = Number(args[1]);
    if (!Number.isInteger(randomN) || randomN < 1) {
      console.error(`--random needs a positive whole number, got "${args[1] ?? ''}".`);
      return 2;
    }
    args = args.slice(2);
  }

  if (!(await chooseRunAs())) return 1;
  console.log(bold('\nConfiguration'));
  const { aio, mapping } = await printConfig();

  let listed = listTests(args);
  let suiteSize = '';
  if (randomN) {
    const picked = pickRandom(listed.entries, randomN);
    suiteSize = ` (random ${picked.length} of ${listed.tests})`;
    listed = {
      tests: picked.length,
      files: new Set(picked.map((e) => e.file)).size,
      entries: picked,
    };
    args = [...args, ...picked.map((e) => e.location)];
  }
  const unique = [...new Set(caseIdsOf(listed.entries))];
  const mapped = mapping ? unique.filter((id) => mapping.has(id)).length : 0;
  console.log(bold('\nRun'));
  console.log(`  Tests         ${listed.tests} in ${listed.files} files${suiteSize}`);
  if (randomN) {
    for (const e of listed.entries) console.log(`                ${e.title}`);
  }
  console.log(`  AIO-mapped    ${mapped} of ${unique.length} case ids`);
  if (!randomN) console.log(`  Args          ${args.length ? args.join(' ') : '(none)'}`);
  console.log(
    `  Greens get    ${aio.statusNames.passed} + "${commentFor('passed', aio.assignee.name)}" in ${aio.cycleKey}`
  );
  console.log(`  Assigned to   ${aio.assignee.name}\n`);

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
  console.log(`  Comment       "${pending.testRuns[0].comments[0]}"`);
  console.log(`  Assigned to   ${aio.assignee.name}\n`);

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
