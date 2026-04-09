// @ts-check
/**
 * TestRail C25449 — Unmanaged Assets: Validation of Ignore Firm Values
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25449 (Run 175, label Pepi)
 *
 * Upload a row whose Ignore Firm column contains an invalid value
 * (e.g., "X" instead of "Y", "N", or blank) and assert the system rejects it.
 */

const { test } = require('@playwright/test');
const { validRowFor, uploadAndExpectError } = require('../_helpers');

test('@pepi C25449 Unmanaged Assets - invalid Ignore Firm value triggers validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(120_000);
  await uploadAndExpectError(
    page,
    workerFirm,
    [{ ...validRowFor(workerFirm), ignoreFirm: 'X' }],
    'C25449_bad_ignore_firm'
  );
});
