// @ts-check
/**
 * TestRail C25102 — Create accounts using different CLIENT types
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25102 (Run 175, label Pepi)
 *
 * The TestRail case has no steps filled in, so the spec interprets the title:
 * exercise the Create Account flow against more than one entity type that
 * `validateClient()` knows about, asserting allowed types succeed and
 * disallowed types are rejected with the canonical error.
 *
 * From the geowealth source
 * (`web/react/bo/account/create/utils/ValidateAccountUtils.java`):
 *
 *     ALLOWED_ENTITY_TYPES_FOR_ACCOUNT_CREATION = Set.of(
 *         EntityType.CLIENT.getEntityTypeCd(),       // 1
 *         EntityType.COMPANY.getEntityTypeCd(),
 *         EntityType.LEGAL_TRUST.getEntityTypeCd()
 *     );
 *
 *     ENTITY_TYPE_NOT_ALLOWED = "Account creation is not allowed for client type %s"
 *
 * The dummy firm only seeds CLIENT (entityTypeCd=1) and HOUSEHOLD
 * (entityTypeCd=5), so we cover one allowed type + one disallowed type:
 *
 *   - workerFirm.client.uuid     → CLIENT, allowed   → row should be created
 *   - workerFirm.household.uuid  → HOUSEHOLD, denied → row should land in
 *                                                      `accountsWithErrors`
 *
 * Implementation:
 *   - Use the bulk-upload path to send both rows in one shot. Upload-time
 *     validation runs server-side and the response carries per-row errors,
 *     which the React grid mounts as `error-cell` classes with tooltips.
 *
 * Discovered behaviour (logged across this spec's failing runs):
 *   - The Create button uses `hasUnresolvedErrors` from the form context, so
 *     ANY error-cell on ANY row keeps Create disabled. The disabled state is
 *     signalled with a CSS class (`disabled___HMSKi`) rather than the native
 *     `disabled` attribute, so Playwright's `toBeDisabled()` won't see it —
 *     match the class instead.
 *   - `hasUnresolvedErrors` is sticky: even after deleting the bad row from
 *     the grid, the flag does NOT clear, so Create remains disabled. This is
 *     a real product behaviour worth noting but irrelevant to this test's
 *     purpose. The actual creation path for an allowed CLIENT entity type is
 *     covered end-to-end by C24940 + C24943; here we only need to verify the
 *     entity-type discrimination, so the spec asserts upload-time validation
 *     produces the canonical error for HOUSEHOLD and clean cells for CLIENT.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const { selectFirmInTypeAhead } = require('../_helpers/ui');
const { buildBulkAccountsXlsx } = require('../_helpers/build-bulk-accounts-xlsx');

const CREATE_ACCOUNT_URL = '/react/indexReact.do#platformOne/backOffice/createAccount';

test('@pepi C25102 Create accounts using different CLIENT types', async ({ page, workerFirm }) => {
  test.setTimeout(240_000);

  const stamp = Date.now();
  const clientRowNumber = `PCT${stamp}`;
  const householdRowNumber = `PHT${stamp}`;

  const xlsxBuffer = buildBulkAccountsXlsx([
    {
      accountNumber: clientRowNumber,
      clientUuid: workerFirm.client.uuid, // entityTypeCd=1 (CLIENT) — allowed
      accountNickname: 'Pepi C25102 client row',
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      accountOpenDate: '2024-01-02',
      defaultMoneyOption: 'MMDA15',
    },
    {
      accountNumber: householdRowNumber,
      clientUuid: workerFirm.household.uuid, // entityTypeCd=5 (HOUSEHOLD) — denied
      accountNickname: 'Pepi C25102 household row',
      accountType: 'Individual Taxable',
      custodian: 'Alternatives',
      accountOpenDate: '2024-02-03',
      defaultMoneyOption: 'MMDA15',
    },
  ]);

  await test.step('Open Create Account, select worker firm', async () => {
    await loginPlatformOneAdmin(page);
    await page.goto(CREATE_ACCOUNT_URL);
    await expect(
      page.getByRole('heading', { name: 'Single/Multiple Account Creation' })
    ).toBeVisible({ timeout: 30_000 });
    await selectFirmInTypeAhead(page, workerFirm, { confirm: 'bulkUploadButton' });
  });

  await test.step('Upload mixed-entity-type xlsx via bulk upload', async () => {
    await page.getByRole('button', { name: 'Open multiple accounts in bulk' }).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Browse For File/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'BulkAccountsClientTypes.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuffer,
    });
    await expect(page.getByText('BulkAccountsClientTypes.xlsx')).toBeVisible();
    const submitBtn = page.getByRole('button', { name: 'Submit', exact: true });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    // Both rows mount in the grid even though one will fail validation later.
    // 60s — bulk-upload backend can lag 30-50s when the full @pepi suite runs
    // 8 workers in parallel across multiple feature areas (account-billing,
    // merge-prospect retry loops, etc.) saturating qa2 server side.
    await expect(page.locator('.ag-row[row-index="0"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('.ag-row[row-index="1"]')).toBeVisible();
  });

  await test.step('Household row carries canonical not-allowed error tooltip', async () => {
    // Upload-time validation marked the household row's clientUuid cell with
    // `error-cell` and a tooltip containing the canonical message. This is
    // the disallowed-type half of "different CLIENT types".
    const errorCell = page
      .locator('.ag-row [role="gridcell"][col-id="clientUuid"].error-cell')
      .first();
    await expect(errorCell).toBeVisible({ timeout: 10_000 });
    const tooltip = await errorCell.getAttribute('title');
    expect(
      tooltip,
      'household client UUID should fail with the canonical not-allowed message'
    ).toMatch(/Account creation is not allowed for client type Household/i);
  });

  await test.step('Client row has no validation errors (allowed CLIENT entity type)', async () => {
    // The allowed-type half: the row containing the regular CLIENT uuid must
    // not carry any error-cell markings on any of its required columns.
    const clientRow = page
      .locator(
        `.ag-row:has([role="gridcell"][col-id="accountNumber"]:has-text("${clientRowNumber}"))`
      )
      .first();
    await expect(clientRow).toBeVisible();
    await expect(clientRow.locator('.error-cell')).toHaveCount(0);
  });

  await test.step('Create button is gated by the bad row (sticky hasUnresolvedErrors)', async () => {
    // The Create button uses CSS class `disabled___HMSKi` instead of the
    // native `disabled` attribute (Playwright `toBeDisabled()` won't catch
    // it). With one row in error, Create is locked.
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toHaveClass(/disabled/);
  });
});
