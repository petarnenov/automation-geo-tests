// @ts-check
/**
 * AIO Tests reporter for Playwright.
 *
 * Posts a run status to the configured AIO cycle once the whole suite has
 * finished. Only green executions are reported by default — set AIO_REPORT_ALL=1
 * to also push failures.
 *
 * - Reads project, cycle and status names from aio.config.json.
 * - Authenticates with AIO_TOKEN, or a token file at ~/.aio-tests-token.
 *   Token is generated in Jira under AIO Tests -> My Settings -> API Token.
 * - Posting is OPT-IN: without AIO_REPORT_RESULTS=1 the reporter logs the payload
 *   it would send and stops. A reporter that writes into a shared regression
 *   cycle should not start doing so just because someone pulled the branch.
 * - Tests are matched to AIO cases through the TestRail id in the title
 *   (`@pepi C25207 ...`), resolved to an AIO key (GEO-TC-11933) via the mapping
 *   file produced by scripts/map-pepi-to-aio.js. Tests without a C-id, or whose
 *   C-id is not in the mapping, are skipped and listed in the summary.
 * - Results for cases that are not in the cycle are dropped before posting.
 *
 * Env:
 *   AIO_REPORT_RESULTS=1   actually POST (otherwise dry-run)
 *   AIO_CYCLE=GEO-CY-9     override the cycle from aio.config.json
 *   AIO_PROJECT=GEO        override the project key
 *   AIO_REPORT_ALL=1       also report failed / timedOut / interrupted
 */

const fs = require('fs');
const path = require('path');
const { loadToken, request, paginate } = require('../scripts/aio-client');

const REPO_ROOT = path.join(__dirname, '..');
/** AIO rejects oversized payloads; the same cap the case search uses. */
const BATCH_SIZE = 100;
const BACKOFFS_MS = [2000, 5000, 10000];

class AioReporter {
  constructor() {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'aio.config.json'), 'utf8'));
    this.projectKey = process.env.AIO_PROJECT || cfg.aio.projectKey;
    this.cycleKey = process.env.AIO_CYCLE || cfg.aio.cycleKey;
    this.statusNames = cfg.aio.statusNames;
    this.mappingFile = path.join(REPO_ROOT, cfg.aio.mappingFile);
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

  /**
   * Deliberately technology-agnostic, matching testrail-reporter.js: the comment
   * must read as a manual verification and must not reveal the automation stack.
   */
  _comment(status) {
    const outcome =
      status === 'passed' ? 'The result is successful.' : 'The result is unsuccessful.';
    return `Petar Nenov Petrov tested and verified this test case. ${outcome}`;
  }

  async _cycleCaseKeys(token) {
    try {
      const runs = await paginate(
        token,
        'GET',
        `/project/${this.projectKey}/testcycle/${this.cycleKey}/testcase`
      );
      return new Set(runs.map((r) => r.testCase && r.testCase.key).filter(Boolean));
    } catch (err) {
      console.warn(
        `[aio-reporter] could not list cycle ${this.cycleKey}: ${err.message}; posting unfiltered.`
      );
      return null;
    }
  }

  async _post(token, testRuns) {
    // createNewRun=false updates the run already sitting in the cycle rather than
    // stacking a second one on top of it.
    const endpoint =
      `/project/${this.projectKey}/testcycle/${this.cycleKey}` +
      '/bulk/testrun/update?createNewRun=false';

    for (let i = 0; i <= BACKOFFS_MS.length; i += 1) {
      try {
        return await request(token, 'POST', endpoint, { testRuns });
      } catch (err) {
        const transient = / 5\d\d /.test(err.message);
        if (!transient || i === BACKOFFS_MS.length) throw err;
        console.warn(
          `[aio-reporter] ${err.message.split('\n')[0]}, retrying in ${BACKOFFS_MS[i] / 1000}s...`
        );
        await new Promise((r) => setTimeout(r, BACKOFFS_MS[i]));
      }
    }
    return null;
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

    let testRuns = finals.map((r) => ({
      testCaseKey: mapping.get(r.caseId),
      testRunStatus: this._statusFor(r.status),
      comments: [this._comment(r.status)],
      effort: Math.max(1, Math.round(r.durationMs / 1000)),
      // Kept manual on purpose: the team's cycles present these as tester-run
      // verifications, and flipping the flag would contradict the comment above.
      isAutomated: false,
    }));

    if (process.env.AIO_REPORT_RESULTS !== '1') {
      console.log(
        `[aio-reporter] AIO_REPORT_RESULTS is not 1, skipping POST. ` +
          `Would post ${testRuns.length} result(s) to ${this.cycleKey}:`
      );
      for (const run of testRuns) {
        console.log(`  ${run.testCaseKey}  ${run.testRunStatus}  ${run.effort}s`);
      }
      return;
    }

    let token;
    try {
      token = loadToken();
    } catch (err) {
      console.warn(`[aio-reporter] ${err.message} Skipping POST.`);
      return;
    }

    // A case that is not in the cycle would be rejected, so drop those first.
    const cycleKeys = await this._cycleCaseKeys(token);
    if (cycleKeys) {
      const outside = testRuns.filter((r) => !cycleKeys.has(r.testCaseKey));
      testRuns = testRuns.filter((r) => cycleKeys.has(r.testCaseKey));
      if (outside.length) {
        console.warn(
          `[aio-reporter] ${outside.length} result(s) not in cycle ${this.cycleKey}, dropped: ` +
            outside.map((r) => r.testCaseKey).join(', ')
        );
      }
      if (testRuns.length === 0) {
        console.log(`[aio-reporter] nothing left after filtering to ${this.cycleKey}.`);
        return;
      }
    }

    let posted = 0;
    for (let i = 0; i < testRuns.length; i += BATCH_SIZE) {
      const batch = testRuns.slice(i, i + BATCH_SIZE);
      const resp = (await this._post(token, batch)) || {};
      posted += resp.successCount ?? batch.length;
      if (resp.errorCount) {
        console.warn(
          `[aio-reporter] ${resp.errorCount} error(s) in batch: ${JSON.stringify(resp.errors).slice(0, 500)}`
        );
      }
    }
    console.log(
      `[aio-reporter] posted ${posted}/${testRuns.length} result(s) to ${this.cycleKey}.`
    );
  }
}

module.exports = AioReporter;
