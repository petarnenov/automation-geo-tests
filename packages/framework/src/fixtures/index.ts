/**
 * Public surface of `@geowealth/e2e-framework/fixtures`.
 */

export { test, expect } from './base';
export { authFixtures, attachStorageState, type AuthFixtures } from './auth.fixture';
export { apiFixtures, type ApiFixtures } from './api.fixture';
export {
  workerFirmFixtures,
  getFirmForPage,
  type WorkerFirm,
  type WorkerFirmFixtures,
} from './workerFirm.fixture';
export { pageFixtures, type PageFixtures } from './pages.fixture';
export { loginViaForm, clearAndLoginAs } from './loginViaForm';
export { default as globalSetup, STORAGE_STATE_PATH } from './globalSetup';
