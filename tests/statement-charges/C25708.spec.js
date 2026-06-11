// @ts-check
/**
 * TestRail C25708 — Statement Charges - save default view with custom filters.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25708 (Run 206)
 * Linked Jira: GEO-20451
 *
 * Manual steps:
 *   1. Log in as firm 1 admin, open Statement Charges.
 *   2. Click the "Filter On" button.
 *   3. Click on a column filter that has ≥1 options — DESCRIPTION.
 *   4. Click (Select All) to deselect all.
 *   5. Click one option's checkbox.
 *   6. Click Save New View.
 *   7. In the modal: type a name, tick Include Current Filters + Default.
 *   8. Click Save.
 *   9. Navigate to Statement Templates.
 *  10. Navigate back to Statement Charges — new default view auto-selected,
 *      grid filtered by the saved selection.
 *
 * Implementation notes:
 *   - The "Filter On" button is `<span id="columnDefault">` (rendered by
 *     ToggleFloatingFilter.js, tooltipTxt="Filter On"). It toggles
 *     `showFloatingFilter=true`. The button is rendered TWICE in the DOM
 *     (probably duplicated by GwGrid's header customization shell), so we
 *     use .first(). When the floating filter row is already shown the
 *     parent span gets `selectedGridSize___xxx` class — clicking is
 *     idempotent (it always sets to true), so we don't need to gate.
 *   - The Description column floating filter is found via aria-colindex
 *     matching the regular header's aria-colindex (floating filter cells
 *     don't carry col-id). The button to open the full filter menu is
 *     `button.ag-floating-filter-button-button` inside the floating cell.
 *   - The set-filter menu pops up as `.ag-popup > .ag-menu.ag-filter-menu`.
 *     Each item is `.ag-virtual-list-item[role="option"]` with
 *     `aria-checked` tracking selection. Items are ordered with
 *     aria-posinset=1 being "(Select All)", 2 being first data value.
 *   - The set filter applies immediately on toggle (no Apply button — the
 *     defaultColDef sets `applyMiniFilterWhileTyping: true`).
 *   - Selecting only one option results in a grid with 1 row (the filtered
 *     description). We verify the row count is small (≤1 visible data row)
 *     and that the description column shows the picked value.
 *   - Save View modal uses the same FormBuilder pattern as C25655 — see
 *     that spec for the icon-label/poll-retry details.
 *
 * Re-runs: same accumulation as C25655 (per-user saved views build up on
 * tim1). Name is timestamp-suffixed to avoid collisions.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const STATEMENT_CHARGES_URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const STATEMENT_TEMPLATES_URL =
  '/react/indexReact.do#platformOne/billingCenter/statementTemplates';

const VIEW_NAME = `Custom filter view C25708 ${Date.now()}`;

test('@pepi C25708 Statement Charges - save default view with custom filters', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  /** @type {string} */
  let pickedDescription;

  await test.step('Open Statement Charges and wait for the grid to render', async () => {
    await page.goto(STATEMENT_CHARGES_URL);
    await expect(
      page.getByText('Statement Charges', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
  });

  await test.step('Click the Filter On toggle', async () => {
    // ToggleFloatingFilter.js renders `<span id="columnDefault">` whose
    // onClick always calls `toggleFloatingFilter(true)` — clicking is
    // always-on rather than a toggle, so it's safe to click even if the
    // floating filter row is already shown.
    await page.locator('span#columnDefault').first().click();
    await expect(
      page.locator('.ag-header-cell.ag-floating-filter').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Open the Description column filter', async () => {
    // Floating filter cells don't have col-id — match by aria-colindex
    // mirroring the description header. The filter trigger inside is
    // `button.ag-floating-filter-button-button` (aria-label "Open Filter Menu").
    const descAriaIdx = await page
      .locator('.ag-header-cell[col-id="description"]')
      .first()
      .getAttribute('aria-colindex');
    expect(descAriaIdx, 'description column must have an aria-colindex').toBeTruthy();
    const descFloating = page.locator(
      `.ag-header-cell.ag-floating-filter[aria-colindex="${descAriaIdx}"]`
    );
    await expect(descFloating).toBeVisible({ timeout: 10_000 });
    await descFloating
      .locator('button.ag-floating-filter-button-button')
      .click({ force: true });
    await expect(page.locator('.ag-filter-menu')).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Click (Select All) until everything is deselected', async () => {
    // (Select All) sits at aria-posinset=1 in the virtual list.
    //
    // On a fresh load the filter is unset and every option is selected, so
    // (Select All) starts aria-checked="true" — ONE click deselects all.
    //
    // On a re-run after C25708 has already saved a default view with one
    // description picked, the saved filter restores into the menu in a
    // partial state ((Select All) shows aria-checked="false" but is
    // visually mixed). The single click then SELECTS everything and we
    // need a second click to get back to all-unchecked. Poll-and-click
    // covers both cases without branching on the starting state.
    const selectAllRow = page.locator(
      '.ag-filter-menu .ag-virtual-list-item[aria-posinset="1"]'
    );
    await expect(selectAllRow).toBeVisible({ timeout: 10_000 });
    const selectAllLabel = selectAllRow.locator('.ag-checkbox-label');
    // Read the aria-checked state on the FIRST data option as a proxy for
    // "is the filter cleared yet?" — if posinset=2 is unchecked, the
    // filter has no values selected, regardless of what (Select All)'s
    // tri-state attribute happens to be.
    const firstOption = page.locator(
      '.ag-filter-menu .ag-virtual-list-item[aria-posinset="2"]'
    );
    await expect
      .poll(
        async () => {
          const checked = await firstOption
            .getAttribute('aria-checked')
            .catch(() => null);
          if (checked === 'true') {
            await selectAllLabel.click().catch(() => {});
            await page.waitForTimeout(150);
          }
          return await firstOption.getAttribute('aria-checked').catch(() => null);
        },
        { timeout: 15_000, intervals: [200, 400, 800, 1500] }
      )
      .toBe('false');
  });

  await test.step('Pick one option', async () => {
    // First real value is at aria-posinset=2. Capture its text so we can
    // later assert the grid is filtered to that value.
    const firstOption = page.locator(
      '.ag-filter-menu .ag-virtual-list-item[aria-posinset="2"]'
    );
    await expect(firstOption).toBeVisible({ timeout: 10_000 });
    pickedDescription = (await firstOption.locator('.ag-checkbox-label').innerText()).trim();
    // eslint-disable-next-line no-console
    console.log(`[C25708] picked description = ${JSON.stringify(pickedDescription)}`);
    await firstOption.locator('.ag-checkbox-label').click();
    await expect(firstOption).toHaveAttribute('aria-checked', 'true', {
      timeout: 10_000,
    });
    // Close the filter menu by clicking outside so the Save View button is
    // not blocked. Pressing Escape is the documented ag-grid close gesture.
    await page.keyboard.press('Escape');
    await expect(page.locator('.ag-filter-menu')).toBeHidden({ timeout: 5_000 });
  });

  await test.step('Save New View button becomes enabled', async () => {
    // The filter change should have flipped savedViewsChanged=true → the
    // grayOut class drops from #saveView.
    const saveBtn = page.locator('span#saveView');
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
    await expect(saveBtn).not.toHaveClass(/grayOut/i, { timeout: 10_000 });
    await saveBtn.click();
    await expect(
      page.getByText('Save View', { exact: true }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Fill name, check both checkboxes, and Save', async () => {
    const nameInput = page.getByPlaceholder('Name of a View').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.click();
    await nameInput.pressSequentially(VIEW_NAME, { delay: 20 });
    await expect(nameInput).toHaveValue(VIEW_NAME);

    // Same FormBuilder pattern as C25655 — the visible click target is
    // `input + label[data-type="icon"]`, not the for-label or the hidden
    // input itself.
    const tickCheckbox = async (fieldId) => {
      const input = page.locator(`input#${fieldId}`).first();
      const iconLabel = page
        .locator(`input#${fieldId} + label[data-type="icon"]`)
        .first();
      await iconLabel.waitFor({ state: 'visible', timeout: 10_000 });
      await expect
        .poll(
          async () => {
            const checked = await input.evaluate(
              (el) => /** @type {HTMLInputElement} */ (el).checked
            );
            if (!checked) await iconLabel.click().catch(() => {});
            return await input.evaluate(
              (el) => /** @type {HTMLInputElement} */ (el).checked
            );
          },
          { timeout: 10_000, intervals: [200, 400, 800, 1500] }
        )
        .toBe(true);
    };
    await tickCheckbox('includeCurrentFilters_0_multiGroupField');
    await tickCheckbox('defaultView_0_multiGroupField');

    const submitBtn = page.locator('button[data-role="formSubmitButton"]').first();
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await expect(submitBtn).not.toHaveClass(/disabled/i, { timeout: 15_000 });
    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/react/saveAdvisorGridPreferences.do') && r.status() === 200,
      { timeout: 30_000 }
    );
    await submitBtn.click();
    await saveResponse;
    await expect(
      page.getByText('Save View', { exact: true }).first()
    ).toBeHidden({ timeout: 15_000 });
  });

  await test.step('Saved view is selected in the views dropdown', async () => {
    await expect(page.locator('#savedViewsList')).toContainText(VIEW_NAME, {
      timeout: 15_000,
    });
  });

  await test.step('Navigate to Statement Templates', async () => {
    await page.goto(STATEMENT_TEMPLATES_URL);
    await expect(
      page.getByText('Statement Templates', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Navigate back to Statement Charges', async () => {
    await page.goto(STATEMENT_CHARGES_URL);
    await expect(
      page.getByText('Statement Charges', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator('.ag-header-cell[col-id="description"]')
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Saved view is auto-selected on return', async () => {
    await expect(page.locator('#savedViewsList')).toContainText(VIEW_NAME, {
      timeout: 30_000,
    });
  });

  await test.step('Grid is filtered by the saved description', async () => {
    // Wait for the data rows to settle, then assert every visible description
    // cell equals the picked value. (The set filter with a single value
    // collapses the grid to rows whose description column matches.)
    await page.waitForTimeout(1000);
    const descCells = page.locator('.ag-row .ag-cell[col-id="description"]');
    const count = await descCells.count();
    expect(count, 'at least one row should match the saved filter').toBeGreaterThan(0);
    // Verify every visible description-column cell carries the picked value.
    for (let i = 0; i < count; i++) {
      const text = (await descCells.nth(i).innerText()).trim();
      expect(text, `row ${i} description should match the saved filter`).toBe(
        pickedDescription
      );
    }
  });
});
