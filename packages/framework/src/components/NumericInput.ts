/**
 * `NumericInput` Component class.
 *
 * Phase 2 step 5 (D-37). Lifted verbatim from the legacy POC's
 * `packages/legacy-poc/tests/_helpers/ui.js::setReactNumericInput`
 * (lines 194-203).
 *
 * Why a Component class instead of `Locator.fill()`: the qa SPA
 * wires its numeric inputs through React's controlled-component
 * value setter. Plain Playwright `fill()` writes the input.value
 * property directly, but React's onChange handler does NOT fire on
 * a property write — only on the synthetic event burst that React's
 * own setValue triggers. The result is that `fill()` LOOKS like it
 * worked (the input shows the new value) but Save submits the
 * previous value.
 *
 * The fix is to use `Object.getOwnPropertyDescriptor(window
 * .HTMLInputElement.prototype, 'value').set` to bypass React's
 * value tracker, then dispatch synthetic `input` and `change`
 * events. This is the same trick the React Testing Library uses
 * internally for `fireEvent.change`.
 */

import type { Page } from '@playwright/test';

export class NumericInput {
  private readonly page: Page;
  private readonly inputId: string;

  /**
   * @param page Playwright Page.
   * @param inputId The DOM `id` of the input element. Stored as the
   *   raw id (without `#`) so the Component can use it both for the
   *   selector and inside `evaluate()` parameters.
   */
  constructor(page: Page, inputId: string) {
    this.page = page;
    this.inputId = inputId;
  }

  /**
   * Set the input's value through React's value setter so the
   * onChange handler fires and the controlled component's state
   * updates. The value is passed as a string because that's what
   * the underlying setter accepts; numeric coercion happens in the
   * application code.
   */
  async setValue(value: string): Promise<void> {
    await this.page.locator(`#${this.inputId}`).evaluate((el: Element, v: string) => {
      const input = el as HTMLInputElement;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
}
