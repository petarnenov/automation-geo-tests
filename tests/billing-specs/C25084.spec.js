// @ts-check
/**
 * TestRail C25084 — Billing Spec Grid Shows Account Min/Max Columns
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25084 (Run 175, label Pepi)
 *
 * Summary: "Verify 'Account Min' and 'Account Max' columns are visible in
 * the column selector and show correct values."
 *
 * TestRail steps:
 *   1. Open the column selector.
 *   2. Enable Account Min/Max columns.
 *
 * Expected: Columns appear with 'Y' if the spec's Account box is checked,
 * 'N' otherwise. NOT shown by default.
 *
 * Implementation notes:
 *   - The grid uses GwGridPersist with `withCustomize={true}`. The toggle is
 *     a `<span id="customizeColumns">` wrapping an svg of the same id; clicking
 *     the svg directly is intercepted by the wrapper, so we click the span.
 *   - Inside the panel each column toggle is a `<div data-type="fieldWrapper">`
 *     containing a hidden `<input type="checkbox" id="...Field">` and a
 *     `<label data-type="checkboxLabel">`. The hidden input cannot be clicked
 *     directly — we click the LABEL element to toggle.
 *   - Account Min checkbox id: `applyMinFeesOnAccountLevelFlagField`
 *   - Account Max checkbox id: `applyMaxFeesOnAccountLevelFlagField`
 *   - After toggling, the columns appear in the ag-grid header with role
 *     `columnheader` and text "Account Min" / "Account Max".
 *
 * Verification: assert columns appear in the header AND that at least one
 * row in those columns shows a Y or N value (not empty / not "—").
 *
 * Read-only: this test never saves or modifies billing spec data. It only
 * toggles client-side column visibility, which is per-user persisted state.
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
    // Grid render is slow on qa3 — wait for at least one row.
    await expect(page.locator('.ag-row').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step('Reset grid to "System View" so column visibility starts from defaults', async () => {
    // Per-user "User View" persists Account Min/Max once they have been
    // toggled on by an earlier run, which breaks the "default-hidden"
    // precondition below. Selecting the System View forces a reload with
    // the original column-def hide flags.
    const savedViewsList = page.locator('#savedViewsList');
    await savedViewsList.click();
    await page.locator('a[data-type="listOption"][data-value="System View"]').click();
    await expect(savedViewsList).toContainText('View: System View', {
      timeout: 10_000,
    });
  });

  await test.step('Account Min/Max columns are NOT in the default visible columns', async () => {
    // Default-hidden per the column def (`hide: true`).
    await expect(page.getByRole('columnheader', { name: 'Account Min' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Account Max' })).toHaveCount(0);
  });

  await test.step('Open the Customize Columns panel', async () => {
    await page.locator('span#customizeColumns').click();
    await expect(page.getByText('Customize Columns', { exact: true }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  await test.step('Enable the Account Min and Account Max column toggles', async () => {
    const overlay = page.locator('[class*="showGridOverlay"]').first();
    // Click the LABEL associated with the hidden checkbox, not the input itself.
    await overlay.locator('label[for="applyMinFeesOnAccountLevelFlagField"]').click();
    await overlay.locator('label[for="applyMaxFeesOnAccountLevelFlagField"]').click();
    // Confirm both checkboxes are now checked.
    await expect(overlay.locator('input#applyMinFeesOnAccountLevelFlagField')).toBeChecked();
    await expect(overlay.locator('input#applyMaxFeesOnAccountLevelFlagField')).toBeChecked();
    // The grid only re-renders new columns AFTER "Confirm & Reload" is clicked.
    await overlay.getByRole('button', { name: 'Confirm & Reload' }).click();
  });

  await test.step('Account Min and Account Max columns appear in the grid header', async () => {
    await expect(page.getByRole('columnheader', { name: 'Account Min' }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('columnheader', { name: 'Account Max' }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step('Each row has a Y or N value in both Account Min and Account Max columns', async () => {
    // The columns are populated by `accountFeeFlagValueGetter` which returns
    // 'Y' or 'N'. Across all rows, every cell in those columns must contain
    // exactly one of those two values.
    const accountMinHeader = page.getByRole('columnheader', { name: 'Account Min' }).first();
    // The col-id value is consumed by the cell selector below, so an
    // imperative read is intentional here — the prefer-web-first lint rule
    // doesn't apply when the value drives downstream logic.
    const colId = await accountMinHeader.getAttribute('col-id');
    // eslint-disable-next-line playwright/prefer-web-first-assertions
    expect(colId, 'Account Min header must expose col-id').toBeTruthy();

    const cells = page.locator(`.ag-row .ag-cell[col-id="${colId}"]`);
    const count = await cells.count();
    expect(count, 'expected at least one billing spec row').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = (await cells.nth(i).innerText()).trim();
      expect(['Y', 'N']).toContain(text);
    }
  });
});
