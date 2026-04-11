/**
 * TestRail C26094 — Platform One: Auto-link new GW Admin user with
 *   empty email against Site 1 account.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26094
 *
 * Scenario (full flow, ported from the legacy POC's UI smoke stop):
 *
 *   1. Create a GW Admin user in firm 1 (GeoWealth) WITH email X.
 *   2. Create a GW Admin user in the worker's dummy firm WITHOUT
 *      an email. The dummy-firm user is valid to persist (Email
 *      Address is not marked `required` in the AddEditUserForm
 *      field config), but has nothing for the backend auto-link
 *      rule to match against.
 *   3. Open User Management, search firm 1 by email X, and verify
 *      the Delink action is NOT present on the expanded email
 *      group. The firm-1 user has no cross-firm match, so
 *      `LinkDelinkActionLink` returns null for its row — both
 *      Link and Delink are absent from the DOM.
 *
 * This is the asymmetric counterpart of C26093 (both users without
 * email): here only the dummy-firm side is empty and we can still
 * use the firm-1 email to drive the User Management search.
 *
 * Uses `tim1Page` for every Platform One action because the
 * Platform One guard in App.js (GEO-21029) gates `/platformOne/*`
 * on the `isGWAdmin` flag, and `firmAdmin/userManagement` is
 * additionally firm-1-only via `GeowealthP1Route`. `workerFirm`
 * is consumed for its `firmCd` only.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { PlatformOnePage } from '@geowealth/e2e-framework/pages';
import { UsersPage } from '../../../src/pages/firm-admin/UsersPage';
import { UserManagementPage } from '../../../src/pages/firm-admin/UserManagementPage';

test('@regression @billing-servicing C26094 Auto-link - new user with empty email', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const stamp = Date.now();
  const emailFirm1 = `qa-al-1094-${stamp}@geowealth.com`;

  const p1 = new PlatformOnePage(tim1Page);
  const usersPage = new UsersPage(tim1Page);
  const userMgmt = new UserManagementPage(tim1Page);

  // Step 1: firm-1 GW Admin user with email X
  await p1.goToUsersForFirm(1);
  await usersPage.createUser({
    firstName: `QAF1-${stamp}`,
    username: `qa-f1-${stamp}`,
    email: emailFirm1,
    gwAdmin: true,
  });

  // Step 2: dummy-firm GW Admin user with NO email. Nothing for
  // the backend match-by-email rule to latch onto, so no
  // auto-link can fire.
  await p1.goToUsersForFirm(workerFirm.firmCd);
  await usersPage.createUser({
    firstName: `QAFX-${stamp}`,
    username: `qa-fx-${stamp}`,
    gwAdmin: true,
  });

  // Step 3: User Management → search firm 1 by X → expand the
  // email group → expect the Delink action to be ABSENT. The
  // firm-1 user is the only member of the X group and has no
  // cross-firm counterpart, so LinkDelinkActionLink renders
  // null for its row.
  await p1.goToUserManagement();
  await userMgmt.searchByEmail(1, emailFirm1);
  await expect(userMgmt.delinkAction()).toBeHidden();
});
