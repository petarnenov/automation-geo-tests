/**
 * Per-role test-scoped page fixtures.
 *
 * Phase 2 step 4 (D-37). Per Section 4.5 of the proposal:
 *
 *   Worker scope: workerFirm, apiClient.
 *   Test scope:   authenticatedPage (per role), testFirm.
 *
 * This file owns the **test-scoped** half of the chain — fixtures that
 * yield a `Page` already logged in as a specific role. Each fixture
 * launches its own context from Playwright's worker-scoped `browser`
 * fixture, drives the resilient login flow, yields the page, and
 * disposes the context at test teardown. Each test gets a clean
 * cookie jar and a clean storage — no identity bleed between tests
 * or between fixtures within the same test.
 *
 * The roles wired up in this commit are exactly the ones C25193 needs
 * (Phase 2 step 7 graduation):
 *
 *   - workerFirmAdminPage : the auto-generated admin of the
 *                           per-worker dummy firm. Replaces the legacy
 *                           POC's loginAsWorkerFirmAdmin().
 *   - tylerPage           : tyler@plimsollfp.com on the static firm
 *                           106. Replaces loginAsNonAdmin().
 *   - tim106Page          : the firm 106 GW Admin (tim106). Used by
 *                           sibling specs in the C25193..C25249
 *                           family that mutate firm 106 directly
 *                           (e.g. C25200's "55 BPS" billing spec
 *                           seed). Replaces loginAsAdmin().
 *
 * Future fixtures (gwAdminPage, firmAdminPage, advisorPage, clientPage)
 * land in their own commits as new specs need them. The Section 4.10.5
 * role matrix is the long-term shape; today's three are the C25193
 * subset.
 *
 * **Why a fresh context per fixture instead of identity-switching on
 * the default `page`:** the legacy POC's hybrid pattern uses a single
 * page and clears cookies between Phase 1 and Phase 2. That works but
 * couples the two phases — any state that survives a cookie clear
 * (localStorage, in-memory React state, the page's URL itself) bleeds
 * across. Fresh contexts give each phase a fully clean slate, and
 * Playwright's parallelism/cleanup model handles the per-test
 * disposal automatically.
 */

import { test as base, mergeTests } from '@playwright/test';
import type { Browser, Page, BrowserContext } from '@playwright/test';
import { selectEnvironment, type EnvironmentConfig } from '../config/environments';
import { PLIMSOLL_FP_ADMIN, PLIMSOLL_FP_TYLER } from '../data/constants/users';
import { authFixtures } from './auth.fixture';
import { apiFixtures } from './api.fixture';
import {
  workerFirmFixtures,
  stampPageFirm,
  type WorkerFirm,
} from './workerFirm.fixture';
import type { FirmManifestLogin } from './firmManifest';
import { STORAGE_STATE_PATH } from './globalSetup';
import { loginViaForm } from './loginViaForm';

// Compose upstream fixtures so this file can consume `firmPool`
// (worker-scoped) without re-declaring it. Per-worker firm pinning
// means `firmPool` is a single-element array — every per-role page
// fixture resolves to the same firm, guaranteeing co-location.
// the top-level base.ts merge composes the final shape that specs see.
const baseWithPool = mergeTests(base, authFixtures, apiFixtures, workerFirmFixtures);

export type PageFixtures = {
  // ────────────────────────────────────────────────────────────────
  // Pool-based per-role pages (Commit 3 of the extended-firm migration).
  // These fixtures load the storage state that globalSetup captured
  // for each role at startup — there is **no form login** in the
  // test path. Every fixture consumes `testFirm`, which checks out a
  // firm from the pool, so all pool-based fixtures in a single test
  // resolve to the same firm (Playwright caches fixture values per
  // test).
  // ────────────────────────────────────────────────────────────────

  /** Page logged in as `admin_<firmCd>` (firm admin of the
   *  checked-out dummy firm). Replaces the legacy form-login-based
   *  `workerFirmAdminPage` — loads storage state directly. */
  firmAdminPage: Page;

  /** Page logged in as `tim<firmCd>` — per-firm tim variant. */
  firmTimPage: Page;

  /** Page logged in as `u<firmCd>_gwadmin` — GW Admin scoped to the
   *  checked-out dummy firm. Use this for GW-Admin-only flows (e.g.
   *  User Management, Platform One admin operations) that should run
   *  on an isolated dummy firm instead of a shared static firm. */
  firmGwAdminPage: Page;

  /** Page logged in as `u<firmCd>_nongwadmin` — non-GW-Admin scoped
   *  to the checked-out dummy firm. Use this to verify read-only or
   *  restricted-permission views (e.g. the Edit-button-hidden check
   *  that legacy specs drove through `tylerPage` on firm 106). */
  firmNonGwAdminPage: Page;

  /** Page logged in as `adv_<firmCd>_1` — the first advisor of the
   *  checked-out dummy firm. Advisors 2 and 3 are exposed via
   *  `firmAdvisorPage2` / `firmAdvisorPage3`. */
  firmAdvisorPage1: Page;

  /** Page logged in as `adv_<firmCd>_2`. */
  firmAdvisorPage2: Page;

  /** Page logged in as `adv_<firmCd>_3`. */
  firmAdvisorPage3: Page;

  // ────────────────────────────────────────────────────────────────
  // Legacy form-login-based fixtures.
  //
  // These kept the original behaviour from Phase 2 so the in-flight
  // C25193-family specs keep running while the account-billing
  // migration to pool-based fixtures happens in a follow-up. Every
  // real-impl spec that currently consumes one of these three will
  // switch to a pool fixture (`firmAdminPage`, `firmNonGwAdminPage`,
  // `firmGwAdminPage`) one spec at a time. Once none remain, the
  // fixtures — and the `buildRolePage` helper — are deleted and the
  // PLIMSOLL_FP_* constants can be dropped.
  // ────────────────────────────────────────────────────────────────

  /** @deprecated Use `firmAdminPage` instead. Loads via form login;
   *  kept until every account-billing spec migrates to the pool. */
  workerFirmAdminPage: Page;

  /** @deprecated Use `firmNonGwAdminPage` (on a dummy firm) once the
   *  account-billing specs migrate. Currently tied to the static
   *  firm 106 via `tyler@plimsollfp.com`. */
  tylerPage: Page;

  /** @deprecated Use `firmGwAdminPage` (on a dummy firm) once the
   *  account-billing specs migrate. Currently tied to the static
   *  firm 106 GW Admin `tim106`. */
  tim106Page: Page;

  /** Page logged in as tim1 — cross-firm GW Admin / Platform One.
   *  **Not deprecated** — tim1 is the global Platform One admin,
   *  not tied to any per-firm role, so it stays regardless of the
   *  firm pool migration. */
  tim1Page: Page;
};

/**
 * Build a per-role context+page from the workspace tim1 storage
 * state, drop tim1's cookies, then log in as the target role.
 *
 * Why seed from tim1.json instead of starting empty: the legacy POC
 * runs every account-billing spec on its main page+context, which
 * starts with tim1's storage state from globalSetup. The legacy
 * `loginAsWorkerFirmAdmin` does `context.clearCookies()` then
 * `login(...)` — clearCookies drops cookies but NOT localStorage.
 * The qa SPA stores firm/role bootstrap state in localStorage; a
 * fresh context with empty localStorage hits "You do not have
 * permission to view this Client" on deep URL navigation even
 * with valid cookies.
 *
 * The fix mirrors the legacy state: load tim1.json (which carries
 * its localStorage), drop the cookies, log in fresh. Now the
 * post-login session has admin_<firmCd>'s cookies AND tim1's
 * localStorage bootstrap — which is exactly what the legacy
 * test environment looks like.
 */
async function buildRolePage(
  browser: Browser,
  username: string,
  password: string
): Promise<{ page: Page; context: BrowserContext }> {
  const env = selectEnvironment();
  const isHttp = env.baseUrl.startsWith('http://');
  const context = await browser.newContext({
    baseURL: env.baseUrl,
    ignoreHTTPSErrors: true,
    // Seed from tim1.json for localStorage bootstrap (HTTPS only).
    // Over HTTP the storage state has no localStorage, so skip it.
    ...(isHttp ? {} : { storageState: STORAGE_STATE_PATH }),
  });
  if (!isHttp) {
    await context.clearCookies();
  }
  const page = await context.newPage();
  await loginViaForm(page, username, password, env.baseUrl);
  return { page, context };
}

/**
 * Build a per-role context+page by loading a pre-captured storage
 * state **plus** replaying the captured `sessionStorage` snapshot
 * through an init script. **No form login** — the session was
 * driven through `loginViaForm` during globalSetup, cookies +
 * localStorage were snapshotted via `storageState()`, and
 * sessionStorage was captured separately (Playwright's
 * `storageState()` does not cover it).
 *
 * The qa SPA puts post-login bootstrap keys (e.g.
 * `gw.whitelabelStaticFolder`) in sessionStorage, so skipping the
 * replay causes the SPA session check to fall back to the login
 * form. `addInitScript` injects the keys before any page script runs.
 */
async function loadRolePageFromStorage(
  browser: Browser,
  env: EnvironmentConfig,
  storageStatePath: string
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    baseURL: env.baseUrl,
    ignoreHTTPSErrors: true,
    storageState: storageStatePath,
  });
  const page = await context.newPage();
  return { page, context };
}

/**
 * Per-role fixture body shared by all 7 role fixtures. Picks the
 * worker's pinned firm from `firmPool[0]`, loads the matching stored
 * state, stamps the firm onto the page via the side-channel map, and
 * yields the page. No checkout/release — co-location and isolation
 * are guaranteed by per-worker firm pinning in `firmPool`.
 */
async function providePoolRolePage(
  browser: Browser,
  firmPool: WorkerFirm[],
  pickLogin: (firm: WorkerFirm) => FirmManifestLogin,
  use: (page: Page) => Promise<void>
): Promise<void> {
  const env = selectEnvironment();
  const firm = firmPool[0];
  const login = pickLogin(firm);
  const { page, context } = await loadRolePageFromStorage(browser, env, login.storageState);
  stampPageFirm(page, firm);
  try {
    await use(page);
  } finally {
    await context.close();
  }
}

export const pageFixtures = baseWithPool.extend<PageFixtures>({
  // ──────────────────────────────────────────────────────────────────
  // Pool-based per-role fixtures (no form login in test path).
  // Per-worker firm pinning means every one of these resolves to the
  // worker's single firm — tests get automatic co-location across
  // role fixtures. Consumers that need the firm call
  // `getFirmForPage(page)`.
  // ──────────────────────────────────────────────────────────────────
  firmAdminPage: async ({ browser, firmPool }, use) => {
    await providePoolRolePage(browser, firmPool, (f) => f.logins.admin, use);
  },

  firmTimPage: async ({ browser, firmPool }, use) => {
    await providePoolRolePage(browser, firmPool, (f) => f.logins.tim, use);
  },

  firmGwAdminPage: async ({ browser, firmPool }, use) => {
    await providePoolRolePage(browser, firmPool, (f) => f.logins.gwAdmin, use);
  },

  firmNonGwAdminPage: async ({ browser, firmPool }, use) => {
    await providePoolRolePage(browser, firmPool, (f) => f.logins.nonGwAdmin, use);
  },

  firmAdvisorPage1: async ({ browser, firmPool }, use) => {
    await providePoolRolePage(browser, firmPool, (f) => f.logins.advisors[0], use);
  },

  firmAdvisorPage2: async ({ browser, firmPool }, use) => {
    await providePoolRolePage(browser, firmPool, (f) => f.logins.advisors[1], use);
  },

  firmAdvisorPage3: async ({ browser, firmPool }, use) => {
    await providePoolRolePage(browser, firmPool, (f) => f.logins.advisors[2], use);
  },

  // ──────────────────────────────────────────────────────────────────
  // Legacy form-login fixtures (deprecated — see PageFixtures docstring)
  // ──────────────────────────────────────────────────────────────────
  workerFirmAdminPage: async ({ browser, workerFirm }, use) => {
    const { page, context } = await buildRolePage(
      browser,
      workerFirm.admin.loginName,
      workerFirm.password
    );
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },

  tylerPage: async ({ browser }, use) => {
    const password = process.env.TIM1_PASSWORD;
    if (!password) {
      throw new Error(
        'tylerPage: TIM1_PASSWORD must be set in workspace .env.local. ' +
          'All qa users (tim1, tim106, tyler, dummy firm users) share the same password.'
      );
    }
    const { page, context } = await buildRolePage(browser, PLIMSOLL_FP_TYLER.username, password);
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },

  tim106Page: async ({ browser }, use) => {
    const password = process.env.TIM1_PASSWORD;
    if (!password) {
      throw new Error('tim106Page: TIM1_PASSWORD must be set in workspace .env.local.');
    }
    const { page, context } = await buildRolePage(browser, PLIMSOLL_FP_ADMIN.username, password);
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },

  tim1Page: async ({ browser }, use) => {
    const username = process.env.TIM1_USERNAME;
    const password = process.env.TIM1_PASSWORD;
    if (!username || !password) {
      throw new Error('tim1Page: TIM1_USERNAME and TIM1_PASSWORD must be set.');
    }
    const { page, context } = await buildRolePage(browser, username, password);
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});
