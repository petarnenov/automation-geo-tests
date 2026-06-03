// @ts-check
/**
 * TestRail C24988 — TC015 Password Change - Password Meets All Rules
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24988
 * Refs:   GEO-14886
 *
 * NOTE: TestRail section is "Require 90 day password resets for the
 * GeoWealth platform for GWAdmin users" — this is the FORCED expiry flow,
 * not the voluntary AdvisorSettings → Change Password tab. Login as a
 * GW Admin whose password is 90+ days old → ExpirationWarningModal appears
 * → click "Update Password" → fill UpdatePasswordModal with a new password
 * that meets all rules → assert success modal.
 *
 * Isolation: provisions a throwaway GW Admin per test (createGwAdmin in
 * firm 1), ages its password row in entity_pswd_change_tbl, drives the
 * flow, and abandons the user — no shared cleanup needed.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

const NEW_PASSWORD = 'NewPass123!';
const UPDATE_PASSWORD_URL = '/react/updatePassword.do';

test.setTimeout(180_000);

test('@pepi C24988 Password Change - new password meets all rules (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision a GW Admin with an expired password', async () => {
    admin = await createGwAdmin('pepiExp');
    expireUserPassword(admin.userId);
  });

  await test.step('Login → ExpirationWarningModal forces password update', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
    await expect(page.getByText(/Your password will expire in 0 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expect(page.locator('#oldPasswordField')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Submit a valid new password', async () => {
    // The UpdatePasswordModal has a tricky React dependency: confirmPassword
    // is `disabled: rulesConfig.some(...!rule(newPassword))` and its
    // customValidation closes over the modal's local `newPassword` useState
    // (set by handlePasswordChange — newPassword field's onChange prop).
    // Until newPassword's full onChange chain fires —
    //   InputCore.onChange → setState → Password.onChangeHandler → BOTH
    //   updateFormState (FormBuilder) AND the field's onChange prop
    //   (handlePasswordChange → setNewPassword)
    // — confirmPassword stays disabled AND the form's isFormValid stays
    // false. Synthesised input events from setReactNumericInput don't
    // drive that chain on this stack; only real keystrokes do. After
    // typing, isFormValid still has to commit via a debounced
    // validateFormFields (~50ms), so we poll the FormBuilder fiber.
    const fillPassword = async (selector, value) => {
      const input = page.locator(selector);
      await expect(input).toBeEnabled({ timeout: 5000 });
      await input.click();
      await input.pressSequentially(value, { delay: 50 });
    };

    await fillPassword('#oldPasswordField', admin.password);
    await fillPassword('#newPasswordField', NEW_PASSWORD);
    await fillPassword('#confirmPasswordField', NEW_PASSWORD);

    // Wait for FormBuilder's React state to flip isFormValid to true — the
    // debounced validateFormFields takes ≥50ms after last keystroke, and
    // the Submit button stays in its `disabledStyleOnly` greyed look until
    // then. Clicking before isFormValid commits hits the submit guard
    // (throttleFireSubmit) and silently no-ops without firing XHR.
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

  await test.step('Verify success modal', async () => {
    await expect(page.getByText(/Password updated successfully/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
