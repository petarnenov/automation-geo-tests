// @ts-check
/**
 * TestRail C25019 — Billing History Replacement for Target Accounts
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25019 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions:
 *   - Partial re-run completed.
 *
 * Step 1: Review the billing history for the selected target accounts.
 * Expected: previous values are replaced in the billing export when
 *           there were updates (new transactions, restrictions, spec
 *           changes, etc.) on any target.
 *
 * Source-of-truth (FE):
 *   The replacement is a BE invariant — the UI surface for "this row
 *   carries re-run replacements" is the asterisk on the detail bucket
 *   row's Status (useBillingRunsColumnDef.detailStatusRenderer appends
 *   RE_RUN_SYMBOL when data.partialReRun === true), plus the existence
 *   of populated Total Accounts Billed / Total Billed cells (which would
 *   be blank or stale if history hadn't been replaced after the re-run).
 *   We verify both signals on the qa4 pre-seeded partial re-run row.
 *
 * Test data: pre-seeded "GeoWealth" / template "min-max-1111111"
 * (partialReRun=true) on qa4.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';
const SEED_TEMPLATE_NAME = 'min-max-1111111';

test('@pepi C25019 Billing History Replacement for Target Accounts', async ({ page }) => {
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

  await test.step('Expand the partial re-run master row to surface detail buckets', async () => {
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

  await test.step('Master row carries the re-run mark AND at least one detail bucket has populated totals', async () => {
    // The "*" superscript on the MASTER row's Status is the FE proof
    // that the billing history for this run has been replaced by the
    // partial re-run (masterStatusRenderer appends RE_RUN_SYMBOL when
    // data.partialReRun === true). Individual detail rows track their
    // own per-bucket partialReRun flag and may or may not be marked,
    // so we anchor the assertion on the master mark + populated totals
    // in the detail grid (a stale/blank Total Billed would imply the
    // history was not actually replaced).
    const masterStatus = masterRow.locator('[col-id="billingRunStatuses"]').first();
    await expect(masterStatus).toHaveText(/\*/, { timeout: 10_000 });

    const detail = page
      .locator('.ag-details-row')
      .filter({ has: page.locator('.ag-details-grid') })
      .first();
    await expect(detail).toBeVisible({ timeout: 15_000 });

    const detailRows = detail.locator('.ag-center-cols-container .ag-row');
    await expect(detailRows.first()).toBeVisible({ timeout: 15_000 });

    const billedTexts = await detailRows
      .locator('[col-id="totalBill"]')
      .allInnerTexts();
    const hasPopulatedBilled = billedTexts.some((t) => {
      const v = t.trim();
      return v.length > 0 && !/^N\/A$/i.test(v);
    });
    expect(hasPopulatedBilled, 'at least one Total Billed cell is populated').toBe(true);
  });
});
