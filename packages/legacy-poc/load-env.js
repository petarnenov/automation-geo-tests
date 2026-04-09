// @ts-check
/**
 * Shared dotenv loader for the legacy POC.
 *
 * Loads .env.local (and .env, .env.<NODE_ENV>, …) from the workspace root
 * so every legacy POC entry point — playwright.config.js, the standalone
 * scripts under scripts/, the reporter — sees the same environment
 * variables. Must be required FIRST in any entry point that subsequently
 * reads process.env.
 *
 * Phase 0 Step 0.C — env-var refactor. The legacy POC's two secret fields
 * (TIM1_USERNAME, TIM1_PASSWORD) used to live in testrail.config.json;
 * they now live in workspace-root .env.local (gitignored). The JSON file
 * keeps only non-secret config (TestRail run id, label filter, base URL).
 *
 * dotenv-flow walks the path argument and loads, in increasing precedence:
 *   .env, .env.<NODE_ENV>, .env.local, .env.<NODE_ENV>.local
 * Variables already in process.env are NOT overwritten — CI's injected
 * env vars take precedence over .env.local.
 */

const path = require('path');

// __dirname here is packages/legacy-poc/. The workspace root is two levels up.
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');

require('dotenv-flow').config({
  path: WORKSPACE_ROOT,
  silent: true,
});

module.exports = { WORKSPACE_ROOT };
