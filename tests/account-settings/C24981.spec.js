// @ts-check
/**
 * TestRail C24981 — TC008 Validate Linked Account Password Sync
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24981
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". When a GW Admin changes their password, the backend
 * propagates the new hash to every linked NEntity
 * (`UserManagerTrait.checkAndUpdatePasswordForUser` →
 * `NEntityDAO.getAllLinkedEntities`, keyed by `entity_tbl.LINKED_GW_USER`).
 * Verifies that after User A changes their password, the linked User B:
 *   - can no longer log in with the OLD password
 *   - can log in with the NEW password
 *
 * Isolation: two throwaway GW Admins per test. User A's password row is
 * aged to force the modal. User B is linked to A via DB before the
 * change. No cleanup.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword, linkUserTo } = require('../_helpers/qa3');

const NEW_PASSWORD = 'NewPass123!';
const UPDATE_PASSWORD_URL = '/react/updatePassword.do';

test.setTimeout(240_000);

test('@pepi C24981 Linked account password sync across users (UI smoke)', async ({
  page,
  context,
}) => {
  let userA;
  let userB;

  await test.step('Provision User A + User B; link B → A', async () => {
    userA = await createGwAdmin('pepiSyncA');
    userB = await createGwAdmin('pepiSyncB');
    linkUserTo(userB.userId, userA.userId);
    // Force the change flow on A by aging A's password row.
    expireUserPassword(userA.userId, 91);
  });

  await test.step('Login as User A → forced modal → open UpdatePasswordModal', async () => {
    await context.clearCookies();
    await login(page, userA.username, userA.password);
    await expect(page.getByText(/Your password will expire in 0 days/i)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Update Password' }).click();
    await expect(page.locator('#oldPasswordField')).toBeVisible({ timeout: 15_000 });
  });

  await test.step('User A submits a new password → backend syncs to User B', async () => {
    // See C24988 + [[formbuilder-password-modal]] for why pressSequentially
    // + an isFormValid fiber-poll is necessary here.
    const fillPassword = async (selector, value) => {
      const input = page.locator(selector);
      await expect(input).toBeEnabled({ timeout: 5000 });
      await input.click();
      await input.pressSequentially(value, { delay: 50 });
    };

    await fillPassword('#oldPasswordField', userA.password);
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
    expect(body.success ?? !body.error).toBeTruthy();
    await expect(page.getByText(/Password updated successfully/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step('User B: old password fails', async () => {
    await context.clearCookies();
    await login(page, userB.username, userB.password); // userB.password is the original
    // Login does not redirect to dashboard on failure; the SPA stays on
    // the login route. Allow a short window in case any state flickers.
    await expect(page).toHaveURL(/#login/, { timeout: 5000 });
    await expect(page).not.toHaveURL(/#\/?(dashboard|platformOne)/);
  });

  await test.step('User B: new password succeeds', async () => {
    await context.clearCookies();
    await login(page, userB.username, NEW_PASSWORD);
    await expect(page).toHaveURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
  });
});
