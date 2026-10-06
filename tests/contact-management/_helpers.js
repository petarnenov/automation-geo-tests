// @ts-check
/**
 * Shared helpers for the Platform One → Contact Management → Manage Contacts
 * spec family (AIO folders "Contact Management" / "Edit Contacts").
 *
 * The page today renders only the firm picker, the Import Contact / Create
 * new... menus and a contact autocomplete (ManageContacts.tsx). Picking a
 * contact routes to its edit page:
 *   #platformOne/firmAdmin/contactManagement/{typeCd}/{firmCd}/{uuid}/{editHousehold|editClient|editProspect}
 *
 * Data source: on qabis1 the searchClient autocomplete returns nothing for
 * freshly created dummy firms, so the edit specs work on existing firm-1
 * contacts. They are strictly read-only (Reset / Cancel, never Submit) and
 * prove it: the entity is snapshotted via getClientDetailsAndSettings.do before
 * and after, and every write endpoint the edit page can reach is tracked and
 * must stay silent.
 */

const { test, expect } = require('@playwright/test');
const { acquireFileLock } = require('../_helpers/file-lock');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const SEARCH_PLACEHOLDER = 'Enter Client or Household name, or Account Number ...';

// Endpoints that persist contact changes from the edit pages:
// editHhService / editClientService (Submit) and disableEnableHHClientService.
const WRITE_ENDPOINT_RX =
  /\/(ux\/createHousehold|ux\/createClient|platformOne\/disableClient|platformOne\/enableClient)\.do/i;

/** @param {number|string} firmCd */
const manageContactsUrl = (firmCd) =>
  `/react/indexReact.do#platformOne/firmAdmin/contactManagement/manageContacts/${firmCd}`;

/**
 * Open Manage Contacts with `firmCd` pre-selected. Reloads so the SPA does not
 * keep stale state when the same hash URL is visited twice.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} firmCd
 */
async function openManageContacts(page, firmCd) {
  await page.goto(manageContactsUrl(firmCd));
  await page.reload();
  await expect(page.locator('#selectCompany_typeAhead')).toHaveValue(
    new RegExp(`\\(${firmCd}\\)`),
    {
      timeout: 30_000,
    }
  );
  await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeEnabled({ timeout: 15_000 });
}

/**
 * @typedef {{ kind: 'household'|'client'|'prospect', entityID: string,
 *   typeCd: number, name: string, firmCd: number, editType: string }} Contact
 */

/**
 * Pick one active contact of `kind` in `firmCd` through the same searchClient
 * call the autocomplete uses. Only names that are unique in the result set are
 * eligible, so the UI row the spec clicks is unambiguous.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} firmCd
 * @param {'household'|'client'|'prospect'} kind
 * @returns {Promise<Contact|null>}
 */
async function findContact(page, firmCd, kind) {
  for (const q of ['te', 'an', 'ro', 'er']) {
    const res = await page.request.get(
      `/ajaxToJson.do?what=searchClient&q=${q}&firmCd=${firmCd}&platformOneRequest=true&reactRequest=true`
    );
    expect(res.ok()).toBeTruthy();
    /** @type {any[]} */
    const rows = (await res.json()).result || [];
    const counts = new Map();
    for (const r of rows) counts.set(r.name, (counts.get(r.name) || 0) + 1);
    const match = rows.find((r) => {
      if (!r.entityActiveFlag || counts.get(r.name) !== 1 || !r.name) return false;
      if (kind === 'household') return r.type === 'household';
      if (r.type !== 'client') return false;
      return kind === 'prospect' ? r.prospect === true : r.prospect !== true;
    });
    if (match) {
      return {
        kind,
        entityID: match.entityID,
        typeCd: match.entityType,
        name: match.name,
        firmCd,
        editType: { household: 'editHousehold', client: 'editClient', prospect: 'editProspect' }[
          kind
        ],
      };
    }
  }
  return null;
}

/**
 * Same as findContact, but skips the test (not fails) when the firm has no
 * such contact.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} firmCd
 * @param {'household'|'client'|'prospect'} kind
 * @returns {Promise<Contact>}
 */
async function requireContact(page, firmCd, kind) {
  const contact = await findContact(page, firmCd, kind);
  test.skip(!contact, `No active ${kind} with a unique name found in firm ${firmCd}`);
  return /** @type {Contact} */ (contact);
}

/**
 * Type the contact name into the Manage Contacts search and click its row.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Contact} contact
 */
async function openContactFromSearch(page, contact) {
  const searchBox = page.getByPlaceholder(SEARCH_PLACEHOLDER);
  const row = page
    .locator('[class*="clientAutocompleteSearchRow"]')
    .filter({ hasText: contact.name })
    .first();
  await searchBox.click();
  await searchBox.fill(contact.name);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page).toHaveURL(
    new RegExp(
      `contactManagement/${contact.typeCd}/${contact.firmCd}/${contact.entityID}/${contact.editType}`
    ),
    { timeout: 30_000 }
  );
  await expect(footerAction(page, 'Cancel')).toBeVisible({ timeout: 30_000 });
}

/**
 * Persisted state of a contact, as the edit page loads it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Contact} contact
 */
async function snapshotContact(page, contact) {
  const res = await page.request.post('/react/getClientDetailsAndSettings.do?reactRequest=true', {
    multipart: { clientUUID: contact.entityID, clientTypeCd: String(contact.typeCd) },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body;
}

/**
 * Record every request to a contact write endpoint for the rest of the test.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {string[]} live list of offending URLs
 */
function trackContactWrites(page) {
  /** @type {string[]} */
  const writes = [];
  page.on('request', (req) => {
    if (WRITE_ENDPOINT_RX.test(req.url())) writes.push(`${req.method()} ${req.url()}`);
  });
  return writes;
}

/**
 * FormBuilder footer links ("Cancel | Reset") are plain spans.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'Cancel'|'Reset'} name
 */
function footerAction(page, name) {
  return page
    .locator('footer[data-type="formBuilderFooter"] [data-type="additionalButtons"] span')
    .filter({ hasText: new RegExp(`^${name}$`) });
}

/**
 * Expand the second set of fields and check the toggle label flips.
 *
 * @param {import('@playwright/test').Page} page
 */
async function showAdditionalSettings(page) {
  await page.getByRole('button', { name: 'Show Additional Settings' }).click();
  await expect(page.getByRole('button', { name: 'Close Additional Settings' })).toBeVisible();
  await expect(page.locator('#documentVaultRootFolderField')).toBeVisible();
}

/**
 * Fields each edit spec changes: one in the main block, one under Additional
 * Settings. Values carry a run id, so an unexpected save is easy to spot.
 *
 * @param {Contact} contact
 */
function editableFields(contact) {
  const main = contact.kind === 'household' ? '#nameField' : '#nicknameField';
  return [main, '#documentVaultRootFolderField'];
}

/**
 * Edit the fields, return their original values.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Contact} contact
 * @param {string} runId
 */
async function editFields(page, contact, runId) {
  /** @type {Record<string,string>} */
  const original = {};
  for (const sel of editableFields(contact)) {
    const input = page.locator(sel);
    original[sel] = await input.inputValue();
    const fake = `pepiNoSave ${runId}`;
    await input.fill(fake);
    await expect(input).toHaveValue(fake);
  }
  return original;
}

/**
 * Serialise firm-1 edit specs across workers: they open the same shared
 * contacts, so running two at once only adds risk.
 *
 * @returns {Promise<() => void>}
 */
function lockFirm1Contacts() {
  return acquireFileLock('firm1-manage-contacts');
}

/**
 * Shared body of the "Reset / Cancel Editing <contact>" cases:
 * Manage Contacts → firm 1 → open contact from search → Show Additional
 * Settings → edit fields → Reset (fields restored) or Cancel (back to Manage
 * Contacts). Asserts the contact was not persisted either way.
 *
 * @param {object} args
 * @param {import('@playwright/test').Page} args.page
 * @param {'household'|'client'|'prospect'} args.kind
 * @param {'Reset'|'Cancel'} args.action
 */
async function runEditContactAbort({ page, kind, action }) {
  test.setTimeout(240_000);
  const firmCd = 1;
  const runId = `${Date.now()}`;

  await loginPlatformOneAdmin(page);
  const release = await lockFirm1Contacts();
  try {
    const contact = await requireContact(page, firmCd, kind);
    const before = await snapshotContact(page, contact);
    const writes = trackContactWrites(page);

    await test.step('Manage Contacts → select firm 1', async () => {
      await openManageContacts(page, firmCd);
    });

    await test.step(`Open ${kind} "${contact.name}" from search`, async () => {
      await openContactFromSearch(page, contact);
      await expect(footerAction(page, 'Reset')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
    });

    await test.step('Show Additional Settings', async () => {
      await showAdditionalSettings(page);
    });

    /** @type {Record<string,string>} */
    let original = {};

    await test.step('Edit fields', async () => {
      original = await editFields(page, contact, runId);
    });

    if (action === 'Reset') {
      await test.step('Reset restores the initial values', async () => {
        await footerAction(page, 'Reset').click();
        for (const [sel, value] of Object.entries(original)) {
          await expect(page.locator(sel)).toHaveValue(value);
        }
        await expect(page).toHaveURL(new RegExp(`${contact.entityID}/${contact.editType}`));
      });
    } else {
      await test.step('Cancel closes the edit page', async () => {
        await footerAction(page, 'Cancel').click();
        await expect(page).toHaveURL(new RegExp(`contactManagement/manageContacts/${firmCd}$`), {
          timeout: 30_000,
        });
        await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeVisible();
        await expect(footerAction(page, 'Cancel')).toHaveCount(0);
      });
    }

    await test.step('Contact was not saved', async () => {
      expect(writes, 'no contact write request may fire').toEqual([]);
      expect(await snapshotContact(page, contact)).toEqual(before);
    });
  } finally {
    release();
  }
}

module.exports = {
  SEARCH_PLACEHOLDER,
  runEditContactAbort,
  manageContactsUrl,
  openManageContacts,
  findContact,
  requireContact,
  openContactFromSearch,
  snapshotContact,
  trackContactWrites,
  footerAction,
  showAdditionalSettings,
  editFields,
  lockFirm1Contacts,
};
