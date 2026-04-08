// @ts-check
/**
 * Playwright globalSetup: log in once as the Platform One admin (tim1) and
 * persist the browser storage state to disk. Each test then starts from that
 * storage state instead of going through the login form, which saves ~5s per
 * test (~3-5 minutes off the full @pepi suite).
 *
 * Tests that need to switch identity (e.g. to a firm advisor like tim106) still
 * call `context.clearCookies()` then re-login — that flow is unchanged. The
 * win is purely on the default tim1 path.
 *
 * Output: tests/.auth/tim1.json (gitignored).
 */

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'testrail.config.json'), 'utf8')
);

const STORAGE_STATE_PATH = path.join(__dirname, '..', '.auth', 'tim1.json');

async function globalSetup() {
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(cfg.appUnderTest.url);
    // qa3 routes to /#login asynchronously after the SPA boots; wait for it
    // before touching the form fields. The form uses placeholder-only inputs
    // (no role/name/label), so we match by placeholder.
    await page.waitForURL(/#login/, { timeout: 30_000 });
    await page.getByPlaceholder(/email|username/i).fill(cfg.appUnderTest.username);
    await page.getByPlaceholder(/password/i).fill(cfg.appUnderTest.password);
    await page.getByRole('button', { name: 'Login' }).click();
    // Wait until any post-login URL transition completes. tim1 may land on
    // either #platformOne (legacy admin landing) or #dashboard (advisor
    // landing) depending on qa3 state — we don't care which, we just need a
    // valid session captured into storageState. Upload tests later navigate
    // to #platformOne URLs explicitly, which works either way.
    await page.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log(`[global-setup] tim1 storage state saved → ${STORAGE_STATE_PATH}`);
  } finally {
    await browser.close();
  }
}

module.exports = globalSetup;
module.exports.STORAGE_STATE_PATH = STORAGE_STATE_PATH;
