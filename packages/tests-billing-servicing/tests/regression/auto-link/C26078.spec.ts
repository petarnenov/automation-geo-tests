/**
 * TestRail C26078 — Platform One: Auto-link after admin email update
 *   to match Site 1 account.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26078
 *
 * Scenario (full flow, ported from the legacy POC's UI smoke stop):
 *
 *   1. Create a GW Admin user in firm 1 (GeoWealth) with email X.
 *   2. Create a GW Admin user in the worker's dummy firm with email Y
 *      (different from X — no auto-link triggers on create).
 *   3. Edit the dummy-firm user and change its email from Y to X.
 *      The email update is the trigger — auto-link should fire when
 *      an existing user's email starts matching a firm-1 user.
 *   4. Open Firm Admin → User Management, search firm 1 by email X,
 *      and verify the Delink action is present on the email group
 *      (proof that the two users are now linked).
 *
 * Uses `tim1Page` for every Platform One action because the Platform
 * One guard in App.js (GEO-21029) gates the `/platformOne/*` routes
 * on `isGWAdmin`, and `firmAdmin/userManagement` is additionally
 * firm-1-only via `GeowealthP1Route`. Dummy-firm GW Admins from the
 * pool can reach `firmAdmin/users/:firmCd` but not User Management,
 * so tim1 is the only user that can drive the whole flow end-to-end.
 * `workerFirm` is consumed for its `firmCd` only — the pool user on
 * that firm is never logged in here.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { PlatformOnePage } from '@geowealth/e2e-framework/pages';
import { UsersPage } from '../../../src/pages/firm-admin/UsersPage';
import { UserManagementPage } from '../../../src/pages/firm-admin/UserManagementPage';

test('@regression @billing-servicing C26078 Auto-link - after admin email update', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const stamp = Date.now();
  const targetEmail = `qa-al-${workerFirm.firmCd}-${stamp}-x@geowealth.com`;
  const initialEmail = `qa-al-${workerFirm.firmCd}-${stamp}-y@geowealth.com`;
  const dummyUsername = `qa-fx-${stamp}`;

  const p1 = new PlatformOnePage(tim1Page);
  const usersPage = new UsersPage(tim1Page);
  const userMgmt = new UserManagementPage(tim1Page);

  // Step 1: create firm-1 user with the target email
  await p1.goToUsersForFirm(1);
  await usersPage.createUser({
    firstName: `QAF1-${stamp}`,
    username: `qa-f1-${stamp}`,
    email: targetEmail,
    gwAdmin: true,
  });

  // Step 2: create dummy-firm user with a DIFFERENT email — no link
  // should exist at this point because emails don't match yet.
  await p1.goToUsersForFirm(workerFirm.firmCd);
  await usersPage.createUser({
    firstName: `QAFX-${stamp}`,
    username: dummyUsername,
    email: initialEmail,
    gwAdmin: true,
  });

  // Step 3: edit the dummy-firm user and update the email to the
  // firm-1 target email — this is the auto-link trigger.
  await usersPage.editUser(dummyUsername, { email: targetEmail });

  // Step 4: User Management → search firm 1 by targetEmail →
  // expect the Delink action to be present on the expanded group
  // (both users are now linked).
  await p1.goToUserManagement();
  await userMgmt.searchByEmail(1, targetEmail);
  await expect(userMgmt.delinkAction()).toBeVisible({ timeout: 15_000 });
});
