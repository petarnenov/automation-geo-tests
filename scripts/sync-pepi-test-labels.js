#!/usr/bin/env node
// @ts-check
/**
 * Ensures every Playwright @pepi test's TestRail test instance in a given run
 * carries the "Pepi" TEST-LEVEL label (the "Test Labels" column in the run
 * grid).
 *
 * Background: case-level labels (managed by sync-pepi-labels.js) and test-level
 * labels are independent surfaces. The run grid reads test-level. The public
 * REST endpoint update_test is permission-locked, so we drive the UI's
 * internal AJAX endpoint via a real logged-in Playwright session.
 *
 * Usage:
 *   node scripts/sync-pepi-test-labels.js                # default run from config
 *   node scripts/sync-pepi-test-labels.js --run 198
 *   DRY_RUN=1 node scripts/sync-pepi-test-labels.js
 *
 * Auth:
 *   - TESTRAIL_USER + TESTRAIL_PASSWORD   (UI login, required)
 *   - TESTRAIL_USER + TESTRAIL_API_KEY    (REST mapping, falls back to password)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');
const PEPI_LABEL_ID = 22;
const PROJECT_ID = 2;
const DRY_RUN = process.env.DRY_RUN === '1';

const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'testrail.config.json'), 'utf8'));
const runArg = process.argv.indexOf('--run');
const runId = runArg !== -1 ? Number(process.argv[runArg + 1]) : Number(cfg.testrail.focusedRun.runId);

const baseUrl = process.env.TESTRAIL_URL ? new URL(process.env.TESTRAIL_URL).origin : 'https://testrail.geowealth.com';
const user = process.env.TESTRAIL_USER;
const apiKey = process.env.TESTRAIL_API_KEY;
const password = process.env.TESTRAIL_PASSWORD;

if (!user || !password) {
  console.error('Missing TESTRAIL_USER or TESTRAIL_PASSWORD (UI login uses password).');
  process.exit(1);
}

function collectPepiCaseIds(dir) {
  const re = /@pepi\s+C(\d+)\b/g;
  const ids = new Set();
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.isFile() || !/\.spec\.(js|ts)$/.test(entry.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      let m; while ((m = re.exec(src))) ids.add(Number(m[1]));
    }
  }
  walk(dir);
  return [...ids].sort((a, b) => a - b);
}

async function trGet(endpoint) {
  const creds = [];
  if (apiKey) creds.push({ label: 'api_key', secret: apiKey });
  if (password) creds.push({ label: 'password', secret: password });
  let lastErr = null;
  for (const c of creds) {
    const auth = Buffer.from(`${user}:${c.secret}`).toString('base64');
    const r = await fetch(`${baseUrl}/index.php?/api/v2/${endpoint}`, {
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    });
    if (r.ok) return r.json();
    if (r.status === 401) { lastErr = `401 with ${c.label}`; continue; }
    throw new Error(`GET ${endpoint} ${r.status}: ${await r.text()}`);
  }
  throw new Error(`GET ${endpoint} auth failed: ${lastErr}`);
}

async function getCaseToTestMap(runId) {
  const map = new Map();
  let next = `get_tests/${runId}`;
  while (next) {
    const d = await trGet(next);
    const items = Array.isArray(d) ? d : (d.tests || []);
    for (const t of items) map.set(t.case_id, t);
    const link = d._links && d._links.next;
    next = link ? link.replace(/^\/api\/v2\//, '') : null;
  }
  return map;
}

(async () => {
  const caseIds = collectPepiCaseIds(TESTS_DIR);
  console.log(`[sync-pepi-test-labels] run=${runId}  @pepi cases in repo=${caseIds.length}`);

  const caseToTest = await getCaseToTestMap(runId);
  const need = [];
  const missingFromRun = [];
  let already = 0;
  for (const cid of caseIds) {
    const t = caseToTest.get(cid);
    if (!t) { missingFromRun.push(cid); continue; }
    const lbls = Array.isArray(t.labels) ? t.labels : [];
    if (lbls.some((l) => Number(l.id) === PEPI_LABEL_ID)) { already++; continue; }
    need.push(t.id);
  }
  if (missingFromRun.length) {
    console.warn(`[sync-pepi-test-labels] ${missingFromRun.length} @pepi case(s) NOT present in run ${runId}: ${missingFromRun.map(n => 'C' + n).join(', ')}`);
  }
  console.log(`[sync-pepi-test-labels] already labeled: ${already}, need update: ${need.length}`);
  if (need.length === 0) { console.log('[sync-pepi-test-labels] nothing to do.'); return; }

  if (DRY_RUN) {
    console.log(`[sync-pepi-test-labels] DRY_RUN: would label T-ids ${need.join(',')}`);
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(`${baseUrl}/index.php?/auth/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid=loginIdName]').fill(user);
    await page.locator('[data-testid=loginPasswordFormDialog]').fill(password);
    await page.locator('[data-testid=loginButtonPrimary]').click();
    await page.waitForURL(/^(?!.*\/auth\/login).*/, { timeout: 30000 });
    await page.goto(`${baseUrl}/index.php?/runs/view/${runId}`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async ({ ids, labelId, projectId }) => {
      return new Promise((resolve) => {
        window.App.Ajax.call({
          target: 'tests/ajax_mass_edit_labels',
          arguments: { entity_ids: ids.join(','), labels: JSON.stringify([labelId]), project: projectId },
          success: (data) => resolve({ ok: true, data }),
          error: (err) => resolve({ ok: false, err }),
        });
      });
    }, { ids: need, labelId: PEPI_LABEL_ID, projectId: PROJECT_ID });

    if (!result.ok) {
      console.error('[sync-pepi-test-labels] UI ajax failed:', JSON.stringify(result.err).slice(0, 400));
      process.exit(1);
    }
    console.log(`[sync-pepi-test-labels] applied Pepi to ${need.length} test instance(s) in run ${runId}.`);

    // Re-verify
    const caseToTestAfter = await getCaseToTestMap(runId);
    let labeled = 0;
    for (const cid of caseIds) {
      const t = caseToTestAfter.get(cid);
      if (t && (t.labels || []).some((l) => Number(l.id) === PEPI_LABEL_ID)) labeled++;
    }
    console.log(`[sync-pepi-test-labels] verify: ${labeled}/${caseIds.length} @pepi cases have test-level Pepi in run ${runId}.`);
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
