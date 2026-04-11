/**
 * `@geowealth/e2e-framework/components` — React widget Component classes.
 *
 * Each class wraps a React widget from the qa SPA with a typed POM
 * API: stable locators pinned to `data-role` / `data-module` /
 * role-based attributes, semantic verbs (`setValue`, `setText`,
 * `selectFirm`), and absorbed quirks that plain Playwright calls
 * cannot express.
 *
 *   ReactDatePicker     — calendar popup with dispatch-burst open + nav
 *   ComboBox            — FormBuilder + standalone Ui variants, exact match
 *   ComboBoxMultiSelect — FormBuilder ComboBoxMultiSelect, dropdown stays open after click
 *   NumericInput        — React controlled-component value setter (FormBuilder Number/Percent/Currency)
 *   TextInput           — React controlled-component value setter (FormBuilder Text/TextArea/Password + standalone)
 *   Checkbox            — FormBuilder Checkbox + standalone Ui/Checkbox via native click()
 *   Checkboxes          — FormBuilder Checkboxes group + optional Select All sibling
 *   RadioButtons        — FormBuilder RadioButtons group, addressed by value
 *   FormBuilder         — cross-cutting form helpers (validation debounce wait)
 *   AgGrid              — single-click edit, rich-select, virtualization
 *   TypeAhead           — server-paginated firm picker with confirm modes
 *   Modal               — React portal under `#modal`, layer-scoped actions
 *
 * Every component POM accepts a field-id string (FormBuilder form)
 * OR a scoped Locator (standalone / arbitrary root), and the
 * internal derivation follows the FormBuilder InputCore/FieldSet
 * id conventions: `#${fieldId}` section, `#${fieldId}Field` input,
 * `#${fieldId}Div` combo wrapper, `#${fieldId}Error` validation
 * message.
 */

export { ReactDatePicker } from './ReactDatePicker';
export { ComboBox } from './ComboBox';
export { ComboBoxMultiSelect } from './ComboBoxMultiSelect';
export { NumericInput } from './NumericInput';
export { TextInput } from './TextInput';
export { Checkbox } from './Checkbox';
export { Checkboxes } from './Checkboxes';
export { RadioButtons } from './RadioButtons';
export { FormBuilder } from './FormBuilder';
export { AgGrid } from './AgGrid';
export { TypeAhead, type FirmTypeAheadTarget, type TypeAheadConfirmationMode } from './TypeAhead';
export { Modal } from './Modal';
