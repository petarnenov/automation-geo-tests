// @ts-check
/**
 * AIO Tests reporter for Playwright.
 *
 * Posts a run status to the configured AIO cycle once the whole suite has
 * finished. Only green executions are reported by default — set AIO_REPORT_ALL=1
 * to also push failures.
 *
 * - Reads project, cycle and status names from aio.config.json.
 * - Authenticates with AIO_TOKEN from .env.local.
 *   Token is generated in Jira under AIO Tests -> My Settings -> API Token.
 * - Posting is OPT-IN: without AIO_REPORT_RESULTS=1 the reporter logs the payload
 *   it would send and stops. A reporter that writes into a shared regression
 *   cycle should not start doing so just because someone pulled the branch.
 * - Tests are matched to AIO cases through the TestRail id in the title
 *   (`@regression C25207 ...`), resolved to an AIO key (GEO-TC-11933) via the mapping
 *   file produced by scripts/map-pepi-to-aio.js. Tests without a C-id, or whose
 *   C-id is not in the mapping, are skipped and listed in the summary.
 * - Results for cases that are not in the cycle are dropped before posting.
 *
 * Env:
 *   AIO_REPORT_RESULTS=1   actually POST (otherwise dry-run)
 *   AIO_CYCLE=GEO-CY-9     override the cycle from aio.config.json
 *   AIO_PROJECT=GEO        override the project key
 *   AIO_REPORT_ALL=1       also report failed / timedOut / interrupted
 *   RUN_AS=grish           who the run is for: assignee + name in the comment
 *                          (aio.config.json assignees). Required to report.
 *
 * A dry run writes the would-be payload to test-results/aio-pending.json
 * (AIO_PENDING_FILE overrides), so `make test` can post it once the operator
 * confirms (scripts/aio-post.js).
 */

const fs = require('fs');
const path = require('path');
const { PENDING_FILE, loadAioConfig, commentFor, postTestRuns } = require('../scripts/aio-post');

class AioReporter {
  constructor() {
    this.aio = loadAioConfig();
    this.cycleKey = this.aio.cycleKey;
    this.statusNames = this.aio.statusNames;
    this.mappingFile = this.aio.mappingFile;
    this.reportAll = process.env.AIO_REPORT_ALL === '1';
    /** @type {Array<{caseId:number,status:string,durationMs:number}>} */
    this.results = [];
  }

  onTestEnd(test, result) {
    const match = test.title.match(/\bC(\d+)\b/);
    if (!match) return;
    this.results.push({
      caseId: Number(match[1]),
      status: result.status,
      durationMs: result.duration,
    });
  }

  /** TestRail id -> AIO key, from the file scripts/map-pepi-to-aio.js writes. */
  _loadMapping() {
    if (!fs.existsSync(this.mappingFile)) {
      console.warn(
        `[aio-reporter] mapping file ${this.mappingFile} not found. ` +
          'Run: node scripts/map-pepi-to-aio.js'
      );
      return null;
    }
    const rows = JSON.parse(fs.readFileSync(this.mappingFile, 'utf8'));
    const map = new Map();
    for (const row of rows) {
      map.set(Number(String(row.testrail_case_id).replace(/^C/i, '')), row.aio_key);
    }
    return map;
  }

  _statusFor(playwrightStatus) {
    if (playwrightStatus === 'passed') return this.statusNames.passed;
    if (playwrightStatus === 'skipped') return this.statusNames.blocked;
    return this.statusNames.failed;
  }

  async onEnd() {
    if (this.results.length === 0) {
      console.log('[aio-reporter] no tests with C-ids matched, nothing to report.');
      return;
    }

    // Playwright fires onTestEnd once per attempt. Keep only the final attempt so
    // a flaky test that fails then passes does not post both outcomes.
    const byCase = new Map();
    for (const r of this.results) byCase.set(r.caseId, r);
    let finals = [...byCase.values()];

    const skipped = finals.filter((r) => r.status === 'skipped');
    finals = finals.filter((r) => r.status !== 'skipped');
    if (!this.reportAll) {
      const notGreen = finals.filter((r) => r.status !== 'passed');
      finals = finals.filter((r) => r.status === 'passed');
      if (notGreen.length) {
        console.log(
          `[aio-reporter] ${notGreen.length} non-green result(s) not reported ` +
            `(set AIO_REPORT_ALL=1 to include): ${notGreen.map((r) => 'C' + r.caseId).join(', ')}`
        );
      }
    }
    if (skipped.length) {
      console.log(`[aio-reporter] ${skipped.length} skipped test(s) ignored.`);
    }
    if (finals.length === 0) {
      console.log('[aio-reporter] nothing left to report.');
      return;
    }

    // Results go out in one person's name; without one there is nothing
    // honest to write in the comment, so report nothing.
    if (!this.aio.assignee.accountId) {
      const known = Object.keys(this.aio.assignees).join(', ');
      console.warn(
        `[aio-reporter] RUN_AS ${this.aio.assignee.key ? `"${this.aio.assignee.key}" is unknown` : 'is not set'}` +
          ` (one of: ${known}); nothing reported.`
      );
      return;
    }

    const mapping = this._loadMapping();
    if (!mapping) return;

    const unmapped = finals.filter((r) => !mapping.has(r.caseId));
    finals = finals.filter((r) => mapping.has(r.caseId));
    if (unmapped.length) {
      console.warn(
        `[aio-reporter] ${unmapped.length} case(s) absent from the mapping, dropped: ` +
          unmapped.map((r) => 'C' + r.caseId).join(', ')
      );
    }

    const testRuns = finals.map((r) => ({
      testCaseKey: mapping.get(r.caseId),
      testRunStatus: this._statusFor(r.status),
      comments: [commentFor(r.status, this.aio.assignee.name)],
      assigneeToID: this.aio.assignee.accountId,
      effort: Math.max(1, Math.round(r.durationMs / 1000)),
      // Kept manual on purpose: the team's cycles present these as tester-run
      // verifications, and flipping the flag would contradict the comment above.
      isAutomated: false,
    }));

    if (process.env.AIO_REPORT_RESULTS !== '1') {
      const pendingFile = process.env.AIO_PENDING_FILE || PENDING_FILE;
      fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
      fs.writeFileSync(
        pendingFile,
        JSON.stringify(
          { projectKey: this.aio.projectKey, cycleKey: this.cycleKey, testRuns },
          null,
          2
        )
      );
      console.log(
        `[aio-reporter] AIO_REPORT_RESULTS is not 1, skipping POST. ` +
          `Would post ${testRuns.length} result(s) to ${this.cycleKey} (saved to ${pendingFile}):`
      );
      for (const run of testRuns) {
        console.log(`  ${run.testCaseKey}  ${run.testRunStatus}  ${run.effort}s`);
      }
      return;
    }

    await postTestRuns(testRuns, this.aio);
  }
}

module.exports = AioReporter;
