// @ts-check
/**
 * TestRail C26306 — Copy a billing specification to another firm
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26306 (Run 175, label Pepi)
 *
 * Precondition (TestRail):
 *   A billing specification (Spec_A1) exists for Firm A and is visible in the
 *   Billing Specifications grid.
 *
 * TestRail steps:
 *   1. In the Billing Specifications grid for Firm A, locate and expand the
 *      row for Spec_A1.
 *   2. Click the Copy icon in the row's open state.
 *   3. In the "Copy of [spec name]" page that opens, verify the title and
 *      that all fields are pre-populated with data from Spec_A1.
 *   4. Change the Firm Name from Firm A to Firm B.
 *   5. Update the Specification Name to a unique value.
 *   6. Click Save.
 *   7. Switch firm selection in the Billing Specifications grid to Firm B.
 *   8. Locate the new spec in Firm B's specs list.
 *
 * Implementation notes:
 *   - Firm A = 1 (GeoWealth Management LLC) — has 5+ stable seeded specs on
 *     qa2 (e.g. "test billing spec"). We only READ from firm 1, never write,
 *     so no pollution.
 *   - Firm B = a fresh dummy firm provisioned by the workerFirm fixture
 *     (`/qa/createDummyFirm.do`). Each test run gets a brand-new firm with no
 *     billing specs at all, so the name-uniqueness server check cannot fail
 *     no matter how many times the test runs. An earlier attempt used firm 3
 *     (CF Inc) and was blocked once accumulated copies stacked up — "Billing
 *     Specification name is not unique for the firm".
 *   - The Copy form's submit button is labeled "Create Spec" (not "Save"):
 *     Copy creates a NEW spec rather than updating the source.
 *   - The form's "Firm Name" is rendered as a custom comboBox: clicking the
 *     visible firm display opens a dropdown whose options carry data-value
 *     attributes equal to the firm code.
 *   - The new spec name is still timestamped per run as a safety belt; the
 *     dummy firm guarantees uniqueness on its own.
 *   - The source spec is never modified.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const FIRM_A = 1;
const FIRM_A_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_A}`;

test('@pepi C26306 Copy a billing specification to another firm', async ({ page, workerFirm }) => {
  const FIRM_B = workerFirm.firmCd;
  const FIRM_B_DISPLAY = workerFirm.firmName;
  const FIRM_B_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_B}`;

  test.setTimeout(240_000);

  // DEBUG: capture spec POST body so we can see what name is actually sent.
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().toLowerCase().includes('billingspec')) {
      const body = r.postData() || '';
      const m = body.match(/name="specificationDescription"\s+([\s\S]*?)------/);
      if (m) {
        // eslint-disable-next-line no-console
        console.log(
          '[C26306 debug] POST sent specificationDescription =',
          JSON.stringify(m[1].trim())
        );
      }
    }
  });

  await loginPlatformOneAdmin(page);

  let sourceSpecName;
  // Composed below from the captured source name + a unique suffix so the
  // test can re-run without colliding on the spec name uniqueness check.
  let newSpecName;
  await test.step('Navigate to Billing Specifications grid for firm A', async () => {
    await page.goto(FIRM_A_URL);
    await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step('Capture the source spec name from the first row', async () => {
    // The Spec Name column is `col-id="specificationDescription"` per the
    // column def. Read its text from the first row so we can later assert
    // that the Copy form pre-populates it AND derive a unique copy name.
    const firstRowSpecCell = page
      .locator('.ag-row')
      .first()
      .locator('.ag-cell[col-id="specificationDescription"]');
    sourceSpecName = (await firstRowSpecCell.innerText()).trim();
    expect(sourceSpecName, 'firm A must have at least one named spec').toBeTruthy();
    // Append a unique suffix to the source name so the new spec is guaranteed
    // not to collide with anything pre-existing in firm B.
    newSpecName = `${sourceSpecName}_C26306_${Date.now()}`;
  });

  await test.step('Hover the row and click the Copy icon', async () => {
    await page.locator('.ag-row').first().hover();
    const copyIcon = page.locator('span[title="Copy"]').first();
    await expect(copyIcon).toBeVisible({ timeout: 5_000 });
    await copyIcon.click();
  });

  await test.step('Copy form opens with the source spec data pre-populated', async () => {
    // URL transitions to /specifications/<firmA>/copy/<sourceSpecId>
    await expect(page).toHaveURL(
      new RegExp(`#platformOne/billingCenter/specifications/${FIRM_A}/copy/`),
      { timeout: 30_000 }
    );
    // The Spec Name input is pre-filled with the source spec's name.
    await expect(page.locator('#specificationDescriptionField')).toHaveValue(sourceSpecName, {
      timeout: 10_000,
    });
    // Give the form a beat to fully hydrate React state — without this the
    // subsequent triple-click + pressSequentially can land before the
    // controlled-input handlers are wired and the typed value never makes it
    // into the React store, so the POST submits the original spec name.
    await page.waitForTimeout(5_000);
  });

  // ORDER NOTE: TestRail's manual order is "change firm, then update spec
  // name". In automation we MUST do these in reverse: changing the firm
  // re-renders the React form and resets the spec name input back to the
  // source value, blowing away whatever we typed. Verified by intercepting
  // the multipart POST body — typing-after-firm-change submits the original
  // name; typing-before-firm-change submits the new name. The end state and
  // the validation surface are equivalent either way.
  await test.step('Update the Specification Name to a unique value (before firm change)', async () => {
    // qa3 React controlled inputs ignore Playwright fill() AND keyboard.type()
    // AND native value setters — the DOM input updates but the form POST still
    // submits the original value. The combination that DOES drive React state
    // correctly is triple-click + pressSequentially: triple-click selects the
    // existing text, pressSequentially types one character at a time, each
    // firing a real keydown/keypress/input event sequence React picks up.
    const specNameInput = page.locator('#specificationDescriptionField');
    await specNameInput.click({ clickCount: 3 });
    await specNameInput.pressSequentially(newSpecName, { delay: 30 });
    await expect(specNameInput).toHaveValue(newSpecName);
  });

  await test.step(`Change Firm Name from firm ${FIRM_A} to firm ${FIRM_B} (${FIRM_B_DISPLAY})`, async () => {
    // The "Firm Name" field is a custom comboBox. Click its visible header
    // (which currently shows "(1) GeoWealth Management LLC") to open the
    // dropdown, then click the option whose data-value matches the target
    // firm. The data-value attribute is the source of truth for the form's
    // internal state — clicking via getByText alone may match a non-option
    // element and leave the React state unchanged.
    await page.getByText(`(${FIRM_A}) GeoWealth Management LLC`).first().click();
    // The dropdown options are <div data-value="N"> elements rendered inside
    // a virtualized scroll list — only ~20 firms are in the DOM at any time.
    // To reach a high-numbered dummy firm we incrementally scroll the list
    // container and re-check, until the option exists. (Standard
    // scrollIntoViewIfNeeded does NOT work because the element doesn't exist
    // in the DOM until the scroll position renders it.)
    const found = await page.evaluate(async (firmCd) => {
      // The LazyList scroller is the section[role="combo-box-list"] (see
      // ComboBox.js renderList → LazyList attributes). Each option is a div
      // with role="combo-box-list-item" and data-value="<firmCd>".
      const scroller = document.querySelector('[role="combo-box-list"]');
      if (!scroller) return { status: 'no-scroller' };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const optSel = `[role="combo-box-list-item"][data-value="${firmCd}"]`;
      const dump = () =>
        Array.from(scroller.querySelectorAll('[role="combo-box-list-item"]')).map((el) =>
          el.getAttribute('data-value')
        );
      const initial = dump();
      if (document.querySelector(optSel)) {
        return { status: 'already-rendered', initialCount: initial.length, initial };
      }
      // Force loadMore by jumping straight to the bottom each iteration. The
      // LazyList onScroll handler only adds items when scrollTop >= scrollHeight - height.
      let lastCount = initial.length;
      let stagnant = 0;
      for (let step = 0; step < 80; step++) {
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(120);
        if (document.querySelector(optSel)) {
          return {
            status: 'scrolled-into-view',
            step,
            initialCount: initial.length,
            finalCount: dump().length,
          };
        }
        const currentCount = dump().length;
        if (currentCount === lastCount) {
          stagnant++;
          if (stagnant >= 4) {
            return {
              status: 'stagnated',
              step,
              initialCount: initial.length,
              finalCount: currentCount,
              tail: dump().slice(-10),
              scrollHeight: scroller.scrollHeight,
              clientHeight: scroller.clientHeight,
              scrollTop: scroller.scrollTop,
            };
          }
        } else {
          stagnant = 0;
          lastCount = currentCount;
        }
      }
      return {
        status: 'not-found',
        initialCount: initial.length,
        finalCount: dump().length,
        tail: dump().slice(-10),
      };
    }, FIRM_B);
    // eslint-disable-next-line no-console
    console.log('[C26306 debug] firm dropdown probe:', JSON.stringify(found));
    expect(
      found.status,
      `dummy firm ${FIRM_B} option must render in dropdown — ${JSON.stringify(found)}`
    ).not.toBe('not-found');
    const targetOption = page.locator(`[data-value="${FIRM_B}"]`).first();
    await expect(targetOption).toBeVisible({ timeout: 10_000 });
    await targetOption.click();
    // The list-item closes; the combo header should now show the new firm.
    await expect(
      page.locator('[data-key="firmCd"]').filter({ hasText: `(${FIRM_B})` })
    ).toBeVisible({ timeout: 5_000 });
    // Sanity-check that the spec name input STILL holds our typed value —
    // i.e. firm change didn't reset it (it shouldn't, in this order).
    await expect(page.locator('#specificationDescriptionField')).toHaveValue(newSpecName);
  });

  await test.step('Click Create Spec to save the copy', async () => {
    await page.getByRole('button', { name: 'Create Spec', exact: true }).click();
    // qa3 keeps the user on the /copy/ URL after save and shows a "Create
    // Successful" confirmation heading instead of navigating. Wait for that
    // confirmation rather than a URL transition.
    await expect(page.getByRole('heading', { name: 'Create Successful' })).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step(`Switch firm view to firm ${FIRM_B} and locate the new spec`, async () => {
    await page.goto(FIRM_B_URL);
    await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row').first()).toBeVisible({
      timeout: 60_000,
    });
    // Search for the new spec name via the grid's Search input — much faster
    // than scrolling the full list.
    const searchBox = page.getByPlaceholder('Search').first();
    await searchBox.click();
    await searchBox.fill(newSpecName);
    // The matching row's Spec Name cell should appear.
    const matchingCell = page
      .locator(`.ag-cell[col-id="specificationDescription"]`)
      .filter({ hasText: newSpecName });
    await expect(matchingCell.first()).toBeVisible({ timeout: 30_000 });
  });
});
