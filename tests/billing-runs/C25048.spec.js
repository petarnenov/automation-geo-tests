// @ts-check
/**
 * TestRail C25048 — Correct Household Target Types Displayed by Billing Type
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25048 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions (per case):
 *   - tim1 firm1 GW Admin, on Operations > Billing > Billing Runs.
 *   - A PUBLISHED='N', STATUS='Completed' billing run with target type
 *     'Household(s)' exists.
 *
 * Steps:
 *   1. Select the checkbox for the Household-target billing run.
 *   2. Click footer "Re Run" → expect "Re Run Target(s)" modal.
 *   3. Open the "Target Type" dropdown → expect Household(s), Client(s),
 *      Account(s); Firm + Advisor(s) must NOT appear.
 *
 * Source-of-truth (FE): same plumbing as C25014.
 *   - ReRunBillingForm/_hooks/_helpers/targetGroupHelpers.js —
 *     `buildTargetTypeOptions('household', noms)` slices
 *     [Firm,Advisor,Household,Client,Account] from index=2 → keeps
 *     [Household, Client, Account].
 *   - BillingRunTargetType.java exposes "Household(s)", "Client(s)",
 *     "Account(s)".
 *   - ComboBox dropdown items render in a React portal: search at page
 *     scope, not within the modal subtree.
 *
 * Test data: qa4 has many Household-target Completed Unpublished rows in
 * the default System View — we pick the first whose target cell renders
 * "Household(s):".
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';

test('@pepi C25048 Correct Household Target Types Displayed by Billing Type', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  /**
   * Find first master row where:
   *   - Status="Completed"
   *   - Published="N"
   *   - target cell starts with "Household(s):"
   * Detail rows excluded by skipping any `.ag-row` nested in `.ag-details-row`.
   */
  const findHouseholdRow = async () => {
    await page.locator('.ag-row').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    return await page.evaluateHandle(() => {
      // Scope to the BillingRunsGrid only: the page also embeds an
      // OngoingBillingRunsGrid at the top whose column ids differ. Match
      // master grids by the presence of `[col-id="billingRunStatuses"]`.
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

  // Poll: the grid sometimes finishes rendering its rows after the first
  // `.ag-row` becomes visible (header row attaches first).
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
  const el = handle.asElement();
  expect(el, 'household-target Completed Unpublished row should exist').toBeTruthy();

  const rowId = await /** @type {import('playwright-core').ElementHandle} */ (
    el
  ).evaluate((r) => r.getAttribute('row-id'));
  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Step 1: Select the Household-target master row checkbox', async () => {
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

  await test.step('Step 3: Open Target Type dropdown → Household/Client/Account only', async () => {
    const modal = page
      .locator('[data-role="modalContainer"]')
      .filter({ hasText: 'Re Run Target(s)' })
      .first();
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const focusInput = modal.locator('input#targetReRunField');
    await expect(focusInput).toBeAttached({ timeout: 10_000 });
    await focusInput.evaluate((node) => /** @type {HTMLInputElement} */ (node).focus());

    // Dropdown items render in a React portal — query at page scope.
    const options = page.locator('[role="combo-box-list-item"]');
    await expect(options.first()).toBeVisible({ timeout: 10_000 });

    const labels = (await options.allInnerTexts()).map((s) => s.trim()).filter(Boolean);
    expect(labels).toEqual(['Household(s)', 'Client(s)', 'Account(s)']);
    expect(labels).not.toContain('Firm');
    expect(labels).not.toContain('Advisor(s)');
  });
});
