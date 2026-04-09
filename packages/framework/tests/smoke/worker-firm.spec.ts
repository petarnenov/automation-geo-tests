/**
 * `workerFirm` fixture smoke spec.
 *
 * Phase 2 step 3 (D-37) verification path. The fixture is the
 * program's most valuable asset (the legacy POC's worker-firm.js,
 * lifted into a typed Playwright fixture). This spec exercises the
 * full chain on a real qa environment:
 *
 *   tim1StorageState (auth fixture)
 *     ↓
 *   apiRequestContext (api fixture)  ← APIRequestContext + storage state
 *     ↓
 *   apiClient (api fixture)          ← framework ApiClient + D-09 guard
 *     ↓
 *   workerFirm (this fixture)        ← DummyFirmApi.create() + flatten
 *
 * If any link in the chain breaks the spec fails loudly, which is
 * exactly what we want during the OQ-1 verification window — the
 * spike's open question 1 asks whether Playwright `APIRequestContext`
 * inside a worker fixture still triggers the legacy POC's trace
 * cleanup race against current Playwright (1.59.x). If it does,
 * `apiRequestContext._wrapApiCall` errors will surface here first.
 *
 * What this spec asserts (the contract `workerFirm` must satisfy):
 *
 *   - `firmCd` is a positive integer (every dummy firm gets a fresh
 *     auto-incrementing firmCd from `/qa/createDummyFirm.do`).
 *   - `firmName` matches the legacy `Firm-YYYYMMDDHHmmss` pattern.
 *   - `admin.loginName` matches `admin_<firmCd>`.
 *   - `admin.entityId` is a 32-char hex string (entity-id format).
 *   - `advisor.loginName` matches `adv_<firmCd>_<n>` for n in 1..3.
 *   - `accounts` has at least one account; each has a 32-char hex
 *     uuid and a non-empty num and title.
 *   - `password` is set (the fixture layered it on from
 *     process.env.TIM1_PASSWORD).
 *   - `tuples.length` is at least 1 (otherwise the fixture would
 *     have thrown).
 *
 * What this spec does NOT do:
 *   - Log in as the dummy firm admin or advisors. That belongs to
 *     the auth fixture's per-role pages (Phase 2 step 4). This spec
 *     verifies the fixture provisions a usable firm — login flow
 *     verification lives elsewhere.
 *   - Touch firm 106 or any static seed data.
 *   - Delete the firm. Per `feedback_dummy_firm_cleanup`, dummy
 *     firms accumulate by design; no teardown.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';

test('@smoke @framework workerFirm fixture provisions a usable dummy firm', async ({
  workerFirm,
}) => {
  // firmCd shape — auto-incrementing positive integer.
  expect(typeof workerFirm.firmCd).toBe('number');
  expect(workerFirm.firmCd).toBeGreaterThan(0);

  // firmName shape — "Firm-YYYYMMDDHHmmss" per the
  // reference_create_dummy_firm memory.
  expect(workerFirm.firmName).toMatch(/^Firm-\d{14}$/);

  // admin shape — loginName must equal `admin_<firmCd>`.
  expect(workerFirm.admin.loginName).toBe(`admin_${workerFirm.firmCd}`);
  expect(workerFirm.admin.entityId).toMatch(/^[0-9A-F]{32}$/);

  // advisor shape — loginName matches the `adv_<firmCd>_<n>` pattern.
  expect(workerFirm.advisor.loginName).toMatch(
    new RegExp(`^adv_${workerFirm.firmCd}_\\d+$`)
  );

  // household + client UUIDs are 32-char hex.
  expect(workerFirm.household.uuid).toMatch(/^[0-9A-F]{32}$/);
  expect(workerFirm.client.uuid).toMatch(/^[0-9A-F]{32}$/);

  // accounts: at least one, each well-formed.
  expect(workerFirm.accounts.length).toBeGreaterThanOrEqual(1);
  for (const account of workerFirm.accounts) {
    expect(account.uuid).toMatch(/^[0-9A-F]{32}$/);
    expect(account.num).toMatch(/^accnum-\d{14}-\d+-\d+$/);
    expect(account.title).toMatch(/^accnum-\d{14}-\d+-\d+$/);
  }

  // password layered on by the fixture from env.
  expect(workerFirm.password).toBeTruthy();

  // tuples — at least one usable household/client/accounts triplet.
  expect(workerFirm.tuples.length).toBeGreaterThanOrEqual(1);

  // The hoisted top-level fields equal the first tuple.
  expect(workerFirm.advisor).toEqual(workerFirm.tuples[0].advisor);
  expect(workerFirm.household).toEqual(workerFirm.tuples[0].household);
  expect(workerFirm.client).toEqual(workerFirm.tuples[0].client);
  expect(workerFirm.accounts).toEqual(workerFirm.tuples[0].accounts);
});
