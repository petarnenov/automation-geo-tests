// @ts-check
/**
 * TestRail C26445 — Platform One: Search returns matching users with enabled
 *   Impersonation permission (Positive).
 *
 * Asserts that typing a substring into the grid quick-search filters the
 * rows to those whose name contains that substring. We use a substring
 * common to tim1 + advisors ("tim") so the test is deterministic across
 * firm 1's user population.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  searchImpersonateGrid,
  getGridRowNames,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26445 Platform One Impersonate search returns matching users (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  await searchImpersonateGrid(page, 'tim');

  await expect
    .poll(
      async () => {
        const names = await getGridRowNames(page);
        return names.length > 0 && names.every((n) => /tim/i.test(n));
      },
      { timeout: 10_000 }
    )
    .toBe(true);
});
