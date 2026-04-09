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
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    // Resilient login flow — DOM-signal race instead of URL-pattern
    // wait. Same fix as the preflight script (commit d17459d): the
    // bare goto('/') lands at /react/indexReact.do without a hash on
    // qa2/qa4, and the SPA never adds /#login to the URL bar, so
    // `waitForURL(/#login/)` times out at 30s. The DOM-signal race
    // is environment-agnostic — it asks "is the login form visible,
    // OR is the post-login content visible?" and acts accordingly.
    // Identical to the legacy POC's loginPlatformOneAdmin in
    // packages/legacy-poc/tests/_helpers/qa3.js (lines 59-86).
    await page.goto(env.baseUrl);

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
      // After submit, wait for the landing content (DOM signal, not
      // hash route).
      await loggedInSignal.waitFor({ state: 'visible', timeout: 30_000 });
    }
    // Otherwise: a session was already valid (cached browser state)
    // — nothing to do; persist the state we have.

    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log(`[framework globalSetup] tim1 storage state saved → ${STORAGE_STATE_PATH}`);
  } finally {
    await browser.close();
  }
}

export default globalSetup;
