/**
 * Page Object for Platform One → Firm Admin → User Management.
 *
 * The advanced search panel is a FormBuilder form with two fields
 * (verified in
 * `~/geowealth/WebContent/react/app/src/pages/PlatformOne/pages/FirmAdmin/UserManagement/Components/UserManagementAdvancedSearch/UserManagementAdvancedSearch.js`):
 *
 *   - `firmCd` — FormBuilder ComboBox, `typeAheadEnabled: true`.
 *     Options keyed by firmCd; display name = `firm.name`.
 *     POM selectors: `#firmCdDiv`, `#firmCd_Dropdown`, items with
 *     `data-value="${firmCd}"`.
 *
 *   - `email` — FormBuilder Text field. React controlled, so
 *     plain `Locator.fill()` risks leaving the form state empty
 *     even when the DOM value is set. Goes through the
 *     `TextInput` POM which uses React's native value setter.
 *     Validation: `value.length >= MIN_LENGTH_FOR_EMAIL` (3).
 *
 * ## Firm-1 specific quirk
 *
 * For `firmCd === 1`, the store routes to
 * `userManagementServices.getFirmOneUsers` (not the regular
 * `getUsers`) which returns **tree data grouped by primary email**
 * — each top-level row is a group containing child rows for every
 * user with that email, across all firms. The backend for this
 * path ignores the `email` filter in the search form and returns
 * every email group in firm 1 (~3k+ rows). Client-side filtering
 * via the column header or row-text lookup is therefore necessary.
 *
 * Consequently:
 *   - `searchByEmail(1, email)` submits the advanced search, waits
 *     for the grid to settle, then locates the specific tree group
 *     row by exact email text and expands it so the children are
 *     visible.
 *   - `linkAction()` / `delinkAction()` return Locators scoped to
 *     the expanded group's children. Tests drive assertions via
 *     `await expect(userMgmt.delinkAction()).toBeVisible()` —
 *     assertions live in the spec, not the POM.
 */

import type { Page, Locator } from '@playwright/test';
import { ComboBox } from '@geowealth/e2e-framework/components/ComboBox';
import { TextInput } from '@geowealth/e2e-framework/components/TextInput';

const DEFAULT_SEARCH_TIMEOUT = 30_000;
const DEFAULT_ACTION_TIMEOUT = 15_000;

export class UserManagementPage {
  private readonly firmFilter: ComboBox;
  private readonly emailInput: TextInput;
  /**
   * Tracks the email the test most recently searched for, so
   * `linkAction()` / `delinkAction()` / the action click methods
   * can scope to the matching tree group's children instead of
   * scanning the whole 3k+ row grid.
   */
  private currentEmail: string | null = null;

  constructor(private readonly page: Page) {
    this.firmFilter = new ComboBox(page, 'firmCd');
    this.emailInput = new TextInput(page, 'email');
  }

  // ────────────────────────────────────────────────────────────────
  // Search
  // ────────────────────────────────────────────────────────────────

  /**
   * Run the advanced search with `firmCd` + `email` filters, wait
   * for the grid to settle, narrow the grid via the column header
   * filter, then expand the tree group for the target email so its
   * children are visible for Link/Delink assertions.
   *
   * ag-grid virtualisation renders only a window of rows, so
   * `scrollIntoViewIfNeeded` on an arbitrary row text is not
   * reliable against a 3k-row firm. The column header's "Primary
   * Email Address / Name" filter input drives ag-grid's internal
   * filter model, which re-applies the visible row window around
   * the matching rows — fast and deterministic.
   */
  async searchByEmail(firmCd: number, email: string): Promise<void> {
    this.currentEmail = email;

    // Firm combo — pick by option data-value (the firmCd key on
    // the ComboBox options object), avoiding the fragile "type +
    // match by text" hack that depended on `(firmCd)` appearing
    // in the option display name (it doesn't — FormBuilder
    // displays only `firm.name`).
    await this.firmFilter.setValueById(firmCd);

    // Email text — committed through React's native value setter
    // via the TextInput POM. `Locator.fill()` would not reliably
    // propagate the value to the controlled form state.
    await this.emailInput.setValue(email);

    // Submit and wait for the backend fetch to complete. The
    // firm-1 path goes through `searchUsersByPrimaryEmail.do`;
    // other firms go through `searchUsersActivateDeactivate.do`.
    // Both POST responses mark the fetch as done. Without this
    // wait, the column filter in `filterGridByEmail` races
    // against a stale dataset in headless mode.
    const endpoint =
      firmCd === 1 ? /searchUsersByPrimaryEmail\.do/ : /searchUsersActivateDeactivate\.do/;
    await Promise.all([
      this.page.waitForResponse(
        (resp) => endpoint.test(resp.url()) && resp.status() === 200,
        { timeout: DEFAULT_SEARCH_TIMEOUT }
      ),
      this.page.getByRole('button', { name: 'Search', exact: true }).click(),
    ]);

    // Wait for the grid root to be present.
    await this.page
      .locator('.ag-root-wrapper')
      .waitFor({ state: 'visible', timeout: DEFAULT_SEARCH_TIMEOUT });

    // Retry-ready polling for the target row to appear in the
    // data. Headless Chrome sometimes reports a 200 response
    // before the downstream store + ag-grid render cycle has
    // populated the DOM (plus, the backend's user index may lag
    // a few seconds behind a fresh createUser commit). Instead
    // of a single waitForTimeout, re-click Search until either
    // the row appears or we hit the hard timeout.
    await this.waitForSearchRowToAppear(email);

    // Expand the resulting tree group so Link/Delink actions
    // are in the DOM (firm-1 tree grid only — no-op otherwise).
    await this.expandGroupForEmail(email);
  }

  /**
   * Poll-retry for the target email to show up in the grid after
   * the advanced search. On each tick we re-submit the form (via
   * a Search button click) so any backend indexing lag between
   * createUser and the search query gets another chance to
   * catch up. Stops as soon as the row is visible.
   */
  private async waitForSearchRowToAppear(email: string): Promise<void> {
    const row = this.groupRowForEmail(email);
    const deadline = Date.now() + DEFAULT_SEARCH_TIMEOUT;

    while (Date.now() < deadline) {
      // Apply the column filter so we don't depend on the
      // backend honoring the form's email filter.
      await this.filterGridByEmail(email);

      if (await row.isVisible().catch(() => false)) {
        return;
      }

      // Re-submit Search — try again after a short pause to give
      // the backend index time to catch up.
      await this.page.waitForTimeout(1000);
      await this.page.getByRole('button', { name: 'Search', exact: true }).click();
      await this.waitForGridSettled().catch(() => {});
    }

    throw new Error(
      `UserManagementPage: timed out waiting for grid to show email "${email}". ` +
        `The user was created successfully in the Users grid but did not appear ` +
        `in the User Management search within ${DEFAULT_SEARCH_TIMEOUT}ms — likely ` +
        `a backend index lag or a caching issue.`
    );
  }

  /**
   * Type the email into ag-grid's "Primary Email Address / Name"
   * column header filter input. ag-grid applies its filter model
   * synchronously after the input changes, so a short delay is
   * enough to let the rendered window settle on the matching rows.
   *
   * The filter input is standard `<input>` inside ag-grid's column
   * header, wired via ag-grid's own event handlers (not React
   * controlled). Playwright `Locator.fill()` works here — the
   * React native-setter trick is not needed.
   */
  private async filterGridByEmail(email: string): Promise<void> {
    const filter = this.page.getByRole('textbox', {
      name: 'Primary Email Address / Name Filter Input',
    });
    await filter.waitFor({ state: 'visible', timeout: DEFAULT_ACTION_TIMEOUT });
    await filter.fill(email);
    // Give ag-grid a frame or two to re-render the row window.
    await this.page.waitForTimeout(500);
  }

  /**
   * Locator for the top-level ag-grid data row whose first cell
   * text matches the given email. Scoped to `[role="rowgroup"]`
   * children to exclude the filter row (which sits in a separate
   * rowgroup and ALSO contains the email text because the column
   * filter input holds it). In firm-1 tree mode this is the
   * collapsed group row with tree children; in flat mode it's
   * the user's own row.
   */
  private groupRowForEmail(email: string): Locator {
    // `.ag-row` is the class ag-grid assigns to every actual data
    // row — filter/header rows do NOT carry this class. Combined
    // with `hasText` this gives us the target data row
    // unambiguously, even when the column filter also contains
    // the email string.
    return this.page.locator('.ag-row').filter({ hasText: email }).first();
  }

  /**
   * Click the tree expand icon on the target row if it is
   * collapsed. No-op when the row is already expanded (or when
   * the grid is flat and the row has no expand icon).
   *
   * Waits for `.ag-icon-tree-closed` to flip to
   * `.ag-icon-tree-open` — ag-grid's synchronous visual
   * confirmation that the expand click was registered. We do
   * not try to wait for child rows here because the two tree
   * shapes we see in practice — "multi-child auto-linked group"
   * and "solo firm-1 user with no cross-firm match" — have
   * opposite child signals (new row vs. no new row). Callers
   * that need to assert on a child cell (e.g. Delink visible)
   * should pass an explicit `{ timeout }` to their web-first
   * assertion to absorb cold-start render lag.
   */
  private async expandGroupForEmail(email: string): Promise<void> {
    const row = this.groupRowForEmail(email);
    await row.waitFor({ state: 'visible', timeout: DEFAULT_ACTION_TIMEOUT });

    const expandIcon = row.locator('.ag-icon-tree-closed');
    if (!(await expandIcon.count())) return;
    if (!(await expandIcon.isVisible().catch(() => false))) return;

    await expandIcon.click();
    await row
      .locator('.ag-icon-tree-open')
      .waitFor({ state: 'visible', timeout: DEFAULT_ACTION_TIMEOUT });
  }

  /**
   * Wait until either the first data row or the ag-grid empty
   * overlay is visible. Whichever wins, the search has completed.
   */
  private async waitForGridSettled(): Promise<void> {
    const firstRow = this.page.locator('.ag-row').first();
    const emptyOverlay = this.page.locator('.ag-overlay-no-rows-center').first();
    await Promise.race([
      firstRow.waitFor({ state: 'visible', timeout: DEFAULT_SEARCH_TIMEOUT }),
      emptyOverlay.waitFor({ state: 'visible', timeout: DEFAULT_SEARCH_TIMEOUT }),
    ]);
  }

  /** True if the grid currently shows at least one data row. */
  async hasResults(): Promise<boolean> {
    const firstRow = this.page.locator('.ag-row').first();
    return firstRow.isVisible().catch(() => false);
  }

  // ────────────────────────────────────────────────────────────────
  // Link / Delink actions
  // ────────────────────────────────────────────────────────────────

  /**
   * Scope to the expanded group's children. Uses the tracked
   * `currentEmail` so the scope matches the row that
   * `searchByEmail` expanded.
   */
  private expandedGroupScope(): Locator {
    if (!this.currentEmail) {
      throw new Error(
        'UserManagementPage: no current email — call searchByEmail(...) before asserting Link/Delink state.'
      );
    }
    // The expanded group is the row with the email in its text;
    // children are subsequent rows with increased tree level.
    // We pick the first-row-after the group row by its position.
    // For action assertions it's enough to scope to "the ag-grid
    // area that just got expanded" — we use the group row's
    // parent rowgroup container so any Link/Delink text inside
    // the group's subtree is caught.
    return this.groupRowForEmail(this.currentEmail).locator('xpath=..');
  }

  /**
   * Locator for the Link action inside the currently expanded
   * email group. Use this in tests to assert "this user is not
   * linked" via `await expect(userMgmt.linkAction()).toBeVisible()`.
   *
   * Matches by exact visible text because the User Management
   * grid renders the Link/Delink cell as a clickable `<div>`
   * with no `role="link"` — `getByRole('link')` would miss it.
   */
  linkAction(): Locator {
    return this.expandedGroupScope().getByText('Link', { exact: true }).first();
  }

  /**
   * Locator for the Delink action inside the currently expanded
   * email group. Use this in tests to assert "this user is
   * linked" via `await expect(userMgmt.delinkAction()).toBeVisible()`.
   *
   * Matches by exact visible text (see `linkAction` for why).
   */
  delinkAction(): Locator {
    return this.expandedGroupScope().getByText('Delink', { exact: true }).first();
  }

  /**
   * Click Link on a child of the current email group and confirm.
   * The Submit button dismisses the confirmation modal.
   */
  async linkUser(): Promise<void> {
    const action = this.linkAction();
    await action.waitFor({ state: 'visible', timeout: DEFAULT_ACTION_TIMEOUT });
    await action.click();
    await this.page.getByRole('button', { name: 'Submit' }).click();
  }

  /**
   * Click Delink on a child of the current email group and
   * confirm via the Submit button on the confirmation modal.
   */
  async delinkUser(): Promise<void> {
    const action = this.delinkAction();
    await action.waitFor({ state: 'visible', timeout: DEFAULT_ACTION_TIMEOUT });
    await action.click();
    await this.page.getByRole('button', { name: 'Submit' }).click();
  }
}
