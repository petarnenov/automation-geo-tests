// @ts-check
/**
 * TestRail C26058 — Platform One: Merge prospect with client that has accounts
 *   and documents (MERGE PROSPECT permissions enabled, site 61).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26058 (Run 175, label Pepi)
 * Refs:   GEO-13610, GEO-22638
 *
 * The dummy firm's auto-generated client already has 3 accounts, which
 * satisfies the "client carrying accounts" precondition. The semantic check
 * itself ("does the merge correctly inherit those accounts") only fires after
 * a destructive merge, which we explicitly avoid for safety.
 */

const { test } = require('@playwright/test');
const { runMergeProspectSmokeWithProvisionedProspect } = require('./_helpers');

test('@pepi C26058 Platform One Merge Prospect - client with accounts + prospect with data, site 61 (UI smoke)', async ({
  page,
  workerFirm,
  context,
  
}) => {
  await runMergeProspectSmokeWithProvisionedProspect({ page, context, workerFirm });
});
