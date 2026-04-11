// @ts-check
/**
 * TestRail C24997 — Create new accounts using grid input AND bulk upload
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24997 (Run 175, label Pepi)
 *
 * Exercises both branches of the upload-confirmation modal that fires when
 * the user already has rows in the grid:
 *
 *   Phase A — "No, keep them": existing manual rows are kept and the
 *             uploaded rows are appended. Both account sets get created.
 *   Phase B — "Yes, Reset": existing manual rows are wiped and the grid is
 *             replaced by the uploaded rows only. Only uploaded accounts get
 *             created; the manual one is dropped.
 *
 * Implementation notes:
 *   - The confirmation modal source
 *     (`pages/Components/UploadOAButton/_hooks/useUploadConfirmationModal.js`)
 *     uses `closeTxt: 'No, keep them'` → `onConcatenate` and
 *     `confirmTxt: 'Yes, Reset'` → `onReplace`. The modal only shows when
 *     `hasExistingData=true`, which is why Phase A needs the manual row
 *     filled in BEFORE clicking the bulk upload button.
 *   - We use distinct account-number prefixes per phase so the advisor-portal
 *     verification can tell which row was supposed to be created vs dropped.
 *   - Both phases reuse the workerFirm — accounts accumulate by design (see
 *     `feedback_dummy_firm_cleanup.md`).
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin, switchToAdvisor } = require('../_helpers/qa3');
const {
  selectFirmInTypeAhead,
  setAgGridText,
  setAgGridRichSelect,
  setAgGridDate,
  pickFirstAgGridRichSelect,
} = require('../_helpers/ui');
const { buildBulkAccountsXlsx } = require('../_helpers/build-bulk-accounts-xlsx');

const CREATE_ACCOUNT_URL = '/react/indexReact.do#platformOne/backOffice/createAccount';

/**
 * Add a manual row with the given account number, populating every required
 * field. Mirrors the C24940 happy path.
 */
async function fillManualRow(page, workerFirm, accountNumber, nickname) {
  await page.getByRole('button', { name: 'Add New Row' }).click();
  await expect(page.locator('.ag-row[row-index="0"]')).toBeVisible({
    timeout: 5000,
  });
  await setAgGridText(page, 0, 'accountNumber', accountNumber);
  await setAgGridText(page, 0, 'clientUuid', workerFirm.client.uuid);
  await setAgGridText(page, 0, 'accountNickname', nickname);
  await setAgGridRichSelect(page, 0, 'accountTypeCd', 'Individual Taxable');
  await setAgGridRichSelect(page, 0, 'eBrokerCd', 'Manual Input');
  await setAgGridDate(page, 0, 'accountOpenDate', '01/02/2024');
  await pickFirstAgGridRichSelect(page, 0, 'defaultMoneyOptionId');
}

/**
 * Open the bulk upload modal and pick a branch on the confirmation prompt.
 * @param {import('@playwright/test').Page} page
 * @param {'keep' | 'reset'} mode
 */
async function openBulkUpload(page, mode) {
  await page.getByRole('button', { name: 'Open multiple accounts in bulk' }).click();
  // The reset/keep prompt only appears when the grid already has rows.
  await expect(page.getByText(/Would you like to reset grid rows before uploading/i)).toBeVisible({
    timeout: 5000,
  });
  if (mode === 'keep') {
    // Heads up: the modal renders `closeTxt` as a `<a>` (role=link), not a
    // button. Verified via the failure snapshot for the first run of this
    // spec — Playwright's getByRole('button', …) does NOT match.
    await page.getByRole('link', { name: 'No, keep them', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Yes, Reset', exact: true }).click();
  }
}

/**
 * Stage and submit the upload xlsx in the FormBuilder UploadDocument modal.
 */
async function uploadXlsx(page, buffer, displayName) {
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Browse For File/i }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: displayName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await expect(page.getByText(displayName)).toBeVisible();
  const submitBtn = page.getByRole('button', { name: 'Submit', exact: true });
  await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
  await submitBtn.click();
}

async function clickCreateAndConfirm(page) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText(/All accounts have been created successfully/i)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
}

test('@pepi C24997 Create new accounts using grid input and bulk upload', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(360_000);

  const stamp = Date.now();
  // Phase A account numbers
  const aManual = `PMA${stamp}`;
  const aUpload = `PUA${stamp}`;
  // Phase B account numbers
  const bManual = `PMB${stamp}`;
  const bUpload = `PUB${stamp}`;

  const baseRow = (accountNumber, nickname, dateStr) => ({
    accountNumber,
    clientUuid: workerFirm.client.uuid,
    accountNickname: nickname,
    accountType: 'Individual Taxable',
    custodian: 'Alternatives', // see project_create_account_specifics.md
    accountOpenDate: dateStr,
    defaultMoneyOption: 'MMDA15',
  });
  const phaseAXlsx = buildBulkAccountsXlsx([
    baseRow(aUpload, 'Pepi C24997 A upload', '2024-01-02'),
  ]);
  const phaseBXlsx = buildBulkAccountsXlsx([
    baseRow(bUpload, 'Pepi C24997 B upload', '2024-02-03'),
  ]);

  // ── PHASE A: keep manual row, append uploaded row ────────────────────────
  await test.step('Phase A: open Create Account, select firm, add manual row', async () => {
    await loginPlatformOneAdmin(page);
    await page.goto(CREATE_ACCOUNT_URL);
    await expect(
      page.getByRole('heading', { name: 'Single/Multiple Account Creation' })
    ).toBeVisible({ timeout: 30_000 });
    await selectFirmInTypeAhead(page, workerFirm, { confirm: 'bulkUploadButton' });
    await fillManualRow(page, workerFirm, aManual, 'Pepi C24997 A manual');
  });

  await test.step('Phase A: bulk upload with "No, keep them", grid has both rows', async () => {
    await openBulkUpload(page, 'keep');
    await uploadXlsx(page, phaseAXlsx, 'PhaseA.xlsx');
    await expect(page.locator('.ag-row[row-index="0"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row[row-index="1"]')).toBeVisible();
    await expect(
      page.locator(`.ag-row [role="gridcell"][col-id="accountNumber"]:has-text("${aManual}")`)
    ).toBeVisible();
    await expect(
      page.locator(`.ag-row [role="gridcell"][col-id="accountNumber"]:has-text("${aUpload}")`)
    ).toBeVisible();
  });

  await test.step('Phase A: Create both accounts', async () => {
    await clickCreateAndConfirm(page);
  });

  // ── PHASE B: reset manual row, only uploaded row remains ─────────────────
  await test.step('Phase B: re-open Create Account, add a fresh manual row', async () => {
    await page.goto(CREATE_ACCOUNT_URL);
    // Wait for the page heading + firm typeAhead so the SPA has finished
    // booting before we drive the firm picker. Without this wait, the second
    // navigation can race the picker bind and the option click silently
    // no-ops.
    await expect(
      page.getByRole('heading', { name: 'Single/Multiple Account Creation' })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#firmCd_typeAhead')).toBeVisible();
    await selectFirmInTypeAhead(page, workerFirm, { confirm: 'bulkUploadButton' });
    await fillManualRow(page, workerFirm, bManual, 'Pepi C24997 B manual');
  });

  await test.step('Phase B: bulk upload with "Yes, Reset", grid has only the uploaded row', async () => {
    await openBulkUpload(page, 'reset');
    await uploadXlsx(page, phaseBXlsx, 'PhaseB.xlsx');
    await expect(page.locator('.ag-row[row-index="0"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row[row-index="1"]')).toBeHidden();
    // The manual row's account number must NOT be in the grid.
    await expect(
      page.locator(`.ag-row [role="gridcell"][col-id="accountNumber"]:has-text("${bManual}")`)
    ).toHaveCount(0);
    await expect(
      page.locator(`.ag-row [role="gridcell"][col-id="accountNumber"]:has-text("${bUpload}")`)
    ).toBeVisible();
  });

  await test.step('Phase B: Create the uploaded account', async () => {
    await clickCreateAndConfirm(page);
  });

  // ── Verification: advisor portal sees A-manual, A-upload, B-upload (NOT B-manual)
  await test.step('Switch to advisor, verify all created accounts are present', async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    await page.goto(`/react/indexReact.do#/client/1/${workerFirm.client.uuid}/accounts`);
    await expect(page.getByText(aManual, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(aUpload, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(bUpload, { exact: false }).first()).toBeVisible();
    // The dropped manual row from Phase B must NOT exist on the advisor side.
    await expect(page.getByText(bManual, { exact: false })).toHaveCount(0);
  });
});
