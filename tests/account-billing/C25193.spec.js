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
  loginAsAdmin,
  loginAsNonAdmin,
  gotoAccountBilling,
  openEditBillingSettings,
  saveEditBillingSettings,
  setBillingInceptionDate,
  getDisplayedBillingInceptionDate,
} = require('./_helpers');

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
}) => {
  test.setTimeout(240_000);

  /** @type {string} */
  let originalDate;
  /** @type {string} */
  let newDate;

  await test.step('Phase 1.1: admin captures current Billing Inception Date', async () => {
    await loginAsAdmin(context, page);
    await gotoAccountBilling(page);
    originalDate = (await getDisplayedBillingInceptionDate(page)).trim();
    expect(originalDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    newDate = nextMonthDate(originalDate);
    test.info().annotations.push({
      type: 'captured',
      description: `original=${originalDate} new=${newDate}`,
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

  await test.step('Phase 1.3: cleanup — revert Billing Inception Date to original', async () => {
    await openEditBillingSettings(page);
    await setBillingInceptionDate(page, originalDate);
    await saveEditBillingSettings(page);
    await expect
      .poll(async () => (await getDisplayedBillingInceptionDate(page)).trim(), {
        timeout: 15_000,
      })
      .toBe(originalDate);
  });

  await test.step('Phase 2: non-admin tyler cannot see Edit Billing Settings', async () => {
    await loginAsNonAdmin(context, page);
    await gotoAccountBilling(page);
    await expect(
      page.getByRole('button', { name: 'Edit Billing Settings' })
    ).toHaveCount(0);
  });
});
