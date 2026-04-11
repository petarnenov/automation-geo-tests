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
   */
  async createUser(fields: CreateUserFields): Promise<void> {
    await this.openCreateUserModal();

    // Wait for the first form field to mount so we know the modal
    // content is rendered — `modal.waitForOpen` only guarantees the
    // container is visible, not that the form body is hydrated.
    await this.firstNameField().waitFor({ state: 'visible', timeout: DEFAULT_WAIT });

    // Text fields — go through React's native value setter.
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

    if (fields.gwAdmin) {
      const gwAdminFlag = new Checkbox(this.page, 'gwAdminFlag');
      await gwAdminFlag.check();
    }

    const defaultRole = new ComboBox(this.page, 'defaultRoleCd');
    await defaultRole.setValue(fields.defaultRole ?? 'Admins');

    // FormBuilder runs a real setTimeout-based debounce on its
    // form validation state (~300 ms) after every field change;
    // the Create button is DOM-enabled before that debounce
    // settles, so clicking too early submits the form with
    // stale internal state and the backend never sees the
    // request. No DOM signal tracks the debounce, so a small
    // wait is the only correct option here.
    //
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await this.page.waitForTimeout(500);

    // Pair the click with the create-user backend response so a
    // failed submit surfaces as a network timeout (with our error
    // context) instead of an opaque modal-still-open timeout. If
    // React form validation blocks the click, no request fires
    // and the waitForResponse times out — we can see that
    // distinctly from a late response.
    await Promise.all([
      this.page.waitForResponse(
        (resp) => CREATE_UPDATE_USER_ENDPOINT.test(resp.url()) && resp.status() === 200,
        { timeout: CREATE_USER_TIMEOUT }
      ),
      this.modal.clickButton('Create'),
    ]);
    await this.modal.waitForClose({ timeout: CREATE_USER_TIMEOUT });

    // Wait for the Users grid to be ready for the next interaction.
    await this.createNewUserButton().waitFor({
      state: 'visible',
      timeout: CREATE_USER_TIMEOUT,
    });
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
