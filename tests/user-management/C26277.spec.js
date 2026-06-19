// @ts-check
/**
 * TestRail C26277 — Failed deactivation does not logout the Client
 *   (error handling) from Platform One
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26277 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-22184
 *
 * Mirror of C26274 (failed deactivation of a GW Admin user from User
 * Management) but for the CLIENT path — Disable Client via Edit Client
 * in Manage Contacts.
 *
 * Scenario:
 *   1-2.  Client A logs into the Client Portal.
 *   3-6.  tim1 → Platform One → Manage Contacts → EditClient page for A.
 *   7-9.  Click "Disable Client" → modal → fill mandatory fields → click
 *         Disable. BE call is simulated to fail (route-mock returns
 *         `{success:false, errors:["System error occurred. Our technical
 *         support has been informed"]}`).
 *   10-11. Modal stays / closes via X; Client A's session must NOT be
 *         revoked (the GEO-22184 invalidation hook fires ONLY on the
 *         BE-success path).
 *   12.   Client A navigates → still on Client Portal, fully functional.
 *
 * Steps 13-14 (logout + re-login expects "deactivated" error) are
 * intentionally skipped — that copy contradicts the case title and
 * mirrors C26276 (positive scenario). The load-bearing assertion is "BE
 * failure must NOT invalidate the existing session"; that's what we
 * verify here.
 *
 * Source-of-truth:
 *   - disableEnableHHClientService.disableHHClient → POST
 *     /platformOne/disableClient.do (intercepted).
 *   - EditContactDisableForm: submit button "Disable",
 *     `disableClientLoginAccess` checkbox (gates session-revocation on
 *     the success path).
 *   - tests/_helpers/client-portal.js — provisionClientPortalAccess +
 *     loginAsClient.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const {
  provisionClientPortalAccess,
  loginAsClient,
} = require('../_helpers/client-portal');

const FIRM_CD = 1;
const DISABLE_PATH = '/platformOne/disableClient.do';
const ENTITY_TYPE_INDIVIDUAL = 1;

test.setTimeout(300_000);

test('@pepi C26277 Failed deactivation does not log out the Client from Platform One', async ({
  browser,
  page,
}) => {
  await test.step('Login tim1 (will provision the test client)', async () => {
    await loginPlatformOneAdmin(page);
  });

  const clientA = await provisionClientPortalAccess(page, {
    firmCd: FIRM_CD,
    namePrefix: 'pepiCliFailA',
  });

  const ctxA = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const pageA = await ctxA.newPage();
  await test.step(`Login Client A (${clientA.email}) into Client Portal`, async () => {
    await loginAsClient(pageA, clientA);
    await expect(pageA).toHaveURL(/#(clientPortal|client\/|dashboard)/i, { timeout: 30_000 });
  });

  await test.step('Open EditClient page for Client A as tim1', async () => {
    await page.goto(
      `/react/indexReact.do#platformOne/firmAdmin/contactManagement/${ENTITY_TYPE_INDIVIDUAL}/${FIRM_CD}/${clientA.clientUUID}/editClient`
    );
    await expect(page).toHaveURL(/contactManagement\/.*\/editClient/i, { timeout: 30_000 });
  });

  await test.step('Open the Disable Client modal', async () => {
    const disableBtn = page.getByRole('button', { name: 'Disable Client', exact: true }).first();
    await expect(disableBtn).toBeVisible({ timeout: 15_000 });
    await disableBtn.click();
    await expect(page.getByText(/Disable client portal access\?/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step('Simulate BE failure: route-mock disableClient.do → error', async () => {
    await page.route(`**${DISABLE_PATH}**`, async (route) => {
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

  await test.step('Fill mandatory fields + click Disable → BE call returns mocked error', async () => {
    // Tick portal access disable — this is the gate the session-revocation
    // logic would key off on the success path. On the FAILURE path the FE
    // must NOT proceed to revoke.
    const portalCheckboxLabel = page.getByText(/Disable client portal access\?/i).first();
    await portalCheckboxLabel.click();

    const submit = page.getByRole('button', { name: 'Disable', exact: true }).first();
    const intercepted = page.waitForResponse(
      (r) => r.url().includes(DISABLE_PATH),
      { timeout: 30_000 }
    );
    await submit.click();
    await intercepted;
    // Let the FE render the error surface.
    await page.waitForTimeout(2000);
  });

  await test.step('Client A session is still active — no log-out on failed deactivate', async () => {
    await pageA.goto('/react/indexReact.do').catch(() => {});
    await pageA.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    // Login form MUST NOT appear — failed deactivate must NOT invalidate
    // Client A's session per GEO-22184's contract.
    await expect(pageA.getByPlaceholder(/email|username/i).first()).toBeHidden({
      timeout: 10_000,
    });
    await expect(pageA).toHaveURL(/#(clientPortal|client\/|dashboard)/i, { timeout: 30_000 });
  });

  await ctxA.close();
});
