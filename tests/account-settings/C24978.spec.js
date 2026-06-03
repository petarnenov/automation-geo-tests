// @ts-check
/**
 * TestRail C24978 — TC005 Validate Password Change Resets Timer
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24978
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". After a forced password change, the DB timestamp that
 * drives the 90-day countdown must update to "now" — confirming the
 * server actually persisted the change and the next expiration is 90 days
 * away (90 - 0 = 90).
 *
 * Steps mirror C24988's forced-flow submission plus a DB read of
 * MAX(change_date) from entity_pswd_change_tbl before and after submit.
 *
 * Isolation: provisions a throwaway GW Admin, ages its password row, runs
 * the modal-driven password change. No shared cleanup needed.
 */

const { test, expect } = require('@playwright/test');
const {
  login,
  createGwAdmin,
  expireUserPassword,
  getLastPasswordChangeMs,
} = require('../_helpers/qa3');

const NEW_PASSWORD = 'NewPass123!';
const UPDATE_PASSWORD_URL = '/react/updatePassword.do';

test.setTimeout(180_000);

test('@pepi C24978 Password change resets the 90-day timer (UI smoke + DB)', async ({
  page,
  context,
}) => {
  let admin;
  let expiredAtMs;

  await test.step('Provision an expired GW Admin', async () => {
    admin = await createGwAdmin('pepiResetTimer');
    expireUserPassword(admin.userId, 91);
    expiredAtMs = getLastPasswordChangeMs(admin.userId);
    // The expired row dates from ~91 days in the past.
    expect(expiredAtMs).toBeLessThan(Date.now() - 80 * 24 * 60 * 60 * 1000);
  });

  await test.step('Login → forced password change modal', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
    await expect(page.getByText(/Your password will expire in 0 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expect(page.locator('#oldPasswordField')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Submit a valid new password', async () => {
    // See C24988 + [[formbuilder-password-modal]] memory: real keystrokes
    // (pressSequentially) are the only path that drives the full React
    // chain — InputCore.onChange → Password.onChangeHandler → BOTH
    // updateFormState (FormBuilder) AND handlePasswordChange (modal's
    // useState that confirmPassword's customValidation closes over).
    const fillPassword = async (selector, value) => {
      const input = page.locator(selector);
      await expect(input).toBeEnabled({ timeout: 5000 });
      await input.click();
      await input.pressSequentially(value, { delay: 50 });
    };

    await fillPassword('#oldPasswordField', admin.password);
    await fillPassword('#newPasswordField', NEW_PASSWORD);
    await fillPassword('#confirmPasswordField', NEW_PASSWORD);

    // Wait for FormBuilder's debounced validateFormFields to commit
    // isFormValid = true; clicking before then hits the submit guard.
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

    await expect(page.getByText(/Password updated successfully/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step('DB timestamp now reflects the change (current date)', async () => {
    const newChangeMs = getLastPasswordChangeMs(admin.userId);
    expect(newChangeMs).not.toBeNull();
    // Updated past the original 91-day-old row.
    expect(newChangeMs).toBeGreaterThan(expiredAtMs);
    // Within the last 48h — entity_pswd_change_tbl.change_date is DAY
    // precision (TRUNC(SYSDATE)) in the DB's local timezone, so the value
    // can be up to ~24h behind UTC "now" depending on TZ. A 48h window
    // tolerates timezone skew while still proving the row was stamped
    // with the current change instead of staying at 91 days ago. This
    // implies the next 90-day countdown starts now (90 - 0 = 90).
    const nowMs = Date.now();
    expect(newChangeMs).toBeGreaterThan(nowMs - 48 * 60 * 60 * 1000);
    expect(newChangeMs).toBeLessThanOrEqual(nowMs + 60 * 60 * 1000);
  });
});
