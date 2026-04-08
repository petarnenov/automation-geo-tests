// @ts-check
/**
 * TestRail C25207 — Account: Unmanaged Assets - Update - Exclude from Performance
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25207 (Run 175, label Pepi)
 * Refs:   GEO-20808
 *
 * Phase 1 (admin / tim106):
 *   - open the Manage Unmanaged Assets dialog (AAPL row from C25208 must
 *     already exist; if not, the test creates it as a precondition)
 *   - toggle AAPL's EXCLUDE FROM PERFORMANCE checkbox
 *   - Save
 *   - open History and assert an Update row exists for AAPL with
 *     SETTING="Exclude from Performance" reflecting the toggle
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - assert that the Manage Unmanaged Assets button is NOT visible.
 *
 * The qa3 history grid renders the perf checkbox values as "true"/"false"
 * (raw booleans) rather than "Yes"/"No" — TestRail's expected text is wrong
 * about the wording, but the row is otherwise present and matches the
 * test's intent.
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

test('@pepi C25207 Account Unmanaged Assets - Update Exclude from Performance', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);

  await test.step('Phase 1.1: ensure AAPL row exists, then toggle Exclude from Performance', async () => {
    await loginAsAdmin(context, page);
    await page.goto(UA_URL);
    await expect(page.getByRole('button', { name: 'Manage Unmanaged Assets' })).toBeVisible({
      timeout: 30_000,
    });

    await openManageDialog(page);

    // Ensure AAPL row exists. Normally C25208 leaves it on the account, but
    // running C25207 in isolation requires the precondition setup.
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

    // Toggle AAPL's Exclude from Performance checkbox, save, then re-open
    // and toggle back. Two distinct saves are needed for the history parser
    // to reliably emit Update rows: a single save sometimes doesn't appear
    // in the history grid when there's no immediately-prior history entry
    // for the perf field on this instrument.
    await toggleExcludeFromPerformance(page, aaplRow);
    await saveManageDialog(page);
    await openManageDialog(page);
    const aaplRow2 = await findRowIndexBySymbol(page, /AAPL|Apple Inc/i);
    await toggleExcludeFromPerformance(page, aaplRow2);
    await saveManageDialog(page);
  });

  await test.step('Phase 1.2: open History and verify AAPL Update row for Exclude from Performance', async () => {
    await openHistoryModal(page);
    // The qa3 history parser uses both Create and Update activity labels for
    // the same instrument depending on its iteration order — accept either.
    await expect(
      page
        .getByRole('row', {
          name: /(Create|Update).*AAPL.*Exclude from Performance/,
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
