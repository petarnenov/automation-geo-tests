/**
 * Workspace-root .env loader for the GeoWealth E2E framework.
 *
 * Loads .env, .env.<NODE_ENV>, .env.local, .env.<NODE_ENV>.local from the
 * workspace root, in dotenv-flow's standard precedence order. Variables
 * already in `process.env` are NOT overwritten — CI's injected env vars
 * take precedence over .env.local.
 *
 * Phase 0 Step 0.F. The legacy POC has its own `load-env.js` (CommonJS,
 * Step 0.C); this is the new framework's TypeScript counterpart, used by
 * `definePlaywrightConfig` and any framework helper that reads
 * `process.env` at module load time.
 *
 * Resolution: walks two levels up from this file's directory to reach the
 * workspace root (`packages/framework/src/config/` → `packages/framework/`
 * → workspace root). The path math is correct as long as this file lives
 * under `packages/framework/src/config/`.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// packages/framework/src/config → packages/framework/src → packages/framework
//   → packages → workspace root.
export const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

let loaded = false;

/**
 * Idempotent loader. Safe to call from multiple entry points; the second
 * and subsequent calls are no-ops because dotenv-flow does not overwrite
 * already-set variables anyway, and we additionally short-circuit here.
 */
export function loadWorkspaceEnv(): void {
  if (loaded) return;
  dotenvFlow.config({
    path: WORKSPACE_ROOT,
    silent: true,
  });
  loaded = true;
}
