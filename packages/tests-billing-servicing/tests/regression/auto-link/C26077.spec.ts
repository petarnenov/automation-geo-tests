/**
 * TestRail C26077 — Platform One: Auto-link new GW Admin user with matching
 *   Site 1 account.
 *
 * Full flow: create user in firm 1, create user in testFirm with same email,
 * open User Management, search by email, Link, verify Delink.
 */

import { test } from '@geowealth/e2e-framework/fixtures';
import { PlatformOnePage } from '@geowealth/e2e-framework/pages';
import { UsersPage } from '../../../src/pages/firm-admin/UsersPage';
import { UserManagementPage } from '../../../src/pages/firm-admin/UserManagementPage';

test('@regression @billing-servicing C26077 Auto-link - new GW Admin user with matching Site 1 account', async ({
  tim1Page,
  testFirm,
}) => {
  test.setTimeout(300_000);
  test.slow();

  const stamp = Date.now();
  const email = `qa-al-${testFirm.firmCd}-${stamp}@geowealth.com`;

  const p1 = new PlatformOnePage(tim1Page);
  const usersPage = new UsersPage(tim1Page);
  const userMgmt = new UserManagementPage(tim1Page);

  // Create user in firm 1 (GeoWealth) with email X — direct URL, no typeahead
  await p1.goToUsers(1);
  await usersPage.createUser({
    firstName: `QAF1-${stamp}`,
    username: `qa-f1-${stamp}`,
    email,
    gwAdmin: true,
  });

  // Create user in testFirm with same email X — direct URL, no typeahead
  await p1.goToUsers(testFirm.firmCd);
  await usersPage.createUser({
    firstName: `QAFX-${stamp}`,
    username: `qa-fx-${stamp}`,
    email,
    gwAdmin: true,
  });

  // User Management: search and verify auto-link happened
  await p1.goToUserManagement();
  await userMgmt.searchByEmail(1, email);
  await userMgmt.expectLinked();
});
