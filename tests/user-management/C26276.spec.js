// @ts-check
/**
 * TestRail C26276 — Direct URL access after deactivation NCC Employee
 * from Platform One -> NCC tab Portal Activity - Deactivate NCC Employee
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26276 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-22184
 *
 * Pre-condition (per case): "Test with both types GWAdmin or any user for
 * selected site." We satisfy with a fresh firm-1 GW Admin (createGwAdmin
 * patches mfa_required_flag=0 so login works immediately).
 *
 * Scenario:
 *   1-2.  User A logs into the Portal, lands on a protected page; copy
 *         that URL.
 *   3-4.  GW Admin (tim1) opens Operations → Firm Admin → User Management.
 *   5-7.  Select User A, click Deactivate, pick "No Longer An Employee".
 *   8.    Click "Yes, Deactivate" — User A row goes Deactivated.
 *   9.    User A's Browser 1: any navigation → bounced to login (session
 *         was revoked by GEO-22184).
 *   10.   Attempt to re-login as User A → login fails (the deactivated
 *         user can no longer authenticate).
 *   11.   In a fresh Browser 3 (no cookies), open the protected URL
 *         captured in step 2 → redirected to the login page (no data).
 *
 * Source-of-truth (FE):
 *   - BulkDeactivateButton / ConfirmDeactivationModal / userManagementServices
 *     are the same primitives covered by C26273/C26274.
 *   - The SPA entry `/react/indexReact.do` is the authenticated shell —
 *     deep-linking with no session redirects to `#login`.
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  createGwAdmin,
  login: qaLogin,
} = require('../_helpers/qa3');
const { selectFirmInTypeAhead } = require('../_helpers/ui');

test.setTimeout(360_000);

test('@pepi C26276 Direct URL access after deactivation redirects deactivated user to login', async ({
  browser,
  page,
}) => {
  const userA = await createGwAdmin('pepiDirectUrl');

  // ─── Context 1: User A logs in + lands on a protected URL ───────────────
  const ctxA = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const pageA = await ctxA.newPage();
  let protectedUrl = '';
  await test.step(`Login User A and capture a protected URL`, async () => {
    await qaLogin(pageA, userA.username, userA.password);
    await pageA.waitForURL(/#(platformOne|dashboard)/i, { timeout: 30_000 });
    // Navigate to a deep authenticated page so the URL is meaningfully
    // "protected" (the SPA refuses to load it without a valid session).
    await pageA.goto('/react/indexReact.do#platformOne');
    await expect(
      pageA.getByText(/Welcome to Platform One|Operations|User Profile/i).first()
    ).toBeVisible({ timeout: 30_000 });
    protectedUrl = pageA.url();
    expect(protectedUrl).toMatch(/#platformOne/);
  });

  // ─── Main page: tim1 GW Admin → deactivate User A ───────────────────────
  await test.step('Login tim1 + open User Management', async () => {
    await loginPlatformOneAdmin(page);
    await page.goto('/react/indexReact.do#platformOne/firmAdmin/userManagement');
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

  await test.step(`Filter firm 1 + email ${userA.emailAddress}, search`, async () => {
    await selectFirmInTypeAhead(
      page,
      { firmCd: 1, firmName: 'GeoWealth' },
      { confirm: 'none' }
    );
    const emailFilter = page.locator('#emailField');
    await emailFilter.click();
    await emailFilter.pressSequentially(userA.emailAddress, { delay: 15 });
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Search' }).click();
  });

  await test.step('Expand parent row + select User A child checkbox', async () => {
    const parentRow = page
      .locator('[role="row"]')
      .filter({ hasText: userA.emailAddress })
      .first();
    await expect(parentRow).toBeVisible({ timeout: 30_000 });
    await page
      .locator('[role="page-loader"]')
      .waitFor({ state: 'detached', timeout: 30_000 })
      .catch(() => {});
    await parentRow.click();
    const userRow = page
      .locator('[role="row"]')
      .filter({ hasText: userA.emailAddress })
      .last();
    const checkbox = userRow.locator('.ag-checkbox-input').first();
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.click();
    await expect(userRow).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  });

  await test.step('Deactivate → reason "No Longer An Employee" → Yes, Deactivate', async () => {
    const deactivateBtn = page.getByRole('button', { name: 'Deactivate', exact: true }).first();
    await expect(deactivateBtn).not.toHaveClass(/disabled/i, { timeout: 10_000 });
    await deactivateBtn.click();

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
    const deactivateResp = page.waitForResponse(
      (r) => r.url().includes('/platformOne/usersActivateDeactivate.do') && r.status() === 200,
      { timeout: 30_000 }
    );
    await yes.click();
    await deactivateResp;
    await expect(modal).toBeHidden({ timeout: 15_000 });
  });

  // ─── Context 1 (User A): session revoked, must redirect to login ───────
  await test.step('User A session is revoked — Browser 1 bounces to login', async () => {
    await pageA.goto('/react/indexReact.do').catch(() => {});
    await pageA.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    const usernameInput = pageA.getByPlaceholder(/email|username/i).first();
    await Promise.race([
      usernameInput.waitFor({ state: 'visible', timeout: 30_000 }),
      pageA.waitForURL(/#login/i, { timeout: 30_000 }),
    ]);
    await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  });

  // ─── Step 10: re-login attempt must NOT succeed ─────────────────────────
  await test.step('Re-login as User A fails — credentials are revoked', async () => {
    const usernameInput = pageA.getByPlaceholder(/email|username/i).first();
    const passwordInput = pageA.getByPlaceholder(/password/i).first();
    await usernameInput.fill(userA.username);
    await passwordInput.fill(userA.password);
    await pageA.locator('button[type="submit"], button:has-text("Log In")').first().click();
    // Give the BE a moment to reject the login.
    await pageA.waitForTimeout(3000);
    // After a rejected login the page MUST NOT have advanced to an
    // authenticated SPA surface — the login form should still render.
    await expect(usernameInput).toBeVisible({ timeout: 10_000 });
    await expect(pageA).not.toHaveURL(/#platformOne|#dashboard/i, { timeout: 5_000 });
  });

  // ─── Context 3: fresh browser, paste protected URL → login ──────────────
  await test.step('Browser 3 (no cookies) opens the protected URL → login page', async () => {
    const ctxC = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const pageC = await ctxC.newPage();
    await pageC.goto(protectedUrl);
    await pageC.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await expect(pageC.getByPlaceholder(/email|username/i).first()).toBeVisible({
      timeout: 30_000,
    });
    // No "Welcome to Platform One" / protected content should leak through.
    await expect(pageC.getByText(/Welcome to Platform One/i).first()).toBeHidden({
      timeout: 5000,
    });
    await ctxC.close();
  });

  await ctxA.close();
});
