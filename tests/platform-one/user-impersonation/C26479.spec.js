// @ts-check
/**
 * TestRail C26479 — Platform One: Direct URL access blocked for unauthorized
 *   user (Negative).
 *
 * As `gwa0` (fresh login, role 529 = All Employees, no Impersonation
 * permission after the BO toggle), pasting the Impersonate URL directly
 * must NOT render the grid + controls. The route guard
 * `{hasPermissionImpersonateEmployee && (<Route .../>)}` in `Router.js`
 * skips registration for an unauthorized user, leaving the content area
 * empty.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { login } = require('../../_helpers/qa3');

const GW_ADMINS_PATH = path.join(__dirname, '..', '..', '.auth', 'gwadmins.json');

test('@pepi C26479 Platform One Impersonate direct URL blocked for unauthorized user (Negative)', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);

  const gwa = JSON.parse(fs.readFileSync(GW_ADMINS_PATH, 'utf8')).admins[0];

  await test.step('Fresh login as gwa0 (no Impersonation permission)', async () => {
    await context.clearCookies();
    await login(page, gwa.username, gwa.password);
    await page.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
  });

  await test.step('Direct navigate to Impersonate URL — page must not render', async () => {
    await page.goto('/react/indexReact.do#platformOne/firmAdmin/userImpersonation', {
      waitUntil: 'domcontentloaded',
    });
    // Allow the SPA time to either render or refuse to render.
    await page.waitForTimeout(3000);

    await expect(page.locator('#UserImpersonationWrapper')).toHaveCount(0);
    await expect(page.locator('#selectFirm')).toHaveCount(0);
    await expect(page.locator('#p1UserImpersonationGrid')).toHaveCount(0);
  });
});
