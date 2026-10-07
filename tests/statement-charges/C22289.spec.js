// @ts-check
/**
 * AIO C22289 (GEO-TC-11891) — Statement Charges - Filter by the 'Firm Name' of an
 * inactive firm.
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * ── About the AIO manual steps ──
 * The first steps describe the real control — the "Select Firm" search-ahead lists
 * ALL firms (active AND inactive); pick an inactive firm and Filter → the grid shows
 * only that firm's Statement Charges. The later steps (Export/Delete run icons,
 * "Export Billing Activity" dialog) are boilerplate carried over from a Billing Runs
 * case and do not apply to Statement Charges. This test implements the title: filter
 * by an INACTIVE firm's name. It is the inactive-firm twin of C22290.
 *
 * ── What the Firm filter does (verified against source) ──
 * The backend adds `equal(firm.firmCd, filter.firmCd)` with no active/inactive
 * check (BillingStatementChargeDAO), so filtering by an inactive firm works exactly
 * like an active one. Inactive firms render with a leading "*" on their name.
 *
 * ── Isolation ──
 * No inactive firm on qa4 owns any statement charge, so the test seeds ONE charge on
 * a known inactive firm (8, "*Smith & Cox, LLC") using a valid active advisor, then
 * filters by that firm and asserts only its charge comes back. The create BE checks
 * the firm exists (not its active flag) and the advisor is active, so seeding on an
 * inactive firm is allowed. The seed is deleted at the end. See
 * [[project_statement_charges_grid_gotchas]].
 *
 * ── What this asserts ──
 *  - The inactive firm is offered in the Select Firm search-ahead (name marked "*").
 *  - Filtering by it returns only that firm's charges (every row's firmCd matches;
 *    the seeded charge is present; the firm name is the inactive "*"-marked one).
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';
const CREATE = '/react/createUpdateBillingStatementCharge.do';
const DELETE = '/react/deleteBillingStatementCharges.do';
const ADVISOR_FIRM = 89; // source of a known active advisor
const INACTIVE_FIRM = 8; // "*Smith & Cox, LLC" — a long-standing inactive firm on qa4

function readAdvisorOptions(page) {
  return page.locator('#advisorOrGroupIDDiv').first().evaluate((el) => {
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

test("@regression C22289 Statement Charges - Filter by the 'Firm Name' of an inactive firm", async ({ page }) => {
  test.setTimeout(180_000);

  const desc = `PepiC22289-${Date.now()}`;
  /** @type {string} */ let chargeId;

  await test.step('Login, open Statement Charges, seed a charge on the inactive firm', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await loginPlatformOneTim1Fresh(page);
    await page.goto(URL);
    await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#firmCd_typeAhead')).toBeVisible({ timeout: 30_000 });
    const baseline = (await (await respP).json()).rows || [];

    // A valid active advisor (firm 89 advisors that already have charges are active).
    const firmTa = page.locator('#firmCd_typeAhead');
    await firmTa.click();
    await firmTa.pressSequentially('Sowell');
    await page.locator('[role="combo-box-list-item"]').filter({ hasText: new RegExp(`\\(${ADVISOR_FIRM}\\)`) }).first()
      .evaluate((el) => /** @type {HTMLElement} */ (el).click());
    /** @type {Record<string,string>|null} */ let optMap = null;
    await expect.poll(async () => { optMap = await readAdvisorOptions(page); return optMap ? Object.keys(optMap).length : 0; }, { timeout: 20_000, intervals: [500, 800, 1500] }).toBeGreaterThan(0);
    const advId = baseline.filter((r) => r.firmCd === ADVISOR_FIRM && r.advisorOrGroupID).map((r) => r.advisorOrGroupID).find((id) => optMap[id]);
    expect(advId, 'a valid active advisor for the seed').toBeTruthy();

    const res = await page.request.post(CREATE, { multipart: {
      firmCd: String(INACTIVE_FIRM), advisorOrGroupID: advId, description: desc, frequencyCd: '1',
      quantity: '1', chargeTypeCd: '1', amount: '55.5', ratePercentFlag: 'false', rates: '[]',
      startDate: '01/01/2025', billingBucketCd: '1', positionInStatement: '1', status: 'New' } });
    const body = await res.json();
    expect(body.success, `seed on inactive firm failed: ${JSON.stringify(body.errors)}`).toBe(true);
    chargeId = body.billingStatementChargeID;
    expect(chargeId, 'seed returns a charge id').toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`[C22289] seeded charge id=${chargeId} on inactive firm ${INACTIVE_FIRM}`);
  });

  await test.step('The inactive firm is offered in the Select Firm search-ahead', async () => {
    const firmTa = page.locator('#firmCd_typeAhead');
    await firmTa.click();
    await firmTa.fill('');
    await firmTa.pressSequentially('Smith');
    const opt = page.locator('[role="combo-box-list-item"]').filter({ hasText: new RegExp(`\\(${INACTIVE_FIRM}\\)`) }).first();
    await expect(opt).toBeVisible({ timeout: 10_000 });
    // Inactive firms are marked with a leading "*".
    await expect(opt).toHaveText(/\*/);
    await opt.evaluate((el) => /** @type {HTMLElement} */ (el).click());
    await expect(firmTa).toHaveValue(new RegExp(`\\(${INACTIVE_FIRM}\\)`), { timeout: 10_000 });
  });

  await test.step('Filter → only the inactive firm\'s charges are shown', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
    const filtered = (await (await respP).json()).rows || [];

    expect(filtered.length, 'the inactive firm has charges to show').toBeGreaterThan(0);
    for (const row of filtered) {
      expect(row.firmCd, 'every row belongs to the selected inactive firm').toBe(INACTIVE_FIRM);
    }
    // The seeded charge is present, and the firm is the inactive "*"-marked one.
    const mine = filtered.find((r) => r.billingStatementChargeID === chargeId);
    expect(mine, 'the seeded charge is displayed').toBeTruthy();
    expect(mine.firmName, 'the firm is marked inactive with a leading "*"').toMatch(/^\*/);
  });

  await test.step('Cleanup: delete the seeded charge', async () => {
    if (chargeId) await page.request.post(DELETE, { multipart: { statementChargesToDelete: JSON.stringify([chargeId]) } });
  });
});
