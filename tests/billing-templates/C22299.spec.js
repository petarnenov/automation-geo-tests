// @ts-check
/**
 * AIO C22299 (GEO-TC-11904) — Billing Templates - Delete Filters
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   Precondition: log in as a user who has already created several filters.
 *   1. Click the 'Edit' link next to "Filter By" → the dialog opens.
 *   2. Click Remove on the filter marked 'default' → a confirm dialog appears:
 *      "Are you sure you want to remove this filter?"
 *   3. Click Yes → the filter is deleted and the "Default View" row is marked as
 *      the default filter.
 *
 * What this asserts: a user can delete their saved filters — including the one
 * marked Default — and once the default filter is gone the system "Default View"
 * takes over (no user filter is default any more).
 *
 * ── Implementation note: why this drives the filter endpoints, not the dialog ──
 * Same as C22296/C22297/C22298. Billing Templates mounts `modules/Filter` with
 * the save/edit UI switched OFF (BillingTemplatesFilter.js → `hideSaveButton`,
 * no FiltersList combo), so there is no on-screen Edit link or dialog to click.
 * The feature and its per-user store are exercised through the requests the dialog
 * issues:
 *   POST /bo/createFilter.do   — seed the "several filters" precondition
 *   GET  /bo/getFilters.do     — what the Edit dialog lists (context read)
 *   POST /bo/deleteFilter.do   — the per-row Remove icon + its Yes confirmation
 * All scoped per user server-side by `createdBy` + `context="BillingTemplates"`.
 *
 * The server does not auto-demote a default (FilterViewTrait.UpdateFilterMsg) and
 * getDefaultFilter uses getSingleResult(), so this run demotes any pre-existing
 * tim1 default at the start and restores it during cleanup, keeping the single-
 * default invariant and leaving no shared state behind.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const BILLING_TEMPLATES_URL = '/react/indexReact.do#platformOne/billingCenter/templates';
const CONTEXT = 'BillingTemplates';
const RUN = Date.now();

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{id: string, name: string, isDefault: boolean, createdBy: string}>>}
 */
async function getFilters(page) {
  const res = await page.request.get(`/bo/getFilters.do?context=${encodeURIComponent(CONTEXT)}`);
  expect(res.ok(), `getFilters.do HTTP ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.rows || [];
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {boolean} isDefault
 */
async function createFilter(page, name, isDefault = false) {
  const res = await page.request.post('/bo/createFilter.do', {
    multipart: {
      name,
      isDefault: String(isDefault),
      criteria: JSON.stringify({ showInactiveFirms: true }),
      context: CONTEXT,
    },
  });
  expect(res.ok(), `createFilter.do HTTP ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.rows[0];
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ id: string, name: string, isDefault?: boolean }} filter
 */
async function updateFilter(page, { id, name, isDefault = false }) {
  const res = await page.request.post('/bo/updateFilters.do', {
    multipart: { id, name, isDefault: String(isDefault) },
  });
  expect(res.ok(), `updateFilters.do HTTP ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body;
}

/**
 * The Remove icon (and its "Yes" confirmation).
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
async function deleteFilter(page, id) {
  const res = await page.request.post('/bo/deleteFilter.do', { multipart: { id } });
  return res.ok();
}

async function openBillingTemplates(page) {
  await page.goto(BILLING_TEMPLATES_URL);
  await expect(page.getByText('Billing Templates', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
}

test('@pepi C22299 Billing Templates - Delete Filters', async ({ page }) => {
  test.setTimeout(180_000);

  /** @type {{id:string,name:string}} */ let fDefault; // marked default, then deleted
  /** @type {{id:string,name:string}} */ let fOther; // extra survivor
  /** @type {{id:string,name:string}|null} */ let preExistingDefault = null;

  await test.step('Login (tim1) and open Billing Templates', async () => {
    await loginPlatformOneTim1Fresh(page);
    await openBillingTemplates(page);
  });

  await test.step('Precondition: several saved filters, one marked Default', async () => {
    const existing = await getFilters(page);
    const prior = existing.find((f) => f.isDefault);
    if (prior) {
      preExistingDefault = { id: prior.id, name: prior.name };
      await updateFilter(page, { id: prior.id, name: prior.name, isDefault: false });
    }

    fDefault = await createFilter(page, `Pepi C22299 default ${RUN}`, true);
    fOther = await createFilter(page, `Pepi C22299 other ${RUN}`);
  });

  await test.step('Step 1 — Edit lists the filters; one is the Default', async () => {
    const rows = await getFilters(page);
    const byId = new Map(rows.map((f) => [f.id, f]));
    expect(byId.get(fDefault.id)?.isDefault, 'fDefault is the default').toBe(true);
    expect(byId.get(fOther.id)?.isDefault, 'fOther not default').toBe(false);
    expect(rows.filter((f) => f.isDefault).length, 'exactly one default overall').toBe(1);
  });

  await test.step('Steps 2-3 — Remove the DEFAULT filter, confirm Yes → Default View', async () => {
    expect(await deleteFilter(page, fDefault.id)).toBeTruthy();
    const rows = await getFilters(page);
    expect(rows.some((f) => f.id === fDefault.id), 'the default filter is deleted').toBe(false);
    expect(rows.some((f) => f.id === fOther.id), 'the other filter survives').toBe(true);
    // "The 'Default View' row is marked as the default filter" — no user filter
    // carries the default flag any more.
    expect(rows.filter((f) => f.isDefault).length, 'no user default remains').toBe(0);
  });

  await test.step('Persistence: re-open Billing Templates → the deletion holds', async () => {
    await openBillingTemplates(page);
    const rows = await getFilters(page);
    expect(rows.some((f) => f.id === fDefault.id), 'deletion persisted').toBe(false);
    expect(rows.filter((f) => f.isDefault).length, 'still no user default').toBe(0);
  });

  await test.step('Cleanup: delete the survivor and restore prior default', async () => {
    await deleteFilter(page, fOther.id);
    if (preExistingDefault) {
      await updateFilter(page, {
        id: preExistingDefault.id,
        name: preExistingDefault.name,
        isDefault: true,
      });
    }
  });
});
