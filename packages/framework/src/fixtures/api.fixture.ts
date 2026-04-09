/**
 * `apiClient` worker-scoped fixture — provides the framework's
 * `ApiClient` (transport over a pre-authenticated `APIRequestContext`)
 * to every spec in the worker.
 *
 * Phase 2 step 3 (D-37). Per Section 4.5 of the proposal:
 *
 *   Worker scope: workerFirm, apiClient.
 *   Test scope:   authenticatedPage (per role), testFirm.
 *
 * Per Decision D-42 the API client accepts an `APIRequestContext` from
 * the caller; this fixture is the canonical caller. It builds the
 * context with the workspace-root tim1 storage state attached (so the
 * context inherits the cross-firm GW Admin session) and the current
 * environment's baseURL.
 *
 * **OQ-1 verification moment.** The C25193 entry spike's open question
 * 1 is: does Playwright `APIRequestContext` inside a worker fixture
 * still trigger the legacy POC's trace cleanup race against current
 * Playwright (1.59.x)? If yes, the fallback is to swap the transport
 * for a Node `fetch` backed alternative. The verification path is to
 * ship this fixture, run it under parallel load (8 workers × the full
 * @regression scope), and watch for `apiRequestContext._wrapApiCall`
 * errors in test output. If none appear, OQ-1 is closed in favor of
 * APIRequestContext.
 *
 * The fixture disposes the request context at worker teardown so it
 * does not leak across workers.
 */

import { test as base, request as playwrightRequest, mergeTests } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { ApiClient } from '../api/client';
import { selectEnvironment } from '../config/environments';
import { authFixtures } from './auth.fixture';

// Merge auth into the base so this file can consume `tim1StorageState`
// without re-declaring it. The top-level base.ts also calls mergeTests
// over (authFixtures, apiFixtures, workerFirmFixtures) — that final
// merge is what specs see; the intermediate merge here is purely so
// TypeScript knows about the upstream fixture's name and shape.
const baseWithAuth = mergeTests(base, authFixtures);

export type ApiFixtures = {
  /**
   * The framework `ApiClient`, pre-authenticated as the cross-firm
   * GW Admin (tim1) and pointed at the current environment. Worker-
   * scoped: instantiated once per worker, shared across every test
   * in that worker.
   */
  apiClient: ApiClient;

  /**
   * Lower-level access to the underlying `APIRequestContext`. Most
   * specs should consume `apiClient` (which has the production
   * safety guard + content-type quirk handling) rather than this
   * raw context. Exposed for the rare case a spec needs to call an
   * endpoint the typed wrappers do not yet cover.
   */
  apiRequestContext: APIRequestContext;
};

export const apiFixtures = baseWithAuth.extend<object, ApiFixtures>({
  apiRequestContext: [
    async ({ tim1StorageState }, use) => {
      const env = selectEnvironment();
      const ctx = await playwrightRequest.newContext({
        baseURL: env.baseUrl,
        ignoreHTTPSErrors: true,
        storageState: tim1StorageState,
      });
      try {
        await use(ctx);
      } finally {
        // Dispose at worker teardown — without this, the context
        // would leak across workers and surface as
        // apiRequestContext._wrapApiCall errors during shutdown
        // (see OQ-1 in the C25193 entry spike).
        await ctx.dispose();
      }
    },
    { scope: 'worker' },
  ],

  apiClient: [
    async ({ apiRequestContext }, use) => {
      const env = selectEnvironment();
      const client = new ApiClient({
        request: apiRequestContext,
        environment: env.name,
      });
      await use(client);
    },
    { scope: 'worker' },
  ],
});
