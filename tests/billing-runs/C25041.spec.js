// @ts-check
/**
 * TestRail C25041 — Correct Advisor Target Types Displayed by Billing Type
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25041 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions:
 *   - tim1 firm1 GW Admin, on Operations > Billing > Billing Runs.
 *   - A PUBLISHED='N', STATUS='Completed' billing run with target type
 *     'Advisor(s)' exists.
 *
 * Steps:
 *   1. Select checkbox for the Advisor-target billing run.
 *   2. Click footer "Re Run" → expect "Re Run Target(s)" modal.
 *   3. Open "Target Type" dropdown → expect Advisor(s), Household(s),
 *      Client(s), Account(s). Firm must NOT appear.
 *
 * Source-of-truth (FE):
 *   - ReRunBillingForm/_hooks/_helpers/targetGroupHelpers.js —
 *     `buildTargetTypeOptions('advisor', noms)` slices
 *     [Firm,Advisor,Household,Client,Account] from index=1 → keeps
 *     [Advisor, Household, Client, Account].
 *   - BillingRunTargetType.java labels: "Advisor(s)", "Household(s)",
 *     "Client(s)", "Account(s)".
 *   - ComboBox dropdown items render in a React portal: query at page scope.
 */

const { test, expect } = require('@playwright/test');
const { ensureBillingRunsColumn, seedTargetRun, filterRunsGrid } = require('./_helpers');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const SEED_NAME = 'C25041 Advisor Seed';
const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';

test('@regression C25041 Correct Advisor Target Types Displayed by Billing Type', async ({ page }) => {
  test.setTimeout(180_000);

  // tim1 (role Admins), not the worker GW Admin (role 529 "All Employees"):
  // the advisor-target Completed/Unpublished runs live on other firms, so only
  // a full admin with cross-firm visibility sees them in the grid at all.
  // Pre-condition row, seeded so the case doesn't depend on env history.
  seedTargetRun(SEED_NAME, 'advisor');
  await loginPlatformOneTim1Fresh(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
    await ensureBillingRunsColumn(page, 'publishedRuns', 'Published');
    await filterRunsGrid(page, SEED_NAME);
  });

  // The default window holds hundreds of rows and ag-grid virtualizes the DOM,
  // so a Completed/Unpublished advisor row that exists in the data may never be
  // rendered by a plain scan. Scroll the grid viewport top-to-bottom, scanning
  // the rendered master rows on each step, until the target row appears; return
  // its row-id. (The billing-runs grid quick-filter matches the underlying run
  // data, not the rendered "Advisor(s): …" target text, so a text filter can't
  // surface these rows — scrolling is the reliable approach.)
  const scanForRowId = async () =>
    page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const grids = Array.from(document.querySelectorAll('.ag-center-cols-container'));
      const billingGrid = grids.find((g) => g.querySelector('[col-id="billingRunStatuses"]'));
      if (!billingGrid) return null;
      const viewport =
        billingGrid.closest('.ag-body-viewport') || document.querySelector('.ag-body-viewport');
      const scan = () => {
        const masters = Array.from(billingGrid.querySelectorAll(':scope > .ag-row')).filter(
          (r) => !r.closest('.ag-details-row')
        );
        for (const row of masters) {
          const status = row.querySelector('[col-id="billingRunStatuses"]')?.textContent?.trim() || '';
          const published = row.querySelector('[col-id="publishedRuns"]')?.textContent?.trim() || '';
          const target = row.querySelector('[col-id="targets"]')?.textContent?.trim() || '';
          if (status === 'Completed' && published === 'N' && /^Advisor\(s\):/.test(target)) {
            return row.getAttribute('row-id');
          }
        }
        return null;
      };
      if (!viewport) return scan();
      viewport.scrollTop = 0;
      await sleep(200);
      let last = -1;
      for (let i = 0; i < 400; i += 1) {
        const id = scan();
        if (id) return id;
        if (viewport.scrollTop === last) break; // reached the bottom
        last = viewport.scrollTop;
        viewport.scrollTop += Math.max(200, viewport.clientHeight * 0.8);
        await sleep(150);
      }
      return scan();
    });

  let rowId = null;
  await expect
    .poll(
      async () => {
        rowId = await scanForRowId();
        return rowId;
      },
      { timeout: 90_000, intervals: [1000, 2000, 3000] }
    )
    .toBeTruthy();

  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Step 1: Select the Advisor-target master row checkbox', async () => {
    const checkbox = masterRow
      .locator('.ag-selection-checkbox .ag-checkbox-input')
      .first();
    await checkbox.scrollIntoViewIfNeeded();
    await checkbox.click();
    await expect(masterRow).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  });

  await test.step('Step 2: Click footer "Re Run" → "Re Run Target(s)" modal appears', async () => {
    const reRun = page.locator('button', { hasText: /^Re Run$/ }).first();
    await expect(reRun).toBeVisible({ timeout: 10_000 });
    await expect(reRun).not.toHaveClass(/disabled/i, { timeout: 10_000 });
    await reRun.click();
    await expect(
      page.getByText('Re Run Target(s)', { exact: true }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Step 3: Open Target Type dropdown → Advisor/Household/Client/Account only', async () => {
    const modal = page
      .locator('[data-role="modalContainer"]')
      .filter({ hasText: 'Re Run Target(s)' })
      .first();
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const focusInput = modal.locator('input#targetReRunField');
    await expect(focusInput).toBeAttached({ timeout: 10_000 });
    await focusInput.evaluate((node) => /** @type {HTMLInputElement} */ (node).focus());

    const options = page.locator('[role="combo-box-list-item"]');
    await expect(options.first()).toBeVisible({ timeout: 10_000 });

    const labels = (await options.allInnerTexts()).map((s) => s.trim()).filter(Boolean);
    expect(labels).toEqual(['Advisor(s)', 'Household(s)', 'Client(s)', 'Account(s)']);
    expect(labels).not.toContain('Firm');
  });
});
