// @ts-check
/**
 * Shared qa3 actions for the @pepi suite. Keep this surface intentionally small —
 * each helper is one focused step that several specs reuse.
 */

const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'testrail.config.json'), 'utf8')
);

/**
 * Log in via the qa3 login form. Works for both Platform One admins (lands on
 * #platformOne) and advisor users (lands on #dashboard) — the caller asserts
 * which landing URL it expects.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 * @param {string} password
 */
async function login(page, username, password) {
  await page.goto('/');
  // qa3 routes to /#login asynchronously after the SPA boots; wait for it
  // before touching the form fields. The form uses placeholder-only inputs
  // (no role/name/label), so we match by placeholder.
  await page.waitForURL(/#login/, { timeout: 30_000 });
  await page.getByPlaceholder(/email|username/i).fill(username);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
}

/**
 * Ensure the page is authenticated as a Platform One GW Admin.
 *
 * The session is preloaded by the worker's storageState (per-worker GW Admin
 * created during globalSetup), so the common case is just a navigate + URL
 * assertion. If the session expired or was cleared mid-test, fall back to
 * the full login form using the provided credentials (or tim1 as default).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{username: string, password: string}} [credentials]  Worker GW Admin
 *   credentials for fallback login. Falls back to tim1 if omitted.
 */
async function loginPlatformOneAdmin(page, credentials) {
  const user = credentials?.username || cfg.appUnderTest.username;
  const pass = credentials?.password || cfg.appUnderTest.password;

  await page.goto('/react/indexReact.do#platformOne');
  // The URL hash is #platformOne immediately after goto, but the SPA may
  // still redirect to #login on its own (the redirect happens in JS, after
  // the bundle boots). We can't rely on waitForURL alone — instead, race
  // for whichever DOM signal appears first: the login form, or any
  // authenticated platformOne page content.
  const usernameInput = page.getByPlaceholder(/email|username/i);
  const platformOneContent = page.getByText(/Welcome to Platform One/i);
  await Promise.race([
    usernameInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    platformOneContent.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
  ]);

  if (await usernameInput.isVisible().catch(() => false)) {
    // Session is genuinely expired — full form login.
    await login(page, user, pass);
    await page.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
  }

  if (!page.url().includes('#platformOne')) {
    // Session is valid but landed on #dashboard. GW Admin still has
    // Platform One permissions — force-navigate.
    await page.goto('/react/indexReact.do#platformOne');
    await expect(page).toHaveURL(/#platformOne/, { timeout: 30_000 });
  }
}

/**
 * Login as the firm-N advisor (qa3 convention: timN with the same password as tim1).
 * @param {import('@playwright/test').Page} page
 * @param {number} firmCode
 */
async function loginFirmAdvisor(page, firmCode) {
  await login(page, `tim${firmCode}`, cfg.appUnderTest.password);
  await expect(page).toHaveURL(/#dashboard/, { timeout: 30_000 });
}

/**
 * Login as a specific advisor by login name. Used for dummy-firm advisors
 * (`adv_<firmCd>_<n>`) returned from /qa/createDummyFirm.do — they share the
 * standard qa3 password, so the only difference vs loginFirmAdvisor is the
 * username.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} loginName
 */
async function loginAsAdvisor(page, loginName) {
  await login(page, loginName, cfg.appUnderTest.password);
  await expect(page).toHaveURL(/#dashboard/, { timeout: 30_000 });
}

/**
 * Switch identity inside a single test by clearing cookies and re-logging in.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 */
async function switchToFirmAdvisor(context, page, firmCode) {
  await context.clearCookies();
  await loginFirmAdvisor(page, firmCode);
}

/**
 * Same as switchToFirmAdvisor, but takes a literal advisor login name —
 * the dummy-firm equivalent.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 * @param {string} loginName
 */
async function switchToAdvisor(context, page, loginName) {
  await context.clearCookies();
  await loginAsAdvisor(page, loginName);
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Normalize the various forms an upload helper accepts into a fileChooser
 * payload + the filename that will appear in the staged-file UI.
 *
 * Accepted forms:
 *   - string  → absolute path on disk; name shown is path.basename(...)
 *   - Buffer  → in-memory xlsx; named with `defaultName`
 *   - { name, buffer, mimeType? } → in-memory xlsx with explicit filename
 *
 * @param {string | Buffer | {name?: string, buffer: Buffer, mimeType?: string}} file
 * @param {string} defaultName
 * @returns {{ payload: string | {name: string, mimeType: string, buffer: Buffer}, displayName: string }}
 */
function resolveUploadInput(file, defaultName) {
  if (Buffer.isBuffer(file)) {
    return {
      payload: { name: defaultName, mimeType: XLSX_MIME, buffer: file },
      displayName: defaultName,
    };
  }
  if (file && typeof file === 'object' && Buffer.isBuffer(file.buffer)) {
    const name = file.name || defaultName;
    return {
      payload: { name, mimeType: file.mimeType || XLSX_MIME, buffer: file.buffer },
      displayName: name,
    };
  }
  if (typeof file === 'string') {
    return { payload: file, displayName: path.basename(file) };
  }
  throw new TypeError(
    `qa3 upload helper: expected string path | Buffer | { buffer }, got ${typeof file}`
  );
}

/**
 * Internal: shared body for the Platform One bulk-exclusions upload routes.
 * Both `uploadUnmanagedAssetsExclusions` and `uploadBillingBucketExclusions`
 * differ only in URL slug and default filename — every other step (firm
 * input wait, file chooser, Upload button, first-time confirmation modal,
 * success modal dismissal) is identical.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {string} opts.url
 * @param {number} opts.firmCode
 * @param {string | Buffer | {name?: string, buffer: Buffer, mimeType?: string}} opts.file
 * @param {string} opts.defaultName
 */
async function _uploadExclusionsXlsx(page, { url, firmCode, file, defaultName }) {
  await page.goto(url);

  const firmInput = page.getByRole('textbox').first();
  await expect(firmInput).toBeVisible({ timeout: 15_000 });
  await expect(firmInput).toHaveValue(new RegExp(`\\(${firmCode}\\)`), {
    timeout: 30_000,
  });

  const { payload, displayName } = resolveUploadInput(file, defaultName);

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse For File' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(payload);

  await expect(page.getByText(displayName)).toBeVisible();

  // Wait for the Upload button to actually be ready instead of a fixed sleep.
  const uploadBtn = page.getByRole('button', { name: 'Upload', exact: true });
  await expect(uploadBtn).toBeEnabled({ timeout: 10_000 });
  await uploadBtn.click();

  // First-time-only confirmation modal — subsequent uploads skip it.
  try {
    await page.getByRole('button', { name: 'Yes, Proceed' }).click({ timeout: 10_000 });
  } catch {}

  // 180s — under full @pepi suite parallel load (8 workers), qa2 queues
  // bulk-exclusions uploads serially backend-side, so the success message can
  // surface 100-150s after the click. 90s was enough for the partial-suite
  // run but flaked on C25377 / C26075 in the full suite.
  await expect(page.getByText(/imported successfully/i).first()).toBeVisible({
    timeout: 180_000,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

/**
 * Upload an Unmanaged Assets Exclusions xlsx for the given firm via Platform One.
 * Returns once the success modal has been confirmed and dismissed.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} firmCode
 * @param {string | Buffer | {name?: string, buffer: Buffer, mimeType?: string}} file
 *   Pass an absolute path for static fixtures, a Buffer for in-memory xlsx
 *   (e.g. built via build-unmanaged-assets-xlsx.js), or `{ name, buffer }` to
 *   override the displayed filename.
 */
async function uploadUnmanagedAssetsExclusions(page, firmCode, file) {
  await _uploadExclusionsXlsx(page, {
    url: `/react/indexReact.do#platformOne/uploadTools/bulkExclusions/unmanagedAssetsExclusions/${firmCode}`,
    firmCode,
    file,
    defaultName: 'UnmanagedAssetsExclusions.xlsx',
  });
}

/**
 * Upload a Billing Bucket Exclusions xlsx for the given firm via Platform One.
 * Same UI shape as Unmanaged Assets Exclusions, just a different upload route.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} firmCode
 * @param {string | Buffer | {name?: string, buffer: Buffer, mimeType?: string}} file
 */
async function uploadBillingBucketExclusions(page, firmCode, file) {
  await _uploadExclusionsXlsx(page, {
    url: `/react/indexReact.do#platformOne/uploadTools/bulkExclusions/billingBucketExclusions/${firmCode}`,
    firmCode,
    file,
    defaultName: 'BillingBucketExclusions.xlsx',
  });
}

/**
 * Navigate to a Household's Billing Settings tab (Details & Activity → Billing Settings).
 * @param {import('@playwright/test').Page} page
 * @param {string} householdUuid
 */
async function gotoHouseholdBillingSettings(page, householdUuid) {
  await page.goto(`/react/indexReact.do#/client/5/${householdUuid}/detailsActivity/info`);
  // The Billing Settings tab content is rendered through SPA routing — clicking
  // the in-page link is more reliable than navigating to the deep URL directly.
  await page.getByRole('link', { name: 'Billing Settings' }).click();
  await expect(page.getByText(/ADVISOR BILLING SPEC/i).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Navigate to a Client's Billing Settings tab (same SPA pattern as the household).
 * @param {import('@playwright/test').Page} page
 * @param {string} clientUuid
 */
async function gotoClientBillingSettings(page, clientUuid) {
  await page.goto(`/react/indexReact.do#/client/1/${clientUuid}/detailsActivity/info`);
  await page.getByRole('link', { name: 'Billing Settings' }).click();
  await expect(page.getByText(/ADVISOR BILLING SPEC/i).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Navigate the Advisor Portal to a specific account's Unmanaged Assets table.
 * @param {import('@playwright/test').Page} page
 * @param {string} clientUuid
 * @param {string} accountUuid
 */
async function gotoAccountUnmanagedAssets(page, clientUuid, accountUuid) {
  await page.goto(
    `/react/indexReact.do#client/1/${clientUuid}/accounts/${accountUuid}/unmanagedAssets`
  );
  // Wait for either a data row or the empty state — both indicate the grid loaded.
  await expect(
    page
      .getByRole('button', { name: 'Manage Unmanaged Assets' })
      .or(page.getByText(/no.*records/i).first())
  ).toBeVisible({ timeout: 30_000 });
}

const { STORAGE_STATE_PATH } = require('./global-setup');

/**
 * Create a GW Admin employee in firm 1 via the Platform One
 * `/platformOne/createUpdateUser.do` endpoint.
 *
 * Uses the saved tim1 session (must already exist from globalSetup).
 * Returns the newly created user's entity UUID.
 *
 * @param {string} name  A short identifier used to derive username / first name
 *   (e.g. "pepiBot"). The actual username is `<name>_<timestamp>` to guarantee
 *   uniqueness.
 * @returns {Promise<{userId: string, username: string, password: string}>}
 */
async function createGwAdmin(name) {
  const storageRaw = fs.readFileSync(STORAGE_STATE_PATH, 'utf8');
  const cookies = JSON.parse(storageRaw)
    .cookies.map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const base = cfg.appUnderTest.url.replace(/\/$/, '');
  const username = `${name}_${Date.now()}`;
  const password = 'C0w&ch1k3n'; // meets uppercase+lowercase+digit+special requirement

  const payload = {
    firmCd: 1,
    firstName: name,
    lastName: 'GWAdmin',
    username,
    password,
    emailAddress: `${username}@geowealth.com`,
    gwAdminFlag: true,
    mfaEnabledFlag: false,
    sendInviteFlag: false,
    defaultRoleCd: 529, // "All Employees" — firm 1 default role
    rolesCds: [529],
  };

  const res = await fetch(`${base}/platformOne/createUpdateUser.do`, {
    method: 'POST',
    headers: {
      Cookie: cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `q=${encodeURIComponent(JSON.stringify(payload))}`,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `createGwAdmin: endpoint did not return JSON (status=${res.status}): ${text.slice(0, 300)}`
    );
  }
  if (!data.success) {
    throw new Error(`createGwAdmin: server returned success=false: ${text.slice(0, 300)}`);
  }

  const userId = (data.messages && data.messages[0]) || null;

  // The backend forces mfaRequiredFlag=true for GW Admins (GEO-3694).
  // Disable it directly in the DB so the login flow doesn't require a
  // passcode — test environments have no real email delivery.
  const { execSync } = require('child_process');
  execSync(
    `python3 -c "
import oracledb
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
cur.execute('UPDATE entity_tbl SET mfa_required_flag = 0 WHERE entity_id = :1', ['${userId}'])
c.commit()
c.close()
"`,
    { timeout: 15_000 }
  );

  return {
    userId,
    username,
    password,
    emailAddress: `${username}@geowealth.com`,
    firstName: name,
    lastName: 'GWAdmin',
  };
}

/**
 * Age a user's most recent password-change record (see [[password-reset-90d]]
 * memory). Default 91 days → forces the UpdatePasswordModal on first login;
 * smaller values land in the ExpirationWarningModal "in N days" branch
 * (warning shows at days_remaining ≤ 14, i.e. daysAgo ≥ 76).
 *
 * The `ENTITY_PSWD_CHANGE_TBL` table holds one row per password change for
 * each entity; `NEntity.getPasswordExpirationDays()` reads the newest row's
 * `CHANGE_DATE`. If the user has no row yet (just-created GW Admin), we
 * INSERT one dated `daysAgo` days in the past.
 *
 * @param {string} entityId  the user's entity UUID (from createGwAdmin)
 * @param {number} [daysAgo=91]  how far in the past to set `change_date`
 */
function expireUserPassword(entityId, daysAgo = 91) {
  if (!Number.isInteger(daysAgo) || daysAgo < 0) {
    throw new Error(`expireUserPassword: daysAgo must be a non-negative integer (got ${daysAgo})`);
  }
  const { execSync } = require('child_process');
  execSync(
    `python3 -c "
import oracledb
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
# Use MERGE so the same call works whether or not a row already exists.
cur.execute('''
    MERGE INTO entity_pswd_change_tbl t
    USING (SELECT :1 AS entity_id FROM dual) s
    ON (t.entity_id = s.entity_id)
    WHEN MATCHED THEN
        UPDATE SET change_date = TRUNC(SYSDATE - ${daysAgo})
    WHEN NOT MATCHED THEN
        INSERT (entity_id, change_date) VALUES (s.entity_id, TRUNC(SYSDATE - ${daysAgo}))
''', ['${entityId}'])
c.commit()
c.close()
"`,
    { timeout: 15_000 }
  );
}

/**
 * Read the most recent password-change timestamp for a user from
 * ENTITY_PSWD_CHANGE_TBL (see [[password-reset-90d]] memory).
 *
 * NEntity.getPasswordExpirationDays() reads the newest row's CHANGE_DATE;
 * we select MAX(change_date) and return it as epoch ms (or null if the user
 * has no row yet). Useful for asserting that a real password-change UI
 * flow actually updated the DB timestamp.
 *
 * @param {string} entityId
 * @returns {number|null}  epoch milliseconds, or null
 */
function getLastPasswordChangeMs(entityId) {
  const { execSync } = require('child_process');
  const out = execSync(
    `python3 -c "
import oracledb, sys
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
cur.execute('SELECT MAX(change_date) FROM entity_pswd_change_tbl WHERE entity_id = :1', ['${entityId}'])
row = cur.fetchone()
c.close()
if row and row[0] is not None:
    print(int(row[0].timestamp() * 1000))
else:
    print('')
"`,
    { timeout: 15_000 }
  )
    .toString()
    .trim();
  return out === '' ? null : Number(out);
}

/**
 * Link one entity to another so they share password+MFA state. The
 * geowealth backend (`UserManagerTrait.checkAndUpdatePasswordForUser` →
 * `NEntityDAO.getAllLinkedEntities`) propagates password changes to every
 * NEntity whose `linkedEntity = <changer>` — keyed by the
 * `LINKED_GW_USER` column on `entity_tbl`.
 *
 * Used to set up "linked accounts across systems" scenarios in the
 * 90-day password reset suite (e.g. C24981 verifies the sync).
 *
 * @param {string} linkedEntityId  the user that becomes a "follower"
 * @param {string} parentEntityId  the user whose password drives the sync
 */
function linkUserTo(linkedEntityId, parentEntityId) {
  const { execSync } = require('child_process');
  execSync(
    `python3 -c "
import oracledb
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
cur.execute('UPDATE entity_tbl SET linked_gw_user = :1 WHERE entity_id = :2', ['${parentEntityId}', '${linkedEntityId}'])
c.commit()
c.close()
"`,
    { timeout: 15_000 }
  );
}

/**
 * Create a firm user via `/platformOne/createUpdateUser.do` (the same
 * endpoint `createGwAdmin` uses), parameterised for either a GW Admin
 * (gwAdminFlag=true, default firm 1) or a regular firm member
 * (gwAdminFlag=false, any firm). Used by the User Management Edit User
 * modal tests (C41285…C41295) which need both shapes.
 *
 * Side effects:
 *   - For GW Admins, applies the same MFA-off DB patch as createGwAdmin
 *     so the resulting user can log in without an emailed passcode.
 *
 * @param {object} opts
 * @param {string} opts.name              short identifier; used as firstName + part of username
 * @param {boolean} [opts.gwAdminFlag]    default false
 * @param {number}  [opts.firmCd]         default 1
 * @param {string}  [opts.emailAddress]   default `${username}@geowealth.com`
 * @returns {Promise<{userId: string, username: string, password: string, emailAddress: string, firstName: string, lastName: string}>}
 */
async function createFirmUser({ name, gwAdminFlag = false, firmCd = 1, emailAddress }) {
  const storageRaw = fs.readFileSync(STORAGE_STATE_PATH, 'utf8');
  const cookies = JSON.parse(storageRaw)
    .cookies.map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const base = cfg.appUnderTest.url.replace(/\/$/, '');
  const username = `${name}_${Date.now()}`;
  const password = 'C0w&ch1k3n';
  const email = emailAddress || `${username}@geowealth.com`;

  const firstName = name;
  const lastName = gwAdminFlag ? 'GWAdmin' : 'FirmUser';
  const payload = {
    firmCd,
    firstName,
    lastName,
    username,
    password,
    emailAddress: email,
    gwAdminFlag,
    mfaEnabledFlag: false,
    sendInviteFlag: false,
    defaultRoleCd: 529,
    rolesCds: [529],
  };

  const res = await fetch(`${base}/platformOne/createUpdateUser.do`, {
    method: 'POST',
    headers: {
      Cookie: cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `q=${encodeURIComponent(JSON.stringify(payload))}`,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `createFirmUser: endpoint did not return JSON (status=${res.status}): ${text.slice(0, 300)}`
    );
  }
  if (!data.success) {
    throw new Error(`createFirmUser: server returned success=false: ${text.slice(0, 300)}`);
  }

  const userId = (data.messages && data.messages[0]) || null;

  if (gwAdminFlag) {
    const { execSync } = require('child_process');
    execSync(
      `python3 -c "
import oracledb
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
cur.execute('UPDATE entity_tbl SET mfa_required_flag = 0 WHERE entity_id = :1', ['${userId}'])
c.commit()
c.close()
"`,
      { timeout: 15_000 }
    );
  }

  return { userId, username, password, emailAddress: email, firstName, lastName };
}

/**
 * Read the user's primary email straight from `ENTITY_EMAIL_TBL`.
 * Used to verify UI-driven email updates persisted to the DB without
 * having to re-navigate through User Management.
 *
 * @param {string} entityId
 * @returns {string|null}
 */
function getUserPrimaryEmail(entityId) {
  const { execSync } = require('child_process');
  const out = execSync(
    `python3 -c "
import oracledb
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
cur.execute('SELECT email FROM entity_email_tbl WHERE entity_id = :1 AND primary_email_flag = 1', ['${entityId}'])
row = cur.fetchone()
c.close()
print(row[0] if row else '')
"`,
    { timeout: 15_000 }
  )
    .toString()
    .trim();
  return out === '' ? null : out;
}

/**
 * Patch a user's primary email directly in `ENTITY_EMAIL_TBL`. Used to
 * seed legacy/invalid-stored-email scenarios (C41291) without going
 * through the createUpdateUser endpoint that would reject invalid
 * domains for a GW Admin.
 *
 * @param {string} entityId
 * @param {string} email
 */
function patchUserPrimaryEmail(entityId, email) {
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
    throw new Error(`patchUserPrimaryEmail: invalid email '${email}'`);
  }
  const { execSync } = require('child_process');
  execSync(
    `python3 -c "
import oracledb
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
cur.execute('UPDATE entity_email_tbl SET email = :1 WHERE entity_id = :2 AND primary_email_flag = 1', ['${email}', '${entityId}'])
c.commit()
c.close()
"`,
    { timeout: 15_000 }
  );
}

/**
 * Seed a USER_LINK_TBL row for the Forgot Password reset flow, returning
 * the generated link UUID. The real "Forgot Password" trigger
 * (`/react/lostPassword.do`) creates the same row via
 * `UserHibernateDAO.createUserLink` and emails the user; in tests we
 * bypass email delivery by inserting directly.
 *
 * The row is the proof-of-possession token for the
 * `<base>/changePassword.do?id=<UUID>` JSP form
 * (`com.geowealth.web.common.action.ChangePasswordAction`).
 *
 * @param {string} entityId  the user's entity UUID
 * @returns {string}  the 32-char hex link UUID (matches LINK_ID column)
 */
function createLostPasswordLink(entityId) {
  const crypto = require('crypto');
  const linkId = crypto.randomUUID().replace(/-/g, '').toUpperCase();
  const { execSync } = require('child_process');
  execSync(
    `python3 -c "
import oracledb
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
cur.execute('INSERT INTO user_link_tbl (link_id, user_id) VALUES (:1, :2)', ['${linkId}', '${entityId}'])
c.commit()
c.close()
"`,
    { timeout: 15_000 }
  );
  return linkId;
}

module.exports = {
  cfg,
  login,
  loginPlatformOneAdmin,
  loginFirmAdvisor,
  loginAsAdvisor,
  switchToFirmAdvisor,
  switchToAdvisor,
  uploadUnmanagedAssetsExclusions,
  uploadBillingBucketExclusions,
  gotoHouseholdBillingSettings,
  gotoClientBillingSettings,
  gotoAccountUnmanagedAssets,
  resolveUploadInput,
  createGwAdmin,
  createFirmUser,
  patchUserPrimaryEmail,
  getUserPrimaryEmail,
  expireUserPassword,
  getLastPasswordChangeMs,
  linkUserTo,
  createLostPasswordLink,
};
