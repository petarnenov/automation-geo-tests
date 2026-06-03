// @ts-check
/**
 * TestRail C25084 — Billing Spec Grid Shows Account Min / Account Max Columns
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25084 (Run 175, label Pepi)
 *
 * Summary: "Verify that the 'Account Min' and 'Account Max' columns can be
 * enabled from the Customize Columns modal and appear in the grid header
 * after Confirm & Reload."
 *
 * Implementation notes:
 *   - The Billing Specifications grid uses GwGrid's GridCustomizeColumns,
 *     which renders the trigger as `<span id="customizeColumns">` with an
 *     icon child (see GridCustomHeaderOverlayButton.js). Clicking the span
 *     opens a HeaderOverlay containing the SelectGridColumnsForm.
 *   - The form's column toggles are FormBuilder checkboxes — each has a
 *     hidden `<input id="...Field">` plus a visible `<label for="...Field">`.
 *     The input is display:none, so we click the label.
 *   - "Account Min" field id  → `applyMinFeesOnAccountLevelFlagField`
 *     "Account Max" field id  → `applyMaxFeesOnAccountLevelFlagField`
 *     (both `hide: true` in useBillingSpecsColumnDef.js — default-hidden).
 *   - The grid only re-renders the new columns after the overlay's
 *     "Confirm & Reload" button is clicked.
 *
 * Read-only: this test toggles client-side column visibility (per-user
 * persisted state) and never mutates billing spec data.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const FIRM_CODE = 1;
const SPECS_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_CODE}`;

test('@pepi C25084 Billing Spec Grid Shows Account Min/Max Columns', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Billing Specifications grid for firm 1', async () => {
    await page.goto(SPECS_URL);
    await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    // Wait for at least one ag-grid row before interacting with the grid header.
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
  });

  await test.step('Open the Customize Columns overlay', async () => {
    await page.locator('span#customizeColumns').click();
    await expect(page.getByText('Customize Columns', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step('Tick Account Min and Account Max, then Confirm & Reload', async () => {
    const overlay = page.locator('[class*="showGridOverlay"]').first();
    // Headless races the FormBuilder Checkbox mount: a label click that lands
    // before React's onChange is attached toggles the DOM checkbox visually
    // but never enters React state, so Confirm & Reload submits no diff. Poll
    // until the input reports `checked=true` — re-click the label as needed.
    const tickBox = async (fieldId) => {
      const label = overlay.locator(`label[for="${fieldId}"]`);
      const input = overlay.locator(`input#${fieldId}`);
      await label.waitFor({ state: 'attached', timeout: 5_000 });
      await expect
        .poll(
          async () => {
            const isChecked = await input.evaluate(
              (el) => /** @type {HTMLInputElement} */ (el).checked
            );
            if (!isChecked) await label.click().catch(() => {});
            return await input.evaluate(
              (el) => /** @type {HTMLInputElement} */ (el).checked
            );
          },
          { timeout: 10_000, intervals: [200, 400, 800, 1_500] }
        )
        .toBe(true);
    };
    await tickBox('applyMinFeesOnAccountLevelFlagField');
    await tickBox('applyMaxFeesOnAccountLevelFlagField');
    await overlay.getByRole('button', { name: 'Confirm & Reload', exact: true }).click();
  });

  await test.step('ACCOUNT MIN and ACCOUNT MAX column headers appear in the grid', async () => {
    // ag-grid header text is uppercased via CSS — the column-def headerName
    // is "Account Min" / "Account Max", but the rendered text reads as
    // "ACCOUNT MIN" / "ACCOUNT MAX". Match case-insensitively.
    await expect(
      page.getByRole('columnheader', { name: /^ACCOUNT MIN$/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('columnheader', { name: /^ACCOUNT MAX$/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
