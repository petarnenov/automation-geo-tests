// @ts-check
/**
 * TestRail C26310 — View billing spec update history with before/after details
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26310 (Run 206)
 * Spec page:
 *   https://geowealth.atlassian.net/wiki/spaces/PRODOPS/pages/2019491841/Billing+Center+-+Billing+Specifications#Copy,-Export,-Delete,-History-Actions
 *
 * BLOCKED — the History row action is not implemented in the UI on
 * qa4 (the `GridRowActionHistory` component is commented out in
 * `BillingSpecsRowsActions.js:48`).  The hook config
 * `useGridRowActionHistoryConfig` exists (lines 24-67) with the
 * expected modal header "Billing Specification History" and the column
 * set ACTIVITY / DATE & TIME / USER / NOTES / BEFORE / AFTER, but the
 * span that would open the modal is not rendered.  Once the FE wires it
 * back in, replace the test.fixme with the actual interactions.
 */

const { test } = require('@playwright/test');

test.fixme(
  '@pepi C26310 Billing Spec History modal — view update history',
  async () => {
    // Implementation pending: see BillingSpecsRowsActions.js:48 — the
    // GridRowActionHistory action is commented out, so the History icon
    // cannot be clicked through the UI today.  Track on the underlying
    // story (Billing Center / Copy-Export-Delete-History Actions).
  }
);
