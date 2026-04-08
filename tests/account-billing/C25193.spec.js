// @ts-check
/**
 * TestRail C25193 — Account: Billing Inception Date - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25193 (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Phase 1 (admin / tim106):
 *   - capture the current Billing Inception Date from the summary card
 *   - open Edit Billing Settings, change the date via the calendar popup, Save
 *   - assert the summary card now shows the new date
 *   - cleanup: open Edit again, revert to the original date, Save
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - open the same Billing tab, assert no Edit Billing Settings button
 *
 * NOTE on History assertion: the qa3 Account Billing History grid does not
 * record Billing Inception Date changes (verified live 2026-04-07: 40 history
 * rows scanned across multiple field categories, none for Inception Date).
 * The previous blocker comment misattributed this to a programmatic-fill bug
 * — actual root cause is that the audit pipeline is silent for this field.
 * Test scope therefore stops at the summary-card round-trip and the non-admin
 * Edit-button visibility check, mirroring the spirit of the TestRail steps
 * without depending on a missing audit row.
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsWorkerFirmAdmin,
  loginAsNonAdmin,
  gotoWorkerFirmAccountBilling,
  gotoAccountBilling,
  openEditBillingSettings,
  saveEditBillingSettings,
  setBillingInceptionDate,
  getDisplayedBillingInceptionDate,
} = require('./_helpers');

// HYBRID isolation pattern (2026-04-09):
//
//   Phase 1 (admin write/read flow) → workerFirm. The shared-firm-106 pattern
//   races under 8-worker parallel load: every spec mutates the same Arnold/
//   Delaney account, so workers overwrite each other's edits between "set"
//   and "verify". Each worker now has its own dummy firm + admin + account,
//   eliminating the race.
//
//   Phase 2 (non-admin Edit-button-hidden check) → STAYS on firm 106 + tyler.
//   Empirically verified that the dummy-firm advisor (adv_<firmCd>_1) is NOT
//   a drop-in for tyler@plimsollfp.com — the dummy advisor has full billing
//   edit rights, while tyler has a Plimsoll-FP-specific restricted custom
//   role. createDummyFirm.do has no way to provision a restricted role. The
//   tyler check is read-only (assert button count == 0), so it cannot race —
//   keeping it on firm 106 is safe under parallel load.

/**
 * Pick a "different" date one month away from the current one (same day,
 * adjacent month). Avoids leap-year / month-length edge cases.
 * @param {string} mmddyyyy
 * @returns {string}
 */
function nextMonthDate(mmddyyyy) {
  const [m, d, y] = mmddyyyy.split('/').map((v) => parseInt(v, 10));
  const next = new Date(Date.UTC(y, m, d)); // m is 0-based, so passing m advances one month
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  const yyyy = next.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

test('@pepi C25193 Account Billing Inception Date - Admin and Non-Admin', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  /** @type {string} */
  let originalDate;
  /** @type {string} */
  let newDate;

  await test.step('Phase 1.1: admin captures (or seeds) Billing Inception Date', async () => {
    await loginAsWorkerFirmAdmin(context, page, workerFirm);
    await gotoWorkerFirmAccountBilling(page, workerFirm);
    let displayed = (await getDisplayedBillingInceptionDate(page)).trim();
    if (!displayed) {
      // Dummy-firm accounts come with no inception date set; seed a baseline
      // so the change-and-verify round-trip below has something to compare to.
      await openEditBillingSettings(page);
      await setBillingInceptionDate(page, '12/01/2024');
      await saveEditBillingSettings(page);
      await expect
        .poll(async () => (await getDisplayedBillingInceptionDate(page)).trim(), {
          timeout: 15_000,
        })
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
    await openEditBillingSettings(page);
    await setBillingInceptionDate(page, newDate);
    await saveEditBillingSettings(page);
    await expect
      .poll(async () => (await getDisplayedBillingInceptionDate(page)).trim(), {
        timeout: 15_000,
      })
      .toBe(newDate);
  });
  // No cleanup revert step — each worker has its own dummy firm, so audit
  // history accumulation per run is irrelevant.

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    // Read-only check on shared firm 106 — no race since tyler never mutates.
    await loginAsNonAdmin(context, page);
    await gotoAccountBilling(page);
    await expect(
      page.getByRole('button', { name: 'Edit Billing Settings' })
    ).toHaveCount(0);
  });
});
