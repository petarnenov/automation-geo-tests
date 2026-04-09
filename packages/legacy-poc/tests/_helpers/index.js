// @ts-check
/**
 * Single-import barrel for the @pepi suite.
 *
 * Usage in a spec:
 *
 *   const {
 *     login, loginPlatformOneAdmin, switchToAdvisor,
 *     setReactDatePicker, setComboBoxValue, setReactNumericInput,
 *     setAgGridText, setAgGridRichSelect, setAgGridDate,
 *   } = require('../_helpers');
 *
 * Re-exports the qa3 navigation/login helpers and the generic UI widget
 * primitives. Add new generic helpers to ui.js (or qa3.js for navigation),
 * not here — this file is just the doorway.
 */

module.exports = {
  ...require('./qa3'),
  ...require('./ui'),
};
