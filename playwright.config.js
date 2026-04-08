// @ts-check
const playwrightTest = require('@playwright/test');
const { defineConfig, devices } = playwrightTest;
const fs = require('fs');
const path = require('path');
const { STORAGE_STATE_PATH } = require('./tests/_helpers/global-setup');
const { setupWorkerFirm } = require('./tests/_helpers/worker-firm');

// Monkey-patch the base `test` exported by @playwright/test so every spec
// (regardless of import path) gets the workerFirm fixture for free, without
// touching imports anywhere in tests/:
//
//   workerFirm   — opt-in worker-scoped fixture; provisions a fresh dummy
//                  firm via /qa/createDummyFirm.do on first use within a
//                  worker, then reuses it for the rest of that worker's
//                  tests. Tests opt in by destructuring `{ workerFirm }`.
//
// Each worker process loads this config before any spec, so the patch is in
// place by the time `require('@playwright/test')` resolves inside specs.
const baseTest = playwrightTest.test;
playwrightTest.test = baseTest.extend({
  workerFirm: [
    async ({}, use, workerInfo) => {
      const firm = await setupWorkerFirm();
      // eslint-disable-next-line no-console
      console.log(
        `[worker-firm] worker ${workerInfo.workerIndex}: ` +
          `firmCd=${firm.firmCd} (${firm.firmName}) ` +
          `advisor=${firm.advisor.loginName} hh=${firm.household.uuid}`
      );
      await use(firm);
      // No teardown — dummy firms accumulate on qa2 by design.
    },
    { scope: 'worker' },
  ],
  // Opt-in extension: tests that need a prospect in the worker firm
  // (merge-prospect specs) declare this fixture and pay the ~10s setup cost.
  // Other tests are unaffected.
});

const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'testrail.config.json'), 'utf8')
);

const labelTag = `@${cfg.playwright.labelFilter}`; // "@pepi"

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 8,
  // Default 30s is too tight: worker fixtures provision a dummy firm
  // (~6-15s) and optionally a prospect (~10s), and the test body itself
  // routinely needs another 60-180s for upload + advisor verification flows.
  // 600s also gives mutex-serialised feature groups (merge-prospect,
  // account-billing) headroom: with N workers waiting on a single lock and
  // each lock-holder running ~90s, the last worker still has budget to spare.
  timeout: 600_000,
  // Only run cases marked with the configured label tag (e.g. @pepi).
  grep: new RegExp(labelTag),
  // Run global setup once per `playwright test` invocation: log in as tim1
  // and save the storage state. Each test then reuses that session.
  globalSetup: require.resolve('./tests/_helpers/global-setup'),
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./reporters/testrail-reporter.js'],
  ],
  use: {
    baseURL: cfg.appUnderTest.url,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Preload the tim1 session so tests skip the login form.
    storageState: STORAGE_STATE_PATH,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
