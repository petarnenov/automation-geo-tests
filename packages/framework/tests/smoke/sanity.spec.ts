/**
 * Framework sanity smoke spec.
 *
 * Phase 2 step 1.1 (D-37) walking-skeleton equivalent — exists so the
 * `framework` package's CI matrix shard has at least one spec to run.
 * Replaced (and supplemented) by real component smoke specs at
 * Phase 2 step 5 (Component lift), each living under
 * `tests/components/<ComponentName>.spec.ts` and exercising its
 * primary actions on a known qa2 page.
 *
 * What this spec verifies:
 *   1. The framework's `definePlaywrightConfig` produced a working
 *      Playwright runtime — i.e. the `test` import resolves and a
 *      browser can boot.
 *   2. The framework's environment selector returned a valid baseUrl
 *      for the configured `TEST_ENV`.
 *   3. The walking-skeleton page (qa2 root) is reachable.
 *
 * What this spec does NOT do:
 *   - Login. The `tim1` storage state is provisioned by globalSetup
 *     and consumed by the auth fixture; this spec deliberately runs
 *     **without** asserting login state so it stays resilient to
 *     auth-flow churn during Phase 2.
 *   - Test any business behaviour. Real component verification lands
 *     in step 5.
 */

import { test, expect } from '@playwright/test';

test('@smoke @framework sanity — Playwright runtime + framework config', async ({
  page,
  baseURL,
}) => {
  // 1. The baseURL was provided by definePlaywrightConfig — assert
  //    it points at one of the qa-environment hosts.
  expect(baseURL).toMatch(/^https:\/\/qa\d+\.geowealth\.com\/?$/);

  // 2. The walking-skeleton page (qa root) is reachable. This is the
  //    same check the framework's preflight runs as its first
  //    health gate (Section 5.9) but inside Playwright's test
  //    harness instead of as a CLI script — proves the test runner
  //    is wired correctly end-to-end.
  const response = await page.goto('/', { timeout: 30_000 });
  expect(response?.ok()).toBe(true);
});
