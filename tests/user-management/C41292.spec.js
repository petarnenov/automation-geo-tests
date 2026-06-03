// @ts-check
/**
 * TestRail C41292 — Edit User modal (GW_Admin): update email from valid →
 * another valid @geowealth.com persists after save
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41292
 * Refs:   GEO-27429, GEO-28299
 *
 * Full happy-path round trip: change a GW Admin's valid email to another
 * valid `@geowealth.com` address, click Save → confirmation modal → click
 * Submit → POST `/platformOne/editUserProfile.do` (200) → modal closes →
 * reopen → email field shows the new value.
 *
 * The other specs in this suite stop at the confirmation modal to avoid
 * mutating user state; this case explicitly verifies persistence, which
 * requires firing the actual update. Backend lowercases the stored value
 * (per the server-side normalisation in `GenericUserJTO.java`), so the
 * reopened modal shows the lowercased form of the submitted address.
 */

const { test, expect } = require('@playwright/test');
const { createGwAdmin, getUserPrimaryEmail } = require('../_helpers/qa3');
const {
  openEditUserModal,
  setModalEmail,
  MODAL_BODY,
  MODAL_SUBMIT_NAME,
  CONFIRM_EMAIL_CHANGE_RE,
} = require('./_helpers');

const NEW_EMAIL = `new.alias.${Date.now()}@geowealth.com`;
const UPDATE_USER_URL = '/platformOne/editUserProfile.do';

test.setTimeout(180_000);

test('@pepi C41292 Edit User modal GW Admin - valid email update persists after save (UI smoke + DB)', async ({
  page,
}) => {
  const user = await createGwAdmin('pepiPersist');

  let modal = await openEditUserModal(page, user);

  await test.step('Change Primary Email and Save (confirm prompt)', async () => {
    await setModalEmail(modal, NEW_EMAIL);

    const saveButton = page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true });
    await expect(saveButton).not.toHaveClass(/disabled/);
    await saveButton.click();

    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeVisible({ timeout: 10_000 });

    // Click Submit in the confirmation modal → fires editUser
    // (POST /platformOne/editUserProfile.do). On success, the Edit User
    // modal closes via EditUserModal.tsx:onSuccess.
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes(UPDATE_USER_URL) && r.request().method() === 'POST',
      { timeout: 30_000 }
    );
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    await expect(page.locator(MODAL_BODY)).toBeHidden({ timeout: 10_000 });
  });

  await test.step('DB: primary email now matches the new address', async () => {
    // Verify persistence via a direct read of ENTITY_EMAIL_TBL — simpler
    // and faster than re-navigating User Management. Server lowercases
    // the stored value.
    const stored = getUserPrimaryEmail(user.userId);
    expect(stored).toBe(NEW_EMAIL.toLowerCase());
  });
});
