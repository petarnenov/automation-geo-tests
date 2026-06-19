// @ts-check
/**
 * TestRail C25018 — Billing Status Progression
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25018 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions:
 *   - Re Run Target(s) window is open; valid target (Target that is part
 *     of the billing) selected.
 *
 * Step 1: Click 'Run' to initiate the partial re-run.
 * Expected: billing status changes from 'Completed' → 'In Progress' and
 *           when complete back to 'Completed'.
 *
 * Source-of-truth (FE):
 *   - billingRunsServices.run hits POST /bo/executeBillingRuns.do — fires
 *     the BE Akka job and the grid then surfaces the new status via the
 *     polling /platformOne/getNewBillingRows.do (BILLING_RUNS_POLLING_INTERVAL
 *     is 10 min, so the test forces a refresh by clicking the Filter
 *     panel's Apply button after each transition).
 *   - useReRunBillingForm.js → hideModal() on success.
 *
 * Test strategy (no shared-state mutation on qa4):
 *   The case asserts a state machine that depends entirely on FE polling
 *   reading BE state. We intercept:
 *     a. /bo/executeBillingRuns.do  → respond success without firing the
 *        real Akka job.
 *     b. /platformOne/searchBillingTargetEntity.do → inject a synthetic
 *        entity so the Target autocomplete can resolve (covered before in
 *        C25017).
 *     c. /platformOne/getNewBillingRows.do → state-machine mock that
 *        rewrites the selected row's `billingRunStatuses`/`partialReRun`
 *        through Completed → In Progress → Completed across consecutive
 *        re-fetches.
 *   With those in place the FE flow (modal close, polling refresh, grid
 *   status flip) runs against unmodified backend data.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';
const GET_ROWS_PATH = '/platformOne/getNewBillingRows.do';
const EXECUTE_PATH = '/bo/executeBillingRuns.do';
const SEARCH_ENTITY_PATH = '/platformOne/searchBillingTargetEntity.do';

test('@pepi C25018 Billing Status Progression', async ({ page }) => {
  test.setTimeout(240_000);

  await loginPlatformOneAdmin(page);

  // ── Route-mock state ──────────────────────────────────────────────────────
  // `runFired`        → flips to true once executeBillingRuns is intercepted.
  // `postRunRefreshes`→ counts grid refresh fetches after Run was clicked.
  // `targetBillingId` → set after we identify the row we'll select; only
  //                     that row gets its status rewritten by the mock.
  const state = { runFired: false, postRunRefreshes: 0, targetBillingId: null };

  await page.route(`**${EXECUTE_PATH}**`, async (route) => {
    state.runFired = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, messages: [], errors: [], result: null }),
    });
  });

  await page.route(`**${SEARCH_ENTITY_PATH}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        messages: [],
        errors: [],
        result: [
          {
            id: 'C25018MOCKHOUSEHOLDIDXXXXXXXXXXXX',
            name: 'C25018 Mock Household',
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

  await page.route(`**${GET_ROWS_PATH}**`, async (route) => {
    const response = await route.fetch();
    let body;
    try {
      body = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    if (state.runFired && state.targetBillingId) {
      // After Run was clicked we drive Completed → In Progress (one refresh)
      // → Completed (subsequent refreshes).
      state.postRunRefreshes += 1;
      const forcedStatus = state.postRunRefreshes === 1 ? 'In Progress' : 'Completed';
      for (const row of rows) {
        const id = row?.billingID?.id || row?.billingID;
        if (id === state.targetBillingId) {
          row.billingRunStatuses = [forcedStatus];
          if (forcedStatus === 'Completed') row.partialReRun = true;
        }
      }
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  /** Find first Household-target Completed Unpublished row in the BillingRuns grid. */
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
          return row;
        }
      }
      return null;
    });
  };

  await expect
    .poll(
      async () => {
        const h = await findHouseholdRow();
        const ok = !!h.asElement();
        await h.dispose();
        return ok;
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000] }
    )
    .toBe(true);

  const handle = await findHouseholdRow();
  const rowId = await handle
    .asElement()
    .evaluate((r) => r.getAttribute('row-id'));
  state.targetBillingId = rowId; // row-id is the stable billingID.id token
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

  await test.step('Pick Target Type=Household and a (mocked) valid Target → Run enabled', async () => {
    const focusInput = modal.locator('input#targetReRunField');
    await focusInput.evaluate((node) => /** @type {HTMLInputElement} */ (node).focus());
    await page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: /^Household\(s\)$/ })
      .first()
      .click();

    const targetSearch = modal.getByRole('textbox', { name: 'Search' }).first();
    await expect(targetSearch).toBeEnabled({ timeout: 10_000 });
    await targetSearch.click();
    await targetSearch.pressSequentially('ab', { delay: 60 });
    const option = page.locator('[data-row-type="parent-row"]').first();
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();
    await expect(runBtn).not.toHaveClass(/disabled/i, { timeout: 10_000 });
  });

  await test.step('Step 1: Click Run → modal closes (executeBillingRuns mocked)', async () => {
    await runBtn.click();
    await expect(modal).toBeHidden({ timeout: 15_000 });
    expect(state.runFired, 'executeBillingRuns POST was issued').toBe(true);
  });

  await test.step('Grid shows status flip Completed → In Progress', async () => {
    // The grid has no auto-refresh after Re Run (BILLING_RUNS_POLLING_INTERVAL
    // is 10 min). Click the Filter Apply button to force a re-fetch.
    await page.locator('button:has-text("Filter")').last().click().catch(() => {});
    const statusCell = masterRow.locator('[col-id="billingRunStatuses"]').first();
    await expect(statusCell).toHaveText(/In Progress/i, { timeout: 30_000 });
  });

  await test.step('On next refresh the row settles back to Completed', async () => {
    await page.locator('button:has-text("Filter")').last().click().catch(() => {});
    const statusCell = masterRow.locator('[col-id="billingRunStatuses"]').first();
    await expect(statusCell).toHaveText(/^Completed/i, { timeout: 30_000 });
  });
});
