// @ts-check
/**
 * TestRail C25655 — Statement Charges - Save new grid view as default
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25655 (Run 206)
 * Linked Jira: GEO-20451
 *
 * Manual steps (paraphrased):
 *   1. Log in as firm 1 admin, open Platform One → Operations → Billing →
 *      Statement Charges.
 *   2. Drag the second column header all the way to the right.
 *   3. Click "Save New View".
 *   4. In the modal: name = "New default view", check "Include Current Filters"
 *      AND "Default", click Save.
 *   5. Navigate to Statement Templates.
 *   6. Navigate back to Statement Charges.
 *   7. The newly saved view is automatically selected AND the moved column is
 *      still at the right end.
 *
 * Implementation notes:
 *   - Routes: hash deep-link is the same end state as the sidebar drill and
 *     is what every other @pepi spec under tests/billing-specs uses, so we
 *     skip the sidebar in favour of #platformOne/billingCenter/statementCharges.
 *   - Grid id: GwGridPersist mounts as "StatementChargesIdP1" on Platform One
 *     (see StatementChargesGrid.js:19). Column 1 is Firm (lockPosition:'left',
 *     suppressMovable:true). Column 2 is "Advisor/Advisor Group", field
 *     `advisorOrGroupName` — the one TestRail asks to drag. Last visible col
 *     is "Action Buttons" (pinned:'right'); the rightmost MOVABLE col is
 *     "Stmt Sort Order" (field `positionInStatement`).
 *   - Saved-views UI lives in modules/GwGrid/components/GridSavedViews. The
 *     "Save New View" trigger is `<span id="saveView">`; it is greyed out
 *     (CSS class `grayOut___xxx`) while `savedViewsChanged===false`, so the
 *     drag MUST register before clicking it.
 *   - Save View modal uses FormBuilder with a multiGroupGrid row holding:
 *       name (text, placeholder "Name of a View"),
 *       includeCurrentFilters (checkbox),
 *       defaultView (checkbox).
 *     React FormBuilder mounts the checkbox `<input>` with display:none and a
 *     visible `<label for="...">`; label clicks need the poll-retry from
 *     C25084 because the onChange handler attaches asynchronously.
 *   - Saved views persist per-user on the GW Admin (POST
 *     /react/saveAdvisorGridPreferences.do). The tim1 account is shared, so
 *     re-runs would collide on a literal name "New default view". We suffix
 *     the name with a timestamp so each run gets a unique saved view; the
 *     literal-name aspect of the TestRail step is documented but relaxed.
 *     No cleanup — saved views accumulate by design (Edit Saved Views modal
 *     can clean them up manually if needed).
 *   - The view header (after save) renders as `View: <name>` or
 *     `View: <name> - default` (useSavedViews.js). We match by regex.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const STATEMENT_CHARGES_URL = '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const STATEMENT_TEMPLATES_URL =
  '/react/indexReact.do#platformOne/billingCenter/statementTemplates';

// "Second column" per TestRail = the second column the user sees, ignoring
// the hidden selection column. On a fresh load that's `advisorOrGroupName`
// (the Firm column is locked at idx 2 and stays put). But this test mutates
// the shared tim1 user's *default* saved view — on rerun, the default view
// already has `advisorOrGroupName` at the right end, so the column at
// aria-colindex=3 is now whatever was at position 3 in the last saved order.
// To keep the test idempotent across re-runs we discover both endpoints
// dynamically at runtime instead of hardcoding col-ids.

const VIEW_NAME = `New default view C25655 ${Date.now()}`;

const NON_MOVABLE_COL_IDS = new Set(['ag-Grid-SelectionColumn', 'firmName', 'actionButtons']);

/**
 * Read the current visual column order from ag-grid headers. Returns
 * objects sorted by aria-colindex (which ag-grid keeps in sync with the
 * visible order). Excludes the pinned Action Buttons column from the
 * "movable" set — it lives in a different header container and can't accept
 * a drop to its right.
 *
 * @param {import('@playwright/test').Page} page
 */
async function readHeaderOrder(page) {
  return page.evaluate(() => {
    /** @type {Array<{colId: string, ariaColIndex: number}>} */
    const headers = [];
    for (const el of document.querySelectorAll('.ag-header-cell[col-id]')) {
      const colId = el.getAttribute('col-id');
      const idxAttr = el.getAttribute('aria-colindex');
      if (!colId || !idxAttr) continue;
      headers.push({ colId, ariaColIndex: Number(idxAttr) });
    }
    headers.sort((a, b) => a.ariaColIndex - b.ariaColIndex);
    return headers;
  });
}

test('@pepi C25655 Statement Charges - Save new grid view as default', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  /** @type {string} */
  let draggedColId;
  /** @type {string} */
  let rightmostMovableColIdAtStart;

  await test.step('Open Statement Charges and wait for the grid to render', async () => {
    await page.goto(STATEMENT_CHARGES_URL);
    await expect(
      page.getByText('Statement Charges', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    // Wait for ag-grid's header cells to render — readHeaderOrder needs them.
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('Identify the second user-visible column and the rightmost movable column', async () => {
    const order = await readHeaderOrder(page);
    // The user-visible columns start with Firm (locked-left, suppressMovable).
    // "Second column" → first movable column to the right of Firm.
    const movable = order.filter((h) => !NON_MOVABLE_COL_IDS.has(h.colId));
    if (movable.length < 2) {
      throw new Error(
        `Statement Charges: expected ≥2 movable columns, got ${movable.length}`
      );
    }
    draggedColId = movable[0].colId;
    rightmostMovableColIdAtStart = movable[movable.length - 1].colId;
    if (draggedColId === rightmostMovableColIdAtStart) {
      throw new Error('Source and target column would be the same — bad starting state');
    }
    // eslint-disable-next-line no-console
    console.log(
      `[C25655] dragging col=${draggedColId} → past rightmost=${rightmostMovableColIdAtStart}`
    );
  });

  await test.step('Drag the second column header to the right end', async () => {
    // ag-grid 33's column reorder is driven by synthetic mouse events on
    // `.ag-header-cell` with a drag-threshold filter — Playwright's HTML5
    // `dragTo()` doesn't fire those events. We must drive mouse.{down,move,up}
    // directly, AND with a slow stepped path: a fast straight-line move was
    // observed to fail the drag-threshold detection silently (the column
    // stays put and `savedViewsChanged` never flips, so #saveView keeps its
    // `grayOut` class). The small waits between intermediate moves let
    // ag-grid latch onto the drag-source and follow the drop indicator.
    const source = page.locator(`.ag-header-cell[col-id="${draggedColId}"]`);
    const target = page.locator(
      `.ag-header-cell[col-id="${rightmostMovableColIdAtStart}"]`
    );
    const srcBox = await source.boundingBox();
    const tgtBox = await target.boundingBox();
    if (!srcBox || !tgtBox) {
      throw new Error('Statement Charges: header cells missing bounding boxes');
    }
    const sx = srcBox.x + srcBox.width / 2;
    const sy = srcBox.y + srcBox.height / 2;
    // Drop just inside the right edge of the rightmost movable column — that
    // tells ag-grid to insert the dragged column AFTER it.
    const ex = tgtBox.x + tgtBox.width - 8;
    const ey = tgtBox.y + tgtBox.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.waitForTimeout(100);
    // Tiny initial nudge to trip the drag threshold.
    await page.mouse.move(sx + 5, sy, { steps: 3 });
    await page.waitForTimeout(50);
    await page.mouse.move(sx + 20, sy, { steps: 5 });
    await page.waitForTimeout(50);
    // Walk in 10% increments toward the target so ag-grid's drop indicator
    // can follow each step.
    for (let f = 0.2; f <= 1.0; f += 0.1) {
      const ix = sx + (ex - sx) * f;
      const iy = sy + (ey - sy) * f;
      await page.mouse.move(ix, iy, { steps: 3 });
      await page.waitForTimeout(30);
    }
    await page.mouse.move(ex, ey, { steps: 3 });
    await page.waitForTimeout(100);
    await page.mouse.up();

    // The dragged column should now sit at the rightmost movable position
    // (i.e. its aria-colindex is now greater than the original anchor's).
    await expect
      .poll(
        async () => {
          const draggedIdx = await source
            .first()
            .getAttribute('aria-colindex')
            .catch(() => null);
          const anchorIdx = await target
            .first()
            .getAttribute('aria-colindex')
            .catch(() => null);
          if (!draggedIdx || !anchorIdx) return null;
          return Number(draggedIdx) > Number(anchorIdx);
        },
        { timeout: 10_000, intervals: [200, 400, 800, 1500] }
      )
      .toBe(true);
  });

  await test.step('Save New View becomes enabled and opens the Save View modal', async () => {
    // span#saveView wears the `grayOut___...` CSS class while
    // savedViewsChanged===false; the click is a no-op then. After the drag,
    // the class drops and the click opens the modal. Gate the click on the
    // class state, not toBeEnabled() (the span has no disabled attribute).
    const saveBtn = page.locator('span#saveView');
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
    await expect(saveBtn).not.toHaveClass(/grayOut/i, { timeout: 10_000 });
    await saveBtn.click();

    await expect(
      page.getByText('Save View', { exact: true }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Type the view name into "Name of a View"', async () => {
    // Stable selector: the placeholder string is set in
    // useSaveViewGroupConfig.js → name.placeholder.
    const nameInput = page.getByPlaceholder('Name of a View').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    // React controlled-input: pressSequentially drives onChange where fill()
    // sometimes leaves React state behind (see project_formbuilder_password_modal).
    await nameInput.click();
    await nameInput.pressSequentially(VIEW_NAME, { delay: 20 });
    await expect(nameInput).toHaveValue(VIEW_NAME);
  });

  // FormBuilder's multiGroupGrid renders each field id as
  // `<fieldId>_<rowIndex>_multiGroupField` (rowIndex is 0 for the saveView
  // single-row form). The checkbox DOM is:
  //   <div data-type="fieldWrapper">
  //     <input type=checkbox id="<id>" style="display:none">  ← hidden
  //     <label data-type="icon"><svg id="checkbox"/></label>  ← visible click target
  //     <label data-type="checkboxLabel" for="<id>"></label>  ← empty, 0×0
  //   </div>
  // Clicking the `for=`-label or the input directly is a no-op (the for-label
  // has no content + no size; the input has display:none). The icon-label
  // (the SVG) is the actual clickable surface — we anchor on it via
  // adjacent-sibling selector. Poll-retry guards against the FormBuilder
  // mount race (same shape as C25084 used).
  const tickFormBuilderCheckbox = async (fieldId) => {
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

  await test.step('Check Include Current Filters', async () => {
    await tickFormBuilderCheckbox('includeCurrentFilters_0_multiGroupField');
  });

  await test.step('Check Default', async () => {
    await tickFormBuilderCheckbox('defaultView_0_multiGroupField');
  });

  await test.step('Click Save and wait for the modal to close', async () => {
    // Two "Save" buttons coexist when the SAVE_VIEW_MODAL_ID modal is open:
    //   1. The FormBuilder submit inside #modal (data-role="formSubmitButton")
    //   2. A "Save as Draft" inside #SaveAsDraftWrapper (data-type="safeAsDraftButton")
    // We want the former. Anchor on data-role to avoid strict-mode collisions.
    // Per [[project_formbuilder_disabled_style_only]] the submit button gets
    // a `disabled___xxx` CSS class while isFormValid===false but has no
    // disabled HTML attribute — wait for the class to drop before clicking.
    const submitBtn = page.locator('button[data-role="formSubmitButton"]').first();
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await expect(submitBtn).not.toHaveClass(/disabled/i, { timeout: 15_000 });

    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/react/saveAdvisorGridPreferences.do') && r.status() === 200,
      { timeout: 30_000 }
    );
    await submitBtn.click();
    await saveResponse;
    // The modal closes once GridCreateSaveView sees isLoaded && !errorMessage.
    await expect(
      page.getByText('Save View', { exact: true }).first()
    ).toBeHidden({ timeout: 15_000 });
  });

  await test.step('Saved view is selected in the views dropdown', async () => {
    const viewSelector = page.locator('#savedViewsList');
    await expect(viewSelector).toContainText(VIEW_NAME, { timeout: 15_000 });
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
    // Wait for the grid to mount again before reading the view selector.
    await expect(
      page.locator(`.ag-header-cell[col-id="${draggedColId}"]`)
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Saved view is auto-selected on return', async () => {
    await expect(page.locator('#savedViewsList')).toContainText(VIEW_NAME, {
      timeout: 30_000,
    });
  });

  await test.step('Dragged column is still rightmost-movable after reload', async () => {
    const draggedHeader = page
      .locator(`.ag-header-cell[col-id="${draggedColId}"]`)
      .first();
    const anchorHeader = page
      .locator(`.ag-header-cell[col-id="${rightmostMovableColIdAtStart}"]`)
      .first();
    await expect
      .poll(
        async () => {
          const draggedIdx = await draggedHeader
            .getAttribute('aria-colindex')
            .catch(() => null);
          const anchorIdx = await anchorHeader
            .getAttribute('aria-colindex')
            .catch(() => null);
          if (!draggedIdx || !anchorIdx) return null;
          return Number(draggedIdx) > Number(anchorIdx);
        },
        { timeout: 15_000, intervals: [400, 800, 1500] }
      )
      .toBe(true);
  });
});
