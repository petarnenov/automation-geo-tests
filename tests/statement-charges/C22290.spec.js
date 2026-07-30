// @ts-check
/**
 * AIO C22290 (GEO-TC-11892) — Statement Charges - Filter by the 'Firm Name' of an
 * active firm.
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1. Click the 'By Firm Name' filter drop-down → a search-ahead, single-select
 *      list of all active/inactive firms opens.
 *   2. Select any active firm and click Filter → the grid is filtered to only that
 *      firm's charges.
 *
 * ── What the Firm filter is (verified against source) ──
 * On the Statement Charges filter (Filter module Options panel,
 * StatementChargesCriteria.js) the "Select Firm" control is a type-ahead single
 * select (`#firmCd`, options from useFirmsSelectors = all firms). It is shown only
 * to a platform (firm-1) admin — a firm-scoped user is pinned to their own firm.
 * Clicking "Filter" re-fetches the grid via POST
 * /react/getBillingStatementCharges.do; the backend adds
 * `equal(firm.firmCd, filter.firmCd)` (BillingStatementChargeDAO), so only the
 * selected firm's charges come back. Each grid row echoes its firm as `firmCd` /
 * `firmName`.
 *
 * ── Strategy ──
 * Data-driven, asserting on the endpoint's JSON (robust to ag-grid virtualisation):
 *   1. Read the unfiltered result on load (baseline, all firms).
 *   2. Pick the firm that owns the most charges — deterministic, guaranteed to have
 *      data, and known-active (it carries current-period charges). The baseline has
 *      more than one firm, so filtering to this one is a genuine narrowing.
 *   3. Select that firm in the type-ahead and click Filter.
 *   4. The filtered result: every row carries the selected firmCd, the row count
 *      equals the firm's baseline charge count, and it is strictly smaller than the
 *      baseline (a different firm's rows were dropped).
 *
 * Read-only: the test only filters; it creates/changes no data.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const STATEMENT_CHARGES_URL =
  '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET_CHARGES = '/react/getBillingStatementCharges.do';

async function openStatementCharges(page) {
  await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
}

test("@pepi C22290 Statement Charges - Filter by the 'Firm Name' of an active firm", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await loginPlatformOneTim1Fresh(page);

  /** @type {Array<{firmCd:number,firmName:string}>} */
  let baseline = [];

  await test.step('Open Statement Charges and capture the unfiltered result', async () => {
    const respP = page.waitForResponse(
      (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
      { timeout: 60_000 }
    );
    await page.goto(STATEMENT_CHARGES_URL);
    await openStatementCharges(page);
    baseline = (await (await respP).json()).rows || [];
    expect(baseline.length, 'firm-1 Statement Charges has data to filter').toBeGreaterThan(0);
    // The "Select Firm" control is present for the platform admin.
    await expect(page.locator('#firmCd_typeAhead')).toBeVisible({ timeout: 30_000 });
  });

  // Firm with the most charges: deterministic, has data, and active (current-period
  // charges). Requires >1 firm in the baseline so the filter really narrows.
  let firm = { firmCd: 0, firmName: '', count: 0 };
  await test.step('Choose the firm to filter by', async () => {
    /** @type {Map<number,{firmName:string,count:number}>} */
    const byFirm = new Map();
    for (const r of baseline) {
      if (!byFirm.has(r.firmCd)) byFirm.set(r.firmCd, { firmName: r.firmName, count: 0 });
      byFirm.get(r.firmCd).count += 1;
    }
    expect(byFirm.size, 'baseline spans more than one firm so the filter is meaningful').toBeGreaterThan(1);
    let best = null;
    for (const [firmCd, f] of byFirm) {
      if (!best || f.count > best.count) best = { firmCd, firmName: f.firmName, count: f.count };
    }
    firm = best;
    expect(firm.count, 'chosen firm has fewer charges than the whole grid').toBeLessThan(
      baseline.length
    );
    // eslint-disable-next-line no-console
    console.log(`[C22290] firm=${firm.firmName} (${firm.firmCd}), charges=${firm.count}, baseline=${baseline.length}`);
  });

  await test.step('Select the firm in the "Select Firm" type-ahead', async () => {
    const firmTa = page.locator('#firmCd_typeAhead');
    await firmTa.click();
    await firmTa.pressSequentially(firm.firmName.split(/\s/)[0]);
    const firmOpt = page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: new RegExp(`\\(${firm.firmCd}\\)`) })
      .first();
    await expect(firmOpt).toBeVisible({ timeout: 10_000 });
    await firmOpt.evaluate((el) => /** @type {HTMLElement} */ (el).click());
    // The closed type-ahead shows the selected firm.
    await expect(firmTa).toHaveValue(new RegExp(`\\(${firm.firmCd}\\)`), { timeout: 10_000 });
  });

  /** @type {Array<{firmCd?:number}>} */
  let filtered = [];
  await test.step('Click Filter', async () => {
    const respP = page.waitForResponse(
      (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
      { timeout: 60_000 }
    );
    await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
    filtered = (await (await respP).json()).rows || [];
  });

  await test.step('Only the selected firm\'s charges remain', async () => {
    expect(filtered.length, 'the firm has charges to show').toBeGreaterThan(0);
    for (const row of filtered) {
      expect(row.firmCd, 'every row belongs to the selected firm').toBe(firm.firmCd);
    }
    expect(filtered.length, 'row count equals the firm\'s baseline charge count').toBe(firm.count);
    expect(filtered.length, 'the filter narrowed the grid').toBeLessThan(baseline.length);
  });
});
