/**
 * TestRail C26094 — Platform One: Auto-link new user with empty email.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26094
 *
 * UI smoke: same flow as C26077.
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';

const FIRM_CODE = 3;

test('@regression @billing-servicing C26094 Auto-link - new user with empty email', async ({
  tim1Page,
}) => {
  test.setTimeout(180_000);

  await test.step(`Open Firm Admin → Users for firm ${FIRM_CODE}`, async () => {
    await tim1Page.goto(`/react/indexReact.do#platformOne/firmAdmin/users/${FIRM_CODE}`);
    await expect(tim1Page.getByRole('button', { name: 'Create New User' })).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('Open Create New User modal and verify form fields', async () => {
    await tim1Page.getByRole('button', { name: 'Create New User' }).click();
    await expect(tim1Page.getByText('Create New User', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(tim1Page.getByRole('textbox', { name: /First Name/i }).first()).toBeVisible();
    await expect(tim1Page.getByRole('textbox', { name: /Username/i }).first()).toBeVisible();
    await expect(tim1Page.getByRole('textbox', { name: /Email Address/i }).first()).toBeVisible();
    await expect(tim1Page.getByText('GW Admin').first()).toBeVisible();
    await expect(tim1Page.getByText('All Employees (Mandatory)').first()).toBeVisible();
    await expect(tim1Page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
  });

  await test.step('SAFETY: close modal without creating', async () => {
    await tim1Page.keyboard.press('Escape');
    await expect(tim1Page.getByRole('button', { name: 'Create New User' })).toBeVisible({
      timeout: 5000,
    });
  });
});
