/**
 * The framework's composed `test` and `expect` exports.
 *
 * Specs in `tests-<team>` packages always import from
 * `@geowealth/e2e-framework/fixtures` (or directly from
 * `@geowealth/e2e-framework`), never from `@playwright/test`.
 *
 * Phase 2 step 3 (D-37) — composition layered to:
 *   1. authFixtures      — tim1StorageState (worker scope)
 *   2. apiFixtures       — apiRequestContext + apiClient (worker scope)
 *   3. workerFirmFixtures — workerFirm (worker scope), depends on
 *                          apiClient.
 *
 * The merge order matters for dependent fixtures: the consumer must
 * appear after the producer. workerFirm consumes apiClient which
 * consumes apiRequestContext which consumes tim1StorageState — the
 * order below honors that chain.
 */

import { mergeTests } from '@playwright/test';
import { authFixtures } from './auth.fixture';
import { apiFixtures } from './api.fixture';
import { workerFirmFixtures } from './workerFirm.fixture';
import { pageFixtures } from './pages.fixture';

export const test = mergeTests(authFixtures, apiFixtures, workerFirmFixtures, pageFixtures);
export { expect } from '@playwright/test';
