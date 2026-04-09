/**
 * `@geowealth/e2e-framework/reporters` — Playwright reporters.
 *
 * Phase 1.6: framework TestRail reporter ported from the legacy POC's
 * `packages/legacy-poc/reporters/testrail-reporter.js`. Per D-15, this
 * reporter does NOT point at TestRail Run 175 while the legacy JS
 * reporter is also pointed at it; the cutover is atomic at Phase 5
 * sunset.
 */

export {
  default as FrameworkTestRailReporter,
  buildResult,
  resolveRunConfig,
  buildAttempts,
  shouldPostResults,
} from './testrail-reporter';

export {
  default as RunSummaryReporter,
  extractTags,
  extractCaseId,
  resolveEnvironment,
  resolvePackageName,
  classifyOutcome,
  type RunSummary,
} from './run-summary-reporter';
