/**
 * `workerFirm` worker-scoped fixture — provisions a fresh dummy firm
 * once per Playwright worker via `/qa/createDummyFirm.do` and yields
 * the flat `WorkerFirm` view to every spec in that worker.
 *
 * Phase 2 step 3 (D-37). Mirror of the legacy POC's
 * `packages/legacy-poc/tests/_helpers/worker-firm.js` (the program's
 * single most valuable asset per the C25193 entry spike). Critical
 * differences from the legacy version:
 *
 *   - Typed via `DummyFirmApi` + Zod schema instead of hand-rolled
 *     `JSON.parse` + flatten().
 *   - Uses Playwright's `APIRequestContext` (D-42) via the `apiClient`
 *     fixture instead of Node `fetch` + manually-stitched Cookie
 *     header. The legacy fetch path was a workaround for the trace
 *     cleanup race documented in the spike's OQ-1; the framework
 *     starts with the typed path and falls back only if the race
 *     reproduces against current Playwright (1.59.x).
 *   - No teardown — feedback_dummy_firm_cleanup is settled. Dummy
 *     firms accumulate by design per Section 5.8.
 *
 * Per Section 4.5 the fixture is **worker-scoped**: every worker pays
 * the ~6s creation cost once at first use, then every spec in the
 * worker reuses the same firm. Specs that need a *fresh per-test*
 * firm consume the (future) `freshFirm` test-scoped fixture instead.
 *
 * The fixture extends the bare `DummyFirm` shape (which is just the
 * API response) with a `password` field set to `process.env
 * .TIM1_PASSWORD`. All dummy firm users — admin and advisors — share
 * the standard tim1 password by qa convention; the password is
 * needed by every login helper (see legacy
 * `loginAsWorkerFirmAdmin`).
 */

import { test as base, mergeTests, chromium } from '@playwright/test';
import { DummyFirmApi, type DummyFirm, createDummyFirmResponseSchema } from '../api/qa/DummyFirmApi';
import { authFixtures } from './auth.fixture';
import { apiFixtures } from './api.fixture';
import { selectEnvironment } from '../config/environments';
import { loginViaForm } from './loginViaForm';

// Merge upstream fixtures so this file can consume `apiClient`
// without re-declaring it. See the same pattern in api.fixture.ts.
const baseWithApi = mergeTests(base, authFixtures, apiFixtures);

/**
 * Test-facing shape: a provisioned dummy firm plus the shared
 * password every dummy firm user accepts. The bare `DummyFirm` from
 * the API client does not include the password (the response never
 * carries it); the fixture layers it on at construction time.
 */
export interface WorkerFirm extends DummyFirm {
  /**
   * The shared password every dummy firm user accepts. Always equal
   * to `process.env.TIM1_PASSWORD` — qa convention is that admin,
   * advisors, and tim<N> all use the same password.
   */
  readonly password: string;
}

export type WorkerFirmFixtures = {
  workerFirm: WorkerFirm;
  /** Pool of N dummy firms created once per worker. Test-scoped
   *  `testFirm` picks a unique firm by test index. */
  firmPool: WorkerFirm[];
};

export type TestFirmFixtures = {
  /** A unique firm from the worker's pool, assigned by test parallel index.
   *  Use this when multiple tests in the same worker must not share a firm. */
  testFirm: WorkerFirm;
};

export const workerFirmFixtures = baseWithApi.extend<object, WorkerFirmFixtures>({
  workerFirm: [
    async ({ apiClient }, use) => {
      const password = process.env.TIM1_PASSWORD;
      if (!password) {
        // Surface the error early — without TIM1_PASSWORD the dummy
        // firm users cannot be logged in, so the fixture is useless
        // even if `createDummyFirm.do` itself succeeds.
        throw new Error(
          'workerFirm: TIM1_PASSWORD must be set in the workspace .env.local. ' +
            'Phase 0 Step 0.C moved every credential out of testrail.config.json ' +
            'into env vars.'
        );
      }

      let dummyFirm: DummyFirm;
      const env = selectEnvironment();

      if (env.baseUrl.startsWith('http://')) {
        // HTTP environments: APIRequestContext does not reliably carry
        // cookies over plain HTTP. Fall back to a browser-based call.
        const username = process.env.TIM1_USERNAME ?? 'tim1';
        const browser = await chromium.launch({
          args: [`--unsafely-treat-insecure-origin-as-secure=${env.baseUrl}`],
        });
        const context = await browser.newContext({ baseURL: env.baseUrl, ignoreHTTPSErrors: true });
        const page = await context.newPage();
        try {
          await loginViaForm(page, username, password, env.baseUrl);
          // Use page.evaluate + XMLHttpRequest to get raw JSON response
          // (fetch/page.request may not carry cookies over HTTP).
          const text = await page.evaluate(
            (url) =>
              new Promise<string>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', url, true);
                xhr.withCredentials = true;
                xhr.timeout = 120_000;
                xhr.onload = () => resolve(xhr.responseText);
                xhr.onerror = () => reject(new Error('XHR network error'));
                xhr.ontimeout = () => reject(new Error('XHR timeout'));
                xhr.send();
              }),
            '/qa/createDummyFirmExtended.do'
          );
          const raw = JSON.parse(text);
          dummyFirm = DummyFirmApi.fromRecordedResponse(raw);
        } finally {
          await browser.close();
        }
      } else {
        dummyFirm = await new DummyFirmApi(apiClient).create();
      }

      const workerFirm: WorkerFirm = { ...dummyFirm, password };
      await use(workerFirm);
      // No teardown — dummy firms accumulate per Section 5.8 of the
      // proposal and per the feedback_dummy_firm_cleanup memory.
    },
    { scope: 'worker' },
  ],

  firmPool: [
    async ({ apiClient }, use) => {
      const password = process.env.TIM1_PASSWORD;
      if (!password) {
        throw new Error('firmPool: TIM1_PASSWORD must be set.');
      }

      const poolSize = Number(process.env.FIRM_POOL_SIZE ?? '8');
      const firms: WorkerFirm[] = [];

      for (let i = 0; i < poolSize; i++) {
        const dummyFirm = await new DummyFirmApi(apiClient).create();
        firms.push({ ...dummyFirm, password });
      }

      await use(firms);
    },
    { scope: 'worker' },
  ],
});

/**
 * Simple checkout/return pool that guarantees no two concurrent
 * tests within the same worker get the same firm.
 */
class FirmCheckout {
  private readonly inUse = new Set<number>();

  checkout(pool: WorkerFirm[]): { firm: WorkerFirm; index: number } {
    for (let i = 0; i < pool.length; i++) {
      if (!this.inUse.has(i)) {
        this.inUse.add(i);
        return { firm: pool[i], index: i };
      }
    }
    throw new Error(
      `FirmCheckout: all ${pool.length} firms are in use. ` +
        `Increase FIRM_POOL_SIZE or reduce parallelism.`
    );
  }

  release(index: number): void {
    this.inUse.delete(index);
  }
}

/** One checkout instance per worker (module-level singleton). */
const checkout = new FirmCheckout();

/** Test-scoped fixture that checks out a unique firm from the pool
 *  and returns it when the test finishes. */
export const testFirmFixtures = workerFirmFixtures.extend<TestFirmFixtures>({
  testFirm: async ({ firmPool }, use) => {
    const { firm, index } = checkout.checkout(firmPool);
    try {
      await use(firm);
    } finally {
      checkout.release(index);
    }
  },
});
