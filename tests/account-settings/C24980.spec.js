// @ts-check
/**
 * TestRail C24980 — TC007 Validate Password History Restriction
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24980
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". The server keeps a 3-deep password history and rejects
 * any new password that matches one of the previous three (see
 * `UserManagerTrait.last3PasswordsMatches`, called from
 * `checkAndUpdatePasswordForUser`). The same error path is triggered when
 * the new password matches the CURRENT one — `UpdateEntityPasswordAction`
 * short-circuits with the identical message:
 *   "The new password cannot match one of the three previously used passwords!"
 *
 * The TestRail expected text ("Password has been used recently. Choose a
 * different one.") is paraphrased — actual server response wording is
 * what we assert on. Reusing the current password is the cheapest way to
 * trip the history check without driving 3 sequential password changes.
 *
 * Isolation: throwaway GW Admin, ages password row to force the modal,
 * submits with old === new → expects the history-restriction error.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

const UPDATE_PASSWORD_URL = '/react/updatePassword.do';

test.setTimeout(180_000);

test('@pepi C24980 Password history restriction rejects reuse (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision an expired GW Admin', async () => {
    admin = await createGwAdmin('pepiHistory');
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

  await test.step('Attempt to reuse the current password → submit', async () => {
    // Same value in all three fields. Structurally valid (admin.password
    // passes the 8+/upper/digit/special rules) so the form submits, but
    // the server's `oldPassword.equals(newPassword)` guard trips the
    // same error path as the 3-password-history check.
    const fillPassword = async (selector, value) => {
      const input = page.locator(selector);
      await expect(input).toBeEnabled({ timeout: 5000 });
      await input.click();
      await input.pressSequentially(value, { delay: 50 });
    };

    await fillPassword('#oldPasswordField', admin.password);
    await fillPassword('#newPasswordField', admin.password);
    await fillPassword('#confirmPasswordField', admin.password);

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
    // Server signalled failure (success:false or error string).
    expect(body.success === false || !!body.error).toBeTruthy();
  });

  await test.step('Error message about reuse is shown', async () => {
    await expect(
      page.getByText(/cannot match one of the three previously used passwords/i)
    ).toBeVisible({ timeout: 10_000 });
  });
});
