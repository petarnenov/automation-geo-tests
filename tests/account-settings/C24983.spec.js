// @ts-check
/**
 * TestRail C24983 — TC010 Validate Notification Dismiss Option
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24983
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". The COMPLEMENT to C24984 — inside the 14-day warning
 * window (passwordExpirationDays > 0), the ExpirationWarningModal IS
 * dismissible. Login.js sets `preventClose: !(allowLoginOnClose)` where
 * `allowLoginOnClose = passwordExpirationDays > 0`. At day 80 (10 days
 * left) → preventClose=false → the header 'X' icon closes the modal and
 * the onClose handler flips setUserIsLoggedIn(true).
 *
 * Companions: C24984 verifies the modal CANNOT be dismissed at day 90.
 *
 * Isolation: throwaway GW Admin with password aged to 80 days.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

test.setTimeout(120_000);

test('@pepi C24983 Expiration notification is dismissible in warning window (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision a GW Admin with an 80-day-old password', async () => {
    admin = await createGwAdmin('pepiDismiss');
    expireUserPassword(admin.userId, 80);
  });

  // "in 10 days" confirms we're inside the dismissible warning branch and
  // not the forced-reset branch (which would say "in 0 days").
  const warningText = page.getByText(/Your password will expire in 10 days/i);

  await test.step('Login → ExpirationWarningModal appears', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
    await expect(warningText).toBeVisible({ timeout: 30_000 });
  });

  await test.step("Clicking the header 'X' dismisses the notification", async () => {
    const closeIcon = page.locator('[data-icon="circle_close_btn"]').first();
    await expect(closeIcon).toBeVisible();
    await closeIcon.click();
    await expect(warningText).toBeHidden({ timeout: 5000 });
  });
});
