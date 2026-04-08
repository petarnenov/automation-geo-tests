// @ts-check
/**
 * TestRail C26082 — Platform One: Merge prospect with empty client (MERGE PROSPECT
 *   permissions enabled, site 1).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26082 (Run 175, label Pepi)
 * Refs:   GEO-13610, GEO-22638
 *
 * Site 1 variant of C26057. After the dummy-firm migration the "site 1 vs
 * site 61" distinction no longer exists at the test level — both run against
 * isolated worker firms. The two TestRail case IDs are preserved for
 * reporting parity with the manual test runs.
 */

const { test } = require('@playwright/test');
const { runMergeProspectSmokeWithProvisionedProspect } = require('./_helpers');

test('@pepi C26082 Platform One Merge Prospect - empty client + prospect with data, site 1 (UI smoke)', async ({
  page,
  workerFirm,
  context,
}) => {
  await runMergeProspectSmokeWithProvisionedProspect({ page, context, workerFirm });
});
