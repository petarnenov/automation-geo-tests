/**
 * TestRail C25791 — Bucket Exclusions: Set All Accts to I column is optional
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25791 (Run 175, label Pepi)
 * Refs:   GEO-20985
 *
 * Two sub-tests prove the "Set All Accts to I" column is optional
 * and defaults to N:
 *
 *   1. Upload WITHOUT the 7th column → success.
 *   2. Upload WITH the column explicitly set to N → same success.
 *
 * Both must produce identical outcomes.
 */

import { test } from '@geowealth/e2e-framework/fixtures';
import { buildBucketXlsx } from '@geowealth/e2e-framework/helpers';
import { BillingBucketExclusionsPage } from '../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';

test('@regression @billing-servicing C25791 Bucket Exclusions - Set All Accts to I column is optional (column omitted)', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const xlsx = buildBucketXlsx([
    { firm: workerFirm.firmCd, bucket: 1, hh: workerFirm.household.uuid, excluded: 'Y' },
  ]); // includeSetAllAccts intentionally omitted

  const uploadPage = new BillingBucketExclusionsPage(tim1Page);
  await uploadPage.open(workerFirm.firmCd);
  await uploadPage.uploadAndConfirm({
    name: 'BillingBucketExclusions_C25791_omitted.xlsx',
    buffer: xlsx,
  });
});

test('@regression @billing-servicing C25791 Bucket Exclusions - Set All Accts to I column is optional (explicit N)', async ({
  tim1Page,
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

  const uploadPage = new BillingBucketExclusionsPage(tim1Page);
  await uploadPage.open(workerFirm.firmCd);
  await uploadPage.uploadAndConfirm({
    name: 'BillingBucketExclusions_C25791_explicitN.xlsx',
    buffer: xlsx,
  });
});
