// @ts-check
/**
 * Minimal TestRail reporter for Playwright.
 *
 * - Reads run id, label filter, and TestRail base URL from testrail.config.json.
 * - Authenticates via env vars TESTRAIL_USER + (TESTRAIL_API_KEY or TESTRAIL_PASSWORD).
 *   Tries API key first; on 401, retries with password. If neither is set, the reporter
 *   logs the would-be payload and skips the POST, so local runs work without credentials.
 * - Optional TESTRAIL_URL env overrides the host derived from testrail.config.json.
 * - Set TESTRAIL_REPORT_RESULTS=0 (or false/no) to skip the POST entirely. Useful when
 *   iterating locally on tests that should not yet update the run in TestRail.
 * - Skipped tests (test.skip / test.fixme) are NOT posted: those are intentional
 *   "not implemented yet" markers, not real blockers, and posting them as
 *   Blocked would clutter the TestRail run with stale statuses. Set
 *   TESTRAIL_REPORT_SKIPPED=1 to override and post skipped tests as Blocked.
 * - Maps tests to TestRail cases by parsing a `C12345` token from the test title.
 *   Tests without a C-id are not reported.
 *
 * Status mapping (TestRail defaults): 1=Passed, 2=Blocked, 3=Untested, 4=Retest, 5=Failed.
 */

const fs = require('fs');
const path = require('path');

const STATUS = {
  passed: 1,
  failed: 5,
  timedOut: 5,
  interrupted: 5,
  skipped: 2,
};

class TestRailReporter {
  constructor() {
    const cfgPath = path.join(__dirname, '..', 'testrail.config.json');
    this.cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    this.runId = this.cfg.testrail.focusedRun.runId;
    this.baseUrl = process.env.TESTRAIL_URL
      ? new URL(process.env.TESTRAIL_URL).origin
      : new URL(this.cfg.testrail.focusedRun.url).origin;
    this.user = process.env.TESTRAIL_USER;
    this.apiKey = process.env.TESTRAIL_API_KEY;
    this.password = process.env.TESTRAIL_PASSWORD;
    /** @type {Array<{case_id:number,status_id:number,comment:string,elapsed?:string}>} */
    this.results = [];
  }

  onTestEnd(test, result) {
    const match = test.title.match(/\bC(\d+)\b/);
    if (!match) return;
    // Skipped/fixme tests are intentional placeholders for unfinished work,
    // not real blockers — drop them unless TESTRAIL_REPORT_SKIPPED is set.
    if (result.status === 'skipped' && process.env.TESTRAIL_REPORT_SKIPPED !== '1') {
      return;
    }
    const caseId = Number(match[1]);
    const statusId = STATUS[result.status] ?? 3;
    const elapsedSec = Math.max(1, Math.round(result.duration / 1000));
    this.results.push({
      case_id: caseId,
      status_id: statusId,
      comment: this._buildComment(test, result),
      elapsed: `${elapsedSec}s`,
    });
  }

  _buildComment(test, result) {
    const lines = [
      `Playwright: ${test.titlePath().join(' > ')}`,
      `Status: ${result.status}`,
      `Duration: ${result.duration} ms`,
    ];
    if (result.error) {
      lines.push('', 'Error:', result.error.message || String(result.error));
    }
    return lines.join('\n');
  }

  async onEnd() {
    if (this.results.length === 0) {
      console.log('[testrail-reporter] no @pepi tests with C-ids matched, nothing to post.');
      return;
    }
    const reportEnv = (process.env.TESTRAIL_REPORT_RESULTS || '').toLowerCase();
    if (reportEnv === '0' || reportEnv === 'false' || reportEnv === 'no') {
      console.log(
        `[testrail-reporter] TESTRAIL_REPORT_RESULTS=${process.env.TESTRAIL_REPORT_RESULTS}, skipping POST. ` +
          `Would post ${this.results.length} result(s) to run ${this.runId}:`
      );
      for (const r of this.results) {
        console.log(`  C${r.case_id}  status_id=${r.status_id}  ${r.elapsed}`);
      }
      return;
    }
    if (!this.user || (!this.apiKey && !this.password)) {
      console.log(
        `[testrail-reporter] TESTRAIL_USER + (TESTRAIL_API_KEY or TESTRAIL_PASSWORD) not set, skipping POST. ` +
          `Would post ${this.results.length} result(s) to run ${this.runId}:`
      );
      console.log(JSON.stringify({ results: this.results }, null, 2));
      return;
    }
    const url = `${this.baseUrl}/index.php?/api/v2/add_results_for_cases/${this.runId}`;
    const body = JSON.stringify({ results: this.results });

    // Prefer password (proven to work against production), fall back to api_key.
    // Trying api_key first caused TestRail to lock the user account out after
    // accumulating 401s, so we now only fall back if password is not set.
    const attempts = [];
    if (this.password) attempts.push({ label: 'password', secret: this.password });
    if (this.apiKey) attempts.push({ label: 'api_key', secret: this.apiKey });

    // Heads-up for the human: if the response body is "License has expired",
    // odds are TESTRAIL_URL is pointing at a different host than the one with
    // the live license. The qa-testrail.geowealth.com instance has been
    // returning a license-expired 503 since 2025-08-28; production
    // testrail.geowealth.com is fine. Check `env | grep TESTRAIL_URL`.
    for (const attempt of attempts) {
      const auth = Buffer.from(`${this.user}:${attempt.secret}`).toString('base64');
      // Retry transient 5xx with backoff: 2s, 5s, 10s. 401s break the loop
      // immediately so we can fall back to the next credential.
      const backoffsMs = [2000, 5000, 10000];
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
            console.log(
              `[testrail-reporter] posted ${this.results.length} result(s) to run ${this.runId} (auth=${attempt.label}${i > 0 ? `, after ${i} retr${i === 1 ? 'y' : 'ies'}` : ''}).`
            );
            return;
          }
          lastStatus = res.status;
          lastErrText = await res.text();
          if (res.status === 401) break; // try next credential
          if (res.status >= 500 && i < backoffsMs.length) {
            console.warn(
              `[testrail-reporter] ${res.status} ${res.statusText} (auth=${attempt.label}), retrying in ${backoffsMs[i] / 1000}s...`
            );
            await new Promise((r) => setTimeout(r, backoffsMs[i]));
            continue;
          }
          break;
        } catch (err) {
          lastErrText = err && err.message ? err.message : String(err);
          if (i < backoffsMs.length) {
            console.warn(
              `[testrail-reporter] network error (auth=${attempt.label}): ${lastErrText} — retrying in ${backoffsMs[i] / 1000}s...`
            );
            await new Promise((r) => setTimeout(r, backoffsMs[i]));
            continue;
          }
          break;
        }
      }
      if (lastStatus === 401 && attempt !== attempts[attempts.length - 1]) {
        console.warn(`[testrail-reporter] 401 with ${attempt.label}, trying next credential...`);
        continue;
      }
      console.error(
        `[testrail-reporter] POST failed (auth=${attempt.label}): ${lastStatus || 'network'}\n${lastErrText}\n` +
          `[testrail-reporter] hint: posting to ${url} — if this is the wrong host, check TESTRAIL_URL.`
      );
      return;
    }
  }
}

module.exports = TestRailReporter;
