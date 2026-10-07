// @ts-check
/**
 * AIO C22317 (GEO-TC-11897) — Statement Charges - Filter by 'End Date'
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * ── About the AIO manual steps ──
 * The AIO case's written steps describe a "Submitted Date" QUARTER dropdown
 * (prior/future 4 quarters, "Current Quarter", a "Custom" range) over a grid of
 * "runs". That step text is boilerplate carried over from a Billing Runs case and
 * does NOT match the Statement Charges page: this page has no quarter picker. What
 * the case TITLE asks for — "Filter by 'End Date'" — is a real, shipped control.
 * The Statement Charges filter (Filter module Options panel,
 * StatementChargesCriteria.js) exposes Start Date and End Date date-pickers plus a
 * "Filter" submit. This test drives the actual End Date filter.
 *
 * ── What the End Date filter does (verified against source) ──
 * Clicking "Filter" re-fetches the grid via POST /react/getBillingStatementCharges.do
 * with the criteria form as its body (StatementCharges.js →
 * usePassSelectedFilterAsFirstParamToService; billingStatementChargesServices.get).
 * The backend applies the End Date as an inclusive upper bound
 * (BillingStatementChargeDAO: `criteria.lessThanOrEqualTo(root.get("endDate"),
 * filter.endDate)`), so a charge is returned only when `charge.endDate <= filterEndDate`.
 * Charges with a NULL end date fail `NULL <= X` and are therefore excluded once an
 * End Date filter is set.
 *
 * ── What this asserts ──
 * The assertions run against the endpoint's JSON (not the virtualised ag-grid), so
 * they are robust to date formatting and row virtualisation:
 *   1. Read the unfiltered result on page load (baseline).
 *   2. Pick a boundary End Date D from the baseline data so the set is genuinely
 *      partitioned (some charges end on/before D, at least one ends after D).
 *   3. Enter D in the End Date picker and click Filter.
 *   4. The filtered result: every row has a non-null end date <= D, the row count
 *      equals exactly the baseline rows satisfying that predicate, and it is
 *      strictly smaller than the baseline (the filter really removed rows —
 *      later-ending charges and null-end-date charges are gone).
 *
 * Read-only: the test only filters; it creates/changes no data.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');
const { setReactDatePicker } = require('../_helpers/ui');

const STATEMENT_CHARGES_URL =
  '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET_CHARGES = '/react/getBillingStatementCharges.do';

/**
 * Convert an end-date string "MM/DD/YYYY 00:00:00" (the shape the endpoint
 * returns) to a timezone-independent day value in UTC ms. Returns null for a
 * missing/blank date.
 * @param {string|null|undefined} s
 * @returns {number|null}
 */
function dayMs(s) {
  if (!s) return null;
  const datePart = String(s).trim().split(/\s+/)[0];
  const [mm, dd, yy] = datePart.split('/').map((v) => parseInt(v, 10));
  if (!mm || !dd || !yy) return null;
  return Date.UTC(yy, mm - 1, dd);
}

/** UTC ms → "MM/DD/YYYY" for the date picker. */
function toMMDDYYYY(ms) {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

test("@regression C22317 Statement Charges - Filter by 'End Date'", async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneTim1Fresh(page);

  /** @type {Array<{endDate?: string}>} */
  let baseline = [];

  await test.step('Open Statement Charges and capture the unfiltered result', async () => {
    const respP = page.waitForResponse(
      (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
      { timeout: 60_000 }
    );
    await page.goto(STATEMENT_CHARGES_URL);
    await expect(
      page.getByText('Statement Charges', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    baseline = (await (await respP).json()).rows || [];
    expect(baseline.length, 'firm-1 Statement Charges has data to filter').toBeGreaterThan(0);
    // The End Date filter control must be present and expanded.
    await expect(page.locator('#endDate')).toBeVisible({ timeout: 30_000 });
  });

  // Pick a boundary D from the data so the filter is a real partition: choose a
  // middle distinct end date, but never the maximum — that guarantees at least
  // one charge ends after D (so the filtered set is strictly smaller).
  let boundaryMs = 0;
  await test.step('Choose an End Date boundary that partitions the data', async () => {
    const days = baseline
      .map((r) => dayMs(r.endDate))
      .filter((v) => v !== null)
      .sort((a, b) => a - b);
    const distinct = [...new Set(days)];
    expect(distinct.length, 'need >= 2 distinct end dates to partition').toBeGreaterThanOrEqual(2);
    const idx = Math.min(Math.floor(distinct.length / 2), distinct.length - 2);
    boundaryMs = distinct[idx];

    const expectedKept = baseline.filter((r) => {
      const v = dayMs(r.endDate);
      return v !== null && v <= boundaryMs;
    }).length;
    expect(expectedKept, 'some charges end on/before the boundary').toBeGreaterThan(0);
    expect(expectedKept, 'the filter must drop at least one charge').toBeLessThan(baseline.length);
    // eslint-disable-next-line no-console
    console.log(
      `[C22317] baseline=${baseline.length}, boundary=${toMMDDYYYY(boundaryMs)}, expectedKept=${expectedKept}`
    );
  });

  /** @type {Array<{endDate?: string}>} */
  let filtered = [];

  await test.step("Enter the End Date and click 'Filter'", async () => {
    await setReactDatePicker(page, page.locator('#endDate'), toMMDDYYYY(boundaryMs));

    const respP = page.waitForResponse(
      (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
      { timeout: 60_000 }
    );
    const filterBtn = page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ });
    await expect(filterBtn).toBeVisible({ timeout: 10_000 });
    await filterBtn.click();
    filtered = (await (await respP).json()).rows || [];
  });

  await test.step('Only charges ending on/before the End Date remain', async () => {
    const expectedKept = baseline.filter((r) => {
      const v = dayMs(r.endDate);
      return v !== null && v <= boundaryMs;
    }).length;

    // Every returned charge respects the inclusive upper bound and none is null.
    for (const row of filtered) {
      const v = dayMs(row.endDate);
      expect(v, `row ${JSON.stringify(row.endDate)} has an end date`).not.toBeNull();
      expect(v, `end date <= boundary ${toMMDDYYYY(boundaryMs)}`).toBeLessThanOrEqual(boundaryMs);
    }
    expect(filtered.length, 'filtered count matches the expected partition').toBe(expectedKept);
    expect(filtered.length, 'filter actually removed rows').toBeLessThan(baseline.length);
  });
});
