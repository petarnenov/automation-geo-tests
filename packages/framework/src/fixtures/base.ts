/**
 * The framework's composed `test` and `expect` exports.
 *
 * Specs in `tests-<team>` packages always import from
 * `@geowealth/e2e-framework/fixtures` (or directly from
 * `@geowealth/e2e-framework`), never from `@playwright/test`.
 *
 * Phase 0 Step 0.F. Today the composition includes only the auth fixture.
 * Phase 2 will use `mergeTests` to layer in firm / worker-firm / api /
 * page fixtures.
 */

import { mergeTests } from '@playwright/test';
import { authFixtures } from './auth.fixture.js';

export const test = mergeTests(authFixtures);
export { expect } from '@playwright/test';
