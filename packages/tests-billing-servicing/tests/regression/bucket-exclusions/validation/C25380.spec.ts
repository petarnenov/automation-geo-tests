/**
 * TestRail C25380 — Bucket Exclusions: wrong values trigger validation
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25380 (Run 175, label Pepi)
 *
 * Three representative sub-cases per the TestRail steps:
 *
 *   1. EXCLUDED = "T" (not Y/N/I)
 *   2. Firm code that does not match the HH (firm 999)
 *   3. Billing bucket out of valid 1..6 range (29)
 *
 * A fourth TestRail sub-case — "HH that doesn't belong to the firm"
 * with a synthetic UUID — is NOT automated because the qa backend
 * accepts the row and falls through to the standard confirmation
 * modal instead of validating, making a deterministic assertion
 * impossible. Flagged for human follow-up; may be a product bug.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import {
  buildBucketXlsx,
  type BucketExclusionsRow,
} from '@geowealth/e2e-framework/helpers';
import { BillingBucketExclusionsPage } from '../../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';

test('@regression @billing-servicing C25380 Bucket Exclusions - wrong values trigger validation', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const FIRM_CODE = workerFirm.firmCd;
  const HH_UUID = workerFirm.household.uuid;

  const subcases: Array<{ name: string; rows: BucketExclusionsRow[] }> = [
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
  ];

  const uploadPage = new BillingBucketExclusionsPage(tim1Page);

  for (const sub of subcases) {
    await test.step(sub.name, async () => {
      // Clean up lingering modal/error state from the previous sub-case.
      await tim1Page.keyboard.press('Escape').catch(() => {});
      await uploadPage.open(FIRM_CODE);

      await uploadPage.uploadFile({
        name: `C25380_${sub.name.replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`,
        buffer: buildBucketXlsx(sub.rows),
      });

      let gotError = false;
      try {
        await uploadPage.waitForValidationError(undefined, 4_000);
        gotError = true;
      } catch {
        if (await uploadPage.uploadButton().isEnabled().catch(() => false)) {
          await uploadPage.clickUpload();
          await uploadPage.confirmProceedIfPresent(3_000);
        }
      }
      if (!gotError) {
        await uploadPage.waitForValidationError(undefined, 30_000);
      }

      await expect(uploadPage.successBanner()).toHaveCount(0, { timeout: 1_000 });
    });
  }
});
