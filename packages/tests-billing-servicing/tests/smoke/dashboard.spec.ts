/**
 * Walking-skeleton smoke spec for the Billing & Servicing team.
 *
 * Generated from packages/tooling/templates/team/tests/smoke/dashboard.spec.ts.tpl.
 *
 * Selector evolution (Phase 0 Step 0.G end-to-end run discovered the
 * correction to D-46):
 *   - tim1 lands on #platformOne (D-45 — NOT #/dashboard despite the
 *     spec file's name).
 *   - The Step 0.0 recon enumerated 118 <h4> menu items and chose
 *     "Operations" (D-46), but those <h4>s only appear AFTER the SPA
 *     hydrates the menu. The first thing that renders is the
 *     <h1> "Welcome to Platform One!" splash heading — a more stable
 *     landmark and a semantically clearer "you reached the landing
 *     page" check (D-48 corrects D-46).
 *
 * Reachable via getByRole rung 2 (Section 4.7) — no data-testid
 * dependency, no CSS / XPath fallback.
 *
 * The spec is named dashboard.spec.ts (not login.spec.ts) so future
 * team-authored login specs at tests/smoke/login.spec.ts do not collide
 * with the scaffolded walking skeleton.
 */

import { test, expect } from '@geowealth/e2e-framework';

test('@smoke @billing-servicing walking skeleton — Platform One landing renders', async ({ page }) => {
  // test.slow() bumps the default 60s test timeout to 180s. The
  // walking skeleton runs `goto + render + heading wait` against a
  // freshly-restored tim1 storage state, and qa2's first SPA render
  // can take 30+ seconds when the package's other smoke specs are
  // hitting the same env in parallel (verified empirically: this
  // spec passes in isolation in 26.5s but races against the
  // AccountBillingPage smoke under default parallelism, exceeding
  // the 30s default navigationTimeout). Per Section 4.8 specs that
  // need more time must call setTimeout and document why.
  test.slow();

  // `waitUntil: 'domcontentloaded'` is the better signal for an
  // SPA navigation than the default 'load' — we only need the JS
  // to start running, not for every image/CSS resource to finish
  // downloading. The 60s timeout overrides the framework default
  // navigationTimeout (30s in definePlaywrightConfig) for this
  // specific goto.
  await page.goto('/react/indexReact.do#platformOne', {
    timeout: 60_000,
    waitUntil: 'domcontentloaded',
  });
  await expect(
    page.getByRole('heading', { name: 'Welcome to Platform One!' })
  ).toBeVisible({ timeout: 60_000 });
});
