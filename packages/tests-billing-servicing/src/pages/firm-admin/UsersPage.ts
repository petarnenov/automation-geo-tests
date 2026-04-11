/**
 * Page Object for Platform One → Firm Admin → Users.
 *
 * The Create New User modal renders in a React Portal at `#modal`.
 * GW Admin checkbox: `#gwAdminFlag #checkbox`
 * Default Role combo: `#defaultRoleCdDiv [role="comboBoxHeader"]`
 * Create button: `getByRole('button', { name: 'Create', exact: true })`
 */

import { expect, type Page } from '@playwright/test';
import { ComboBox } from '@geowealth/e2e-framework/components/ComboBox';
import { Modal } from '@geowealth/e2e-framework/components/Modal';
import type { FirmTypeAheadTarget } from '@geowealth/e2e-framework/components/TypeAhead';

export interface CreateUserFields {
  firstName: string;
  username: string;
  email: string;
  gwAdmin?: boolean;
  lastName?: string;
}

export class UsersPage {
  private readonly modal: Modal;

  constructor(private readonly page: Page) {
    this.modal = new Modal(page);
  }

  /** Select a firm via the typeAhead on the Users page. */
  async selectFirm(target: FirmTypeAheadTarget): Promise<void> {
    const ta = this.page.locator('#selectFirm_typeAhead');
    await ta.click();
    for (let i = 0; i < 80; i++) await ta.press('Backspace');
    await ta.pressSequentially(target.firmName);
    await this.page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: new RegExp(`\\(${target.firmCd}\\)`) })
      .first()
      .evaluate((el: Element) => (el as HTMLElement).click());
    await expect(this.page.getByRole('button', { name: 'Create New User' })).toBeVisible({
      timeout: 30_000,
    });
  }

  /**
   * Open the Create New User modal, fill fields, and submit.
   * Order: Contact Type → text fields → GW Admin → Default Role → Create.
   */
  async createUser(fields: CreateUserFields): Promise<void> {
    await this.page.getByRole('button', { name: 'Create New User' }).click();
    await this.modal.waitForOpen();

    const mc = this.modal.container();

    // Wait for the form to fully render
    await mc.getByRole('textbox', { name: '* First Name' }).waitFor({ state: 'visible', timeout: 10_000 });

    // Text fields
    await mc.getByRole('textbox', { name: '* First Name' }).fill(fields.firstName);

    if (fields.lastName) {
      await mc.getByRole('textbox', { name: 'Last Name', exact: true }).fill(fields.lastName);
    }

    await mc.getByRole('textbox', { name: '* Username' }).fill(fields.username);
    await mc.getByRole('textbox', { name: 'Email Address' }).fill(fields.email);

    // GW Admin — before Default Role
    if (fields.gwAdmin) {
      await mc.locator('#gwAdminFlag #checkbox').click();
    }

    // Default Role → Admins (framework ComboBox handles both variants)
    const defaultRole = new ComboBox(this.page, 'defaultRoleCd');
    await defaultRole.setValue('Admins');

    // Wait for React form validation debounce (50ms) to settle after
    // combo selection before attempting to submit.
    await this.page.waitForTimeout(300);
    await this.modal.clickButton('Create');
    await this.modal.waitForClose({ timeout: 30_000 });

    // Wait for Users list to be ready
    await expect(this.page.getByRole('button', { name: 'Create New User' })).toBeVisible({
      timeout: 30_000,
    });
  }
}
