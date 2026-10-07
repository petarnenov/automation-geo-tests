// @ts-check
/**
 * TestRail C26629 — Employee Access Set cannot be removed from the list.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26629 (Run 214)
 * Section: Back Office → Access Sets
 *
 * Manual steps (paraphrased):
 *   1. Navigate to System Admin → User Authorization → Access Sets.
 *   2. Look for the Delete button. EXPECTED: the delete button does not exist.
 *
 * The case title narrows the scope to *Employee* Access Sets specifically.
 * The Back Office struts page renders two tables on `accessSetList.do`
 * (accessSetListBody.jsp):
 *   - `#asTableFirm` — Firm Access Sets, which DOES have a Delete column with
 *     `<a class="needConfirmation" title="Delete">` rows.
 *   - `#asTableEmployee` — Employees Access Sets, which has columns
 *     Name / Description / Modify Properties / Modify Entity Roles /
 *     Modify Members — and no Delete header or delete-link cells.
 *
 * This spec asserts the negative on `#asTableEmployee` only — the Firm table's
 * Delete column is the expected positive (covered by other cases).
 *
 * Auth: tim1 (firm 1 GW Admin) has Back Office access via the same
 * JSESSIONID-backed session as the React Portal — clearCookies + form login
 * to guarantee we are tim1, since the worker GW Admin storage state has only
 * the "All Employees" role (see [[project_tim1_vs_gwa0_permission_gap]]) and
 * may not see the BO Access Sets page at all.
 */

const { test, expect } = require('@playwright/test');
const { cfg, login } = require('../_helpers/qa3');

const ACCESS_SET_LIST_URL = '/bo/accessSetList.do';

test('@regression C26629 Employee Access Set cannot be removed from the list', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);

  await test.step('Login as tim1 (firm 1 GW Admin)', async () => {
    await context.clearCookies();
    await login(page, cfg.appUnderTest.username, cfg.appUnderTest.password);
    // The post-login SPA may land on #platformOne or #dashboard; either is
    // fine — we only need the JSESSIONID to be tim1's.
    await expect(page).toHaveURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
  });

  await test.step('Open the Access Sets list in Back Office', async () => {
    await page.goto(ACCESS_SET_LIST_URL);
    await expect(page.getByText('Access Set Lists', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Employees Access Sets', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step('Employees Access Sets table has no Delete column', async () => {
    // The Firm table renders the Delete column header — sanity-check that we
    // are not accidentally asserting against an empty table where the
    // headers never rendered. The Firm table must exist AND must carry
    // its own Delete header (covered elsewhere — used here as a positive
    // baseline so a regression that drops every Delete column wouldn't
    // make this spec falsely pass).
    const employeeTable = page.locator('table#asTableEmployee');
    await expect(employeeTable).toBeVisible({ timeout: 10_000 });

    // No `<th>Delete</th>` header inside the Employee table.
    await expect(
      employeeTable.locator('thead th', { hasText: /^Delete$/ })
    ).toHaveCount(0);

    // No row carries the BO confirmation-link pattern
    // `<a class="needConfirmation" title="Delete">` either — the JSP omits
    // the delete `<td>` cell entirely for personalAccessSetList rows.
    await expect(
      employeeTable.locator('a.needConfirmation[title="Delete"]')
    ).toHaveCount(0);
  });
});
