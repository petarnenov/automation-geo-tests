// @ts-check
/**
 * Diagnostic: flip gw_admin_flag=0 on a dummy advisor and verify the
 * "Merge With Prospect" button disappears in the Edit Client view.
 *
 * Usage: node scripts/debug-noperm-advisor.js <firmCd> <advisorLoginName> <clientLastNamePrefix>
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const firmCd = Number(process.argv[2] || 1246);
const advisorLogin = process.argv[3] || 'adv_1246_2';
const clientLastNamePrefix = process.argv[4] || 'clSR-';

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testrail.config.json'), 'utf8'));
const baseUrl = cfg.appUnderTest.url;
const PASSWORD = cfg.appUnderTest.password;

function setGwAdminFlag(loginName, flag) {
  execSync(
    `python3 -c "
import oracledb
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
cur.execute('UPDATE entity_tbl SET gw_admin_flag = :1 WHERE ldap_uid = :2', [${flag}, '${loginName}'])
c.commit()
c.close()
"`,
    { timeout: 15_000 }
  );
}

(async () => {
  console.log(`Flipping gw_admin_flag=0 for ${advisorLogin}…`);
  setGwAdminFlag(advisorLogin, 0);

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${baseUrl}react/indexReact.do`);
    await page.waitForURL(/#login/, { timeout: 30_000 });
    await page.getByPlaceholder(/email|username/i).fill(advisorLogin);
    await page.getByPlaceholder(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(/#(dashboard|platformOne)/, { timeout: 30_000 });
    console.log('Logged in as', advisorLogin, '→ URL:', page.url());

    // Navigate to manageContacts for the firm
    await page.goto(`${baseUrl}react/indexReact.do#platformOne/firmAdmin/contactManagement/manageContacts/${firmCd}`);
    await page.waitForLoadState('networkidle');
    console.log('After nav URL:', page.url());

    // Search client
    const searchBox = page.locator('input[placeholder*="Enter Client or Household"]');
    if ((await searchBox.count()) === 0) {
      console.log('Search box not found — likely no Platform One access. Body:', (await page.locator('body').innerText()).slice(0, 200));
      return;
    }
    await searchBox.click();
    await searchBox.fill(clientLastNamePrefix);
    await page.waitForTimeout(2500);

    const row = page.locator('.clientAutocompleteSearchRow___dumCz', { hasText: clientLastNamePrefix }).first();
    if ((await row.count()) === 0) {
      console.log('No row matched — search dropdown empty.');
      return;
    }
    await row.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const after = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, a[role=button], a.button, [class*="Button"]')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => (b.innerText || '').trim())
        .filter((t) => t && t.length < 60)
        .filter((t, i, a) => a.indexOf(t) === i);
      return { url: location.href, hasMerge: buttons.includes('Merge With Prospect'), buttons };
    });
    console.log('\n=== After click ===');
    console.log('URL:', after.url);
    console.log('hasMerge:', after.hasMerge);
    console.log('Buttons:', after.buttons.join(' | '));
  } finally {
    console.log('\nRestoring gw_admin_flag=1…');
    setGwAdminFlag(advisorLogin, 1);
    await page.waitForTimeout(2000);
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  try {
    setGwAdminFlag(advisorLogin, 1);
  } catch {}
  process.exit(1);
});
