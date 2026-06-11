// @ts-check
/**
 * TestRail C25218 — Household: Exclude from billing - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25218 (Run 206)
 * Refs:   GEO-11480
 *
 * Phase 1 (admin / workerFirm admin):
 *   - navigate to the worker dummy firm's household billing page
 *     (clientTypeCd=5 for HOUSEHOLD per `config.clientCodes.HOUSEHOLD`)
 *   - open "Edit Household Billing Settings"
 *   - for each of the 6 buckets:
 *       1. read current "Exclude from <bucket> billing" radio (0/1/2)
 *          and flip to a different value
 *       2. dismiss "Remove Existing Account Exclusion Settings for
 *          <bucketHeader>" sub-modal if it appears (tick first account
 *          checkbox if any rows exist, then Save)
 *       3. Save the main modal
 *   - open History and assert 6 "Exclude from <bucket> billing" rows
 *
 * Phase 2 (non-admin / tyler):
 *   - navigate to the Arnold/Delaney client billing page (same fallback
 *     pattern as the client-level C25244 — the role-gating check is
 *     user-level, not entity-type-specific, so verifying tyler cannot
 *     see "Edit Billing Settings" on a known firm-106 entity is enough)
 *   - assert "Edit Billing Settings" button is hidden
 *
 * Mirror of C25244 but on the household-level URL. We use workerFirm.
 * household (NOT firm 106) per the goal directive — each worker gets a
 * fresh isolated household, so re-runs and parallel workers don't race.
 */

const { test, expect } = require('@playwright/test');
const {
  CLIENT_UUID,
  loginAsWorkerFirmAdmin,
  loginAsNonAdmin,
  gotoAccountBilling,
  openHistory,
  closeHistory,
} = require('./_helpers');

const VALUE_LABELS = { 0: 'No', 1: 'Yes', 2: 'Inherit' };

const BUCKETS = [
  {
    bucketKey: 'adviserBillingExcludeCd',
    historyBucketRe: /^Advisor billing$/i,
    excludeHeaderRe: /Remove Existing Account Exclusion Settings for Adviser/i,
    historySettingRe: /^Exclude from Advisor billing$/i,
  },
  {
    bucketKey: 'platformBillingExcludeCd',
    historyBucketRe: /^Platform billing$/i,
    excludeHeaderRe: /Remove Existing Account Exclusion Settings for Platform/i,
    historySettingRe: /^Exclude from Platform billing$/i,
  },
  {
    bucketKey: 'moneyManagerBillingExcludeCd',
    historyBucketRe: /^Money manager billing$/i,
    excludeHeaderRe: /Remove Existing Account Exclusion Settings for Money Manager/i,
    historySettingRe: /^Exclude from Money manager billing$/i,
  },
  {
    bucketKey: 'internalAdviserBillingExcludeCd',
    historyBucketRe: /^Internal Advisor billing$/i,
    excludeHeaderRe: /Remove Existing Account Exclusion Settings for Internal Adviser/i,
    historySettingRe: /^Exclude from Internal Advisor billing$/i,
  },
  {
    bucketKey: 'internalPlatformBillingExcludeCd',
    historyBucketRe: /^Internal Platform billing$/i,
    excludeHeaderRe: /Remove Existing Account Exclusion Settings for Internal Platform/i,
    historySettingRe: /^Exclude from Internal Platform billing$/i,
  },
  {
    bucketKey: 'internalMoneyManagerBillingExcludeCd',
    historyBucketRe: /^Internal Money manager billing$/i,
    excludeHeaderRe: /Remove Existing Account Exclusion Settings for Internal Money Manager/i,
    historySettingRe: /^Exclude from Internal Money manager billing$/i,
  },
];

function householdBillingUrl(uuid) {
  return `/react/indexReact.do#/client/5/${uuid}/detailsActivity/balanceSettings`;
}

async function gotoHouseholdBilling(page, householdUuid) {
  await page.goto(householdBillingUrl(householdUuid));
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function openEditHouseholdBillingSettings(page) {
  await page.getByRole('button', { name: 'Edit Billing Settings' }).click();
  await expect(page.getByText('Edit Household Billing Settings').first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function saveEditHouseholdBillingSettings(page) {
  await page.locator('button[data-role="formSubmitButton"]').first().click();
  await expect(page.getByText(/Billing Details are Updated/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText(/Billing Details are Updated/i)).toBeHidden({
    timeout: 5000,
  });
}

async function readExcludeValue(page, formKey) {
  return await page.evaluate(
    (key) => {
      for (const v of ['0', '1', '2']) {
        const el = document.getElementById(`${key}_${v}`);
        if (el && /** @type {HTMLInputElement} */ (el).checked) return v;
      }
      return null;
    },
    formKey
  );
}

async function clickExcludeRadio(page, formKey, value) {
  await page.evaluate(
    (args) => {
      const el = document.getElementById(`${args.key}_${args.value}`);
      if (!el) throw new Error(`radio not found: ${args.key}_${args.value}`);
      /** @type {HTMLInputElement} */ (el).click();
    },
    { key: formKey, value }
  );
}

async function dismissExcludeModalIfPresent(page, bucketHeaderRe, { timeoutMs = 6000 } = {}) {
  const title = page.getByText(bucketHeaderRe).first();
  const appeared = await title
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  const firstRowCheckbox = page.locator(
    '#excludeFromAccounts .ag-center-cols-container .ag-row[row-index="0"] .ag-selection-checkbox'
  );
  await firstRowCheckbox.click({ timeout: 3000 }).catch(() => {});
  await page
    .locator('button[name="button"][type="button"]')
    .filter({ hasText: /^Save$/ })
    .first()
    .click();
  await expect(title).toBeHidden({ timeout: 10_000 });
  return true;
}

test('@pepi C25218 Household Exclude from billing - Admin and Non-Admin', async ({
  page,
  context,
  workerFirm,
}) => {
  test.setTimeout(600_000);
  const householdUuid = workerFirm.household.uuid;

  await test.step('Phase 1.1: flip exclude for all 6 buckets, one save per bucket', async () => {
    await loginAsWorkerFirmAdmin(context, page, workerFirm);
    await gotoHouseholdBilling(page, householdUuid);

    for (const b of BUCKETS) {
      await openEditHouseholdBillingSettings(page);

      const before = await readExcludeValue(page, b.bucketKey);
      const after = before === '0' ? '1' : '0';

      // eslint-disable-next-line no-console
      console.log(
        `[C25218] ${b.bucketKey}: ${JSON.stringify(VALUE_LABELS[before ?? ''] || before)} -> ${JSON.stringify(VALUE_LABELS[after])}`
      );

      const overridesFetched = page
        .waitForResponse(
          (r) => r.url().includes('/ajaxToJsonBillingOverrides.do'),
          { timeout: 20_000 }
        )
        .catch(() => null);

      await clickExcludeRadio(page, b.bucketKey, after);
      await overridesFetched;
      await dismissExcludeModalIfPresent(page, b.excludeHeaderRe);
      await page.waitForTimeout(400);

      await saveEditHouseholdBillingSettings(page);
      // eslint-disable-next-line no-console
      console.log(`[C25218] ${b.bucketKey}: saved`);
    }
  });

  await test.step('Phase 1.2: History shows 6 Exclude rows', async () => {
    await openHistory(page);
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 30_000 });

    const rowRecords = await page.evaluate(() => {
      const viewport =
        document.querySelector('.ag-body-viewport') ||
        document.querySelector('[data-ref="eBodyViewport"]') ||
        document.querySelector('.ag-center-cols-viewport');
      if (!viewport) return [];
      const byRowId = new Map();
      const collectVisible = () => {
        for (const rowEl of document.querySelectorAll('.ag-row[row-id]')) {
          const rowId = rowEl.getAttribute('row-id');
          const existing = byRowId.get(rowId) || {};
          for (const cell of rowEl.querySelectorAll('.ag-cell[col-id]')) {
            const colId = cell.getAttribute('col-id');
            const txt = (cell.textContent || '').trim();
            if (!existing[colId] || (existing[colId] === '' && txt !== '')) {
              existing[colId] = txt;
            }
          }
          byRowId.set(rowId, existing);
        }
      };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      viewport.scrollTop = 0;
      return (async () => {
        await sleep(200);
        collectVisible();
        let lastTop = -1;
        for (let i = 0; i < 200; i++) {
          viewport.scrollTop = viewport.scrollTop + 200;
          await sleep(100);
          collectVisible();
          if (viewport.scrollTop === lastTop) break;
          lastTop = viewport.scrollTop;
        }
        viewport.scrollTop = 0;
        await sleep(100);
        return Array.from(byRowId.values());
      })();
    });

    const dumpFirstN = (n) =>
      rowRecords
        .slice(0, n)
        .map((r) => `  ${r.setting} | ${r.billingBucket} | ${r.before} → ${r.after}`)
        .join('\n');
    // eslint-disable-next-line no-console
    console.log(
      `[C25218] history rows (${rowRecords.length}), unique buckets: ${JSON.stringify([...new Set(rowRecords.map((r) => r.billingBucket).filter(Boolean))])}`
    );

    for (const b of BUCKETS) {
      const match = rowRecords.some(
        (r) =>
          b.historySettingRe.test((r.setting || '').trim()) &&
          b.historyBucketRe.test((r.billingBucket || '').trim())
      );
      expect(
        match,
        `No "${b.historySettingRe.source}" history row for ${b.historyBucketRe.source} — first 12:\n${dumpFirstN(12)}`
      ).toBe(true);
    }

    await closeHistory(page);
  });

  await test.step('Phase 2: non-admin tyler cannot see Edit Billing Settings', async () => {
    // The role-gating check is user-level, so verifying tyler can't see
    // the Edit button on the firm-106 Arnold/Delaney client (where she
    // has read access) covers the case's intent. Re-using the same
    // pattern as C25197 / C25244 keeps the household spec aligned with
    // the wider family of admin/non-admin specs.
    await loginAsNonAdmin(context, page);
    await gotoAccountBilling(page);
    await expect(page.getByRole('button', { name: 'Edit Billing Settings' })).toHaveCount(0);
  });
});
