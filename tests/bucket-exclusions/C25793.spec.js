// @ts-check
/**
 * TestRail C25793 — Bucket Exclusions: appropriate error message for invalid
 *   combinations or missing data.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25793 (Run 175, label Pepi)
 *
 * The case description is intentionally broad ("invalid combinations or
 * missing data"). We exercise three representative invalid combinations that
 * are not already covered by C25378 (single missing required field) or C25380
 * (single wrong value):
 *
 *   1. A row with BOTH HouseHold UUID AND Account UUID populated (the schema
 *      expects exactly one entity per row).
 *   2. An empty file (no data rows) — header row only.
 *   3. EXCLUDED is set to a digit ("1") instead of Y/N/I.
 *
 * Each sub-case is its own test() to keep state contamination from leaking.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const { validationErrorRegex } = require('../_helpers/ui');
const { buildBucketXlsx } = require('../_helpers/build-bucket-xlsx');

const ERROR_RX = validationErrorRegex('empty', 'combination');
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function uploadAndExpectError(page, workerFirm, rows, label) {
  test.setTimeout(180_000);
  const xlsx = buildBucketXlsx(rows);
  const uploadUrl = `/react/indexReact.do#platformOne/uploadTools/bulkExclusions/billingBucketExclusions/${workerFirm.firmCd}`;

  await loginPlatformOneAdmin(page);
  await page.goto(uploadUrl);
  await expect(page.getByRole('textbox').first()).toHaveValue(
    new RegExp(`\\(${workerFirm.firmCd}\\)`),
    { timeout: 30_000 }
  );

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse For File' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: `C25793_${label}.xlsx`,
    mimeType: XLSX_MIME,
    buffer: xlsx,
  });

  let immediate = false;
  try {
    await expect(page.getByText(ERROR_RX).first()).toBeVisible({ timeout: 4000 });
    immediate = true;
  } catch {
    const uploadBtn = page.getByRole('button', { name: 'Upload', exact: true });
    if (await uploadBtn.isEnabled().catch(() => false)) {
      await uploadBtn.click();
      try {
        await page
          .getByRole('button', { name: 'Yes, Proceed' })
          .click({ timeout: 3000 });
      } catch {
        /* none */
      }
    }
  }

  if (!immediate) {
    await expect(page.getByText(ERROR_RX).first()).toBeVisible({ timeout: 60_000 });
  }

  await expect(page.getByText(/imported successfully/i)).toHaveCount(0, {
    timeout: 1000,
  });
}

test('@pepi C25793 Bucket Exclusions - both HH and Account in same row triggers error', async ({
  page,
  workerFirm,
}) => {
  await uploadAndExpectError(
    page,
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

test('@pepi C25793 Bucket Exclusions - empty data file (header only) triggers error', async ({
  page,
  workerFirm,
}) => {
  await uploadAndExpectError(page, workerFirm, [], 'empty');
});

test('@pepi C25793 Bucket Exclusions - numeric EXCLUDED value triggers error', async ({
  page,
  workerFirm,
}) => {
  await uploadAndExpectError(
    page,
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
