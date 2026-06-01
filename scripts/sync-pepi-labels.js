#!/usr/bin/env node
// @ts-check
/**
 * Ensures every Playwright @pepi test has its corresponding TestRail case
 * tagged with the "Pepi" test label.
 *
 * Source of truth for @pepi case IDs: the `Cxxxxx` IDs embedded in each
 * `tests/**\/*.spec.js` test title that is tagged with @pepi.
 *
 * Source of truth for current case labels: `get_case/{id}` — TestRail's
 * case-level labels (these are what render in the "Test Labels" column of
 * the case grid). Note: `get_tests/{run_id}` labels are TEST-level labels
 * applied per-run, which are a different thing.
 *
 * Behaviour:
 *   1. Extracts @pepi case IDs from the repo.
 *   2. Reads current case-level labels via get_case.
 *   3. For any case where the Pepi label is missing, POSTs update_case
 *      preserving pre-existing labels and appending Pepi (id 22 in project 2).
 *
 * Auth: TESTRAIL_USER + (TESTRAIL_API_KEY or TESTRAIL_PASSWORD).
 *
 * Env knobs:
 *   - DRY_RUN=1   — log the planned writes but don't POST them
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');
const PEPI_LABEL_TITLE = 'Pepi';
const PROJECT_ID = 2;
const DRY_RUN = process.env.DRY_RUN === '1';

const baseUrl = (process.env.TESTRAIL_URL
  ? new URL(process.env.TESTRAIL_URL).origin
  : 'https://testrail.geowealth.com');
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

async function trCall(method, endpoint, body) {
  const url = `${baseUrl}/index.php?/api/v2/${endpoint}`;
  let lastErr = null;
  for (const cred of credentials) {
    const auth = Buffer.from(`${user}:${cred.secret}`).toString('base64');
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    if (res.status === 401) {
      lastErr = `401 with ${cred.label}`;
      continue;
    }
    const text = await res.text();
    throw new Error(`${method} ${endpoint} failed: ${res.status} ${res.statusText}\n${text}`);
  }
  throw new Error(`${method} ${endpoint} failed all auth attempts: ${lastErr}`);
}

async function trGetPaginated(endpoint, collectionKey) {
  /** @type {any[]} */
  const out = [];
  let next = endpoint;
  while (next) {
    const data = await trCall('GET', next);
    if (Array.isArray(data)) {
      out.push(...data);
      break;
    }
    out.push(...(data[collectionKey] || []));
    const link = data._links && data._links.next;
    next = link ? link.replace(/^\/api\/v2\//, '') : null;
  }
  return out;
}

function collectPepiCaseIds(dir) {
  const re = /@pepi\s+C(\d+)\b/g;
  const ids = new Set();
  /** @param {string} d */
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.isFile() || !/\.spec\.(js|ts)$/.test(entry.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      let m;
      while ((m = re.exec(src))) ids.add(Number(m[1]));
    }
  }
  walk(dir);
  return [...ids].sort((a, b) => a - b);
}

(async () => {
  const caseIds = collectPepiCaseIds(TESTS_DIR);
  console.log(`[sync-pepi-labels] found ${caseIds.length} @pepi case IDs in tests/`);
  if (caseIds.length === 0) {
    console.log('[sync-pepi-labels] nothing to do.');
    return;
  }

  // Find the Pepi label id in the project.
  const labelsPayload = await trCall('GET', `get_labels/${PROJECT_ID}`);
  const labels = labelsPayload.labels || labelsPayload;
  const pepi = (Array.isArray(labels) ? labels : []).find(
    (l) => String(l.title).toLowerCase() === PEPI_LABEL_TITLE.toLowerCase()
  );
  if (!pepi) {
    throw new Error(`Pepi label not found in project ${PROJECT_ID}`);
  }
  console.log(`[sync-pepi-labels] Pepi label id=${pepi.id}`);

  // Pull current case-level labels via get_case. This is what renders in the
  // "Test Labels" column of the case grid. Test-level labels in run payloads
  // (get_tests) are a different surface.
  console.log(`[sync-pepi-labels] reading current case-level labels for ${caseIds.length} case(s)...`);
  let already = 0;
  const toUpdate = [];
  let i = 0;
  for (const id of caseIds) {
    i++;
    const c = await trCall('GET', `get_case/${id}`);
    const lbls = Array.isArray(c.labels) ? c.labels : [];
    if (i % 10 === 0) console.log(`  ... ${i}/${caseIds.length}`);
    const has = lbls.some((l) => Number(l.id) === Number(pepi.id));
    if (has) {
      already++;
      continue;
    }
    const merged = [...new Set([...lbls.map((l) => l.id), pepi.id])];
    toUpdate.push({ id, merged, before: lbls });
  }

  console.log(
    `[sync-pepi-labels] already labeled: ${already}/${caseIds.length}, need update: ${toUpdate.length}`
  );

  if (toUpdate.length === 0) {
    console.log('[sync-pepi-labels] nothing to write — every @pepi case is already tagged Pepi.');
    return;
  }

  for (const u of toUpdate) {
    const beforeStr = u.before.map((l) => `${l.id}:${l.title}`).join(',') || '∅';
    console.log(`  C${u.id}  labels: [${beforeStr}] -> [${u.merged.join(',')}]`);
    if (!DRY_RUN) {
      await trCall('POST', `update_case/${u.id}`, { labels: u.merged });
    }
  }
  console.log(
    DRY_RUN
      ? `[sync-pepi-labels] DRY_RUN: would have updated ${toUpdate.length} case(s).`
      : `[sync-pepi-labels] updated ${toUpdate.length} case(s).`
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
