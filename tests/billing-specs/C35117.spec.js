// @ts-check
/**
 * AIO GEO-TC-11840 (C35117) — Verify Min/Max fee fields display the "per
 * billing period" hint label on Create New Billing Spec. Ref. GEO-26096.
 *
 * The AIO steps describe the hint as "per billing period"; the shipped copy is
 * FEE_PERIOD_HINT = "Periodic, not Annual" (GEO-26096). The test asserts the
 * real text so a future copy change fails loudly.
 *
 * Read-only: the form is filled but never submitted, so firm 1 is safe to use.
 *
 * Selectors (BillingSpecs/pages/CreateBillingSpecification, FormBuilder):
 *   - Minimum Fee  →  input#minimumFeeAmountField
 *   - Maximum Fee  →  input#maxFeeAmountField
 *   - Hint         →  span.labelHint (FEE_PERIOD_HINT) inside the field's
 *                     <label>, within section#minimumFeeAmount / #maxFeeAmount
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const FIRM_CODE = 1;
const SPECS_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_CODE}`;
const FEE_PERIOD_HINT = 'Periodic, not Annual';

test(
  '@regression C35117 Min/Max fee fields display the per billing period hint on Create New Billing Spec',
  {
    annotation: [
      { type: 'aio', description: 'GEO-TC-11840' },
      {
        type: 'aio-deviation',
        description:
          'AIO says "per billing period"; shipped hint text is "Periodic, not Annual" (GEO-26096)',
      },
    ],
  },
  async ({ page }) => {
    test.setTimeout(180_000);

    const minInput = page.locator('#minimumFeeAmountField');
    const maxInput = page.locator('#maxFeeAmountField');
    // The hint is a span inside the field's <label>, within section#<field>.
    const hintFor = (fieldKey) => page.locator(`section#${fieldKey}`).getByText(FEE_PERIOD_HINT);
    const minHint = hintFor('minimumFeeAmount');
    const maxHint = hintFor('maxFeeAmount');

    /** The hint must stay visible and must not sit on top of its input. */
    const assertHintBesideInput = async (hint, input) => {
      await expect(hint).toBeVisible();
      const hintBox = await hint.boundingBox();
      const inputBox = await input.boundingBox();
      expect(hintBox && inputBox, 'hint and input both rendered').toBeTruthy();
      const overlaps =
        hintBox.x < inputBox.x + inputBox.width &&
        hintBox.x + hintBox.width > inputBox.x &&
        hintBox.y < inputBox.y + inputBox.height &&
        hintBox.y + hintBox.height > inputBox.y;
      expect(overlaps, 'hint must not overlap the input').toBe(false);
    };

    // FormBuilder Currency inputs ignore fill(); type real keystrokes.
    const typeInto = async (input, value) => {
      await input.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      if (value) await input.pressSequentially(value, { delay: 30 });
    };

    await loginPlatformOneAdmin(page);

    await test.step('Precondition: open Create New Billing Spec for a firm', async () => {
      await page.goto(SPECS_URL);
      const createLink = page.getByText('Create New Billing Spec', { exact: true });
      await expect(createLink).toBeVisible({ timeout: 60_000 });
      await createLink.click();
      await expect(page).toHaveURL(/#platformOne\/billingCenter\/specifications\/1\/create/);
      await expect(page.getByRole('button', { name: 'Create Spec', exact: true })).toBeVisible({
        timeout: 30_000,
      });
    });

    await test.step('Step 1: Minimum Fee shows the hint', async () => {
      await expect(minInput).toBeVisible();
      await assertHintBesideInput(minHint, minInput);
    });

    await test.step('Step 2: Maximum Fee shows the hint', async () => {
      await expect(maxInput).toBeVisible();
      await assertHintBesideInput(maxHint, maxInput);
    });

    await test.step('Step 3: $100 in Minimum Fee is accepted, hint stays', async () => {
      await typeInto(minInput, '100');
      await expect(minInput).toHaveValue(/100/);
      await assertHintBesideInput(minHint, minInput);
    });

    await test.step('Step 4: $5000 in Maximum Fee is accepted, hint stays', async () => {
      await typeInto(maxInput, '5000');
      await expect(maxInput).toHaveValue(/5,?000/);
      await assertHintBesideInput(maxHint, maxInput);
    });

    await test.step('Step 5: both fields empty, both hints still visible', async () => {
      await typeInto(minInput, '');
      await typeInto(maxInput, '');
      await expect(minInput).toHaveValue('');
      await expect(maxInput).toHaveValue('');
      await assertHintBesideInput(minHint, minInput);
      await assertHintBesideInput(maxHint, maxInput);
    });
  }
);
