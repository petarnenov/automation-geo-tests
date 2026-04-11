/**
 * `NumericInput` Component class.
 *
 * Wraps the qa SPA's FormBuilder numeric inputs (Number, Percent,
 * Currency, Phone-number mask, plain Text) and any standalone
 * controlled `<input>` that React manages via a value setter.
 *
 * ## Why this isn't just `Locator.fill()`
 *
 * GeoWealth's FormBuilder numeric inputs are React **controlled
 * components**: the input's `value` prop is driven by React state,
 * and `onChange` is the only way the state updates. React ships a
 * value-tracker that compares the input's DOM `value` against its
 * last-known state value; when the two match, `onChange` is **not
 * fired** even if a property write happened. Plain Playwright
 * `Locator.fill()` sets `input.value` directly, which trips the
 * tracker and makes `onChange` a no-op — the visible text updates
 * but React state does not, and Save submits the stale value.
 *
 * The fix is the React Testing Library trick: look up the native
 * `HTMLInputElement.prototype.value` setter via
 * `Object.getOwnPropertyDescriptor`, invoke it against the element,
 * then dispatch `input` and `change` events. React's SyntheticEvent
 * system picks up the real setter call and runs the onChange handler.
 *
 * ## FormBuilder DOM structure
 *
 * Every `FormBuilder/Fields/{Number,Percent,Currency,Text,...}`
 * component ends up at `FormBuilder/Core/InputCore`, which renders:
 *
 *     <section
 *       id="${fieldId}"
 *       data-type="fieldSet"
 *       data-module="inputNumber" | "percent" | "currency" | ...
 *       data-key="${fieldName}"
 *     >
 *       <label htmlFor="${fieldId}Field" />
 *       <div data-type="errorContainer">
 *         <input id="${fieldId}Field" name="${fieldId}Field" type="text" />
 *         <ErrorMessage id="${fieldId}Error" />
 *       </div>
 *     </section>
 *
 * Verified in
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Core/InputCore.js`
 * and `FieldSet.js`.
 *
 * Key naming convention: the FormBuilder `id` prop (e.g.
 * `'adviserBillingDiscountAmount'`) is NOT the input's DOM id. The
 * actual `<input>` gets an `id="${id}Field"` suffix. This POM
 * follows the same convention as `ComboBox`: callers pass the
 * field id without suffix, the POM derives the input and error
 * selectors internally.
 *
 * ## Two construction forms
 *
 *   1. **FormBuilder** — `new NumericInput(page, 'myFieldId')`.
 *      POM derives `#myFieldIdField` for the input and
 *      `#myFieldIdError` for the validation message.
 *
 *   2. **Standalone / scoped** — `new NumericInput(locator)`.
 *      Pass any Locator that resolves to an `<input>` element.
 *      No error-message accessor in this mode (there is no
 *      FormBuilder FieldSet to read errors from).
 */

import type { Page, Locator } from '@playwright/test';

export interface NumericInputSetOptions {
  /**
   * Blur the input after setting the value. Some FormBuilder fields
   * (currency, phone-number mask, plain text with formatValue) only
   * commit their normalised value on blur — the onChange fires, but
   * the final persisted string is rewritten in a blur handler. Set
   * `true` for those; the default is `false` because most consumers
   * follow setValue with another interaction that naturally blurs
   * the input.
   */
  blur?: boolean;
}

export class NumericInput {
  private readonly page: Page;
  private readonly input: Locator;
  private readonly fieldId: string | null;

  /**
   * FormBuilder variant — `page` + field id (WITHOUT the `Field`
   * suffix). The POM derives `#${fieldId}Field` for the input and
   * `#${fieldId}Error` for the validation message.
   *
   * @example
   *   const amount = new NumericInput(page, 'adviserBillingDiscountAmount');
   *   await amount.setValue(55);
   */
  constructor(page: Page, fieldId: string);
  /**
   * Standalone / scoped variant — pass a Locator pointing at an
   * `<input>` element directly. Use this for inputs that are not
   * rendered through FormBuilder, or when a scoped locator is
   * easier than deriving from a field id.
   */
  constructor(input: Locator);
  constructor(pageOrInput: Page | Locator, fieldId?: string) {
    if (typeof fieldId === 'string') {
      this.page = pageOrInput as Page;
      this.fieldId = fieldId;
      this.input = this.page.locator(`#${fieldId}Field`);
    } else {
      this.input = pageOrInput as Locator;
      this.page = (pageOrInput as Locator).page();
      this.fieldId = null;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────

  /**
   * Set the input's value through React's native value setter so
   * the controlled component's `onChange` handler fires. Accepts
   * either a string or a number — numbers are stringified before
   * the setter call since the native setter expects a string.
   */
  async setValue(value: string | number, options?: NumericInputSetOptions): Promise<void> {
    const str = typeof value === 'number' ? String(value) : value;
    await this.input.evaluate((el: Element, v: string) => {
      const input = el as HTMLInputElement;
      if (input.tagName !== 'INPUT') {
        throw new Error(
          `NumericInput.setValue: target is <${input.tagName.toLowerCase()}>, not <input>`
        );
      }
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        'value'
      )?.set;
      if (!setter) {
        throw new Error('NumericInput.setValue: native value setter unavailable');
      }
      setter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, str);

    if (options?.blur) {
      await this.input.blur();
    }
  }

  /**
   * Read the input's current value. Reflects the React state after
   * any normalisation the component applied (e.g. Percent trims
   * extra decimal places, Currency inserts thousand separators).
   */
  async getValue(): Promise<string> {
    return this.input.inputValue();
  }

  /**
   * Clear the input to the empty string using the same React-aware
   * setter path `setValue` uses. Equivalent to `setValue('')` but
   * more obvious at the call site when the intent is just to clear.
   */
  async clear(options?: NumericInputSetOptions): Promise<void> {
    await this.setValue('', options);
  }

  /** True if the input is currently disabled by React. */
  async isDisabled(): Promise<boolean> {
    return this.input.isDisabled();
  }

  /**
   * Read the FormBuilder validation error message for this field,
   * if any. Returns `null` when the error container is empty (field
   * is valid) or when this POM was constructed in standalone mode
   * (no FieldSet to read from).
   *
   * Scoped to `#${fieldId}Error` which is where
   * `FormBuilder/Core/FieldSet.ErrorMessage` renders.
   */
  async errorMessage(): Promise<string | null> {
    if (!this.fieldId) return null;
    const err = this.page.locator(`#${this.fieldId}Error`);
    const present = await err.count();
    if (!present) return null;
    const text = (await err.innerText()).trim();
    return text === '' ? null : text;
  }
}
