// @ts-check
/**
 * TestRail C25195 — Account: Account for Billing - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25195 (Run 175, label Pepi)
 *
 * Phase 1 (admin / tim106):
 *   - capture the current "Account for Billing" value from the summary card
 *   - open Edit, change the "Auto Select Billing Account to Bill" combo
 *     to a different account, Save
 *   - assert the summary card shows the new account
 *   - cleanup: revert
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - assert no Edit Billing Settings button on the same Billing tab
 *
 * The combo is `autoSelectClientAccount` (no typeAhead variant — driven via
 * the setComboBoxValue React-props fallback). For the qa3 Arnold, Delaney
 * client there are exactly two real accounts available:
 *   - "Arnold, Delaney (12287266)" (the default — same as the URL account)
 *   - "Arnold, Delaney (66629414)"
 * (plus the "Select account" placeholder, which we never pick).
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsWorkerFirmAdmin,
  loginAsNonAdmin,
  gotoWorkerFirmAccountBilling,
  gotoAccountBilling,
  openEditBillingSettings,
  saveEditBillingSettings,
  setComboBoxValue,
} = require('./_helpers');

// HYBRID isolation: Phase 1 uses workerFirm (race-free), Phase 2 stays on
// firm 106 + tyler (read-only check, no race). See C25193 for full rationale.
//
// Dropdown values are derived dynamically from the worker firm's auto-created
// accounts. Each dummy firm client has 2-3 accounts named accnum-YYYY...-N-M;
// the combo renders them as "{accountTitle} ({accountNum})" which for dummy
// firms boils down to "{num} ({num})" since title === num.
test('@pepi C25195 Account for Billing - Admin and Non-Admin', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  if (workerFirm.accounts.length < 2) {
    throw new Error(
      `C25195 needs at least 2 accounts on the worker firm's client; got ${workerFirm.accounts.length}`
    );
  }
  const formatOption = (a) => `${a.title} (${a.num})`;
  const ACCOUNT_A = formatOption(workerFirm.accounts[0]);
  const ACCOUNT_B = formatOption(workerFirm.accounts[1]);

  /** @type {string} */
  let firstValue;
  /** @type {string} */
  let secondValue;

  await test.step('Phase 1.1: change Account for Billing', async () => {
    await loginAsWorkerFirmAdmin(context, page, workerFirm);
    await gotoWorkerFirmAccountBilling(page, workerFirm);

    const current = (
      await page
        .locator('text=Account for Billing')
        .first()
        .locator('xpath=following-sibling::*[1]')
        .innerText()
    ).trim();
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

    await openEditBillingSettings(page);
    await setComboBoxValue(page, 'autoSelectClientAccount', firstValue);
    await saveEditBillingSettings(page);

    await expect(
      page.locator('text=Account for Billing').first().locator('xpath=following-sibling::*[1]')
    ).toHaveText(firstValue, { timeout: 15_000 });
  });

  await test.step('Phase 1.2: flip Account for Billing to the other test value', async () => {
    await openEditBillingSettings(page);
    await setComboBoxValue(page, 'autoSelectClientAccount', secondValue);
    await saveEditBillingSettings(page);
    await expect(
      page.locator('text=Account for Billing').first().locator('xpath=following-sibling::*[1]')
    ).toHaveText(secondValue, { timeout: 15_000 });
  });

  await test.step('Phase 2: non-admin tyler cannot see Edit Billing Settings', async () => {
    await loginAsNonAdmin(context, page);
    await gotoAccountBilling(page);
    await expect(page.getByRole('button', { name: 'Edit Billing Settings' })).toHaveCount(0);
  });
});
