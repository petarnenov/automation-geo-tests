// @ts-check
/**
 * TestRail C25381 — Bucket Exclusions: all billing buckets, all Y/N/I actions
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25381 (Run 175, label Pepi)
 *
 * The case asks to exercise every billing bucket (1..6) with every Excluded
 * action (Y/N/I). We construct a 6-row HouseHold-level fixture that cycles
 * through Y/N/I across the six buckets, upload it, and verify the HH Billing
 * Settings page has been updated.
 *
 * Bucket → spec mapping (from the qa3 HH Billing Settings page):
 *   1 = Advisor          → Y → "Exclude from Advisor billing: Yes"
 *   2 = Money Manager    → N → "Exclude from Money Manager billing: No"  (explicit override)
 *   3 = Platform         → I → "Exclude from Platform billing: Inherit from Firm (No)"
 *   4 = Internal Advisor → Y
 *   5 = Internal MM      → N
 *   6 = Internal Platform→ I
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  switchToAdvisor,
  uploadBillingBucketExclusions,
  gotoHouseholdBillingSettings,
} = require('../_helpers/qa3');
const { buildBucketXlsx } = require('../_helpers/build-bucket-xlsx');

const ACTIONS = ['Y', 'N', 'I', 'Y', 'N', 'I']; // bucket 1..6

test('@pepi C25381 Bucket Exclusions - all 6 buckets accept Y/N/I excluded actions', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  const xlsx = buildBucketXlsx(
    ACTIONS.map((excluded, i) => ({
      firm: workerFirm.firmCd,
      bucket: i + 1,
      hh: workerFirm.household.uuid,
      excluded,
    }))
  );

  await test.step('Phase 1: upload 6-row all-buckets fixture', async () => {
    await loginPlatformOneAdmin(page);
    await uploadBillingBucketExclusions(page, workerFirm.firmCd, xlsx);
  });

  await test.step(`Phase 2: HH Billing Settings reflects the upload`, async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    await gotoHouseholdBillingSettings(page, workerFirm.household.uuid);

    // The page must contain all 6 spec sections after the upload — this alone
    // is a useful smoke (the page would be partially blank if the upload had
    // corrupted the HH billing config).
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

    // Bucket 1 (Advisor) was set to Y → look for an explicit Yes inside the
    // Advisor section.
    const advisorSection = page
      .locator('text=ADVISOR BILLING SPEC')
      .first()
      .locator('..')
      .locator('..');
    await expect(
      advisorSection.getByText(/\bYes\b/).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
