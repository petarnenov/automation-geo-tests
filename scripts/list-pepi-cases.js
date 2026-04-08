#!/usr/bin/env node
// @ts-check
/**
 * Fetches all tests in the focused TestRail run, filters those carrying the
 * configured label (default "pepi"), and writes the result to pepi-cases.json.
 *
 * Auth: TESTRAIL_USER + (TESTRAIL_API_KEY or TESTRAIL_PASSWORD), API key tried first.
 * Host: TESTRAIL_URL env overrides the host derived from testrail.config.json.
 */

const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testrail.config.json'), 'utf8'));

const runId = cfg.testrail.focusedRun.runId;
const labelName = (cfg.testrail.filter.label || '').toLowerCase();
const baseUrl = process.env.TESTRAIL_URL
  ? new URL(process.env.TESTRAIL_URL).origin
  : new URL(cfg.testrail.focusedRun.url).origin;
const user = process.env.TESTRAIL_USER;
const apiKey = process.env.TESTRAIL_API_KEY;
const password = process.env.TESTRAIL_PASSWORD;

if (!user || (!apiKey && !password)) {
  console.error('Missing TESTRAIL_USER + (TESTRAIL_API_KEY or TESTRAIL_PASSWORD) in env.');
  process.exit(1);
}

const credentials = [];
if (apiKey) credentials.push({ label: 'api_key', secret: apiKey });
if (password) credentials.push({ label: 'password', secret: password });

async function trGet(endpoint) {
  const url = `${baseUrl}/index.php?/api/v2/${endpoint}`;
  let lastErr = null;
  for (const cred of credentials) {
    const auth = Buffer.from(`${user}:${cred.secret}`).toString('base64');
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.ok) return res.json();
    if (res.status === 401) {
      lastErr = `401 with ${cred.label}`;
      continue;
    }
    const body = await res.text();
    throw new Error(`GET ${endpoint} failed: ${res.status} ${res.statusText}\n${body}`);
  }
  throw new Error(`GET ${endpoint} failed all auth attempts: ${lastErr}`);
}

/**
 * TestRail paginates list endpoints. Walk `_links.next` until exhausted.
 * Some endpoints return `{ tests: [...], _links: {...} }`, others return arrays directly.
 */
async function trGetPaginated(endpoint, collectionKey) {
  /** @type {any[]} */
  const all = [];
  let next = endpoint;
  while (next) {
    const data = await trGet(next);
    if (Array.isArray(data)) {
      all.push(...data);
      break;
    }
    const items = data[collectionKey] || [];
    all.push(...items);
    const nextLink = data._links && data._links.next;
    if (!nextLink) break;
    // _links.next looks like "/api/v2/get_tests/175&limit=250&offset=250"
    next = nextLink.replace(/^\/api\/v2\//, '');
  }
  return all;
}

(async () => {
  console.log(`[list-pepi-cases] host=${baseUrl} run=${runId} label="${labelName}"`);

  // 1. Pull all tests in the run.
  const tests = await trGetPaginated(`get_tests/${runId}`, 'tests');
  console.log(`[list-pepi-cases] fetched ${tests.length} tests in run ${runId}`);

  // 2. Determine which tests carry the target label. TestRail returns labels as
  //    either an array of {id, title} objects on the case, or as a separate
  //    `labels` field on the test. We try a few shapes to be defensive.
  const matched = [];
  for (const t of tests) {
    const labels = extractLabels(t);
    if (labels.some((l) => l.toLowerCase() === labelName)) {
      matched.push({
        test_id: t.id,
        case_id: t.case_id,
        title: t.title,
        status_id: t.status_id,
        labels,
      });
    }
  }

  // 3. If the label info isn't on the test payload, fall back to fetching each
  //    underlying case and checking its labels there.
  if (matched.length === 0) {
    console.log(`[list-pepi-cases] no labels on test payloads, falling back to per-case fetch...`);
    let checked = 0;
    for (const t of tests) {
      checked++;
      if (checked % 25 === 0) {
        console.log(`  ... ${checked}/${tests.length}`);
      }
      const c = await trGet(`get_case/${t.case_id}`);
      const labels = extractLabels(c);
      if (labels.some((l) => l.toLowerCase() === labelName)) {
        matched.push({
          test_id: t.id,
          case_id: t.case_id,
          title: t.title,
          status_id: t.status_id,
          labels,
        });
      }
    }
  }

  console.log(`[list-pepi-cases] matched ${matched.length} case(s) with label "${labelName}"`);
  for (const m of matched) {
    console.log(`  C${m.case_id}  T${m.test_id}  ${m.title}`);
  }

  const out = path.join(__dirname, '..', 'pepi-cases.json');
  fs.writeFileSync(
    out,
    JSON.stringify(
      { run_id: runId, label: labelName, count: matched.length, cases: matched },
      null,
      2
    )
  );
  console.log(`[list-pepi-cases] wrote ${out}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * @param {any} obj
 * @returns {string[]}
 */
function extractLabels(obj) {
  if (!obj) return [];
  const raw = obj.labels;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((l) => (typeof l === 'string' ? l : l && (l.title || l.name))).filter(Boolean);
  }
  if (typeof raw === 'string') return [raw];
  return [];
}
