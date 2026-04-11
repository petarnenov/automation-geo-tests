/**
 * TestRail C25377 — Bucket Exclusions: correctly filled template uploaded via file explorer
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25377 (Run 175, label Pepi)
 *
 * Browse-For-File variant of C25363. Same default fixture, different
 * upload code path.
 */

import { test } from '@geowealth/e2e-framework/fixtures';
import { BillingBucketExclusionsPage } from '../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';
import { buildDefaultXlsx } from '../../../src/pages/bucket-exclusions/bucketExclusionFixtures';

test('@regression @billing-servicing C25377 Bucket Exclusions - correctly filled template uploaded via file explorer', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const uploadPage = new BillingBucketExclusionsPage(tim1Page);
  await uploadPage.open(workerFirm.firmCd);
  await uploadPage.uploadAndConfirm({
    name: 'BillingBucketExclusions_C25377.xlsx',
    buffer: buildDefaultXlsx(workerFirm),
  });
});
