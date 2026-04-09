// @ts-check
/**
 * TestRail C25194 — Account: Billing method - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25194 (Run 175, label Pepi)
 *
 * Phase 1 (admin / tim106):
 *   - capture the current Billing Method from the summary card
 *   - open Edit Billing Settings, change the combo to a different value, Save
 *   - assert the summary card shows the new value
 *   - cleanup: revert to the original
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - assert no Edit Billing Settings button on the same Billing tab
 *
 * The combo is `billingMethodCd` (no typeAhead variant — driven via the
 * setComboBoxValue React-props fallback). Available options are
 * "Electronic" and "Paper". The default value is empty (renders as "None"
 * on the summary card).
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

const VALUE_A = 'Electronic';
const VALUE_B = 'Paper';

// HYBRID isolation: Phase 1 uses workerFirm (race-free), Phase 2 stays on
// firm 106 + tyler (read-only check, no race). See C25193 for full rationale.
test('@pepi C25194 Account Billing method - Admin and Non-Admin', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  /** @type {string} */
  let firstValue;
  /** @type {string} */
  let secondValue;

  await test.step('Phase 1.1: change Billing Method', async () => {
    await loginAsWorkerFirmAdmin(context, page, workerFirm);
    await gotoWorkerFirmAccountBilling(page, workerFirm);

    // Read the currently displayed Billing Method to decide which direction
    // to flip in. The card text node sits as a sibling of the "Billing Method"
    // label. If the current value is one of the test values we flip to the
    // other; otherwise we go A then B.
    const current = (
      await page
        .locator('text=Billing Method')
        .first()
        .locator('xpath=following-sibling::*[1]')
        .innerText()
    ).trim();
    if (current === VALUE_A) {
      firstValue = VALUE_B;
      secondValue = VALUE_A;
    } else {
      firstValue = VALUE_A;
      secondValue = VALUE_B;
    }
    test.info().annotations.push({
      type: 'captured',
      description: `current=${current} first=${firstValue} second=${secondValue}`,
    });

    await openEditBillingSettings(page);
    await setComboBoxValue(page, 'billingMethodCd', firstValue);
    await saveEditBillingSettings(page);

    await expect(
      page.locator('text=Billing Method').first().locator('xpath=following-sibling::*[1]')
    ).toHaveText(firstValue, { timeout: 15_000 });
  });

  await test.step('Phase 1.2: flip Billing Method to the other test value', async () => {
    await openEditBillingSettings(page);
    await setComboBoxValue(page, 'billingMethodCd', secondValue);
    await saveEditBillingSettings(page);
    await expect(
      page.locator('text=Billing Method').first().locator('xpath=following-sibling::*[1]')
    ).toHaveText(secondValue, { timeout: 15_000 });
  });

  await test.step('Phase 2: non-admin tyler cannot see Edit Billing Settings', async () => {
    await loginAsNonAdmin(context, page);
    await gotoAccountBilling(page);
    await expect(page.getByRole('button', { name: 'Edit Billing Settings' })).toHaveCount(0);
  });
});
