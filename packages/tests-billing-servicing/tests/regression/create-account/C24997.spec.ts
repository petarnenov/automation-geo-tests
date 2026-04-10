/**
 * TestRail C24997 — Create new accounts using grid input AND bulk upload
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24997
 *         (Run 175, label Pepi)
 *
 * Exercises both branches of the upload-confirmation modal:
 *
 *   Phase A — "No, keep them": existing manual row is kept, uploaded row
 *             appended. Both account sets get created.
 *
 *   Phase B — "Yes, Reset": existing manual row is wiped, grid replaced
 *             by uploaded rows only. Dropped manual account must NOT
 *             appear in advisor portal.
 *
 * Isolation: tim1Page — accounts accumulate by design.
 */

import { test, expect, clearAndLoginAs } from '@geowealth/e2e-framework/fixtures';
import { selectEnvironment } from '@geowealth/e2e-framework/config';
import { CreateAccountPage } from '../../../src/pages/create-account/CreateAccountPage';
import { buildBulkAccountsXlsx } from '../../../src/helpers/build-bulk-accounts-xlsx';

test('@regression @billing-servicing C24997 Create new accounts using grid input and bulk upload', async ({
  tim1Page,
  workerFirm,
}) => {
  test.fixme();
  test.setTimeout(360_000);

  const page = tim1Page;
  const createAccount = new CreateAccountPage(page);
  const stamp = Date.now();

  // Phase A account numbers
  const aManual = `PMA${stamp}`;
  const aUpload = `PUA${stamp}`;
  // Phase B account numbers
  const bManual = `PMB${stamp}`;
  const bUpload = `PUB${stamp}`;

  const makeRow = (accountNumber: string, nickname: string, dateStr: string) => ({
    accountNumber,
    clientUuid: workerFirm.client.uuid,
    accountNickname: nickname,
    accountType: 'Individual Taxable',
    custodian: 'Alternatives',
    accountOpenDate: dateStr,
    defaultMoneyOption: 'MMDA15',
  });

  const phaseAXlsx = buildBulkAccountsXlsx([makeRow(aUpload, 'Pepi C24997 A upload', '2024-01-02')]);
  const phaseBXlsx = buildBulkAccountsXlsx([makeRow(bUpload, 'Pepi C24997 B upload', '2024-02-03')]);

  // ── Phase A: keep manual row, append uploaded row ─────────────────────

  await test.step('Phase A: open Create Account, select firm, add manual row', async () => {
    await createAccount.goto();
    await createAccount.selectFirm(workerFirm, { confirm: 'bulkUploadButton' });
    await createAccount.addNewRow();
    await createAccount.fillRow(0, {
      accountNumber: aManual,
      clientUuid: workerFirm.client.uuid,
      accountNickname: 'Pepi C24997 A manual',
      accountType: 'Individual Taxable',
      custodian: 'Manual Input',
      openDate: '01/02/2024',
    });
  });

  await test.step('Phase A: bulk upload with "No, keep them", grid has both rows', async () => {
    await createAccount.openBulkUploadModal('keep');
    await createAccount.uploadXlsx(phaseAXlsx, 'PhaseA.xlsx');
    await expect(createAccount.row(0)).toBeVisible({ timeout: 30_000 });
    await expect(createAccount.row(1)).toBeVisible();
    await expect(createAccount.cellWithText('accountNumber', aManual)).toBeVisible();
    await expect(createAccount.cellWithText('accountNumber', aUpload)).toBeVisible();
  });

  await test.step('Phase A: Create both accounts', async () => {
    await createAccount.createAndConfirmSuccess();
  });

  // ── Phase B: reset manual row, only uploaded row remains ──────────────

  await test.step('Phase B: re-open Create Account, add a fresh manual row', async () => {
    await createAccount.goto();
    await expect(page.locator('#firmCd_typeAhead')).toBeVisible();
    await createAccount.selectFirm(workerFirm, { confirm: 'bulkUploadButton' });
    await createAccount.addNewRow();
    await createAccount.fillRow(0, {
      accountNumber: bManual,
      clientUuid: workerFirm.client.uuid,
      accountNickname: 'Pepi C24997 B manual',
      accountType: 'Individual Taxable',
      custodian: 'Manual Input',
      openDate: '01/02/2024',
    });
  });

  await test.step('Phase B: bulk upload with "Yes, Reset", grid has only uploaded row', async () => {
    await createAccount.openBulkUploadModal('reset');
    await createAccount.uploadXlsx(phaseBXlsx, 'PhaseB.xlsx');
    await expect(createAccount.row(0)).toBeVisible({ timeout: 30_000 });
    await expect(createAccount.row(1)).not.toBeVisible();
    await expect(createAccount.cellWithText('accountNumber', bManual)).toHaveCount(0);
    await expect(createAccount.cellWithText('accountNumber', bUpload)).toBeVisible();
  });

  await test.step('Phase B: Create the uploaded account', async () => {
    await createAccount.createAndConfirmSuccess();
  });

  // ── Verification ──────────────────────────────────────────────────────

  await test.step('Switch to advisor, verify all created accounts present', async () => {
    const env = selectEnvironment();
    await clearAndLoginAs(
      page,
      page.context(),
      workerFirm.advisor.loginName,
      workerFirm.password,
      env.baseUrl
    );
    await page.goto(`/react/indexReact.do#/client/1/${workerFirm.client.uuid}/accounts`);
    await expect(page.getByText(aManual, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(aUpload, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(bUpload, { exact: false }).first()).toBeVisible();
    // Dropped manual row from Phase B must NOT exist.
    await expect(page.getByText(bManual, { exact: false })).toHaveCount(0);
  });
});
