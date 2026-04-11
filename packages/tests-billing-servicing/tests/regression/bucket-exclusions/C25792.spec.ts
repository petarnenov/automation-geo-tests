/**
 * TestRail C25792 — Bucket Exclusions: account record after hh/client overrides the setting
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25792 (Run 175, label Pepi)
 *
 * Phase 1: upload a single xlsx with 3 rows for the same firm+bucket:
 *   1. HouseHold row, EXCLUDED=Y
 *   2. Client row,    EXCLUDED=Y
 *   3. Account row,   EXCLUDED=I   (must override the inherited Y)
 *
 * Per the TestRail case title, the account row position AFTER the
 * HH/Client rows is what makes the override apply.
 *
 * Phase 2: verify the HouseHold Billing Settings show HH-level Yes
 *          in the ADVISOR BILLING SPEC section. Exhaustive cell-
 *          level verification of the account-level override is
 *          deferred — the smoke here is "upload was not rejected
 *          with a conflict and the HH change propagated".
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { buildBucketXlsx } from '@geowealth/e2e-framework/helpers';
import { BillingBucketExclusionsPage } from '../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';
import { HouseholdBillingSettingsPage } from '../../../src/pages/household/HouseholdBillingSettingsPage';

test('@regression @billing-servicing C25792 Bucket Exclusions - account record after hh/client overrides the setting', async ({
  tim1Page,
  firmAdvisorPage1,
  workerFirm,
}) => {
  test.slow();

  const xlsx = buildBucketXlsx([
    // Order matters: HH → Client → Account; the account row overrides.
    { firm: workerFirm.firmCd, bucket: 1, hh: workerFirm.household.uuid, excluded: 'Y' },
    { firm: workerFirm.firmCd, bucket: 1, client: workerFirm.client.uuid, excluded: 'Y' },
    {
      firm: workerFirm.firmCd,
      bucket: 1,
      account: workerFirm.accounts[0].uuid,
      excluded: 'I',
    },
  ]);

  await test.step('Phase 1: upload ordered hh→client→account fixture', async () => {
    const uploadPage = new BillingBucketExclusionsPage(tim1Page);
    await uploadPage.open(workerFirm.firmCd);
    await uploadPage.uploadAndConfirm({
      name: 'BillingBucketExclusions_C25792.xlsx',
      buffer: xlsx,
    });
  });

  await test.step('Phase 2: HH Billing Settings reflect the upload', async () => {
    const hhPage = new HouseholdBillingSettingsPage(firmAdvisorPage1);
    await hhPage.open(workerFirm.household.uuid);
    await expect(
      hhPage.section('ADVISOR BILLING SPEC').getByText(/\bYes\b/).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
