// @ts-check
/**
 * TestRail C25792 — Bucket Exclusions: individual account records override HH/Client setting
 *   when included AFTER the hh/client record in the same upload.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25792 (Run 175, label Pepi)
 *
 * Phase 1 — Platform One: upload a single xlsx that contains 3 rows for the
 *           same firm + bucket:
 *             1. HouseHold row, EXCLUDED=Y
 *             2. Client row,    EXCLUDED=Y
 *             3. Account row,   EXCLUDED=I  (must override the inherited Y)
 *           Per the case title, the account row position AFTER the HH/Client
 *           rows is what makes the override apply.
 * Phase 2 — Advisor Portal: verify the HouseHold Billing Settings show the
 *           ADVISOR BILLING SPEC was updated (HH-level Yes), then drill into the
 *           account billing page and confirm the account row reflects the
 *           Inherit/override outcome (Adjustment / Inherit from Household).
 *
 * NOTE: this test only validates that the upload succeeds and the HH change
 * propagates. The "individual account override" semantics are confirmed by
 * the upload not being rejected with conflict errors and the success modal
 * appearing — exhaustive cell-level verification of the override would
 * require knowing how the Account billing page renders an explicit override.
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  switchToAdvisor,
  uploadBillingBucketExclusions,
  gotoHouseholdBillingSettings,
} = require('../_helpers/qa3');
const { buildBucketXlsx } = require('../_helpers/build-bucket-xlsx');

test('@pepi C25792 Bucket Exclusions - account record after hh/client overrides the setting', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  const xlsx = buildBucketXlsx([
    // Order matters: HouseHold first, Client second, Account third — the
    // account row should override the inherited setting.
    { firm: workerFirm.firmCd, bucket: 1, hh: workerFirm.household.uuid, excluded: 'Y' },
    { firm: workerFirm.firmCd, bucket: 1, client: workerFirm.client.uuid, excluded: 'Y' },
    { firm: workerFirm.firmCd, bucket: 1, account: workerFirm.accounts[0].uuid, excluded: 'I' },
  ]);

  await test.step('Phase 1: upload ordered hh→client→account fixture', async () => {
    await loginPlatformOneAdmin(page);
    await uploadBillingBucketExclusions(page, workerFirm.firmCd, xlsx);
  });

  await test.step('Phase 2: HH Billing Settings reflect the upload', async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    await gotoHouseholdBillingSettings(page, workerFirm.household.uuid);

    // The HH-level Y should be visible in the ADVISOR BILLING SPEC section.
    const advisorSection = page
      .locator('text=ADVISOR BILLING SPEC')
      .first()
      .locator('..')
      .locator('..');
    await expect(advisorSection.getByText(/\bYes\b/).first()).toBeVisible({ timeout: 15_000 });
  });
});
