// @ts-check
/**
 * AIO GEO-TC-8068 (C18085) — Manage Contacts: Cancel Editing Prospect.
 *
 * Platform One → Firm Admin → Contact Management → Manage Contacts, firm 1:
 * open an existing prospect from the search, Show Additional Settings, edit
 * fields, then click "Cancel". Never submits; the spec asserts that no
 * contact write request fired and the stored contact is unchanged.
 */

const { test } = require('@playwright/test');
const { runEditContactAbort } = require('./_helpers');

test('@pepi C18085 Manage Contacts - Cancel Editing Prospect', async ({ page }) => {
  await runEditContactAbort({ page, kind: 'prospect', action: 'Cancel' });
});
