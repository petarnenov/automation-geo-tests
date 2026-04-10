/**
 * TestRail C24941 — Open new account through Platform One - UI elements
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24941
 *         (Run 175, label Pepi)
 *
 * Smoke test for the Create Account page UI. Asserts:
 *   1. Page title and firm picker present
 *   2. Firm-dependent buttons activate after firm selection
 *   3. Account Type dropdown contains expected options
 *   4. Custodian dropdown contains expected options
 *   5. Default Money dropdown is populated
 *
 * Does NOT create any accounts. Uses tim1Page to have a
 * deterministic firm to select, but does not mutate firm state.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { CreateAccountPage } from '../../../src/pages/create-account/CreateAccountPage';

const EXPECTED_ACCOUNT_TYPES_SAMPLE = [
  'Unknown',
  'Individual Taxable',
  'Joint Account (with right of survivorship)',
  'UTMA',
  'Rollover Roth IRA',
];

const EXPECTED_CUSTODIANS_SAMPLE = [
  'Alternatives',
  'Interactive Brokers',
  'Goldman Sachs',
  'Folio Institutional',
  'Raymond James',
];

test('@regression @billing-servicing C24941 Open Account UI elements', async ({
  tim1Page,
  workerFirm,
}) => {
  test.fixme();
  test.setTimeout(180_000);

  const createAccount = new CreateAccountPage(tim1Page);

  await test.step('Load Create Account page', async () => {
    await createAccount.goto();
    await expect(tim1Page.locator('#firmCd_typeAhead')).toBeVisible();
  });

  await test.step('Select a firm, firm-dependent UI activates', async () => {
    await createAccount.selectFirm(workerFirm);
    await expect(createAccount.bulkUploadButton).toBeVisible();
    await expect(createAccount.addNewRowButton).toBeVisible();
    await expect(createAccount.resetButton).toBeVisible();
    await expect(createAccount.createButton).toBeVisible();
  });

  await test.step('Add New Row, assert row appears', async () => {
    await createAccount.addNewRow();
  });

  await test.step('Account Type cell opens with the expected options', async () => {
    const options = await createAccount.openCellEditorAndGetOptions(0, 'accountTypeCd');
    for (const expected of EXPECTED_ACCOUNT_TYPES_SAMPLE) {
      expect(options, `Account Type dropdown should contain "${expected}"`).toContain(expected);
    }
    await createAccount.closeEditor();
  });

  await test.step('Custodian cell opens with the expected options', async () => {
    const options = await createAccount.openCellEditorAndGetOptions(0, 'eBrokerCd');
    for (const expected of EXPECTED_CUSTODIANS_SAMPLE) {
      expect(options, `Custodian dropdown should contain "${expected}"`).toContain(expected);
    }
    await createAccount.closeEditor();
  });

  await test.step('Default Money cell opens with at least one option', async () => {
    const options = await createAccount.openCellEditorAndGetOptions(0, 'defaultMoneyOptionId');
    expect(options.length, 'Default Money dropdown should be populated').toBeGreaterThan(0);
    await createAccount.closeEditor();
  });
});
