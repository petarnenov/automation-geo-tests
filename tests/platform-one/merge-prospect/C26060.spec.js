// @ts-check
/**
 * TestRail C26060 — Platform One: Merge prospect with empty client + empty
 *   prospect (MERGE PROSPECT permissions DISABLED by default, site 61).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26060 (Run 214, label Pepi)
 * Refs:   GEO-13610
 *
 * IMPLEMENTATION STATUS: blocked. Latest attempt (2026-06-19) was the
 * cleanest yet and still produced a Merge With Prospect button for a
 * fresh-from-zero firm-61 GW Admin.
 *
 * What 2026-06-19 attempted (and what failed):
 *   1. Provisioned a fresh client in firm 61 via `/ux/createClient.do`
 *      (`provisionClientPortalAccess` helper) — owns the UUID, no
 *      autocomplete indexer dependency.
 *   2. Provisioned a fresh firm-61 GW Admin via createFirmUser
 *      (`firmCd:61, gwAdminFlag:true`, default role 529 = "All
 *      Employees"). Per the case precondition that role should NOT
 *      carry MERGE_PROSPECTS (80_5).
 *   3. Logged in as that admin in an isolated context, navigated
 *      directly to the EditClient URL.
 *   4. Asserted "Merge With Prospect" button hidden.
 *
 *   → Button was rendered (visible 9× while waiting for it to hide). So
 *     either the firm-61 default role for GW Admins DOES include
 *     MERGE_PROSPECTS in qa4 (contradicting the case precondition copy),
 *     or there's a GW-Admin-side override the FE permissionsHelper does
 *     not show. Same outcome Albina hit in the previous attempt.
 *
 * To unblock — pick ONE of:
 *   1. Test-data team manually mints a firm-61 GW Admin and STRIPS
 *      MERGE_PROSPECTS (80_5) from their assigned role(s) directly in
 *      the role/permission DB tables. Pin those credentials in
 *      `.env.local` / `testrail.config.json`. We re-enable this spec to
 *      log in with the pinned user.
 *   2. New `/qa/createMergeProspectDisabledAdmin.do` seed action that
 *      creates a firm-61 GW Admin and removes 80_5 from their assigned
 *      role's permission set in the same Hibernate transaction. See
 *      `docs/be-unblock-prompts/` for the spec template.
 *   3. Reframe the TestRail case as an FE-only contract test: route-mock
 *      the EditClient permissions response to drop `MERGE_PROSPECTS` and
 *      assert the button is hidden. Documents the FE-side gate but does
 *      not exercise a real permission scenario end-to-end.
 *
 * The previous attempt's UI scaffolding (provisioning client +
 * createFirmUser firm 61 + direct EditClient URL) is preserved and
 * known-working — once a permissions-disabled user exists, only the
 * login step + assertion remain to flip this from fixme to green.
 */

const { test } = require('@playwright/test');

test('@pepi C26060 Platform One Merge Prospect - empty client + permissions disabled, site 61', async () => {
  test.fixme(
    true,
    'Fresh firm-61 GW Admin still has MERGE_PROSPECTS — no qa4 user/firm combo with ' +
      'the perm disabled. See header for the three unblock options.'
  );
});
