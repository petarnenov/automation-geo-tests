// @ts-check
/**
 * AIO C22318 (GEO-TC-11894) — Statement Charges - Filter by 'Advisor(s)'
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * ── About the AIO manual steps ──
 * The AIO case's written steps describe a "Submitted Date" QUARTER dropdown over a
 * grid of "runs". That text is boilerplate carried over from a Billing Runs case
 * and does not match the Statement Charges page. What the case TITLE asks for —
 * "Filter by 'Advisor(s)'" — is a real, shipped control: the Statement Charges
 * filter (Filter module Options panel, StatementChargesCriteria.js) has an
 * "Advisor(s)" multi-select. This test drives that filter.
 *
 * ── How the Advisor(s) filter works (verified against source) ──
 * For a firm-1 (platform) admin the "Advisor(s)" combo is disabled until a firm is
 * chosen in "Select Firm" (StatementChargesCriteria.js: `disabled` when no firm).
 * Its options are that firm's advisor groups + advisors, keyed by id
 * (useAdvisorsGroupOptions). Clicking "Filter" re-fetches the grid via
 * POST /react/getBillingStatementCharges.do; the backend returns a charge when its
 * advisor OR advisor-group id is in the selected set (BillingStatementChargeDAO:
 * `in(advisor.entityId, ids) OR in(advisorGroup.advisorGroupID, ids)`). Each grid
 * row echoes that id back as `advisorOrGroupID`.
 *
 * ── Strategy ──
 * Data-driven and self-adapting to whatever qa4 firm-1 data exists, asserting on
 * the endpoint's JSON (robust to ag-grid virtualisation):
 *   1. Read the unfiltered result on load (baseline, all firms).
 *   2. Pick the firm that owns the most distinct advisors-with-charges, select it,
 *      and read the combo's real id→name option map from its React state.
 *   3. Intersect "advisors that have charges" with "advisors offered by the combo"
 *      and pick one with a unique name and a small, non-trivial charge count.
 *   4. Select that advisor in the combo and click Filter.
 *   5. The filtered result: every row carries exactly the selected advisor's id,
 *      the row count equals that advisor's baseline charge count, and it is far
 *      smaller than the baseline (the filter really narrowed the grid).
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
 * Pull the Advisor(s) combo's id→name option map straight out of its React
 * fiber. The names on screen and the ids the grid echoes back live only in
 * component state, so this is the reliable bridge between "what the combo offers"
 * and "what the endpoint returns".
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Record<string,string>|null>}
 */
function readAdvisorOptions(page) {
  return page.locator('#advisorOrGroupIDDiv').evaluate((el) => {
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
            Object.keys(p.options).length > 3
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

test("@regression C22318 Statement Charges - Filter by 'Advisor(s)'", async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneTim1Fresh(page);

  /** @type {Array<{firmCd:number,firmName:string,advisorOrGroupID?:string,advisorOrGroupName?:string}>} */
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
  });

  // Firm with the most distinct advisors that actually have charges.
  let firm = { firmCd: 0, firmName: '' };
  await test.step('Pick the firm with the richest advisor data', async () => {
    /** @type {Map<number,{firmName:string,advisors:Set<string>}>} */
    const byFirm = new Map();
    for (const r of baseline) {
      if (!r.advisorOrGroupID) continue;
      if (!byFirm.has(r.firmCd)) byFirm.set(r.firmCd, { firmName: r.firmName, advisors: new Set() });
      byFirm.get(r.firmCd).advisors.add(r.advisorOrGroupID);
    }
    let best = null;
    for (const [firmCd, f] of byFirm) {
      if (!best || f.advisors.size > best.size) best = { firmCd, firmName: f.firmName, size: f.advisors.size };
    }
    expect(best, 'at least one firm has advisors with charges').toBeTruthy();
    expect(best.size, 'the chosen firm needs several advisors to filter within').toBeGreaterThanOrEqual(2);
    firm = { firmCd: best.firmCd, firmName: best.firmName };
    // eslint-disable-next-line no-console
    console.log(`[C22318] firm=${firm.firmName} (${firm.firmCd}), distinct advisors=${best.size}`);
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
    // The Advisor(s) combo enables and loads this firm's options.
    await expect(page.locator('#advisorOrGroupID')).toBeVisible({ timeout: 15_000 });
  });

  /** @type {{id:string,name:string,count:number}} */
  let target;
  await test.step('Choose an advisor that has charges AND is offered by the combo', async () => {
    // Open the combo so its options mount into React state, then read them.
    await page.locator('#advisorOrGroupID').click();
    /** @type {Record<string,string>|null} */
    let optMap = null;
    await expect
      .poll(async () => {
        optMap = await readAdvisorOptions(page);
        return optMap ? Object.keys(optMap).length : 0;
      }, { timeout: 20_000, intervals: [500, 800, 1500] })
      .toBeGreaterThan(3);

    const counts = new Map();
    for (const r of baseline) {
      if (r.firmCd !== firm.firmCd || !r.advisorOrGroupID) continue;
      counts.set(r.advisorOrGroupID, (counts.get(r.advisorOrGroupID) || 0) + 1);
    }
    const nameFreq = {};
    for (const v of Object.values(optMap)) nameFreq[v] = (nameFreq[v] || 0) + 1;
    // ids that (a) have charges, (b) are combo options, (c) have a unique label,
    // and (d) whose name has no regex/quote-hostile characters (keeps the
    // type-ahead + option match simple and deterministic).
    const clean = (n) => typeof n === 'string' && /^[A-Za-z][A-Za-z ,.'-]*$/.test(n);
    const inter = [...counts.entries()].filter(
      ([id]) => optMap[id] && nameFreq[optMap[id]] === 1 && clean(optMap[id])
    );
    expect(inter.length, 'some advisor is both offered and has charges').toBeGreaterThan(0);
    // Deterministic pick: prefer a mid-weight advisor (count in [3,100]); among
    // those take the largest count, tie-broken by name, so the same run picks the
    // same advisor regardless of the order rows came back in.
    const band = inter.filter(([, c]) => c >= 3 && c <= 100);
    const pool = band.length ? band : inter;
    pool.sort((a, b) => b[1] - a[1] || String(optMap[a[0]]).localeCompare(String(optMap[b[0]])));
    const pick = pool[0];
    target = { id: pick[0], name: optMap[pick[0]], count: pick[1] };
    expect(target.count, 'target advisor has fewer charges than the whole grid').toBeLessThan(
      baseline.length
    );
    // eslint-disable-next-line no-console
    console.log(`[C22318] advisor="${target.name}" (${target.id}), charges=${target.count}`);
  });

  await test.step('Select the advisor in the "Advisor(s)" combo', async () => {
    const advTa = page.locator('#advisorOrGroupID_typeAhead');
    await expect(advTa).toBeVisible({ timeout: 10_000 });
    await advTa.click();
    // Type the full "Last, First" name so the virtualised option list narrows to
    // the target row (a bare last name can leave it scrolled out of the window).
    await advTa.pressSequentially(target.name);
    const escaped = target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const opt = page
      .locator(MULTI_ITEM)
      .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
      .first();
    await expect(opt).toBeVisible({ timeout: 10_000 });
    await opt.click();
    // The combo keeps its list open after a pick (dontCloseList); close it by
    // clicking the page title so it can't intercept the Filter button.
    await page.getByText('Statement Charges', { exact: true }).first().click();
    // The closed header shows the selected advisor's name.
    await expect(page.locator('#advisorOrGroupID_advisorOrGroupID_header')).toHaveText(
      target.name,
      { timeout: 10_000 }
    );
  });

  /** @type {Array<{advisorOrGroupID?:string}>} */
  let filtered = [];
  await test.step('Click Filter', async () => {
    const respP = page.waitForResponse(
      (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
      { timeout: 60_000 }
    );
    await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
    filtered = (await (await respP).json()).rows || [];
  });

  await test.step('Only the selected advisor\'s charges remain', async () => {
    expect(filtered.length, 'the advisor has charges to show').toBeGreaterThan(0);
    for (const row of filtered) {
      expect(row.advisorOrGroupID, 'every row belongs to the selected advisor').toBe(target.id);
    }
    expect(filtered.length, 'row count equals the advisor\'s baseline charge count').toBe(
      target.count
    );
    expect(filtered.length, 'the filter narrowed the grid').toBeLessThan(baseline.length);
  });
});
