// @ts-check
/**
 * TestRail C26079 — Platform One: Auto-link not allowed for non-GW Admin user
 *   to link with Site 1 account.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26079 (Run 175, label Pepi)
 *
 * UI smoke (safety stop) — see ./_helpers.js for the rationale.
 */

const { test } = require('@playwright/test');
const { runAutoLinkCreateUserSmoke } = require('./_helpers');

test('@pepi C26079 Platform One Auto-link - non-GW Admin user cannot link (UI smoke)', async ({
  page,
}) => {
  await runAutoLinkCreateUserSmoke({ page, firmCode: 3 });
});
