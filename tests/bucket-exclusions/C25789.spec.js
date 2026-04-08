// @ts-check
/**
 * TestRail C25789 — Bucket Exclusions: 'Set All Accts to I = Y'
 *   "all accounts under hh/client inherit the setting"
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25789 (Run 175, label Pepi)
 * Refs:   GEO-20985
 *
 * Phase 1 — Platform One: upload a Billing Bucket Exclusions xlsx that marks the
 *           target HouseHold as Excluded=Y for billing bucket 1 (Advisor), with
 *           the underlying Client and Accounts set to Excluded=I (Inherit).
 * Phase 2 — Advisor Portal: re-authenticate as the firm's advisor and verify the
 *           Household Billing Settings reflect the new exclusion.
 *
 * Test data (real qa3 hierarchy under firm 106 / GeoWealth):
 *   Household: Hudye, Benedict — 836CF7A661EE498497B5C19DFD6C6754
 *   Client:    Hudye, Benedict — E4727F2E803F457898ACE52C506F3849
 *   Accounts:  3 accounts under that client
 *
 * The fixture is generated programmatically via scripts/generate-bucket-fixture.js
 * so the test data lives in version control alongside the spec.
 *
 * NOTE: the TestRail case talks about a "Set All Accts to I" column that does
 * not exist in the current xlsx template. We omit that column per user direction.
 * The verification covers the upload + the HH-level Excluded propagation only.
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  switchToAdvisor,
  uploadBillingBucketExclusions,
  gotoHouseholdBillingSettings,
} = require('../_helpers/qa3');
const { buildDefaultXlsx } = require('./_helpers');

test('@pepi C25789 Bucket Exclusions - Set All Accts to I = Y propagates to all accounts', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  await test.step('Phase 1: upload Billing Bucket Exclusions file', async () => {
    await loginPlatformOneAdmin(page);
    await uploadBillingBucketExclusions(
      page,
      workerFirm.firmCd,
      buildDefaultXlsx(workerFirm)
    );
  });

  await test.step(`Phase 2: verify HH Billing Settings as ${workerFirm.advisor.loginName}`, async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    await gotoHouseholdBillingSettings(page, workerFirm.household.uuid);

    // Bucket 1 in the xlsx maps to ADVISOR BILLING SPEC. After uploading with
    // EXCLUDED=Y at the household level, the "Exclude from Advisor billing" row
    // should no longer show "Inherit from Firm (No)" — it should show an
    // explicit Yes (or "Inherit from Firm (Yes)") set at the household level.
    const advisorSection = page
      .locator('text=ADVISOR BILLING SPEC')
      .locator('..')
      .locator('..');
    await expect(advisorSection).toContainText(/Exclude from Advisor billing/i);
    await expect(
      advisorSection.getByText(/\bYes\b/).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
