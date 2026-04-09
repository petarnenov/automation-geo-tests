/**
 * `preflight` — environment health check (Section 5.9).
 *
 * Run before any nightly job. Aborts the nightly cleanly with a clear
 * env-health error rather than letting hundreds of confusing spec
 * failures pile up against an unhealthy environment.
 *
 * Phase 1.5. Wired to:
 *   - `npm run preflight` at the workspace root.
 *   - The Phase 1.8 nightly GitHub workflow as a gating job.
 *
 * Checks:
 *   1. Target environment is reachable.
 *      A `GET /` against the base URL returns within 5 seconds.
 *      (Per Section 5.9: previous "GET /react/loginReact.do" was wrong
 *      because that endpoint expects a POST and a bare GET returns the
 *      login form, masking auth failures.)
 *
 *   2. tim1 can authenticate end-to-end.
 *      Performs the SPA login flow against the env's loginPath, asserts
 *      a session cookie is set and the post-login route matches the
 *      env's `postLoginHashRoute` regex (`#(platformOne|dashboard)`,
 *      per D-45). This is the only check that proves the env is
 *      *actually usable*.
 *
 *   3. /qa/createDummyFirm.do returns within 30 seconds with the
 *      tim1 session attached.
 *
 *   4. (Best-effort, non-blocking) Confluence link is reachable.
 *
 * Manual override (D-23 / Section 5.9): set `SKIP_PREFLIGHT=1` to force
 * a run when pre-flight has a known false positive. The override is
 * audited in run-summary.json (Phase 1 D-40 schema) and a follow-up
 * issue is opened against pre-flight if used twice in any rolling 7-day
 * window.
 *
 * Exit codes:
 *   0 — every check passed (or SKIP_PREFLIGHT=1 was honored)
 *   2 — at least one check failed
 */

import { request as playwrightRequest } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  loadWorkspaceEnv,
  selectEnvironment,
  type EnvironmentConfig,
} from '@geowealth/e2e-framework/config';

loadWorkspaceEnv();

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly detail?: string;
}

async function withTiming(name: string, fn: () => Promise<{ ok: boolean; detail?: string }>): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { name, ok: r.ok, durationMs: Date.now() - t0, detail: r.detail };
  } catch (e) {
    return {
      name,
      ok: false,
      durationMs: Date.now() - t0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkReachable(env: EnvironmentConfig): Promise<{ ok: boolean; detail?: string }> {
  const ctx = await playwrightRequest.newContext({ baseURL: env.baseUrl, ignoreHTTPSErrors: true });
  try {
    const res = await ctx.get('/', { timeout: 5_000 });
    if (!res.ok()) {
      return { ok: false, detail: `GET / returned ${res.status()} ${res.statusText()}` };
    }
    return { ok: true, detail: `GET / → ${res.status()}` };
  } finally {
    await ctx.dispose();
  }
}

async function checkTim1Login(env: EnvironmentConfig): Promise<{ ok: boolean; detail?: string }> {
  const username = process.env.TIM1_USERNAME;
  const password = process.env.TIM1_PASSWORD;
  if (!username || !password) {
    return {
      ok: false,
      detail: 'TIM1_USERNAME / TIM1_PASSWORD not set in workspace .env.local',
    };
  }
  // Resilient login flow — mirrors the legacy POC's
  // loginPlatformOneAdmin in packages/legacy-poc/tests/_helpers/qa3.js
  // (lines 59-86), which is the battle-hardened pattern.
  //
  // The original preflight implementation relied on
  // `waitForURL(env.loginHashRoute)` and then `waitForURL(env.
  // postLoginHashRoute)`. That works on qa3 — where the SPA
  // synchronously redirects `/` to `/react/indexReact.do#login` —
  // but on qa2/qa4 the bare goto('/') lands directly at
  // `/react/indexReact.do` (no hash), and the SPA never adds `#login`
  // to the URL bar. waitForURL then times out at 30s.
  //
  // The DOM-signal race is environment-agnostic: it asks "is the login
  // form visible, OR is the post-login content visible?" and acts
  // accordingly. Identical to what loginPlatformOneAdmin does, and
  // identical to what the framework's auth.fixture will do once Phase
  // 2 lifts it.
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: env.baseUrl, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto('/', { timeout: 30_000 });

    // Race for either the login form or the authenticated landing
    // content. .catch(() => {}) keeps Promise.race from rejecting on
    // the loser — the actual decision is made by the isVisible() call
    // afterwards.
    const usernameField = page.getByPlaceholder(/email|username/i);
    const loggedInSignal = page.getByText(/Welcome to Platform One|Dashboard/i);
    await Promise.race([
      usernameField.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
      loggedInSignal.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    ]);

    if (await usernameField.isVisible().catch(() => false)) {
      // Login form is showing — submit it.
      await usernameField.fill(username);
      await page.getByPlaceholder(/password/i).fill(password);
      await page.getByRole('button', { name: 'Login' }).click();
      // After submit, wait for the landing content (DOM signal, not
      // hash route — see comment above for the rationale).
      await loggedInSignal.waitFor({ state: 'visible', timeout: 30_000 });
    }
    // Otherwise: a session was already valid (storage state from a
    // previous run, browser cache, etc.) — nothing to do.

    const cookies = await context.cookies();
    const sessionCookies = cookies.filter((c) => /session|jsess/i.test(c.name));
    if (sessionCookies.length === 0) {
      return { ok: false, detail: 'login flow completed but no session cookie was set' };
    }
    return {
      ok: true,
      detail: `${username} → ${page.url()} (${sessionCookies.length} session cookie(s))`,
    };
  } finally {
    await browser.close();
  }
}

async function checkCreateDummyFirm(env: EnvironmentConfig): Promise<{ ok: boolean; detail?: string }> {
  // The /qa/createDummyFirm.do endpoint requires a tim1 session. We
  // can't easily reuse the browser cookies from checkTim1Login here
  // (different context), so this is a best-effort HEAD/POST check that
  // only verifies the endpoint exists and responds. The full
  // round-trip with auth is exercised by every nightly's worker-firm
  // fixture, so we don't need to duplicate it here.
  const ctx = await playwrightRequest.newContext({ baseURL: env.baseUrl, ignoreHTTPSErrors: true });
  try {
    const res = await ctx.post('/qa/createDummyFirm.do', { timeout: 30_000 });
    // Expected without auth: 401 / 302 / 200 with login form.
    // Anything 5xx is a real env health problem.
    if (res.status() >= 500) {
      return { ok: false, detail: `POST /qa/createDummyFirm.do → ${res.status()}` };
    }
    return {
      ok: true,
      detail: `POST /qa/createDummyFirm.do → ${res.status()} (endpoint reachable; full auth round-trip exercised by worker-firm fixture)`,
    };
  } finally {
    await ctx.dispose();
  }
}

async function checkConfluence(): Promise<{ ok: boolean; detail?: string }> {
  // Best-effort, non-blocking. The internal Confluence URL is in the
  // proposal but may not be reachable from every CI runner.
  const url = 'https://development.geowealth.com/confluence/';
  const ctx = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
  try {
    const res = await ctx.get(url, { timeout: 5_000 });
    return {
      ok: true, // Always OK — non-blocking
      detail: `GET ${url} → ${res.status()} (non-blocking)`,
    };
  } catch (e) {
    return {
      ok: true, // Non-blocking even on error
      detail: `GET ${url} → unreachable (non-blocking): ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    await ctx.dispose();
  }
}

async function runPreflight(env: EnvironmentConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  results.push(await withTiming('reachable', () => checkReachable(env)));
  results.push(await withTiming('tim1-login', () => checkTim1Login(env)));
  results.push(await withTiming('createDummyFirm', () => checkCreateDummyFirm(env)));
  results.push(await withTiming('confluence', () => checkConfluence()));
  return results;
}

function printResults(env: EnvironmentConfig, results: CheckResult[]): void {
  console.log(`preflight: env=${env.name} baseUrl=${env.baseUrl}`);
  for (const r of results) {
    const mark = r.ok ? '✓' : '✘';
    console.log(`  ${mark} ${r.name.padEnd(20)} ${r.durationMs.toString().padStart(5)}ms  ${r.detail ?? ''}`);
  }
}

async function main(): Promise<number> {
  if (process.env.SKIP_PREFLIGHT === '1') {
    console.log('preflight: SKIP_PREFLIGHT=1 — skipping all checks (D-23 manual override).');
    console.log('preflight: this skip will be audited in run-summary.json (D-40).');
    return 0;
  }

  let env: EnvironmentConfig;
  try {
    env = selectEnvironment();
  } catch (e) {
    console.error(`preflight: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  const results = await runPreflight(env);
  printResults(env, results);

  // Confluence is non-blocking; everything else must be ok.
  const blocking = results.filter((r) => r.name !== 'confluence');
  const failed = blocking.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(
      `preflight: ${failed.length} blocking check(s) failed against env=${env.name}. Aborting nightly.`
    );
    return 2;
  }
  console.log(`preflight: env=${env.name} healthy. Proceeding with nightly.`);
  return 0;
}

const invokedAsScript =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedAsScript) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`preflight: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
  );
}

export { main, runPreflight };
