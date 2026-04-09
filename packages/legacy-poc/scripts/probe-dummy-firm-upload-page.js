// @ts-check
/**
 * Probe: navigate to the Bucket Exclusions upload URL for a freshly-created
 * dummy firm and dump what loads. Compare with firm 106 (the legacy hardcoded
 * firm) to see whether dummy firms are usable in the upload tool at all.
 *
 * Usage: node scripts/probe-dummy-firm-upload-page.js
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { setupWorkerFirm } = require('../tests/_helpers/worker-firm');

const STORAGE = path.join(__dirname, '..', 'tests', '.auth', 'tim1.json');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testrail.config.json'), 'utf8'));
const BASE = cfg.appUnderTest.url.replace(/\/$/, '');

const uploadUrl = (firmCd) =>
  `${BASE}/react/indexReact.do#platformOne/uploadTools/bulkExclusions/billingBucketExclusions/${firmCd}`;

async function inspect(page, label, firmCd) {
  console.log(`\n=== ${label} (firmCd=${firmCd}) ===`);
  console.log('navigating to', uploadUrl(firmCd));
  await page.goto(uploadUrl(firmCd));
  // Give the SPA up to 20s to render either the form or an error.
  await page.waitForTimeout(8_000);

  const url = page.url();
  console.log('current url:', url);

  const textboxCount = await page.getByRole('textbox').count();
  console.log('textbox count:', textboxCount);
  if (textboxCount > 0) {
    const firstVal = await page
      .getByRole('textbox')
      .first()
      .inputValue()
      .catch(() => '<n/a>');
    console.log('first textbox value:', JSON.stringify(firstVal));
  }

  const browseBtn = await page.getByRole('button', { name: 'Browse For File' }).count();
  console.log('"Browse For File" button count:', browseBtn);

  const visibleText = await page
    .locator('body')
    .innerText()
    .catch(() => '');
  const trimmed = visibleText.replace(/\s+/g, ' ').trim().slice(0, 300);
  console.log('visible body text (clipped):', trimmed || '(empty)');
}

(async () => {
  console.log('1. Creating dummy firm…');
  const wf = await setupWorkerFirm();
  console.log(`   firmCd=${wf.firmCd}  firmName=${wf.firmName}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: STORAGE,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  try {
    await inspect(page, 'LEGACY firm 106', 106);
    await inspect(page, 'DUMMY firm', wf.firmCd);
  } finally {
    await browser.close();
  }
})();
