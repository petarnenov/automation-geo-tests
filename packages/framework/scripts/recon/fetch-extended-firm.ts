/**
 * Recon script — capture the raw response shape of `/qa/createDummyFirmExtended.do`.
 *
 * Logs in as tim1 via the framework's resilient login helper, calls the
 * extended dummy-firm endpoint through the logged-in context, and writes
 * the parsed JSON response to a dated fixture under
 * `packages/framework/tests/api/qa/__fixtures__/`.
 *
 * Usage:
 *     npx tsx packages/framework/scripts/recon/fetch-extended-firm.ts
 *     npx tsx packages/framework/scripts/recon/fetch-extended-firm.ts --env=qa2
 *
 * Env vars required (from workspace `.env.local` or shell):
 *     TIM1_USERNAME, TIM1_PASSWORD
 *
 * Output:
 *     packages/framework/tests/api/qa/__fixtures__/createDummyFirmExtended.<env>.<YYYY-MM-DD>.json
 *
 * The response is parsed as text → JSON.parse to match the ApiClient
 * behaviour (qa endpoints return `Content-Type: text/plain;charset=UTF-8`
 * even though the body is JSON).
 */

import { chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadWorkspaceEnv, WORKSPACE_ROOT } from '../../src/config/dotenv-loader';
import { environments, type EnvironmentName } from '../../src/config/environments';
import { loginViaForm } from '../../src/fixtures/loginViaForm';

const ENDPOINT = '/qa/createDummyFirmExtended.do';
const DEFAULT_ENV: EnvironmentName = 'qa2';
const REQUEST_TIMEOUT_MS = 180_000;

function parseEnvArg(): EnvironmentName {
  const flag = process.argv.slice(2).find((a) => a.startsWith('--env='));
  if (!flag) return DEFAULT_ENV;
  const value = flag.slice('--env='.length) as EnvironmentName;
  if (!(value in environments)) {
    throw new Error(`Unknown env "${value}". Known: ${Object.keys(environments).join(', ')}`);
  }
  return value;
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function main(): Promise<void> {
  loadWorkspaceEnv();

  const envName = parseEnvArg();
  const env = environments[envName];

  const username = process.env.TIM1_USERNAME;
  const password = process.env.TIM1_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'fetch-extended-firm: TIM1_USERNAME / TIM1_PASSWORD must be set in .env.local.'
    );
  }

  console.log(`[recon] env=${envName} baseUrl=${env.baseUrl}`);
  console.log(`[recon] launching headless chromium…`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: env.baseUrl,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    console.log(`[recon] logging in as ${username}…`);
    await loginViaForm(page, username, password, env.baseUrl);

    console.log(`[recon] POST ${env.baseUrl}${ENDPOINT.replace(/^\//, '')}`);
    const started = Date.now();
    const response = await context.request.post(ENDPOINT, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    const elapsedMs = Date.now() - started;

    const status = response.status();
    const contentType = response.headers()['content-type'] ?? '(none)';
    const bodyText = await response.text();

    console.log(`[recon] status=${status} contentType=${contentType} bytes=${bodyText.length} elapsed=${elapsedMs}ms`);

    if (status < 200 || status >= 300) {
      console.error(`[recon] non-2xx response body (first 500 chars):`);
      console.error(bodyText.slice(0, 500));
      throw new Error(`fetch-extended-firm: endpoint returned HTTP ${status}`);
    }

    // Parse as text → JSON.parse to match ApiClient behaviour.
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e) {
      console.error(`[recon] body is not valid JSON. First 500 chars:`);
      console.error(bodyText.slice(0, 500));
      throw e;
    }

    const outDir = path.join(
      WORKSPACE_ROOT,
      'packages',
      'framework',
      'tests',
      'api',
      'qa',
      '__fixtures__'
    );
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `createDummyFirmExtended.${envName}.${todayStamp()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');

    console.log(`[recon] response saved → ${path.relative(WORKSPACE_ROOT, outFile)}`);

    // Quick preview so you can eyeball the shape without opening the file.
    if (parsed && typeof parsed === 'object') {
      const topKeys = Object.keys(parsed as Record<string, unknown>);
      console.log(`[recon] top-level keys: ${topKeys.join(', ')}`);
      const p = parsed as Record<string, unknown>;
      if (p.firm) console.log(`[recon] firm: ${JSON.stringify(p.firm)}`);
      if (p.adminUser) console.log(`[recon] adminUser: ${JSON.stringify(p.adminUser)}`);
      if (Array.isArray(p.users)) {
        console.log(`[recon] users[]: ${p.users.length} entries`);
        for (const [i, u] of p.users.slice(0, 6).entries()) {
          const loginName = (u as { loginName?: unknown }).loginName;
          console.log(`  [${i}] loginName=${String(loginName)}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[recon] failed:', err);
  process.exit(1);
});
