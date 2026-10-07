// @ts-check
/**
 * AIO C22320 (GEO-TC-11895) — Statement Charges - Filter by 'Status'
 *
 * Source: AIO Tests, project GEO, folder "Filters". Team: Billing&Services.
 *
 * ── About the AIO manual steps ──
 * The AIO case's written steps list run statuses (Completed, In Progress, Ready,
 * Canceled, Failed, Running) — boilerplate carried over from a Billing Runs case.
 * The Statement Charges page has no such statuses. What the case TITLE asks for —
 * "Filter by 'Status'" — is a real, shipped control: the Statement Charges filter
 * (Filter module Options panel, StatementChargesCriteria.js) has a "Status" combo.
 *
 * ── What the Status filter actually offers (verified against source) ──
 * The Status combo has exactly two options, "New" and "Processed"
 * (useBillingStatementChargesNomenclatures.nomBillingStatementChargesStatus; the BE
 * NOM_BILLING_STATEMENT_CHARGES_STATUS nomenclature is still a TODO, so the FE hard-
 * codes them). The backend maps the chosen status to the persisted `processedFlag`
 * (BillingStatementChargeDAO: `equal(processedFlag, !"New".equalsIgnoreCase(status))`)
 * — i.e. status="New" → processedFlag=false, status="Processed" → processedFlag=true.
 * Each grid row echoes its status back as `status` ("New" or "Processed"). Clicking
 * "Filter" re-fetches the grid via POST /react/getBillingStatementCharges.do.
 *
 * ── What this asserts (both statuses, per the "repeat for each status" step) ──
 * Against the endpoint's JSON (robust to ag-grid virtualisation):
 *   1. Read the unfiltered result on load (baseline) and count rows per status.
 *   2. For EACH status the combo offers that has baseline rows: reload, re-capture
 *      a FRESH unfiltered baseline from the reload's own fetch, filter, and require
 *      that every returned row carries that status, the filtered set (by
 *      billingStatementChargeID) contains every fresh-baseline row of that status
 *      and none of the other status, and the filter strictly narrowed the grid.
 * The two statuses partition the grid (New + Processed = all rows), so each filter
 * is a genuine, non-trivial narrowing.
 *
 * Assertions are set-based against the same-reload snapshot, NOT exact counts
 * against the initial load: other @regression specs create statement charges in
 * parallel, so an exact count captured a minute earlier goes stale (seen as
 * 290 vs 292 in the 8-worker run).
 *
 * Read-only: the test only filters; it creates/changes no data.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneTim1Fresh } = require('../_helpers/qa3');

const STATEMENT_CHARGES_URL =
  '/react/indexReact.do#platformOne/billingCenter/statementCharges';
const GET_CHARGES = '/react/getBillingStatementCharges.do';
const OPTION = '[role="combo-box-list-item"]';

async function openStatementCharges(page) {
  await expect(page.getByText('Statement Charges', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.ag-header-cell[col-id]').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Pick a status in the single-select Status combo and run the filter.
 * Returns the endpoint's rows for that status.
 *
 * The caller MUST hand this a freshly (re)loaded page: after a Filter submit the
 * FormBuilder marks the criteria form pristine, so a second programmatic pick on
 * the same page never re-arms the submit and the click fires no request. A reload
 * restores a clean form. (goto to the same #hash is a no-op — reload is required.)
 * @param {import('@playwright/test').Page} page
 * @param {string} status  "New" or "Processed"
 * @returns {Promise<Array<{status?:string}>>}
 */
async function filterByStatus(page, status) {
  // Open the combo (a plain click on the section header opens the list) and
  // choose the option. Poll the open+pick so a stray toggle self-heals.
  const option = page.locator(`${OPTION}:text-is("${status}")`).first();
  await expect
    .poll(
      async () => {
        if (await option.isVisible().catch(() => false)) return true;
        await page.locator('#status').click().catch(() => {});
        return await option.isVisible().catch(() => false);
      },
      { timeout: 15_000, intervals: [300, 600, 1000, 1500] }
    )
    .toBe(true);
  await option.click();
  // Single-select closes the list and shows the pick in the header.
  await expect(page.locator('#statusDiv header[role="comboBoxHeader"]')).toHaveText(status, {
    timeout: 10_000,
  });

  const respP = page.waitForResponse(
    (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
    { timeout: 60_000 }
  );
  await page.locator('button[data-role="formSubmitButton"]', { hasText: /^Filter$/ }).click();
  return (await (await respP).json()).rows || [];
}

test("@regression C22320 Statement Charges - Filter by 'Status'", async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneTim1Fresh(page);

  /** @type {Array<{status?:string}>} */
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
    await expect(page.locator('#status')).toBeVisible({ timeout: 30_000 });
  });

  // Baseline count per status. The combo offers exactly New and Processed.
  const STATUSES = ['New', 'Processed'];
  /** @type {Record<string, number>} */
  const baseCount = {};
  for (const s of STATUSES) baseCount[s] = baseline.filter((r) => r.status === s).length;
  // eslint-disable-next-line no-console
  console.log(`[C22320] baseline=${baseline.length}, New=${baseCount.New}, Processed=${baseCount.Processed}`);

  // At least two statuses must be represented, else there is no real partition.
  const present = STATUSES.filter((s) => baseCount[s] > 0);
  expect(present.length, 'both statuses need baseline rows to prove a real filter').toBe(2);

  for (const status of present) {
    await test.step(`Filter by '${status}' — only ${status} charges remain`, async () => {
      // Fresh form for each status (see filterByStatus). Reload — not goto — since
      // the page is already on this #hash route. The reload's own unfiltered fetch
      // doubles as a fresh per-iteration baseline, closing the race window that an
      // initial-load count leaves open while parallel specs seed new charges.
      const reloadResp = page.waitForResponse(
        (r) => r.url().includes(GET_CHARGES) && r.status() === 200,
        { timeout: 60_000 }
      );
      await page.reload();
      await expect(page.locator('#status')).toBeVisible({ timeout: 30_000 });
      const fresh = (await (await reloadResp).json()).rows || [];
      const freshIds = (s) =>
        new Set(
          fresh.filter((r) => r.status === s).map((r) => r.billingStatementChargeID)
        );
      const wantIds = freshIds(status);
      const otherIds = freshIds(status === 'New' ? 'Processed' : 'New');

      const filtered = await filterByStatus(page, status);
      expect(filtered.length, `${status}: filter returns rows`).toBeGreaterThan(0);
      for (const row of filtered) {
        expect(row.status, `every row is '${status}'`).toBe(status);
      }
      const filteredIds = new Set(filtered.map((r) => r.billingStatementChargeID));
      for (const id of wantIds) {
        expect(filteredIds.has(id), `${status}: fresh ${status} row ${id} survives the filter`).toBe(
          true
        );
      }
      for (const id of filteredIds) {
        expect(otherIds.has(id), `${status}: row ${id} of the other status is filtered out`).toBe(
          false
        );
      }
      expect(filtered.length, `${status}: the filter narrowed the grid`).toBeLessThan(
        fresh.length
      );
    });
  }
});
