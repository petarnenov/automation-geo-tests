// @ts-check
/**
 * TestRail C26080 — Platform One: Auto-link new GW Admin user with non-matching
 *   email from Site 1 account.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26080 (Run 175, label Pepi)
 *
 * UI smoke (safety stop) — see ./_helpers.js for the rationale.
 */

const { test } = require('@playwright/test');
const { runAutoLinkCreateUserSmoke } = require('./_helpers');

test('@pepi C26080 Platform One Auto-link - non-matching email triggers no link (UI smoke)', async ({
  page,
}) => {
  await runAutoLinkCreateUserSmoke({ page, firmCode: 3 });
});
