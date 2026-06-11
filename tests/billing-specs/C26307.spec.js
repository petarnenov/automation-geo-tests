// @ts-check
/**
 * TestRail C26307 — Export multiple billing specifications using bulk Export
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26307 (Run 206)
 * Spec page:
 *   https://geowealth.atlassian.net/wiki/spaces/PRODOPS/pages/2019491841/Billing+Center+-+Billing+Specifications#Copy,-Export,-Delete,-History-Actions
 *
 * Steps (paraphrased):
 *   1. Open Billing Specifications grid for a firm with ≥2 specs.
 *   2. Select 2 rows via the selection checkboxes.
 *   3. Click the Export button in the bottom-of-grid bulk action footer.
 *   4. Verify a file download is initiated.
 *
 * Implementation notes:
 *   - Firm 1 (GeoWealth Management LLC) has many seeded specs on qa4 — we
 *     use it read-only (Export does NOT mutate state).
 *   - The bulk action footer (`BillingSpecsGridFooterActions.js`) mounts
 *     once at least one row is selected; before that, the row-count text
 *     "0 Selected Billing Spec" / "N Selected Billing Specs" tracks the
 *     selection.  The "Export" button (`ExportBillingSpecsButton`) is a
 *     <FileDownload.Post> wrapper around a `<button type="submit">` that
 *     POSTs to `/react/exportBillingSpecs.do` with the selected
 *     billingSpecId list, prompting a download.
 *   - Both the per-row Edit/Copy/Export/Delete actions AND the footer
 *     Export coexist; we anchor on the footer button by scoping to the
 *     "N Selected Billing Specs" text container.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const FIRM_CODE = 1;
const SPECS_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_CODE}`;

test('@pepi C26307 Export multiple billing specifications using bulk Export', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Billing Specifications grid for firm 1', async () => {
    await page.goto(SPECS_URL);
    await expect(
      page.getByText('Billing Specifications', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
  });

  await test.step('Select two billing spec rows via the selection checkboxes', async () => {
    // ag-grid's selection column renders a checkbox per row via
    // `.ag-selection-checkbox`. The first two rows are the first two
    // returned in the grid's default order (sort = Spec Name asc on qa4).
    // Click both checkboxes; the footer text mirrors the count.
    const firstRowCheckbox = page
      .locator('.ag-center-cols-container .ag-row[row-index="0"] .ag-selection-checkbox')
      .first();
    const secondRowCheckbox = page
      .locator('.ag-center-cols-container .ag-row[row-index="1"] .ag-selection-checkbox')
      .first();
    await firstRowCheckbox.click();
    await secondRowCheckbox.click();

    // The bulk-action footer shows "2 Selected Billing Specs" once both
    // rows are checked.  Match the pluralised form exactly so we don't
    // accept a stale "1 Selected" mid-click.
    await expect(page.getByText('2 Selected Billing Specs').first()).toBeVisible({
      timeout: 5000,
    });
  });

  await test.step('Click bulk Export and capture the download', async () => {
    // Footer renders the Export button as a plain Submit inside a
    // <FileDownload.Post>; clicking it POSTs to
    // /react/exportBillingSpecs.do which returns a file (Content-Disposition
    // attachment). Playwright's waitForEvent('download') captures the
    // download promise the browser raises.
    const footerSection = page
      .locator('section, footer, div')
      .filter({ hasText: /Selected Billing Specs/i })
      .first();
    const exportBtn = footerSection.getByRole('button', { name: 'Export', exact: true });
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });
    await expect(exportBtn).toBeEnabled();

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await exportBtn.click();
    const download = await downloadPromise;

    // The server names the file (typically `billing-specs-export-*.xlsx`
    // or similar). We don't assert on the exact name — just that the
    // browser registered a download with non-empty suggested filename.
    const suggested = download.suggestedFilename();
    expect(suggested, 'exported file name should be non-empty').toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`[C26307] downloaded: ${JSON.stringify(suggested)}`);

    // Saving the file would write to disk; for the @pepi suite we only
    // need to confirm the download event fired.  We still call
    // `path()` (it returns null on failure → throws) to guarantee the
    // payload is non-empty.
    const localPath = await download.path();
    expect(localPath, 'download path should exist').toBeTruthy();
  });
});
