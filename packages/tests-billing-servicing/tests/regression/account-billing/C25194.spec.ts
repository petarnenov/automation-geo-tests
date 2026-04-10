/**
 * TestRail C25194 — Account: Billing Method - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25194
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Hybrid isolation pattern (same as C25193):
 *
 *   Phase 1 (admin write/read flow) → workerFirmAdminPage. Each
 *     worker gets its own dummy firm + admin + account, eliminating
 *     cross-worker races on the Billing Method field.
 *
 *   Phase 2 (non-admin Edit-button-hidden check) → tylerPage on
 *     firm 106. tyler has a Plimsoll-FP-specific restricted custom
 *     role that dummy-firm advisors cannot replicate. Read-only
 *     access cannot race under parallel load.
 *
 * The Billing Method combo (`billingMethodCd`) is the icon-only
 * variant (no typeAhead) with two options: "Electronic" and "Paper".
 * Dummy firms start with no billing method set (blank on the summary
 * card). The test toggles between the two values.
 *
 * Differences from the legacy spec (deliberate):
 *
 *   - Uses two distinct fixture-provided pages (workerFirmAdminPage
 *     in Phase 1, tylerPage in Phase 2) instead of a single page
 *     with clearCookies + relogin.
 *
 *   - Drives the form via the AccountBillingPage Page Object and
 *     its ComboBox component, not inline locators + setComboBoxValue.
 *
 *   - All identifiers come from `framework/data/constants`, not
 *     inline constants.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

const VALUE_A = 'Electronic';
const VALUE_B = 'Paper';

test('@regression @billing-servicing C25194 Account Billing Method - Admin and Non-Admin', async ({
  workerFirmAdminPage,
  workerFirm,
  tylerPage,
}) => {
  test.slow();

  const billing = new AccountBillingPage(workerFirmAdminPage);

  /** Which values to flip between — decided by the current state. */
  let firstValue: string;
  let secondValue: string;

  await test.step('Phase 1.1: change Billing Method', async () => {
    await billing.goto({ workerFirm });

    const current = await billing.getDisplayedBillingMethod();
    if (current === VALUE_A) {
      firstValue = VALUE_B;
      secondValue = VALUE_A;
    } else {
      firstValue = VALUE_A;
      secondValue = VALUE_B;
    }
    test.info().annotations.push({
      type: 'captured',
      description: `firmCd=${workerFirm.firmCd} current=${current} first=${firstValue} second=${secondValue}`,
    });

    await billing.openEditModal();
    await billing.billingMethod.setValue(firstValue);
    await billing.saveEditModal();

    // Q6 polling — post-save React Query cache lag.
    await expect
      .poll(async () => billing.getDisplayedBillingMethod(), { timeout: 15_000 })
      .toBe(firstValue);
  });

  await test.step('Phase 1.2: flip Billing Method to the other value', async () => {
    await billing.openEditModal();
    await billing.billingMethod.setValue(secondValue);
    await billing.saveEditModal();

    await expect
      .poll(async () => billing.getDisplayedBillingMethod(), { timeout: 15_000 })
      .toBe(secondValue);
  });

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    const billingPhase2 = new AccountBillingPage(tylerPage);
    await billingPhase2.goto({ static: 'arnold-delaney' });
    await expect(billingPhase2.editButton).toHaveCount(0);
  });
});
