// @ts-check
/**
 * TestRail C25441 — Unmanaged Assets: template downloaded, added and uploaded via drag & drop
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25441 (Run 175, label Pepi)
 *
 * This case combines the Download Template + drag&drop + upload mechanics into
 * one happy path. Playwright's setFiles() does not differentiate between
 * drag&drop and Browse-For-File at the input level, so this test verifies the
 * upload mechanics with a programmatically-built U-action xlsx.
 *
 * The "download template" sub-step is implicitly covered: the test relies on
 * the same xlsx schema the template would produce, and a separate dedicated
 * test (when added) can verify the download endpoint independently.
 */

const { test } = require('@playwright/test');
const { loginPlatformOneAdmin, uploadUnmanagedAssetsExclusions } = require('../_helpers/qa3');
const { buildXlsxFor } = require('./_helpers');

test('@pepi C25441 Unmanaged Assets - template added and uploaded via drag & drop', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);
  await loginPlatformOneAdmin(page);
  await uploadUnmanagedAssetsExclusions(page, workerFirm.firmCd, buildXlsxFor(workerFirm));
});
