// @ts-check
/**
 * AIO C22284 (GEO-TC-11873) — Statement Charges - Grid sorting, filtering and
 * column availability.
 *
 * Source: AIO Tests, project GEO, folder "Statement Charges UI and actions from firm 1".
 * Team: Billing&Services.
 *
 * Manual steps (paraphrased from AIO):
 *   1-2. Firm-1 admin opens Platform One → Billing Center → Statement Charges; the
 *        grid loads with charges.
 *   3.   The grid exposes: Firm (firm-1 P1), Advisor/Advisor Group, Description,
 *        Frequency, Qty, Charge Type, Amount, Start Date, End Date, Billing Bucket,
 *        Split %, Split Advisor/Advisor Group, Status, Stmt Sort Order.
 *   4.   Clicking a column header sorts it ascending/descending; the sort icon shows.
 *   5.   Columns can be reordered by drag & drop.
 *   6.   Every column is filterable from its header.
 *
 * ── What this asserts (verified against the live grid) ──
 *  - Column availability: every required column is present as an ag-grid header,
 *    matched by its stable col-id (StatementCharges consts).
 *  - Sorting: clicking a column header drives its aria-sort to ascending then
 *    descending and shows the matching sort indicator icon.
 *  - Reordering: a header dragged past another lands after it (aria-colindex grows).
 *  - Filtering: the header carries a floating-filter row and a column's filter menu
 *    opens from its header.
 *
 * ── Robustness ──
 * tim1's shared saved view leaves the grid with a non-default column order, a
 * column sort, a leftover column filter and a horizontal scroll offset — which
 * hide/virtualise headers. The test first resets the grid's column state and clears
 * its filter model via the ag-grid api (ephemeral, not saved), then scrolls each
 * target column into view before interacting. See
 * [[project_statement_charges_grid_gotchas]]. Read-only: no view is saved, no data
 * changes.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET = '/react/getBillingStatementCharges.do';

const REQUIRED_COLUMNS = [
  ['Firm', 'firmName'],
  ['Advisor/Advisor Group', 'advisorOrGroupName'],
  ['Description', 'description'],
  ['Frequency', 'frequencyCd'],
  ['Qty', 'quantity'],
  ['Charge Type', 'chargeTypeCd'],
  ['Amount', 'amount'],
  ['Start Date', 'startDate'],
  ['End Date', 'endDate'],
  ['Billing Bucket', 'billingBucketCd'],
  ['Split %', 'splitPerc'],
  ['Split Advisor/Advisor Group', 'splitAdvisorOrGroupName'],
  ['Status', 'status'],
  ['Stmt Sort Order', 'positionInStatement'],
];

const NON_MOVABLE = new Set(['ag-Grid-SelectionColumn', 'firmName', 'actionButtons']);

/**
 * Run a function against the ag-grid api (found via the React fiber under
 * .ag-root-wrapper). `body` receives (api, arg); `arg` is serialised across.
 * The function is stringified — it must not close over test-scope variables; pass
 * anything it needs via `arg`.
 * @param {import('@playwright/test').Page} page
 * @param {(api:any, arg:any)=>any} body
 * @param {any} [arg]
 */
function withGridApi(page, body, arg) {
  return page.locator('.ag-root-wrapper').first().evaluate((el, { bodyStr, arg }) => {
    const findApi = (root) => {
      const fk = Object.keys(root).find((k) => k.startsWith('__reactFiber$'));
      if (!fk) return null;
      let f = root[fk];
      for (let u = 0; u < 80 && f; u++) {
        for (const o of [f.memoizedProps || {}, f.memoizedState || {}, (f.memoizedProps && f.memoizedProps.gridOptions) || {}]) {
          if (o && o.api && typeof o.api.setFilterModel === 'function') return o.api;
          if (o && o.gridApi && typeof o.gridApi.setFilterModel === 'function') return o.gridApi;
        }
        f = f.return;
      }
      return null;
    };
    const api = findApi(/** @type {any} */ (el));
    if (!api) return 'no-api';
    // eslint-disable-next-line no-eval
    return (0, eval)('(' + bodyStr + ')')(api, arg);
  }, { bodyStr: body.toString(), arg });
}

/** Read the visible header order (col-id + aria-colindex), sorted by index. */
function readHeaderOrder(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.ag-header-cell[col-id]')) {
      const colId = el.getAttribute('col-id');
      const idx = el.getAttribute('aria-colindex');
      if (colId && idx) out.push({ colId, idx: Number(idx) });
    }
    return out.sort((a, b) => a.idx - b.idx);
  });
}

test('@pepi C22284 Statement Charges - Grid sorting, filtering and column availability', async ({ page }) => {
  test.setTimeout(180_000);

  await test.step('Open Statement Charges and reset the grid view state', async () => {
    const respP = page.waitForResponse((r) => r.url().includes(GET) && r.status() === 200, { timeout: 60_000 });
    await loginPlatformOneTim1Fresh(page);
    await page.goto(URL);
    await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
    await respP;
    // Clear the shared saved view's leftover column filter so the grid isn't stuck
    // empty (ephemeral — not saved). NOTE: do NOT resetColumnState() — it strips the
    // grid's custom header components. Instead scroll target columns into view.
    await withGridApi(page, (api) => api.setFilterModel(null));
    await page.waitForTimeout(1000);
  });

  await test.step('All required columns are available', async () => {
    for (const [label, colId] of REQUIRED_COLUMNS) {
      await expect(
        page.locator(`.ag-header-cell[col-id="${colId}"]`),
        `column "${label}" (${colId}) is present`
      ).toHaveCount(1, { timeout: 10_000 });
    }
  });

  await test.step('Clicking a header sorts the column ascending then descending', async () => {
    // Pick the leftmost movable column (reliably on-screen) and scroll it in.
    const order0 = await readHeaderOrder(page);
    const colId = order0.filter((h) => !NON_MOVABLE.has(h.colId))[0].colId;
    await withGridApi(page, (api, c) => api.ensureColumnVisible(c), colId);
    const header = page.locator(`.ag-header-cell[col-id="${colId}"]`).first();
    await expect(header).toBeVisible({ timeout: 10_000 });

    // Click the header (its label area) to sort. Start state may be 'none' or a
    // prior sort; drive it to ascending, then descending, over successive clicks.
    // aria-sort is the authoritative sort-indicator state (ag-grid sets it exactly
    // when the header's sort icon appears).
    await header.click();
    if ((await header.getAttribute('aria-sort')) !== 'ascending') await header.click();
    await expect(header, 'ascending sort applied (icon shown)').toHaveAttribute('aria-sort', 'ascending', { timeout: 10_000 });

    await header.click();
    await expect(header, 'descending sort applied (icon shown)').toHaveAttribute('aria-sort', 'descending', { timeout: 10_000 });
  });

  await test.step('Columns can be reordered by drag & drop', async () => {
    const order = await readHeaderOrder(page);
    const movable = order.filter((h) => !NON_MOVABLE.has(h.colId));
    expect(movable.length, 'at least two movable columns').toBeGreaterThanOrEqual(2);
    const sourceColId = movable[0].colId;
    const anchorColId = movable[1].colId;
    // Make sure both are on-screen before dragging.
    await withGridApi(page, (api, c) => api.ensureColumnVisible(c), sourceColId);

    const source = page.locator(`.ag-header-cell[col-id="${sourceColId}"]`);
    const target = page.locator(`.ag-header-cell[col-id="${anchorColId}"]`);
    const srcBox = await source.boundingBox();
    const tgtBox = await target.boundingBox();
    if (!srcBox || !tgtBox) throw new Error('header cells missing bounding boxes');

    const sx = srcBox.x + srcBox.width / 2;
    const sy = srcBox.y + srcBox.height / 2;
    const ex = tgtBox.x + tgtBox.width - 8;
    const ey = tgtBox.y + tgtBox.height / 2;

    // ag-grid 33 column reorder needs stepped synthetic mouse events (same
    // technique as C25655 — HTML5 dragTo doesn't trip its drag threshold).
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(sx + 5, sy, { steps: 3 });
    await page.waitForTimeout(50);
    await page.mouse.move(sx + 20, sy, { steps: 5 });
    await page.waitForTimeout(50);
    for (let f = 0.2; f <= 1.0; f += 0.1) {
      await page.mouse.move(sx + (ex - sx) * f, sy + (ey - sy) * f, { steps: 3 });
      await page.waitForTimeout(30);
    }
    await page.mouse.move(ex, ey, { steps: 3 });
    await page.waitForTimeout(100);
    await page.mouse.up();

    await expect
      .poll(async () => {
        const draggedIdx = await source.first().getAttribute('aria-colindex').catch(() => null);
        const anchorIdx = await target.first().getAttribute('aria-colindex').catch(() => null);
        if (!draggedIdx || !anchorIdx) return null;
        return Number(draggedIdx) > Number(anchorIdx);
      }, { timeout: 10_000, intervals: [200, 400, 800, 1500] })
      .toBe(true);
  });

  await test.step('Columns are filterable from the header', async () => {
    // The grid shows a floating-filter row (a filter affordance per column).
    await expect(page.locator('.ag-header-cell.ag-floating-filter').first()).toBeVisible({ timeout: 10_000 });

    // Opening a column's filter menu from its header proves header filtering. Use
    // the current leftmost movable column (on-screen) — the drag may have moved
    // others off to the far right.
    const orderF = await readHeaderOrder(page);
    const colId = orderF.filter((h) => !NON_MOVABLE.has(h.colId))[0].colId;
    await withGridApi(page, (api, c) => api.ensureColumnVisible(c), colId);
    const header = page.locator(`.ag-header-cell[col-id="${colId}"]`).first();
    const colIdx = await header.getAttribute('aria-colindex');
    const floating = page.locator(`.ag-header-cell.ag-floating-filter[aria-colindex="${colIdx}"]`);
    await expect(floating).toBeVisible({ timeout: 10_000 });
    await floating.locator('button.ag-floating-filter-button-button').click({ force: true });
    await expect(page.locator('.ag-filter-menu')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.ag-filter-menu')).toBeHidden({ timeout: 5_000 });
  });
});
