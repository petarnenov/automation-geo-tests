// @ts-check
/**
 * TestRail C26073 — Unmanaged Assets [Update/Add action]
 *   "verified that the user is able to create a new record using U action"
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26073 (Run 175, label Pepi)
 *
 * Phase 1 — Platform One: upload xlsx with Action=U for firm 106 as `tim1`,
 *           verify the success modal.
 * Phase 2 — Advisor Portal: re-authenticate as `tim106`, navigate to the account's
 *           Unmanaged Assets page, and verify the imported instrument row matches
 *           the expected portfolio type names.
 *
 * Test data (from tests/fixtures/UnmanagedAssetsExclusions_C26073_U.xlsx):
 *   Firm Code             = 106  → "(106) GeoWealth"
 *   Account UUID          = 338BD8AB82A244158A5687959967CC59
 *   Instrument UUID       = 5F5FE5576175486BAE2DA9932CEEDD6A → US037833EN61 / APPLE INC.
 *   Action                = U  (Update/Add)
 *   Portfolio types       = MM 3 / IA 2 / IP 1 / I MM 5
 *
 * Value→name decoder (from C26073 custom_summary):
 *   0=null(Select), 1=All, 2=Managed, 3=Discretionary, 4=Unaffiliated Cash, 5=Unmanaged
 */

const { test, expect } = require('@playwright/test');
const {
  loginPlatformOneAdmin,
  switchToAdvisor,
  uploadUnmanagedAssetsExclusions,
  gotoAccountUnmanagedAssets,
} = require('../_helpers/qa3');
const { buildXlsxFor, APPLE_SYMBOL, APPLE_HOLDINGS } = require('./_helpers');

const EXPECTED = {
  symbol: APPLE_SYMBOL,
  holdings: APPLE_HOLDINGS,
  excludeFromPerformance: 'No',
  moneyManager: 'Discretionary', // xlsx I=3
  internalAdvisor: 'Managed', // xlsx J=2
  internalPlatform: 'All', // xlsx K=1
  internalMM: 'Unmanaged', // xlsx L=5
};

test('@pepi C26073 Unmanaged Assets - Update/Add (U action) creates a new exclusion record', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  await test.step('Phase 1: upload U-action exclusion file as Platform One admin', async () => {
    await loginPlatformOneAdmin(page);
    await uploadUnmanagedAssetsExclusions(
      page,
      workerFirm.firmCd,
      buildXlsxFor(workerFirm /* default action: 'U' */)
    );
  });

  await test.step(`Phase 2: verify the new row in Advisor Portal as ${workerFirm.advisor.loginName}`, async () => {
    await switchToAdvisor(context, page, workerFirm.advisor.loginName);
    await gotoAccountUnmanagedAssets(page, workerFirm.client.uuid, workerFirm.accounts[0].uuid);

    const row = page.getByRole('row', { name: new RegExp(EXPECTED.symbol) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await expect(row.getByRole('gridcell', { name: EXPECTED.symbol, exact: true })).toBeVisible();
    await expect(row.getByRole('gridcell', { name: EXPECTED.holdings, exact: true })).toBeVisible();
    await expect(
      row.getByRole('gridcell', { name: EXPECTED.excludeFromPerformance, exact: true })
    ).toBeVisible();
    await expect(
      row.getByRole('gridcell', { name: EXPECTED.moneyManager, exact: true })
    ).toBeVisible();
    await expect(
      row.getByRole('gridcell', { name: EXPECTED.internalAdvisor, exact: true })
    ).toBeVisible();
    await expect(
      row.getByRole('gridcell', { name: EXPECTED.internalPlatform, exact: true })
    ).toBeVisible();
    await expect(
      row.getByRole('gridcell', { name: EXPECTED.internalMM, exact: true }).first()
    ).toBeVisible();
  });
});
