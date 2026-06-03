// @ts-check
/**
 * TestRail C41288 — Edit User modal (GW_Admin): suffix-spoof guard rejects
 * @evilgeowealth.com
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/41288
 * Refs:   GEO-27429, GEO-28299
 *
 * Spoof attempt: `alice@evilgeowealth.com`. The validator's check is
 * `.toLowerCase().endsWith('@geowealth.com')` (the leading `@` is part of
 * the suffix) — `@evilgeowealth.com` ends with `geowealth.com` but NOT
 * `@geowealth.com`, so it must be rejected.
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

test('@pepi C41288 Edit User modal GW Admin - @evilgeowealth.com suffix-spoof blocks Save (UI smoke)', async ({
  page,
}) => {
  const user = await createGwAdmin('pepiSpoofA');
  const modal = await openEditUserModal(page, user);

  await test.step('Set Primary Email to alice@evilgeowealth.com → inline error', async () => {
    await setModalEmail(modal, 'alice@evilgeowealth.com');
    await expect(page.getByText(GW_ADMIN_EMAIL_ERROR_RE)).toBeVisible({ timeout: 5000 });
  });

  await test.step('Click Save → confirmation modal does NOT appear', async () => {
    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
    await expect(page.getByText(CONFIRM_EMAIL_CHANGE_RE)).toBeHidden({ timeout: 2000 });
    await expect(modal).toBeVisible();
  });
});
