// @ts-check
/**
 * TestRail C25446 — Unmanaged Assets: validation triggered with invalid data
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25446 (Run 175, label Pepi)
 *
 * Single sub-case per the TestRail steps: upload a fixture with several
 * deliberately incorrect required values (firm code, account UUID, instrument
 * UUID, action) and assert the system surfaces a validation error.
 */

const { test } = require('@playwright/test');
const { validRowFor, uploadAndExpectError } = require('../_helpers');

test('@pepi C25446 Unmanaged Assets - invalid data triggers validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(120_000);
  await uploadAndExpectError(
    page,
    workerFirm,
    [
      {
        ...validRowFor(workerFirm),
        firmCode: 999, // wrong firm
        accountUuid: 'NOT-A-VALID-UUID',
        instrumentUuid: 'ALSO-NOT-VALID',
        action: 'X', // not U/D/RA
      },
    ],
    'C25446_invalid_data'
  );
});
