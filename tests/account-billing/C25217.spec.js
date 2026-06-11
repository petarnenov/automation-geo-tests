// @ts-check
/**
 * TestRail C25217 — Household: Spec Name/Active Date - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25217 (Run 206)
 * Refs:   GEO-11480
 *
 * Mirror of C25243 (client-level Spec Name/Active Date) but on the
 * household route (clientTypeCd=5 — `config.clientCodes.HOUSEHOLD`).
 *
 * Why firm 106 + Arnold/Delaney's household (NOT workerFirm.household):
 *   Dummy firms provisioned by /qa/createDummyFirm.do don't seed billing
 *   spec nomenclatures, so every bucket's combo offers only
 *   "Inherit from Firm (None)" — no alternative spec to pick.  The
 *   Plimsoll FP firm 106 "Kevin and Leah Arnold" household has rich
 *   seeded specs in all 6 buckets — verified via probe.  C25243 makes
 *   the same trade-off for the analogous client-level case.
 *
 *   Arnold household uuid: 6E09DE2BFBBC48EAAD91B5B5D98B6CE8
 *
 * Phase 1 (admin / tim106):
 *   - flip each of the 6 buckets to a different non-Inherit spec AND a
 *     different Active Date, ONE save per bucket
 *   - the spec change triggers a "Remove Existing Account Billing
 *     Specification Overrides" sub-modal (when overrides exist) — Save
 *     it to commit removal and let the spec change stick
 *   - the Active Date is set via the picker's three spinbuttons
 *     (calendar drilling races with React commits — see C25243)
 *   - History should show a "Billing specification" row + an "active
 *     date" row per bucket (12 rows in total)
 *
 * Phase 2 (non-admin / tyler):
 *   - assert no Edit Billing Settings button on a known firm-106 entity
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsAdmin,
  loginAsNonAdmin,
  gotoAccountBilling,
  openHistory,
  closeHistory,
  setComboBoxValue,
} = require('./_helpers');

const HOUSEHOLD_UUID = '6E09DE2BFBBC48EAAD91B5B5D98B6CE8';
const HOUSEHOLD_BILLING_URL = `/react/indexReact.do#/client/5/${HOUSEHOLD_UUID}/detailsActivity/balanceSettings`;

const BUCKETS = [
  {
    bucketKey: 'adviser',
    bucketLabel: 'Advisor',
    specA: '55 BPS',
    specB: '55 BPS-Flows',
  },
  {
    bucketKey: 'platform',
    bucketLabel: 'Platform',
    specA: 'FAAM Flat HH $5,000',
    specB: 'FAAM Flat HH $5,900',
  },
  {
    bucketKey: 'moneyManager',
    bucketLabel: 'Money Manager',
    specA: 'Customized Index-SH .35%',
    specB: 'Customized Index-SH .29%',
  },
  {
    bucketKey: 'internalAdviser',
    bucketLabel: 'Internal Advisor',
    specA: 'Flat Fee $11,000-HH internal advisor',
    specB: 'Flat Fee $11,000-HH internal advisor spec name',
  },
  {
    bucketKey: 'internalPlatform',
    bucketLabel: 'Internal Platform',
    specA: 'FAAM Flat HH $2,500 -AI',
    specB: 'Old-FAAM Flat Fee $5,700 AI',
  },
  {
    bucketKey: 'internalMoneyManager',
    bucketLabel: 'Internal Money Manager',
    specA: 'Top Fee',
    specB: '3rd Party Internal MM Fees',
  },
];

const DATE_A = '06/15/2025';
const DATE_B = '06/22/2025';

const HISTORY_BUCKET_BY_KEY = {
  adviser: /^Advisor billing$/i,
  platform: /^Platform billing$/i,
  moneyManager: /^Money manager billing$/i,
  internalAdviser: /^Internal Advisor billing$/i,
  internalPlatform: /^Internal Platform billing$/i,
  internalMoneyManager: /^Internal Money manager billing$/i,
};

async function gotoHouseholdBilling(page) {
  await page.goto(HOUSEHOLD_BILLING_URL);
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

async function dismissOverrideModalIfPresent(page, { timeoutMs = 5000 } = {}) {
  const overrideTitle = page.getByText(
    /Remove Existing Account Billing Specification Overrides/i
  );
  const appeared = await overrideTitle
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await page
    .locator('button[name="button"][type="button"]')
    .filter({ hasText: /^Save$/ })
    .first()
    .click();
  await expect(overrideTitle).toBeHidden({ timeout: 10_000 });
}

async function saveEditHouseholdBillingSettings(page) {
  // The FormBuilder submit gets a `disabled___xxx` CSS class (no HTML
  // disabled attribute) while isFormValid===false. A naïve click looks
  // like it landed but no save fires (verified via trace.network for
  // moneyManager: no `editBillingClientSettings.do` request emitted).
  // Wait for the disabled class to drop — that's the real signal the
  // form is committed and ready to submit.
  const submit = page.locator('button[data-role="formSubmitButton"]').first();
  await expect(submit).toBeVisible({ timeout: 10_000 });
  await expect(submit).not.toHaveClass(/disabled/i, { timeout: 15_000 });
  await submit.click();
  await expect(page.getByText(/Billing Details are Updated/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText(/Billing Details are Updated/i)).toBeHidden({
    timeout: 5000,
  });
}

async function setDateViaSpinbuttons(page, sectionId, mmddyyyy) {
  // Strip leading zeros — react-date-picker spinbuttons are
  // `<input type="number" min="1">`, and intermediate values like "0"
  // (while typing "06") trip the form's "Value must be greater than or
  // equal to 1" validator. Typing "6" then Tab is accepted as June.
  const [m, d, y] = mmddyyyy.split('/').map((v) => String(parseInt(v, 10)));
  const setSpin = async (name, value) => {
    const spin = page.locator(`#${sectionId} input[name="${name}"]`);
    await spin.click({ clickCount: 3 });
    await spin.pressSequentially(value, { delay: 20 });
    await spin.press('Tab');
  };
  await setSpin('month', m);
  await setSpin('day', d);
  await setSpin('year', y);
}

// Same race window as C25196/C25243: firm-106 mutations from sibling
// specs can race. One retry rides out collisions.
test.describe.configure({ retries: 1 });

test('@pepi C25217 Household Spec Name/Active Date - Admin and Non-Admin', async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);

  await test.step('Phase 1.1: flip spec + active date for all 6 buckets, one save per bucket', async () => {
    await loginAsAdmin(context, page);
    await gotoHouseholdBilling(page);

    for (const b of BUCKETS) {
      await openEditHouseholdBillingSettings(page);

      const taSel = `#${b.bucketKey}BillingSpecification_typeAhead`;
      const currentSpec = (await page.locator(taSel).inputValue()).trim();
      const specAfter = currentSpec === b.specA ? b.specB : b.specA;
      const dateBefore = await page
        .locator(`#${b.bucketKey}BillingActiveDate`)
        .evaluate((sec) => {
          const m = sec.querySelector('input[name="month"]')?.value;
          const d = sec.querySelector('input[name="day"]')?.value;
          const y = sec.querySelector('input[name="year"]')?.value;
          return m && d && y ? `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}` : '';
        });
      const dateAfter = dateBefore === DATE_A ? DATE_B : DATE_A;

      // eslint-disable-next-line no-console
      console.log(
        `[C25217] ${b.bucketKey}: spec ${JSON.stringify(currentSpec)} -> ${JSON.stringify(specAfter)}, date ${JSON.stringify(dateBefore)} -> ${JSON.stringify(dateAfter)}`
      );

      const overridesFetched = page
        .waitForResponse(
          (r) => r.url().includes('/ajaxToJsonBillingOverrides.do'),
          { timeout: 20_000 }
        )
        .catch(() => null);

      await setComboBoxValue(page, `${b.bucketKey}BillingSpecification`, specAfter);
      await overridesFetched;
      await dismissOverrideModalIfPresent(page);
      await page.waitForTimeout(600);
      await setDateViaSpinbuttons(page, `${b.bucketKey}BillingActiveDate`, dateAfter);
      await saveEditHouseholdBillingSettings(page);
      // eslint-disable-next-line no-console
      console.log(`[C25217] ${b.bucketKey}: saved`);
    }
  });

  await test.step('Phase 1.2: History shows spec + active-date rows per bucket', async () => {
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
      `[C25217] history rows (${rowRecords.length}), unique buckets: ${JSON.stringify([...new Set(rowRecords.map((r) => r.billingBucket).filter(Boolean))])}`
    );

    for (const b of BUCKETS) {
      const labelRe = HISTORY_BUCKET_BY_KEY[b.bucketKey];
      const specMatch = rowRecords.some(
        (r) =>
          /Billing specification/i.test(r.setting || '') &&
          labelRe.test((r.billingBucket || '').trim())
      );
      expect(
        specMatch,
        `No "Billing specification" history row found for ${b.bucketLabel} bucket — first 12:\n${dumpFirstN(12)}`
      ).toBe(true);

      const dateMatch = rowRecords.some(
        (r) =>
          /active date/i.test(r.setting || '') &&
          labelRe.test((r.billingBucket || '').trim())
      );
      expect(
        dateMatch,
        `No "active date" history row found for ${b.bucketLabel} bucket — first 12:\n${dumpFirstN(12)}`
      ).toBe(true);
    }

    await closeHistory(page);
  });

  await test.step('Phase 2: non-admin tyler cannot see Edit Billing Settings', async () => {
    await loginAsNonAdmin(context, page);
    await gotoAccountBilling(page);
    await expect(page.getByRole('button', { name: 'Edit Billing Settings' })).toHaveCount(0);
  });
});
