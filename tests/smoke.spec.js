// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Placeholder smoke test, tagged @pepi so the configured grep picks it up.
 *
 * The C-id (here C0) in the title is what the TestRail reporter uses to map
 * the test to a case in Run 175. Replace `C0` with the real TestRail case id
 * (e.g. `C28104`) once the mapping for each Pepi-labeled case is known.
 */
test.skip('@pepi qa3 login page loads (smoke, no TestRail case)', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), 'qa3 root should respond 2xx').toBeTruthy();
  expect(page.url()).toContain('geowealth.com');
});
