/**
 * `Modal` Component class.
 *
 * GeoWealth modals render via `ReactDOM.createPortal` into
 * `<div id="modal">`. Each open modal contributes a `Container`
 * wrapper with `data-role="modalContainer"` around a
 * `Content` wrapper with `data-role="modalContent"`. Stacked modals
 * appear as siblings under `#modal`, newest last.
 *
 * Stable selectors (verified against `~/geowealth/WebContent/react/app/src/modules/Modal/`):
 *
 *   - `#modal [data-role="modalContainer"]` — every mounted modal
 *   - `[data-role="modalContent"]` — the inner scroll container
 *     (per-modal, so footer buttons below the fold are always inside it)
 *   - `[data-role="formSubmitButton"]` — form modal submit button
 *
 * This Component scopes every interaction to the **top** modal via
 * `.last()` on the container list. Stacked-modal consumers that need
 * to target a specific layer can pass `layerIndex` to the constructor.
 *
 * Quirks absorbed:
 *
 *   Q1 (buttons below the fold). Form modals cap the inner content
 *       height; footer buttons (Save, Create, Cancel) are often
 *       below the fold. Every click-type method scrolls the per-
 *       modal `modalContent` to the bottom before attempting the
 *       click. Single shared helper — no inconsistency between
 *       click variants.
 *
 *   Q2 (success overlay after Save). Saving a form modal often
 *       triggers a second "success" modal that must be explicitly
 *       dismissed. `saveAndDismiss()` absorbs the full Save → success
 *       → Close sequence. Callers that use raw `clickButton('Save')`
 *       bypass this — callers that want the full flow must use
 *       `saveAndDismiss` explicitly.
 *
 *   Q3 (backdrop is a fixed overlay). The Component never clicks
 *       the backdrop — all dismissal goes through explicit button
 *       clicks for deterministic behaviour.
 *
 *   Q4 (stacked modals). `#modal` contains every open layer. This
 *       Component targets the newest (top) by default via `.last()`;
 *       pass `layerIndex` to the constructor to bind a Component
 *       instance to a specific layer (0 = oldest).
 */

import { expect, type Page, type Locator } from '@playwright/test';

/** Default Playwright-style waits used across the Component. */
const DEFAULT_OPEN_TIMEOUT = 10_000;
const DEFAULT_CLOSE_TIMEOUT = 5_000;
const DEFAULT_CLICK_TIMEOUT = 5_000;
const DEFAULT_SAVE_SUCCESS_TIMEOUT = 30_000;
const CANCEL_PROBE_TIMEOUT = 1_000;

/** Selectors for the GeoWealth React modal DOM, pinned to `data-role` attrs. */
const SEL = {
  portal: '#modal',
  container: '[data-role="modalContainer"]',
  content: '[data-role="modalContent"]',
  formSubmit: '[data-role="formSubmitButton"]',
} as const;

export interface ModalOptions {
  /**
   * Which stacked layer this Component binds to. Omit (default) to
   * target the **top** modal — i.e. the newest `modalContainer` in the
   * portal, which is what single-modal flows and most stacked flows
   * need. Pass `0` for the oldest, `1` for the next, and so on.
   */
  layerIndex?: number;
}

export class Modal {
  private readonly page: Page;
  private readonly portal: Locator;
  private readonly layerIndex: number | 'top';

  constructor(page: Page, options: ModalOptions = {}) {
    this.page = page;
    this.portal = page.locator(SEL.portal);
    this.layerIndex = options.layerIndex ?? 'top';
  }

  // ────────────────────────────────────────────────────────────────
  // Public scoped locators
  // ────────────────────────────────────────────────────────────────

  /**
   * The modal's `[data-role="modalContainer"]` element — scoped to
   * the layer this Component was constructed with. Use this to chain
   * further locators:
   *
   *     const mc = modal.container();
   *     await mc.getByRole('textbox', { name: 'First Name' }).fill('X');
   *
   * The chain is scoped to the target layer, so stacked-modal state
   * never leaks into queries.
   */
  container(): Locator {
    const containers = this.portal.locator(SEL.container);
    if (this.layerIndex === 'top') return containers.last();
    return containers.nth(this.layerIndex);
  }

  /**
   * The modal's inner `[data-role="modalContent"]` scroll container.
   * Scoped to this Component's layer.
   */
  content(): Locator {
    return this.container().locator(SEL.content);
  }

  // ────────────────────────────────────────────────────────────────
  // Open/close state
  // ────────────────────────────────────────────────────────────────

  /**
   * Wait until the modal is mounted and its `modalContainer` is
   * visible. Does not wait for any specific content inside — pass
   * `titleText` to wait for a specific header if a generic check is
   * not tight enough.
   */
  async waitForOpen(options?: { titleText?: string | RegExp; timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_OPEN_TIMEOUT;
    if (options?.titleText) {
      await this.container()
        .getByText(options.titleText)
        .first()
        .waitFor({ state: 'visible', timeout });
      return;
    }
    await this.container().waitFor({ state: 'visible', timeout });
  }

  /**
   * Wait until the modal (or the given title text) is no longer
   * visible. Mirrors `waitForOpen`.
   */
  async waitForClose(options?: { titleText?: string | RegExp; timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_CLOSE_TIMEOUT;
    if (options?.titleText) {
      await this.container()
        .getByText(options.titleText)
        .first()
        .waitFor({ state: 'hidden', timeout });
      return;
    }
    await this.container().waitFor({ state: 'hidden', timeout });
  }

  /** True if the target layer's `modalContainer` is currently visible. */
  async isOpen(): Promise<boolean> {
    return this.container()
      .isVisible()
      .catch(() => false);
  }

  /** Count of currently open modal layers in the portal. */
  async openCount(): Promise<number> {
    return this.portal.locator(SEL.container).count();
  }

  // ────────────────────────────────────────────────────────────────
  // Click actions
  // ────────────────────────────────────────────────────────────────

  /**
   * Click a footer button by its accessible name. Scrolls the modal's
   * `modalContent` to the bottom first (Q1) so footer buttons below
   * the fold become reachable, then does a standard Locator.click —
   * no `evaluate` shortcuts, so Playwright's actionability checks
   * (stable, visible, receives events) fire normally.
   *
   * Common names: `'Save'`, `'Cancel'`, `'Close'`, `'OK'`,
   * `'Create'`, `'Yes, Reset'`, `'Confirm & Reload'`.
   */
  async clickButton(name: string, options?: { exact?: boolean; timeout?: number }): Promise<void> {
    const exact = options?.exact ?? true;
    const timeout = options?.timeout ?? DEFAULT_CLICK_TIMEOUT;
    await this.scrollToBottom();
    const btn = this.container().getByRole('button', { name, exact }).first();
    await btn.waitFor({ state: 'visible', timeout });
    await btn.click();
  }

  /**
   * Click the Cancel button if it is present within a short probe
   * window. Some modal flows don't render Cancel, or it has already
   * disappeared after a prior action — the probe lets both cases
   * no-op cleanly. Uses `waitFor({timeout})` rather than a
   * point-in-time `isVisible()` so a button that is still mounting
   * is not missed by timing.
   */
  async clickCancel(): Promise<void> {
    await this.scrollToBottom();
    const btn = this.container().getByRole('button', { name: 'Cancel', exact: true }).first();
    const mounted = await btn
      .waitFor({ state: 'visible', timeout: CANCEL_PROBE_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (!mounted) return;
    await btn.click();
  }

  /**
   * Click any element inside the modal by its exact visible text.
   * Useful for clickable non-button elements (spans, divs, labels).
   * Scrolls to bottom first (Q1) for consistency with `clickButton`.
   */
  async clickButtonByLabel(text: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_CLICK_TIMEOUT;
    await this.scrollToBottom();
    const el = this.container().getByText(text, { exact: true }).first();
    await el.waitFor({ state: 'visible', timeout });
    await el.click();
  }

  /**
   * Click a link inside the modal by its accessible name. Used for
   * confirmation prompts that render actions as `<a>` tags
   * (e.g. "No, keep them"). Scrolls to bottom first (Q1).
   */
  async clickLink(name: string, options?: { exact?: boolean; timeout?: number }): Promise<void> {
    const exact = options?.exact ?? true;
    const timeout = options?.timeout ?? DEFAULT_CLICK_TIMEOUT;
    await this.scrollToBottom();
    const link = this.container().getByRole('link', { name, exact }).first();
    await link.waitFor({ state: 'visible', timeout });
    await link.click();
  }

  /**
   * Click the `[data-role="formSubmitButton"]` inside the modal.
   * Some form modals wire submission through this data-role instead
   * of a named button. Uses a real Locator.click (not an in-page
   * `evaluate`) so covered/obscured buttons fail loudly instead of
   * being silently swallowed by a synthetic DOM click.
   */
  async clickSubmit(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_CLICK_TIMEOUT;
    await this.scrollToBottom();
    const btn = this.container().locator(SEL.formSubmit).first();
    await btn.waitFor({ state: 'visible', timeout });
    await btn.click();
  }

  // ────────────────────────────────────────────────────────────────
  // Composite flows
  // ────────────────────────────────────────────────────────────────

  /**
   * Full Save → success-modal → Close sequence (Q2).
   *
   *   1. Click Save (or the named primary button).
   *   2. Wait for the success confirmation text to appear.
   *   3. Click the dismiss button on the success modal.
   *   4. Wait for the success text to disappear.
   *
   * The caller must be explicit about `successText` and `dismissButton`
   * — the defaults are intentionally narrow to avoid silent
   * false-positive matches on unrelated text. A default
   * `/successfully/i` pattern previously caused modals that say
   * "Update successful" or "Processed" to miss; spelling out the
   * exact text per flow is safer.
   */
  async saveAndDismiss(options: {
    /** Primary button name on the form modal. Default `'Save'`. */
    primaryButton?: string;
    /** Regex matching the success confirmation text. Required. */
    successText: RegExp;
    /** Button name on the success modal. Required (varies per flow). */
    dismissButton: string;
    /** Timeout for the whole sequence. */
    timeout?: number;
  }): Promise<void> {
    const primary = options.primaryButton ?? 'Save';
    const timeout = options.timeout ?? DEFAULT_SAVE_SUCCESS_TIMEOUT;

    await this.clickButton(primary);

    const successLocator = this.portal.getByText(options.successText).first();
    await successLocator.waitFor({ state: 'visible', timeout });

    await this.clickButton(options.dismissButton);
    await successLocator.waitFor({ state: 'hidden', timeout: DEFAULT_CLOSE_TIMEOUT });
  }

  // ────────────────────────────────────────────────────────────────
  // Scroll helpers
  // ────────────────────────────────────────────────────────────────

  /**
   * Scroll the modal's `modalContent` so that an element matching
   * `text` is in view. Uses the browser's native `scrollIntoView`
   * with `block: 'nearest'`, which handles nested offset parents
   * correctly — the previous `offsetTop` arithmetic was fragile
   * against layers with `position: relative` inside the scroll
   * ancestor.
   */
  async scrollToText(text: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_CLICK_TIMEOUT;
    const el = this.container().getByText(text, { exact: true }).first();
    await el.waitFor({ state: 'attached', timeout });
    await el.evaluate((node: Element) => {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    await el.waitFor({ state: 'visible', timeout });
  }

  /**
   * Scroll the modal's `[data-role="modalContent"]` to the bottom.
   * Per-layer scoped via `container()`, so the right scroll container
   * is targeted even when stacked modals are open. No-op when
   * `modalContent` is not attached (Message modals sometimes render
   * without an inner scroll area).
   */
  async scrollToBottom(): Promise<void> {
    const scrollable = this.content();
    if (!(await scrollable.count())) return;
    await scrollable.first().evaluate((node: Element) => {
      node.scrollTop = node.scrollHeight;
    });
  }
}
