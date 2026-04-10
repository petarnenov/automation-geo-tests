/**
 * TestRail C25102 — Create accounts using different CLIENT types
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25102
 *         (Run 175, label Pepi)
 *
 * Exercises entity-type discrimination on the Create Account page:
 *
 *   - workerFirm.client.uuid     → CLIENT (entityTypeCd=1), allowed
 *   - workerFirm.household.uuid  → HOUSEHOLD (entityTypeCd=5), denied
 *
 * Both rows are uploaded via bulk-upload. After upload-time validation:
 *   - The HOUSEHOLD row's clientUuid cell carries `error-cell` with the
 *     canonical tooltip "Account creation is not allowed for client type
 *     Household".
 *   - The CLIENT row has no error cells.
 *   - The Create button is disabled (sticky `hasUnresolvedErrors`).
 *
 * Isolation: tim1Page.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { CreateAccountPage } from '../../../src/pages/create-account/CreateAccountPage';
import { buildBulkAccountsXlsx } from '../../../src/helpers/build-bulk-accounts-xlsx';

test('@regression @billing-servicing C25102 Create accounts using different CLIENT types', async ({
  tim1Page,
  workerFirm,
}) => {
  test.fixme();
  test.setTimeout(240_000);

  const page = tim1Page;
  const createAccount = new CreateAccountPage(page);
  const stamp = Date.now();
  const clientRowNumber = `PCT${stamp}`;
  const householdRowNumber = `PHT${stamp}`;

  const xlsxBuffer = buildBulkAccountsXlsx([
    {
      accountNumber: clientRowNumber,
      clientUuid: workerFirm.client.uuid,
      accountNickname: 'Pepi C25102 client row',
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      accountOpenDate: '2024-01-02',
      defaultMoneyOption: 'MMDA15',
    },
    {
      accountNumber: householdRowNumber,
      clientUuid: workerFirm.household.uuid,
      accountNickname: 'Pepi C25102 household row',
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      accountOpenDate: '2024-02-03',
      defaultMoneyOption: 'MMDA15',
    },
  ]);

  await test.step('Open Create Account, select worker firm', async () => {
    await createAccount.goto();
    await createAccount.selectFirm(workerFirm, { confirm: 'bulkUploadButton' });
  });

  await test.step('Upload mixed-entity-type xlsx via bulk upload', async () => {
    await createAccount.openBulkUploadModal();
    await createAccount.uploadXlsx(xlsxBuffer, 'BulkAccountsClientTypes.xlsx');

    // Both rows mount in the grid.
    await expect(createAccount.row(0)).toBeVisible({ timeout: 60_000 });
    await expect(createAccount.row(1)).toBeVisible();
  });

  await test.step('Household row carries canonical not-allowed error tooltip', async () => {
    const errorCell = createAccount.errorCellInColumn('clientUuid').first();
    await expect(errorCell).toBeVisible({ timeout: 10_000 });
    const tooltip = await errorCell.getAttribute('title');
    expect(
      tooltip,
      'household client UUID should fail with the canonical not-allowed message'
    ).toMatch(/Account creation is not allowed for client type Household/i);
  });

  await test.step('Client row has no validation errors', async () => {
    const clientRow = page
      .locator(
        `.ag-row:has([role="gridcell"][col-id="accountNumber"]:has-text("${clientRowNumber}"))`
      )
      .first();
    await expect(clientRow).toBeVisible();
    await expect(clientRow.locator('.error-cell')).toHaveCount(0);
  });

  await test.step('Create button is gated by the bad row', async () => {
    await expect(createAccount.createButton).toHaveClass(/disabled/);
  });
});
