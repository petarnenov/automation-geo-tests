/**
 * `Checkbox` Component class.
 *
 * Wraps the qa SPA's FormBuilder `Checkbox` field and the standalone
 * `Ui/Checkbox` component. Both render a real `<input type="checkbox">`
 * driven by React state, but the visible click target differs and the
 * standalone variant hides the native input via `className="hidden"`,
 * so plain `Locator.click()` against the `<input>` is unreliable.
 *
 * ## Why not `Locator.check()` / `setChecked()`
 *
 * Playwright's `check()` actionability waits for the element to be
 * visible and stable. The standalone `Ui/Checkbox` paints
 * `<input className="hidden">` and exposes a `<label htmlFor={id}>`
 * icon as the only visible click target — Playwright considers the
 * input non-actionable and times out. Forcing the click works, but
 * still goes through the visibility check pipeline.
 *
 * Calling `HTMLInputElement.click()` from `evaluate` sidesteps both
 * issues: the browser flips `checked`, dispatches `click → input →
 * change` events, and React's `onChange` runs through its
 * SyntheticEvent system as if a user clicked the label. The same
 * call works against the FormBuilder variant where the input is
 * styled but not hidden, so one code path covers both.
 *
 * ## FormBuilder Checkbox DOM structure
 *
 * `FormBuilder/Fields/Checkbox.js` wraps `FormBuilder/Core/FieldSet`
 * with `dataModule="checkbox"` and renders:
 *
 *     <section
 *       id="${fieldId}"
 *       data-type="fieldSet"
 *       data-module="checkbox"
 *       data-key="${fieldName}"
 *     >
 *       <div data-type="errorContainer">
 *         <div data-type="fieldWrapper">
 *           <input
 *             type="checkbox"
 *             id="${fieldId}Field"
 *             name="${fieldName}"
 *             checked={isChecked}
 *             onChange={updateCheckBoxState}
 *           />
 *           <label data-type="icon"><Icon /></label>
 *           <label data-type="checkboxLabel" htmlFor="${fieldId}Field" />
 *         </div>
 *         <ErrorMessage id="${fieldId}Error" />
 *       </div>
 *     </section>
 *
 * The input is a controlled component: `checked` is bound to React
 * state, and `onChange` flows through `setCheckboxValue →
 * updateFormState`. When the parent passes
 * `useEmptyCheckboxValue=false`, unchecking calls `removeField`
 * instead of writing the empty value to form state.
 *
 * Verified in
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Fields/Checkbox.js`
 * and `FormBuilder/Core/FieldSet.js`.
 *
 * ## Standalone variant
 *
 * `~/geowealth/WebContent/react/app/src/modules/Ui/Checkbox/Checkbox.js`
 * renders a much simpler tree:
 *
 *     <div data-field-display="checkbox">
 *       <input className="hidden" type="checkbox" id={id} checked={checked} onChange={onChange} />
 *       <label data-type="icon" htmlFor={id}><Icon /></label>
 *       {label && <Label htmlFor={id}>{label}</Label>}
 *     </div>
 *
 * The input is hidden, so all user interaction goes through the
 * label. Pass the `<input>` Locator directly — the POM toggles via
 * `evaluate` and never relies on visibility.
 *
 * ## Two construction forms
 *
 *   1. **FormBuilder** — `new Checkbox(page, 'sendEmail')`.
 *      POM derives `#sendEmailField` for the input and
 *      `#sendEmailError` for the validation message.
 *
 *   2. **Standalone / scoped** — `new Checkbox(locator)`.
 *      Pass a Locator pointing at the `<input type="checkbox">`.
 *      No error-message accessor in this mode (no FieldSet).
 */

import type { Page, Locator } from '@playwright/test';

export class Checkbox {
  private readonly page: Page;
  private readonly input: Locator;
  private readonly fieldId: string | null;

  /**
   * FormBuilder variant — `page` + field id (WITHOUT the `Field`
   * suffix). The POM derives `#${fieldId}Field` for the input and
   * `#${fieldId}Error` for the validation message.
   *
   * @example
   *   const sendEmail = new Checkbox(page, 'sendEmail');
   *   await sendEmail.check();
   */
  constructor(page: Page, fieldId: string);
  /**
   * Standalone / scoped variant — pass a Locator pointing at an
   * `<input type="checkbox">` element directly.
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
   * Set the checkbox to the desired state. No-ops when the current
   * state already matches `value`. The toggle is performed by
   * calling `HTMLInputElement.click()` from `evaluate`, which flips
   * `checked` and dispatches `click → input → change` so React's
   * `onChange` runs through `setCheckboxValue → updateFormState`.
   * Works against both the FormBuilder variant (visible input) and
   * the standalone `Ui/Checkbox` (input hidden behind a label).
   */
  async setChecked(value: boolean): Promise<void> {
    const current = await this.isChecked();
    if (current === value) return;
    await this.toggle();
  }

  /** Convenience for `setChecked(true)`. */
  async check(): Promise<void> {
    await this.setChecked(true);
  }

  /** Convenience for `setChecked(false)`. */
  async uncheck(): Promise<void> {
    await this.setChecked(false);
  }

  /**
   * Flip the current checkbox state unconditionally. Prefer
   * `setChecked` / `check` / `uncheck` when the desired end state
   * is known — they idempotently no-op when already in the target
   * state.
   */
  async toggle(): Promise<void> {
    await this.input.evaluate((el: Element) => {
      if (el.tagName !== 'INPUT' || (el as HTMLInputElement).type !== 'checkbox') {
        throw new Error(
          `Checkbox.toggle: target is <${el.tagName.toLowerCase()}>, not <input type="checkbox">`
        );
      }
      (el as HTMLInputElement).click();
    });
  }

  /** Read the input's current `checked` state from the DOM. */
  async isChecked(): Promise<boolean> {
    return this.input.isChecked();
  }

  /** True if the input is currently disabled by React. */
  async isDisabled(): Promise<boolean> {
    return this.input.isDisabled();
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
