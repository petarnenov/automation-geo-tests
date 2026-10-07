// @ts-check
/**
 * Helper: provision a CLIENT in a given firm with full Client Portal login
 * credentials in one round-trip.
 *
 * Verified on qa4 (2026-06-19) — three endpoints stitched together:
 *
 *   1. POST /ux/createClient.do
 *      Creates the CLIENT entity. With `enabledPortalAccess=true` and an
 *      `emailAddresses` JSON the BE additionally calls
 *      `UserManager.activateClientLogin(...)` which provisions the
 *      ldap_uid/portal-access row keyed off the primary email. Without
 *      that JSON (PlatformOne branch in
 *      `CreateUpdateClientContactAction.createClient`) BE silently skips
 *      activation and login fails downstream — be sure to send BOTH the
 *      individual `emailAddress*` form fields AND the `emailAddresses`
 *      JSON.
 *
 *   2. POST /qa/createInvitationToken.do?userEmail=<email>
 *      Generates a one-shot invitation token bound to the client's email.
 *      Verified to work on qa4 (no `DeveloperUtils.isDevelopmentModeEnabled`
 *      gate).
 *
 *   3. POST /platformOne/setInitialPassword.do  body=q={invitationId,password}
 *      Sets the password via the same path the InvitationPasswordModal
 *      uses. Returns "Password changed successfully" on the happy path.
 *
 * The returned record carries `{clientUUID, email, password}` — the test
 * can then fill the standard #login form with email + password to land
 * on `#clientPortal/dashboard`.
 */

const { dbExec } = require('./db');

const { cfg } = require('./config');
const { requireEnv } = require('./env');

/**
 * Provision a Client Portal-enabled client in `firmCd`.
 *
 * @param {import('@playwright/test').Page} adminPage  authenticated as tim1
 *   (or any GW Admin with permission to create clients in the target firm).
 * @param {object} opts
 * @param {number} opts.firmCd
 * @param {string} [opts.namePrefix='pepiCli']  first name + username prefix
 * @param {string} [opts.lastName='PortalCli']
 * @param {string} [opts.password] defaults to GEO_TEST_USER_PASSWORD
 * @param {string} [opts.emailDomain='geowealth.com']
 * @returns {Promise<{clientUUID:string, email:string, password:string, firstName:string, lastName:string, firmCd:number}>}
 */
async function provisionClientPortalAccess(
  adminPage,
  {
    firmCd,
    namePrefix = 'pepiCli',
    lastName = 'PortalCli',
    password = requireEnv('GEO_TEST_USER_PASSWORD'),
    emailDomain = 'geowealth.com',
  }
) {
  const baseURL = cfg.appUnderTest.url;
  const username = `${namePrefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const email = `${username}@${emailDomain}`;
  const firstName = namePrefix;

  // ── Step 1: create client + activate portal access ───────────────────────
  const form = new URLSearchParams();
  form.append('firmCd', String(firmCd));
  form.append('clientType', '1'); // INDIVIDUAL
  form.append('contactTypes', '1');
  form.append('givenName', firstName);
  form.append('surname', lastName);
  // BOTH email shapes — `emailAddresses` JSON is the trigger for the
  // platformOneRequest=true branch in BE; the individual fields are
  // consumed by the non-P1 branch as a backup.
  form.append('emailAddress', email);
  form.append('emailName', email);
  form.append('emailTypeCd', '1');
  form.append('emailSequenceNumber', '0');
  form.append('emailPrimary', '0');
  form.append('emailAddresses', JSON.stringify([{ emailAddress: email, isPrimary: true }]));
  form.append('addressPrimary', '0');
  form.append('phonePrimary', '0');
  form.append('enabledPortalAccess', 'true');
  form.append('showPortfolioClPortal', 'inherit');
  form.append('dataJson', '[]');
  form.append('platformOneRequest', 'true');

  const createRes = await adminPage.request.post(`${baseURL}ux/createClient.do`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
    timeout: 60_000,
  });
  if (!createRes.ok()) {
    throw new Error(`provisionClientPortalAccess: createClient HTTP ${createRes.status()}`);
  }
  const createBody = await createRes.json();
  if (createBody?.success !== true) {
    throw new Error(
      `provisionClientPortalAccess: createClient success=false — ${JSON.stringify(createBody).slice(0, 400)}`
    );
  }
  const clientUUID = createBody?.metaData?.extra?.model?.geoUUID;
  if (!clientUUID) {
    throw new Error('provisionClientPortalAccess: no clientUUID in response');
  }

  // ── Step 2: invitation token ─────────────────────────────────────────────
  const tokenRes = await adminPage.request.post(`${baseURL}qa/createInvitationToken.do`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: `userEmail=${encodeURIComponent(email)}`,
    timeout: 30_000,
  });
  const tokenBody = await tokenRes.json();
  const invitationId = tokenBody?.messages?.[0];
  if (!invitationId) {
    throw new Error(
      `provisionClientPortalAccess: no invitationId returned — ${JSON.stringify(tokenBody).slice(0, 400)}`
    );
  }

  // ── Step 3: set initial password ────────────────────────────────────────
  const setPwForm = new URLSearchParams();
  setPwForm.append('q', JSON.stringify({ invitationId, password }));
  // setInitialPassword.do can take well over 30s on slower envs (qabis1).
  const setPwRes = await adminPage.request.post(`${baseURL}platformOne/setInitialPassword.do`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: setPwForm.toString(),
    timeout: 120_000,
  });
  const setPwBody = await setPwRes.json();
  if (setPwBody?.success !== true) {
    throw new Error(
      `provisionClientPortalAccess: setInitialPassword success=false — ${JSON.stringify(setPwBody).slice(0, 400)}`
    );
  }

  // ── Step 4: seed LDAP_UID directly ────────────────────────────────────────
  // createClient's activateClientLogin sets ldap_uid (the login username) but
  // only commits that transaction AFTER sending the activation email. qa4 has
  // no SMTP for @geowealth.com, so the send throws and the whole tx rolls back,
  // leaving ldap_uid NULL — login is then rejected ("having trouble logging
  // in") even though setInitialPassword committed the password hash in its own
  // transaction. isLoginActive = !loginInactivatedFlag && ldapUid!=null
  // (UserManagerTrait), so restoring ldap_uid here is all that's needed;
  // entity_active_flag is already 1 and the hash is already set.
  dbExec('UPDATE entity_tbl SET ldap_uid = :1, login_inactivated_flag = 0 WHERE entity_id = :2', [
    email,
    clientUUID,
  ]);

  return { clientUUID, email, password, firstName, lastName, firmCd };
}

/**
 * Drive the standard #login form with the supplied email/password and wait
 * for the Client Portal dashboard URL to land. Asserts via URL match — the
 * helper does NOT bring its own `expect`, so callers can wrap with one.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{email:string, password:string}} creds
 */
async function loginAsClient(page, { email, password }) {
  await page.goto(cfg.appUnderTest.url + '/');
  await page.waitForURL(/#login/, { timeout: 30_000 });
  await page.getByPlaceholder(/email|username/i).fill(email);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  // A client provisioned in an internal/admin firm (e.g. firm 1) logs in as a
  // GW-internal user and getHomePage() routes to /platformOne, never the client
  // portal — the clientPortal regex would then silently time out at 30s. Race
  // both landings and fail loudly with the actual cause instead.
  await Promise.race([
    page.waitForURL(/#(clientPortal|client\/|dashboard)/, { timeout: 30_000 }),
    page.waitForURL(/#platformOne/, { timeout: 30_000 }),
  ]);
  if (/#platformOne/.test(page.url())) {
    throw new Error(
      `loginAsClient: ${email} landed on Platform One (admin), not the Client Portal — ` +
        'the client was provisioned in an internal/admin firm (check firmCd; must not be firm 1).'
    );
  }
}

module.exports = {
  provisionClientPortalAccess,
  loginAsClient,
};
