// @ts-check
/**
 * TestRail C26427 — Platform One: Load user list when a firm is selected for
 *   site 1 firms with enabled Impersonation permission (Positive).
 *
 * Asserts that selecting a firm populates the grid with rows.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  getGridRowNames,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26427 Platform One Impersonate user list loads when firm selected (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  const names = await getGridRowNames(page);
  expect(names.length).toBeGreaterThan(0);
});
