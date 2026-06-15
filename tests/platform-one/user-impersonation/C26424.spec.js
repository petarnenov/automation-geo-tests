// @ts-check
/**
 * TestRail C26424 — Platform One: Impersonate menu visible for site 1 firms
 *   with enabled Impersonation permission (Positive).
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26424 (Run 206, label Pepi)
 * Refs:   GEO-22320
 *
 * Verifies the gating in useSideBarLinks: tim1 (firm 1, with IMPERSONATE_EMPLOYEE
 * permission) sees the Impersonate item under Operations → Firm Admin (it's the
 * penultimate item in the flyout: User Management, Users, **Impersonate**,
 * Access Sets), and clicking it loads the UserImpersonation page with the
 * firm selector and an "IMPERSONATE ACTION" grid column.
 *
 * IMPORTANT: the helper forces a fresh tim1 session (`context.clearCookies`
 * + form login). The default worker context is preloaded with a per-worker
 * GW Admin (`gwa0_...`) that only has the "All Employees" role and lacks
 * IMPERSONATE_EMPLOYEE — running this case under that session would always
 * fail. See ./_helpers.js for the rationale.
 */

const { test } = require('@playwright/test');
const { runImpersonateMenuVisibilityCheck } = require('./_helpers');

test('@pepi C26424 Platform One Impersonate menu visible for site 1 with permission (Positive)', async ({
  page,
}) => {
  await runImpersonateMenuVisibilityCheck({ page });
});
