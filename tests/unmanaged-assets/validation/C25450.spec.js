// @ts-check
/**
 * TestRail C25450 — Unmanaged Assets: Consistency Validation for Ignore Firm per Account
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25450 (Run 175, label Pepi)
 *
 * Upload a fixture with TWO rows for the same Account UUID but conflicting
 * Ignore Firm values (one Y, the other N). The system must reject the upload.
 */

const { test } = require('@playwright/test');
const { validRowFor, uploadAndExpectError } = require('../_helpers');

test('@pepi C25450 Unmanaged Assets - inconsistent Ignore Firm per Account triggers validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(120_000);
  await uploadAndExpectError(
    page,
    workerFirm,
    [
      { ...validRowFor(workerFirm), ignoreFirm: 'Y' },
      // Same account UUID, different Ignore Firm value, different instrument
      // so the rows are otherwise distinct.
      {
        ...validRowFor(workerFirm),
        ignoreFirm: 'N',
        instrumentUuid: 'AAAA1111BBBB2222CCCC3333DDDD4444',
      },
    ],
    'C25450_inconsistent_ignore_firm'
  );
});
