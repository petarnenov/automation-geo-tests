// @ts-check
/**
 * TestRail C41287 — Edit User modal (GW_Admin): non-@geowealth.com email
 * shows GW error and blocks Save
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41287
 * Refs:   GEO-27429, GEO-28299
 *
 * Section: "Edit User modal — GW_Admin email domain restriction". The
 * client validator `isValidUserEmail(value, isGWAdmin)` at
 * `WebContent/react/app/src/utils/helpers/isValidUserEmail.ts` requires a
 * GW Admin's email to end with `@geowealth.com`. Invalid emails surface
 * an inline error and the FormBuilder.isFormValid guard blocks Save.
 */

const { test, expect } = require('@playwright/test');
const { createGwAdmin } = require('../_helpers/qa3');
const {
  openEditUserModal,
  setModalEmail,
  MODAL_SUBMIT_NAME,
  GW_ADMIN_EMAIL_ERROR_RE,
  CONFIRM_EMAIL_CHANGE_RE,
} = require('./_helpers');

test.setTimeout(180_000);

test('@pepi C41287 Edit User modal GW Admin - non-@geowealth.com email blocks Save (UI smoke)', async ({
  page,
}) => {
  const user = await createGwAdmin('pepiBlockSave');
  const modal = await openEditUserModal(page, user);

  await test.step('Set Primary Email to user@gmail.com → inline error shown', async () => {
    await setModalEmail(modal, 'user@gmail.com');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeVisible({ timeout: 5000 });
  });

  await test.step('Click Save → confirmation modal does NOT appear', async () => {
    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeHidden({ timeout: 2000 });
    await expect(modal).toBeVisible();
  });
});
