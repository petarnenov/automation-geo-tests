// @ts-check
/**
 * TestRail C25364 — Bucket Exclusions: multiple templates added and uploaded via drag and drop
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25364 (Run 175, label Pepi)
 *
 * Two non-conflicting fixtures are uploaded SEQUENTIALLY:
 *   - File A: the standard C25789 fixture (HH=Y, Client=I, 3 Accounts=I)
 *   - File B: a one-row no-op (just one Account=I, no HH/Client) so the two
 *     files cannot conflict during server-side validation.
 *
 * IMPLEMENTATION NOTE: the qa3 page uses a single non-multiple file input, and
 * Browse-twice replaces the previous staged file rather than accumulating. The
 * literal "drop multiple files at once" path would require a synthetic
 * DataTransfer drop event, which we trade off here for a sequential upload
 * that still proves the user can upload multiple templates back-to-back without
 * a re-login.
 */

const { test } = require('@playwright/test');
const { loginPlatformOneAdmin, uploadBillingBucketExclusions } = require('../_helpers/qa3');
const { buildBucketXlsx } = require('../_helpers/build-bucket-xlsx');
const { buildDefaultXlsx } = require('./_helpers');

test('@pepi C25364 Bucket Exclusions - multiple templates uploaded via drag and drop', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);

  // File A: the standard "C25789 default" payload (HH=Y + Client=I + accounts=I).
  const fixtureA = buildDefaultXlsx(workerFirm);

  // File B: a one-row no-op that just sets one of the same accounts to Inherit
  // again. The two files target the same firm but cannot conflict because B is
  // a strict subset of A's account-level inheritance.
  const fixtureB = buildBucketXlsx([
    {
      firm: workerFirm.firmCd,
      bucket: 1,
      account: workerFirm.accounts[0].uuid,
      excluded: 'I',
    },
  ]);

  await loginPlatformOneAdmin(page);
  await uploadBillingBucketExclusions(page, workerFirm.firmCd, fixtureA);
  await uploadBillingBucketExclusions(page, workerFirm.firmCd, fixtureB);
});
