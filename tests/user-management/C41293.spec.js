// @ts-check
/**
 * TestRail C41293 — Edit User modal (GW_Admin): inline error copy matches
 * exact required text
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41293
 * Refs:   GEO-27429, GEO-28299
 *
 * Copy-stability check: the GW Admin invalid-email inline error must read
 * exactly "GW_Admin users must use a @geowealth.com email address." (per
 * the constant `GW_ADMIN_EMAIL_ERROR` in
 * `WebContent/react/app/src/utils/helpers/isValidUserEmail.ts`).
 *
 * Different from C41287 (which just checks the regex contains the text)
 * — here we assert the rendered `#emailError` text matches the exact
 * string the spec / UX team committed to.
 */

const { test, expect } = require('@playwright/test');
const { createGwAdmin } = require('../_helpers/qa3');
const { openEditUserModal, setModalEmail } = require('./_helpers');

const EXACT_ERROR_TEXT = 'GW_Admin users must use a @geowealth.com email address.';

test.setTimeout(180_000);

test('@pepi C41293 Edit User modal GW Admin - inline error copy matches exact text (UI smoke)', async ({
  page,
}) => {
  const user = await createGwAdmin('pepiExactCopy');
  const modal = await openEditUserModal(page, user);

  await test.step('Enter invalid Primary Email → inline error matches exact copy', async () => {
    await setModalEmail(modal, 'user@company.com');
    await expect(modal.locator('#emailError')).toHaveText(EXACT_ERROR_TEXT, { timeout: 5000 });
  });
});
