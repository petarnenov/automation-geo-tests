// @ts-check
/**
 * TestRail C26480 — Platform One: Load performance for large firms
 *   (Positive – Non-functional).
 *
 * Selects firm 5 (the qa4 "large firm" with ~59k active entities) and times
 * how long it takes for the Impersonate grid to populate with rows. The
 * TestRail acceptance is "no worse than current loading time" — we apply a
 * deliberately relaxed budget (30 seconds) per user direction, so the test
 * catches catastrophic regressions without flaking on background load.
 */

const { test, expect } = require('@playwright/test');
const { gotoImpersonatePageAsTim1 } = require('./_helpers');

const LARGE_FIRM_CD = 5;
const LOAD_BUDGET_MS = 30_000;

test('@pepi C26480 Platform One Impersonate load performance for large firm 5 (Non-functional)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);

  const startMs = Date.now();
  await page.goto(`/react/indexReact.do#platformOne/firmAdmin/userImpersonation/${LARGE_FIRM_CD}`);

  // Wait until the grid has at least one row OR shows the empty-state — that's
  // the "fully loaded" signal for the GwGrid component (see waitForGridReady).
  await expect(async () => {
    const rows = await page
      .locator('#p1UserImpersonationGrid .ag-center-cols-container .ag-row')
      .count();
    const empty = await page
      .locator('#p1UserImpersonationGrid')
      .getByText(/No users found/i)
      .isVisible()
      .catch(() => false);
    if (rows === 0 && !empty) throw new Error('grid still loading');
  }).toPass({ timeout: LOAD_BUDGET_MS });
  const elapsedMs = Date.now() - startMs;

  console.log(`[C26480] firm ${LARGE_FIRM_CD} grid loaded in ${elapsedMs} ms (budget ${LOAD_BUDGET_MS} ms)`);
  expect(elapsedMs).toBeLessThan(LOAD_BUDGET_MS);
});
