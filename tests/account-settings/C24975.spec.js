// @ts-check
/**
 * TestRail C24975 — TC002 Validate Password Expiration Notification Start
 * (Day 76)
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24975
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". The warning modal threshold is `PASSWORD_EXPIRATION_WARNING_DAYS = 14`
 * (Login/consts.js). At day 76 → 14 days remaining → the warning kicks in
 * for the first time. Verifies the notification text says "in 14 days".
 *
 * Unlike day 90 (C24974/C24984), the warning at day 76 IS dismissible
 * (Login.js sets `preventClose: !(passwordExpirationDays > 0)` and
 * `passwordExpirationDays === 14 > 0`), but C24975 only cares that the
 * notification appears.
 *
 * Isolation: provisions a throwaway GW Admin, ages its password row to
 * 76 days, drives the login, asserts the warning.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

test.setTimeout(120_000);

test('@pepi C24975 Password expiration notification starts at day 76 (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision a GW Admin with a 76-day-old password', async () => {
    admin = await createGwAdmin('pepiWarn14');
    expireUserPassword(admin.userId, 76);
  });

  await test.step('Login → Expiration warning shows "in 14 days"', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
    await expect(page.getByText(/Your password will expire in 14 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: /^Update Password$/ })).toBeVisible();
  });
});
