// @ts-check
/**
 * AIO C22308 (GEO-TC-11879) — Statement Charges - Delete a single Statement Charge
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1. Firm-1 admin opens Platform One → Billing Center → Statement Charges.
 *   2. Hover a charge row → the action buttons show on the far right.
 *   3. Hover the Delete icon → a "Delete" tooltip shows.
 *   4. Click Delete → the "Delete Statement Charge: Confirmation" dialog opens:
 *      "Are you sure you want to delete the selected Statement Charge(s)?".
 *   5. Click Cancel → the charge is retained; back on the grid (filtered as before).
 *   6. Repeat step 4 and click Yes → the charge is deleted; back on the grid, which
 *      now reflects the removal.
 *
 * ── Isolation ──
 * The test creates its OWN disposable charge (via the same endpoint the Create form
 * posts to, createUpdateBillingStatementCharge.do) on firm 89, then deletes it
 * through the real UI Delete flow — it touches no real data. See
 * [[project_statement_charges_grid_gotchas]] for the grid quirks reused here
 * (vertical virtualization, saved-view filter pollution cleared via the grid api,
 * quick-Search isolation, pinned-right hover-reveal action buttons).
 *
 * ── What this asserts ──
 *  - Delete opens the confirmation dialog with the "are you sure" message.
 *  - Cancel retains the charge (still present via the endpoint; still one row).
 *  - Delete → Yes removes it (the delete request succeeds; the endpoint re-read no
 *    longer returns it; the grid row is gone).
 *
 * Read-mostly: the one charge it creates is removed by the flow itself (the seed is
 * belt-and-suspenders deleted in cleanup only if the Yes path somehow left it).
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';
const CREATE = '/react/createUpdateBillingStatementCharge.do';
const DELETE = '/react/deleteBillingStatementCharges.do';
const SEED_FIRM = 89;

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

async function selectSeedFirm(page) {
  const firmTa = page.locator('#firmCd_typeAhead');
  await firmTa.click();
  await firmTa.pressSequentially('Sowell');
  await page.locator('[role="combo-box-list-item"]').filter({ hasText: new RegExp(`\\(${SEED_FIRM}\\)`) }).first()
    .evaluate((el) => /** @type {HTMLElement} */ (el).click());
}

/** Filter to firm 89, clear polluted column filters, quick-search by text, and
 *  wait for the given row count. Returns the first center row. */
async function isolateRow(page, searchText, expectedCount = 1) {
  const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
  await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
  await respP;
  await clearGridColumnFilters(page);
  const search = page.locator('input[placeholder="Search"]').first();
  await search.click();
  await search.fill('');
  await search.pressSequentially(searchText);
  await expect
    .poll(async () => page.locator('.ag-center-cols-container .ag-row').count(), { timeout: 20_000, intervals: [400, 800, 1500] })
    .toBe(expectedCount);
  return page.locator('.ag-center-cols-container .ag-row').first();
}

async function clickRowAction(page, centerRow, title) {
  await centerRow.scrollIntoViewIfNeeded().catch(() => {});
  await centerRow.hover();
  const icon = page.locator(`.ag-pinned-right-cols-container .ag-row span[title="${title}"]`).first();
  if (await icon.isVisible().catch(() => false)) await icon.click();
  else await icon.click({ force: true });
}

/** Does the seeded charge still exist (per the endpoint)? */
async function chargeExists(page, chargeId) {
  const rows = (await (await page.request.post(GET, { multipart: { firmCd: String(SEED_FIRM) } })).json()).rows || [];
  return rows.some((r) => r.billingStatementChargeID === chargeId);
}

test('@regression C22308 Statement Charges - Delete a single Statement Charge', async ({ page }) => {
  test.setTimeout(180_000);

  const desc = `PepiC22308-${Date.now()}`;
  /** @type {string} */ let chargeId;

  await test.step('Login, open Statement Charges, seed a disposable charge', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await loginPlatformOneTim1Fresh(page);
    await page.goto(URL);
    await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
    const baseline = (await (await respP).json()).rows || [];

    await selectSeedFirm(page);
    /** @type {Record<string,string>|null} */ let optMap = null;
    await expect.poll(async () => { optMap = await readAdvisorOptions(page); return optMap ? Object.keys(optMap).length : 0; }, { timeout: 20_000, intervals: [500, 800, 1500] }).toBeGreaterThan(0);
    const advId = baseline.filter((r) => r.firmCd === SEED_FIRM && r.advisorOrGroupID)
      .map((r) => r.advisorOrGroupID).find((id) => optMap[id]);
    expect(advId, 'a valid firm-89 advisor for the seed').toBeTruthy();

    const res = await page.request.post(CREATE, { multipart: {
      firmCd: String(SEED_FIRM), advisorOrGroupID: advId, description: desc, frequencyCd: '1',
      quantity: '1', chargeTypeCd: '1', amount: '55.5', ratePercentFlag: 'false', rates: '[]',
      startDate: '01/01/2025', billingBucketCd: '1', positionInStatement: '1', status: 'New' } });
    const body = await res.json();
    expect(body.success, `seed failed: ${JSON.stringify(body.errors)}`).toBe(true);
    chargeId = body.billingStatementChargeID;
    expect(chargeId, 'seed returns a charge id').toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`[C22308] seeded advisor="${optMap[advId]}" desc="${desc}" id=${chargeId}`);
  });

  await test.step('Hover the row → Delete → the confirmation dialog opens', async () => {
    const row = await isolateRow(page, desc, 1);
    await clickRowAction(page, row, 'Delete');
    await expect(page.getByText(/Are you sure you want to delete/i).first()).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Cancel retains the charge', async () => {
    await page.locator('a[data-type="link"]').filter({ hasText: /^Cancel$/ }).first().click();
    await expect(page.getByText(/Are you sure you want to delete/i)).toBeHidden({ timeout: 10_000 });
    expect(await chargeExists(page, chargeId), 'charge retained after Cancel').toBe(true);
    // Still one row in the (still-filtered) grid.
    await expect.poll(async () => page.locator('.ag-center-cols-container .ag-row').count(), { timeout: 10_000, intervals: [400, 800] }).toBe(1);
  });

  await test.step('Delete → Yes removes the charge', async () => {
    const row = page.locator('.ag-center-cols-container .ag-row').first();
    await clickRowAction(page, row, 'Delete');
    await expect(page.getByText(/Are you sure you want to delete/i).first()).toBeVisible({ timeout: 15_000 });

    const delResp = page.waitForResponse((r) => r.url().includes(DELETE) && r.status() === 200, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    const dbody = await (await delResp).json();
    expect(dbody.success, 'delete request succeeded').toBe(true);
    await expect(page.getByText(/Are you sure you want to delete/i)).toBeHidden({ timeout: 10_000 });

    // The charge is gone from the app's data and from the grid.
    expect(await chargeExists(page, chargeId), 'charge deleted').toBe(false);
    await expect.poll(async () => page.locator('.ag-center-cols-container .ag-row').count(), { timeout: 10_000, intervals: [400, 800] }).toBe(0);
  });

  await test.step('Cleanup (only if Yes did not remove it)', async () => {
    if (await chargeExists(page, chargeId)) {
      await page.request.post(DELETE, { multipart: { statementChargesToDelete: JSON.stringify([chargeId]) } });
    }
  });
});
