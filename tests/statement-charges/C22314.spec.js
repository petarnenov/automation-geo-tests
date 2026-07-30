// @ts-check
/**
 * AIO C22314 (GEO-TC-11883) — Statement Charges - Clear Selection
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1. Firm-1 admin opens Platform One → Billing Center → Statement Charges.
 *   2. Select the checkbox in front of a few charges → they check; a "Clear
 *      Selection" button appears in the footer with an "X Selected Statement
 *      Charges" label (X = number selected).
 *   3. Click Clear Selection → the checkboxes clear.
 *   4. Click the header checkbox (in front of the Firm column) → all rows select.
 *   5. Click Clear Selection → the checkboxes clear.
 *
 * ── Isolation / grid quirks ──
 * The grid vertically virtualises (only a couple of rows render out of thousands),
 * so the test seeds THREE disposable charges on firm 89 sharing a unique prefix and
 * narrows the grid to just those three (Firm filter + clear the polluted saved-view
 * column filter via the grid api + quick Search on the prefix). It then exercises
 * the real selection checkboxes / Clear Selection footer against that small, fully
 * rendered set, and deletes the seeds at the end. See
 * [[project_statement_charges_grid_gotchas]].
 *
 * ── What this asserts ──
 *  - Selecting a couple of rows checks them, shows the "N Selected Statement
 *    Charge(s)" label and the Clear Selection button.
 *  - Clear Selection unchecks everything (0 rows selected).
 *  - The header select-all checkbox selects every row in the (filtered) grid.
 *  - Clear Selection again unchecks everything.
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

const selectedCount = (page) => page.locator('.ag-center-cols-container .ag-row[aria-selected="true"]').count();
const clearSelectionBtn = (page) => page.getByRole('button', { name: 'Clear Selection' });

test('@pepi C22314 Statement Charges - Clear Selection', async ({ page }) => {
  test.setTimeout(180_000);

  const prefix = `PepiC22314-${Date.now()}`;
  /** @type {string[]} */ const chargeIds = [];

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
      const body = await res.json();
      expect(body.success, `seed ${i} failed: ${JSON.stringify(body.errors)}`).toBe(true);
      chargeIds.push(body.billingStatementChargeID);
    }
    // eslint-disable-next-line no-console
    console.log(`[C22314] seeded ${chargeIds.length} charges, prefix="${prefix}"`);
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

  await test.step('Select a couple rows → Clear Selection appears with the count', async () => {
    const checkboxes = page.locator('.ag-center-cols-container .ag-row .ag-selection-checkbox .ag-checkbox-input');
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();
    await expect.poll(async () => selectedCount(page), { timeout: 10_000, intervals: [200, 400, 800] }).toBe(2);
    // Footer shows the "N Selected Statement Charge(s)" label and the button.
    await expect(page.getByText(/2 Selected Statement Charge/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(clearSelectionBtn(page)).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Clear Selection unchecks everything', async () => {
    await clearSelectionBtn(page).click();
    await expect.poll(async () => selectedCount(page), { timeout: 10_000, intervals: [200, 400, 800] }).toBe(0);
  });

  await test.step('Header select-all selects every row in the grid', async () => {
    await page.locator('.ag-header-select-all .ag-checkbox-input').first().click();
    await expect.poll(async () => selectedCount(page), { timeout: 10_000, intervals: [200, 400, 800] }).toBe(SEED_COUNT);
    await expect(page.getByText(new RegExp(`${SEED_COUNT} Selected Statement Charge`, 'i')).first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Clear Selection unchecks everything again', async () => {
    await clearSelectionBtn(page).click();
    await expect.poll(async () => selectedCount(page), { timeout: 10_000, intervals: [200, 400, 800] }).toBe(0);
  });

  await test.step('Cleanup: delete the seeded charges', async () => {
    for (const id of chargeIds) {
      await page.request.post(DELETE, { multipart: { statementChargesToDelete: JSON.stringify([id]) } });
    }
  });
});
