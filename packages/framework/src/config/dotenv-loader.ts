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

import * as fs from 'node:fs';
import * as path from 'node:path';
import dotenvFlow from 'dotenv-flow';

/**
 * Find the workspace root by walking up from `process.cwd()` looking for
 * a marker file (`tsconfig.base.json` is unique to the workspace root).
 *
 * Module-system agnostic: works whether the framework is loaded by
 * Playwright's CJS-style TS loader (no `import.meta.url`) or by a Node
 * 22+ ESM runtime. Avoids hardcoding `__dirname` paths that depend on
 * the file's location.
 */
function findWorkspaceRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 16; i++) {
    if (fs.existsSync(path.join(dir, 'tsconfig.base.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'dotenv-loader: could not find workspace root (no tsconfig.base.json ' +
      `walking up from ${process.cwd()})`
  );
}

export const WORKSPACE_ROOT = findWorkspaceRoot();

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
