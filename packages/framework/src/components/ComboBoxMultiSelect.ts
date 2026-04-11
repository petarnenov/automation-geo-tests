/**
 * `ComboBoxMultiSelect` Component class.
 *
 * Wraps the qa SPA's FormBuilder `ComboBoxMultiSelect` field at
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Fields/ComboBoxMultiSelect.js`.
 * It is rendered as an inner `<ComboBox dataModule="comboMultiSelect">`
 * with custom row + selected-display renderers, so the wrapper /
 * dropdown selectors match the singular `ComboBox` POM but the row
 * semantics, header semantics, and post-click behavior all differ.
 *
 * Use this POM when the form passes an array of selected ids /
 * objects under one `id`. Use the singular `ComboBox` POM when the
 * form passes one option id.
 *
 * ## Why a separate POM
 *
 * Three behaviors make `ComboBoxMultiSelect` non-trivial to drive
 * through the singular `ComboBox` POM directly:
 *
 *   1. **Row role differs.** Single-select rows carry
 *      `role="combo-box-list-item"`; multi-select rows carry
 *      `role="combo-box-multi-list-item"`. The singular POM's row
 *      selector misses every option.
 *
 *   2. **Dropdown stays open after click.** The field's
 *      `stateReducer` returns `dontCloseList: true` for both
 *      `selectOption` and `clearAllOptions` actions, so the list
 *      never auto-closes after a row click. The singular POM's
 *      `setValue` waits for `state: 'hidden'` after click, which
 *      times out against this field. The multi POM omits that wait
 *      and closes the list explicitly with `Escape` when the caller
 *      is done.
 *
 *   3. **Header is a count or comma-list, not a single name.** The
 *      `<header>` element renders either `${N} selected` (when the
 *      field is configured with `showSelectedOptionsLength`) or a
 *      comma-joined list of names. Either way, the canonical "what
 *      is selected" signal is the header's `title` attribute, which
 *      always carries the semicolon-joined names regardless of
 *      display mode. This POM reads `title` for state queries.
 *
 * ## FormBuilder ComboBoxMultiSelect DOM structure
 *
 *     <div id="${id}Div" data-module="comboBoxContainer">
 *       <header
 *         id="${id}_${fieldName}_header"
 *         title="name1;name2;…"
 *         data-type-placeholder={selectedCount === 0}
 *       >
 *         {N selected | name1, name2 | placeholder}
 *       </header>
 *     </div>
 *
 *     <!-- portaled into #form-top-container -->
 *     <div id="${id}_Dropdown" role="combo-box-list">
 *       {showSelectAllClear && (
 *         <div role="combo-box-multi-select-all-clear-actions">
 *           <a>Select All</a> | <a>Clear</a>
 *         </div>
 *       )}
 *       <div role="combo-box-multi-list-item" title="${row.name}">
 *         <Icon name="checkbox" | "checkbox_selected" class="multiSelectCheckIcon" />
 *         <span>{row.name}</span>
 *       </div>
 *       …repeat per row…
 *     </div>
 *
 * Verified in
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Fields/ComboBoxMultiSelect.js`
 * and the singular `ComboBox.js`.
 *
 * ## Standalone variant
 *
 * No standalone multi-select combo exists in `modules/Ui/`. The
 * scoped-Locator constructor below is for forms that mount the
 * FormBuilder field inside a portal / modal where the dropdown's
 * `#${id}_Dropdown` may collide with another open multi-select.
 */

import { expect, type Page, type Locator } from '@playwright/test';

const SEL = {
  portalRoot: '#form-top-container',
  listInPortal: '[role="combo-box-list"]',
  multiRow: '[role="combo-box-multi-list-item"]',
  header: '[role="comboBoxHeader"]',
  selectAllClearActions: '[role="combo-box-multi-select-all-clear-actions"]',
  typeAheadInput: '[data-type="comboBoxTypeAheadInput"]',
} as const;

const DEFAULT_WAIT = 5_000;
const BACKSPACE_CLEAR_COUNT = 80;
const FILTER_DEBOUNCE_MS = 500;

export class ComboBoxMultiSelect {
  private readonly page: Page;
  private readonly root: Locator;
  private readonly fieldId: string | null;

  /**
   * FormBuilder variant — `page` + field id.
   *
   * @example
   *   const segments = new ComboBoxMultiSelect(page, 'segments');
   *   await segments.select('Equity');
   *   await segments.select('Fixed Income');
   *   await segments.close();
   */
  constructor(page: Page, fieldId: string);
  /**
   * Scoped variant — pass a Locator that resolves to the combo's
   * `#${id}Div` wrapper or any ancestor uniquely identifying it.
   * Use when the field lives inside a portal/modal where dropdown
   * id derivation would collide with another open multi-select.
   */
  constructor(root: Locator);
  constructor(pageOrRoot: Page | Locator, fieldId?: string) {
    if (typeof fieldId === 'string') {
      this.page = pageOrRoot as Page;
      this.fieldId = fieldId;
      this.root = this.page.locator(`#${fieldId}Div`);
    } else {
      this.root = pageOrRoot as Locator;
      this.page = (pageOrRoot as Locator).page();
      this.fieldId = null;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────

  /**
   * Toggle the option ON. No-op when already selected. Opens the
   * dropdown if needed, filters via typeAhead when available, clicks
   * the row, then verifies the option appears in the header `title`.
   * The dropdown stays open after the click — the multi-select's
   * `stateReducer` sets `dontCloseList: true`.
   */
  async select(optionText: string): Promise<void> {
    if (await this.isSelected(optionText)) return;
    await this.clickRow(optionText);
    await this.expectSelectedState(optionText, true);
  }

  /**
   * Toggle the option OFF. No-op when not selected. Same flow as
   * `select` — clicking a selected row in this widget unchecks it.
   */
  async deselect(optionText: string): Promise<void> {
    if (!(await this.isSelected(optionText))) return;
    await this.clickRow(optionText);
    await this.expectSelectedState(optionText, false);
  }

  /**
   * Replace the current selection with exactly `optionTexts`. Calls
   * `clear()` first to flush any existing selection (only when the
   * Select All / Clear actions are rendered — otherwise falls back
   * to deselecting each currently-selected option), then selects
   * each provided option in order.
   */
  async setSelection(optionTexts: string[]): Promise<void> {
    await this.open();
    if (await this.hasSelectAllClearActions()) {
      await this.clear();
    } else {
      const current = await this.selectedTexts();
      for (const text of current) {
        await this.deselect(text);
      }
    }
    for (const text of optionTexts) {
      await this.select(text);
    }
  }

  /**
   * Click the dropdown's `Select All` action. Throws when the field
   * is configured with `showSelectAllClear={false}` so call sites
   * fail loudly instead of timing out on a missing element.
   */
  async selectAll(): Promise<void> {
    await this.open();
    const action = this.list().locator(`${SEL.selectAllClearActions} a`).first();
    await expect(action).toBeVisible({ timeout: DEFAULT_WAIT });
    await action.click();
  }

  /**
   * Click the dropdown's `Clear` action. Throws when the field is
   * configured without Select All / Clear actions.
   */
  async clear(): Promise<void> {
    await this.open();
    const action = this.list().locator(`${SEL.selectAllClearActions} a`).nth(1);
    await expect(action).toBeVisible({ timeout: DEFAULT_WAIT });
    await action.click();
  }

  /**
   * Open the dropdown (no-op if already open). Waits for the list
   * to become visible before returning.
   */
  async open(): Promise<void> {
    if (await this.isOpen()) return;
    await this.root.click();
    await this.list().waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
  }

  /**
   * Close the dropdown by pressing Escape. The widget's
   * `dontCloseList: true` post-click behavior leaves the list open,
   * so callers must explicitly close when done with a batch of
   * selections.
   */
  async close(): Promise<void> {
    if (!(await this.isOpen())) return;
    await this.page.keyboard.press('Escape');
    await this.list().waitFor({ state: 'hidden', timeout: DEFAULT_WAIT });
  }

  /** True if the dropdown list is currently visible. */
  async isOpen(): Promise<boolean> {
    return this.list()
      .isVisible()
      .catch(() => false);
  }

  /**
   * The list of currently selected option names, parsed from the
   * header's `title` attribute (semicolon-joined by the FE in
   * `getSelectedOptionsNames(';')`). Returns `[]` when nothing is
   * selected — the FE renders `data-type-placeholder="true"` and
   * an empty title in that case.
   */
  async selectedTexts(): Promise<string[]> {
    const header = this.root.locator(SEL.header);
    const title = (await header.getAttribute('title')) ?? '';
    if (title === '') return [];
    return title.split(';').map((s) => s.trim()).filter((s) => s !== '');
  }

  /** Number of currently selected options. */
  async selectedCount(): Promise<number> {
    return (await this.selectedTexts()).length;
  }

  /** True if `optionText` is currently selected. Exact text match. */
  async isSelected(optionText: string): Promise<boolean> {
    const selected = await this.selectedTexts();
    return selected.includes(optionText);
  }

  // ────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────

  /**
   * Locator for the dropdown list. For FormBuilder fields the
   * unique `#${fieldId}_Dropdown` id is the safest pin; for scoped
   * mode we fall back to the visible list inside the portal root.
   */
  private list(): Locator {
    if (this.fieldId) {
      return this.page.locator(`#${this.fieldId}_Dropdown`);
    }
    return this.page.locator(`${SEL.portalRoot} ${SEL.listInPortal}:visible`).first();
  }

  /**
   * Locator for the typeAhead filter input. Multi-select renders it
   * with `typeAheadEnabled={true}` set unconditionally on the inner
   * ComboBox, so it's always present once the dropdown is open.
   */
  private typeAheadInput(): Locator {
    if (this.fieldId) {
      return this.page.locator(`#${this.fieldId}_typeAhead`);
    }
    return this.root.locator(SEL.typeAheadInput);
  }

  /**
   * Open the dropdown, filter to the option, click the row. Used by
   * both `select` and `deselect` since clicking a row toggles its
   * state regardless of direction.
   */
  private async clickRow(optionText: string): Promise<void> {
    await this.open();
    await this.filterIfPossible(optionText);

    const quoted = optionText.replace(/"/g, '\\"');
    const row = this.list().locator(`${SEL.multiRow}[title="${quoted}"]`);
    await expect(row).toBeVisible({ timeout: DEFAULT_WAIT });
    await row.first().click();
  }

  /**
   * Wait for the header's selection state to reflect the expected
   * value of `optionText`. The FE updates the header on the next
   * tick after `updateFormStateMultiSelect` runs; polling the
   * `title` attribute is the cheapest way to know the toggle
   * landed.
   */
  private async expectSelectedState(optionText: string, expected: boolean): Promise<void> {
    await expect
      .poll(() => this.isSelected(optionText), { timeout: DEFAULT_WAIT })
      .toBe(expected);
  }

  /** True if the dropdown renders the Select All / Clear actions block. */
  private async hasSelectAllClearActions(): Promise<boolean> {
    return (await this.list().locator(SEL.selectAllClearActions).count()) > 0;
  }

  /**
   * Filter the option list by typing the first whitespace-delimited
   * token of `optionText` into the typeAhead input. Mirrors the
   * singular `ComboBox` POM's strategy: full-text typing
   * over-filters when the label contains punctuation, and
   * `Locator.fill('')` does not reliably clear the input — the
   * 80-keypress backspace clear is preserved verbatim.
   */
  private async filterIfPossible(optionText: string): Promise<void> {
    const input = this.typeAheadInput();
    const present = (await input.count()) > 0;
    if (!present) return;
    const visible = await input.isVisible().catch(() => false);
    if (!visible) return;

    await input.focus();
    for (let i = 0; i < BACKSPACE_CLEAR_COUNT; i++) {
      await input.press('Backspace');
    }
    const filter = optionText.split(/\s/)[0] || optionText.slice(0, 3);
    await input.pressSequentially(filter);
    await this.page.waitForTimeout(FILTER_DEBOUNCE_MS);
  }
}
