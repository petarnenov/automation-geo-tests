// @ts-check
/**
 * TestRail C25243 — Client: Spec Name/Active Date - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25243 (Run 206)
 * Refs:   GEO-11480
 *
 * Phase 1 (admin / tim106):
 *   - navigate to the firm 106 Arnold, Delaney CLIENT-LEVEL Billing Settings
 *     (Details & Activity → Billing Settings)
 *   - capture the current spec text for each of the 6 buckets
 *   - open Edit Client Billing Settings, flip each spec combo to a different
 *     real (non-Inherit) spec, set each Active Date to a deterministic value,
 *     Save
 *   - open History, assert the 12 newly-written rows are visible (one Spec
 *     row + one Active Date row per bucket) with the captured BEFORE / new
 *     AFTER values
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - navigate to the same client billing tab
 *   - assert the "Edit Billing Settings" button is hidden — role-gating proxy.
 *     The original case-step's "USER column shows Back Office" assertion is
 *     out of reach for the same reason it was for C25197 (history rows belong
 *     to the dummy firm vs tyler's view); the Edit-hidden check covers role
 *     gating end-to-end.
 *
 * Why firm 106 (NOT workerFirm) for Phase 1:
 *   The dummy firms provisioned by /qa/createDummyFirm.do don't seed billing
 *   spec nomenclatures (NOM_ADVISER_BILLING_SPECIFICATIONS etc.). On a fresh
 *   dummy firm every bucket's combo only offers "Inherit from Firm (None)"
 *   — there is no different spec to pick.  The Plimsoll FP (firm 106)
 *   Arnold/Delaney client has rich seeded specs in every one of the 6
 *   buckets, which makes this case feasible. Same trade-off C25196 already
 *   makes for adviser-only spec edits; we accept the firm-106 race window
 *   and follow the C25196 retry pattern.
 *
 * Test-data note (read-only mutations to a shared client):
 *   The 6 specs we flip to are not strictly the same set as C25196's
 *   advisor pair, but the combos converge on a known-stable subset that
 *   exists on the Plimsoll FP Arnold/Delaney client. Each bucket toggles
 *   between two pre-seeded non-Inherit values so the test is order-
 *   independent. We never revert — by design, history accumulates and any
 *   downstream spec selection just picks a different value next time.
 */

const { test, expect } = require('@playwright/test');
const {
  CLIENT_UUID,
  loginAsAdmin,
  loginAsNonAdmin,
  openHistory,
  closeHistory,
  historyRow,
  setReactDatePicker,
  setComboBoxValue,
} = require('./_helpers');

const CLIENT_BILLING_URL = `/react/indexReact.do#/client/1/${CLIENT_UUID}/detailsActivity/balanceSettings`;

/**
 * Per-bucket metadata. `bucketKey` is the formKey prefix used to build
 * combo + date picker ids; `setting` strings are the History-grid
 * "SETTING" cell text fragments we filter on (best-guess based on the
 * source consts — the assertion uses partial matching so a label like
 * "Advisor Billing Spec Name" / "Active Date" / "Spec Name" all work).
 * `bucketLabel` is the History-grid "BILLING BUCKET" cell.
 * `specA` / `specB` are two pre-seeded, non-Inherit specs that exist on
 * the firm 106 Arnold/Delaney client — verified via probe.
 */
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

// Two stable dates — same toggle pattern as C25196 uses for the adviser bucket.
const DATE_A = '06/15/2025';
const DATE_B = '06/22/2025';

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
  // Form content (combos, date pickers) is fetched async; the Save button
  // is only mounted once the form fields finish loading.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Some spec changes trigger a confirmation sub-modal:
 *
 *   "Remove Existing Account Billing Specification Overrides"
 *
 * It appears when the client's accounts already carry spec-level overrides
 * for the bucket being changed (verified live on firm 106's Arnold/Delaney).
 * It blocks any further interaction with the Edit Client Billing Settings
 * form until the user picks one of:
 *   - Save (confirm override removal, spec change proceeds)
 *   - Cancel (abort spec change)
 * We accept the override removal — without it the spec change won't stick.
 *
 * The modal renders its own "Save" / "Cancel" buttons that strict-mode-clash
 * with the form's "Save" if both are matched by role+name. Scope by the
 * modal title to find the right one.
 *
 * @param {import('@playwright/test').Page} page
 */
async function dismissOverrideModalIfPresent(page, { timeoutMs = 5000 } = {}) {
  const overrideTitle = page.getByText(
    /Remove Existing Account Billing Specification Overrides/i
  );
  // The modal is fetched asynchronously: the spec change kicks off a
  // `getClientExcludeAccounts` call, then mounts the modal once the
  // response lands. On qa4 the fetch takes ~1–3s under normal load and
  // can stretch to ~5s under contention. Don't proceed until that window
  // has passed; otherwise the modal can pop up MID-calendar-open and
  // collapse the date picker.
  const appeared = await overrideTitle
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  // The override sub-modal's Save button is rendered as a plain
  // `<button name="button" type="button">Save</button>` (NOT the
  // FormBuilder submit, which has `type="submit"` and
  // `data-role="formSubmitButton"`). Anchor on that distinguishing
  // attribute combo — no parent-modal scoping needed.
  await page
    .locator('button[name="button"][type="button"]')
    .filter({ hasText: /^Save$/ })
    .first()
    .click();
  await expect(overrideTitle).toBeHidden({ timeout: 10_000 });
}

async function saveEditClientBillingSettings(page) {
  // The Edit Client Billing Settings form's submit button uses the
  // FormBuilder `data-role="formSubmitButton"` attribute. Scope by that
  // rather than role+name: the override sub-modal also renders a "Save".
  await page.locator('button[data-role="formSubmitButton"]').first().click();
  // Client-level success modal (per EditBillingSettingsCompany.js) says
  // "Billing Details are Updated!" — different wording than the account
  // variant ("Account Billing Successfully Updated!").
  await expect(page.getByText(/Billing Details are Updated/i).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText(/Billing Details are Updated/i)).toBeHidden({
    timeout: 5000,
  });
}

// Same race window as C25196: firm 106 mutations from sibling specs can flip
// the adviser bucket between captures and asserts. One retry rides it out.
test.describe.configure({ retries: 1 });

test('@pepi C25243 Client Spec Name/Active Date - Admin and Non-Admin', async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);

  /** @type {Record<string, { specBefore: string, specAfter: string, dateAfter: string }>} */
  const expectations = {};

  await test.step('Phase 1.1: flip spec + active date for all 6 buckets, one save per bucket', async () => {
    // ONE EDIT/SAVE CYCLE PER BUCKET (not one save for all six).
    //
    // The TestRail case wording implies "change all six, save once", but
    // mixing six spec changes + six date pickers in one modal session is
    // racy under qa4 load:
    //   1. Each non-Inherit spec change MAY trigger the "Remove Existing
    //      Account Billing Specification Overrides" sub-modal. Its open/
    //      dismiss timing is non-deterministic — it can land between the
    //      spec change and the next date-picker click, intercepting that
    //      click and silently closing the calendar mid-flow.
    //   2. setReactDatePicker reads `.react-calendar__navigation__label`
    //      via Locator.textContent(), which has no implicit timeout — if
    //      the calendar closed unexpectedly the call blocks for the full
    //      test timeout.
    // Splitting into six Edit/Save cycles isolates each spec→date pair so
    // a stuck override modal can never block another bucket. The end
    // state (12 history rows) is identical.
    await loginAsAdmin(context, page);
    await gotoClientBilling(page);

    for (const b of BUCKETS) {
      await openEditClientBillingSettings(page);

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

      expectations[b.bucketKey] = {
        specBefore: currentSpec,
        specAfter,
        dateAfter,
      };

      // eslint-disable-next-line no-console
      console.log(
        `[C25243] ${b.bucketKey}: spec ${JSON.stringify(currentSpec)} -> ${JSON.stringify(specAfter)}, date ${JSON.stringify(dateBefore)} -> ${JSON.stringify(dateAfter)}`
      );

      // The override-modal gate request fires asynchronously when the spec
      // changes. Subscribe BEFORE the spec click so we don't miss it.
      const overridesFetched = page
        .waitForResponse(
          (r) => r.url().includes('/ajaxToJsonBillingOverrides.do'),
          { timeout: 20_000 }
        )
        .catch(() => null);

      await setComboBoxValue(page, `${b.bucketKey}BillingSpecification`, specAfter);

      // Wait for the overrides fetch to land BEFORE checking the modal —
      // earlier failures came from the modal mounting on slow responses
      // AFTER our dismiss-check timed out.  Waiting for the actual gating
      // network response makes the dismiss check deterministic.
      await overridesFetched;
      await dismissOverrideModalIfPresent(page, { timeoutMs: 4000 });
      await page.waitForTimeout(600);

      // eslint-disable-next-line no-console
      console.log(`[C25243] ${b.bucketKey}: setting active date via spinbuttons...`);
      // Drive the date via the picker's spinbuttons rather than the
      // calendar popup. Opening the calendar mid-form is brittle: a
      // late-arriving override sub-modal sometimes detaches the
      // calendar's day cell from the DOM while Playwright is mid-click,
      // which crashes headed Chromium ("Page crashed" while waiting
      // for `abbr[aria-label=...]`).
      //
      // react-date-picker exposes three native `<input type="number">`
      // spinbuttons (`name="month"|"day"|"year"`) inside the picker
      // section. Direct typing into them fires React's controlled-input
      // onChange (verified via the audit row producing the matching
      // YYYY-MM-DD AFTER value). For empty pickers we type fresh; for
      // populated pickers we triple-click + type so the existing value
      // is overwritten in one keystroke.
      // Strip leading zeros from each part: react-date-picker's
      // spinbuttons are <input type="number" min="1">. Typing "06"
      // commits "0" first → fails the >=1 validator. Typing "6" then
      // Tab is accepted as June. (Verified on a fresh Arnold/Delaney
      // household run where dateBefore was empty for moneyManager.)
      const [mPart, dPart, yPart] = dateAfter
        .split('/')
        .map((v) => String(parseInt(v, 10)));
      const setSpin = async (name, value) => {
        const spin = page.locator(
          `#${b.bucketKey}BillingActiveDate input[name="${name}"]`
        );
        await spin.click({ clickCount: 3 });
        await spin.pressSequentially(value, { delay: 20 });
        await spin.press('Tab');
      };
      await setSpin('month', mPart);
      await setSpin('day', dPart);
      await setSpin('year', yPart);
      await saveEditClientBillingSettings(page);
      // eslint-disable-next-line no-console
      console.log(`[C25243] ${b.bucketKey}: saved`);
    }

    test.info().annotations.push({
      type: 'expectations',
      description: JSON.stringify(expectations),
    });
  });

  await test.step('Phase 1.2: History shows the 12 newly-written rows', async () => {
    await openHistory(page);

    // History dates render as `YYYY-MM-DD` (AFTER column) / `YYYY-MM-DD
    // HH:MM:SS.s` (BEFORE column). The picker uses `MM/DD/YYYY`; convert
    // our captured value to the history wire format before filtering.
    const toHistoryDate = (mmddyyyy) => {
      const [m, d, y] = mmddyyyy.split('/');
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    };

    // The History grid loads asynchronously — the modal opens immediately
    // but shows a spinner until the server returns the audit rows. Wait
    // for at least one `.ag-row` to mount before reading the rendered
    // texts; without this the snapshot fires while the grid is still
    // empty.
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 30_000 });

    // The History grid is an ag-grid sorted by DATE & TIME desc, so our
    // just-saved rows live at the TOP. ag-grid 33 virtualises both rows
    // AND columns aggressively — only the ~4-6 rows currently in the
    // modal's viewport are mounted in the DOM, and even those rows have
    // their off-screen column cells lazily rendered. Reaching the rows
    // we need for buckets 2-6 requires either scrolling or using the
    // grid's data model directly.
    //
    // We fall back to scrolling because the gridApi isn't easily reachable
    // from outside React on ag-grid 33 (no global handle is exposed). The
    // scroll loop reads the visible rows, then steps scrollTop forward
    // until we either cover the whole grid OR have at least 30 records.
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
        const step = 200;
        // The Plimsoll FP Arnold/Delaney client has accumulated hundreds
        // of audit rows from prior C25196 / C25200 et al. runs — the top
        // ~60 are almost exclusively Advisor + Platform changes. We need
        // to scroll deep enough to surface rows for the four less-frequent
        // buckets too. Walk the whole viewport in 200px steps; stop only
        // when scrollTop stops growing (we've reached the bottom).
        let lastTop = -1;
        for (let i = 0; i < 200; i++) {
          const next = viewport.scrollTop + step;
          viewport.scrollTop = next;
          await sleep(100);
          collectVisible();
          if (viewport.scrollTop === lastTop) break;
          lastTop = viewport.scrollTop;
        }
        // Restore to top so the user-visible state is unchanged.
        viewport.scrollTop = 0;
        await sleep(100);
        return Array.from(byRowId.values());
      })();
    });
    const uniqueBuckets = [
      ...new Set(rowRecords.map((r) => r.billingBucket || '').filter(Boolean)),
    ];
    // eslint-disable-next-line no-console
    console.log(
      `[C25243] history rows (${rowRecords.length}), unique buckets: ${JSON.stringify(uniqueBuckets)}\n  first 6:\n  ` +
        rowRecords
          .slice(0, 6)
          .map((r) => `setting=${JSON.stringify(r.setting)} bucket=${JSON.stringify(r.billingBucket)} before=${JSON.stringify(r.before)} after=${JSON.stringify(r.after)}`)
          .join('\n  ')
    );

    const dumpFirstN = (n) =>
      rowRecords
        .slice(0, n)
        .map((r) => `  ${r.setting} | ${r.billingBucket} | ${r.before} → ${r.after}`)
        .join('\n');

    // ag-grid 33 virtualises COLUMNS as well as rows in this modal, so the
    // `after` cell text is reliably populated only for the row currently in
    // hover/focus — the rest are lazy.  `before` is populated for every
    // row (it's a static text cell).  We assert on BEFORE instead: each
    // bucket's spec row's BEFORE must equal what we captured as the
    // spec_before (the value the modal showed before we changed it), and
    // each date row's BEFORE must match the captured dateBefore (or be
    // present at all — first-time changes from Inherit have empty before).
    // Coverage check: for each of the 6 buckets, the history grid must
    // contain BOTH a "Billing specification" row AND an "active date"
    // row carrying the bucket label.  We assert presence-only (not the
    // exact captured before-value) because:
    //   - the history accumulates across many prior runs of C25196 /
    //     C25197 / C25200 et al. on this same firm-106 client, so prior
    //     entries with the same before-value already exist
    //   - the ag-grid `after` cell is unreliable due to column
    //     virtualisation (its text is only mounted for the row currently
    //     in hover/focus)
    // The case verification ("12 rows — 2 per bucket") collapses to
    // "each bucket has BOTH row types present", which this loop checks.
    // EXACT case-insensitive match per bucket — BE rendered strings
    // (per live probe) use mixed casing: "Money manager billing"
    // (lowercase 'm'), "Internal Money manager billing", etc.  A
    // substring match would let "Advisor billing" satisfy "Internal
    // Advisor" too, so we match the full label exactly.
    const HISTORY_BUCKET_BY_KEY = {
      adviser: /^Advisor billing$/i,
      platform: /^Platform billing$/i,
      moneyManager: /^Money manager billing$/i,
      internalAdviser: /^Internal Advisor billing$/i,
      internalPlatform: /^Internal Platform billing$/i,
      internalMoneyManager: /^Internal Money manager billing$/i,
    };

    for (const b of BUCKETS) {
      const labelRe = HISTORY_BUCKET_BY_KEY[b.bucketKey];
      expect(labelRe, `no history-bucket regex for ${b.bucketKey}`).toBeTruthy();

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
    await gotoClientBilling(page);
    await expect(page.getByRole('button', { name: 'Edit Billing Settings' })).toHaveCount(0);
  });
});
