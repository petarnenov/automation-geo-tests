// @ts-check
/**
 * AIO C22319 (GEO-TC-11893) — Statement Charges - Filter by 'Split Advisor(s)'
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * ── About the AIO manual steps ──
 * The AIO case's written steps describe a "Submitted Date" QUARTER dropdown over a
 * grid of "runs" — boilerplate carried over from a Billing Runs case that does not
 * match this page. What the case TITLE asks for — "Filter by 'Split Advisor(s)'" —
 * is a real, shipped control: the Statement Charges filter (Filter module Options
 * panel, StatementChargesCriteria.js) has a "Split Advisor(s)" multi-select. This
 * test drives that filter. It is the split-advisor twin of C22318 (Advisor(s)).
 *
 * ── How the Split Advisor(s) filter works (verified against source) ──
 * For a firm-1 (platform) admin the "Split Advisor(s)" combo is disabled until a
 * firm is chosen in "Select Firm" (StatementChargesCriteria.js: shared `disabled`).
 * Its options are that firm's advisor groups + advisors, keyed by id, exactly the
 * same option set as the Advisor(s) combo (both come from
 * useAdvisorsGroupOptions(selectedFirmCd)). Clicking "Filter" re-fetches the grid
 * via POST /react/getBillingStatementCharges.do; the backend returns a charge when
 * its split-advisor OR split-advisor-group id is in the selected set
 * (BillingStatementChargeDAO: `in(splitAdvisor.entityId, ids) OR
 * in(splitAdvisorGroup.advisorGroupID, ids)`). Each grid row echoes that id back as
 * `splitAdvisorOrGroupID`.
 *
 * ── Strategy ──
 * Data-driven and self-adapting to whatever qa4 firm-1 data exists, asserting on
 * the endpoint's JSON (robust to ag-grid virtualisation):
 *   1. Read the unfiltered result on load (baseline, all firms).
 *   2. Pick the firm that owns the most distinct split-advisors-with-charges,
 *      select it, and read the Split combo's real id->name option map from its
 *      React state.
 *   3. Intersect "split-advisors that have charges" with "options the combo
 *      offers" and pick one with a unique name (prefer a non-trivial count).
 *   4. Select that split advisor in the combo and click Filter.
 *   5. The filtered result: every row carries exactly the selected id, the row
 *      count equals that split advisor's baseline charge count, and it is smaller
 *      than the baseline (the filter really narrowed the grid).
 *
 * Read-only: the test only filters; it creates/changes no data.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const STATEMENT_CHARGES_URL =
  '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET_CHARGES = '/react/getBillingStatementCharges.do';
const MULTI_ITEM = '[role="combo-box-multi-list-item"]';

/**
 * Pull the Split Advisor(s) combo's id->name option map straight out of its React
 * fiber. The on-screen names and the ids the grid echoes back live only in
 * component state, so this bridges "what the combo offers" and "what the endpoint
 * returns".
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Record<string,string>|null>}
 */
function readSplitOptions(page) {
  return page.locator('#splitAdvisorOrGroupIDDiv').evaluate((el) => {
    let node = /** @type {any} */ (el);
    for (let hop = 0; hop < 30 && node; hop++) {
      const fk = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
      if (fk) {
        let fiber = node[fk];
        for (let up = 0; up < 40 && fiber; up++) {
          const p = fiber.memoizedProps;
          if (
            p &&
            p.options &&
            typeof p.options === 'object' &&
            !Array.isArray(p.options) &&
            Object.keys(p.options).length > 0
          ) {
            /** @type {Record<string,string>} */
            const out = {};
            for (const k of Object.keys(p.options)) out[k] = p.options[k] && p.options[k].name;
            return out;
          }
          fiber = fiber.return;
        }
      }
      node = node.parentElement;
    }
    return null;
  });
}

async function openStatementCharges(page) {
  await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
}

test("@pepi C22319 Statement Charges - Filter by 'Split Advisor(s)'", async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneTim1Fresh(page);

  /** @type {Array<{firmCd:number,firmName:string,splitAdvisorOrGroupID?:string,splitAdvisorOrGroupName?:string}>} */
  let baseline = [];

  await test.step('Open Statement Charges and capture the unfiltered result', async () => {
    const respP = page.waitForResponse(
      (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
      { timeout: 60_000 }
    );
    await page.goto(STATEMENT_CHARGES_URL);
    await openStatementCharges(page);
    baseline = (await (await respP).json()).rows || [];
    expect(baseline.length, 'firm-1 Statement Charges has data to filter').toBeGreaterThan(0);
    const anySplit = baseline.some((r) => r.splitAdvisorOrGroupID);
    expect(anySplit, 'some charges carry a split advisor to filter by').toBe(true);
  });

  // Firm with the most distinct split-advisors that actually have charges.
  let firm = { firmCd: 0, firmName: '' };
  await test.step('Pick the firm with the richest split-advisor data', async () => {
    /** @type {Map<number,{firmName:string,split:Set<string>}>} */
    const byFirm = new Map();
    for (const r of baseline) {
      if (!r.splitAdvisorOrGroupID) continue;
      if (!byFirm.has(r.firmCd)) byFirm.set(r.firmCd, { firmName: r.firmName, split: new Set() });
      byFirm.get(r.firmCd).split.add(r.splitAdvisorOrGroupID);
    }
    let best = null;
    for (const [firmCd, f] of byFirm) {
      if (!best || f.split.size > best.size) best = { firmCd, firmName: f.firmName, size: f.split.size };
    }
    expect(best, 'at least one firm has split advisors with charges').toBeTruthy();
    firm = { firmCd: best.firmCd, firmName: best.firmName };
    // eslint-disable-next-line no-console
    console.log(`[C22319] firm=${firm.firmName} (${firm.firmCd}), distinct split advisors=${best.size}`);
  });

  await test.step('Select the firm in "Select Firm"', async () => {
    const firmTa = page.locator('#firmCd_typeAhead');
    await expect(firmTa).toBeVisible({ timeout: 20_000 });
    await firmTa.click();
    await firmTa.pressSequentially(firm.firmName.split(/\s/)[0]);
    const firmOpt = page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: new RegExp(`\\(${firm.firmCd}\\)`) })
      .first();
    await expect(firmOpt).toBeVisible({ timeout: 10_000 });
    await firmOpt.evaluate((el) => /** @type {HTMLElement} */ (el).click());
    // The Split Advisor(s) combo enables and loads this firm's options.
    await expect(page.locator('#splitAdvisorOrGroupID')).toBeVisible({ timeout: 15_000 });
  });

  /** @type {{id:string,name:string,count:number}} */
  let target;
  await test.step('Choose a split advisor that has charges AND is offered by the combo', async () => {
    // The option map lives in the combo's React props whether or not the list is
    // open, so read it without opening (opening here and re-opening in the next
    // step races the dropdown's toggle).
    /** @type {Record<string,string>|null} */
    let optMap = null;
    await expect
      .poll(async () => {
        optMap = await readSplitOptions(page);
        return optMap ? Object.keys(optMap).length : 0;
      }, { timeout: 20_000, intervals: [500, 800, 1500] })
      .toBeGreaterThan(0);

    const counts = new Map();
    for (const r of baseline) {
      if (r.firmCd !== firm.firmCd || !r.splitAdvisorOrGroupID) continue;
      counts.set(r.splitAdvisorOrGroupID, (counts.get(r.splitAdvisorOrGroupID) || 0) + 1);
    }
    const nameFreq = {};
    for (const v of Object.values(optMap)) nameFreq[v] = (nameFreq[v] || 0) + 1;
    // ids that (a) have charges, (b) are combo options, (c) have a unique label,
    // and (d) whose name has no regex/quote-hostile characters.
    const clean = (n) => typeof n === 'string' && /^[A-Za-z][A-Za-z ,.'-]*$/.test(n);
    const inter = [...counts.entries()].filter(
      ([id]) => optMap[id] && nameFreq[optMap[id]] === 1 && clean(optMap[id])
    );
    expect(inter.length, 'some split advisor is both offered and has charges').toBeGreaterThan(0);
    // Deterministic pick: prefer a split advisor with >=2 charges (a single-row
    // advisor is fragile if that one charge is retagged); among those take the
    // smallest count, tie-broken by name, so the same run picks the same target.
    const multi = inter.filter(([, c]) => c >= 2);
    const pool = multi.length ? multi : inter;
    pool.sort((a, b) => a[1] - b[1] || String(optMap[a[0]]).localeCompare(String(optMap[b[0]])));
    const pick = pool[0];
    target = { id: pick[0], name: optMap[pick[0]], count: pick[1] };
    expect(target.count, 'target has fewer charges than the whole grid').toBeLessThan(
      baseline.length
    );
    // eslint-disable-next-line no-console
    console.log(`[C22319] split advisor="${target.name}" (${target.id}), charges=${target.count}`);
  });

  await test.step('Select the split advisor in the "Split Advisor(s)" combo', async () => {
    const escaped = target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const opt = page
      .locator(MULTI_ITEM)
      .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
      .first();
    // Open the combo and type the full "Last, First" / group name so the
    // virtualised option list narrows to the target row. Poll the open+type so a
    // stray toggle (list opened then closed) self-heals instead of flaking.
    const header = page.locator('#splitAdvisorOrGroupID_splitAdvisorOrGroupIDField_header, #splitAdvisorOrGroupIDDiv header[role="comboBoxHeader"]').first();
    await expect
      .poll(
        async () => {
          if (await opt.isVisible().catch(() => false)) return true;
          const advTa = page.locator('#splitAdvisorOrGroupID_typeAhead');
          if (!(await advTa.isVisible().catch(() => false))) {
            await header.click().catch(() => {});
            return false;
          }
          await advTa.click().catch(() => {});
          await advTa.fill('').catch(() => {});
          await advTa.pressSequentially(target.name).catch(() => {});
          return await opt.isVisible().catch(() => false);
        },
        { timeout: 20_000, intervals: [400, 700, 1000, 1500] }
      )
      .toBe(true);
    await opt.click();
    // The combo keeps its list open after a pick (dontCloseList); close it by
    // clicking the page title so it can't intercept the Filter button.
    await page.getByText('Statement Charges', { exact: true }).first().click();
    // The closed header shows the selected split advisor's name.
    await expect(
      page.locator('#splitAdvisorOrGroupID_splitAdvisorOrGroupID_header')
    ).toHaveText(target.name, { timeout: 10_000 });
  });

  /** @type {Array<{splitAdvisorOrGroupID?:string}>} */
  let filtered = [];
  await test.step('Click Filter', async () => {
    const respP = page.waitForResponse(
      (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
      { timeout: 60_000 }
    );
    await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
    filtered = (await (await respP).json()).rows || [];
  });

  await test.step('Only the selected split advisor\'s charges remain', async () => {
    expect(filtered.length, 'the split advisor has charges to show').toBeGreaterThan(0);
    for (const row of filtered) {
      expect(row.splitAdvisorOrGroupID, 'every row belongs to the selected split advisor').toBe(
        target.id
      );
    }
    expect(filtered.length, 'row count equals the split advisor\'s baseline charge count').toBe(
      target.count
    );
    expect(filtered.length, 'the filter narrowed the grid').toBeLessThan(baseline.length);
  });
});
