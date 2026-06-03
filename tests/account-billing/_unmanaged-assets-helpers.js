// @ts-check
/**
 * Shared helpers for the Manage Unmanaged Assets dialog.
 *
 * Used by C25206..C25209. Each spec exercises a different combination of the
 * dialog's controls (the SYMBOL autocomplete, the EXCLUDE FROM PERFORMANCE
 * checkbox, and the 6 billing-bucket comboBoxes), but the open/save/history
 * flow is the same.
 *
 * Notes that apply to ALL specs using this helper:
 *
 * 1. **Save closes the dialog silently — no Success modal.** Wait for the
 *    "Managed Unmanaged Assets" heading (note: typo in source — "Managed",
 *    not "Manage") to disappear.
 * 2. **History parser requires a 2nd save before any rows appear.**
 *    `BillingSettingsHistoryParser.sortUnmanagedAccInstrumentHistoryById()`
 *    has a `grouped.size() > 1` gate. A pure Create alone produces 1 entry
 *    per instrument and is therefore skipped. To verify history rows for a
 *    Create, the spec must save twice (e.g. create + toggle a bucket).
 * 3. **Bucket combos use the same React-props onClick pattern as the
 *    icon-only combos in the Edit Account Billing Settings form,** with
 *    `#{key}_multiGroupDiv` instead of `#{key}Div`.
 * 4. **No UI delete for an Unmanaged Asset row.** Tests are idempotent —
 *    if AAPL is already in the grid (from a previous run) they reuse it.
 * 5. **Save button "outside viewport" trap.** The dialog body has an
 *    internal scroll container; Playwright's auto-scrollIntoView scrolls
 *    the page, not the dialog body. The save helper bypasses Playwright's
 *    actionability check by dispatching the click via element.click() in
 *    `evaluate`.
 */

const { expect } = require('@playwright/test');

/** The 6 billing-bucket combo keys (matches qa3 form `data-key`s). */
const BUCKET_KEYS = [
  'advisorExcludeCategoryCd',
  'platformExcludeCategoryCd',
  'mmExcludeCategoryCd',
  'internalAdvisorExcludeCategoryCd',
  'internalPlatformExcludeCategoryCd',
  'internalMmExcludeCategoryCd',
];

/** Each bucket key + the corresponding label that appears in the History grid. */
const BUCKET_HISTORY_LABELS = {
  advisorExcludeCategoryCd: 'Advisor',
  platformExcludeCategoryCd: 'Platform',
  mmExcludeCategoryCd: 'Money manager',
  internalAdvisorExcludeCategoryCd: 'Internal Advisor',
  internalPlatformExcludeCategoryCd: 'Internal Platform',
  internalMmExcludeCategoryCd: 'Internal Money manager',
};

/** Selector for the row's SYMBOL autocomplete `<input>` (the visible textbox). */
const SYMBOL_INPUT_SELECTOR = 'input[placeholder="Enter Instrument Symbol"]';

/**
 * The Manage UA dialog renders multiple rows under a `multiGroupGrid`. Each
 * row is wrapped in `<section id="unmanagedInstrumentsJSON_{index}" data-module="group">`,
 * but the inner field IDs (combo boxes, the EXCLUDE FROM PERFORMANCE checkbox)
 * are NOT indexed — they're literally identical across rows. To target a
 * specific row's combo, scope the locator to its row container.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex  zero-based row index
 */
function rowLocator(page, rowIndex) {
  return page.locator(`section[id="unmanagedInstrumentsJSON_${rowIndex}"]`);
}

/**
 * Open the Manage Unmanaged Assets dialog from the UA tab and wait for the
 * form to be ready.
 * @param {import('@playwright/test').Page} page
 */
async function openManageDialog(page) {
  await page.getByRole('button', { name: 'Manage Unmanaged Assets' }).click();
  await waitForManageDialogReady(page);
}

/**
 * Wait for the dialog heading and the first-row SYMBOL autocomplete to be
 * present.
 * @param {import('@playwright/test').Page} page
 */
async function waitForManageDialogReady(page) {
  await expect(page.getByText(/Managed Unmanaged Assets/i)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(SYMBOL_INPUT_SELECTOR).first()).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Drive the SYMBOL autocomplete (instrument picker) in the given multiGroup
 * row. The autocomplete renders rows with [role="option"] inside a listbox.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @param {string} symbol  e.g. "AAPL"
 * @param {string} optionText  partial description that uniquely identifies
 *   the desired row, e.g. "Apple Inc Ordinary Shares" or "Microsoft"
 */
async function pickInstrumentSymbol(page, rowIndex, symbol, optionText) {
  const input = rowLocator(page, rowIndex).locator(SYMBOL_INPUT_SELECTOR);
  await input.click();
  await input.pressSequentially(symbol);
  const option = page.locator('[role="option"]').filter({ hasText: optionText }).first();
  await expect(option).toBeVisible({ timeout: 5000 });
  await reactClick(option);
}

/**
 * Set one of the multiGroup row's bucket combos via React's onClick handler
 * and wait for the header text to commit. The combo IDs are NOT row-indexed
 * — both rows have the same `#advisorExcludeCategoryCd_multiGroupDiv`. The
 * helper scopes the locator to the given row container so the right combo
 * is targeted.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @param {string} bucketKey  e.g. "advisorExcludeCategoryCd"
 * @param {string} optionText  one of "All", "Managed", "Discretionary", "Unaffiliated Cash", "Unmanaged"
 */
async function setMultiGroupBucket(page, rowIndex, bucketKey, optionText) {
  // Both rows share the same `#${key}_multiGroupDiv` id (the form's id
  // generator does NOT include a row suffix). `page.locator('#id')` would
  // pick the first match — use a global `nth(rowIndex)` instead.
  const div = page.locator(`#${bucketKey}_multiGroupDiv`).nth(rowIndex);
  const option = page
    .locator('[role="combo-box-list-item"]')
    .filter({ hasText: new RegExp(`^${optionText}$`) })
    .first();
  const headerLocator = div.locator('header');

  // Both the combo OPEN and the option PICK occasionally drop their synthetic
  // onClick — especially right after a row was added or the parent re-rendered.
  // Wrap the whole open+pick+commit loop in a single expect.poll so any step
  // can retry until the header reflects the chosen optionText.
  await expect
    .poll(
      async () => {
        const headerText = (await headerLocator.textContent().catch(() => '')) || '';
        if (headerText.trim() === optionText) return optionText;

        // Open the combo if the option list isn't already visible.
        if (!(await option.isVisible().catch(() => false))) {
          await div.evaluate((el) => {
            /** @type {HTMLElement} */ (el).scrollIntoView({ block: 'center' });
            const k = Object.keys(el).find((kk) => kk.startsWith('__reactProps'));
            if (!k) throw new Error(`no react props on ${el.id}`);
            /** @type {any} */ (el)[k].onClick({
              target: el,
              currentTarget: el,
              preventDefault: () => {},
              stopPropagation: () => {},
              nativeEvent: new MouseEvent('click'),
            });
          });
          // Give React a tick to render the option list before clicking.
          await new Promise((r) => setTimeout(r, 50));
        }

        if (await option.isVisible().catch(() => false)) {
          await reactClick(option).catch(() => {});
        }

        return (await headerLocator.textContent().catch(() => '') || '').trim();
      },
      { timeout: 10_000, intervals: [200, 400, 800, 1_500] }
    )
    .toBe(optionText);
}

/**
 * Read the current text shown in a bucket combo's header.
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @param {string} bucketKey
 * @returns {Promise<string>}
 */
async function getMultiGroupBucket(page, rowIndex, bucketKey) {
  const text = await page
    .locator(`#${bucketKey}_multiGroupDiv`)
    .nth(rowIndex)
    .locator('header')
    .innerText();
  return text.trim();
}

/**
 * Toggle the EXCLUDE FROM PERFORMANCE checkbox for a specific row. The
 * checkbox input id is `excludeFromPerformance_multiGroupField` and is
 * NOT row-indexed — same id is reused per row, so the locator is scoped
 * to the row container.
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 */
async function toggleExcludeFromPerformance(page, rowIndex) {
  // FormBuilder's Checkbox renders three clickable areas (Checkbox.js:200-225):
  //   1. wrapper <div data-type="fieldWrapper" onClick={onClick}>  (default no-op)
  //   2. <label data-type="icon"><Icon onClick={updateCheckBoxState} />  ← bound to THIS row
  //   3. <label htmlFor={checkboxId}>  ← duplicate-id collision: hits row 0
  //
  // Click the icon-label scoped to this row. The icon-label has no
  // `htmlFor`, so the duplicate `excludeFromPerformance_multiGroupField` id
  // shared across rows does NOT mis-resolve. The Icon child's React onClick
  // is `updateCheckBoxState` bound to this row's Checkbox instance.
  await rowLocator(page, rowIndex)
    .locator('label[data-type="icon"]')
    .first()
    .click();
  // MultiGroupGrid.updateMultiGroupGridState is debounced (MultiGroupGrid.js:219).
  // Several setState callbacks chain (Checkbox.setCheckboxValue → updateFormState
  // → MultiGroupGrid.updateListItemConfig → debounced updateMultiGroupGridState
  // → calcTotalWeight → outer updateFormState). Give the chain enough time
  // before the next save click reads form state.
  await page.waitForTimeout(500);
}

/**
 * Read whether the row's EXCLUDE FROM PERFORMANCE checkbox is checked.
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @returns {Promise<boolean>}
 */
async function getExcludeFromPerformance(page, rowIndex) {
  return await page
    .locator('#excludeFromPerformance_multiGroupField')
    .nth(rowIndex)
    .evaluate((el) => /** @type {HTMLInputElement} */ (el).checked);
}

/**
 * Click the Save button in the Manage UA dialog and wait for it to close.
 * @param {import('@playwright/test').Page} page
 */
async function saveManageDialog(page) {
  const save = page.getByRole('button', { name: 'Save', exact: true }).last();
  await expect(save).toBeEnabled({ timeout: 10_000 });
  // The dialog body has an internal scroll container — Playwright's
  // .click() (even with force:true) refuses "Element is outside of the
  // viewport" because Playwright clicks via page coordinates, and the dialog's
  // own scroll doesn't move the page viewport. Dispatch the click via JS
  // inside an evaluate, which bypasses Playwright's coordinate-based click
  // entirely and goes through the button's React onClick handler.
  await save.evaluate((el) => {
    /** @type {HTMLElement} */ (el).scrollIntoView({ block: 'center' });
    /** @type {HTMLElement} */ (el).click();
  });
  await expect(page.getByText(/Managed Unmanaged Assets/i)).toBeHidden({
    timeout: 15_000,
  });
}

/**
 * Open the Account Unmanaged Assets History modal (separate from the Manage
 * dialog). The modal is opened by the History button on the UA tab.
 * @param {import('@playwright/test').Page} page
 */
async function openHistoryModal(page) {
  // The History button can be intercepted by the form-loader overlay that
  // lingers after a recent save (seen in C25209 Update flow). Retry the click
  // until the History modal actually opens, instead of relying on a single
  // click + visibility wait.
  const historyBtn = page.getByRole('button', { name: 'History', exact: true });
  const historyHeading = page.getByText(/Account Unmanaged Assets History/i);
  await expect
    .poll(
      async () => {
        if (await historyHeading.isVisible().catch(() => false)) return true;
        await historyBtn.click({ timeout: 2_000 }).catch(() => {});
        return historyHeading.isVisible().catch(() => false);
      },
      { timeout: 20_000, intervals: [500, 1_000, 2_000] }
    )
    .toBe(true);
}

/**
 * Close the History modal.
 * @param {import('@playwright/test').Page} page
 */
async function closeHistoryModal(page) {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

/**
 * Find the row index of an existing instrument by its symbol/description.
 * Reads each visible row's SYMBOL textbox value and returns the first index
 * whose value matches the regex. Returns -1 if not found.
 *
 * Useful for tests that need to operate on a specific instrument that may
 * be in any row (e.g. C25207 update on AAPL row when MSFT was added by C25206).
 *
 * @param {import('@playwright/test').Page} page
 * @param {RegExp} pattern  e.g. /AAPL|Apple Inc/i
 * @returns {Promise<number>}
 */
async function findRowIndexBySymbol(page, pattern) {
  const inputs = page.locator(SYMBOL_INPUT_SELECTOR);
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const v = await inputs.nth(i).inputValue();
    if (pattern.test(v)) return i;
  }
  return -1;
}

/**
 * Click the "Add New Row" button to append an empty multiGroup row.
 * @param {import('@playwright/test').Page} page
 */
async function addNewRow(page) {
  await page.getByRole('button', { name: 'Add New Row' }).click();
}

/**
 * Internal: invoke an element's React onClick handler directly. Falls back
 * to a regular DOM click if the element has no react props (rare but happens
 * for portal-rendered list items).
 * @param {import('@playwright/test').Locator} loc
 */
async function reactClick(loc) {
  await loc.evaluate((el) => {
    const k = Object.keys(el).find((kk) => kk.startsWith('__reactProps'));
    if (k) {
      /** @type {any} */ (el)[k].onClick({
        target: el,
        currentTarget: el,
        preventDefault: () => {},
        stopPropagation: () => {},
        nativeEvent: new MouseEvent('click'),
      });
    } else {
      /** @type {HTMLElement} */ (el).click();
    }
  });
}

/**
 * Resolve a row in the Account Unmanaged Assets History grid by name regex,
 * scrolling the ag-grid viewport until the row is rendered into the DOM.
 *
 * Why: the History modal is a React portal containing an ag-Grid Enterprise
 * grid with a virtualised body — only the windowed range is in the DOM, so
 * `getByRole('row', { name })` against rows below the fold returns nothing.
 * Target `#accountUnmanagedAssetsHistory` (the GwGrid wrapper id from
 * UnmanagedAssetsSettingsHistoryModal.js) and page its `.ag-body-viewport`
 * down until the row appears (or scrolling no longer advances).
 *
 * @param {import('@playwright/test').Page} page
 * @param {RegExp} nameRegex  matches the row's accessible name
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<import('@playwright/test').Locator>} the resolved row
 */
async function findHistoryRow(page, nameRegex, { timeout = 15_000 } = {}) {
  // The History grid is ag-Grid Enterprise rendered inside a React portal
  // modal — `<div id="accountUnmanagedAssetsHistory" role="grid">` is the
  // wrapper, with `.ag-body-viewport` as its scrollable body. Targeting by
  // this id avoids the underlying Manage UA grid (also ag-grid) entirely.
  const grid = page.locator('#accountUnmanagedAssetsHistory');
  await grid.waitFor({ state: 'attached', timeout: 5_000 });

  // Wait for ag-grid to finish loading rows. Service-driven grids start with
  // just the header rendered; running scroll logic before data lands gives a
  // misleading "empty grid" snapshot.
  await expect
    .poll(async () => await grid.locator('[role="row"]').count(), {
      timeout: 10_000,
      intervals: [200, 500, 1_000],
    })
    .toBeGreaterThan(2);

  const target = grid.getByRole('row', { name: nameRegex }).first();
  if (await target.isVisible().catch(() => false)) return target;

  const viewport = await grid
    .locator('.ag-body-viewport')
    .first()
    .elementHandle({ timeout: 3_000 })
    .catch(() => null);

  if (!viewport) {
    // Fall back to wheel-over-row in case ag-grid's class isn't exposed.
    const bodyRow = grid.getByRole('row').nth(1);
    const box = await bodyRow.boundingBox();
    if (!box) {
      await expect(target).toBeVisible({ timeout: 2_000 });
      return target;
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const deadline = Date.now() + timeout;
    let lastFirst = '';
    let stuck = 0;
    while (Date.now() < deadline) {
      if (await target.isVisible().catch(() => false)) return target;
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(200);
      const cur = await bodyRow.textContent({ timeout: 1_000 }).catch(() => '');
      if (cur && cur === lastFirst) {
        stuck += 1;
        if (stuck >= 2) break;
      } else {
        stuck = 0;
        lastFirst = cur || '';
      }
    }
    await expect(target).toBeVisible({ timeout: 2_000 });
    return target;
  }

  const deadline = Date.now() + timeout;
  let lastScrollTop = -1;
  while (Date.now() < deadline) {
    if (await target.isVisible().catch(() => false)) return target;
    const state = await viewport.evaluate((el) => {
      const next = Math.min(el.scrollHeight, el.scrollTop + el.clientHeight);
      el.scrollTop = next;
      return {
        scrollTop: el.scrollTop,
        atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
      };
    });
    if (state.scrollTop === lastScrollTop) break;
    lastScrollTop = state.scrollTop;
    await page.waitForTimeout(200);
    if (state.atBottom) {
      if (await target.isVisible().catch(() => false)) return target;
      break;
    }
  }
  await expect(target).toBeVisible({ timeout: 2_000 });
  return target;
}

module.exports = {
  BUCKET_KEYS,
  BUCKET_HISTORY_LABELS,
  SYMBOL_INPUT_SELECTOR,
  rowLocator,
  openManageDialog,
  waitForManageDialogReady,
  pickInstrumentSymbol,
  setMultiGroupBucket,
  getMultiGroupBucket,
  toggleExcludeFromPerformance,
  getExcludeFromPerformance,
  saveManageDialog,
  openHistoryModal,
  closeHistoryModal,
  findRowIndexBySymbol,
  addNewRow,
  findHistoryRow,
};
