/**
 * TestRail C25065 — Create new accounts using an upload file that contains
 *                   missing data
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25065
 *         (Run 175, label Pepi)
 *
 *   1. Open Create Account, select worker firm
 *   2. Upload xlsx where one row omits AccountOpenDate
 *   3. Submit → assert the parse error message surfaces
 *
 * The server's `ParseXlsUtils.dateFromCell()` throws
 * "Cell at row [X] and column [5] is null" for absent date cells.
 * This is wrapped as "Unable to parse line X in file due to: …".
 *
 * Isolation: tim1Page.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { CreateAccountPage } from '../../../src/pages/create-account/CreateAccountPage';
import { buildBulkAccountsXlsx } from '../../../src/helpers/build-bulk-accounts-xlsx';

test('@regression @billing-servicing C25065 Create new accounts with missing data in upload', async ({
  tim1Page,
  workerFirm,
}) => {
  test.fixme();
  test.setTimeout(180_000);

  const createAccount = new CreateAccountPage(tim1Page);
  const stamp = Date.now();

  const xlsxBuffer = buildBulkAccountsXlsx([
    {
      accountNumber: `PG${stamp}`,
      clientUuid: workerFirm.client.uuid,
      accountNickname: 'Pepi C25065 good row',
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      accountOpenDate: '2024-01-02',
      defaultMoneyOption: 'MMDA15',
    },
    {
      accountNumber: `PB${stamp}`,
      clientUuid: workerFirm.client.uuid,
      accountNickname: 'Pepi C25065 missing-date row',
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      // accountOpenDate intentionally omitted — server should reject.
      defaultMoneyOption: 'MMDA15',
    },
  ]);

  await test.step('Open Create Account, select worker firm', async () => {
    await createAccount.goto();
    await createAccount.selectFirm(workerFirm, { confirm: 'bulkUploadButton' });
  });

  await test.step('Open bulk upload and submit the bad xlsx', async () => {
    await createAccount.openBulkUploadModal();
    await createAccount.uploadXlsx(xlsxBuffer, 'BulkAccountsMissingData.xlsx');
  });

  await test.step('Assert the parse-error message surfaces', async () => {
    await expect(
      tim1Page.getByText(/Unable to parse line .* in file due to/i).first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
