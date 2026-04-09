/**
 * Authentication fixture: provides `authenticatedPage` per role.
 *
 * Per Section 4.10.5 of the proposal (Multi-Tenant Role Matrix), every
 * spec must declare both the firm scope and the user role it requires.
 * In Phase 0 only the `tim1` role is wired up — additional roles
 * (gw-admin, firm-admin, advisor, client) land in Phase 2 alongside the
 * worker-firm fixture and the API client.
 *
 * Storage-state freshness re-validation (R-14, R-25 mitigation, D-41):
 * - The check runs **once per worker per execution**, not per test, by
 *   reading the storage-state file's mtime and skipping re-validation
 *   if it is newer than (GW_SESSION_TTL_MINUTES - safety_margin).
 * - Only when the cached state is potentially stale does the fixture
 *   issue a real authenticated request; a 302 to login re-runs the
 *   login flow and rewrites the file.
 * - This bounds extra HTTP volume to N workers per nightly, not N x
 *   tests, protecting qa2/qa3 from unnecessary login pressure.
 *
 * Phase 0 Step 0.F. The freshness check is implemented but only
 * file-mtime gated for now — the "real authenticated request" branch
 * lands in Phase 1 once the framework's API client exists.
 */

import { test as base, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import { STORAGE_STATE_PATH } from './globalSetup';

/**
 * GeoWealth session TTL — empirically ~8 hours. The freshness check
 * triggers re-validation if the storage state file is older than
 * (TTL - safety margin). Tunable via env var for CI experimentation.
 */
const GW_SESSION_TTL_MINUTES = Number(process.env.GW_SESSION_TTL_MINUTES ?? 480);
const SAFETY_MARGIN_MINUTES = 30;
const FRESHNESS_THRESHOLD_MS = (GW_SESSION_TTL_MINUTES - SAFETY_MARGIN_MINUTES) * 60_000;

export type AuthFixtures = {
  /**
   * The shared `tim1` storage-state freshness check, run once per worker.
   * Returns the storage state path that the test fixtures should use.
   */
  tim1StorageState: string;
};

export const authFixtures = base.extend<object, AuthFixtures>({
  tim1StorageState: [
    async ({}, use) => {
      const path = STORAGE_STATE_PATH;
      let needsRefresh = false;

      if (!fs.existsSync(path)) {
        needsRefresh = true;
      } else {
        const stat = fs.statSync(path);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > FRESHNESS_THRESHOLD_MS) {
          needsRefresh = true;
        }
      }

      if (needsRefresh) {
        // Phase 0: surface a clear error pointing the developer at
        // globalSetup. Phase 1 will swap this for an in-fixture re-login
        // that calls the framework API client.
        throw new Error(
          `auth.fixture: storage state at ${path} is missing or stale ` +
            `(threshold ${GW_SESSION_TTL_MINUTES - SAFETY_MARGIN_MINUTES}m). ` +
            `Re-run \`playwright test\` to trigger globalSetup, or remove ` +
            `the file and rerun. Phase 1 will add in-fixture re-login.`
        );
      }

      await use(path);
    },
    { scope: 'worker' },
  ],
});

/**
 * Helper for Phase 1 framework code that needs an authenticated request
 * context constructed from the storage state. The API client (D-42)
 * accepts an `APIRequestContext` from the caller — this is how callers
 * build that context.
 */
export function attachStorageState(
  state: string
): { storageState: string } {
  return { storageState: state };
}

// Re-export the Playwright type so consumers don't have to import it from
// @playwright/test directly when wiring up the API client.
export type { APIRequestContext };
