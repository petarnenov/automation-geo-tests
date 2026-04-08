// @ts-check
/**
 * TestRail C25199 — Account: Adjustment/Expiration Date - Amount [$] - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25199 (Run 175, label Pepi)
 *
 * Mirror of C25198 but exercises the Amount [$] adjustment type instead of
 * Percent. See C25198.spec.js for the rationale on idempotent updates and
 * test data accumulation.
 *
 * IMPORTANT: this case shares the Arnold, Delaney qa3 account with C25198.
 * The two cases run sequentially in alphabetical order, so C25199 always
 * sees the Percent adjustment that C25198 just left in place and overwrites
 * it with an Amount adjustment. This is intentional — both flows are exercised
 * end-to-end every run.
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsWorkerFirmAdmin,
  loginAsNonAdmin,
  gotoWorkerFirmAccountBilling,
  gotoAccountBilling,
  openEditBillingSettings,
  saveEditBillingSettings,
  setReactDatePicker,
  setComboBoxValue,
  setReactNumericInput,
} = require('./_helpers');

const AMOUNT_VALUE = '125';
const EXPIRATION_DATE = '07/20/2027';
// Card renders the amount as "$125.00" followed by " Exp. Date: 07/20/2027".
const EXPECTED_CARD_FRAGMENT = /\$\s*125\.00[\s\S]*Exp\.\s*Date:\s*07\/20\/2027/;

// HYBRID isolation: Phase 1 uses workerFirm (race-free), Phase 2 stays on
// firm 106 + tyler (read-only check, no race). See C25193 for full rationale.
test('@pepi C25199 Account Adjustment/Expiration Date - Amount', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  await test.step('Phase 1: admin sets Advisor billing Amount adjustment', async () => {
    await loginAsWorkerFirmAdmin(context, page, workerFirm);
    await gotoWorkerFirmAccountBilling(page, workerFirm);
    await openEditBillingSettings(page);

    const addLink = page.locator('a', { hasText: 'Add An Adjustment' }).first();
    if ((await addLink.count()) && (await addLink.isVisible())) {
      await addLink.click();
    }
    await expect(page.locator('#adviserBillingDiscountTypeDiv')).toBeVisible({
      timeout: 5000,
    });

    await setComboBoxValue(page, 'adviserBillingDiscountType', 'Amount [$]');
    await setReactNumericInput(page, 'adviserBillingDiscountAmountField', AMOUNT_VALUE);
    await setReactDatePicker(
      page,
      page.locator('#adviserBillingDiscountDate'),
      EXPIRATION_DATE
    );
    await saveEditBillingSettings(page);

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
