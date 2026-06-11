// @ts-check
/**
 * TestRail C25706 — Statement Charges - default system view sort order for
 * Advisor/Advisor Group and Start Date.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25706 (Run 206)
 * Linked Jira: GEO-20451
 *
 * Manual steps:
 *   1. Log in as firm 1 admin, open Statement Charges.
 *   2. Click the "View:" dropdown.
 *   3. Click "Edit" → Edit Saved Views modal opens.
 *   4. For "System View" row, click the DEFAULT radio button.
 *   5. Click Save (modal submit).
 *   6. Reopen the View dropdown → "System View - default" appears.
 *   7. Select it.
 *   8. Verify: Start Date column sorted DESC, Advisor/Advisor Group sorted ASC.
 *
 * Implementation notes:
 *   - The view selector is rendered by GridSavedViews.js as
 *     `<ListNew id="savedViewsList">`. Clicking its visible header text opens
 *     a dropdown menu containing each saved view + an "Edit" entry.
 *   - The Edit Saved Views modal is FormBuilder-backed with a multiGroupGrid
 *     of rows; the DEFAULT control per row is a FormBuilder RadioButtons
 *     rendered as `defaultViewIndex_<rowIndex>` (see MultiGroupGrid.js:444).
 *     "System View" is always the LAST row (sortSavedViewsForEdit puts the
 *     SYSTEM_DEFAULT_VIEW_ID at the end).
 *   - After save, useSavedViews.js suffixes the active default's name with
 *     " - default", so the dropdown header reads "View: System View - default".
 *   - Sort assertion: ag-grid mirrors the column sort state into the header
 *     cell's `aria-sort` attribute ("ascending" / "descending" / "none").
 *
 * Re-runs: this test sets tim1's default back to System View — it actually
 * REVERTS state that previous C25655 runs may have set. No accumulation.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const STATEMENT_CHARGES_URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';

const SYSTEM_VIEW_LABEL = 'System View';
const SYSTEM_VIEW_DEFAULT_LABEL = `${SYSTEM_VIEW_LABEL} - default`;

test('@pepi C25706 Statement Charges - default system view sort order', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Open Statement Charges', async () => {
    await page.goto(STATEMENT_CHARGES_URL);
    await expect(
      page.getByText('Statement Charges', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('Open the View dropdown and click Edit', async () => {
    // ListNew renders `<menu id="savedViewsList">` as the closed header.
    // When clicked, the dropdown options are rendered into a sibling portal
    // (NOT as children of the menu) — anchors carry
    // `data-type="listOption" data-value="<text>"`.
    await page.locator('#savedViewsList').click();
    const editOption = page.locator('a[data-type="listOption"][data-value="Edit"]');
    await expect(editOption).toBeVisible({ timeout: 5_000 });
    await editOption.click();

    await expect(
      page.getByText('Edit Saved Views', { exact: true }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Mark System View as default and save', async () => {
    // The list inside the modal is sorted so SYSTEM_DEFAULT_VIEW_ID is last
    // (sortSavedViewsForEdit). We need to pick its DEFAULT radio. The radio
    // is rendered by MultiGroupGrid as `id="defaultViewIndex_<rowIndex>"`
    // with index = position in the rendered list. Rather than count rows
    // (which would couple us to whatever saved views currently exist on
    // tim1's account), we scope by the "System View" name in the row's
    // name input and pick the radio in the same row.
    //
    // Each row is `<section id="editSavedViews_<rowIndex>">` (FormBuilder
    // multiGroupGrid convention — same as #saveView_0 in C25655). The
    // System View row's name input holds value "System View" AND its name
    // input is disabled (per useBuildEditSaveViewsList:35).
    const rows = page.locator('section[id^="editSavedViews_"]');
    const systemRow = rows.filter({
      has: page.locator('input[value="System View"]'),
    });
    await expect(systemRow).toHaveCount(1, { timeout: 10_000 });
    // The DEFAULT radio is a FormBuilder RadioButtons rendered inside the row.
    // Its input id starts with `defaultViewIndex_`.
    const defaultRadio = systemRow.locator('input[id^="defaultViewIndex_"]').first();
    // Same trap as C25655 checkboxes: the input is display:none, with a
    // visible adjacent label[data-type="icon"] acting as the click target.
    const radioLabel = systemRow
      .locator('input[id^="defaultViewIndex_"] + label[data-type="icon"]')
      .first();
    await radioLabel.waitFor({ state: 'visible', timeout: 10_000 });
    await expect
      .poll(
        async () => {
          const checked = await defaultRadio.evaluate(
            (el) => /** @type {HTMLInputElement} */ (el).checked
          );
          if (!checked) await radioLabel.click().catch(() => {});
          return await defaultRadio.evaluate(
            (el) => /** @type {HTMLInputElement} */ (el).checked
          );
        },
        { timeout: 10_000, intervals: [200, 400, 800, 1500] }
      )
      .toBe(true);

    const submitBtn = page.locator('button[data-role="formSubmitButton"]').first();
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await expect(submitBtn).not.toHaveClass(/disabled/i, { timeout: 15_000 });
    const saveResponse = page.waitForResponse(
      (r) =>
        (r.url().includes('/react/saveAdvisorGridPreferences.do') ||
          r.url().includes('/react/updateGridPreferences')) &&
        r.status() === 200,
      { timeout: 30_000 }
    );
    await submitBtn.click();
    await saveResponse.catch(() => {
      // Some EditSavedViews flows hit a different endpoint or batch the save;
      // fall back to waiting for the modal to close.
    });
    await expect(
      page.getByText('Edit Saved Views', { exact: true }).first()
    ).toBeHidden({ timeout: 15_000 });
  });

  await test.step('Reopen the View dropdown and select "System View - default"', async () => {
    await page.locator('#savedViewsList').click();
    // ListNew renders the active default's name with a " - default" suffix
    // in the dropdown options (see useSavedViews.js), so we match the
    // suffixed string. The header below the dropdown, in contrast, shows
    // the raw `View: System View` (no suffix) — selectedView.name is the
    // unsuffixed form, see GridSavedViews.js:114.
    const sysDefault = page.locator(
      `a[data-type="listOption"][data-value="${SYSTEM_VIEW_DEFAULT_LABEL}"]`
    );
    await expect(sysDefault).toBeVisible({ timeout: 10_000 });
    await sysDefault.click();
    await expect(page.locator('#savedViewsList')).toContainText(
      `View: ${SYSTEM_VIEW_LABEL}`,
      { timeout: 10_000 }
    );
  });

  await test.step('Start Date is sorted descending and Advisor/Advisor Group ascending', async () => {
    const startDateHeader = page.locator('.ag-header-cell[col-id="startDate"]').first();
    const advisorHeader = page
      .locator('.ag-header-cell[col-id="advisorOrGroupName"]')
      .first();
    await expect(startDateHeader).toHaveAttribute('aria-sort', 'descending', {
      timeout: 10_000,
    });
    await expect(advisorHeader).toHaveAttribute('aria-sort', 'ascending', {
      timeout: 10_000,
    });
  });
});
