/**
 * `CreateAccountPage` — facade over the Platform One → Create Account page.
 *
 * Phase 4. Absorbs the ag-grid, firm-picker, bulk-upload and Create/success
 * flows from the 7 legacy create-account specs (C24940–C25102).
 *
 * Per Section 4.4 contract:
 *   - Exposes locators as readonly properties.
 *   - No `expect()` assertions inside — assertions stay in spec files.
 *   - `goto()` performs navigation and waits for the page-loaded signal.
 *
 * Composes framework Components:
 *   - `AgGrid` for cell-level operations (text, rich-select, date)
 *   - `TypeAhead` for the firm picker
 */

import { expect, type Page, type Locator } from '@playwright/test';
import { AgGrid } from '@geowealth/e2e-framework/components/AgGrid';
import { TypeAhead, type FirmTypeAheadTarget, type TypeAheadConfirmationMode } from '@geowealth/e2e-framework/components/TypeAhead';

const CREATE_ACCOUNT_URL = '/react/indexReact.do#platformOne/backOffice/createAccount';

export class CreateAccountPage {
  readonly page: Page;
  readonly grid: AgGrid;
  readonly firmTypeAhead: TypeAhead;

  readonly heading: Locator;
  readonly addNewRowButton: Locator;
  readonly bulkUploadButton: Locator;
  readonly resetButton: Locator;
  readonly createButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.grid = new AgGrid(page);
    this.firmTypeAhead = new TypeAhead(page);

    this.heading = page.getByRole('heading', { name: 'Single/Multiple Account Creation' });
    this.addNewRowButton = page.getByRole('button', { name: 'Add New Row' });
    this.bulkUploadButton = page.getByRole('button', { name: 'Open multiple accounts in bulk' });
    this.resetButton = page.getByRole('button', { name: 'Reset' });
    this.createButton = page.getByRole('button', { name: 'Create', exact: true });
  }

  /** Navigate to the Create Account page and wait for the heading. */
  async goto(): Promise<void> {
    await this.page.goto(CREATE_ACCOUNT_URL);
    await expect(this.heading).toBeVisible({ timeout: 30_000 });
  }

  /** Select a firm via the typeAhead picker. */
  async selectFirm(
    target: FirmTypeAheadTarget,
    options?: { confirm?: TypeAheadConfirmationMode }
  ): Promise<void> {
    await this.firmTypeAhead.selectFirm(target, options);
  }

  /** Click Add New Row and wait for the row to appear in the grid. */
  async addNewRow(): Promise<void> {
    await this.addNewRowButton.click();
    await expect(this.page.locator('.ag-row[row-index="0"]')).toBeVisible({ timeout: 5000 });
  }

  /**
   * Fill a complete row in the Create Account grid.
   *
   * The `defaultMoneyOption` field's valid values depend on the chosen
   * custodian, so we use `pickFirstRichSelect` (select whatever's first)
   * unless a specific value is passed.
   */
  async fillRow(
    rowIndex: number,
    fields: {
      accountNumber: string;
      clientUuid: string;
      accountNickname: string;
      accountType: string;
      custodian: string;
      openDate: string;
      defaultMoneyOption?: string;
    }
  ): Promise<void> {
    await this.grid.setText(rowIndex, 'accountNumber', fields.accountNumber);
    await this.grid.setText(rowIndex, 'clientUuid', fields.clientUuid);
    await this.grid.setText(rowIndex, 'accountNickname', fields.accountNickname);
    await this.grid.setRichSelect(rowIndex, 'accountTypeCd', fields.accountType);
    await this.grid.setRichSelect(rowIndex, 'eBrokerCd', fields.custodian);
    await this.grid.setDate(rowIndex, 'accountOpenDate', fields.openDate);
    if (fields.defaultMoneyOption) {
      await this.grid.setRichSelect(rowIndex, 'defaultMoneyOptionId', fields.defaultMoneyOption);
    } else {
      await this.grid.pickFirstRichSelect(rowIndex, 'defaultMoneyOptionId');
    }
  }

  /**
   * Click Create, assert success modal, close it.
   * Returns only when the modal is dismissed.
   */
  async createAndConfirmSuccess(): Promise<void> {
    await this.createButton.click();
    await expect(
      this.page.getByText(/All accounts have been created successfully/i)
    ).toBeVisible({ timeout: 30_000 });
    await this.page.getByRole('button', { name: 'OK', exact: true }).click();
  }

  /**
   * Open the bulk upload modal. If the grid already has rows, the
   * reset/keep confirmation prompt appears — pick based on `mode`.
   *
   * @param mode 'keep' = "No, keep them" (concatenate), 'reset' = "Yes, Reset"
   */
  async openBulkUploadModal(mode?: 'keep' | 'reset'): Promise<void> {
    await this.bulkUploadButton.click();

    if (mode === 'keep') {
      await expect(
        this.page.getByText(/Would you like to reset grid rows before uploading/i)
      ).toBeVisible({ timeout: 5000 });
      // "No, keep them" renders as a link, not a button.
      await this.page.getByRole('link', { name: 'No, keep them', exact: true }).click();
    } else if (mode === 'reset') {
      await expect(
        this.page.getByText(/Would you like to reset grid rows before uploading/i)
      ).toBeVisible({ timeout: 5000 });
      await this.page.getByRole('button', { name: 'Yes, Reset', exact: true }).click();
    } else {
      // No mode specified — the modal should open directly (no existing rows).
      // If a prompt appears unexpectedly, pick concatenate as the safe default.
      try {
        await this.page.getByRole('button', { name: /concatenate/i }).click({ timeout: 2000 });
      } catch {
        // No confirmation prompt — modal opened straight to upload view.
      }
    }
  }

  /**
   * Upload an xlsx buffer via the Browse For File modal, then click Submit.
   * Waits for Submit to be enabled (file validation) before clicking.
   */
  async uploadXlsx(buffer: Buffer, displayName: string): Promise<void> {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.page.getByRole('button', { name: /Browse For File/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: displayName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });
    await expect(this.page.getByText(displayName)).toBeVisible();

    const submitBtn = this.page.getByRole('button', { name: 'Submit', exact: true });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();
  }

  /** Locator for a grid row by row-index. */
  row(index: number): Locator {
    return this.page.locator(`.ag-row[row-index="${index}"]`);
  }

  /** Locator for a cell in a specific row by col-id containing given text. */
  cellWithText(colId: string, text: string): Locator {
    return this.page.locator(
      `.ag-row [role="gridcell"][col-id="${colId}"]:has-text("${text}")`
    );
  }

  /** Locator for error cells (cells with class `error-cell`). */
  errorCells(): Locator {
    return this.page.locator('.ag-row [role="gridcell"].error-cell');
  }

  /** Locator for error cells in a specific column. */
  errorCellInColumn(colId: string): Locator {
    return this.page.locator(`.ag-row [role="gridcell"][col-id="${colId}"].error-cell`);
  }

  /**
   * Open the ag-grid rich-select cell editor and return the visible option texts.
   * Used by C24941 to assert dropdown contents without committing a selection.
   */
  async openCellEditorAndGetOptions(rowIndex: number, colId: string): Promise<string[]> {
    const cell = this.grid.cell(rowIndex, colId);
    await cell.scrollIntoViewIfNeeded();
    await cell.click({ force: true });

    const options = this.page
      .locator('.ag-rich-select-virtual-list-viewport .ag-virtual-list-item')
      .first();

    // Fallback attempts if the first click didn't open the editor.
    if (!(await options.isVisible().catch(() => false))) {
      await cell.evaluate((el: Element) => (el as HTMLElement).click());
    }
    if (!(await options.isVisible().catch(() => false))) {
      await this.page.keyboard.press('Enter');
    }
    await expect(options).toBeVisible({ timeout: 5000 });

    return await this.page
      .locator('.ag-rich-select-virtual-list-viewport .ag-virtual-list-item')
      .allInnerTexts();
  }

  /** Press Escape to close an open rich-select editor. */
  async closeEditor(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }
}
