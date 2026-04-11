/**
 * Page Object for Platform One → Firm Admin → Users.
 *
 * The Create New User modal is a FormBuilder form (verified in
 * `~/geowealth/WebContent/react/app/src/pages/PlatformOne/pages/FirmAdmin/UsersAndAccess/Components/AddEditModal/AddEditUserForm.js`)
 * with these field ids (from `UsersAndAccess/consts.js`):
 *
 *   - `contactTypeCd`        (comboBox)
 *   - `firstName`            (text)
 *   - `lastName`             (text)
 *   - `username`             (text)
 *   - `emailAddress`         (text)
 *   - `password` / `confirmPassword` (password)
 *   - `customWhitelabelCode` (comboBox, disabled for GW Admin)
 *   - `gwAdminFlag`          (checkbox)
 *   - `mfaEnabledFlag`       (comboBox, default Enabled)
 *   - `defaultRoleCd`        (comboBox, required)
 *   - `rolesCds`              (checkboxes)
 *   - `sendInviteFlag`       (checkbox)
 *
 * Every text field is a React controlled component wired through
 * `FormBuilder/Core/InputCore.js` — writes through
 * `Locator.fill()` can slip past React's value tracker and leave
 * the form state empty. The Create button then submits with
 * whatever survived in React state, which may be nothing. This
 * POM goes through the framework `TextInput` / `ComboBox` POMs
 * which use React's native value setter and are safe against
 * that failure mode.
 */

import { expect, type Page } from '@playwright/test';
import { ComboBox } from '@geowealth/e2e-framework/components/ComboBox';
import { Modal } from '@geowealth/e2e-framework/components/Modal';
import { TextInput } from '@geowealth/e2e-framework/components/TextInput';
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
   * Open the Create New User modal, fill every required field
   * through the React-aware POMs, and submit. Order matters:
   * Contact Type first (gates subsequent field rendering), then
   * text fields, then GW Admin flag, then Default Role combo,
   * then Create.
   */
  async createUser(fields: CreateUserFields): Promise<void> {
    await this.page.getByRole('button', { name: 'Create New User' }).click();
    await this.modal.waitForOpen();

    // Wait for the First Name text input to render so the form
    // is ready for input. InputCore renders `id="firstNameField"`.
    const firstNameLocator = this.page.locator('#firstNameField');
    await firstNameLocator.waitFor({ state: 'visible', timeout: 10_000 });

    // Text fields — go through the React-aware setter path.
    const firstName = new TextInput(this.page, 'firstName');
    const lastName = new TextInput(this.page, 'lastName');
    const username = new TextInput(this.page, 'username');
    const emailAddress = new TextInput(this.page, 'emailAddress');

    await firstName.setValue(fields.firstName);
    if (fields.lastName) {
      await lastName.setValue(fields.lastName);
    }
    await username.setValue(fields.username);
    await emailAddress.setValue(fields.email);

    // GW Admin — before Default Role. The checkbox wrapper has
    // id="gwAdminFlag" per the FormBuilder FieldSet id convention;
    // the actual clickable child is the `#checkbox` element.
    if (fields.gwAdmin) {
      await this.page.locator('#gwAdminFlag #checkbox').click();
    }

    // Default Role combo — the FormBuilder ComboBox variant.
    const defaultRole = new ComboBox(this.page, 'defaultRoleCd');
    await defaultRole.setValue('Admins');

    // Short settle for React form validation (debounced). The
    // Create button is disabled until all required fields are
    // valid; the debounce fires on the most recent keystroke.
    await this.page.waitForTimeout(300);
    await this.modal.clickButton('Create');
    await this.modal.waitForClose({ timeout: 30_000 });

    // Users list ready again.
    await expect(this.page.getByRole('button', { name: 'Create New User' })).toBeVisible({
      timeout: 30_000,
    });
  }
}
