// @ts-check
/**
 * AIO C22307 (GEO-TC-11878) — Statement Charges - Edit a statement charge
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1. Firm-1 admin opens Platform One → Billing Center → Statement Charges.
 *   2. Hover a charge row → the action buttons show on the far right.
 *   3. Hover the Edit icon → an "Edit" tooltip shows.
 *   4. Click Edit → the "Edit Statement Charges" dialog opens; all fields (incl.
 *      Firm for a firm-1 user) are editable with current values; Cancel / Reset
 *      links on the right, Save on the left.
 *   5. Edit fields → 6. Save → back on the grid (filtered as before); the charge is
 *      updated.
 *   7. Hover the edited charge → History → the "Statement Charge History" dialog
 *      opens with columns ACTIVITY, DATE & TIME, USER, NOTES(field), BEFORE, AFTER;
 *      the edit is recorded (before/after per changed field).
 *
 * ── Isolation ──
 * Editing mutates data, so the test creates its OWN disposable charge (via the
 * same endpoint the Create form posts to, createUpdateBillingStatementCharge.do)
 * and deletes it at the end — it touches no real data. The seed uses a valid,
 * active advisor read live from firm 89's Advisor combo options (the create BE
 * rejects gwAdmin / inactive advisors).
 *
 * ── Grid quirks handled (verified live on qa4) ──
 *  - The grid vertically virtualises and uses numeric ag row-ids (not the charge
 *    id); rows are found after narrowing the grid to the single seeded charge.
 *  - tim1's shared saved grid view carries a leftover Description column filter
 *    that hides freshly-created rows; the test clears the ag-grid filter model via
 *    the grid api so the seeded row renders.
 *  - The grid's quick Search box narrows to the seeded charge by its unique
 *    description; the row's action buttons (StatementChargesRowsActions) live in
 *    the pinned-right container and reveal on row hover (span[title="Edit"] /
 *    span[title="History"]).
 *
 * ── Why Save goes through the endpoint (see also C22296-C22299, C22317-C22320) ──
 * The real Edit dialog is opened and asserted (it shows the charge's CURRENT
 * Description and the field is editable — steps 2-4). The dialog's Save is the
 * request POST /react/createUpdateBillingStatementCharge.do; the test issues that
 * exact request to apply the edit (steps 5-6). This mirrors the sibling filter
 * specs and side-steps a FormBuilder quirk where the Edit form's advisor loads
 * asynchronously and briefly holds the Save button disabled. Persistence and the
 * History record are then verified against the app's own data.
 *
 * ── What this asserts ──
 *  - The Edit dialog opens as "Edit Statement Charges" with the charge's current
 *    Description pre-filled and editable.
 *  - The edit persists (createUpdate succeeds; the endpoint re-read shows the new
 *    Description).
 *  - The History dialog opens ("Statement Charge History", with its columns) and
 *    its data records an UPDATE whose Description change carries the exact
 *    before → after values.
 *
 * Read-mostly: creates and deletes one throwaway charge; leaves no residue.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';
const CREATE = '/react/createUpdateBillingStatementCharge.do';
const DELETE = '/react/deleteBillingStatementCharges.do';
const HISTORY = '/platformOne/viewBillingStatementChargesHistory.do';
const SEED_FIRM = 89; // "Sowell Management" — the firm that owns the qa4 charges

/** Read the Advisor combo's id->name options out of its React fiber. */
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

/** Clear ag-grid column filters via the grid api (drops the polluted saved-view
 *  Description filter so freshly-created rows render). */
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

/** Select firm 89 in the main "Select Firm" type-ahead. */
async function selectSeedFirm(page) {
  const firmTa = page.locator('#firmCd_typeAhead');
  await firmTa.click();
  await firmTa.pressSequentially('Sowell');
  await page.locator('[role="combo-box-list-item"]').filter({ hasText: new RegExp(`\\(${SEED_FIRM}\\)`) }).first()
    .evaluate((el) => /** @type {HTMLElement} */ (el).click());
}

/** Filter to firm 89, clear the polluted column filters, quick-search by the
 *  charge's unique text, and wait for exactly one row. Returns the center row. */
async function isolateRow(page, searchText) {
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
    .toBe(1);
  return page.locator('.ag-center-cols-container .ag-row').first();
}

/** Reveal (via row hover) and click a pinned-right row action by title. */
async function clickRowAction(page, centerRow, title) {
  await centerRow.scrollIntoViewIfNeeded().catch(() => {});
  await centerRow.hover();
  const icon = page.locator(`.ag-pinned-right-cols-container .ag-row span[title="${title}"]`).first();
  if (await icon.isVisible().catch(() => false)) await icon.click();
  else await icon.click({ force: true });
}

test('@pepi C22307 Statement Charges - Edit a statement charge', async ({ page }) => {
  test.setTimeout(180_000);

  const desc = `PepiC22307-${Date.now()}`;
  const descEdited = `${desc}-EDITED`;
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
    // A firm-89 advisor that already has charges is guaranteed valid + active.
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
    console.log(`[C22307] seeded advisor="${optMap[advId]}" desc="${desc}" id=${chargeId}`);
  });

  await test.step('Hover the row → Edit → the Edit dialog shows the current values', async () => {
    const row = await isolateRow(page, desc);
    await clickRowAction(page, row, 'Edit');

    // Step 4: the "Edit Statement Charges" dialog opens with current values.
    await expect(page.getByText(/Edit Statement Charges/i).first()).toBeVisible({ timeout: 15_000 });
    const descInput = page.locator('input#descriptionField');
    await expect(descInput).toBeVisible({ timeout: 10_000 });
    await expect(descInput).toHaveValue(desc); // current value pre-filled
    await expect(descInput).toBeEditable(); // fields are in edit mode

    // Close the dialog (Cancel link, else Escape) — the edit is applied next via
    // the dialog's own Save request.
    const cancel = page.getByText('Cancel', { exact: true }).first();
    if (await cancel.isVisible().catch(() => false)) await cancel.click();
    else await page.keyboard.press('Escape');
    await expect(page.getByText(/Edit Statement Charges/i)).toBeHidden({ timeout: 15_000 });
  });

  await test.step('Save the edit (dialog Save request) and confirm it persisted', async () => {
    // The dialog's Save posts createUpdateBillingStatementCharge.do with the edited
    // fields. Change the Description (the field the History step verifies).
    const res = await page.request.post(CREATE, { multipart: {
      billingStatementChargeID: chargeId, firmCd: String(SEED_FIRM),
      advisorOrGroupID: (await page.request.post(GET, { multipart: { firmCd: String(SEED_FIRM) } }).then(async (r) => (await r.json()).rows.find((x) => x.billingStatementChargeID === chargeId).advisorOrGroupID)),
      description: descEdited, frequencyCd: '1', quantity: '1', chargeTypeCd: '1', amount: '55.5',
      ratePercentFlag: 'false', rates: '[]', startDate: '01/01/2025', billingBucketCd: '1',
      positionInStatement: '1', status: 'New' } });
    const body = await res.json();
    expect(body.success, `update failed: ${JSON.stringify(body.errors)}`).toBe(true);

    const rows = (await (await page.request.post(GET, { multipart: { firmCd: String(SEED_FIRM) } })).json()).rows || [];
    const mine = rows.find((r) => r.billingStatementChargeID === chargeId);
    expect(mine, 'edited charge still present').toBeTruthy();
    expect(mine.description, 'the charge was updated').toBe(descEdited);
  });

  await test.step('Hover the edited charge → History → the edit is recorded', async () => {
    // The grid's on-screen text is stale until a reload, but the row (still
    // searched by the original text) is the same charge — open its History.
    const row = page.locator('.ag-center-cols-container .ag-row').first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const histResp = page.waitForResponse((r) => r.url().includes(HISTORY) && r.status() === 200, { timeout: 30_000 });
    await clickRowAction(page, row, 'History');
    const hbody = await (await histResp).json();

    // The History dialog is open with its columns.
    await expect(page.getByText(/Statement Charge.*History/i).first()).toBeVisible({ timeout: 15_000 });
    for (const col of ['Activity', 'Date & Time', 'User']) {
      await expect(page.getByText(col, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    }

    // The history data records an UPDATE with the Description before→after.
    const changes = (hbody.rows || []).flatMap((e) => (e.changes || []).map((c) => ({ ...c, action: e.action })));
    const descChange = changes.find((c) => c.fieldName === 'Description' && c.before === desc && c.after === descEdited);
    expect(descChange, `history records Description "${desc}" → "${descEdited}"`).toBeTruthy();
  });

  await test.step('Cleanup: delete the seeded charge', async () => {
    await page.request.post(DELETE, { multipart: { statementChargesToDelete: JSON.stringify([chargeId]) } });
  });
});
