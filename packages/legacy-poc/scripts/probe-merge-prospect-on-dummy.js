// @ts-check
/**
 * End-to-end probe for the merge-prospect flow against a fresh dummy firm:
 *   1. Provision dummy firm via /qa/createDummyFirm.do
 *   2. Login as the dummy firm admin (admin_<firmCd>) and create one prospect
 *      via the UI directories/prospects/create form
 *   3. Login as tim1 Platform One admin
 *   4. Navigate to Manage Contacts for the dummy firm
 *   5. Search for the dummy firm's client and open it
 *   6. Click Merge With Prospect
 *   7. Type the prospect's last-name prefix and assert autocomplete returns
 *      at least one option
 *
 * If this passes end-to-end, we know merge-prospect specs can migrate to
 * dummy firms via two worker-scoped fixtures: workerFirm + workerFirmProspect.
 */

// Phase 0 Step 0.C: load .env.local from workspace root for standalone scripts.
require('../load-env');

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { setupWorkerFirm } = require('../tests/_helpers/worker-firm');

// cfg kept loaded in case future fields are needed; secrets now come from env.
// eslint-disable-next-line no-unused-vars
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testrail.config.json'), 'utf8'));
const STORAGE = path.join(__dirname, '..', 'tests', '.auth', 'tim1.json');
const PASSWORD = process.env.TIM1_PASSWORD;
if (!PASSWORD) {
  console.error('probe-merge-prospect-on-dummy: TIM1_PASSWORD must be set in .env.local.');
  process.exit(2);
}

async function loginAs(page, username) {
  await page.goto('https://qa2.geowealth.com/');
  await page.waitForURL(/#login/, { timeout: 30000 });
  await page.getByPlaceholder(/email|username/i).fill(username);
  await page.getByPlaceholder(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/#(dashboard|platformOne)/, { timeout: 30000 });
}

(async () => {
  console.log('1. provisioning dummy firm…');
  const wf = await setupWorkerFirm();
  console.log(`   firm=${wf.firmCd} admin=${wf.admin.loginName} client=${wf.client.name}`);

  const browser = await chromium.launch();

  // ── Step 2: create a prospect as the dummy firm admin ─────────────────────
  console.log('2. creating prospect as dummy firm admin…');
  const adminCtx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const adminPage = await adminCtx.newPage();
  await loginAs(adminPage, wf.admin.loginName);
  await adminPage.goto(
    'https://qa2.geowealth.com/react/indexReact.do#directories/prospects/create'
  );
  await adminPage.locator('#firstNameField').waitFor({ timeout: 30000 });
  const prospectFirst = 'PepiPF';
  const prospectLast = 'PepiPL' + wf.firmCd;
  await adminPage.locator('#firstNameField').fill(prospectFirst);
  await adminPage.locator('#lastNameField').fill(prospectLast);
  await adminPage.getByRole('button', { name: 'Create Prospect' }).click();
  await adminPage.waitForTimeout(5000);
  console.log(`   prospect created: ${prospectFirst} ${prospectLast}`);
  await adminCtx.close();

  // ── Steps 3-7: run the merge-prospect smoke as tim1 ───────────────────────
  console.log('3. logging in as tim1 platform one admin…');
  const tim1Ctx = await browser.newContext({
    storageState: STORAGE,
    viewport: { width: 1600, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const tim1Page = await tim1Ctx.newPage();
  await tim1Page.goto(
    `https://qa2.geowealth.com/react/indexReact.do#platformOne/firmAdmin/contactManagement/manageContacts/${wf.firmCd}`
  );
  await tim1Page.waitForTimeout(8000);

  console.log('4. checking firm picker is set to dummy firm…');
  const firmInput = tim1Page.locator('#selectCompany_typeAhead');
  let firmInputValue = await firmInput.inputValue().catch(() => '');
  console.log('   firm input value:', firmInputValue);
  if (!firmInputValue.includes(`(${wf.firmCd})`)) {
    console.log('   firm not auto-selected, opening dropdown…');
    await firmInput.click();
    await firmInput.fill(String(wf.firmCd));
    await tim1Page.waitForTimeout(1500);
    await tim1Page.getByText(`(${wf.firmCd}) ${wf.firmName}`).first().click();
    firmInputValue = await firmInput.inputValue();
    console.log('   after manual select:', firmInputValue);
  }

  // Search for the client
  const lastName = wf.client.name.split(',')[0].trim();
  console.log(`5. searching for client "${lastName}"…`);
  const searchBox = tim1Page.getByRole('textbox', { name: /Enter Client or Household/i });
  await searchBox.click();
  await searchBox.fill(lastName);
  await tim1Page.waitForTimeout(2000);

  const clientOption = tim1Page
    .getByText(new RegExp(`${lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\\(C\\)`))
    .first();
  const clientVisible = await clientOption.isVisible({ timeout: 10000 }).catch(() => false);
  console.log('   client option visible:', clientVisible);
  if (!clientVisible) {
    console.log('   FAIL: client not found in search');
    const body = (await tim1Page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);
    console.log('   body:', body);
    await browser.close();
    process.exit(1);
  }
  await clientOption.click();
  await tim1Page.waitForTimeout(3000);

  console.log('6. opening Merge With Prospect modal…');
  const mergeBtn = tim1Page.getByRole('button', { name: 'Merge With Prospect' });
  const mergeBtnVisible = await mergeBtn.isVisible({ timeout: 15000 }).catch(() => false);
  console.log('   Merge With Prospect button visible:', mergeBtnVisible);
  if (!mergeBtnVisible) {
    console.log('   FAIL: button missing');
    await browser.close();
    process.exit(1);
  }
  await mergeBtn.click();

  const prospectSearch = tim1Page.getByRole('textbox', { name: 'Search Prospect Name' });
  await prospectSearch.waitFor({ timeout: 10000 });
  await prospectSearch.click();
  await prospectSearch.fill('PepiPL');
  await tim1Page.waitForTimeout(3000);

  console.log('7. checking autocomplete for "PepiPL"…');
  const option = tim1Page.getByRole('listbox').last().getByRole('option').first();
  const optionVisible = await option.isVisible({ timeout: 15000 }).catch(() => false);
  if (optionVisible) {
    const text = await option.innerText();
    console.log('   ✅ autocomplete option visible:', text);
  } else {
    console.log('   ❌ no autocomplete option');
    const list = await tim1Page
      .getByRole('listbox')
      .last()
      .innerText()
      .catch(() => '<no listbox>');
    console.log('   listbox content:', list);
  }

  await browser.close();
})();
