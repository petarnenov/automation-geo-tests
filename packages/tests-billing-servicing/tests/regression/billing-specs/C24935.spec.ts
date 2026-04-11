/**
 * TestRail C24935 — Billing Specification - Edit Specification for a firm
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24935
 *         (Run 175, label Pepi)
 *
 * Read-only: navigates to Billing Specifications grid for firm 1,
 * hovers the first row, clicks the Edit icon, verifies the edit form
 * opens. Never clicks Save / Delete / Copy.
 *
 * Uses the default `page` with tim1 storageState (GW admin) — the
 * billing specs route is firm-1-scoped and requires gwAdminFlag.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { BillingSpecificationsGridPage } from '../../../src/pages/billing-specs/BillingSpecificationsGridPage';

const FIRM_CODE = 1;

test('@regression @billing-servicing C24935 Billing Specification - Edit Specification for a firm', async ({
  page,
}) => {
  test.slow();

  const gridPage = new BillingSpecificationsGridPage(page);

  await test.step('Open Billing Specifications grid for firm 1', async () => {
    await gridPage.open(FIRM_CODE);
    await expect(gridPage.heading()).toBeVisible();
  });

  await test.step('Hover the first row and click Edit', async () => {
    await gridPage.editRowByIndex(0);
  });

  await test.step('Verify the edit form opened for that spec', async () => {
    await gridPage.waitForEditFormLoaded(FIRM_CODE);
    await expect(gridPage.saveUpdatesButton()).toBeVisible();
  });
});
