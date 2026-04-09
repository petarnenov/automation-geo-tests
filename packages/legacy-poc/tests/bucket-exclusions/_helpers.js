// @ts-check
/**
 * Shared helpers for the bucket-exclusions @pepi specs.
 *
 * Several specs (C25363, C25364, C25377, C25789) reuse the same "default
 * happy-path" Bucket Exclusions row set: HouseHold=Y on bucket 1, with the
 * underlying Client and every Account inheriting (=I). This was the shape of
 * the legacy static `BillingBucketExclusions_C25789.xlsx` fixture, which is
 * gone now that each test gets its own dummy firm.
 */

const { buildBucketXlsx } = require('../_helpers/build-bucket-xlsx');

/**
 * Build the row array for the C25789-equivalent fixture against a worker firm.
 *
 * @param {{firmCd: number, household: {uuid: string}, client: {uuid: string}, accounts: Array<{uuid: string}>}} workerFirm
 * @param {{bucket?: number}} [opts]
 */
function defaultRows(workerFirm, opts = {}) {
  const bucket = opts.bucket ?? 1;
  return [
    { firm: workerFirm.firmCd, bucket, hh: workerFirm.household.uuid, excluded: 'Y' },
    { firm: workerFirm.firmCd, bucket, client: workerFirm.client.uuid, excluded: 'I' },
    ...workerFirm.accounts.map((acc) => ({
      firm: workerFirm.firmCd,
      bucket,
      account: acc.uuid,
      excluded: 'I',
    })),
  ];
}

/**
 * Convenience: build the C25789-equivalent xlsx in memory and return the Buffer.
 * @param {Parameters<typeof defaultRows>[0]} workerFirm
 * @param {Parameters<typeof defaultRows>[1]} [opts]
 */
function buildDefaultXlsx(workerFirm, opts) {
  return buildBucketXlsx(defaultRows(workerFirm, opts));
}

module.exports = { defaultRows, buildDefaultXlsx };
