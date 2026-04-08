// @ts-check
/**
 * TestRail C26094 — Platform One: Auto-link new GW Admin user with empty email
 *   with Site 1 account.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26094 (Run 175, label Pepi)
 *
 * UI smoke (safety stop) — see ./_helpers.js for the rationale.
 */

const { test } = require('@playwright/test');
const { runAutoLinkCreateUserSmoke } = require('./_helpers');

test('@pepi C26094 Platform One Auto-link - new user with empty email (UI smoke)', async ({
  page,
}) => {
  await runAutoLinkCreateUserSmoke({ page, firmCode: 3 });
});
