/**
 * Playwright config for the {{name}} team.
 * Generated from packages/tooling/templates/team/playwright.config.ts.tpl.
 */

import { definePlaywrightConfig } from '@geowealth/e2e-framework/config';

export default definePlaywrightConfig({
  projectName: '{{slug}}',
  testDir: './tests',
});
