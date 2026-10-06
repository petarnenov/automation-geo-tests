// @ts-check
/**
 * AIO GEO-TC-8067 (C18084) — Manage Contacts: Cancel Editing Client.
 *
 * Platform One → Firm Admin → Contact Management → Manage Contacts, firm 1:
 * open an existing client from the search, Show Additional Settings, edit
 * fields, then click "Cancel". Never submits; the spec asserts that no
 * contact write request fired and the stored contact is unchanged.
 */

const { test } = require('@playwright/test');
const { runEditContactAbort } = require('./_helpers');

test('@pepi C18084 Manage Contacts - Cancel Editing Client', async ({ page }) => {
  await runEditContactAbort({ page, kind: 'client', action: 'Cancel' });
});
