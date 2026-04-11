/**
 * `GwGridPersist` Component class.
 *
 * Wraps the `GwGridPersist` chrome shared by every ag-grid in the
 * Platform One SPA (Users, Billing Specs, Spec Overrides, Accounts,
 * etc.). That chrome is rendered by
 * `~/geowealth/WebContent/react/app/src/modules/GwGrid/` and surfaces
 * four persistable user affordances:
 *
 *   1. **Saved views** — `GridSavedViews` renders a `ListNew` with
 *      `id="savedViewsList"`. Each option is
 *      `a[data-type="listOption"][data-value="${viewName}"]`. The
 *      default view is `"System View"`. The whole component is
 *      user-scoped, so there is always at least that option.
 *
 *   2. **Customize Columns overlay** — `GridCustomizeColumns` renders
 *      a `HeaderOverlay` opened by clicking `span#customizeColumns`
 *      (id comes from `CUSTOMIZE_COLUMNS = 'customizeColumns'`). The
 *      overlay contains a FormBuilder form of column-visibility
 *      checkboxes (each with a FormBuilder-style `#${fieldId}Field`
 *      input) and a `"Confirm & Reload"` primary submit button.
 *
 *   3. **Export grid** — `ExportGridButton` renders a second
 *      `HeaderOverlay` opened by clicking `span#export` (id comes
 *      from `GRID_EXPORT = 'export'`). The overlay contains the
 *      `SelectGridColumnsForm` and an `"Export XLS"` primary submit
 *      button that calls `gridApi.exportDataAsExcel`.
 *
 *   4. **Quick filter search** — `SearchBox` renders `.quickSearch`
 *      with a plain `<input placeholder="Search">` and a 300ms
 *      debounce, then writes `gridApi.setGridOption('quickFilterText')`
 *      (see `GwGrid.js:750`).
 *
 * The overlay markup uses a CSS-module `showGridOverlay` class whose
 * hash is emitted on the element when the overlay is open
 * (`[class*="showGridOverlay"]` is the portable selector, kept verbatim
 * from the legacy specs — anchoring on the hashed module name is what
 * the Phase 2 POMs do elsewhere).
 *
 * ## Scoping
 *
 * Every consumer page in the Platform One SPA renders exactly one
 * `GwGridPersist`, so this POM takes a `page` and queries the shared
 * chrome globally. If a future page renders two grids side-by-side,
 * the constructor will grow an optional `scope?: Locator` parameter.
 *
 * ## Assertions and waits
 *
 * This component never calls `expect(...)`. Internal preconditions use
 * `locator.waitFor({ state })`; test-facing state is exposed as
 * Locator getters.
 */

import type { Download, Locator, Page } from '@playwright/test';

const DEFAULT_WAIT = 10_000;
const LIST_OPEN_WAIT = 5_000;
const OVERLAY_WAIT = 10_000;
const EXPORT_DOWNLOAD_WAIT = 30_000;
/**
 * FormBuilder runs a real setTimeout-based (~300 ms) debounce on its
 * form validation state after every field change. Customize Columns
 * and Export submit are both FormBuilder primary buttons, so the same
 * pause pattern used in `UsersPage.submitUserForm` applies here. Kept
 * at 500ms for margin.
 */
const FORM_DEBOUNCE_MS = 500;
/**
 * `SearchBox` has a 300ms debounce on the quick filter text. Callers
 * may need to wait out that debounce before asserting on the filtered
 * grid — `quickFilter` does this wait itself so specs don't have to.
 */
const QUICK_FILTER_DEBOUNCE_MS = 400;

export class GwGridPersist {
  constructor(private readonly page: Page) {}

  // ────────────────────────────────────────────────────────────────
  // Saved views
  // ────────────────────────────────────────────────────────────────

  /**
   * Open the Saved Views dropdown and pick the option whose
   * `data-value` matches `viewName` exactly. The default shipped view
   * is `'System View'` — use that to reset column visibility and
   * filter state to factory defaults before running a column
   * visibility assertion.
   *
   * Waits for the `#savedViewsList` header to reflect the new
   * selection via `"View: ${viewName}"` before returning, so callers
   * can immediately assert on the grid chrome.
   */
  async selectSavedView(viewName: string): Promise<void> {
    const list = this.savedViewsList();
    await list.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await list.click();

    const option = this.page.locator(
      `a[data-type="listOption"][data-value="${cssEscape(viewName)}"]`
    );
    await option.waitFor({ state: 'visible', timeout: LIST_OPEN_WAIT });
    await option.click();

    await list.locator(`text=View: ${viewName}`).waitFor({
      state: 'visible',
      timeout: DEFAULT_WAIT,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Customize Columns
  // ────────────────────────────────────────────────────────────────

  /**
   * Open the Customize Columns overlay (returns after the overlay's
   * heading is visible). Idempotent — safe to call when already open,
   * but the typical usage is one call before a batch of
   * `setColumnEnabled` calls.
   */
  async openCustomizeColumns(): Promise<void> {
    await this.page.locator('span#customizeColumns').click();
    await this.page
      .getByText('Customize Columns', { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: OVERLAY_WAIT });
  }

  /**
   * Toggle a column-visibility checkbox inside the currently-open
   * Customize Columns overlay to the desired state. Idempotent —
   * reads the checkbox state first and no-ops if already correct, so
   * callers can encode "ensure this column is enabled" without
   * guarding at the call site.
   *
   * `columnField` is the ag-grid column `field` prop — `SelectGridColumnsForm`
   * feeds that straight into FormBuilder as the Checkbox `id`, and
   * FormBuilder's InputCore appends `Field`, so the rendered input id
   * is `#${columnField}Field`. For example the Billing Specs Account
   * Min column uses `applyMinFeesOnAccountLevelFlag`, which renders
   * as `#applyMinFeesOnAccountLevelFlagField` in the DOM — same as
   * any other FormBuilder checkbox field addressed by the framework
   * `Checkbox` POM.
   */
  async setColumnEnabled(columnField: string, enabled: boolean): Promise<void> {
    const overlay = this.openOverlayScope();
    const inputId = `${columnField}Field`;
    const cb = overlay.locator(`input#${inputId}`);
    await cb.waitFor({ state: 'attached', timeout: DEFAULT_WAIT });

    const isChecked = await cb.isChecked();
    if (isChecked === enabled) return;

    const label = overlay.locator(`label[for="${inputId}"]`).first();
    await label.click();

    // Confirm the React state flipped before returning so callers
    // that immediately click Confirm & Reload don't race the setter.
    await this.page.waitForFunction(
      ({ selector, target }) => {
        const el = document.querySelector(selector) as HTMLInputElement | null;
        return !!el && el.checked === target;
      },
      { selector: `input#${inputId}`, target: enabled },
      { timeout: DEFAULT_WAIT }
    );
  }

  /**
   * Click the Customize Columns "Confirm & Reload" primary button
   * and wait for the overlay to close. Pauses
   * {@link FORM_DEBOUNCE_MS} first so FormBuilder's validation
   * debounce can settle before the submit — otherwise the click can
   * land during the window where the button is still rendered in its
   * pre-debounce state and the submit is swallowed.
   */
  async confirmAndReload(): Promise<void> {
    const overlay = this.openOverlayScope();
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await this.page.waitForTimeout(FORM_DEBOUNCE_MS);
    await overlay.getByRole('button', { name: 'Confirm & Reload' }).click();
    await this.page
      .getByText('Customize Columns', { exact: true })
      .first()
      .waitFor({ state: 'hidden', timeout: OVERLAY_WAIT });
  }

  // ────────────────────────────────────────────────────────────────
  // Export
  // ────────────────────────────────────────────────────────────────

  /**
   * Open the Export overlay, click "Export XLS", and capture the
   * resulting download. Returns the Playwright `Download` so callers
   * can `saveAs` to a temporary path and parse the file.
   *
   * The underlying `gridApi.exportDataAsExcel` call happens
   * synchronously inside the React handler, so the `waitForEvent`
   * needs to be registered BEFORE the click. The standard
   * Playwright download race (`Promise.all([download, click])`) is
   * used verbatim.
   */
  async exportXls(): Promise<Download> {
    await this.page.locator('span#export').click();
    await this.page
      .getByRole('button', { name: 'Export XLS', exact: true })
      .waitFor({ state: 'visible', timeout: OVERLAY_WAIT });

    // eslint-disable-next-line playwright/no-wait-for-timeout
    await this.page.waitForTimeout(FORM_DEBOUNCE_MS);

    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: EXPORT_DOWNLOAD_WAIT }),
      this.page.getByRole('button', { name: 'Export XLS', exact: true }).click(),
    ]);
    return download;
  }

  // ────────────────────────────────────────────────────────────────
  // Quick filter (search box)
  // ────────────────────────────────────────────────────────────────

  /**
   * Type a query into the grid's quick-filter SearchBox. Waits out
   * the 300ms debounce before returning so callers can immediately
   * assert on the filtered rows. Pass an empty string to clear.
   */
  async quickFilter(query: string): Promise<void> {
    const input = this.page.getByPlaceholder('Search').first();
    await input.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await input.click();
    await input.fill(query);
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await this.page.waitForTimeout(QUICK_FILTER_DEBOUNCE_MS);
  }

  // ────────────────────────────────────────────────────────────────
  // Locators (for test-facing assertions)
  // ────────────────────────────────────────────────────────────────

  /** `#savedViewsList` — the ListNew root that renders the saved views dropdown. */
  savedViewsList(): Locator {
    return this.page.locator('#savedViewsList');
  }

  /** `span#customizeColumns` — the icon that opens the Customize Columns overlay. */
  customizeColumnsButton(): Locator {
    return this.page.locator('span#customizeColumns');
  }

  /** `span#export` — the icon that opens the Export overlay. */
  exportButton(): Locator {
    return this.page.locator('span#export');
  }

  // ────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────

  /**
   * The currently-open HeaderOverlay. GwGrid's HeaderOverlay styles
   * hash the `showGridOverlay` class name, so we substring-match on
   * the prefix — the same pattern the legacy specs use.
   */
  private openOverlayScope(): Locator {
    return this.page.locator('[class*="showGridOverlay"]').first();
  }
}

/**
 * Minimal CSS.escape for attribute values — only covers what
 * `[data-value="..."]` selectors need (quotes, backslashes). Avoids
 * pulling a polyfill for a two-char escape.
 */
function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
