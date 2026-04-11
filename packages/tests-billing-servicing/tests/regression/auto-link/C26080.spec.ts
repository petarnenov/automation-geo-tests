/**
 * TestRail C26080 — Platform One: Auto-link new GW Admin user with
 *   non-matching email from Site 1 account.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26080
 *
 * Scenario (full flow, ported from the legacy POC's UI smoke stop):
 *
 *   1. Create a GW Admin user in firm 1 (GeoWealth) with email X1.
 *   2. Create a GW Admin user in the worker's dummy firm with a
 *      DIFFERENT email X2. Both users are GW Admins so the policy
 *      filter is passed, but the backend auto-link rule matches by
 *      primary email — mismatched emails short-circuit it.
 *   3. Open User Management, search firm 1 by email X1, and verify
 *      the **Delink** action is NOT visible. No-auto-link is the
 *      contract under test — asserting the absence of Delink is the
 *      cleanest positive check that the pair did not get linked.
 *
 * Note on why we don't assert `linkAction()` instead: the
 * `LinkDelinkActionLink` component (see
 * `~/geowealth/.../LinkDelinkActionLink.js`) only renders Link or
 * Delink for users whose row carries a `FIRM_1_ENTITY_ID`, which
 * the backend only populates when there's a cross-firm email
 * match. X1 has no cross-firm match (dummy firm uses X2), so the
 * component returns `null` for the X1 group's firm-1 user —
 * neither Link nor Delink is in the DOM at all. Asserting "Delink
 * absent" is therefore the right positive signal for this spec.
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

test('@regression @billing-servicing C26080 Auto-link - non-matching email triggers no link', async ({
  tim1Page,
  workerFirm,
}) => {
  test.setTimeout(300_000);
  test.slow();

  const stamp = Date.now();
  const emailFirm1 = `qa-al-1080-${stamp}@geowealth.com`;
  const emailDummy = `qa-al-x80-${stamp}@geowealth.com`;

  const p1 = new PlatformOnePage(tim1Page);
  const usersPage = new UsersPage(tim1Page);
  const userMgmt = new UserManagementPage(tim1Page);

  // Step 1: firm-1 GW Admin user with email X1
  await p1.goToUsersForFirm(1);
  await usersPage.createUser({
    firstName: `QAF1-${stamp}`,
    username: `qa-f1-${stamp}`,
    email: emailFirm1,
    gwAdmin: true,
  });

  // Step 2: dummy-firm GW Admin user with a DIFFERENT email X2.
  // Both are GW Admins, so the policy allows auto-link — but the
  // backend matches by primary email, and X1 !== X2, so no link
  // is created.
  await p1.goToUsersForFirm(workerFirm.firmCd);
  await usersPage.createUser({
    firstName: `QAFX-${stamp}`,
    username: `qa-fx-${stamp}`,
    email: emailDummy,
    gwAdmin: true,
  });

  // Step 3: User Management → search firm 1 by the firm-1 email →
  // expand the email group → expect the Delink action to be
  // ABSENT. The dummy-firm user stayed under X2 and never showed
  // up in X1's group, so no auto-link was created and the
  // LinkDelinkActionLink cell renders null for the firm-1 row.
  await p1.goToUserManagement();
  await userMgmt.searchByEmail(1, emailFirm1);
  await expect(userMgmt.delinkAction()).not.toBeVisible();
});
