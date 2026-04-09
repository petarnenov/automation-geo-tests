/**
 * Framework `run-summary` reporter — D-40, Section 6.11.
 *
 * Phase 1.8. Every per-package CI invocation emits a single
 * `run-summary.json` artifact under `<package-root>/test-results/`.
 * The aggregator (`testrail-aggregator.ts`) and the time-series push
 * both consume this contract; producer and consumer are pinned to
 * `schemaVersion: '1'`. A breaking schema change bumps the version
 * field and is treated as a framework breaking change (Section 6.11
 * "Framework breaking-change discipline").
 *
 * The schema mirrors Section 6.11 verbatim:
 *
 *   interface RunSummary {
 *     schemaVersion: '1';
 *     package:       string;            // e.g. "@geowealth/tests-billing-servicing"
 *     environment:   'qa1' | ... | 'qa10' | 'qatrd';
 *     commitSha:     string;
 *     startedAt:     string;            // ISO-8601 UTC
 *     durationMs:    number;
 *     totals:        { passed; failed; skipped; flaky };
 *     byTag:         Record<tag, { passed; failed; durationMs }>;
 *     preflightSkipped: boolean;        // true iff SKIP_PREFLIGHT=1 was used
 *     testRailCaseIds: number[];        // for the per-nightly aggregator (D-30)
 *   }
 *
 * Inputs read from the environment (CI sets these; locally they default
 * to safe values):
 *
 *   GW_PACKAGE_NAME    package name to embed in the summary. Defaults to
 *                      the consuming package's name from its package.json.
 *   TEST_ENV           qa1..qa10 | qatrd. Defaults to qa2.
 *   GITHUB_SHA         commit SHA. Defaults to "local".
 *   SKIP_PREFLIGHT     "1" iff the operator forced the run past
 *                      preflight (Section 5.9 manual override).
 *
 * Tag extraction: Playwright test titles in this codebase use the
 * convention `@<area> C<id> <human description>` (Section 4.9). Every
 * `@<word>` token in the title is treated as a tag and contributes to
 * the byTag totals. A test with `@billing @smoke C25193 ...` counts
 * once under `@billing` and once under `@smoke`.
 *
 * TestRail case IDs are extracted by the same `\bC(\d+)\b` regex the
 * TestRail reporter uses, so the two reporters agree on what counts as
 * a TestRail-mapped test.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Reporter,
  TestCase,
  TestResult,
  FullConfig,
  Suite,
  FullResult,
} from '@playwright/test/reporter';

/**
 * Section 6.11 D-40 schema. The producer (this reporter) and the
 * consumers (testrail-aggregator + time-series push) are pinned to
 * `schemaVersion: '1'`. Bumping it is a framework breaking change.
 */
export interface RunSummary {
  schemaVersion: '1';
  package: string;
  environment:
    | 'qa1'
    | 'qa2'
    | 'qa3'
    | 'qa4'
    | 'qa5'
    | 'qa6'
    | 'qa7'
    | 'qa8'
    | 'qa9'
    | 'qa10'
    | 'qatrd';
  commitSha: string;
  startedAt: string;
  durationMs: number;
  totals: { passed: number; failed: number; skipped: number; flaky: number };
  byTag: Record<string, { passed: number; failed: number; durationMs: number }>;
  preflightSkipped: boolean;
  testRailCaseIds: number[];
}

const VALID_ENVS = new Set([
  'qa1',
  'qa2',
  'qa3',
  'qa4',
  'qa5',
  'qa6',
  'qa7',
  'qa8',
  'qa9',
  'qa10',
  'qatrd',
]);

export type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Extract every `@<word>` tag from a Playwright test title.
 * Exported for unit testing.
 */
export function extractTags(title: string): string[] {
  const out: string[] = [];
  const re = /@([a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    out.push(`@${m[1]}`);
  }
  return out;
}

/**
 * Extract a TestRail C-id from a Playwright test title (`Cnnn` token).
 * Returns null if no C-id is present. Exported for unit testing.
 */
export function extractCaseId(title: string): number | null {
  const m = title.match(/\bC(\d+)\b/);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * Resolve the environment string from `TEST_ENV`. Defaults to qa2 to
 * match the framework's environment selector (Phase 0 default).
 * Exported for unit testing.
 */
export function resolveEnvironment(env: EnvLike): RunSummary['environment'] {
  const raw = (env.TEST_ENV ?? 'qa2').toLowerCase();
  if (!VALID_ENVS.has(raw)) {
    // Unknown environment string. Fall back to qa2 rather than crashing
    // — the run is more valuable than a perfect summary.
    return 'qa2';
  }
  return raw as RunSummary['environment'];
}

/**
 * Resolve the consuming package's name. Walks up from the
 * Playwright test root looking for a package.json with a `name` field.
 * Falls back to `GW_PACKAGE_NAME` env var, then to the literal string
 * `'unknown'`. Exported for unit testing.
 */
export function resolvePackageName(rootDir: string, env: EnvLike): string {
  if (env.GW_PACKAGE_NAME) return env.GW_PACKAGE_NAME;
  const pkgRoot = findPackageRoot(rootDir);
  if (pkgRoot) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (pkg.name) return pkg.name;
    } catch {
      // Malformed package.json — fall through to 'unknown'.
    }
  }
  return 'unknown';
}

/**
 * Walk up from `start` looking for the nearest directory that contains
 * a package.json. Returns the directory path, or null if none found.
 *
 * Per D-30 / D-40 / Section 6.11, both the testrail-reporter and the
 * run-summary-reporter must write to `<package-root>/test-results/` so
 * the aggregator finds them. Playwright's `FullConfig.rootDir` is the
 * `testDir` (e.g. `./tests`), not the package root, so reporters must
 * walk up to locate the package root themselves.
 *
 * Exported for unit testing.
 */
export function findPackageRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 16; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Map a Playwright test outcome to one of the four totals buckets
 * defined by D-40. `flaky` is the Playwright outcome for tests that
 * eventually passed after a retry. Exported for unit testing.
 */
export function classifyOutcome(
  test: TestCase
): 'passed' | 'failed' | 'skipped' | 'flaky' {
  const outcome = test.outcome();
  if (outcome === 'expected') return 'passed';
  if (outcome === 'flaky') return 'flaky';
  if (outcome === 'skipped') return 'skipped';
  return 'failed'; // 'unexpected'
}

class RunSummaryReporter implements Reporter {
  private startedAt = new Date();
  private rootDir = '';
  private completedTests: Array<{
    test: TestCase;
    finalResult: TestResult;
  }> = [];

  onBegin(config: FullConfig, _suite: Suite): void {
    this.startedAt = new Date();
    this.rootDir = config.rootDir;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // We only care about the *final* attempt for totals/byTag/duration.
    // Playwright calls onTestEnd once per attempt; the last call wins.
    // Replace any prior entry for the same test object.
    const existing = this.completedTests.findIndex((c) => c.test === test);
    if (existing >= 0) {
      this.completedTests[existing] = { test, finalResult: result };
    } else {
      this.completedTests.push({ test, finalResult: result });
    }
  }

  async onEnd(_result: FullResult): Promise<void> {
    const summary = this.buildSummary();
    // Per Section 6.11 / D-40, the artifact lives at
    // <package-root>/test-results/run-summary.json — NOT under the
    // testDir. config.rootDir is the testDir; walk up to find the
    // package root (the directory with package.json).
    const packageRoot = findPackageRoot(this.rootDir) ?? this.rootDir;
    const outDir = path.join(packageRoot, 'test-results');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'run-summary.json');
    fs.writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8');
    console.log(
      `[run-summary] wrote schema v${summary.schemaVersion} ` +
        `(${summary.totals.passed} passed, ${summary.totals.failed} failed, ` +
        `${summary.totals.skipped} skipped, ${summary.totals.flaky} flaky) → ${outFile}`
    );
  }

  private buildSummary(): RunSummary {
    const totals = { passed: 0, failed: 0, skipped: 0, flaky: 0 };
    const byTag: RunSummary['byTag'] = {};
    const caseIds = new Set<number>();

    for (const { test, finalResult } of this.completedTests) {
      const bucket = classifyOutcome(test);
      totals[bucket]++;

      const tags = extractTags(test.title);
      for (const tag of tags) {
        if (!byTag[tag]) byTag[tag] = { passed: 0, failed: 0, durationMs: 0 };
        if (bucket === 'passed' || bucket === 'flaky') byTag[tag].passed++;
        else if (bucket === 'failed') byTag[tag].failed++;
        // skipped: counted neither as pass nor fail in byTag (matches
        // D-40's deliberate omission of a per-tag skipped column).
        byTag[tag].durationMs += finalResult.duration;
      }

      const caseId = extractCaseId(test.title);
      if (caseId !== null) caseIds.add(caseId);
    }

    const endedAt = Date.now();
    return {
      schemaVersion: '1',
      package: resolvePackageName(this.rootDir, process.env),
      environment: resolveEnvironment(process.env),
      commitSha: process.env.GITHUB_SHA ?? 'local',
      startedAt: this.startedAt.toISOString(),
      durationMs: endedAt - this.startedAt.getTime(),
      totals,
      byTag,
      preflightSkipped: process.env.SKIP_PREFLIGHT === '1',
      testRailCaseIds: [...caseIds].sort((a, b) => a - b),
    };
  }
}

export default RunSummaryReporter;
