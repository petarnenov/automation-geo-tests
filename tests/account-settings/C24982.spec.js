// @ts-check
/**
 * TestRail C24982 — TC009 Validate Notification on Login
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24982
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Inside the 14-day warning window (day 80 → 10 days
 * remaining), the ExpirationWarningModal must show up immediately on
 * login — driven by Login.js componentDidUpdate firing showModalById as
 * soon as passwordExpirationDays ≤ PASSWORD_EXPIRATION_WARNING_DAYS.
 *
 * Companions: C24975 covers the start of the window at day 76 (14 days
 * left), C24976 sweeps the full 76→89 range. C24982 specifically asserts
 * the immediate-on-login behaviour mid-window.
 *
 * Isolation: throwaway GW Admin, password row aged to 80 days.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

test.setTimeout(120_000);

test('@pepi C24982 Expiration notification shows immediately on login (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision a GW Admin with an 80-day-old password', async () => {
    admin = await createGwAdmin('pepiNotifLogin');
    expireUserPassword(admin.userId, 80);
  });

  await test.step('Login → notification shows immediately', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
    await expect(page.getByText(/Your password will expire in 10 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: /^Update Password$/ })).toBeVisible();
  });
});
