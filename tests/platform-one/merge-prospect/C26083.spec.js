// @ts-check
/**
 * TestRail C26083 — Platform One: Merge prospect with client that has accounts
 *   and documents (MERGE PROSPECT permissions enabled, site 1).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26083 (Run 175, label Pepi)
 * Refs:   GEO-13610, GEO-22638
 *
 * Site 1 variant of C26058. The "client with accounts/documents" semantics
 * cannot be exercised through the safe UI smoke (the safety stop happens
 * before the destructive merge), so this test reuses the same fixture as
 * C26082. Marking this as a smoke duplicate is intentional — the value of
 * having a separate spec is that TestRail tracks coverage for each case ID.
 */

const { test } = require('@playwright/test');
const { runMergeProspectSmokeWithProvisionedProspect } = require('./_helpers');

test('@pepi C26083 Platform One Merge Prospect - client with accounts + prospect with data, site 1 (UI smoke)', async ({
  page,
  workerFirm,
  context,
  
}) => {
  await runMergeProspectSmokeWithProvisionedProspect({ page, context, workerFirm });
});
