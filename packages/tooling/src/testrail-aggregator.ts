/**
 * `testrail-aggregator` — D-30 post-processing job.
 *
 * Phase 1.7. Per-package nightly runs each emit their own TestRail
 * payload via the framework's TS reporter in TESTRAIL_AGGREGATE=1 mode
 * (writes to `<package-root>/test-results/testrail-results.json`).
 *
 * To avoid race conditions on TestRail's `add_results_for_cases`
 * endpoint when N team packages report concurrently, this aggregator
 * runs *once* at the end of the nightly and POSTs every per-package
 * result file in **one** call.
 *
 * Phase 5 sunset removes the legacy JS reporter; the aggregator stays
 * (it is the only writer to TestRail Run 175 from then on).
 *
 * Per Decision D-15: while the legacy POC is alive, this aggregator
 * NEVER points at TestRail Run 175. The legacy JS reporter owns Run 175
 * until Phase 5; the aggregator points at the per-package result files'
 * own `runId` field, which during Phase 1–4 must be a *sandbox* run.
 * The atomic Run 175 cutover happens in a single Phase 5 PR.
 *
 * Usage (called from the nightly workflow as a final job):
 *
 *     npm run testrail:aggregate
 *     # or with explicit roots:
 *     tsx packages/tooling/src/testrail-aggregator.ts \
 *       --root packages/tests-billing-servicing \
 *       --root packages/tests-platform
 *
 * Default behavior with no `--root` flags: walk every `packages/tests-*`
 * and `packages/framework` directory under the workspace root. The
 * legacy POC is intentionally excluded — its JS reporter posts directly
 * to Run 175 and never writes a per-package file.
 *
 * Auth precedence matches the framework reporter (password first, then
 * api_key — the legacy POC's discovery that api-key-first triggered
 * account lockout from accumulated 401s).
 *
 * Exit codes:
 *   0  POST succeeded (or no result files were found and that is OK)
 *   1  POST failed for at least one run id
 *   2  Configuration error (missing TESTRAIL_USER, etc.)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

interface PerPackageResultFile {
  runId: number;
  baseUrl: string;
  results: Array<{
    case_id: number;
    status_id: number;
    comment: string;
    elapsed: string;
  }>;
}

interface CredentialAttempt {
  label: 'password' | 'api_key';
  secret: string;
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Find the workspace root by walking up looking for `tsconfig.base.json`.
 * Same algorithm as the framework's dotenv-loader and TestRail reporter
 * — module-system agnostic.
 *
 * Exported for unit testing.
 */
export function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 16; i++) {
    if (fs.existsSync(path.join(dir, 'tsconfig.base.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `testrail-aggregator: cannot find workspace root (looked for tsconfig.base.json) starting at ${start}`
  );
}

/**
 * Discover the default set of package roots to scan: every
 * `packages/tests-*` and `packages/framework` directory. The legacy POC
 * is excluded by design (its JS reporter writes directly to Run 175).
 *
 * Exported for unit testing.
 */
export function discoverPackageRoots(workspaceRoot: string): string[] {
  const packagesDir = path.join(workspaceRoot, 'packages');
  if (!fs.existsSync(packagesDir)) return [];
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  const roots: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'legacy-poc') continue;
    if (entry.name === 'tooling') continue;
    if (entry.name !== 'framework' && !entry.name.startsWith('tests-')) continue;
    roots.push(path.join(packagesDir, entry.name));
  }
  // Stable ordering for predictable logs and tests.
  return roots.sort();
}

/**
 * Read every `<root>/test-results/testrail-results.json` from the given
 * roots. Missing files are silently skipped (a package may have nothing
 * to report on a given nightly). Malformed files throw with the path so
 * the operator can fix them.
 *
 * Exported for unit testing.
 */
export function readPerPackageFiles(
  roots: readonly string[]
): Array<{ packageDir: string; payload: PerPackageResultFile }> {
  const out: Array<{ packageDir: string; payload: PerPackageResultFile }> = [];
  for (const root of roots) {
    const file = path.join(root, 'test-results', 'testrail-results.json');
    if (!fs.existsSync(file)) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      throw new Error(`testrail-aggregator: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    let parsed: PerPackageResultFile;
    try {
      parsed = JSON.parse(raw) as PerPackageResultFile;
    } catch (err) {
      throw new Error(`testrail-aggregator: ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.runId !== 'number' ||
      typeof parsed.baseUrl !== 'string' ||
      !Array.isArray(parsed.results)
    ) {
      throw new Error(
        `testrail-aggregator: ${file} does not match the per-package result schema ` +
          `({ runId: number, baseUrl: string, results: [...] }).`
      );
    }
    out.push({ packageDir: root, payload: parsed });
  }
  return out;
}

/**
 * Group per-package payloads by `(baseUrl, runId)` and merge their
 * `results` arrays. The aggregator emits one POST per group; in the
 * common case (every package targets the same sandbox run) there is
 * exactly one group, hence one POST.
 *
 * Exported for unit testing.
 */
export function groupByRun(
  files: ReadonlyArray<{ packageDir: string; payload: PerPackageResultFile }>
): Array<{ baseUrl: string; runId: number; results: PerPackageResultFile['results']; sources: string[] }> {
  const groups = new Map<
    string,
    { baseUrl: string; runId: number; results: PerPackageResultFile['results']; sources: string[] }
  >();
  for (const { packageDir, payload } of files) {
    const key = `${payload.baseUrl}#${payload.runId}`;
    let group = groups.get(key);
    if (!group) {
      group = { baseUrl: payload.baseUrl, runId: payload.runId, results: [], sources: [] };
      groups.set(key, group);
    }
    group.results.push(...payload.results);
    group.sources.push(packageDir);
  }
  return [...groups.values()];
}

/**
 * Build the credential attempt list. Password first (legacy POC
 * discovery: api-key-first caused account lockout from accumulated
 * 401s).
 *
 * Exported for unit testing.
 */
export function buildAttempts(env: EnvLike): CredentialAttempt[] {
  const attempts: CredentialAttempt[] = [];
  if (env.TESTRAIL_PASSWORD) attempts.push({ label: 'password', secret: env.TESTRAIL_PASSWORD });
  if (env.TESTRAIL_API_KEY) attempts.push({ label: 'api_key', secret: env.TESTRAIL_API_KEY });
  return attempts;
}

const REPORT_RESULTS_DISABLED = new Set(['0', 'false', 'no']);

/**
 * Decide whether to actually POST results. Default: enabled.
 * Exported for unit testing.
 */
export function shouldPostResults(env: EnvLike): boolean {
  const v = (env.TESTRAIL_REPORT_RESULTS ?? '').toLowerCase();
  return !REPORT_RESULTS_DISABLED.has(v);
}

/**
 * Parse `--root <dir>` flags from argv. Multiple `--root` flags are
 * allowed and accumulate. No flags → use the default discovery.
 *
 * Exported for unit testing.
 */
export function parseArgs(argv: readonly string[]): { roots: string[] } {
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const next = argv[i + 1];
      if (!next) throw new Error('testrail-aggregator: --root requires a directory argument');
      roots.push(next);
      i++;
    }
  }
  return { roots };
}

async function postOneRun(args: {
  baseUrl: string;
  runId: number;
  results: PerPackageResultFile['results'];
  user: string;
  attempts: readonly CredentialAttempt[];
}): Promise<boolean> {
  const url = `${args.baseUrl}/index.php?/api/v2/add_results_for_cases/${args.runId}`;
  const body = JSON.stringify({ results: args.results });
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
          const retrySuffix = i > 0 ? `, after ${i} retr${i === 1 ? 'y' : 'ies'}` : '';
          console.log(
            `[testrail-aggregator] posted ${args.results.length} result(s) to run ${args.runId} ` +
              `(auth=${attempt.label}${retrySuffix}).`
          );
          return true;
        }
        lastStatus = res.status;
        lastErrText = await res.text();
        if (res.status === 401) break; // try next credential
        if (res.status >= 500 && i < backoffsMs.length) {
          console.warn(
            `[testrail-aggregator] ${res.status} ${res.statusText} (auth=${attempt.label}), ` +
              `retrying in ${backoffsMs[i] / 1000}s...`
          );
          await new Promise((r) => setTimeout(r, backoffsMs[i]));
          continue;
        }
        break;
      } catch (err) {
        lastErrText = err instanceof Error ? err.message : String(err);
        if (i < backoffsMs.length) {
          console.warn(
            `[testrail-aggregator] network error (auth=${attempt.label}): ${lastErrText} ` +
              `— retrying in ${backoffsMs[i] / 1000}s...`
          );
          await new Promise((r) => setTimeout(r, backoffsMs[i]));
          continue;
        }
        break;
      }
    }

    if (lastStatus === 401 && attempt !== args.attempts[args.attempts.length - 1]) {
      console.warn(
        `[testrail-aggregator] 401 with ${attempt.label}, trying next credential...`
      );
      continue;
    }
    console.error(
      `[testrail-aggregator] POST failed for run ${args.runId} (auth=${attempt.label}): ` +
        `${lastStatus || 'network'}\n${lastErrText}\n` +
        `[testrail-aggregator] hint: posting to ${url} — if this is the wrong host, check the per-package result file's baseUrl.`
    );
    return false;
  }
  return false;
}

/**
 * CLI entrypoint. Exported so unit tests can drive the orchestration
 * without spawning a subprocess.
 */
export async function main(argv: readonly string[], env: EnvLike, cwd: string): Promise<number> {
  const { roots: explicitRoots } = parseArgs(argv);
  const workspaceRoot = findWorkspaceRoot(cwd);
  const roots =
    explicitRoots.length > 0
      ? explicitRoots.map((r) => (path.isAbsolute(r) ? r : path.resolve(cwd, r)))
      : discoverPackageRoots(workspaceRoot);

  const files = readPerPackageFiles(roots);
  if (files.length === 0) {
    console.log(
      `[testrail-aggregator] no per-package result files found under ${roots.length} root(s); ` +
        `nothing to aggregate. (This is normal if no team package ran with TESTRAIL_AGGREGATE=1.)`
    );
    return 0;
  }

  const groups = groupByRun(files);
  console.log(
    `[testrail-aggregator] found ${files.length} per-package file(s) → ${groups.length} run group(s):`
  );
  for (const g of groups) {
    console.log(
      `  run ${g.runId} @ ${g.baseUrl}  (${g.results.length} result(s) from ${g.sources.length} package(s))`
    );
  }

  if (!shouldPostResults(env)) {
    console.log(
      `[testrail-aggregator] TESTRAIL_REPORT_RESULTS=${env.TESTRAIL_REPORT_RESULTS}, skipping POST. ` +
        `Would have posted the groups above.`
    );
    return 0;
  }

  const user = env.TESTRAIL_USER;
  const attempts = buildAttempts(env);
  if (!user || attempts.length === 0) {
    console.error(
      `[testrail-aggregator] TESTRAIL_USER + (TESTRAIL_API_KEY or TESTRAIL_PASSWORD) not set; ` +
        `refusing to silently drop ${files.length} result file(s). Set TESTRAIL_REPORT_RESULTS=0 to skip explicitly.`
    );
    return 2;
  }

  let allOk = true;
  for (const g of groups) {
    const ok = await postOneRun({
      baseUrl: g.baseUrl,
      runId: g.runId,
      results: g.results,
      user,
      attempts,
    });
    if (!ok) allOk = false;
  }
  return allOk ? 0 : 1;
}

// Direct CLI invocation guard — same convention as the sibling tooling
// scripts (check-versions.ts, changed-packages.ts, preflight.ts).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2), process.env, process.cwd())
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[testrail-aggregator] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      process.exit(1);
    });
}
