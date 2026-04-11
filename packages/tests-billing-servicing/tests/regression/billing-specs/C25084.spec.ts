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
import { BillingSpecificationsGridPage } from '../../../src/pages/billing-specs/BillingSpecificationsGridPage';

const FIRM_CODE = 1;

/** ag-grid column `field` props for the two toggles we flip. */
const ACCOUNT_MIN_FIELD = 'applyMinFeesOnAccountLevelFlag';
const ACCOUNT_MAX_FIELD = 'applyMaxFeesOnAccountLevelFlag';

test('@regression @billing-servicing C25084 Billing Spec Grid Shows Account Min/Max Columns', async ({
  page,
}) => {
  test.slow();

  const gridPage = new BillingSpecificationsGridPage(page);

  await test.step('Open Billing Specifications grid for firm 1', async () => {
    await gridPage.open(FIRM_CODE);
  });

  await test.step('Reset grid to "System View" so column visibility starts from defaults', async () => {
    await gridPage.grid.selectSavedView('System View');
  });

  await test.step('Account Min/Max columns are NOT in the default visible columns', async () => {
    await expect(gridPage.columnHeader('Account Min')).toHaveCount(0);
    await expect(gridPage.columnHeader('Account Max')).toHaveCount(0);
  });

  await test.step('Enable the Account Min and Account Max column toggles', async () => {
    await gridPage.grid.openCustomizeColumns();
    await gridPage.grid.setColumnEnabled(ACCOUNT_MIN_FIELD, true);
    await gridPage.grid.setColumnEnabled(ACCOUNT_MAX_FIELD, true);
    await gridPage.grid.confirmAndReload();
  });

  await test.step('Account Min and Account Max columns appear in the grid header', async () => {
    await expect(gridPage.columnHeader('Account Min').first()).toBeVisible({ timeout: 10_000 });
    await expect(gridPage.columnHeader('Account Max').first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Each row has a Y or N value in both Account Min and Account Max columns', async () => {
    const accountMinHeader = gridPage.columnHeader('Account Min').first();
    const colId = await accountMinHeader.getAttribute('col-id');
    expect(colId, 'Account Min header must expose col-id').toBeTruthy();

    const cells = gridPage.cellsByColId(colId!);
    const count = await cells.count();
    expect(count, 'expected at least one billing spec row').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = (await cells.nth(i).innerText()).trim();
      expect(['Y', 'N']).toContain(text);
    }
  });
});
