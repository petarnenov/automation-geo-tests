// @ts-check
/**
 * TestRail C41291 — Edit User modal (GW_Admin): pre-loaded invalid stored
 * email keeps form invalid until corrected
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41291
 * Refs:   GEO-27429, GEO-28299
 *
 * Legacy-state simulation: a GW Admin's stored email is non-@geowealth.com
 * (created before the GEO-27429 guard, or patched). When the modal opens,
 * `isFormValid` should be false (the email field's customValidation rejects
 * the legacy domain), Save's confirmation does not appear. Correcting the
 * email to a valid @geowealth.com address clears the inline error and Save
 * proceeds.
 *
 * Provisioning: `createGwAdmin` will not accept a non-@geowealth.com email
 * (server-side guard `GenericUserJTO.java`); we create with the default
 * email then patch `entity_email_tbl.email` directly via
 * `patchUserPrimaryEmail`.
 */

const { test, expect } = require('@playwright/test');
const { createGwAdmin, patchUserPrimaryEmail } = require('../_helpers/qa3');
const {
  openEditUserModal,
  setModalEmail,
  MODAL_SUBMIT_NAME,
  GW_ADMIN_EMAIL_ERROR_RE,
  CONFIRM_EMAIL_CHANGE_RE,
} = require('./_helpers');

test.setTimeout(180_000);

test('@pepi C41291 Edit User modal GW Admin - legacy invalid stored email keeps form invalid (UI smoke)', async ({
  page,
}) => {
  const user = await createGwAdmin('pepiLegacy');
  // Stamp the legacy email so prior test runs (which leave the user in
  // place — no cleanup) don't collide on the same search filter.
  const legacyEmail = `bob_${Date.now()}@old-corp.com`;
  await test.step('Patch the stored Primary Email to a legacy non-@geowealth.com value', async () => {
    patchUserPrimaryEmail(user.userId, legacyEmail);
  });

  // After the patch, server-side email search must use the new value; the
  // user's row no longer carries the username in its email column.
  const modal = await openEditUserModal(page, user, { searchEmail: legacyEmail });

  await test.step('Save click surfaces the inline error (form was invalid)', async () => {
    // FormBuilder only renders the inline error after `showFieldError`
    // flips to true — that happens on the first Save attempt against an
    // invalid form. The Save click also stays guarded so the
    // confirmation modal must not appear.
    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeHidden({ timeout: 2000 });
  });

  await test.step('Correct the email → inline error clears, Save proceeds', async () => {
    await setModalEmail(modal, 'alice@geowealth.com');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeHidden();

    // After typing, FormBuilder needs a moment for its debounced
    // validateFormFields to recompute isFormValid=true and the Save
    // button to drop its `disabled___…` style class. Click before that
    // commit hits the guard and silently no-ops.
    const saveButton = page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true });
    await expect(saveButton).not.toHaveClass(/disabled/);
    await saveButton.click();
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeVisible({ timeout: 10_000 });
  });
});
