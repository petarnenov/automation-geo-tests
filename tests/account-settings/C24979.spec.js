// @ts-check
/**
 * TestRail C24979 — TC006 Password Change Flow Validation
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24979
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Preconditions describe a user "logged in with an
 * expiring password" — i.e. inside the 14-day warning window — who
 * proactively clicks Update Password and completes the change. Steps:
 *   1. Trigger notification pop-up.
 *   2. Click 'Update password'.
 *   3. Enter current, new, confirm passwords.
 *   4. Submit. Expected: password updated, confirmation shown.
 *
 * This differs from C24988 (TC015) which validates the forced-reset path
 * at day 91+; here the password is set to 80 days old (10 days remaining)
 * so the warning modal appears but is dismissible. The user opts to
 * change anyway.
 *
 * Isolation: throwaway GW Admin, ages password row to 80 days, drives
 * the full flow once. No shared cleanup.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

const NEW_PASSWORD = 'NewPass123!';
const UPDATE_PASSWORD_URL = '/react/updatePassword.do';

test.setTimeout(180_000);

test('@pepi C24979 Password change flow from notification (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision a GW Admin with an expiring password (10 days left)', async () => {
    admin = await createGwAdmin('pepiFlow');
    expireUserPassword(admin.userId, 80);
  });

  await test.step('Login → notification pop-up appears', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
    await expect(page.getByText(/Your password will expire in 10 days/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('Click "Update Password" → UpdatePasswordModal opens', async () => {
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expect(page.locator('#oldPasswordField')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Enter current, new, confirm passwords → submit', async () => {
    // See C24988 + [[formbuilder-password-modal]] memory: real keystrokes
    // (pressSequentially) drive the full React chain so confirmPassword
    // becomes enabled and FormBuilder's isFormValid commits.
    const fillPassword = async (selector, value) => {
      const input = page.locator(selector);
      await expect(input).toBeEnabled({ timeout: 5000 });
      await input.click();
      await input.pressSequentially(value, { delay: 50 });
    };

    await fillPassword('#oldPasswordField', admin.password);
    await fillPassword('#newPasswordField', NEW_PASSWORD);
    await fillPassword('#confirmPasswordField', NEW_PASSWORD);

    // Debounced validateFormFields (50ms) must commit isFormValid = true
    // before we click, otherwise the submit guard fires silently.
    await page.waitForFunction(
      () => {
        const input = document.querySelector('#oldPasswordField');
        if (!input) return false;
        const fk = Object.keys(input).find((k) => k.startsWith('__reactFiber'));
        let f = input[fk];
        while (f && !(f.stateNode && f.stateNode.state && 'isFormValid' in f.stateNode.state)) {
          f = f.return;
        }
        return f ? f.stateNode.state.isFormValid === true : false;
      },
      null,
      { timeout: 5000 }
    );

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes(UPDATE_PASSWORD_URL) && r.request().method() === 'POST',
      { timeout: 30_000 }
    );
    await page.locator('[data-role="formSubmitButton"]').click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success ?? !body.error).toBeTruthy();
  });

  await test.step('Confirmation message shown', async () => {
    await expect(page.getByText(/Password updated successfully/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
