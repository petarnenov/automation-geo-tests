// @ts-check
/**
 * TestRail C26482 — Impersonated user from firm 74 lands on the Manager
 *   Portal → Model Center.
 *
 * Verified by impersonating a firm 74 Employee and asserting the post-
 * redirect URL hash is `#modelCenter/models` (the Manager Portal landing
 * for firm 74 Employees on qa4).
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  impersonateFirstNonSelfEmployee,
  terminateImpersonationFromUserMenu,
} = require('./_helpers');

const FIRM_74 = 74;

test('@pepi C26482 Platform One Impersonated user from firm74 lands on Manager Portal (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_74);

  const target = await impersonateFirstNonSelfEmployee(page, []);
  console.log(`[C26482] impersonating firm74: ${target}`);

  // URL change alone is the impersonation signal here: the React Manager
  // Portal renders the "Impersonated By" text inside `userInfoBlock` which
  // is hidden until the user tab is hovered. Reaching #modelCenter/models
  // is only possible with an established firm 74 impersonation, so the URL
  // is a deterministic proxy.
  await expect(page).toHaveURL(/#modelCenter\/models/, { timeout: 30_000 });

  await terminateImpersonationFromUserMenu(page);
});
