/**
 * `AccountBillingPage` Page Object end-to-end smoke spec.
 *
 * Phase 2 step 6 (D-37). Exercises every method on the new Page
 * Object against a real qa2 environment, using the worker firm's
 * primary client/account so the spec is parallel-safe and does not
 * mutate firm 106.
 *
 * Coverage:
 *
 *   1. goto({ workerFirm }) — navigate to the Billing tab and wait
 *      for the History button (page-loaded signal).
 *   2. getDisplayedInceptionDate() — read the summary card via the
 *      Q3 sibling-axis xpath. Dummy firm accounts come with no
 *      inception date set, so this returns an empty string on the
 *      first call.
 *   3. openEditModal() — click Edit, wait for title + Save button
 *      (Q4 form-fetched-async absorption).
 *   4. inceptionDate.setValue(...) — drives the lifted ReactDatePicker
 *      Component (Q1+Q1'+Q2 paths). Already verified by the
 *      framework's own ReactDatePicker.spec.ts; here it is exercised
 *      via the Page Object surface, not directly.
 *   5. cancelEditModal() — close without saving. Save-path
 *      verification belongs to C25193 in step 7, not here.
 *
 * What this spec does NOT do:
 *   - Save (step 7's job).
 *   - Open the History modal (no audit row to assert against; Q6
 *     audit-pipeline absence is documented in C25193's spec header).
 *   - Touch firm 106 (read-only Phase 2 of C25193 covers that).
 *
 * test.slow() applied per Section 4.8 — same rationale as the
 * framework's per-role-pages spec: real qa login + navigate +
 * form-load eats the default 60s budget.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { AccountBillingPage } from '../../src/pages/account-billing/AccountBillingPage';

test('@smoke @billing-servicing AccountBillingPage navigates and drives the Edit modal', async ({
  workerFirmAdminPage,
  workerFirm,
}) => {
  test.slow();

  const billing = new AccountBillingPage(workerFirmAdminPage);

  // 1. Navigate. Page-loaded signal (History button visible) is
  //    encapsulated in goto().
  await billing.goto({ workerFirm });

  // 2. Read the summary card. Dummy firm accounts come with no
  //    inception date — empty string is the expected initial state.
  const initial = await billing.getDisplayedInceptionDate();
  expect(initial).toBe('');

  // 3. Open the Edit modal. Q4 absorption: openEditModal() returns
  //    only after the Save button is visible (proof the form fetch
  //    completed).
  await billing.openEditModal();
  await expect(billing.editModalTitle).toBeVisible();
  await expect(billing.saveButton).toBeVisible();

  // 4. Drive the date picker through the Page Object surface.
  //    The ReactDatePicker Component is composed inside billing as
  //    `inceptionDate` — exercise the Q1+Q1'+Q2 paths via the Page
  //    Object's facade, not by reaching into the Component.
  await billing.inceptionDate.setValue('06/15/2025');

  // 5. The calendar popup is closed again — proof the day-cell
  //    click was accepted by React's onChange (otherwise the
  //    Component's internal `expect(calendar).toBeHidden()` would
  //    have thrown).
  await expect(workerFirmAdminPage.locator('.react-calendar')).toBeHidden();

  // 6. Cancel without saving. Save-path verification is C25193's
  //    job — this smoke spec only verifies the Page Object's
  //    method surface, not the write path.
  await billing.cancelEditModal();
});
