/**
 * TestRail C25790 — Bucket Exclusions: Set All Accts to I = N: HH-level upload accepted
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25790 (Run 175, label Pepi)
 * Refs:   GEO-20985
 *
 * Uploading a HouseHold-level row with the optional "Set All Accts
 * to I" column set to N should NOT propagate the Excluded change
 * down to the underlying accounts — unlike the Y variant exercised
 * by C25789.
 *
 * Phase 1: upload WITH the optional column included and set to N.
 * Phase 2: HH Billing Settings still loads cleanly (smoke). Per-row
 *          "no propagation" verification at the account level is
 *          left as a TODO — it would require a snapshot diff against
 *          the pre-upload state.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { buildBucketXlsx } from '@geowealth/e2e-framework/helpers';
import { BillingBucketExclusionsPage } from '../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';
import {
  BILLING_SPEC_SECTIONS,
  HouseholdBillingSettingsPage,
} from '../../../src/pages/household/HouseholdBillingSettingsPage';

test('@regression @billing-servicing C25790 Bucket Exclusions - Set All Accts to I = N: HH-level upload accepted', async ({
  tim1Page,
  firmAdvisorPage1,
  workerFirm,
}) => {
  test.slow();

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
    const uploadPage = new BillingBucketExclusionsPage(tim1Page);
    await uploadPage.open(workerFirm.firmCd);
    await uploadPage.uploadAndConfirm({
      name: 'BillingBucketExclusions_C25790.xlsx',
      buffer: xlsx,
    });
  });

  await test.step('Phase 2: HH Billing Settings still loads cleanly', async () => {
    const hhPage = new HouseholdBillingSettingsPage(firmAdvisorPage1);
    await hhPage.open(workerFirm.household.uuid);
    for (const label of BILLING_SPEC_SECTIONS) {
      await expect(hhPage.sectionHeader(label)).toBeVisible();
    }
  });
});
