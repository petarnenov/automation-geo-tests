/**
 * TestRail C24943 — Create new account using upload
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24943
 *         (Run 175, label Pepi)
 *
 * Walks the bulk-upload path:
 *   1. Open Create Account, select worker firm
 *   2. Open bulk upload modal, upload xlsx with 2 accounts
 *   3. Assert both rows appear in the grid
 *   4. Click Create → success modal
 *   5. Switch to advisor → verify both accounts under the client
 *
 * Isolation: tim1Page — each worker has its own firm.
 */

import { test, expect, clearAndLoginAs } from '@geowealth/e2e-framework/fixtures';
import { selectEnvironment } from '@geowealth/e2e-framework/config';
import { CreateAccountPage } from '../../../src/pages/create-account/CreateAccountPage';
import { buildBulkAccountsXlsx } from '../../../src/helpers/build-bulk-accounts-xlsx';

test('@regression @billing-servicing C24943 Create new account using upload', async ({
  tim1Page,
  workerFirm,
}) => {
  test.fixme();
  test.setTimeout(240_000);

  const page = tim1Page;
  const createAccount = new CreateAccountPage(page);
  const stamp = Date.now();
  const accountNumberA = `PUA${stamp}`;
  const accountNumberB = `PUB${stamp}`;

  const xlsxBuffer = buildBulkAccountsXlsx([
    {
      accountNumber: accountNumberA,
      clientUuid: workerFirm.client.uuid,
      accountNickname: `Pepi C24943 A ${stamp.toString().slice(-6)}`,
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      accountOpenDate: '2024-01-02',
      defaultMoneyOption: 'MMDA15',
    },
    {
      accountNumber: accountNumberB,
      clientUuid: workerFirm.client.uuid,
      accountNickname: `Pepi C24943 B ${stamp.toString().slice(-6)}`,
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      accountOpenDate: '2024-02-03',
      defaultMoneyOption: 'MMDA15',
    },
  ]);

  await test.step('Open Create Account, select worker firm', async () => {
    await createAccount.goto();
    await createAccount.selectFirm(workerFirm);
  });

  await test.step('Open the bulk upload modal and upload the xlsx', async () => {
    await createAccount.openBulkUploadModal();
    await createAccount.uploadXlsx(xlsxBuffer, 'BulkAccounts.xlsx');
  });

  await test.step('Both rows appear in the grid', async () => {
    await expect(createAccount.row(0)).toBeVisible({ timeout: 30_000 });
    await expect(createAccount.row(1)).toBeVisible();
    await expect(createAccount.cellWithText('accountNumber', accountNumberA)).toBeVisible();
    await expect(createAccount.cellWithText('accountNumber', accountNumberB)).toBeVisible();
  });

  await test.step('Click Create, confirm success modal', async () => {
    // Sanity: no inline errors on uploaded rows.
    const errorCells = await createAccount.errorCells().all();
    if (errorCells.length > 0) {
      const details: string[] = [];
      for (const c of errorCells) {
        const colId = await c.getAttribute('col-id');
        const tooltip = await c.getAttribute('title');
        const text = (await c.innerText()).trim();
        details.push(`col=${colId} value="${text}" tooltip="${tooltip}"`);
      }
      throw new Error(`uploaded rows have validation errors:\n${details.join('\n')}`);
    }
    await createAccount.createAndConfirmSuccess();
  });

  await test.step('Switch to advisor, verify both accounts under the client', async () => {
    const env = selectEnvironment();
    await clearAndLoginAs(
      page,
      page.context(),
      workerFirm.advisor.loginName,
      workerFirm.password,
      env.baseUrl
    );
    await page.goto(`/react/indexReact.do#/client/1/${workerFirm.client.uuid}/accounts`);
    await expect(page.getByText(accountNumberA, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(accountNumberB, { exact: false }).first()).toBeVisible();
  });
});
