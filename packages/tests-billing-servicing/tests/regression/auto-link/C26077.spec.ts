/**
 * TestRail C26077 — Platform One: Auto-link new GW Admin user with matching
 *   Site 1 account.
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26077
 *
 * UI smoke: opens Firm Admin → Users for firm 3, clicks Create New User,
 * verifies the modal mounts with GW Admin checkbox + Email field.
 * STOPS before clicking Create (no disposable email pool yet).
 */

import { test, expect } from '@geowealth/e2e-framework/fixtures';

test('@regression @billing-servicing C26077 Auto-link - new GW Admin user with matching Site 1 account', async ({
  tim1Page,
  workerFirm,
}) => {
  test.setTimeout(180_000);

  await test.step(`Open Firm Admin → Users for firm ${workerFirm.firmCd}`, async () => {
    await tim1Page.goto(`/react/indexReact.do#platformOne/firmAdmin/users/${workerFirm.firmCd}`);
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
