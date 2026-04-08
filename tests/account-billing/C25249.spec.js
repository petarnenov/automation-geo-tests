// @ts-check
/**
 * TestRail C25249 — Account: Advisor Split/Inactive Date - Update - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25249 (Run 175, label Pepi)
 *
 * Update counterpart to C25200. Assumes an Advisor Split already exists on
 * the Arnold, Delaney qa3 account (left there by C25200, which always runs
 * first in alphabetical order). The test changes the Inactive Date to a
 * different value and verifies the summary card.
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsAdmin,
  loginAsNonAdmin,
  gotoAccountBilling,
  openEditBillingSettings,
  saveEditBillingSettings,
  setReactDatePicker,
} = require('./_helpers');

const NEW_INACTIVE_DATE = '06/30/2031';

test('@pepi C25249 Account Advisor Split - Update', async ({ page, context }) => {
  test.setTimeout(240_000);

  await test.step('Phase 1: admin updates Advisor Split Inactive Date', async () => {
    await loginAsAdmin(context, page);
    await gotoAccountBilling(page);
    await openEditBillingSettings(page);

    // C25200 should have left a split in place. The Inactive Date picker is
    // already populated and enabled — overwrite it with a new value.
    await setReactDatePicker(
      page,
      page.locator('#billingAdvisorSplitInactiveDate'),
      NEW_INACTIVE_DATE
    );
    await saveEditBillingSettings(page);

    await expect(
      page.locator('section[data-content="fieldSet"]', {
        hasText: NEW_INACTIVE_DATE,
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
