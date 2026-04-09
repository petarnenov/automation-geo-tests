/**
 * Playwright config for the @geowealth/e2e-framework package itself.
 *
 * Phase 2 step 1.1 (D-37). The framework package runs its own
 * component smoke specs as a dedicated package shard alongside the
 * team packages — every Component class lifted in step 5
 * (ReactDatePicker, ComboBox, AgGrid, NumericInput, TypeAhead) gets
 * a single dedicated spec under `tests/components/` that exercises
 * its primary actions on a known qa2 page (no business assertions).
 *
 * Until step 5 lands, the framework's only spec is a sanity smoke
 * spec under `tests/smoke/sanity.spec.ts` which verifies the package
 * loads and a Playwright browser can boot. It exists so the per-
 * package CI matrix has something to run for the `framework` package
 * — without it, the matrix shard fails with "no tests found".
 *
 * The config is identical in shape to a team package's config: it
 * delegates to `definePlaywrightConfig` which centralizes timeouts,
 * retries, reporters, and the production safety guard. Per D-41 the
 * framework also writes its storage state to the workspace-root
 * `<workspace>/.auth/tim1.json` (shared across all packages to bound
 * login pressure on qa2/qa3) — `definePlaywrightConfig` already does
 * that by default.
 */

import { definePlaywrightConfig } from '@geowealth/e2e-framework/config';

export default definePlaywrightConfig({
  projectName: 'framework',
  testDir: './tests',
});
