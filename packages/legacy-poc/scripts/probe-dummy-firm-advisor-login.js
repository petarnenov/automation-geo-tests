// @ts-check
/**
 * Probe: create a fresh dummy firm and try to log in as its advisor with the
 * standard qa3 password (the same one tim1/tim106 use). Reports whether the
 * advisor lands on #dashboard, which is the prerequisite for using dummy firms
 * for advisor-side tests (merge-prospect, auto-link, etc.).
 *
 * Usage: node scripts/probe-dummy-firm-advisor-login.js
 */

// Phase 0 Step 0.C: load .env.local from workspace root for standalone scripts.
require('../load-env');

const { chromium, request } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const STORAGE = path.join(__dirname, '..', 'tests', '.auth', 'tim1.json');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testrail.config.json'), 'utf8'));
const BASE = cfg.appUnderTest.url.replace(/\/$/, '');
const STANDARD_PASSWORD = process.env.TIM1_PASSWORD;
if (!STANDARD_PASSWORD) {
  console.error('probe-dummy-firm-advisor-login: TIM1_PASSWORD must be set in .env.local.');
  process.exit(2);
}

async function createDummyFirm() {
  const ctx = await request.newContext({
    baseURL: BASE,
    storageState: STORAGE,
    ignoreHTTPSErrors: true,
  });
  const res = await ctx.fetch('/qa/createDummyFirm.do', { method: 'POST' });
  const data = JSON.parse(await res.text());
  await ctx.dispose();
  if (!data.success) throw new Error('createDummyFirm did not return success');
  return data;
}

async function tryLogin(username, password) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const result = { username, password, success: false, landedUrl: null, error: null };
  try {
    await page.goto(BASE + '/');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('textbox', { name: 'username' }).fill(username);
    await page.getByRole('textbox', { name: 'password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    // Wait for either #dashboard (advisor success), #platformOne (admin success),
    // or any error indicator. Cap at 15s.
    try {
      await page.waitForURL(/#(dashboard|platformOne)/, { timeout: 15_000 });
      result.success = true;
      result.landedUrl = page.url();
    } catch {
      result.landedUrl = page.url();
      // Try to capture any visible error message on the login page.
      try {
        const errText = await page.locator('body').innerText({ timeout: 1000 });
        const lines = errText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const errLine = lines.find((l) => /invalid|incorrect|fail|error/i.test(l));
        if (errLine) result.error = errLine;
      } catch {
        // ignore
      }
    }
  } catch (err) {
    result.error = err.message;
  } finally {
    await browser.close();
  }
  return result;
}

(async () => {
  console.log('1. Creating dummy firm…');
  const firm = await createDummyFirm();
  console.log(`   firmCd=${firm.firm.firmCd}  firmName=${firm.firm.firmName}`);
  const advisorLogins = firm.users.map((u) => u.loginName);
  const adminLogin = firm.adminUser.loginName;
  console.log(`   adminUser=${adminLogin}`);
  console.log(`   advisors=${advisorLogins.join(', ')}`);

  // 2. Try adv_<firmCd>_1 with the standard password.
  console.log(`\n2. Logging in as ${advisorLogins[0]} with standard password…`);
  const advResult = await tryLogin(advisorLogins[0], STANDARD_PASSWORD);
  console.log('   →', advResult);

  // 3. If that failed, also try the admin user with the standard password to
  //    see if it's a password issue or a per-user-type quirk.
  if (!advResult.success) {
    console.log(`\n3. Falling back: logging in as ${adminLogin} with standard password…`);
    const adminResult = await tryLogin(adminLogin, STANDARD_PASSWORD);
    console.log('   →', adminResult);
  }

  console.log('\n=== summary ===');
  console.log(
    advResult.success
      ? `OK — ${advisorLogins[0]} logs in with the standard qa3 password and lands on ${advResult.landedUrl}`
      : `BLOCKED — ${advisorLogins[0]} cannot log in with the standard password`
  );
})();
