// @ts-check
/**
 * TestRail C26074 — Unmanaged Assets [Delete action]
 *   "verified that the user is able to delete a record using D action"
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26074 (Run 175, label Pepi)
 *
 * The case body in TestRail is empty (sister case of C26073, same xlsx structure
 * with Action=D instead of U). The fixture in tests/fixtures/...C26074_D.xlsx is
 * derived from the C26073 template by replacing the Action cell.
 *
 * Phase 1 — Platform One: ensure the U record exists (re-upload C26073 fixture
 *           so the test is independent of execution order), then upload the
 *           D-action file and verify the success modal.
 * Phase 2 — Advisor Portal: confirm the row for the imported instrument is gone.
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  switchToAdvisor,
  uploadUnmanagedAssetsExclusions,
  gotoAccountUnmanagedAssets,
} = require('../_helpers/qa3');
const { buildXlsxFor, APPLE_SYMBOL } = require('./_helpers');

test('@pepi C26074 Unmanaged Assets - Delete (D action) removes an existing exclusion record', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(300_000);

  await test.step('Setup: ensure target instrument is present (upload U file)', async () => {
    await loginPlatformOneAdmin(page);
    await uploadUnmanagedAssetsExclusions(page, workerFirm.firmCd, buildXlsxFor(workerFirm));
  });

  await test.step('Phase 1: upload D-action file', async () => {
    await uploadUnmanagedAssetsExclusions(
      page,
      workerFirm.firmCd,
      buildXlsxFor(workerFirm, { action: 'D' })
    );
  });

  await test.step(`Phase 2: verify the row is gone in Advisor Portal as ${workerFirm.advisor.loginName}`, async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    await gotoAccountUnmanagedAssets(page, workerFirm.client.uuid, workerFirm.accounts[0].uuid);

    // The row matched by the imported instrument's symbol should not exist after D action.
    await expect(page.getByRole('row', { name: new RegExp(APPLE_SYMBOL) })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
