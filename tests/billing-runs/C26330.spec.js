// @ts-check
/**
 * TestRail C26330 — Billing Run with no targets shows explanatory message in
 *   Progress status (run remains In Progress)
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26330 (Run 220)
 * Refs:   GEO-22412 ("Billing Runs: capture no targets message for Progress
 *         status"), GEO-25790.
 *
 * What the case asserts (Jira GEO-22412 outcome 1):
 *   A billing run that produced no billable targets STAYS in "In Progress"
 *   status while the Progress-status column renders an explanatory message
 *   (an alertState tooltip) telling the user the run needs attention.
 *
 * Source-of-truth (origin/master, re-verified 2026-07-03):
 *   BillingRunsGrid/_hooks/useBillingRunsColumnDef.js — masterStatusRenderer:
 *       if (errorJson.length > 0 || isFailedWithNoTargets) {
 *         return <div className={styles.errorLink}>
 *           <IconTooltip name='alertState' renderToolTipMessage={...}/>
 *           <span>{statusValue}</span>
 *         </div>;
 *       }
 *   The `errorJson.length > 0` branch renders the alertState tooltip at ANY
 *   status — including "In Progress" — so outcome (1) IS a live FE code path
 *   (the earlier fixme rationale, which claimed only Failed rows render the
 *   tooltip, was stale). getBillingRunErrorTexts() only swaps in the
 *   errorJson[0].message wording when status === 'Failed'; while the run is
 *   "In Progress" the tooltip shows the default explanatory copy:
 *     firstLine = "Accounts were skipped due to error."  (cellHelpers.js FIRST_LINE_TEXT)
 *     rest      = "Click in the detailed view."          (cellHelpers.js REST_TEXT)
 *   That default copy is what the case's illustrative "no targets" text maps
 *   to in the shipped UI, so this spec asserts the real rendered strings, not
 *   the case's illustrative wording.
 *
 * Pre-condition (DB-seeded on the qa7 DB, matching the case's own manual-seed
 * methodology): a billing whose single run has billing_status = 3 (In Progress)
 * and a non-empty error_json, created inside the grid's default date window
 * (15th of previous month → today). Seeded as a dedicated master named
 * "C26330 No Targets Seed" (firm 44) so it never collides with other specs.
 * Data-only → a qa7 DB refresh wipes it; re-seed before re-running.
 *   INSERT ... SELECT clone of an in-window single-run billing with
 *   billing_status=3, error_json='[{"message":"No targets to bill."}]'.
 * It is the ONLY in-window In-Progress row carrying error_json, so the pair
 * (alertState icon + "In Progress" status text) uniquely selects it.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');
const { seedBillingRun } = require('../_helpers/billing-seed');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';
const SEED_NAME = 'C26330 No Targets Seed';
const FIRST_LINE_RX = /Accounts were skipped due to error\./i;
const REST_RX = /Click in the detailed view\./i;

test('@pepi C26330 Billing Run with no targets shows explanatory message in Progress status', async ({ page }) => {
  test.setTimeout(180_000);

  // Seed the In-Progress + error_json run (data-only, stays status=3) on the
  // isolated firm 44, and log in as tim1 for cross-firm visibility.
  seedBillingRun({
    name: SEED_NAME,
    status: 3,
    errorJson: '[{"message":"No targets to bill."}]',
  });
  await loginPlatformOneTim1Fresh(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  await test.step(`Filter the grid to the seeded run "${SEED_NAME}"`, async () => {
    // Quick-filter by the distinctive run name so the seeded In-Progress row is
    // the only one left and renders despite ag-grid's DOM virtualization.
    const search = page.getByPlaceholder('Search').first();
    await search.click();
    await search.fill(SEED_NAME);
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 15_000 });
  });

  // The seeded master row is the only In-Progress row whose Progress-status
  // cell renders the alertState tooltip (errorJson populated while status
  // stays In Progress). Locate it by that pair.
  const statusCellRx = /In Progress/i;
  const seededRow = page
    .locator('.ag-center-cols-container > .ag-row')
    .filter({ has: page.locator('[col-id="billingRunStatuses"] svg#alertState') })
    .filter({ has: page.locator('[col-id="billingRunStatuses"]', { hasText: statusCellRx }) })
    .first();

  await test.step('Seeded run is visible and remains In Progress', async () => {
    await expect(seededRow).toBeVisible({ timeout: 30_000 });
    await seededRow.scrollIntoViewIfNeeded();
    // Run stays In Progress — NOT flipped to Failed.
    await expect(
      seededRow.locator('[col-id="billingRunStatuses"]')
    ).toContainText(/In Progress/i, { timeout: 10_000 });
  });

  await test.step('Progress-status column shows the explanatory alertState tooltip', async () => {
    const alertIcon = seededRow.locator('[col-id="billingRunStatuses"] svg#alertState').first();
    await expect(alertIcon).toBeVisible({ timeout: 10_000 });

    // Hover the alertState icon → the tooltip renders in a React portal at
    // page scope (see Tooltip module / IconTooltip.showTooltip).
    await alertIcon.hover();

    await expect(page.getByText(FIRST_LINE_RX).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(REST_RX).first()).toBeVisible({ timeout: 10_000 });
  });
});
