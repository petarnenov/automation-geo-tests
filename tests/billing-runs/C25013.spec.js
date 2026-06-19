// @ts-check
/**
 * TestRail C25013 — Partial Re-run Action Visibility for Eligible Billings
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25013 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions (per case):
 *   - Logged into PlatformOne as a firm1 GW Admin (tim1).
 *   - Operations > Billing > Billing Runs grid, at least one Completed
 *     unpublished billing exists.
 *
 * Step 1: Locate any completed, unpublished billing.
 * Expected: The "Re Run" footer button is visible (enabled) when the parent
 *           billing row is selected, AND when any child (bucket) billing
 *           row from the same parent is selected.
 *
 * Source-of-truth (FE):
 *   pages/PlatformOne/.../BillingRuns/Components/BillingRunsGrid/
 *     - Components/BillingRunsGridFooterActions/BillingRunsGridFooterActions.js
 *       canReRun = length && allChildrenHasSameParent
 *                  && everyBillingRunsCompleted && everyBillingRunsUnpublished
 *       button text = consts.RE_RUN_LABEL = 'Re Run'
 *     - Components/_hooks/useBillingRunsGrid.js
 *       master multiRow checkbox + detail multiRow checkbox; selecting a
 *       master propagates to all its children.
 *
 * The Re Run button is always rendered; it's the `disabled` style class
 * that toggles. Per project_formbuilder_disabled_style_only, Button uses
 * `styles.disabled` (no HTML disabled attribute) so we gate on the class.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const { setReactDatePicker } = require('../_helpers/ui');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';

/**
 * Locate the Re Run footer button by its visible text. Wrap with first()
 * — the footer renders a single instance; this guards against re-renders.
 */
const reRunButton = (page) =>
  page.locator('button', { hasText: /^Re Run$/ }).first();

test('@pepi C25013 Partial Re-run Action Visibility for Eligible Billings', async ({ page }) => {
  test.setTimeout(240_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    // First the page chrome, then the grid header — finally a real row.
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  /**
   * Returns a Locator for the first master grid row whose Status cell reads
   * "Completed" and Published cell reads "N". The master grid uses the
   * top-level `.ag-center-cols-container .ag-row` selector — detail rows
   * sit inside `.ag-details-row` and are excluded by chaining `:not()`.
   */
  const findEligibleMasterRow = async () => {
    // Wait briefly for rows to render at all. If nothing visible, return null.
    await page.locator('.ag-row').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    const handle = await page.evaluateHandle(() => {
      const masterRows = Array.from(
        document.querySelectorAll('.ag-center-cols-container > .ag-row')
      ).filter((r) => !r.closest('.ag-details-row'));
      for (const row of masterRows) {
        const statusCell = row.querySelector('[col-id="billingRunStatuses"]');
        const publishedCell = row.querySelector('[col-id="publishedRuns"]');
        const status = statusCell?.textContent?.trim() || '';
        const published = publishedCell?.textContent?.trim() || '';
        if (status === 'Completed' && published === 'N') {
          return row;
        }
      }
      return null;
    });
    const asElement = handle.asElement();
    if (!asElement) {
      await handle.dispose();
      return null;
    }
    return asElement;
  };

  /** Widen the Created date filter to start of 2020 to maximise hit chances. */
  const widenCreatedFromTo2020 = async () => {
    const createdFromSection = page.locator('#createdFrom');
    if (await createdFromSection.isVisible().catch(() => false)) {
      await setReactDatePicker(page, createdFromSection, '01/01/2020');
      // After a date change the FormBuilder fires onChange which triggers
      // the Filter Apply automatically (Filter > Options auto-applies).
      // Give the grid a moment to re-fetch.
      await page.waitForTimeout(2000);
    }
  };

  let eligibleRow = await findEligibleMasterRow();
  if (!eligibleRow) {
    await widenCreatedFromTo2020();
    await page.locator('.ag-row').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
    eligibleRow = await findEligibleMasterRow();
  }

  if (!eligibleRow) {
    test.skip(
      true,
      'No completed unpublished billing run exists on qa4 for firm 1 — ' +
        'cannot exercise C25013 without seeded data.'
    );
  }

  // From here on, eligibleRow is guaranteed non-null.
  const rowId = await /** @type {import('playwright-core').ElementHandle} */ (
    eligibleRow
  ).evaluate((r) => r.getAttribute('row-id'));
  expect(rowId, 'master row should expose row-id').toBeTruthy();

  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Step 1a: Select the master billing row', async () => {
    // The selection checkbox is in the pinned-left checkbox column. ag-grid
    // renders it as `.ag-selection-checkbox .ag-checkbox-input-wrapper`.
    // Click via the input itself to bypass overlay quirks.
    const masterCheckbox = masterRow
      .locator('.ag-selection-checkbox .ag-checkbox-input')
      .first();
    await masterCheckbox.scrollIntoViewIfNeeded();
    await masterCheckbox.click();
    await expect(masterRow).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  });

  await test.step('Re Run button is visible and enabled with parent selected', async () => {
    const btn = reRunButton(page);
    await expect(btn).toBeVisible({ timeout: 10_000 });
    // Button is "enabled" when its className does NOT carry the disabled token.
    await expect(btn).not.toHaveClass(/disabled/i, { timeout: 10_000 });
  });

  await test.step('Step 1b: Deselect master, expand it, select a child bucket row', async () => {
    // Deselect the master so the child-only selection state is unambiguous
    // for the second assertion. The grid uses `enableClickSelection: false`
    // for the selection column, so clicking the checkbox toggles only
    // selection (not the row expand state).
    const masterCheckbox = masterRow
      .locator('.ag-selection-checkbox .ag-checkbox-input')
      .first();
    await masterCheckbox.click();
    await expect(masterRow).toHaveAttribute('aria-selected', 'false', { timeout: 10_000 });

    // The grid has no agGroupCellRenderer chevron — expand is wired via
    // GwGrid.onCellClicked → node.setExpanded(!expanded) on any cell that
    // doesn't carry `suppressExpandOnCellClick`. Clicking the Firm Name
    // cell flips the master row open. Reading aria-expanded keeps this
    // idempotent across re-runs that may have left the row open.
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

    // The detail grid lives in `.ag-details-row` immediately after the
    // master row in the DOM. Use the parent rowGroup to scope the lookup.
    const detailRow = page
      .locator(`.ag-details-row`)
      .filter({ has: page.locator('.ag-details-grid') })
      .first();
    await expect(detailRow).toBeVisible({ timeout: 15_000 });
    // Wait for at least one child row to materialise inside the detail.
    const firstChildRow = detailRow
      .locator('.ag-center-cols-container .ag-row')
      .first();
    await expect(firstChildRow).toBeVisible({ timeout: 15_000 });

    const childCheckbox = firstChildRow
      .locator('.ag-selection-checkbox .ag-checkbox-input')
      .first();
    await childCheckbox.scrollIntoViewIfNeeded();
    await childCheckbox.click();
    await expect(firstChildRow).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  });

  await test.step('Re Run button is visible and enabled with child bucket selected', async () => {
    const btn = reRunButton(page);
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await expect(btn).not.toHaveClass(/disabled/i, { timeout: 10_000 });
  });
});
