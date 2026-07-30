// @ts-check
/**
 * AIO C22310 (GEO-TC-11881) — Statement Charges - At least one field must have been
 * updated to create a statement charge copy.
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1-2. Firm-1 admin opens Statement Charges; hover a row → action buttons show.
 *   3.   Click the Copy icon → the "Create New Charge from Existing" dialog opens
 *        with the source row's values (Cancel / Reset links, Save).
 *   4.   The dialog data matches the grid row (no changes made).
 *   5.   Without changing anything, click Save → a standard error message is shown
 *        and the copy is NOT created.
 *
 * ── Why the real UI Save is used here (unlike C22307/C22316) ──
 * The Copy dialog is PRE-FILLED from the source, so every required field is already
 * populated and the Save button is enabled (form valid). Clicking Save posts the
 * copy (createUpdateBillingStatementCharge.do, no id) with data identical to the
 * source; the backend rejects it — a copy must differ from the original
 * (BillingStatementChargeDAO.chargeWithDescrAndAdvOrGrpExistsInFirm →
 * "Combination of Description and Advisor/Advisor Group must be unique."). The error
 * is surfaced in the dialog and no copy is created. This test drives that real flow.
 *
 * ── Isolation ──
 * The test seeds its OWN source charge on firm 89, attempts the no-change copy
 * (which fails by design), and deletes the source. See
 * [[project_statement_charges_grid_gotchas]].
 *
 * ── What this asserts ──
 *  - The Copy dialog opens with the source row's values (Description, Amount).
 *  - Saving without any change returns a backend error (success=false) surfaced as
 *    a message, and no second (copy) charge is created — only the source remains.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';
const CREATE = '/react/createUpdateBillingStatementCharge.do';
const DELETE = '/react/deleteBillingStatementCharges.do';
const SEED_FIRM = 89;

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

test('@pepi C22310 Statement Charges - At least one field must change to copy a charge', async ({ page }) => {
  test.setTimeout(180_000);

  const desc = `PepiC22310-${Date.now()}`;
  /** @type {string} */ let srcId;

  await test.step('Login, open Statement Charges, seed a source charge', async () => {
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
    expect(advId, 'a valid firm-89 advisor for the seed').toBeTruthy();

    const res = await page.request.post(CREATE, { multipart: {
      firmCd: String(SEED_FIRM), advisorOrGroupID: advId, description: desc, frequencyCd: '1',
      quantity: '1', chargeTypeCd: '1', amount: '55.5', ratePercentFlag: 'false', rates: '[]',
      startDate: '01/01/2025', billingBucketCd: '1', positionInStatement: '1', status: 'New' } });
    const body = await res.json();
    expect(body.success, `seed failed: ${JSON.stringify(body.errors)}`).toBe(true);
    srcId = body.billingStatementChargeID;
    // eslint-disable-next-line no-console
    console.log(`[C22310] seeded source id=${srcId} desc="${desc}"`);
  });

  await test.step('Hover the row → Copy → the dialog shows the source values', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
    await respP;
    await clearGridColumnFilters(page);
    const search = page.locator('input[placeholder="Search"]').first();
    await search.click();
    await search.fill('');
    await search.pressSequentially(desc);
    await expect.poll(async () => page.locator('.ag-center-cols-container .ag-row').count(), { timeout: 20_000, intervals: [400, 800, 1500] }).toBe(1);

    const row = page.locator('.ag-center-cols-container .ag-row').first();
    await row.hover();
    const copyIcon = page.locator('.ag-pinned-right-cols-container .ag-row span[title="Copy"]').first();
    if (await copyIcon.isVisible().catch(() => false)) await copyIcon.click();
    else await copyIcon.click({ force: true });

    // "Create New Charge from Existing" — the dialog carries the source's values.
    await expect(page.getByText(/Create New Charge from Existing/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input#descriptionField')).toHaveValue(desc); // matches the grid row
    await expect(page.locator('section[data-key="amount"] input').first()).toHaveValue(/55\.5/);
  });

  await test.step('Save without any change → error shown, copy not created', async () => {
    // The copy form is pre-filled, so wait for the advisor to finish loading (keeps
    // the form valid / Save enabled), then Save the unchanged copy.
    await expect(page.locator('#advisorOrGroupID_typeAhead').last()).not.toHaveValue(/Select Advisor/i, { timeout: 15_000 });
    const save = page.locator('button[data-role="formSubmitButton"]', { hasText: /^Save$/ }).first();
    await expect(save).not.toHaveClass(/disabled/i, { timeout: 10_000 });

    const saveResp = page.waitForResponse((r) => r.url().includes(CREATE) && r.status() === 200, { timeout: 30_000 });
    await save.click();
    const body = await (await saveResp).json();
    // The backend rejects the unchanged copy.
    expect(body.success, 'the unchanged copy is rejected').toBe(false);
    expect(JSON.stringify(body.errors || []), 'a standard error is returned').toMatch(/unique|differ|exist/i);

    // The error is surfaced in the dialog, which stays open.
    await expect(page.getByText(/unique|must differ|already exist/i).first()).toBeVisible({ timeout: 10_000 });

    // No copy was created — only the source charge exists with this description.
    const rows = (await (await page.request.post(GET, { multipart: { firmCd: String(SEED_FIRM) } })).json()).rows || [];
    expect(rows.filter((r) => r.description === desc).length, 'no copy created').toBe(1);
  });

  await test.step('Cleanup: delete the source charge', async () => {
    if (srcId) await page.request.post(DELETE, { multipart: { statementChargesToDelete: JSON.stringify([srcId]) } });
  });
});
