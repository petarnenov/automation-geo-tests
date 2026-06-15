// @ts-check
/**
 * Shared helpers for the Platform One User Impersonation spec family
 * (TestRail section 2332 — C26424, C26425, C26426, …, C26598).
 *
 * The Impersonate menu under Operations → Firm Admin is gated by two
 * conditions in useSideBarLinks (geowealth FE):
 *   hidden: !luIsFirmGEOWEALTH || !luHasPermissionImpersonateEmployee
 *
 * Meaning the item is rendered ONLY when the logged user is in firm 1
 * (config.firmCodes.GEOWEALTH) AND has the IMPERSONATE_EMPLOYEE permission
 * (`82_5`).
 *
 * The worker fixture preloads contexts with a per-worker GW Admin (`gwa{N}_`),
 * which is in firm 1 but only carries the "All Employees" role and lacks
 * IMPERSONATE_EMPLOYEE. Positive specs therefore must clearCookies + login
 * as `tim1` explicitly (see `loginAsTim1Fresh`). Negative specs reuse the
 * default `gwa0` session — that's exactly the "user without permission"
 * profile the negatives need.
 *
 * Sidebar markup + CSS notes (BackOfficeLinks.js, SidebarLink.js,
 * sidebarStyles.scss):
 *   - Top-level group "Operations" is a CSS-radio accordion:
 *       <input type=radio name=accordion id=item-N> + <label for=item-N><h4>Operations</h4></label>
 *     Clicking the label flips the radio → expands its `linksWrapper`.
 *   - "Firm Admin" inside Operations is a <SidebarLabel><h5>Firm Admin</h5></SidebarLabel>
 *     followed by a <ul.submenuLinksWrapper>. That <ul> is `display: none` by
 *     default and only becomes visible on `:hover` (either of the label OR the
 *     <ul> itself). It's a fly-out side panel positioned at `left: 20rem`.
 *     ⇒ we must HOVER the Firm Admin label before its children are reachable.
 *   - "Impersonate" leaf is <li><a><h4>Impersonate</h4></a></li> — matched
 *     reliably via getByRole('link', { name: 'Impersonate' }) or by href.
 *
 * UserImpersonation page selectors (UserImpersonation.js, columnDefs.js,
 * FirmsListP1.js, HeaderSearchInput.js, SearchBox.js):
 *   - Page wrapper: `#UserImpersonationWrapper`
 *   - Firm selector (FormBuilder comboBox): `#selectFirm` field id; the
 *     FormBuilder renders an input + a clickable wrapper with `id="selectFirm"`.
 *   - Grid root: `#p1UserImpersonationGrid`
 *   - Grid columns: "Name" (sortable), "Impersonate Action" (right-locked,
 *     not sortable, renders an `<Button buttonTxt="Advisor Portal">` per row).
 *   - Grid search box: input inside `#headerSearchInputId` with placeholder
 *     "Search".
 */

const { test, expect } = require('@playwright/test');
const { cfg, login } = require('../../_helpers/qa3');

const IMPERSONATE_HREF = /firmAdmin\/userImpersonation/;
const FIRM_CD_GEOWEALTH = 1;
const FIRM_CD_FALLBACK = 3; // Stable second firm for switch-firm scenarios.

/**
 * Force the page into a fresh tim1 session.
 *
 * Why this instead of `loginPlatformOneAdmin`: the worker fixture preloads
 * each context with a per-worker GW Admin (`gwa{0..7}_...`) session
 * (storageState override in playwright.config.js). `loginPlatformOneAdmin`
 * short-circuits the login when ANY valid session is already present, so it
 * silently uses `gwa0` — which was created with only the "All Employees"
 * role and does not have IMPERSONATE_EMPLOYEE. The Impersonate sidebar item
 * is hidden for `gwa0` regardless of feature deployment, and positive specs
 * would always fail.
 *
 * Clearing cookies first guarantees the form login runs as `tim1`, the
 * Platform One admin who carries the Impersonation permission.
 *
 * @param {import('@playwright/test').Page} page
 */
async function loginAsTim1Fresh(page) {
  await page.context().clearCookies();
  await login(page, cfg.appUnderTest.username, cfg.appUnderTest.password);
  await page.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
  if (!page.url().includes('#platformOne')) {
    await page.goto('/react/indexReact.do#platformOne');
    await expect(page).toHaveURL(/#platformOne/, { timeout: 30_000 });
  }
}

/**
 * Expand the Operations group in the Platform One sidebar.
 *
 * Idempotent: clicking a radio that's already checked is a no-op for CSS
 * accordions, so callers can invoke this without tracking prior state.
 *
 * @param {import('@playwright/test').Page} page
 */
async function expandOperationsGroup(page) {
  const operationsLabel = page
    .locator('label')
    .filter({ has: page.getByRole('heading', { level: 4, name: 'Operations' }) })
    .first();
  await expect(operationsLabel).toBeVisible({ timeout: 30_000 });
  await operationsLabel.click();
}

/**
 * Hover the Firm Admin sub-group label to reveal its <ul.submenuLinksWrapper>.
 * Requires Operations to be expanded first.
 *
 * @param {import('@playwright/test').Page} page
 */
async function hoverFirmAdminGroup(page) {
  const firmAdminLabel = page
    .locator('label')
    .filter({ has: page.getByRole('heading', { level: 5, name: 'Firm Admin' }) })
    .first();
  await expect(firmAdminLabel).toBeVisible({ timeout: 10_000 });
  await firmAdminLabel.hover();
}

/**
 * C26424 flow: login as tim1, expand Operations, assert the Impersonate
 * link is visible under Firm Admin, click it, assert the UserImpersonation
 * page mounts.
 *
 * @param {object} args
 * @param {import('@playwright/test').Page} args.page
 */
async function runImpersonateMenuVisibilityCheck({ page }) {
  test.setTimeout(180_000);

  await test.step('Login as Platform One admin (site 1, tim1) — fresh session', async () => {
    await loginAsTim1Fresh(page);
  });

  const impersonateLink = page.locator(`a[href*="firmAdmin/userImpersonation"]`);

  await test.step('Expand Operations → Firm Admin and assert Impersonate link visible', async () => {
    await expandOperationsGroup(page);
    await hoverFirmAdminGroup(page);
    await expect(impersonateLink).toBeVisible({ timeout: 10_000 });
  });

  await test.step('Click Impersonate and assert UserImpersonation page loads', async () => {
    await impersonateLink.click();
    await expect(page).toHaveURL(/#platformOne\/.*firmAdmin\/userImpersonation/, {
      timeout: 30_000,
    });
    await expect(page.locator('#UserImpersonationWrapper')).toBeVisible({ timeout: 30_000 });
  });
}

/**
 * Login as tim1 and navigate to the UserImpersonation page (no menu
 * assertions). Use this for specs that exercise the page itself.
 *
 * @param {import('@playwright/test').Page} page
 */
async function gotoImpersonatePageAsTim1(page) {
  await loginAsTim1Fresh(page);
  await page.goto(`/react/indexReact.do#platformOne/firmAdmin/userImpersonation`);
  await expect(page).toHaveURL(IMPERSONATE_HREF, { timeout: 30_000 });
  await expect(page.locator('#UserImpersonationWrapper')).toBeVisible({ timeout: 30_000 });
}

/**
 * Select a firm in the FirmsListP1 comboBox by code. The page reflects the
 * selection in the URL hash (`.../userImpersonation/{firmCd}`) before the
 * grid request fires, so we wait for both the URL and the grid render.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} firmCd
 */
async function selectFirmInImpersonate(page, firmCd) {
  // Direct URL navigation is the most reliable way to drive the FirmsListP1
  // comboBox: its onChange handler does `history.push(.../firmCd)` — we just
  // skip the click choreography and push the same URL. This avoids the
  // typeAhead vs option-list race the auto-link memory warns about.
  const target = `/react/indexReact.do#platformOne/firmAdmin/userImpersonation/${firmCd}`;
  if (!page.url().endsWith(`/${firmCd}`)) {
    await page.goto(target);
  } else {
    await page.reload();
  }
  await expect(page).toHaveURL(new RegExp(`firmAdmin\\/userImpersonation\\/${firmCd}(?:$|/|\\?)`), {
    timeout: 30_000,
  });
  await waitForGridReady(page);
}

/**
 * Wait until the grid finishes its initial load: either rows are present
 * OR the "No users found" state shows. The loading overlay disappears before
 * either of these states becomes truthy.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForGridReady(page) {
  // ag-grid renders rows under .ag-center-cols-container; the empty-state
  // text comes from the GwGrid `noDataText` prop ("No users found").
  const rowCount = page.locator('#p1UserImpersonationGrid .ag-center-cols-container .ag-row');
  const emptyState = page.locator('#p1UserImpersonationGrid').getByText(/No users found/i);
  await expect(async () => {
    const rows = await rowCount.count();
    const empty = await emptyState.isVisible().catch(() => false);
    if (rows === 0 && !empty) throw new Error('grid still loading');
  }).toPass({ timeout: 30_000 });
}

/**
 * Return the visible "Name" column values, in display order.
 *
 * @param {import('@playwright/test').Page} page
 */
async function getGridRowNames(page) {
  const cells = page.locator(
    '#p1UserImpersonationGrid .ag-center-cols-container .ag-row [col-id="name"]'
  );
  await expect(cells.first()).toBeVisible({ timeout: 15_000 });
  return cells.allInnerTexts();
}

/**
 * Type into the grid quick-search input. The SearchBox is uncontrolled and
 * pushes the value through `updateGridQuickFilter` on each keystroke, so we
 * use `fill()` (single set) and then trigger a tiny keyup to force ag-grid
 * to re-filter — fill alone sometimes does not emit onChange in this build.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} query
 */
async function searchImpersonateGrid(page, query) {
  const input = page.locator('#headerSearchInputId input[type="text"]');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(query);
  // Nudge React/ag-grid so the controlled state sees the value. The empty
  // press is harmless — it doesn't add characters but does fire input/change.
  await input.press('End');
}

/**
 * Clear the quick-search via the circle-close icon (the React onClick clears
 * internal state); fall back to selecting + Delete if the icon is hidden.
 *
 * @param {import('@playwright/test').Page} page
 */
async function clearImpersonateSearch(page) {
  const closeIcon = page.locator('#headerSearchInputId').locator('svg#circle_close_btn').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click();
    return;
  }
  const input = page.locator('#headerSearchInputId input[type="text"]');
  await input.fill('');
  await input.press('End');
}

/**
 * Click the "Advisor Portal" Impersonate button on the first row whose name
 * does NOT match `excludeNames`. Returns the impersonated name so callers can
 * verify the post-redirect screen reflects that user.
 *
 * The ImpersonateButton handler does:
 *   window.open(baseURL + '/platformOne/impersonateEmployee.do?reactRequest=true&entityID=…', '_self')
 * which navigates the CURRENT tab. After redirect the SPA lands on the
 * impersonated user's portal (Advisor Portal Dashboard for most firms,
 * Manager Portal → Model Center for firm 74).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} [excludeNames] Names to skip (e.g. ['GeoWealth, Tim'] to
 *   avoid self-impersonation).
 * @returns {Promise<string>} the picked row's display name
 */
async function impersonateFirstNonSelfEmployee(page, excludeNames = []) {
  const names = await getGridRowNames(page);
  const pickIndex = names.findIndex((n) => !excludeNames.includes(n.trim()));
  if (pickIndex < 0) throw new Error('No non-self employee row found');
  const targetName = names[pickIndex].trim();
  const button = page
    .locator('#p1UserImpersonationGrid .ag-center-cols-container .ag-row')
    .nth(pickIndex)
    .getByRole('button', { name: 'Advisor Portal' });
  await button.click();
  return targetName;
}

/**
 * Open the Advisor Portal Non-Customer Contacts grid as tim1 (fresh session)
 * and click the first row's name link → SelectedClient (Employee) page.
 * Returns the Employee's display name for downstream assertions.
 *
 * The name cell is rendered as
 *   <a href="/react/indexReact.do#/client/4/<uuid>/documents" class=" link">
 *     <span>Lastname, Firstname</span>
 *   </a>
 * — clicking it navigates to the SelectedClient Employee profile page.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>} the picked Employee's display name
 */
async function openFirstEmployeeFromAPDirectory(page) {
  await loginAsTim1Fresh(page);
  await page.goto('/react/indexReact.do#directories/nonCustomerContacts');
  // The grid pulls a paginated list — give it room to settle. The first row's
  // displayName cell carries an <a class=" link"> we can target reliably.
  const nameLink = page
    .locator('.ag-center-cols-container .ag-row [col-id="displayName"] a')
    .first();
  await expect(nameLink).toBeVisible({ timeout: 30_000 });
  const displayName = (await nameLink.innerText()).trim();
  await nameLink.click();
  // Wait for SelectedClient Employee URL (client/4/...).
  await expect(page).toHaveURL(/#client\/4\//i, { timeout: 30_000 });
  return displayName;
}

/**
 * Open the SelectedClient "User Actions" dropdown (`#actionList`). Returns
 * the locator for the Impersonate option so callers can assert / click it.
 *
 * The dropdown is the ListNew component; clicking the menu trigger expands
 * its options inline (NOT through createPortal in this build), but the
 * "Impersonate" option is identifiable by its `[data-value="Impersonate"]`
 * attribute regardless of portal vs inline rendering.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openAPUserActionsMenu(page) {
  const trigger = page.locator('#actionList');
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const impersonateOption = page.locator('[data-value="Impersonate"]').first();
  await expect(impersonateOption).toBeVisible({ timeout: 10_000 });
  return impersonateOption;
}

/**
 * Terminate the active impersonation session.
 *
 * Why a direct endpoint hit instead of UI click: Employee impersonation from
 * Platform One redirects to the LEGACY ExtJS portal
 * (`/portal/portalIndex.do#dashboard`), NOT a React surface. The React
 * "Terminate Impersonation" link in `NavigationLeftComponent` is not
 * available there. The React appService (`appService.js:573`) calls
 * `LOGOUT_IMPERSONATED_ADVISOR = '/logout.do?reactRequest=true'` to terminate
 * — that endpoint works regardless of which portal the impersonator is in,
 * which makes it the reliable mechanism for tests.
 *
 * @param {import('@playwright/test').Page} page
 */
async function terminateImpersonationFromUserMenu(page) {
  // Page-crash flake guard: the impersonated session occasionally crashes the
  // Chromium page during the logout redirect under full-suite load (the
  // ExtJS landing + immediate hard navigation away). Retry once on crash via
  // a fresh page-level navigation; the impersonation cookie is on the
  // context, not the page, so a recovery navigation will still terminate
  // the session.
  try {
    await page.goto('/logout.do?reactRequest=true');
  } catch (err) {
    if (!/page (closed|crashed)/i.test(String(err && err.message))) throw err;
    await page.waitForTimeout(1000);
    await page.goto('/logout.do?reactRequest=true');
  }
}

/**
 * UUID of `tim1` in `entity_tbl` (qa4 / Oracle). Verified once via DB query:
 *   select entity_id from entity_tbl where ldap_uid = 'tim1'
 * Stable across environments — entity IDs don't rotate.
 */
const TIM1_ENTITY_ID = '4502746CD9044636A78C804DBF3F70BF';

/**
 * Query `LOGIN_HISTORY_TBL` for the count of impersonation events initiated
 * by `tim1` (`IMPERSONATED_BY = TIM1_ENTITY_ID`) more recent than the supplied
 * `sinceIsoUtc` timestamp. The table records every impersonated login attempt
 * with the admin in `IMPERSONATED_BY` and the impersonated user in
 * `ENTITY_ID` — exactly the audit data C26451 asks for.
 *
 * @param {string} sinceIsoUtc ISO-8601 UTC timestamp (e.g. new Date().toISOString())
 * @returns {number} count of matching rows where LOGIN_SUCCESS_FLAG = 1
 */
function countTim1ImpersonationEventsSince(sinceIsoUtc) {
  const { execSync } = require('child_process');
  const py = `
import oracledb
from datetime import datetime
c = oracledb.connect(user='gp', password='gp123', dsn='dbhost:1521/ORCL12VM')
cur = c.cursor()
# Oracle DB column is DATE (no tz). Use UTC-naive parse + cast.
since = datetime.fromisoformat('${sinceIsoUtc.replace('Z', '+00:00')}').replace(tzinfo=None)
cur.execute('''
  select count(*) from login_history_tbl
   where impersonated_by = :1
     and login_success_flag = 1
     and login_attempted_date > :2
''', ['${TIM1_ENTITY_ID}', since])
print(cur.fetchone()[0])
c.close()
`;
  const out = execSync(`python3 -c "${py.replace(/"/g, '\\"')}"`, { timeout: 15_000 });
  return parseInt(out.toString().trim(), 10);
}

module.exports = {
  IMPERSONATE_HREF,
  FIRM_CD_GEOWEALTH,
  FIRM_CD_FALLBACK,
  TIM1_ENTITY_ID,
  countTim1ImpersonationEventsSince,
  runImpersonateMenuVisibilityCheck,
  loginAsTim1Fresh,
  expandOperationsGroup,
  hoverFirmAdminGroup,
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  waitForGridReady,
  getGridRowNames,
  searchImpersonateGrid,
  clearImpersonateSearch,
  impersonateFirstNonSelfEmployee,
  terminateImpersonationFromUserMenu,
  openFirstEmployeeFromAPDirectory,
  openAPUserActionsMenu,
};
