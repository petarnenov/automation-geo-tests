// @ts-check
/**
 * AIO GEO-TC-7942 (legacy TestRail C18114) — Custom CRM Fields:
 *   "Custom Fields" page availability.
 *
 * Steps (AIO): Platform One sidebar → Custom CRM Fields; Firm dropdown lists
 * only active firms and supports type-ahead; picking a firm shows either the
 * 'No Custom Fields for this Firm' message or the entity grid (Entity Type /
 * Groups / Fields / Enabled / Last Edit / Remove), with an "Add Type" combo and
 * a disabled submit button beneath; switching firm re-renders the same way.
 *
 * Product notes (read from ~/nodejs/geowealth, read-only):
 *   - The sidebar category the case calls "System Admin" is now labelled
 *     "Site Customizations" (Operations → Site Customizations → Custom CRM
 *     Fields; useSideBarLinks.tsx, route /systemAdmin/customFields, shown only
 *     for firm-1 users).
 *   - The Firm combo (#selectCompany, CustomFields.tsx) is fed by
 *     /react/getWhitelabelFirmsList.do → WhitelabelAction.getFirmsList(), which
 *     drops `firm.isInactiveFlag()` server-side. The case precondition lists
 *     active firms via SQL; the DB is not reachable from the runner, so the
 *     inactive set comes from /bo/getFirms.do?inactive=true instead and the
 *     check is targeted: inactive names must not be offered, the worker's own
 *     (active) dummy firm must be — the positive control.
 *   - Grid + footer: CustomFieldsBody.tsx / columnDefs.tsx /
 *     AddItemFooter.tsx. The footer's submit is labelled "Add" (the case's
 *     "Submit"); with no Entity Type chosen it is disabled.
 *   - The firm under test stays read-only: nothing is added or removed.
 */

const { test, expect } = require('@playwright/test');

const PAGE_URL = '/react/indexReact.do#platformOne/systemAdmin/customFields';
const GRID_COLUMNS = ['Entity Type', 'Groups', 'Fields', 'Enabled', 'Last Edit', 'Remove'];

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} url
 */
async function getJson(request, url, options = {}) {
  const res = await request.fetch(url, options);
  expect(res.ok(), `${url} → ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body.success, `${url} success flag`).toBe(true);
  return body;
}

/**
 * Type into the Firm type-ahead from an empty value and return the offered
 * option labels, e.g. "(308) ABC Wealth Management".
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function typeFirm(page, text) {
  const ta = page.locator('#selectCompany_typeAhead');
  await ta.click();
  await ta.press('Control+a');
  await ta.press('Backspace');
  await ta.pressSequentially(text);
  // The list filters synchronously on input; give React one frame to commit.
  await page.waitForTimeout(500);
  return (await page.locator('[role="combo-box-list-item"]').allInnerTexts()).map((t) => t.trim());
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} firmCd
 * @param {string} firmName
 */
async function selectFirm(page, firmCd, firmName) {
  const options = await typeFirm(page, firmName);
  expect(options, `type-ahead offers (${firmCd}) ${firmName}`).toContain(`(${firmCd}) ${firmName}`);
  await page
    .locator('[role="combo-box-list-item"]')
    .filter({ hasText: `(${firmCd}) ${firmName}` })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`customFields/${firmCd}$`));
  await expect(page.locator('#selectCompany_typeAhead')).toHaveValue(`(${firmCd}) ${firmName}`);
}

/**
 * Footer common to both grid states: "Add Type" combo + disabled "Add".
 * FormBuilder may disable the submit only via a `disabled___xxx` class
 * (disabledStyleOnly), so accept either the attribute or the class.
 * @param {import('@playwright/test').Page} page
 */
async function expectAddTypeFooter(page) {
  const typeCombo = page.locator('#objectTypeDiv');
  await expect(typeCombo).toBeVisible();
  await expect(page.locator('label[for="objectTypeField"]')).toHaveText(/Add Type/);
  const addBtn = page.getByRole('button', { name: 'Add', exact: true });
  await expect(addBtn).toBeVisible();
  const disabled = await addBtn.evaluate(
    (el) => /** @type {HTMLButtonElement} */ (el).disabled || /disabled/i.test(el.className)
  );
  expect(disabled, 'Add button is disabled with no Entity Type selected').toBe(true);
}

test('@pepi C18114 Custom CRM Fields - "Custom Fields" page availability', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(180_000);

  const inactive = (await getJson(page.request, '/bo/getFirms.do?inactive=true')).rows.filter(
    (/** @type {any} */ r) => r.inactiveFirm
  );
  const active = (await getJson(page.request, '/react/getWhitelabelFirmsList.do')).rows;
  // Inactive firms whose name is not also a substring of an active firm's
  // name, so "no option offered" is unambiguous.
  const inactiveProbes = inactive
    .filter(
      (/** @type {any} */ f) =>
        !active.some((/** @type {any} */ a) => a.firmName.toLowerCase().includes(f.name.toLowerCase()))
    )
    .slice(0, 2);
  expect(inactiveProbes.length, 'env has inactive firms to probe').toBeGreaterThan(0);

  // A different active firm that already has custom fields, for the grid
  // branch of step 5/6 (read-only).
  let firmWithFields = null;
  for (const f of active) {
    if (f.firmCd === workerFirm.firmCd) continue;
    const cf = await getJson(page.request, '/bo/getListOfCustomFieldsAndGroupsAsJSON.do', {
      method: 'POST',
      multipart: { firmCd: String(f.firmCd) },
    });
    if ((cf.categories || []).length > 0) {
      firmWithFields = { firmCd: f.firmCd, firmName: f.firmName, count: cf.categories.length };
      break;
    }
  }
  expect(firmWithFields, 'env has an active firm with custom fields').not.toBeNull();
  const withFields = /** @type {{firmCd:number, firmName:string, count:number}} */ (firmWithFields);

  await test.step('1. Open Platform One', async () => {
    await page.goto('/react/indexReact.do#platformOne');
    await expect(page.getByRole('heading', { level: 4, name: 'Operations' }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('2. Sidebar → Site Customizations → Custom CRM Fields', async () => {
    const link = page.locator('a[href*="systemAdmin/customFields"]');
    if (!(await link.isVisible())) {
      const siteCustomizations = page.getByText('Site Customizations', { exact: true }).first();
      if (!(await siteCustomizations.isVisible())) {
        await page.getByRole('heading', { level: 4, name: 'Operations' }).first().click();
      }
      await siteCustomizations.hover();
    }
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click();
    await expect(page).toHaveURL(/#platformOne\/systemAdmin\/customFields/);
    await expect(page.getByText('Custom Fields', { exact: true }).first()).toBeVisible();
    await expect(page.locator('#selectCompany')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('label[for="selectCompanyField"]')).toHaveText(/Firm/);
  });

  await test.step('3. Dropdown lists active firms only', async () => {
    await page.locator('#selectCompany_typeAhead').click();
    const items = page.locator('[role="combo-box-list-item"]');
    await expect(items.first()).toBeVisible({ timeout: 10_000 });
    expect(await items.allInnerTexts()).toContain('(1) GeoWealth Management LLC');
    for (const f of inactiveProbes) {
      const offered = await typeFirm(page, f.name);
      expect(
        offered.filter((o) => o.startsWith(`(${f.id}) `)),
        `inactive firm (${f.id}) ${f.name} is not offered`
      ).toEqual([]);
    }
  });

  await test.step('4. Type-ahead filters to matching active firms', async () => {
    const offered = await typeFirm(page, workerFirm.firmName);
    expect(offered).toContain(`(${workerFirm.firmCd}) ${workerFirm.firmName}`);
    for (const o of offered) expect(o.toLowerCase()).toContain(workerFirm.firmName.toLowerCase());
  });

  await test.step('5. Firm without custom fields → message + Add Type + disabled Add', async () => {
    await selectFirm(page, workerFirm.firmCd, workerFirm.firmName);
    await expect(page.getByText('No Custom Fields for this Firm')).toBeVisible({ timeout: 30_000 });
    await expectAddTypeFooter(page);
  });

  await test.step('6. Switch to a firm with custom fields → grid + footer', async () => {
    await selectFirm(page, withFields.firmCd, withFields.firmName);
    const grid = page.locator('#customFieldsEntityGrid');
    await expect(page.getByText('No Custom Fields for this Firm')).toHaveCount(0, { timeout: 30_000 });
    // GwGrid renders its own header component (headerCell), not ag-grid's
    // default .ag-header-cell-text.
    const headers = grid.locator('.ag-header-row-column [role="columnheader"]');
    await expect(headers.first()).toBeVisible({ timeout: 30_000 });
    const headerTexts = (await headers.allInnerTexts()).map((t) => t.trim().toLowerCase()).filter(Boolean);
    expect(headerTexts).toEqual(GRID_COLUMNS.map((c) => c.toLowerCase()));
    await expect(grid.locator('.ag-center-cols-container .ag-row')).toHaveCount(withFields.count);
    await expectAddTypeFooter(page);
  });
});
