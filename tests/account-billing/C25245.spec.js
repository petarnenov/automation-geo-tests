// @ts-check
/**
 * TestRail C25245 — Client: Adjustment/Expiration Date - Percent [%] -
 *                   Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25245 (Run 206)
 * Refs:   GEO-11480
 *
 * Phase 1 (admin / tim106):
 *   - open Edit Client Billing Settings on the Plimsoll FP Arnold/Delaney
 *     client
 *   - for the Advisor billing bucket (case says "for ANY of the 6
 *     buckets"), click "Add An Adjustment" if the inline form isn't
 *     already shown
 *   - set Adjustment Type = "Percent [%]"
 *   - type a percent value (0-100)
 *   - set the Expiration Date via the picker spinbuttons
 *     (calendar-popup drilling is brittle here — see C25243's findings)
 *   - Save the modal
 *   - open History and assert three audit rows landed for the Advisor
 *     billing bucket: discount type, discount value, expiration date
 *
 * Phase 2 (non-admin / tyler):
 *   - navigate to the same client billing tab and assert the "Edit
 *     Billing Settings" button is hidden.
 *
 * Test data accumulation: the modal has no "remove adjustment" UI, so
 * each run leaves an adjustment in place that the next run UPDATES
 * (similar to C25198 / C25199 at account level). We always set a
 * deterministic value, then alternate between two values per run so the
 * audit row is always a real change.
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

const PERCENT_A = '7';
const PERCENT_B = '11';
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

/**
 * Type a MM/DD/YYYY date into the picker section's three native
 * spinbuttons (month/day/year). The calendar-popup drill was found to
 * race with React commits on the client modal — direct spinbutton
 * typing is reliable AND commits to React state on Tab-out.
 */
async function setDateViaSpinbuttons(page, sectionId, mmddyyyy) {
  // Strip leading zeros: spinbuttons are <input type="number" min="1">
  // and intermediate "0" while typing "06" trips the validator.
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

test('@pepi C25245 Client Adjustment/Expiration Date - Percent', async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);

  // Alternate between two values per run so we ALWAYS produce a real
  // change (the form's onChange is no-op when the new value equals the
  // current one).  We don't know which one was last saved, so we read
  // it from the form and pick the OTHER.
  /** @type {string} */
  let percentValue;
  /** @type {string} */
  let dateValue;

  await test.step('Phase 1: set Advisor adjustment to Percent + value + expiration', async () => {
    await loginAsAdmin(context, page);
    await gotoClientBilling(page);
    await openEditClientBillingSettings(page);

    // If no adjustment exists yet, click "Add An Adjustment" inside the
    // Advisor section to expand the inline form. Once expanded, the link
    // is gone and the form fields mount.
    const addLink = page.locator('a', { hasText: 'Add An Adjustment' }).first();
    if ((await addLink.count()) && (await addLink.isVisible())) {
      await addLink.click();
    }
    await expect(page.locator('#adviserBillingDiscountTypeDiv')).toBeVisible({
      timeout: 10_000,
    });

    // Read current value to pick the OTHER.
    const currentAmount = await page
      .locator('#adviserBillingDiscountAmountField')
      .inputValue()
      .catch(() => '');
    percentValue = currentAmount.replace(/[^\d]/g, '') === PERCENT_A ? PERCENT_B : PERCENT_A;
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
      `[C25245] advisor adjustment: percent ${JSON.stringify(currentAmount)} -> ${percentValue}, date ${JSON.stringify(currentDateBefore)} -> ${dateValue}`
    );

    await setComboBoxValue(page, 'adviserBillingDiscountType', 'Percent [%]');
    await setReactNumericInput(page, 'adviserBillingDiscountAmountField', percentValue);
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
    const uniqueSettings = [
      ...new Set(rowRecords.map((r) => r.setting || '').filter(Boolean)),
    ];
    // eslint-disable-next-line no-console
    console.log(
      `[C25245] history rows (${rowRecords.length}), unique settings: ${JSON.stringify(uniqueSettings)}`
    );

    const advisorBucket = /^Advisor billing$/i;
    // Case wording: "1 row discount type, 1 row billing discount, 1 row
    // expiration date".  The BE renders these as three distinct setting
    // values — we match on the keyword in the SETTING column.
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
        `No "${c.name}" adjustment history row for Advisor billing — first 12:\n${dumpFirstN(12)}\nunique settings: ${JSON.stringify(uniqueSettings)}`
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
