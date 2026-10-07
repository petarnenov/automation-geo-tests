// @ts-check
/**
 * AIO GEO-TC-11841 (C35119) — Verify the Min/Max "per billing period" hint
 * label is consistent across all billing bucket types. Ref. GEO-26096.
 *
 * Walks the Billing Bucket combo (`#buckets_typeAhead`) on the Create New
 * Billing Spec form through all six buckets and checks both fee hints after
 * every switch. The shipped hint copy is "Periodic, not Annual" (GEO-26096).
 *
 * Read-only: the form is never submitted.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const { setComboBoxValue, listComboBoxOptions } = require('../_helpers/ui');

const FIRM_CODE = 1;
const CREATE_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_CODE}/create`;
const FEE_PERIOD_HINT = 'Periodic, not Annual';
const ALL_BUCKETS = [
  'Advisor',
  'Money Manager',
  'Platform',
  'Internal Advisor',
  'Internal MM',
  'Internal Platform',
];

test(
  '@regression C35119 Min/Max per billing period hint is consistent across all billing bucket types',
  {
    annotation: [
      { type: 'aio', description: 'GEO-TC-11841' },
      {
        type: 'aio-deviation',
        description:
          'AIO says "per billing period"; shipped hint text is "Periodic, not Annual" (GEO-26096)',
      },
    ],
  },
  async ({ page }) => {
    test.setTimeout(180_000);

    const bucket = page.locator('#buckets_typeAhead');
    // The hint is a span inside the field's <label>, within section#<field>.
    const hintFor = (fieldKey) => page.locator(`section#${fieldKey}`).getByText(FEE_PERIOD_HINT);
    const assertBothHints = async () => {
      await expect(hintFor('minimumFeeAmount')).toBeVisible();
      await expect(hintFor('maxFeeAmount')).toBeVisible();
    };

    await loginPlatformOneAdmin(page);
    await page.goto(CREATE_URL);
    await expect(page.getByRole('button', { name: 'Create Spec', exact: true })).toBeVisible({
      timeout: 60_000,
    });

    await test.step('Step 1: Advisor (form default) shows both hints', async () => {
      // Re-picking the already-selected option clears the combo, so assert
      // the default instead of selecting it.
      await expect(bucket).toHaveValue('Advisor');
      await assertBothHints();
    });

    await test.step('All six bucket types are offered', async () => {
      // Listing clears the typeAhead; the loop below re-selects a bucket.
      expect(await listComboBoxOptions(page, 'buckets')).toEqual(ALL_BUCKETS);
    });

    // Steps 2-4 in AIO order: Platform, Money Manager, then the internal ones.
    for (const name of [
      'Platform',
      'Money Manager',
      'Internal Advisor',
      'Internal Platform',
      'Internal MM',
    ]) {
      await test.step(`${name} shows both hints`, async () => {
        await setComboBoxValue(page, 'buckets', name);
        await expect(bucket).toHaveValue(name);
        await assertBothHints();
      });
    }
  }
);
