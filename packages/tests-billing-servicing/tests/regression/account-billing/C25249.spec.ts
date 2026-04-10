/**
 * TestRail C25249 — Account: Advisor Split/Inactive Date - Update - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25249
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Update counterpart to C25200. Assumes an Advisor Split already
 * exists on the Arnold/Delaney account (left there by C25200, which
 * always runs first in alphabetical order). The test changes the
 * Inactive Date to a different value and verifies the summary card.
 *
 * Both phases run on firm 106 — same rationale as C25200 (dummy
 * firms lack billing specs and advisor splits).
 *
 *   Phase 1 (admin) → tim106Page.
 *   Phase 2 (non-admin) → tylerPage.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

const NEW_INACTIVE_DATE = '06/30/2031';

test('@regression @billing-servicing C25249 Advisor Split - Update - Admin and Non-Admin', async ({
  tim106Page,
  tylerPage,
}) => {
  test.slow();

  const billing = new AccountBillingPage(tim106Page);

  await test.step('Phase 1: admin updates Advisor Split Inactive Date', async () => {
    await billing.goto({ static: 'arnold-delaney' });
    await billing.openEditModal();

    // C25200 should have left a split in place. The Inactive Date
    // picker is already populated and enabled.
    await billing.advisorSplitInactiveDate.setValue(NEW_INACTIVE_DATE);
    await billing.saveEditModal();

    await expect(
      tim106Page.locator('section[data-content="fieldSet"]', {
        hasText: NEW_INACTIVE_DATE,
      })
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    const billingPhase2 = new AccountBillingPage(tylerPage);
    await billingPhase2.goto({ static: 'arnold-delaney' });
    await expect(billingPhase2.editButton).toHaveCount(0);
  });
});
