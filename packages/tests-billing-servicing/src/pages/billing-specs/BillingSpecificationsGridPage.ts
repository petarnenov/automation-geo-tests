/**
 * Page Object for Platform One → Billing Center → Billing Specifications.
 *
 * Covers the Specifications grid for a single firm — the list view
 * rendered by
 * `~/geowealth/WebContent/react/app/src/pages/PlatformOne/pages/BillingCenter/pages/BillingSpecs/pages/BillingSpecs/Components/BillingSpecsGrid/BillingSpecsGrid.js`
 * and its per-row action strip
 * (`Components/BillingSpecsRowsActions/BillingSpecsRowsActions.js`).
 *
 * ## What the FE does that this POM has to respect
 *
 *   - **Grid data comes from `GET /react/getP1BillingSpecs.do?firmCd=X`.**
 *     The React store starts empty and the `useService` hook fires the
 *     request on mount. Until that XHR returns, the grid shows an
 *     `AppLoader` and `.ag-row` is absent. `open()` pairs the goto with
 *     a `waitForResponse` for this endpoint so callers never race the
 *     initial render.
 *
 *   - **Row actions live under a `hiddenActionRow` class and only show
 *     on hover.** The Edit / Copy / Delete icons are inside
 *     `<span title="Edit">` / `"Copy"` / `"Delete"` elements. The Edit
 *     and Copy spans wrap React-Router `<Link>`s — clicking the span
 *     navigates via `pathname + /edit/{billingSpecId}` or `/copy/...`.
 *     The POM hovers the row first, then clicks the span by `title`.
 *
 *   - **Inactive firms hide the Edit icon.** `useFirmsSelectors →
 *     isInactiveFirm(firmCd)` gates the Edit span. Firm 1 is always
 *     active in QA, so `editFirstRow()` is safe for the read-only
 *     specs in Run 175 — but if a future caller passes a firm that
 *     might be inactive, the hover→click path will throw a clean
 *     locator-not-visible error rather than hang.
 *
 *   - **Edit navigation is a hash-route change, not a modal.** After
 *     clicking Edit the URL becomes
 *     `#platformOne/billingCenter/specifications/{firmCd}/edit/{id}` and
 *     the CreateBillingSpecification form mounts with a "Save Updates"
 *     primary button. Callers assert that URL + button, not a modal
 *     open event.
 *
 * ## Assertions and waits
 *
 * This POM never calls `expect(...)`. Internal preconditions use
 * `locator.waitFor({ state })` and `waitForResponse`; test-facing state
 * is exposed as Locator getters so specs can assert through
 * `await expect(page.saveUpdatesButton()).toBeVisible()`.
 *
 * ## Navigation
 *
 * The Billing Specifications route is NOT enumerated in
 * `PlatformOnePage.PlatformOneSection` yet — the direct URL is
 * `#platformOne/billingCenter/specifications/{firmCd}`, which doesn't
 * live under `platformOne/operations/billingCenter` like the other
 * Billing Center sections in that POM. Rather than widen the union
 * for a single consumer, this POM navigates via `page.goto()` directly
 * and does its own permission-deny detection (the route is wrapped in
 * `GeowealthP1Route`; non-firm-1 admins bounce to `/dashboard`). If a
 * second billing-specs-rooted page appears, lift this into
 * `PlatformOnePage` as `billingSpecifications` section.
 */

import type { Locator, Page } from '@playwright/test';
import { GwGridPersist } from '@geowealth/e2e-framework/components';

const DEFAULT_WAIT = 10_000;
const GRID_LOAD_TIMEOUT = 30_000;
const EDIT_NAV_TIMEOUT = 30_000;
const COPY_NAV_TIMEOUT = 30_000;

const GET_BILLING_SPECS_ENDPOINT = /\/react\/getP1BillingSpecs\.do/;

/** ag-grid column field for the Specification Description column. */
const SPEC_DESCRIPTION_COL_ID = 'specificationDescription';

export class BillingSpecificationsGridPage {
  /**
   * Chrome wrapper for the grid's GwGridPersist affordances (saved
   * views, customize columns, export, quick filter). Exposed as a
   * public field so specs can reach into it directly when the action
   * they need isn't wrapped by this POM — `gridPage.grid.quickFilter(...)`
   * reads as well as a thin facade method would.
   */
  readonly grid: GwGridPersist;

  constructor(private readonly page: Page) {
    this.grid = new GwGridPersist(page);
  }

  // ────────────────────────────────────────────────────────────────
  // Navigation
  // ────────────────────────────────────────────────────────────────

  /**
   * Navigate to the Billing Specifications grid for `firmCd` and wait
   * until the initial `getP1BillingSpecs.do` fetch completes AND the
   * grid header is visible. Pairs the goto with a `waitForResponse`
   * so callers never race the initial store population.
   *
   * Throws a clean permission-deny error if App.js bounced us to
   * /dashboard (GEO-21029 — non-GW-Admin users can't reach
   * /platformOne/*).
   */
  async open(firmCd: number): Promise<void> {
    const target = `/react/indexReact.do#platformOne/billingCenter/specifications/${firmCd}`;

    await Promise.all([
      this.page.waitForResponse(
        (resp) => GET_BILLING_SPECS_ENDPOINT.test(resp.url()) && resp.status() === 200,
        { timeout: GRID_LOAD_TIMEOUT }
      ),
      this.page.goto(target),
    ]);

    const url = this.page.url();
    if (url.includes('#dashboard') || url.endsWith('/dashboard')) {
      throw new Error(
        `BillingSpecificationsGridPage: permission-deny navigating to ` +
          `#platformOne/billingCenter/specifications/${firmCd} — App.js redirected ` +
          `to /dashboard. The logged-in user lacks gwAdminFlag. Use tim1Page.`
      );
    }

    await this.heading().waitFor({ state: 'visible', timeout: GRID_LOAD_TIMEOUT });
    await this.waitForRowsLoaded();
  }

  // ────────────────────────────────────────────────────────────────
  // Row actions
  // ────────────────────────────────────────────────────────────────

  /**
   * Wait until the first ag-grid row is rendered. Called by `open()`
   * after the fetch lands — the XHR can resolve a tick before ag-grid
   * has finished mounting the row DOM, so we also wait on `.ag-row`.
   */
  async waitForRowsLoaded(): Promise<void> {
    await this.row(0).waitFor({ state: 'visible', timeout: GRID_LOAD_TIMEOUT });
  }

  /**
   * Hover a grid row and click its Edit icon. The row action strip
   * uses `hiddenActionRow` CSS and only materialises on hover —
   * `row.hover()` is mandatory before the Edit span becomes clickable.
   *
   * Does NOT wait for the edit form to mount. Use
   * `waitForEditFormLoaded()` after to assert the navigation landed.
   */
  async editRowByIndex(rowIndex: number): Promise<void> {
    await this.clickRowActionIcon(rowIndex, 'Edit');
  }

  /**
   * Hover a grid row and click its Copy icon. Navigates to the
   * `/copy/{billingSpecId}` URL where `CreateBillingSpecification`
   * mounts in copy mode. Use `waitForCopyFormLoaded()` after to
   * assert the navigation landed.
   */
  async copyRowByIndex(rowIndex: number): Promise<void> {
    await this.clickRowActionIcon(rowIndex, 'Copy');
  }

  /**
   * Wait until the edit form has navigated in (hash matches
   * `/edit/{id}`) and its "Save Updates" primary button is visible.
   * Uses `waitForURL` + locator wait so a stuck edit navigation
   * surfaces as two distinct errors (URL never changed vs. form never
   * mounted) instead of one opaque locator timeout.
   */
  async waitForEditFormLoaded(firmCd: number): Promise<void> {
    await this.page.waitForURL(
      new RegExp(`#platformOne/billingCenter/specifications/${firmCd}/edit/`),
      { timeout: EDIT_NAV_TIMEOUT }
    );
    await this.saveUpdatesButton().waitFor({
      state: 'visible',
      timeout: EDIT_NAV_TIMEOUT,
    });
  }

  /**
   * Wait until the copy form has navigated in (hash matches
   * `/copy/{id}`). The primary button in copy mode is labelled
   * "Create Spec" rather than "Save Updates"; asserting visibility
   * is the caller's job via `CopyBillingSpecificationPage`.
   */
  async waitForCopyFormLoaded(firmCd: number): Promise<void> {
    await this.page.waitForURL(
      new RegExp(`#platformOne/billingCenter/specifications/${firmCd}/copy/`),
      { timeout: COPY_NAV_TIMEOUT }
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Row lookups
  // ────────────────────────────────────────────────────────────────

  /**
   * Read the Specification Description cell text of the nth row.
   * Used by specs that capture the source row name before copying
   * so they can assert the destination row later without having to
   * care about ag-grid internal ids.
   */
  async getRowSpecName(rowIndex: number): Promise<string> {
    const cell = this.row(rowIndex).locator(`.ag-cell[col-id="${SPEC_DESCRIPTION_COL_ID}"]`);
    return (await cell.innerText()).trim();
  }

  /**
   * Locator for the grid row whose Specification Description cell
   * contains `name` (substring match, since the grid virtualises
   * long names and row locators should survive minor text wrapping).
   */
  findRowBySpecName(name: string): Locator {
    return this.page
      .locator('.ag-row')
      .filter({
        has: this.page
          .locator(`.ag-cell[col-id="${SPEC_DESCRIPTION_COL_ID}"]`)
          .filter({ hasText: name }),
      })
      .first();
  }

  /**
   * Quick-filter the grid by typing into the SearchBox. Delegates to
   * the shared `GwGridPersist` component so the 300ms search debounce
   * is handled once and not reinvented per spec.
   */
  async quickSearch(query: string): Promise<void> {
    await this.grid.quickFilter(query);
  }

  // ────────────────────────────────────────────────────────────────
  // Locators (for test-facing assertions)
  // ────────────────────────────────────────────────────────────────

  /** Heading element for the Billing Specifications page. */
  heading(): Locator {
    return this.page.getByText('Billing Specifications', { exact: true }).first();
  }

  /** Nth rendered ag-grid data row (0-indexed in DOM order). */
  row(rowIndex: number): Locator {
    return this.page.locator('.ag-row').nth(rowIndex);
  }

  /**
   * "Save Updates" primary button on the edit form. Exposed as a
   * locator so specs can assert on it via `await expect(...)`.
   */
  saveUpdatesButton(): Locator {
    return this.page.getByRole('button', { name: 'Save Updates', exact: true }).first();
  }

  /** Column header locator by visible name (for column visibility assertions). */
  columnHeader(name: string): Locator {
    return this.page.getByRole('columnheader', { name, exact: true });
  }

  /**
   * Locator for every data cell in the column with the given
   * `col-id`. Used to assert per-row content (e.g. Y/N in Account
   * Min/Max columns after enabling them). `col-id` must be resolved
   * from the column header via `await columnHeader(name).getAttribute('col-id')`.
   */
  cellsByColId(colId: string): Locator {
    return this.page.locator(`.ag-row .ag-cell[col-id="${colId}"]`);
  }

  // ────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────

  /**
   * Hover a row and click the action icon with the given `title`
   * attribute. Used by `editRowByIndex` / `copyRowByIndex` /
   * (future) `deleteRowByIndex`. The row action strip is hidden
   * behind a CSS `hiddenActionRow` class that only renders on hover
   * — `row.hover()` is mandatory.
   */
  private async clickRowActionIcon(rowIndex: number, title: string): Promise<void> {
    const row = this.row(rowIndex);
    await row.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await row.hover();

    const icon = row.locator(`span[title="${title}"]`).first();
    await icon.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await icon.click();
  }
}
