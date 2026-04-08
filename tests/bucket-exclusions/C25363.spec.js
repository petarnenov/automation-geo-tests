// @ts-check
/**
 * TestRail C25363 — Bucket Exclusions: correctly filled template uploaded via drag & drop
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25363 (Run 175, label Pepi)
 *
 * Functionally identical to C25377 (file explorer variant): both end up calling
 * the same input[type=file] handler. Playwright's setFiles() bypasses the click
 * source distinction (drag&drop vs Browse), so this test only verifies the upload
 * mechanics — that a correctly-filled fixture is accepted and the success modal
 * appears.
 *
 * Reuses the C25789 fixture (firm 106 / Hudye, Benedict household, EXCLUDED=Y).
 */

const { test } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  uploadBillingBucketExclusions,
} = require('../_helpers/qa3');
const { buildDefaultXlsx } = require('./_helpers');

test('@pepi C25363 Bucket Exclusions - correctly filled template uploaded via drag & drop', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);
  await loginPlatformOneAdmin(page);
  await uploadBillingBucketExclusions(page, workerFirm.firmCd, buildDefaultXlsx(workerFirm));
});
