// @ts-check
/**
 * TestRail C26077 — Platform One: Auto-link new GW Admin user with matching
 *   Site 1 account.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26077 (Run 175, label Pepi)
 *
 * SAFETY: this test is a UI smoke that opens the Create New User modal and
 * verifies the GW Admin checkbox + Email field are present. It STOPS before
 * clicking Create because creating a user is destructive and qa3 has no
 * documented per-run cleanup. See ./_blocker-note.md and ./_helpers.js for
 * the full rationale and what's needed to upgrade this to the full flow.
 */

const { test } = require('@playwright/test');
const { runAutoLinkCreateUserSmoke } = require('./_helpers');

test('@pepi C26077 Platform One Auto-link - new GW Admin user with matching Site 1 account (UI smoke)', async ({
  page,
}) => {
  await runAutoLinkCreateUserSmoke({ page, firmCode: 3 });
});
