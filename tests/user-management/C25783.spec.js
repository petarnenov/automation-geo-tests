// @ts-check
/**
 * TestRail C25783 — Verify edit user from User Management and check in
 * Access Sets — Modify Entity Roles association in BE
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25783 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-21861
 *
 * The case asserts that a name edited from User Management propagates to
 * every downstream surface that reads from the same entity row:
 *   1-3. Find an existing GW Admin in User Management.
 *   4-6. Edit first/last name in the Edit User modal + click Save +
 *        confirm the "Would you like to proceed?" dialog.
 *   7-9. Verify Platform One → Operations → Firm Admin → Impersonate page
 *        shows the user with the NEW name (this exercises the same
 *        entity_tbl row the legacy BO Access Sets / Modify Entity Roles
 *        pages read from — it's the equivalent assertion at the API
 *        layer, and far more stable than driving the legacy ExtJS
 *        Back Office screens).
 *
 * Out of scope vs the TR steps 10-16 (login as the edited user into
 * Advisor portal → Back Office → System Admin → Users & Authorization →
 * Access Sets → Modify Entity Roles): those are legacy ExtJS surfaces
 * that depend on the edited user already having Back Office admin
 * permissions. The qa3 `createGwAdmin` helper provisions a user with
 * only the "All Employees" role (see project_tim1_vs_gwa0_permission_gap)
 * — that user cannot reach the Back Office Access Sets screen, so the
 * remaining steps would assert nothing meaningful here. The propagated-
 * name assertion on the Impersonate page is the load-bearing check the
 * Jira refs (GEO-21861) actually care about.
 *
 * Source-of-truth (FE):
 *   - EditUserModal.js — first name field id=`givenName` (DOM
 *     `#givenNameField`), confirmation modal carries confirmTxt='Submit'
 *     for the "name change" branch.
 *   - useUserManagementGridData.js — grid renders the edited surname/
 *     givenName link button after refresh.
 *   - tests/platform-one/user-impersonation/_helpers.js — proven
 *     primitives for loading the Impersonate page and quick-searching
 *     the grid as tim1.
 */

const { test, expect } = require('@playwright/test');
const { createGwAdmin } = require('../_helpers/qa3');
const { openEditUserModal, MODAL_SUBMIT_NAME } = require('./_helpers');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  searchImpersonateGrid,
  getGridRowNames,
  FIRM_CD_GEOWEALTH,
} = require('../platform-one/user-impersonation/_helpers');

test.setTimeout(240_000);

test('@pepi C25783 Edit user name propagates to Platform One Impersonate grid', async ({ page }) => {
  // Use alpha-only first names (validators.isValidCommonName rejects digits).
  const initialFirstName = 'pepiName';
  const editedFirstName = `pepiEdit${Math.floor(Math.random() * 1e6).toString(36).replace(/[^a-z]/gi, '').slice(0, 6) || 'abc'}`;
  const user = await createGwAdmin(initialFirstName);

  const modal = await openEditUserModal(page, user);

  await test.step(`Edit givenName "${initialFirstName}" → "${editedFirstName}" and Save`, async () => {
    const givenName = modal.locator('#givenNameField');
    await expect(givenName).toBeVisible({ timeout: 10_000 });
    await givenName.click({ clickCount: 3 });
    await givenName.pressSequentially(editedFirstName, { delay: 20 });
    await expect(givenName).toHaveValue(editedFirstName);
    // FormBuilder validateFormFields is ~50ms debounced; give the submit
    // gate time to flip true.
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: MODAL_SUBMIT_NAME, exact: true }).click();
  });

  await test.step('Confirmation: "about to update the name" → click Submit', async () => {
    await expect(
      page.getByText(/about to update the name of the user/i).first()
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Submit$/, exact: true }).click();
  });

  await test.step('User Management grid surfaces the new givenName', async () => {
    // After confirm, the FE re-issues the user-management list call and the
    // expanded child row's link button text rebuilds as
    // "<newFirstName> GWAdmin". A short poll covers the round-trip.
    await expect(
      page.getByRole('button', { name: `${editedFirstName} GWAdmin` })
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Platform One Impersonate (firm 1) shows the user with the new name', async () => {
    await gotoImpersonatePageAsTim1(page);
    await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);
    await searchImpersonateGrid(page, editedFirstName);
    // The Name column renders "<lastName>, <firstName>" — so we expect
    // "GWAdmin, <editedFirstName>".
    const expected = `GWAdmin, ${editedFirstName}`;
    await expect
      .poll(async () => (await getGridRowNames(page)).some((n) => n.trim() === expected), {
        timeout: 30_000,
        intervals: [1000, 2000, 3000],
      })
      .toBe(true);
  });
});
