#!/usr/bin/env node
// @ts-check
/**
 * Maps the TestRail cases of the pepi suite onto their AIO Tests counterparts.
 *
 * The TestRail -> AIO migration kept the old case id as a "C<id> - " prefix on the
 * AIO case title. That prefix is the only link between the two systems, so this
 * script rebuilds an index from it, matches every pepi case by id, and verifies
 * each match by comparing titles once the migration noise is stripped.
 *
 * Matching is by id, never by title: TestRail holds distinct cases with identical
 * titles (C26445 and C26447), which title matching would silently merge.
 *
 * Reads  : pepi-cases.json          (produced by list-pepi-cases.js)
 * Writes : pepi-aio-map.json, pepi-aio-map.csv
 *
 * Auth: see aio-client.js
 *
 * Usage:
 *   node scripts/map-pepi-to-aio.js
 *   node scripts/map-pepi-to-aio.js --project GEO --cycle GEO-CY-8
 */

const fs = require('fs');
const path = require('path');
const { loadToken, paginate } = require('./aio-client');

const REPO_ROOT = path.join(__dirname, '..');
const CASES_FILE = path.join(REPO_ROOT, 'pepi-cases.json');
const OUT_JSON = path.join(REPO_ROOT, 'pepi-aio-map.json');
const OUT_CSV = path.join(REPO_ROOT, 'pepi-aio-map.csv');

/** Anchored so a stray "C" inside a title cannot produce a false match. */
const CASE_PREFIX = /^\s*C(\d+)\b\s*[-–—:.]?\s*/i;

function parseArgs(argv) {
  const args = { project: 'GEO', cycle: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') args.project = argv[(i += 1)];
    else if (argv[i] === '--cycle') args.cycle = argv[(i += 1)];
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

/**
 * Strips everything the migration added or reformatted, so that two titles that
 * describe the same scenario compare equal.
 * @param {string} title
 */
function normalizeTitle(title) {
  return (title || '')
    .replace(CASE_PREFIX, '')
    .replace(/\s*-\s*ref\.\s*\S.*$/i, '')
    .replace(/[–—]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * TestRail id -> every AIO case carrying it. The value stays an array on purpose:
 * collapsing it would hide duplicate migrations instead of reporting them.
 * @param {any[]} cases
 */
function buildIndex(cases) {
  /** @type {Map<number, any[]>} */
  const index = new Map();
  for (const aioCase of cases) {
    const hit = CASE_PREFIX.exec(aioCase.title || '');
    if (!hit) continue;
    const id = Number(hit[1]);
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(aioCase);
  }
  return index;
}

function toCsv(rows) {
  const columns = Object.keys(rows[0]);
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((c) => escape(row[c])).join(',')),
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/map-pepi-to-aio.js [--project GEO] [--cycle GEO-CY-8]');
    return 0;
  }

  if (!fs.existsSync(CASES_FILE)) {
    throw new Error(`${CASES_FILE} not found. Run scripts/list-pepi-cases.js first.`);
  }
  const suite = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  const pepiCases = suite.cases || [];
  console.log(`pepi suite: run ${suite.run_id}, label "${suite.label}", ${pepiCases.length} cases`);

  const token = loadToken();

  // Archived cases are included: a migrated case may since have been retired in
  // AIO, and leaving it out would look like a missing mapping.
  const aioCases = await paginate(token, 'POST', `/project/${args.project}/testcase/search`, {});
  const index = buildIndex(aioCases);
  const prefixed = [...index.values()].reduce((sum, list) => sum + list.length, 0);
  console.log(
    `AIO project ${args.project}: ${aioCases.length} cases, ` +
      `${prefixed} carry a C-prefix (${((prefixed / aioCases.length) * 100).toFixed(1)}%), ` +
      `${index.size} distinct TestRail ids`
  );

  const collisions = [...index.entries()].filter(([, list]) => list.length > 1);
  if (collisions.length) {
    console.log(`\nTestRail ids mapping to more than one AIO case: ${collisions.length}`);
    for (const [id, list] of collisions) {
      console.log(`  C${id} -> ${list.map((c) => c.key).join(', ')}`);
    }
  }

  /** @type {Set<string>} */
  let cycleKeys = new Set();
  if (args.cycle) {
    const runs = await paginate(
      token,
      'GET',
      `/project/${args.project}/testcycle/${args.cycle}/testcase`
    );
    cycleKeys = new Set(runs.map((r) => r.testCase && r.testCase.key).filter(Boolean));
    console.log(`cycle ${args.cycle}: ${cycleKeys.size} cases`);
  }

  const rows = [];
  const unmatched = [];
  const ambiguous = [];
  const titleMismatch = [];

  for (const pepiCase of pepiCases) {
    const matches = index.get(pepiCase.case_id);
    if (!matches) {
      unmatched.push(pepiCase);
      continue;
    }
    if (matches.length > 1) ambiguous.push(pepiCase);

    const aioCase = matches[0];
    const titlesAgree = normalizeTitle(aioCase.title) === normalizeTitle(pepiCase.title);
    if (!titlesAgree) titleMismatch.push({ pepiCase, aioCase });

    rows.push({
      testrail_case_id: `C${pepiCase.case_id}`,
      testrail_test_id: pepiCase.test_id,
      aio_key: aioCase.key,
      aio_id: aioCase.ID,
      title_verified: titlesAgree,
      ambiguous: matches.length > 1,
      in_cycle: args.cycle ? cycleKeys.has(aioCase.key) : '',
      folder: (aioCase.folder && aioCase.folder.name) || '',
      aio_status: (aioCase.status && aioCase.status.name) || '',
      title: aioCase.title,
    });
  }

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(rows, null, 2)}\n`);
  fs.writeFileSync(OUT_CSV, `${toCsv(rows)}\n`);

  console.log(`\nmatched          : ${rows.length}/${pepiCases.length}`);
  console.log(`title verified   : ${rows.filter((r) => r.title_verified).length}/${rows.length}`);
  console.log(`unmatched        : ${unmatched.length}`);
  console.log(`ambiguous        : ${ambiguous.length}`);
  if (args.cycle) {
    const inCycle = rows.filter((r) => r.in_cycle).length;
    console.log(`present in ${args.cycle}: ${inCycle}, absent: ${rows.length - inCycle}`);
    for (const row of rows.filter((r) => !r.in_cycle)) {
      console.log(`  absent: ${row.testrail_case_id} -> ${row.aio_key} | ${row.title}`);
    }
  }
  for (const c of unmatched) console.log(`  unmatched: C${c.case_id} | ${c.title}`);
  for (const m of titleMismatch) {
    console.log(`  title differs: C${m.pepiCase.case_id} -> ${m.aioCase.key}`);
    console.log(`    testrail: ${normalizeTitle(m.pepiCase.title)}`);
    console.log(`    aio     : ${normalizeTitle(m.aioCase.title)}`);
  }
  console.log(`\nwrote ${OUT_JSON}`);
  console.log(`wrote ${OUT_CSV}`);

  // Non-zero exit so CI notices a mapping that stopped being complete.
  return unmatched.length || ambiguous.length || titleMismatch.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
