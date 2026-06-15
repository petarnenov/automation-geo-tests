// @ts-check
/**
 * TestRail C26425 — Platform One: Impersonate menu NOT visible for site 1
 *   firms with disabled Impersonation permission (Negative).
 *
 * Uses a worker GW Admin (`gwa0`) — a firm 1 user whose only role is
 * "All Employees" (529). With the BO toggle removing Impersonation from
 * that role, gwa0 satisfies "site 1 user without Impersonation permission"
 * exactly. We force a fresh form login (clearCookies + login) so the
 * backend session is rebuilt against the current role permission state,
 * sidestepping any cached storage-state session created before the toggle.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { login } = require('../../_helpers/qa3');
const { expandOperationsGroup, hoverFirmAdminGroup } = require('./_helpers');

const GW_ADMINS_PATH = path.join(__dirname, '..', '..', '.auth', 'gwadmins.json');

test('@pepi C26425 Platform One Impersonate menu NOT visible for site 1 without permission (Negative)', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);

  const gwa = JSON.parse(fs.readFileSync(GW_ADMINS_PATH, 'utf8')).admins[0];

  await test.step('Fresh login as gwa0 (firm 1 GW Admin without Impersonation permission)', async () => {
    await context.clearCookies();
    await login(page, gwa.username, gwa.password);
    await page.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
    if (!page.url().includes('#platformOne')) {
      await page.goto('/react/indexReact.do#platformOne');
    }
    await expect(page).toHaveURL(/#platformOne/, { timeout: 30_000 });
  });

  await test.step('Expand Operations → Firm Admin and assert Impersonate link is NOT present', async () => {
    await expandOperationsGroup(page);
    await hoverFirmAdminGroup(page);
    await expect(page.locator('a[href*="firmAdmin/userImpersonation"]')).toHaveCount(0);
  });
});
