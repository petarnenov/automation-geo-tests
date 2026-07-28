// @ts-check
/**
 * TestRail C25711 — Statement Templates - save default view with custom filters.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25711 (Run 214)
 * Linked Jira: GEO-20452
 *
 * Manual steps (paraphrased):
 *   1. Log in as firm 1 admin, open Statement Templates.
 *   2. Click the "Filter On" button.
 *   3. Open the NAME column filter (templateName).
 *   4. Click (Select All) to deselect every value.
 *   5. Pick one option.
 *   6. Click "Save New View".
 *   7. In the modal: type a name, tick Include Current Filters + Default.
 *   8. Click Save.
 *   9. Navigate to a different Platform One page (Statement Charges).
 *  10. Navigate back to Statement Templates — saved view auto-selected and the
 *      grid is populated by the saved filter (only the picked NAME visible).
 *
 * Implementation notes — sibling C25708 (Statement Charges variant) is the
 * structural blueprint. Differences here:
 *   - Filtered column is `templateName` (Template Name) rather than
 *     `description`. defaultColDef sets `filter: 'agSetColumnFilter'`
 *     (StatementTemplatesGrid.js), so the column carries the same Set Filter
 *     popup machinery as Statement Charges.
 *   - Away page is Statement Charges (`#platformOne/billingCenter/statementCharges`).
 *
 * tim1's saved views accumulate per-user via POST
 * `/react/saveAdvisorGridPreferences.do`; we suffix the view name with a
 * timestamp so re-runs don't collide. No cleanup by design.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const STATEMENT_TEMPLATES_URL =
  '/react/indexReact.do#platformOne/billingCenter/statementTemplates';
const STATEMENT_CHARGES_URL =
  '/react/indexReact.do#platformOne/billingCenter/statementCharges';

const VIEW_NAME = `Custom filter view C25711 ${Date.now()}`;

// qa4 renders the Template Name column with col-id `statementName` (the source
// const TEMPLATE_NAME = 'templateName' is a newer rename not yet on qa4).
const FILTERED_COL_ID = 'statementName';

test('@pepi C25711 Statement Templates - save default view with custom filters', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneTim1Fresh(page);

  /** @type {string} */
  let pickedName;

  await test.step('Open Statement Templates and wait for the grid to render', async () => {
    await page.goto(STATEMENT_TEMPLATES_URL);
    await expect(
      page.getByText('Statement Templates', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
  });

  await test.step('Click the Filter On toggle', async () => {
    // ToggleFloatingFilter.js renders `<span id="columnDefault">`; its onClick
    // always sets showFloatingFilter=true, so clicking is idempotent.
    await page.locator('span#columnDefault').first().click();
    await expect(
      page.locator('.ag-header-cell.ag-floating-filter').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Open the Template Name column filter', async () => {
    // Floating filter cells don't have col-id — match by aria-colindex
    // mirroring the regular header. The trigger is
    // `button.ag-floating-filter-button-button` (aria-label "Open Filter Menu").
    const nameAriaIdx = await page
      .locator(`.ag-header-cell[col-id="${FILTERED_COL_ID}"]`)
      .first()
      .getAttribute('aria-colindex');
    expect(nameAriaIdx, `${FILTERED_COL_ID} column must have an aria-colindex`).toBeTruthy();
    const nameFloating = page.locator(
      `.ag-header-cell.ag-floating-filter[aria-colindex="${nameAriaIdx}"]`
    );
    await expect(nameFloating).toBeVisible({ timeout: 10_000 });
    await nameFloating.locator('button.ag-floating-filter-button-button').click({ force: true });
    await expect(page.locator('.ag-filter-menu')).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Click (Select All) until everything is deselected', async () => {
    // (Select All) is at aria-posinset=1, first real value at posinset=2.
    // Polling on posinset=2 covers both the fresh-load state (everything
    // pre-selected; one click clears) and the re-run state where a saved
    // view restored a partial selection (one click might re-select all).
    const selectAllRow = page.locator(
      '.ag-filter-menu .ag-virtual-list-item[aria-posinset="1"]'
    );
    await expect(selectAllRow).toBeVisible({ timeout: 10_000 });
    const selectAllLabel = selectAllRow.locator('.ag-checkbox-label');
    const firstOption = page.locator(
      '.ag-filter-menu .ag-virtual-list-item[aria-posinset="2"]'
    );
    await expect
      .poll(
        async () => {
          const checked = await firstOption.getAttribute('aria-checked').catch(() => null);
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
    const firstOption = page.locator(
      '.ag-filter-menu .ag-virtual-list-item[aria-posinset="2"]'
    );
    await expect(firstOption).toBeVisible({ timeout: 10_000 });
    pickedName = (await firstOption.locator('.ag-checkbox-label').innerText()).trim();
    // eslint-disable-next-line no-console
    console.log(`[C25711] picked template name = ${JSON.stringify(pickedName)}`);
    await firstOption.locator('.ag-checkbox-label').click();
    await expect(firstOption).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
    // Close the filter menu so the Save View button is clickable.
    await page.keyboard.press('Escape');
    await expect(page.locator('.ag-filter-menu')).toBeHidden({ timeout: 5_000 });
  });

  await test.step('Save New View button becomes enabled', async () => {
    const saveBtn = page.locator('span#saveView');
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
    await expect(saveBtn).not.toHaveClass(/grayOut/i, { timeout: 10_000 });
    await saveBtn.click();
    await expect(page.getByText('Save View', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  await test.step('Fill name, check both checkboxes, and Save', async () => {
    const nameInput = page.getByPlaceholder('Name of a View').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.click();
    await nameInput.pressSequentially(VIEW_NAME, { delay: 20 });
    await expect(nameInput).toHaveValue(VIEW_NAME);

    // FormBuilder visible click target is `input + label[data-type="icon"]`.
    const tickCheckbox = async (fieldId) => {
      const input = page.locator(`input#${fieldId}`).first();
      const iconLabel = page.locator(`input#${fieldId} + label[data-type="icon"]`).first();
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
    await expect(page.getByText('Save View', { exact: true }).first()).toBeHidden({
      timeout: 15_000,
    });
  });

  await test.step('Saved view is selected in the views dropdown', async () => {
    await expect(page.locator('#savedViewsList')).toContainText(VIEW_NAME, {
      timeout: 15_000,
    });
  });

  await test.step('Navigate to Statement Charges', async () => {
    await page.goto(STATEMENT_CHARGES_URL);
    await expect(
      page.getByText('Statement Charges', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Navigate back to Statement Templates', async () => {
    await page.goto(STATEMENT_TEMPLATES_URL);
    await expect(
      page.getByText('Statement Templates', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(`.ag-header-cell[col-id="${FILTERED_COL_ID}"]`)
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Saved view is auto-selected on return', async () => {
    await expect(page.locator('#savedViewsList')).toContainText(VIEW_NAME, {
      timeout: 30_000,
    });
  });

  await test.step('Grid is filtered by the saved template name', async () => {
    // The set filter with a single value collapses the grid to rows whose
    // templateName column matches. Assert every visible templateName cell
    // equals the picked value.
    await page.waitForTimeout(1000);
    const nameCells = page.locator(`.ag-row .ag-cell[col-id="${FILTERED_COL_ID}"]`);
    const count = await nameCells.count();
    expect(count, 'at least one row should match the saved filter').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = (await nameCells.nth(i).innerText()).trim();
      expect(text, `row ${i} ${FILTERED_COL_ID} should match the saved filter`).toBe(
        pickedName
      );
    }
  });
});
