import { test, expect } from '@playwright/test';

test('manual: fill form, you click Create', async ({ browser }) => {
  test.setTimeout(600_000);

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Login
  await page.goto('https://qa4.geowealth.com/');
  await page.getByRole('textbox', { name: 'username' }).fill('tim1');
  await page.getByRole('textbox', { name: 'password' }).fill('c0w&ch1k3n');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });

  // Navigate to Users
  await page.locator('#hamburgerVertical').click();
  await page.getByRole('heading', { name: 'Operations' }).click();
  await page.getByText('Firm Admin').click();
  await page.getByRole('link', { name: 'Users', exact: true }).click();

  // Select firm 1
  await page.locator('#selectFirm_typeAhead').click();
  await page.locator('#selectFirm_typeAhead').fill('1');
  await page.getByText('(1) GeoWealth Management LLC').click();

  // Open Create New User
  await page.getByRole('button', { name: 'Create New User' }).click();

  // Fill form
  await page.locator('#contactTypeCdDiv').getByText('Select').click();
  await page.getByText('Individual').click();
  await page.getByRole('textbox', { name: '* First Name' }).fill('TestManual1');
  await page.getByRole('textbox', { name: 'Last Name', exact: true }).fill('TestManual1');
  await page.getByRole('textbox', { name: '* Username' }).fill(`manual-${Date.now()}`);
  await page.getByRole('textbox', { name: 'Email Address' }).fill(`manual-${Date.now()}@test.com`);
  await page.locator('#defaultRoleCdDiv').click();
  await page.getByText('Admins', { exact: true }).click();
  await page.locator('#checkbox > use').first().click();

  // --- STOP HERE: form is filled, YOU scroll and click Create ---
  console.log('Form filled. Scroll down in the modal and click Create.');
  await page.pause();
});
