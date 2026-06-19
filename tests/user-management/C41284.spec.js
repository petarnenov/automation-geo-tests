// @ts-check
/**
 * TestRail C41284 — Edit User modal (GW_Admin): malformed email shows GW
 * error and blocks Save
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41284
 * Refs:   GEO-27429, GEO-28299
 *
 * Negative variant of C41285. A malformed Primary Email on a GW_Admin
 * user surfaces the inline error
 *   "GW_Admin users must use a @geowealth.com email address."
 * and the Save submit must stay gated (no confirmation modal opens).
 *
 * Source-of-truth (FE):
 *   - EditUserModal.js — `#emailField` + customValidation isValidEmail;
 *     `submitDisplayName='Save'`. Button uses styles.disabled class when
 *     FormBuilder isFormValid=false (per project_formbuilder_disabled_style_only).
 *   - tests/user-management/_helpers.js — GW_ADMIN_EMAIL_ERROR_RE,
 *     CONFIRM_EMAIL_CHANGE_RE, setModalEmail (drives the React-controlled
 *     input via real keystrokes), MODAL_SUBMIT_NAME.
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

test('@pepi C41284 Edit User modal GW Admin - malformed email blocks Save', async ({ page }) => {
  // Alpha-only firstName (validators.isValidCommonName rejects digits) —
  // ensures only the email validation gates Save in this run.
  const user = await createGwAdmin('pepiBlockSave');
  const modal = await openEditUserModal(page, user);

  await test.step('Step 1: Set Primary Email to a malformed value → inline error appears', async () => {
    await setModalEmail(modal, 'not-an-email');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step('Step 2: Attempt Save → blocked, no confirmation modal', async () => {
    const saveBtn = page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).first();
    // FormBuilder gates the submit via the `disabled` style class — the
    // button has no native HTML `disabled` attribute.
    await expect(saveBtn).toHaveClass(/disabled/i, { timeout: 10_000 });

    // Click anyway — the FormBuilder Button's onClick short-circuits when
    // the disabled class is set, so the confirmation modal MUST NOT open.
    await saveBtn.click().catch(() => {});
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeHidden({ timeout: 5000 });
    // The inline error persists until the user fixes it.
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE).first()).toBeVisible({
      timeout: 5000,
    });
  });
});
