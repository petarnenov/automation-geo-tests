// @ts-check
/**
 * AIO C22322 (GEO-TC-11887) — Statement Charges - Create a statement charge from firm 1.
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * ── About the AIO manual steps ──
 * The written steps are copy-pasted from C22321 (the mandatory-fields NEGATIVE case
 * — open the dialog, remove defaults, Save, see red outlines). That text does not
 * match this case's TITLE, "Create a statement charge from firm 1", which is the
 * POSITIVE case: fill the Create dialog and successfully create a charge. This test
 * implements the title.
 *
 * ── What it does ──
 *  1. Opens the real "Create New Charge" dialog and asserts it is the create UI with
 *     the documented defaults (Qty=1, Charge Type=Flat, Billing Bucket=Advisor, Stmt
 *     Sort Order=1) and that its Firm defaults to firm 1 (GeoWealth Management LLC) —
 *     i.e. the charge is being created "from firm 1".
 *  2. Creates the charge through the dialog's own Save request
 *     (POST /react/createUpdateBillingStatementCharge.do, no billingStatementChargeID)
 *     with valid data and a firm-1 advisor. Same hybrid pattern as C22307/C22316 —
 *     the endpoint IS the dialog's Save, and it side-steps the FormBuilder
 *     async-advisor quirk that briefly disables the Save button.
 *  3. Verifies the new charge is created (distinct id, correct values via the
 *     endpoint) and is displayed in the grid.
 *
 * ── Isolation ──
 * Firm 1 has no statement charges of its own on qa4, so filtering the grid by firm 1
 * shows exactly this created charge. It is deleted in cleanup. See
 * [[project_statement_charges_grid_gotchas]].
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';
const CREATE = '/react/createUpdateBillingStatementCharge.do';
const DELETE = '/react/deleteBillingStatementCharges.do';
const CREATE_FIRM = 1;

function readAdvisorOptions(page) {
  return page.locator('#advisorOrGroupIDDiv').first().evaluate((el) => {
    let node = /** @type {any} */ (el);
    for (let h = 0; h < 30 && node; h++) {
      const fk = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
      if (fk) {
        let f = node[fk];
        for (let u = 0; u < 40 && f; u++) {
          const p = f.memoizedProps;
          if (p && p.options && typeof p.options === 'object' && !Array.isArray(p.options) && Object.keys(p.options).length > 0) {
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

/** Select firm 1 (GeoWealth Management LLC) in the filter panel's Select Firm combo. */
async function selectFirm1(page) {
  const firmTa = page.locator('#firmCd_typeAhead').last();
  await firmTa.click();
  await firmTa.pressSequentially('GeoWealth Management');
  await page.locator('[role="combo-box-list-item"]').filter({ hasText: /\(1\)/ }).first()
    .evaluate((el) => /** @type {HTMLElement} */ (el).click());
}

test('@regression C22322 Statement Charges - Create a statement charge from firm 1', async ({ page }) => {
  test.setTimeout(180_000);

  const desc = `PepiC22322-${Date.now()}`;
  /** @type {string} */ let advId;
  /** @type {string} */ let chargeId;

  await test.step('Open Statement Charges', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await loginPlatformOneTim1Fresh(page);
    await page.goto(URL);
    await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
    await respP;
  });

  await test.step('Create New Charge dialog opens with defaults, from firm 1', async () => {
    await page.getByRole('button', { name: 'Create New Charge' }).click();
    // The Create dialog is identified by its modal-only Description field (the page
    // also carries a "Create New Charge" button with the same text).
    const descInput = page.locator('input#descriptionField');
    await expect(descInput).toBeVisible({ timeout: 15_000 });
    await expect(descInput, 'Description starts blank').toHaveValue('');
    // Documented defaults for the Flat charge type.
    await expect(page.locator('section[data-key="quantity"] input').first()).toHaveValue('1');
    await expect(page.locator('section[data-key="positionInStatement"] input').first()).toHaveValue('1');
    await expect(page.locator('section[data-key="billingBucketCd"] header[role="comboBoxHeader"]').first()).toHaveText(/Advisor/i);
    // The dialog's Firm defaults to firm 1 (create "from firm 1").
    await expect(page.locator('#firmCd_typeAhead').first()).toHaveValue(/\(1\)/, { timeout: 10_000 });
    // Read firm 1's advisor options (loaded for the defaulted firm), for the Save.
    /** @type {Record<string,string>|null} */ let optMap = null;
    await expect.poll(async () => { optMap = await readAdvisorOptions(page); return optMap ? Object.keys(optMap).length : 0; }, { timeout: 20_000, intervals: [500, 800, 1500] }).toBeGreaterThan(0);
    advId = Object.keys(optMap)[0];
    // Close the dialog (Cancel link, else Escape); the create is applied via its
    // Save request next.
    const cancel = page.locator('a[data-type="link"]').filter({ hasText: /^Cancel$/ }).first();
    if (await cancel.isVisible().catch(() => false)) await cancel.click();
    else await page.keyboard.press('Escape');
    await expect(page.locator('input#descriptionField')).toBeHidden({ timeout: 15_000 });
  });

  await test.step('Save the new charge (dialog Save request) and confirm it was created', async () => {
    const res = await page.request.post(CREATE, { multipart: {
      firmCd: String(CREATE_FIRM), advisorOrGroupID: advId, description: desc, frequencyCd: '1',
      quantity: '1', chargeTypeCd: '1', amount: '88.8', ratePercentFlag: 'false', rates: '[]',
      startDate: '01/01/2025', billingBucketCd: '1', positionInStatement: '1', status: 'New' } });
    const body = await res.json();
    expect(body.success, `create failed: ${JSON.stringify(body.errors)}`).toBe(true);
    chargeId = body.billingStatementChargeID;
    expect(chargeId, 'create returns a new charge id').toBeTruthy();

    const rows = (await (await page.request.post(GET, { multipart: { firmCd: String(CREATE_FIRM) } })).json()).rows || [];
    const mine = rows.find((r) => r.billingStatementChargeID === chargeId);
    expect(mine, 'the created charge exists on firm 1').toBeTruthy();
    expect(mine.description).toBe(desc);
    expect(String(mine.amount)).toBe('88.8');
    expect(mine.status).toBe('New');
    // eslint-disable-next-line no-console
    console.log(`[C22322] created charge id=${chargeId} desc="${desc}" on firm ${CREATE_FIRM}`);
  });

  await test.step('The new charge is displayed in the grid', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await page.reload();
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
    await respP;
    await selectFirm1(page);
    const filterResp = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
    await filterResp;
    await clearGridColumnFilters(page);
    const search = page.locator('input[placeholder="Search"]').first();
    await search.click();
    await search.fill('');
    await search.pressSequentially(desc);
    await expect.poll(async () => page.locator('.ag-center-cols-container .ag-row').count(), { timeout: 20_000, intervals: [400, 800, 1500] }).toBe(1);
  });

  await test.step('Cleanup: delete the created charge', async () => {
    if (chargeId) await page.request.post(DELETE, { multipart: { statementChargesToDelete: JSON.stringify([chargeId]) } });
  });
});
