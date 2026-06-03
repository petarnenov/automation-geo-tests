// @ts-check
/**
 * TestRail C41289 — Edit User modal (GW_Admin): suffix-spoof guard rejects
 * @geowealth.com.evil
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41289
 * Refs:   GEO-27429, GEO-28299
 *
 * Spoof attempt: `alice@geowealth.com.evil`. `endsWith('@geowealth.com')`
 * returns false because the address ends with `.evil`, not `.com`.
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

test('@pepi C41289 Edit User modal GW Admin - @geowealth.com.evil suffix-spoof blocks Save (UI smoke)', async ({
  page,
}) => {
  const user = await createGwAdmin('pepiSpoofB');
  const modal = await openEditUserModal(page, user);

  await test.step('Set Primary Email to alice@geowealth.com.evil → inline error', async () => {
    await setModalEmail(modal, 'alice@geowealth.com.evil');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeVisible({ timeout: 5000 });
  });

  await test.step('Click Save → confirmation modal does NOT appear', async () => {
    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeHidden({ timeout: 2000 });
    await expect(modal).toBeVisible();
  });
});
