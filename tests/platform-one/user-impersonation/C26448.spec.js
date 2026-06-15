// @ts-check
/**
 * TestRail C26448 — Platform One: Advisor Portal button visible for employee
 *   users with enabled Impersonation permission (Positive).
 *
 * Asserts every data row in the Impersonate Action column shows the
 * "Advisor Portal" button. The columnDef hard-codes ImpersonateButton for
 * every row (no conditional renderer), so the button count must equal the
 * data row count.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26448 Platform One Impersonate Advisor Portal button per row (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  const grid = page.locator('#p1UserImpersonationGrid');
  const rows = grid.locator('.ag-center-cols-container .ag-row');
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);

  const buttons = grid.getByRole('button', { name: 'Advisor Portal' });
  await expect
    .poll(
      async () => {
        const r = await rows.count();
        const b = await buttons.count();
        return r > 0 && b === r;
      },
      { timeout: 15_000 }
    )
    .toBe(true);
});
