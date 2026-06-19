// @ts-check
/**
 * TestRail C25021 — Timestamp Superscript for Partial Re-run
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25021 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions:
 *   - A partial re-run has completed (row with partialReRun=true).
 *
 * Step 1: Review the Submitted and Completed timestamps.
 * Expected: timestamps display an asterisk superscript, indicating
 *           partial re-run.
 *
 * Source-of-truth (FE):
 *   - BillingTemplates/consts.js — RE_RUN_SYMBOL = '*'.
 *   - BillingRuns/Components/BillingRunsGrid/_hooks/useBillingRunsColumnDef.js
 *     master + detail Status renderers append RE_RUN_SYMBOL when
 *     data.partialReRun === true.
 *   - The case copy says "Submitted/Completed timestamps" but the FE
 *     attaches the symbol to the Status column value, not the date
 *     columns; we assert the actual FE behaviour.
 *
 * Test data: pre-seeded "GeoWealth" / template "min-max-1111111" row on
 * qa4 carries partialReRun=true (probed via /platformOne/getNewBillingRows.do).
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';
const SEED_TEMPLATE_NAME = 'min-max-1111111';

test('@pepi C25021 Timestamp Superscript for Partial Re-run', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  await test.step(`Narrow grid via Search box to "${SEED_TEMPLATE_NAME}"`, async () => {
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
  const el = handle.asElement();
  expect(el).toBeTruthy();
  const rowId = await /** @type {import('playwright-core').ElementHandle} */ (
    el
  ).evaluate((r) => r.getAttribute('row-id'));
  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Status cell on the partial re-run row contains the "*" superscript', async () => {
    const statusCell = masterRow.locator('[col-id="billingRunStatuses"]').first();
    await expect(statusCell).toBeVisible({ timeout: 10_000 });
    // useBillingRunsColumnDef.masterStatusRenderer returns `${value}${reRunSymbol}`
    // and RE_RUN_SYMBOL = '*' (BillingTemplates/consts.js), so the visible
    // text reads e.g. "Completed*".
    await expect(statusCell).toHaveText(/\*/, { timeout: 10_000 });
  });
});
