// @ts-check
/**
 * TestRail C24935 — Billing Specification - Edit Specification for a firm
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/24935 (Run 175, label Pepi)
 *
 * Precondition: Logged in to Platform One as a Firm 1 Admin (tim1).
 *
 * TestRail steps:
 *   1. In the side navigation, go to "Operations" menu.
 *   2. Select "Billing" → "Billing Specifications".
 *   3. In the "Select Firm" dropdown, choose the desired firm.
 *   4. Hover the specification row and click the Edit icon to open it for editing.
 *
 * Implementation notes:
 *   - Steps 1-3 collapse into a single direct navigation to
 *     `#platformOne/billingCenter/specifications/1` — the route accepts the
 *     firmCd as a URL param, which is what the Select Firm picker writes
 *     into the URL anyway. Going direct skips the sidebar dance and the
 *     firm dropdown interaction.
 *   - The Billing Specs grid takes ~15-20s to render rows on qa3, even with
 *     a warm storageState session. Wait generously for the first .ag-row.
 *   - The per-row action buttons live inside `.actionRow.hiddenActionRow`
 *     and are revealed on hover; the Edit button is `<span title="Edit">`
 *     wrapping a `<Link>` that navigates to
 *     `#platformOne/billingCenter/specifications/1/edit/<billingSpecId>`.
 *   - The test verifies the URL transition (the hash now includes `/edit/`)
 *     AND that the edit form rendered (Save button visible).
 *
 * Read-only: this test never clicks Save / Delete / Copy. No state mutation.
 * Runs against firm 1's existing specs — the test asserts there is at least
 * one row, which is true on qa3 (firm 1 has multiple seeded test specs).
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const FIRM_CODE = 1;
const SPECS_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_CODE}`;

test('@pepi C24935 Billing Specification - Edit Specification for a firm', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Billing Specifications grid for firm 1', async () => {
    await page.goto(SPECS_URL);
    // The page title "Billing Specifications" is rendered as a styled <span>,
    // not a real heading element — match by text instead of role.
    await expect(
      page.getByText('Billing Specifications', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  let firstRow;
  await test.step('Wait for at least one billing spec row to render', async () => {
    firstRow = page.locator('.ag-row').first();
    // Grid render is slow on qa3 — give it up to 60s.
    await expect(firstRow).toBeVisible({ timeout: 60_000 });
  });

  await test.step('Hover the row and click the Edit icon', async () => {
    // ag-grid renders the per-row action cell as a floating element that is
    // NOT a DOM child of `.ag-row`, so we can't scope `span[title="Edit"]`
    // inside `firstRow`. Instead, hover the row to reveal its action cell
    // (CSS-driven), then click the first Edit span at the page level — the
    // first one in DOM order corresponds to the first row.
    await firstRow.hover();
    const editIcon = page.locator('span[title="Edit"]').first();
    await expect(editIcon).toBeVisible({ timeout: 5_000 });
    await editIcon.click();
  });

  await test.step('Verify the edit form opened for that spec', async () => {
    // The Link navigates to /specifications/<firmCd>/edit/<billingSpecId>.
    await expect(page).toHaveURL(
      new RegExp(`#platformOne/billingCenter/specifications/${FIRM_CODE}/edit/`),
      { timeout: 30_000 }
    );
    // The Edit form's submit button is labeled "Save Updates" (not "Save").
    // Wait for it to confirm the form actually mounted (and isn't just a
    // hash change with no body).
    await expect(
      page.getByRole('button', { name: 'Save Updates', exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
