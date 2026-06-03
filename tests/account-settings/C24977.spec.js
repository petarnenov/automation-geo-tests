// @ts-check
/**
 * TestRail C24977 — TC004 Validate Forced Password Reset on Day 90
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24977
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Boundary check at exactly 90 days old. Per
 * `NEntity.getPasswordExpirationDays()` the rule is `daysOld >= 90 → 0`,
 * so day 90 (this case) and day 91+ (C24974) both end up in the forced
 * reset branch and surface the same ExpirationWarningModal with the
 * Update Password CTA as the only forward action.
 *
 * Companions: C24974 sweeps day 91, C24984 verifies the modal cannot be
 * dismissed, C24988 drives the actual password submit.
 *
 * Isolation: provisions a throwaway GW Admin, ages the password row to
 * exactly 90 days. No password change.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

test.setTimeout(120_000);

test('@pepi C24977 Forced password reset on day 90 (UI smoke)', async ({ page, context }) => {
  let admin;

  await test.step('Provision a GW Admin with a 90-day-old password', async () => {
    admin = await createGwAdmin('pepiDay90');
    expireUserPassword(admin.userId, 90);
  });

  await test.step('Login → user blocked, forced reset prompt shown', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
    await expect(page.getByText(/Your password will expire in 0 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: /^Update Password$/ })).toBeVisible();
    // User cannot proceed: URL must not reflect a dashboard handoff.
    await expect(page).not.toHaveURL(/#\/?(dashboard|platformOne)/);
  });
});
