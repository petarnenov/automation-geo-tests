// @ts-check
/**
 * TestRail C24976 — TC003 Validate Notification Continues Until Expiration
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24976
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Verifies that for every day in the warning window
 * (passwordExpirationDays 14 → 1, i.e. password age 76 → 89) the login
 * surfaces the ExpirationWarningModal with the correct countdown text.
 *
 * Companions: C24975 covers day 76 (warning start); this case sweeps the
 * whole interior of the window.
 *
 * Performance: provisions ONE GW Admin and updates its ENTITY_PSWD_CHANGE_TBL
 * row 14 times rather than creating 14 fresh admins. Each iteration:
 * clearCookies → re-age the row → login → assert. ~5–7s per iteration on
 * qa4 means ~90s total; raised timeout accordingly.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

test.setTimeout(300_000);

test('@pepi C24976 Expiration notification countdown days 76 to 89 (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision a single throwaway GW Admin', async () => {
    admin = await createGwAdmin('pepiCountdown');
  });

  for (let daysAgo = 76; daysAgo <= 89; daysAgo++) {
    const daysLeft = 90 - daysAgo;

    await test.step(`Day ${daysAgo}: warning shows "in ${daysLeft} days"`, async () => {
      await context.clearCookies();
      expireUserPassword(admin.userId, daysAgo);
      await login(page, admin.username, admin.password);
      await expect(
        page.getByText(new RegExp(`Your password will expire in ${daysLeft} days`, 'i'))
      ).toBeVisible({ timeout: 30_000 });
    });
  }
});
