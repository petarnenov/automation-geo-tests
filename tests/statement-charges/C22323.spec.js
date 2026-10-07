// @ts-check
/**
 * AIO C22323 (GEO-TC-11885) — Statement Charges - Mandatory fields in the
 * 'Statement Charges | Create New Charge' dialog with AUM Charge Type.
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1. Firm-1 admin opens Statement Charges.
 *   2. Click "Create New Charge" → the dialog opens with defaults (Charge Type=Flat,
 *      Amount visible, Qty=1, Billing Bucket=Advisor, Stmt Sort Order=1).
 *   3. Click the AUM radio → the Amount field is replaced by the Rate and Range To
 *      fields.
 *   4. Click Save → Firm, Advisor/Advisor Group, Description, Frequency, Qty, Charge
 *      Type, Rate, Range To and Billing Bucket are outlined in red (Rate and Range
 *      To require at least one row when Charge Type = AUM). A charge cannot be
 *      created while any required field is missing.
 *
 * ── What this asserts (verified against the live dialog) ──
 *  - The Create dialog opens with the Flat defaults and the Amount field shown.
 *  - Selecting AUM hides Amount and shows the Rate / Range To rate-grid fields.
 *  - Clicking Save with the required fields empty flags them invalid — FormBuilder
 *    sets `data-error="true"` (the red outline) on the empty required fields,
 *    including the AUM-only Rate and Range To — and NO create request is sent (the
 *    charge is not created; Save stays disabled).
 *
 * Negative test — nothing is created, so there is nothing to clean up.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';
const CREATE = '/react/createUpdateBillingStatementCharge.do';

test('@regression C22323 Statement Charges - Mandatory fields in Create New Charge (AUM)', async ({ page }) => {
  test.setTimeout(180_000);

  await test.step('Open Statement Charges', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await loginPlatformOneTim1Fresh(page);
    await page.goto(URL);
    await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
    await respP;
  });

  await test.step('Open the Create dialog — Flat defaults, Amount shown', async () => {
    await page.getByRole('button', { name: 'Create New Charge' }).click();
    await expect(page.locator('input#descriptionField')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('section[data-key="quantity"] input').first()).toHaveValue('1');
    await expect(page.locator('section[data-key="positionInStatement"] input').first()).toHaveValue('1');
    await expect(page.locator('section[data-key="billingBucketCd"] header[role="comboBoxHeader"]').first()).toHaveText(/Advisor/i);
    // Flat is the default charge type; the Amount field is shown.
    await expect(page.locator('input#chargeTypeCd_1')).toBeChecked();
    await expect(page.locator('section[data-key="amount"]')).toBeVisible();
  });

  await test.step('Select AUM → Amount is replaced by Rate and Range To', async () => {
    // FormBuilder radio: the visible target is the icon label next to the hidden
    // input (same pattern as C25706). Poll-click until the radio checks.
    const aum = page.locator('input#chargeTypeCd_2');
    await expect
      .poll(async () => {
        if (!(await aum.evaluate((el) => /** @type {HTMLInputElement} */ (el).checked).catch(() => false))) {
          await page.locator('input#chargeTypeCd_2 + label').first().click({ force: true }).catch(() => {});
        }
        return aum.evaluate((el) => /** @type {HTMLInputElement} */ (el).checked).catch(() => false);
      }, { timeout: 10_000, intervals: [300, 600, 1000, 1500] })
      .toBe(true);

    await expect(page.locator('section[data-key="amount"]'), 'Amount is hidden for AUM').toBeHidden({ timeout: 10_000 });
    await expect(page.locator('input#rate_0_multiGroupField'), 'Rate field shown').toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input#rangeTo_0_multiGroupField'), 'Range To field shown').toBeVisible({ timeout: 10_000 });
  });

  let createRequested = false;
  page.on('request', (r) => { if (r.url().includes(CREATE) && r.method() === 'POST') createRequested = true; });

  await test.step('Save with required fields empty → they are flagged (incl. Rate/Range To); no charge created', async () => {
    const save = page.locator('button[data-role="formSubmitButton"]', { hasText: /^Save$/ }).first();
    await expect(save).toBeVisible({ timeout: 10_000 });
    await save.click();

    // The empty required fields are flagged, including the AUM-only Rate & Range To.
    await expect(page.locator('section[data-key="description"][data-error="true"]')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('section[data-key="rates"][data-error="true"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('section[data-key="rangeTo"][data-error="true"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('section[data-key="advisorOrGroupID"][data-error="true"]').first()).toBeVisible({ timeout: 10_000 });

    // The charge is NOT created and the Save stays disabled (form invalid).
    expect(createRequested, 'no create request while required fields are missing').toBe(false);
    await expect(save).toHaveClass(/disabled/i, { timeout: 10_000 });
    await expect(page.locator('input#descriptionField'), 'dialog still open').toBeVisible();
  });

  await test.step('Confirm still nothing was created', async () => {
    await page.waitForTimeout(1000);
    expect(createRequested, 'no statement charge was created').toBe(false);
  });
});
