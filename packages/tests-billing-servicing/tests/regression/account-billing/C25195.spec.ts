/**
 * TestRail C25195 — Account: Account for Billing - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25195
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Hybrid isolation pattern (same as C25193/C25194):
 *
 *   Phase 1 (admin write/read flow) → workerFirmAdminPage. The
 *     worker firm's client has 2+ accounts; the test toggles the
 *     "Auto Select Billing Account to Bill" combo between them.
 *
 *   Phase 2 (non-admin Edit-button-hidden check) → tylerPage on
 *     firm 106. Read-only, no race.
 *
 * The combo is `autoSelectClientAccount` (icon-only variant, no
 * typeAhead). Options are the client's accounts rendered as
 * "{title} ({num})". Dummy firm accounts are named by their account
 * number, so the option text becomes "{num} ({num})".
 *
 * Differences from the legacy spec (deliberate):
 *
 *   - Uses two distinct fixture-provided pages instead of
 *     clearCookies + relogin.
 *
 *   - Drives the form via AccountBillingPage + ComboBox component.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

test('@regression @billing-servicing C25195 Account for Billing - Admin and Non-Admin', async ({
  workerFirmAdminPage,
  workerFirm,
  tylerPage,
}) => {
  test.slow();

  if (workerFirm.accounts.length < 2) {
    throw new Error(
      `C25195 needs at least 2 accounts on the worker firm's client; got ${workerFirm.accounts.length}`
    );
  }

  const formatOption = (a: { title: string; num: string }) => `${a.title} (${a.num})`;
  const ACCOUNT_A = formatOption(workerFirm.accounts[0]);
  const ACCOUNT_B = formatOption(workerFirm.accounts[1]);

  const billing = new AccountBillingPage(workerFirmAdminPage);

  let firstValue: string;
  let secondValue: string;

  await test.step('Phase 1.1: change Account for Billing', async () => {
    await billing.goto({ workerFirm });

    const current = await billing.getDisplayedAccountForBilling();
    if (current === ACCOUNT_A) {
      firstValue = ACCOUNT_B;
      secondValue = ACCOUNT_A;
    } else {
      firstValue = ACCOUNT_A;
      secondValue = ACCOUNT_B;
    }
    test.info().annotations.push({
      type: 'captured',
      description: `firmCd=${workerFirm.firmCd} current=${current} first=${firstValue} second=${secondValue}`,
    });

    await billing.openEditModal();
    await billing.accountForBilling.setValue(firstValue);
    await billing.saveEditModal();

    await expect
      .poll(async () => billing.getDisplayedAccountForBilling(), { timeout: 15_000 })
      .toBe(firstValue);
  });

  await test.step('Phase 1.2: flip Account for Billing to the other value', async () => {
    await billing.openEditModal();
    await billing.accountForBilling.setValue(secondValue);
    await billing.saveEditModal();

    await expect
      .poll(async () => billing.getDisplayedAccountForBilling(), { timeout: 15_000 })
      .toBe(secondValue);
  });

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    const billingPhase2 = new AccountBillingPage(tylerPage);
    await billingPhase2.goto({ static: 'arnold-delaney' });
    await expect(billingPhase2.editButton).toHaveCount(0);
  });
});
