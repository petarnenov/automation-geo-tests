/**
 * Shared row builders for the Bucket Exclusions specs.
 *
 * Several specs (C25363, C25364, C25377, C25789) reuse the same
 * "default happy-path" Bucket Exclusions row set: HouseHold on
 * bucket 1 Excluded=Y, with the underlying Client and every Account
 * inheriting. Keeping the builder in one file means the specs read
 * as their intent ("upload the default fixture") rather than
 * restating the row shape verbatim.
 *
 * Ported from `packages/legacy-poc/tests/bucket-exclusions/_helpers.js`.
 */

import {
  buildBucketXlsx,
  type BucketExclusionsRow,
} from '@geowealth/e2e-framework/helpers';
import type { WorkerFirm } from '@geowealth/e2e-framework/fixtures';

/** Row shape for the "C25789 default" fixture (HH=Y, Client=I, Accounts=I). */
export function defaultRows(
  firm: WorkerFirm,
  opts: { bucket?: number } = {}
): BucketExclusionsRow[] {
  const bucket = opts.bucket ?? 1;
  return [
    { firm: firm.firmCd, bucket, hh: firm.household.uuid, excluded: 'Y' },
    { firm: firm.firmCd, bucket, client: firm.client.uuid, excluded: 'I' },
    ...firm.accounts.map((acc) => ({
      firm: firm.firmCd,
      bucket,
      account: acc.uuid,
      excluded: 'I' as const,
    })),
  ];
}

/** Build the "C25789 default" xlsx in memory against a worker firm. */
export function buildDefaultXlsx(firm: WorkerFirm, opts?: { bucket?: number }): Buffer {
  return buildBucketXlsx(defaultRows(firm, opts));
}
