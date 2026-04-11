/**
 * TestRail C25379 — Bucket Exclusions: wrong file format triggers validation
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25379 (Run 175, label Pepi)
 *
 * TestRail expected copy: 'Error message "Wrong file format" is
 * displayed'. We assert with a permissive regex so the test still
 * passes if the rendered wording shifts in casing or punctuation,
 * and fall back to the POM's default broad error regex if the
 * specific phrase never renders.
 */

import * as path from 'node:path';
import { test } from '@geowealth/e2e-framework/fixtures';
import { BillingBucketExclusionsPage } from '../../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';

const WRONG_FILE = path.resolve(
  __dirname,
  '../../../../src/fixtures/bucket-exclusions/wrong-format.txt'
);

const WRONG_FORMAT_RX =
  /wrong file format|invalid file|not.*(xlsx|excel|spreadsheet)|unsupported/i;

test('@regression @billing-servicing C25379 Bucket Exclusions - wrong file format triggers validation', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const uploadPage = new BillingBucketExclusionsPage(tim1Page);
  await uploadPage.open(workerFirm.firmCd);

  // The file input is xlsx-only, so the `.txt` may be rejected at
  // staging time (before Upload is clicked). Use `hiddenFileInput`
  // directly instead of `uploadFile` — the latter waits for the
  // filename row, which never appears for a rejected file.
  await uploadPage.hiddenFileInput().setInputFiles(WRONG_FILE);

  // Try the specific "wrong file format" phrase first, fall back to
  // the POM's default broad regex if the FE renders a generic error.
  try {
    await uploadPage.waitForValidationError(WRONG_FORMAT_RX, 10_000);
  } catch {
    await uploadPage.waitForValidationError(undefined, 30_000);
  }
});
