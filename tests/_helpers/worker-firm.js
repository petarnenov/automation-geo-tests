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

const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'testrail.config.json'), 'utf8')
);
const STORAGE = path.join(__dirname, '..', '.auth', 'tim1.json');
const BASE = cfg.appUnderTest.url.replace(/\/$/, '');
const PASSWORD = cfg.appUnderTest.password;

const ENDPOINT = '/qa/createDummyFirm.do';

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
async function createDummyFirm() {
  const cookieHeader = cookieHeaderFromStorage();
  const res = await fetch(BASE + ENDPOINT, {
    method: 'POST',
    headers: { Cookie: cookieHeader },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `worker-firm: ${ENDPOINT} did not return JSON ` +
        `(status=${res.status}): ${text.slice(0, 300)}`
    );
  }
  if (!data.success) {
    throw new Error(`worker-firm: ${ENDPOINT} returned success=false: ${text.slice(0, 300)}`);
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
async function setupWorkerFirm() {
  const raw = await createDummyFirm();
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
  };
}

// Cache provisioned prospects per firmCd so the first merge-prospect spec in
// a worker pays the ~10s setup cost and subsequent specs reuse the result.
// Keyed by firmCd because each worker has at most one dummy firm at a time.
const _prospectCache = new Map();

/**
 * Idempotent wrapper around provisionProspectInPlace — call from inside a
 * spec. Drives the test's own page for prospect creation, so it doesn't have
 * to spin up a side-channel browser context (which conflicts with the test
 * worker's trace/page lifecycle in subtle ways).
 *
 * Side-effect: leaves the page logged out (cookies cleared) so the spec body
 * can re-authenticate however it wants — typically via loginPlatformOneAdmin
 * inside runMergeProspectSmoke.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ firmCd: number, admin: {loginName: string} }} workerFirm
 */
async function ensureProspect(page, context, workerFirm) {
  if (_prospectCache.has(workerFirm.firmCd)) {
    return _prospectCache.get(workerFirm.firmCd);
  }
  const prospect = await provisionProspectInPlace(page, context, workerFirm);
  _prospectCache.set(workerFirm.firmCd, prospect);
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
  await page.locator('#firstNameField').fill(firstName);
  await page.locator('#lastNameField').fill(lastName);
  await page.getByRole('button', { name: 'Create Prospect' }).click();
  // The form clears after submit but URL does not change; wait briefly for
  // the POST to complete server-side before the next step.
  await page.waitForTimeout(3_000);

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
