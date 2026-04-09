// @ts-check
/**
 * TestRail C25448 — Unmanaged Assets: Required Fields Validation
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25448 (Run 175, label Pepi)
 *
 * The TestRail case lists 4 required-field sub-cases. Each is its own test() so
 * Playwright reports them independently and a failure on one does not mask the
 * others. The reporter posts the same TestRail case ID for each — TestRail will
 * see multiple results for C25448 in this run, and the latest one wins.
 *
 * NOTE: the "missing Firm Code" sub-case from the TestRail steps is not
 * automated — on qa3 the firm is also derived from the upload page URL hash,
 * so a row with a blank Firm Code falls back to the URL-selected firm and the
 * upload succeeds. Validation cannot fire from the file alone.
 */

const { test } = require('@playwright/test');
const { validRowFor, uploadAndExpectError } = require('../_helpers');

test('@pepi C25448 Unmanaged Assets - missing Account UUID triggers validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);
  const row = validRowFor(workerFirm);
  delete row.accountUuid;
  await uploadAndExpectError(page, workerFirm, [row], 'missingAccountUuid');
});

test('@pepi C25448 Unmanaged Assets - missing Instrument UUID triggers validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);
  const row = validRowFor(workerFirm);
  delete row.instrumentUuid;
  await uploadAndExpectError(page, workerFirm, [row], 'missingInstrumentUuid');
});

test('@pepi C25448 Unmanaged Assets - missing Action triggers validation', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);
  const row = validRowFor(workerFirm);
  delete row.action;
  await uploadAndExpectError(page, workerFirm, [row], 'missingAction');
});
