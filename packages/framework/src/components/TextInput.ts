/**
 * `TextInput` Component class.
 *
 * Wraps the qa SPA's FormBuilder `Text` field and any standalone
 * controlled `<input type="text">` / `<textarea>` that React drives
 * via a value setter.
 *
 * ## Why not `Locator.fill()`
 *
 * FormBuilder Text (`modules/FormBuilder/Fields/Text.js`) is a
 * React **controlled component**: the input's `value` prop is
 * driven by React state and `onChange` is the only path to update
 * it. React ships a value-tracker that compares the input's DOM
 * `value` against its last-known state value; when the two match,
 * `onChange` is NOT fired even if a property write happened. Plain
 * Playwright `Locator.fill()` sets `input.value` directly, which
 * trips the tracker and makes `onChange` a no-op — the visible
 * text updates but React state does not, and Save submits the
 * stale value.
 *
 * The React Testing Library trick: look up the native
 * `HTMLInputElement.prototype.value` setter via
 * `Object.getOwnPropertyDescriptor`, invoke it against the
 * element, then dispatch `input` and `change` events so React's
 * SyntheticEvent system runs `onChange` normally.
 *
 * ## FormBuilder Text DOM structure
 *
 * `FormBuilder/Fields/Text.js` wraps `FormBuilder/Core/InputCore.js`
 * and passes `dataModule="inputText"`. InputCore renders:
 *
 *     <section
 *       id="${fieldId}"
 *       data-type="fieldSet"
 *       data-module="inputText"
 *       data-key="${fieldName}"
 *     >
 *       <label htmlFor="${fieldId}Field" />
 *       <div data-type="errorContainer">
 *         <input id="${fieldId}Field" name="${fieldId}Field" type="text" />
 *         <ErrorMessage id="${fieldId}Error" />
 *       </div>
 *     </section>
 *
 * Text's onChange trims whitespace on every keystroke, so the
 * committed state is always the trimmed form. No blur is required
 * to get the trimmed value — unlike Currency / masked variants
 * which only normalise on blur.
 *
 * Verified in
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Fields/Text.js`
 * and `FormBuilder/Core/InputCore.js`.
 *
 * ## Standalone variant
 *
 * There is no standalone Text component in `modules/Ui/`. Pages
 * that need a non-FormBuilder text input render a plain `<input>`.
 * Most of those are NOT React controlled components and work fine
 * with `Locator.fill()`, but some custom widgets still drive value
 * through React state. This POM handles both by accepting a
 * Locator in the standalone constructor form; the native-setter
 * path is harmless against uncontrolled inputs.
 *
 * ## Two construction forms
 *
 *   1. **FormBuilder** — `new TextInput(page, 'firstName')`.
 *      POM derives `#firstNameField` for the input and
 *      `#firstNameError` for the validation message.
 *
 *   2. **Standalone / scoped** — `new TextInput(locator)`.
 *      Pass any Locator that resolves to an `<input>` or
 *      `<textarea>` element. No error-message accessor in this
 *      mode (no FieldSet to read errors from).
 */

import type { Page, Locator } from '@playwright/test';

export interface TextInputSetOptions {
  /**
   * Blur the input after setting the value. FormBuilder Text
   * commits the trimmed form on every keystroke, so blur is
   * usually unnecessary; set `true` only when the next interaction
   * depends on the blur handler running (validation rules keyed
   * to `interactedWithField`, showing field errors, etc.).
   */
  blur?: boolean;
}

export class TextInput {
  private readonly page: Page;
  private readonly input: Locator;
  private readonly fieldId: string | null;

  /**
   * FormBuilder variant — `page` + field id (WITHOUT the `Field`
   * suffix). The POM derives `#${fieldId}Field` for the input and
   * `#${fieldId}Error` for the validation message.
   *
   * @example
   *   const firstName = new TextInput(page, 'firstName');
   *   await firstName.setValue('Alice');
   */
  constructor(page: Page, fieldId: string);
  /**
   * Standalone / scoped variant — pass a Locator pointing at an
   * `<input>` or `<textarea>` element directly.
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
   * the controlled component's `onChange` handler fires and the
   * form state updates. The native setter path is harmless against
   * uncontrolled inputs, so standalone non-React inputs accept the
   * same call.
   */
  async setValue(value: string, options?: TextInputSetOptions): Promise<void> {
    await this.input.evaluate((el: Element, v: string) => {
      const tag = el.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        throw new Error(
          `TextInput.setValue: target is <${tag.toLowerCase()}>, not <input> or <textarea>`
        );
      }
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
      inputEl.focus();
      const prototype =
        tag === 'INPUT'
          ? globalThis.HTMLInputElement.prototype
          : globalThis.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) {
        throw new Error('TextInput.setValue: native value setter unavailable');
      }
      setter.call(inputEl, v);
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);

    if (options?.blur) {
      await this.input.blur();
    }
  }

  /**
   * Read the input's current value. For FormBuilder Text this
   * reflects the trimmed state because `Text.onChange` trims on
   * every keystroke.
   */
  async getValue(): Promise<string> {
    return this.input.inputValue();
  }

  /**
   * Clear the input to the empty string through the React-aware
   * setter path `setValue` uses. Equivalent to `setValue('')` but
   * more obvious at the call site.
   */
  async clear(options?: TextInputSetOptions): Promise<void> {
    await this.setValue('', options);
  }

  /** True if the input is currently disabled by React. */
  async isDisabled(): Promise<boolean> {
    return this.input.isDisabled();
  }

  /** True if the input has the `readOnly` attribute set. */
  async isReadOnly(): Promise<boolean> {
    const v = await this.input.getAttribute('readonly');
    return v !== null;
  }

  /**
   * The `maxlength` attribute on the input, if FormBuilder Text
   * was constructed with a `maxLength` prop. Returns `null` when
   * no max length is enforced.
   */
  async maxLength(): Promise<number | null> {
    const v = await this.input.getAttribute('maxlength');
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Read the FormBuilder validation error message for this field,
   * if any. Returns `null` when the error container is empty
   * (field is valid) or when this POM was constructed in
   * standalone mode (no FieldSet to read from).
   *
   * Scoped to `#${fieldId}Error` where
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
