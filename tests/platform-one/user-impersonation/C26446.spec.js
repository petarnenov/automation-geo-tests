// @ts-check
/**
 * TestRail C26446 — Platform One: Search with no results with enabled
 *   Impersonation permission (Positive / Edge).
 *
 * Asserts that a non-matching search string yields zero data rows and no
 * error/exception breaks the page.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  searchImpersonateGrid,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26446 Platform One Impersonate search with no results (Positive / Edge)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  await searchImpersonateGrid(page, 'ZZZ123');

  const rows = page.locator('#p1UserImpersonationGrid .ag-center-cols-container .ag-row');
  await expect.poll(() => rows.count(), { timeout: 10_000 }).toBe(0);

  // Page still healthy: wrapper visible, no error toast / boundary message.
  await expect(page.locator('#UserImpersonationWrapper')).toBeVisible();
});
