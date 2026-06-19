// @ts-check
/**
 * TestRail C25017 — Run Button Activation Upon Valid Selection
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25017 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions:
 *   - Partial Re-run window is open; valid target selected.
 *
 * Steps:
 *   1. Select a valid target row.
 *   Expected: the 'Run' button becomes enabled.
 *
 * Test path:
 *   - Pick a Household-target Completed Unpublished row from the grid.
 *   - Open the Re Run Target(s) modal.
 *   - Before any selection, the Run submit button is disabled (FormBuilder
 *     gates submit on required fields being filled — Target Type and
 *     Target are both `required: true` for non-Firm types).
 *   - Pick Target Type=Household → still disabled (Target empty).
 *   - Type 2 chars into Target autocomplete; pick the first option.
 *   - Run button becomes enabled (loses `disabled` style class).
 *
 * Source-of-truth (FE):
 *   - ReRunBillingForm.js — submitDisplayName='Run' (the form's submit).
 *   - ReRunTargetGroup.js — TARGET field
 *       `required: !isFirmType, disabled: !type || isFirmType`,
 *       `type: 'autocompleteMultiSelect', serviceName: 'searchEntityByBilling',
 *        minCharsToSearch: 2`.
 *   - Button uses `styles.disabled` class — assert via class regex.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';

test('@pepi C25017 Run Button Activation Upon Valid Selection', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  /** Household-target Completed Unpublished row from the BillingRuns grid. */
  const findHouseholdRow = async () => {
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
        const target = row.querySelector('[col-id="targets"]')?.textContent?.trim() || '';
        if (status === 'Completed' && published === 'N' && /^Household\(s\):/.test(target)) {
          return { row, target };
        }
      }
      return null;
    });
  };

  await expect
    .poll(
      async () => {
        const h = await findHouseholdRow();
        const ok = !!(await h.evaluate((v) => v && !!v.row).catch(() => false));
        await h.dispose();
        return ok;
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000] }
    )
    .toBe(true);

  const handle = await findHouseholdRow();
  const { rowId, targetText } = await handle.evaluate((v) => ({
    rowId: v.row.getAttribute('row-id'),
    targetText: v.target,
  }));
  expect(rowId).toBeTruthy();

  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Select the household-target row + open Re Run Target(s) modal', async () => {
    const checkbox = masterRow
      .locator('.ag-selection-checkbox .ag-checkbox-input')
      .first();
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.click();
    await expect(masterRow).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });

    const reRun = page.locator('button', { hasText: /^Re Run$/ }).first();
    await expect(reRun).not.toHaveClass(/disabled/i, { timeout: 10_000 });
    await reRun.click();
    await expect(
      page.getByText('Re Run Target(s)', { exact: true }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  const modal = page
    .locator('[data-role="modalContainer"]')
    .filter({ hasText: 'Re Run Target(s)' })
    .first();
  const runBtn = modal.getByRole('button', { name: 'Run', exact: true }).first();

  await test.step('Pre-condition: Run submit is disabled before any selection', async () => {
    await expect(runBtn).toBeVisible({ timeout: 10_000 });
    await expect(runBtn).toHaveClass(/disabled/i, { timeout: 10_000 });
  });

  await test.step('Pick Target Type = Household(s) from the dropdown', async () => {
    const focusInput = modal.locator('input#targetReRunField');
    await expect(focusInput).toBeAttached({ timeout: 10_000 });
    await focusInput.evaluate((node) => /** @type {HTMLInputElement} */ (node).focus());

    await page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: /^Household\(s\)$/ })
      .first()
      .click();
  });

  await test.step('Run is still disabled (Target field empty)', async () => {
    await expect(runBtn).toHaveClass(/disabled/i, { timeout: 5000 });
  });

  await test.step('Type 2 chars into Target autocomplete and pick first option', async () => {
    // The autocomplete service (`/platformOne/searchBillingTargetEntity.do`)
    // returns entities scoped to the row's billingID. For some Household
    // rows the BE returns empty for the prefix we derive from the target
    // cell text (the cell may show a denormalised name that doesn't match
    // any household stored under that billingID). The unit under test here
    // is the FE: "Run becomes enabled after a valid Target is picked" —
    // so we intercept the response and inject a synthetic entity. Picking
    // that fake entity flows through the same FormBuilder code path that
    // would gate Run on a real selection.
    await page.route(`**/platformOne/searchBillingTargetEntity.do**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          messages: [],
          errors: [],
          result: [
            {
              id: 'C25017MOCKHOUSEHOLDIDXXXXXXXXXXXX',
              name: 'C25017 Mock Household',
              type: 'household',
              firmCd: 1,
              rows: [],
              totalCount: null,
              objectType: null,
              nomenclatureSerial: 0,
            },
          ],
        }),
      });
    });

    const targetSearch = modal.getByRole('textbox', { name: 'Search' }).first();
    await expect(targetSearch).toBeEnabled({ timeout: 10_000 });
    await targetSearch.click();
    await targetSearch.pressSequentially('ab', { delay: 60 });

    // Autocomplete option rows render as `<li>` with `<span data-row-type="parent-row">`.
    const option = page.locator('[data-row-type="parent-row"]').first();
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();
  });

  await test.step('Expected: Run button is enabled after a valid Target selection', async () => {
    await expect(runBtn).not.toHaveClass(/disabled/i, { timeout: 10_000 });
  });
});
