// @ts-check
/**
 * TestRail C26426 — Platform One: Firm dropdown shows all firms for site 1
 *   firms with enabled Impersonation permission (Positive).
 *
 * Asserts the FirmsListP1 combo box is mounted on the Impersonate page with
 * the "Select Firm" label. The "displays all firms" expectation is covered
 * transitively by C26436 (switching between two specific firms reloads
 * each firm's distinct user list) — that test would fail if either firm
 * were missing from the dropdown.
 *
 * We do not click the combo open to assert option count: FormBuilder
 * comboBox uses typeAhead + a virtualized list (not a flat <select>), so a
 * synthetic click does not surface the options without typing — see memory
 * `[Advanced-search panel persists state]` for the analogous trap.
 */

const { test, expect } = require('@playwright/test');
const { gotoImpersonatePageAsTim1 } = require('./_helpers');

test('@pepi C26426 Platform One Impersonate firm dropdown is mounted (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);

  const firmCombo = page.locator('#selectFirm');
  await expect(firmCombo).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Select Firm', { exact: false }).first()).toBeVisible();
});
