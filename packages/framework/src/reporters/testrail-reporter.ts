/**
 * Framework TestRail reporter — TypeScript port of the legacy POC's
 * `packages/legacy-poc/reporters/testrail-reporter.js`.
 *
 * Phase 1.6. Per Decision D-15: this reporter NEVER points at TestRail
 * Run 175 while the legacy JS reporter is also pointed at it. The
 * cutover from JS-on-Run-175 to TS-on-Run-175 is atomic, single-PR,
 * and happens at Phase 5 sunset. Until then this reporter posts to a
 * separate sandbox run for parity verification.
 *
 * Per D-30, when multiple per-package runs report concurrently, each
 * writes to a per-package result file under
 * `<package-root>/test-results/testrail-results.json` and a single
 * post-processing job aggregates them into one POST. This reporter
 * supports both modes:
 *
 *   - Direct mode (default): POST results immediately at onEnd.
 *   - Aggregator mode (`TESTRAIL_AGGREGATE=1`): write the per-package
 *     result file and skip the POST. The aggregator job (Phase 1.7,
 *     `testrail-aggregator.ts`) reads every per-package file and POSTs
 *     them in a single call.
 *
 * Behavior parity with the legacy JS reporter:
 *   - Reads run id, label filter, and TestRail base URL from
 *     `packages/legacy-poc/testrail.config.json` while the legacy POC
 *     is alive. After Phase 5 sunset this is replaced by a per-team
 *     config injection (Phase 5).
 *   - Auth: TESTRAIL_USER + (TESTRAIL_API_KEY or TESTRAIL_PASSWORD).
 *     Tries password first (legacy comment: api-key-first caused
 *     account lockout from accumulated 401s).
 *   - TESTRAIL_REPORT_RESULTS=0/false/no skips the POST entirely
 *     (logs the would-be payload).
 *   - Skipped tests are NOT posted unless TESTRAIL_REPORT_SKIPPED=1.
 *   - Maps tests to TestRail cases by parsing a `C12345` token from
 *     the test title; tests without a C-id are dropped.
 *   - Retries 5xx with backoff: 2s, 5s, 10s. 401 breaks the loop and
 *     falls through to the next credential.
 *
 * Status mapping (TestRail defaults):
 *   1=Passed, 2=Blocked, 3=Untested, 4=Retest, 5=Failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Reporter,
  TestCase,
  TestResult,
  FullConfig,
  Suite,
} from '@playwright/test/reporter';

const STATUS: Record<string, number> = {
  passed: 1,
  failed: 5,
  timedOut: 5,
  interrupted: 5,
  skipped: 2,
};

interface TestRailResult {
  case_id: number;
  status_id: number;
  comment: string;
  elapsed: string;
}

interface TestRailConfig {
  testrail: {
    focusedRun: {
      url: string;
      runId: number;
    };
  };
}

/**
 * Build a per-test result row from a Playwright TestCase + TestResult.
 * Returns null if the test has no `Cnnn` token in its title or if it
 * was skipped without TESTRAIL_REPORT_SKIPPED=1.
 *
 * Exported for unit testing.
 */
export function buildResult(
  test: TestCase,
  result: TestResult,
  options: { reportSkipped: boolean }
): TestRailResult | null {
  const match = test.title.match(/\bC(\d+)\b/);
  if (!match) return null;
  if (result.status === 'skipped' && !options.reportSkipped) return null;

  const caseId = Number(match[1]);
  const statusId = STATUS[result.status] ?? 3;
  const elapsedSec = Math.max(1, Math.round(result.duration / 1000));

  const lines = [
    `Playwright: ${test.titlePath().join(' > ')}`,
    `Status: ${result.status}`,
    `Duration: ${result.duration} ms`,
  ];
  if (result.error) {
    lines.push('', 'Error:', result.error.message ?? String(result.error));
  }

  return {
    case_id: caseId,
    status_id: statusId,
    comment: lines.join('\n'),
    elapsed: `${elapsedSec}s`,
  };
}

/**
 * Resolve the TestRail run id and base URL.
 *
 * Phase 1.6: while the legacy POC is alive, prefer
 * `packages/legacy-poc/testrail.config.json`. After Phase 5 sunset,
 * this becomes a per-team config injection (TESTRAIL_RUN_ID +
 * TESTRAIL_URL env vars).
 *
 * Exported for unit testing.
 */
export function resolveRunConfig(workspaceRoot: string): {
  runId: number;
  baseUrl: string;
} {
  // Env vars take precedence (Phase 5+).
  if (process.env.TESTRAIL_RUN_ID && process.env.TESTRAIL_URL) {
    return {
      runId: Number(process.env.TESTRAIL_RUN_ID),
      baseUrl: new URL(process.env.TESTRAIL_URL).origin,
    };
  }

  // Fallback: legacy POC config.
  const legacyConfigPath = path.join(workspaceRoot, 'packages', 'legacy-poc', 'testrail.config.json');
  if (!fs.existsSync(legacyConfigPath)) {
    throw new Error(
      `framework testrail-reporter: cannot resolve TestRail run id. ` +
        `Set TESTRAIL_RUN_ID + TESTRAIL_URL, or place a testrail.config.json ` +
        `at ${legacyConfigPath}.`
    );
  }
  const cfg = JSON.parse(fs.readFileSync(legacyConfigPath, 'utf8')) as TestRailConfig;
  const runId = cfg.testrail.focusedRun.runId;
  const baseUrl = process.env.TESTRAIL_URL
    ? new URL(process.env.TESTRAIL_URL).origin
    : new URL(cfg.testrail.focusedRun.url).origin;
  return { runId, baseUrl };
}

interface CredentialAttempt {
  label: 'password' | 'api_key';
  secret: string;
}

/**
 * Build the credential attempt list. Password first (legacy POC
 * discovery: api-key-first caused account lockout from accumulated
 * 401s).
 *
 * Exported for unit testing. Uses a structural env type so the unit
 * tests do not need to reference the global `NodeJS.ProcessEnv`.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export function buildAttempts(env: EnvLike): CredentialAttempt[] {
  const attempts: CredentialAttempt[] = [];
  if (env.TESTRAIL_PASSWORD) attempts.push({ label: 'password', secret: env.TESTRAIL_PASSWORD });
  if (env.TESTRAIL_API_KEY) attempts.push({ label: 'api_key', secret: env.TESTRAIL_API_KEY });
  return attempts;
}

const REPORT_RESULTS_DISABLED = new Set(['0', 'false', 'no']);

/**
 * Decide whether to actually POST results based on TESTRAIL_REPORT_RESULTS.
 * Default: enabled. Exported for unit testing.
 */
export function shouldPostResults(env: EnvLike): boolean {
  const v = (env.TESTRAIL_REPORT_RESULTS ?? '').toLowerCase();
  return !REPORT_RESULTS_DISABLED.has(v);
}

class FrameworkTestRailReporter implements Reporter {
  private results: TestRailResult[] = [];
  private workspaceRoot = '';
  private packageDir = '';

  onBegin(config: FullConfig, _suite: Suite): void {
    this.workspaceRoot = findWorkspaceRoot(process.cwd());
    // Per-package result file location: <package-root>/test-results/testrail-results.json
    // Detect the package root by walking up from cwd to find the
    // nearest playwright.config.* file (the consumer of this reporter).
    this.packageDir = config.rootDir;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const reportSkipped = process.env.TESTRAIL_REPORT_SKIPPED === '1';
    const row = buildResult(test, result, { reportSkipped });
    if (row) this.results.push(row);
  }

  async onEnd(): Promise<void> {
    if (this.results.length === 0) {
      console.log('[framework testrail-reporter] no tests with C-ids matched, nothing to post.');
      return;
    }

    const { runId, baseUrl } = resolveRunConfig(this.workspaceRoot);

    // D-30 aggregator mode: write a per-package result file and skip
    // the POST. The aggregator job (testrail-aggregator.ts) handles
    // the actual TestRail POST.
    if (process.env.TESTRAIL_AGGREGATE === '1') {
      const outDir = path.join(this.packageDir, 'test-results');
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, 'testrail-results.json');
      const payload = { runId, baseUrl, results: this.results };
      fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
      console.log(
        `[framework testrail-reporter] TESTRAIL_AGGREGATE=1, wrote ${this.results.length} ` +
          `result(s) to ${path.relative(this.workspaceRoot, outFile)} (run ${runId}).`
      );
      return;
    }

    if (!shouldPostResults(process.env)) {
      console.log(
        `[framework testrail-reporter] TESTRAIL_REPORT_RESULTS=${process.env.TESTRAIL_REPORT_RESULTS}, ` +
          `skipping POST. Would post ${this.results.length} result(s) to run ${runId}:`
      );
      for (const r of this.results) {
        console.log(`  C${r.case_id}  status_id=${r.status_id}  ${r.elapsed}`);
      }
      return;
    }

    const user = process.env.TESTRAIL_USER;
    const attempts = buildAttempts(process.env);
    if (!user || attempts.length === 0) {
      console.log(
        `[framework testrail-reporter] TESTRAIL_USER + (TESTRAIL_API_KEY or TESTRAIL_PASSWORD) ` +
          `not set, skipping POST. Would post ${this.results.length} result(s) to run ${runId}:`
      );
      console.log(JSON.stringify({ results: this.results }, null, 2));
      return;
    }

    await this.postToTestRail({ user, attempts, baseUrl, runId });
  }

  private async postToTestRail(args: {
    user: string;
    attempts: CredentialAttempt[];
    baseUrl: string;
    runId: number;
  }): Promise<void> {
    const url = `${args.baseUrl}/index.php?/api/v2/add_results_for_cases/${args.runId}`;
    const body = JSON.stringify({ results: this.results });
    const backoffsMs = [2000, 5000, 10000];

    for (const attempt of args.attempts) {
      const auth = Buffer.from(`${args.user}:${attempt.secret}`).toString('base64');
      let lastErrText = '';
      let lastStatus = 0;

      for (let i = 0; i <= backoffsMs.length; i++) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${auth}`,
            },
            body,
          });
          if (res.ok) {
            const retrySuffix =
              i > 0 ? `, after ${i} retr${i === 1 ? 'y' : 'ies'}` : '';
            console.log(
              `[framework testrail-reporter] posted ${this.results.length} ` +
                `result(s) to run ${args.runId} (auth=${attempt.label}${retrySuffix}).`
            );
            return;
          }
          lastStatus = res.status;
          lastErrText = await res.text();
          if (res.status === 401) break; // try next credential
          if (res.status >= 500 && i < backoffsMs.length) {
            console.warn(
              `[framework testrail-reporter] ${res.status} ${res.statusText} ` +
                `(auth=${attempt.label}), retrying in ${backoffsMs[i] / 1000}s...`
            );
            await new Promise((r) => setTimeout(r, backoffsMs[i]));
            continue;
          }
          break;
        } catch (err) {
          lastErrText = err instanceof Error ? err.message : String(err);
          if (i < backoffsMs.length) {
            console.warn(
              `[framework testrail-reporter] network error (auth=${attempt.label}): ` +
                `${lastErrText} — retrying in ${backoffsMs[i] / 1000}s...`
            );
            await new Promise((r) => setTimeout(r, backoffsMs[i]));
            continue;
          }
          break;
        }
      }

      if (lastStatus === 401 && attempt !== args.attempts[args.attempts.length - 1]) {
        console.warn(
          `[framework testrail-reporter] 401 with ${attempt.label}, trying next credential...`
        );
        continue;
      }
      console.error(
        `[framework testrail-reporter] POST failed (auth=${attempt.label}): ` +
          `${lastStatus || 'network'}\n${lastErrText}\n` +
          `[framework testrail-reporter] hint: posting to ${url} — if this is the wrong host, check TESTRAIL_URL.`
      );
      return;
    }
  }
}

/**
 * Walk up from `start` looking for the workspace root marker
 * (`tsconfig.base.json`). Same algorithm as the framework's
 * dotenv-loader; module-system agnostic.
 */
function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 16; i++) {
    if (fs.existsSync(path.join(dir, 'tsconfig.base.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback to cwd; the caller will get a clear error from
  // resolveRunConfig if the legacy config is missing.
  return start;
}

export default FrameworkTestRailReporter;
