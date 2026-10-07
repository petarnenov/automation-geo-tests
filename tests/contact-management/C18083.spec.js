// @ts-check
/**
 * AIO GEO-TC-8066 (C18083) — Manage Contacts: Cancel Editing Household.
 *
 * Platform One → Firm Admin → Contact Management → Manage Contacts, firm 1:
 * open an existing household from the search, Show Additional Settings, edit
 * fields, then click "Cancel". Never submits; the spec asserts that no
 * contact write request fired and the stored contact is unchanged.
 */

const { test } = require('@playwright/test');
const { runEditContactAbort } = require('./_helpers');

test('@regression C18083 Manage Contacts - Cancel Editing Household', async ({ page }) => {
  await runEditContactAbort({ page, kind: 'household', action: 'Cancel' });
});
