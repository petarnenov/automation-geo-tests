/**
 * TestRail C25789 — Bucket Exclusions: Set All Accts to I = Y propagates to all accounts
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25789 (Run 175, label Pepi)
 * Refs:   GEO-20985
 *
 * Phase 1: upload a Bucket Exclusions xlsx marking the HouseHold
 *          Excluded=Y on bucket 1 (Advisor) with underlying Client
 *          and Accounts set to Inherit.
 * Phase 2: verify the Advisor Portal HH Billing Settings reflect the
 *          new exclusion — ADVISOR BILLING SPEC section now shows an
 *          explicit Yes.
 *
 * NOTE: TestRail's title mentions "Set All Accts to I" but the
 * current xlsx template does not expose that column — the same
 * propagation is achieved by marking each account Excluded=I in
 * the row data (the default fixture shape). The C25790/C25791
 * specs exercise the optional 7th column explicitly.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { BillingBucketExclusionsPage } from '../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';
import { buildDefaultXlsx } from '../../../src/pages/bucket-exclusions/bucketExclusionFixtures';
import { HouseholdBillingSettingsPage } from '../../../src/pages/household/HouseholdBillingSettingsPage';

test('@regression @billing-servicing C25789 Bucket Exclusions - Set All Accts to I = Y propagates to all accounts', async ({
  tim1Page,
  firmAdvisorPage1,
  workerFirm,
}) => {
  test.slow();

  await test.step('Phase 1: upload Bucket Exclusions xlsx as tim1', async () => {
    const uploadPage = new BillingBucketExclusionsPage(tim1Page);
    await uploadPage.open(workerFirm.firmCd);
    await uploadPage.uploadAndConfirm({
      name: 'BillingBucketExclusions_C25789.xlsx',
      buffer: buildDefaultXlsx(workerFirm),
    });
  });

  await test.step('Phase 2: HH Billing Settings shows HH-level Yes in Advisor section', async () => {
    const hhPage = new HouseholdBillingSettingsPage(firmAdvisorPage1);
    await hhPage.open(workerFirm.household.uuid);

    const advisorSection = hhPage.section('ADVISOR BILLING SPEC');
    await expect(advisorSection).toContainText(/Exclude from Advisor billing/i);
    await expect(advisorSection.getByText(/\bYes\b/).first()).toBeVisible({ timeout: 15_000 });
  });
});
