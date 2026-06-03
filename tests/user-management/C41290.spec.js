// @ts-check
/**
 * TestRail C41290 — Edit User modal (Non-GW_Admin): domain is not
 * restricted and existing validation behavior is unchanged
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41290
 * Refs:   GEO-27429, GEO-28299
 *
 * Negative test: `isValidUserEmail(value, isGWAdmin)` only enforces the
 * `@geowealth.com` suffix when `isGWAdmin === true`. A regular firm user
 * (gwAdminFlag=false, lastName "FirmUser") may have any valid email.
 * `user@gmail.com` passes; Save proceeds to the confirmation modal.
 */

const { test, expect } = require('@playwright/test');
const { createFirmUser } = require('../_helpers/qa3');
const {
  openEditUserModal,
  setModalEmail,
  MODAL_SUBMIT_NAME,
  GW_ADMIN_EMAIL_ERROR_RE,
  CONFIRM_EMAIL_CHANGE_RE,
} = require('./_helpers');

test.setTimeout(180_000);

test('@pepi C41290 Edit User modal non-GW Admin - any valid email allows Save (UI smoke)', async ({
  page,
}) => {
  const user = await createFirmUser({ name: 'pepiNonAdmin', gwAdminFlag: false });
  const modal = await openEditUserModal(page, user);

  await test.step('Set Primary Email to user@gmail.com → no GW Admin error', async () => {
    await setModalEmail(modal, 'user@gmail.com');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeHidden();
  });

  await test.step('Click Save → confirmation modal appears', async () => {
    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeVisible({ timeout: 10_000 });
  });
});
