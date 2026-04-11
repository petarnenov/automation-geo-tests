/**
 * `ComboBox` Component class.
 *
 * GeoWealth has two distinct ComboBox React components in the
 * application source, both of which this POM supports through a
 * single API:
 *
 *   1. **FormBuilder variant** (`modules/FormBuilder/Fields/ComboBox.js`).
 *      Rendered inside `FormBuilder` forms; every field has an `id`
 *      prop that produces stable selectors:
 *        - wrapper div:  `#${id}Div` (data-module="comboBoxContainer")
 *        - typeAhead input (when open): `#${id}_typeAhead`
 *        - dropdown list (in portal): `#${id}_Dropdown`
 *      Consumer constructs via `new ComboBox(page, 'myFieldId')`.
 *
 *   2. **Standalone Ui variant** (`modules/Ui/ComboBox/ComboBox.js`).
 *      Rendered outside FormBuilder (e.g. standalone widgets,
 *      legacy pages). No id prop; selectors are role / data-attribute
 *      based:
 *        - wrapper div:  `[role="comboBox"]`
 *        - typeAhead input (when open): `[data-type="comboBoxTypeAheadInput"]`
 *        - dropdown list (in portal): `[role="combo-box-list"]`
 *      Consumer constructs via `new ComboBox(scopedRootLocator)`.
 *
 * Both variants portal the dropdown list via `TopContainer` into the
 * `#form-top-container` DOM root. The list is therefore **never**
 * inside the combo's wrapper subtree at runtime — the POM queries
 * the portal directly.
 *
 * Both variants share the option semantics:
 *   - `role="combo-box-list-item"` for each option row
 *   - `data-value="${id}"` — the option's internal id
 *   - visible text = the option's display name
 *   - selected value on wrapper: `data-selected-value="${id}"`
 *
 * ## Opening strategy
 *
 * The wrapper's `onClick` handler opens/closes the dropdown in both
 * variants. Native `Locator.click()` works for most combos. A handful
 * of exceptional combos (the memory notes Commission Fee) need a CDP
 * click or direct `__reactProps.onClick` invocation — pass
 * `{ openStrategy: 'reactProps' }` for those. A future
 * `framework/src/helpers/cdp.ts::withCdpClick` helper will cover the
 * CDP case.
 *
 * ## Quirks preserved from the legacy POC
 *
 *   - **Exact-text match** on option selection (`:text-is(...)`).
 *     Substring would catch "55 BPS-Flows" when asked for "55 BPS".
 *   - **First-word filter** for typeAhead. Typing the full label
 *     over-filters on punctuation. The POM types only the first
 *     whitespace-delimited token.
 *   - **80-keypress backspace clear.** `Locator.fill('')` does not
 *     reliably clear the typeAhead; the legacy's 80 backspaces is
 *     kept verbatim.
 */

import { expect, type Page, type Locator } from '@playwright/test';

/** Stable selectors pinned to `data-role` / `role` attributes. */
const SEL = {
  portalRoot: '#form-top-container',
  listInPortal: '[role="combo-box-list"]',
  listItem: '[role="combo-box-list-item"]',
  header: '[role="comboBoxHeader"]',
  typeAheadInput: '[data-type="comboBoxTypeAheadInput"]',
} as const;

const DEFAULT_WAIT = 5_000;
const BACKSPACE_CLEAR_COUNT = 80;
const FILTER_DEBOUNCE_MS = 500;

export interface ComboBoxConfig {
  /**
   * How to open the combo when calling `open()` or `setValue()`.
   *
   *   - `'native'` (default) — Playwright `Locator.click()`. Works
   *     for the vast majority of combos; Playwright dispatches real
   *     mouse events that React's onClick receives normally.
   *
   *   - `'reactProps'` — invoke the React onClick prop attached to
   *     the wrapper directly via `__reactProps$...`. Escape hatch
   *     for combos where the wrapper is not a valid mouse target
   *     (descendant with `pointer-events:none`, overlay interception).
   *     Still uses the React event system, so React state updates
   *     normally.
   */
  openStrategy?: 'native' | 'reactProps';
}

export class ComboBox {
  private readonly page: Page;
  private readonly root: Locator;
  private readonly fieldId: string | null;
  private readonly config: Required<ComboBoxConfig>;

  /**
   * FormBuilder variant — `page` + field id.
   *
   * @param page Playwright Page.
   * @param fieldId The FormBuilder `id` prop of the combo (e.g.
   *   `'defaultRoleCd'` or `'adviserBillingSpecification'`). The
   *   POM derives `#${fieldId}Div`, `#${fieldId}_typeAhead`, and
   *   `#${fieldId}_Dropdown` from this.
   * @param config Interaction strategy.
   */
  constructor(page: Page, fieldId: string, config?: ComboBoxConfig);
  /**
   * Standalone Ui variant — pass a Locator that resolves to the
   * combo's `[role="comboBox"]` wrapper (or an ancestor uniquely
   * identifying it).
   *
   * @param root Locator for the combo's root element.
   * @param config Interaction strategy.
   */
  constructor(root: Locator, config?: ComboBoxConfig);
  constructor(
    pageOrRoot: Page | Locator,
    idOrConfig?: string | ComboBoxConfig,
    maybeConfig?: ComboBoxConfig
  ) {
    if (typeof idOrConfig === 'string') {
      this.page = pageOrRoot as Page;
      this.fieldId = idOrConfig;
      this.root = this.page.locator(`#${idOrConfig}Div`);
      this.config = { openStrategy: 'native', ...(maybeConfig ?? {}) };
    } else {
      this.root = pageOrRoot as Locator;
      this.page = (pageOrRoot as Locator).page();
      this.fieldId = null;
      this.config = { openStrategy: 'native', ...(idOrConfig ?? {}) };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────

  /**
   * Pick the option whose visible text exactly matches `optionText`.
   * Opens the combo if not already open, filters via typeAhead when
   * the input is available, clicks the matching option, waits for
   * the list to close.
   */
  async setValue(optionText: string): Promise<void> {
    await this.open();
    await this.filterIfPossible(optionText);

    const quoted = optionText.replace(/"/g, '\\"');
    const option = this.list().locator(`${SEL.listItem}:text-is("${quoted}")`);
    await expect(option).toBeVisible({ timeout: DEFAULT_WAIT });
    await option.first().click();
    await this.list().waitFor({ state: 'hidden', timeout: DEFAULT_WAIT });
  }

  /**
   * Pick the option by its internal `data-value` id. Use this when
   * the tested flow cares about option identity not display text —
   * avoids brittleness to localization / cosmetic renames.
   */
  async setValueById(id: string | number): Promise<void> {
    await this.open();
    const option = this.list().locator(`${SEL.listItem}[data-value="${id}"]`);
    await expect(option).toBeVisible({ timeout: DEFAULT_WAIT });
    await option.first().click();
    await this.list().waitFor({ state: 'hidden', timeout: DEFAULT_WAIT });
  }

  /**
   * Pick a virtualised-list option by its `data-value` id, scrolling
   * the list until the option row is materialised in the DOM.
   *
   * Some combos back large datasets (the Firm picker, for example,
   * holds thousands of rows) and render through `LazyList`, which
   * keeps only a window of ~20 rows in the DOM at a time. Naive
   * `setValueById` fails for any option below the initial window
   * because the target element is never attached. This method
   * scrolls the list container to the bottom in small steps, waits
   * for the next batch to render, and retries — stopping as soon as
   * the target option appears OR the visible rows stop growing
   * (stagnation = list exhausted).
   *
   * Falls back cleanly to `setValueById` semantics if the combo is
   * not virtualised (the first render already includes the target).
   *
   * @param id The option's `data-value` attribute.
   * @param options.maxScrollSteps Maximum scroll iterations before
   *   declaring the option not found. Default: 80 (~10s total).
   * @param options.stagnationLimit Consecutive scroll steps with
   *   zero new items after which we give up. Default: 4.
   */
  async setValueByIdVirtualised(
    id: string | number,
    options: { maxScrollSteps?: number; stagnationLimit?: number } = {}
  ): Promise<void> {
    const maxScrollSteps = options.maxScrollSteps ?? 80;
    const stagnationLimit = options.stagnationLimit ?? 4;

    await this.open();

    const list = this.list();
    const found = await list.evaluate(
      async (listRoot: Element, args: { dataValue: string; max: number; stagnant: number }) => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const optSel = `[role="combo-box-list-item"][data-value="${args.dataValue}"]`;
        const itemSel = '[role="combo-box-list-item"]';
        // For the FormBuilder variant the list root is `#${fieldId}_Dropdown`
        // which wraps the actual scrolling container
        // `[role="combo-box-list"]`. For the standalone variant the root IS
        // the combo-box-list. Use the nearest matching descendant, falling
        // back to the root itself.
        const scroller =
          (listRoot.querySelector('[role="combo-box-list"]') as Element | null) ?? listRoot;
        if (scroller.querySelector(optSel)) return { status: 'already-rendered' as const };

        let lastCount = scroller.querySelectorAll(itemSel).length;
        let stagnant = 0;
        for (let step = 0; step < args.max; step++) {
          scroller.scrollTop = scroller.scrollHeight;
          await sleep(120);
          if (scroller.querySelector(optSel)) {
            return { status: 'scrolled-into-view' as const, step };
          }
          const currentCount = scroller.querySelectorAll(itemSel).length;
          if (currentCount === lastCount) {
            stagnant++;
            if (stagnant >= args.stagnant) return { status: 'stagnated' as const, step };
          } else {
            stagnant = 0;
            lastCount = currentCount;
          }
        }
        return { status: 'not-found' as const };
      },
      { dataValue: String(id), max: maxScrollSteps, stagnant: stagnationLimit }
    );

    if (found.status === 'not-found' || found.status === 'stagnated') {
      throw new Error(
        `ComboBox.setValueByIdVirtualised: option with data-value="${id}" did not appear ` +
          `after scrolling the list (status=${found.status}). The value may not exist, or ` +
          `the virtualised list exhausted before reaching it.`
      );
    }

    const option = list.locator(`${SEL.listItem}[data-value="${id}"]`);
    await expect(option).toBeVisible({ timeout: DEFAULT_WAIT });
    await option.first().click();
    await this.list().waitFor({ state: 'hidden', timeout: DEFAULT_WAIT });
  }

  /**
   * Open the combo (no-op if already open). Waits for the dropdown
   * list to become visible before returning so callers can interact
   * with options immediately after.
   */
  async open(): Promise<void> {
    if (await this.isOpen()) return;

    if (this.config.openStrategy === 'native') {
      await this.root.click();
    } else {
      await this.openViaReactProps();
    }

    await this.list().waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
  }

  /**
   * Close the combo by pressing Escape (both variants listen for
   * ESC on the list). No-op if already closed.
   */
  async close(): Promise<void> {
    if (!(await this.isOpen())) return;
    await this.page.keyboard.press('Escape');
    await this.list().waitFor({ state: 'hidden', timeout: DEFAULT_WAIT });
  }

  /** True if the combo's dropdown list is currently visible. */
  async isOpen(): Promise<boolean> {
    return this.list()
      .isVisible()
      .catch(() => false);
  }

  /**
   * The visible text of the currently selected option (reads from
   * `role="comboBoxHeader"`). Returns the placeholder text when the
   * combo has no selection.
   */
  async selectedText(): Promise<string> {
    const header = this.root.locator(SEL.header);
    return (await header.innerText()).trim();
  }

  /**
   * The internal id of the currently selected option (reads
   * `data-selected-value` on the wrapper). Returns `null` when no
   * selection has been made.
   */
  async selectedId(): Promise<string | null> {
    const v = await this.root.getAttribute('data-selected-value');
    return v && v !== '' ? v : null;
  }

  // ────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────

  /**
   * Locator for the dropdown list. For FormBuilder combos this is
   * the unique `#${fieldId}_Dropdown` id; for standalone combos we
   * scope to the shared portal root and pick the visible list (only
   * one combo's list is normally open at a time).
   */
  private list(): Locator {
    if (this.fieldId) {
      return this.page.locator(`#${this.fieldId}_Dropdown`);
    }
    return this.page.locator(`${SEL.portalRoot} ${SEL.listInPortal}:visible`).first();
  }

  /**
   * Locator for the typeAhead input. FormBuilder renders the input
   * only while the list is open, so this should be called after
   * `open()`. Standalone combos always render the input when
   * `typeAheadEnabled` is true.
   */
  private typeAheadInput(): Locator {
    if (this.fieldId) {
      return this.page.locator(`#${this.fieldId}_typeAhead`);
    }
    return this.root.locator(SEL.typeAheadInput);
  }

  /**
   * Filter the option list by typing into the typeAhead input if
   * one is available. No-ops when the combo has no typeAhead input
   * (not all combos do; `typeAheadEnabled=false` in props).
   *
   * The filter text is the first whitespace-delimited token of
   * `optionText`, falling back to the first three characters when
   * the text has no whitespace. Typing the full text over-filters
   * when the label contains punctuation.
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

  /**
   * Invoke the React `onClick` prop attached to the wrapper directly,
   * bypassing the DOM mouse event chain. Used when native click is
   * swallowed by an overlay or a non-interactive descendant.
   */
  private async openViaReactProps(): Promise<void> {
    await this.root.evaluate((el: Element) => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
      if (!key) {
        throw new Error('ComboBox.openViaReactProps: wrapper has no __reactProps');
      }
      const props = (el as unknown as Record<string, { onClick?: (e: unknown) => void }>)[key];
      if (typeof props.onClick !== 'function') {
        throw new Error('ComboBox.openViaReactProps: __reactProps.onClick is not a function');
      }
      props.onClick({
        target: el,
        currentTarget: el,
        preventDefault: () => {},
        stopPropagation: () => {},
        nativeEvent: new MouseEvent('click'),
      });
    });
  }
}
