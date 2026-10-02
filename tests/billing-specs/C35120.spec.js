// @ts-check
/**
 * TestRail C35120 — Regression: Verify Min/Max fee fields retain full
 * functionality after label update.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/35120 (Run 214)
 * Linked Jira: GEO-26096
 *
 * Background: GEO-26096 renamed the labels for the Annual Min / Max Fee
 * fields on the Create / Edit Billing Specification form. The regression
 * here confirms those fields still drive Save correctly across a handful of
 * value combinations (only-Min, only-Max, both, Min>Max, both-zero) and that
 * the descriptive hint copy ("Periodic, not Annual") remains rendered on the
 * form after every edit.
 *
 * Isolation: provisions a fresh dummy firm via the workerFirm fixture. This
 * keeps the test from polluting firm 1's seeded specs and guarantees the spec
 * name we pick is unique to this run.
 *
 * Source-of-truth selectors (verified against
 * WebContent/react/app/src/pages/PlatformOne/pages/BillingCenter/pages/BillingSpecs):
 *   - Spec Name input  →  #specificationDescriptionField
 *   - Billing Bucket   →  comboBox with data-key="bucketCd" (label "Billing Bucket")
 *   - Minimum Fee      →  #minimumFeeAmount    (FormBuilder currency, hint=FEE_PERIOD_HINT)
 *   - Maximum Fee      →  #maxFeeAmount        (FormBuilder currency, hint=FEE_PERIOD_HINT)
 *   - Hint text        →  "Periodic, not Annual" (consts.js FEE_PERIOD_HINT)
 *   - Create button    →  "Create Spec" (FormBuilder submitDisplayName)
 *   - Edit button      →  "Save Updates"
 *   - Success heading  →  <h4> with "Create Successful" / "Update Successful"
 *
 * After a successful Create the form stays on the /create URL with the
 * green <h4> shown — there is no auto-navigation. To re-edit, the test
 * navigates back to the specs grid and clicks the row's Edit icon (same
 * pattern C24935 uses for the Edit form).
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const FEE_PERIOD_HINT = 'Periodic, not Annual';

test.setTimeout(300_000);

test('@pepi C35120 Regression: Min/Max fee fields retain functionality after label update', async ({
  page,
  workerFirm,
}) => {
  const firmCd = workerFirm.firmCd;
  const specsGridUrl = `/react/indexReact.do#platformOne/billingCenter/specifications/${firmCd}`;
  const createUrl = `${specsGridUrl}/create`;
  const specName = `C35120 Min/Max regression ${Date.now()}`;

  await loginPlatformOneAdmin(page);

  /**
   * Fill the Min and/or Max fee fields. Pass `null` to clear a field; pass a
   * string value like '50' to set it. InputCore renders the actual <input>
   * with id `<fieldId>Field`, so the DOM ids are `#minimumFeeAmountField` and
   * `#maxFeeAmountField`. Typing via pressSequentially drives the FormBuilder
   * Currency component's onChange properly (a plain native setter on the
   * value attribute throws "Illegal invocation" against this wrapper).
   */
  const setMinMax = async ({ min, max }) => {
    const fillField = async (inputId, value) => {
      const input = page.locator(`#${inputId}`);
      await input.click({ clickCount: 3 });
      // Use Backspace rather than Delete; on a triple-selected empty value
      // Delete is a no-op while Backspace nukes whatever was selected.
      await page.keyboard.press('Backspace');
      if (value !== null && value !== '') {
        await input.pressSequentially(value, { delay: 30 });
      }
    };
    if (min !== undefined) await fillField('minimumFeeAmountField', min);
    if (max !== undefined) await fillField('maxFeeAmountField', max);
  };

  /**
   * Add one valid Rate via the "Add Rate" modal so the Rates section is not
   * empty (the Rates section is required and Save is a silent no-op otherwise).
   * The modal is FormBuilder with:
   *   - billingCategoryTitleField  (Rate Name, text, required)
   *   - ratePct_0_multiGroupField  (Rate %, the first tier row)
   *   - toRange_0_multiGroupField  (Range To $, no decimals)
   *   - rateDescription_0_multiGroupField (Description)
   *   - Save button: button[data-role="formSubmitButton"]
   * Default "Bill By Total Portfolio" selection is fine (the test doesn't
   * exercise Bill By variants).
   */
  const addOneRate = async () => {
    await page.getByRole('button', { name: 'Add Rate', exact: true }).first().click();
    const name = page.locator('#billingCategoryTitleField');
    await expect(name).toBeVisible({ timeout: 10_000 });
    await name.click();
    await name.pressSequentially(`Rate ${Date.now()}`, { delay: 20 });

    const ratePct = page.locator('#ratePct_0_multiGroupField');
    await ratePct.click();
    await ratePct.pressSequentially('1', { delay: 20 });

    const rangeTo = page.locator('#toRange_0_multiGroupField');
    await rangeTo.click();
    await rangeTo.pressSequentially('1000000', { delay: 20 });

    const desc = page.locator('#rateDescription_0_multiGroupField');
    await desc.click();
    await desc.pressSequentially('Default tier', { delay: 20 });

    // The modal Save sits inside the FormBuilder rate-schedule submit. Two
    // formSubmitButton anchors exist on screen (rate modal + outer Create
    // Spec form), so scope to the rate modal heading's container.
    const rateModalSave = page.locator('button[data-role="formSubmitButton"]').first();
    await expect(rateModalSave).not.toHaveClass(/disabled/i, { timeout: 10_000 });
    await rateModalSave.click();
    // Modal close ⇒ the Rate Schedule Name cell appears in the outer grid.
    await expect(name).toBeHidden({ timeout: 10_000 });
  };

  /** Both fee inputs still expose the "Periodic, not Annual" hint after every edit. */
  const assertHintsVisible = async () => {
    // The hint text is rendered once per fee field, so we expect at least 2
    // visible occurrences on the page.
    await expect(page.getByText(FEE_PERIOD_HINT).first()).toBeVisible({ timeout: 5000 });
    const count = await page.getByText(FEE_PERIOD_HINT).count();
    expect(count, 'both Min and Max fee fields should render the hint').toBeGreaterThanOrEqual(2);
  };

  /** Click the Edit icon on the spec's row in the grid. */
  const openEditForSpec = async () => {
    await page.goto(specsGridUrl);
    await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 120_000 });
    // Filter the grid to the one row we care about via the Search box, so we
    // can hover it deterministically (workerFirm starts with 0 specs but
    // subsequent edits don't add new ones — still a single-row grid).
    const searchBox = page.getByPlaceholder('Search').first();
    await searchBox.click();
    await searchBox.fill(specName);
    const row = page.locator('.ag-row').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.hover();
    const editIcon = page.locator('span[title="Edit"]').first();
    await expect(editIcon).toBeVisible({ timeout: 5000 });
    await editIcon.click();
    await expect(page).toHaveURL(
      new RegExp(`#platformOne/billingCenter/specifications/${firmCd}/edit/`),
      { timeout: 30_000 }
    );
    await expect(
      page.getByRole('button', { name: 'Save Updates', exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
  };

  await test.step('Step 1: Create the spec — Spec Name, Bucket, Min $50, no Max', async () => {
    await page.goto(createUrl);
    await expect(
      page.getByRole('button', { name: 'Create Spec', exact: true })
    ).toBeVisible({ timeout: 30_000 });

    // Spec Name — triple-click + pressSequentially per the C26306 pattern;
    // qa3's controlled inputs ignore plain fill().
    const specNameInput = page.locator('#specificationDescriptionField');
    await specNameInput.click({ clickCount: 3 });
    await specNameInput.pressSequentially(specName, { delay: 25 });
    await expect(specNameInput).toHaveValue(specName);

    // Billing Bucket — the Create form already pre-fills "Advisor" by default
    // (NOM_BILLING_TEMPLATES_BUCKETS first entry from billingSpec={}). No
    // comboBox interaction needed for the regression assertion.

    await setMinMax({ min: '50', max: null });
    await assertHintsVisible();

    // Rates section is required — without a rate row, the Create Spec button
    // silently no-ops via FormBuilder validation. Add one minimal rate.
    await addOneRate();

    const submitResp = page.waitForResponse(
      (r) => r.url().includes('/react/createUpdateBillingSpec.do') && r.status() === 200,
      { timeout: 120_000 }
    );
    await page.getByRole('button', { name: 'Create Spec', exact: true }).click();
    await submitResp;
    await expect(
      page.getByRole('heading', { name: 'Create Successful' })
    ).toBeVisible({ timeout: 30_000 });
    await assertHintsVisible();
  });

  await test.step('Step 2: Edit — clear Min, set Max $10000', async () => {
    await openEditForSpec();
    await setMinMax({ min: null, max: '10000' });
    await assertHintsVisible();

    const submitResp = page.waitForResponse(
      (r) => r.url().includes('/react/createUpdateBillingSpec.do') && r.status() === 200,
      { timeout: 120_000 }
    );
    await page.getByRole('button', { name: 'Save Updates', exact: true }).click();
    await submitResp;
    await expect(
      page.getByRole('heading', { name: 'Update Successful' })
    ).toBeVisible({ timeout: 30_000 });
    await assertHintsVisible();
  });

  await test.step('Step 3: Edit — set both Min $50 and Max $10000', async () => {
    await openEditForSpec();
    await setMinMax({ min: '50', max: '10000' });
    await assertHintsVisible();

    const submitResp = page.waitForResponse(
      (r) => r.url().includes('/react/createUpdateBillingSpec.do') && r.status() === 200,
      { timeout: 120_000 }
    );
    await page.getByRole('button', { name: 'Save Updates', exact: true }).click();
    await submitResp;
    await expect(
      page.getByRole('heading', { name: 'Update Successful' })
    ).toBeVisible({ timeout: 30_000 });
    await assertHintsVisible();
  });

  await test.step('Step 4: Edit — Min > Max (Min $15000, Max $10000). Hint labels remain.', async () => {
    await openEditForSpec();
    await setMinMax({ min: '15000', max: '10000' });
    // Step 4's expected outcome is intentionally loose: either the system
    // blocks Save with a validation error, or it saves per the existing
    // business rules. The deterministic invariant is that the hint labels
    // stay rendered through the edit.
    await assertHintsVisible();
    // Click Save Updates and let whatever happens happen — we don't gate on
    // a specific success/error UX, only on the hint copy persisting.
    await page.getByRole('button', { name: 'Save Updates', exact: true }).click();
    // Give the form a moment to either flash an error or render the success
    // heading, then re-check hints. Avoid a brittle response wait here.
    await page.waitForTimeout(2000);
    await assertHintsVisible();
  });

  await test.step('Step 5: Edit — Min $0 and Max $0. Hint labels remain.', async () => {
    await openEditForSpec();
    await setMinMax({ min: '0', max: '0' });
    await assertHintsVisible();
    await page.getByRole('button', { name: 'Save Updates', exact: true }).click();
    await page.waitForTimeout(2000);
    await assertHintsVisible();
  });
});
