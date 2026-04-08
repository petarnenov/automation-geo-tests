// @ts-check
/**
 * TestRail C24943 — Create new account using upload
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24943 (Run 175, label Pepi)
 *
 * Walks the bulk-upload path of the Platform One → Create Account page:
 *   1. Login as Platform One admin, open Create Account
 *   2. Pick the worker dummy firm
 *   3. Click "Open multiple accounts in bulk"
 *   4. The TestRail flow is "Download sample → fill it in → upload it back".
 *      We skip the round-trip and synthesize the xlsx in memory via
 *      build-bulk-accounts-xlsx.js, which produces the same column shape the
 *      sample template defines (verified by inspecting the on-disk template at
 *      `/docs/upload_samples/uploadAccounts/BulkAccountsTemplate.xlsx`).
 *   5. Browse for File → upload xlsx → Submit → assert rows appear in the grid
 *   6. Click Create → assert success modal "All accounts have been created
 *      successfully" → close
 *   7. Switch to advisor → navigate to client Accounts tab → assert both
 *      uploaded accounts appear there
 *
 * Implementation notes:
 *   - The upload modal is the standard FormBuilder UploadDocument view (same
 *     as the unmanaged-assets / billing-bucket exclusions modals), so the
 *     filechooser + Submit button shape matches existing helpers.
 *   - We upload TWO accounts so the test exercises the multi-row path; using
 *     a single row would also pass but is indistinguishable from C24940.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin, switchToAdvisor } = require('../_helpers/qa3');
const { selectFirmInTypeAhead } = require('../_helpers/ui');
const { buildBulkAccountsXlsx } = require('../_helpers/build-bulk-accounts-xlsx');

const CREATE_ACCOUNT_URL =
  '/react/indexReact.do#platformOne/backOffice/createAccount';

test('@pepi C24943 Create new account using upload', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

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

  await test.step('Open Create Account as Platform One admin', async () => {
    await loginPlatformOneAdmin(page);
    await page.goto(CREATE_ACCOUNT_URL);
    await expect(
      page.getByRole('heading', { name: 'Single/Multiple Account Creation' })
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Select the worker dummy firm', async () => {
    await selectFirmInTypeAhead(page, workerFirm);
  });

  await test.step('Open the bulk upload modal and upload the xlsx', async () => {
    await page
      .getByRole('button', { name: 'Open multiple accounts in bulk' })
      .click();
    // The "concatenate vs replace" picker only appears when the grid already
    // has rows. With a fresh page load there's no existing data, so the
    // upload modal opens immediately. If a confirmation modal does appear
    // (e.g. on retries), pick "Concatenate" — the safer of the two.
    try {
      await page
        .getByRole('button', { name: /concatenate/i })
        .click({ timeout: 2000 });
    } catch {
      // No confirmation prompt — modal opened straight to the upload view.
    }

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Browse For File/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'BulkAccounts.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuffer,
    });
    await expect(page.getByText('BulkAccounts.xlsx')).toBeVisible();

    const submitBtn = page.getByRole('button', { name: 'Submit', exact: true });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();
  });

  await test.step('Both rows appear in the Create Account grid', async () => {
    await expect(page.locator('.ag-row[row-index="0"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row[row-index="1"]')).toBeVisible();
    // Confirm both account numbers landed in the right cells.
    await expect(
      page.locator(
        `.ag-row [role="gridcell"][col-id="accountNumber"]:has-text("${accountNumberA}")`
      )
    ).toBeVisible();
    await expect(
      page.locator(
        `.ag-row [role="gridcell"][col-id="accountNumber"]:has-text("${accountNumberB}")`
      )
    ).toBeVisible();
  });

  await test.step('Click Create, confirm success modal', async () => {
    // Sanity check: no inline errors on the uploaded rows. If validation
    // failed during Submit, ag-grid marks the offending cells with the
    // `error-cell` class — surface that in the failure message rather than
    // letting the test time out waiting for a modal that will never appear.
    const errorCells = await page.locator('.ag-row .error-cell').all();
    if (errorCells.length > 0) {
      const details = [];
      for (const c of errorCells) {
        const colId = await c.getAttribute('col-id');
        const tooltip = await c.getAttribute('title');
        const text = (await c.innerText()).trim();
        details.push(`col=${colId} value="${text}" tooltip="${tooltip}"`);
      }
      throw new Error(
        `uploaded rows have validation errors:\n${details.join('\n')}`
      );
    }

    const createBtn = page.getByRole('button', { name: 'Create', exact: true });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();
    await expect(
      page.getByText(/All accounts have been created successfully/i)
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'OK', exact: true }).click();
  });

  await test.step('Switch to advisor, verify both accounts under the client', async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    await page.goto(
      `/react/indexReact.do#/client/1/${workerFirm.client.uuid}/accounts`
    );
    await expect(
      page.getByText(accountNumberA, { exact: false }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(accountNumberB, { exact: false }).first()
    ).toBeVisible();
  });
});
