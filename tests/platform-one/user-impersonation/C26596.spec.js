// @ts-check
/**
 * TestRail C26596 — Advisor Portal: Launch Advisor Portal impersonation
 *   from AP entry point (Positive).
 *
 * Click "Impersonate" in the Employee User Actions dropdown and verify the
 * page transitions out of the SelectedClient profile into an impersonated
 * session. The dropdown handler calls
 *   window.open('/bo/impersonateEmployeeReact.do?portal=true&entityID=…', '_self')
 * — the AP variant of the P1 entry verified by C26449.
 */

const { test, expect } = require('@playwright/test');
const {
  openFirstEmployeeFromAPDirectory,
  openAPUserActionsMenu,
  terminateImpersonationFromUserMenu,
} = require('./_helpers');

test('@pepi C26596 Advisor Portal Launch impersonation from AP entry point (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const employee = await openFirstEmployeeFromAPDirectory(page);
  console.log(`[C26596] impersonating via AP entry: ${employee}`);

  const impersonateOption = await openAPUserActionsMenu(page);
  await impersonateOption.click();

  // After click: we leave the #client/4/... profile and land on the
  // impersonated session's portal (Advisor Portal #dashboard or Manager
  // Portal #modelCenter, depending on the picked employee's firm).
  await expect(page).not.toHaveURL(/#client\/4\//, { timeout: 30_000 });
  await expect(page).toHaveURL(/#(dashboard|modelCenter|platformOne)/, { timeout: 30_000 });

  await terminateImpersonationFromUserMenu(page);
});
