/**
 * Page Object for Billing Center → Copy Billing Specification form.
 *
 * Wraps the `CreateBillingSpecification` React page when mounted in
 * `copy` mode (URL hash
 * `#platformOne/billingCenter/specifications/{sourceFirmCd}/copy/{billingSpecId}`).
 * In copy mode the form is prefilled with the source spec's data
 * minus the internal ids (see `billingSpecsServices.getById(_, true)`),
 * and the submit button is labelled `"Create Spec"` rather than
 * `"Save Updates"`.
 *
 * Verified in
 * `~/geowealth/WebContent/react/app/src/pages/PlatformOne/pages/BillingCenter/pages/BillingSpecs/pages/CreateBillingSpecification/CreateBillingSpecification.js`
 * (submit label) and
 * `.../Components/GeneralProrate/_hooks/useGeneralFields.js`
 * (field ids: `firmCd`, `specificationDescription`).
 *
 * ## Non-obvious form quirks
 *
 *   - **Changing the firm resets the spec name back to the source
 *     value.** `CreateBillingSpecification` re-mounts the prorate
 *     subsection when `firmCd` changes, and the `specificationDescription`
 *     controlled input reinitialises from the original billing spec
 *     payload. Specs must therefore either set the firm FIRST and the
 *     name SECOND, or capture the intended name after the firm
 *     change. This POM enforces the latter by splitting `setTargetFirm`
 *     and `setSpecName` into distinct methods — callers decide the
 *     order and the POM warns in docs, rather than the POM hardcoding
 *     a sequence that might be wrong for a future caller.
 *
 *   - **Virtualised firm picker.** Firm options render through
 *     `LazyList` and per-viewport only ~20 firms are in the DOM at a
 *     time, so `setTargetFirm` uses
 *     `ComboBox.setValueByIdVirtualised` to scroll until the target
 *     firm option materialises. Picking a recently-created dummy
 *     firm from firm 1's combo would otherwise fail silently — the
 *     option just isn't in the first render window.
 *
 *   - **"Create Successful" banner, not a modal.** On submit the app
 *     keeps the user on the `/copy/` URL and renders a plain-text
 *     "Create Successful" message somewhere on the page. There's no
 *     modal and no URL change to verify; the POM waits on the text.
 *
 * ## Assertions and waits
 *
 * This POM never calls `expect(...)`. Preconditions use
 * `locator.waitFor({ state })`; test-facing state is exposed as
 * Locator getters for spec-side assertions.
 */

import type { Locator, Page } from '@playwright/test';
import { ComboBox, TextInput } from '@geowealth/e2e-framework/components';

const DEFAULT_WAIT = 10_000;
const CREATE_SPEC_TIMEOUT = 60_000;

export class CopyBillingSpecificationPage {
  private readonly specName: TextInput;
  private readonly firmCombo: ComboBox;

  constructor(private readonly page: Page) {
    this.specName = new TextInput(page, 'specificationDescription');
    this.firmCombo = new ComboBox(page, 'firmCd');
  }

  // ────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────

  /**
   * Wait until the copy form's primary input is populated from the
   * source billing spec. The form hydrates asynchronously through
   * `billingSpecsServices.getById(id, true)` after the route mounts,
   * so the `specificationDescription` input may be momentarily empty
   * on first render. Returning only after a non-empty value means
   * callers don't race the hydration.
   */
  async waitForHydrated(): Promise<void> {
    const input = this.page.locator('#specificationDescriptionField');
    await input.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector('#specificationDescriptionField') as
          | HTMLInputElement
          | null;
        return !!el && el.value.trim().length > 0;
      },
      { timeout: DEFAULT_WAIT }
    );
  }

  /** Current value of the Specification Description input. */
  async getSpecName(): Promise<string> {
    return this.specName.getValue();
  }

  /**
   * Set the Specification Description field to `name`. Goes through
   * the React-aware `TextInput` setter so the form state updates,
   * not just the DOM value.
   *
   * NOTE: calling `setTargetFirm` AFTER this method will reset the
   * name back to the source value. If both a firm change and a
   * custom name are needed, call `setTargetFirm` first, then
   * `setSpecName`.
   */
  async setSpecName(name: string): Promise<void> {
    await this.specName.setValue(name);
  }

  /**
   * Change the Firm Name picker to target firm `firmCd`. Scrolls
   * the virtualised firm list until the option materialises, then
   * clicks it. Throws with a descriptive error if the firm isn't
   * present in the logged-in user's firm list.
   */
  async setTargetFirm(firmCd: number): Promise<void> {
    await this.firmCombo.setValueByIdVirtualised(firmCd);
  }

  /**
   * Click the "Create Spec" primary button and wait for the
   * "Create Successful" confirmation to render. The app keeps the
   * user on the `/copy/` URL after success — no navigation, no
   * modal; the confirmation is plain text somewhere on the page.
   */
  async submit(): Promise<void> {
    const button = this.createSpecButton();
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await this.waitForCreateSuccess();
  }

  /**
   * Wait for the "Create Successful" confirmation message. Exposed
   * separately from `submit()` so a spec that needs to observe the
   * pre-success state can assert on it before moving on.
   */
  async waitForCreateSuccess(): Promise<void> {
    // On qa2 the confirmation renders as a heading; on other envs it
    // may render as plain text. Accept either via locator OR.
    await this.page
      .getByRole('heading', { name: 'Create Successful' })
      .or(this.page.getByText('Create Successful'))
      .waitFor({ state: 'visible', timeout: CREATE_SPEC_TIMEOUT });
  }

  // ────────────────────────────────────────────────────────────────
  // Locators (for test-facing assertions)
  // ────────────────────────────────────────────────────────────────

  /** "Create Spec" primary submit button. */
  createSpecButton(): Locator {
    return this.page.getByRole('button', { name: 'Create Spec', exact: true });
  }

  /** Specification Description input element. */
  specNameInput(): Locator {
    return this.page.locator('#specificationDescriptionField');
  }
}
