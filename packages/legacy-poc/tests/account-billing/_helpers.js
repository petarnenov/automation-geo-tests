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
const NON_ADMIN_USERNAME = 'tyler@plimsollfp.com';
// Phase 0 Step 0.E discovered this hardcoded copy of the tim1 shared password
// (Step 0.C grep was scoped to testrail.config references and missed it).
// All firm advisors and tyler share the same password convention.
const SHARED_PASSWORD = process.env.TIM1_PASSWORD;
if (!SHARED_PASSWORD) {
  throw new Error(
    'account-billing/_helpers: TIM1_PASSWORD must be set ' +
      '(workspace-root .env.local or shell). Phase 0 Step 0.E.'
  );
}

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
  await login(page, username, SHARED_PASSWORD);
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
  SHARED_PASSWORD,
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
  openHistory,
  closeHistory,
  historyRow,
  setReactDatePicker,
  setBillingInceptionDate,
  getDisplayedBillingInceptionDate,
  setComboBoxValue,
  setReactNumericInput,
};
