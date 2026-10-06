// @ts-check
/**
 * Suite configuration: non-secret settings from testrail.config.json,
 * credentials from the environment (.env.local, see ./env.js).
 *
 *   TIM1_USERNAME   Platform One admin login (falls back to the config value)
 *   TIM1_PASSWORD   its password; also used by dummy-firm users and timN
 *   GEO_DB_USER     Oracle user for the direct-DB helpers
 *   GEO_DB_PASSWORD its password
 */

const fs = require('fs');
const path = require('path');
const { loadEnv, requireEnv, REPO_ROOT } = require('./env');

loadEnv();

const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'testrail.config.json'), 'utf8'));

const cfg = {
  ...raw,
  appUnderTest: {
    ...raw.appUnderTest,
    username: process.env.TIM1_USERNAME || raw.appUnderTest.username,
    // Getter: specs that never log in (and `playwright test --list`) must not
    // fail just because the password is not configured.
    get password() {
      return requireEnv('TIM1_PASSWORD');
    },
  },
};

module.exports = { cfg };
