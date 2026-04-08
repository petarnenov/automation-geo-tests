// @ts-check
/**
 * TestRail C25447 — Unmanaged Assets: validation triggered with wrong file format
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25447 (Run 175, label Pepi)
 *
 * Same pattern as the Bucket Exclusions counterpart (C25379) but on the
 * Unmanaged Assets upload page.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const { loginPlatformOneAdmin } = require('../../_helpers/qa3');
const { uploadUrl } = require('../_helpers');

const WRONG_FILE = path.join(__dirname, '..', '..', 'fixtures', 'wrong-format.txt');

test('@pepi C25447 Unmanaged Assets - wrong file format triggers validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(120_000);

  await loginPlatformOneAdmin(page);
  await page.goto(uploadUrl(workerFirm));
  await expect(page.getByRole('textbox').first()).toHaveValue(
    new RegExp(`\\(${workerFirm.firmCd}\\)`),
    { timeout: 30_000 }
  );

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse For File' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(WRONG_FILE);

  const errorLocator = page.getByText(
    /wrong file format|invalid file|not.*(xlsx|excel|spreadsheet)|unsupported/i
  );

  let immediate = false;
  try {
    await expect(errorLocator.first()).toBeVisible({ timeout: 4000 });
    immediate = true;
  } catch {
    const uploadBtn = page.getByRole('button', { name: 'Upload', exact: true });
    if (await uploadBtn.isEnabled().catch(() => false)) {
      await uploadBtn.click();
    }
  }

  if (!immediate) {
    await expect(errorLocator.first()).toBeVisible({ timeout: 30_000 });
  }
});
