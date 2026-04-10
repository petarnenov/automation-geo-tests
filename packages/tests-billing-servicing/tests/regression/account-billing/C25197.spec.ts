/**
 * TestRail C25197 — Account: Exclude from billing - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25197
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Hybrid isolation pattern:
 *
 *   Phase 1 (admin write/read + history check) → workerFirmAdminPage.
 *     Toggles all 6 billing-bucket "exclude" radios and verifies each
 *     change appears as a History row.
 *
 *   Phase 2 (non-admin Edit-button-hidden check) → tylerPage on
 *     firm 106. Phase 2.2 history-rows-as-non-admin from the legacy
 *     spec is dropped — those rows belong to the dummy firm and tyler
 *     can't navigate there. Role-gating coverage is preserved.
 *
 * The 6 billing buckets are encoded as radio buttons:
 *   `{bucketKey}BillingExcludeCd_{0|1|2}` where 0=No, 1=Yes, 2=Inherit.
 *
 * Differences from the legacy spec (deliberate):
 *
 *   - Uses two distinct fixture-provided pages instead of clearCookies
 *     + relogin.
 *
 *   - Drives modal open/save/history via AccountBillingPage POM.
 *
 *   - No cleanup revert — each worker has its own dummy firm.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import type { Page } from '@playwright/test';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

const BUCKETS = [
  {
    formKey: 'adviserBillingExcludeCd',
    setting: 'Exclude from Advisor billing',
  },
  {
    formKey: 'platformBillingExcludeCd',
    setting: 'Exclude from Platform billing',
  },
  {
    formKey: 'moneyManagerBillingExcludeCd',
    setting: 'Exclude from Money Manager billing',
  },
  {
    formKey: 'internalAdviserBillingExcludeCd',
    setting: 'Exclude from Internal Advisor billing',
  },
  {
    formKey: 'internalPlatformBillingExcludeCd',
    setting: 'Exclude from Internal Platform billing',
  },
  {
    formKey: 'internalMoneyManagerBillingExcludeCd',
    setting: 'Exclude from Internal Money manager billing',
  },
] as const;

const VALUE_LABELS: Record<string, string> = { '0': 'No', '1': 'Yes', '2': 'Inherit' };

/**
 * Read the currently selected radio value (0/1/2) for each bucket
 * from the open edit modal. Returns a map of formKey → "0"|"1"|"2".
 */
async function captureExcludeState(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(
    (bucketKeys: string[]) => {
      const out: Record<string, string> = {};
      for (const key of bucketKeys) {
        for (const v of ['0', '1', '2']) {
          const el = document.getElementById(`${key}_${v}`) as HTMLInputElement | null;
          if (el?.checked) {
            out[key] = v;
            break;
          }
        }
      }
      return out;
    },
    BUCKETS.map((b) => b.formKey)
  );
}

/**
 * Click the radio input via native JS click — the radio is styled
 * invisibly and Playwright `.click()` hits the label instead.
 */
async function clickExcludeRadio(page: Page, formKey: string, value: string): Promise<void> {
  await page.evaluate(
    ({ id }) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`radio not found: ${id}`);
      el.click();
    },
    { id: `${formKey}_${value}` }
  );
}

test('@regression @billing-servicing C25197 Exclude from billing - Admin and Non-Admin', async ({
  workerFirmAdminPage,
  workerFirm,
  tylerPage,
}) => {
  test.slow();

  const billing = new AccountBillingPage(workerFirmAdminPage);
  let originalState: Record<string, string>;
  let testState: Record<string, string>;

  await test.step('Phase 1.1+1.2: capture state, toggle all 6 buckets, Save', async () => {
    await billing.goto({ workerFirm });
    await billing.openEditModal();

    originalState = await captureExcludeState(workerFirmAdminPage);
    // Build the test state: flip 0↔1, Inherit(2) → No(0).
    testState = {};
    for (const b of BUCKETS) {
      const cur = originalState[b.formKey];
      testState[b.formKey] = cur === '0' ? '1' : '0';
    }
    test.info().annotations.push({
      type: 'captured',
      description: `firmCd=${workerFirm.firmCd} original=${JSON.stringify(originalState)} test=${JSON.stringify(testState)}`,
    });

    for (const b of BUCKETS) {
      await clickExcludeRadio(workerFirmAdminPage, b.formKey, testState[b.formKey]);
    }
    await billing.saveEditModal();
  });

  await test.step('Phase 1.3: History shows the 6 toggle rows', async () => {
    await billing.openHistory();
    for (const b of BUCKETS) {
      const before = VALUE_LABELS[originalState[b.formKey]];
      const after = VALUE_LABELS[testState[b.formKey]];
      await expect(
        billing.historyRow({ setting: b.setting, before, after }).first(),
        `History row for ${b.setting} (${before}→${after})`
      ).toBeVisible({ timeout: 10_000 });
    }
    await billing.closeHistory();
  });

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    const billingPhase2 = new AccountBillingPage(tylerPage);
    await billingPhase2.goto({ static: 'arnold-delaney' });
    await expect(billingPhase2.editButton).toHaveCount(0);
  });
});
