/**
 * TestRail C26490 — Verify UI message on the Open account pages for
 * deprecation of the back office page
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26490
 *         (Run 175, label Pepi)
 * Refs:   GEO-22328
 *
 * Asserts the legacy Back Office "Open Account" flow renders the
 * deprecation banner on every step page. The test stops at Step 4
 * (Review) — it does NOT click final Submit to avoid creating a
 * real brokerage account.
 *
 * Firm 106 / tim106Page — navigates directly to the BO Open Account
 * URL, no React hash routing.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';
import { ARNOLD_DELANEY } from '@geowealth/e2e-framework/data/constants';

const OPEN_ACCOUNT_URL = `/openAccount.do?clientUUID=${ARNOLD_DELANEY.clientUuid}`;
const DEPRECATION_BANNER =
  /This page will be unavailable starting April 6, 2026, as it now exists in Platform One/;

async function assertDeprecationBanner(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByText(DEPRECATION_BANNER).first()).toBeVisible({ timeout: 15_000 });
}

test('@regression @billing-servicing C26490 Open Account back-office deprecation message', async ({
  tim106Page,
}) => {
  test.slow();

  const page = tim106Page;

  await test.step('Page 0: Open Account intro shows deprecation banner', async () => {
    await page.goto(OPEN_ACCOUNT_URL);
    await expect(page).toHaveTitle(/Open Account/i, { timeout: 30_000 });
    await assertDeprecationBanner(page);
  });

  await test.step('Page 1: Choose Account Type — banner + Individual + Next', async () => {
    await page.getByRole('link', { name: 'Online Application' }).click();
    await expect(page).toHaveTitle(/Choose Account Type/i, { timeout: 15_000 });
    await assertDeprecationBanner(page);

    await page.getByRole('radio', { name: 'Individual Account' }).click();
    await page.getByRole('link', { name: 'Next step »' }).click();
  });

  await test.step('Page 2: Account Preference — banner + Cash + No write-checks + Next', async () => {
    await expect(page).toHaveTitle(/Choose Account Type \(cont\.\)/i, { timeout: 15_000 });
    await assertDeprecationBanner(page);

    await page.getByRole('radio', { name: /Cash account/ }).click();
    await page.locator('#openAccountForm_writeChecks0').click();
    await page.getByRole('link', { name: 'Next step »' }).click();
  });

  await test.step('Page 3: Set Up Account — banner + DOB + Employment + Compliance + Next', async () => {
    await expect(page).toHaveTitle(/Set Up Account/i, { timeout: 15_000 });
    await assertDeprecationBanner(page);

    await page.locator('#openAccountForm_birthMonth').fill('01');
    await page.locator('#openAccountForm_birthDate').fill('01');
    await page.locator('#openAccountForm_birthYear').fill('1990');
    await page.getByRole('radio', { name: 'Currently Employed' }).click();

    await page.locator('#openAccountForm_isbroker0').click();
    await page.locator('#openAccountForm_isdirector0').click();
    await page.locator('#openAccountForm_isfamilibroker0').click();
    await page.locator('#openAccountForm_isfamilyemployed0').click();

    await page.getByRole('link', { name: 'Next step »' }).click();
  });

  await test.step('Page 4: Investment Profile — banner + financials + Next', async () => {
    await expect(page).toHaveTitle(/Investment Profile/i, { timeout: 15_000 });
    await assertDeprecationBanner(page);

    await page.getByRole('radio', { name: 'Income' }).click();
    await page.locator('#openAccountForm_annualIncome').fill('1000');
    await page.locator('#openAccountForm_netWorth').fill('1000');
    await page.locator('#openAccountForm_primaryBank').fill('NJN');
    await page.locator('#openAccountForm_accountNumber').fill('123123123');
    await page.locator('#openAccountForm_accountInfo1').click();

    await page.getByRole('link', { name: 'Next step »' }).click();
  });

  await test.step('Page 5: Review Application — banner present, STOP', async () => {
    await expect(page).toHaveTitle(/Review Application/i, { timeout: 15_000 });
    await assertDeprecationBanner(page);
    // Do NOT submit — verifying the banner on Review is sufficient.
  });
});
