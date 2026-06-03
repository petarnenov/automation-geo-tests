// @ts-check
/**
 * TestRail C41295 — Edit User modal (GW_Admin): update email from valid →
 * invalid domain is blocked and not persisted
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41295
 * Refs:   GEO-27429, GEO-28299
 *
 * Round trip: GW Admin starts with a valid `@geowealth.com` email. Change
 * to `user@yahoo.com`, inline error appears, Save is blocked, the modal
 * stays open. Reopen the modal (cancel + reopen) — the email field
 * displays the original valid address; the edit was not persisted.
 */

const { test, expect } = require('@playwright/test');
const { createGwAdmin } = require('../_helpers/qa3');
const {
  openEditUserModal,
  setModalEmail,
  MODAL_BODY,
  MODAL_SUBMIT_NAME,
  GW_ADMIN_EMAIL_ERROR_RE,
  CONFIRM_EMAIL_CHANGE_RE,
} = require('./_helpers');

test.setTimeout(180_000);

test('@pepi C41295 Edit User modal GW Admin - valid → invalid email is blocked and not persisted (UI smoke)', async ({
  page,
}) => {
  const user = await createGwAdmin('pepiRevert');
  const originalEmail = user.emailAddress.toLowerCase();

  let modal = await openEditUserModal(page, user);

  await test.step('Change Primary Email to user@yahoo.com → blocked', async () => {
    await setModalEmail(modal, 'user@yahoo.com');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeHidden({ timeout: 2000 });
    await expect(modal).toBeVisible();
  });

  await test.step('Reopen the modal → the original email is still stored', async () => {
    await page.locator('[data-testid="userManagementEditUserModal-cancel"]').click();
    await expect(page.locator(MODAL_BODY)).toBeHidden({ timeout: 5000 });

    // The grid still shows the filtered user — click the same link
    // button to reopen the modal directly (avoids a second navigation
    // racing the page-loader).
    const firstName = user.firstName || user.username.split('_')[0];
    const lastName = user.lastName || 'GWAdmin';
    await page.getByRole('button', { name: `${firstName} ${lastName}` }).click();
    modal = page.locator(MODAL_BODY);
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal.locator('#emailField')).toHaveValue(originalEmail);
  });
});
