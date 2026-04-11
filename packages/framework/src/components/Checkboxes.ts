/**
 * `Checkboxes` Component class.
 *
 * Wraps the qa SPA's FormBuilder `Checkboxes` field — the multi-
 * checkbox group renderer at
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Fields/Checkboxes.js`.
 * It is a different field from the singular `Checkbox.js`: the group
 * builds N child Checkbox instances inside a `Group` field and
 * exposes the collection as one form value.
 *
 * Use this POM when the form passes an array of checkbox configs
 * under one `id` / `fieldName`. Use the singular `Checkbox` POM when
 * the form passes one boolean.
 *
 * ## Why a separate POM
 *
 * Two specifics make `Checkboxes` non-trivial to drive through the
 * singular `Checkbox` POM directly:
 *
 *   1. **Reversed id composition.** Each child checkbox config has
 *      its own `id`, and `Checkboxes.buildCheckboxes()` rewrites it
 *      to `${childId}_${groupId}` — child first, group second. The
 *      inner Checkbox component then renders the input as
 *      `${childId}_${groupId}Field`. Hand-deriving that at every
 *      call site is a footgun: the natural guess is
 *      `${groupId}_${childId}Field`, which silently misses every
 *      checkbox in the group.
 *
 *   2. **Optional Select All sibling.** When the field is rendered
 *      with `withSelectAll`, an extra Checkbox is mounted with id
 *      `${fieldName}_SelectAll` (input `${fieldName}_SelectAllField`).
 *      It is NOT inside the Group `config` — it sits as a sibling
 *      above and uses `selectAllCheckboxes` / `deselectAllCheckboxes`
 *      to flip all the children's `isChecked` props at once. The POM
 *      addresses it via the `fieldName`-derived id.
 *
 * ## FormBuilder Checkboxes DOM structure
 *
 *     <Checkbox id="${fieldName}_SelectAll" />        ← optional select-all
 *     <section id="${groupId}" data-module="group">    ← Group field wrapper
 *       …
 *       <section id="${childId}_${groupId}" data-module="checkbox">
 *         <input id="${childId}_${groupId}Field" type="checkbox" … />
 *       </section>
 *       …repeat per child…
 *     </section>
 *
 * Verified in
 * `~/geowealth/WebContent/react/app/src/modules/FormBuilder/Fields/Checkboxes.js`
 * and the singular `Checkbox.js`.
 *
 * ## Construction
 *
 *   - **FormBuilder** — `new Checkboxes(page, 'permissions')`. POM
 *     derives child input ids as `#${childKey}_permissionsField` and
 *     the group error message at `#permissionsError`.
 *
 *   - **FormBuilder with custom field name** — pass `fieldName` as a
 *     third argument when the form definition uses a different
 *     `fieldName` than `id`. Defaults to `fieldName === id`, which
 *     covers the common case. Required only when reading
 *     `selectAll()` / `deselectAll()` against a group whose
 *     `fieldName` differs from `id`.
 *
 *   - **Scoped** — pass a Locator pointing at any ancestor that
 *     uniquely scopes the group. The POM resolves child checkboxes
 *     by their input id within that scope. No `errorMessage()`
 *     accessor in this mode.
 */

import type { Page, Locator } from '@playwright/test';

import { Checkbox } from './Checkbox';

export class Checkboxes {
  private readonly page: Page;
  private readonly groupId: string | null;
  private readonly fieldName: string | null;
  private readonly root: Locator | null;

  /**
   * FormBuilder variant — `page` + group id (and optional fieldName
   * when it differs from the id, which is rare). The POM derives
   * `#${childKey}_${groupId}Field` per child input and
   * `#${fieldName}_SelectAllField` for the optional select-all
   * sibling.
   *
   * @example
   *   const perms = new Checkboxes(page, 'permissions');
   *   await perms.check('read');
   *   await perms.check('write');
   *   await perms.selectAll();
   */
  constructor(page: Page, groupId: string, fieldName?: string);
  /**
   * Scoped variant — pass a Locator that uniquely contains the
   * checkbox group. Children are addressed by id within the scope.
   */
  constructor(root: Locator);
  constructor(pageOrRoot: Page | Locator, groupId?: string, fieldName?: string) {
    if (typeof groupId === 'string') {
      this.page = pageOrRoot as Page;
      this.groupId = groupId;
      this.fieldName = fieldName ?? groupId;
      this.root = null;
    } else {
      this.root = pageOrRoot as Locator;
      this.page = (pageOrRoot as Locator).page();
      this.groupId = null;
      this.fieldName = null;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────

  /**
   * Set the child checkbox identified by `childKey` to `value`.
   * No-op when already in the target state. Delegates to the
   * singular `Checkbox` POM, which uses the React-aware
   * `evaluate(el => el.click())` toggle path.
   */
  async setChecked(childKey: string, value: boolean): Promise<void> {
    await this.child(childKey).setChecked(value);
  }

  /** Convenience for `setChecked(childKey, true)`. */
  async check(childKey: string): Promise<void> {
    await this.child(childKey).check();
  }

  /** Convenience for `setChecked(childKey, false)`. */
  async uncheck(childKey: string): Promise<void> {
    await this.child(childKey).uncheck();
  }

  /** True if the child checkbox identified by `childKey` is currently checked. */
  async isChecked(childKey: string): Promise<boolean> {
    return this.child(childKey).isChecked();
  }

  /**
   * Click the optional Select All sibling checkbox, which the field
   * renders only when `withSelectAll` is set. Throws when the
   * select-all checkbox is not present so call sites fail loudly
   * instead of silently no-op'ing on a misconfigured group.
   *
   * Idempotent: no-op when already fully selected (the underlying
   * Checkbox POM compares state before clicking).
   */
  async selectAll(): Promise<void> {
    await this.selectAllCheckbox().check();
  }

  /**
   * Click the optional Select All sibling checkbox to clear all
   * children. See `selectAll()` for caveats.
   */
  async deselectAll(): Promise<void> {
    await this.selectAllCheckbox().uncheck();
  }

  /**
   * Read the FormBuilder validation error message for the group, if
   * any. Returns `null` when the error container is empty (group is
   * valid) or when this POM was constructed in scoped mode.
   *
   * The error sits at `#${groupId}Error` because the inner Group
   * field receives `id={groupId}` and FieldSet renders ErrorMessage
   * as `#${id}Error`.
   */
  async errorMessage(): Promise<string | null> {
    if (!this.groupId) return null;
    const err = this.page.locator(`#${this.groupId}Error`);
    const present = await err.count();
    if (!present) return null;
    const text = (await err.innerText()).trim();
    return text === '' ? null : text;
  }

  // ────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────

  /**
   * Build a singular `Checkbox` POM pointed at the child input. In
   * FormBuilder mode the input id is `${childKey}_${groupId}Field`;
   * in scoped mode we look up an `<input type="checkbox">` whose id
   * matches that pattern within the root scope.
   */
  private child(childKey: string): Checkbox {
    if (this.groupId) {
      return new Checkbox(this.page, `${childKey}_${this.groupId}`);
    }
    const input = (this.root as Locator).locator(
      `input[type="checkbox"][id$="${childKey}_Field"], input[type="checkbox"][id="${childKey}Field"]`
    );
    return new Checkbox(input);
  }

  /**
   * Build a singular `Checkbox` POM for the optional Select All
   * sibling. Only valid in FormBuilder mode (the scoped form has no
   * canonical select-all id to derive). Throws on scoped use to
   * fail fast.
   */
  private selectAllCheckbox(): Checkbox {
    if (!this.fieldName) {
      throw new Error(
        'Checkboxes.selectAll/deselectAll: not supported in scoped mode — construct with a fieldName'
      );
    }
    return new Checkbox(this.page, `${this.fieldName}_SelectAll`);
  }
}
