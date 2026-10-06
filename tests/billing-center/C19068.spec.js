// @ts-check
/**
 * AIO GEO-TC-11953 (C19068) — Fee Rate: "Requires Permission to Edit" is
 * unchecked by default for the selected firm.
 *
 * "By default" needs a firm whose Proposal Fee Rate config was never edited,
 * so the test uses the worker's freshly provisioned dummy firm (workerFirm)
 * rather than a shared firm someone may have configured.
 *
 * Source (BillingCenter/pages/ProposalFeeRates):
 *   - SearchFirms: comboBox `selectCompany` (label "Firm", required); picking a
 *     firm only pushes #platformOne/billingCenter/proposalFeeRates/<firmCd>.
 *   - Config loads from /react/getProposalFeeRateConfig.do; the checkbox is
 *     FormBuilder `requiresPermissionToEdit` (isChecked = value ?? false).
 *   - Saving happens only on an explicit form submit, which the test never does.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const PAGE_URL = '/react/indexReact.do#platformOne/billingCenter/proposalFeeRates';

test(
  '@pepi C19068 Fee Rate - Requires Permission to Edit is unchecked by default',
  { annotation: [{ type: 'aio', description: 'GEO-TC-11953' }] },
  async ({ page, workerFirm }) => {
    test.setTimeout(180_000);

    const typeAhead = page.locator('#selectCompany_typeAhead');

    await loginPlatformOneAdmin(page);

    await test.step('Step 2: Proposal Fee Rate page shows a mandatory "Firm" dropdown', async () => {
      await page.goto(PAGE_URL);
      const label = page.locator('#selectCompany label[for="selectCompanyField"]');
      await expect(label).toBeVisible({ timeout: 60_000 });
      await expect(label).toHaveAttribute('title', 'Firm');
      await expect(label.locator('[role="required-label"]')).toHaveText('*');
    });

    let config;

    await test.step('Step 3: select the firm from the dropdown', async () => {
      await typeAhead.click();
      await typeAhead.pressSequentially(workerFirm.firmName, { delay: 20 });
      const option = page.locator(
        `[role="combo-box-list-item"][data-value="${workerFirm.firmCd}"]`
      );
      await expect(option).toBeVisible({ timeout: 10_000 });
      const configResp = page.waitForResponse((r) =>
        r.url().includes('/react/getProposalFeeRateConfig.do')
      );
      await option.evaluate((el) => /** @type {HTMLElement} */ (el).click());
      await expect(page).toHaveURL(new RegExp(`/proposalFeeRates/${workerFirm.firmCd}$`));
      config = await (await configResp).json();
    });

    await test.step('Step 3: "Requires Permission to Edit" is unchecked', async () => {
      const checkbox = page.locator('#requiresPermissionToEditField');
      // FormBuilder checkboxes render two labels for the input: the box and the text.
      await expect(
        page
          .locator('label[for="requiresPermissionToEditField"]')
          .filter({ hasText: 'Requires Permission to Edit' })
      ).toBeVisible({ timeout: 30_000 });
      await expect(checkbox).not.toBeChecked();
      expect(
        JSON.stringify(config),
        'config for a new firm carries no requiresPermissionToEdit=true'
      ).not.toMatch(/"requiresPermissionToEdit"\s*:\s*(true|"Y"|"true")/);
    });
  }
);
