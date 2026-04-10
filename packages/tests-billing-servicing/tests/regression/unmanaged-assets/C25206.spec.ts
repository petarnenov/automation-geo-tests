/**
 * TestRail C25206 — Account: Unmanaged Assets - Create - Exclude from Performance
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25206
 *         (Run 175, label Pepi)
 * Refs:   GEO-20808
 *
 * Firm 106 only. Uses MSFT (not AAPL) so C25206 and C25208 exercise
 * distinct Create code paths and keep history rows separate.
 *
 *   Phase 1 — tim106Page. Ensures MSFT row with all 6 buckets = "All"
 *     and Exclude from Performance = Yes, saves twice (history parser
 *     gate), verifies MSFT "Exclude from Performance" history row.
 *
 *   Phase 2 — tylerPage. Manage button hidden check.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { UnmanagedAssetsPage } from '../../../src/pages/unmanaged-assets/UnmanagedAssetsPage';

const SYMBOL_PATTERN = /MSFT|Microsoft/i;
const SYMBOL_OPTION_TEXT = 'Microsoft';

test('@regression @billing-servicing C25206 Unmanaged Assets - Create Exclude from Performance', async ({
  tim106Page,
  tylerPage,
}) => {
  test.slow();

  const ua = new UnmanagedAssetsPage(tim106Page);

  await test.step('Phase 1.1: ensure MSFT row with all buckets = All and Exclude from Performance = Yes', async () => {
    await ua.goto();
    await ua.openManageDialog();

    const msftRow = await ua.ensureInstrumentRow(SYMBOL_PATTERN, 'MSFT', SYMBOL_OPTION_TEXT);
    await ua.setAllBuckets(msftRow, 'All');
    // Always toggle perf to force the form dirty — if already
    // checked from a prior run, a no-change save silently no-ops
    // and the dialog won't close.
    await ua.toggleExcludeFromPerformance(msftRow);
    await ua.saveManageDialog();

    await expect(tim106Page.getByRole('row', { name: /MSFT.*Microsoft/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  await test.step('Phase 1.2: 2nd save so History parser emits Create rows', async () => {
    await ua.openManageDialog();
    const msftRow = await ua.findRowIndexBySymbol(SYMBOL_PATTERN);
    expect(msftRow, 'MSFT row must exist after Phase 1.1').toBeGreaterThanOrEqual(0);
    await ua.toggleExcludeFromPerformance(msftRow);
    await ua.saveManageDialog();
    // Re-open and toggle back to Yes.
    await ua.openManageDialog();
    const msftRow2 = await ua.findRowIndexBySymbol(SYMBOL_PATTERN);
    await ua.toggleExcludeFromPerformance(msftRow2);
    await ua.saveManageDialog();
  });

  await test.step('Phase 1.3: History shows MSFT Exclude from Performance row', async () => {
    await ua.openHistory();
    await expect(
      tim106Page
        .getByRole('row')
        .filter({ hasText: /MSFT/ })
        .filter({ hasText: /Exclude from Performance/ })
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
