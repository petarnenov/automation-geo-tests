// @ts-check
/**
 * One-off probe: hit /qa/createDummyFirm.do once and dump the full JSON,
 * pretty-printed, so we can design the per-test isolation fixture against
 * the real response shape.
 *
 * Reuses the tim1 storage state from global-setup.
 *
 * Usage: node scripts/probe-create-dummy-firm.js
 */

const { request } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const STORAGE = path.join(__dirname, '..', 'tests', '.auth', 'tim1.json');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testrail.config.json'), 'utf8'));
const BASE = cfg.appUnderTest.url.replace(/\/$/, '');
const ENDPOINT = '/qa/createDummyFirm.do';

(async () => {
  if (!fs.existsSync(STORAGE)) {
    console.error(`storage state missing: ${STORAGE}`);
    process.exit(1);
  }

  const ctx = await request.newContext({
    baseURL: BASE,
    storageState: STORAGE,
    ignoreHTTPSErrors: true,
  });

  const t0 = Date.now();
  const res = await ctx.fetch(BASE + ENDPOINT, { method: 'POST' });
  const elapsed = Date.now() - t0;
  const status = res.status();
  const text = await res.text();

  console.log(`POST ${ENDPOINT} → ${status} in ${elapsed}ms`);
  console.log('content-type:', res.headers()['content-type']);
  console.log();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.log('NOT JSON, raw body:');
    console.log(text);
    await ctx.dispose();
    return;
  }

  console.log('=== full response (pretty) ===');
  console.log(JSON.stringify(parsed, null, 2));
  console.log();
  console.log('=== top-level keys ===');
  console.log(Object.keys(parsed));
  console.log();
  console.log('=== shape summary ===');
  console.log('firmCd:', parsed.firm?.firmCd);
  console.log('firmName:', parsed.firm?.firmName);
  console.log('adminUser.loginName:', parsed.adminUser?.loginName);
  console.log('adminUser.entityId:', parsed.adminUser?.entityId);
  console.log('users count:', parsed.users?.length);
  if (parsed.users) {
    parsed.users.forEach((u, i) => {
      console.log(`  user[${i}].loginName=${u.loginName}, name=${u.name}`);
      console.log(`    clients=${u.clients?.length}`);
    });
  }

  await ctx.dispose();
})();
