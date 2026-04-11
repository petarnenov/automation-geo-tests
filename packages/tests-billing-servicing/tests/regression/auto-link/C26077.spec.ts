/**
 * TestRail C26077 — Platform One: Auto-link new GW Admin user with matching
 *   Site 1 account.
 *
 * Full flow: create user in firm 1, create user in the worker's pinned
 * dummy firm with the same email, open User Management, search, verify Delink.
 *
 * Uses `tim1Page` for every Platform One action because the Platform
 * One route is gated by `firmCd === 1` (see GeowealthP1Route); dummy
 * firm GW Admins from the pool (`firmGwAdminPage` etc.) cannot reach
 * this area. The spec consumes `workerFirm` only for its `firmCd` —
 * the pool user on that firm is never logged in here.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { PlatformOnePage } from '@geowealth/e2e-framework/pages';
import { UsersPage } from '../../../src/pages/firm-admin/UsersPage';
import { UserManagementPage } from '../../../src/pages/firm-admin/UserManagementPage';

test('@regression @billing-servicing C26077 Auto-link - new GW Admin user with matching Site 1 account', async ({
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

  // Create user in firm 1 (GeoWealth) with email X — direct URL, no typeahead
  await p1.goToUsersForFirm(1);
  await usersPage.createUser({
    firstName: `QAF1-${stamp}`,
    username: `qa-f1-${stamp}`,
    email,
    gwAdmin: true,
  });

  // Create user in the worker's dummy firm with same email X.
  // Triggers the auto-link: the new dummy-firm user's email
  // matches the firm-1 user created above, so the backend links
  // them automatically.
  await p1.goToUsersForFirm(workerFirm.firmCd);
  await usersPage.createUser({
    firstName: `QAFX-${stamp}`,
    username: `qa-fx-${stamp}`,
    email,
    gwAdmin: true,
  });

  // User Management: search and verify auto-link happened.
  // The Delink action is present on the expanded email group
  // when both users are linked — so we assert it's visible.
  await p1.goToUserManagement();
  await userMgmt.searchByEmail(1, email);
  await expect(userMgmt.delinkAction()).toBeVisible();
});
