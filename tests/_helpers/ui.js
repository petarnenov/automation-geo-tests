// @ts-check
/**
 * Generic qa3/qa2 UI widget primitives.
 *
 * The qa3 frontend mixes a few non-standard input widgets that don't respond to
 * Playwright's default fill/click flows: react-date-picker, the in-house
 * `comboBoxContainer` (typeAhead + icon-only variants), React controlled
 * numeric inputs, and ag-grid `singleClickEdit` cells with rich-select editors.
 *
 * Each helper here was extracted from a working spec — see the originating
 * file/comment for the live verification context. Keep this surface small:
 * one helper per real-world quirk, no speculative options.
 *
 *   originally lived in:
 *   - setReactDatePicker / setComboBoxValue / setReactNumericInput
 *       → tests/account-billing/_helpers.js (verified live 2026-04-07 on the
 *         Edit Account Billing Settings modal)
 *   - activateAgGridCell / setAgGridText / setAgGridRichSelect / setAgGridDate
 *       → tests/create-account/C24940.spec.js (Platform One Create Account grid)
 */

const { expect } = require('@playwright/test');

// ───────────────────────────── react-date-picker ─────────────────────────────

/**
 * Set a react-date-picker by opening its calendar popup and clicking the day
 * cell. Filling the spinbuttons or hidden input does NOT commit through React's
 * controlled state — only the popup day click fires the onChange that Save
 * picks up.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} pickerSection  the wrapping <section> (e.g. page.locator('#billingInceptionDate'))
 * @param {string} mmddyyyy  e.g. "02/14/2025"
 */
async function setReactDatePicker(page, pickerSection, mmddyyyy) {
  const [m, d, y] = mmddyyyy.split('/').map((v) => parseInt(v, 10));
  const targetDate = new Date(Date.UTC(y, m - 1, d));
  const targetLabel = targetDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const targetMonthYear = targetDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // Some pickers (esp. ones whose section was just re-enabled by a combo
  // change) silently swallow .click() because their React onClick hasn't
  // re-attached yet. Dispatch a full mousedown/mouseup/click sequence and
  // retry until the popup actually appears.
  const calendarBtn = pickerSection.locator(
    'button.react-date-picker__calendar-button'
  );
  const calendar = page.locator('.react-calendar');
  for (let attempt = 0; attempt < 10; attempt++) {
    await calendarBtn.evaluate((btn) => {
      /** @type {HTMLElement} */ (btn).scrollIntoView({ block: 'center' });
      /** @type {HTMLElement} */ (btn).focus();
      for (const t of ['mousedown', 'mouseup', 'click']) {
        btn.dispatchEvent(
          new MouseEvent(t, { bubbles: true, cancelable: true, view: window })
        );
      }
    });
    if (await calendar.isVisible().catch(() => false)) break;
    await page.waitForTimeout(200);
  }
  await expect(calendar).toBeVisible({ timeout: 5000 });

  // Read the displayed month from the calendar header — when the picker has
  // no value, the spinbuttons are empty but the calendar opens at today.
  const navLabel = page.locator('.react-calendar__navigation__label').first();
  const parseMonthYear = (s) => {
    const dt = new Date(`${s} 1 UTC`);
    return { m: dt.getUTCMonth() + 1, y: dt.getUTCFullYear() };
  };

  let displayed = (await navLabel.textContent())?.trim() || '';
  for (let safety = 0; safety < 240; safety++) {
    if (displayed === targetMonthYear) break;
    const cur = parseMonthYear(displayed);
    const monthsDiff = (y - cur.y) * 12 + (m - cur.m);
    const btn =
      monthsDiff < 0
        ? '.react-calendar__navigation__prev-button'
        : '.react-calendar__navigation__next-button';
    await page.locator(btn).click();
    displayed = (await navLabel.textContent())?.trim() || '';
  }
  if (displayed !== targetMonthYear) {
    throw new Error(
      `calendar nav stuck at ${displayed}, target ${targetMonthYear}`
    );
  }

  await page
    .locator(`.react-calendar abbr[aria-label="${targetLabel}"]`)
    .click();
  await expect(page.locator('.react-calendar')).toBeHidden({ timeout: 5000 });
}

// ───────────────────────────── comboBoxContainer ─────────────────────────────

/**
 * Set a qa3 comboBox field. The widget is NOT a native <select> — it's a
 * `data-module="comboBoxContainer"` div with two variants:
 *
 *   1. typeAhead variant — has `<input id="{key}_typeAhead">`. Type to filter,
 *      click the matching `[role="combo-box-list-item"]`.
 *   2. icon-only variant (Adjustment Type, Commission Fee, etc.) — no input,
 *      Playwright `.click()` lands on <body>. Workaround: invoke the React
 *      onClick handler attached to the container div via `__reactProps$xxx`.
 *
 * Both paths verified live 2026-04-07 on the Edit Account Billing Settings modal.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} fieldKey  data-key on the comboBox section
 *   (e.g. "adviserBillingSpecification" or "adviserBillingDiscountType")
 * @param {string} optionText  EXACT visible text of the desired option
 */
async function setComboBoxValue(page, fieldKey, optionText) {
  const hasTypeAhead = await page
    .locator(`#${fieldKey}_typeAhead`)
    .count()
    .then((n) => n > 0);

  if (hasTypeAhead) {
    const typeAhead = page.locator(`#${fieldKey}_typeAhead`);
    await typeAhead.evaluate((el) => {
      /** @type {HTMLInputElement} */ (el).focus();
      /** @type {HTMLInputElement} */ (el).select();
    });
    for (let i = 0; i < 80; i++) await typeAhead.press('Backspace');
    // Type only the first word — typing the full label can over-filter when
    // the label contains punctuation the typeAhead matches differently.
    const filterPrefix = optionText.split(/\s/)[0] || optionText.slice(0, 3);
    await typeAhead.pressSequentially(filterPrefix);
    const option = page.locator(
      `[role="combo-box-list-item"]:text-is("${optionText.replace(/"/g, '\\"')}")`
    );
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.evaluate((el) => /** @type {HTMLElement} */ (el).click());
    return;
  }

  // Icon-only variant: drive React props directly.
  await page.locator(`#${fieldKey}Div`).evaluate((div) => {
    const key = Object.keys(div).find((k) => k.startsWith('__reactProps'));
    if (!key) throw new Error('comboBox container has no react props');
    const props = /** @type {any} */ (div)[key];
    props.onClick({
      target: div,
      currentTarget: div,
      preventDefault: () => {},
      stopPropagation: () => {},
      nativeEvent: new MouseEvent('click'),
    });
  });
  const option = page.locator(
    `[role="combo-box-list-item"]:text-is("${optionText.replace(/"/g, '\\"')}")`
  );
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.evaluate((el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
    if (key) {
      /** @type {any} */ (el)[key].onClick({
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

// ─────────────────────────── React controlled inputs ─────────────────────────

/**
 * Set a numeric input by id, dispatching React-compatible input/change events.
 * Use this for fields that ignore Playwright's `fill()` because they're wired
 * through React's controlled-component value setter.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} inputId
 * @param {string} value
 */
async function setReactNumericInput(page, inputId, value) {
  await page.locator(`#${inputId}`).evaluate((el, v) => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

// ────────────────────────── firm typeAhead picker ───────────────────────────

/**
 * Select a firm via the qa3 firm picker comboBox (`#firmCd_typeAhead`).
 *
 * Identical body was inlined in 6 create-account specs (C24940, C24943, C24996,
 * C24997, C25065, C25102). The only meaningful difference between them was the
 * post-selection assertion — some asserted on the typeAhead input value, others
 * waited for a firm-dependent button to enable. Both modes are exposed here.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{firmCd: number, firmName: string}} workerFirm
 * @param {object} [options]
 * @param {'typeAheadValue' | 'bulkUploadButton' | 'none'} [options.confirm]
 *   How to assert the selection landed:
 *   - 'typeAheadValue' (default) — assert the input contains `(firmCd)`. Fast,
 *     but unreliable after a form reset (the wrapper generic is not updated).
 *   - 'bulkUploadButton' — wait for the "Open multiple accounts in bulk" button
 *     to be enabled. Slower but the strongest real signal that firm-dependent
 *     UI activated.
 *   - 'none' — caller will assert separately.
 */
async function selectFirmInTypeAhead(page, workerFirm, options = {}) {
  const confirm = options.confirm || 'typeAheadValue';
  const ta = page.locator('#firmCd_typeAhead');
  await ta.evaluate((el) => {
    /** @type {HTMLInputElement} */ (el).focus();
    /** @type {HTMLInputElement} */ (el).select();
  });
  for (let i = 0; i < 80; i++) await ta.press('Backspace');
  await ta.pressSequentially(workerFirm.firmName);
  const option = page
    .locator('[role="combo-box-list-item"]')
    .filter({ hasText: new RegExp(`\\(${workerFirm.firmCd}\\)`) })
    .first();
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.evaluate((el) => /** @type {HTMLElement} */ (el).click());

  if (confirm === 'typeAheadValue') {
    await expect(ta).toHaveValue(new RegExp(`\\(${workerFirm.firmCd}\\)`), {
      timeout: 5000,
    });
  } else if (confirm === 'bulkUploadButton') {
    await expect(
      page.getByRole('button', { name: 'Open multiple accounts in bulk' })
    ).toBeEnabled({ timeout: 5000 });
  }
}

// ──────────────────────── validation error regex factory ─────────────────────

/**
 * Build the standard "validation error visible on page" regex used by the
 * upload-validation specs. The base set of tokens covers the messages every
 * upload form surfaces; pass extra tokens for upload-specific words (e.g.
 * `'empty', 'combination'` for billing buckets).
 *
 * Originally inlined as `ERROR_RX` in:
 *   - tests/unmanaged-assets/_helpers.js
 *   - tests/bucket-exclusions/C25793.spec.js
 *   - tests/bucket-exclusions/validation/C25378.spec.js
 *   - tests/bucket-exclusions/validation/C25380.spec.js
 *
 * @param {...string} extraTokens  additional alternation members
 * @returns {RegExp}
 */
function validationErrorRegex(...extraTokens) {
  const base = [
    'error',
    'invalid',
    'required',
    'missing',
    'wrong',
    'must',
    'cannot',
    'failed',
  ];
  return new RegExp([...base, ...extraTokens].join('|'), 'i');
}

// ────────────────────────────────── ag-grid ──────────────────────────────────

/**
 * Click an ag-grid cell to activate its editor. With `singleClickEdit: true`
 * a single click puts the cell into `ag-cell-inline-editing` mode.
 * Returns the cell locator for chained assertions.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @param {string} colId
 */
async function activateAgGridCell(page, rowIndex, colId) {
  const cell = page.locator(
    `.ag-row[row-index="${rowIndex}"] [role="gridcell"][col-id="${colId}"]`
  );
  await cell.scrollIntoViewIfNeeded();
  await cell.click({ force: true });
  await expect(cell).toHaveClass(/ag-cell-inline-editing/, { timeout: 5000 });
  return cell;
}

/**
 * Fill a plain ag-grid text cell.
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @param {string} colId
 * @param {string} value
 */
async function setAgGridText(page, rowIndex, colId, value) {
  await activateAgGridCell(page, rowIndex, colId);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(value);
  await page.keyboard.press('Tab');
}

/**
 * Fill an ag-grid rich-select cell. Relies on `allowTyping: true` + `filterList`
 * (verified for the Platform One Create Account grid). Types the filter and
 * presses Enter to commit the first match.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @param {string} colId
 * @param {string} optionText
 */
async function setAgGridRichSelect(page, rowIndex, colId, optionText) {
  await activateAgGridCell(page, rowIndex, colId);
  await page.keyboard.type(optionText);
  const firstOption = page
    .locator('.ag-rich-select-virtual-list-viewport .ag-virtual-list-item')
    .first();
  await expect(firstOption).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Enter');
  const cell = page.locator(
    `.ag-row[row-index="${rowIndex}"] [role="gridcell"][col-id="${colId}"]`
  );
  await expect(cell).toContainText(optionText, { timeout: 5000 });
}

/**
 * Fill an ag-grid `agDateStringCellEditor` cell — a plain text input that
 * accepts MM/DD/YYYY.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @param {string} colId
 * @param {string} mmddyyyy
 */
async function setAgGridDate(page, rowIndex, colId, mmddyyyy) {
  await activateAgGridCell(page, rowIndex, colId);
  await page.keyboard.type(mmddyyyy);
  await page.keyboard.press('Tab');
}

/**
 * Pick the first option from an ag-grid rich-select cell. Used when the valid
 * options vary per parent-cell value (e.g. Default Money depends on custodian)
 * and a hardcoded name is brittle. Returns the chosen text.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @param {string} colId
 */
async function pickFirstAgGridRichSelect(page, rowIndex, colId) {
  await activateAgGridCell(page, rowIndex, colId);
  const firstOption = page
    .locator('.ag-rich-select-virtual-list-viewport .ag-virtual-list-item')
    .first();
  await expect(firstOption).toBeVisible({ timeout: 5000 });
  const text = (await firstOption.innerText()).trim();
  // Pressing Enter without first typing/highlighting doesn't commit — click
  // the option directly.
  await firstOption.click();
  const cell = page.locator(
    `.ag-row[row-index="${rowIndex}"] [role="gridcell"][col-id="${colId}"]`
  );
  await expect(cell).toContainText(text, { timeout: 5000 });
  return text;
}

module.exports = {
  setReactDatePicker,
  setComboBoxValue,
  setReactNumericInput,
  selectFirmInTypeAhead,
  validationErrorRegex,
  activateAgGridCell,
  setAgGridText,
  setAgGridRichSelect,
  setAgGridDate,
  pickFirstAgGridRichSelect,
};
