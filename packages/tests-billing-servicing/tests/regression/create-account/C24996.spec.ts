/**
 * TestRail C24996 — Create new accounts with wrong data
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24996
 *         (Run 175, label Pepi)
 *
 *   1. Open Create Account, select worker firm
 *   2. Add row with all fields but a bogus (non-existent) Client UUID
 *   3. Click Create → assert error popup
 *   4. Assert the clientUuid cell carries the `error-cell` class
 *
 * Isolation: tim1Page.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { CreateAccountPage } from '../../../src/pages/create-account/CreateAccountPage';

const BOGUS_CLIENT_UUID = 'DEADBEEFDEADBEEFDEADBEEFDEADBEEF';

test('@regression @billing-servicing C24996 Create new accounts with wrong data', async ({
  tim1Page,
  workerFirm,
}) => {
  test.fixme();
  test.setTimeout(180_000);

  const createAccount = new CreateAccountPage(tim1Page);
  const accountNumber = `PW${Date.now()}`;

  await test.step('Open Create Account, select worker firm', async () => {
    await createAccount.goto();
    await createAccount.selectFirm(workerFirm);
  });

  await test.step('Add a row with a bogus Client UUID', async () => {
    await createAccount.addNewRow();
    await createAccount.fillRow(0, {
      accountNumber,
      clientUuid: BOGUS_CLIENT_UUID,
      accountNickname: 'Pepi C24996 bad row',
      accountType: 'Individual Taxable',
      custodian: 'Manual Input',
      openDate: '01/02/2024',
    });
  });

  await test.step('Click Create, assert error popup + per-cell error', async () => {
    await createAccount.createButton.click();

    await expect(
      tim1Page.getByText(/Remaining rows contain issues and need correction/i)
    ).toBeVisible({ timeout: 30_000 });

    await tim1Page.getByRole('button', { name: 'OK', exact: true }).click();

    await expect(createAccount.errorCellInColumn('clientUuid').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
