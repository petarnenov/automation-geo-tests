// @ts-check
/**
 * TestRail C24996 — Create new accounts with wrong data
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24996 (Run 175, label Pepi)
 *
 *   1. Login as Platform One admin, open Create Account
 *   2. Pick the worker firm
 *   3. Add new row, fill all required fields but with at least one invalid
 *      value (here: a syntactically-correct but non-existent Client UUID).
 *   4. Click Create → assert the error popup appears
 *
 * Implementation notes:
 *   - The clearest "wrong data" failure mode that lets us reach the Create
 *     handler at all is a bogus Client UUID. The dropdown-backed columns
 *     (Account Type, Custodian, Default Money) only accept values from the
 *     server-provided lists, so feeding them garbage isn't possible from the
 *     UI. Account Number duplicates are also rejected post-hoc, but require a
 *     prior account in the same firm.
 *   - The server returns the row in `accountsWithErrors`, so the front-end
 *     shows the "Creation Completed" modal with the message
 *     "0 accounts created successfully. Remaining rows contain issues and
 *     need correction." (verified in
 *     `pages/Components/CreateAccountAfterGrid/_hooks/useCreateAccountAfterGrid.js`).
 *     Per TestRail, that's the "Error popup" — the title comes from the
 *     submit modal hook, the body from the same hook's `msg` template.
 *   - The bogus UUID also causes the row's clientUuid cell to switch to the
 *     `error-cell` class with a tooltip — we assert that as a tighter check
 *     than the modal text alone.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const {
  selectFirmInTypeAhead,
  setAgGridText,
  setAgGridRichSelect,
  setAgGridDate,
  pickFirstAgGridRichSelect,
} = require('../_helpers/ui');

const CREATE_ACCOUNT_URL = '/react/indexReact.do#platformOne/backOffice/createAccount';

// 32 hex chars, valid UUID format, but no entity exists with this id in any
// firm. Validated server-side via `NEntityDAO.getNEntity()` which returns null.
const BOGUS_CLIENT_UUID = 'DEADBEEFDEADBEEFDEADBEEFDEADBEEF';

test('@pepi C24996 Create new accounts with wrong data', async ({ page, workerFirm }) => {
  test.setTimeout(180_000);

  const accountNumber = `PW${Date.now()}`;

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

  await test.step('Add a row, fill all fields with a bogus Client UUID', async () => {
    await page.getByRole('button', { name: 'Add New Row' }).click();
    await expect(page.locator('.ag-row[row-index="0"]')).toBeVisible({
      timeout: 5000,
    });

    await setAgGridText(page, 0, 'accountNumber', accountNumber);
    await setAgGridText(page, 0, 'clientUuid', BOGUS_CLIENT_UUID);
    await setAgGridText(page, 0, 'accountNickname', 'Pepi C24996 bad row');
    await setAgGridRichSelect(page, 0, 'accountTypeCd', 'Individual Taxable');
    await setAgGridRichSelect(page, 0, 'eBrokerCd', 'Manual Input');
    await setAgGridDate(page, 0, 'accountOpenDate', '01/02/2024');
    await pickFirstAgGridRichSelect(page, 0, 'defaultMoneyOptionId');
  });

  await test.step('Click Create, assert error popup + per-cell error', async () => {
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // The submit modal opens with "Creation Completed" header and the
    // partial-failure body. With our single bogus row, the count is 0.
    await expect(page.getByText(/Remaining rows contain issues and need correction/i)).toBeVisible({
      timeout: 30_000,
    });

    // Close the modal — the back-end has refreshed the grid with the bad row
    // re-mounted, so its clientUuid cell should now carry the `error-cell`
    // class. Tighter assertion than the modal text alone.
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    const badCell = page.locator('.ag-row [role="gridcell"][col-id="clientUuid"].error-cell');
    await expect(badCell.first()).toBeVisible({ timeout: 10_000 });
  });
});
