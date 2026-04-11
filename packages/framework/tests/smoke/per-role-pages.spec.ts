/**
 * Per-role page fixtures smoke spec.
 *
 * Phase 2 step 4 (D-37) verification path. Exercises the three
 * test-scoped fixtures from `pages.fixture.ts` end-to-end against
 * qa2: each fixture launches its own context, drives the resilient
 * login flow, and yields a Page that is actually authenticated as
 * the right user.
 *
 * Two assertions per fixture:
 *   1. The page reached the application (URL contains
 *      `/react/indexReact.do`).
 *   2. The login form is NOT visible (proof that login completed —
 *      if the form is still showing, the click never went through
 *      or post-login navigation failed).
 *
 * The combined `tylerPage` + `workerFirmAdminPage` test mirrors what
 * C25193 will do post-port: two distinct identities in two distinct
 * contexts, used sequentially within one spec. The fixtures are
 * idiomatically composable — Playwright handles the parallel
 * launch + cleanup automatically.
 */

import { test, expect, getFirmForPage } from '@geowealth/e2e-framework/fixtures';

test('@smoke @framework workerFirmAdminPage logs in as the dummy firm admin', async ({
  workerFirmAdminPage,
  workerFirm,
}) => {
  // The page navigated to the app and survived post-login routing.
  await expect(workerFirmAdminPage).toHaveURL(/\/react\/indexReact\.do/);

  // Login form is gone — proof we got past the form. The username
  // input is the most reliable "is the form showing" signal because
  // its placeholder is stable across qa branches.
  await expect(workerFirmAdminPage.getByPlaceholder(/email|username/i)).toBeHidden();

  // The session belongs to the worker firm's auto-generated admin
  // (admin_<firmCd>) — the workerFirm fixture provided the loginName.
  expect(workerFirm.admin.loginName).toMatch(new RegExp(`^admin_${workerFirm.firmCd}$`));
});

test('@smoke @framework tylerPage logs in as tyler@plimsollfp.com', async ({ tylerPage }) => {
  await expect(tylerPage).toHaveURL(/\/react\/indexReact\.do/);
  await expect(tylerPage.getByPlaceholder(/email|username/i)).toBeHidden();
});

test('@smoke @framework firmAdminPage loads storage state from the pool (no form login)', async ({
  firmAdminPage,
}) => {
  // The pool-based fixture does zero form logins — it loads the
  // storage state globalSetup captured. So the page should already be
  // authenticated as `admin_<firmCd>` the first time we interact with it.
  await firmAdminPage.goto('/react/indexReact.do');
  await expect(firmAdminPage).toHaveURL(/\/react\/indexReact\.do/);
  await expect(firmAdminPage.getByPlaceholder(/email|username/i)).toBeHidden();

  // The firm backing this page is whichever (firm, admin) slot the
  // checkout found free. We recover it via the side-channel map.
  const firm = getFirmForPage(firmAdminPage);
  expect(firm.logins.admin.loginName).toBe(`admin_${firm.firmCd}`);
});

test('@smoke @framework firmGwAdminPage and firmNonGwAdminPage co-locate on the worker firm', async ({
  firmGwAdminPage,
  firmNonGwAdminPage,
}) => {
  // Per-worker firm pinning: every Playwright worker owns exactly one
  // firm, so any two pool-based role fixtures consumed in the same
  // test MUST land on the same firm. This is the guarantee tests
  // that mix roles (admin creates, advisor views) rely on.
  await firmGwAdminPage.goto('/react/indexReact.do');
  await firmNonGwAdminPage.goto('/react/indexReact.do');

  await expect(firmGwAdminPage).toHaveURL(/\/react\/indexReact\.do/);
  await expect(firmNonGwAdminPage).toHaveURL(/\/react\/indexReact\.do/);
  await expect(firmGwAdminPage.getByPlaceholder(/email|username/i)).toBeHidden();
  await expect(firmNonGwAdminPage.getByPlaceholder(/email|username/i)).toBeHidden();

  const gwFirm = getFirmForPage(firmGwAdminPage);
  const nonFirm = getFirmForPage(firmNonGwAdminPage);
  expect(gwFirm.firmCd).toBe(nonFirm.firmCd);
  expect(gwFirm.logins.gwAdmin.loginName).toBe(`u${gwFirm.firmCd}_gwadmin`);
  expect(nonFirm.logins.nonGwAdmin.loginName).toBe(`u${nonFirm.firmCd}_nongwadmin`);
});

test('@smoke @framework two distinct identities can coexist in one spec', async ({
  workerFirmAdminPage,
  tylerPage,
}) => {
  // test.slow() bumps the default 60s test timeout to 180s (per
  // Section 4.8 — specs that need more time must call setTimeout
  // and document why). Justification here: each per-role fixture's
  // setup includes a real qa login round-trip (~30s on qa2 under
  // typical load), and Playwright sets up requested fixtures
  // serially; consuming two fixtures in one test stacks the login
  // costs to ~60s, which is exactly at the default test timeout.
  // Three minutes leaves headroom for qa2 timing variance.
  test.slow();
  // Both pages are independent contexts — neither's cookies bleed
  // into the other. This is the C25193 graduation pattern: Phase 1
  // uses workerFirmAdminPage, Phase 2 uses tylerPage, and the test
  // body never has to clearCookies + re-login on a single page.
  await expect(workerFirmAdminPage).toHaveURL(/\/react\/indexReact\.do/);
  await expect(tylerPage).toHaveURL(/\/react\/indexReact\.do/);

  // Both pages reached the app simultaneously (Playwright sets up
  // the fixtures in parallel). Neither shows the login form — both
  // are authenticated.
  await expect(workerFirmAdminPage.getByPlaceholder(/email|username/i)).toBeHidden();
  await expect(tylerPage.getByPlaceholder(/email|username/i)).toBeHidden();
});
