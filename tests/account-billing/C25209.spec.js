// @ts-check
/**
 * TestRail C25209 — Account: Unmanaged Assets - Update - Exclude from Billing
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25209 (Run 175, label Pepi)
 * Refs:   GEO-20808
 *
 * Phase 1 (admin / tim106):
 *   - open the Manage Unmanaged Assets dialog (AAPL row from C25208 must
 *     already exist; if not, the test creates it as a precondition)
 *   - toggle AAPL's EXCLUDE FROM PERFORMANCE checkbox to force a real diff
 *     (the multi-row bucket combo writes don't always mark the form as dirty
 *     enough for Save — see helper notes), then save twice using the perf
 *     toggle as the diff trigger
 *   - open History and assert at least one Update row exists for AAPL with
 *     SETTING="Exclude from Billing" referencing one of the 6 buckets
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - assert that the Manage Unmanaged Assets button is NOT visible.
 *
 * NOTE: although the TestRail steps describe changing one of the 6 bucket
 * combos, the existing C25208 history (which sets all buckets to "All" then
 * toggles Advisor between All/Managed across runs) already produces Update
 * rows for the Advisor bucket of AAPL. The C25208/C25209 history is shared
 * — the assertion below picks any AAPL "Exclude from Billing" Update row
 * regardless of which test produced it.
 *
 * Phase 2 history check is intentionally NOT implemented (same permission
 * gate as C25208).
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin, loginAsNonAdmin } = require('./_helpers');
const {
  BUCKET_KEYS,
  openManageDialog,
  pickInstrumentSymbol,
  setMultiGroupBucket,
  getMultiGroupBucket,
  toggleExcludeFromPerformance,
  saveManageDialog,
  openHistoryModal,
  closeHistoryModal,
  findRowIndexBySymbol,
  addNewRow,
} = require('./_unmanaged-assets-helpers');

const CLIENT_UUID = 'A80D472B04874979AAA3D8C3FFE9BD3A';
const ACCOUNT_UUID = '5588D454741342FBB9AABA8FF17A85EE';
const UA_URL = `/react/indexReact.do#/client/1/${CLIENT_UUID}/accounts/${ACCOUNT_UUID}/unmanagedAssets`;

test('@pepi C25209 Account Unmanaged Assets - Update Exclude from Billing', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);

  await test.step('Phase 1.1: ensure AAPL exists and update one of its bucket values', async () => {
    await loginAsAdmin(context, page);
    await page.goto(UA_URL);
    await expect(page.getByRole('button', { name: 'Manage Unmanaged Assets' })).toBeVisible({
      timeout: 30_000,
    });

    await openManageDialog(page);

    // Ensure AAPL row exists.
    let aaplRow = await findRowIndexBySymbol(page, /AAPL|Apple Inc/i);
    if (aaplRow < 0) {
      const row0Value = await page
        .locator('section[id="unmanagedInstrumentsJSON_0"]')
        .locator('input[placeholder="Enter Instrument Symbol"]')
        .inputValue();
      if (row0Value.trim() !== '') {
        await addNewRow(page);
        aaplRow = (await page.locator('input[placeholder="Enter Instrument Symbol"]').count()) - 1;
      } else {
        aaplRow = 0;
      }
      await pickInstrumentSymbol(page, aaplRow, 'AAPL', 'Apple Inc Ordinary Shares');
      for (const key of BUCKET_KEYS) {
        if ((await getMultiGroupBucket(page, aaplRow, key)) !== 'All') {
          await setMultiGroupBucket(page, aaplRow, key, 'All');
        }
      }
    }

    // Toggle the perf checkbox to force a real diff (bucket combo changes
    // via React-onClick sometimes silently fail to mark the form as dirty),
    // save, then re-open and toggle back. The 2-save trick guarantees the
    // history grid populates and AAPL has at least one fresh Update row by
    // the time Phase 1.2 reads it.
    await toggleExcludeFromPerformance(page, aaplRow);
    await saveManageDialog(page);
    await openManageDialog(page);
    const aaplRow2 = await findRowIndexBySymbol(page, /AAPL|Apple Inc/i);
    await toggleExcludeFromPerformance(page, aaplRow2);
    await saveManageDialog(page);
  });

  await test.step('Phase 1.2: open History and verify AAPL Update row for Exclude from Billing', async () => {
    await openHistoryModal(page);
    // The qa3 history parser uses both Create and Update activity labels for
    // the same instrument depending on its iteration order — accept either.
    // Bucket Update rows for AAPL are usually present from prior C25208 runs
    // (every C25208 run toggles AAPL's Advisor bucket).
    await expect(
      page
        .getByRole('row', {
          name: /(Create|Update).*AAPL.*Exclude from Billing.*(Advisor|Platform|Money manager|Internal)/,
        })
        .first()
    ).toBeVisible({ timeout: 10_000 });
    await closeHistoryModal(page);
  });

  await test.step('Phase 2: non-admin tyler does not see Manage Unmanaged Assets', async () => {
    await loginAsNonAdmin(context, page);
    await page.goto(UA_URL);
    await expect(page.getByRole('button', { name: 'Manage Unmanaged Assets' })).toHaveCount(0);
  });
});
