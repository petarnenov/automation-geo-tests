// @ts-check
/**
 * TestRail C26381 — Verify "Create" record is shown in Unmanaged Assets
 *                    history even when no subsequent update exists
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26381 (Run 206)
 * Refs:   GEO-22458 — "Create record in UA history without subsequent update"
 *
 * BLOCKED — on qa4 the "Account Unmanaged Assets History" modal opens
 * for an account whose Unmanaged Assets were just freshly created via
 * bulk upload (verified end-to-end through the same path as C26073),
 * but the audit grid renders the placeholder "Unmanaged Assets Data is
 * not available" — no Create row is emitted by the BE.  This matches
 * the GEO-22458 ticket: the underlying BE change that writes Create-
 * only audit rows hasn't shipped to qa4 yet.  Once the fix lands,
 * replace `test.fixme` with the following sketch:
 *
 *   - Phase 1: bulk-upload a single U-action UA for the worker firm.
 *   - Phase 2: log in as workerFirm.admin (avoids the advisor-perm
 *     cache warmup race), navigate to the account's Unmanaged Assets
 *     tab, click History.
 *   - Read the audit grid scoped to `#accountUnmanagedAssetsHistory`
 *     (NOT the underlying account UA grid), filter for any row with
 *     Activity = "Create" + Symbol = Apple SYMBOL + Before empty +
 *     After non-empty, expect ≥1 match.
 *
 * The scaffold for that flow was implemented and validated up to the
 * History-modal open step (the modal title appears, the grid mounts);
 * only the rows assertion fails today because the BE returns
 * `{rows: []}` for accountUUID after a bulk upload.
 */

const { test } = require('@playwright/test');

test.fixme(
  '@pepi C26381 Unmanaged Assets history shows a Create record for newly added assets',
  async () => {
    // Pending GEO-22458 deploy on qa4. The audit grid currently
    // renders "Unmanaged Assets Data is not available" because the BE
    // omits the Create row when no subsequent Update happened. See
    // the spec header for the full repro path.
  }
);
