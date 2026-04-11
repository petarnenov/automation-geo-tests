/**
 * TestRail C25793 — Bucket Exclusions: appropriate error message for
 *   invalid combinations or missing data
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25793 (Run 175, label Pepi)
 *
 * The TestRail case is intentionally broad ("invalid combinations or
 * missing data"). Three representative invalid combinations are
 * exercised that are NOT already covered by C25378 (single missing
 * required field) or C25380 (single wrong value):
 *
 *   1. A row with BOTH HouseHold UUID AND Account UUID populated
 *      (schema expects exactly one entity per row).
 *   2. An empty file (header row only, no data rows).
 *   3. EXCLUDED = "1" (numeric) instead of Y/N/I.
 *
 * Each sub-case is its own test() to prevent state contamination
 * from a lingering error modal or confirmation banner.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import {
  buildBucketXlsx,
  type BucketExclusionsRow,
} from '@geowealth/e2e-framework/helpers';
import type { Page } from '@playwright/test';
import { BillingBucketExclusionsPage } from '../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';
import type { WorkerFirm } from '@geowealth/e2e-framework/fixtures';

async function uploadAndExpectError(
  page: Page,
  workerFirm: WorkerFirm,
  rows: BucketExclusionsRow[],
  label: string
): Promise<void> {
  const uploadPage = new BillingBucketExclusionsPage(page);
  await uploadPage.open(workerFirm.firmCd);
  await uploadPage.uploadFile({
    name: `BillingBucketExclusions_C25793_${label}.xlsx`,
    buffer: buildBucketXlsx(rows),
  });

  // The error may render before Upload is clicked, or only after the
  // backend rejects it. Try both without failing if the first path
  // doesn't surface anything.
  let gotError = false;
  try {
    await uploadPage.waitForValidationError(undefined, 4_000);
    gotError = true;
  } catch {
    if (await uploadPage.uploadButton().isEnabled().catch(() => false)) {
      await uploadPage.clickUpload();
      await uploadPage.confirmProceedIfPresent(3_000);
    }
  }
  if (!gotError) {
    await uploadPage.waitForValidationError(undefined, 60_000);
  }

  // Make sure no success toast snuck through.
  await expect(uploadPage.successBanner()).toHaveCount(0, { timeout: 1_000 });
}

test('@regression @billing-servicing C25793 Bucket Exclusions - both HH and Account in same row triggers error', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();
  await uploadAndExpectError(
    tim1Page,
    workerFirm,
    [
      {
        firm: workerFirm.firmCd,
        bucket: 1,
        hh: workerFirm.household.uuid,
        account: workerFirm.accounts[0].uuid,
        excluded: 'Y',
      },
    ],
    'hh_and_account_together'
  );
});

test('@regression @billing-servicing C25793 Bucket Exclusions - empty data file (header only) triggers error', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();
  await uploadAndExpectError(tim1Page, workerFirm, [], 'empty');
});

test('@regression @billing-servicing C25793 Bucket Exclusions - numeric EXCLUDED value triggers error', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();
  await uploadAndExpectError(
    tim1Page,
    workerFirm,
    [
      {
        firm: workerFirm.firmCd,
        bucket: 1,
        hh: workerFirm.household.uuid,
        excluded: '1',
      },
    ],
    'numeric_excluded'
  );
});
