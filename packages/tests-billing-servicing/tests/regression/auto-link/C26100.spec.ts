/**
 * TestRail C26100 — Platform One: Auto-link new GW Admin user with
 *   matching Site 1 account, then Delink and Link again.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26100
 *
 * Scenario (full flow, ported from the legacy POC's UI smoke stop):
 *
 *   1. Create a GW Admin user in firm 1 (GeoWealth) with email X.
 *   2. Create a GW Admin user in the worker's dummy firm with the
 *      same email X. The backend auto-links them.
 *   3. Open User Management, search firm 1 by X, expand the email
 *      group, and verify the Delink action is present (linked).
 *   4. Click Delink → confirm → verify the Link action appears
 *      (the pair was unlinked and the cross-firm row still
 *      carries a FIRM_1_ENTITY_ID, so `LinkDelinkActionLink`
 *      renders "Link" instead of "Delink").
 *   5. Click Link → confirm → verify the Delink action comes back
 *      (pair re-linked manually, matching the initial state).
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

test('@regression @billing-servicing C26100 Auto-link - matching, delink and link again', async ({
  tim1Page,
  workerFirm,
}) => {
  test.slow();

  const stamp = Date.now();
  const email = `qa-al-1100-${stamp}@geowealth.com`;

  const p1 = new PlatformOnePage(tim1Page);
  const usersPage = new UsersPage(tim1Page);
  const userMgmt = new UserManagementPage(tim1Page);

  // Step 1: firm-1 GW Admin with email X
  await p1.goToUsersForFirm(1);
  await usersPage.createUser({
    firstName: `QAF1-${stamp}`,
    username: `qa-f1-${stamp}`,
    email,
    gwAdmin: true,
  });

  // Step 2: dummy-firm GW Admin with the SAME email X → auto-link
  await p1.goToUsersForFirm(workerFirm.firmCd);
  await usersPage.createUser({
    firstName: `QAFX-${stamp}`,
    username: `qa-fx-${stamp}`,
    email,
    gwAdmin: true,
  });

  // Step 3: User Management → search → assert auto-linked
  // (Delink visible under the expanded email group).
  await p1.goToUserManagement();
  await userMgmt.searchByEmail(1, email);
  await expect(userMgmt.delinkAction()).toBeVisible({ timeout: 15_000 });

  // Step 4: Delink the pair → Link action takes Delink's place.
  await userMgmt.delinkUser();
  await expect(userMgmt.linkAction()).toBeVisible({ timeout: 15_000 });

  // Step 5: Link again → Delink is back.
  await userMgmt.linkUser();
  await expect(userMgmt.delinkAction()).toBeVisible({ timeout: 15_000 });
});
