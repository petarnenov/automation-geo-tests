// @ts-check
/**
 * TestRail C25652 — Statement Templates - Save new grid view as default
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25652 (Run 214)
 * Linked Jira: GEO-20452
 *
 * Manual steps (paraphrased):
 *   1. Log in as firm 1 admin, open Platform One → Operations → Billing →
 *      Statement Templates.
 *   2. Drag the second column header all the way to the right.
 *   3. Click "Save New View".
 *   4. In the modal: name = "New default view", check "Include Current Filters"
 *      AND "Default", click Save.
 *   5. Navigate to a different Platform One page (Operations → Billing → Billing
 *      Templates).
 *   6. Navigate back to Statement Templates.
 *   7. The newly saved view is automatically selected AND the moved column is
 *      still at the right end.
 *
 * Implementation notes — see the sibling case C25655 (Statement Charges variant)
 * which uses the same GwGridPersist saved-views UI and is the structural blueprint
 * for this spec. The differences here:
 *   - Grid id is StatementTemplatesIdP1 (vs StatementChargesIdP1) — irrelevant
 *     for selectors, but worth noting if a future change scopes things by grid id.
 *   - The locked-left, suppressMovable column is `selectFirmName` (Firm) rather
 *     than `firmName`. The pinned-right `actionButtons` and ag-grid's hidden
 *     `ag-Grid-SelectionColumn` are the same.
 *   - "Different part of Platform One" → Billing Templates lives at
 *     `#platformOne/billingCenter/templates` (BillingCenter.js:46).
 *
 * Same shared-state caveat as C25655: tim1's saved views accumulate per-user
 * (POST /react/saveAdvisorGridPreferences.do). The view name is suffixed with a
 * timestamp so re-runs don't collide; no cleanup by design.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const STATEMENT_TEMPLATES_URL =
  '/react/indexReact.do#platformOne/billingCenter/statementTemplates';
const BILLING_TEMPLATES_URL = '/react/indexReact.do#platformOne/billingCenter/templates';

const VIEW_NAME = `New default view C25652 ${Date.now()}`;

// qa4 renders the locked-left Firm column with col-id `firmName` (the source
// code's `selectFirmName` is a newer rename not yet on qa4). Keep both ids in
// the non-movable set so the spec survives whichever build is deployed.
const NON_MOVABLE_COL_IDS = new Set([
  'ag-Grid-SelectionColumn',
  'firmName',
  'selectFirmName',
  'actionButtons',
]);

/**
 * Read the current visual column order from ag-grid headers. Returns
 * objects sorted by aria-colindex (which ag-grid keeps in sync with the
 * visible order). The pinned `actionButtons` column lives in a different
 * header container and cannot accept a drop to its right, so it is
 * excluded from the "movable" set the spec drags against.
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

test('@pepi C25652 Statement Templates - Save new grid view as default', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneTim1Fresh(page);

  /** @type {string} */
  let draggedColId;
  /** @type {string} */
  let rightmostMovableColIdAtStart;

  await test.step('Open Statement Templates and wait for the grid to render', async () => {
    await page.goto(STATEMENT_TEMPLATES_URL);
    await expect(
      page.getByText('Statement Templates', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('Identify the second user-visible column and the rightmost movable column', async () => {
    const order = await readHeaderOrder(page);
    const movable = order.filter((h) => !NON_MOVABLE_COL_IDS.has(h.colId));
    if (movable.length < 2) {
      throw new Error(
        `Statement Templates: expected ≥2 movable columns, got ${movable.length}`
      );
    }
    draggedColId = movable[0].colId;
    rightmostMovableColIdAtStart = movable[movable.length - 1].colId;
    if (draggedColId === rightmostMovableColIdAtStart) {
      throw new Error('Source and target column would be the same — bad starting state');
    }
    // eslint-disable-next-line no-console
    console.log(
      `[C25652] dragging col=${draggedColId} → past rightmost=${rightmostMovableColIdAtStart}`
    );
  });

  await test.step('Drag the second column header to the right end', async () => {
    // ag-grid 33's column reorder is driven by synthetic mouse events on
    // `.ag-header-cell` with a drag-threshold filter — Playwright's HTML5
    // `dragTo()` doesn't fire those events. Drive mouse.{down,move,up}
    // directly, with a slow stepped path so ag-grid latches onto the drag
    // source and follows the drop indicator. Identical shape to C25655.
    const source = page.locator(`.ag-header-cell[col-id="${draggedColId}"]`);
    const target = page.locator(
      `.ag-header-cell[col-id="${rightmostMovableColIdAtStart}"]`
    );
    const srcBox = await source.boundingBox();
    const tgtBox = await target.boundingBox();
    if (!srcBox || !tgtBox) {
      throw new Error('Statement Templates: header cells missing bounding boxes');
    }
    const sx = srcBox.x + srcBox.width / 2;
    const sy = srcBox.y + srcBox.height / 2;
    const ex = tgtBox.x + tgtBox.width - 8;
    const ey = tgtBox.y + tgtBox.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(sx + 5, sy, { steps: 3 });
    await page.waitForTimeout(50);
    await page.mouse.move(sx + 20, sy, { steps: 5 });
    await page.waitForTimeout(50);
    for (let f = 0.2; f <= 1.0; f += 0.1) {
      const ix = sx + (ex - sx) * f;
      const iy = sy + (ey - sy) * f;
      await page.mouse.move(ix, iy, { steps: 3 });
      await page.waitForTimeout(30);
    }
    await page.mouse.move(ex, ey, { steps: 3 });
    await page.waitForTimeout(100);
    await page.mouse.up();

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
    // savedViewsChanged===false; gate the click on the class state, not
    // toBeEnabled() (the span has no disabled attribute).
    const saveBtn = page.locator('span#saveView');
    await expect(saveBtn).toBeVisible({ timeout: 10_000 });
    await expect(saveBtn).not.toHaveClass(/grayOut/i, { timeout: 10_000 });
    await saveBtn.click();

    await expect(page.getByText('Save View', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  await test.step('Type the view name into "Name of a View"', async () => {
    const nameInput = page.getByPlaceholder('Name of a View').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.click();
    await nameInput.pressSequentially(VIEW_NAME, { delay: 20 });
    await expect(nameInput).toHaveValue(VIEW_NAME);
  });

  // FormBuilder's multiGroupGrid renders each field id as
  // `<fieldId>_<rowIndex>_multiGroupField` (rowIndex is 0 for the saveView
  // single-row form). The visible click target is the icon-label sibling
  // of the (display:none) checkbox input. See C25655 for the long-form
  // rationale.
  const tickFormBuilderCheckbox = async (fieldId) => {
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

  await test.step('Check Include Current Filters', async () => {
    await tickFormBuilderCheckbox('includeCurrentFilters_0_multiGroupField');
  });

  await test.step('Check Default', async () => {
    await tickFormBuilderCheckbox('defaultView_0_multiGroupField');
  });

  await test.step('Click Save and wait for the modal to close', async () => {
    // FormBuilder submit button wears a `disabled___xxx` CSS class while
    // isFormValid===false but exposes no disabled HTML attribute — wait for
    // the class to drop before clicking. See project_formbuilder_disabled_style_only.
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

  await test.step('Navigate to Billing Templates', async () => {
    await page.goto(BILLING_TEMPLATES_URL);
    await expect(
      page.getByText('Billing Templates', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('Navigate back to Statement Templates', async () => {
    await page.goto(STATEMENT_TEMPLATES_URL);
    await expect(
      page.getByText('Statement Templates', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
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
