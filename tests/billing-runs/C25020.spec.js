// @ts-check
/**
 * TestRail C25020 — Totals Update for Full Billing Run
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25020 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions:
 *   - Partial re-run has completed (partialReRun=true row exists).
 *
 * Step 1: Check 'Total Accounts Billed' and 'Total Billed' after the
 *         partial re-run.
 * Expected: totals reflect the entire billing run, including updated
 *           values from the re-run (cells populated, not "N/A" / empty).
 *
 * Source-of-truth (FE):
 *   - useBillingRunsColumnDef.js — `detailsGridColumnsDefs` defines
 *     `billedAccounts` ("Total Accounts Billed", cellRenderer
 *     getBilledAccounts) and `totalBill` ("Total Billed", cellRenderer
 *     getAdvisorTotalValues).
 *   - Master row exposes the master/detail expand on click via
 *     GwGrid.onCellClicked → node.setExpanded; detail rows render inside
 *     `.ag-details-row`.
 *
 * Test data: re-uses the qa4 pre-seeded "GeoWealth" / template
 * "min-max-1111111" row (partialReRun=true).
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';
const SEED_TEMPLATE_NAME = 'min-max-1111111';

test('@pepi C25020 Totals Update for Full Billing Run', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  await test.step(`Search the partial re-run row by template "${SEED_TEMPLATE_NAME}"`, async () => {
    const search = page.getByPlaceholder('Search').first();
    await search.click();
    await search.fill(SEED_TEMPLATE_NAME);
  });

  const findReRunRow = async () => {
    return await page.evaluateHandle((name) => {
      const grids = Array.from(document.querySelectorAll('.ag-center-cols-container'));
      const billingGrid = grids.find((g) =>
        g.querySelector('[col-id="billingRunStatuses"]')
      );
      if (!billingGrid) return null;
      const masters = Array.from(billingGrid.querySelectorAll(':scope > .ag-row')).filter(
        (r) => !r.closest('.ag-details-row')
      );
      for (const row of masters) {
        const tmplt = row.querySelector('[col-id="tmpltName"]')?.textContent?.trim() || '';
        if (tmplt === name) return row;
      }
      return null;
    }, SEED_TEMPLATE_NAME);
  };

  await expect
    .poll(
      async () => {
        const h = await findReRunRow();
        const ok = !!h.asElement();
        await h.dispose();
        return ok;
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000] }
    )
    .toBe(true);

  const handle = await findReRunRow();
  const rowId = await handle
    .asElement()
    .evaluate((r) => r.getAttribute('row-id'));
  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Expand the partial re-run master row', async () => {
    // GwGrid has no agGroupCellRenderer chevron — onCellClicked toggles
    // node.setExpanded(!expanded). Click the Firm Name cell to open it.
    const firmNameCell = masterRow.locator('[col-id="firmName"]').first();
    const isExpanded = async () =>
      (await masterRow.getAttribute('aria-expanded')) === 'true';
    if (!(await isExpanded())) {
      await firmNameCell.click();
      await expect
        .poll(async () => await isExpanded(), {
          timeout: 10_000,
          intervals: [200, 400, 800, 1500],
        })
        .toBe(true);
    }
  });

  await test.step('Detail Total Accounts Billed + Total Billed cells are populated', async () => {
    // Detail grid lives in `.ag-details-row` directly following the master.
    const detail = page
      .locator('.ag-details-row')
      .filter({ has: page.locator('.ag-details-grid') })
      .first();
    await expect(detail).toBeVisible({ timeout: 15_000 });
    const firstDetailRow = detail.locator('.ag-center-cols-container .ag-row').first();
    await expect(firstDetailRow).toBeVisible({ timeout: 15_000 });

    const totalAccountsCell = firstDetailRow.locator('[col-id="billedAccounts"]').first();
    const totalBilledCell = firstDetailRow.locator('[col-id="totalBill"]').first();
    await expect(totalAccountsCell).toBeVisible({ timeout: 10_000 });
    await expect(totalBilledCell).toBeVisible({ timeout: 10_000 });

    // Totals reflect the run — must be non-empty and not the "N/A" placeholder.
    // getBilledAccounts renders "<billed> / <total> (<pct>%)" for processed
    // accounts; getAdvisorTotalValues renders a currency string.
    const acctText = (await totalAccountsCell.textContent())?.trim() || '';
    const billedText = (await totalBilledCell.textContent())?.trim() || '';
    expect(acctText.length, 'Total Accounts Billed cell text').toBeGreaterThan(0);
    expect(acctText, 'Total Accounts Billed should not be N/A').not.toMatch(/^N\/A$/i);
    expect(billedText.length, 'Total Billed cell text').toBeGreaterThan(0);
    expect(billedText, 'Total Billed should not be N/A').not.toMatch(/^N\/A$/i);
  });
});
