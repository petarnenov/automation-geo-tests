// @ts-check
/**
 * TestRail C26551 — Validate 90-Day Password Expiration: logging in with a
 * non-expired user after we tried logging in with an expired one
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26551
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Regression check: an expired-user prompt left behind in
 * the UI must NOT poison the next user's login. Steps:
 *   1. User A (expired) logs in → ExpirationWarningModal blocks them.
 *   2. Reload → login screen reappears.
 *   3. User B (fresh password) logs in → succeeds and reaches dashboard,
 *      no expiry modal.
 *
 * Isolation: provisions two throwaway GW Admins per test; only User A's
 * password row is aged. Neither account is mutated further.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

test.setTimeout(180_000);

test('@pepi C26551 Login as fresh user after expired user attempted (UI smoke)', async ({
  page,
  context,
}) => {
  let userA;
  let userB;

  await test.step('Provision User A (expired) and User B (fresh)', async () => {
    userA = await createGwAdmin('pepiExpA');
    expireUserPassword(userA.userId);
    userB = await createGwAdmin('pepiFreshB');
  });

  await test.step('User A login is blocked with reset prompt', async () => {
    await context.clearCookies();
    await login(page, userA.username, userA.password);
    await expect(page.getByText(/Your password will expire in 0 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: /^Update Password$/ })).toBeVisible();
  });

  await test.step('Reload → Login screen is shown again', async () => {
    await page.reload();
    // Front-end resets isUserLoggedIn on reload, so even though User A's
    // session cookie persists in the browser, Login.js renders the login
    // form again. The login inputs must be reachable for Step 3.
    await expect(page.getByPlaceholder(/email|username/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
  });

  await test.step('User B login succeeds → dashboard, no expiry modal', async () => {
    await page.getByPlaceholder(/email|username/i).fill(userB.username);
    await page.getByPlaceholder(/password/i).fill(userB.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
    await expect(page.getByText(/Your password will expire in 0 days/i)).toBeHidden();
  });
});
