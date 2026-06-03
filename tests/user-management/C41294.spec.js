// @ts-check
/**
 * TestRail C41294 — Edit User modal (GW_Admin): invalid email blocks save
 * (no confirmation modal)
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41294
 * Refs:   GEO-27429, GEO-28299
 *
 * Variant framing of C41287: assert that with an invalid GW Admin email
 * the Save submit guard fires — no confirmation modal appears. The
 * companion specs cover the error-copy assertion (C41293) and the suffix
 * spoof guards (C41288 / C41289).
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

test('@pepi C41294 Edit User modal GW Admin - invalid email blocks save no confirmation (UI smoke)', async ({
  page,
}) => {
  const user = await createGwAdmin('pepiNoConfirm');
  const modal = await openEditUserModal(page, user);

  await test.step('Enter invalid Primary Email → inline error', async () => {
    await setModalEmail(modal, 'user@gmail.com');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeVisible({ timeout: 5000 });
  });

  await test.step('Try to Save → confirmation modal does NOT appear', async () => {
    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeHidden({ timeout: 2000 });
    await expect(modal).toBeVisible();
  });
});
