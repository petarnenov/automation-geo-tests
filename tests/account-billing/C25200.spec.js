// @ts-check
/**
 * TestRail C25200 — Account: Advisor Split/Inactive Date - Create - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25200 (Run 175, label Pepi)
 *
 * Phase 1 (admin / tim106):
 *   - open Edit Billing Settings
 *   - change Advisor Billing Spec to a non-Inherit value (this is a hard
 *     prerequisite — the Advisor Entity Split section's Active/Inactive Date
 *     pickers stay non-interactive when the bucket spec is "Inherit from …",
 *     even though the date picker's data-disabled attribute reads "false").
 *     This is qa3 product behaviour, not a test bug.
 *   - select an Advisor Entity Split via the comboBox typeAhead
 *   - set Active Date and Inactive Date via the calendar popup
 *   - Save → assert the Advisor Split summary card now shows the chosen
 *     split and inactive date
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - assert no Edit Billing Settings button on the same Billing tab
 *
 * NOTE on test data accumulation: same as C25198/C25199 — once an Advisor
 * Split is set and a non-Inherit Advisor Billing Spec is chosen, the form
 * has no UI mechanism to clear them. The test is therefore an idempotent
 * CREATE-OR-UPDATE that always sets the split to the same value. C25249
 * (Update) immediately follows in alphabetical order and overwrites the
 * inactive date with a different value to exercise the update path.
 *
 * Plimsoll firm 106 has exactly one available split option for this account:
 * "77.5% Ruffing/22.5% Rawal".
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsAdmin,
  loginAsNonAdmin,
  gotoAccountBilling,
  openEditBillingSettings,
  saveEditBillingSettings,
  setReactDatePicker,
  setComboBoxValue,
} = require('./_helpers');

const ADVISOR_SPEC = '55 BPS';
const SPLIT_OPTION = '77.5% Ruffing/22.5% Rawal';
const ACTIVE_DATE = '01/05/2024';
const INACTIVE_DATE = '12/31/2030';

test('@pepi C25200 Account Advisor Split - Create', async ({ page, context }) => {
  test.setTimeout(240_000);

  await test.step('Phase 1: admin sets Advisor Entity Split', async () => {
    await loginAsAdmin(context, page);
    await gotoAccountBilling(page);
    await openEditBillingSettings(page);

    // Prerequisite: Advisor Billing Spec must be non-Inherit so the Advisor
    // Entity Split section's date pickers become interactive.
    await setComboBoxValue(page, 'adviserBillingSpecification', ADVISOR_SPEC);

    await setComboBoxValue(page, 'billingAdvisorSplit', SPLIT_OPTION);
    await setReactDatePicker(
      page,
      page.locator('#billingAdvisorSplitActiveDate'),
      ACTIVE_DATE
    );
    await setReactDatePicker(
      page,
      page.locator('#billingAdvisorSplitInactiveDate'),
      INACTIVE_DATE
    );
    await saveEditBillingSettings(page);

    // Card "Advisor Split" row should now show the split label, and "Inactive Date"
    // row should show the new inactive date.
    await expect(
      page.locator('section[data-content="fieldSet"]', {
        hasText: SPLIT_OPTION,
      })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('section[data-content="fieldSet"]', {
        hasText: '12/31/2030',
      })
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Phase 2: non-admin tyler cannot see Edit Billing Settings', async () => {
    await loginAsNonAdmin(context, page);
    await gotoAccountBilling(page);
    await expect(
      page.getByRole('button', { name: 'Edit Billing Settings' })
    ).toHaveCount(0);
  });
});
