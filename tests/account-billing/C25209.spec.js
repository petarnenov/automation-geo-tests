// @ts-check
/**
 * TestRail C25209 — Account: Unmanaged Assets - Update - Exclude from Billing
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25209 (Run 175, label Pepi)
 * Refs:   GEO-20808
 *
 * Hybrid isolation (mirrors C25208):
 *
 *   Phase 1 (write/read flow) → workerFirm. The shared Arnold, Delaney
 *   account on firm 106 accumulates UA history across every test run; once
 *   per-instrument history exceeds NUMBER_OF_ELEMENTS=25 in
 *   BillingSettingsHistoryParser.java the parser no longer surfaces the
 *   recent Update rows the assertion below needs. Each worker now provisions
 *   its own dummy firm via /qa/createDummyFirm.do.
 *
 *   Phase 2 (non-admin tyler check) → STAYS on firm 106 + tyler. The dummy
 *   advisor (adv_<firmCd>_1) has full firm-admin rights, not Tyler's
 *   restricted Plimsoll-FP-specific role.
 *
 * Phase 1 (workerFirm admin):
 *   - bulk-upload an APPLE INC. row onto the dummy firm's first account so
 *     the Manage UA dialog opens with a pre-existing Apple row
 *   - open Manage UA, normalise all 6 billing-bucket combos to "All" (the
 *     xlsx seed sets them to mixed values from validRowFor — this Save is the
 *     first real diff and emits per-bucket Update rows)
 *   - toggle Exclude From Performance, Save
 *   - re-open and toggle Exclude From Performance again, Save — the History
 *     parser requires a 2nd save before any rows surface
 *     (see _unmanaged-assets-helpers.js note 2)
 *   - open History and assert at least one Apple "Create" or "Update" row
 *     with SETTING="Exclude from Billing" for any of the 6 buckets
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com, on firm 106):
 *   - assert that the Manage Unmanaged Assets button is NOT visible.
 */

const { test, expect } = require('@playwright/test');
const { loginAsWorkerFirmAdmin, loginAsNonAdmin } = require('./_helpers');
const {
  loginPlatformOneAdmin,
  uploadUnmanagedAssetsExclusions,
  gotoAccountUnmanagedAssets,
} = require('../_helpers/qa3');
const { buildXlsxFor, APPLE_SYMBOL, APPLE_HOLDINGS } = require('../unmanaged-assets/_helpers');
const {
  BUCKET_KEYS,
  openManageDialog,
  setMultiGroupBucket,
  getMultiGroupBucket,
  toggleExcludeFromPerformance,
  saveManageDialog,
  openHistoryModal,
  closeHistoryModal,
  findRowIndexBySymbol,
  findHistoryRow,
} = require('./_unmanaged-assets-helpers');

// Phase 2 read-only check on the shared firm 106 / Arnold, Delaney account.
const FIRM_106_CLIENT_UUID = 'A80D472B04874979AAA3D8C3FFE9BD3A';
const FIRM_106_ACCOUNT_UUID = '5588D454741342FBB9AABA8FF17A85EE';
const FIRM_106_UA_URL = `/react/indexReact.do#/client/1/${FIRM_106_CLIENT_UUID}/accounts/${FIRM_106_ACCOUNT_UUID}/unmanagedAssets`;

test('@pepi C25209 Account Unmanaged Assets - Update Exclude from Billing', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  await test.step('Setup: seed Apple Inc on the dummy firm via xlsx upload', async () => {
    await loginPlatformOneAdmin(page);
    await uploadUnmanagedAssetsExclusions(page, workerFirm.firmCd, buildXlsxFor(workerFirm));
  });

  await test.step('Phase 1.1: workerFirm admin opens Manage UA, normalises buckets, toggles EFP, saves', async () => {
    await loginAsWorkerFirmAdmin(context, page, workerFirm);
    await gotoAccountUnmanagedAssets(page, workerFirm.household.uuid, workerFirm.accounts[0].uuid);
    await expect(page.getByRole('button', { name: 'Manage Unmanaged Assets' })).toBeVisible({
      timeout: 30_000,
    });

    await openManageDialog(page);

    // The Manage UA dialog's symbol input renders the instrument's HOLDINGS
    // (e.g. "APPLE INC."), not the ticker symbol. Match on holdings.
    const appleRow = await findRowIndexBySymbol(page, new RegExp(APPLE_HOLDINGS, 'i'));
    expect(appleRow, 'Apple row must exist after xlsx seed').toBeGreaterThanOrEqual(0);

    for (const key of BUCKET_KEYS) {
      if ((await getMultiGroupBucket(page, appleRow, key)) !== 'All') {
        await setMultiGroupBucket(page, appleRow, key, 'All');
      }
    }

    // Toggle the perf checkbox so each save has a guaranteed diff (the
    // bucket combo changes via React-onClick sometimes silently fail to mark
    // the form as dirty enough for Save). The 2-save flow below also gates
    // the History parser (see _unmanaged-assets-helpers.js note 2).
    await toggleExcludeFromPerformance(page, appleRow);
    await saveManageDialog(page);
  });

  await test.step('Phase 1.2: trigger 2nd save so the History parser emits Update rows', async () => {
    await openManageDialog(page);
    const appleRow = await findRowIndexBySymbol(page, new RegExp(APPLE_HOLDINGS, 'i'));
    expect(appleRow, 'Apple row must exist after Phase 1.1').toBeGreaterThanOrEqual(0);
    await toggleExcludeFromPerformance(page, appleRow);
    await saveManageDialog(page);
  });

  await test.step('Phase 1.3: open History and verify Apple Update row for Exclude from Billing', async () => {
    await openHistoryModal(page);
    // The qa3 history parser uses both Create and Update activity labels for
    // the same instrument depending on its iteration order — accept either.
    // The 6 buckets all transitioned from their xlsx-seed values to "All" in
    // Phase 1.1, so Update rows for at least one bucket are guaranteed.
    // The modal is a React portal with a virtualised ag-grid body — scroll-search.
    // History grid shows the instrument's ticker (US037833EN61), not the
    // holdings text — match on APPLE_SYMBOL here even though the Manage UA
    // dialog uses APPLE_HOLDINGS in its symbol input.
    const row = await findHistoryRow(
      page,
      new RegExp(
        `(Create|Update).*${APPLE_SYMBOL}.*Exclude from Billing.*(Advisor|Platform|Money manager|Internal)`,
        'i'
      ),
      { timeout: 15_000 }
    );
    await expect(row).toBeVisible();
    await closeHistoryModal(page);
  });

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Manage Unmanaged Assets', async () => {
    // Read-only check on shared firm 106 — no race since tyler never mutates.
    await loginAsNonAdmin(context, page);
    await page.goto(FIRM_106_UA_URL);
    await expect(page.getByRole('button', { name: 'Manage Unmanaged Assets' })).toHaveCount(0);
  });
});
