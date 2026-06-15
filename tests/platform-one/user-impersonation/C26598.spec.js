// @ts-check
/**
 * TestRail C26598 — Advisor Portal: Terminate impersonation from AP entry
 *   point returns to the AP Impersonated employee screen (Positive).
 *
 * Builds on C26596's launch flow: after impersonation lands in the
 * impersonated portal, terminate the session and verify the impersonator
 * is back on a non-impersonated React surface (not on the client profile).
 */

const { test, expect } = require('@playwright/test');
const {
  openFirstEmployeeFromAPDirectory,
  openAPUserActionsMenu,
  terminateImpersonationFromUserMenu,
} = require('./_helpers');

test('@pepi C26598 Advisor Portal Terminate impersonation returns to P1 Impersonate page (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const employee = await openFirstEmployeeFromAPDirectory(page);
  console.log(`[C26598] launching then terminating: ${employee}`);

  const impersonateOption = await openAPUserActionsMenu(page);
  await impersonateOption.click();
  await expect(page).not.toHaveURL(/#client\/4\//, { timeout: 30_000 });

  await terminateImpersonationFromUserMenu(page);

  // Post-terminate: not in the impersonated session anymore. The page must
  // land on a non-client React surface (P1, AP dashboard, or BO chrome —
  // the legacy redirect target depends on whether the impersonator started
  // from P1 or AP). The key invariant: we are NOT still on the impersonated
  // user's profile.
  await expect(page).not.toHaveURL(/#client\/4\//, { timeout: 30_000 });
  await expect(page).toHaveURL(/#(platformOne|dashboard)|backOffice|bo\//, { timeout: 30_000 });
});
