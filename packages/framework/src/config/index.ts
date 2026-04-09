/**
 * Public surface of `@geowealth/e2e-framework/config`.
 */

export {
  definePlaywrightConfig,
  type DefinePlaywrightConfigOptions,
} from './playwright';
export {
  environments,
  selectEnvironment,
  assertNotProduction,
  type EnvironmentName,
  type EnvironmentConfig,
} from './environments';
export { loadWorkspaceEnv, WORKSPACE_ROOT } from './dotenv-loader';
