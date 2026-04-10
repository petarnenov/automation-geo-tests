/**
 * `UnmanagedAssetsPage` — facade over the Account Unmanaged Assets tab
 * and its Manage Unmanaged Assets dialog.
 *
 * Phase 4. Absorbs the legacy POC's
 * `packages/legacy-poc/tests/account-billing/_unmanaged-assets-helpers.js`.
 *
 * Per Section 4.4 contract:
 *   - Exposes locators as readonly properties.
 *   - No `expect()` assertions inside — assertions stay in spec files.
 *   - `goto()` performs navigation and waits for the page-loaded signal.
 *
 * Quirks absorbed:
 *
 *   - Save button "outside viewport" trap: the dialog body has an
 *     internal scroll container; Playwright's click() refuses. The
 *     save helper dispatches click via evaluate.
 *
 *   - Bucket combos use React-props onClick (same as icon-only ComboBox)
 *     with `#{key}_multiGroupDiv` instead of `#{key}Div`, scoped by
 *     `nth(rowIndex)` because IDs are NOT row-indexed.
 *
 *   - History parser requires 2 saves before any rows appear (the
 *     `grouped.size() > 1` gate). Specs handle this, not the POM.
 *
 *   - History button can be intercepted by post-save overlay — retry
 *     loop in `openHistory()`.
 */

import { expect, type Page, type Locator } from '@playwright/test';
import {
  ARNOLD_DELANEY,
  arnoldDelaneyUnmanagedAssetsUrl,
} from '@geowealth/e2e-framework/data/constants';

export const BUCKET_KEYS = [
  'advisorExcludeCategoryCd',
  'platformExcludeCategoryCd',
  'mmExcludeCategoryCd',
  'internalAdvisorExcludeCategoryCd',
  'internalPlatformExcludeCategoryCd',
  'internalMmExcludeCategoryCd',
] as const;

export type BucketKey = (typeof BUCKET_KEYS)[number];

export class UnmanagedAssetsPage {
  private readonly page: Page;

  readonly manageButton: Locator;
  readonly historyButton: Locator;
  readonly dialogHeading: Locator;
  readonly historyHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.manageButton = page.getByRole('button', { name: 'Manage Unmanaged Assets' });
    this.historyButton = page.getByRole('button', { name: 'History', exact: true });
    this.dialogHeading = page.getByText(/Managed Unmanaged Assets/i);
    this.historyHeading = page.getByText(/Account Unmanaged Assets History/i);
  }

  /**
   * Navigate to the Unmanaged Assets tab for the static Arnold/Delaney
   * account on firm 106. Waits for either the Manage button (admin)
   * or the History button (non-admin) as the page-loaded signal.
   */
  async goto(): Promise<void> {
    await this.page.goto(arnoldDelaneyUnmanagedAssetsUrl());
    // Admin sees the Manage button; non-admin (tyler) does not but
    // does see the History button. Wait for either to appear.
    await Promise.race([
      this.manageButton.waitFor({ state: 'visible', timeout: 30_000 }),
      this.historyButton.waitFor({ state: 'visible', timeout: 30_000 }),
    ]);
  }

  // ─── Manage Dialog ──────────────────────────────────────────────

  async openManageDialog(): Promise<void> {
    await this.manageButton.click();
    await this.dialogHeading.waitFor({ state: 'visible', timeout: 10_000 });
    await this.page
      .locator('input[placeholder="Enter Instrument Symbol"]')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
  }

  /**
   * Save the Manage dialog and wait for it to close. Verbatim from
   * the legacy `_unmanaged-assets-helpers.js::saveManageDialog`.
   *
   * The dialog's Save button sits below the internal scroll container
   * — Playwright's coordinate-based click refuses. The evaluate path
   * uses scrollIntoView + native click. The `.last()` is needed
   * because other parts of the underlying page may have their own
   * Save buttons.
   */
  async saveManageDialog(): Promise<void> {
    const save = this.page.getByRole('button', { name: 'Save', exact: true }).last();
    await expect(save).toBeEnabled({ timeout: 10_000 });
    // Retry the save click: the first evaluate-based click can
    // silently no-op when the dialog's internal scroll hasn't
    // settled. Poll until the dialog heading disappears.
    await expect
      .poll(
        async () => {
          if (!(await this.dialogHeading.isVisible().catch(() => false))) return false;
          await save.evaluate((el: Element) => {
            const btn = el as HTMLElement;
            btn.scrollIntoView({ block: 'center' });
            btn.click();
          });
          // Small wait to let the save/close animation start.
          await this.page.waitForTimeout(500);
          return await this.dialogHeading.isVisible().catch(() => false);
        },
        { timeout: 30_000, intervals: [1_000, 2_000, 3_000, 5_000] }
      )
      .toBe(false);
  }

  // ─── Instrument Symbol ──────────────────────────────────────────

  /**
   * Find the row index of an existing instrument by symbol/description.
   * Returns -1 if not found.
   */
  async findRowIndexBySymbol(pattern: RegExp): Promise<number> {
    const inputs = this.page.locator('input[placeholder="Enter Instrument Symbol"]');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const v = await inputs.nth(i).inputValue();
      if (pattern.test(v)) return i;
    }
    return -1;
  }

  /**
   * Click "Add New Row" to append an empty multiGroup row.
   */
  async addNewRow(): Promise<void> {
    await this.page.getByRole('button', { name: 'Add New Row' }).click();
  }

  /**
   * Pick an instrument into the given row's symbol autocomplete.
   */
  async pickInstrumentSymbol(
    rowIndex: number,
    symbol: string,
    optionText: string
  ): Promise<void> {
    const input = this.rowLocator(rowIndex).locator(
      'input[placeholder="Enter Instrument Symbol"]'
    );
    await input.click();
    await input.pressSequentially(symbol);
    const option = this.page
      .locator('[role="option"]')
      .filter({ hasText: optionText })
      .first();
    await expect(option).toBeVisible({ timeout: 5000 });
    await this.reactClick(option);
  }

  // ─── Bucket Combos ─────────────────────────────────────────────

  /**
   * Set a bucket combo to the given value for a specific row.
   */
  async setBucket(rowIndex: number, bucketKey: BucketKey, optionText: string): Promise<void> {
    const div = this.page.locator(`#${bucketKey}_multiGroupDiv`).nth(rowIndex);
    const option = this.page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: new RegExp(`^${optionText}$`) })
      .first();
    await expect
      .poll(
        async () => {
          await div.evaluate((el: Element) => {
            const htmlEl = el as HTMLElement;
            htmlEl.scrollIntoView({ block: 'center' });
            const k = Object.keys(el).find((kk) => kk.startsWith('__reactProps'));
            if (!k) throw new Error(`no react props on ${htmlEl.id}`);
            (el as unknown as Record<string, { onClick: (e: unknown) => void }>)[k].onClick({
              target: el,
              currentTarget: el,
              preventDefault: () => {},
              stopPropagation: () => {},
              nativeEvent: new MouseEvent('click'),
            });
          });
          return await option.isVisible().catch(() => false);
        },
        { timeout: 5000, intervals: [100, 200, 400, 800] }
      )
      .toBe(true);
    await this.reactClick(option);
    await expect(div.locator('header')).toContainText(optionText, { timeout: 5000 });
  }

  /**
   * Read the current bucket combo header text for a specific row.
   */
  async getBucket(rowIndex: number, bucketKey: BucketKey): Promise<string> {
    return (
      await this.page
        .locator(`#${bucketKey}_multiGroupDiv`)
        .nth(rowIndex)
        .locator('header')
        .innerText()
    ).trim();
  }

  // ─── Exclude from Performance ──────────────────────────────────

  /**
   * Toggle the Exclude from Performance checkbox for a specific row.
   */
  async toggleExcludeFromPerformance(rowIndex: number): Promise<void> {
    await this.page
      .locator('#labelexcludeFromPerformance_multiGroupField')
      .nth(rowIndex)
      .evaluate((el: Element) => (el as HTMLElement).click());
  }

  /**
   * Read whether the row's Exclude from Performance checkbox is checked.
   */
  async getExcludeFromPerformance(rowIndex: number): Promise<boolean> {
    return await this.page
      .locator('#excludeFromPerformance_multiGroupField')
      .nth(rowIndex)
      .evaluate((el: Element) => (el as HTMLInputElement).checked);
  }

  // ─── History Modal ─────────────────────────────────────────────

  /**
   * Open the UA History modal with a retry loop (post-save overlay
   * can intercept the first click).
   */
  async openHistory(): Promise<void> {
    await expect
      .poll(
        async () => {
          if (await this.historyHeading.isVisible().catch(() => false)) return true;
          await this.historyButton.click({ timeout: 2_000 }).catch(() => {});
          return this.historyHeading.isVisible().catch(() => false);
        },
        { timeout: 20_000, intervals: [500, 1_000, 2_000] }
      )
      .toBe(true);
  }

  async closeHistory(): Promise<void> {
    await this.page.getByRole('button', { name: 'Close', exact: true }).click();
  }

  // ─── Helpers (private) ─────────────────────────────────────────

  /**
   * Ensure a row with the given symbol exists, creating one if needed.
   * Returns the row index.
   */
  async ensureInstrumentRow(
    symbolPattern: RegExp,
    symbol: string,
    optionText: string
  ): Promise<number> {
    let rowIdx = await this.findRowIndexBySymbol(symbolPattern);
    if (rowIdx < 0) {
      const row0Value = await this.rowLocator(0)
        .locator('input[placeholder="Enter Instrument Symbol"]')
        .inputValue();
      if (row0Value.trim() !== '') {
        await this.addNewRow();
        rowIdx =
          (await this.page.locator('input[placeholder="Enter Instrument Symbol"]').count()) - 1;
      } else {
        rowIdx = 0;
      }
      await this.pickInstrumentSymbol(rowIdx, symbol, optionText);
    }
    return rowIdx;
  }

  /**
   * Set all 6 bucket combos to the given value for a specific row,
   * skipping any that already have the target value.
   */
  async setAllBuckets(rowIndex: number, value: string): Promise<void> {
    for (const key of BUCKET_KEYS) {
      if ((await this.getBucket(rowIndex, key)) !== value) {
        await this.setBucket(rowIndex, key, value);
      }
    }
  }

  private rowLocator(rowIndex: number): Locator {
    return this.page.locator(`section[id="unmanagedInstrumentsJSON_${rowIndex}"]`);
  }

  private async reactClick(loc: Locator): Promise<void> {
    await loc.evaluate((el: Element) => {
      const k = Object.keys(el).find((kk) => kk.startsWith('__reactProps'));
      if (k) {
        (el as unknown as Record<string, { onClick: (e: unknown) => void }>)[k].onClick({
          target: el,
          currentTarget: el,
          preventDefault: () => {},
          stopPropagation: () => {},
          nativeEvent: new MouseEvent('click'),
        });
      } else {
        (el as HTMLElement).click();
      }
    });
  }

  static readonly ARNOLD_DELANEY = ARNOLD_DELANEY;
}
