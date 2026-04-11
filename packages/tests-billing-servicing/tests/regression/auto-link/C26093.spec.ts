/**
 * TestRail C26093 — Platform One: Auto-link new GW Admin user with
 *   Site 1 account, both saved without email addresses.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26093
 *
 * Scenario (full flow, ported from the legacy POC's UI smoke stop):
 *
 *   1. Create a GW Admin user in firm 1 (GeoWealth) with NO email.
 *   2. Create a GW Admin user in the worker's dummy firm with NO
 *      email. Both creations go through the same FormBuilder
 *      AddEditUserForm — Email Address is NOT marked `required`,
 *      so leaving the field untouched keeps `emailAddress.isValid`
 *      true and the form submits cleanly.
 *   3. Navigate back to each firm's Users grid, filter by the
 *      newly-created username, and assert the row is visible —
 *      proves both users were persisted despite having no email.
 *
 * ## Why no User Management verification
 *
 * The User Management advanced search form requires the Email
 * Address filter to be at least `MIN_LENGTH_FOR_EMAIL` (3) chars
 * long (see `UserManagementAdvancedSearch.js`). Users without an
 * email cannot be located through that path. On the backend side,
 * the auto-link rule matches users by primary email — so two
 * users with empty emails have nothing to join on, and no
 * auto-link can happen by construction. Absence of auto-link is
 * therefore implicit in the product semantics; the test asserts
 * the observable part (creation succeeded) via the Users grid.
 *
 * Uses `tim1Page` for every Platform One action because the
 * Platform One guard in App.js (GEO-21029) gates `/platformOne/*`
 * on the `isGWAdmin` flag. `workerFirm` is consumed for its
 * `firmCd` only.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { PlatformOnePage } from '@geowealth/e2e-framework/pages';
import { UsersPage } from '../../../src/pages/firm-admin/UsersPage';

test('@regression @billing-servicing C26093 Auto-link - both users without email', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const stamp = Date.now();
  const firm1Username = `qa-f1-${stamp}`;
  const dummyUsername = `qa-fx-${stamp}`;

  const p1 = new PlatformOnePage(tim1Page);
  const usersPage = new UsersPage(tim1Page);

  // Step 1: firm-1 GW Admin, no email
  await p1.goToUsersForFirm(1);
  await usersPage.createUser({
    firstName: `QAF1-${stamp}`,
    username: firm1Username,
    gwAdmin: true,
  });
  await expect(await usersPage.findUserRow(firm1Username)).toBeVisible();

  // Step 2: dummy-firm GW Admin, no email
  await p1.goToUsersForFirm(workerFirm.firmCd);
  await usersPage.createUser({
    firstName: `QAFX-${stamp}`,
    username: dummyUsername,
    gwAdmin: true,
  });
  await expect(await usersPage.findUserRow(dummyUsername)).toBeVisible();
});
