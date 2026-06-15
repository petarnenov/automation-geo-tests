// @ts-check
/**
 * TestRail C26452 — Platform One: Failure to create impersonated session
 *   with enabled Impersonation permission (Negative).
 *
 * The TestRail script asks the operator to "Stop the useragents before user
 * impersonation" — a backend-side outage we cannot trigger from a browser.
 * We simulate it at the network layer instead: intercept the
 * `/platformOne/impersonateEmployee.do?reactRequest=true&entityID=…`
 * navigation that the ImpersonateButton fires (`window.open(url, '_self')`)
 * and abort the request before the backend handler runs.
 *
 * Expected outcome from the case: "No new valid impersonated session is
 * established." → we stay on the Impersonate page (or a failed-navigation
 * state) and never reach the impersonated portal landing (dashboard /
 * modelCenter / legacy portalIndex).
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26452 Platform One Failure to create impersonated session (Negative)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  // Mock the "useragents stopped" failure at the network layer. The
  // ImpersonateButton handler does:
  //   window.open(baseURL + '/platformOne/impersonateEmployee.do?reactRequest=true&entityID=…', '_self')
  // which fires a top-level navigation request. Aborting that request
  // simulates the backend impersonation service being unavailable.
  let impersonateRequestAttempted = false;
  await page.route('**/impersonateEmployee.do*', async (route) => {
    impersonateRequestAttempted = true;
    await route.abort('failed');
  });

  // Capture the URL the test starts the click from so we can assert we did
  // not navigate to a valid impersonated session.
  const preClickUrl = page.url();
  expect(preClickUrl).toMatch(/firmAdmin\/userImpersonation/);

  // Click the first row's Advisor Portal button. The aborted navigation will
  // leave the page state intact — Chromium swallows net::ERR_FAILED on a
  // page-level navigation.
  const button = page
    .locator('#p1UserImpersonationGrid .ag-center-cols-container .ag-row')
    .first()
    .getByRole('button', { name: 'Advisor Portal' });
  await button.click();

  // Give the SPA time to attempt the navigation (and fail).
  await page.waitForTimeout(3000);

  // The mock was hit — confirms the simulated outage path was exercised.
  expect(impersonateRequestAttempted).toBe(true);

  // No impersonated session was established: URL must not have landed on
  // any of the post-impersonation portals.
  await expect(page).not.toHaveURL(/#(dashboard|modelCenter)/, { timeout: 5_000 });
  await expect(page).not.toHaveURL(/portalIndex\.do/);

  // The "Impersonated By" banner — which appears anywhere we have a
  // successful impersonated session — must not be visible.
  await expect(page.locator('[class*="impersonateText"]')).toHaveCount(0);
});
