// @ts-check
/**
 * TestRail C26447 — Platform One: Search returns matching users + clear
 *   restores full list, with enabled Impersonation permission (Positive).
 *
 * Same setup as C26445, plus: after the filter narrows the list, clearing
 * the search input must restore the full user list for the selected firm.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  searchImpersonateGrid,
  clearImpersonateSearch,
  getGridRowNames,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26447 Platform One Impersonate search + clear restores list (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  const baselineCount = (await getGridRowNames(page)).length;
  expect(baselineCount).toBeGreaterThan(0);

  await searchImpersonateGrid(page, 'tim');
  await expect
    .poll(async () => (await getGridRowNames(page)).length, { timeout: 10_000 })
    .toBeLessThan(baselineCount);

  await clearImpersonateSearch(page);
  await expect
    .poll(async () => (await getGridRowNames(page)).length, { timeout: 10_000 })
    .toBe(baselineCount);
});
