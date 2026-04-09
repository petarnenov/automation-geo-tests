/**
 * `@geowealth/e2e-framework/components` — React widget Component classes.
 *
 * Phase 2 step 5 (D-37). Five classes lifted from the legacy POC's
 * `_helpers/ui.js` (387 LOC), one per real-world widget quirk:
 *
 *   ReactDatePicker — calendar popup with dispatch-burst open + nav
 *   ComboBox        — typeAhead and icon-only variants, exact match
 *   NumericInput    — React controlled-component value setter
 *   AgGrid          — single-click edit, rich-select, virtualization
 *   TypeAhead       — server-paginated firm picker with confirm modes
 *
 * Per Section 4.4: each class accepts `(page, scope)` in its
 * constructor and exposes semantic verbs (`setValue`, `setText`,
 * `selectFirm`, ...) — never mechanical `click()` calls. The Page
 * Objects in Phase 2 step 6 onward instantiate these as readonly
 * properties and forward semantic verbs from the Page Object's own
 * methods.
 */

export { ReactDatePicker } from './ReactDatePicker';
export { ComboBox } from './ComboBox';
export { NumericInput } from './NumericInput';
export { AgGrid } from './AgGrid';
export { TypeAhead, type FirmTypeAheadTarget, type TypeAheadConfirmationMode } from './TypeAhead';
