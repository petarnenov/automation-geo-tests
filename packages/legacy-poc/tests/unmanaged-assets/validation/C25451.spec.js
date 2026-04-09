// @ts-check
/**
 * TestRail C25451 — Unmanaged Assets: Validation of Action Values
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25451 (Run 175, label Pepi)
 *
 * Upload a row whose Action column contains an invalid value (e.g., "X"
 * instead of "U", "D", or "RA") and assert the system rejects it.
 */

const { test } = require('@playwright/test');
const { validRowFor, uploadAndExpectError } = require('../_helpers');

test('@pepi C25451 Unmanaged Assets - invalid Action value triggers validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(120_000);
  await uploadAndExpectError(
    page,
    workerFirm,
    [{ ...validRowFor(workerFirm), action: 'X' }],
    'C25451_bad_action'
  );
});
