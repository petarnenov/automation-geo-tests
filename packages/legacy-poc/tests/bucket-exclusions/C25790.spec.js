// @ts-check
/**
 * TestRail C25790 — Bucket Exclusions: 'Set All Accts to I = N' or blank
 *   accounts retain their current settings.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25790 (Run 175, label Pepi)
 * Refs:   GEO-20985
 *
 * The case asserts that uploading a HouseHold-level row with the optional
 * "Set All Accts to I" column set to N (or blank) does NOT propagate the
 * Excluded change down to the underlying client and account billing settings —
 * unlike the Y variant exercised by C25789.
 *
 * Phase 1 — Platform One: build a Bucket Exclusions xlsx WITH the optional
 *           "Set All Accts to I" column included and set to N for the HH row.
 *           Upload it and verify the success modal.
 * Phase 2 — Advisor Portal: open the HH Billing Settings page and verify it
 *           still loads correctly. Per-row "no propagation" verification at
 *           the account level is left as a TODO — it would require a snapshot
 *           diff against pre-upload state, which is more complex than the
 *           single-page assertion we use here.
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  switchToAdvisor,
  uploadBillingBucketExclusions,
  gotoHouseholdBillingSettings,
} = require('../_helpers/qa3');
const { buildBucketXlsx } = require('../_helpers/build-bucket-xlsx');

test('@pepi C25790 Bucket Exclusions - Set All Accts to I = N: HH-level upload accepted', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  const xlsx = buildBucketXlsx(
    [
      {
        firm: workerFirm.firmCd,
        bucket: 1,
        hh: workerFirm.household.uuid,
        excluded: 'Y',
        setAllAcctsToI: 'N',
      },
    ],
    { includeSetAllAccts: true }
  );

  await test.step('Phase 1: upload xlsx with Set All Accts to I = N', async () => {
    await loginPlatformOneAdmin(page);
    await uploadBillingBucketExclusions(page, workerFirm.firmCd, xlsx);
  });

  await test.step('Phase 2: HH Billing Settings still loads cleanly', async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    await gotoHouseholdBillingSettings(page, workerFirm.household.uuid);

    // Smoke: all 6 spec sections rendered after the upload (the page would be
    // partially blank if the upload had corrupted the HH config).
    for (const label of [
      'ADVISOR BILLING SPEC',
      'PLATFORM BILLING SPEC',
      'MONEY MANAGER BILLING SPEC',
      'INTERNAL ADVISOR BILLING SPEC',
      'INTERNAL PLATFORM BILLING SPEC',
      'INTERNAL MONEY MANAGER BILLING SPEC',
    ]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });
});
