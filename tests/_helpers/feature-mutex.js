// @ts-check
/**
 * Cross-worker mutex for @pepi feature areas.
 *
 * Why this exists: Pepi tests share qa3 firm/account state (mostly firm 106).
 * Different feature areas touch disjoint endpoints/data and can run in parallel,
 * but tests *within* a feature area race each other. We use a directory-based
 * file lock (atomic mkdir) so each feature area is serialized across Playwright
 * workers without serializing the whole suite.
 *
 * This is a temporary scaffold until per-test data isolation is in place.
 * Once each test seeds its own firm/account, delete this file and the
 * monkey-patch in playwright.config.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_DIR = path.join(os.tmpdir(), 'pepi-feature-locks');
fs.mkdirSync(LOCK_DIR, { recursive: true });

// If a worker crashes mid-test, its lock would be orphaned. We treat any lock
// older than this as stale and steal it. Must comfortably exceed the longest
// single test (Pepi specs cap at test.setTimeout(180_000) = 3 min).
const STALE_MS = 5 * 60 * 1000;
const POLL_MS = 200;

/**
 * Map an absolute spec file path to its feature-area lock name.
 * Returns null for tests outside the recognized feature areas — those run
 * without any lock (full parallelism).
 *
 * @param {string} filePath
 * @returns {string | null}
 */
function deriveFeature(filePath) {
  const p = filePath.replace(/\\/g, '/');
  // Migrated to per-worker dummy firms (workerFirm fixture) — no lock needed.
  if (p.includes('/bucket-exclusions/')) return null;
  if (p.includes('/unmanaged-assets/')) return null;
  // auto-link is read-only smoke (closes Create User modal before submit) and
  // needs no isolation.
  if (p.includes('/platform-one/auto-link/')) return null;
  // merge-prospect is migrated to dummy firms but the parallel flow is flaky
  // (qa2 contact search lags 30s+ for a freshly-created dummy firm under
  // parallel load — single-worker passes, workers=2+ fails). Serialise via
  // mutex until the search timing is understood.
  if (p.includes('/platform-one/merge-prospect/')) return 'merge-prospect';
  // Mutates billing fields then reverts; needs an Admin/Non-Admin user pair
  // that the dummy-firm endpoint does not provide. Stays serialised on a
  // single shared firm 106 account until the test data shape is reworked.
  if (p.includes('/account-billing/')) return 'account-billing';
  return null;
}

/**
 * Block until the named lock is acquired. Returns the lock path so the caller
 * can release it. Uses atomic mkdir as the lock primitive.
 *
 * @param {string} name
 * @returns {Promise<string>}
 */
async function acquire(name) {
  const lockPath = path.join(LOCK_DIR, `${name}.lock`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(
        path.join(lockPath, 'owner'),
        `${process.pid}@${Date.now()}\n`
      );
      return lockPath;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }

    // Lock is held — check if it's stale before sleeping.
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > STALE_MS) {
        try {
          fs.rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // someone else stole it; loop and retry
        }
        continue;
      }
    } catch {
      // lock vanished between EEXIST and stat — retry immediately
      continue;
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * Release a previously acquired lock. Safe to call multiple times.
 * @param {string} lockPath
 */
function release(lockPath) {
  try {
    fs.rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // already gone
  }
}

module.exports = { deriveFeature, acquire, release, LOCK_DIR };
