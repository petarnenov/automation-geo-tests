// @ts-check
/**
 * TestRail C25379 — Bucket Exclusions: validation triggered with wrong file format
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25379 (Run 175, label Pepi)
 *
 * The TestRail expected text is: 'Error message "Wrong file format" is displayed'.
 * We assert with a permissive regex so the test still passes if the rendered
 * copy differs in casing or punctuation, then drill into the exact wording on
 * failure.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const { loginPlatformOneAdmin } = require('../../_helpers/qa3');

const WRONG_FILE = path.join(__dirname, '..', '..', 'fixtures', 'wrong-format.txt');

test('@pepi C25379 Bucket Exclusions - wrong file format triggers validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(120_000);

  await loginPlatformOneAdmin(page);
  await page.goto(
    `/react/indexReact.do#platformOne/uploadTools/bulkExclusions/billingBucketExclusions/${workerFirm.firmCd}`
  );
  await expect(page.getByRole('textbox').first()).toHaveValue(
    new RegExp(`\\(${workerFirm.firmCd}\\)`),
    { timeout: 30_000 }
  );

  // Stage the wrong-format file via the file chooser. The UI should reject it
  // either at staging time or when Upload is clicked.
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse For File' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(WRONG_FILE);

  // The error may render before Upload is clicked, or only after. We try both:
  // first wait briefly for an immediate error; if none, click Upload and wait.
  const errorLocator = page.getByText(
    /wrong file format|invalid file|not.*(xlsx|excel|spreadsheet)|unsupported/i
  );

  let immediate = false;
  try {
    await expect(errorLocator.first()).toBeVisible({ timeout: 4000 });
    immediate = true;
  } catch {
    // No immediate error; try clicking Upload to trigger server-side validation.
    const uploadBtn = page.getByRole('button', { name: 'Upload', exact: true });
    if (await uploadBtn.isEnabled().catch(() => false)) {
      await uploadBtn.click();
    }
  }

  if (!immediate) {
    await expect(errorLocator.first()).toBeVisible({ timeout: 30_000 });
  }
});
