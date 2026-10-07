// @ts-check
/**
 * AIO C22315 (GEO-TC-11880) — Statement Charges - Bulk Delete
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1. Firm-1 admin opens Platform One → Billing Center → Statement Charges.
 *   2. Select the checkbox in front of a few charges → the footer 'Delete' button
 *      is enabled.
 *   3. Click Delete → the "Delete Statement Charge: Confirmation" dialog opens
 *      ("Are you sure you want to delete the selected Statement Charge(s)?").
 *   4. Click Yes → the selected charges are deleted; the grid updates.
 *
 * ── Isolation / grid quirks ──
 * The grid vertically virtualises, so the test seeds THREE disposable charges on
 * firm 89 sharing a unique prefix and narrows the grid to just those three (Firm
 * filter + clear the polluted saved-view column filter via the grid api + quick
 * Search on the prefix). It selects two of them and bulk-deletes those two through
 * the real footer Delete → confirmation → Yes flow, then deletes the surviving seed
 * in cleanup. See [[project_statement_charges_grid_gotchas]].
 *
 * ── What this asserts ──
 *  - Selecting rows enables the footer Delete button.
 *  - Delete opens the confirmation dialog with the "are you sure" message.
 *  - Yes deletes exactly the selected charges (the bulk delete request succeeds;
 *    only one of the three seeded charges survives per the endpoint; the grid drops
 *    to a single row).
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';
const CREATE = '/react/createUpdateBillingStatementCharge.do';
const DELETE = '/react/deleteBillingStatementCharges.do';
const SEED_FIRM = 89;
const SEED_COUNT = 3;

function readAdvisorOptions(page) {
  return page.locator('#advisorOrGroupIDDiv').evaluate((el) => {
    let node = /** @type {any} */ (el);
    for (let h = 0; h < 30 && node; h++) {
      const fk = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
      if (fk) {
        let f = node[fk];
        for (let u = 0; u < 40 && f; u++) {
          const p = f.memoizedProps;
          if (p && p.options && typeof p.options === 'object' && !Array.isArray(p.options) && Object.keys(p.options).length > 3) {
            /** @type {Record<string,string>} */
            const o = {};
            for (const k of Object.keys(p.options)) o[k] = p.options[k] && p.options[k].name;
            return o;
          }
          f = f.return;
        }
      }
      node = node.parentElement;
    }
    return null;
  });
}

async function clearGridColumnFilters(page) {
  await page.locator('.ag-root-wrapper').first().evaluate((el) => {
    const findApi = (root) => {
      const fk = Object.keys(root).find((k) => k.startsWith('__reactFiber$'));
      if (!fk) return null;
      let f = root[fk];
      for (let u = 0; u < 80 && f; u++) {
        for (const o of [f.memoizedProps || {}, f.memoizedState || {}, (f.memoizedProps && f.memoizedProps.gridOptions) || {}]) {
          if (o && o.api && typeof o.api.setFilterModel === 'function') return o.api;
          if (o && o.gridApi && typeof o.gridApi.setFilterModel === 'function') return o.gridApi;
        }
        f = f.return;
      }
      return null;
    };
    const api = findApi(/** @type {any} */ (el));
    if (api) api.setFilterModel(null);
  });
}

/** How many of the seeded (prefix) charges still exist, per the endpoint. */
async function survivingSeeds(page, prefix) {
  const rows = (await (await page.request.post(GET, { multipart: { firmCd: String(SEED_FIRM) } })).json()).rows || [];
  return rows.filter((r) => (r.description || '').startsWith(prefix)).map((r) => r.billingStatementChargeID);
}

test('@regression C22315 Statement Charges - Bulk Delete', async ({ page }) => {
  test.setTimeout(180_000);

  const prefix = `PepiC22315-${Date.now()}`;

  await test.step('Login, open Statement Charges, seed a few disposable charges', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await loginPlatformOneTim1Fresh(page);
    await page.goto(URL);
    await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
    const baseline = (await (await respP).json()).rows || [];

    const firmTa = page.locator('#firmCd_typeAhead');
    await firmTa.click();
    await firmTa.pressSequentially('Sowell');
    await page.locator('[role="combo-box-list-item"]').filter({ hasText: new RegExp(`\\(${SEED_FIRM}\\)`) }).first()
      .evaluate((el) => /** @type {HTMLElement} */ (el).click());
    /** @type {Record<string,string>|null} */ let optMap = null;
    await expect.poll(async () => { optMap = await readAdvisorOptions(page); return optMap ? Object.keys(optMap).length : 0; }, { timeout: 20_000, intervals: [500, 800, 1500] }).toBeGreaterThan(0);
    const advId = baseline.filter((r) => r.firmCd === SEED_FIRM && r.advisorOrGroupID).map((r) => r.advisorOrGroupID).find((id) => optMap[id]);
    expect(advId, 'a valid firm-89 advisor for the seeds').toBeTruthy();

    for (let i = 0; i < SEED_COUNT; i++) {
      const res = await page.request.post(CREATE, { multipart: {
        firmCd: String(SEED_FIRM), advisorOrGroupID: advId, description: `${prefix}-${i}`, frequencyCd: '1',
        quantity: '1', chargeTypeCd: '1', amount: '55.5', ratePercentFlag: 'false', rates: '[]',
        startDate: '01/01/2025', billingBucketCd: '1', positionInStatement: '1', status: 'New' } });
      expect((await res.json()).success, `seed ${i} failed`).toBe(true);
    }
    // eslint-disable-next-line no-console
    console.log(`[C22315] seeded ${SEED_COUNT} charges, prefix="${prefix}"`);
  });

  await test.step('Narrow the grid to the seeded charges', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
    await respP;
    await clearGridColumnFilters(page);
    const search = page.locator('input[placeholder="Search"]').first();
    await search.click();
    await search.fill('');
    await search.pressSequentially(prefix);
    await expect.poll(async () => page.locator('.ag-center-cols-container .ag-row').count(), { timeout: 20_000, intervals: [400, 800, 1500] }).toBe(SEED_COUNT);
  });

  await test.step('Select two rows → footer Delete is enabled', async () => {
    const checkboxes = page.locator('.ag-center-cols-container .ag-row .ag-selection-checkbox .ag-checkbox-input');
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();
    await expect.poll(async () => page.locator('.ag-center-cols-container .ag-row[aria-selected="true"]').count(), { timeout: 10_000, intervals: [200, 400, 800] }).toBe(2);
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled({ timeout: 10_000 });
  });

  await test.step('Delete → confirm → Yes deletes the selected charges', async () => {
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(/Are you sure you want to delete/i).first()).toBeVisible({ timeout: 15_000 });

    const delResp = page.waitForResponse((r) => r.url().includes(DELETE) && r.status() === 200, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    expect((await (await delResp).json()).success, 'bulk delete request succeeded').toBe(true);
    await expect(page.getByText(/Are you sure you want to delete/i)).toBeHidden({ timeout: 10_000 });

    // Exactly the two selected charges are gone: one of three seeds survives.
    await expect.poll(async () => (await survivingSeeds(page, prefix)).length, { timeout: 15_000, intervals: [500, 1000, 1500] }).toBe(SEED_COUNT - 2);
    // The grid dropped to the single surviving row.
    await expect.poll(async () => page.locator('.ag-center-cols-container .ag-row').count(), { timeout: 10_000, intervals: [400, 800] }).toBe(SEED_COUNT - 2);
  });

  await test.step('Cleanup: delete the surviving seed', async () => {
    for (const id of await survivingSeeds(page, prefix)) {
      await page.request.post(DELETE, { multipart: { statementChargesToDelete: JSON.stringify([id]) } });
    }
  });
});
