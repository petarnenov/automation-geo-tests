// @ts-check
/**
 * TestRail C24941 — Open new account through Platform One - UI elements
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24941 (Run 175, label Pepi)
 *
 * Smoke test for the Platform One → Operations → Create Account page. Walks
 * the page's main UI affordances and asserts the expected dropdowns/buttons
 * are present and populated. Does NOT actually create any accounts.
 *
 * Steps (mirrors TestRail):
 *   1. Load the Create Account page → assert title "Single/Multiple Account
 *      Creation" and the firm picker is present
 *   2. Open the firm typeAhead, type "Firm-" to filter to dummy firms,
 *      assert the dropdown opens with at least one option, then pick the
 *      worker's own dummy firm
 *   3. After firm is selected → assert "Open multiple accounts in bulk"
 *      button + "Add New Row" + "Reset" + "Create" buttons are present
 *   4. Click "Add New Row" → assert a new row appears in the grid
 *   5. Click the row's Account Type cell → assert ag-rich-select opens with
 *      the expected account type options (a sample of the long list)
 *   6. Click the row's Custodian cell → assert the rich-select opens with
 *      the expected custodian options
 *   7. Click the row's Default Money cell → assert the rich-select opens
 *
 * Implementation notes:
 *   - The Create Account grid is an ag-grid with `ag-rich-select` cell
 *     editors (NOT the qa2 form's custom comboBoxContainer). Editors are
 *     activated by clicking the cell; the dropdown options are
 *     `.ag-list-item` elements inside `.ag-rich-select-virtual-list-viewport`,
 *     virtualized so only ~16 are rendered at a time.
 *   - The Firm picker IS a custom comboBox (`section[data-key="firmCd"]`,
 *     module=comboBox, with a `#firmCd_typeAhead` input) — same pattern the
 *     account-billing helpers handle.
 *   - We use the workerFirm fixture so the firm picker lands on a
 *     deterministic value, but the test does NOT mutate the firm in any way.
 *     A non-isolated firm would also work; this just keeps things
 *     consistent with the rest of the create-account suite.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const CREATE_ACCOUNT_URL =
  '/react/indexReact.do#platformOne/backOffice/createAccount';

// A small, ordered subset of the TestRail expected list — picking a few
// distinctive types confirms the dropdown is populated without making the
// assertion brittle to nomenclature reorderings.
// Limited to options that fit in the rich-select's first virtualization batch
// (~8 items). Roth IRA / SEP IRA / 401(k) etc. live further down the list and
// would require scrolling the virtualized viewport — overkill for a smoke test.
const EXPECTED_ACCOUNT_TYPES_SAMPLE = [
  'Unknown',
  'Individual Taxable',
  'Joint Account (with right of survivorship)',
  'UTMA',
  'Rollover Roth IRA',
];

// Same first-batch caveat as EXPECTED_ACCOUNT_TYPES_SAMPLE — Charles Schwab,
// Fidelity and Pershing are further down the alphabetized list and only render
// after scrolling. The smoke test just confirms the dropdown is populated with
// real custodian names.
const EXPECTED_CUSTODIANS_SAMPLE = [
  'Alternatives',
  'Interactive Brokers',
  'Goldman Sachs',
  'Folio Institutional',
  'Raymond James',
];

/**
 * Open the firm comboBox typeAhead, type a filter, then click the first
 * option that appears. The qa2 firm dropdown is paginated server-side and
 * only returns the first ~20 matches per query, so picking a SPECIFIC firm
 * by id requires a tightly-scoped filter — not worth it for a UI smoke test
 * that doesn't mutate firm state. We just need any firm so the page
 * activates.
 *
 * @param {import('@playwright/test').Page} page
 */
async function selectAnyFirm(page) {
  const ta = page.locator('#firmCd_typeAhead');
  await ta.evaluate((el) => {
    /** @type {HTMLInputElement} */ (el).focus();
    /** @type {HTMLInputElement} */ (el).select();
  });
  for (let i = 0; i < 80; i++) await ta.press('Backspace');
  // "Firm-" reliably surfaces dummy firms (which always exist on qa2 because
  // they accumulate by design — see project_apple_global_instrument memory).
  // Any other prefix that returns >0 options would also work.
  await ta.pressSequentially('Firm-');
  const firstOption = page.locator('[role="combo-box-list-item"]').first();
  await expect(firstOption).toBeVisible({ timeout: 5000 });
  const pickedText = (await firstOption.innerText()).trim();
  await firstOption.evaluate((el) => /** @type {HTMLElement} */ (el).click());
  // The picked value should appear in the combo's typeAhead input.
  await expect(ta).toHaveValue(pickedText, { timeout: 5000 });
  return pickedText;
}

/**
 * Activate an ag-grid rich-select cell editor and wait for the option list
 * to render. The Create Account grid has `singleClickEdit: true` (verified
 * in source: `pages/_helpers/index.js`), so a single click on the cell's
 * `.ag-cell-value` inner div opens the editor. Playwright's plain
 * `cell.click()` sometimes resolves to a child of the gridcell that doesn't
 * trigger ag-grid's click handler — `force: true` with an explicit centre
 * position is more reliable.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex
 * @param {string} colId
 */
async function openRowCellEditor(page, rowIndex, colId) {
  const cell = page.locator(
    `.ag-row[row-index="${rowIndex}"] [role="gridcell"][col-id="${colId}"]`
  );
  await cell.scrollIntoViewIfNeeded();
  await cell.click({ force: true });
  const options = page
    .locator('.ag-rich-select-virtual-list-viewport .ag-virtual-list-item')
    .first();
  if (await options.isVisible().catch(() => false)) return;
  // Fallback: dispatch the click via the React props of the inner cell-value
  // div directly. ag-grid attaches its click listener at the body level via
  // event delegation, so a synthetic event on the inner div bubbles up.
  await cell.evaluate((el) => {
    /** @type {HTMLElement} */ (el).click();
  });
  if (await options.isVisible().catch(() => false)) return;
  await page.keyboard.press('Enter');
  await expect(options).toBeVisible({ timeout: 5000 });
}

/**
 * Read the visible (rendered) options of the open ag-rich-select dropdown.
 * Only ~16 are in the DOM at a time due to virtualization, so callers must
 * either scroll the list or limit assertions to options near the top.
 */
async function getVisibleRichSelectOptions(page) {
  return await page
    .locator('.ag-rich-select-virtual-list-viewport .ag-virtual-list-item')
    .allInnerTexts();
}

test('@pepi C24941 Open Account UI elements', async ({ page }) => {
  test.setTimeout(180_000);

  await test.step('Load Create Account page as Platform One admin', async () => {
    await loginPlatformOneAdmin(page);
    await page.goto(CREATE_ACCOUNT_URL);
    await expect(
      page.getByRole('heading', { name: 'Single/Multiple Account Creation' })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#firmCd_typeAhead')).toBeVisible();
  });

  await test.step('Open firm picker, filter to dummy firms, select the first match', async () => {
    await selectAnyFirm(page);
  });

  await test.step('Firm-dependent UI activates: bulk button, Add New Row, Reset, Create', async () => {
    await expect(
      page.getByRole('button', { name: 'Open multiple accounts in bulk' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add New Row' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();
  });

  await test.step('Click Add New Row, assert a new row appears in the grid', async () => {
    await page.getByRole('button', { name: 'Add New Row' }).click();
    await expect(
      page.locator('.ag-row[row-index="0"]')
    ).toBeVisible({ timeout: 5000 });
  });

  await test.step('Account Type cell opens with the expected options', async () => {
    await openRowCellEditor(page, 0, 'accountTypeCd');
    const options = await getVisibleRichSelectOptions(page);
    for (const expected of EXPECTED_ACCOUNT_TYPES_SAMPLE) {
      expect(
        options,
        `Account Type dropdown should contain "${expected}"`
      ).toContain(expected);
    }
    await page.keyboard.press('Escape');
  });

  await test.step('Custodian cell opens with the expected options', async () => {
    await openRowCellEditor(page, 0, 'eBrokerCd');
    const options = await getVisibleRichSelectOptions(page);
    for (const expected of EXPECTED_CUSTODIANS_SAMPLE) {
      expect(
        options,
        `Custodian dropdown should contain "${expected}"`
      ).toContain(expected);
    }
    await page.keyboard.press('Escape');
  });

  await test.step('Default Money cell opens with at least one option', async () => {
    await openRowCellEditor(page, 0, 'defaultMoneyOptionId');
    const options = await getVisibleRichSelectOptions(page);
    expect(options.length, 'Default Money dropdown should be populated').toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  });
});
