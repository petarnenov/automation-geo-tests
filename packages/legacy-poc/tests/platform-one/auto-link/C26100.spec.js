// @ts-check
/**
 * TestRail C26100 — Platform One: Auto-link new GW Admin user with matching
 *   Site 1 account, then Delink and Link again.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26100 (Run 175, label Pepi)
 *
 * UI smoke (safety stop) — see ./_helpers.js for the rationale.
 */

const { test } = require('@playwright/test');
const { runAutoLinkCreateUserSmoke } = require('./_helpers');

test('@pepi C26100 Platform One Auto-link - matching, delink and link again (UI smoke)', async ({
  page,
}) => {
  await runAutoLinkCreateUserSmoke({ page, firmCode: 3 });
});
