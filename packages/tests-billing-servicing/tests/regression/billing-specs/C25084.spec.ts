/**
 * TestRail C25084 — Billing Spec Grid Shows Account Min/Max Columns
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25084
 *         (Run 175, label Pepi)
 *
 * Read-only: toggles Account Min/Max column visibility in the
 * Billing Specifications grid for firm 1 and verifies the columns
 * appear with Y/N values. Never modifies billing spec data.
 *
 * Uses the default `page` with tim1 storageState (GW admin).
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';

const FIRM_CODE = 1;
const SPECS_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_CODE}`;

test('@regression @billing-servicing C25084 Billing Spec Grid Shows Account Min/Max Columns', async ({
  page,
}) => {
  test.slow();

  await test.step('Navigate to Billing Specifications grid for firm 1', async () => {
    await page.goto(SPECS_URL);
    await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
  });

  await test.step('Reset grid to "System View" so column visibility starts from defaults', async () => {
    const savedViewsList = page.locator('#savedViewsList');
    await savedViewsList.click();
    await page.locator('a[data-type="listOption"][data-value="System View"]').click();
    await expect(savedViewsList).toContainText('View: System View', { timeout: 10_000 });
  });

  await test.step('Account Min/Max columns are NOT in the default visible columns', async () => {
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
    await overlay.locator('label[for="applyMinFeesOnAccountLevelFlagField"]').click();
    await overlay.locator('label[for="applyMaxFeesOnAccountLevelFlagField"]').click();
    await expect(overlay.locator('input#applyMinFeesOnAccountLevelFlagField')).toBeChecked();
    await expect(overlay.locator('input#applyMaxFeesOnAccountLevelFlagField')).toBeChecked();
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
    const accountMinHeader = page.getByRole('columnheader', { name: 'Account Min' }).first();
    const colId = await accountMinHeader.getAttribute('col-id');
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
