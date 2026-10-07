#!/usr/bin/env node
// @ts-check
/**
 * Post test-run results to an AIO Tests cycle.
 *
 * Shared by reporters/aio-reporter.js (posting straight from a run) and
 * scripts/run-suite.js (posting after the operator confirms). As a CLI it
 * posts a pending-results file the reporter wrote during a dry run:
 *
 *   node scripts/aio-post.js [test-results/aio-pending.json]
 */

const fs = require('fs');
const path = require('path');
const { loadToken, request, paginate } = require('./aio-client');

const REPO_ROOT = path.join(__dirname, '..');
const PENDING_FILE = path.join(REPO_ROOT, 'test-results', 'aio-pending.json');
/** AIO rejects oversized payloads; the same cap the case search uses. */
const BATCH_SIZE = 100;
const BACKOFFS_MS = [2000, 5000, 10000];

/**
 * The person the run is made for: RUN_AS names a key of aio.config.json
 * `assignees` (case-insensitive). There is no default — anyone on the list
 * can run the suite, so nobody is assumed.
 *
 * @param {Record<string,{name:string,accountId:string}>} [assignees]
 * @returns {{key:string, name?:string, accountId?:string}}
 */
function resolveAssignee(assignees = {}) {
  const wanted = (process.env.RUN_AS || '').toLowerCase();
  const key = wanted && Object.keys(assignees).find((k) => k.toLowerCase() === wanted);
  return key ? { key, ...assignees[key] } : { key: process.env.RUN_AS || '' };
}

function loadAioConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'aio.config.json'), 'utf8'));
  return {
    assignees: cfg.aio.assignees || {},
    assignee: resolveAssignee(cfg.aio.assignees),
    projectKey: process.env.AIO_PROJECT || cfg.aio.projectKey,
    cycleKey: process.env.AIO_CYCLE || cfg.aio.cycleKey,
    statusNames: cfg.aio.statusNames,
    mappingFile: path.join(REPO_ROOT, cfg.aio.mappingFile),
  };
}

/**
 * Deliberately technology-agnostic: the comment
 * must read as a manual verification and must not reveal the automation stack.
 *
 * @param {string} status Playwright status
 * @param {string} tester the assignee's name
 */
function commentFor(status, tester) {
  const outcome = status === 'passed' ? 'The result is successful.' : 'The result is unsuccessful.';
  return `${tester} tested and verified this test case. ${outcome}`;
}

/**
 * @param {string} token
 * @param {{projectKey:string, cycleKey:string}} aio
 * @returns {Promise<Set<string>|null>} null when the cycle cannot be listed
 */
async function cycleCaseKeys(token, { projectKey, cycleKey }) {
  try {
    const runs = await paginate(
      token,
      'GET',
      `/project/${projectKey}/testcycle/${cycleKey}/testcase`
    );
    return new Set(runs.map((r) => r.testCase && r.testCase.key).filter(Boolean));
  } catch (err) {
    console.warn(`[aio] could not list cycle ${cycleKey}: ${err.message}; posting unfiltered.`);
    return null;
  }
}

/**
 * @param {string} token
 * @param {{projectKey:string, cycleKey:string}} aio
 * @param {any[]} testRuns
 */
async function postBatch(token, { projectKey, cycleKey }, testRuns) {
  // createNewRun=false updates the run already sitting in the cycle rather than
  // stacking a second one on top of it. assigneeMode=OVERRIDE replaces an
  // existing assignee (DEFAULT only fills an empty one), but it also clears the
  // assignee when assigneeToID is missing, so it is sent only when every run has one.
  const override = testRuns.every((r) => r.assigneeToID) ? '&assigneeMode=OVERRIDE' : '';
  const endpoint =
    `/project/${projectKey}/testcycle/${cycleKey}` +
    `/bulk/testrun/update?createNewRun=false${override}`;

  for (let i = 0; i <= BACKOFFS_MS.length; i += 1) {
    try {
      return await request(token, 'POST', endpoint, { testRuns });
    } catch (err) {
      const transient = / 5\d\d /.test(err.message);
      if (!transient || i === BACKOFFS_MS.length) throw err;
      console.warn(`[aio] ${err.message.split('\n')[0]}, retrying in ${BACKOFFS_MS[i] / 1000}s...`);
      await new Promise((r) => setTimeout(r, BACKOFFS_MS[i]));
    }
  }
  return null;
}

/**
 * Drop runs whose case is not in the cycle (AIO would reject them), then post
 * the rest in batches.
 *
 * @param {any[]} testRuns
 * @param {{projectKey:string, cycleKey:string}} [aio]
 * @returns {Promise<number>} number of results AIO accepted
 */
async function postTestRuns(testRuns, aio = loadAioConfig()) {
  let token;
  try {
    token = loadToken();
  } catch (err) {
    console.warn(`[aio] ${err.message} Skipping POST.`);
    return 0;
  }

  const keys = await cycleCaseKeys(token, aio);
  if (keys) {
    const outside = testRuns.filter((r) => !keys.has(r.testCaseKey));
    testRuns = testRuns.filter((r) => keys.has(r.testCaseKey));
    if (outside.length) {
      console.warn(
        `[aio] ${outside.length} result(s) not in cycle ${aio.cycleKey}, dropped: ` +
          outside.map((r) => r.testCaseKey).join(', ')
      );
    }
    if (testRuns.length === 0) {
      console.log(`[aio] nothing left after filtering to ${aio.cycleKey}.`);
      return 0;
    }
  }

  let posted = 0;
  for (let i = 0; i < testRuns.length; i += BATCH_SIZE) {
    const batch = testRuns.slice(i, i + BATCH_SIZE);
    const resp = (await postBatch(token, aio, batch)) || {};
    posted += resp.successCount ?? batch.length;
    if (resp.errorCount) {
      console.warn(
        `[aio] ${resp.errorCount} error(s) in batch: ${JSON.stringify(resp.errors).slice(0, 500)}`
      );
    }
  }
  console.log(`[aio] posted ${posted}/${testRuns.length} result(s) to ${aio.cycleKey}.`);
  return posted;
}

module.exports = {
  PENDING_FILE,
  loadAioConfig,
  commentFor,
  postTestRuns,
};

if (require.main === module) {
  const file = path.resolve(process.argv[2] || PENDING_FILE);
  const pending = JSON.parse(fs.readFileSync(file, 'utf8'));
  postTestRuns(pending.testRuns, { projectKey: pending.projectKey, cycleKey: pending.cycleKey })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[aio] ${err.message}`);
      process.exit(1);
    });
}
