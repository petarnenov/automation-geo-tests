/**
 * TestRail C25207 — Account: Unmanaged Assets - Update - Exclude from Performance
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25207
 *         (Run 175, label Pepi)
 * Refs:   GEO-20808
 *
 * Firm 106 only. Ensures AAPL exists, toggles Exclude from
 * Performance twice (2-save trick), verifies an AAPL Update
 * "Exclude from Performance" history row.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { UnmanagedAssetsPage } from '../../../src/pages/unmanaged-assets/UnmanagedAssetsPage';

test('@regression @billing-servicing C25207 Unmanaged Assets - Update Exclude from Performance', async ({
  tim106Page,
  tylerPage,
}) => {
  test.slow();

  const ua = new UnmanagedAssetsPage(tim106Page);

  await test.step('Phase 1.1: ensure AAPL exists, toggle perf twice', async () => {
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

    await ua.openManageDialog();
    const aaplRow2 = await ua.findRowIndexBySymbol(/AAPL|Apple Inc/i);
    await ua.toggleExcludeFromPerformance(aaplRow2);
    await ua.saveManageDialog();
  });

  await test.step('Phase 1.2: History shows AAPL Update Exclude from Performance row', async () => {
    await ua.openHistory();
    await expect(
      tim106Page
        .getByRole('row', {
          name: /(Create|Update).*AAPL.*Exclude from Performance/,
        })
        .first()
    ).toBeVisible({ timeout: 10_000 });
    await ua.closeHistory();
  });

  await test.step('Phase 2: tyler does not see Manage Unmanaged Assets', async () => {
    const ua2 = new UnmanagedAssetsPage(tylerPage);
    await ua2.goto();
    await expect(ua2.manageButton).toHaveCount(0);
  });
});
