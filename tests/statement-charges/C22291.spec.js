// @ts-check
/**
 * AIO C22291 (GEO-TC-11896) — Statement Charges - Filter by 'Start Date'
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * ── About the AIO manual steps ──
 * The AIO case's written steps describe a "Submitted Date" QUARTER dropdown over a
 * grid of "runs" — boilerplate carried over from a Billing Runs case that does not
 * match the Statement Charges page (it has no quarter picker). What the case TITLE
 * asks for — "Filter by 'Start Date'" — is a real, shipped control: the Statement
 * Charges filter (Filter module Options panel, StatementChargesCriteria.js) exposes
 * Start Date and End Date date-pickers plus a "Filter" submit. This is the
 * start-date twin of C22317 (End Date).
 *
 * ── What the Start Date filter does (verified against source) ──
 * Clicking "Filter" re-fetches the grid via POST /react/getBillingStatementCharges.do
 * with the criteria form as its body. The backend applies the Start Date as an
 * inclusive LOWER bound (BillingStatementChargeDAO:
 * `criteria.greaterThanOrEqualTo(root.get("startDate"), filter.startDate)`), so a
 * charge is returned only when `charge.startDate >= filterStartDate`. Charges with a
 * NULL start date fail `NULL >= X` and are excluded once a Start Date filter is set.
 *
 * ── What this asserts ──
 * Against the endpoint's JSON (robust to date formatting and row virtualisation):
 *   1. Read the unfiltered result on page load (baseline).
 *   2. Pick a boundary Start Date D from the baseline so the set is genuinely
 *      partitioned (some charges start on/after D, at least one starts before D).
 *   3. Enter D in the Start Date picker and click Filter.
 *   4. The filtered result: every row has a non-null start date >= D, the row count
 *      equals exactly the baseline rows satisfying that predicate, and it is
 *      strictly smaller than the baseline (earlier-starting charges and null-start
 *      charges are gone).
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
 * Convert a date string "MM/DD/YYYY 00:00:00" (the shape the endpoint returns) to
 * a timezone-independent day value in UTC ms. Returns null for a missing/blank date.
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

test("@regression C22291 Statement Charges - Filter by 'Start Date'", async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneTim1Fresh(page);

  /** @type {Array<{startDate?: string}>} */
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
    await expect(page.locator('#startDate')).toBeVisible({ timeout: 30_000 });
  });

  // Pick a boundary D so the filter is a real partition: a middle distinct start
  // date, but never the MINIMUM — that guarantees at least one charge starts
  // before D (so the filtered set is strictly smaller).
  let boundaryMs = 0;
  await test.step('Choose a Start Date boundary that partitions the data', async () => {
    const days = baseline
      .map((r) => dayMs(r.startDate))
      .filter((v) => v !== null)
      .sort((a, b) => a - b);
    const distinct = [...new Set(days)];
    expect(distinct.length, 'need >= 2 distinct start dates to partition').toBeGreaterThanOrEqual(2);
    // Never index 0 (the minimum) — that would keep every row. Take the middle,
    // clamped to at least index 1.
    const idx = Math.max(1, Math.floor(distinct.length / 2));
    boundaryMs = distinct[idx];

    const expectedKept = baseline.filter((r) => {
      const v = dayMs(r.startDate);
      return v !== null && v >= boundaryMs;
    }).length;
    expect(expectedKept, 'some charges start on/after the boundary').toBeGreaterThan(0);
    expect(expectedKept, 'the filter must drop at least one charge').toBeLessThan(baseline.length);
    // eslint-disable-next-line no-console
    console.log(
      `[C22291] baseline=${baseline.length}, boundary=${toMMDDYYYY(boundaryMs)}, expectedKept=${expectedKept}`
    );
  });

  /** @type {Array<{startDate?: string}>} */
  let filtered = [];

  await test.step("Enter the Start Date and click 'Filter'", async () => {
    await setReactDatePicker(page, page.locator('#startDate'), toMMDDYYYY(boundaryMs));

    const respP = page.waitForResponse(
      (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
      { timeout: 60_000 }
    );
    const filterBtn = page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ });
    await expect(filterBtn).toBeVisible({ timeout: 10_000 });
    await filterBtn.click();
    filtered = (await (await respP).json()).rows || [];
  });

  await test.step('Only charges starting on/after the Start Date remain', async () => {
    const expectedKept = baseline.filter((r) => {
      const v = dayMs(r.startDate);
      return v !== null && v >= boundaryMs;
    }).length;

    for (const row of filtered) {
      const v = dayMs(row.startDate);
      expect(v, `row ${JSON.stringify(row.startDate)} has a start date`).not.toBeNull();
      expect(v, `start date >= boundary ${toMMDDYYYY(boundaryMs)}`).toBeGreaterThanOrEqual(boundaryMs);
    }
    expect(filtered.length, 'filtered count matches the expected partition').toBe(expectedKept);
    expect(filtered.length, 'filter actually removed rows').toBeLessThan(baseline.length);
  });
});
