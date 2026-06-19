// @ts-check
/**
 * TestRail C25067 — Correct Client Target Type Displayed by Billing Type
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25067 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions:
 *   - tim1 firm1 GW Admin, on Operations > Billing > Billing Runs.
 *   - A PUBLISHED='N', STATUS='Completed' billing run with target type
 *     'Client(s)' exists.
 *
 * Steps:
 *   1. Select the Client-target billing run.
 *   2. Click "Re Run" → "Re Run Target(s)" modal.
 *   3. Open Target Type dropdown → expect Client(s), Account(s).
 *   4. Select Client → warning row visible.
 *   5. Select Account → warning row visible.
 *
 * Source-of-truth (FE):
 *   - targetGroupHelpers.js — buildTargetTypeOptions('client', noms)
 *     slices [Firm,Advisor,Household,Client,Account] from index=3 →
 *     [Client, Account].
 *   - BillingRuns/consts.js — CLIENT_ACCOUNT_WARNING_MESSAGE renders for
 *     target type ∈ {CLIENT, ACCOUNT}.
 *   - Combo list items render in a React portal: query at page scope.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';
const WARNING_RX =
  /Billing will be re-run for all accounts in the household and the history updated for all of the household.?s accounts\./i;

test('@pepi C25067 Correct Client Target Type Displayed by Billing Type', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  const findClientRow = async () => {
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
        if (status === 'Completed' && published === 'N' && /^Client\(s\):/.test(target)) {
          return row;
        }
      }
      return null;
    });
  };

  await expect
    .poll(
      async () => {
        const h = await findClientRow();
        const ok = !!h.asElement();
        await h.dispose();
        return ok;
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000] }
    )
    .toBe(true);

  const handle = await findClientRow();
  const el = handle.asElement();
  expect(el).toBeTruthy();

  const rowId = await /** @type {import('playwright-core').ElementHandle} */ (
    el
  ).evaluate((r) => r.getAttribute('row-id'));
  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Step 1: Select the Client-target master row checkbox', async () => {
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

  const modal = page
    .locator('[data-role="modalContainer"]')
    .filter({ hasText: 'Re Run Target(s)' })
    .first();

  /** Open the Target Type dropdown idempotently — focus may have been lost
   * after a previous selection collapsed the list. */
  const openTargetTypeDropdown = async () => {
    const focusInput = modal.locator('input#targetReRunField');
    await expect(focusInput).toBeAttached({ timeout: 10_000 });
    await focusInput.evaluate((node) => /** @type {HTMLInputElement} */ (node).focus());
    await expect(page.locator('[role="combo-box-list-item"]').first()).toBeVisible({
      timeout: 10_000,
    });
  };

  await test.step('Step 3: Target Type dropdown shows Client(s), Account(s)', async () => {
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await openTargetTypeDropdown();
    const labels = (await page.locator('[role="combo-box-list-item"]').allInnerTexts())
      .map((s) => s.trim())
      .filter(Boolean);
    expect(labels).toEqual(['Client(s)', 'Account(s)']);
  });

  await test.step('Step 4: Pick Client(s) → warning row visible', async () => {
    await page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: /^Client\(s\)$/ })
      .first()
      .click();
    await expect(modal.getByText(WARNING_RX).first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Step 5: Re-open dropdown, pick Account(s) → warning still visible', async () => {
    await openTargetTypeDropdown();
    await page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: /^Account\(s\)$/ })
      .first()
      .click();
    await expect(modal.getByText(WARNING_RX).first()).toBeVisible({ timeout: 10_000 });
  });
});
