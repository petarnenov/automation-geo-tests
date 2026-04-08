// @ts-check
/**
 * Shared helpers for the Platform One Merge Prospect spec family.
 *
 * Each merge-prospect spec follows the same UX:
 *   1. login as Platform One admin
 *   2. navigate Manage Contacts → select firm
 *   3. search for the test client → open it
 *   4. assert "Merge With Prospect" button presence (= permission enabled)
 *   5. open the merge modal → type prospect prefix → wait for autocomplete
 *   6. CANCEL — never click "Merge" then "Yes, Merge", since the operation is
 *      irreversible and consumes a real qa3 fixture.
 *
 * Specs only differ in: firm code, client name, prospect prefix, expected
 * client heading text, and (optionally) the client-page heading regex.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../../_helpers/qa3');
const { ensureProspect } = require('../../_helpers/worker-firm');

/**
 * Convenience wrapper used by every merge-prospect spec: lazily provisions a
 * prospect inside the worker dummy firm (cached per firmCd) using the test's
 * own browser, then runs the smoke flow against it.
 *
 * @param {{ page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext, workerFirm: any }} args
 */
async function runMergeProspectSmokeWithProvisionedProspect({
  page,
  context,
  workerFirm,
}) {
  const prospect = await ensureProspect(page, context, workerFirm);
  await runMergeProspectSmoke({ page, workerFirm, prospect });
}

/**
 * Run the merge-prospect UI smoke against a worker-scoped dummy firm + a
 * worker-scoped prospect that was provisioned inside that firm. The test
 * exercises the search → open client → open merge modal → autocomplete
 * prospect → cancel flow without ever committing the destructive merge.
 *
 * @param {object} args
 * @param {import('@playwright/test').Page} args.page
 * @param {{firmCd: number, firmName: string, client: {name: string}}} args.workerFirm
 * @param {{firstName: string, lastName: string}} args.prospect
 */
async function runMergeProspectSmoke({ page, workerFirm, prospect }) {
  // 300s — under parallel load the qa2 contact-search indexer can lag 60-90s
  // for a freshly-created dummy firm, and the retry loop in the "Open client"
  // step alone budgets ~100s. Plus login (~10s), modal flow (~30s), Cancel.
  test.setTimeout(300_000);

  const firmCode = workerFirm.firmCd;
  const firmDisplayName = workerFirm.firmName;
  // Dummy-firm clients are named "<lastName>, <firstName>" — split for the
  // search and the heading-match regex.
  const [lastNameRaw, firstNameRaw] = workerFirm.client.name.split(',');
  const clientLastName = lastNameRaw.trim();
  const clientFirstName = (firstNameRaw || '').trim();
  const escapedLast = clientLastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedFirst = clientFirstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clientHeadingPattern = new RegExp(`${escapedLast},\\s*${escapedFirst}`, 'i');

  await test.step(`Login and switch to firm ${firmCode} (${firmDisplayName})`, async () => {
    await loginPlatformOneAdmin(page);
    await page.goto(
      `/react/indexReact.do#platformOne/firmAdmin/contactManagement/manageContacts/${firmCode}`
    );
    const firmInput = page.locator('#selectCompany_typeAhead');
    await expect(firmInput).toBeVisible({ timeout: 30_000 });
    if (!(await firmInput.inputValue()).includes(`(${firmCode})`)) {
      await firmInput.click();
      await firmInput.fill(String(firmCode));
      await page
        .getByText(`(${firmCode}) ${firmDisplayName}`)
        .first()
        .click();
    }
    await expect(firmInput).toHaveValue(new RegExp(`\\(${firmCode}\\)`), {
      timeout: 15_000,
    });
  });

  await test.step(`Open client "${clientLastName}"`, async () => {
    // Use placeholder, NOT getByRole({name}) — once the input has a value, its
    // accessible name flips to that value, breaking re-querying inside the
    // retry loop below.
    const searchBox = page.locator(
      'input[placeholder*="Enter Client or Household"]'
    );
    const clientOption = page
      .getByText(new RegExp(`${escapedLast}.*\\(C\\)`))
      .first();
    // qa2's contact search indexer lags 30-90s for a freshly-created dummy
    // firm, especially under parallel load (multiple workers all hitting the
    // search at the same time). A single fill + 30s wait often races the
    // indexer and surfaces "No results for this search". Re-type the query
    // every ~8s so each attempt re-issues the underlying search request once
    // the indexer has caught up. 12 attempts × 8s ≈ 100s total budget.
    let lastError;
    for (let attempt = 0; attempt < 12; attempt++) {
      await searchBox.click();
      await searchBox.fill('');
      await searchBox.fill(clientLastName);
      try {
        await expect(clientOption).toBeVisible({ timeout: 8_000 });
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) {
      throw lastError;
    }
    await clientOption.click();

    await expect(
      page.getByRole('heading', { name: clientHeadingPattern })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: 'Merge With Prospect' })
    ).toBeVisible();
  });

  // Use getByPlaceholder, NOT getByRole('textbox', { name: 'Search Prospect Name' }):
  // once you type into the input, its accessible name flips from the placeholder
  // to the typed value, so the role+name locator stops matching mid-step.
  const prospectSearch = page.getByPlaceholder('Search Prospect Name');

  await test.step('Open merge modal and verify prospect autocomplete', async () => {
    await page.getByRole('button', { name: 'Merge With Prospect' }).click();

    await expect(prospectSearch).toBeVisible({ timeout: 10_000 });
    await prospectSearch.click();
    // Use the worker prospect's last-name prefix for an exact-ish match.
    await prospectSearch.fill(prospect.lastName);

    const anyProspectOption = page
      .getByRole('listbox')
      .last()
      .getByRole('option')
      .first();
    await expect(anyProspectOption).toBeVisible({ timeout: 15_000 });
  });

  await test.step('SAFETY: cancel without merging', async () => {
    // Two non-obvious traps in this step:
    //   1. The downshift autocomplete listbox from the previous step renders
    //      its <li role="option" id="downshift-..."> options as an overlay that
    //      visually covers the modal's "Cancel" element, intercepting clicks.
    //      Pressing Escape closes the listbox BUT also closes the parent modal
    //      (the modal listens for Escape too) — leaving the page with a single
    //      "Cancel | Reset" link belonging to the underlying Edit Client form.
    //   2. `getByText('Cancel').first()` then matches THAT page-level Cancel
    //      and navigates the user away from Edit Client back to Manage Contacts,
    //      so the post-cancel "Merge With Prospect" assertion fails.
    // Robust path: scope Cancel to the modal by anchoring on the sibling
    // "Merge" button (only one such button on the page — the modal's submit),
    // and force-click to bypass the autocomplete overlay without dismissing
    // either the listbox or the modal beforehand.
    const modalFooter = page
      .getByRole('button', { name: 'Merge', exact: true })
      .locator('..');
    await modalFooter
      .getByText('Cancel', { exact: true })
      .click({ force: true });
    await expect(
      page.getByRole('button', { name: 'Merge With Prospect' })
    ).toBeVisible({ timeout: 5000 });
  });
}

/**
 * Verifies that a client whose firm has MERGE PROSPECT permissions DISABLED
 * does NOT show the Merge With Prospect button on the Edit Client page. Used
 * by C26060 and C26085, both currently test.fixme'd because dummy firms have
 * the permission ENABLED by default — there is no way to provision a
 * permissions-disabled firm via /qa/createDummyFirm.do.
 */
async function runMergeProspectPermissionsDisabled({
  page,
  firmCode,
  firmDisplayName,
  clientName,
  clientHeadingPattern,
}) {
  test.setTimeout(120_000);

  await loginPlatformOneAdmin(page);
  await page.goto(
    `/react/indexReact.do#platformOne/firmAdmin/contactManagement/manageContacts/${firmCode}`
  );
  const firmInput = page.locator('#selectCompany_typeAhead');
  await expect(firmInput).toBeVisible({ timeout: 15_000 });
  if (!(await firmInput.inputValue()).includes(`(${firmCode})`)) {
    await firmInput.click();
    await firmInput.fill(String(firmCode));
    await page.getByText(`(${firmCode}) ${firmDisplayName}`).first().click();
  }
  await expect(firmInput).toHaveValue(new RegExp(`\\(${firmCode}\\)`));

  const searchBox = page.getByRole('textbox', {
    name: /Enter Client or Household/i,
  });
  await searchBox.click();
  await searchBox.fill(clientName);

  const escaped = clientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  await page.getByText(new RegExp(`${escaped}\\s*\\(C\\)`)).first().click();

  await expect(
    page.getByRole('heading', { name: clientHeadingPattern })
  ).toBeVisible({ timeout: 15_000 });

  // The Merge With Prospect button must be ABSENT (or hidden) when MERGE
  // PROSPECT permissions are disabled.
  await expect(
    page.getByRole('button', { name: 'Merge With Prospect' })
  ).toHaveCount(0, { timeout: 5000 });
}

module.exports = {
  runMergeProspectSmoke,
  runMergeProspectSmokeWithProvisionedProspect,
  runMergeProspectPermissionsDisabled,
};
