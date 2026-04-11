/**
 * `Password` Component class.
 *
 * Wraps the qa SPA's FormBuilder `Password` field —
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Fields/Password.js`.
 * The field looks like a Text field but has three structural
 * differences that matter for automation:
 *
 *   1. **An autofill-hack sibling input.** Password.js renders a
 *      `<input name="user" type="text" className="preventAutofill">`
 *      BEFORE the real `InputCore` inside a wrapping `<span>`. The
 *      hack input has no id, so targeting `#${id}Field` still
 *      uniquely hits the real password input — but any selector
 *      that matches by role/placeholder/name alone can land on the
 *      hack input instead.
 *
 *   2. **`type="password"` on the real input.** React's value
 *      tracker handles type="password" the same way it handles
 *      type="text" for event dispatch, but the native setter path
 *      the `TextInput` POM uses runs into a subtle race with the
 *      form's dependent `confirmPassword` customValidation:
 *      `confirmPassword` reads `formFields[PASSWORD_FIELD].value`
 *      synchronously during its own validator run, and that read
 *      happens BEFORE React has committed the password's
 *      `updateFormState` result under headless Chrome's batching
 *      pattern. The result is that `confirmPassword` validates
 *      against an empty `formFields.password.value` even though
 *      the DOM input has the correct value, `isValid` stays
 *      false, and the form-wide `isFormValid` never flips to
 *      true — the SubmitButton keeps its CSS-module `disabled`
 *      style class indefinitely.
 *
 *      Playwright's `Locator.fill()` goes through the keyboard
 *      event pipeline instead of the native-setter shortcut,
 *      which serializes the input/change dispatch with React's
 *      setState flush and avoids the race. This POM uses
 *      `fill()` + an explicit blur to push the committed value
 *      through before any downstream validator reads the form
 *      state.
 *
 *   3. **Visibility-toggle icon.** Password.js renders an
 *      `<Icon>` after the input when `showPasswordIcon` is true.
 *      This POM does not expose the toggle; tests that need the
 *      icon should locate it directly.
 *
 * ## FormBuilder Password DOM structure
 *
 *     <span>
 *       <input name="user" type="text" class="preventAutofill"/>  ← autofill hack
 *       <section id="${fieldId}" data-module="password" data-type="fieldSet">
 *         <div data-type="errorContainer">
 *           <input id="${fieldId}Field" name="${fieldId}Field" type="password" />
 *           <ErrorMessage id="${fieldId}Error" />
 *         </div>
 *       </section>
 *     </span>
 *
 * ## Two construction forms
 *
 *   1. **FormBuilder** — `new Password(page, 'password')`. POM
 *      derives `#passwordField` for the input and `#passwordError`
 *      for the validation message.
 *
 *   2. **Standalone / scoped** — `new Password(locator)`. Pass a
 *      Locator that resolves to the `<input type="password">`
 *      directly. No error-message accessor in this mode.
 */

import type { Page, Locator } from '@playwright/test';

import { FormBuilder } from './FormBuilder';

const DEFAULT_WAIT = 10_000;

export class Password {
  private readonly page: Page;
  private readonly input: Locator;
  private readonly fieldId: string | null;

  /**
   * FormBuilder variant — `page` + field id (WITHOUT the `Field`
   * suffix). The POM derives `#${fieldId}Field` for the input and
   * `#${fieldId}Error` for the validation message.
   *
   * @example
   *   const pw = new Password(page, 'password');
   *   await pw.setValue('TestPass123!');
   */
  constructor(page: Page, fieldId: string);
  /**
   * Standalone / scoped variant — pass a Locator pointing at an
   * `<input type="password">` element directly.
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
   * Fill the password field with `value` through Playwright's
   * keyboard-based `fill()` path. Unlike `TextInput.setValue`
   * (which uses React's native value setter), `fill()` dispatches
   * real keystroke events that React's synthetic event system
   * processes in order — serializing the input/change dispatch
   * with React's setState flush. This keeps FormBuilder's form
   * state in sync and lets dependent validators (e.g.
   * `confirmPassword`'s check against `formFields.password.value`)
   * read the committed value instead of a stale empty string.
   *
   * Follows the fill with an explicit blur so onBlur handlers run
   * and the form's `isFormValid` recomputes against the fresh
   * state before the caller submits.
   *
   * Finally waits out the FormBuilder validation debounce
   * (`FormBuilder.awaitValidationDebounce`) so that by the time
   * `setValue` resolves, FormBuilder has already flushed its
   * debounced `validateFormFields` call for this password change
   * AND any `triggerValidation`-linked field (e.g.
   * `confirmPassword`) has re-run its `customValidation` against
   * the freshly committed `formFields.password.value`. Without
   * this, back-to-back password field writes can race the
   * debounce window and leave FormBuilder's `isFormValid` stale.
   */
  async setValue(value: string): Promise<void> {
    await this.input.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await this.input.fill(value);
    await this.input.blur();
    await FormBuilder.awaitValidationDebounce(this.page);
  }

  /** Read the input's current value via `Locator.inputValue()`. */
  async getValue(): Promise<string> {
    return this.input.inputValue();
  }

  /** Clear the password field to the empty string. */
  async clear(): Promise<void> {
    await this.setValue('');
  }

  /** True if the input is currently disabled by React. */
  async isDisabled(): Promise<boolean> {
    return this.input.isDisabled();
  }

  /**
   * Read the FormBuilder validation error message for this field,
   * if any. Returns `null` when the error container is empty
   * (field is valid) or when this POM was constructed in
   * standalone mode.
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
