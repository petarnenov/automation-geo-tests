// @ts-check
/**
 * AIO GEO-TC-8063 (C18080) — Manage Contacts: Reset Editing Household.
 *
 * Platform One → Firm Admin → Contact Management → Manage Contacts, firm 1:
 * open an existing household from the search, Show Additional Settings, edit
 * fields, then click "Reset". Never submits; the spec asserts that no
 * contact write request fired and the stored contact is unchanged.
 */

const { test } = require('@playwright/test');
const { runEditContactAbort } = require('./_helpers');

test('@regression C18080 Manage Contacts - Reset Editing Household', async ({ page }) => {
  await runEditContactAbort({ page, kind: 'household', action: 'Reset' });
});
