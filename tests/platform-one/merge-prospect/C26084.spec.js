// @ts-check
/**
 * TestRail C26084 — Platform One: Merge prospect with client that has a document
 *   with the same name as a prospect document (MERGE PROSPECT permissions
 *   enabled, site 1).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26084 (Run 175, label Pepi)
 * Refs:   GEO-13610, GEO-22638
 *
 * Site 1 variant of C26059. The document-name conflict only fires after the
 * destructive merge, which we explicitly avoid. UI smoke duplicate of C26082.
 */

const { test } = require('@playwright/test');
const { runMergeProspectSmokeWithProvisionedProspect } = require('./_helpers');

test('@pepi C26084 Platform One Merge Prospect - client with same-named document, site 1 (UI smoke)', async ({
  page,
  workerFirm,
  context,
}) => {
  await runMergeProspectSmokeWithProvisionedProspect({ page, context, workerFirm });
});
