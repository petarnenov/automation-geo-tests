/**
 * TestRail C24935 — Billing Specification - Edit Specification for a firm
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24935
 *         (Run 175, label Pepi)
 *
 * Read-only: navigates to Billing Specifications grid for firm 1,
 * hovers the first row, clicks the Edit icon, and verifies the edit
 * form opens. Never clicks Save / Delete / Copy.
 *
 * Uses the default `page` with tim1 storageState (GW admin).
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';

const FIRM_CODE = 1;
const SPECS_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_CODE}`;

test('@regression @billing-servicing C24935 Billing Specification - Edit Specification for a firm', async ({
  page,
}) => {
  test.slow();

  await test.step('Navigate to Billing Specifications grid for firm 1', async () => {
    await page.goto(SPECS_URL);
    await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  let firstRow: import('@playwright/test').Locator;
  await test.step('Wait for at least one billing spec row to render', async () => {
    firstRow = page.locator('.ag-row').first();
    await expect(firstRow).toBeVisible({ timeout: 60_000 });
  });

  await test.step('Hover the row and click the Edit icon', async () => {
    await firstRow.hover();
    const editIcon = page.locator('span[title="Edit"]').first();
    await expect(editIcon).toBeVisible({ timeout: 5_000 });
    await editIcon.click();
  });

  await test.step('Verify the edit form opened for that spec', async () => {
    await expect(page).toHaveURL(
      new RegExp(`#platformOne/billingCenter/specifications/${FIRM_CODE}/edit/`),
      { timeout: 30_000 }
    );
    await expect(
      page.getByRole('button', { name: 'Save Updates', exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
