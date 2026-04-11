/**
 * `workerFirm` / `firmPool` — firm pool fixtures.
 *
 * Reads from the manifest that `globalSetup` writes at the start of
 * a run. There is zero API traffic in the fixture path — every firm
 * in the pool exists before the first spec begins, and every per-role
 * storage state is already on disk.
 *
 * Per-worker firm pinning: `firmPool` returns a single-element array
 * containing `manifest.firms[workerInfo.parallelIndex]`. Two Playwright
 * workers therefore never see the same firm, so cross-worker session
 * collisions are structurally impossible. Within one worker, all
 * pool-backed per-role page fixtures (`firmAdminPage`, ...) resolve to
 * the same firm, giving automatic co-location for tests that mix roles.
 */

import { test as base, mergeTests, type Page } from '@playwright/test';
import { authFixtures } from './auth.fixture';
import { apiFixtures } from './api.fixture';
import { loadManifest, type FirmManifestEntry } from './firmManifest';

// Merge upstream fixtures so this file can compose the auth freshness
// check + apiClient without re-declaring them. `apiClient` is still
// exposed here for specs that need direct API access (e.g. a spec
// that seeds extra state via the QA endpoints) even though
// createDummyFirmExtended itself no longer runs from a fixture.
const baseWithApi = mergeTests(base, authFixtures, apiFixtures);

/**
 * Test-facing shape: one manifest entry plus the shared password
 * every dummy firm user accepts. All qa users — admin, tim, gwAdmin,
 * nonGwAdmin, and advisors — share `process.env.TIM1_PASSWORD` by qa
 * convention.
 *
 * `WorkerFirm extends FirmManifestEntry` so top-level accessors
 * (`firmCd`, `advisor`, `household`, `client`, `accounts`, `logins`,
 * `firmName`, `firmUrl`) are all present without re-listing them here.
 */
export interface WorkerFirm extends FirmManifestEntry {
  /** Top-level admin accessor — hoisted from `logins.admin` so
   *  existing specs that read `firm.admin.loginName` /
   *  `firm.admin.entityId` keep working. */
  readonly admin: { readonly loginName: string; readonly entityId: string };
  /** Shared qa password (tim1/admin/advisors/tyler/etc. all use it). */
  readonly password: string;
}

export type WorkerFirmFixtures = {
  /** A single firm from the pool — preserved for backwards compat
   *  with worker-scoped consumers (the framework smoke spec, etc.). */
  workerFirm: WorkerFirm;
  /** Full pool of FIRM_POOL_SIZE firms read from the manifest. */
  firmPool: WorkerFirm[];
};


/** Hoist the top-level `admin` accessor from `logins.admin` so legacy
 *  consumers of `firm.admin.entityId` keep working. Throws if the
 *  manifest entry's admin login lacks an entityId (which would mean
 *  globalSetup wrote a malformed manifest — fail loudly). */
function hoistAdmin(
  entry: FirmManifestEntry
): { loginName: string; entityId: string } {
  const login = entry.logins.admin;
  if (login.entityId === null) {
    throw new Error(
      `workerFirm: manifest entry for firm ${entry.firmCd} has logins.admin.entityId === null ` +
        `— regenerate with REBUILD_FIRMS=1 (Commit 2 added the field).`
    );
  }
  return { loginName: login.loginName, entityId: login.entityId };
}

/** Materialize a `WorkerFirm` from a manifest entry + shared password. */
function toWorkerFirm(entry: FirmManifestEntry, password: string): WorkerFirm {
  return {
    ...entry,
    admin: hoistAdmin(entry),
    password,
  };
}

export const workerFirmFixtures = baseWithApi.extend<object, WorkerFirmFixtures>({
  firmPool: [
    async ({}, use, workerInfo) => {
      const password = process.env.TIM1_PASSWORD;
      if (!password) {
        throw new Error('firmPool: TIM1_PASSWORD must be set in workspace .env.local.');
      }
      const manifest = loadManifest();
      // Per-worker firm pinning: each Playwright worker owns exactly
      // ONE firm from the manifest, indexed by `workerInfo.parallelIndex`.
      // Two workers therefore never see the same firm, which makes
      // cross-worker `(firm, role)` collisions structurally impossible
      // — there is nothing to coordinate because they cannot reach the
      // same server-side HttpSession via a shared stored JSESSIONID.
      //
      // Consequences:
      //   - Every test in a worker runs against the same firm for the
      //     whole worker lifetime. Consecutive tests re-use its state
      //     (dummy firms accumulate by design, no cleanup).
      //   - Co-location across role fixtures in one test is automatic:
      //     `firmAdminPage + firmAdvisorPage1` both resolve to the
      //     single pool entry → same firm → same backend.
      //   - `workers > FIRM_POOL_SIZE` is forbidden; the guard below
      //     matches the cap in `definePlaywrightConfig`.
      if (workerInfo.parallelIndex >= manifest.firms.length) {
        throw new Error(
          `firmPool: Playwright worker parallelIndex=${workerInfo.parallelIndex} ` +
            `exceeds manifest firm count ${manifest.firms.length}. Cap --workers to ` +
            `<= ${manifest.firms.length} or increase FIRM_POOL_SIZE in firmManifest.ts ` +
            `and rebuild the pool with REBUILD_FIRMS=1.`
        );
      }
      const mine = manifest.firms[workerInfo.parallelIndex];
      await use([toWorkerFirm(mine, password)]);
    },
    { scope: 'worker' },
  ],

  workerFirm: [
    async ({ firmPool }, use) => {
      if (firmPool.length === 0) {
        throw new Error('workerFirm: manifest contains zero firms — run globalSetup first.');
      }
      // Pool now contains exactly one firm (the worker's pinned slice)
      // so this is equivalent to returning "the worker's firm".
      await use(firmPool[0]);
    },
    { scope: 'worker' },
  ],
});

/**
 * Side-channel map from a per-role Page to the firm that backs it.
 * Populated by per-role page fixtures in `pages.fixture.ts`. Tests
 * call `getFirmForPage(page)` to recover the firm identity behind
 * a pool-backed page.
 *
 * WeakMap so closed Pages are GC'd with their firm reference — we
 * do not want a closed Page to keep a WorkerFirm alive.
 *
 * With per-worker pinning the pool has exactly one firm per worker,
 * so in practice every pool-backed page in a single worker resolves
 * to the same WorkerFirm. The map is kept because it lets
 * `getFirmForPage(page)` throw cleanly when called on a non-pool
 * Page (e.g. one from a legacy form-login fixture).
 */
const pageToFirm = new WeakMap<Page, WorkerFirm>();

export function stampPageFirm(page: Page, firm: WorkerFirm): void {
  pageToFirm.set(page, firm);
}

export function getFirmForPage(page: Page): WorkerFirm {
  const firm = pageToFirm.get(page);
  if (!firm) {
    throw new Error(
      'getFirmForPage: this Page was not created by a pool-based firm fixture. ' +
        'Only pages yielded by firmAdminPage/firmGwAdminPage/etc. carry firm identity.'
    );
  }
  return firm;
}
