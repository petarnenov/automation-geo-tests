/**
 * TestRail C25196 — Account: Spec Name/Active Date - Admin and Non-Admin
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25196
 *         (Run 175, label Pepi)
 * Refs:   GEO-11480
 *
 * Both phases run on firm 106 (NOT workerFirm) because dummy firms
 * do not seed billing specs like "55 BPS" / "55 BPS-Flows". The
 * `adviserBillingSpecification` combo is a typeAhead variant whose
 * options are firm-specific.
 *
 *   Phase 1 (admin write/read flow) → tim106Page (GW Admin on firm 106).
 *   Phase 2 (non-admin Edit-button-hidden check) → tylerPage.
 *
 * Race note: C25200 also mutates `adviserBillingSpecification` on
 * firm 106. With only this single race partner, a per-spec retry
 * rides out the rare collision — same approach as the legacy spec.
 *
 * The test toggles between two non-Inherit spec options. We avoid
 * switching to/from "Inherit from ..." because the form rejects Save
 * when Active Date is non-empty and the new spec is Inherit (the
 * Active Date picker becomes disabled and the form fails the implicit
 * cleared-when-disabled invariant). Both flips are non-Inherit →
 * non-Inherit, which matches what the TestRail steps exercise.
 *
 * Differences from the legacy spec (deliberate):
 *
 *   - Uses two distinct fixture-provided pages (tim106Page in Phase 1,
 *     tylerPage in Phase 2) instead of clearCookies + relogin.
 *
 *   - Drives the form via AccountBillingPage + ComboBox + ReactDatePicker
 *     components, not inline locators + setComboBoxValue/setReactDatePicker.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { AccountBillingPage } from '../../../src/pages/account-billing/AccountBillingPage';

const SPEC_A = '55 BPS';
const SPEC_B = '55 BPS-Flows';

// Race partner: C25200 also mutates adviserBillingSpecification on firm 106.
test.describe.configure({ retries: 1 });

test('@regression @billing-servicing C25196 Spec Name/Active Date - Admin and Non-Admin', async ({
  tim106Page,
  tylerPage,
}) => {
  test.slow();

  const billing = new AccountBillingPage(tim106Page);

  let firstSpec: string;
  let secondSpec: string;

  await test.step('Phase 1.1: change Adviser Billing Spec + Active Date', async () => {
    await billing.goto({ static: 'arnold-delaney' });

    const current = await billing.getDisplayedAdviserBillingSpec();
    if (current === SPEC_A) {
      firstSpec = SPEC_B;
      secondSpec = SPEC_A;
    } else {
      firstSpec = SPEC_A;
      secondSpec = SPEC_B;
    }
    test.info().annotations.push({
      type: 'captured',
      description: `current=${current} first=${firstSpec} second=${secondSpec}`,
    });

    await billing.openEditModal();
    await billing.adviserBillingSpec.setValue(firstSpec);
    await billing.activeDate.setValue('06/15/2025');
    await billing.saveEditModal();

    await expect
      .poll(async () => billing.getDisplayedAdviserBillingSpec(), { timeout: 15_000 })
      .toContain(firstSpec);
  });

  await test.step('Phase 1.2: flip Adviser Billing Spec to the other value', async () => {
    await billing.openEditModal();
    await billing.adviserBillingSpec.setValue(secondSpec);
    await billing.saveEditModal();

    await expect
      .poll(async () => billing.getDisplayedAdviserBillingSpec(), { timeout: 15_000 })
      .toContain(secondSpec);
  });

  await test.step('Phase 2: tyler (firm 106 non-admin) cannot see Edit Billing Settings', async () => {
    const billingPhase2 = new AccountBillingPage(tylerPage);
    await billingPhase2.goto({ static: 'arnold-delaney' });
    await expect(billingPhase2.editButton).toHaveCount(0);
  });
});
