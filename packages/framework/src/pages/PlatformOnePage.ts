/**
 * `PlatformOnePage` — Page Object for Platform One sub-page navigation.
 *
 * Direct-URL navigation via `#platformOne/...` hash routes. Sidebar
 * traversal is brittle against SPA re-renders and accordion state —
 * hash navigation is not.
 *
 * ## Design
 *
 * The POM is organised around a typed `PlatformOneSection` discriminated
 * union: every callable section is listed there with its parameters and
 * the hash path + DOM ready signal live alongside in one place. Adding
 * a new section means extending the union once, not writing a new
 * method family.
 *
 * Two levels of API:
 *
 *   - `goTo(section)` — the generic navigation primitive. Accepts any
 *     `PlatformOneSection` and handles the full transition: neutral
 *     hash transition, goto, permission-deny detection, retry-with-
 *     reload on transient failure, section-specific ready signal.
 *
 *   - `goTo<Xxx>(...)` convenience methods — thin wrappers over
 *     `goTo(...)` with IDE-friendly names for the most common flows.
 *     Use these in specs; they read better than the generic form.
 *
 * ## Defensive wiring
 *
 *   1. **Gate detection.** `App.js` (GEO-21029) redirects any
 *      non-GW-Admin user away from `/platformOne/*` to `/dashboard`.
 *      After `goto`, we verify the URL is still on Platform One and
 *      throw a clear error when it isn't — pointing at the real cause
 *      (missing `gwAdminFlag`) instead of the 30-second DOM waiter
 *      timeout that would otherwise fire.
 *
 *   2. **Stale-hash fix.** `page.goto()` with a URL identical to the
 *      current one is a no-op — React Router doesn't re-render. Before
 *      every goto we detect the same-hash case and transition through
 *      a neutral throwaway hash so the target goto always produces a
 *      real route change.
 *
 *   3. **Retry with reload.** On transient failures (React state
 *      stuck, XHR in flight) we retry once with `page.reload()`
 *      between attempts. Permission-deny failures are NOT retried —
 *      reloading with the same user would fail the same way.
 *
 *   4. **Classified errors.** The three failure modes —
 *      permission-deny, route-wrong, DOM-timeout — get three
 *      distinct error messages so callers don't chase phantom flakes.
 */

import { expect, type Page, type Locator } from '@playwright/test';

const READY_TIMEOUT = 30_000;
const GATE_CHECK_TIMEOUT = 5_000;
const NEUTRAL_HASH = '__platform_one_transition__';

/**
 * Discriminated union of every Platform One section the POM knows
 * how to navigate to. Extend this to add a new section — `sectionPath`
 * and `sectionReadyLocator` below will force you to wire the hash and
 * ready signal at compile time.
 */
export type PlatformOneSection =
  | { name: 'home' }
  | { name: 'users'; firmCd: number }
  | { name: 'usersFirmPicker' }
  | { name: 'userManagement' }
  | { name: 'advisorGroups' }
  | { name: 'accountOpening' }
  | { name: 'customFields'; firmCd?: number }
  | { name: 'tradingCenter' }
  | { name: 'backOffice' }
  | { name: 'billingCenter' }
  | { name: 'billingBucketExclusions' }
  | { name: 'unmanagedAssetsExclusions' }
  | { name: 'reportingCenterHome' }
  | { name: 'businessIntelligence' }
  | { name: 'masterAccounts' }
  /**
   * Escape hatch for sections not yet enumerated above. `hash` is the
   * route path without the leading `#`, e.g. `platformOne/systemAdmin/x`.
   * `readySelector` is a Playwright selector that resolves to a
   * visible element on the target page; `readyName` is an optional
   * accessible name if the selector is role-based.
   *
   * Prefer extending the union above; the escape hatch is a temporary
   * workaround for one-off specs.
   */
  | { name: 'custom'; hash: string; readySelector: string };

export class PlatformOnePage {
  constructor(private readonly page: Page) {}

  // ────────────────────────────────────────────────────────────────
  // Generic navigation primitive
  // ────────────────────────────────────────────────────────────────

  /**
   * Navigate to any Platform One section via hash routing.
   *
   * Performs the full defensive sequence:
   *   1. Neutral-hash transition (stale-goto protection).
   *   2. `page.goto` to the target.
   *   3. Permission-deny detection via URL check.
   *   4. Section-specific DOM ready signal.
   *   5. On transient failure, retry once with `page.reload()`.
   */
  async goTo(section: PlatformOneSection): Promise<void> {
    const hash = this.sectionPath(section);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt === 1) {
          // Retry: force a fresh page state. Avoids React router
          // getting stuck when a prior navigation half-completed.
          await this.page.reload({ waitUntil: 'domcontentloaded' });
        }
        await this.transitionToHash(hash);
        await this.assertNotRedirected(hash);
        await this.assertSectionReady(section, hash);
        return;
      } catch (e) {
        lastError = e as Error;
        // Permission-deny is not retryable — reloading as the same
        // user would fail identically. Fail fast.
        if (lastError.message.startsWith('PlatformOnePage: permission-deny')) {
          throw lastError;
        }
      }
    }
    throw lastError ?? new Error('PlatformOnePage.goTo: unknown failure');
  }

  // ────────────────────────────────────────────────────────────────
  // Convenience methods — common flows with named signatures
  // ────────────────────────────────────────────────────────────────

  /** Navigate to the Platform One home dashboard. */
  async goHome(): Promise<void> {
    return this.goTo({ name: 'home' });
  }

  /**
   * Navigate directly to Firm Admin → Users for a specific firm.
   * Lands on the user list without going through the typeahead.
   */
  async goToUsersForFirm(firmCd: number): Promise<void> {
    return this.goTo({ name: 'users', firmCd });
  }

  /**
   * Navigate to Firm Admin → Users firm picker (no firm selected).
   * Caller still needs to select a firm via the typeahead.
   */
  async goToUsersFirmPicker(): Promise<void> {
    return this.goTo({ name: 'usersFirmPicker' });
  }

  /**
   * Navigate to Firm Admin → User Management.
   *
   * This route is wrapped in `GeowealthP1Route` on the backend (firm 1
   * only); callers logged in as any other firm will be bounced to
   * `/dashboard` by the App.js guard, and `goTo` will throw a
   * `permission-deny` error.
   */
  async goToUserManagement(): Promise<void> {
    return this.goTo({ name: 'userManagement' });
  }

  // ────────────────────────────────────────────────────────────────
  // Private: section ↔ hash mapping
  // ────────────────────────────────────────────────────────────────

  private sectionPath(section: PlatformOneSection): string {
    switch (section.name) {
      case 'home':
        return 'platformOne';
      case 'users':
        return `platformOne/firmAdmin/users/${section.firmCd}`;
      case 'usersFirmPicker':
        return 'platformOne/firmAdmin/users';
      case 'userManagement':
        return 'platformOne/firmAdmin/userManagement';
      case 'advisorGroups':
        return 'platformOne/firmAdmin/advisorGroups';
      case 'accountOpening':
        return 'platformOne/systemAdmin/accountOpening';
      case 'customFields':
        return section.firmCd
          ? `platformOne/systemAdmin/customFields/${section.firmCd}`
          : 'platformOne/systemAdmin/customFields';
      case 'tradingCenter':
        return 'platformOne/operations/tradingCenter';
      case 'backOffice':
        return 'platformOne/operations/backOffice';
      case 'billingCenter':
        return 'platformOne/operations/billingCenter';
      case 'billingBucketExclusions':
        return 'platformOne/operations/billingBucketExclusions';
      case 'unmanagedAssetsExclusions':
        return 'platformOne/operations/unmanagedAssetsExclusions';
      case 'reportingCenterHome':
        return 'platformOne/reportingCenter/home';
      case 'businessIntelligence':
        return 'platformOne/businessIntelligence';
      case 'masterAccounts':
        return 'platformOne/systemAdmin/masterAccounts';
      case 'custom':
        return section.hash;
    }
  }

  /**
   * Section-specific ready signal. The returned locator is a DOM
   * element whose visibility proves the target page has mounted, not
   * just that the URL changed.
   */
  private sectionReadyLocator(section: PlatformOneSection): Locator {
    switch (section.name) {
      case 'home':
        // The home dashboard has no single stable landmark; use the
        // top-level Platform One chrome.
        return this.page.locator('[data-role="platformOneHome"]').first();
      case 'users':
        return this.page.getByRole('button', { name: 'Create New User' });
      case 'usersFirmPicker':
        return this.page.locator('#selectFirm_typeAhead');
      case 'userManagement':
        return this.page.locator('#firmCd_typeAhead');
      case 'advisorGroups':
        return this.page.getByRole('heading', { name: /advisor groups/i });
      case 'accountOpening':
        return this.page.getByRole('heading', { name: /account opening/i });
      case 'customFields':
        return this.page.getByRole('heading', { name: /custom fields/i });
      case 'tradingCenter':
        return this.page.getByRole('heading', { name: /trading center/i });
      case 'backOffice':
        return this.page.getByRole('heading', { name: /back office/i });
      case 'billingCenter':
        return this.page.getByRole('heading', { name: /billing center/i });
      case 'billingBucketExclusions':
        return this.page.getByRole('heading', { name: /bucket exclusions/i });
      case 'unmanagedAssetsExclusions':
        return this.page.getByRole('heading', { name: /unmanaged assets/i });
      case 'reportingCenterHome':
        return this.page.getByRole('heading', { name: /reporting center/i });
      case 'businessIntelligence':
        return this.page.getByRole('heading', { name: /business intelligence/i });
      case 'masterAccounts':
        return this.page.getByRole('heading', { name: /master accounts/i });
      case 'custom':
        return this.page.locator(section.readySelector).first();
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Private: navigation primitives + guards
  // ────────────────────────────────────────────────────────────────

  /**
   * Hash-goto helper. Transitions through a throwaway hash first if
   * the page is already on the target — otherwise `page.goto()` is a
   * no-op and React Router does not re-render.
   */
  private async transitionToHash(hash: string): Promise<void> {
    const target = `/react/indexReact.do#${hash}`;
    if (this.page.url().includes(`#${hash}`)) {
      await this.page.evaluate((neutral) => {
        globalThis.location.hash = `#${neutral}`;
      }, NEUTRAL_HASH);
    }
    await this.page.goto(target);
  }

  /**
   * Check whether App.js bounced us off Platform One after the goto.
   * GEO-21029: non-GW-Admin users get force-redirected to /dashboard.
   * Catching this at the URL level turns a silent 30-second DOM
   * timeout into an immediate, actionable error.
   */
  private async assertNotRedirected(requestedHash: string): Promise<void> {
    // Give React Router a brief window to settle before reading URL.
    await this.page
      .waitForFunction(
        (hash) =>
          globalThis.location.hash.length > 1 ||
          globalThis.location.pathname.includes('dashboard'),
        requestedHash,
        { timeout: GATE_CHECK_TIMEOUT }
      )
      .catch(() => {
        /* non-fatal — some routes settle without any hash */
      });

    const url = this.page.url();
    const onPlatformOne = url.includes('#platformOne') || url.includes(`#${requestedHash}`);
    const onDashboard = url.includes('#dashboard') || url.endsWith('/dashboard');

    if (!onPlatformOne) {
      if (onDashboard) {
        throw new Error(
          `PlatformOnePage: permission-deny navigating to "#${requestedHash}" — ` +
            `App.js (GEO-21029) redirected to /dashboard. The logged-in user ` +
            `lacks gwAdminFlag. Use tim1Page, or a pool fixture whose user is ` +
            `a GW Admin (firmGwAdminPage works for routes not wrapped in ` +
            `GeowealthP1Route; firm-1-only sub-routes like userManagement ` +
            `still require tim1Page).`
        );
      }
      throw new Error(
        `PlatformOnePage: route-wrong — navigation to "#${requestedHash}" ` +
          `ended on ${url}. Expected URL to contain "#platformOne" or the ` +
          `target hash. Likely causes: malformed section path, backend 5xx ` +
          `response, or a redirect from a different part of the app.`
      );
    }
  }

  /**
   * Wait for the section-specific DOM ready signal. If the signal
   * does not appear within the timeout, wrap the Playwright error
   * with context about what section we were waiting for and what the
   * URL looked like at failure time — so callers don't have to
   * cross-reference a bare "locator not visible" message back to the
   * POM method that issued it.
   */
  private async assertSectionReady(
    section: PlatformOneSection,
    requestedHash: string
  ): Promise<void> {
    const locator = this.sectionReadyLocator(section);
    try {
      await expect(locator).toBeVisible({ timeout: READY_TIMEOUT });
    } catch (e) {
      const url = this.page.url();
      throw new Error(
        `PlatformOnePage: dom-timeout waiting for section "${section.name}" ` +
          `ready signal (${requestedHash}). Current URL: ${url}. The route ` +
          `guard passed (we are on Platform One) but the section's landmark ` +
          `element never appeared — likely a backend 5xx, a slow XHR, or a ` +
          `missing permission inside the section itself.`,
        { cause: e }
      );
    }
  }
}
