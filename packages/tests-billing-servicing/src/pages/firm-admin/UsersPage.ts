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
import { Checkboxes } from '@geowealth/e2e-framework/components/Checkboxes';
import { ComboBox } from '@geowealth/e2e-framework/components/ComboBox';
import { FormBuilder } from '@geowealth/e2e-framework/components/FormBuilder';
import { Modal } from '@geowealth/e2e-framework/components/Modal';
import { Password } from '@geowealth/e2e-framework/components/Password';
import { TextInput } from '@geowealth/e2e-framework/components/TextInput';

const CREATE_USER_TIMEOUT = 30_000;
const DEFAULT_WAIT = 10_000;
const CREATE_UPDATE_USER_ENDPOINT = /\/platformOne\/createUpdateUser\.do/;

export interface CreateUserFields {
  /** Required — first name, stored as-is after Text field trim. */
  firstName: string;
  /** Required — username, stored as-is after trim. */
  username: string;
  /**
   * Optional — email address. When provided must be valid per
   * FormBuilder's `isValidEmail` or the form submit stays
   * disabled. Omitted → the field is left untouched, which the
   * form accepts because Email Address is not marked `required`
   * in the AddEditUserForm field config (see
   * `~/geowealth/.../AddEditUserForm.js`).
   */
  email?: string;
  /** Optional — last name. Omitted → field left empty. */
  lastName?: string;
  /** Optional — mark the user as GW Admin. Default: false. */
  gwAdmin?: boolean;
  /** Optional — role name to pick in the Default Role combo. Default: 'Admins'. */
  defaultRole?: string;
  /**
   * Optional — password for non-GW-Admin users. The Password /
   * Confirm Password fields are DISABLED when `gwAdmin: true`
   * and REQUIRED when `gwAdmin: false`. Must satisfy the form's
   * validation regex: at least 8 chars with uppercase, lowercase,
   * digit, and special character. If omitted while creating a
   * non-GW-Admin user, `createUser` falls back to
   * `DEFAULT_NON_GW_ADMIN_PASSWORD`.
   */
  password?: string;
}

/**
 * Strong-enough password used as the `createUser` fallback for
 * non-GW-Admin users. Satisfies the FormBuilder regex
 * `^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,}$`.
 */
const DEFAULT_NON_GW_ADMIN_PASSWORD = 'TestPass123!';

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
   * Defaults applied here:
   *
   *   - `defaultRole` defaults to `'Admins'` — the Default Role
   *     combo is required on Create.
   *   - `password` defaults to `DEFAULT_NON_GW_ADMIN_PASSWORD`
   *     **only when `gwAdmin` is explicitly `false`**. GW Admin
   *     users have the password fields disabled by React, so
   *     passing a password to them would no-op; non-GW-Admin
   *     users require a strong password to submit.
   */
  async createUser(fields: CreateUserFields): Promise<void> {
    await this.openCreateUserModal();
    const passwordNeeded = fields.gwAdmin === false;
    await this.applyUserFormFields({
      ...fields,
      defaultRole: fields.defaultRole ?? 'Admins',
      password: passwordNeeded
        ? (fields.password ?? DEFAULT_NON_GW_ADMIN_PASSWORD)
        : fields.password,
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
    // GW Admin flag must be applied BEFORE password — the
    // password / confirmPassword fields are React-disabled while
    // `gwAdmin` is true, and flipping the flag to false is what
    // un-disables them.
    if (fields.gwAdmin !== undefined) {
      const gwAdminFlag = new Checkbox(this.page, 'gwAdminFlag');
      if (fields.gwAdmin === false) {
        // useState default is already `false` so `setChecked(false)`
        // would idempotently no-op, but `handleGWAdminChange` never
        // firing leaves the form in a subtly-uninitialised state
        // that keeps SubmitButton's isFormValid false. Force a
        // toggle on then off so the handler executes at least once.
        await gwAdminFlag.toggle();
        await gwAdminFlag.toggle();
      } else {
        await gwAdminFlag.setChecked(fields.gwAdmin);
      }
    }
    if (fields.password !== undefined) {
      // Wait for React to re-render the password fields as
      // enabled after the gwAdmin flip.
      await this.page
        .locator('#passwordField:not([disabled])')
        .waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
      await new Password(this.page, 'password').setValue(fields.password);
      await new Password(this.page, 'confirmPassword').setValue(fields.password);
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

  /**
   * Filter the Users grid by the given username via the column
   * header filter input so the target row is inside ag-grid's
   * virtualisation window, then return a Locator for the row.
   *
   * Without the filter, large firms (firm 1 especially) can have
   * thousands of users and the freshly-created row is far outside
   * the rendered window — `userRow(username)` would never resolve
   * even though the backend committed the insert. Use this when
   * you need to assert `await expect(...).toBeVisible()` on a
   * just-created user.
   */
  async findUserRow(username: string) {
    await this.filterGridByUsername(username);
    return this.userRow(username);
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
