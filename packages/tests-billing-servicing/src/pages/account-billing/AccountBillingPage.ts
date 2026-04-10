/**
 * `AccountBillingPage` — thin facade over the Account Billing tab and
 * its Edit Billing Settings modal.
 *
 * Phase 2 step 6 (D-37). Lives in `tests-billing-servicing/src/pages/`
 * because it is billing-servicing-specific (per Section 4.2.2 the
 * framework package owns only Page Objects shared across two or more
 * teams; team-specific Page Objects live in the team package). The
 * promotion rule (Section 4.2.2) says: a Page Object that starts in
 * a team package may be promoted to `framework/` once a *second* team
 * needs it.
 *
 * Per Section 4.4 contract:
 *   - Exposes locators as readonly properties typed Locator, named
 *     after the user concept (`editButton`, `inceptionDate`), not the
 *     implementation.
 *   - Method calls perform user-meaningful actions or return locators.
 *   - **No `expect()` assertions inside.** Assertions remain in spec
 *     files so failure messages map to user intent.
 *   - Composes framework Component classes for reusable widgets.
 *   - `goto()` performs the navigation and waits for the page-loaded
 *     signal so callers don't have to.
 *
 * Absorbs the following legacy helpers from
 * `packages/legacy-poc/tests/account-billing/_helpers.js`:
 *
 *   gotoAccountBilling                → goto({ static: 'arnold-delaney' })
 *   gotoWorkerFirmAccountBilling      → goto({ workerFirm })
 *   openEditBillingSettings           → openEditModal() (Q4)
 *   saveEditBillingSettings           → saveEditModal() (Q5)
 *   openHistory                       → openHistory()
 *   closeHistory                      → closeHistory()
 *   historyRow                        → historyRow()
 *   setBillingInceptionDate           → inceptionDate.setValue(...)
 *   getDisplayedBillingInceptionDate  → getDisplayedInceptionDate() (Q3)
 *
 * Quirks the methods absorb (from the C25193 entry spike):
 *
 *   Q3 — summary card uses sibling-axis layout (no label/input
 *        pairing). `displayedInceptionDate` reads via
 *        `text=Billing Inception Date` + `xpath=following-sibling::*[1]`.
 *
 *   Q4 — Edit modal form is fetched async after the title appears.
 *        `openEditModal()` waits for the modal title AND for the
 *        Save button to become visible (the button only renders
 *        after the form fetch completes).
 *
 *   Q5 — Save flow has a two-step modal dance (Save → success modal
 *        → Close → wait for hidden). `saveEditModal()` performs all
 *        three steps; spec authors call one method, not three.
 *
 *   Q6 — Post-save value is not immediately visible on the summary
 *        card (React Query cache lag). NOT absorbed by this Page
 *        Object — specs that need to verify post-save state should
 *        use `expect.poll(() => page.getDisplayedInceptionDate())`
 *        per the legacy C25193.spec.js pattern. When D-08
 *        (`__REACT_QUERY_CLIENT__` exposure) lands in Phase 2/3, the
 *        polling can be replaced with a single deterministic wait.
 *
 * Future Component instances (commented placeholders) for sibling
 * specs in the C25194..C25249 family land alongside their consuming
 * specs in Phase 4 — they are not pre-built here because the
 * framework's promotion rule prefers per-spec growth over speculative
 * scaffolding.
 */

import type { Page, Locator } from '@playwright/test';
import {
  ARNOLD_DELANEY,
  arnoldDelaneyAccountBillingUrl,
} from '@geowealth/e2e-framework/data/constants';
import { ReactDatePicker } from '@geowealth/e2e-framework/components/ReactDatePicker';
import { ComboBox } from '@geowealth/e2e-framework/components/ComboBox';
import type { WorkerFirm } from '@geowealth/e2e-framework/fixtures';

/**
 * Navigation target for `AccountBillingPage.goto()`. Either the
 * static Arnold/Delaney account on firm 106 (read-only — used by
 * Phase 2 of the C25193 hybrid pattern), or a worker firm's primary
 * client/account triple.
 */
export type AccountBillingTarget =
  | { readonly static: 'arnold-delaney' }
  | { readonly workerFirm: WorkerFirm };

export class AccountBillingPage {
  private readonly page: Page;

  // ─── Tab-level locators ──────────────────────────────────────────
  readonly editButton: Locator;
  readonly historyButton: Locator;

  // ─── Edit modal locators ─────────────────────────────────────────
  readonly editModalTitle: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly saveSuccessModal: Locator;
  readonly closeButton: Locator;

  // ─── History modal locators ──────────────────────────────────────
  readonly historyModalTitle: Locator;

  // ─── Summary card locators ───────────────────────────────────────

  /**
   * The persisted Billing Inception Date displayed on the summary
   * card. Uses Q3's sibling-axis xpath because the card has no
   * label/input pairing — `getByLabel` returns nothing.
   */
  readonly displayedInceptionDate: Locator;

  /**
   * The persisted Billing Method displayed on the summary card.
   * Same sibling-axis pattern as `displayedInceptionDate`.
   */
  readonly displayedBillingMethod: Locator;

  /**
   * The persisted Adviser Billing Spec displayed on the summary card.
   * Unlike the sibling-axis fields above, this one renders as a button
   * inside a `section[data-key="adviserBillingSpecification"]`.
   */
  readonly displayedAdviserBillingSpec: Locator;

  /**
   * The persisted Account for Billing displayed on the summary card.
   * Same sibling-axis pattern as `displayedInceptionDate`.
   */
  readonly displayedAccountForBilling: Locator;

  // ─── Components for form widgets ─────────────────────────────────

  /**
   * The Billing Inception Date picker. Component class wraps the
   * Q1+Q1'+Q2 quirks (dispatch-burst calendar open + 240-iter nav).
   * Specs call `accountBillingPage.inceptionDate.setValue('06/15/2025')`.
   */
  readonly inceptionDate: ReactDatePicker;

  /**
   * The Billing Method combo (icon-only variant, no typeAhead).
   * Options: "Electronic", "Paper". Default on dummy firms is empty
   * (renders as blank on the summary card).
   */
  readonly billingMethod: ComboBox;

  /**
   * The Adviser Billing Spec combo (typeAhead variant). Options are
   * firm-specific — firm 106 has "55 BPS", "55 BPS-Flows", "60 BPS",
   * etc. Dummy firms do NOT seed billing specs, so specs that exercise
   * this combo must run on firm 106.
   */
  readonly adviserBillingSpec: ComboBox;

  /**
   * The Adviser Billing Active Date picker. Only enabled when the
   * Adviser Billing Spec is set to a non-Inherit value.
   */
  readonly activeDate: ReactDatePicker;

  /**
   * The Account for Billing combo (icon-only variant, no typeAhead).
   * Options are the client's accounts rendered as "{title} ({num})".
   */
  readonly accountForBilling: ComboBox;

  constructor(page: Page) {
    this.page = page;

    this.editButton = page.getByRole('button', { name: 'Edit Billing Settings' });
    this.historyButton = page.getByRole('button', { name: 'History', exact: true });

    this.editModalTitle = page.getByText('Edit Account Billing Settings').first();
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
    this.cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
    this.saveSuccessModal = page.getByText(/Account Billing Successfully Updated/i).first();
    this.closeButton = page.getByRole('button', { name: 'Close', exact: true });

    this.historyModalTitle = page.getByText(/Billing Settings History/i).first();

    this.displayedInceptionDate = page
      .locator('text=Billing Inception Date')
      .first()
      .locator('xpath=following-sibling::*[1]');

    this.displayedBillingMethod = page
      .locator('text=Billing Method')
      .first()
      .locator('xpath=following-sibling::*[1]');

    this.displayedAdviserBillingSpec = page
      .locator('section[data-key="adviserBillingSpecification"] button')
      .first();

    this.displayedAccountForBilling = page
      .locator('text=Account for Billing')
      .first()
      .locator('xpath=following-sibling::*[1]');

    this.inceptionDate = new ReactDatePicker(page, '#billingInceptionDate');
    this.billingMethod = new ComboBox(page, 'billingMethodCd');
    this.adviserBillingSpec = new ComboBox(page, 'adviserBillingSpecification');
    this.activeDate = new ReactDatePicker(page, '#adviserBillingActiveDate');
    this.accountForBilling = new ComboBox(page, 'autoSelectClientAccount');
  }

  /**
   * Navigate to the Billing tab for either the static Arnold/Delaney
   * account on firm 106 or the given worker firm's primary
   * client/account. Waits for the History button to become visible
   * — the most stable signal that the tab content has rendered.
   */
  async goto(target: AccountBillingTarget): Promise<void> {
    const url =
      'static' in target
        ? arnoldDelaneyAccountBillingUrl()
        : `/react/indexReact.do#/client/1/${target.workerFirm.client.uuid}/accounts/${target.workerFirm.accounts[0].uuid}/billing`;
    await this.page.goto(url);
    // The History button is the most stable signal that the Billing
    // tab content rendered (legacy gotoAccountBilling uses the same
    // wait — present for both admin and non-admin views).
    await this.historyButton.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Open the Edit Billing Settings modal. Absorbs Q4: the modal title
   * appears immediately, but the form content (date pickers, combos,
   * inputs) is fetched asynchronously and only renders once the Save
   * button is present. Specs that touch form fields immediately after
   * `openEditModal()` are safe — the wait is encapsulated here.
   */
  async openEditModal(): Promise<void> {
    await this.editButton.click();
    await this.editModalTitle.waitFor({ state: 'visible', timeout: 10_000 });
    // The Save button only renders once the form fetch completes
    // (Q4). Touching form fields before this returns is racy.
    await this.saveButton.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Save the Edit Billing Settings modal and dismiss the success
   * confirmation. Absorbs Q5: clicking Save closes the Edit modal
   * AND opens a "Account Billing Successfully Updated!" success
   * modal that must be explicitly dismissed via Close. Skipping the
   * Close leaves the success modal in the DOM and the next assertion
   * races against an old DOM.
   */
  async saveEditModal(): Promise<void> {
    await this.saveButton.click();
    await this.saveSuccessModal.waitFor({ state: 'visible', timeout: 30_000 });
    await this.closeButton.click();
    await this.saveSuccessModal.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Cancel the Edit modal without saving. Some forms surface a
   * "you have unsaved changes" prompt — callers handle that
   * separately if needed.
   */
  async cancelEditModal(): Promise<void> {
    if (await this.cancelButton.isVisible().catch(() => false)) {
      await this.cancelButton.click();
    }
  }

  /**
   * Open the History modal and wait for its title to be visible.
   */
  async openHistory(): Promise<void> {
    await this.historyButton.click();
    await this.historyModalTitle.waitFor({ state: 'visible', timeout: 10_000 });
  }

  /**
   * Close the History modal.
   */
  async closeHistory(): Promise<void> {
    await this.closeButton.click();
    await this.historyModalTitle.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Locator factory for finding a row in the open History grid that
   * matches a setting name AND both before/after text fragments.
   * Returns the locator; caller asserts visibility.
   *
   * Used by sibling specs in the C25194..C25249 family that verify a
   * change is recorded in the audit trail. NOT used by C25193 itself
   * because the qa3 audit pipeline does not record Billing Inception
   * Date changes (verified live 2026-04-07; spike entry).
   */
  historyRow(opts: { setting: string; before: string; after: string }): Locator {
    return this.page
      .getByRole('row')
      .filter({ hasText: opts.setting })
      .filter({ hasText: opts.before })
      .filter({ hasText: opts.after });
  }

  /**
   * Read the persisted Billing Inception Date from the summary card.
   * Returns the trimmed text — empty string if no date is set
   * (dummy firms come with no inception date until the spec seeds
   * one; see C25193 Phase 1.1).
   *
   * Q3: this reads via the sibling-axis xpath because the summary
   * card has no label/input pairing. Documented as a justified
   * rung-5 selector per Section 4.7.
   */
  async getDisplayedInceptionDate(): Promise<string> {
    return (await this.displayedInceptionDate.innerText()).trim();
  }

  /**
   * Read the persisted Billing Method from the summary card.
   * Returns the trimmed text — empty string if no method is set
   * (dummy firms come with no billing method).
   */
  async getDisplayedBillingMethod(): Promise<string> {
    return (await this.displayedBillingMethod.innerText()).trim();
  }

  /**
   * Read the persisted Adviser Billing Spec from the summary card.
   * Returns the trimmed button text (e.g. "55 BPS", "Inherit from
   * Household (60 BPS-HH)").
   */
  async getDisplayedAdviserBillingSpec(): Promise<string> {
    return (await this.displayedAdviserBillingSpec.innerText()).trim();
  }

  /**
   * Read the persisted Account for Billing from the summary card.
   * Returns the trimmed text, e.g. "Arnold, Delaney (12287266)".
   */
  async getDisplayedAccountForBilling(): Promise<string> {
    return (await this.displayedAccountForBilling.innerText()).trim();
  }

  /**
   * Convenience accessor for the static Arnold/Delaney constants —
   * exposed on the Page Object so specs that need the raw IDs (e.g.
   * for an `expect.poll` URL) don't have to import from
   * `framework/data/constants` directly.
   */
  static readonly ARNOLD_DELANEY = ARNOLD_DELANEY;
}
