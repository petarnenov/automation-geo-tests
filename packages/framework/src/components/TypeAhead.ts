/**
 * `TypeAhead` Component class.
 *
 * Phase 2 step 5 (D-37). Lifted from the legacy POC's
 * `packages/legacy-poc/tests/_helpers/ui.js::selectFirmInTypeAhead`
 * (lines 227-252). The legacy version was duplicated inline across 6
 * create-account specs (C24940, C24943, C24996, C24997, C25065,
 * C25102) before being extracted; this Component is the canonical
 * home.
 *
 * Distinct from `ComboBox`: a TypeAhead is a server-paginated
 * suggestion list (no static options), and the matching is keyed
 * by an embedded display token like `(firmCd)` rather than the
 * full visible label. The two share the `combo-box-list-item`
 * role but the workflow and verification are different enough that
 * combining them in one class would be more confusing than separate.
 *
 * Quirks preserved:
 *
 *   - **Server-paginated, ~20 results per query**. For specific
 *     pickers (e.g. firm by firmCd), use a tightly-scoped filter
 *     (the full firm name). Generic prefixes don't surface
 *     higher-numbered firms.
 *
 *   - **80-keypress backspace clear** (same as ComboBox typeAhead).
 *     `.fill('')` is unreliable.
 *
 *   - **Selection match by `(firmCd)` regex, not by exact label**.
 *     Multiple firms can share the display name prefix; the firmCd
 *     is the unique discriminator.
 *
 *   - **Confirmation modes**:
 *       'typeAheadValue'   — assert the input contains `(firmCd)`.
 *                            Fast, but unreliable after a form
 *                            reset (the wrapper generic is not
 *                            updated). Default.
 *       'bulkUploadButton' — wait for the
 *                            "Open multiple accounts in bulk"
 *                            button to be enabled. Slower but the
 *                            strongest real signal.
 *       'none'             — caller asserts separately.
 *
 *   - **Quirk 10 from project_create_account_specifics**: don't
 *     assert on `expect(input).toHaveValue(/firm/)` after the
 *     SECOND selectFirmInTypeAhead call in the same spec — the
 *     wrapper element doesn't update reliably. Use the
 *     `bulkUploadButton` confirmation mode for second-and-later
 *     selections in a spec.
 *
 * The Component is currently scoped to `#firmCd_typeAhead` because
 * that is the only TypeAhead the legacy POC exercises. If a future
 * spec needs a different TypeAhead (e.g. `#advisorCd_typeAhead`),
 * the constructor will grow a `fieldKey` parameter.
 */

import { expect, type Page } from '@playwright/test';

const FILTER_DEBOUNCE_MS = 500;

export type TypeAheadConfirmationMode = 'typeAheadValue' | 'bulkUploadButton' | 'none';

export interface FirmTypeAheadTarget {
  readonly firmCd: number;
  readonly firmName: string;
}

export class TypeAhead {
  private readonly page: Page;
  private readonly inputId: string;

  /**
   * @param page Playwright Page.
   * @param inputId The DOM `id` of the typeAhead input. Defaults to
   *   `'firmCd_typeAhead'` (the only TypeAhead the legacy POC
   *   currently uses).
   */
  constructor(page: Page, inputId: string = 'firmCd_typeAhead') {
    this.page = page;
    this.inputId = inputId;
  }

  /**
   * Select a firm via the typeAhead. Types the firm name as the
   * filter, picks the option whose label contains the matching
   * `(firmCd)` token, and confirms the selection per the chosen
   * mode.
   */
  async selectFirm(
    target: FirmTypeAheadTarget,
    options: { confirm?: TypeAheadConfirmationMode } = {}
  ): Promise<void> {
    const confirm = options.confirm ?? 'typeAheadValue';
    const ta = this.page.locator(`#${this.inputId}`);
    await ta.evaluate((el: Element) => {
      const input = el as HTMLInputElement;
      input.focus();
      input.select();
    });
    // If a firm is already selected (auto-populated by the extended
    // endpoint), skip re-selection. Check if the input has a value
    // that looks like a firm name (contains "Firm" or the firmCd).
    const currentValue = await ta.inputValue();
    if (currentValue && (
      currentValue.includes(target.firmName) ||
      currentValue.includes(`(${target.firmCd})`) ||
      currentValue.startsWith('Firm-')
    )) {
      return;
    }

    // 80-keypress clear — `.fill('')` is unreliable; preserved
    // verbatim from the legacy.
    for (let i = 0; i < 80; i++) await ta.press('Backspace');
    await ta.pressSequentially(target.firmName);
    await this.page.waitForTimeout(FILTER_DEBOUNCE_MS);
    const option = this.page
      .locator('[role="combo-box-list-item"]')
      .filter({ hasText: new RegExp(`\\(${target.firmCd}\\)`) })
      .first();
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.evaluate((el: Element) => (el as HTMLElement).click());

    if (confirm === 'typeAheadValue') {
      await expect(ta).toHaveValue(new RegExp(`\\(${target.firmCd}\\)`), {
        timeout: 5000,
      });
    } else if (confirm === 'bulkUploadButton') {
      // The strongest real signal that firm-dependent UI activated.
      // Use this mode for second-and-later selections in a spec
      // (Quirk 10).
      await expect(
        this.page.getByRole('button', { name: 'Open multiple accounts in bulk' })
      ).toBeEnabled({ timeout: 5000 });
    }
    // confirm === 'none' — caller asserts separately.
  }
}
