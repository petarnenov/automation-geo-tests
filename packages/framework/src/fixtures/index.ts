/**
 * Public surface of `@geowealth/e2e-framework/fixtures`.
 */

export { test, expect } from './base.js';
export { authFixtures, attachStorageState, type AuthFixtures } from './auth.fixture.js';
export { default as globalSetup, STORAGE_STATE_PATH } from './globalSetup.js';
