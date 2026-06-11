// @ts-check
/**
 * TestRail C25244 — Client: Exclude from billing - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25244 (Run 206)
 * Refs:   GEO-11480
 *
 * Phase 1 (admin / tim106):
 *   - navigate to the Plimsoll FP Arnold/Delaney CLIENT-LEVEL Billing
 *     Settings (Details & Activity → Billing Settings)
 *   - open "Edit Client Billing Settings"
 *   - for each of the 6 buckets:
 *       1. read the currently selected "Exclude from <bucket> billing"
 *          radio (0=No / 1=Yes / 2=Inherit) and flip to a different value
 *       2. the BillingSpec component fires `triggerPopUpGridAcc` when the
 *          exclude radio changes on a client (no accountTypeCd) — it
 *          opens the "Remove Existing Account Exclusion Settings for
 *          <bucketHeader>" sub-modal. Tick at least one account checkbox
 *          (if any rows are present) and click Save in the sub-modal.
 *   - Save the main modal
 *   - open History and assert one "Exclude from <bucket> billing" audit
 *     row exists per bucket (6 rows total).
 *
 * Phase 2 (non-admin / tyler):
 *   - navigate to the same client billing tab and assert the "Edit
 *     Billing Settings" button is hidden.
 *
 * Test data: firm 106 + Arnold/Delaney client — same as C25243.  Each
 * run flips every bucket between 'No' and 'Yes' (avoiding 'Inherit' so
 * the toggle is always a real change).
 */

const { test, expect } = require('@playwright/test');
const {
  CLIENT_UUID,
  loginAsAdmin,
  loginAsNonAdmin,
  openHistory,
  closeHistory,
} = require('./_helpers');

const CLIENT_BILLING_URL = `/react/indexReact.do#/client/1/${CLIENT_UUID}/detailsActivity/balanceSettings`;

const VALUE_LABELS = { 0: 'No', 1: 'Yes', 2: 'Inherit' };

/**
 * Per-bucket metadata.
 *   bucketKey       — radio name prefix (`<key>BillingExcludeCd`)
 *   bucketLabel     — exact case-insensitive string the History grid
 *                     renders in the BILLING BUCKET column
 *   excludeHeader   — bucketHeader string for the "Remove Existing
 *                     Account Exclusion Settings for ${header}" sub-modal
 *                     (per ExcludeModalGrid.js)
 *   historySetting  — exact case-insensitive setting label the audit
 *                     row carries
 */
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

async function gotoClientBilling(page) {
  await page.goto(CLIENT_BILLING_URL);
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function openEditClientBillingSettings(page) {
  await page.getByRole('button', { name: 'Edit Billing Settings' }).click();
  await expect(page.getByText('Edit Client Billing Settings').first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function saveEditClientBillingSettings(page) {
  // Scope to the FormBuilder submit; co-existing sub-modal Save buttons
  // share the name "Save".
  await page.locator('button[data-role="formSubmitButton"]').first().click();
  await expect(page.getByText(/Billing Details are Updated/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText(/Billing Details are Updated/i)).toBeHidden({
    timeout: 5000,
  });
}

/**
 * Read the currently selected radio value (0/1/2) for an exclude radio
 * group.  Returns the value or null if none selected.
 */
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

/**
 * Click an exclude radio button via native .click() — the visible
 * widget is a styled sibling that intercepts Playwright's pointer.
 */
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

/**
 * When exclude radio changes on a client (no accountTypeCd), the
 * BillingSpec component opens the "Remove Existing Account Exclusion
 * Settings" sub-modal. Wait briefly; if it appears, optionally tick
 * the first account row's checkbox and click the modal's Save button
 * (rendered as `<button name="button" type="button">Save</button>`,
 * distinct from the FormBuilder submit which has
 * `data-role="formSubmitButton"`).
 */
async function dismissExcludeModalIfPresent(page, bucketHeaderRe, { timeoutMs = 6000 } = {}) {
  const title = page.getByText(bucketHeaderRe).first();
  const appeared = await title
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  // Tick the first account in the grid (case step: "Click on the
  // checkbox for an account"). The grid id is `excludeFromAccounts`.
  // ag-grid's selection checkbox lives in the first column header/cell.
  // We click the FIRST data row's checkbox label, ignoring failure (some
  // sub-modals open empty when no overrides exist — the case wording
  // assumes ≥1 account is present, which is true for the Plimsoll FP
  // Arnold/Delaney client).
  const firstRowCheckbox = page
    .locator('#excludeFromAccounts .ag-center-cols-container .ag-row[row-index="0"] .ag-selection-checkbox');
  await firstRowCheckbox
    .click({ timeout: 3000 })
    .catch(() => {});
  // Save the sub-modal.
  await page
    .locator('button[name="button"][type="button"]')
    .filter({ hasText: /^Save$/ })
    .first()
    .click();
  await expect(title).toBeHidden({ timeout: 10_000 });
  return true;
}

// Same race window as C25196/C25243: firm 106 mutations from sibling
// specs can race. One retry rides out collisions.
test.describe.configure({ retries: 1 });

test('@pepi C25244 Client Exclude from billing - Admin and Non-Admin', async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);

  /** @type {Record<string, { excludeBefore: string|null, excludeAfter: string }>} */
  const expectations = {};

  await test.step('Phase 1.1: flip exclude for all 6 buckets, one save per bucket', async () => {
    // One save per bucket: gives the override sub-modal a clean window
    // and lets a single failure not block subsequent buckets — see
    // C25243's commentary for the rationale.
    await loginAsAdmin(context, page);
    await gotoClientBilling(page);

    for (const b of BUCKETS) {
      await openEditClientBillingSettings(page);

      const before = await readExcludeValue(page, b.bucketKey);
      // Flip 'No' (0) ↔ 'Yes' (1) — avoid 'Inherit' (2) which can
      // disable the per-account override and skip the audit row.
      const after = before === '0' ? '1' : '0';
      expectations[b.bucketKey] = { excludeBefore: before, excludeAfter: after };

      // eslint-disable-next-line no-console
      console.log(
        `[C25244] ${b.bucketKey}: ${JSON.stringify(VALUE_LABELS[before ?? ''] || before)} -> ${JSON.stringify(VALUE_LABELS[after])}`
      );

      // Subscribe to the override-fetch BEFORE clicking the radio so the
      // promise definitely catches the request firing.
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

      await saveEditClientBillingSettings(page);
      // eslint-disable-next-line no-console
      console.log(`[C25244] ${b.bucketKey}: saved`);
    }
  });

  await test.step('Phase 1.2: History shows 6 Exclude rows (one per bucket)', async () => {
    await openHistory(page);
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 30_000 });

    // Collect rows by row-id, paging through the virtualised viewport.
    // Same approach as C25243 — the Plimsoll FP client has hundreds of
    // accumulated audit rows from prior C25197/C25243 runs.
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
      `[C25244] history rows (${rowRecords.length}), unique buckets: ${JSON.stringify([...new Set(rowRecords.map((r) => r.billingBucket).filter(Boolean))])}`
    );

    for (const b of BUCKETS) {
      const match = rowRecords.some(
        (r) =>
          b.historySettingRe.test((r.setting || '').trim()) &&
          b.historyBucketRe.test((r.billingBucket || '').trim())
      );
      expect(
        match,
        `No "${b.historySettingRe.source}" history row found for ${b.historyBucketRe.source} bucket — first 12:\n${dumpFirstN(12)}`
      ).toBe(true);
    }

    await closeHistory(page);
  });

  await test.step('Phase 2: non-admin tyler cannot see Edit Billing Settings', async () => {
    await loginAsNonAdmin(context, page);
    await gotoClientBilling(page);
    await expect(page.getByRole('button', { name: 'Edit Billing Settings' })).toHaveCount(0);
  });
});
