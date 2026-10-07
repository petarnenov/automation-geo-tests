// @ts-check
/**
 * AIO GEO-TC-11788 (C18414) — Billing Specifications page availability.
 *
 * Covers: page + Select Firm combo; firm list ordering (active firms first,
 * inactive at the end, each group by firm number); an active firm shows the
 * grid with the "Create New Billing Spec" link and "Create from Upload"
 * button; an inactive firm hides both.
 *
 * Source (BillingSpecs/pages/BillingSpecs):
 *   - BillingSpecsSelectFirm: comboBox `selectCompanyId`, options from
 *     /bo/getFirms.do?inactive=true, ordered by addFirmOptionsOrder
 *     (inactive last; ties keep firmCd order). Each option carries
 *     data-value=<firmCd> and data-sort=<order>.
 *   - BillingSpecsActions: returns null for an inactive firm.
 *   - The option list is virtualised (~20 rows rendered), so it is scrolled
 *     to read every option.
 *
 * Read-only: nothing is created or saved; the inactive firm is only viewed.
 * The grid's visible columns come from tim1's persisted grid view, so the
 * "3 default columns" expectation is checked as Spec Name + Billing Bucket
 * headers plus Number of Accounts being an available column.
 */

const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const SPECS_URL = '/react/indexReact.do#platformOne/billingCenter/specifications';
const ACTIVE_FIRM = 1;

test(
  '@regression C18414 Billing Specifications page availability',
  {
    annotation: [
      { type: 'aio', description: 'GEO-TC-11788' },
      {
        type: 'aio-deviation',
        description:
          "Default column set not asserted strictly: visible columns follow tim1's persisted grid view",
      },
    ],
  },
  async ({ page }) => {
    test.setTimeout(240_000);

    const typeAhead = page.locator('#selectCompanyId_typeAhead');
    const options = page.locator('[role="combo-box-list-item"]');

    /** Scroll the virtualised list and return [{firmCd, sort}] for every option. */
    const readAllOptions = async () => {
      const seen = new Map();
      for (let i = 0; i < 300; i++) {
        const rows = await options.evaluateAll((els) =>
          els.map((e) => [Number(e.dataset.value), Number(e.dataset.sort)])
        );
        rows.forEach(([firmCd, sort]) => seen.set(firmCd, sort));
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
      return [...seen.entries()]
        .map(([firmCd, sort]) => ({ firmCd, sort }))
        .sort((a, b) => a.sort - b.sort);
    };

    /** Open the combo and click the option for firmCd, scrolling it into the window. */
    const pickFirm = async (firmCd) => {
      await typeAhead.click();
      await expect(options.first()).toBeVisible({ timeout: 10_000 });
      const option = page.locator(`[role="combo-box-list-item"][data-value="${firmCd}"]`);
      for (let i = 0; i < 300 && !(await option.count()); i++) {
        await options.first().evaluate((el) => {
          let s = el.parentElement;
          while (s && s.scrollHeight <= s.clientHeight) s = s.parentElement;
          if (s) s.scrollTop += 300;
        });
      }
      await option.evaluate((el) => /** @type {HTMLElement} */ (el).click());
      await expect(page).toHaveURL(new RegExp(`/specifications/${firmCd}$`), { timeout: 15_000 });
    };

    await loginPlatformOneAdmin(page);

    let inactiveFirms = [];

    await test.step('Step 1-2: Billing Specification page loads with a Select Firm combo', async () => {
      const firmsResp = page.waitForResponse((r) => r.url().includes('/bo/getFirms.do'));
      await page.goto(SPECS_URL);
      const body = await (await firmsResp).json();
      inactiveFirms = (body.rows || []).filter((f) => f.inactiveFirm).map((f) => Number(f.id));
      await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText('Select Firm', { exact: true })).toBeVisible();
      await expect(typeAhead).toBeVisible();
    });

    await test.step('Step 3: firm list has active firms first, inactive last, each by firm number', async () => {
      await typeAhead.click();
      await expect(options.first()).toBeVisible({ timeout: 10_000 });
      const all = await readAllOptions();
      await typeAhead.press('Escape');

      const inactive = new Set(inactiveFirms);
      const active = all.filter((o) => !inactive.has(o.firmCd));
      const inactiveListed = all.filter((o) => inactive.has(o.firmCd));
      expect(active.length, 'active firms listed').toBeGreaterThan(0);

      if (inactiveListed.length) {
        const lastActive = Math.max(...active.map((o) => o.sort));
        const firstInactive = Math.min(...inactiveListed.map((o) => o.sort));
        expect(lastActive, 'every active firm precedes every inactive firm').toBeLessThan(
          firstInactive
        );
      }
      const byNumber = (group) => group.map((o) => o.firmCd);
      expect(byNumber(active)).toEqual([...byNumber(active)].sort((a, b) => a - b));
      expect(byNumber(inactiveListed)).toEqual([...byNumber(inactiveListed)].sort((a, b) => a - b));
    });

    await test.step('Step 4: an active firm shows the grid, Create New Billing Spec and Create from Upload', async () => {
      await pickFirm(ACTIVE_FIRM);
      await expect(page.locator('.ag-root').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Create New Billing Spec', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Create from Upload', exact: true })
      ).toBeVisible();
      await expect(page.getByRole('columnheader', { name: /^SPEC NAME$/i }).first()).toBeVisible();
      await expect(
        page.getByRole('columnheader', { name: /^BILLING BUCKET$/i }).first()
      ).toBeVisible();

      // Number of Accounts may be hidden in tim1's saved view; it must at
      // least be an available column. Close the overlay without confirming.
      await page.locator('span#customizeColumns').click();
      await expect(page.getByText('Customize Columns', { exact: true }).first()).toBeVisible();
      await expect(page.locator('label[for="numberOfAccountsField"]')).toHaveText(
        'Number of Accounts'
      );
      await page.getByText('Cancel', { exact: true }).last().click();
      await expect(page.getByText('Customize Columns', { exact: true })).toBeHidden();
    });

    await test.step('Step 5: an inactive firm hides Create New Billing Spec and Create from Upload', async () => {
      test.skip(!inactiveFirms.length, 'environment has no inactive firms');
      await pickFirm(inactiveFirms[0]);
      await expect(page.locator('.ag-root').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Create New Billing Spec', { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Create from Upload', exact: true })
      ).toHaveCount(0);
    });
  }
);
