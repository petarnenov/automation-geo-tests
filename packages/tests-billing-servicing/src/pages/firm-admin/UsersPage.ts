/**
 * Page Object for Platform One → Firm Admin → Users.
 *
 * Assumes the caller has already navigated to the right firm via
 * `PlatformOnePage.goToUsersForFirm(firmCd)` — the Users page
 * supports both a typeahead firm picker and a direct URL path,
 * and every in-flight spec uses the direct path.
 *
 * The Create New User modal is a FormBuilder form (verified in
 * `~/geowealth/WebContent/react/app/src/pages/PlatformOne/pages/FirmAdmin/UsersAndAccess/Components/AddEditModal/AddEditUserForm.js`)
 * with these field ids (from `UsersAndAccess/consts.js`):
 *
 *   - `contactTypeCd`        (comboBox, has default)
 *   - `firstName`            (text, required)
 *   - `lastName`             (text, optional)
 *   - `username`             (text, required)
 *   - `emailAddress`         (text)
 *   - `password` / `confirmPassword` (password, disabled for GW Admin)
 *   - `customWhitelabelCode` (comboBox, disabled for GW Admin)
 *   - `gwAdminFlag`          (checkbox)
 *   - `mfaEnabledFlag`       (comboBox, default Enabled)
 *   - `defaultRoleCd`        (comboBox, required)
 *   - `rolesCds`             (checkboxes)
 *   - `sendInviteFlag`       (checkbox)
 *
 * Every text field is a React controlled component wired through
 * `FormBuilder/Core/InputCore.js` — writes via `Locator.fill()`
 * can slip past React's value tracker and leave the form state
 * empty, so this POM uses the framework `TextInput` / `ComboBox`
 * POMs which go through React's native value setter path.
 *
 * ## Assertions and waits
 *
 * This POM never calls `expect(...)`. Internal preconditions use
 * `locator.waitFor({ state })`, and test-facing state getters
 * return Locators so callers can drive assertions via
 * `await expect(usersPage.someLocator()).toBeVisible()`.
 */

import type { Page } from '@playwright/test';
import { Checkbox } from '@geowealth/e2e-framework/components/Checkbox';
import { ComboBox } from '@geowealth/e2e-framework/components/ComboBox';
import { FormBuilder } from '@geowealth/e2e-framework/components/FormBuilder';
import { Modal } from '@geowealth/e2e-framework/components/Modal';
import { TextInput } from '@geowealth/e2e-framework/components/TextInput';

const CREATE_USER_TIMEOUT = 30_000;
const DEFAULT_WAIT = 10_000;
const CREATE_UPDATE_USER_ENDPOINT = /\/platformOne\/createUpdateUser\.do/;

export interface CreateUserFields {
  /** Required — first name, stored as-is after Text field trim. */
  firstName: string;
  /** Required — username, stored as-is after trim. */
  username: string;
  /** Required — email address; must be valid per FormBuilder's `isValidEmail`. */
  email: string;
  /** Optional — last name. Omitted → field left empty. */
  lastName?: string;
  /** Optional — mark the user as GW Admin. Default: false. */
  gwAdmin?: boolean;
  /** Optional — role name to pick in the Default Role combo. Default: 'Admins'. */
  defaultRole?: string;
}

export class UsersPage {
  private readonly modal: Modal;

  constructor(private readonly page: Page) {
    this.modal = new Modal(page);
  }

  // ────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────

  /**
   * Open the Create New User modal, fill every relevant field via
   * the React-aware POMs, and submit. Waits for the backend
   * response to `createUpdateUser.do` so callers know the user
   * was actually persisted, not just that the modal happened to
   * close.
   *
   * `defaultRole` defaults to `'Admins'` because the form's
   * Default Role combo is required and has no auto-selected
   * value on Create — the caller must explicitly pick one.
   */
  async createUser(fields: CreateUserFields): Promise<void> {
    await this.openCreateUserModal();
    await this.applyUserFormFields({
      ...fields,
      defaultRole: fields.defaultRole ?? 'Admins',
    });
    await this.submitUserForm('Create');
  }

  /**
   * Open the Edit User modal for the user matching `username` and
   * apply the given field updates. Every field in `updates` is
   * optional — omitted fields keep their current value. Submits
   * via the "Save" button and waits for the
   * `createUpdateUser.do` response so the caller knows the
   * backend committed the edit.
   *
   * The grid is ag-grid virtualised, so we filter by the Username
   * column first to make sure the target row is actually rendered
   * before trying to click its Edit button.
   */
  async editUser(username: string, updates: Partial<CreateUserFields>): Promise<void> {
    await this.filterGridByUsername(username);

    const row = this.userRow(username);
    await row.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });

    const editBtn = row.getByRole('button', { name: 'Edit', exact: true });
    await editBtn.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await editBtn.click();

    await this.modal.waitForOpen();
    await this.firstNameField().waitFor({ state: 'visible', timeout: DEFAULT_WAIT });

    await this.applyUserFormFields(updates);
    await this.submitUserForm('Save');
  }

  // ────────────────────────────────────────────────────────────────
  // Private — form helpers shared by createUser / editUser
  // ────────────────────────────────────────────────────────────────

  /**
   * Apply the non-empty fields from a `CreateUserFields`-shaped
   * object to the currently-open Create/Edit User modal. Skips
   * undefined fields so `editUser` can update just the ones the
   * caller cares about. Every text field goes through the
   * `TextInput` POM (React native value setter), the GW Admin
   * checkbox through `Checkbox.setChecked`, and the Default Role
   * combo through the `ComboBox` POM.
   */
  private async applyUserFormFields(fields: Partial<CreateUserFields>): Promise<void> {
    if (fields.firstName !== undefined) {
      await new TextInput(this.page, 'firstName').setValue(fields.firstName);
    }
    if (fields.lastName !== undefined) {
      await new TextInput(this.page, 'lastName').setValue(fields.lastName);
    }
    if (fields.username !== undefined) {
      await new TextInput(this.page, 'username').setValue(fields.username);
    }
    if (fields.email !== undefined) {
      await new TextInput(this.page, 'emailAddress').setValue(fields.email);
    }
    if (fields.gwAdmin !== undefined) {
      await new Checkbox(this.page, 'gwAdminFlag').setChecked(fields.gwAdmin);
    }
    if (fields.defaultRole !== undefined) {
      await new ComboBox(this.page, 'defaultRoleCd').setValue(fields.defaultRole);
    }
  }

  /**
   * Click the submit button (`'Create'` for new users, `'Save'`
   * for edits), wait for the `createUpdateUser.do` backend
   * response, then wait for the modal to close.
   *
   * Calls `FormBuilder.awaitValidationDebounce` first — the
   * submit button has no DOM sentinel that tracks FormBuilder's
   * validation debounce, so clicking straight after the last
   * setValue triggers the form's onSubmit handler against a
   * stale `isFormValid` state. See `FormBuilder.ts` for the
   * full rationale; this POM just delegates to the framework.
   */
  private async submitUserForm(buttonName: 'Create' | 'Save'): Promise<void> {
    await FormBuilder.awaitValidationDebounce(this.page);

    // Pair the click with the backend response. A failed submit
    // surfaces as a clean network timeout, distinct from the
    // opaque "modal never closed" waitForClose failure.
    await Promise.all([
      this.page.waitForResponse(
        (resp) => CREATE_UPDATE_USER_ENDPOINT.test(resp.url()) && resp.status() === 200,
        { timeout: CREATE_USER_TIMEOUT }
      ),
      this.modal.clickButton(buttonName),
    ]);
    await this.modal.waitForClose({ timeout: CREATE_USER_TIMEOUT });

    // Users grid ready for the next interaction.
    await this.createNewUserButton().waitFor({
      state: 'visible',
      timeout: CREATE_USER_TIMEOUT,
    });
  }

  /**
   * Type the given username into the Users grid's Username column
   * header filter so the target row is rendered inside the
   * ag-grid virtualisation window. Used before clicking the row's
   * Edit button in `editUser`.
   */
  private async filterGridByUsername(username: string): Promise<void> {
    const filter = this.page.getByRole('textbox', { name: 'Username Filter Input' });
    await filter.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await filter.fill(username);
  }

  // ────────────────────────────────────────────────────────────────
  // Locators (for test-facing assertions)
  // ────────────────────────────────────────────────────────────────

  /**
   * Locator for the "Create New User" button on the Users grid.
   * Use it in tests via `await expect(usersPage.createNewUserButton()).toBeVisible()`.
   */
  createNewUserButton() {
    return this.page.getByRole('button', { name: 'Create New User' });
  }

  /** Locator for a Users grid data row containing `username`. */
  userRow(username: string) {
    return this.page.locator('.ag-row').filter({ hasText: username }).first();
  }

  // ────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────

  private firstNameField() {
    return this.page.locator('#firstNameField');
  }

  /**
   * Open the Create New User modal and wait for the portal content
   * to be visible.
   */
  private async openCreateUserModal(): Promise<void> {
    await this.createNewUserButton().click();
    await this.modal.waitForOpen();
  }

}
