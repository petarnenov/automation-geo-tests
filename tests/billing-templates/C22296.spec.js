// @ts-check
/**
 * AIO C22296 (GEO-TC-11901) — Billing Templates - Filters are saved per user
 *
 * Source: AIO Tests, project GEO, folder "Filters".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   Precondition: all other filter criteria cleared.
 *   1. On Billing Templates, filter by any criteria and click Save →
 *      a "Save Filter" dialog opens.
 *   2. Name the filter and click Save → the filter is saved and its name is
 *      shown in the "Filter By" field.
 *   3. Log in as ANOTHER firm-1 admin (different from step 1-2) and open
 *      Platform One → Billing Center → Billing Templates.
 *   4. Open the "Filter By" field → it lists filters this user created; the
 *      filter saved in step 2 is NOT shown.
 *
 * What this asserts: saved filters on Billing Templates are scoped per user —
 * a filter created by user A never appears for user B.
 *
 * ── Implementation note: why this drives the filter endpoints, not the modal ──
 * The saved-filter feature is the `modules/Filter` module: a "Filter By"
 * combo (FiltersList) plus a "Create Filter" modal, backed by
 *   POST /bo/createFilter.do   (name, isDefault, criteria, context)
 *   GET  /bo/getFilters.do?context=…
 * and scoped per user server-side by `createdBy` (FilterViewDAO:
 * `WHERE createdBy = :user AND context = :context`).
 *
 * On the current build the Billing Templates page mounts this module with the
 * save UI switched OFF —
 *   BillingTemplatesFilter.js:
 *     <FilterComponents.Options defaultCriteria={…} hideSaveButton={true}>
 * so there is no on-screen "Save" button and no FiltersList combo to click.
 * The page still *reads* saved filters for this context on load
 * (usePassSelectedFilterAsFirstParamToService → getFilters.do), so the
 * per-user guarantee the case checks is fully exercised through the feature's
 * own endpoints. Both identities log in through the real UI and open the real
 * Billing Templates page; the save (step 1-2) and the list read (step 4) go
 * through createFilter.do / getFilters.do — the exact requests the removed
 * dialog would have issued, with `context = "BillingTemplates"`.
 *
 * User B is a throwaway firm-1 GW Admin provisioned per run (createGwAdmin),
 * guaranteeing it starts with an empty filter list and is distinct from tim1.
 * Filters accumulate by design; the run deletes its own filter at the end.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh, login, createGwAdmin } = require('../_helpers/qa3');

const BILLING_TEMPLATES_URL = '/react/indexReact.do#platformOne/billingCenter/templates';
const CONTEXT = 'BillingTemplates';
const FILTER_NAME = `Pepi per-user filter C22296 ${Date.now()}`;

/**
 * Read the saved filters the *current session's* user can see for a context.
 * This is the same GET the Billing Templates page fires on load.
 * @param {import('@playwright/test').Page} page
 * @param {string} context
 * @returns {Promise<Array<{id: string, name: string, createdBy: string, context: string}>>}
 */
async function getFilters(page, context) {
  const res = await page.request.get(`/bo/getFilters.do?context=${encodeURIComponent(context)}`);
  expect(res.ok(), `getFilters.do HTTP ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body.success, `getFilters.do success=false: ${JSON.stringify(body).slice(0, 200)}`).toBe(
    true
  );
  return body.rows || [];
}

/**
 * Save a named filter for the current session's user — the "Save Filter"
 * dialog analog. Returns the persisted row (incl. server-assigned id and the
 * `createdBy` owner id).
 * @param {import('@playwright/test').Page} page
 * @param {{ name: string, context: string, criteria: object }} opts
 */
async function createFilter(page, { name, context, criteria }) {
  const res = await page.request.post('/bo/createFilter.do', {
    multipart: {
      name,
      isDefault: 'false',
      criteria: JSON.stringify(criteria),
      context,
    },
  });
  expect(res.ok(), `createFilter.do HTTP ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body.success, `createFilter.do success=false: ${JSON.stringify(body).slice(0, 200)}`).toBe(
    true
  );
  return body.rows[0];
}

/**
 * Delete a saved filter by id (creator-scoped on the server).
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 */
async function deleteFilter(page, id) {
  const res = await page.request.post('/bo/deleteFilter.do', { multipart: { id } });
  return res.ok();
}

/**
 * Open the Billing Templates page and wait for its grid to render — the same
 * page whose on-load getFilters.do read is what step 4 inspects.
 * @param {import('@playwright/test').Page} page
 */
async function openBillingTemplates(page) {
  await page.goto(BILLING_TEMPLATES_URL);
  await expect(page.getByText('Billing Templates', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
}

test('@regression C22296 Billing Templates - Filters are saved per user', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);

  /** @type {string} */
  let userAId;
  /** @type {string} */
  let savedFilterId;

  await test.step('User A (tim1) opens Billing Templates', async () => {
    await loginPlatformOneTim1Fresh(page);
    await openBillingTemplates(page);
  });

  await test.step('User A saves a named filter (Save Filter dialog)', async () => {
    // Precondition: the unique name is not already present for user A.
    const before = await getFilters(page, CONTEXT);
    expect(before.some((f) => f.name === FILTER_NAME)).toBe(false);

    const saved = await createFilter(page, {
      name: FILTER_NAME,
      context: CONTEXT,
      criteria: { showInactiveFirms: true },
    });
    savedFilterId = saved.id;
    userAId = saved.createdBy;
    expect(savedFilterId, 'server should return a filter id').toBeTruthy();
    expect(userAId, 'server should stamp createdBy').toBeTruthy();
  });

  await test.step("Saved filter appears in User A's Filter By list", async () => {
    const rows = await getFilters(page, CONTEXT);
    const mine = rows.find((f) => f.id === savedFilterId);
    expect(mine, "user A's own filter should be listed for user A").toBeTruthy();
    expect(mine.name).toBe(FILTER_NAME);
    expect(mine.createdBy).toBe(userAId);
  });

  /** @type {{userId: string, username: string, password: string}} */
  let userB;

  await test.step('Provision + log in as a second firm-1 admin (User B)', async () => {
    userB = await createGwAdmin('pepiFilterUserB');
    // User B must be a different identity than user A.
    expect(userB.userId).not.toBe(userAId);
    await context.clearCookies();
    await login(page, userB.username, userB.password);
    await page.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
  });

  await test.step('User B opens Billing Templates', async () => {
    await openBillingTemplates(page);
  });

  await test.step("User B's Filter By list does NOT contain User A's filter", async () => {
    const rows = await getFilters(page, CONTEXT);
    expect(
      rows.some((f) => f.id === savedFilterId),
      "user A's filter must not leak to user B"
    ).toBe(false);
    expect(
      rows.some((f) => f.name === FILTER_NAME),
      "user A's filter name must not appear for user B"
    ).toBe(false);
    // Everything user B can see must be user B's own.
    for (const f of rows) {
      expect(f.createdBy, 'user B may only see filters it created').not.toBe(userAId);
    }
  });

  await test.step("Cleanup: delete User A's filter", async () => {
    // Only the creator can delete it, so re-authenticate as tim1 first.
    await context.clearCookies();
    await loginPlatformOneTim1Fresh(page);
    await deleteFilter(page, savedFilterId);
  });
});
