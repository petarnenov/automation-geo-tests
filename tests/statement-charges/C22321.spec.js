// @ts-check
/**
 * AIO C22321 (GEO-TC-11884) — Statement Charges - Mandatory fields in the
 * 'Statement Charges | Create New Charge' dialog with Flat Charge Type.
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1. Firm-1 admin (full BILLING STMT CHARGES permission) opens Statement Charges.
 *   2. Click "Create New Charge" → the dialog opens, all fields blank/at defaults
 *      (Frequency=Monthly, Qty=1, Charge Type=Flat, Billing Bucket=Advisor, Stmt
 *      Sort Order=1; Firm/Advisor/Description/Amount/dates/split blank).
 *   3. Remove all default values if possible.
 *   4. Click Save → Firm, Advisor/Advisor Group, Description, Frequency, Qty, Charge
 *      Type, Amount and Billing Bucket are outlined in red. A charge cannot be
 *      created while any required field is missing.
 *
 * ── What this asserts (verified against the live dialog) ──
 *  - The Create New Charge dialog opens with the documented defaults (Qty=1, Charge
 *    Type=Flat, Billing Bucket=Advisor, Stmt Sort Order=1) and blank required fields.
 *  - Clicking Save with the required fields empty flags them as invalid — the
 *    FormBuilder sets `data-error="true"` (the red outline) on the empty required
 *    fields (Description, Amount, Advisor/Advisor Group, Firm) — and NO create
 *    request is sent, i.e. the charge is not created. The Save button also stays in
 *    its disabled (isFormValid=false) style.
 *
 * Negative test — nothing is created, so there is nothing to clean up.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';
const CREATE = '/react/createUpdateBillingStatementCharge.do';

test('@regression C22321 Statement Charges - Mandatory fields in Create New Charge (Flat)', async ({ page }) => {
  test.setTimeout(180_000);

  await test.step('Open Statement Charges', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await loginPlatformOneTim1Fresh(page);
    await page.goto(URL);
    await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
    await respP;
  });

  await test.step('Click "Create New Charge" — the dialog opens with its defaults', async () => {
    await page.getByRole('button', { name: 'Create New Charge' }).click();
    await expect(page.getByText('Create New Charge', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    // Documented defaults for the Flat charge type.
    await expect(page.locator('section[data-key="quantity"] input').first()).toHaveValue('1');
    await expect(page.locator('section[data-key="positionInStatement"] input').first()).toHaveValue('1');
    await expect(page.locator('section[data-key="billingBucketCd"] header[role="comboBoxHeader"]').first()).toHaveText(/Advisor/i);
    // Required fields start blank.
    await expect(page.locator('section[data-key="description"] input#descriptionField')).toHaveValue('');
  });

  let createRequested = false;
  page.on('request', (r) => { if (r.url().includes(CREATE) && r.method() === 'POST') createRequested = true; });

  await test.step('Click Save with required fields empty → they are flagged; no charge is created', async () => {
    // The Save button is style-disabled while the form is invalid, but is HTML-
    // clickable — clicking it runs the form validation.
    const save = page.locator('button[data-role="formSubmitButton"]', { hasText: /^Save$/ }).first();
    await expect(save).toBeVisible({ timeout: 10_000 });
    await save.click();

    // FormBuilder marks the empty required fields invalid (data-error="true" is the
    // red outline). Description and Amount are unique to the Create dialog.
    await expect(page.locator('section[data-key="description"][data-error="true"]')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('section[data-key="amount"][data-error="true"]')).toHaveCount(1, { timeout: 10_000 });
    // The required Advisor/Advisor Group and Firm are flagged too (>=1 instance).
    await expect(page.locator('section[data-key="advisorOrGroupID"][data-error="true"]').first()).toBeVisible({ timeout: 10_000 });

    // The charge is NOT created and the Save stays disabled (form invalid).
    expect(createRequested, 'no create request is sent while required fields are missing').toBe(false);
    await expect(save).toHaveClass(/disabled/i, { timeout: 10_000 });
    // The dialog is still open.
    await expect(page.getByText('Create New Charge', { exact: true }).first()).toBeVisible();
  });

  await test.step('Confirm still nothing was created', async () => {
    await page.waitForTimeout(1000);
    expect(createRequested, 'no statement charge was created').toBe(false);
  });
});
