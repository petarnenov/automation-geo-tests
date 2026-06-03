// @ts-check
/**
 * Shared steps for the Edit-User-modal suite (C41285-C41295).
 *
 * Driving Firm Admin → User Management as tim1 requires a specific
 * sequence (discovered with user help):
 *   1. goto `#platformOne/firmAdmin/userManagement` (no query — the SPA
 *      ignores `?firmCd=…` query params on initial load).
 *   2. Pick firm 1 in the advanced-search Firm typeAhead.
 *   3. Type the user's username into the email filter with real
 *      keystrokes, then wait ~400ms for React to commit before Save —
 *      otherwise the submit posts firmCd only and the grid returns all
 *      firm 1 users.
 *   4. Click Search. For firm 1 the grid renders in tree-data mode
 *      (UserManagement.js: `treeData = gridType == GRID_TYPE_FIRM_1`).
 *      The parent row collapses children by default.
 *   5. Click the parent row to expand.
 *   6. The child row's surname cell renders a `<button class="link___…">`
 *      with the text "<firstName> GWAdmin" (firstName is the createGwAdmin
 *      `name` arg). Clicking it triggers the column's onClick →
 *      openEditUserModal.
 *
 * Note: the advanced search's `#emailField` and the Edit User modal's
 * `#emailField` share the same id. Scope email-field interactions inside
 * the modal to `modalBody.locator('#emailField')`.
 */

const { expect } = require('@playwright/test');
const { selectFirmInTypeAhead } = require('../_helpers/ui');

const MODAL_BODY = '[data-testid="userManagementEditUserModal-body"]';
// The User Management page renders two FormBuilder submit buttons:
// "Search" in the advanced-search panel and "Save" in the Edit User
// modal. Scope by exact button name (account-billing pattern, e.g.
// `saveEditBillingSettings` in tests/account-billing/_helpers.js:118).
const MODAL_SUBMIT_NAME = /^Save$/;
// FormBuilder renders the email field's error in a `<div id="emailError"
// data-type="errorMessage">` under the input. The text matches
// `GW_ADMIN_EMAIL_ERROR_RE`. Scope to the modal to avoid colliding with the
// advanced-search panel that has its own `#emailField`.
const MODAL_EMAIL_ERROR = '#emailError';
const GW_ADMIN_EMAIL_ERROR_RE = /GW_Admin users must use a @geowealth\.com email address/i;
// The confirmation message text varies with which field actually changed
// (EditUserModal.tsx: `confirmationMessage` switches on isUserIdChanged /
// areNamesChanged / isEmailChanged). Match the common "about to update" /
// "Would you like to proceed?" pair that all four variants share.
const CONFIRM_EMAIL_CHANGE_RE = /Would you like to proceed/i;

/**
 * Navigate to User Management for firm 1, filter to the target user, expand
 * the parent row, and click the link button that opens the Edit User modal.
 * Returns the modal-body locator (scope further interactions to it to avoid
 * id collisions with the advanced search).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{userId: string, username: string, firstName?: string, lastName?: string, emailAddress?: string}} user
 *   `firstName` defaults to the part of `username` before the first `_`
 *   (matches createGwAdmin's naming). `lastName` defaults to "GWAdmin"
 *   for `createGwAdmin` users and "FirmUser" for `createFirmUser` users.
 * @param {object} [opts]
 * @param {string} [opts.searchEmail]  Override the email used for the
 *   advanced-search filter. Default `user.username`, which works because
 *   the server-side filter matches the email column and the default email
 *   contains the username. Pass the patched email (e.g. `bob@old-corp.com`)
 *   when the user's stored email has been changed via DB patch.
 * @returns {Promise<import('@playwright/test').Locator>}
 */
async function openEditUserModal(page, user, opts = {}) {
  const firstName = user.firstName || user.username.split('_')[0];
  const lastName = user.lastName || 'GWAdmin';
  const searchEmail = opts.searchEmail || user.username;

  await page.goto(`/react/indexReact.do#platformOne/firmAdmin/userManagement`);
  // The advanced-search panel is an ag-grid sidebar whose open/closed state
  // ag-grid persists across sessions (AdvancedSearchToggle.js uses
  // gridApi.isSideBarVisible). If a prior visit closed it, `#firmCd_typeAhead`
  // is in the DOM but hidden, and the open-toggle icon renders as
  // `<span id="seacrh_filter"><svg id="seacrh_filter" />`. Both inner and
  // outer carry the same id (GridCustomHeaderOverlayButton.js:58 wraps an
  // <Icon name="seacrh_filter">), so we must scope to the span to avoid a
  // strict-mode violation. The typo in the id is intentional in the source.
  // Race the two: whichever becomes visible first tells us the state. If the
  // toggle is the one that landed, click it to open the panel before we wait
  // on the typeAhead.
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

  await selectFirmInTypeAhead(page, { firmCd: 1, firmName: 'GeoWealth' }, { confirm: 'none' });
  const emailFilter = page.locator('#emailField');
  await emailFilter.click();
  await emailFilter.pressSequentially(searchEmail, { delay: 15 });
  // Let React commit the email value to FormBuilder state before Save fires.
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Search' }).click();

  // The parent row's matchable text comes from the email column; use the
  // search email (default = username) so we find the right row whether or
  // not the stored email contains the username.
  const parentRow = page.locator('[role="row"]').filter({ hasText: searchEmail }).first();
  await expect(parentRow).toBeVisible({ timeout: 30_000 });
  // Wait for the grid's PageLoader to detach — Playwright's default click
  // actionability check would otherwise time out against the overlay.
  await page
    .locator('[role="page-loader"]')
    .waitFor({ state: 'detached', timeout: 30_000 })
    .catch(() => {});
  await parentRow.click();

  const editButton = page.getByRole('button', { name: `${firstName} ${lastName}` });
  await expect(editButton).toBeVisible({ timeout: 10_000 });
  await editButton.click();

  const modal = page.locator(MODAL_BODY);
  await expect(modal).toBeVisible({ timeout: 15_000 });
  // InputCore.componentDidMount fires updateFormValue per field, but
  // FormBuilder.validateFormFields is debounced ~50ms before isFormValid
  // commits. Without a wait, an immediate Save click reads stale state
  // (initial isFormValid=true default) and the guard misfires. ~400ms
  // covers the debounce plus any subsequent setState flushes.
  await page.waitForTimeout(400);
  return modal;
}

/**
 * Replace the value of the Edit User modal's Primary Email field with the
 * given value, committing it to React state so FormBuilder.isFormValid
 * recomputes correctly. `fill()` alone updates the DOM and triggers the
 * field-level customValidation (so the inline error toggles correctly),
 * but it doesn't propagate the new value into FormBuilder.fields — Save
 * then submits with the ORIGINAL email and the test sees the generic
 * "about to update this user's information" confirmation instead of the
 * email-specific one (or, for invalid emails, sees Save proceed when it
 * should have been blocked). pressSequentially fires real keystrokes
 * that drive the full React onChange chain.
 *
 * @param {import('@playwright/test').Locator} modal
 * @param {string} value
 */
async function setModalEmail(modal, value) {
  const input = modal.locator('#emailField');
  // Triple-click selects the entire current value (more reliable than
  // Control+A on React-controlled inputs). pressSequentially then types
  // the new value char-by-char, firing real onChange events that
  // propagate up to FormBuilder.fields[email].{value,isValid} — without
  // which the Save submit guard reads stale state and incorrectly fires.
  await input.click({ clickCount: 3 });
  await input.pressSequentially(value, { delay: 15 });
  await input.press('Tab');
  // FormBuilder.validateFormFields is debounced and the React re-render
  // chain (FormBuilder state → SubmitButton context → button class) takes
  // a few hundred ms to settle. Without enough wait, an immediate Save
  // click reads stale state.
  await modal.page().waitForTimeout(1500);
}

module.exports = {
  openEditUserModal,
  setModalEmail,
  MODAL_BODY,
  MODAL_SUBMIT_NAME,
  MODAL_EMAIL_ERROR,
  GW_ADMIN_EMAIL_ERROR_RE,
  CONFIRM_EMAIL_CHANGE_RE,
};
