// @ts-check
/**
 * AIO GEO-TC-11949 (C19066) — Fee Rate: only active firms appear in the
 * "Proposal Fee Rate" Firm dropdown.
 *
 * The AIO precondition lists active firms with a DB query; here the inactive
 * firm set comes from /bo/getFirms.do?inactive=true (the same source the
 * Billing Specifications firm picker uses), so no DB access is needed.
 *
 * Source (BillingCenter/pages/ProposalFeeRates/Components/SearchFirms):
 *   comboBox `selectCompany` (label "Firm", required) fed by `firmsList`, the
 *   active-firms selector. Picking a firm only pushes a route; nothing is saved.
 *   The option list is virtualised (~20 rows rendered), so it is scrolled to
 *   read every option.
 *
 * Read-only.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const PAGE_URL = '/react/indexReact.do#platformOne/billingCenter/proposalFeeRates';

test(
  '@pepi C19066 Fee Rate - only active firms appear in the Proposal Fee Rate dropdown',
  { annotation: [{ type: 'aio', description: 'GEO-TC-11949' }] },
  async ({ page }) => {
    test.setTimeout(180_000);

    const typeAhead = page.locator('#selectCompany_typeAhead');
    const options = page.locator('[role="combo-box-list-item"]');

    const clearTypeAhead = async () => {
      await typeAhead.evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).focus();
        /** @type {HTMLInputElement} */ (el).select();
      });
      await typeAhead.press('Backspace');
    };

    await loginPlatformOneAdmin(page);

    /** @type {{firmCd: number, name: string}[]} */
    let inactiveFirms = [];

    await test.step('Precondition: resolve the inactive firms', async () => {
      const res = await page.request.get('/bo/getFirms.do?inactive=true&reactRequest=true');
      const body = await res.json();
      expect(body.success, 'getFirms.do succeeded').toBeTruthy();
      inactiveFirms = (body.rows || [])
        .filter((f) => f.inactiveFirm)
        .map((f) => ({ firmCd: Number(f.id), name: f.name }));
    });

    test.skip(!inactiveFirms.length, 'environment has no inactive firms');

    await test.step('Step 2: Proposal Fee Rate page shows a mandatory "Firm" dropdown', async () => {
      await page.goto(PAGE_URL);
      const label = page.locator('#selectCompany label[for="selectCompanyField"]');
      await expect(label).toBeVisible({ timeout: 60_000 });
      await expect(label).toHaveAttribute('title', 'Firm');
      await expect(label.locator('[role="required-label"]')).toHaveText('*');
      await expect(typeAhead).toBeVisible();
    });

    await test.step('Step 3: no inactive firm is offered in the list', async () => {
      await typeAhead.click();
      await expect(options.first()).toBeVisible({ timeout: 10_000 });
      const listed = new Set();
      for (let i = 0; i < 300; i++) {
        (await options.evaluateAll((els) => els.map((e) => Number(e.dataset.value)))).forEach((v) =>
          listed.add(v)
        );
        const atEnd = await options.first().evaluate((el) => {
          let s = el.parentElement;
          while (s && s.scrollHeight <= s.clientHeight) s = s.parentElement;
          if (!s) return true;
          const before = s.scrollTop;
          s.scrollTop += 300;
          return s.scrollTop === before;
        });
        if (atEnd) break;
      }
      expect(listed.size, 'active firms are listed').toBeGreaterThan(0);
      const leaked = inactiveFirms.filter((f) => listed.has(f.firmCd));
      expect(leaked, 'inactive firms must not be listed').toEqual([]);
      await typeAhead.press('Escape');
    });

    await test.step('Step 3: searching an inactive firm by number or name finds nothing', async () => {
      const probe = inactiveFirms[0];
      const probeOption = page.locator(
        `[role="combo-box-list-item"][data-value="${probe.firmCd}"]`
      );
      for (const query of [String(probe.firmCd), probe.name.replace(/^\*+/, '').slice(0, 12)]) {
        await clearTypeAhead();
        await typeAhead.pressSequentially(query, { delay: 30 });
        await page.waitForTimeout(500);
        await expect(probeOption, `"${query}" must not surface firm ${probe.firmCd}`).toHaveCount(
          0
        );
      }
    });
  }
);
