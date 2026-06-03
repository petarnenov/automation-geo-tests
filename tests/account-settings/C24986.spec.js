// @ts-check
/**
 * TestRail C24986 — TC013 Password Change - Mismatched New Passwords
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24986
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Client-side check: confirmPassword field has
 * `customValidation: (value) => value === newPassword` and a configured
 * `errorMessage: 'Passwords do not match'` (UpdatePasswordModal.js). When
 * the two new-password fields differ, confirmPassword.isValid stays false,
 * FormBuilder's isFormValid is false, the Submit click hits the guard and
 * fires `setState({showFieldError: true})` — the configured errorMessage
 * then surfaces inline.
 *
 * Isolation: throwaway expired GW Admin; we never POST to the backend
 * (the guard prevents it), so the user's password is unchanged.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

const NEW_PASSWORD = 'NewPass123!';
const MISMATCHED_PASSWORD = 'OtherPass456!';
const UPDATE_PASSWORD_URL = '/react/updatePassword.do';

test.setTimeout(120_000);

test('@pepi C24986 Password change - mismatched new passwords show inline error (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision an expired GW Admin', async () => {
    admin = await createGwAdmin('pepiMismatch');
    expireUserPassword(admin.userId, 91);
  });

  await test.step('Login → forced modal → open UpdatePasswordModal', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
    await expect(page.getByText(/Your password will expire in 0 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expect(page.locator('#oldPasswordField')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Enter mismatched new passwords and attempt submit', async () => {
    const fillPassword = async (selector, value) => {
      const input = page.locator(selector);
      await expect(input).toBeEnabled({ timeout: 5000 });
      await input.click();
      await input.pressSequentially(value, { delay: 50 });
    };

    await fillPassword('#oldPasswordField', admin.password);
    await fillPassword('#newPasswordField', NEW_PASSWORD);
    await fillPassword('#confirmPasswordField', MISMATCHED_PASSWORD);

    // No XHR is expected: the isFormValid guard in FormBuilder.submitForm
    // returns early. We watch for ~3s and assert nothing was POSTed.
    let posted = false;
    const onRequest = (req) => {
      if (req.url().includes(UPDATE_PASSWORD_URL) && req.method() === 'POST') {
        posted = true;
      }
    };
    page.on('request', onRequest);
    await page.locator('[data-role="formSubmitButton"]').click();
    // Brief window to confirm no POST fires; the inline error surfaces
    // synchronously from the same setState that flips showFieldError.
    await expect.poll(() => posted, { timeout: 3000, intervals: [200, 200, 500] }).toBe(false);
    page.off('request', onRequest);
  });

  await test.step('Inline "Passwords do not match" error is shown', async () => {
    await expect(page.getByText(/Passwords do not match/i)).toBeVisible({ timeout: 5000 });
  });
});
