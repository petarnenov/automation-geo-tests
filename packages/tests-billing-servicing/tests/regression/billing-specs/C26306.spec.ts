/**
 * TestRail C26306 — Copy a billing specification to another firm
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26306
 *         (Run 175, label Pepi)
 *
 * Copies a billing spec from firm 1 (GeoWealth Management LLC) to a
 * per-worker dummy firm. Uses workerFirm for isolation — each run
 * targets a fresh firm with no billing specs, so the name-uniqueness
 * server check cannot fail.
 *
 * Uses the default `page` with tim1 storageState (GW admin).
 * workerFirm provides the target firm.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';

const FIRM_A = 1;
const FIRM_A_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_A}`;

test('@regression @billing-servicing C26306 Copy a billing specification to another firm', async ({
  page,
  workerFirm,
}) => {
  test.slow();

  const FIRM_B = workerFirm.firmCd;
  const FIRM_B_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_B}`;

  let sourceSpecName: string;
  let newSpecName: string;

  await test.step('Navigate to Billing Specifications grid for firm A', async () => {
    await page.goto(FIRM_A_URL);
    await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
  });

  await test.step('Capture the source spec name from the first row', async () => {
    const firstRowSpecCell = page
      .locator('.ag-row')
      .first()
      .locator('.ag-cell[col-id="specificationDescription"]');
    sourceSpecName = (await firstRowSpecCell.innerText()).trim();
    expect(sourceSpecName, 'firm A must have at least one named spec').toBeTruthy();
    newSpecName = `${sourceSpecName}_C26306_${Date.now()}`;
  });

  await test.step('Hover the row and click the Copy icon', async () => {
    await page.locator('.ag-row').first().hover();
    const copyIcon = page.locator('span[title="Copy"]').first();
    await expect(copyIcon).toBeVisible({ timeout: 5_000 });
    await copyIcon.click();
  });

  await test.step('Copy form opens with the source spec data pre-populated', async () => {
    await expect(page).toHaveURL(
      new RegExp(`#platformOne/billingCenter/specifications/${FIRM_A}/copy/`),
      { timeout: 30_000 }
    );
    await expect(page.locator('#specificationDescriptionField')).toHaveValue(sourceSpecName, {
      timeout: 10_000,
    });
    // Wait for React onChange handler to attach to the controlled input.
    await page.waitForFunction(
      () => {
        const input = document.querySelector('#specificationDescriptionField');
        if (!input) return false;
        const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$'));
        if (!propsKey) return false;
        const props = (input as unknown as Record<string, { onChange?: unknown }>)[propsKey];
        return !!props && typeof props.onChange === 'function';
      },
      { timeout: 15_000 }
    );
  });

  // Update spec name BEFORE firm change — changing the firm re-renders
  // the form and resets the input back to the source value.
  await test.step('Update the Specification Name to a unique value', async () => {
    const specNameInput = page.locator('#specificationDescriptionField');
    await specNameInput.click({ clickCount: 3 });
    await specNameInput.pressSequentially(newSpecName, { delay: 30 });
    await expect(specNameInput).toHaveValue(newSpecName);
  });

  await test.step(`Change Firm Name from firm ${FIRM_A} to firm ${FIRM_B}`, async () => {
    await page.getByText(`(${FIRM_A}) GeoWealth Management LLC`).first().click();
    // The dropdown is a virtualized LazyList — scroll to find the dummy firm.
    const found = await page.evaluate(async (firmCd: number) => {
      const scroller = document.querySelector('[role="combo-box-list"]');
      if (!scroller) return { status: 'no-scroller' };
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const optSel = `[role="combo-box-list-item"][data-value="${firmCd}"]`;
      if (document.querySelector(optSel)) return { status: 'already-rendered' };
      let lastCount = scroller.querySelectorAll('[role="combo-box-list-item"]').length;
      let stagnant = 0;
      for (let step = 0; step < 80; step++) {
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(120);
        if (document.querySelector(optSel)) return { status: 'scrolled-into-view', step };
        const currentCount = scroller.querySelectorAll('[role="combo-box-list-item"]').length;
        if (currentCount === lastCount) {
          stagnant++;
          if (stagnant >= 4) return { status: 'stagnated', step };
        } else {
          stagnant = 0;
          lastCount = currentCount;
        }
      }
      return { status: 'not-found' };
    }, FIRM_B);
    expect(
      found.status,
      `dummy firm ${FIRM_B} option must render in dropdown`
    ).not.toBe('not-found');

    const targetOption = page.locator(`[data-value="${FIRM_B}"]`).first();
    await expect(targetOption).toBeVisible({ timeout: 10_000 });
    await targetOption.click();
    await expect(
      page.locator('[data-key="firmCd"]').filter({ hasText: `(${FIRM_B})` })
    ).toBeVisible({ timeout: 5_000 });
    // Verify spec name wasn't reset by the firm change.
    await expect(page.locator('#specificationDescriptionField')).toHaveValue(newSpecName);
  });

  await test.step('Click Create Spec to save the copy', async () => {
    const createBtn = page.getByRole('button', { name: 'Create Spec', exact: true });
    await createBtn.scrollIntoViewIfNeeded();
    await createBtn.click();
    // The app keeps the user on the /copy/ URL and shows a "Create
    // Successful" heading. On qa2 it may also render as plain text.
    await expect(
      page.getByRole('heading', { name: 'Create Successful' })
        .or(page.getByText('Create Successful'))
    ).toBeVisible({ timeout: 60_000 });
  });

  await test.step(`Switch to firm ${FIRM_B} and locate the new spec`, async () => {
    await page.goto(FIRM_B_URL);
    await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 60_000 });
    const searchBox = page.getByPlaceholder('Search').first();
    await searchBox.click();
    await searchBox.fill(newSpecName);
    const matchingCell = page
      .locator('.ag-cell[col-id="specificationDescription"]')
      .filter({ hasText: newSpecName });
    await expect(matchingCell.first()).toBeVisible({ timeout: 30_000 });
  });
});
