/**
 * Walking-skeleton smoke spec for the Reporting team.
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

test('@smoke @reporting walking skeleton — Platform One landing renders', async ({ page }) => {
  await page.goto('/react/indexReact.do#platformOne');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Platform One!' })
  ).toBeVisible({ timeout: 30_000 });
});
