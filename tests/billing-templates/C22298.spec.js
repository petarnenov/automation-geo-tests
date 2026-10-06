// @ts-check
/**
 * AIO C22298 (GEO-TC-11903) — Billing Templates - Default Filters
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   Precondition: log in as a user who has already created several filters.
 *   1. Click the 'Edit' link next to "Filter By" → the dialog opens; one filter
 *      is marked as Default.
 *   2. Click the Default radio of ANOTHER filter and click Save → the default
 *      moves to that filter; its name shows in the Filter By field.
 *   3. Log out and log in again → successful.
 *   4. Platform One → Billing Center → Billing Templates → the list is already
 *      filtered by the Default filter (the default persisted across re-login).
 *   5. Click 'Edit' again → the dialog opens.
 *   6. Click Remove on the filter marked DEFAULT → a confirm dialog appears.
 *   7. Click Yes → the filter is deleted and the "Default View" becomes the
 *      default (no user filter is default any more).
 *
 * What this asserts: a user can move the Default flag between their saved filters,
 * the choice persists across re-login, and deleting the default filter falls the
 * user back to the system "Default View".
 *
 * ── Implementation note: why this drives the filter endpoints, not the dialog ──
 * Same as C22296/C22297. Billing Templates mounts `modules/Filter` with the
 * save/edit UI switched OFF (BillingTemplatesFilter.js → `hideSaveButton={true}`,
 * no FiltersList combo), so there is no on-screen Edit link or dialog to click.
 * The feature and its per-user store are intact and are exercised through the
 * exact requests the dialog issues:
 *   POST /bo/createFilter.do   — seed the "several filters" precondition
 *   GET  /bo/getFilters.do     — what the Edit dialog lists (context read)
 *   POST /bo/updateFilters.do  — the dialog's Save (rename / set default), per-id
 *   POST /bo/deleteFilter.do   — the per-row Remove icon
 * All scoped per user server-side by `createdBy` + `context="BillingTemplates"`.
 *
 * ── Why the default is MOVED with two calls (demote, then promote) ──
 * The server does NOT auto-demote (FilterViewTrait.UpdateFilterMsg just sets the
 * flag on each id it is given), and getDefaultFilter uses getSingleResult(), which
 * throws if two rows are default. The real dialog Save avoids that by sending the
 * whole list at once with exactly one default=true. Issuing it as demote-then-
 * promote is the same end state and keeps the single-default invariant at every
 * committed step (never two defaults at rest).
 *
 * The run seeds its own uniquely-named filters, and — because tim1 may already
 * own a default from another case — it demotes any pre-existing default at the
 * start and restores it at the end, so it neither depends on nor leaves behind
 * shared default state.
 */

const { test, expect } = require('@playwright/test');
const { acquireFileLock } = require('../_helpers/file-lock');
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
 * The Edit Filters dialog's Save — set a single filter's name and default flag.
 * Per-id, so other filters are left as-is.
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
 * Move the Default flag onto `target` without ever leaving two defaults at rest:
 * demote whatever is currently default first, then promote the target.
 * @param {import('@playwright/test').Page} page
 * @param {{id:string,name:string}} target
 */
async function makeDefault(page, target) {
  const rows = await getFilters(page);
  for (const f of rows) {
    if (f.isDefault && f.id !== target.id) {
      await updateFilter(page, { id: f.id, name: f.name, isDefault: false });
    }
  }
  await updateFilter(page, { id: target.id, name: target.name, isDefault: true });
}

/**
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

// Both Billing Templates filter specs mutate tim1's saved filters and assert
// "exactly one Default"; serialise them across workers.
/** @type {(() => void) | null} */
let releaseFiltersLock = null;
test.beforeEach(async () => {
  releaseFiltersLock = await acquireFileLock('billing-templates-filters');
});
test.afterEach(() => {
  releaseFiltersLock?.();
});

test('@pepi C22298 Billing Templates - Default Filters', async ({ page }) => {
  test.setTimeout(180_000);

  /** @type {{id:string,name:string}} */ let fA; // starts as the default
  /** @type {{id:string,name:string}} */ let fB; // default is moved onto this one
  /** @type {{id:string,name:string}} */ let fC; // extra, never default
  /** @type {{id:string,name:string}|null} */ let preExistingDefault = null;

  await test.step('Login (tim1) and open Billing Templates', async () => {
    await loginPlatformOneTim1Fresh(page);
    await openBillingTemplates(page);
  });

  await test.step('Precondition: several saved filters, exactly one Default (fA)', async () => {
    // tim1 may already own a default from another case; demote it so this run
    // controls the single-default invariant, and restore it during cleanup.
    const existing = await getFilters(page);
    // Demote EVERY current default: stale runs can leave tim1 with more than
    // one (seen on qabis1). Only the first is restored during cleanup.
    const priors = existing.filter((f) => f.isDefault);
    if (priors.length) preExistingDefault = { id: priors[0].id, name: priors[0].name };
    for (const prior of priors) {
      await updateFilter(page, { id: prior.id, name: prior.name, isDefault: false });
    }

    fA = await createFilter(page, `Pepi C22298 A ${RUN}`, true);
    fB = await createFilter(page, `Pepi C22298 B ${RUN}`);
    fC = await createFilter(page, `Pepi C22298 C ${RUN}`);
  });

  await test.step('Step 1 — Edit lists the filters; fA is marked Default', async () => {
    const rows = await getFilters(page);
    const byId = new Map(rows.map((f) => [f.id, f]));
    expect(byId.get(fA.id)?.isDefault, 'fA is the default').toBe(true);
    expect(byId.get(fB.id)?.isDefault, 'fB not yet default').toBe(false);
    expect(byId.get(fC.id)?.isDefault, 'fC not default').toBe(false);
    expect(rows.filter((f) => f.isDefault).length, 'exactly one default overall').toBe(1);
  });

  await test.step('Step 2 — Set Default on another filter (fB) and Save', async () => {
    await makeDefault(page, fB);
    const rows = await getFilters(page);
    const byId = new Map(rows.map((f) => [f.id, f]));
    expect(byId.get(fB.id)?.isDefault, 'default moved to fB').toBe(true);
    expect(byId.get(fA.id)?.isDefault, 'fA demoted').toBe(false);
    expect(rows.filter((f) => f.isDefault).length, 'still exactly one default').toBe(1);
  });

  await test.step('Step 3 — Log out and log in again', async () => {
    await loginPlatformOneTim1Fresh(page);
  });

  await test.step('Step 4 — Billing Templates opens filtered by the persisted Default (fB)', async () => {
    await openBillingTemplates(page);
    const rows = await getFilters(page);
    const byId = new Map(rows.map((f) => [f.id, f]));
    expect(byId.get(fB.id)?.isDefault, 'fB is still the default after re-login').toBe(true);
    expect(byId.get(fA.id)?.isDefault, 'fA still not default').toBe(false);
  });

  await test.step('Steps 5-7 — Remove the DEFAULT filter → fall back to Default View', async () => {
    expect(await deleteFilter(page, fB.id)).toBeTruthy();
    const rows = await getFilters(page);
    expect(rows.some((f) => f.id === fB.id), 'the default filter is gone').toBe(false);
    // "The 'Default View' is marked as the default filter" — i.e. no user filter
    // carries the default flag any more, so the system Default View takes over.
    expect(rows.filter((f) => f.isDefault).length, 'no user default remains').toBe(0);
  });

  await test.step('Cleanup: delete this run\'s filters and restore prior default', async () => {
    await deleteFilter(page, fA.id);
    await deleteFilter(page, fC.id);
    if (preExistingDefault) {
      await updateFilter(page, {
        id: preExistingDefault.id,
        name: preExistingDefault.name,
        isDefault: true,
      });
    }
  });
});
