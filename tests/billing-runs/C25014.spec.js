// @ts-check
/**
 * TestRail C25014 — Correct Firm Target Types Displayed by Billing Type
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25014 (Run 214)
 * Linked Jira: https://geowealth.atlassian.net/browse/GEO-12914
 *
 * Pre-conditions (per case):
 *   - tim1 firm1 GW Admin, on Operations > Billing > Billing Runs.
 *   - A PUBLISHED='N', STATUS='Completed', TARGET='Firm' billing run exists.
 *
 * Steps:
 *   1. Select the checkbox for the Firm-target billing run.
 *   2. Click footer "Re Run" → expect "Re Run Target(s)" modal.
 *   3. Open the "Target Type" dropdown → expect Advisor(s), Household(s),
 *      Client(s), Account(s); Firm must NOT appear.
 *
 * Test data:
 *   The default System View filter on /billingCenter/runs hides many rows,
 *   but the unfiltered API returns several firm-target Completed+Unpublished
 *   rows (probed via /platformOne/getNewBillingRows.do). We force the row
 *   into view by routing the response through `transformBillingRows`-shape
 *   data the grid recognises: we keep the original API rows but additionally
 *   surface ours by clearing the firmName ag-grid filter and using the
 *   shared Search box to narrow on the template name "firm 7" (a
 *   pre-seeded Wise Wealth firm-target billing).
 *
 * Source-of-truth (FE):
 *   - BillingRuns/Components/ReRunBillingForm/ReRunTargetGroup.js — Target
 *     Type field id is `targetReRun` (TARGET_GROUP_FIELD.TARGET_TYPE).
 *   - ReRunBillingForm/_hooks/_helpers/targetGroupHelpers.js —
 *     `buildTargetTypeOptions('firm', noms)` slices [Firm,Advisor,Household,
 *     Client,Account] from index+1 → drops Firm itself.
 *   - useBillingReRunsFormModal.js — headerTxtPrimary='Re Run Target(s)'.
 *   - BillingRunTargetType.java — option names "Advisor(s)", "Household(s)",
 *     "Client(s)", "Account(s)".
 *   - BillingRuns/_services/_helpers/index.js — `transformBillingRows` adds
 *     `targets` to each row from parsed templateJson.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const BILLING_RUNS_URL = '/react/indexReact.do#platformOne/billingCenter/runs';
const SEED_TEMPLATE_NAME = 'firm 7'; // pre-seeded Wise Wealth firm-only template

test('@pepi C25014 Correct Firm Target Types Displayed by Billing Type', async ({ page }) => {
  test.setTimeout(240_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Operations > Billing > Billing Runs', async () => {
    await page.goto(BILLING_RUNS_URL);
    await expect(page).toHaveURL(/#platformOne\/billingCenter\/runs/, { timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="firmName"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  await test.step(`Narrow grid via Search box to "${SEED_TEMPLATE_NAME}"`, async () => {
    const search = page.getByPlaceholder('Search').first();
    await search.click();
    await search.fill(SEED_TEMPLATE_NAME);
  });

  /**
   * Locate the master row whose template name === "firm 7", whose target
   * cell renders "Firm: …", whose Status reads "Completed", and whose
   * Published cell reads "N".  Excludes detail rows.
   */
  const findFirmRow = async () => {
    return await page.evaluateHandle((tmpltName) => {
      const masters = Array.from(
        document.querySelectorAll('.ag-center-cols-container > .ag-row')
      ).filter((r) => !r.closest('.ag-details-row'));
      for (const row of masters) {
        const tmplt = row.querySelector('[col-id="tmpltName"]')?.textContent?.trim() || '';
        if (tmplt !== tmpltName) continue;
        const status = row.querySelector('[col-id="billingRunStatuses"]')?.textContent?.trim() || '';
        const published = row.querySelector('[col-id="publishedRuns"]')?.textContent?.trim() || '';
        const target = row.querySelector('[col-id="targets"]')?.textContent?.trim() || '';
        if (status === 'Completed' && published === 'N' && /^Firm:/.test(target)) {
          return row;
        }
      }
      return null;
    }, SEED_TEMPLATE_NAME);
  };

  // Poll up to 30 s — the grid may take a tick to filter + re-render.
  await expect
    .poll(
      async () => {
        const h = await findFirmRow();
        const el = h.asElement();
        const ok = !!el;
        await h.dispose();
        return ok;
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000] }
    )
    .toBe(true);

  const firmRowHandle = await findFirmRow();
  const firmRowEl = firmRowHandle.asElement();
  const rowId = await /** @type {import('playwright-core').ElementHandle} */ (
    firmRowEl
  ).evaluate((r) => r.getAttribute('row-id'));
  const masterRow = page.locator(
    `.ag-center-cols-container > .ag-row[row-id="${rowId}"]`
  );

  await test.step('Step 1: Select the Firm-target master row checkbox', async () => {
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
    // Find the open modal (Container has `data-role="modalContainer"`).
    const modal = page
      .locator('[data-role="modalContainer"]')
      .filter({ hasText: 'Re Run Target(s)' })
      .first();
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // ComboBox wires onFocus on input#{id}Field to toggle the dropdown.
    const focusInput = modal.locator('input#targetReRunField');
    await expect(focusInput).toBeAttached({ timeout: 10_000 });
    await focusInput.evaluate((el) => /** @type {HTMLInputElement} */ (el).focus());

    // The dropdown list renders in a React portal (separate DOM subtree
    // from the modal). Search at PAGE scope. Only one combo is open at a
    // time, so collisions with unrelated combos aren't a concern here.
    const options = page.locator('[role="combo-box-list-item"]');
    await expect(options.first()).toBeVisible({ timeout: 10_000 });

    const labels = (await options.allInnerTexts()).map((s) => s.trim()).filter(Boolean);
    expect(labels).toEqual(['Advisor(s)', 'Household(s)', 'Client(s)', 'Account(s)']);
    expect(labels).not.toContain('Firm');
  });
});
