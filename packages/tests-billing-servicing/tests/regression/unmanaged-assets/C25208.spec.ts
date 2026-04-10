/**
 * TestRail C25208 — Account: Unmanaged Assets - Create - Exclude from Billing
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25208
 *         (Run 175, label Pepi)
 * Refs:   GEO-20808
 *
 * Firm 106 only — uses the Arnold/Delaney UA tab.
 *
 *   Phase 1 (admin) → tim106Page. Ensures AAPL row exists with all
 *     6 buckets = "All", toggles perf checkbox to force a diff, saves
 *     twice (history parser `grouped.size() > 1` gate), verifies
 *     at least one AAPL "Exclude from Billing" history row.
 *
 *   Phase 2 (non-admin) → tylerPage. Manage button hidden check.
 *     Tyler lacks `canLoggedUserExecuteBillingSettings` so History
 *     is not asserted for the non-admin path.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { UnmanagedAssetsPage } from '../../../src/pages/unmanaged-assets/UnmanagedAssetsPage';

test('@regression @billing-servicing C25208 Unmanaged Assets - Create Exclude from Billing', async ({
  tim106Page,
  tylerPage,
}) => {
  test.slow();

  const ua = new UnmanagedAssetsPage(tim106Page);

  await test.step('Phase 1.1: ensure AAPL exists with all 6 buckets = All', async () => {
    await ua.goto();
    await ua.openManageDialog();

    const aaplRow = await ua.ensureInstrumentRow(
      /AAPL|Apple Inc/i,
      'AAPL',
      'Apple Inc Ordinary Shares'
    );
    await ua.setAllBuckets(aaplRow, 'All');
    await ua.toggleExcludeFromPerformance(aaplRow);
    await ua.saveManageDialog();

    await expect(tim106Page.getByRole('row', { name: /AAPL.*Apple Inc Ordinary Shares/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  await test.step('Phase 1.2: 2nd save so History parser emits Create rows', async () => {
    await ua.openManageDialog();
    const aaplRow = await ua.findRowIndexBySymbol(/AAPL|Apple Inc/i);
    expect(aaplRow, 'AAPL row must exist after Phase 1.1').toBeGreaterThanOrEqual(0);
    await ua.toggleExcludeFromPerformance(aaplRow);
    await ua.saveManageDialog();
  });

  await test.step('Phase 1.3: History shows AAPL Exclude from Billing row', async () => {
    await ua.openHistory();
    await expect(
      tim106Page
        .getByRole('row', {
          name: /(Create|Update).*AAPL.*Exclude from Billing.*(Advisor|Platform|Money manager|Internal).*All/,
        })
        .first()
    ).toBeVisible({ timeout: 10_000 });
    await ua.closeHistory();
  });

  await test.step('Phase 2: tyler does not see Manage Unmanaged Assets', async () => {
    const ua2 = new UnmanagedAssetsPage(tylerPage);
    await ua2.goto();
    await expect(ua2.manageButton).toHaveCount(0);
    await expect(tylerPage.getByRole('row', { name: /AAPL.*Apple Inc Ordinary Shares/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});
