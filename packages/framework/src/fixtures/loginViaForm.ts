/**
 * `loginViaForm` — the framework's canonical SPA login helper.
 *
 * Phase 2 step 4 (D-37). Used by every per-role test-scoped fixture
 * in `auth.fixture.ts` to drive a Page through the login form.
 * Mirrors the resilient DOM-signal race pattern from the legacy POC's
 * `loginPlatformOneAdmin` (packages/legacy-poc/tests/_helpers/qa3.js
 * lines 59-86) and the framework's preflight script (commit d17459d)
 * — there is exactly one login implementation in the framework, and
 * this is it.
 *
 * Why a DOM-signal race instead of `waitForURL`:
 * - On qa2/qa4, the bare `goto('/')` lands at `/react/indexReact.do`
 *   without a hash. The SPA does NOT immediately add `#login` to the
 *   URL bar — it may set the hash only after the bundle boots, or
 *   not at all in some branch states. `waitForURL(/#login/)` then
 *   times out at 30s.
 * - The DOM-signal race asks "is the username field visible OR is
 *   the post-login content visible?" and acts accordingly. It is
 *   environment-agnostic, branch-agnostic, and timing-tolerant.
 *
 * The post-login wait uses the same DOM signal pattern: wait for
 * "Welcome to Platform One" or "Dashboard" text. This works for both
 * tim1/tim106 (lands on Platform One) and tyler/firm advisors (land
 * on Dashboard) per the post-login URL variance documented in
 * feedback_account_billing_isolation memory.
 */

import type { Page, BrowserContext } from '@playwright/test';

/**
 * Log a Page in via the SPA login form. Uses the resilient DOM-signal
 * race; safe to call against qa2, qa3, qa4, qatrd. Idempotent: if a
 * session is already valid (cached cookies), returns immediately.
 *
 * Caller is responsible for clearing cookies first if a *fresh* login
 * is required (test-scoped fixtures do this; the workerFirm-scoped
 * apiClient fixture does not need to because it gets a fresh context
 * from `playwrightRequest.newContext()`).
 *
 * @param page Playwright Page already navigated to the app's root.
 * @param username The login username (tim1, tim106, tyler@plimsoll, admin_<firmCd>, ...).
 * @param password The shared qa password (process.env.TIM1_PASSWORD).
 * @param baseUrl Optional base URL — if provided, the function will
 *   `goto(baseUrl)` itself; otherwise the caller must have already
 *   navigated.
 */
export async function loginViaForm(
  page: Page,
  username: string,
  password: string,
  baseUrl?: string
): Promise<void> {
  if (baseUrl) {
    await page.goto(baseUrl);
  }

  const usernameField = page.getByPlaceholder(/email|username/i);
  const loggedInSignal = page.getByText(/Welcome to Platform One|Dashboard/i);

  await Promise.race([
    usernameField.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    loggedInSignal.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
  ]);

  if (await usernameField.isVisible().catch(() => false)) {
    await usernameField.fill(username);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    // Two-phase post-login wait:
    //
    //   Phase 1 — form disappearance. Fires within ~1s of the
    //   click and proves the submit was accepted by the form.
    //   This is the fast safety check that catches submit failures
    //   (form re-renders with an error message) before they
    //   cascade.
    //
    //   Phase 2 — URL hash transition. Fires when React Router has
    //   booted enough to set the post-login hash route. This is
    //   the signal the SPA uses to populate localStorage with
    //   firm/role bootstrap state. Capturing storageState BEFORE
    //   this wait gives a session with cookies but EMPTY
    //   localStorage, which means subsequent deep-URL navigations
    //   hit "You do not have permission to view this Client".
    //
    // Earlier iterations of this file used only one wait or the
    // other. Form-disappear alone misses the localStorage
    // bootstrap (caught while end-to-end-testing
    // tests-billing-servicing's dashboard spec). URL-hash alone
    // matches false positives on cached layouts and fails for
    // some user/branch combinations where the hash is not added.
    // The combination is the empirically validated path.
    await usernameField.waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForURL(/#(dashboard|platformOne)/, { timeout: 30_000 });
  }
  // Otherwise: a session was already valid — no-op.
}

/**
 * Convenience: clear cookies on the given context, then drive
 * `loginViaForm` against the page. Used by every per-role test-scoped
 * fixture so identity switches are clean (no leakage from a previous
 * session).
 */
export async function clearAndLoginAs(
  page: Page,
  context: BrowserContext,
  username: string,
  password: string,
  baseUrl: string
): Promise<void> {
  await context.clearCookies();
  await loginViaForm(page, username, password, baseUrl);
}
