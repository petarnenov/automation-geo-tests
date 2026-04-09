/**
 * Framework globalSetup — logs in `tim1` once per `playwright test`
 * invocation and persists the browser storage state under
 * `<WORKSPACE_ROOT>/.auth/tim1.json` (D-41 — shared across packages).
 *
 * Phase 0 Step 0.F. Mirrors the legacy POC's `tests/_helpers/global-setup.js`
 * but reads credentials exclusively from `process.env` and uses the
 * framework's typed environment selector.
 *
 * Per Step 0.0 reconnaissance (D-45 / D-46):
 * - tim1 lands on `#platformOne` (NOT `#/dashboard`).
 * - The post-login wait tolerates either route via the framework's
 *   `EnvironmentConfig.postLoginHashRoute` regex.
 * - The walking-skeleton spec asserts on the heading
 *   `getByRole('heading', { name: 'Operations' })` (the first heading on
 *   the Platform One landing page).
 */

import { chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { selectEnvironment } from '../config/environments';
import { loadWorkspaceEnv, WORKSPACE_ROOT } from '../config/dotenv-loader';

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

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // The SPA async-routes to /#login after the bundle boots; wait for it
    // before touching the form fields. The login form has placeholder-only
    // inputs (no name/role), so we match by placeholder.
    await page.goto(env.baseUrl);
    await page.waitForURL(env.loginHashRoute, { timeout: 30_000 });
    await page.getByPlaceholder(/email|username/i).fill(username);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    // tim1 lands on #platformOne; advisor users land on #dashboard. We
    // accept either as "logged in" — see D-45.
    await page.waitForURL(env.postLoginHashRoute, { timeout: 30_000 });
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log(`[framework globalSetup] tim1 storage state saved → ${STORAGE_STATE_PATH}`);
  } finally {
    await browser.close();
  }
}

export default globalSetup;
