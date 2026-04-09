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
import type { Page, BrowserContext } from '@playwright/test';
import { selectEnvironment } from '../config/environments';
import { PLIMSOLL_FP_ADMIN, PLIMSOLL_FP_TYLER } from '../data/constants/users';
import { authFixtures } from './auth.fixture';
import { apiFixtures } from './api.fixture';
import { workerFirmFixtures } from './workerFirm.fixture';
import { STORAGE_STATE_PATH } from './globalSetup';
import { loginViaForm } from './loginViaForm';

// Compose upstream fixtures so this file can consume `workerFirm`
// (worker-scoped) without re-declaring it. The intermediate merges
// here mirror the pattern used by api.fixture.ts and
// workerFirm.fixture.ts; the top-level base.ts merge composes the
// final shape that specs see.
const baseWithWorkerFirm = mergeTests(base, authFixtures, apiFixtures, workerFirmFixtures);

export type PageFixtures = {
  /**
   * Page logged in as the auto-generated admin of the per-worker
   * dummy firm. Phase 1 of the C25193 hybrid isolation pattern.
   * Each test gets its own context — no leakage across tests in the
   * same worker.
   */
  workerFirmAdminPage: Page;

  /**
   * Page logged in as `tyler@plimsollfp.com` on the static firm 106.
   * Phase 2 of the C25193 hybrid isolation pattern. Used for the
   * read-only Edit-button-hidden assertion. **Cannot be substituted
   * by a worker-firm advisor** — see PLIMSOLL_FP_TYLER docstring.
   */
  tylerPage: Page;

  /**
   * Page logged in as `tim106` (firm 106 GW Admin). Used by sibling
   * specs in the account-billing family that mutate firm 106
   * directly (e.g. C25200). C25193 itself does NOT use this fixture;
   * it lands now alongside its siblings to keep the per-role layer
   * complete in one commit.
   */
  tim106Page: Page;
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
  browser: import('@playwright/test').Browser,
  username: string,
  password: string
): Promise<{ page: Page; context: BrowserContext }> {
  const env = selectEnvironment();
  const context = await browser.newContext({
    baseURL: env.baseUrl,
    ignoreHTTPSErrors: true,
    // Seed from the workspace tim1.json — carries the SPA's
    // localStorage bootstrap state. Cookies are dropped immediately
    // below.
    storageState: STORAGE_STATE_PATH,
  });
  await context.clearCookies();
  const page = await context.newPage();
  await loginViaForm(page, username, password, env.baseUrl);
  return { page, context };
}

export const pageFixtures = baseWithWorkerFirm.extend<PageFixtures>({
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
});
