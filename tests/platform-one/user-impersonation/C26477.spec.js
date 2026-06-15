// @ts-check
/**
 * TestRail C26477 — Impersonated user role/s not affecting existing Back
 *   Office logic.
 *
 * The case verifies the BO entry point (System Admin → User Impersonation)
 * works for tim1 and the BO impersonation cycle does not break BO. The
 * cycle itself reuses the same backend endpoints exercised by C26449
 * (`/platformOne/impersonateEmployee.do` family + `/logout.do?reactRequest=true`),
 * so this smoke focuses on the *new* surface — BO page accessibility — and
 * relies on C26449/C26450 to cover the impersonation/terminate mechanics.
 *
 * Verifies:
 *  - tim1 can navigate directly to `/bo/viewImpersonateEmployees.do`
 *  - the BO Impersonate Employees page renders (title + body chrome)
 *  - tim1 stays signed in (top header shows "Tim Arnold (1) signed in")
 */

const { test, expect } = require('@playwright/test');
const { loginAsTim1Fresh } = require('./_helpers');

test('@pepi C26477 Platform One Back Office Impersonate Employees page accessible (Smoke)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await loginAsTim1Fresh(page);
  await page.goto('/bo/viewImpersonateEmployees.do');

  await expect(page).toHaveURL(/\/bo\/viewImpersonateEmployees\.do/, { timeout: 30_000 });
  await expect(page).toHaveTitle(/Impersonate Employees/i, { timeout: 30_000 });

  // BO header chrome — confirms we are signed in and not on a login bounce.
  await expect(page.getByText(/Tim Arnold/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Impersonate Employees/i).first()).toBeVisible();
});
