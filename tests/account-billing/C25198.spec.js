// @ts-check
/**
 * TestRail C25198 — Account: Adjustment/Expiration Date - Percent [%] - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25198 (Run 175, label Pepi)
 *
 * Phase 1 (admin / tim106):
 *   - open Edit Billing Settings
 *   - if Advisor Billing has no adjustment yet, click "Add An Adjustment"
 *   - set Adjustment Type = "Percent [%]"
 *   - set the percent value
 *   - set Expiration Date via the calendar popup
 *   - Save → assert the Advisor billing summary card now shows the percent
 *     and expiration date
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - open the same Billing tab, assert no Edit Billing Settings button
 *
 * NOTE on test data accumulation: the qa3 form has no UI mechanism to remove
 * an Advisor billing adjustment once one has been saved (the "Add An
 * Adjustment" link is replaced by the inline form, and there is no remove
 * or "set to Inherit" control). The test is therefore written as an
 * idempotent UPDATE — every run sets the adjustment to a deterministic value,
 * which exercises the same form interactions whether or not a prior run
 * already left an adjustment in place. The Arnold, Delaney qa3 account is
 * therefore expected to permanently carry an Advisor billing adjustment after
 * this case has run at least once. C25199 (Amount) and this case alternate
 * the type each run.
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
  setReactNumericInput,
} = require('./_helpers');

const PERCENT_VALUE = '7';
const EXPIRATION_DATE = '06/15/2027';
// Card renders the percent as "7.00 %" across separate <StaticText> nodes,
// followed by "Exp. Date: 06/15/2027". The regex tolerates the formatting/spacing.
const EXPECTED_CARD_FRAGMENT = /7\.00\s*%[\s\S]*Exp\.\s*Date:\s*06\/15\/2027/;

test('@pepi C25198 Account Adjustment/Expiration Date - Percent', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);

  await test.step('Phase 1: admin sets Advisor billing Percent adjustment', async () => {
    await loginAsAdmin(context, page);
    await gotoAccountBilling(page);
    await openEditBillingSettings(page);

    // If no adjustment exists yet for Advisor billing, the "Add An Adjustment"
    // link sits inside the Advisor section. Click it; if the inline form is
    // already expanded (because a prior run saved an adjustment) the link is
    // gone and the click is a no-op.
    const addLink = page.locator('a', { hasText: 'Add An Adjustment' }).first();
    if (await addLink.count() && await addLink.isVisible()) {
      await addLink.click();
    }
    await expect(page.locator('#adviserBillingDiscountTypeDiv')).toBeVisible({
      timeout: 5000,
    });

    await setComboBoxValue(page, 'adviserBillingDiscountType', 'Percent [%]');
    await setReactNumericInput(page, 'adviserBillingDiscountAmountField', PERCENT_VALUE);
    await setReactDatePicker(
      page,
      page.locator('#adviserBillingDiscountDate'),
      EXPIRATION_DATE
    );
    await saveEditBillingSettings(page);

    // The Advisor billing card section should now show the new percent and date.
    const adviserCard = page
      .locator('section[data-key="adviserBillingSpecification"]')
      .locator('xpath=following-sibling::*')
      .first();
    // Easier: just look for the Adjustment label closest to the Advisor section.
    await expect(
      page.locator('section[data-content="fieldSet"]', {
        hasText: EXPECTED_CARD_FRAGMENT,
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
