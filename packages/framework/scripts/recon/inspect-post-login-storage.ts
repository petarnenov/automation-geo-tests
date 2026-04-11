/**
 * Recon script — log in as each role from an existing firm manifest
 * and dump the post-login localStorage / cookie state to stdout.
 *
 * Used to investigate why the storage-state files captured by
 * globalSetup have zero origins (no localStorage): is the qa SPA
 * writing to localStorage at all for these users, and if so, when?
 *
 * Reads the firm manifest from `.auth/firms.json`, grabs the first
 * firm, and walks the 7 roles in order. For each role, logs in via
 * the resilient DOM-signal race, waits for localStorage hydration,
 * and prints cookies + localStorage + a few key DOM signals.
 *
 * Usage:
 *     npx tsx packages/framework/scripts/recon/inspect-post-login-storage.ts
 *     npx tsx packages/framework/scripts/recon/inspect-post-login-storage.ts --env=qa4 --firm=1021
 */

import { chromium, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadWorkspaceEnv } from '../../src/config/dotenv-loader';
import { environments, type EnvironmentName } from '../../src/config/environments';
import { loginViaForm } from '../../src/fixtures/loginViaForm';
import { loadManifest, type FirmManifestEntry } from '../../src/fixtures/firmManifest';

function parseArgs(): {
  env: EnvironmentName;
  firmCd: number | null;
  all: boolean;
  storedOnly: boolean;
} {
  const args = process.argv.slice(2);
  const envFlag = args.find((a) => a.startsWith('--env='));
  const firmFlag = args.find((a) => a.startsWith('--firm='));
  const env = (envFlag ? envFlag.slice('--env='.length) : 'qa4') as EnvironmentName;
  const firmCd = firmFlag ? Number(firmFlag.slice('--firm='.length)) : null;
  const all = args.includes('--all');
  const storedOnly = args.includes('--stored-only');
  return { env, firmCd, all, storedOnly };
}

async function inspectRole(
  browser: Browser,
  baseUrl: string,
  loginName: string,
  password: string
): Promise<void> {
  const context = await browser.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    const t0 = Date.now();
    await loginViaForm(page, loginName, password, baseUrl);
    const afterLoginMs = Date.now() - t0;

    const url = page.url();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const afterNetworkIdleMs = Date.now() - t0;

    const cookies = await context.cookies();
    const localStorage = await page.evaluate(() =>
      Object.entries(window.localStorage).map(([k, v]) => ({
        key: k,
        valueHead: String(v).slice(0, 60),
        length: String(v).length,
      }))
    );
    const sessionStorage = await page.evaluate(() =>
      Object.entries(window.sessionStorage).map(([k, v]) => ({
        key: k,
        length: String(v).length,
      }))
    );

    console.log(`\n─── ${loginName} ───`);
    console.log(`  url: ${url}`);
    console.log(`  timing: loginViaForm=${afterLoginMs}ms, +networkIdle=${afterNetworkIdleMs}ms`);
    console.log(`  cookies (${cookies.length}):`);
    for (const c of cookies) {
      console.log(`    ${c.name}=${c.value.slice(0, 20)}... (${c.domain})`);
    }
    console.log(`  localStorage (${localStorage.length} keys):`);
    for (const ls of localStorage) {
      console.log(`    ${ls.key} = ${ls.valueHead} (len=${ls.length})`);
    }
    console.log(`  sessionStorage (${sessionStorage.length} keys):`);
    for (const ss of sessionStorage) {
      console.log(`    ${ss.key} (len=${ss.length})`);
    }

    // Round-trip: save storage state → load into fresh context → navigate → report
    const tmpStatePath = path.join(
      os.tmpdir(),
      `recon-state-${loginName}-${Date.now()}.json`
    );
    await context.storageState({ path: tmpStatePath });
    const stateBytes = fs.statSync(tmpStatePath).size;

    const freshCtx = await browser.newContext({
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      storageState: tmpStatePath,
    });
    try {
      const freshPage = await freshCtx.newPage();
      await freshPage.goto('/react/indexReact.do', { waitUntil: 'domcontentloaded' });
      await freshPage.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      const landingUrl = freshPage.url();
      // Match the same selector the smoke test uses
      const signInVisible = await freshPage
        .getByPlaceholder(/email|username/i)
        .first()
        .isVisible()
        .catch(() => false);
      const title = await freshPage.title().catch(() => '');
      const bodyText = await freshPage.evaluate(() => document.body?.innerText?.slice(0, 200) ?? '');
      const freshLs = await freshPage.evaluate(() => globalThis.localStorage.length);
      const freshSs = await freshPage.evaluate(() => globalThis.sessionStorage.length);
      const screenshotPath = path.join(
        os.tmpdir(),
        `recon-${loginName}-${Date.now()}.png`
      );
      await freshPage.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

      console.log(`  round-trip:`);
      console.log(`    stateFile=${stateBytes}B`);
      console.log(`    landingUrl=${landingUrl}`);
      console.log(`    title="${title}"`);
      console.log(`    signInVisible=${signInVisible}`);
      console.log(`    bodyText[0..200]=${JSON.stringify(bodyText)}`);
      console.log(`    fresh localStorage keys=${freshLs}  sessionStorage keys=${freshSs}`);
      console.log(`    screenshot=${screenshotPath}`);
    } finally {
      await freshCtx.close();
      fs.rmSync(tmpStatePath, { force: true });
    }
  } finally {
    await context.close();
  }
}

/**
 * Load a stored state file directly (no form login) and see whether
 * it still authenticates against qa. This isolates "did the captured
 * session expire" from "is the storage state structurally wrong".
 */
async function inspectStoredState(
  browser: Browser,
  baseUrl: string,
  role: string,
  storagePath: string
): Promise<void> {
  if (!fs.existsSync(storagePath)) {
    console.log(`  [${role}] STORAGE FILE MISSING: ${storagePath}`);
    return;
  }
  const context = await browser.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    storageState: storagePath,
  });
  try {
    const page = await context.newPage();
    await page.goto('/react/indexReact.do', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const url = page.url();
    const signInVisible = await page
      .getByPlaceholder(/email|username/i)
      .first()
      .isVisible()
      .catch(() => false);
    const title = await page.title().catch(() => '');
    const cookies = await context.cookies();
    const jsession = cookies.find((c) => c.name === 'JSESSIONID');
    console.log(
      `  [${role}] storedJSESSIONID=${jsession?.value.slice(0, 16) ?? 'NONE'} ` +
        `landingUrl=${url} title="${title}" signInVisible=${signInVisible}`
    );
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  loadWorkspaceEnv();

  const { env: envName, firmCd, all, storedOnly } = parseArgs();
  const env = environments[envName];
  const password = process.env.TIM1_PASSWORD;
  if (!password) throw new Error('TIM1_PASSWORD not set');

  const manifest = loadManifest();
  const targetFirms: readonly FirmManifestEntry[] = all
    ? manifest.firms
    : firmCd
      ? [manifest.firms.find((f) => f.firmCd === firmCd)!]
      : [manifest.firms[0]];
  if (targetFirms.some((f) => !f)) throw new Error(`Firm not found in manifest`);

  const browser = await chromium.launch();
  try {
    for (const targetFirm of targetFirms) {
      console.log(
        `\n[recon] ======== firm=${targetFirm.firmCd} (${targetFirm.firmName}) ========`
      );
      await runFirm(browser, env.baseUrl, targetFirm, password, storedOnly);
    }
  } finally {
    await browser.close();
  }
}

async function runFirm(
  browser: Browser,
  baseUrl: string,
  targetFirm: FirmManifestEntry,
  password: string,
  storedOnly: boolean
): Promise<void> {
  {
    // Phase A: inspect STORED storage state files (no fresh login).
    // This is what the pool-based fixtures actually load at test time,
    // so this is the one that tells us whether the captured sessions
    // are still alive.
    console.log(`\n[recon] ===== Phase A: stored state files (no login) =====`);
    const storedRoles: Array<[string, string]> = [
      ['admin', targetFirm.logins.admin.storageState],
      ['tim', targetFirm.logins.tim.storageState],
      ['gwAdmin', targetFirm.logins.gwAdmin.storageState],
      ['nonGwAdmin', targetFirm.logins.nonGwAdmin.storageState],
      ['advisor-1', targetFirm.logins.advisors[0].storageState],
      ['advisor-2', targetFirm.logins.advisors[1].storageState],
      ['advisor-3', targetFirm.logins.advisors[2].storageState],
    ];
    for (const [roleLabel, storagePath] of storedRoles) {
      await inspectStoredState(browser, baseUrl, roleLabel, storagePath);
    }

    if (storedOnly) return;

    // Phase B: fresh form login + round-trip (pre-existing behaviour)
    console.log(`\n[recon] ===== Phase B: fresh form logins =====`);
    const roles: Array<[string, string]> = [
      ['admin', targetFirm.logins.admin.loginName],
      ['tim', targetFirm.logins.tim.loginName],
      ['gwAdmin', targetFirm.logins.gwAdmin.loginName],
      ['nonGwAdmin', targetFirm.logins.nonGwAdmin.loginName],
      ['advisor-1', targetFirm.logins.advisors[0].loginName],
    ];
    for (const [roleLabel, loginName] of roles) {
      console.log(`\n[recon] inspecting role=${roleLabel}…`);
      try {
        await inspectRole(browser, baseUrl, loginName, password);
      } catch (e) {
        console.error(`[recon]   FAILED: ${(e as Error).message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('[recon] failed:', err);
  process.exit(1);
});
