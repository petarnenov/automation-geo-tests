/**
 * `ComboBox` Component class.
 *
 * Phase 2 step 5 (D-37). Lifted verbatim from the legacy POC's
 * `packages/legacy-poc/tests/_helpers/ui.js::setComboBoxValue`
 * (lines 125-181). Verified live on the qa3 Edit Account Billing
 * Settings modal on 2026-04-07.
 *
 * The qa SPA's "comboBoxContainer" is NOT a native `<select>` — it
 * is a `data-module="comboBoxContainer"` div with two distinct
 * variants. The Component picks the right path automatically based
 * on whether the typeAhead input exists.
 *
 *   Variant 1 — typeAhead: has `<input id="{key}_typeAhead">`. Type
 *     to filter, click the matching `[role="combo-box-list-item"]`.
 *
 *   Variant 2 — icon-only (Adjustment Type, Commission Fee, etc.):
 *     no input — Playwright `.click()` lands on `<body>`. Workaround:
 *     invoke the React `onClick` handler attached to the container
 *     div via `__reactProps$xxx` directly.
 *
 * Quirks preserved:
 *
 *   - **Exact-text matching, not substring** (`text-is`). Substring
 *     would catch e.g. "55 BPS-Flows" when asked for "55 BPS".
 *   - **First-word filter** for typeAhead. Typing the full label can
 *     over-filter when the label contains punctuation the typeAhead
 *     matches differently. The Component types only the first word.
 *   - **80-keypress backspace clear**. The typeAhead input retains
 *     prior text across opens; `.fill('')` does not clear it
 *     reliably. The legacy uses 80 backspaces — preserved verbatim.
 *
 * **Commission Fee combo is the documented exception** and the only
 * combo this class does NOT handle (per the project_billing_form
 * _quirks memory and reference_billing_helpers memory). It does not
 * respond to JS dispatchEvent or React props onClick — it only
 * opens via a real Playwright CDP click on the OUTER wrapper. The
 * legacy POC has C25201's local `setCommissionFee` for it. The
 * spike's Phase 2 work order owes that special case its own
 * dedicated helper (`framework/src/helpers/cdp.ts::withCdpClick`)
 * which lands alongside C25201 in Phase 4. Calling
 * `ComboBox.setValue` against `commissionFreeFlag` will fail at
 * the `[role="combo-box-list-item"]` wait — by design.
 */

import { expect, type Page } from '@playwright/test';

export class ComboBox {
  private readonly page: Page;
  private readonly fieldKey: string;

  /**
   * @param page Playwright Page.
   * @param fieldKey The `data-key` on the comboBox section, e.g.
   *   `'adviserBillingSpecification'` or `'adviserBillingDiscountType'`.
   *   The Component derives selector ids from this key:
   *     - typeAhead variant: `#{fieldKey}_typeAhead`
   *     - icon-only variant: `#{fieldKey}Div`
   */
  constructor(page: Page, fieldKey: string) {
    this.page = page;
    this.fieldKey = fieldKey;
  }

  /**
   * Pick the option whose visible text matches `optionText` exactly.
   * Auto-detects which variant the combo is (typeAhead vs icon-only)
   * and routes accordingly.
   *
   * @param optionText EXACT visible text of the desired option.
   *   Substring matches are NOT used (would catch e.g. "55 BPS-Flows"
   *   when asked for "55 BPS").
   */
  async setValue(optionText: string): Promise<void> {
    const hasTypeAhead = await this.page
      .locator(`#${this.fieldKey}_typeAhead`)
      .count()
      .then((n) => n > 0);

    if (hasTypeAhead) {
      await this.setViaTypeAhead(optionText);
    } else {
      await this.setViaReactProps(optionText);
    }
  }

  private async setViaTypeAhead(optionText: string): Promise<void> {
    const typeAhead = this.page.locator(`#${this.fieldKey}_typeAhead`);
    await typeAhead.evaluate((el: Element) => {
      const input = el as HTMLInputElement;
      input.focus();
      input.select();
    });
    // 80-keypress clear — the typeAhead retains prior text across
    // opens; .fill('') is unreliable. Verbatim from the legacy.
    for (let i = 0; i < 80; i++) await typeAhead.press('Backspace');
    // First-word filter — the full label over-filters on punctuation.
    const filterPrefix = optionText.split(/\s/)[0] || optionText.slice(0, 3);
    await typeAhead.pressSequentially(filterPrefix);
    const option = this.page.locator(
      `[role="combo-box-list-item"]:text-is("${optionText.replace(/"/g, '\\"')}")`
    );
    await expect(option).toBeVisible({ timeout: 5000 });
    // The matched item ignores Locator.click() too — invoke its
    // native click via evaluate.
    await option.evaluate((el: Element) => (el as HTMLElement).click());
  }

  private async setViaReactProps(optionText: string): Promise<void> {
    // Open the dropdown by invoking the React onClick handler
    // directly. Playwright .click() lands on <body> for this variant.
    await this.page.locator(`#${this.fieldKey}Div`).evaluate((div: Element) => {
      const key = Object.keys(div).find((k) => k.startsWith('__reactProps'));
      if (!key) throw new Error('comboBox container has no react props');
      const props = (div as unknown as Record<string, { onClick: (e: unknown) => void }>)[key];
      props.onClick({
        target: div,
        currentTarget: div,
        preventDefault: () => {},
        stopPropagation: () => {},
        nativeEvent: new MouseEvent('click'),
      });
    });

    const option = this.page.locator(
      `[role="combo-box-list-item"]:text-is("${optionText.replace(/"/g, '\\"')}")`
    );
    await expect(option).toBeVisible({ timeout: 5000 });

    // The list item also needs the React-props click path on this
    // variant. Fall back to a regular click if the props aren't
    // present (some list items render with regular onClick handlers).
    await option.evaluate((el: Element) => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
      if (key) {
        const props = (el as unknown as Record<string, { onClick: (e: unknown) => void }>)[key];
        props.onClick({
          target: el,
          currentTarget: el,
          preventDefault: () => {},
          stopPropagation: () => {},
          nativeEvent: new MouseEvent('click'),
        });
      } else {
        (el as HTMLElement).click();
      }
    });
  }
}
