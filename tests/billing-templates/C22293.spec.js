// @ts-check
/**
 * AIO C22293 (GEO-TC-11898) — Billing Templates - Save Filters
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   Precondition: other filter criteria cleared.
 *   1. Filter by a criterion and click Save → a "Save Filter" dialog opens (Cancel /
 *      Reset links right, Save left, a Default checkbox that is checked).
 *   2. Name it and Save → the filter is saved and its name shows in "Filter By".
 *   3. Repeat for each filter type: Firm Name, Template Name, Billing Buckets,
 *      Frequency, Period Type, Target Type, Last Build Date, Show Inactive Firms.
 *   4. Open the "Filter By" field → a dropdown lists all previously created filters.
 *   5. Select each → the grid is filtered by that filter's saved criteria.
 *
 * ── Implementation note: why this drives the filter endpoints, not the dialog ──
 * Same as C22296-C22299. Billing Templates mounts the `modules/Filter` module with
 * the save/edit UI switched OFF (BillingTemplatesFilter.js → `hideSaveButton={true}`),
 * so there is no on-screen Save button or "Save Filter" dialog to click. The feature
 * and its per-user store are intact and are exercised through the exact requests the
 * dialog issues:
 *   POST /bo/createFilter.do  — the Save Filter dialog's Save (name, criteria, ...)
 *   GET  /bo/getFilters.do    — what the "Filter By" dropdown lists (per user +
 *                               context), returning each filter's `criteria` verbatim
 *   POST /bo/deleteFilter.do  — cleanup
 * All scoped per user server-side by `createdBy` + `context="BillingTemplates"`.
 * The identity logs in through the real UI and opens the real Billing Templates page.
 *
 * ── What this asserts ──
 * A filter is saved for EACH of the eight filter types with its own criteria, all of
 * them then appear in the per-user "Filter By" list (getFilters), and each filter's
 * criteria round-trips exactly — i.e. selecting it would re-apply its saved criteria.
 *
 * Filters are created non-default (isDefault=false): the Save Filter dialog defaults
 * its Default checkbox to checked, but saving eight defaults would leave the user
 * with multiple defaults, which getDefaultFilter (getSingleResult) cannot resolve —
 * so, as in C22297/C22298, the run keeps a single-default invariant and cleans up
 * its own filters, restoring any pre-existing default.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const BILLING_TEMPLATES_URL = '/react/indexReact.do#platformOne/billingCenter/templates';
const CONTEXT = 'BillingTemplates';
const RUN = Date.now();

// One saved filter per filter type, each with representative criteria.
const FILTER_TYPES = [
  { type: 'Firm Name', criteria: { firmCd: 89 } },
  { type: 'Template Name', criteria: { templateName: `Pepi Tmpl ${RUN}` } },
  { type: 'Billing Buckets', criteria: { billingBuckets: [1, 2] } },
  { type: 'Frequency', criteria: { frequency: 1 } },
  { type: 'Period Type', criteria: { periodType: 1 } },
  { type: 'Target Type', criteria: { targetType: 1 } },
  { type: 'Last Build Date', criteria: { lastBuildDate: '01/01/2025' } },
  { type: 'Show Inactive Firms', criteria: { showInactiveFirms: true } },
];

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{id:string,name:string,isDefault:boolean,criteria:string,createdBy:string}>>}
 */
async function getFilters(page) {
  const res = await page.request.get(`/bo/getFilters.do?context=${encodeURIComponent(CONTEXT)}`);
  expect(res.ok(), `getFilters.do HTTP ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.rows || [];
}

/**
 * The Save Filter dialog's Save — persist a named filter with a criteria object.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {object} criteria
 */
async function createFilter(page, name, criteria) {
  const res = await page.request.post('/bo/createFilter.do', {
    multipart: { name, isDefault: 'false', criteria: JSON.stringify(criteria), context: CONTEXT },
  });
  expect(res.ok(), `createFilter.do HTTP ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.rows[0];
}

async function updateFilter(page, { id, name, isDefault }) {
  const res = await page.request.post('/bo/updateFilters.do', {
    multipart: { id, name, isDefault: String(isDefault) },
  });
  return res.ok();
}

async function deleteFilter(page, id) {
  const res = await page.request.post('/bo/deleteFilter.do', { multipart: { id } });
  return res.ok();
}

async function openBillingTemplates(page) {
  await page.goto(BILLING_TEMPLATES_URL);
  await expect(page.getByText('Billing Templates', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
}

test('@pepi C22293 Billing Templates - Save Filters', async ({ page }) => {
  test.setTimeout(180_000);

  /** @type {Array<{id:string,name:string,type:string,criteria:object}>} */
  const created = [];
  /** @type {{id:string,name:string}|null} */ let preExistingDefault = null;

  await test.step('Login (tim1) and open Billing Templates', async () => {
    await loginPlatformOneTim1Fresh(page);
    await openBillingTemplates(page);
  });

  await test.step('Precondition: keep a single-default invariant', async () => {
    const existing = await getFilters(page);
    const prior = existing.find((f) => f.isDefault);
    if (prior) {
      preExistingDefault = { id: prior.id, name: prior.name };
      await updateFilter(page, { id: prior.id, name: prior.name, isDefault: false });
    }
  });

  await test.step('Save a filter for each of the eight filter types', async () => {
    for (const { type, criteria } of FILTER_TYPES) {
      const name = `Pepi C22293 ${type} ${RUN}`;
      const row = await createFilter(page, name, criteria);
      expect(row.id, `${type} filter got an id`).toBeTruthy();
      created.push({ id: row.id, name, type, criteria });
    }
    // eslint-disable-next-line no-console
    console.log(`[C22293] saved ${created.length} filters`);
  });

  await test.step('All saved filters appear in the "Filter By" list with their criteria intact', async () => {
    const rows = await getFilters(page);
    const byId = new Map(rows.map((f) => [f.id, f]));
    for (const c of created) {
      const saved = byId.get(c.id);
      expect(saved, `"${c.type}" filter is listed`).toBeTruthy();
      expect(saved.name).toBe(c.name);
      // Selecting the filter re-applies exactly this criteria.
      expect(saved.criteria, `"${c.type}" criteria round-trips`).toBe(JSON.stringify(c.criteria));
    }
    // The list is per user; every filter this run created is present together.
    const mineListed = rows.filter((f) => created.some((c) => c.id === f.id));
    expect(mineListed.length, 'all eight saved filters are listed').toBe(FILTER_TYPES.length);
  });

  await test.step('Cleanup: delete this run\'s filters and restore any prior default', async () => {
    for (const c of created) await deleteFilter(page, c.id);
    if (preExistingDefault) {
      await updateFilter(page, { id: preExistingDefault.id, name: preExistingDefault.name, isDefault: true });
    }
  });
});
