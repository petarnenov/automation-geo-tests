// @ts-check
/**
 * One-off diagnostic for C26057: search a client in manageContacts and inspect
 * what the `(C)` autocomplete option's DOM actually points to. The spec's
 * `getByText(/.*(C)/)` may be matching a row that opens Edit Client directly
 * instead of the View Client overview where Merge With Prospect lives.
 *
 * Run:  node scripts/debug-mergeprospect-search.js <firmCd> <clientLastName>
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const firmCd = Number(process.argv[2] || 1238);
const clientLastName = process.argv[3] || 'clSR-20260603155728-1';

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testrail.config.json'), 'utf8'));
const baseUrl = cfg.appUnderTest.url;
const tim1State = path.join(__dirname, '..', 'tests', '.auth', 'tim1.json');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ storageState: tim1State, viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  await page.goto(`${baseUrl}react/indexReact.do#platformOne/firmAdmin/contactManagement/manageContacts/${firmCd}`);
  await page.waitForLoadState('networkidle');
  console.log('URL after navigate:', page.url());

  // Confirm we're authenticated and on the page
  const firmInput = page.locator('#selectCompany_typeAhead');
  await firmInput.waitFor({ timeout: 30_000 });
  console.log('firm input value:', await firmInput.inputValue());

  // Open the client search
  const searchBox = page.locator('input[placeholder*="Enter Client or Household"]');
  await searchBox.click();
  await searchBox.fill(clientLastName);

  // Wait for autocomplete to render — give it some time
  await page.waitForTimeout(4000);

  // Dump the suggestion list HTML
  const dumps = await page.evaluate((needle) => {
    const all = [...document.querySelectorAll('*')]
      .filter((el) => el.textContent && el.textContent.includes(needle))
      .filter((el) => el.children.length < 8 && el.textContent.length < 400);
    return all.slice(0, 30).map((el) => ({
      tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 80),
      text: el.textContent.trim().slice(0, 100),
      role: el.getAttribute('role'),
      onclick: !!el.onclick,
      parentTag: el.parentElement?.tagName,
      parentRole: el.parentElement?.getAttribute('role'),
      rect: el.getBoundingClientRect ? (() => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; })() : null,
    }));
  }, '(C)');

  console.log('\nElements containing "(C)":');
  for (const d of dumps) console.log(JSON.stringify(d));

  // Click the visible row matching the client (.clientAutocompleteSearchRow___dumCz)
  const row = page.locator('.clientAutocompleteSearchRow___dumCz', { hasText: clientLastName }).first();
  console.log('\nclicking row count =', await row.count());
  await row.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Inspect URL + visible buttons + heading
  const after = await page.evaluate(() => {
    const heading = (document.querySelector('h1, h2, .pageTitle, [class*="pageTitle"], [class*="PageTitle"]')?.innerText || '').trim().slice(0, 120);
    const breadcrumb = (document.querySelector('[class*="breadcrumb"], [class*="Breadcrumb"]')?.innerText || '').trim().slice(0, 120);
    const buttons = [...document.querySelectorAll('button, a[role=button], a.button, [class*="Button"]')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim())
      .filter((t) => t && t.length < 60)
      .filter((t, i, a) => a.indexOf(t) === i);
    return { url: location.href, heading, breadcrumb, buttons };
  });
  console.log('\n--- After click ---');
  console.log('URL:', after.url);
  console.log('Heading:', after.heading);
  console.log('Breadcrumb:', after.breadcrumb);
  console.log('Visible buttons:');
  for (const b of after.buttons) console.log('  •', b);

  console.log('\nLeave browser open for 30s for manual inspection — Ctrl+C to exit early.');
  await page.waitForTimeout(30_000);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
