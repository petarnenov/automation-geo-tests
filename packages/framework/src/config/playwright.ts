/**
 * `definePlaywrightConfig` — the function every per-team package's
 * `playwright.config.ts` calls. Centralizes timeouts, retries, reporters,
 * and the production safety guard so every team inherits the same defaults.
 *
 * Phase 0 Step 0.F. The reporter list is just `[['list'], ['html', { open:
 * 'never' }]]` for now — the framework's TS TestRail reporter does not
 * exist yet (Phase 1 deliverable). `definePlaywrightConfig` reads
 * `process.env.TESTRAIL_REPORTING` and *conditionally* appends the
 * TestRail reporter only when set to `on`, so Phase 0 specs run cleanly
 * without referencing an unbuilt reporter.
 */

import { defineConfig, devices } from '@playwright/test';
import type { PlaywrightTestConfig, ReporterDescription } from '@playwright/test';
import * as path from 'node:path';
import { loadWorkspaceEnv, WORKSPACE_ROOT } from './dotenv-loader';
import { selectEnvironment } from './environments';

loadWorkspaceEnv();

export interface DefinePlaywrightConfigOptions {
  /** Short slug for the consuming package, e.g. `'billing-servicing'`. */
  projectName: string;
  /** Test directory relative to the consuming package. Default `./tests`. */
  testDir?: string;
  /** Number of parallel workers. Default 6 (validated under qa2/qa3 load). */
  workers?: number;
  /**
   * Optional `use.storageState` override. Default points at the workspace-
   * root `<WORKSPACE_ROOT>/.auth/tim1.json` (D-41 — shared across packages
   * to bound login pressure on qa2/qa3).
   */
  storageState?: string;
  /**
   * Extra `use` overrides merged after the framework defaults.
   */
  use?: PlaywrightTestConfig['use'];
}

/**
 * Build a Playwright config with the framework's defaults applied.
 *
 * Default reporter: `[['list'], ['html', { open: 'never' }]]`.
 * Conditional reporter: when `TESTRAIL_REPORTING=on`, the framework's TS
 * TestRail reporter is appended (Phase 1 deliverable; today the require
 * is guarded behind a try/catch so Phase 0 doesn't fail on a missing
 * module).
 */
export function definePlaywrightConfig(
  opts: DefinePlaywrightConfigOptions
): PlaywrightTestConfig {
  const env = selectEnvironment();
  const sharedStorageState = path.join(WORKSPACE_ROOT, '.auth', 'tim1.json');

  const reporter: ReporterDescription[] = [
    ['list'],
    ['html', { open: 'never' }],
  ];

  if (process.env.TESTRAIL_REPORTING === 'on') {
    try {
      // Resolve at runtime so Phase 0 (where the reporter does not yet
      // exist) does not fail at config-load time.
      const reporterPath = require.resolve(
        '@geowealth/e2e-framework/reporters'
      );
      reporter.push([reporterPath]);
    } catch {
      // Silent — the framework's TestRail reporter is a Phase 1
      // deliverable. Phase 0 specs run with list+html only.
    }
  }

  return defineConfig({
    testDir: opts.testDir ?? './tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: opts.workers ?? 6,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter,
    // Per Phase 0 Step 0.F: every team package's playwright.config.ts
    // gets globalSetup wired up by default. require.resolve returns the
    // absolute file path on disk, which Playwright loads at startup.
    globalSetup: require.resolve('@geowealth/e2e-framework/fixtures/globalSetup'),
    use: {
      baseURL: env.baseUrl,
      actionTimeout: 15_000,
      navigationTimeout: 30_000,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      storageState: opts.storageState ?? sharedStorageState,
      ...opts.use,
    },
    projects: [
      {
        name: opts.projectName,
        use: { ...devices['Desktop Chrome'] },
      },
    ],
  });
}
