/**
 * `@geowealth/e2e-framework` public surface.
 *
 * Per Decision D-36, every importable subpath is declared in the
 * `exports` field of this package's `package.json`. The default entry
 * (this file) re-exports the most commonly used names; everything else
 * is reachable via the `./config`, `./fixtures`, etc. subpaths.
 *
 * Phase 0 Step 0.F.
 */

export {
  definePlaywrightConfig,
  type DefinePlaywrightConfigOptions,
  selectEnvironment,
  environments,
  type EnvironmentName,
  type EnvironmentConfig,
} from './config/index.js';

export { test, expect } from './fixtures/base.js';
export { STORAGE_STATE_PATH } from './fixtures/globalSetup.js';
