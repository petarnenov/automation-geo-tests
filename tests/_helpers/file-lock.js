// @ts-check
/**
 * Cross-worker mutex for specs that mutate the same shared per-user state
 * (e.g. tim1's Billing Templates saved filters, where "exactly one Default"
 * breaks if two specs run at once). Playwright workers are separate
 * processes, so the lock is an exclusively-created file in the OS temp dir.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * @param {string} name     lock name, shared by every spec in the group
 * @param {{timeoutMs?: number, staleMs?: number}} [opts]
 * @returns {Promise<() => void>} release function
 */
async function acquireFileLock(name, { timeoutMs = 600_000, staleMs = 900_000 } = {}) {
  const file = path.join(os.tmpdir(), `pw-lock-${name}`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch (err) {
      if (/** @type {any} */ (err).code !== 'EEXIST') throw err;
      // A crashed holder never releases; reclaim locks older than staleMs.
      const age = Date.now() - fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs;
      if (age > staleMs) fs.rmSync(file, { force: true });
      if (Date.now() > deadline) throw new Error(`acquireFileLock(${name}): timed out`, { cause: err });
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

module.exports = { acquireFileLock };
