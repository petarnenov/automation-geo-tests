// @ts-check
/**
 * Per-worker dummy firm provisioning for the @pepi suite.
 *
 * Creates a fresh isolated firm via /qa/createDummyFirm.do once per Playwright
 * worker, then exposes a flattened, test-friendly view of the firm's data.
 * Each worker gets its own firm so multiple workers can run mutating tests in
 * parallel without stepping on each other's state.
 *
 * No teardown — dummy firms accumulate on qa3 by design.
 *
 * Wired into the test runner via the monkey-patch in playwright.config.js, so
 * specs can use it as a worker-scoped fixture:
 *
 *   test('@pepi …', async ({ page, workerFirm }) => {
 *     await uploadBillingBucketExclusions(page, workerFirm.firmCd, xlsxBuffer);
 *   });
 */

const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { setComboBoxValue } = require('./ui');

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'testrail.config.json'), 'utf8')
);
const STORAGE = path.join(__dirname, '..', '.auth', 'tim1.json');
const BASE = cfg.appUnderTest.url.replace(/\/$/, '');
const PASSWORD = cfg.appUnderTest.password;

const ENDPOINT = '/qa/createDummyFirm.do';
// Variant of /qa/createDummyFirm.do that also seeds 2 prospects + 3 custom
// groups directly via DAO inside the firm (see CreateDummyFirmProcess.java:
// createProspectsAndCustomGroups). Both prospects get lastName
// `prospectSR-<NOW>-<suffix>` and firstName `prospectGN-<NOW>-<suffix>`, so a
// search for the literal "prospectSR-" prefix matches them deterministically.
const ENDPOINT_EXTENDED = '/qa/createDummyFirmExtended.do';
// Static last-name prefix the BE assigns to all prospects seeded by
// createDummyFirmExtended.do. Merge-prospect specs use this prefix to drive
// the autocomplete on the Edit Client → Merge With Prospect modal without
// having to walk the UI to create one.
const SEEDED_PROSPECT_PREFIX = 'prospectSR-';

/**
 * Read the saved tim1 storage state and turn its cookie list into a single
 * `Cookie:` header string suitable for fetch().
 */
function cookieHeaderFromStorage() {
  if (!fs.existsSync(STORAGE)) {
    throw new Error(
      `worker-firm: storage state missing at ${STORAGE}. ` +
        `globalSetup should produce it before workers start.`
    );
  }
  const state = JSON.parse(fs.readFileSync(STORAGE, 'utf8'));
  return (state.cookies || []).map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Hit /qa/createDummyFirm.do and return the parsed response. Uses Node's
 * built-in fetch with cookies pulled from the tim1 storage state file —
 * deliberately NOT Playwright's APIRequestContext, because creating that
 * inside a worker fixture conflicts with the worker's trace artifact cleanup
 * (silent ENOENTs on .trace and .network files that surface much later as
 * apiRequestContext._wrapApiCall errors).
 */
async function createDummyFirm({ extended = false } = {}) {
  const cookieHeader = cookieHeaderFromStorage();
  const endpoint = extended ? ENDPOINT_EXTENDED : ENDPOINT;
  const res = await fetch(BASE + endpoint, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `worker-firm: ${endpoint} did not return JSON ` +
        `(status=${res.status}): ${text.slice(0, 300)}`
    );
  }
  if (!data.success) {
    throw new Error(`worker-firm: ${endpoint} returned success=false: ${text.slice(0, 300)}`);
  }
  return data;
}

/**
 * Walk the createDummyFirm response tree and pull out usable
 * (advisor, household, client, accounts) tuples.
 *
 * The raw response nests as: users[advisor].clients[household].clients[client].accounts[].
 * Top-level "clients" entries with entityTypeCd:5 are households; their nested
 * "clients" with entityTypeCd:1 are the real clients. We skip orphan-account
 * branches (advisors whose accounts have hh:null), because nearly every Pepi
 * test that needs a dummy firm also needs a household.
 *
 * @param {any} raw  the parsed createDummyFirm response
 * @returns {Array<{advisor: {loginName: string, name: string}, household: {uuid: string, name: string}, client: {uuid: string, name: string}, accounts: Array<{uuid: string, num: string, title: string}>}>}
 */
function flattenFirm(raw) {
  const tuples = [];
  for (const advisor of raw.users || []) {
    for (const householdNode of advisor.clients || []) {
      if (householdNode.entityTypeCd !== 5) continue; // not a household
      for (const clientNode of householdNode.clients || []) {
        if (clientNode.entityTypeCd !== 1) continue; // not a client
        const accounts = (clientNode.accounts || []).map((a) => ({
          uuid: a.accountID,
          num: a.accountNum,
          title: a.accountTitle,
        }));
        if (accounts.length === 0) continue;
        tuples.push({
          advisor: { loginName: advisor.loginName, name: advisor.name },
          household: { uuid: householdNode.userId, name: householdNode.name },
          client: { uuid: clientNode.userId, name: clientNode.name },
          accounts,
        });
      }
    }
  }
  return tuples;
}

/**
 * High-level entry point: provision a dummy firm and return a flat,
 * test-friendly view. The first usable tuple (advisor + household + client +
 * accounts) is hoisted to the top-level fields for convenience; the rest are
 * available via `tuples` for tests that need more than one household.
 *
 * @returns {Promise<{
 *   firmCd: number,
 *   firmName: string,
 *   password: string,
 *   admin: {loginName: string, entityId: string},
 *   advisor: {loginName: string, name: string},
 *   household: {uuid: string, name: string},
 *   client: {uuid: string, name: string},
 *   accounts: Array<{uuid: string, num: string, title: string}>,
 *   tuples: ReturnType<typeof flattenFirm>,
 *   raw: any,
 * }>}
 */
async function setupWorkerFirm({ extended = false } = {}) {
  const raw = await createDummyFirm({ extended });
  const tuples = flattenFirm(raw);
  if (tuples.length === 0) {
    throw new Error(
      `worker-firm: createDummyFirm response had no usable household/client/accounts tuple. ` +
        `firmCd=${raw.firm?.firmCd}`
    );
  }
  const primary = tuples[0];
  return {
    firmCd: raw.firm.firmCd,
    firmName: raw.firm.firmName,
    password: PASSWORD,
    admin: {
      loginName: raw.adminUser.loginName,
      entityId: raw.adminUser.entityId,
    },
    advisor: primary.advisor,
    household: primary.household,
    client: primary.client,
    accounts: primary.accounts,
    tuples,
    raw,
    // Set only when createDummyFirmExtended.do was used — exposes the static
    // last-name prefix that the BE DAO assigns to the 2 prospects it seeds.
    seededProspectPrefix: extended ? SEEDED_PROSPECT_PREFIX : null,
  };
}

/**
 * Return a `{ firstName, lastName }` for a prospect that already exists in the
 * worker firm, suitable for autocomplete searches in the merge-prospect specs.
 *
 * When the worker firm was provisioned via /qa/createDummyFirmExtended.do
 * (`workerFirm.seededProspectPrefix` is set), the BE seeded 2 prospects
 * directly via DAO with a known static last-name prefix — we just return that
 * prefix and skip the UI flow entirely. Otherwise we fall back to driving the
 * Create Prospect form as the firm admin (provisionProspectInPlace), which is
 * the legacy path retained for any caller that opted out of `extended`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ firmCd: number, admin: {loginName: string}, seededProspectPrefix?: string|null }} workerFirm
 * @returns {Promise<{firstName: string, lastName: string}>}
 */
async function ensureProspect(page, context, workerFirm) {
  if (workerFirm.seededProspectPrefix) {
    // The DAO assigns "prospectSR-<NOW>-<suffix>" to the 2 seeded prospects.
    // The autocomplete on Edit Client → Merge With Prospect matches by
    // last-name prefix, so the raw prefix alone is enough to hit both rows.
    return { firstName: 'prospectGN-', lastName: workerFirm.seededProspectPrefix };
  }
  // Legacy path: drive the Create Prospect form in the UI. Cached per firmCd
  // so the first merge-prospect spec pays the cost and the rest reuse it.
  if (!ensureProspect._cache) ensureProspect._cache = new Map();
  if (ensureProspect._cache.has(workerFirm.firmCd)) {
    return ensureProspect._cache.get(workerFirm.firmCd);
  }
  const prospect = await provisionProspectInPlace(page, context, workerFirm);
  ensureProspect._cache.set(workerFirm.firmCd, prospect);
  return prospect;
}

/**
 * Provision one prospect inside a dummy firm by driving the
 * `#directories/prospects/create` UI as the firm's auto-generated admin user.
 *
 * createDummyFirm.do does not seed prospects, but the merge-prospect specs
 * need at least one prospect in the firm to autocomplete against. Logging in
 * as the dummy firm admin (admin_<firmCd>) gives that user's primary firm as
 * the prospect's home firm; tim1 cannot be used here because the directories
 * form has no firm picker and would create the prospect in tim1's firm 1.
 *
 * Drives the SPEC's own page (and clears the spec's cookies first) instead of
 * spinning up a side-channel browser context. The side-channel approach
 * (chromium.launch or browser.newContext from inside a worker) was unreliable:
 * the SPA login form simply never rendered for those isolated contexts even
 * though identical code worked in a standalone Node script.
 *
 * Side-effect: leaves the page authenticated as the dummy firm admin. Callers
 * (typically via ensureProspect → runMergeProspectSmoke) re-authenticate via
 * loginPlatformOneAdmin afterwards.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ admin: {loginName: string} }} workerFirm
 * @param {{firstName?: string, lastName?: string}} [opts]
 * @returns {Promise<{firstName: string, lastName: string}>}
 */
async function provisionProspectInPlace(page, context, workerFirm, opts = {}) {
  const firstName = opts.firstName || 'PepiPF';
  const lastName = opts.lastName || `PepiPL${Date.now()}`;

  // Drop the tim1 session before logging in as the dummy firm admin.
  await context.clearCookies();

  await page.goto(`${BASE}/`);
  const usernameInput = page.getByPlaceholder(/email|username/i);
  await usernameInput.waitFor({ timeout: 30_000, state: 'visible' });
  await usernameInput.fill(workerFirm.admin.loginName);
  await page.getByPlaceholder(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/#(dashboard|platformOne)/, { timeout: 30_000 });

  await page.goto(`${BASE}/react/indexReact.do#directories/prospects/create`);
  await page.locator('#firstNameField').waitFor({ timeout: 30_000 });
  // The Customer Type comboBox renders "Individual" in the header as a
  // PLACEHOLDER hint, not as a real selection — the underlying React state
  // is empty until the user opens the dropdown and clicks "Individual"
  // explicitly. Without that, the Create Prospect button stays gated by the
  // `disabled___...` CSS class and the submit click silently no-ops.
  // Native clicks on header + option commit the React state reliably; the
  // setComboBoxValue React-props path doesn't (the option's onClick reads
  // event metadata that the synthetic call doesn't reproduce).
  await page.locator('#clientTypeDiv').click();
  await page
    .locator('#clientType_Dropdown [role="combo-box-list-item"]')
    .filter({ hasText: /^Individual$/ })
    .click();
  await page.locator('#firstNameField').fill(firstName);
  await page.locator('#lastNameField').fill(lastName);
  const submitBtn = page.getByRole('button', { name: 'Create Prospect' });
  await expect(submitBtn).not.toHaveClass(/disabled/, { timeout: 10_000 });
  await submitBtn.click();
  // The Create Prospect flow surfaces a "Prospect Contact Created Successfully"
  // success modal once the server confirms the create, then the SPA navigates
  // to the new prospect's overview. Wait for the modal text — it's the
  // earliest deterministic signal that the create round-trip is done.
  // Replaces an earlier blind waitForTimeout(3_000).
  // 60s — under full @pepi suite parallel load (8 workers all spinning up
  // dummy firms + provisioning prospects), qa2 can queue create-prospect
  // requests serially server-side. Verified in a parallel run where the
  // failure snapshot showed the modal visible at timeout time, meaning the
  // surface lag exceeded the original 15s.
  await expect(page.getByText(/Prospect Contact Created Successfully/i)).toBeVisible({
    timeout: 60_000,
  });

  // Drop the dummy firm admin's cookies so the caller starts from a clean slate.
  await context.clearCookies();
  return { firstName, lastName };
}

module.exports = {
  setupWorkerFirm,
  flattenFirm,
  createDummyFirm,
  provisionProspectInPlace,
  ensureProspect,
};
