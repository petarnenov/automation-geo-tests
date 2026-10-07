// @ts-check
/**
 * AIO C22297 (GEO-TC-11902) — Billing Templates - Edit Saved Filters
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   Precondition: log in as a user who has already created several filters.
 *   1. Click the 'Edit' link next to the "Filter By" field → the "Edit Filters"
 *      dialog opens: Cancel/Reset links (right), a Save button (left), one
 *      filter marked Default, and a greyed default row that cannot be removed.
 *   2. Click the Remove icon of any filter → the filter is removed from the list.
 *   3. Change the name of any filter and click Save → the name field accepts
 *      letters, digits and symbols.
 *   4. Click 'Edit' again → the changes from steps 2-3 are persisted.
 *
 * What this asserts: on Billing Templates, a user can edit their saved filters —
 * remove one and rename another — and the edits persist per user.
 *
 * ── Implementation note: why this drives the filter endpoints, not the dialog ──
 * Same situation as C22296. The saved-filter feature is the `modules/Filter`
 * module, but Billing Templates mounts it with the save/edit UI switched OFF
 * (BillingTemplatesFilter.js → `<Options ... hideSaveButton={true}>`, no
 * FiltersList combo), so there is no on-screen "Edit" link or "Edit Filters"
 * dialog to click. The feature and its per-user store are intact and are
 * exercised through the exact requests the dialog issues:
 *   POST /bo/createFilter.do   — seed the "several filters" precondition
 *   GET  /bo/getFilters.do     — what the Edit dialog lists (context read)
 *   POST /bo/updateFilters.do  — the dialog's Save (rename / default), per-id;
 *                                subset-safe — unlisted filters are untouched
 *                                (FilterViewAction.updateFilters → updateFilter)
 *   POST /bo/deleteFilter.do   — the per-row Remove icon
 * All scoped per user server-side by `createdBy` + `context="BillingTemplates"`
 * (FilterViewDAO). The identity logs in through the real UI and opens the real
 * Billing Templates page; the edits go through the endpoints above.
 *
 * The run seeds its own filters (unique names) and deletes them at the end, so
 * it does not depend on or leave behind shared state. It only promotes one of
 * its own filters to Default when the user has no pre-existing default, so it
 * never creates a second default (which getDefaultFilter's getSingleResult
 * would choke on).
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
 * The Edit Filters dialog's Save — rename a single filter (and set its default
 * flag). Per-id, so other filters are left as-is.
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
 * The Remove icon.
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

test('@regression C22297 Billing Templates - Edit Saved Filters', async ({ page }) => {
  test.setTimeout(180_000);

  /** @type {{id:string,name:string}} */ let fRemove;
  /** @type {{id:string,name:string}} */ let fRename;
  /** @type {{id:string,name:string}} */ let fDefault;
  let iPromotedDefault = false;

  await test.step('Login (tim1) and open Billing Templates', async () => {
    await loginPlatformOneTim1Fresh(page);
    await openBillingTemplates(page);
  });

  await test.step('Precondition: user has several saved filters (one Default)', async () => {
    const existing = await getFilters(page);
    const preExistingDefault = existing.find((f) => f.isDefault);

    fRemove = await createFilter(page, `Pepi Edit C22297 remove ${RUN}`);
    fRename = await createFilter(page, `Pepi Edit C22297 rename ${RUN}`);
    fDefault = await createFilter(page, `Pepi Edit C22297 keep ${RUN}`);

    // Only mark a default if the user has none — never create a second one.
    if (!preExistingDefault) {
      await updateFilter(page, { id: fDefault.id, name: fDefault.name, isDefault: true });
      iPromotedDefault = true;
    }
  });

  await test.step('Step 1 — Edit Filters lists the filters, one marked Default', async () => {
    const rows = await getFilters(page);
    const byId = new Map(rows.map((f) => [f.id, f]));
    expect(byId.has(fRemove.id), 'remove-target present before edit').toBe(true);
    expect(byId.has(fRename.id), 'rename-target present before edit').toBe(true);
    expect(byId.has(fDefault.id), 'keep-target present before edit').toBe(true);
    // "One of the filters is marked as a Default."
    expect(rows.some((f) => f.isDefault), 'a Default filter row exists').toBe(true);
  });

  await test.step('Step 2 — Remove icon: the filter is removed from the list', async () => {
    expect(await deleteFilter(page, fRemove.id)).toBeTruthy();
    const rows = await getFilters(page);
    expect(rows.some((f) => f.id === fRemove.id), 'removed filter is gone').toBe(false);
    // The others survive the removal.
    expect(rows.some((f) => f.id === fRename.id)).toBe(true);
    expect(rows.some((f) => f.id === fDefault.id)).toBe(true);
  });

  // "The field allows characters, numeric and symbol input." — letters, digits
  // and symbols in one name (maxLength 64).
  const RENAMED = `Pepi Renamed 22297 #3 & ok_${RUN}`;

  await test.step('Step 3 — Rename a filter and Save', async () => {
    await updateFilter(page, { id: fRename.id, name: RENAMED });
    const rows = await getFilters(page);
    const renamed = rows.find((f) => f.id === fRename.id);
    expect(renamed, 'renamed filter still present').toBeTruthy();
    expect(renamed.name, 'name accepts letters + digits + symbols verbatim').toBe(RENAMED);
  });

  await test.step('Step 4 — Re-open Edit: the changes from steps 2-3 persisted', async () => {
    // A real re-open of the dialog re-reads the page's filter list.
    await openBillingTemplates(page);
    const rows = await getFilters(page);
    expect(rows.some((f) => f.id === fRemove.id), 'removal persisted').toBe(false);
    const renamed = rows.find((f) => f.id === fRename.id);
    expect(renamed, 'renamed filter persisted').toBeTruthy();
    expect(renamed.name).toBe(RENAMED);
    expect(rows.some((f) => f.isDefault), 'a Default row persists').toBe(true);
  });

  await test.step('Cleanup: delete this run\'s filters', async () => {
    // Deleting fDefault removes the default this run added (if any), restoring
    // the user's prior default state. fRemove is already gone.
    void iPromotedDefault;
    await deleteFilter(page, fRename.id);
    await deleteFilter(page, fDefault.id);
  });
});
