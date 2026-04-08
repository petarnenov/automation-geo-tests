// @ts-check
/**
 * TestRail C25378 — Bucket Exclusions: validation triggered with invalid required fields
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25378 (Run 175, label Pepi)
 *
 * Four sub-cases per the TestRail steps, each producing a deliberately broken
 * fixture and expecting the upload UI to surface a validation error:
 *
 *   1. missing FIRM CODE
 *   2. missing BILLING BUCKET
 *   3. missing HH/Client/Account (all three blank)
 *   4. missing EXCLUDED action
 *
 * Each sub-case re-navigates to the upload page (the page does not gracefully
 * recover from a previous error in-place) and looks for any visible error.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loginPlatformOneAdmin } = require('../../_helpers/qa3');
const { validationErrorRegex } = require('../../_helpers/ui');
const { buildBucketXlsx } = require('../../_helpers/build-bucket-xlsx');

const ERROR_RX = validationErrorRegex();

test('@pepi C25378 Bucket Exclusions - missing required fields trigger validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(300_000);

  const FIRM_CODE = workerFirm.firmCd;
  const HH_UUID = workerFirm.household.uuid;
  const UPLOAD_URL = `/react/indexReact.do#platformOne/uploadTools/bulkExclusions/billingBucketExclusions/${FIRM_CODE}`;

  const SUBCASES = [
    {
      name: 'missing FIRM CODE',
      rows: [{ bucket: 1, hh: HH_UUID, excluded: 'Y' }],
    },
    {
      name: 'missing BILLING BUCKET',
      rows: [{ firm: FIRM_CODE, hh: HH_UUID, excluded: 'Y' }],
    },
    {
      name: 'missing HH/Client/Account',
      rows: [{ firm: FIRM_CODE, bucket: 1, excluded: 'Y' }],
    },
    {
      name: 'missing EXCLUDED action',
      rows: [{ firm: FIRM_CODE, bucket: 1, hh: HH_UUID }],
    },
  ];

  await loginPlatformOneAdmin(page);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pepi-c25378-'));

  for (const sub of SUBCASES) {
    await test.step(sub.name, async () => {
      const fixturePath = path.join(
        tmpDir,
        `C25378_${sub.name.replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`
      );
      buildBucketXlsx(sub.rows, { outFile: fixturePath });

      // Aggressive cleanup: Escape any open modal, then about:blank → URL.
      await page.keyboard.press('Escape').catch(() => {});
      await page.goto('about:blank');
      await page.goto(UPLOAD_URL);
      await expect(page.getByRole('textbox').first()).toHaveValue(
        new RegExp(`\\(${FIRM_CODE}\\)`),
        { timeout: 30_000 }
      );

      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Browse For File' }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(fixturePath);

      // Check for an immediate error first; if none, click Upload.
      let immediate = false;
      try {
        await expect(page.getByText(ERROR_RX).first()).toBeVisible({
          timeout: 4000,
        });
        immediate = true;
      } catch {
        const uploadBtn = page.getByRole('button', { name: 'Upload', exact: true });
        if (await uploadBtn.isEnabled().catch(() => false)) {
          await uploadBtn.click();
          // Some forms still pop the "Yes, Proceed" confirmation even on bad files.
          try {
            await page
              .getByRole('button', { name: 'Yes, Proceed' })
              .click({ timeout: 3000 });
          } catch {
            /* none */
          }
        }
      }

      if (!immediate) {
        await expect(page.getByText(ERROR_RX).first()).toBeVisible({
          timeout: 30_000,
        });
      }

      // Verify we did NOT get a success modal.
      await expect(
        page.getByText(/imported successfully/i)
      ).toHaveCount(0, { timeout: 1000 });
    });
  }
});
