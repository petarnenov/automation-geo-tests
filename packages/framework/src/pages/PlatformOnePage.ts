/**
 * `PlatformOnePage` — Page Object for Platform One sub-page navigation.
 *
 * Uses direct URL navigation to each sub-page instead of sidebar clicks.
 * This mirrors the pattern used by all other Platform One specs (C26078,
 * C26079, etc.) and is more robust than sidebar traversal, which is
 * brittle against SPA re-renders and accordion state.
 */

import { expect, type Page } from '@playwright/test';

export class PlatformOnePage {
  constructor(private readonly page: Page) {}

  /**
   * Navigate directly to Firm Admin → Users and wait for the page to load.
   * Pass `firmCd` to land directly on a specific firm's user list (skips typeahead).
   */
  async goToUsers(firmCd?: number): Promise<void> {
    const path = firmCd
      ? `/react/indexReact.do#platformOne/firmAdmin/users/${firmCd}`
      : '/react/indexReact.do#platformOne/firmAdmin/users';
    await this.page.goto(path);
    if (firmCd) {
      await expect(this.page.getByRole('button', { name: 'Create New User' })).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(this.page.locator('#selectFirm_typeAhead')).toBeVisible({ timeout: 30_000 });
    }
  }

  /** Navigate directly to Firm Admin → User Management and wait for the page to load. */
  async goToUserManagement(): Promise<void> {
    await this.page.goto('/react/indexReact.do#platformOne/firmAdmin/userManagement');
    await expect(this.page.locator('#firmCd_typeAhead')).toBeVisible({ timeout: 30_000 });
  }
}
