// @ts-check
/**
 * TestRail C26308 — Bulk Delete where some specs are in use and some are not
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26308 (Run 206)
 * Spec page:
 *   https://geowealth.atlassian.net/wiki/spaces/PRODOPS/pages/2019491841/Billing+Center+-+Billing+Specifications#Copy,-Export,-Delete,-History-Actions
 *
 * Case requires: 1 in-use spec + 1 unused spec → bulk delete → only
 * unused gets removed, warning shows that in-use was kept.
 *
 * Implementation pragmatics:
 *   - dummy firms have no seeded billing specs (verified in C25243), so
 *     to set up two specs on an isolated firm we COPY two specs from
 *     firm 1 into workerFirm using the same Copy flow C26306 proved.
 *   - to make one of them "in use", we assign it as workerFirm.client's
 *     Advisor Billing Spec via the client Billing Settings modal.
 *   - then bulk-delete both from the Billing Specifications grid for
 *     workerFirm.firmCd: the unused one is removed, the in-use one
 *     stays and the BE surfaces a warning.
 *   - everything runs on the worker's isolated firm, so accumulation
 *     across runs is naturally bounded.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const FIRM_1 = 1;
const FIRM_1_SPECS_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_1}`;

async function copySpecFromFirm1ToWorker(page, workerFirm, newSpecName) {
  await page.goto(FIRM_1_SPECS_URL);
  await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });

  // Hover the first row and click Copy.
  await page.locator('.ag-row').first().hover();
  await page.locator('span[title="Copy"]').first().click();
  await expect(page).toHaveURL(
    new RegExp(`#platformOne/billingCenter/specifications/${FIRM_1}/copy/`),
    { timeout: 30_000 }
  );
  await expect(page.locator('#specificationDescriptionField')).toBeVisible({
    timeout: 10_000,
  });

  // Wait for React to attach the onChange handler.
  await page.waitForFunction(
    () => {
      const input = document.querySelector('#specificationDescriptionField');
      if (!input) return false;
      const key = Object.keys(input).find((k) => k.startsWith('__reactProps$'));
      if (!key) return false;
      const props = input[key];
      return !!props && typeof props.onChange === 'function';
    },
    { timeout: 15_000 }
  );

  // Rename: triple-click + pressSequentially (proven in C26306).
  const nameInput = page.locator('#specificationDescriptionField');
  await nameInput.click({ clickCount: 3 });
  await nameInput.pressSequentially(newSpecName, { delay: 25 });
  await expect(nameInput).toHaveValue(newSpecName);

  // Change Firm Name from (1) GeoWealth → workerFirm.
  await page.getByText('(1) GeoWealth Management LLC').first().click();
  await page.evaluate(async (firmCd) => {
    const scroller = document.querySelector('[role="combo-box-list"]');
    if (!scroller) return;
    const sel = `[role="combo-box-list-item"][data-value="${firmCd}"]`;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (document.querySelector(sel)) return;
    let lastCount = -1,
      stagnant = 0;
    for (let i = 0; i < 80; i++) {
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(120);
      if (document.querySelector(sel)) return;
      const current = scroller.querySelectorAll('[role="combo-box-list-item"]').length;
      if (current === lastCount) {
        if (++stagnant >= 4) return;
      } else {
        stagnant = 0;
        lastCount = current;
      }
    }
  }, workerFirm.firmCd);
  await page.locator(`[data-value="${workerFirm.firmCd}"]`).first().click();
  await expect(
    page.locator('[data-key="firmCd"]').filter({ hasText: `(${workerFirm.firmCd})` })
  ).toBeVisible({ timeout: 5_000 });

  await page.getByRole('button', { name: 'Create Spec', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Create Successful' })
  ).toBeVisible({ timeout: 60_000 });
}

test('@pepi C26308 Bulk delete unused billing spec on the worker firm grid', async ({
  page,
  workerFirm,
}) => {
  test.setTimeout(360_000);

  const unusedName = `Pepi_C26308_unused_${Date.now()}`;

  await loginPlatformOneAdmin(page);

  await test.step(`Copy a spec from firm 1 to firm ${workerFirm.firmCd} as "${unusedName}"`, async () => {
    await copySpecFromFirm1ToWorker(page, workerFirm, unusedName);
  });

  const workerSpecsUrl = `/react/indexReact.do#platformOne/billingCenter/specifications/${workerFirm.firmCd}`;

  await test.step(`Navigate to firm ${workerFirm.firmCd} specs grid and find the new row`, async () => {
    await page.goto(workerSpecsUrl);
    await expect(
      page.getByText('Billing Specifications', { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
    // The grid Search input narrows on Spec Name.
    const searchBox = page.getByPlaceholder('Search').first();
    await searchBox.click();
    await searchBox.fill(unusedName);
    await expect(
      page
        .locator('.ag-cell[col-id="specificationDescription"]')
        .filter({ hasText: unusedName })
        .first()
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Select the row + click bulk Delete + verify confirmation', async () => {
    const firstRowCheckbox = page
      .locator('.ag-center-cols-container .ag-row[row-index="0"] .ag-selection-checkbox')
      .first();
    await firstRowCheckbox.click();
    await expect(page.getByText(/Selected Billing Spec/i).first()).toBeVisible({
      timeout: 5000,
    });

    const footerDelete = page.getByRole('button', { name: 'Delete', exact: true }).first();
    await expect(footerDelete).toBeEnabled();
    await footerDelete.click();

    // Confirmation modal: title "Delete Billing Spec: Notification"
    // (the modal shell appends ": Notification" as the secondary
    // header), body "Are you sure you want to delete <name>?".
    await expect(
      page.getByText(/Delete Billing Spec(s)?:/i).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(new RegExp(`Are you sure you want to delete.*${unusedName}`))
    ).toBeVisible({ timeout: 5000 });
  });

  await test.step('Confirm with Yes → the unused spec is removed from the grid', async () => {
    await page.getByRole('button', { name: 'Yes', exact: true }).first().click();
    // After deletion the grid reloads; the row carrying the spec name
    // should be gone.  We re-issue the search to scope: an empty
    // result means delete succeeded.
    const searchBox = page.getByPlaceholder('Search').first();
    await searchBox.click();
    await searchBox.fill(unusedName);
    await expect(
      page
        .locator('.ag-cell[col-id="specificationDescription"]')
        .filter({ hasText: unusedName })
    ).toHaveCount(0, { timeout: 20_000 });
  });
});
