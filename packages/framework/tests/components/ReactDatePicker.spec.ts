/**
 * `ReactDatePicker` Component end-to-end smoke spec.
 *
 * Phase 2 step 5 (D-37). The lifted Component class wraps the
 * legacy `setReactDatePicker` from `_helpers/ui.js` (Q1+Q2 in the
 * C25193 entry spike — dispatch-burst loop + 240-iter calendar nav).
 * This spec verifies the lift preserved the behaviour by driving
 * the picker against a real qa2 page.
 *
 * The picker is reachable from the worker firm's Account Billing
 * edit modal — the same path C25193 will use after step 7. The spec
 * navigates there, opens the edit modal, sets a date via the
 * Component, and asserts the calendar popup closes (proof the day
 * cell click was accepted by React's onChange). It does NOT save —
 * the verification is on the Component, not on the Account Billing
 * write path (that's C25193's job).
 *
 * test.slow() is used for the same reason as the per-role-pages
 * smoke spec from step 4: the workerFirmAdminPage fixture's setup
 * includes a real qa login (~30s), and on top of that this spec
 * navigates to the Billing tab and waits for the form to render
 * (~10s). The default 60s test timeout is right at the edge.
 *
 * Smoke specs for ComboBox, NumericInput, and AgGrid are deferred
 * to step 6 (AccountBillingPage), where the modal-opening logic
 * lives in one place and three Component verifications can share
 * one navigation. Inlining the modal opening here for all three
 * would duplicate ~20 lines per spec; one Page Object call after
 * step 6 is the cleaner unit. The legacy POC's setReactDatePicker
 * is the highest-risk component (Q1 + Q1' + Q2 are non-trivial),
 * so it gets its own spec ahead of the others.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { ReactDatePicker } from '@geowealth/e2e-framework/components/ReactDatePicker';

test('@smoke @framework ReactDatePicker opens calendar, navigates, sets date', async ({
  workerFirmAdminPage,
  workerFirm,
}) => {
  // Login + navigate take most of the wall clock; bump the timeout
  // budget per Section 4.8.
  test.slow();

  // Navigate to the worker firm's primary client/account Billing
  // tab. Same URL shape as the legacy gotoWorkerFirmAccountBilling.
  // The leading "1" is entityTypeCd (client = 1), NOT a firm code.
  const url = `/react/indexReact.do#/client/1/${workerFirm.client.uuid}/accounts/${workerFirm.accounts[0].uuid}/billing`;
  await workerFirmAdminPage.goto(url);

  // Wait for the Billing tab to finish loading. The History button
  // is the most stable signal that the tab content rendered (legacy
  // POC's gotoAccountBilling uses the same wait).
  await expect(
    workerFirmAdminPage.getByRole('button', { name: 'History', exact: true })
  ).toBeVisible({ timeout: 30_000 });

  // Open the Edit Billing Settings modal. The form is fetched async
  // — the modal title appears immediately, but the date pickers and
  // other inputs only render once the Save button is present (Q4
  // in the spike).
  await workerFirmAdminPage.getByRole('button', { name: 'Edit Billing Settings' }).click();
  await expect(
    workerFirmAdminPage.getByText('Edit Account Billing Settings').first()
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    workerFirmAdminPage.getByRole('button', { name: 'Save', exact: true })
  ).toBeVisible({ timeout: 30_000 });

  // Drive the Component. The setValue call exercises:
  //   - Q1' dispatch-burst calendar open (with retry)
  //   - Q2 month-by-month navigation reading the calendar header
  //   - the day cell click that fires React's onChange
  //   - the post-click "calendar hidden" assertion
  const inceptionDate = new ReactDatePicker(workerFirmAdminPage, '#billingInceptionDate');
  await inceptionDate.setValue('06/15/2025');

  // The calendar popup is hidden again — proof setValue completed
  // the click and React accepted the value. We do NOT click Save
  // (no write-path verification here — that belongs to C25193).
  await expect(workerFirmAdminPage.locator('.react-calendar')).toBeHidden();

  // Cancel the modal so we leave a clean state. Some forms surface
  // a "you have unsaved changes" prompt — close it if it appears.
  const cancelBtn = workerFirmAdminPage.getByRole('button', { name: 'Cancel', exact: true });
  if (await cancelBtn.isVisible().catch(() => false)) {
    await cancelBtn.click();
  }
});
