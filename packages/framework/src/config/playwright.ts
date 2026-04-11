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
import { FIRM_POOL_SIZE } from '../fixtures/firmManifest';

loadWorkspaceEnv();

export interface DefinePlaywrightConfigOptions {
  /** Short slug for the consuming package, e.g. `'billing-servicing'`. */
  projectName: string;
  /** Test directory relative to the consuming package. Default `./tests`. */
  testDir?: string;
  /**
   * Number of parallel workers. Default `FIRM_POOL_SIZE` so every
   * worker gets a dedicated firm from the pool — pool fixtures use
   * per-(firm, role) locking backed by a module-level singleton that
   * is NOT shared across workers, so `workers > FIRM_POOL_SIZE` risks
   * two workers simultaneously leasing the same `(firm, role)` slot
   * and colliding on server-side session state.
   */
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
    // D-40 / Section 6.11: every per-package run emits a single
    // run-summary.json artifact under <package-root>/test-results/.
    // Producer and consumers (testrail-aggregator + time-series push)
    // are pinned to schemaVersion '1'.
    [require.resolve('@geowealth/e2e-framework/reporters/run-summary-reporter')],
  ];

  if (process.env.TESTRAIL_REPORTING === 'on') {
    try {
      // Resolve at runtime. The reporter's subpath was added to the
      // framework's exports field in Phase 1.6.
      const reporterPath = require.resolve(
        '@geowealth/e2e-framework/reporters/testrail-reporter'
      );
      reporter.push([reporterPath]);
    } catch {
      // Silent — fall through to list+html only. This branch fires
      // only if the framework's package.json exports field has not yet
      // been updated.
    }
  }

  return defineConfig({
    testDir: opts.testDir ?? './tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: Math.min(opts.workers ?? FIRM_POOL_SIZE, FIRM_POOL_SIZE),
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter,
    // Per Phase 0 Step 0.F: every team package's playwright.config.ts
    // gets globalSetup wired up by default. require.resolve returns the
    // absolute file path on disk, which Playwright loads at startup.
    globalSetup: require.resolve('@geowealth/e2e-framework/fixtures/globalSetup'),
    use: {
      baseURL: env.baseUrl,
      ignoreHTTPSErrors: true,
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
        use: {
          ...devices['Desktop Chrome'],
          // Allow cookies over plain HTTP (needed for local dev servers).
          // On HTTPS environments this is a no-op.
          launchOptions: {
            args: env.baseUrl.startsWith('http://')
              ? [`--unsafely-treat-insecure-origin-as-secure=${env.baseUrl}`]
              : [],
          },
        },
      },
    ],
  });
}
