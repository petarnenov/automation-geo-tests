// @ts-check
/**
 * TestRail C26254 — Non-deactivated Client remains logged in Advisor Portal
 *   after deactivate/Disable different Client from Platform One
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26254 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-22184
 *
 * Scenario:
 *   1-2.  Client A + Client G both log into the Client Portal.
 *   3-5.  tim1 → Platform One → Manage Contacts → pick firm where the
 *         clients live.
 *   6.    Search Client A → click → EditClient page loads.
 *   7.    Click Disable → pick "Disable client portal access?" → submit.
 *   8.    Client A's browser → reload → bounced to login (GEO-22184).
 *   9.    Client G's browser → reload → still on Client Portal.
 *
 * Two CLIENT users with Client Portal credentials are provisioned in-test
 * via `provisionClientPortalAccess` (tests/_helpers/client-portal.js) —
 * verified 2026-06-19 on qa4: `POST /ux/createClient.do` with
 * `enabledPortalAccess=true` + `emailAddresses` JSON → `POST
 * /qa/createInvitationToken.do` → `POST /platformOne/setInitialPassword.do`.
 *
 * Source-of-truth (FE):
 *   - EditContactDisableForm.js — submit button "Disable", form fields
 *     `closeAccountAsOfDate` (defaults today, OK), and
 *     `disableClientLoginAccess` (checkbox, the session-revocation gate).
 *   - disableEnableHHClientService.disableHHClient → POST
 *     /platformOne/disableClient.do.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const {
  provisionClientPortalAccess,
  loginAsClient,
} = require('../_helpers/client-portal');

const FIRM_CD = 1;
const MANAGE_CONTACTS_URL = `/react/indexReact.do#platformOne/firmAdmin/contactManagement/manageContacts/${FIRM_CD}`;

test.setTimeout(360_000);

test('@pepi C26254 Non-deactivated Client remains logged in Advisor Portal after another Client is disabled', async ({
  browser,
  page,
}) => {
  await test.step('Login tim1 (will create the test clients in firm 1)', async () => {
    await loginPlatformOneAdmin(page);
  });

  // ── Provision 2 CLIENT users with Portal credentials ────────────────────
  const clientA = await provisionClientPortalAccess(page, {
    firmCd: FIRM_CD,
    namePrefix: 'pepiClientA',
  });
  const clientG = await provisionClientPortalAccess(page, {
    firmCd: FIRM_CD,
    namePrefix: 'pepiClientG',
  });

  // ── Context A: Client A logs into Client Portal ─────────────────────────
  const ctxA = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const pageA = await ctxA.newPage();
  await test.step(`Step 1: Login Client A (${clientA.email}) into Client Portal`, async () => {
    await loginAsClient(pageA, clientA);
    await expect(pageA).toHaveURL(/#(clientPortal|client\/|dashboard)/i, { timeout: 30_000 });
  });

  // ── Context G: Client G logs into Client Portal ─────────────────────────
  const ctxG = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const pageG = await ctxG.newPage();
  await test.step(`Step 1: Login Client G (${clientG.email}) into Client Portal`, async () => {
    await loginAsClient(pageG, clientG);
    await expect(pageG).toHaveURL(/#(clientPortal|client\/|dashboard)/i, { timeout: 30_000 });
  });

  // ── Main page (tim1): Manage Contacts → EditClient → Disable Client A ──
  await test.step('Step 3-5: Open Manage Contacts firm 1 as tim1', async () => {
    await page.goto(MANAGE_CONTACTS_URL);
    const firmInput = page.locator('#selectCompany_typeAhead');
    await expect(firmInput).toHaveValue(new RegExp(`\\(${FIRM_CD}\\)`), { timeout: 30_000 });
  });

  await test.step('Step 6: Open EditClient page for Client A by direct URL', async () => {
    // The qa4 contact-search indexer can lag 60-180 s after a fresh
    // /ux/createClient.do, especially under @pepi parallel load — the
    // autocomplete path is flaky. Skip it: the EditClient route per
    // PlatformOne Router (Router.js:278) + buildContactUrls is
    // `contactManagement/<entityTypeCd>/<firmCd>/<entityID>/editClient`.
    // entityTypeCd=1 for INDIVIDUAL client (config.clientCodes.INDIVIDUAL).
    const ENTITY_TYPE_INDIVIDUAL = 1;
    await page.goto(
      `/react/indexReact.do#platformOne/firmAdmin/contactManagement/${ENTITY_TYPE_INDIVIDUAL}/${FIRM_CD}/${clientA.clientUUID}/editClient`
    );
    await expect(page).toHaveURL(/contactManagement\/.*\/editClient/i, { timeout: 30_000 });
  });

  await test.step('Step 7: Click Disable + tick "Disable client portal access?" + submit', async () => {
    const disableBtn = page.getByRole('button', { name: 'Disable Client', exact: true }).first();
    await expect(disableBtn).toBeVisible({ timeout: 15_000 });
    await disableBtn.click();
    // The Disable form mounts inside a modal. The portal-access checkbox is
    // the gate the session-revocation logic keys off (GEO-22184).
    const portalCheckboxLabel = page.getByText(/Disable client portal access\?/i).first();
    await expect(portalCheckboxLabel).toBeVisible({ timeout: 10_000 });
    await portalCheckboxLabel.click();
    // Form submit button reads "Disable" (FormBuilder submitDisplayName).
    const submit = page.getByRole('button', { name: 'Disable', exact: true }).first();
    const disableResp = page.waitForResponse(
      (r) => r.url().includes('/platformOne/disableClient.do') && r.status() === 200,
      { timeout: 60_000 }
    );
    await submit.click();
    await disableResp;
  });

  // ── Step 8: Client A session is revoked ─────────────────────────────────
  await test.step('Step 8: Client A is bounced to login on next navigation', async () => {
    await pageA.goto('/react/indexReact.do').catch(() => {});
    await pageA.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    const usernameInput = pageA.getByPlaceholder(/email|username/i).first();
    await Promise.race([
      usernameInput.waitFor({ state: 'visible', timeout: 30_000 }),
      pageA.waitForURL(/#login/i, { timeout: 30_000 }),
    ]);
    await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  });

  // ── Step 9: Client G session is unaffected ──────────────────────────────
  await test.step('Step 9: Client G stays logged in on Client Portal', async () => {
    await pageG.goto('/react/indexReact.do').catch(() => {});
    await pageG.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await expect(pageG).toHaveURL(/#(clientPortal|client\/|dashboard)/i, { timeout: 30_000 });
    await expect(pageG.getByPlaceholder(/email|username/i).first()).toBeHidden({
      timeout: 5000,
    });
  });

  await ctxA.close();
  await ctxG.close();
});
