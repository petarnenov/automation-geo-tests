// @ts-check
/**
 * TestRail C41285 — Edit User modal (GW_Admin): valid @geowealth.com email
 * allows Save and shows confirmation
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41285
 * Refs:   GEO-27429, GEO-28299
 *
 * Happy path: a GW Admin's Primary Email is set to a valid `@geowealth.com`
 * address. No inline error appears; clicking Save opens the
 * "You are about to update the user's email address" confirmation modal.
 * We stop at the confirmation (do not click Submit) to avoid actually
 * mutating the user — the confirmation is the spec's success signal.
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

test('@pepi C41285 Edit User modal GW Admin - valid @geowealth.com email allows Save (UI smoke)', async ({
  page,
}) => {
  // `validators.isValidCommonName` (EditUserModal's givenName field)
  // rejects digits; use an alpha-only firstName so isFormValid can flip
  // true and Save can proceed.
  const user = await createGwAdmin('pepiAllowSave');
  const modal = await openEditUserModal(page, user);

  await test.step('Set Primary Email to alice@geowealth.com → no inline error', async () => {
    await setModalEmail(modal, 'alice@geowealth.com');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeHidden();
  });

  await test.step('Click Save → confirmation modal appears', async () => {
    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeVisible({ timeout: 10_000 });
  });
});
