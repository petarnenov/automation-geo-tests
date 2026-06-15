// @ts-check
/**
 * TestRail C26437 — Platform One: Grid shows correct columns and user data
 *   with enabled Impersonation permission (Positive).
 *
 * Asserts the grid renders the Name + "Impersonate Action" columns and that
 * the action column carries the "Advisor Portal" button per data row.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26437 Platform One Impersonate grid shows correct columns + user data (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  const grid = page.locator('#p1UserImpersonationGrid');
  await expect(grid.getByText('Name', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(grid.getByText('Impersonate Action', { exact: true }).first()).toBeVisible();

  // Data rows: at least one row + one "Advisor Portal" button in the action
  // column (every Employee row gets one — see ImpersonateButton.js).
  const rows = grid.locator('.ag-center-cols-container .ag-row');
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(grid.getByRole('button', { name: 'Advisor Portal' }).first()).toBeVisible();
});
