// @ts-check
/**
 * TestRail C25246 — Client: Adjustment/Expiration Date - Amount [$] -
 *                   Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25246 (Run 206)
 * Refs:   GEO-11480
 *
 * Mirror of C25245 but exercises the Amount [$] adjustment type instead
 * of Percent. See C25245.spec.js for the rationale on idempotent updates
 * and accumulation. C25245 and C25246 alternate the type per run; both
 * flip the Advisor bucket's adjustment between the two types end-to-end.
 */

const { test, expect } = require('@playwright/test');
const {
  CLIENT_UUID,
  loginAsAdmin,
  loginAsNonAdmin,
  openHistory,
  closeHistory,
  setComboBoxValue,
  setReactNumericInput,
} = require('./_helpers');

const CLIENT_BILLING_URL = `/react/indexReact.do#/client/1/${CLIENT_UUID}/detailsActivity/balanceSettings`;

const AMOUNT_A = '125';
const AMOUNT_B = '250';
const DATE_A = '06/15/2027';
const DATE_B = '07/20/2027';

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
  await page.locator('button[data-role="formSubmitButton"]').first().click();
  await expect(page.getByText(/Billing Details are Updated/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText(/Billing Details are Updated/i)).toBeHidden({
    timeout: 5000,
  });
}

async function setDateViaSpinbuttons(page, sectionId, mmddyyyy) {
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

test.describe.configure({ retries: 1 });

test('@pepi C25246 Client Adjustment/Expiration Date - Amount', async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);

  /** @type {string} */
  let amountValue;
  /** @type {string} */
  let dateValue;

  await test.step('Phase 1: set Advisor adjustment to Amount + value + expiration', async () => {
    await loginAsAdmin(context, page);
    await gotoClientBilling(page);
    await openEditClientBillingSettings(page);

    const addLink = page.locator('a', { hasText: 'Add An Adjustment' }).first();
    if ((await addLink.count()) && (await addLink.isVisible())) {
      await addLink.click();
    }
    await expect(page.locator('#adviserBillingDiscountTypeDiv')).toBeVisible({
      timeout: 10_000,
    });

    const currentAmount = await page
      .locator('#adviserBillingDiscountAmountField')
      .inputValue()
      .catch(() => '');
    const numericCurrent = currentAmount.replace(/[^\d]/g, '');
    amountValue = numericCurrent === AMOUNT_A ? AMOUNT_B : AMOUNT_A;
    const currentDateBefore = await page
      .locator('#adviserBillingDiscountDate')
      .evaluate((sec) => {
        const mm = sec.querySelector('input[name="month"]')?.value;
        const dd = sec.querySelector('input[name="day"]')?.value;
        const yy = sec.querySelector('input[name="year"]')?.value;
        return mm && dd && yy ? `${mm.padStart(2, '0')}/${dd.padStart(2, '0')}/${yy}` : '';
      });
    dateValue = currentDateBefore === DATE_A ? DATE_B : DATE_A;

    // eslint-disable-next-line no-console
    console.log(
      `[C25246] advisor adjustment: amount ${JSON.stringify(currentAmount)} -> $${amountValue}, date ${JSON.stringify(currentDateBefore)} -> ${dateValue}`
    );

    await setComboBoxValue(page, 'adviserBillingDiscountType', 'Amount [$]');
    await setReactNumericInput(page, 'adviserBillingDiscountAmountField', amountValue);
    await setDateViaSpinbuttons(page, 'adviserBillingDiscountDate', dateValue);
    await saveEditClientBillingSettings(page);
  });

  await test.step('Phase 1.2: History shows 3 adjustment rows for Advisor billing', async () => {
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

    const advisorBucket = /^Advisor billing$/i;
    // The same three setting names emerge from the BE regardless of
    // discount-type direction (Percent vs Amount): the type column
    // BEFORE/AFTER strings flip, but the setting labels stay.  Verified
    // live via C25245's probe — exact strings are:
    //   "Advisor billing discount type" / "Advisor billing discount" /
    //   "Advisor expiration date".
    const checks = [
      { name: 'discount type', re: /discount\s*type/i },
      { name: 'billing discount', re: /(billing\s*discount|discount\s*amount)/i },
      { name: 'expiration date', re: /expiration\s*date/i },
    ];
    for (const c of checks) {
      const match = rowRecords.some(
        (r) =>
          c.re.test((r.setting || '').trim()) &&
          advisorBucket.test((r.billingBucket || '').trim())
      );
      expect(
        match,
        `No "${c.name}" adjustment history row for Advisor billing — first 12:\n${dumpFirstN(12)}`
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
