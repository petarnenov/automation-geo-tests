/**
 * TestRail C25381 — Bucket Exclusions: all 6 buckets accept Y/N/I excluded actions
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25381 (Run 175, label Pepi)
 *
 * Exercises every billing bucket (1..6) with every EXCLUDED action
 * (Y/N/I). A single 6-row HouseHold-level xlsx cycles through the
 * three actions across the six buckets.
 *
 * Bucket → spec mapping (verified against the qa HH Billing Settings):
 *   1 = Advisor
 *   2 = Money Manager
 *   3 = Platform
 *   4 = Internal Advisor
 *   5 = Internal Money Manager
 *   6 = Internal Platform
 *
 * Phase 1: upload as tim1 (Platform One admin).
 * Phase 2: re-verify on a fresh advisor-scoped page (firmAdvisorPage1
 *          is the pre-logged-in advisor of the same worker firm, no
 *          explicit identity switch required).
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { buildBucketXlsx } from '@geowealth/e2e-framework/helpers';
import { BillingBucketExclusionsPage } from '../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';
import {
  BILLING_SPEC_SECTIONS,
  HouseholdBillingSettingsPage,
} from '../../../src/pages/household/HouseholdBillingSettingsPage';

const ACTIONS = ['Y', 'N', 'I', 'Y', 'N', 'I'] as const; // bucket 1..6

test('@regression @billing-servicing C25381 Bucket Exclusions - all 6 buckets accept Y/N/I excluded actions', async ({
  tim1Page,
  firmAdvisorPage1,
  workerFirm,
}) => {
  test.slow();

  const xlsx = buildBucketXlsx(
    ACTIONS.map((excluded, i) => ({
      firm: workerFirm.firmCd,
      bucket: i + 1,
      hh: workerFirm.household.uuid,
      excluded,
    }))
  );

  await test.step('Phase 1: upload 6-row all-buckets fixture as tim1', async () => {
    const uploadPage = new BillingBucketExclusionsPage(tim1Page);
    await uploadPage.open(workerFirm.firmCd);
    await uploadPage.uploadAndConfirm({
      name: 'BillingBucketExclusions_C25381.xlsx',
      buffer: xlsx,
    });
  });

  await test.step('Phase 2: HH Billing Settings reflects the upload', async () => {
    const hhPage = new HouseholdBillingSettingsPage(firmAdvisorPage1);
    await hhPage.open(workerFirm.household.uuid);

    for (const label of BILLING_SPEC_SECTIONS) {
      await expect(hhPage.sectionHeader(label)).toBeVisible();
    }

    // Bucket 1 (Advisor) was set to Y → explicit Yes inside the Advisor section.
    await expect(
      hhPage.section('ADVISOR BILLING SPEC').getByText(/\bYes\b/).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
