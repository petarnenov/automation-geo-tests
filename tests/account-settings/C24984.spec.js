// @ts-check
/**
 * TestRail C24984 — TC011 Validate Notification Cannot Be Ignored on Day 90
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24984
 * Refs:   GEO-14886
 *
 * Section: "Require 90 day password resets for the GeoWealth platform for
 * GWAdmin users". Verifies the post-login ExpirationWarningModal for a
 * GW Admin whose password is 90+ days old is non-dismissible:
 *   - ESC is ignored
 *   - the header close icon click is ignored
 *   - backdrop click is ignored
 *   - the "Update Password" CTA is the only forward action
 *
 * Background (from Login.js:97-112 + ModalArena.js:52-53): when
 * passwordExpirationDays === 0, Login dispatches showModalById with
 * preventClose: true + preventEscClose: true. Both guards make the
 * Modal's Container.onCloseHandler short-circuit (disableClose) and
 * ModalArena.handleEsc skip ESC entirely.
 *
 * Isolation: provisions a throwaway GW Admin per test, ages its password
 * row in entity_pswd_change_tbl. Does NOT change the password.
 */

const { test, expect } = require('@playwright/test');
const { login, createGwAdmin, expireUserPassword } = require('../_helpers/qa3');

test.setTimeout(120_000);

test('@pepi C24984 Password expiry notification cannot be ignored on day 90 (UI smoke)', async ({
  page,
  context,
}) => {
  let admin;

  await test.step('Provision a GW Admin with an expired password', async () => {
    admin = await createGwAdmin('pepiExpNotif');
    expireUserPassword(admin.userId);
  });

  // Matching specifically "in 0 days" confirms we hit the truly-expired
  // branch (the modal is dismissible for any non-zero value <= 14).
  const warningText = page.getByText(/Your password will expire in 0 days/i);

  await test.step('Login → ExpirationWarningModal appears', async () => {
    await context.clearCookies();
    await login(page, admin.username, admin.password);
    await expect(warningText).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Pressing Escape does not dismiss the modal', async () => {
    await page.keyboard.press('Escape');
    await expect(warningText).toBeVisible();
  });

  await test.step('Clicking the header close icon does not dismiss the modal', async () => {
    const closeIcon = page.locator('[data-icon="circle_close_btn"]').first();
    await expect(closeIcon).toBeVisible();
    await closeIcon.click();
    await expect(warningText).toBeVisible();
  });

  await test.step('Clicking the backdrop does not dismiss the modal', async () => {
    // Top-left corner — outside the centred modal box but inside the
    // overlay layer. If the modal were dismissible this would close it.
    await page.mouse.click(5, 5);
    await expect(warningText).toBeVisible();
  });

  await test.step('Update Password button is the only valid action', async () => {
    await expect(page.getByRole('button', { name: /^Update Password$/ })).toBeVisible();
  });
});
