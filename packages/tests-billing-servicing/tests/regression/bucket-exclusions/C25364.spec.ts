/**
 * TestRail C25364 — Bucket Exclusions: multiple templates uploaded via drag and drop
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25364 (Run 175, label Pepi)
 *
 * Two non-conflicting fixtures are uploaded SEQUENTIALLY:
 *   - File A: the standard C25789 default (HH=Y, Client=I, 3 Accounts=I)
 *   - File B: a one-row no-op (just one Account=I) so the files cannot
 *             conflict server-side.
 *
 * The FE `FileUpload` field is not `multiple`, so Browse-twice replaces
 * the previous staged file rather than accumulating. The legacy POC
 * calls this out and uploads sequentially — we do the same, which
 * also proves the session can run back-to-back uploads without a
 * re-login (the confirmation modal is first-time-only).
 */

import { test } from '@geowealth/e2e-framework/fixtures';
import { buildBucketXlsx } from '@geowealth/e2e-framework/helpers';
import { BillingBucketExclusionsPage } from '../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';
import { buildDefaultXlsx } from '../../../src/pages/bucket-exclusions/bucketExclusionFixtures';

test('@regression @billing-servicing C25364 Bucket Exclusions - multiple templates uploaded via drag and drop', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const uploadPage = new BillingBucketExclusionsPage(tim1Page);

  const fixtureA = buildDefaultXlsx(workerFirm);
  const fixtureB = buildBucketXlsx([
    {
      firm: workerFirm.firmCd,
      bucket: 1,
      account: workerFirm.accounts[0].uuid,
      excluded: 'I',
    },
  ]);

  await uploadPage.open(workerFirm.firmCd);
  await uploadPage.uploadAndConfirm({
    name: 'BillingBucketExclusions_C25364_A.xlsx',
    buffer: fixtureA,
  });
  await uploadPage.uploadAndConfirm({
    name: 'BillingBucketExclusions_C25364_B.xlsx',
    buffer: fixtureB,
  });
});
