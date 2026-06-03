// @ts-check
/**
 * TestRail C24974 — TC001 Validate 90-Day Password Expiration - 0 days left
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24974
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Verifies the fundamental contract on day 90:
 *
 *   - Login is BLOCKED — user does not reach the dashboard.
 *   - User IS prompted to reset the password (ExpirationWarningModal).
 *
 * Per the TestRail steps: set password_last_changed in DB to 91 days ago →
 * attempt login with correct credentials → expected: login blocked + reset
 * prompt. Companion tests in the same section drill into details:
 *   - C24984 — the modal cannot be dismissed
 *   - C24988 — submitting a valid new password unlocks the account
 *
 * Isolation: provisions a throwaway GW Admin per test, ages its password
 * row in entity_pswd_change_tbl. Does not change the password.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

test.setTimeout(120_000);

test('@pepi C24974 90-Day Password Expiration - 0 days left blocks login (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision a GW Admin with a 91-day-old password', async () => {
    admin = await createGwAdmin('pepiExpired0');
    expireUserPassword(admin.userId);
  });

  await test.step('Login with correct credentials', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
  });

  await test.step('User is prompted to reset the password (login blocked)', async () => {
    // The "in 0 days" warning is the prompt; its presence implies the
    // server accepted the credentials BUT the front-end has redux-flagged
    // the session as EXPIRED (LoggedUserJTO.objectType=EXPIRED). The
    // user lands on the login page with the modal layered on top —
    // dashboard is never reached.
    await expect(page.getByText(/Your password will expire in 0 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: /^Update Password$/ })).toBeVisible();
    // Login is blocked: URL must NOT reflect a successful dashboard handoff.
    await expect(page).not.toHaveURL(/#\/?(dashboard|platformOne)/);
  });
});
