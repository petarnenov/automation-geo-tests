// @ts-check
/**
 * Shared helpers for the Platform One Auto-link spec family.
 *
 * Each Auto-link spec follows the same UX:
 *   1. login as Platform One admin (`tim1`)
 *   2. navigate Firm Admin → Users for the configured firm
 *   3. click "Create New User" → assert the modal mounts with the expected fields
 *   4. SAFETY: close the modal without clicking Create.
 *
 * Why a safety stop and not the full destructive flow:
 *   - Each TestRail case asserts behaviour AFTER the user is created (auto-link
 *     vs no-link, delink/relink, etc), but creating a user is destructive and
 *     qa3 has no documented per-run cleanup. The full automation needs a
 *     disposable email pool, a Site 1 fixture user, and a teardown step
 *     (see ./_blocker-note.md).
 *   - The smoke still has value: it verifies tim1 has Firm Admin Users access,
 *     the Create User modal mounts, and the GW Admin checkbox + Email field
 *     are present — i.e. the prerequisites for the auto-link logic are wired.
 *
 * Specs vary only in the firm code they target. The modal structure is the
 * same across firms.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../../_helpers/qa3');

/**
 * @param {object} args
 * @param {import('@playwright/test').Page} args.page
 * @param {number} args.firmCode  Firm to open the Users page for.
 */
async function runAutoLinkCreateUserSmoke({ page, firmCode }) {
  test.setTimeout(180_000);

  await test.step(`Login and open Firm Admin → Users for firm ${firmCode}`, async () => {
    await loginPlatformOneAdmin(page);
    await page.goto(`/react/indexReact.do#platformOne/firmAdmin/users/${firmCode}`);
    // 30s — qa2 can be slow under parallel load (8 workers hitting Firm Admin
    // pages concurrently); the legacy 15s was a single-worker assumption.
    await expect(page.getByRole('button', { name: 'Create New User' })).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('Open Create New User modal and verify form fields', async () => {
    await page.getByRole('button', { name: 'Create New User' }).click();

    // Modal title
    await expect(page.getByText('Create New User', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Required fields the auto-link logic depends on
    await expect(page.getByRole('textbox', { name: /First Name/i }).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Username/i }).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Email Address/i }).first()).toBeVisible();

    // The GW Admin toggle is the linchpin of the auto-link behaviour.
    await expect(page.getByText('GW Admin').first()).toBeVisible();

    // The Roles section must be present (auto-link permissions hinge on this)
    await expect(page.getByText('All Employees (Mandatory)').first()).toBeVisible();

    // Create button exists (disabled until form is valid).
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
  });

  await test.step('SAFETY: close modal without creating', async () => {
    // The modal X icon doesn't have an accessible name, so we use Escape which
    // most React modals listen to. Fall back to refreshing the page if the
    // modal stays mounted.
    await page.keyboard.press('Escape');
    // Verify we are back on the Users page (Create New User button visible)
    // and not stuck in the modal.
    await expect(page.getByRole('button', { name: 'Create New User' })).toBeVisible({
      timeout: 5000,
    });
  });
}

module.exports = { runAutoLinkCreateUserSmoke };
