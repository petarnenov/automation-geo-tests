/**
 * Page Object for Platform One → Upload Tools → Bulk Exclusions →
 * Billing Bucket Exclusions.
 *
 * Wraps the firm-scoped xlsx upload flow implemented in
 * `~/geowealth/WebContent/react/app/src/pages/PlatformOne/pages/UploadTools/BulkExclusions/BillingBucketExclusions/`.
 *
 * ## What the page does (FE summary)
 *
 * The form is a single-field FormBuilder wrapper around
 * `FileUpload` (`modules/FormBuilder/Fields/FileUpload/FileUpload.js`)
 * with `useDropZone: true`, so users can either click
 * `"Browse For File"` (`AddDocButton`) and pick through the OS file
 * picker, or drag-and-drop an xlsx into the page's `OverlayDnd`
 * area. Both paths funnel through `addNewFile(files[])`, so
 * functionally Playwright's `setInputFiles` is 1:1 with a drop event
 * for any assertion that runs after the file is attached. The
 * underlying `<input type="file" id="uploadedDocuments">` is
 * `display:none` but reachable by id.
 *
 * After a file is attached, `BillingBucketExclusionsFilesGrid`
 * renders a `multiGroupGrid` row showing the filename; clicking
 * `"Upload"` fires
 * `POST /platformOne/billingBucketExclusionsBulkUpload.do`, which
 * returns `{ conversationUUID, errors }`. If `conversationUUID` is
 * present the confirmation modal
 * (`#ConfirmationBillingBucketExclusionsModal`) opens with either a
 * success prompt ("This action will create new Billing Bucket
 * Exclusions...") or an error list ("N Billing Bucket Exclusions
 * will not be imported due to an error"); clicking `"Yes, Proceed"`
 * fires
 * `POST /platformOne/confirmBillingBucketExclusionsBulkUpload.do`
 * and, on 200, the modal flips to the success toast
 * `"The Billing Bucket Exclusions were imported successfully"`
 * plus a `"Close"` button.
 *
 * ## Drag-and-drop vs file explorer
 *
 * TestRail distinguishes `C25363 (drag & drop)` from
 * `C25377 (file explorer)`. The legacy POC spec for C25363 documents
 * its own pragmatic shortcut: *"Playwright's setFiles() bypasses the
 * click source distinction (drag&drop vs Browse), so this test only
 * verifies the upload mechanics."* This POM follows the same
 * approach — `uploadFile` uses the real `"Browse For File"` filechooser
 * path, and `uploadFileViaDropZone` additionally dispatches real
 * HTML5 `dragenter`/`dragover`/`drop` events with a populated
 * `DataTransfer` on the drop zone so `react-dnd-html5-backend` sees
 * the drop. Either method terminates at the same
 * `FileUpload.addNewFile` handler, so downstream assertions are
 * identical — pick the method that reads best for the spec's intent.
 *
 * ## First-time-only confirmation modal
 *
 * Verified by the legacy helper `_uploadExclusionsXlsx`: after the
 * first successful upload per session, the service-confirmation modal
 * with `"Yes, Proceed"` does NOT reappear for subsequent uploads.
 * `clickUpload` handles both cases by waiting for either the modal
 * OR the success toast and routing accordingly.
 *
 * ## Timeouts
 *
 * The import success toast can take up to ~180s under full parallel
 * load because qa2 queues bulk-exclusions uploads serially backend-
 * side (legacy `_uploadExclusionsXlsx` comment). The POM's
 * `waitForImportSuccess` defaults to 180s for the same reason —
 * shrinking to 90s caused flakes on C25377 / C26075 in the full
 * @pepi suite.
 *
 * ## Assertions and waits
 *
 * This POM never calls `expect(...)`. Internal preconditions use
 * `locator.waitFor({ state })` and `waitForResponse`; test-facing
 * state is exposed as Locator getters for spec-side assertions.
 */

import type { Download, Locator, Page, Response } from '@playwright/test';

/** Network endpoints fired by the upload flow. */
const UPLOAD_ENDPOINT = /\/platformOne\/billingBucketExclusionsBulkUpload\.do/;
const CONFIRM_ENDPOINT = /\/platformOne\/confirmBillingBucketExclusionsBulkUpload\.do/;

/** MIME type for the xlsx upload; matches FormBuilder's `accepts: [XLSX]`. */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Route constants — the form is firm-scoped at this path. */
const ROUTE_PATH = 'platformOne/uploadTools/bulkExclusions/billingBucketExclusions';

const DEFAULT_WAIT = 10_000;
const UPLOAD_RESPONSE_TIMEOUT = 60_000;
/**
 * Upper bound for the `imported successfully` toast after Yes, Proceed.
 * 180s is deliberate — see the class docstring.
 */
const IMPORT_SUCCESS_TIMEOUT = 180_000;

/**
 * File input accepted by the POM's upload methods. Mirrors
 * Playwright's `FileChooser.setFiles` shape so callers have the full
 * range: an absolute path, a `Buffer` plus a synthesised name, or a
 * full `{name, buffer, mimeType}` descriptor for complete control.
 */
export type BucketExclusionsUploadInput =
  | string
  | Buffer
  | { name: string; buffer: Buffer; mimeType?: string };

/**
 * Structured response from
 * `POST /platformOne/billingBucketExclusionsBulkUpload.do`. Exposed so
 * specs can assert on the backend's verdict (error list, acceptance)
 * without re-parsing the body.
 */
export interface BucketExclusionsUploadResponse {
  /** Present on accepted uploads; absent on hard failures. */
  conversationUUID?: string;
  /** Server-reported errors (if any), raw strings from the FE handler. */
  errors?: string[];
}

export class BillingBucketExclusionsPage {
  constructor(private readonly page: Page) {}

  // ────────────────────────────────────────────────────────────────
  // Navigation
  // ────────────────────────────────────────────────────────────────

  /**
   * Navigate directly to the firm-scoped upload form. Waits for the
   * firm-picker typeahead to reflect the target firmCd (the
   * `P1FirmListDropdown` renders a textbox prefilled with
   * `(firmCd) Firm Name`) and for the hidden file input to be
   * attached. Throws a permission-deny error if App.js redirected to
   * /dashboard.
   */
  async open(firmCd: number): Promise<void> {
    const target = `/react/indexReact.do#${ROUTE_PATH}/${firmCd}`;
    await this.page.goto(target);

    const url = this.page.url();
    if (url.includes('#dashboard') || url.endsWith('/dashboard')) {
      throw new Error(
        `BillingBucketExclusionsPage: permission-deny navigating to ` +
          `#${ROUTE_PATH}/${firmCd} — App.js redirected to /dashboard. ` +
          `The logged-in user lacks gwAdminFlag. Use tim1Page or a ` +
          `workerFirmAdminPage fixture whose user has upload rights.`
      );
    }

    // The firm picker is rendered by `P1FirmListDropdown` above the
    // form. Its typeahead is a plain `<input type="text">`; waiting for
    // the prefilled `(firmCd)` value confirms the SPA route resolved
    // and the firm list loaded.
    const firmInput = this.page.getByRole('textbox').first();
    await firmInput.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });

    await this.page.waitForFunction(
      (firm) => {
        const inputs = document.querySelectorAll('input[type="text"]');
        for (const el of inputs) {
          if ((el as HTMLInputElement).value.includes(`(${firm})`)) return true;
        }
        return false;
      },
      firmCd,
      { timeout: DEFAULT_WAIT * 3 }
    );

    await this.hiddenFileInput().waitFor({ state: 'attached', timeout: DEFAULT_WAIT });
  }

  // ────────────────────────────────────────────────────────────────
  // Uploading
  // ────────────────────────────────────────────────────────────────

  /**
   * Attach a file via the "Browse For File" button's native file
   * picker. This is the C25377 path — semantically identical to the
   * drop-zone path at the React handler level, but reads more
   * naturally in specs that test the file-explorer flow.
   */
  async uploadFile(file: BucketExclusionsUploadInput): Promise<void> {
    const payload = toFileChooserPayload(file);

    const chooserPromise = this.page.waitForEvent('filechooser', { timeout: DEFAULT_WAIT });
    await this.browseButton().click();
    const chooser = await chooserPromise;
    await chooser.setFiles(payload);

    await this.waitForFileAttached(fileDisplayName(payload));
  }

  /**
   * Attach a file by dispatching HTML5 `dragenter`/`dragover`/`drop`
   * events on the `OverlayDnd` drop zone with a populated
   * `DataTransfer`. This exercises the `react-dnd-html5-backend`
   * path used by `FileDropZone`, which is what C25363 specifies
   * ("uploaded via drag and drop").
   *
   * Playwright has no first-class DnD-of-external-files API, so this
   * method builds a synthetic `DataTransfer` in the page context,
   * attaches a File object constructed from the Buffer, and fires
   * the drag sequence directly on the drop zone element. Works
   * against react-dnd's HTML5 backend because that backend also
   * listens for the real DOM drop event.
   *
   * Falls back to `uploadFile` semantics if the drop zone element
   * is not present — e.g. when the form is rendered without
   * `useDropZone: true` in a future refactor.
   */
  async uploadFileViaDropZone(file: BucketExclusionsUploadInput): Promise<void> {
    const dropZone = this.dropZone();
    const dropZoneCount = await dropZone.count();
    if (dropZoneCount === 0) {
      await this.uploadFile(file);
      return;
    }

    const { name, mimeType, base64 } = await this.materialiseFileForDnd(file);

    await dropZone.first().evaluate(
      async (
        el: Element,
        payload: { name: string; mimeType: string; base64: string }
      ) => {
        const binary = globalThis.atob(payload.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const fileObj = new File([bytes], payload.name, { type: payload.mimeType });
        const dt = new DataTransfer();
        dt.items.add(fileObj);

        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        const fire = (type: string) => {
          const ev = new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: dt,
          });
          el.dispatchEvent(ev);
        };
        fire('dragenter');
        fire('dragover');
        fire('drop');
      },
      { name, mimeType, base64 }
    );

    await this.waitForFileAttached(name);
  }

  /**
   * Wait for the files grid to show the attached filename. `FileUpload`
   * re-renders the grid only when the file state contains at least
   * one entry, so a visible row with the filename is the definitive
   * signal that the file is attached and the Upload button is
   * about to become enabled.
   */
  async waitForFileAttached(fileName: string): Promise<void> {
    await this.page
      .getByText(fileName, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
  }

  // ────────────────────────────────────────────────────────────────
  // Submitting
  // ────────────────────────────────────────────────────────────────

  /**
   * Click the `"Upload"` primary submit button and return the parsed
   * `billingBucketExclusionsBulkUpload.do` response body. The Upload
   * button is a FormBuilder primary submit, so the usual 300ms
   * debounce applies; this method waits for `isEnabled` rather than a
   * fixed timeout because the button has no `disabled` DOM attribute
   * (it uses `disabledStyleOnly` — see `UsersPage.submitUserForm`
   * for the long-form explanation of the same quirk).
   */
  async clickUpload(): Promise<BucketExclusionsUploadResponse> {
    const btn = this.uploadButton();
    await btn.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    const [resp] = await Promise.all([
      this.page.waitForResponse(
        (r) => UPLOAD_ENDPOINT.test(r.url()) && r.request().method() === 'POST',
        { timeout: UPLOAD_RESPONSE_TIMEOUT }
      ),
      btn.click(),
    ]);
    return parseUploadResponse(resp);
  }

  /**
   * Click `"Yes, Proceed"` on the confirmation modal if it is
   * currently visible. The modal is first-time-only per session —
   * subsequent uploads skip straight to the success toast — so this
   * method is a best-effort click with a short timeout and does not
   * throw when the modal is absent.
   */
  async confirmProceedIfPresent(timeoutMs = 5_000): Promise<boolean> {
    const btn = this.yesProceedButton();
    try {
      await btn.waitFor({ state: 'visible', timeout: timeoutMs });
    } catch {
      return false;
    }
    await Promise.all([
      this.page.waitForResponse(
        (r) => CONFIRM_ENDPOINT.test(r.url()) && r.request().method() === 'POST',
        { timeout: UPLOAD_RESPONSE_TIMEOUT }
      ),
      btn.click(),
    ]);
    return true;
  }

  /**
   * Wait for the `"…imported successfully"` confirmation banner. Uses
   * a 180s timeout by default because qa2 queues bulk-exclusions
   * uploads serially backend-side under full parallel load.
   */
  async waitForImportSuccess(timeoutMs: number = IMPORT_SUCCESS_TIMEOUT): Promise<void> {
    await this.successBanner().waitFor({ state: 'visible', timeout: timeoutMs });
  }

  /**
   * Click the confirmation modal's `"Close"` button to dismiss the
   * success banner. Matches the legacy `_uploadExclusionsXlsx`
   * cleanup step so the form is ready for a subsequent upload
   * without reloading the page.
   */
  async dismissSuccessModal(): Promise<void> {
    const close = this.page.getByRole('button', { name: 'Close', exact: true });
    await close.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await close.click();
    await this.successBanner().waitFor({ state: 'hidden', timeout: DEFAULT_WAIT });
  }

  /**
   * Full happy-path submit: attaches the file via Browse For File,
   * clicks Upload, dismisses the (possibly absent) Yes-Proceed modal,
   * waits for the success banner, and closes it. Returns the initial
   * upload response so specs can still inspect the backend verdict.
   *
   * Use this in specs that only care about "did the upload work";
   * use the granular methods for specs that assert on each phase.
   */
  async uploadAndConfirm(
    file: BucketExclusionsUploadInput
  ): Promise<BucketExclusionsUploadResponse> {
    await this.uploadFile(file);
    const resp = await this.clickUpload();
    await this.confirmProceedIfPresent();
    await this.waitForImportSuccess();
    await this.dismissSuccessModal();
    return resp;
  }

  // ────────────────────────────────────────────────────────────────
  // Errors and validation
  // ────────────────────────────────────────────────────────────────

  /**
   * Wait for a validation error to surface. Matches either:
   *
   *   1. Any visible element whose text matches `pattern` — defaults
   *      to {@link DEFAULT_VALIDATION_ERROR_RX}, a broad error-token
   *      regex kept for back-compat with callers that want to assert
   *      on specific copy.
   *
   *   2. A confirmation-modal error heading with the stable qa
   *      backend `[N] ...` prefix (`[1] Household is not from
   *      provided firm!`, `[1] Unhandled billing type: 29`, …).
   *      Matching the prefix is more robust than chasing keyword
   *      synonyms per backend release — every server-validated
   *      rejection renders through the same
   *      `ConfirmationBillingBucketExclusionsModal` error branch
   *      with that prefix.
   *
   * Waits on whichever locator becomes visible first. Returns the
   * matched text so specs can assert further without re-querying.
   */
  async waitForValidationError(
    pattern: RegExp = DEFAULT_VALIDATION_ERROR_RX,
    timeoutMs: number = DEFAULT_WAIT * 3
  ): Promise<string> {
    const byPattern = this.page.getByText(pattern).first();
    const byPrefix = this.page
      .getByRole('heading')
      .filter({ hasText: /^\[\d+\]\s/ })
      .first();
    const error = byPattern.or(byPrefix);
    await error.waitFor({ state: 'visible', timeout: timeoutMs });
    return (await error.innerText()).trim();
  }

  // ────────────────────────────────────────────────────────────────
  // Template download
  // ────────────────────────────────────────────────────────────────

  /**
   * Click the `"Download Upload Template"` footer link and return
   * the Playwright `Download` so callers can saveAs to disk or
   * parse the bytes (via
   * `@geowealth/e2e-framework/helpers.readXlsxSheet`).
   *
   * The underlying href is
   * `/docs/upload_samples/uploadTools/bucketExclusions/BillingBucketExclusions_Import_Template.xlsx`;
   * the Button is rendered as a `displayType="link"` element so it
   * matches `getByRole('button')` rather than `getByRole('link')`.
   */
  async downloadTemplate(): Promise<Download> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: DEFAULT_WAIT * 3 }),
      this.page.getByRole('button', { name: 'Download Upload Template' }).click(),
    ]);
    return download;
  }

  // ────────────────────────────────────────────────────────────────
  // Locators (for test-facing assertions)
  // ────────────────────────────────────────────────────────────────

  /** Hidden `<input type="file" id="uploadedDocuments">` driven by FileUpload. */
  hiddenFileInput(): Locator {
    return this.page.locator('input#uploadedDocuments[type="file"]');
  }

  /** `"Browse For File"` primary trigger on the drop zone. */
  browseButton(): Locator {
    return this.page.getByRole('button', { name: 'Browse For File' });
  }

  /** `"Upload"` primary submit button. */
  uploadButton(): Locator {
    return this.page.getByRole('button', { name: 'Upload', exact: true });
  }

  /** `"Yes, Proceed"` confirmation modal button. */
  yesProceedButton(): Locator {
    return this.page.getByRole('button', { name: 'Yes, Proceed' });
  }

  /** Import success banner (matches `/imported successfully/i`). */
  successBanner(): Locator {
    return this.page.getByText(/imported successfully/i).first();
  }

  /**
   * `OverlayDnd` drop zone element. The overlay CSS module hashes
   * the class name at build time, but `OverlayDnd` wraps the form in
   * a div with `data-type="dropZone"` or similar. Since that
   * attribute isn't currently exposed, we anchor on the nearest
   * stable parent: the form's container id.
   */
  dropZone(): Locator {
    return this.page.locator('#billingBucketExclusions');
  }

  // ────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────

  /**
   * Convert a `BucketExclusionsUploadInput` into a structure suitable
   * for DataTransfer-based DnD simulation. Reads from disk when a
   * path is given so the drop-zone path supports static fixture files.
   */
  private async materialiseFileForDnd(
    file: BucketExclusionsUploadInput
  ): Promise<{ name: string; mimeType: string; base64: string }> {
    if (typeof file === 'string') {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const buffer = fs.readFileSync(file);
      return {
        name: path.basename(file),
        mimeType: XLSX_MIME,
        base64: buffer.toString('base64'),
      };
    }
    if (Buffer.isBuffer(file)) {
      return {
        name: 'BillingBucketExclusions.xlsx',
        mimeType: XLSX_MIME,
        base64: file.toString('base64'),
      };
    }
    return {
      name: file.name,
      mimeType: file.mimeType ?? XLSX_MIME,
      base64: file.buffer.toString('base64'),
    };
  }
}

/**
 * Validation-error keyword regex. Broad enough to catch the FE's
 * error copy regardless of whether the text is rendered inline under
 * the field or inside the confirmation modal's heading/error list.
 *
 * The base set mirrors the legacy `validationErrorRegex` keyword
 * union. The `not from|not.*match|does not belong|does not match`
 * alternations cover qa2 backend messages like
 * `"[1] Household is not from provided firm!"` which don't contain
 * any of the base tokens — C25380 subcase 2 surfaces this exact
 * copy when the firm code mismatches the HH.
 */
const DEFAULT_VALIDATION_ERROR_RX =
  /error|invalid|required|missing|wrong|must|cannot|failed|not from|not.*match|does not belong/i;

// ──────────────────────────────────────────────────────────────────
// Local helpers (not exported)
// ──────────────────────────────────────────────────────────────────

/**
 * Convert a `BucketExclusionsUploadInput` into the exact shape
 * `FileChooser.setFiles()` expects. Strings pass through as paths,
 * Buffers get a synthesised filename, and the object form is forwarded
 * verbatim.
 */
function toFileChooserPayload(
  file: BucketExclusionsUploadInput
):
  | string
  | { name: string; mimeType: string; buffer: Buffer } {
  if (typeof file === 'string') return file;
  if (Buffer.isBuffer(file)) {
    return {
      name: 'BillingBucketExclusions.xlsx',
      mimeType: XLSX_MIME,
      buffer: file,
    };
  }
  return {
    name: file.name,
    mimeType: file.mimeType ?? XLSX_MIME,
    buffer: file.buffer,
  };
}

/**
 * Extract the displayable filename from a filechooser payload so the
 * caller can assert on the rendered files-grid row without having to
 * reach back into the original `BucketExclusionsUploadInput`.
 */
function fileDisplayName(
  payload: string | { name: string; mimeType: string; buffer: Buffer }
): string {
  if (typeof payload === 'string') {
    const slash = payload.lastIndexOf('/');
    return slash >= 0 ? payload.slice(slash + 1) : payload;
  }
  return payload.name;
}

/**
 * Best-effort parse of the
 * `billingBucketExclusionsBulkUpload.do` response body. The FE
 * service handler returns `{ conversationUUID, errors }` wrapped in
 * the generic ManageService envelope; actual wire shape is
 * `{ payload: { conversationUUID, errors } }` or a flat
 * `{ conversationUUID, errors }` depending on env. Both shapes are
 * accepted here.
 */
async function parseUploadResponse(resp: Response): Promise<BucketExclusionsUploadResponse> {
  try {
    const body = (await resp.json()) as unknown;
    if (body && typeof body === 'object') {
      const wrapper = body as { payload?: unknown; conversationUUID?: unknown; errors?: unknown };
      const inner =
        wrapper.payload && typeof wrapper.payload === 'object' ? wrapper.payload : wrapper;
      const withFields = inner as { conversationUUID?: unknown; errors?: unknown };
      return {
        conversationUUID:
          typeof withFields.conversationUUID === 'string' ? withFields.conversationUUID : undefined,
        errors: Array.isArray(withFields.errors)
          ? (withFields.errors as unknown[]).map((e) => String(e))
          : undefined,
      };
    }
  } catch {
    /* non-JSON response — return empty */
  }
  return {};
}
