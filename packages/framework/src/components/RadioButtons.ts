/**
 * `RadioButtons` Component class.
 *
 * Wraps the qa SPA's FormBuilder `RadioButtons` field. There is no
 * standalone `modules/Ui/Radio*` widget — every radio group in the
 * app goes through `FormBuilder/Fields/RadioButtons.js`, so this POM
 * targets that single render path. A scoped-Locator constructor is
 * still provided for groups that live inside a modal portal or any
 * other root that needs explicit scoping.
 *
 * ## Why not `Locator.check()` on each radio
 *
 * `RadioButtons` is a controlled group: `state.selected` drives
 * `checked` on every input, and the only path that updates state is
 * the input's `onChange → applyChange(buttonValue)`. Plain
 * `Locator.check()` waits for actionability and then synthesises a
 * click — that works in most cases, but some radio groups in the
 * app render the icon label over the input via absolute positioning,
 * which trips Playwright's hit-test and intermittently times out.
 *
 * Calling `HTMLInputElement.click()` from `evaluate` sidesteps the
 * actionability + hit-test pipeline entirely: the browser flips
 * `checked`, dispatches `click → input → change`, and React's
 * `onChange` runs through its SyntheticEvent system identically to a
 * real user click on the icon label.
 *
 * ## FormBuilder RadioButtons DOM structure
 *
 * `FormBuilder/Fields/RadioButtons.js` wraps `FormBuilder/Core/FieldSet`
 * with `dataModule="radioButtons"` and renders one `<input>` per
 * button key:
 *
 *     <section
 *       id="${fieldId}"
 *       data-type="fieldSet"
 *       data-module="radioButtons"
 *       data-key="${fieldName}"
 *     >
 *       <div data-type="errorContainer">
 *         <div data-type="fieldWrapper">
 *           <section>
 *             <div data-type="radioButton" data-disabled={disabled}>
 *               <div>
 *                 <input
 *                   type="radio"
 *                   id="${fieldId}_${key}"
 *                   name="${name || uniqueId}"
 *                   value="${key}"
 *                   checked={state.selected === key}
 *                   onChange={() => applyChange(key)}
 *                 />
 *                 <label data-type="icon" htmlFor="${fieldId}_${key}" />
 *                 <Label htmlFor="${fieldId}_${key}">{label}</Label>
 *               </div>
 *             </div>
 *             {/* …repeat per key… *\/}
 *           </section>
 *         </div>
 *         <ErrorMessage id="${fieldId}Error" />
 *       </div>
 *     </section>
 *
 * Note the input id convention is `${fieldId}_${value}` — NOT the
 * `${fieldId}Field` suffix that Text / Checkbox use. The `value`
 * attribute on each input is the canonical key that flows to
 * `updateFormState(fieldName, value, …)`, so the POM addresses
 * options by that string.
 *
 * `trueFalseAsBool` on the field converts `'true'`/`'false'` strings
 * to real booleans before they hit form state — but the input's
 * `value` attribute is still the string, so `select('true')` is the
 * correct call site even when the form receives `true`.
 *
 * Verified in
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Fields/RadioButtons.js`
 * and `FormBuilder/Core/FieldSet.js`.
 */

import type { Page, Locator } from '@playwright/test';

export class RadioButtons {
  private readonly page: Page;
  private readonly root: Locator;
  private readonly fieldId: string | null;

  /**
   * FormBuilder variant — `page` + field id. The POM derives the
   * group section at `#${fieldId}`, individual inputs at
   * `#${fieldId}_${value}`, and the validation message at
   * `#${fieldId}Error`.
   *
   * @example
   *   const accountType = new RadioButtons(page, 'accountType');
   *   await accountType.select('joint');
   */
  constructor(page: Page, fieldId: string);
  /**
   * Scoped variant — pass a Locator pointing at the FieldSet
   * `<section>` (or any ancestor that uniquely contains the group).
   * Inputs are addressed by their `value` attribute. No
   * error-message accessor in this mode (no `#${fieldId}Error`
   * derivation possible).
   */
  constructor(root: Locator);
  constructor(pageOrRoot: Page | Locator, fieldId?: string) {
    if (typeof fieldId === 'string') {
      this.page = pageOrRoot as Page;
      this.fieldId = fieldId;
      this.root = this.page.locator(`#${fieldId}`);
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
   * Select the radio whose `value` attribute matches `value`. No-op
   * when the option is already selected. The toggle is performed by
   * calling `HTMLInputElement.click()` from `evaluate`, which flips
   * `checked` and dispatches `click → input → change` so React's
   * `onChange` runs through `applyChange → updateFormState`.
   */
  async select(value: string): Promise<void> {
    if (await this.isSelected(value)) return;
    const input = this.option(value);
    await input.evaluate((el: Element) => {
      if (el.tagName !== 'INPUT' || (el as HTMLInputElement).type !== 'radio') {
        throw new Error(
          `RadioButtons.select: target is <${el.tagName.toLowerCase()}>, not <input type="radio">`
        );
      }
      (el as HTMLInputElement).click();
    });
  }

  /**
   * Read the `value` attribute of the currently selected radio in
   * the group. Returns `null` when no option is selected — which is
   * the initial state for required groups before any user
   * interaction.
   */
  async getSelectedValue(): Promise<string | null> {
    const checked = this.root.locator('input[type="radio"]:checked');
    if ((await checked.count()) === 0) return null;
    return checked.getAttribute('value');
  }

  /** True if the radio with the given `value` is currently selected. */
  async isSelected(value: string): Promise<boolean> {
    return this.option(value).isChecked();
  }

  /**
   * True if the radio with the given `value` is disabled. Per-button
   * `disabled` flows from `props.buttons[key].disabled` OR the
   * group-level `props.disabled`, both of which land on the input
   * element, so a single `isDisabled` check covers both.
   */
  async isDisabled(value: string): Promise<boolean> {
    return this.option(value).isDisabled();
  }

  /**
   * Enumerate the `value` attributes of every radio in the group, in
   * DOM order. Useful for assertions like "the group renders exactly
   * these options" without hard-coding the list at the call site.
   */
  async values(): Promise<string[]> {
    const inputs = this.root.locator('input[type="radio"]');
    const count = await inputs.count();
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const v = await inputs.nth(i).getAttribute('value');
      if (v !== null) out.push(v);
    }
    return out;
  }

  /**
   * Read the FormBuilder validation error message for this group,
   * if any. Returns `null` when the error container is empty
   * (group is valid) or when this POM was constructed in scoped
   * mode (no `#${fieldId}Error` to read from).
   */
  async errorMessage(): Promise<string | null> {
    if (!this.fieldId) return null;
    const err = this.page.locator(`#${this.fieldId}Error`);
    const present = await err.count();
    if (!present) return null;
    const text = (await err.innerText()).trim();
    return text === '' ? null : text;
  }

  // ────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────

  /**
   * Locator for a single radio option. In FormBuilder mode the input
   * id is `${fieldId}_${value}`; in scoped mode we look up by the
   * `value` attribute within the group root, which is unique per
   * radio group by HTML semantics.
   */
  private option(value: string): Locator {
    if (this.fieldId) {
      return this.page.locator(
        `#${cssEscape(`${this.fieldId}_${value}`)}`
      );
    }
    return this.root.locator(
      `input[type="radio"][value="${cssAttrEscape(value)}"]`
    );
  }
}

/**
 * Minimal CSS.escape polyfill for ids that contain `:` / `.` / other
 * characters that would otherwise terminate a CSS id selector. We
 * cannot rely on `globalThis.CSS.escape` because the POM runs in
 * Node, not the page — it builds selector strings that Playwright
 * sends to the browser.
 */
function cssEscape(value: string): string {
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

/** Escape a value for use inside an `[attr="…"]` CSS selector. */
function cssAttrEscape(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}
