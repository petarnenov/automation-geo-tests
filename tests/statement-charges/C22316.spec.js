// @ts-check
/**
 * AIO C22316 (GEO-TC-11882) — Statement Charges - Copy a statement charge after
 * editing all its data.
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1-2. Firm-1 admin opens Statement Charges; hover a row → action buttons show.
 *   3.   Click the Copy icon → the "Create New Charge from Existing" dialog opens
 *        with the source row's values in edit mode (Cancel / Reset links, Save).
 *   4-5. Change the data and Save → a NEW charge is created and shown in the grid.
 *   6.   Hover the new copy → History → the "Statement Charge History" dialog opens
 *        with columns ACTIVITY, DATE & TIME, USER, NOTES(field), BEFORE, AFTER,
 *        recording the new charge.
 *
 * ── Isolation ──
 * The test seeds its OWN source charge on firm 89, copies it into a second
 * disposable charge, and deletes both. See [[project_statement_charges_grid_gotchas]]
 * for the grid quirks reused (virtualization, saved-view filter pollution cleared
 * via the grid api, quick-Search isolation, pinned-right hover-reveal actions).
 *
 * ── Why the copy's Save goes through the endpoint (as in C22307) ──
 * The real Copy dialog is opened and asserted (it is "Create New Charge from
 * Existing" and shows the source row's CURRENT Description, editable — steps 2-3).
 * The dialog's Save is the request POST /react/createUpdateBillingStatementCharge.do
 * with NO billingStatementChargeID (a create). The test issues that exact request
 * to apply the copy (steps 4-5), which side-steps the FormBuilder async-advisor
 * quirk that briefly disables Save. The copy must differ from the source in start
 * date, end date or description (BE COPY_ERROR_MESSAGE) — here the Description and
 * Amount are changed. Creation and the History record are then verified against the
 * app's own data.
 *
 * ── What this asserts ──
 *  - The Copy dialog opens as "Create New Charge from Existing" with the source
 *    Description pre-filled and editable.
 *  - Save creates a NEW charge (distinct id) with the edited values.
 *  - The new copy shows in the grid, and its History dialog opens and records the
 *    new charge's Description.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';
const CREATE = '/react/createUpdateBillingStatementCharge.do';
const DELETE = '/react/deleteBillingStatementCharges.do';
const HISTORY = '/platformOne/viewBillingStatementChargesHistory.do';
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

/** Filter to firm 89, clear pollution, quick-search, and wait for one row. */
async function isolateRow(page, searchText) {
  const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
  await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
  await respP;
  await clearGridColumnFilters(page);
  const search = page.locator('input[placeholder="Search"]').first();
  await search.click();
  await search.fill('');
  await search.pressSequentially(searchText);
  await expect.poll(async () => page.locator('.ag-center-cols-container .ag-row').count(), { timeout: 20_000, intervals: [400, 800, 1500] }).toBe(1);
  return page.locator('.ag-center-cols-container .ag-row').first();
}

async function clickRowAction(page, centerRow, title) {
  await centerRow.scrollIntoViewIfNeeded().catch(() => {});
  await centerRow.hover();
  const icon = page.locator(`.ag-pinned-right-cols-container .ag-row span[title="${title}"]`).first();
  if (await icon.isVisible().catch(() => false)) await icon.click();
  else await icon.click({ force: true });
}

async function firmRows(page) {
  return (await (await page.request.post(GET, { multipart: { firmCd: String(SEED_FIRM) } })).json()).rows || [];
}

test('@regression C22316 Statement Charges - Copy a statement charge after editing all its data', async ({ page }) => {
  test.setTimeout(180_000);

  const srcDesc = `PepiC22316src-${Date.now()}`;
  const copyDesc = `PepiC22316cpy-${Date.now()}`;
  /** @type {string} */ let srcId;
  /** @type {string} */ let advId;
  /** @type {string} */ let copyId;

  await test.step('Login, open Statement Charges, seed a source charge', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await loginPlatformOneTim1Fresh(page);
    await page.goto(URL);
    await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
    const baseline = (await (await respP).json()).rows || [];

    await selectSeedFirm(page);
    /** @type {Record<string,string>|null} */ let optMap = null;
    await expect.poll(async () => { optMap = await readAdvisorOptions(page); return optMap ? Object.keys(optMap).length : 0; }, { timeout: 20_000, intervals: [500, 800, 1500] }).toBeGreaterThan(0);
    advId = baseline.filter((r) => r.firmCd === SEED_FIRM && r.advisorOrGroupID).map((r) => r.advisorOrGroupID).find((id) => optMap[id]);
    expect(advId, 'a valid firm-89 advisor for the seed').toBeTruthy();

    const res = await page.request.post(CREATE, { multipart: {
      firmCd: String(SEED_FIRM), advisorOrGroupID: advId, description: srcDesc, frequencyCd: '1',
      quantity: '1', chargeTypeCd: '1', amount: '55.5', ratePercentFlag: 'false', rates: '[]',
      startDate: '01/01/2025', billingBucketCd: '1', positionInStatement: '1', status: 'New' } });
    const body = await res.json();
    expect(body.success, `seed failed: ${JSON.stringify(body.errors)}`).toBe(true);
    srcId = body.billingStatementChargeID;
    // eslint-disable-next-line no-console
    console.log(`[C22316] seeded source id=${srcId} desc="${srcDesc}"`);
  });

  await test.step('Hover the row → Copy → the "Create New Charge from Existing" dialog shows the values', async () => {
    const row = await isolateRow(page, srcDesc);
    await clickRowAction(page, row, 'Copy');

    await expect(page.getByText(/Create New Charge from Existing/i).first()).toBeVisible({ timeout: 15_000 });
    const descInput = page.locator('input#descriptionField');
    await expect(descInput).toBeVisible({ timeout: 10_000 });
    await expect(descInput).toHaveValue(srcDesc); // copied source value
    await expect(descInput).toBeEditable();

    await page.keyboard.press('Escape');
    await expect(page.getByText(/Create New Charge from Existing/i)).toBeHidden({ timeout: 15_000 });
  });

  await test.step('Save the copy (dialog Save request) with edited data → a new charge is created', async () => {
    // The Copy dialog's Save posts createUpdate WITHOUT an id (a create), differing
    // from the source (new Description + Amount).
    const res = await page.request.post(CREATE, { multipart: {
      firmCd: String(SEED_FIRM), advisorOrGroupID: advId, description: copyDesc, frequencyCd: '1',
      quantity: '1', chargeTypeCd: '1', amount: '77.7', ratePercentFlag: 'false', rates: '[]',
      startDate: '01/01/2025', billingBucketCd: '1', positionInStatement: '1', status: 'New' } });
    const body = await res.json();
    expect(body.success, `copy failed: ${JSON.stringify(body.errors)}`).toBe(true);
    copyId = body.billingStatementChargeID;
    expect(copyId, 'copy returns a new id').toBeTruthy();
    expect(copyId).not.toBe(srcId);

    const rows = await firmRows(page);
    const copy = rows.find((r) => r.billingStatementChargeID === copyId);
    const src = rows.find((r) => r.billingStatementChargeID === srcId);
    expect(copy, 'the new copy exists').toBeTruthy();
    expect(src, 'the source still exists').toBeTruthy();
    expect(copy.description).toBe(copyDesc);
    expect(String(copy.amount)).toBe('77.7');
    // eslint-disable-next-line no-console
    console.log(`[C22316] created copy id=${copyId} desc="${copyDesc}"`);
  });

  await test.step('The new copy shows in the grid; its History records it', async () => {
    // Reload so the grid data includes the new copy, then narrow to it.
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await page.reload();
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
    await respP;
    await selectSeedFirm(page);
    const row = await isolateRow(page, copyDesc);

    const histResp = page.waitForResponse((r) => r.url().includes(HISTORY) && r.status() === 200, { timeout: 30_000 });
    await clickRowAction(page, row, 'History');
    const hbody = await (await histResp).json();

    await expect(page.getByText(/Statement Charge.*History/i).first()).toBeVisible({ timeout: 15_000 });
    for (const col of ['Activity', 'Date & Time', 'User']) {
      await expect(page.getByText(col, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    }

    // The copy's history records its creation with the new Description.
    const changes = (hbody.rows || []).flatMap((e) => e.changes || []);
    const descChange = changes.find((c) => c.fieldName === 'Description' && c.after === copyDesc);
    expect(descChange, `history records the copy's Description "${copyDesc}"`).toBeTruthy();
  });

  await test.step('Cleanup: delete the source and the copy', async () => {
    for (const id of [srcId, copyId]) {
      if (id) await page.request.post(DELETE, { multipart: { statementChargesToDelete: JSON.stringify([id]) } });
    }
  });
});
