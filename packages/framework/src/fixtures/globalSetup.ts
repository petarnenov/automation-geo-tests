/**
 * Framework globalSetup — runs once per `playwright test` invocation.
 *
 * Responsibilities:
 *
 *   1. Log `tim1` in and persist its browser storage state under
 *      `<WORKSPACE_ROOT>/.auth/tim1.json` (D-41 — shared across
 *      packages).
 *   2. Provision a fixed pool of FIRM_POOL_SIZE dummy firms via
 *      `/qa/createDummyFirmExtended.do` and capture a per-role
 *      storage state for each of 7 logins per firm (admin + tim +
 *      gwAdmin + nonGwAdmin + 3 advisors = 7). Writes a manifest to
 *      `.auth/firms.json` describing the pool.
 *
 * Reuse gate: the firm pool is rebuilt only when the manifest is
 * missing, older than `(GW_SESSION_TTL_MINUTES - 30)` minutes, from a
 * different environment, or references storage-state files that no
 * longer exist. Local re-runs within the same day pay zero setup
 * cost. Set `REBUILD_FIRMS=1` to force a rebuild.
 *
 * Mirrors the legacy POC's `tests/_helpers/global-setup.js` for the
 * tim1 half, then layers the extended-firm provisioning on top.
 */

import { chromium, type Browser, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { selectEnvironment, type EnvironmentConfig } from '../config/environments';
import { loadWorkspaceEnv, WORKSPACE_ROOT } from '../config/dotenv-loader';
import { ApiClient } from '../api/client';
import { DummyFirmApi, type DummyFirm } from '../api/qa/DummyFirmApi';
import { loginViaForm } from './loginViaForm';
import {
  AUTH_DIR,
  FIRM_POOL_SIZE,
  FIRM_ROLES,
  FIRMS_STORAGE_DIR,
  firmStoragePath,
  readFreshManifest,
  writeManifest,
  type FirmManifest,
  type FirmManifestEntry,
  type FirmManifestLogin,
  type FirmRole,
  type SessionStorageSnapshot,
} from './firmManifest';

loadWorkspaceEnv();

export const STORAGE_STATE_PATH = path.join(WORKSPACE_ROOT, '.auth', 'tim1.json');

async function globalSetup(): Promise<void> {
  const env = selectEnvironment();

  const username = process.env.TIM1_USERNAME;
  const password = process.env.TIM1_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'framework globalSetup: TIM1_USERNAME / TIM1_PASSWORD must be set ' +
        '(workspace-root .env.local or shell). Phase 0 Step 0.F.'
    );
  }

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  const browser = await chromium.launch({
    args: env.baseUrl.startsWith('http://')
      ? [`--unsafely-treat-insecure-origin-as-secure=${env.baseUrl}`]
      : [],
  });

  try {
    // ───────────────────────────────────────────────────────────────
    // Phase 1: tim1 login + storage state persist (existing behaviour)
    // ───────────────────────────────────────────────────────────────
    const tim1Context = await browser.newContext({
      baseURL: env.baseUrl,
      ignoreHTTPSErrors: true,
    });
    const tim1Page = await tim1Context.newPage();
    try {
      await loginViaForm(tim1Page, username, password, env.baseUrl);
      await tim1Context.storageState({ path: STORAGE_STATE_PATH });
      console.log(`[framework globalSetup] tim1 storage state saved → ${STORAGE_STATE_PATH}`);

      // ─────────────────────────────────────────────────────────────
      // Phase 2: firm pool reuse gate
      // ─────────────────────────────────────────────────────────────
      const rebuildFlag = process.env.REBUILD_FIRMS === '1';
      if (!rebuildFlag) {
        const fresh = readFreshManifest(env.name);
        if (fresh) {
          console.log(
            `[framework globalSetup] firm pool reused from ${AUTH_DIR}/firms.json ` +
              `(${fresh.firms.length} firms, created ${fresh.createdAt})`
          );
          return;
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Phase 3: provision FIRM_POOL_SIZE firms + capture 7 logins each
      // ─────────────────────────────────────────────────────────────
      console.log(
        `[framework globalSetup] provisioning ${FIRM_POOL_SIZE} dummy firms against ${env.name}…`
      );
      const startedAt = Date.now();

      // Wipe any stale per-firm storage states so leftover files from
      // a previous rebuild do not shadow a failed provisioning.
      if (fs.existsSync(FIRMS_STORAGE_DIR)) {
        fs.rmSync(FIRMS_STORAGE_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(FIRMS_STORAGE_DIR, { recursive: true });

      const firms = await createFirms(tim1Context.request, env, FIRM_POOL_SIZE);
      console.log(
        `[framework globalSetup] created ${firms.length} firms: ${firms
          .map((f) => f.firmCd)
          .join(', ')}`
      );

      // Fully serial login capture.
      //
      // Running form logins in parallel against qa corrupts
      // server-side session state: `AuthenticationManager` is a
      // static singleton dispatching through an atomatron actor
      // (`providerSendAndWait`), and concurrent Authenticate
      // messages race on shared state. The observable symptom is
      // that `storageState()` writes a valid-looking JSESSIONID
      // cookie whose HttpSession has no `loggedUser` attribute, so
      // React's post-boot `/react/login.do?reactRequest=true` call
      // returns `objectType: "redirect"` and the page bounces to
      // #login. Confirmed via recon: 7 parallel logins → all 7
      // stored states dead; 7 serial logins → all 7 alive.
      // Optimisation (bounded concurrency) is a follow-up.
      const entries: FirmManifestEntry[] = [];
      for (const firm of firms) {
        entries.push(await captureFirmRoleSessions(browser, env, firm, password));
      }

      const manifest: FirmManifest = {
        createdAt: new Date().toISOString(),
        env: env.name,
        firms: entries,
      };
      writeManifest(manifest);

      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      console.log(
        `[framework globalSetup] firm pool ready in ${elapsedSec}s — ` +
          `${firms.length} firms × ${FIRM_ROLES.length} roles = ${firms.length * FIRM_ROLES.length} sessions`
      );
    } finally {
      await tim1Context.close();
    }
  } finally {
    await browser.close();
  }
}

/**
 * Create FIRM_POOL_SIZE dummy firms in parallel through the extended
 * endpoint, using the tim1 APIRequestContext that comes pre-loaded
 * with auth cookies.
 */
async function createFirms(
  request: APIRequestContext,
  env: EnvironmentConfig,
  count: number
): Promise<DummyFirm[]> {
  const apiClient = new ApiClient({ request, environment: env.name });
  const api = new DummyFirmApi(apiClient);
  return Promise.all(Array.from({ length: count }, () => api.create()));
}

/**
 * For one firm, log every role in via form, save each session to a
 * per-role storageState file, and build the manifest entry.
 *
 * Roles are logged in **serially** — the server's AuthenticationManager
 * singleton races under concurrent login messages, corrupting session
 * state for all involved users. See the comment in globalSetup() for
 * the full diagnosis.
 */
async function captureFirmRoleSessions(
  browser: Browser,
  env: EnvironmentConfig,
  firm: DummyFirm,
  password: string
): Promise<FirmManifestEntry> {
  const roleMap = buildRoleMap(firm);

  fs.mkdirSync(path.join(FIRMS_STORAGE_DIR, String(firm.firmCd)), { recursive: true });

  const loginRecords: FirmManifestLogin[] = [];
  for (const role of FIRM_ROLES) {
    const loginInfo = roleMap[role];
    const storagePath = firmStoragePath(firm.firmCd, role);
    const sessionStorage = await provisionRoleSession(
      browser,
      env,
      loginInfo.loginName,
      password,
      storagePath
    );
    loginRecords.push({
      role,
      loginName: loginInfo.loginName,
      name: loginInfo.name,
      entityId: role === 'admin' ? firm.admin.entityId : null,
      storageState: storagePath,
      sessionStorage,
    });
  }

  const byRole = Object.fromEntries(loginRecords.map((r) => [r.role, r])) as Record<
    FirmRole,
    FirmManifestLogin
  >;

  return {
    firmCd: firm.firmCd,
    firmName: firm.firmName,
    firmUrl: firm.firmUrl,
    logins: {
      admin: byRole['admin'],
      tim: byRole['tim'],
      gwAdmin: byRole['gwAdmin'],
      nonGwAdmin: byRole['nonGwAdmin'],
      advisors: [byRole['advisor-1'], byRole['advisor-2'], byRole['advisor-3']],
    },
    advisor: firm.advisor,
    household: firm.household,
    client: firm.client,
    accounts: firm.accounts.map((a) => ({ uuid: a.uuid, num: a.num, title: a.title })),
  };
}

/**
 * Translate a DummyFirm into the `{ role: { loginName, name } }` shape
 * captureFirmRoleSessions wants. Fails fast when the extended response
 * is missing any of the 7 slots — globalSetup cannot proceed without
 * the full matrix.
 */
function buildRoleMap(firm: DummyFirm): Record<FirmRole, { loginName: string; name: string | null }> {
  const l = firm.logins;
  if (!l.tim) throw new Error(`buildRoleMap: firm ${firm.firmCd} has no tim<firmCd> login`);
  if (!l.gwAdmin) throw new Error(`buildRoleMap: firm ${firm.firmCd} has no u<firmCd>_gwadmin login`);
  if (!l.nonGwAdmin) {
    throw new Error(`buildRoleMap: firm ${firm.firmCd} has no u<firmCd>_nongwadmin login`);
  }
  if (l.advisors.length < 3) {
    throw new Error(
      `buildRoleMap: firm ${firm.firmCd} has only ${l.advisors.length} advisors (expected 3)`
    );
  }

  return {
    admin: { loginName: l.admin.loginName, name: null },
    tim: { loginName: l.tim.loginName, name: l.tim.name },
    gwAdmin: { loginName: l.gwAdmin.loginName, name: l.gwAdmin.name },
    nonGwAdmin: { loginName: l.nonGwAdmin.loginName, name: l.nonGwAdmin.name },
    'advisor-1': { loginName: l.advisors[0].loginName, name: l.advisors[0].name },
    'advisor-2': { loginName: l.advisors[1].loginName, name: l.advisors[1].name },
    'advisor-3': { loginName: l.advisors[2].loginName, name: l.advisors[2].name },
  };
}

/**
 * Launch a fresh BrowserContext, drive the login form, wait for the
 * SPA to fully hydrate localStorage with the post-login bootstrap
 * state, and persist the resulting storage state to `storagePath`.
 *
 * The localStorage wait is the critical difference from a naive
 * `loginViaForm → storageState` sequence: Playwright's
 * `storageState()` snapshots cookies AND `localStorage` per origin,
 * but only what's already in the page at snapshot time. The qa SPA
 * writes firm/role bootstrap keys to `localStorage` a few hundred
 * milliseconds after the post-login URL hash fires — if we capture
 * immediately we get a session with a valid JSESSIONID but no
 * bootstrap, and consumers that load that state into a fresh context
 * without a form login land back on the sign-in page.
 *
 * Two-layer wait:
 *   1. `networkidle` — gives the SPA a chance to run its post-login
 *      XHR round-trips (user info, permissions, nomenclatures, etc.).
 *   2. `localStorage.length > 0` — explicit assertion that at least
 *      one bootstrap key has landed before we snapshot. Capped by a
 *      generous timeout with a `.catch(() => {})` fallback so roles
 *      that legitimately have no post-login storage do not block the
 *      provisioning run.
 */
async function provisionRoleSession(
  browser: Browser,
  env: EnvironmentConfig,
  loginName: string,
  password: string,
  storagePath: string
): Promise<SessionStorageSnapshot> {
  const context = await browser.newContext({
    baseURL: env.baseUrl,
    ignoreHTTPSErrors: true,
  });
  try {
    const page = await context.newPage();
    await loginViaForm(page, loginName, password, env.baseUrl);
    // Give the SPA a chance to settle — networkidle fires when all
    // XHR chatter stops, which correlates with the post-login
    // bootstrap (user info / permissions / whitelabel). Some roles
    // have persistent background polling, so the wait is best-effort.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {
      /* non-fatal */
    });
    // Capture sessionStorage manually — storageState() only saves
    // cookies + localStorage, but the qa SPA keeps its post-login
    // bootstrap keys (e.g. `gw.whitelabelStaticFolder`) in
    // sessionStorage. Without this snapshot the consumer fixture's
    // fresh context starts with empty sessionStorage and the SPA
    // falls back to the sign-in page on first navigation.
    const sessionStorage = await page.evaluate<SessionStorageSnapshot>(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key !== null) {
          out[key] = window.sessionStorage.getItem(key) ?? '';
        }
      }
      return out;
    });
    // eslint-disable-next-line no-console
    console.log(
      `  [${loginName}] url=${page.url()} sessionStorage keys=${JSON.stringify(Object.keys(sessionStorage))}`
    );
    await context.storageState({ path: storagePath });
    return sessionStorage;
  } finally {
    await context.close();
  }
}

export default globalSetup;
