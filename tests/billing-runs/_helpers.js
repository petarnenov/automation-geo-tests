// @ts-check
const { expect } = require('@playwright/test');

/**
 * Make sure a Billing Runs grid column is shown before a spec reads it.
 *
 * Column visibility is a per-user saved grid preference. On qabis1 tim1's
 * saved layout hides "Published" (`publishedRuns`), so specs that read that
 * cell found nothing. If the column is missing, tick it in Customize Columns
 * and Confirm & Reload; a no-op when it is already visible.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} colId   ag-grid col-id, e.g. 'publishedRuns'
 * @param {string} label   checkbox label in Customize Columns, e.g. 'Published'
 */
async function ensureBillingRunsColumn(page, colId, label) {
  const header = page.locator(`.ag-header-cell[col-id="${colId}"]`);
  if (await header.count()) return;

  await page.locator('span#customizeColumns').first().click();
  const heading = page.getByText('Customize Columns', { exact: true }).first();
  await expect(heading).toBeVisible({ timeout: 10_000 });
  const option = page.locator('label').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).last();
  const input = page.locator(`input#${await option.getAttribute('for')}`);
  // FormBuilder checkboxes can swallow a click that lands before React wires
  // onChange (see C25084), so re-click until the input reports checked.
  await expect
    .poll(
      async () => {
        if (!(await input.isChecked())) await option.click().catch(() => {});
        return input.isChecked();
      },
      { timeout: 15_000, intervals: [500, 1000, 2000] }
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Confirm & Reload' }).click();
  await expect(heading).toBeHidden({ timeout: 15_000 });
  await expect(header.first()).toBeAttached({ timeout: 60_000 });
}

/**
 * Seed a Completed, unpublished billing run whose single target is of the
 * given type, so specs that need "a run with an Advisor/Household/Account
 * target" don't depend on whatever history an env happens to hold (qa4 has
 * such rows, fresh/anonymized envs like qabis1 don't). The target's display
 * name comes straight from target_json, so the id can be synthetic.
 *
 * @param {string} name       distinctive tmplt_name (also used to filter the grid)
 * @param {'advisor'|'household'|'client'|'account'} targetCd
 */
function seedTargetRun(name, targetCd) {
  const { seedBillingRun } = require('../_helpers/billing-seed');
  const targetJson = JSON.stringify({
    targets: [
      { targetCd, targets: [{ id: '0'.repeat(32), name: `${name} Target`, type: targetCd }] },
    ],
    buckets: ['1'],
  });
  seedBillingRun({ name, status: 2, targetJson });
}

/**
 * Quick-filter the Billing Runs grid to one run name so it renders despite
 * ag-grid virtualization.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function filterRunsGrid(page, name) {
  const search = page.getByPlaceholder('Search').first();
  await search.click();
  await search.fill(name);
  await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 15_000 });
}

module.exports = { ensureBillingRunsColumn, seedTargetRun, filterRunsGrid };
