// @ts-check
/**
 * TestRail C26060 — Platform One: Merge prospect with empty client + empty prospect
 *   (MERGE PROSPECT permissions DISABLED by default, site 61).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26060 (Run 175, label Pepi)
 * Refs:   GEO-13610
 *
 * The case verifies that when MERGE PROSPECT permission is disabled at the
 * firm level, the "Merge With Prospect" button does NOT appear on the Edit
 * Client page.
 *
 * IMPLEMENTATION STATUS: not automated.
 *
 * Blocker: in qa3 we cannot find a user/firm combination where MERGE PROSPECT
 * is disabled.
 *   - `tim1` has the permission enabled in firm 61 and firm 1 (verified — the
 *     button is visible for Test asdfg and Test Client respectively).
 *   - `albina.urmat1` is a GW Admin user. GW Admin overrides all role-based
 *     permission checks, so even though her default role has the Merge Prospect
 *     permission unchecked, she still sees the button (verified manually:
 *     navigated to firm 1 Test Client as Albina, the button was rendered).
 *
 * To unblock, we need a NON-GW-Admin user whose role does not include the
 * Merge Prospect permission AND who has firmAdmin/contactManagement access.
 * Such a user is not currently provisioned in qa3.
 */

const { test } = require('@playwright/test');

test('@pepi C26060 Platform One Merge Prospect - empty client + permissions disabled, site 61', async () => {
  test.fixme(
    true,
    'Cannot automate without a user/firm where MERGE PROSPECT permission is disabled — see header comment.'
  );
});
