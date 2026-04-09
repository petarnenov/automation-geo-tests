/**
 * Static user identities used by the framework's tests and Page
 * Objects. Phase 2 step 2 (D-37).
 *
 * These are credentials *names* and role identifiers — never
 * passwords. Passwords come from `process.env.TIM1_PASSWORD` (the
 * legacy POC's "shared password" convention: tim1, tim106, every
 * tim<N> firm advisor, and tyler all share the same password) via
 * the framework's `dotenv-loader`.
 *
 * Do not import these from spec files directly — go through the
 * fixture (`auth.fixture.ts::tim1Page`, `tylerPage`, etc.) so the
 * tests stay decoupled from credential plumbing.
 */

/**
 * The Plimsoll FP firm 106 Platform One admin user. Has full GW
 * Admin permissions. Used by the legacy POC's `loginAsAdmin` and
 * by the framework's `tim106Page` fixture (when it lands in
 * Phase 2 step 4).
 *
 * Note: tim106 is firm-106-scoped; tim1 is the *cross-firm* GW
 * Admin used for `/qa/*` calls and storage state. They are NOT
 * interchangeable. The framework's `auth.fixture` uses tim1 for
 * the API client + globalSetup; tests that need a firm-106-scoped
 * admin (most of the `account-billing` family) ask for tim106
 * explicitly.
 */
export const PLIMSOLL_FP_ADMIN = {
  username: 'tim106',
  /**
   * tim106 lands on either `#dashboard` or `#platformOne` depending
   * on the qa branch. The auth fixture's post-login wait must accept
   * both — the legacy POC uses regex `/#(dashboard|platformOne)/`.
   */
  postLoginHashRoute: /#(dashboard|platformOne)/,
} as const;

/**
 * Plimsoll FP non-admin advisor with a *restricted custom role* —
 * specifically, no Edit Billing Settings permission. Used by Phase 2
 * of the C25193..C25201 family to assert "non-admin cannot edit
 * billing".
 *
 * Critical quirk (verified empirically 2026-04-09 and recorded in
 * `feedback_account_billing_isolation` memory): the dummy-firm
 * advisor `adv_<firmCd>_1` from `/qa/createDummyFirm.do` is **NOT**
 * a drop-in for tyler. Dummy-firm advisors have full billing edit
 * rights; tyler has the Plimsoll-FP-specific restricted custom
 * role. `createDummyFirm.do` cannot provision restricted roles, so
 * the tyler check has to live on the static firm 106 — it cannot be
 * substituted by a worker firm. This is the reason the C25193 spec
 * uses the *hybrid* isolation pattern (Phase 1 worker firm, Phase 2
 * static firm 106).
 */
export const PLIMSOLL_FP_TYLER = {
  username: 'tyler@plimsollfp.com',
  /**
   * tyler always lands on `#dashboard` — never `#platformOne` (he
   * has no Platform One admin role).
   */
  postLoginHashRoute: /#dashboard/,
} as const;

/**
 * The cross-firm GW Admin used for `/qa/*` calls and the framework's
 * shared `tim1.json` storage state (D-41). Lives in env vars so the
 * username can rotate without a code change.
 *
 * Resolved at fixture-construction time, not at module load: the
 * env var may not be present in non-Playwright contexts (unit tests,
 * the scaffold script, etc.).
 */
export const TIM1_ENV_VAR = {
  username: 'TIM1_USERNAME',
  password: 'TIM1_PASSWORD',
} as const;
