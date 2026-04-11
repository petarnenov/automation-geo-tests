/**
 * TestRail C25378 — Bucket Exclusions: missing required fields trigger validation
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25378 (Run 175, label Pepi)
 *
 * Four sub-cases per the TestRail steps, each a deliberately broken
 * fixture the upload UI must reject:
 *
 *   1. missing FIRM CODE
 *   2. missing BILLING BUCKET
 *   3. missing HH/Client/Account (all three blank)
 *   4. missing EXCLUDED action
 *
 * Each sub-case re-opens the upload page because the form does not
 * gracefully recover from a previous error in-place.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import {
  buildBucketXlsx,
  type BucketExclusionsRow,
} from '@geowealth/e2e-framework/helpers';
import { BillingBucketExclusionsPage } from '../../../../src/pages/bucket-exclusions/BillingBucketExclusionsPage';

test('@regression @billing-servicing C25378 Bucket Exclusions - missing required fields trigger validation', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const FIRM_CODE = workerFirm.firmCd;
  const HH_UUID = workerFirm.household.uuid;

  const subcases: Array<{ name: string; rows: BucketExclusionsRow[] }> = [
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

  const uploadPage = new BillingBucketExclusionsPage(tim1Page);

  for (const sub of subcases) {
    await test.step(sub.name, async () => {
      // Aggressive cleanup: Escape any open modal and re-open the
      // upload page between sub-cases so a lingering error from the
      // previous attempt cannot bleed through.
      await tim1Page.keyboard.press('Escape').catch(() => {});
      await uploadPage.open(FIRM_CODE);

      await uploadPage.uploadFile({
        name: `C25378_${sub.name.replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`,
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
