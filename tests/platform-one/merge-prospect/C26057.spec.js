// @ts-check
/**
 * TestRail C26057 — Platform One: Merge prospect with empty client (MERGE PROSPECT
 *   permissions enabled, site 61).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26057 (Run 175, label Pepi)
 * Refs:   GEO-13610, GEO-22638
 *
 * SAFETY: this test exercises steps 1–8 of the TestRail case as a UI smoke and
 * STOPS at the merge confirmation step (clicks Cancel instead of "Yes, Merge").
 *
 * Test data: a worker-scoped dummy firm + a worker-scoped prospect provisioned
 * inside that firm. The "site 61" distinction from the legacy hardcoded version
 * is no longer meaningful — every spec runs against an isolated firm now.
 */

const { test } = require('@playwright/test');
const { runMergeProspectSmokeWithProvisionedProspect } = require('./_helpers');

test('@pepi C26057 Platform One Merge Prospect - empty client + prospect with data, site 61 (UI smoke)', async ({
  page,
  workerFirm,
  context,
}) => {
  await runMergeProspectSmokeWithProvisionedProspect({ page, context, workerFirm });
});
