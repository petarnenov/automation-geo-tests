// @ts-check
/**
 * Playwright globalSetup:
 *
 * 1. Log in once as the Platform One admin (tim1) and persist the browser
 *    storage state to disk. worker-firm.js uses this for API calls
 *    (createDummyFirm).
 *
 * 2. Create 8 GW Admin users in firm 1 via the createUpdateUser endpoint,
 *    log in as each one and save individual storage states. Each Playwright
 *    worker receives its own GW Admin session so there is no cross-worker
 *    session invalidation.
 *
 * GW Admin sessions are cached: if gwadmins.json exists, was created less
 * than 6 hours ago, and all storage state files are present, the cached
 * credentials and sessions are reused without creating new admins or
 * logging in again.
 *
 * Output:
 *   tests/.auth/tim1.json        — tim1 session (API calls only)
 *   tests/.auth/gwadmin-N.json   — per-worker GW Admin sessions (N = 0..7)
 *   tests/.auth/gwadmins.json    — index with credentials + createdAt timestamp
 */

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'testrail.config.json'), 'utf8')
);

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'tim1.json');
const GW_ADMINS_PATH = path.join(AUTH_DIR, 'gwadmins.json');
const WORKER_COUNT = 8;
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Check whether the cached GW Admin sessions are still fresh.
 * Returns the parsed gwadmins array if valid, or null if stale/missing.
 */
function loadCachedAdmins() {
  if (!fs.existsSync(GW_ADMINS_PATH)) return null;

  let cached;
  try {
    cached = JSON.parse(fs.readFileSync(GW_ADMINS_PATH, 'utf8'));
  } catch {
    return null;
  }

  // Must have createdAt and correct count
  if (!cached.createdAt || !Array.isArray(cached.admins) || cached.admins.length < WORKER_COUNT) {
    return null;
  }

  // Must target the same environment
  if (cached.baseUrl && cached.baseUrl !== cfg.appUnderTest.url) {
    return null;
  }

  // Must be younger than 6 hours
  const age = Date.now() - new Date(cached.createdAt).getTime();
  if (age > MAX_AGE_MS) return null;

  // All storage state files must exist
  for (const admin of cached.admins) {
    if (!admin.storageStatePath || !fs.existsSync(admin.storageStatePath)) {
      return null;
    }
  }

  return cached.admins;
}

async function globalSetup() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();

  // ── Step 1: tim1 session ──────────────────────────────────────────────
  const tim1Ctx = await browser.newContext();
  const tim1Page = await tim1Ctx.newPage();
  try {
    await tim1Page.goto(cfg.appUnderTest.url);
    await tim1Page.waitForURL(/#login/, { timeout: 60_000 });
    await tim1Page.getByPlaceholder(/email|username/i).fill(cfg.appUnderTest.username);
    await tim1Page.getByPlaceholder(/password/i).fill(cfg.appUnderTest.password);
    await tim1Page.getByRole('button', { name: 'Login' }).click();
    await tim1Page.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
    await tim1Ctx.storageState({ path: STORAGE_STATE_PATH });
    console.log(`[global-setup] tim1 storage state saved → ${STORAGE_STATE_PATH}`);
  } finally {
    await tim1Ctx.close();
  }

  // ── Step 2: reuse or create GW Admins ─────────────────────────────────
  const cached = loadCachedAdmins();

  if (cached) {
    const age = Date.now() - new Date(
      JSON.parse(fs.readFileSync(GW_ADMINS_PATH, 'utf8')).createdAt
    ).getTime();
    const mins = Math.round(age / 60_000);
    console.log(
      `[global-setup] reusing ${cached.length} cached GW Admins ` +
        `(created ${mins} min ago, valid for ${Math.round((MAX_AGE_MS - age) / 60_000)} more min)`
    );
    await browser.close();
    return;
  }

  console.log('[global-setup] creating fresh GW Admins…');

  // Lazy-require after tim1.json exists — createGwAdmin reads its cookies.
  const { createGwAdmin } = require('./qa3');

  const gwAdmins = [];
  for (let i = 0; i < WORKER_COUNT; i++) {
    const admin = await createGwAdmin(`gwa${i}`);
    admin.storageStatePath = path.join(AUTH_DIR, `gwadmin-${i}.json`);
    gwAdmins.push(admin);
    console.log(`[global-setup] created GW Admin ${i}: ${admin.username}`);
  }

  // ── Step 3: log in as each GW Admin and save storage state ────────────
  for (let i = 0; i < gwAdmins.length; i++) {
    const admin = gwAdmins[i];
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(cfg.appUnderTest.url);
      await page.waitForURL(/#login/, { timeout: 60_000 });
      await page.getByPlaceholder(/email|username/i).fill(admin.username);
      await page.getByPlaceholder(/password/i).fill(admin.password);
      await page.getByRole('button', { name: 'Login' }).click();
      await page.waitForURL(/#(platformOne|dashboard)/, { timeout: 60_000 });
      await ctx.storageState({ path: admin.storageStatePath });
      console.log(`[global-setup] gwadmin-${i} storage state saved`);
    } finally {
      await ctx.close();
    }
  }

  // ── Step 4: write index with timestamp ────────────────────────────────
  const index = {
    createdAt: new Date().toISOString(),
    baseUrl: cfg.appUnderTest.url,
    admins: gwAdmins,
  };
  fs.writeFileSync(GW_ADMINS_PATH, JSON.stringify(index, null, 2));
  console.log(`[global-setup] gwadmins index saved → ${GW_ADMINS_PATH}`);

  await browser.close();
}

module.exports = globalSetup;
module.exports.STORAGE_STATE_PATH = STORAGE_STATE_PATH;
module.exports.GW_ADMINS_PATH = GW_ADMINS_PATH;
