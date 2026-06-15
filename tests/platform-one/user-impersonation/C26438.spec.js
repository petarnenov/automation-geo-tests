// @ts-check
/**
 * TestRail C26438 — Platform One: Grid supports sorting by Name with enabled
 *   Impersonation permission (Positive).
 *
 * Asserts the Name column header sorts rows on click. The custom
 * `GridHeader.js` wires the sort onClick to the INNER `.title___…` div
 * (line 263 spreads `getSortingProps()` onto the title element, NOT the
 * outer `headerCell___…` wrapper). Clicking the outer cell, the wrapper,
 * or the resize handle is a no-op because React's synthetic event system
 * only fires onClick handlers in the bubble path of the actual click
 * target — and the handler lives one level deeper.
 *
 * We verify by reading the inner title's `data-sorting` attribute: it
 * toggles from `false` → `true` after the first click (sort becomes
 * active), and stays `true` after the second click (direction changes but
 * sort remains active). That's a deterministic signal independent of
 * ag-grid's `aria-sort` (which the custom header does NOT sync).
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26438 Platform One Impersonate grid sorts by Name (Positive)', async ({ page }) => {
  test.setTimeout(180_000);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  // The inner title element — it carries the onClick that fires setSort.
  const sortClick = page.locator(
    '#p1UserImpersonationGrid .ag-header-cell[col-id="name"] [class*="subNavTab"] > [class*="title___"]'
  );
  await expect(sortClick).toBeVisible({ timeout: 15_000 });
  await expect(sortClick).toHaveAttribute('data-sorting', 'false');

  await sortClick.click();
  await expect(sortClick).toHaveAttribute('data-sorting', 'true', { timeout: 10_000 });

  // The "withSort" sibling icon flips between asc / desc on each click via
  // the `displayNone___` class — assert the icon container becomes visible
  // (asc) after the first click and stays visible after the second.
  const sortIcon = page.locator(
    '#p1UserImpersonationGrid .ag-header-cell[col-id="name"] [class*="withSort"]'
  );
  await expect(sortIcon).not.toHaveClass(/displayNone___/);

  await sortClick.click();
  await expect(sortClick).toHaveAttribute('data-sorting', 'true');
  await expect(sortIcon).not.toHaveClass(/displayNone___/);
});
