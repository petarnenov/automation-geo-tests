/**
 * TestRail C25201 — Account: Commission Fee - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25201
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Hybrid isolation pattern:
 *
 *   Phase 1 (admin write/read) → workerFirmAdminPage. Toggles the
 *     Commission Fee between Yes and No.
 *
 *   Phase 2 (non-admin Edit-button-hidden) → tylerPage on firm 106.
 *
 * The Commission Fee combo (`commissionFreeFlag`) is the documented
 * exception that the framework's ComboBox class does NOT handle.
 * Its React onClick handler ignores JS-dispatched events — only a
 * real CDP-level click on `#commissionFreeFlagDiv` opens it. The
 * `setCommissionFee` helper below uses Playwright's native `.click()`
 * which fires a CDP mouse event, with a retry loop for robustness.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import type { Page } from '@playwright/test';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

/**
 * Open the commissionFreeFlag dropdown via a real CDP click, then
 * click the target option. Retry loop handles the case where the
 * first click doesn't open the dropdown.
 */
async function setCommissionFee(page: Page, value: 'Yes' | 'No'): Promise<void> {
  await page.locator('body').click({ position: { x: 0, y: 0 } });
  const option = page.locator(`[role="combo-box-list-item"]:text-is("${value}")`);
  await expect
    .poll(
      async () => {
        await page.locator('#commissionFreeFlagDiv').click();
        return await option.isVisible().catch(() => false);
      },
      { timeout: 5000, intervals: [100, 200, 400, 800] }
    )
    .toBe(true);
  await option.click();
}

test('@regression @billing-servicing C25201 Commission Fee - Admin and Non-Admin', async ({
  workerFirmAdminPage,
  workerFirm,
  tylerPage,
}) => {
  test.slow();

  const billing = new AccountBillingPage(workerFirmAdminPage);
  let testValue: 'Yes' | 'No';

  await test.step('Phase 1.1: change Commission Fee', async () => {
    await billing.goto({ workerFirm });

    const current = await billing.getDisplayedCommissionFee();
    testValue = current === 'Yes' ? 'No' : 'Yes';
    test.info().annotations.push({
      type: 'captured',
      description: `firmCd=${workerFirm.firmCd} original=${current} test=${testValue}`,
    });

    await billing.openEditModal();
    await setCommissionFee(workerFirmAdminPage, testValue);
    await billing.saveEditModal();

    await expect
      .poll(async () => billing.getDisplayedCommissionFee(), { timeout: 15_000 })
      .toBe(testValue);
  });

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    const billingPhase2 = new AccountBillingPage(tylerPage);
    await billingPhase2.goto({ static: 'arnold-delaney' });
    await expect(billingPhase2.editButton).toHaveCount(0);
  });
});
