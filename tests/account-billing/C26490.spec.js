// @ts-check
/**
 * TestRail C26490 — Verify UI message on the Open account pages for deprecation
 *   of the back office page
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26490 (Run 175, label Pepi)
 * Refs:   GEO-22328
 *
 * What this asserts: the legacy Back Office "Open Account" flow renders the
 * deprecation banner on every step page in the wizard. The banner copy lives
 * in WebContent/tiles/pages/openAccount*Body.jsp and reads:
 *
 *     "This page will be unavailable starting April 6, 2026, as it now exists
 *      in Platform One. Please use the Platform One version going forward."
 *
 * Notable simplifications vs the literal TestRail script:
 *   - TestRail step 2 says "Click User icon → Back Office → new browser tab".
 *     Live exploration on qa2 showed the BO Open Account screen renders in
 *     the SAME tab when navigated directly via /openAccount.do?clientUUID=…,
 *     so we skip the React-side User Icon click and the new-tab handling.
 *   - TestRail step 9 says "select No radio button" for the existing-account
 *     question. With the default broker "Manual Entry DF", that fails server
 *     validation ("For this broker dealer you must provide account number")
 *     and the wizard refuses to advance. We select **Yes** + account number
 *     instead — verified to work on qa2.
 *   - TestRail step 10 (final Submit) actually creates a brokerage account
 *     for the test client. We deliberately STOP at Step 4 (Review) and do
 *     NOT click the final Next, so the test is non-destructive: it asserts
 *     the deprecation banner on all 6 pages without mutating any client.
 *
 * Test data: tim106 / Plimsoll FP (firm 106) admin against the existing
 * Arnold, Delaney client (UUID A80D472B04874979AAA3D8C3FFE9BD3A). Firm 106
 * is the firm Tyler/tim106 belong to and is neither firm 1 nor firm 74,
 * matching the TestRail precondition.
 */

const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./_helpers');

const CLIENT_UUID = 'A80D472B04874979AAA3D8C3FFE9BD3A';
const OPEN_ACCOUNT_URL = `/openAccount.do?clientUUID=${CLIENT_UUID}`;

const DEPRECATION_BANNER =
  /This page will be unavailable starting April 6, 2026, as it now exists in Platform One/;

/**
 * Assert the legacy Back Office deprecation banner is visible on the current
 * page. Banner DOM: `div.errorHolder > div.error`. We match by text so the
 * assertion is robust to wrapper class renames.
 * @param {import('@playwright/test').Page} page
 */
async function assertDeprecationBanner(page) {
  await expect(page.getByText(DEPRECATION_BANNER).first()).toBeVisible({
    timeout: 15_000,
  });
}

test('@pepi C26490 Open Account back-office deprecation message', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);

  await loginAsAdmin(context, page);

  await test.step('Page 0: Open Account intro shows deprecation banner', async () => {
    await page.goto(OPEN_ACCOUNT_URL);
    await expect(page).toHaveTitle(/Open Account/i, { timeout: 30_000 });
    await assertDeprecationBanner(page);
  });

  await test.step('Page 1: Choose Account Type — banner + select Individual + Next', async () => {
    await page.getByRole('link', { name: 'Online Application' }).click();
    await expect(page).toHaveTitle(/Choose Account Type/i, { timeout: 15_000 });
    await assertDeprecationBanner(page);

    await page.getByRole('radio', { name: 'Individual Account' }).click();
    await page.getByRole('link', { name: 'Next step »' }).click();
  });

  await test.step('Page 2: Account Preference — banner + Cash + No write-checks + Next', async () => {
    await expect(page).toHaveTitle(/Choose Account Type \(cont\.\)/i, {
      timeout: 15_000,
    });
    await assertDeprecationBanner(page);

    await page.getByRole('radio', { name: /Cash account/ }).click();
    // The "write checks" question and the Cash/Margin question both have a
    // "No" radio. Use #openAccountForm_writeChecks0 (the first 'No' on the
    // page is the writeChecks one — confirmed in exploration).
    await page.locator('#openAccountForm_writeChecks0').click();
    await page.getByRole('link', { name: 'Next step »' }).click();
  });

  await test.step('Page 3: Set Up The Account — banner + DOB + Employment + 4× Compliance=No + Next', async () => {
    await expect(page).toHaveTitle(/Set Up Account/i, { timeout: 15_000 });
    await assertDeprecationBanner(page);

    // DOB split across three text inputs.
    await page.locator('#openAccountForm_birthMonth').fill('01');
    await page.locator('#openAccountForm_birthDate').fill('01');
    await page.locator('#openAccountForm_birthYear').fill('1990');

    await page.getByRole('radio', { name: 'Currently Employed' }).click();

    // Compliance Information: 4 questions, all "No". The struts form names
    // each as <field>0 = No, <field>1 = Yes.
    await page.locator('#openAccountForm_isbroker0').click();
    await page.locator('#openAccountForm_isdirector0').click();
    await page.locator('#openAccountForm_isfamilibroker0').click();
    await page.locator('#openAccountForm_isfamilyemployed0').click();

    await page.getByRole('link', { name: 'Next step »' }).click();
  });

  await test.step('Page 4: Investment Profile — banner + Income + financials + broker info + Next', async () => {
    await expect(page).toHaveTitle(/Investment Profile/i, { timeout: 15_000 });
    await assertDeprecationBanner(page);

    await page.getByRole('radio', { name: 'Income' }).click();
    await page.locator('#openAccountForm_annualIncome').fill('1000');
    await page.locator('#openAccountForm_netWorth').fill('1000');
    await page.locator('#openAccountForm_primaryBank').fill('NJN');
    // Default broker "Manual Entry DF" requires account number — selecting
    // No here yields a server validation error. Select Yes + provide a
    // dummy account number so the wizard advances.
    await page.locator('#openAccountForm_accountNumber').fill('123123123');
    // Field is `accountInfo` (yes/no radio bound via `s:radio list="yesno"`),
    // index 1 = Yes. Selecting Yes lets the form pass server validation when
    // an account number is supplied.
    await page.locator('#openAccountForm_accountInfo1').click();

    await page.getByRole('link', { name: 'Next step »' }).click();
  });

  await test.step('Page 5: Review Application — banner present, STOP (do not submit)', async () => {
    await expect(page).toHaveTitle(/Review Application/i, { timeout: 15_000 });
    await assertDeprecationBanner(page);
    // Intentional: do NOT click "Next step »" here. Step 5 (Submit) creates
    // a real brokerage account for Delaney Arnold; the deprecation message
    // contract is fully verified by reaching the Review page with banner.
  });
});
