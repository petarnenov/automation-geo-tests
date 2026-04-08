// @ts-check
/**
 * TestRail C26085 — Platform One: Merge prospect with empty client + empty prospect
 *   (MERGE PROSPECT permissions DISABLED by default, site 1).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26085 (Run 175, label Pepi)
 * Refs:   GEO-13610
 *
 * IMPLEMENTATION STATUS: not automated.
 *
 * Blocker: same as C26060. We tried two qa3 users:
 *   - `tim1` — has the permission enabled in firm 1.
 *   - `albina.urmat1` — is a GW Admin user, which overrides role-based
 *     permission checks; she still sees the button on Test Client (firm 1)
 *     even though her default role has Merge Prospect unchecked.
 * Asserting the "permissions disabled" branch needs a NON-GW-Admin user with
 * a role that does not include Merge Prospect, which is not currently
 * provisioned in qa3.
 */

const { test } = require('@playwright/test');

test('@pepi C26085 Platform One Merge Prospect - empty client + permissions disabled, site 1', async () => {
  test.fixme(
    true,
    'Cannot automate without a user/firm where MERGE PROSPECT permission is disabled — see header comment.'
  );
});
