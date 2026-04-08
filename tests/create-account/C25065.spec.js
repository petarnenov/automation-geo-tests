// @ts-check
/**
 * TestRail C25065 — Create new accounts using an upload file that contains
 *                   missing data
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25065 (Run 175, label Pepi)
 *
 *   1. Login as Platform One admin, open Create Account
 *   2. Pick the worker firm
 *   3. Open the bulk upload modal
 *   4. Upload an xlsx where one row is missing a required column
 *   5. Submit → assert the parse error surfaces
 *
 * Implementation notes:
 *   - We omit the **AccountOpenDate** cell (column F, index 5) of the second
 *     row because it's the only column for which the parser actually throws a
 *     ParseXlsException with a missing-cell message:
 *     `dateFromCell()` calls `getCellAtIndex()` which returns null for an
 *     absent cell, then throws "Cell at row [X] and column [5] is null".
 *     Other columns just return null from `stringFromCell()` and become
 *     downstream validation errors instead of parse errors.
 *     Verified in `src/main/java/com/geowealth/web/react/bo/account/create/utils/ParseXlsUtils.java`.
 *   - The error is wrapped by `CreateAccountAction` as
 *     `"Unable to parse line X in file due to: ..."` and bubbled to the UI as
 *     a fail() response. The TestRail expected wording "Missing data in
 *     column X" is loose phrasing of this same message — we match the exact
 *     prefix with a regex.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const { selectFirmInTypeAhead } = require('../_helpers/ui');
const { buildBulkAccountsXlsx } = require('../_helpers/build-bulk-accounts-xlsx');

const CREATE_ACCOUNT_URL = '/react/indexReact.do#platformOne/backOffice/createAccount';

test('@pepi C25065 Create new accounts using an upload file with missing data', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);

  const stamp = Date.now();
  const goodNumber = `PG${stamp}`;
  const badNumber = `PB${stamp}`;

  // Row 1: complete + valid. Row 2: omit accountOpenDate so the parser throws
  // ParseXlsException for the missing column F cell. The omit happens because
  // build-bulk-accounts-xlsx.js skips cells whose value is null/undefined.
  const xlsxBuffer = buildBulkAccountsXlsx([
    {
      accountNumber: goodNumber,
      clientUuid: workerFirm.client.uuid,
      accountNickname: 'Pepi C25065 good row',
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      accountOpenDate: '2024-01-02',
      defaultMoneyOption: 'MMDA15',
    },
    {
      accountNumber: badNumber,
      clientUuid: workerFirm.client.uuid,
      accountNickname: 'Pepi C25065 missing-date row',
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      // accountOpenDate intentionally omitted — server should reject this row.
      defaultMoneyOption: 'MMDA15',
    },
  ]);

  await test.step('Open Create Account as Platform One admin', async () => {
    await loginPlatformOneAdmin(page);
    await page.goto(CREATE_ACCOUNT_URL);
    await expect(
      page.getByRole('heading', { name: 'Single/Multiple Account Creation' })
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Select the worker dummy firm', async () => {
    await selectFirmInTypeAhead(page, workerFirm, { confirm: 'bulkUploadButton' });
  });

  await test.step('Open the bulk upload modal and submit the bad xlsx', async () => {
    await page.getByRole('button', { name: 'Open multiple accounts in bulk' }).click();
    // No "reset vs keep" prompt because the grid is empty.

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Browse For File/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'BulkAccountsMissingData.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuffer,
    });
    await expect(page.getByText('BulkAccountsMissingData.xlsx')).toBeVisible();

    const submitBtn = page.getByRole('button', { name: 'Submit', exact: true });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();
  });

  await test.step('Assert the parse-error message surfaces', async () => {
    // The fail() response from CreateAccountAction.parseFile() is shown as a
    // toast/notification by the UploadDocument modal. The exact wording is
    // "Unable to parse line 3 in file due to: Cell at row [2] and column [5]
    // is null" — we don't pin the exact line/column to keep the test resilient
    // to template-row reorders.
    await expect(page.getByText(/Unable to parse line .* in file due to/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
