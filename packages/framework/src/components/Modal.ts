/**
 * `Modal` Component class.
 *
 * GeoWealth modals render via React Portal into `<div id="modal">`.
 * The portal root is defined in `index.html` and sits outside the
 * main React tree. All modal types (Message, Form, Big) land here.
 *
 * This Component scopes every locator to `#modal`, so callers never
 * need to manually filter between portal content and the page behind
 * it.
 *
 * Quirks absorbed:
 *
 *   Q1 (buttons below the fold). Form modals render inside an inner
 *       scroll container whose height is capped. Footer buttons
 *       (Save, Create, Cancel) are often below the fold. The
 *       Component scrolls the inner container to the bottom before
 *       clicking any footer button.
 *
 *   Q2 (success overlay after Save). Saving triggers a second
 *       "success" modal (e.g. "Account Billing Successfully Updated!")
 *       that must be explicitly dismissed via Close/OK. The
 *       `saveAndDismiss()` method absorbs the full Save → success →
 *       Close sequence.
 *
 *   Q3 (backdrop is a fixed overlay). The `.Container` CSS-module
 *       class renders a fixed 100vw×100vh backdrop at
 *       `rgba(0,0,0,0.3)`. ESC and backdrop-click close the modal
 *       unless `preventModalBackdropClick` is set. The Component
 *       does NOT click the backdrop — it always uses explicit button
 *       clicks for deterministic control.
 *
 *   Q4 (stacked modals). The Redux store keeps an `orderList` queue.
 *       `showModalById` can stack modals via `overShow: true`. This
 *       Component always targets `#modal` which contains ALL stacked
 *       modals — callers that need to interact with a specific layer
 *       should scope via `content()` + additional selectors.
 *
 * Usage from a Page Object:
 *
 *   class AccountBillingPage {
 *     readonly editModal: Modal;
 *     constructor(page: Page) {
 *       this.editModal = new Modal(page);
 *     }
 *     async saveEdit() {
 *       await this.editModal.saveAndDismiss();
 *     }
 *   }
 */

import { type Page, type Locator } from '@playwright/test';

export class Modal {
  private readonly page: Page;
  private readonly root: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.locator('#modal');
  }

  /**
   * Scoped locator for the portal root. Page Objects can chain
   * further selectors off this: `modal.container().getByText(...)`.
   */
  container(): Locator {
    return this.root;
  }

  /**
   * Wait until the modal portal has visible content. Checks for any
   * visible child element inside `#modal`. Use `titleText` to wait
   * for a specific modal by its header.
   *
   * @param titleText  Optional regex or string to match in the modal
   *   header. When provided, waits for that text to be visible inside
   *   `#modal` — useful when multiple modals can appear and you need
   *   to target a specific one.
   * @param timeout  Defaults to 10 000 ms.
   */
  async waitForOpen(options?: {
    titleText?: string | RegExp;
    timeout?: number;
  }): Promise<void> {
    const timeout = options?.timeout ?? 10_000;
    if (options?.titleText) {
      await this.root
        .getByText(options.titleText)
        .first()
        .waitFor({ state: 'visible', timeout });
    } else {
      // Wait for the backdrop container to appear — it's the first
      // direct child rendered by the Modal component.
      await this.root.locator('> *').first().waitFor({ state: 'visible', timeout });
    }
  }

  /**
   * Wait until the modal portal has no visible content.
   *
   * @param titleText  Optional — when provided, waits for that
   *   specific text to disappear rather than the entire portal.
   * @param timeout  Defaults to 5 000 ms.
   */
  async waitForClose(options?: {
    titleText?: string | RegExp;
    timeout?: number;
  }): Promise<void> {
    const timeout = options?.timeout ?? 5_000;
    if (options?.titleText) {
      await this.root
        .getByText(options.titleText)
        .first()
        .waitFor({ state: 'hidden', timeout });
    } else {
      await this.root.locator('> *').first().waitFor({ state: 'hidden', timeout });
    }
  }

  /**
   * Click a footer button by its accessible name. Scrolls the inner
   * scroll container to the bottom first (Q1) so that buttons below
   * the fold become clickable.
   *
   * Common names: `'Save'`, `'Cancel'`, `'Close'`, `'OK'`,
   * `'Create'`, `'Yes, Reset'`, `'Confirm & Reload'`.
   */
  async clickButton(name: string, options?: { exact?: boolean; timeout?: number }): Promise<void> {
    const exact = options?.exact ?? true;
    const timeout = options?.timeout ?? 5_000;

    // Q1 — scroll the inner scroll container to the bottom so
    // footer buttons are in view.
    await this.scrollToBottom();

    const btn = this.root.getByRole('button', { name, exact });
    await btn.waitFor({ state: 'visible', timeout });
    await btn.click();
  }

  /**
   * Click the Cancel button inside the modal. No-ops if Cancel is
   * not visible (some modals don't have one, or it's already gone
   * after a save).
   */
  async clickCancel(): Promise<void> {
    const btn = this.root.getByRole('button', { name: 'Cancel', exact: true });
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
    }
  }

  /**
   * Click an element inside the modal by its visible text label.
   * Unlike `clickButton()` which uses `getByRole('button')`, this
   * matches any element containing the exact text — useful for
   * non-button clickable elements (spans, divs, labels, etc.).
   */
  async clickButtonByLabel(text: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 5_000;
    const el = this.root.getByText(text, { exact: true }).first();
    await el.waitFor({ state: 'visible', timeout });
    await el.click();
  }

  /**
   * Click a link inside the modal by its accessible name. Used for
   * confirmation prompts that render actions as `<a>` tags
   * (e.g. "No, keep them").
   */
  async clickLink(name: string, options?: { exact?: boolean }): Promise<void> {
    const exact = options?.exact ?? true;
    await this.root.getByRole('link', { name, exact }).click();
  }

  /**
   * Click the `[data-role="formSubmitButton"]` inside the modal.
   * Some form modals use this data-role instead of a named button.
   * Scrolls to bottom first (Q1).
   */
  async clickSubmit(): Promise<void> {
    const clicked = await this.page.evaluate(() => {
      const modal = document.querySelector('#modal');
      if (!modal) return false;
      const scrollable = Array.from(modal.querySelectorAll('*')).find(
        (el) => el.scrollHeight > el.clientHeight && el.clientHeight > 0
      );
      if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
      const btn = modal.querySelector('[data-role="formSubmitButton"]');
      if (!btn) return false;
      (btn as HTMLElement).click();
      return true;
    });
    if (!clicked) {
      throw new Error('Modal.clickSubmit: [data-role="formSubmitButton"] not found inside #modal');
    }
  }

  /**
   * Full Save → success-modal → Close sequence (Q2).
   *
   * 1. Click Save.
   * 2. Wait for the success confirmation text to appear.
   * 3. Click Close (or OK) to dismiss the success modal.
   * 4. Wait for the success text to disappear.
   *
   * @param successText  Regex matching the success message. Defaults
   *   to a broad `/successfully/i` pattern. Override for modals with
   *   non-standard success text.
   * @param dismissButton  The button that dismisses the success
   *   modal. Defaults to `'Close'`.
   */
  async saveAndDismiss(options?: {
    successText?: RegExp;
    dismissButton?: string;
    timeout?: number;
  }): Promise<void> {
    const successText = options?.successText ?? /successfully/i;
    const dismissButton = options?.dismissButton ?? 'Close';
    const timeout = options?.timeout ?? 30_000;

    await this.clickButton('Save');

    const successLocator = this.root.getByText(successText).first();
    await successLocator.waitFor({ state: 'visible', timeout });

    await this.clickButton(dismissButton);
    await successLocator.waitFor({ state: 'hidden', timeout: 5_000 });
  }

  /**
   * Scroll the modal's inner scroll container until the given text
   * is visible. Uses `scrollIntoView` on the matched element.
   */
  async scrollToText(text: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 5_000;
    const el = this.root.getByText(text, { exact: true }).first();
    await el.waitFor({ state: 'attached', timeout });
    // Playwright's scrollIntoViewIfNeeded scrolls the parent page
    // instead of the portal's inner container. Use evaluate to
    // scroll the element into view within its own scroll ancestor.
    await el.evaluate((node: HTMLElement) => {
      let parent = node.parentElement;
      while (parent) {
        if (parent.scrollHeight > parent.clientHeight && parent.clientHeight > 0) {
          parent.scrollTop = node.offsetTop - parent.offsetTop;
          break;
        }
        parent = parent.parentElement;
      }
    });
    await el.waitFor({ state: 'visible', timeout });
  }

  /**
   * Scroll the modal's inner scroll container to the bottom (Q1).
   * Form modals have a capped-height inner container; footer buttons
   * sit below the fold. This finds the first scrollable descendant
   * of `#modal` and scrolls it to its full scrollHeight.
   *
   * No-ops silently if no scrollable container exists (Message
   * modals are short enough to fit without scroll).
   */
  async scrollToBottom(): Promise<void> {
    await this.page.evaluate(() => {
      const modal = document.querySelector('#modal');
      if (!modal) return;
      const scrollable = Array.from(modal.querySelectorAll('*')).find(
        (el) => el.scrollHeight > el.clientHeight && el.clientHeight > 0
      );
      if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
    });
  }

  /**
   * Check whether the modal portal currently has any visible content.
   */
  async isOpen(): Promise<boolean> {
    return await this.root.locator('> *').first().isVisible().catch(() => false);
  }
}
