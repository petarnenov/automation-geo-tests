// @ts-check
/**
 * TestRail C25197 — Account: Exclude from billing - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25197 (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Phase 1 (admin / tim106):
 *   - capture the current "Exclude from {bucket} billing" radio for all 6
 *     billing buckets
 *   - open Edit Billing Settings, toggle each radio to a different value, Save
 *   - open History, verify 6 new rows appear (one per bucket) with the
 *     before/after values
 *   - cleanup: revert all 6 radios to their original state, Save
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - open the same Billing tab — assert no Edit Billing Settings button
 *   - open History, verify all 6 rows from phase 1 are still visible
 *
 * The 6 billing buckets are encoded in the form as radio button names:
 *   `{bucketKey}BillingExcludeCd_{0|1|2}` where 0=No, 1=Yes, 2=Inherit.
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsAdmin,
  loginAsNonAdmin,
  gotoAccountBilling,
  openEditBillingSettings,
  saveEditBillingSettings,
  openHistory,
  closeHistory,
  historyRow,
} = require('./_helpers');

/**
 * Per-bucket metadata: form key, History "Setting" cell, History "Billing Bucket"
 * cell. The form key is the radio name prefix; the labels are the strings the
 * History grid renders.
 */
const BUCKETS = [
  {
    formKey: 'adviserBillingExcludeCd',
    setting: 'Exclude from Advisor billing',
    billingBucket: 'Advisor billing',
  },
  {
    formKey: 'platformBillingExcludeCd',
    setting: 'Exclude from Platform billing',
    billingBucket: 'Platform billing',
  },
  {
    formKey: 'moneyManagerBillingExcludeCd',
    setting: 'Exclude from Money Manager billing',
    billingBucket: 'Money Manager billing',
  },
  {
    formKey: 'internalAdviserBillingExcludeCd',
    setting: 'Exclude from Internal Advisor billing',
    billingBucket: 'Internal Advisor billing',
  },
  {
    formKey: 'internalPlatformBillingExcludeCd',
    setting: 'Exclude from Internal Platform billing',
    billingBucket: 'Internal Platform billing',
  },
  {
    formKey: 'internalMoneyManagerBillingExcludeCd',
    setting: 'Exclude from Internal Money manager billing',
    billingBucket: 'Internal Money manager billing',
  },
];

const VALUE_LABELS = { 0: 'No', 1: 'Yes', 2: 'Inherit' };

/**
 * Read the currently selected radio value (0/1/2) for each bucket. Returns
 * a Map<formKey, "0"|"1"|"2">.
 */
async function captureExcludeState(page) {
  return await page.evaluate((bucketKeys) => {
    const out = {};
    for (const key of bucketKeys) {
      for (const v of ['0', '1', '2']) {
        const el = document.getElementById(`${key}_${v}`);
        if (el && el.checked) {
          out[key] = v;
          break;
        }
      }
    }
    return out;
  }, BUCKETS.map((b) => b.formKey));
}

/**
 * Click the radio button for the given bucket+value. Uses the visible label
 * sibling click since the radio input itself may be styled invisibly.
 */
async function clickExcludeRadio(page, formKey, value) {
  // Click the actual <input id="..."> via JS — radio inputs are typically
  // visible to React's onChange but the click is intercepted by a styled
  // sibling label. Use the native click() in evaluate to bypass styling.
  await page.evaluate(
    ({ id }) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`radio not found: ${id}`);
      el.click();
    },
    { id: `${formKey}_${value}` }
  );
}

test('@pepi C25197 Account Exclude from billing - Admin and Non-Admin', async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);

  /** @type {Record<string, string>} */
  let originalState;
  /** @type {Record<string, string>} */
  let testState;

  await test.step('Phase 1.1+1.2: capture state, toggle all 6 buckets, Save', async () => {
    await loginAsAdmin(context, page);
    await gotoAccountBilling(page);
    await openEditBillingSettings(page);

    originalState = await captureExcludeState(page);
    // Build the test state: flip 0↔1, leave 2 as 0 (Inherit → No is also a change).
    testState = {};
    for (const b of BUCKETS) {
      const cur = originalState[b.formKey];
      testState[b.formKey] = cur === '0' ? '1' : '0';
    }
    test.info().annotations.push({
      type: 'captured',
      description: `original=${JSON.stringify(originalState)} test=${JSON.stringify(testState)}`,
    });

    for (const b of BUCKETS) {
      await clickExcludeRadio(page, b.formKey, testState[b.formKey]);
    }
    await saveEditBillingSettings(page);
  });

  await test.step('Phase 1.3: History shows the 6 toggle rows', async () => {
    await openHistory(page);
    for (const b of BUCKETS) {
      const before = VALUE_LABELS[originalState[b.formKey]];
      const after = VALUE_LABELS[testState[b.formKey]];
      await expect(
        historyRow(page, { setting: b.setting, before, after }).first(),
        `History row for ${b.setting} (${before}→${after})`
      ).toBeVisible({ timeout: 10_000 });
    }
    await closeHistory(page);
  });

  await test.step('Phase 1.4: cleanup — revert all 6 buckets to original', async () => {
    await openEditBillingSettings(page);
    for (const b of BUCKETS) {
      await clickExcludeRadio(page, b.formKey, originalState[b.formKey]);
    }
    await saveEditBillingSettings(page);
  });

  await test.step('Phase 2.1: non-admin tyler logs in and opens billing', async () => {
    await loginAsNonAdmin(context, page);
    await gotoAccountBilling(page);
    await expect(
      page.getByRole('button', { name: 'Edit Billing Settings' })
    ).toHaveCount(0);
  });

  await test.step('Phase 2.2: non-admin verifies all 6 history rows still visible', async () => {
    await openHistory(page);
    for (const b of BUCKETS) {
      const before = VALUE_LABELS[originalState[b.formKey]];
      const after = VALUE_LABELS[testState[b.formKey]];
      await expect(
        historyRow(page, { setting: b.setting, before, after }).first(),
        `non-admin: row ${b.setting} (${before}→${after})`
      ).toBeVisible({ timeout: 10_000 });
    }
    await closeHistory(page);
  });
});
