// @ts-check
/**
 * TestRail C26436 — Platform One: Switching firms reloads corresponding user
 *   list with enabled Impersonation permission (Positive).
 *
 * Asserts firm A's users are replaced by firm B's users when the firm
 * selector changes. We use the URL hash as the driver (the FirmsListP1
 * onChange handler pushes the new firmCd into the route).
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  getGridRowNames,
  FIRM_CD_GEOWEALTH,
  FIRM_CD_FALLBACK,
} = require('./_helpers');

test('@pepi C26436 Platform One Impersonate switching firms reloads user list (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);

  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);
  const firmAUsers = new Set(await getGridRowNames(page));
  expect(firmAUsers.size).toBeGreaterThan(0);

  await selectFirmInImpersonate(page, FIRM_CD_FALLBACK);
  const firmBUsers = new Set(await getGridRowNames(page));
  expect(firmBUsers.size).toBeGreaterThan(0);

  // The two lists must differ — different firms own disjoint employee rows.
  // A pure subset equality would be a regression (grid did not refresh).
  const intersection = [...firmAUsers].filter((n) => firmBUsers.has(n));
  expect(intersection.length).toBeLessThan(firmAUsers.size);
});
