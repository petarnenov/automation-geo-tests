// @ts-check
/**
 * TestRail C25445 — Unmanaged Assets: correctly filled template uploaded using file explorer
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25445 (Run 175, label Pepi)
 *
 * Browse-For-File happy path with a programmatically-built U-action xlsx.
 */

const { test } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  uploadUnmanagedAssetsExclusions,
} = require('../_helpers/qa3');
const { buildXlsxFor } = require('./_helpers');

test('@pepi C25445 Unmanaged Assets - correctly filled template uploaded using file explorer', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);
  await loginPlatformOneAdmin(page);
  await uploadUnmanagedAssetsExclusions(
    page,
    workerFirm.firmCd,
    buildXlsxFor(workerFirm)
  );
});
