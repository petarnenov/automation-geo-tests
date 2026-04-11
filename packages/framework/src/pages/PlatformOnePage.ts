/**
 * `PlatformOnePage` — Page Object for Platform One sub-page navigation.
 *
 * Direct-URL navigation (via the `#platformOne/...` hash route) to each
 * sub-page instead of sidebar clicks. Sidebar traversal is brittle
 * against SPA re-renders and accordion state — hash navigation is not.
 *
 * Defensive wiring:
 *
 *   - **Gate detection.** App.js redirects any non-GW-Admin user away
 *     from `/platformOne/*` back to `/dashboard` (GEO-21029). If we
 *     land on `/dashboard` after a `goto`, throw a clear error
 *     instead of letting the DOM waiter time out after 30 s.
 *
 *   - **Stale hash.** `page.goto()` with an identical URL is a no-op
 *     in Playwright — React Router doesn't re-render and the caller
 *     sees stale page content. We always transition through a neutral
 *     URL (`/react/indexReact.do` without a hash) before setting the
 *     target hash, so every call produces a real route change.
 *
 * API note: `goToUsers` is split into `goToUsersForFirm(firmCd)` and
 * `goToUsersFirmPicker()` because the optional-`firmCd` overload hid
 * the contract from callers. The two flows have different ready
 * signals and should not share a method signature.
 */

import { expect, type Page } from '@playwright/test';

const READY_TIMEOUT = 30_000;

export class PlatformOnePage {
  constructor(private readonly page: Page) {}

  /**
   * Navigate directly to Firm Admin → Users for a specific firm.
   * Lands on the user list for `firmCd` without going through the
   * firm typeahead picker.
   */
  async goToUsersForFirm(firmCd: number): Promise<void> {
    await this.navigateToHash(`platformOne/firmAdmin/users/${firmCd}`);
    await expect(this.page.getByRole('button', { name: 'Create New User' })).toBeVisible({
      timeout: READY_TIMEOUT,
    });
  }

  /**
   * Navigate to Firm Admin → Users firm picker (no firm selected).
   * Lands on the typeahead where the caller still needs to select a
   * firm before any action.
   */
  async goToUsersFirmPicker(): Promise<void> {
    await this.navigateToHash('platformOne/firmAdmin/users');
    await expect(this.page.locator('#selectFirm_typeAhead')).toBeVisible({
      timeout: READY_TIMEOUT,
    });
  }

  /**
   * Navigate directly to Firm Admin → User Management and wait for
   * the firm typeahead to appear. User Management is wrapped in a
   * `GeowealthP1Route` (firm 1 only) on the backend; callers that
   * are not logged in as a firm-1 user will get redirected and this
   * method will throw via `assertStillOnPlatformOne()`.
   */
  async goToUserManagement(): Promise<void> {
    await this.navigateToHash('platformOne/firmAdmin/userManagement');
    await expect(this.page.locator('#firmCd_typeAhead')).toBeVisible({
      timeout: READY_TIMEOUT,
    });
  }

  /**
   * Shared hash-navigation helper. Three jobs:
   *
   *   1. Transition through a neutral URL so `goto()` never no-ops
   *      on an identical hash (see stale-hash note above).
   *   2. Drive `goto()` to the target path+hash.
   *   3. Assert we are still on `/platformOne/*` after the React
   *      Router cycle. If App.js bounced us to `/dashboard` because
   *      we lack `gwAdminFlag`, throw with an actionable error.
   */
  private async navigateToHash(hash: string): Promise<void> {
    const target = `/react/indexReact.do#${hash}`;

    // Step 1 — neutral transition to force a route change even if
    // the caller is already on `target`. We use a bogus hash that
    // no route matches; React Router will render nothing for it,
    // but that's fine because we immediately replace it in step 2.
    if (this.page.url().includes(`#${hash}`)) {
      await this.page.evaluate(() => {
        globalThis.location.hash = '#__platform_one_transition__';
      });
    }

    // Step 2 — navigate to the real target.
    await this.page.goto(target);

    // Step 3 — gate detection. App.js (GEO-21029) redirects
    // non-GW-Admin users away from /platformOne/* to /dashboard.
    // Give React Router a short window to react, then check.
    await this.page.waitForFunction(
      () => globalThis.location.hash.length > 1,
      undefined,
      { timeout: 5_000 }
    ).catch(() => {
      /* non-fatal — some routes settle without a hash */
    });
    await this.assertStillOnPlatformOne(hash);
  }

  /**
   * Throw a clear error if the user got bounced off Platform One.
   * Distinguishes "you lack permission" from "DOM selector timed out"
   * so callers don't chase phantom flakes.
   */
  private async assertStillOnPlatformOne(requestedHash: string): Promise<void> {
    const url = this.page.url();
    const stillOnP1 = url.includes('#platformOne') || url.includes(`#${requestedHash}`);
    if (!stillOnP1) {
      throw new Error(
        `PlatformOnePage: navigation to "#${requestedHash}" was rejected — ` +
          `landed on ${url}. The App.js /platformOne guard (GEO-21029) ` +
          `redirects users without gwAdminFlag to /dashboard. Ensure the ` +
          `page's user is a GW Admin (tim1Page, or any pool user whose ` +
          `session carries gwAdminFlag).`
      );
    }
  }
}
