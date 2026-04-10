/**
 * TestRail C25198 — Account: Adjustment/Expiration Date - Percent [%] - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25198
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Hybrid isolation pattern:
 *
 *   Phase 1 (admin write/read) → workerFirmAdminPage. Sets the
 *     Adviser Billing Adjustment to "Percent [%]" with a deterministic
 *     value and expiration date.
 *
 *   Phase 2 (non-admin Edit-button-hidden check) → tylerPage on
 *     firm 106. Read-only, no race.
 *
 * The qa form has no UI to remove an adjustment once saved; the test
 * is written as an idempotent UPDATE — every run sets the adjustment
 * to the same deterministic value.
 *
 * Differences from the legacy spec (deliberate):
 *
 *   - Uses two distinct fixture-provided pages.
 *
 *   - Drives the form via AccountBillingPage POM + ComboBox +
 *     NumericInput + ReactDatePicker components.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

const PERCENT_VALUE = '7';
const EXPIRATION_DATE = '06/15/2027';
// Card renders "7.00 %" followed by "Exp. Date: 06/15/2027".
const EXPECTED_CARD_FRAGMENT = /7\.00\s*%[\s\S]*Exp\.\s*Date:\s*06\/15\/2027/;

test('@regression @billing-servicing C25198 Adjustment/Expiration Date - Percent - Admin and Non-Admin', async ({
  workerFirmAdminPage,
  workerFirm,
  tylerPage,
}) => {
  test.slow();

  const billing = new AccountBillingPage(workerFirmAdminPage);

  await test.step('Phase 1: admin sets Advisor billing Percent adjustment', async () => {
    await billing.goto({ workerFirm });
    await billing.openEditModal();
    await billing.ensureAdjustmentExpanded();

    await billing.adviserDiscountType.setValue('Percent [%]');
    await billing.adviserDiscountAmount.setValue(PERCENT_VALUE);
    await billing.adviserDiscountExpiration.setValue(EXPIRATION_DATE);
    await billing.saveEditModal();

    await expect(
      workerFirmAdminPage.locator('section[data-content="fieldSet"]', {
        hasText: EXPECTED_CARD_FRAGMENT,
      })
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    const billingPhase2 = new AccountBillingPage(tylerPage);
    await billingPhase2.goto({ static: 'arnold-delaney' });
    await expect(billingPhase2.editButton).toHaveCount(0);
  });
});
