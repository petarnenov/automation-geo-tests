/**
 * `FormBuilder` — helpers for the qa SPA's FormBuilder forms.
 *
 * The FormBuilder framework (`~/geowealth/WebContent/react/app/src/modules/FormBuilder/`)
 * is the base used by every non-trivial form in the qa SPA:
 * Create/Edit User, Advanced Search, Account Billing, etc. It
 * wraps React state with its own FormContext and a
 * `setTimeout`-based validation pipeline.
 *
 * This class centralises the one cross-cutting concern that no
 * other component POM can reasonably own:
 *
 * ## The validation debounce
 *
 * FormBuilder runs a real `setTimeout`-based (~300 ms) debounce
 * on its form-wide validation state after every field change.
 * During that window:
 *
 *   - Individual field state is already committed through
 *     React's onChange path (each field's value is in form
 *     state).
 *   - The form-wide `isFormValid` flag is still stale.
 *   - The submit button's `disabledStyleOnly={!isFormValid}`
 *     style-class has not yet lifted.
 *
 * Clicking the submit button during this window triggers the
 * form's `onSubmit` handler, which re-computes validity against
 * the stale `isFormValid` state and short-circuits with
 * "mandatory field" errors — even though every field actually
 * has a value in form state. The network request is never made
 * and the modal stays open.
 *
 * There is **no DOM sentinel** that tracks this debounce. The
 * submit button's `disabled` attribute is never set (see
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Core/SubmitButton.js`),
 * the CSS-module `disabled` class is absent during the initial
 * render window (false-positive for a `:not([class*="disabled"])`
 * wait), `Tab`-blur doesn't force a flush (FormBuilder reads
 * state from its own store, not from React's batched setState),
 * and waiting for `requestAnimationFrame` ticks is too short
 * for a real `setTimeout` timer.
 *
 * The only correct solution is a bounded wait. This is a
 * **legitimate** exception to the `playwright/no-wait-for-timeout`
 * rule — the wait is tied to a specific widget, is documented,
 * and is not a bandage over a selector issue.
 *
 * ## Usage
 *
 *     import { FormBuilder } from '@geowealth/e2e-framework/components/FormBuilder';
 *
 *     // inside a page object method, after setting all fields
 *     // and before clicking a submit button:
 *     await FormBuilder.awaitValidationDebounce(page);
 *     await modal.clickButton('Create');
 *
 * Callers that use `Promise.all(page.waitForResponse + click)`
 * should put the debounce wait BEFORE the `Promise.all` so the
 * click fires after the debounce has settled.
 */

import type { Page } from '@playwright/test';

/**
 * The canonical FormBuilder debounce window, padded slightly
 * beyond the observed ~300 ms setTimeout so it absorbs render
 * cycle jitter under headless Chrome.
 */
const VALIDATION_DEBOUNCE_MS = 500;

export class FormBuilder {
  /**
   * Wait for FormBuilder's form-wide validation debounce to
   * settle. Call this after the last field setValue and before
   * clicking any submit button on a FormBuilder form.
   *
   * @param page The Playwright Page the form is rendered on.
   */
  static async awaitValidationDebounce(page: Page): Promise<void> {
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(VALIDATION_DEBOUNCE_MS);
  }
}
