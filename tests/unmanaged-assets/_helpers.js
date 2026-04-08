// @ts-check
/**
 * Shared helpers for the unmanaged-assets @pepi specs.
 *
 * Apple Inc is treated as a globally-available instrument on every qa firm
 * (validated 2026-04-08 and recorded as a project decision); per-test isolation
 * uses dummy firms but reuses the Apple UUID across all of them. See
 * memory/project_apple_global_instrument.md for the rationale.
 */

const { expect } = require('@playwright/test');
const {
  buildUnmanagedAssetsXlsx,
} = require('../_helpers/build-unmanaged-assets-xlsx');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const { validationErrorRegex } = require('../_helpers/ui');

/** Apple Inc — used as the universal instrument reference for any dummy firm. */
const APPLE_INSTRUMENT_UUID = '5F5FE5576175486BAE2DA9932CEEDD6A';
const APPLE_SYMBOL = 'US037833EN61';
const APPLE_HOLDINGS = 'APPLE INC.';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ERROR_RX = validationErrorRegex(
  'conflict',
  'inconsistent',
  'ignore',
  'action'
);

/**
 * Build the deep upload URL for a worker firm.
 * @param {{firmCd: number}} workerFirm
 */
function uploadUrl(workerFirm) {
  return `/react/indexReact.do#platformOne/uploadTools/bulkExclusions/unmanagedAssetsExclusions/${workerFirm.firmCd}`;
}

/**
 * Return a fully-populated valid Unmanaged Assets row for a worker firm. Uses
 * the worker's first account and the global Apple instrument. Tests override
 * specific fields to introduce defects.
 *
 * @param {{firmCd: number, accounts: Array<{uuid: string}>}} workerFirm
 */
function validRowFor(workerFirm) {
  return {
    firmCode: workerFirm.firmCd,
    accountUuid: workerFirm.accounts[0].uuid,
    ignoreFirm: 'N',
    instrumentUuid: APPLE_INSTRUMENT_UUID,
    action: 'U',
    excludeFromPerformance: 'N',
    advisorPortfolioType: 5,
    platformPortfolioType: 4,
    mmPortfolioType: 3,
    internalAdvisorPortfolioType: 2,
    internalPlatformType: 1,
    internalMmPortfolioType: 5,
  };
}

/**
 * Convenience: build a single-row Unmanaged Assets xlsx in memory for the
 * worker firm, with optional field overrides (typically just `action`).
 *
 * @param {Parameters<typeof validRowFor>[0]} workerFirm
 * @param {Record<string, any>} [overrides]
 * @returns {Buffer}
 */
function buildXlsxFor(workerFirm, overrides = {}) {
  return buildUnmanagedAssetsXlsx([{ ...validRowFor(workerFirm), ...overrides }]);
}

/**
 * Shared "upload-and-expect-validation-error" flow used by every
 * unmanaged-assets validation spec. Builds the xlsx in memory, navigates to
 * the upload page for the worker firm, stages the file, then asserts that the
 * error appears (immediately or after clicking Upload) and that the success
 * modal does NOT appear.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{firmCd: number, accounts: Array<{uuid: string}>}} workerFirm
 * @param {Array<Record<string, any>>} rows
 * @param {string} label  short identifier used in the synthetic filename
 */
async function uploadAndExpectError(page, workerFirm, rows, label) {
  const xlsx = buildUnmanagedAssetsXlsx(rows);

  await loginPlatformOneAdmin(page);
  await page.goto(uploadUrl(workerFirm));
  await expect(page.getByRole('textbox').first()).toHaveValue(
    new RegExp(`\\(${workerFirm.firmCd}\\)`),
    { timeout: 30_000 }
  );

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse For File' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: `UnmanagedAssetsExclusions_${label}.xlsx`,
    mimeType: XLSX_MIME,
    buffer: xlsx,
  });

  let immediate = false;
  try {
    await expect(page.getByText(ERROR_RX).first()).toBeVisible({ timeout: 4000 });
    immediate = true;
  } catch {
    const uploadBtn = page.getByRole('button', { name: 'Upload', exact: true });
    if (await uploadBtn.isEnabled().catch(() => false)) {
      await uploadBtn.click();
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
    await expect(page.getByText(ERROR_RX).first()).toBeVisible({ timeout: 60_000 });
  }

  await expect(page.getByText(/imported successfully/i)).toHaveCount(0, {
    timeout: 1000,
  });
}

module.exports = {
  APPLE_INSTRUMENT_UUID,
  APPLE_SYMBOL,
  APPLE_HOLDINGS,
  XLSX_MIME,
  ERROR_RX,
  uploadUrl,
  validRowFor,
  buildXlsxFor,
  uploadAndExpectError,
};
