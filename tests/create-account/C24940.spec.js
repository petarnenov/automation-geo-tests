// @ts-check
/**
 * TestRail C24940 — Create new account manually
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24940 (Run 175, label Pepi)
 *
 * End-to-end happy path for the Platform One → Create Account page:
 *   1. Login as Platform One admin, open Create Account
 *   2. Pick the worker's dummy firm via the firm typeAhead
 *   3. Click Add New Row
 *   4. Fill: Account Number, Client UUID, Account Nickname, Account Type,
 *      Custodian, Open Date, Default Money
 *   5. Click Create → assert "All accounts have been created successfully"
 *   6. Switch to the dummy firm's advisor → navigate to the client's Accounts
 *      tab → assert the new account row is present
 *
 * NOTE: This spec covers ONLY the happy path. The household-uuid negative case
 * from TestRail step 8 is covered by C25102 (Different CLIENT types) — kept
 * separate so a single failure doesn't mask both.
 *
 * Implementation notes:
 *   - The Create Account grid is an ag-grid with `singleClickEdit: true`
 *     (verified in `pages/_helpers/index.js` of the geowealth source).
 *     Clicking a cell opens its editor inline; rich-select editors render
 *     options as `.ag-virtual-list-item` elements in a virtualized viewport.
 *   - Rich-select editors have `allowTyping: true`, so we type a filter and
 *     press Enter to commit the first match — far more reliable than scrolling
 *     a virtualized list to click a specific option.
 *   - The Open Date column uses `agDateStringCellEditor`, which is a plain
 *     text input that accepts MM/DD/YYYY.
 *   - We pick the worker firm specifically (not "any firm") because step 6
 *     needs to log in as that firm's advisor and verify the account showed up
 *     under the firm's auto-seeded client.
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

const CREATE_ACCOUNT_URL = '/react/indexReact.do#platformOne/backOffice/createAccount';

test('@pepi C24940 Create new account manually', async ({ page, context, workerFirm }) => {
  test.setTimeout(240_000);

  const accountNumber = `PA${Date.now()}`;
  const accountNickname = `Pepi C24940 ${Date.now().toString().slice(-6)}`;
  // Use a date safely in the past — `today` would also work but past dates
  // sidestep any timezone-edge weirdness in the date validator.
  const openDate = '01/02/2024';

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

  await test.step('Add New Row, fill all required fields', async () => {
    await page.getByRole('button', { name: 'Add New Row' }).click();
    await expect(page.locator('.ag-row[row-index="0"]')).toBeVisible({
      timeout: 5000,
    });

    await setAgGridText(page, 0, 'accountNumber', accountNumber);
    await setAgGridText(page, 0, 'clientUuid', workerFirm.client.uuid);
    await setAgGridText(page, 0, 'accountNickname', accountNickname);
    await setAgGridRichSelect(page, 0, 'accountTypeCd', 'Individual Taxable');
    await setAgGridRichSelect(page, 0, 'eBrokerCd', 'Manual Input');
    await setAgGridDate(page, 0, 'accountOpenDate', openDate);
    await pickFirstAgGridRichSelect(page, 0, 'defaultMoneyOptionId');
  });

  await test.step('Click Create, confirm success modal', async () => {
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText(/All accounts have been created successfully/i)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'OK', exact: true }).click();
  });

  await test.step('Switch to advisor, verify account appears under the client', async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    // The Client Overview page does NOT list account numbers — only totals and
    // snapshots. The dedicated Accounts tab does. Verified via the page
    // snapshot in C24940's first failure: tab href is `#/client/1/<uuid>/accounts`.
    await page.goto(`/react/indexReact.do#/client/1/${workerFirm.client.uuid}/accounts`);
    await expect(page.getByText(accountNumber, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
