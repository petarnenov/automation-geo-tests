/**
 * TestRail C26306 — Copy a billing specification to another firm
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26306
 *         (Run 175, label Pepi)
 *
 * Copies a billing spec from firm 1 (GeoWealth Management LLC) to a
 * per-worker dummy firm. Uses workerFirm for isolation — each run
 * targets a fresh firm with no billing specs, so the name-uniqueness
 * server check cannot fail.
 *
 * Uses the default `page` with tim1 storageState (GW admin).
 * workerFirm provides the target firm.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { BillingSpecificationsGridPage } from '../../../src/pages/billing-specs/BillingSpecificationsGridPage';
import { CopyBillingSpecificationPage } from '../../../src/pages/billing-specs/CopyBillingSpecificationPage';

const FIRM_A = 1;

test('@regression @billing-servicing C26306 Copy a billing specification to another firm', async ({
  page,
  workerFirm,
}) => {
  test.slow();

  const FIRM_B = workerFirm.firmCd;
  const gridPage = new BillingSpecificationsGridPage(page);
  const copyPage = new CopyBillingSpecificationPage(page);

  let sourceSpecName: string;
  let newSpecName: string;

  await test.step('Open Billing Specifications grid for firm A', async () => {
    await gridPage.open(FIRM_A);
  });

  await test.step('Capture the source spec name from the first row', async () => {
    sourceSpecName = await gridPage.getRowSpecName(0);
    expect(sourceSpecName, 'firm A must have at least one named spec').toBeTruthy();
    newSpecName = `${sourceSpecName}_C26306_${Date.now()}`;
  });

  await test.step('Hover the row and click the Copy icon', async () => {
    await gridPage.copyRowByIndex(0);
    await gridPage.waitForCopyFormLoaded(FIRM_A);
  });

  await test.step('Copy form opens with the source spec data pre-populated', async () => {
    await copyPage.waitForHydrated();
    expect(await copyPage.getSpecName()).toBe(sourceSpecName);
  });

  // Firm change re-hydrates the form and resets spec name, so set
  // firm FIRST and override the name AFTER. See the quirk docs in
  // `CopyBillingSpecificationPage`.
  await test.step(`Change Firm Name from firm ${FIRM_A} to firm ${FIRM_B}`, async () => {
    await copyPage.setTargetFirm(FIRM_B);
  });

  await test.step('Update the Specification Name to a unique value', async () => {
    await copyPage.setSpecName(newSpecName);
    expect(await copyPage.getSpecName()).toBe(newSpecName);
  });

  await test.step('Click Create Spec to save the copy', async () => {
    await copyPage.submit();
  });

  await test.step(`Switch to firm ${FIRM_B} and locate the new spec`, async () => {
    await gridPage.open(FIRM_B);
    await gridPage.quickSearch(newSpecName);
    await expect(gridPage.findRowBySpecName(newSpecName)).toBeVisible({ timeout: 30_000 });
  });
});
