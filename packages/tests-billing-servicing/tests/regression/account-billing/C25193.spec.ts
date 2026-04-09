/**
 * TestRail C25193 — Account: Billing Inception Date - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25193
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Phase 2 step 7 (D-37) — the **graduation spec** for Phase 2 per
 * Section 6.4.1. This is the FIRST migrated spec; from this point
 * onward `packages/tests-billing-servicing/tests/regression/
 * account-billing/C25193.spec.ts` is the canonical home, and the
 * legacy `packages/legacy-poc/tests/account-billing/C25193.spec.js`
 * is queued for deletion in Phase 4 once this spec passes its
 * 5-night gating window per Section 6.6.
 *
 * Hybrid isolation pattern (verified in `feedback_account_billing
 * _isolation` memory):
 *
 *   Phase 1 (admin write/read flow) → workerFirmAdminPage. The
 *     shared-firm-106 pattern races under 8-worker parallel load:
 *     every spec mutates the same Arnold/Delaney account, so
 *     workers overwrite each other's edits between "set" and
 *     "verify". Each worker now has its own dummy firm + admin +
 *     account, eliminating the race.
 *
 *   Phase 2 (non-admin Edit-button-hidden check) → tylerPage on
 *     firm 106. Empirically verified that the dummy-firm advisor
 *     `adv_<firmCd>_1` is NOT a drop-in for tyler@plimsollfp.com —
 *     the dummy advisor has full billing edit rights, while tyler
 *     has a Plimsoll-FP-specific restricted custom role.
 *     `createDummyFirm.do` cannot provision restricted roles, so
 *     the tyler check has to live on firm 106. Read-only access
 *     cannot race under parallel load.
 *
 * NOTE on History assertion (Q6 in the C25193 entry spike): the qa3
 * Account Billing History grid does not record Billing Inception
 * Date changes (verified live 2026-04-07: 40 history rows scanned
 * across multiple field categories, none for Inception Date). The
 * previous blocker comment misattributed this to a programmatic-fill
 * bug — actual root cause is that the audit pipeline is silent for
 * this field. Test scope therefore stops at the summary-card
 * round-trip and the non-admin Edit-button visibility check,
 * mirroring the spirit of the TestRail steps without depending on
 * a missing audit row. The legacy spec made the same call.
 *
 * Differences from the legacy spec (deliberate):
 *
 *   - Uses two distinct fixture-provided pages (workerFirmAdminPage
 *     in Phase 1, tylerPage in Phase 2) instead of a single page
 *     with clearCookies + relogin between phases. The framework's
 *     fresh-context pattern is cleaner state isolation.
 *
 *   - Drives the form via the AccountBillingPage Page Object, not
 *     via inline locators. The Q3/Q4/Q5 quirks are encapsulated in
 *     the Page Object methods.
 *
 *   - All identifiers (firm 106 UUIDs, tyler username) come from
 *     `framework/data/constants` per Section 4.9, not inline
 *     constants in the spec.
 *
 * No cleanup revert step — each worker has its own dummy firm so
 * audit-history accumulation per run is irrelevant per Section 5.8.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

/**
 * Pick a "different" date one month away from the current one (same
 * day, adjacent month). Avoids leap-year / month-length edge cases by
 * using `Date.UTC` arithmetic.
 *
 * Mirrors the legacy `nextMonthDate()` helper from C25193.spec.js
 * lines 61-68 verbatim.
 */
function nextMonthDate(mmddyyyy: string): string {
  const [m, d, y] = mmddyyyy.split('/').map((v) => parseInt(v, 10));
  // m is 0-based in the Date constructor, so passing m advances one month.
  const next = new Date(Date.UTC(y, m, d));
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  const yyyy = next.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

test('@regression @billing-servicing C25193 Account Billing Inception Date - Admin and Non-Admin', async ({
  workerFirmAdminPage,
  workerFirm,
  tylerPage,
}) => {
  // The Phase 1 + Phase 2 sequence stacks two real-qa logins (plus
  // a workerFirm createDummyFirm) on top of the spec body. Bump the
  // test timeout per Section 4.8 with the same justification as the
  // step 4 multi-identity smoke spec.
  test.slow();

  const billingPhase1 = new AccountBillingPage(workerFirmAdminPage);
  let originalDate: string;
  let newDate: string;

  await test.step('Phase 1.1: admin captures (or seeds) Billing Inception Date', async () => {
    await billingPhase1.goto({ workerFirm });

    let displayed = await billingPhase1.getDisplayedInceptionDate();
    if (!displayed) {
      // Dummy-firm accounts come with no inception date set; seed a
      // baseline so the change-and-verify round-trip below has
      // something to compare to. Same pattern as the legacy spec
      // Phase 1.1.
      await billingPhase1.openEditModal();
      await billingPhase1.inceptionDate.setValue('12/01/2024');
      await billingPhase1.saveEditModal();

      // Q6 — post-save value is not immediately visible on the
      // summary card (React Query cache lag). Poll until the card
      // reflects the seeded value. When D-08 lands the polling can
      // be replaced with a single deterministic wait.
      await expect
        .poll(async () => billingPhase1.getDisplayedInceptionDate(), { timeout: 15_000 })
        .toBe('12/01/2024');
      displayed = '12/01/2024';
    }

    originalDate = displayed;
    expect(originalDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    newDate = nextMonthDate(originalDate);
    test.info().annotations.push({
      type: 'captured',
      description: `firmCd=${workerFirm.firmCd} original=${originalDate} new=${newDate}`,
    });
  });

  await test.step('Phase 1.2: change Billing Inception Date and Save', async () => {
    await billingPhase1.openEditModal();
    await billingPhase1.inceptionDate.setValue(newDate);
    await billingPhase1.saveEditModal();
    // Q6 polling — same rationale as Phase 1.1.
    await expect
      .poll(async () => billingPhase1.getDisplayedInceptionDate(), { timeout: 15_000 })
      .toBe(newDate);
  });

  // No cleanup revert step — each worker has its own dummy firm, so
  // audit-history accumulation per run is irrelevant.

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    // Read-only check on shared firm 106 — no race since tyler
    // never mutates. tylerPage fixture is its own context per
    // Section 4.5; nothing from Phase 1 leaks here.
    const billingPhase2 = new AccountBillingPage(tylerPage);
    await billingPhase2.goto({ static: 'arnold-delaney' });
    await expect(billingPhase2.editButton).toHaveCount(0);
  });
});
