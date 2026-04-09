// @ts-check
/**
 * TestRail C26093 — Platform One: Auto-link new GW Admin user with Site 1
 *   account, both saved without email addresses.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26093 (Run 175, label Pepi)
 *
 * UI smoke (safety stop) — see ./_helpers.js for the rationale.
 */

const { test } = require('@playwright/test');
const { runAutoLinkCreateUserSmoke } = require('./_helpers');

test('@pepi C26093 Platform One Auto-link - both users without email (UI smoke)', async ({
  page,
}) => {
  await runAutoLinkCreateUserSmoke({ page, firmCode: 3 });
});
