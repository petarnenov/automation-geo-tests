/**
 * TestRail C25199 — Account: Adjustment/Expiration Date - Amount [$] - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25199
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Mirror of C25198 but exercises the Amount [$] adjustment type.
 * See C25198 for rationale on idempotent updates and test data
 * accumulation.
 *
 * Hybrid isolation pattern:
 *
 *   Phase 1 (admin write/read) → workerFirmAdminPage.
 *   Phase 2 (non-admin Edit-button-hidden) → tylerPage on firm 106.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

const AMOUNT_VALUE = '125';
const EXPIRATION_DATE = '07/20/2027';
// Card renders "$125.00" followed by "Exp. Date: 07/20/2027".
const EXPECTED_CARD_FRAGMENT = /\$\s*125\.00[\s\S]*Exp\.\s*Date:\s*07\/20\/2027/;

test('@regression @billing-servicing C25199 Adjustment/Expiration Date - Amount - Admin and Non-Admin', async ({
  workerFirmAdminPage,
  workerFirm,
  tylerPage,
}) => {
  test.slow();

  const billing = new AccountBillingPage(workerFirmAdminPage);

  await test.step('Phase 1: admin sets Advisor billing Amount adjustment', async () => {
    await billing.goto({ workerFirm });
    await billing.openEditModal();
    await billing.ensureAdjustmentExpanded();

    await billing.adviserDiscountType.setValue('Amount [$]');
    await billing.adviserDiscountAmount.setValue(AMOUNT_VALUE);
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
