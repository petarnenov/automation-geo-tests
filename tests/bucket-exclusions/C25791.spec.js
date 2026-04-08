// @ts-check
/**
 * TestRail C25791 — Bucket Exclusions: 'Set All Accts to I' column is optional
 *   and defaults to N.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25791 (Run 175, label Pepi)
 * Refs:   GEO-20985
 *
 * Two sub-tests prove the column is optional:
 *   1. Upload a fixture WITHOUT the "Set All Accts to I" column → success.
 *   2. Upload a fixture WITH the column explicitly set to N → success.
 *
 * Both should produce identical outcomes (default behavior == N).
 */

const { test } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  uploadBillingBucketExclusions,
} = require('../_helpers/qa3');
const { buildBucketXlsx } = require('../_helpers/build-bucket-xlsx');

test('@pepi C25791 Bucket Exclusions - Set All Accts to I column is optional (column omitted)', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);

  const xlsx = buildBucketXlsx(
    [{ firm: workerFirm.firmCd, bucket: 1, hh: workerFirm.household.uuid, excluded: 'Y' }]
    /* includeSetAllAccts intentionally false */
  );

  await loginPlatformOneAdmin(page);
  await uploadBillingBucketExclusions(page, workerFirm.firmCd, xlsx);
});

test('@pepi C25791 Bucket Exclusions - Set All Accts to I column is optional (explicit N)', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);

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

  await loginPlatformOneAdmin(page);
  await uploadBillingBucketExclusions(page, workerFirm.firmCd, xlsx);
});
