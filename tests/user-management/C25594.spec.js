// @ts-check
/**
 * TestRail C25594 — Impersonate newly created user
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25594 (Run 214)
 *
 * Pre-condition: newly created user from Platform One. We satisfy with a
 * fresh firm-1 GW Admin (createGwAdmin patches mfa_required_flag=0 so the
 * user shows up immediately under the Non-Customer Contacts directory).
 *
 * Steps:
 *   1. Login as an Advisor in the firm where the user was created — we
 *      use tim1 (the seeded Platform One admin in firm 1).
 *   2. Directories → Non-Customer Contacts: search the newly created user
 *      and open their profile.
 *   3. User Actions → Impersonate. → Impersonation lands on the user's
 *      portal.
 *
 * Source-of-truth (FE):
 *   - openFirstEmployeeFromAPDirectory / openAPUserActionsMenu in
 *     tests/platform-one/user-impersonation/_helpers.js — primitives for
 *     the NCC directory + the SelectedClient Actions menu.
 *   - NavigationLeftComponent.js — the post-impersonation banner reads
 *     "Impersonated By" and the bottom action becomes "Terminate
 *     Impersonation"; both are stable signals to assert on.
 *   - terminateImpersonationFromUserMenu calls
 *     `GET /logout.do?reactRequest=true` which works regardless of which
 *     portal the impersonator was redirected into — used here for
 *     deterministic teardown.
 */

const { test, expect } = require('@playwright/test');
const { createGwAdmin } = require('../_helpers/qa3');
const {
  loginAsTim1Fresh,
  openAPUserActionsMenu,
  terminateImpersonationFromUserMenu,
} = require('../platform-one/user-impersonation/_helpers');

test.setTimeout(240_000);

test('@pepi C25594 Impersonate newly created user', async ({ page }) => {
  // createGwAdmin creates a firm-1 GW Admin Employee — surfaces in the
  // Non-Customer Contacts directory (`isNonCustomer` covers both EMPLOYEE
  // and VENDOR_CONTACT typeCds, per @Utils/helpers/clientTypes).
  const user = await createGwAdmin('pepiImp');

  await test.step('Step 1: Login as Platform One admin (tim1) — fresh session', async () => {
    await loginAsTim1Fresh(page);
  });

  await test.step('Step 2: Directories → Non-Customer Contacts → find new user → click', async () => {
    await page.goto('/react/indexReact.do#directories/nonCustomerContacts');
    await expect(
      page.locator('.ag-center-cols-container .ag-row [col-id="displayName"] a').first()
    ).toBeVisible({ timeout: 60_000 });

    const search = page.getByRole('textbox', { name: 'Search', exact: true }).first();
    await expect(search).toBeVisible({ timeout: 10_000 });
    await search.click();
    await search.fill(user.firstName);
    await search.press('End');

    const expected = `GWAdmin, ${user.firstName}`;
    const userLink = page
      .locator('.ag-center-cols-container .ag-row [col-id="displayName"] a')
      .filter({ hasText: expected })
      .first();
    await expect(userLink).toBeVisible({ timeout: 60_000 });
    await userLink.click();
    await expect(page).toHaveURL(/#client\/4\//i, { timeout: 30_000 });
  });

  await test.step('Step 3: User Actions → Impersonate → verify post-impersonation banner', async () => {
    const impersonateOption = await openAPUserActionsMenu(page);
    // Clicking Impersonate redirects the current tab to the impersonated
    // user's portal (P1 admin → legacy ExtJS portal for employees, but
    // the React shell still re-mounts with the new identity, so
    // `isImpersonated=true` and the sidebar surfaces both signals).
    await impersonateOption.click();
    // Both surface together once impersonation lands: the sidebar
    // "Impersonated By" badge AND the bottom action flipping to
    // "Terminate Impersonation". Asserting either signal is enough.
    await expect(
      page.getByRole('link', { name: /Terminate Impersonation/i }).first()
    ).toBeVisible({ timeout: 60_000 });
  });

  // Always terminate the impersonation so subsequent worker tests start
  // from a clean session.
  await terminateImpersonationFromUserMenu(page);
});
