/**
 * Firm manifest — shared types and path helpers for the pre-created
 * dummy firm pool.
 *
 * `globalSetup` writes `.auth/firms.json` and 28 storage-state files
 * (4 firms × 7 logins each) at the start of a `playwright test` run.
 * Worker-scoped fixtures read the manifest and hand tests a
 * pre-logged-in `Page` per role — no form login in the test path.
 *
 * This module is imported by both the writer (globalSetup) and the
 * readers (workerFirm / pages fixtures), so types, paths, and the
 * freshness check live here instead of duplicated at each end.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { WORKSPACE_ROOT } from '../config/dotenv-loader';
import type { EnvironmentName } from '../config/environments';

/**
 * Target firm pool size. Must equal `workers` in `definePlaywrightConfig`
 * so every parallel worker can check out its own firm. Commit 4 of the
 * extended-firm migration pins `workers: 4` framework-wide; keep this
 * constant in lockstep.
 */
export const FIRM_POOL_SIZE = 4;

/** `.auth/` directory (holds tim1.json, firms.json, and firms/<firmCd>/). */
export const AUTH_DIR = path.join(WORKSPACE_ROOT, '.auth');

/** Path to the manifest JSON written by globalSetup. */
export const FIRMS_MANIFEST_PATH = path.join(AUTH_DIR, 'firms.json');

/** Directory that holds per-firm per-role storage states. */
export const FIRMS_STORAGE_DIR = path.join(AUTH_DIR, 'firms');

/**
 * Named role slots for a firm. The `advisor-1..3` names map to the
 * three advisors returned by the extended endpoint, sorted by their
 * numeric loginName suffix.
 */
export type FirmRole =
  | 'admin'
  | 'tim'
  | 'gwAdmin'
  | 'nonGwAdmin'
  | 'advisor-1'
  | 'advisor-2'
  | 'advisor-3';

/** All roles in the order globalSetup provisions them. */
export const FIRM_ROLES: readonly FirmRole[] = [
  'admin',
  'tim',
  'gwAdmin',
  'nonGwAdmin',
  'advisor-1',
  'advisor-2',
  'advisor-3',
];

/**
 * Absolute path to the storage-state file for a given firm/role
 * pair. `.auth/firms/<firmCd>/<role>.json`.
 */
export function firmStoragePath(firmCd: number, role: FirmRole): string {
  return path.join(FIRMS_STORAGE_DIR, String(firmCd), `${role}.json`);
}

/**
 * Post-login `sessionStorage` snapshot for a role. Playwright's
 * `storageState()` captures cookies + localStorage but NOT
 * sessionStorage, and empirically the qa SPA puts its post-login
 * bootstrap keys (`gw.whitelabelStaticFolder`, etc.) in
 * sessionStorage. We grab it manually via `page.evaluate` and replay
 * it in consumer fixtures through `context.addInitScript`.
 */
export type SessionStorageSnapshot = Record<string, string>;

/**
 * One login entry in the manifest. `storageState` is an absolute path.
 * `entityId` is populated only for the `admin` role (the top-level
 * `adminUser.entityId` from the createDummyFirmExtended response); for
 * all other roles it is `null`.
 *
 * `sessionStorage` holds the post-login `window.sessionStorage`
 * snapshot captured alongside the cookies; see SessionStorageSnapshot
 * for the rationale.
 */
export interface FirmManifestLogin {
  readonly role: FirmRole;
  readonly loginName: string;
  readonly name: string | null;
  readonly entityId: string | null;
  readonly storageState: string;
  readonly sessionStorage: SessionStorageSnapshot;
}

/**
 * One firm entry in the manifest. Preserves the flattened
 * household/client/accounts view that the existing workerFirm fixture
 * consumers rely on, plus the new `logins` map.
 */
export interface FirmManifestEntry {
  readonly firmCd: number;
  readonly firmName: string;
  readonly firmUrl: string | null;
  readonly logins: {
    readonly admin: FirmManifestLogin;
    readonly tim: FirmManifestLogin;
    readonly gwAdmin: FirmManifestLogin;
    readonly nonGwAdmin: FirmManifestLogin;
    readonly advisors: readonly FirmManifestLogin[];
  };
  /** Primary advisor hoisted from DummyFirm.advisor (first flatten tuple). */
  readonly advisor: { readonly loginName: string; readonly name: string };
  readonly household: { readonly uuid: string; readonly name: string };
  readonly client: { readonly uuid: string; readonly name: string };
  readonly accounts: ReadonlyArray<{
    readonly uuid: string;
    readonly num: string;
    readonly title: string;
  }>;
}

export interface FirmManifest {
  /** ISO timestamp of when this manifest was written. */
  readonly createdAt: string;
  /** Environment the firms were created against (qa2, qa4, etc.). */
  readonly env: EnvironmentName;
  readonly firms: readonly FirmManifestEntry[];
}

/**
 * Session freshness threshold in milliseconds. Mirrors the pattern in
 * `auth.fixture.ts` — the underlying SPA sessions last ~8 hours; we
 * subtract a safety margin so the manifest is considered stale well
 * before any individual session actually expires.
 */
function freshnessThresholdMs(): number {
  const ttlMinutes = Number(process.env.GW_SESSION_TTL_MINUTES ?? 480);
  const safetyMargin = 30;
  return (ttlMinutes - safetyMargin) * 60_000;
}

/**
 * Cheap reuse gate for globalSetup. Returns `true` when a previous
 * manifest can be reused as-is:
 *
 *   1. `.auth/firms.json` exists and is younger than the TTL minus
 *      safety margin;
 *   2. It parses into a manifest that matches the target env;
 *   3. It contains at least `FIRM_POOL_SIZE` firms; and
 *   4. Every storage-state file it references actually exists on disk.
 *
 * Any single failure returns `false`, and globalSetup rebuilds the pool.
 */
export function readFreshManifest(env: EnvironmentName): FirmManifest | null {
  if (!fs.existsSync(FIRMS_MANIFEST_PATH)) return null;

  const stat = fs.statSync(FIRMS_MANIFEST_PATH);
  const ageMs = Date.now() - stat.mtimeMs;
  if (ageMs > freshnessThresholdMs()) return null;

  let parsed: FirmManifest;
  try {
    parsed = JSON.parse(fs.readFileSync(FIRMS_MANIFEST_PATH, 'utf-8')) as FirmManifest;
  } catch {
    return null;
  }

  if (parsed.env !== env) return null;
  if (!Array.isArray(parsed.firms) || parsed.firms.length < FIRM_POOL_SIZE) return null;

  for (const firm of parsed.firms) {
    const paths: string[] = [
      firm.logins.admin.storageState,
      firm.logins.tim.storageState,
      firm.logins.gwAdmin.storageState,
      firm.logins.nonGwAdmin.storageState,
      ...firm.logins.advisors.map((a: FirmManifestLogin) => a.storageState),
    ];
    for (const p of paths) {
      if (!fs.existsSync(p)) return null;
    }
  }

  return parsed;
}

/**
 * Write a manifest to `.auth/firms.json`. Creates the directory if
 * missing. Callers are expected to have already written every
 * referenced storage-state file.
 */
export function writeManifest(manifest: FirmManifest): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(FIRMS_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/**
 * Load the manifest from disk. Throws with a clear error if missing
 * or malformed — fixtures call this and treat any failure as "run
 * globalSetup first".
 */
export function loadManifest(): FirmManifest {
  if (!fs.existsSync(FIRMS_MANIFEST_PATH)) {
    throw new Error(
      `firmManifest: ${FIRMS_MANIFEST_PATH} not found. Run \`playwright test\` ` +
        `so globalSetup can provision the firm pool, or set FIRM_POOL_SIZE=0 ` +
        `to opt out (when supported).`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(FIRMS_MANIFEST_PATH, 'utf-8')) as FirmManifest;
  } catch (e) {
    throw new Error(
      `firmManifest: failed to parse ${FIRMS_MANIFEST_PATH}: ${(e as Error).message}`
    );
  }
}
