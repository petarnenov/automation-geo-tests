// @ts-check
/**
 * TestRail C41286 — Edit User modal (GW_Admin): mixed-case @GeoWealth.COM
 * is accepted
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41286
 * Refs:   GEO-27429, GEO-28299
 *
 * Case-insensitive variant of the C41285 happy path. The validator at
 * `WebContent/react/app/src/utils/helpers/isValidUserEmail.ts:14` does
 * `.toLowerCase().endsWith('@geowealth.com')`, so `alice@GeoWealth.COM`
 * passes — no inline error, Save proceeds to the confirmation modal.
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

test('@pepi C41286 Edit User modal GW Admin - mixed-case @GeoWealth.COM is accepted (UI smoke)', async ({
  page,
}) => {
  const user = await createGwAdmin('pepiMixedCase');
  const modal = await openEditUserModal(page, user);

  await test.step('Set Primary Email to alice@GeoWealth.COM → no inline error', async () => {
    await setModalEmail(modal, 'alice@GeoWealth.COM');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeHidden();
  });

  await test.step('Click Save → confirmation modal appears', async () => {
    const saveButton = page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true });
    await expect(saveButton).not.toHaveClass(/disabled/);
    await saveButton.click();
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeVisible({ timeout: 10_000 });
  });
});
