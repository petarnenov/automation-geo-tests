// @ts-check
/**
 * TestRail C26483 — Impersonated user from any other firm lands on the
 *   Advisor Portal → Dashboard.
 *
 * Verified by impersonating a firm 3 Employee (the smallest stable non-74
 * firm on qa4) and asserting the post-redirect URL hash is `#dashboard`.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  impersonateFirstNonSelfEmployee,
  terminateImpersonationFromUserMenu,
  FIRM_CD_FALLBACK,
} = require('./_helpers');

test('@pepi C26483 Platform One Impersonated user from other firm lands on Advisor Portal (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_FALLBACK);

  const target = await impersonateFirstNonSelfEmployee(page, []);
  console.log(`[C26483] impersonating firm${FIRM_CD_FALLBACK}: ${target}`);

  // URL change alone is the impersonation signal: React Advisor Portal
  // renders "Impersonated By" inside a hover-revealed userInfoBlock, but
  // reaching #dashboard is only possible with an established impersonation.
  await expect(page).toHaveURL(/#dashboard/, { timeout: 30_000 });

  await terminateImpersonationFromUserMenu(page);
});
