// @ts-check
/**
 * TestRail C25201 — Account: Commission Fee - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25201 (Run 175, label Pepi)
 *
 * Phase 1 (admin / tim106):
 *   - capture the current Commission Fee value from the summary card
 *   - open Edit, toggle the combo to the other value (Yes ↔ No), Save
 *   - assert the summary card shows the new value
 *   - cleanup: revert to the original
 *
 * Phase 2 (non-admin / tyler@plimsollfp.com):
 *   - assert no Edit Billing Settings button on the same Billing tab
 *
 * NOTE on the Commission Fee combo: this is a `comboBoxContainer` widget
 * (data-key=`commissionFreeFlag`) that does NOT respond to JS-dispatched
 * `dispatchEvent` clicks the way other comboBoxes do — the dropdown stays
 * unrendered. Playwright's `page.mouse.click(x, y)` at the header's centre
 * fires a CDP-level mouse event that DOES open it. Once open, the
 * `[role="combo-box-list-item"]` options ("Yes"/"No") are clickable normally.
 */

const { test, expect } = require('@playwright/test');
const {
  loginAsAdmin,
  loginAsNonAdmin,
  gotoAccountBilling,
  openEditBillingSettings,
  saveEditBillingSettings,
} = require('./_helpers');

/**
 * Open the commissionFreeFlag dropdown via a real CDP click on the OUTER
 * `#commissionFreeFlagDiv` wrapper (clicking the inner header silently no-ops).
 * Then click the option via another real CDP click — this combo's React
 * onChange ignores synthetic DOM clicks on list items too.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'Yes'|'No'} value
 */
async function setCommissionFee(page, value) {
  // Click outside to drop any existing focus, then click the combo wrapper.
  // Without the blur, a second invocation in the same modal session sometimes
  // fails to re-open the dropdown.
  await page.locator('body').click({ position: { x: 0, y: 0 } });
  const option = page.locator(
    `[role="combo-box-list-item"]:text-is("${value}")`
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.locator('#commissionFreeFlagDiv').click();
    if (await option.isVisible().catch(() => false)) break;
    await page.waitForTimeout(200);
  }
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
}

test('@pepi C25201 Account Commission Fee - Admin and Non-Admin', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);

  /** @type {string} */
  let originalValue;
  /** @type {'Yes'|'No'} */
  let testValue;

  await test.step('Phase 1.1: change Commission Fee', async () => {
    await loginAsAdmin(context, page);
    await gotoAccountBilling(page);

    originalValue = (
      await page
        .locator('text=Commission Fee')
        .first()
        .locator('xpath=following-sibling::*[1]')
        .innerText()
    ).trim();
    testValue = originalValue === 'Yes' ? 'No' : 'Yes';
    test.info().annotations.push({
      type: 'captured',
      description: `original=${originalValue} test=${testValue}`,
    });

    await openEditBillingSettings(page);
    await setCommissionFee(page, testValue);
    await saveEditBillingSettings(page);

    await expect(
      page
        .locator('text=Commission Fee')
        .first()
        .locator('xpath=following-sibling::*[1]')
    ).toHaveText(testValue, { timeout: 15_000 });
  });

  await test.step('Phase 1.2: cleanup — revert Commission Fee', async () => {
    await openEditBillingSettings(page);
    await setCommissionFee(page, /** @type {'Yes'|'No'} */ (originalValue));
    await saveEditBillingSettings(page);
    await expect(
      page
        .locator('text=Commission Fee')
        .first()
        .locator('xpath=following-sibling::*[1]')
    ).toHaveText(originalValue, { timeout: 15_000 });
  });

  await test.step('Phase 2: non-admin tyler cannot see Edit Billing Settings', async () => {
    await loginAsNonAdmin(context, page);
    await gotoAccountBilling(page);
    await expect(
      page.getByRole('button', { name: 'Edit Billing Settings' })
    ).toHaveCount(0);
  });
});
