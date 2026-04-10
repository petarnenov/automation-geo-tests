/**
 * TestRail C25200 — Account: Advisor Split/Inactive Date - Create - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25200
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Both phases run on firm 106 (NOT workerFirm) because dummy firms
 * do not seed billing specs like "55 BPS" or advisor split options
 * like "77.5% Ruffing/22.5% Rawal".
 *
 *   Phase 1 (admin) → tim106Page. Sets Adviser Billing Spec to a
 *     non-Inherit value (prerequisite — the split section's date
 *     pickers stay non-interactive when spec is "Inherit"), then
 *     picks a split and sets active/inactive dates.
 *
 *   Phase 2 (non-admin) → tylerPage. Edit-button-hidden check.
 *
 * Race note: C25196 also mutates `adviserBillingSpecification` on
 * firm 106. Per-spec retry rides out the rare collision.
 *
 * The form has no UI to clear an advisor split once saved — the test
 * is an idempotent CREATE-OR-UPDATE. C25249 (Update) follows and
 * overwrites the inactive date.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

const ADVISOR_SPEC = '55 BPS';
const SPLIT_OPTION = '77.5% Ruffing/22.5% Rawal';
const ACTIVE_DATE = '01/05/2024';
const INACTIVE_DATE = '12/31/2030';

// Race partner: C25196 also mutates adviserBillingSpecification on firm 106.
test.describe.configure({ retries: 1 });

test('@regression @billing-servicing C25200 Advisor Split - Create - Admin and Non-Admin', async ({
  tim106Page,
  tylerPage,
}) => {
  test.slow();

  const billing = new AccountBillingPage(tim106Page);

  await test.step('Phase 1: admin sets Advisor Entity Split', async () => {
    await billing.goto({ static: 'arnold-delaney' });
    await billing.openEditModal();

    // Prerequisite: Advisor Billing Spec must be non-Inherit so the
    // split section's date pickers become interactive.
    await billing.adviserBillingSpec.setValue(ADVISOR_SPEC);

    await billing.advisorSplit.setValue(SPLIT_OPTION);
    await billing.advisorSplitActiveDate.setValue(ACTIVE_DATE);
    await billing.advisorSplitInactiveDate.setValue(INACTIVE_DATE);
    await billing.saveEditModal();

    await expect(
      tim106Page.locator('section[data-content="fieldSet"]', {
        hasText: SPLIT_OPTION,
      })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      tim106Page.locator('section[data-content="fieldSet"]', {
        hasText: '12/31/2030',
      })
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    const billingPhase2 = new AccountBillingPage(tylerPage);
    await billingPhase2.goto({ static: 'arnold-delaney' });
    await expect(billingPhase2.editButton).toHaveCount(0);
  });
});
