// @ts-check
/**
 * TestRail C24987 — TC014 Password Change - Wrong Current Password
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24987
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Server-side check: when the supplied current password
 * doesn't match the stored hash, UserManagerTrait short-circuits with
 *   msg.setErrors(List.of("User password does not match!"));
 * (see UserManagerTrait.java around line 7731). The TestRail expected
 * text "Current password incorrect." is paraphrased — the actual server
 * response wording is what we assert on.
 *
 * Isolation: throwaway expired GW Admin; the form is structurally valid
 * so the POST fires, but the server rejects before any DB write happens.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

const NEW_PASSWORD = 'NewPass123!';
const WRONG_CURRENT = 'WrongPass456!';
const UPDATE_PASSWORD_URL = '/react/updatePassword.do';

test.setTimeout(180_000);

test('@pepi C24987 Password change - wrong current password is rejected (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision an expired GW Admin', async () => {
    admin = await createGwAdmin('pepiWrongCur');
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

  await test.step('Submit with incorrect current password', async () => {
    const fillPassword = async (selector, value) => {
      const input = page.locator(selector);
      await expect(input).toBeEnabled({ timeout: 5000 });
      await input.click();
      await input.pressSequentially(value, { delay: 50 });
    };

    await fillPassword('#oldPasswordField', WRONG_CURRENT);
    await fillPassword('#newPasswordField', NEW_PASSWORD);
    await fillPassword('#confirmPasswordField', NEW_PASSWORD);

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
    expect(body.success === false || !!body.error).toBeTruthy();
  });

  await test.step('Error modal "User password does not match" is shown', async () => {
    await expect(page.getByText(/User password does not match/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
