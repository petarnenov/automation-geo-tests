/**
 * `AgGrid` Component class.
 *
 * Phase 2 step 5 (D-37). Consolidates the 5 legacy ag-grid helpers
 * from `packages/legacy-poc/tests/_helpers/ui.js` (lines 287-374):
 *
 *   - activateAgGridCell        → activateCell()
 *   - setAgGridText             → setText()
 *   - setAgGridRichSelect       → setRichSelect()
 *   - setAgGridDate             → setDate()
 *   - pickFirstAgGridRichSelect → pickFirstRichSelect()
 *
 * Quirks preserved (from project_create_account_specifics memory
 * and the legacy comments):
 *
 *   - **`.ag-virtual-list-item` is the rich-select item class** —
 *     NOT `.ag-list-item`. The container is
 *     `.ag-rich-select-virtual-list-viewport`. Items are virtualized
 *     — only ~8 are in the DOM at a time, so assertions on options
 *     "below the fold" need scrolling or sample only top-of-list.
 *
 *   - **Single-click activates editing** (`singleClickEdit: true`).
 *     One `cell.click({ force: true })` puts the cell in
 *     `ag-cell-inline-editing` mode. Wait via
 *     `expect(cell).toHaveClass(/ag-cell-inline-editing/)`.
 *
 *   - **Rich-select Enter behavior depends on whether you typed**.
 *     With `allowTyping: true`, typing a filter then pressing Enter
 *     commits the first match. Pressing Enter WITHOUT typing first
 *     does NOT commit (no item is highlighted). For the "pick
 *     whatever's first" case (Default Money etc.), the Component
 *     calls `firstOption.click()` directly.
 *
 *   - **Date column uses `agDateStringCellEditor`** — a plain text
 *     input accepting MM/DD/YYYY. `keyboard.type()` + Tab.
 *
 *   - **Selection by colId, never by visual column index**. Column
 *     resizing and pinning can change selectors silently if you
 *     index by position. Always use the col-id attribute.
 *
 *   - **`force: true` on the cell click is intentional**. The grid
 *     overlay sometimes intercepts at the body level under load;
 *     force-clicking the cell bypasses that. Documented per
 *     Section 4.7's "last resort, justified inline" rule.
 *
 * Edit-path quirks NOT covered here (Phase 4 work):
 *
 *   - Virtual scroll for off-screen rows: `getRow(index)` would
 *     need `ensureIndexVisible()` exposed through `evaluate()`
 *     against the grid API. The legacy POC never needed that
 *     (every test stays in the visible viewport). Add it when the
 *     first Phase 4 spec needs it.
 *
 *   - Column resizing and pinning: same — add when needed.
 *
 *   - Commission Fee combo's CDP click — that's a ComboBox quirk,
 *     not an AgGrid quirk. Goes to `framework/src/helpers/cdp.ts`
 *     in Phase 4 alongside C25201.
 */

import { expect, type Page, type Locator } from '@playwright/test';

export class AgGrid {
  private readonly page: Page;

  /**
   * @param page Playwright Page.
   *
   * No grid-level scope is taken because the legacy helpers all
   * select cells globally via `.ag-row[row-index="X"]
   * [role="gridcell"][col-id="Y"]`. There is exactly one ag-grid
   * per page in the consuming specs (Account Billing History,
   * Create Account grid, etc.), so a global scope works. If a
   * future spec has two grids on one page, the constructor will
   * grow a `gridContainer?: Locator` parameter.
   */
  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Get the cell locator for `(rowIndex, colId)`. Cells are looked
   * up by `col-id` attribute, never by visual column index — column
   * resizing and pinning can change positions silently.
   */
  cell(rowIndex: number, colId: string): Locator {
    return this.page.locator(
      `.ag-row[row-index="${rowIndex}"] [role="gridcell"][col-id="${colId}"]`
    );
  }

  /**
   * Click a cell to put it in `ag-cell-inline-editing` mode. With
   * `singleClickEdit: true` (the convention in the GeoWealth grids)
   * a single click is enough. Returns the cell locator for chaining.
   *
   * The `force: true` is intentional — the grid overlay sometimes
   * intercepts clicks at the body level under load.
   */
  async activateCell(rowIndex: number, colId: string): Promise<Locator> {
    const cell = this.cell(rowIndex, colId);
    await cell.scrollIntoViewIfNeeded();
    await cell.click({ force: true });
    await expect(cell).toHaveClass(/ag-cell-inline-editing/, { timeout: 5000 });
    return cell;
  }

  /**
   * Fill a plain ag-grid text cell. Activates the cell, clears any
   * existing content via Ctrl+A, types the value, commits with Tab.
   */
  async setText(rowIndex: number, colId: string, value: string): Promise<void> {
    await this.activateCell(rowIndex, colId);
    await this.page.keyboard.press('Control+a');
    await this.page.keyboard.type(value);
    await this.page.keyboard.press('Tab');
  }

  /**
   * Fill an ag-grid rich-select cell. Relies on `allowTyping: true`
   * + `filterList`. Types the filter prefix and presses Enter to
   * commit the first match.
   *
   * @param optionText The visible text of the desired option. Used
   *   verbatim as the filter input AND asserted on the cell after
   *   commit.
   */
  async setRichSelect(rowIndex: number, colId: string, optionText: string): Promise<void> {
    await this.activateCell(rowIndex, colId);
    await this.page.keyboard.type(optionText);
    const firstOption = this.page
      .locator('.ag-rich-select-virtual-list-viewport .ag-virtual-list-item')
      .first();
    await expect(firstOption).toBeVisible({ timeout: 5000 });
    await this.page.keyboard.press('Enter');
    await expect(this.cell(rowIndex, colId)).toContainText(optionText, { timeout: 5000 });
  }

  /**
   * Pick the first option from an ag-grid rich-select cell, return
   * its text. Used when the valid options vary per parent-cell value
   * (e.g. Default Money depends on custodian) and a hardcoded name
   * is brittle.
   *
   * Pressing Enter without first typing/highlighting does NOT
   * commit (the rich-select Enter behavior quirk) — click the
   * option directly.
   */
  async pickFirstRichSelect(rowIndex: number, colId: string): Promise<string> {
    await this.activateCell(rowIndex, colId);
    const firstOption = this.page
      .locator('.ag-rich-select-virtual-list-viewport .ag-virtual-list-item')
      .first();
    await expect(firstOption).toBeVisible({ timeout: 5000 });
    const text = (await firstOption.innerText()).trim();
    await firstOption.click();
    await expect(this.cell(rowIndex, colId)).toContainText(text, { timeout: 5000 });
    return text;
  }

  /**
   * Fill an ag-grid `agDateStringCellEditor` cell — a plain text
   * input that accepts MM/DD/YYYY.
   */
  async setDate(rowIndex: number, colId: string, mmddyyyy: string): Promise<void> {
    await this.activateCell(rowIndex, colId);
    await this.page.keyboard.type(mmddyyyy);
    await this.page.keyboard.press('Tab');
  }

  /**
   * Read a cell's text without activating its editor. Used for
   * read-only assertions on the History grid and similar
   * non-editable surfaces.
   */
  async readCell(rowIndex: number, colId: string): Promise<string> {
    return (await this.cell(rowIndex, colId).innerText()).trim();
  }

  /**
   * Count the number of currently-rendered rows. Note: with virtual
   * scrolling, only visible rows are in the DOM — this is the
   * count of *rendered* rows, not the total dataset size. Use
   * `getRowCountFromGridApi()` (NYI) for the dataset size.
   */
  async renderedRowCount(): Promise<number> {
    return await this.page.locator('.ag-row').count();
  }
}
