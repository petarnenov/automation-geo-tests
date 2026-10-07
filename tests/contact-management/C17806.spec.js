// @ts-check
/**
 * AIO GEO-TC-8103 (C17806) — Contact Management: 'Manage Contacts' page
 * availability.
 *
 * Steps 1-6 (sidebar navigation, firm picker, type-ahead, Import Contact /
 * Create new... menus) run against the worker dummy firm. Step 7 (search finds
 * an existing household, client and prospect) runs against firm 1: on qabis1
 * the searchClient autocomplete returns nothing for fresh dummy firms, and the
 * step is read-only.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const { SEARCH_PLACEHOLDER, findContact } = require('./_helpers');

/**
 * @param {import('@playwright/test').Page} page
 * @param {{firmCd: number, firmName: string}} firm
 */
async function pickFirm(page, firm) {
  const firmInput = page.locator('#selectCompany_typeAhead');
  await firmInput.click();
  await firmInput.fill('');
  await firmInput.pressSequentially(firm.firmName, { delay: 20 });
  const option = page
    .locator('[role="combo-box-list-item"]')
    .filter({ hasText: `(${firm.firmCd}) ${firm.firmName}` })
    .first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(firmInput).toHaveValue(`(${firm.firmCd}) ${firm.firmName}`, { timeout: 15_000 });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} menuId
 * @param {string} label
 */
async function expectMenuItems(page, menuId, label) {
  const menu = page.locator(`#${menuId}`);
  await expect(menu).toContainText(label);
  await menu.getByText(label, { exact: true }).click();
  // The options render in a portal, not inside the menu element.
  for (const item of ['Household', 'Client', 'Prospect']) {
    await expect(page.getByRole('link', { name: item, exact: true })).toBeVisible();
  }
  // Close the menu by clicking a neutral spot (the Search label).
  await page.locator('label.searchLabel').click();
  await expect(page.getByRole('link', { name: 'Prospect', exact: true })).toHaveCount(0);
}

test('@regression C17806 Contact Management - Manage Contacts page availability', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(240_000);

  await test.step('Login as GW admin and open Platform One', async () => {
    await loginPlatformOneAdmin(page);
  });

  await test.step('Upload Tools → Contact Management → Manage Contacts', async () => {
    const contactMgmt = page.getByText('Contact Management', { exact: true }).first();
    if (!(await contactMgmt.isVisible().catch(() => false))) {
      await page.getByText('Upload Tools', { exact: true }).first().click();
    }
    await expect(contactMgmt).toBeVisible({ timeout: 15_000 });
    await contactMgmt.click();
    const manageContacts = page.getByText('Manage Contacts', { exact: true }).first();
    await expect(manageContacts).toBeVisible({ timeout: 15_000 });
    await manageContacts.click();

    await expect(page).toHaveURL(/contactManagement\/manageContacts/, { timeout: 30_000 });
    await expect(page.locator('#selectCompany_typeAhead')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeDisabled();
  });

  await test.step('Choose Firm lists firms with their site number', async () => {
    await page.locator('#selectCompany_typeAhead').click();
    const options = page.locator('[role="combo-box-list-item"]');
    await expect(options.first()).toBeVisible({ timeout: 15_000 });
    await expect(options.first()).toHaveText(/^\(\d+\) \S/);
    expect(await options.count()).toBeGreaterThan(1);
  });

  await test.step(`Type-ahead and select dummy firm ${workerFirm.firmCd}`, async () => {
    await pickFirm(page, workerFirm);
    const options = page.locator('[role="combo-box-list-item"]');
    // Type-ahead narrowed the list to the typed firm before the pick.
    await expect(options).toHaveCount(0);
  });

  await test.step('Import Contact and Create new... menus appear', async () => {
    await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeEnabled({ timeout: 15_000 });
    await expectMenuItems(page, 'importContact', 'Import Contact');
    await expectMenuItems(page, 'addNewItem', 'Create new...');
  });

  await test.step('Search finds an existing household, client and prospect (firm 1)', async () => {
    const contacts = [];
    for (const kind of /** @type {const} */ (['household', 'client', 'prospect'])) {
      const contact = await findContact(page, 1, kind);
      test.skip(!contact, `No active ${kind} with a unique name in firm 1`);
      contacts.push(/** @type {NonNullable<typeof contact>} */ (contact));
    }
    await pickFirm(page, { firmCd: 1, firmName: 'GeoWealth Management LLC' });
    const searchBox = page.getByPlaceholder(SEARCH_PLACEHOLDER);
    for (const contact of contacts) {
      await searchBox.fill(contact.name);
      const suffix = { household: 'H', client: 'C', prospect: 'P' }[contact.kind];
      await expect(
        page
          .locator('[class*="clientAutocompleteSearchRow"]')
          .filter({ hasText: contact.name })
          .first()
      ).toContainText(`(${suffix})`, { timeout: 20_000 });
    }
  });
});
