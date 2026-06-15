// @ts-check
/**
 * TestRail C26449 — Platform One: Launch Advisor Portal impersonation with
 *   enabled Impersonation permission (Positive).
 *
 * Click an Employee row's "Advisor Portal" button and verify the page
 * transitions to the impersonated session. ImpersonateButton fires
 *   window.open(.../platformOne/impersonateEmployee.do?entityID=<uuid>, '_self')
 * which navigates the current tab. After redirect the SPA should:
 *   - leave the userImpersonation URL,
 *   - establish a session indicator showing "Impersonated By" + tim1's name.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  impersonateFirstNonSelfEmployee,
  terminateImpersonationFromUserMenu,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26449 Platform One Launch Advisor Portal impersonation (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  const targetName = await impersonateFirstNonSelfEmployee(page, []);
  console.log(`[C26449] impersonating: ${targetName}`);

  // After redirect, URL must have left the userImpersonation route. Employee
  // impersonation lands on the legacy ExtJS portal at
  // /portal/portalIndex.do#dashboard — the React banner copy "Impersonated By"
  // is still rendered there by the ExtJS shell, so it's a usable signal.
  await expect(page).not.toHaveURL(/firmAdmin\/userImpersonation/, { timeout: 30_000 });
  await expect(page).toHaveURL(/portal\/portalIndex\.do/, { timeout: 30_000 });
  await expect(page.getByText(/Impersonated By/i).first()).toBeVisible({ timeout: 30_000 });

  // Cleanup: terminate so the next test in this worker is not left
  // impersonating. Uses the same `/logout.do?reactRequest=true` endpoint the
  // React `appService.terminateImpersonatedUser` calls internally.
  await terminateImpersonationFromUserMenu(page);
});
