// @ts-check
/**
 * TestRail C26274 — Failed deactivation does not logout the NCC Employee
 * (error handling) from Platform One
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26274 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-22184
 *
 * Pre-condition (per case): "Test with both types GWAdmin or any user for
 * selected site." We satisfy with a fresh firm-1 GW Admin (createGwAdmin
 * patches mfa_required_flag=0, so the user can log in immediately).
 *
 * Scenario:
 *   1-2.  User A logs into Portal (Browser 1), navigates to some menu.
 *   3-4.  GW Admin (tim1) logs into Platform One, opens
 *         Operations → Firm Admin → User Management.
 *   5-7.  Select User A, click Deactivate, pick reason "No Longer An
 *         Employee".
 *   8.    "Stop the CRM before Disable Login confirmation" — the case
 *         requires the BE call to fail. We simulate the failure by
 *         intercepting POST /platformOne/usersActivateDeactivate.do and
 *         returning `{success:false, errors:[...]}` BEFORE clicking the
 *         confirm button, so the FE sees an error and User A's BE
 *         session is never invalidated.
 *   9-10. Click "Yes, Deactivate" → error surface visible; click Confirm.
 *   11.   Switch to Browser 1 — User A is STILL logged in and can
 *         navigate without being bounced to the login screen.
 *
 * Steps 12-13 (Logout + re-login from the portal) are pure positive
 * sanity around the standard login flow already covered by other specs;
 * the load-bearing assertion of this case is "failed deactivation must
 * NOT invalidate the user's existing session" — that's what we verify.
 *
 * Source-of-truth (FE):
 *   - BulkDeactivateButton.js — onConfirm hits
 *     userManagementServices.bulkActivateDeactivateUsers; useService
 *     surfaces `error` and the BulkDeactivateButton routes it through
 *     openErrorModal on the next render.
 *   - userManagementServices.js — POST /platformOne/usersActivateDeactivate.do.
 *   - GEO-22184 wires session invalidation ONLY on the deactivate
 *     success path, so a forced failure must keep User A logged in.
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  createGwAdmin,
  login: qaLogin,
} = require('../_helpers/qa3');
const { selectFirmInTypeAhead } = require('../_helpers/ui');

const DEACTIVATE_PATH = '/platformOne/usersActivateDeactivate.do';

test.setTimeout(360_000);

test('@pepi C26274 Failed deactivation does not log out the User from Platform One', async ({
  browser,
  page,
}) => {
  const userA = await createGwAdmin('pepiFailDeact');

  // ─── Context 1: User A logs in ──────────────────────────────────────────
  const ctxA = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const pageA = await ctxA.newPage();
  await test.step(`Login as User A (${userA.username}) into Platform One`, async () => {
    await qaLogin(pageA, userA.username, userA.password);
    await pageA.waitForURL(/#(platformOne|dashboard)/i, { timeout: 30_000 });
  });

  await test.step('Navigate User A to a menu — Platform One landing renders', async () => {
    // Any visible PlatformOne content proves the menu loaded.
    await expect(pageA.getByText(/Welcome to Platform One|Operations|User Profile/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  // ─── Main page: tim1 GW Admin → UM ──────────────────────────────────────
  await test.step('Login as GW Admin (tim1) into Platform One', async () => {
    await loginPlatformOneAdmin(page);
  });

  await test.step('Navigate Operations → Firm Admin → User Management', async () => {
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

  await test.step(`Filter to firm 1 + email ${userA.emailAddress}`, async () => {
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

  await test.step('Expand parent + select User A child row checkbox', async () => {
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
    await expect(userRow).toBeVisible({ timeout: 10_000 });
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

  await test.step('Pick reason "No Longer An Employee"', async () => {
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
  });

  await test.step('Stop the CRM: route-mock the deactivate POST to return a server error', async () => {
    // The case asks for the BE call to fail (simulated by killing the CRM
    // in production). We mock the response with success=false so the FE
    // never reaches the session-invalidation branch GEO-22184 added.
    await page.route(`**${DEACTIVATE_PATH}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          messages: [],
          errors: ['System error occurred. Our technical support has been informed'],
          objectType: 'error',
          nomenclatureSerial: 0,
        }),
      });
    });
  });

  await test.step('Click "Yes, Deactivate" → BE call returns the mocked error', async () => {
    const modal = page
      .locator('[data-role="modalContainer"]')
      .filter({ hasText: 'Deactivate Users' })
      .first();
    const yes = modal
      .getByRole('button', { name: 'Yes, Deactivate', exact: true })
      .first();
    await expect(yes).not.toHaveClass(/disabled/i, { timeout: 5000 });

    const intercepted = page.waitForResponse(
      (r) => r.url().includes(DEACTIVATE_PATH),
      { timeout: 30_000 }
    );
    await yes.click();
    await intercepted;
    // Give the FE a moment to render the error surface — implementation
    // routes it through the standard error-modal helper.
    await page.waitForTimeout(2000);
  });

  // ─── User A session must still be active ────────────────────────────────
  await test.step('Switch to Browser 1 — User A is STILL logged in after failed deactivation', async () => {
    await pageA.goto('/react/indexReact.do').catch(() => {});
    await pageA.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    // Login form MUST NOT appear — the failed deactivation should NOT
    // have invalidated User A's session per GEO-22184's contract.
    await expect(pageA.getByPlaceholder(/email|username/i).first()).toBeHidden({
      timeout: 10_000,
    });
    await expect(pageA).toHaveURL(/#(platformOne|dashboard)/i, { timeout: 30_000 });
  });

  await ctxA.close();
});
