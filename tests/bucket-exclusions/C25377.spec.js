// @ts-check
/**
 * TestRail C25377 — Bucket Exclusions: correctly filled template uploaded via file explorer
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25377 (Run 175, label Pepi)
 *
 * The Browse-For-File path is what the existing helper already exercises (it
 * waits on a filechooser event triggered by clicking the button), so this test
 * is the most direct mapping of all upload-mechanics cases. Reuses the C25789
 * fixture.
 */

const { test } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  uploadBillingBucketExclusions,
} = require('../_helpers/qa3');
const { buildDefaultXlsx } = require('./_helpers');

test('@pepi C25377 Bucket Exclusions - correctly filled template uploaded via file explorer', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);
  await loginPlatformOneAdmin(page);
  await uploadBillingBucketExclusions(page, workerFirm.firmCd, buildDefaultXlsx(workerFirm));
});
