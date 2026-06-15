// @ts-check
/**
 * TestRail C26597 — Advisor Portal: Impersonate action visible for employee
 *   users with enabled Impersonation permission, from AP entry point
 *   (Positive).
 *
 * Asserts the "Impersonate" option is present in the Employee's User
 * Actions dropdown when navigating via Directories → Non-Customer Contacts.
 */

const { test, expect } = require('@playwright/test');
const {
  openFirstEmployeeFromAPDirectory,
  openAPUserActionsMenu,
} = require('./_helpers');

test('@pepi C26597 Advisor Portal Impersonate action visible from AP entry point (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const employee = await openFirstEmployeeFromAPDirectory(page);
  console.log(`[C26597] employee opened: ${employee}`);

  const impersonateOption = await openAPUserActionsMenu(page);
  await expect(impersonateOption).toBeVisible();
});
