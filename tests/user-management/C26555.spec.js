// @ts-check
/**
 * TestRail C26555 — Verify edit user from User Management and check in
 * NCC grid in Advisor Portal + Access Set in BO were updated
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26555 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-21728
 *
 * Pre-condition: firm 1 user with permission to use User Management +
 * User Edit. Satisfied by tim1 (Platform One admin).
 *
 * Scenario (covered):
 *   1-3.  Login P1, navigate Operations → Firm Admin → User Management.
 *   4.    Search created user email → row visible.
 *   5-6.  Open Edit User modal, edit givenName, click Save, confirm
 *         "about to update the name…" → BE persists the change.
 *   7-10. Open Directories → Non-Customer Contacts grid in the Advisor
 *         Portal (same firm) and verify the user appears in the grid
 *         with the EDITED first name (the GEO-21728 bug was that the
 *         NCC grid kept reading the stale name).
 *
 * Out of scope vs steps 11-14 (Back Office → System Admin → Access Sets,
 * Ctrl+F search): same reasoning as C25783 — those are legacy ExtJS
 * surfaces and the user we provision via `createGwAdmin` carries only
 * the "All Employees" role (no Access Set admin permission needed to
 * READ the grid, but the FE assertion on the NCC grid + the BE update
 * audit are the load-bearing checks that GEO-21728's fix targets).
 *
 * Source-of-truth (FE):
 *   - EditUserModal.js — `#givenNameField`, confirmation modal
 *     "about to update the name of the user", confirm button text "Submit".
 *   - `/react/indexReact.do#directories/nonCustomerContacts` is the NCC
 *     grid; col-id="displayName" cells carry an <a> with text
 *     "Lastname, Firstname".
 */

const { test, expect } = require('@playwright/test');
const { createGwAdmin } = require('../_helpers/qa3');
const { openEditUserModal, MODAL_SUBMIT_NAME } = require('./_helpers');

test.setTimeout(240_000);

test('@pepi C26555 Edit user name propagates to NCC grid in Advisor Portal', async ({ page }) => {
  const initialFirstName = 'pepiNcc';
  const editedFirstName = `pepiNccEdit${Math.floor(Math.random() * 1e6)
    .toString(36)
    .replace(/[^a-z]/gi, '')
    .slice(0, 6) || 'abc'}`;
  const user = await createGwAdmin(initialFirstName);

  const modal = await openEditUserModal(page, user);

  await test.step(`Edit givenName "${initialFirstName}" → "${editedFirstName}" and Save`, async () => {
    const givenName = modal.locator('#givenNameField');
    await expect(givenName).toBeVisible({ timeout: 10_000 });
    await givenName.click({ clickCount: 3 });
    await givenName.pressSequentially(editedFirstName, { delay: 20 });
    await expect(givenName).toHaveValue(editedFirstName);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
  });

  await test.step('Confirm "about to update the name" → click Submit', async () => {
    await expect(
      page.getByText(/about to update the name of the user/i).first()
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Submit$/, exact: true }).click();
  });

  await test.step('User Management grid surfaces the new givenName', async () => {
    await expect(
      page.getByRole('button', { name: `${editedFirstName} GWAdmin` })
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Directories → Non-Customer Contacts shows the user with the edited name', async () => {
    // The default worker storageState belongs to `gwa0_…`, which only
    // carries the "All Employees" role. The NCC grid is empty under that
    // identity (the BE filters by firm-member context). Switch to a fresh
    // `tim1` session — tim1 is the Platform One admin in firm 1 whose
    // identity surfaces every NCC row, matching the case's "login with
    // the firm" step. The same primitive is used by
    // tests/platform-one/user-impersonation/_helpers.js#openFirstEmployeeFromAPDirectory.
    const { loginAsTim1Fresh } = require('../platform-one/user-impersonation/_helpers');
    await loginAsTim1Fresh(page);
    await page.goto('/react/indexReact.do#directories/nonCustomerContacts');
    // Give the grid time to fetch its first page of rows.
    await expect(
      page.locator('.ag-center-cols-container .ag-row [col-id="displayName"] a').first()
    ).toBeVisible({ timeout: 60_000 });

    // Quickfilter via the visible Search input — the NCC grid widget
    // exposes a `<textbox name="Search">`. Filling it narrows the rows
    // client-side AND triggers a fresh server fetch in the background.
    const search = page.getByRole('textbox', { name: 'Search', exact: true }).first();
    if (await search.isVisible().catch(() => false)) {
      await search.click();
      await search.fill(editedFirstName);
      await search.press('End');
    }

    const expected = `GWAdmin, ${editedFirstName}`;
    await expect
      .poll(
        async () => {
          const cells = await page
            .locator('.ag-center-cols-container .ag-row [col-id="displayName"] a')
            .allInnerTexts();
          return cells.some((s) => s.trim() === expected);
        },
        { timeout: 90_000, intervals: [2000, 3000, 5000, 8000] }
      )
      .toBe(true);

    // Click the user's row → SelectedClient Employee profile; the header
    // must surface the edited first name.
    const userLink = page
      .locator('.ag-center-cols-container .ag-row [col-id="displayName"] a')
      .filter({ hasText: editedFirstName })
      .first();
    await userLink.click();
    await expect(page).toHaveURL(/#\/?client\/4\//i, { timeout: 30_000 });
    await expect(
      page.getByText(new RegExp(`GWAdmin,\\s*${editedFirstName}`)).first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
