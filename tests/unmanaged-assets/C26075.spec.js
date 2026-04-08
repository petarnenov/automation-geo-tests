// @ts-check
/**
 * TestRail C26075 — Unmanaged Assets [Remove All action]
 *   "verified that the user is able to remove all records using RA action"
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26075 (Run 175, label Pepi)
 *
 * Step 1 expects "uploaded successfully", step 2 expects "all records are deleted"
 * in the Advisor Portal Unmanaged Assets page for the matching firm/account.
 *
 * The fixture in tests/fixtures/...C26075_RA.xlsx is derived from the C26073
 * template by replacing the Action cell with "RA".
 *
 * Phase 1 — Platform One: ensure at least one record exists (upload C26073 U file
 *           as setup), then upload the RA-action file and verify success.
 * Phase 2 — Advisor Portal: confirm the table is empty for that account.
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  switchToAdvisor,
  uploadUnmanagedAssetsExclusions,
  gotoAccountUnmanagedAssets,
} = require('../_helpers/qa3');
const { buildXlsxFor, APPLE_SYMBOL } = require('./_helpers');

test('@pepi C26075 Unmanaged Assets - Remove All (RA action) clears all exclusion records', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(300_000);

  await test.step('Setup: ensure at least one exclusion exists for the firm', async () => {
    await loginPlatformOneAdmin(page);
    await uploadUnmanagedAssetsExclusions(
      page,
      workerFirm.firmCd,
      buildXlsxFor(workerFirm)
    );
  });

  await test.step('Phase 1: upload RA-action file', async () => {
    await uploadUnmanagedAssetsExclusions(
      page,
      workerFirm.firmCd,
      buildXlsxFor(workerFirm, { action: 'RA' })
    );
  });

  await test.step(`Phase 2: verify the table is empty in Advisor Portal as ${workerFirm.advisor.loginName}`, async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    await gotoAccountUnmanagedAssets(
      page,
      workerFirm.client.uuid,
      workerFirm.accounts[0].uuid
    );

    // After RA, no instrument rows should remain for this account.
    await expect(
      page.getByRole('row', { name: new RegExp(APPLE_SYMBOL) })
    ).toHaveCount(0, { timeout: 15_000 });
  });
});
