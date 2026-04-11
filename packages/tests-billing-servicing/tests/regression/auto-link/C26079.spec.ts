/**
 * TestRail C26079 — Platform One: Auto-link non-GW Admin user cannot link.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26079
 *
 * Scenario (full flow, ported from the legacy POC's UI smoke stop):
 *
 *   1. Create a GW Admin user in firm 1 (GeoWealth) with email X.
 *   2. Create a **non-GW Admin** user in the worker's dummy firm with
 *      the same email X. Non-GW Admins have the password fields
 *      enabled and required, so `createUser` falls back to a strong
 *      default password when none is passed.
 *   3. Open User Management, search firm 1 by email X, and verify
 *      the Link action is present on the expanded email group — the
 *      dummy-firm user shows up in the group but the auto-link did
 *      NOT fire, because only GW-Admin matches auto-link. The pair
 *      would have to be linked manually via the Link button.
 *
 * Uses `tim1Page` for every Platform One action because the Platform
 * One guard in App.js (GEO-21029) gates `/platformOne/*` on the
 * `isGWAdmin` flag, and `firmAdmin/userManagement` is additionally
 * firm-1-only via `GeowealthP1Route`. `workerFirm` is consumed for
 * its `firmCd` only.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { PlatformOnePage } from '@geowealth/e2e-framework/pages';
import { UsersPage } from '../../../src/pages/firm-admin/UsersPage';
import { UserManagementPage } from '../../../src/pages/firm-admin/UserManagementPage';

test('@regression @billing-servicing C26079 Auto-link - non-GW Admin user cannot link', async ({
  tim1Page,
  workerFirm,
}) => {
  test.setTimeout(300_000);
  test.slow();

  const stamp = Date.now();
  const email = `qa-al-${workerFirm.firmCd}-${stamp}@geowealth.com`;

  const p1 = new PlatformOnePage(tim1Page);
  const usersPage = new UsersPage(tim1Page);
  const userMgmt = new UserManagementPage(tim1Page);

  // Step 1: firm-1 GW Admin user with email X
  await p1.goToUsersForFirm(1);
  await usersPage.createUser({
    firstName: `QAF1-${stamp}`,
    username: `qa-f1-${stamp}`,
    email,
    gwAdmin: true,
  });

  // Step 2: dummy-firm NON-GW-Admin user with the SAME email X.
  // Non-GW-Admin requires a password — createUser fills the
  // default strong password when none is passed.
  await p1.goToUsersForFirm(workerFirm.firmCd);
  await usersPage.createUser({
    firstName: `QAFX-${stamp}`,
    username: `qa-fx-${stamp}`,
    email,
    gwAdmin: false,
  });

  // Step 3: User Management → search firm 1 by email → expand the
  // email group → expect the Link action to be visible (NOT the
  // Delink). Only GW-Admin matches auto-link; this pair stayed
  // unlinked despite the matching email.
  await p1.goToUserManagement();
  await userMgmt.searchByEmail(1, email);
  await expect(userMgmt.linkAction()).toBeVisible();
});
