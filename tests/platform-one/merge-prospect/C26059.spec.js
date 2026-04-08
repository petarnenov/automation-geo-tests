// @ts-check
/**
 * TestRail C26059 — Platform One: Merge prospect with client that has a document
 *   with the same name as a prospect document (MERGE PROSPECT permissions
 *   enabled, site 61).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26059 (Run 175, label Pepi)
 * Refs:   GEO-13610, GEO-22638
 *
 * The "document name conflict" semantics can only be tested AFTER a real
 * destructive merge (the name-collision logic only fires server-side at merge
 * time). Because we stop at the merge confirmation modal for safety, this
 * spec is duplicate-coverage UI smoke against the worker dummy firm — same
 * shape as C26057/C26058, different TestRail case ID. Real conflict resolution
 * should be exercised manually with a custom fixture.
 */

const { test } = require('@playwright/test');
const { runMergeProspectSmokeWithProvisionedProspect } = require('./_helpers');

test('@pepi C26059 Platform One Merge Prospect - client with same-named document, site 61 (UI smoke)', async ({
  page,
  workerFirm,
  context,
}) => {
  await runMergeProspectSmokeWithProvisionedProspect({ page, context, workerFirm });
});
