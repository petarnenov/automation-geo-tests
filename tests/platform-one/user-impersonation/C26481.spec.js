// @ts-check
/**
 * TestRail C26481 — Platform One: Search/filter performance for large firm
 *   (Positive – Non-functional).
 *
 * After loading firm 5 (the qa4 "large firm" with ~59k active entities),
 * types into the quick-search input and times how long it takes the grid
 * to filter down. Relaxed budget (5 seconds) per user direction — catches
 * catastrophic slowness without flaking on background load.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  searchImpersonateGrid,
} = require('./_helpers');

const LARGE_FIRM_CD = 5;
const SEARCH_BUDGET_MS = 5_000;

test('@pepi C26481 Platform One Impersonate search performance for large firm 5 (Non-functional)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, LARGE_FIRM_CD);

  const rows = page.locator('#p1UserImpersonationGrid .ag-center-cols-container .ag-row');
  const baselineCount = await rows.count();
  expect(baselineCount).toBeGreaterThan(0);

  const startMs = Date.now();
  await searchImpersonateGrid(page, 'aaa');

  // Filter is considered "done" once the rendered row count differs from the
  // baseline OR the grid reports zero matches. Either resolves quickly when
  // ag-grid's quickFilter is responsive on a large dataset.
  await expect
    .poll(async () => (await rows.count()) !== baselineCount, { timeout: SEARCH_BUDGET_MS })
    .toBe(true);
  const elapsedMs = Date.now() - startMs;

  console.log(`[C26481] firm ${LARGE_FIRM_CD} search filtered in ${elapsedMs} ms (budget ${SEARCH_BUDGET_MS} ms)`);
  expect(elapsedMs).toBeLessThan(SEARCH_BUDGET_MS);
});
