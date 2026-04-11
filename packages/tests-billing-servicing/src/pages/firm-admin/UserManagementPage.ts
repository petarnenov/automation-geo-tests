/**
 * Page Object for Platform One → Firm Admin → User Management.
 *
 * Handles navigation, firm/email search, and Link/Delink actions.
 */

import { expect, type Page } from '@playwright/test';

export class UserManagementPage {
  constructor(private readonly page: Page) {}

  /** Select firm and search by email. */
  async searchByEmail(firmCd: number, email: string): Promise<void> {
    const ta = this.page.locator('#firmCd_typeAhead');
    await ta.click();
    for (let i = 0; i < 80; i++) await ta.press('Backspace');
    await ta.pressSequentially(String(firmCd));
    await this.page.getByText(`(${firmCd})`).first().click();

    await this.page.getByRole('textbox', { name: 'Email Address' }).fill(email);
    await this.page.getByRole('button', { name: 'Search' }).click();

    await expect(this.page.locator('.ag-row').first()).toBeVisible({ timeout: 30_000 });
  }

  /** Click Link action (expand row if needed) and confirm. */
  async linkUser(): Promise<void> {
    // Link is an <a> on child nodes only. Expand the first group row if needed.
    const linkAction = this.page.getByRole('link', { name: 'Link', exact: true }).first();
    if (!(await linkAction.isVisible().catch(() => false))) {
      const expandIcon = this.page.locator('.ag-row').first().locator('.ag-icon-tree-closed');
      if (await expandIcon.isVisible().catch(() => false)) {
        await expandIcon.click();
      }
    }
    await expect(linkAction).toBeVisible({ timeout: 15_000 });
    await linkAction.click();
    await this.page.getByRole('button', { name: 'Submit' }).click();
  }

  /** Click Delink action and confirm. */
  async delinkUser(): Promise<void> {
    await this.page.getByText('Delink').first().click();
    await this.page.getByRole('button', { name: 'Submit' }).click();
  }

  /** Assert that Delink is visible (user is linked). */
  async expectLinked(): Promise<void> {
    await expect(this.page.getByText('Delink').first()).toBeVisible({ timeout: 10_000 });
  }

  /** Assert that Link is visible (user is not linked). */
  async expectNotLinked(): Promise<void> {
    await expect(this.page.getByText('Link', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  }
}
