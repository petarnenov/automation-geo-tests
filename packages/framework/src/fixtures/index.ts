/**
 * Public surface of `@geowealth/e2e-framework/fixtures`.
 */

export { test, expect } from './base';
export { authFixtures, attachStorageState, type AuthFixtures } from './auth.fixture';
export { default as globalSetup, STORAGE_STATE_PATH } from './globalSetup';
