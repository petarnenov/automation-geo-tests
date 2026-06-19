// @ts-check
/**
 * TestRail C25066 — Correct Account Target Type Displayed by Billing Type
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25066 (Run 214)
 * Linked Jira: GEO-12914
 *
 * Pre-conditions:
 *   - tim1 firm1 GW Admin, on Operations > Billing > Billing Runs.
 *   - A PUBLISHED='N', STATUS='Completed' billing run with target type
 *     'Account(s)' exists.
 *
 * Steps:
 *   1. Select the Account-target billing run.
 *   2. Click "Re Run" → "Re Run Target(s)" modal.
 *   3. Open Target Type dropdown → expect ONLY Account(s).
 *   4. Select Account → expect warning row: "Billing will be re-run for
 *      all accounts in the household and the history updated for all of
 *      the household's accounts."
 *
 * Source-of-truth (FE):
 *   - targetGroupHelpers.js — buildTargetTypeOptions('account', noms)
 *     slices [Firm,Advisor,Household,Client,Account] from index=4 →
 *     [Account].
 *   - BillingRuns/consts.js — CLIENT_ACCOUNT_WARNING_MESSAGE is the row
 *     rendered when target type ∈ {CLIENT, ACCOUNT}.
 *   - ReRunTargetGroup.js — wires warningMessage block conditionally.
 *   - Combo list items render in a React portal: query at page scope.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';
const WARNING_RX =
  /Billing will be re-run for all accounts in the household and the history updated for all of the household.?s accounts\./i;

test('@pepi C25066 Correct Account Target Type Displayed by Billing Type', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  /** Find first BillingRuns master row with Status=Completed, Published=N, target "Account(s):". */
  const findAccountRow = async () => {
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
        if (status === 'Completed' && published === 'N' && /^Account\(s\):/.test(target)) {
          return row;
        }
      }
      return null;
    });
  };

  await expect
    .poll(
      async () => {
        const h = await findAccountRow();
        const ok = !!h.asElement();
        await h.dispose();
        return ok;
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000] }
    )
    .toBe(true);

  const handle = await findAccountRow();
  const el = handle.asElement();
  expect(el).toBeTruthy();

  const rowId = await /** @type {import('playwright-core').ElementHandle} */ (
    el
  ).evaluate((r) => r.getAttribute('row-id'));
  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Step 1: Select the Account-target master row checkbox', async () => {
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

  await test.step('Step 3: Target Type dropdown shows ONLY Account(s)', async () => {
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
    expect(labels).toEqual(['Account(s)']);
  });

  await test.step('Step 4: Select Account → warning row appears in modal', async () => {
    // Click the only option.
    await page.locator('[role="combo-box-list-item"]').first().click();
    const modal = page
      .locator('[data-role="modalContainer"]')
      .filter({ hasText: 'Re Run Target(s)' })
      .first();
    await expect(modal.getByText(WARNING_RX).first()).toBeVisible({ timeout: 10_000 });
  });
});
