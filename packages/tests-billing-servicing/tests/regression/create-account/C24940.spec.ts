/**
 * TestRail C24940 — Create new account manually
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24940
 *         (Run 175, label Pepi)
 *
 * End-to-end happy path for Platform One → Create Account:
 *   1. Login as tim1 (Platform One admin), open Create Account
 *   2. Pick the worker's dummy firm via the firm typeAhead
 *   3. Add New Row, fill all required fields
 *   4. Click Create → assert "All accounts have been created successfully"
 *   5. Switch to the dummy firm's advisor → verify the new account appears
 *
 * Isolation: tim1Page (Platform One admin) + workerFirm for data.
 * Each worker has its own dummy firm — no cross-worker collisions.
 */

import { test, expect, clearAndLoginAs } from '@geowealth/e2e-framework/fixtures';
import { selectEnvironment } from '@geowealth/e2e-framework/config';
import { CreateAccountPage } from '../../../src/pages/create-account/CreateAccountPage';

test('@regression @billing-servicing C24940 Create new account manually', async ({
  tim1Page,
  workerFirm,
}) => {
  test.fixme();
  test.setTimeout(240_000);

  const page = tim1Page;
  const createAccount = new CreateAccountPage(page);
  const accountNumber = `PA${Date.now()}`;
  const accountNickname = `Pepi C24940 ${Date.now().toString().slice(-6)}`;
  const openDate = '01/02/2024';

  await test.step('Open Create Account as Platform One admin', async () => {
    await createAccount.goto();
  });

  await test.step('Select the worker dummy firm', async () => {
    await createAccount.selectFirm(workerFirm);
  });

  await test.step('Add New Row, fill all required fields', async () => {
    await createAccount.addNewRow();
    await createAccount.fillRow(0, {
      accountNumber,
      clientUuid: workerFirm.client.uuid,
      accountNickname,
      accountType: 'Individual Taxable',
      custodian: 'Manual Input',
      openDate,
    });
  });

  await test.step('Click Create, confirm success modal', async () => {
    await createAccount.createAndConfirmSuccess();
  });

  await test.step('Switch to advisor, verify account appears under the client', async () => {
    const env = selectEnvironment();
    await clearAndLoginAs(
      page,
      page.context(),
      workerFirm.advisor.loginName,
      workerFirm.password,
      env.baseUrl
    );
    await page.goto(`/react/indexReact.do#/client/1/${workerFirm.client.uuid}/accounts`);
    await expect(page.getByText(accountNumber, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
