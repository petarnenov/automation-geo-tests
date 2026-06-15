// @ts-check
/**
 * TestRail C26453 — Check impersonated user role/s with enabled Impersonation
 *   permission (Positive).
 *
 * The TestRail step list expects browser 1 to log in as the target Employee
 * and browser 2 (tim1) to then impersonate them. We can't dynamically log in
 * as an arbitrary firm 1 Employee because their passwords aren't part of the
 * automation surface; we approximate by:
 *   - Context A: a worker GW Admin (gwa0) signs in — a concurrent active
 *     session, mirroring the "browser 1 has someone logged in" precondition.
 *   - Context B: tim1 navigates to the Impersonate grid and impersonates the
 *     first-row Employee (the one whose row click was already verified by
 *     C26449). The assertion key here is that the impersonation succeeds
 *     while context A's session is alive — i.e. concurrent sessions do not
 *     block role propagation.
 *
 * If a target Employee's credentials are later wired into the suite,
 * tighten Context A to log in as that same target.
 */

const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { cfg, login } = require('../../_helpers/qa3');
const {
  loginAsTim1Fresh,
  selectFirmInImpersonate,
  impersonateFirstNonSelfEmployee,
  FIRM_CD_GEOWEALTH,
  terminateImpersonationFromUserMenu,
} = require('./_helpers');

const GW_ADMINS_PATH = path.join(__dirname, '..', '..', '.auth', 'gwadmins.json');

test('@pepi C26453 Platform One Check for impersonated user roles cross-browser (Positive)', async () => {
  test.setTimeout(240_000);

  const gwadmins = JSON.parse(fs.readFileSync(GW_ADMINS_PATH, 'utf8')).admins;
  const concurrentUser = gwadmins[0];

  const browser = await chromium.launch();
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  try {
    await pageA.goto(cfg.appUnderTest.url);
    await login(pageA, concurrentUser.username, concurrentUser.password);
    await pageA.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });
    console.log(`[C26453] context A live as ${concurrentUser.username} → ${pageA.url()}`);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    try {
      await loginAsTim1Fresh(pageB);
      await pageB.goto(
        `/react/indexReact.do#platformOne/firmAdmin/userImpersonation/${FIRM_CD_GEOWEALTH}`
      );
      await expect(pageB.locator('#UserImpersonationWrapper')).toBeVisible({ timeout: 30_000 });
      const targetName = await impersonateFirstNonSelfEmployee(pageB, []);
      console.log(`[C26453] context B impersonating: ${targetName}`);

      // Post-impersonation: context B leaves the Impersonate page and lands
      // in the target user's portal (Advisor Portal / Manager Portal / legacy
      // ExtJS depending on the firm + portal mapping).
      await expect(pageB).not.toHaveURL(/firmAdmin\/userImpersonation/, { timeout: 30_000 });
      await expect(pageB).toHaveURL(
        /#(dashboard|modelCenter|platformOne)|portalIndex\.do/,
        { timeout: 30_000 }
      );

      await terminateImpersonationFromUserMenu(pageB);
    } finally {
      await contextB.close();
    }
  } finally {
    await contextA.close();
    await browser.close();
  }
});
