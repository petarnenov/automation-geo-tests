// @ts-check
/**
 * Shared helpers for the Account Billing "Admin and Non-Admin" spec family
 * (C25193..C25249).
 *
 * Each spec follows the same outer shape:
 *   1. login as a GW Admin user (admin can edit) — qa3 convention is `tim{firmCode}`
 *   2. navigate to the test account's Billing tab
 *   3. capture the original value of one billing field
 *   4. open Edit Billing Settings → change the field → Save
 *   5. open History → assert the change appears as a new row
 *   6. (cleanup) open Edit Billing Settings → revert the field → Save
 *   7. clearCookies → login as a non-admin (here `tyler@plimsollfp.com`)
 *   8. navigate to the same Billing tab
 *   9. assert the non-admin canNOT see the Edit button
 *  10. open History → assert the same change row is still visible
 *
 * History accumulates per design (audit trail) — every test run adds 2 rows
 * (one forward, one revert). This is intentional and accepted (option A).
 *
 * Test data is the qa3 Plimsoll FP account "Arnold, Delaney":
 *   client UUID  = A80D472B04874979AAA3D8C3FFE9BD3A
 *   account UUID = 5588D454741342FBB9AABA8FF17A85EE
 * Both `tim106` (GW Admin in firm 106 — same firm Tyler belongs to) and
 * `tyler@plimsollfp.com` (non-admin) can resolve this URL.
 */

const { test, expect } = require('@playwright/test');
const { login } = require('../_helpers/qa3');
const { setReactDatePicker, setComboBoxValue, setReactNumericInput } = require('../_helpers/ui');

const ADMIN_USERNAME = 'tim106';
const { appUnderTest } = require('../_helpers/config').cfg;
// Tyler (firm 106, advisor of the "Arnold, Delaney" client, no BILLING_SETTINGS
// 64_5 permission). Anonymized envs rename him — qabis1 has the same entity
// 04BA4FD68D7B44FA8D0FC9CEFAE0D9CB as `37352@geowealth.com` — so allow a
// per-env override via appUnderTest.accountBillingNonAdmin.
const NON_ADMIN_USERNAME = appUnderTest.accountBillingNonAdmin || 'tyler@plimsollfp.com';

const CLIENT_UUID = 'A80D472B04874979AAA3D8C3FFE9BD3A';
const ACCOUNT_UUID = '5588D454741342FBB9AABA8FF17A85EE';
const ACCOUNT_BILLING_URL = `/react/indexReact.do#/client/1/${CLIENT_UUID}/accounts/${ACCOUNT_UUID}/billing`;

/**
 * Switch the page to a fresh login as the given user.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 * @param {RegExp} expectedLandingUrl
 */
async function loginAs(context, page, username, expectedLandingUrl) {
  await context.clearCookies();
  // Same password as tim1 on every env (TIM1_PASSWORD).
  await login(page, username, appUnderTest.password);
  await expect(page).toHaveURL(expectedLandingUrl, { timeout: 30_000 });
}

async function loginAsAdmin(context, page) {
  await loginAs(context, page, ADMIN_USERNAME, /#dashboard|#platformOne/);
}

async function loginAsNonAdmin(context, page) {
  await loginAs(context, page, NON_ADMIN_USERNAME, /#dashboard/);
}

async function gotoAccountBilling(page) {
  await page.goto(ACCOUNT_BILLING_URL);
  // The Billing tab takes a couple of seconds to render its content; the
  // History button is present for both admin and non-admin and is the most
  // stable signal that the tab finished loading.
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Hybrid-isolation helper: log in as the auto-generated admin of a per-worker
 * dummy firm. Used by the Phase 1 (write/read) flow of the Account Billing
 * spec family to escape the firm 106 race under parallel load. The dummy
 * admin lands on either #dashboard or #platformOne depending on qa branch.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 * @param {{admin: {loginName: string}, password: string}} workerFirm
 */
async function loginAsWorkerFirmAdmin(context, page, workerFirm) {
  await context.clearCookies();
  await login(page, workerFirm.admin.loginName, workerFirm.password);
  await expect(page).toHaveURL(/#(dashboard|platformOne)/, { timeout: 30_000 });
}

/**
 * Navigate to the Billing tab of the worker firm's primary client/account.
 * Same URL shape as ACCOUNT_BILLING_URL — the leading "1" is the client
 * entityTypeCd (not a firm code), so it stays.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{client: {uuid: string}, accounts: Array<{uuid: string}>}} workerFirm
 */
async function gotoWorkerFirmAccountBilling(page, workerFirm) {
  await page.goto(
    `/react/indexReact.do#/client/1/${workerFirm.client.uuid}/accounts/${workerFirm.accounts[0].uuid}/billing`
  );
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function openEditBillingSettings(page) {
  await page.getByRole('button', { name: 'Edit Billing Settings' }).click();
  await expect(page.getByText('Edit Account Billing Settings').first()).toBeVisible({
    timeout: 10_000,
  });
  // The modal title appears immediately, but the form content (date pickers,
  // radios, dropdowns) is fetched async — wait for the Save button to be
  // present, which only renders once the form is fully populated.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function saveEditBillingSettings(page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // After Save the Edit modal closes and a Success modal appears
  // ("Account Billing Successfully Updated!"). Dismiss it via Close.
  await expect(page.getByText(/Account Billing Successfully Updated/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText(/Account Billing Successfully Updated/i)).toBeHidden({
    timeout: 5000,
  });
}

/** Rows in ENTITY_BILLING_DATA_HIST_TBL for an entity — grows by one per committed save. */
function billingHistCount(entityId) {
  const { execFileSync } = require('child_process');
  const { DB_DSN } = require('../_helpers/qa3');
  const out = execFileSync(
    'python3',
    [
      '-c',
      `import os, oracledb,sys
c=oracledb.connect(user=os.environ['GEO_DB_USER'],password=os.environ['GEO_DB_PASSWORD'],dsn='${DB_DSN}')
cur=c.cursor()
cur.execute("SELECT COUNT(*) FROM entity_billing_data_hist_tbl WHERE entity_id=:1",[sys.argv[1]])
print(cur.fetchone()[0])`,
      entityId,
    ],
    { timeout: 60_000 }
  );
  return Number(String(out).trim());
}

/**
 * Submit the Edit Household/Client Billing Settings form and wait until the
 * change is committed.
 *
 * On firm 106 (qabis1) `editBillingClientSettings.do` runs ~90s server-side,
 * longer than the load balancer's 60s idle timeout: the browser gets a 504
 * and the SPA shows "Communication to Server lost" although the save does
 * commit. Treat the 504 as "still running": dismiss the error, poll the
 * entity's billing history table until a new row lands, then reload so the
 * page reflects the persisted state. A 200 keeps the original toast path.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} submit
 */
async function submitClientBillingSettings(page, submit) {
  const entityId = (page.url().match(/#\/?client\/\d+\/([0-9A-F]{32})/i) || [])[1];
  const before = entityId ? billingHistCount(entityId) : null;
  const responseP = page.waitForResponse((r) => r.url().includes('/editBillingClientSettings.do'), {
    timeout: 180_000,
  });
  await submit.click();
  const response = await responseP;

  if (response.status() !== 504) {
    await expect(page.getByText(/Billing Details are Updated/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText(/Billing Details are Updated/i)).toBeHidden({ timeout: 5000 });
    return;
  }

  if (!entityId) throw new Error(`editBillingClientSettings 504 and no entity id in URL ${page.url()}`);
  const lostDialog = page.getByText(/Communication to Server lost/i).first();
  if (await lostDialog.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  }
  await expect
    .poll(() => billingHistCount(entityId), {
      message: `editBillingClientSettings 504: waiting for ${entityId} save to commit`,
      timeout: 240_000,
      intervals: [5000],
    })
    .toBeGreaterThan(before);
  await page.reload();
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

async function openHistory(page) {
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText(/Billing Settings History/i).first()).toBeVisible({
    timeout: 10_000,
  });
}

async function closeHistory(page) {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText(/Billing Settings History/i)).toBeHidden({ timeout: 5000 });
}

/**
 * Find a row in the open History grid that contains the given setting label
 * AND both the before and after text fragments. Returns the locator (caller
 * asserts visibility).
 */
function historyRow(page, { setting, before, after }) {
  return page
    .getByRole('row')
    .filter({ hasText: setting })
    .filter({ hasText: before })
    .filter({ hasText: after });
}

/**
 * Convenience wrapper: set the Billing Inception Date.
 * @param {import('@playwright/test').Page} page
 * @param {string} mmddyyyy
 */
async function setBillingInceptionDate(page, mmddyyyy) {
  await setReactDatePicker(page, page.locator('#billingInceptionDate'), mmddyyyy);
}

/**
 * Read the persisted Billing Inception Date from the Billing summary card
 * (the value rendered next to the "Billing Inception Date" label).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}  e.g. "07/25/2020"
 */
async function getDisplayedBillingInceptionDate(page) {
  return await page
    .locator('text=Billing Inception Date')
    .first()
    .locator('xpath=following-sibling::*[1]')
    .innerText();
}

module.exports = {
  ADMIN_USERNAME,
  NON_ADMIN_USERNAME,
  CLIENT_UUID,
  ACCOUNT_UUID,
  ACCOUNT_BILLING_URL,
  loginAsAdmin,
  loginAsNonAdmin,
  loginAsWorkerFirmAdmin,
  gotoAccountBilling,
  gotoWorkerFirmAccountBilling,
  openEditBillingSettings,
  saveEditBillingSettings,
  submitClientBillingSettings,
  openHistory,
  closeHistory,
  historyRow,
  setReactDatePicker,
  setBillingInceptionDate,
  getDisplayedBillingInceptionDate,
  setComboBoxValue,
  setReactNumericInput,
};
