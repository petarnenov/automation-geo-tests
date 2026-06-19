// @ts-check
/**
 * TestRail C25023 — Partial Re-run Action Not Available for Ineligible Billings
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25023 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions:
 *   - User on Billing Runs; an ineligible billing exists (published=Y OR
 *     status ∈ {Canceled, In Progress, Ready, Failed, ...}, i.e. anything
 *     other than Completed+Unpublished).
 *
 * Steps:
 *   1. Select the ineligible row.
 *   Expected: footer 'Re Run' button is disabled (has `disabled` style class).
 *
 * Source-of-truth (FE): BillingRunsGridFooterActions.js
 *   canReRun = length && allChildrenHasSameParent
 *              && everyBillingRunsCompleted && everyBillingRunsUnpublished
 *
 * Button uses `styles.disabled` class (no native `disabled` attribute,
 * per project_formbuilder_disabled_style_only memory).
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';

test('@pepi C25023 Partial Re-run Action Not Available for Ineligible Billings', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  /** Find first ineligible BillingRuns master row: status != Completed OR published != N. */
  const findIneligibleRow = async () => {
    await page.locator('.ag-row').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    return await page.evaluateHandle(() => {
      const grids = Array.from(document.querySelectorAll('.ag-center-cols-container'));
      const billingGrid = grids.find((g) =>
        g.querySelector('[col-id="billingRunStatuses"]')
      );
      if (!billingGrid) return null;
      const masters = Array.from(billingGrid.querySelectorAll(':scope > .ag-row')).filter(
        (r) => !r.closest('.ag-details-row')
      );
      for (const row of masters) {
        const status = row.querySelector('[col-id="billingRunStatuses"]')?.textContent?.trim() || '';
        const published = row.querySelector('[col-id="publishedRuns"]')?.textContent?.trim() || '';
        // Ineligible: any non-Completed status OR Completed but Published=Y/Various.
        if (status && (status !== 'Completed' || published === 'Y' || published === 'Various')) {
          return row;
        }
      }
      return null;
    });
  };

  await expect
    .poll(
      async () => {
        const h = await findIneligibleRow();
        const ok = !!h.asElement();
        await h.dispose();
        return ok;
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000] }
    )
    .toBe(true);

  const handle = await findIneligibleRow();
  const el = handle.asElement();
  expect(el, 'an ineligible billing row should exist').toBeTruthy();

  const rowId = await /** @type {import('playwright-core').ElementHandle} */ (
    el
  ).evaluate((r) => r.getAttribute('row-id'));
  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Step 1: Select the ineligible row', async () => {
    const checkbox = masterRow
      .locator('.ag-selection-checkbox .ag-checkbox-input')
      .first();
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.click();
    await expect(masterRow).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  });

  await test.step('Expected: footer "Re Run" button is disabled', async () => {
    const reRun = page.locator('button', { hasText: /^Re Run$/ }).first();
    await expect(reRun).toBeVisible({ timeout: 10_000 });
    await expect(reRun).toHaveClass(/disabled/i, { timeout: 10_000 });
  });
});
