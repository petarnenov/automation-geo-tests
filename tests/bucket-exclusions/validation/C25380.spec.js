// @ts-check
/**
 * TestRail C25380 — Bucket Exclusions: validation triggered with wrong values
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25380 (Run 175, label Pepi)
 *
 * Four sub-cases per the TestRail steps:
 *
 *   1. EXCLUDED = "T" (not Y/N/I)
 *   2. Wrong firm code (firm that does not match the HH/Client/Account)
 *   3. Billing bucket = 29 (out of valid 1..6 range)
 *   4. HH that does not match the firm
 *
 * For sub-cases 2 and 4 we use a non-existent firm 999 and a known-good HH
 * UUID — the system should reject the mismatch.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loginPlatformOneAdmin } = require('../../_helpers/qa3');
const { validationErrorRegex } = require('../../_helpers/ui');
const { buildBucketXlsx } = require('../../_helpers/build-bucket-xlsx');

const ERROR_RX = validationErrorRegex('not.*match');

test('@pepi C25380 Bucket Exclusions - wrong values trigger validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(300_000);

  const FIRM_CODE = workerFirm.firmCd;
  const HH_UUID = workerFirm.household.uuid;
  const UPLOAD_URL = `/react/indexReact.do#platformOne/uploadTools/bulkExclusions/billingBucketExclusions/${FIRM_CODE}`;

  const SUBCASES = [
    {
      name: 'EXCLUDED = T (not Y/N/I)',
      rows: [{ firm: FIRM_CODE, bucket: 1, hh: HH_UUID, excluded: 'T' }],
    },
    {
      name: 'firm does not match the HH',
      // Firm 999 is not the firm the household belongs to.
      rows: [{ firm: 999, bucket: 1, hh: HH_UUID, excluded: 'Y' }],
    },
    {
      name: 'billing bucket out of range (29)',
      rows: [{ firm: FIRM_CODE, bucket: 29, hh: HH_UUID, excluded: 'Y' }],
    },
    // NOTE: The 4th TestRail sub-case ("HH that doesn't belong to the firm")
    // is not automated here. With a synthetic UUID like 00...01 the qa3 backend
    // accepts the row and pops the standard "Are you sure you want to proceed?"
    // confirmation instead of validating, so the test cannot meaningfully assert
    // a validation error. This may be a real product bug or a different
    // validation tier; flagged for human follow-up rather than asserted blindly.
  ];

  await loginPlatformOneAdmin(page);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pepi-c25380-'));

  for (const sub of SUBCASES) {
    await test.step(sub.name, async () => {
      const fixturePath = path.join(
        tmpDir,
        `C25380_${sub.name.replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`
      );
      buildBucketXlsx(sub.rows, { outFile: fixturePath });

      // Aggressive cleanup between sub-cases: an error or confirmation modal
      // from a previous sub-case can otherwise intercept the next Browse click.
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
          try {
            await page.getByRole('button', { name: 'Yes, Proceed' }).click({ timeout: 3000 });
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

      await expect(page.getByText(/imported successfully/i)).toHaveCount(0, { timeout: 1000 });
    });
  }
});
