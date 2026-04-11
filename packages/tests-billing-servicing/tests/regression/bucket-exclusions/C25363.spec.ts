/**
 * TestRail C25363 — Bucket Exclusions: correctly filled template uploaded via drag and drop
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25363 (Run 175, label Pepi)
 *
 * Uses the drop-zone code path (`uploadFileViaDropZone`) so the test
 * exercises the `react-dnd-html5-backend` handler, not just the
 * Browse-For-File filechooser. The legacy POC documented this as
 * functionally equivalent at the React handler level, but TestRail
 * specifies the click source, so the POM distinguishes the two.
 *
 * Reuses the "C25789 default" row shape: HH Excluded=Y on bucket 1
 * with underlying Client and every Account set to Inherit.
 */

import { test } from '@geowealth/e2e-framework/fixtures';
import { BillingBucketExclusionsPage } from '../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';
import { buildDefaultXlsx } from '../../../src/pages/bucket-exclusions/bucketExclusionFixtures';

test('@regression @billing-servicing C25363 Bucket Exclusions - correctly filled template uploaded via drag and drop', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const uploadPage = new BillingBucketExclusionsPage(tim1Page);
  await uploadPage.open(workerFirm.firmCd);
  await uploadPage.uploadFileViaDropZone({
    name: 'BillingBucketExclusions_C25363.xlsx',
    buffer: buildDefaultXlsx(workerFirm),
  });
  await uploadPage.clickUpload();
  await uploadPage.confirmProceedIfPresent();
  await uploadPage.waitForImportSuccess();
  await uploadPage.dismissSuccessModal();
});
