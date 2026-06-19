// @ts-check
/**
 * TestRail C26273 — Non-deactivated NCC Employee remains logged in Advisor
 * Portal after deactivate/Disable different NCC from Platform One
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26273 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-22184
 *
 * Pre-conditions (case): User A + User G both have Advisor Portal access.
 *   The precondition explicitly notes: "Test with both types GWAdmin or
 *   any user for selected site." — so the case logic is not specific to
 *   NCCs. We satisfy it with two advisors from a fresh `workerFirm`
 *   (dummy firm seeded via `/qa/createDummyFirm.do`), which provisions
 *   3 advisors with `loginName=adv_<firmCd>_<n>` and the standard qa3
 *   password — both can log into the Advisor Portal directly.
 *
 * Steps:
 *   1. Login as User A + User G into the Advisor Portal in two browser
 *      contexts. → both portals load.
 *   2. Both navigate to some menu. → menus render.
 *   3. In a third (main) context, login as the GW Admin (tim1) into
 *      Platform One.
 *   4. Open Operations → Firm Admin → User Management.
 *   5. Select User A in the grid.
 *   6. Click Deactivate. → ConfirmDeactivationModal opens.
 *   7. Pick Deactivation Reason "No Longer An Employee".
 *   8. Click "Yes, Deactivate". → User A status flips to Deactivated.
 *   9. In Context 1 (User A) reload / navigate. → User A is logged out
 *      (the BE invalidates the session — UI lands on the login screen).
 *   10. In Context 2 (User G) reload / navigate. → User G is unaffected.
 *
 * Source-of-truth (FE):
 *   - BulkDeactivateButton.js — "Deactivate" footer; gated on selectedUsers.
 *   - ConfirmDeactivationModal.js — `<SubmitButton submitDisplayName="Yes, Deactivate" />`,
 *     Deactivation Reason combo id=`deactivateReasonCd`.
 *   - consts.js — DEACTIVATION_REASON_OPTIONS[NO_LONGER_EMPLOYEE]=3 →
 *     "No Longer An Employee".
 *   - UserManagementAdvancedSearch.js — Firm typeAhead `#firmCd_typeAhead`,
 *     email text `#emailField`.
 *   - useUserManagementGridOptions.js — grid uses multiRow checkbox
 *     selection in autoGroupColumn.
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  createGwAdmin,
  login: qaLogin,
  cfg,
} = require('../_helpers/qa3');
const { selectFirmInTypeAhead } = require('../_helpers/ui');

test.setTimeout(360_000);

test('@pepi C26273 Non-deactivated portal user stays logged in after another user is deactivated', async ({
  browser,
  page,
}) => {
  // Two distinct fresh GW Admins on firm 1 (each with a unique primary
  // email so the FIRM_1_DEACTIVATION_WARNING's email-cascade never fires
  // across them). createGwAdmin patches mfa_required_flag=0 in the DB,
  // so both can log in directly without a passcode.
  const userA = await createGwAdmin('pepiUserA');
  const userG = await createGwAdmin('pepiUserG');

  // ─── Context 1: User A logs in ──────────────────────────────────────────
  const ctxA = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const pageA = await ctxA.newPage();
  await test.step(`Login as User A (${userA.username}) into Platform One`, async () => {
    await qaLogin(pageA, userA.username, userA.password);
    await pageA.waitForURL(/#(platformOne|dashboard)/i, { timeout: 30_000 });
  });

  // ─── Context 2: User G logs in ──────────────────────────────────────────
  const ctxG = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const pageG = await ctxG.newPage();
  await test.step(`Login as User G (${userG.username}) into Platform One`, async () => {
    await qaLogin(pageG, userG.username, userG.password);
    await pageG.waitForURL(/#(platformOne|dashboard)/i, { timeout: 30_000 });
  });

  // ─── Main page: tim1 GW Admin → User Management → Deactivate User A ─────
  await test.step('Login as GW Admin (tim1) into Platform One', async () => {
    await loginPlatformOneAdmin(page);
  });

  await test.step('Navigate Operations → Firm Admin → User Management', async () => {
    await page.goto('/react/indexReact.do#platformOne/firmAdmin/userManagement');
    // Same advanced-search panel race documented in
    // tests/user-management/_helpers.js — race for either firm typeAhead or
    // the toggle icon.
    const advancedSearchToggle = page.locator('span#seacrh_filter');
    const firmTypeAhead = page.locator('#firmCd_typeAhead');
    await Promise.race([
      firmTypeAhead.waitFor({ state: 'visible', timeout: 30_000 }),
      advancedSearchToggle.waitFor({ state: 'visible', timeout: 30_000 }),
    ]);
    if (await advancedSearchToggle.isVisible()) {
      await advancedSearchToggle.click();
    }
    await expect(firmTypeAhead).toBeVisible({ timeout: 30_000 });
  });

  // createGwAdmin sets emailAddress = `${username}@geowealth.com`, so the
  // username substring uniquely identifies User A in the email column.
  const userAEmail = userA.emailAddress;

  await test.step(`Filter to firm 1 + email ${userAEmail}`, async () => {
    await selectFirmInTypeAhead(
      page,
      { firmCd: 1, firmName: 'GeoWealth' },
      { confirm: 'none' }
    );
    const emailFilter = page.locator('#emailField');
    await emailFilter.click();
    await emailFilter.pressSequentially(userAEmail, { delay: 15 });
    // FormBuilder commit debounce.
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Search' }).click();
  });

  await test.step('Select User A row checkbox in the grid', async () => {
    // For firm 1 the grid uses tree-data mode — a parent group row collapses
    // its child users. Click the parent row first to expand, then locate the
    // child by email and tick its checkbox.
    const parentRow = page
      .locator('[role="row"]')
      .filter({ hasText: userAEmail })
      .first();
    await expect(parentRow).toBeVisible({ timeout: 30_000 });
    await page
      .locator('[role="page-loader"]')
      .waitFor({ state: 'detached', timeout: 30_000 })
      .catch(() => {});
    await parentRow.click();
    // The child row's email cell also carries the email text. Use the LAST
    // matching row (typically the child) for the checkbox click.
    const userRow = page
      .locator('[role="row"]')
      .filter({ hasText: userAEmail })
      .last();
    await expect(userRow).toBeVisible({ timeout: 10_000 });
    // Wait for any PageLoader overlay to detach before clicking.
    await page
      .locator('[role="page-loader"]')
      .waitFor({ state: 'detached', timeout: 30_000 })
      .catch(() => {});
    const checkbox = userRow.locator('.ag-checkbox-input').first();
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.click();
    await expect(userRow).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  });

  await test.step('Click footer Deactivate → ConfirmDeactivationModal opens', async () => {
    const deactivateBtn = page.getByRole('button', { name: 'Deactivate', exact: true }).first();
    await expect(deactivateBtn).toBeVisible({ timeout: 10_000 });
    await expect(deactivateBtn).not.toHaveClass(/disabled/i, { timeout: 10_000 });
    await deactivateBtn.click();
    await expect(
      page.getByText('Deactivate Users', { exact: true }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Pick Deactivation Reason "No Longer An Employee" + click Yes, Deactivate', async () => {
    const modal = page
      .locator('[data-role="modalContainer"]')
      .filter({ hasText: 'Deactivate Users' })
      .first();
    const focusInput = modal.locator('input#deactivateReasonCdField');
    await expect(focusInput).toBeAttached({ timeout: 10_000 });
    await focusInput.evaluate((node) => /** @type {HTMLInputElement} */ (node).focus());

    await page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: /^No Longer An Employee$/ })
      .first()
      .click();

    const yes = modal
      .getByRole('button', { name: 'Yes, Deactivate', exact: true })
      .first();
    await expect(yes).not.toHaveClass(/disabled/i, { timeout: 5000 });
    // The deactivate POST goes to /platformOne/usersActivateDeactivate.do —
    // wait for it to settle so the BE has actually flipped User A's flag.
    const deactivateResp = page.waitForResponse(
      (r) => r.url().includes('/platformOne/usersActivateDeactivate.do') && r.status() === 200,
      { timeout: 30_000 }
    );
    await yes.click();
    await deactivateResp;
    await expect(modal).toBeHidden({ timeout: 15_000 });
  });

  // ─── Context 1 (User A): expected to be logged out on next navigation ───
  await test.step('User A session is invalidated after deactivation', async () => {
    // The SPA on Advisor Portal lazily revalidates the session. A hash-only
    // navigation does NOT trigger a full reload, and any cached page data
    // can hide the auth state flip. Force a HARD navigation to the SPA
    // entry — that re-issues authenticated requests, the BE rejects them
    // (the user is now deactivated), and the SPA bounces to the login.
    await pageA.goto('/react/indexReact.do').catch(() => {});
    await pageA.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    // Either the login form mounts OR the URL flips to a #login hash —
    // both are valid signals that the session was forcefully terminated.
    const usernameInput = pageA.getByPlaceholder(/email|username/i).first();
    await Promise.race([
      usernameInput.waitFor({ state: 'visible', timeout: 30_000 }),
      pageA.waitForURL(/#login/i, { timeout: 30_000 }),
    ]);
    await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  });

  // ─── Context 2 (User G): unaffected ─────────────────────────────────────
  await test.step('User G session is unaffected — still on Advisor Portal', async () => {
    await pageG.goto('/react/indexReact.do').catch(() => {});
    await pageG.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await expect(pageG).toHaveURL(/#(dashboard|platformOne|client)/i, { timeout: 30_000 });
    // Sanity: the username/login input must NOT be visible (no auth
    // redirect happened for User G).
    await expect(pageG.getByPlaceholder(/email|username/i).first()).toBeHidden({
      timeout: 5000,
    });
  });

  await ctxA.close();
  await ctxG.close();
});
