// @ts-check
/**
 * Standalone smoke test for tests/_helpers/worker-firm.js — calls setupWorkerFirm()
 * once and prints the normalized shape, so we can eyeball whether the flattening
 * matches what the upcoming spec refactor expects.
 *
 * Usage: node scripts/probe-worker-firm.js
 */

// Phase 0 Step 0.C: load .env.local BEFORE requiring worker-firm, which reads
// process.env.TIM1_PASSWORD at module load time.
require('../load-env');

const { setupWorkerFirm } = require('../tests/_helpers/worker-firm');

(async () => {
  const t0 = Date.now();
  const wf = await setupWorkerFirm();
  const elapsed = Date.now() - t0;

  console.log(`setupWorkerFirm() OK in ${elapsed}ms`);
  console.log();
  console.log('firmCd     :', wf.firmCd);
  console.log('firmName   :', wf.firmName);
  console.log('admin      :', wf.admin);
  console.log('advisor    :', wf.advisor);
  console.log('household  :', wf.household);
  console.log('client     :', wf.client);
  console.log('accounts   :', wf.accounts);
  console.log();
  console.log(`tuples (${wf.tuples.length} total):`);
  wf.tuples.forEach((t, i) => {
    console.log(
      `  [${i}] advisor=${t.advisor.loginName} hh=${t.household.uuid.slice(0, 8)}… ` +
        `client=${t.client.uuid.slice(0, 8)}… accounts=${t.accounts.length}`
    );
  });
})();
