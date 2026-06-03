// @ts-check
/**
 * TestRail C24985 — TC012 Validate Forgot Password Resets 90-Day Timer
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24985
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Verifies that the Forgot Password reset flow updates
 * `entity_pswd_change_tbl.change_date`, resetting the 90-day countdown
 * (same code path the forced UpdatePasswordModal uses, via
 * `UserManagerTrait.checkAndUpdatePasswordForUser`).
 *
 * Flow shortcut: real Forgot Password is `/react/lostPassword.do` →
 * email with `<base>/changePassword.do?id=<UUID>`. Test envs don't
 * deliver email, so we INSERT the USER_LINK_TBL row directly (same row
 * `UserHibernateDAO.createUserLink` would have made) and navigate to the
 * JSP reset form. The reset form is independent of the modal stack:
 * action `com.geowealth.web.common.action.ChangePasswordAction` reads
 * pass1/pass2 from POST and updates the password.
 *
 * Isolation: throwaway GW Admin with password aged to 91 days. The link
 * row is consumed by the action (single-use).
 */

const { test, expect } = require('@playwright/test');
const {
  createGwAdmin,
  expireUserPassword,
  createLostPasswordLink,
  getLastPasswordChangeMs,
} = require('../_helpers/qa3');

const NEW_PASSWORD = 'NewPass123!';

test.setTimeout(180_000);

test('@pepi C24985 Forgot Password resets the 90-day timer (UI smoke + DB)', async ({
  page,
  context,
}) => {
  let admin;
  let expiredAtMs;
  let linkUUID;

  await test.step('Provision an expired GW Admin', async () => {
    admin = await createGwAdmin('pepiForgot');
    expireUserPassword(admin.userId, 91);
    expiredAtMs = getLastPasswordChangeMs(admin.userId);
    expect(expiredAtMs).toBeLessThan(Date.now() - 80 * 24 * 60 * 60 * 1000);
  });

  await test.step('Seed a Forgot Password link (DB row from /react/lostPassword.do)', async () => {
    linkUUID = createLostPasswordLink(admin.userId);
    expect(linkUUID).toMatch(/^[A-F0-9]{32}$/);
  });

  await test.step('Open the reset URL and submit a new password', async () => {
    await context.clearCookies();
    await page.goto(`/changePassword.do?id=${linkUUID}`);
    // JSP form — plain <input type="password" name="pass1|pass2">.
    const pass1 = page.locator('input[name="pass1"]');
    const pass2 = page.locator('input[name="pass2"]');
    await expect(pass1).toBeVisible({ timeout: 30_000 });
    await pass1.fill(NEW_PASSWORD);
    await pass2.fill(NEW_PASSWORD);
    // The visible submit button is intentionally hidden in the JSP — the
    // page comment says "Hidden submit button to allow form submit by
    // hitting Enter." Press Enter inside pass2 to submit naturally.
    await Promise.all([
      page.waitForLoadState('load', { timeout: 30_000 }),
      pass2.press('Enter'),
    ]);
  });

  await test.step('DB: password_last_changed is current (90-day timer reset)', async () => {
    const newChangeMs = getLastPasswordChangeMs(admin.userId);
    expect(newChangeMs).not.toBeNull();
    // Moved past the original 91-day-old row.
    expect(newChangeMs).toBeGreaterThan(expiredAtMs);
    // Within the recent ~48h window (DAY-precision DB + timezone slack;
    // see C24978 for the rationale).
    const nowMs = Date.now();
    expect(newChangeMs).toBeGreaterThan(nowMs - 48 * 60 * 60 * 1000);
    expect(newChangeMs).toBeLessThanOrEqual(nowMs + 60 * 60 * 1000);
  });
});
