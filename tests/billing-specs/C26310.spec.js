// @ts-check
/**
 * TestRail C26310 — View billing spec update history with before/after details
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/26310 (Run 214)
 * Spec page:
 *   https://geowealth.atlassian.net/wiki/spaces/PRODOPS/pages/2019491841/Billing+Center+-+Billing+Specifications#Copy,-Export,-Delete,-History-Actions
 *
 * Jira chain:
 *   - GEO-8263 (parent story "Billing Spec - View History")     — Open
 *   - GEO-7054 (FE - Billing Spec view History)                 — Closed
 *     (built then disabled; see commented lines below)
 *   - GEO-7055 (BE - Billing Spec view History)                 — To Do
 *     (NEVER built — this is the root blocker)
 *   - GEO-23253 (Run Tests - Billing Spec - View History)       — To Do
 *     (the automation task that owns this spec)
 *
 * IMPLEMENTATION STATUS: BLOCKED on GEO-7055. The History row action is
 * also hard-disabled in the FE on master, and the FE service layer
 * shadows the BE response with hardcoded mock rows.
 *
 * What the case expects:
 *   - On Billing Specifications grid, hover a row → History icon next to
 *     Edit/Copy/Export/Delete.
 *   - Click → modal titled "Billing Spec History" with headings
 *     "[Spec Name] Settings" and "Entered/Last Modified".
 *   - Grid columns: ACTIVITY · DATE & TIME · USER · NOTES · BEFORE · AFTER.
 *   - At least one Create row + at least one Edit row (Edit shows USER,
 *     timestamp, NOTES = field name, BEFORE/AFTER = old/new value).
 *   - "Close Window" button bottom-right closes the modal.
 *
 * Why this can't run today — three layers all need work:
 *
 *   A) FE component: WebContent/react/app/src/pages/PlatformOne/pages/
 *      BillingCenter/pages/BillingSpecs/pages/BillingSpecs/Components/
 *      BillingSpecsGrid/Components/BillingSpecsRowsActions/
 *      BillingSpecsRowsActions.js
 *        line 24 — `//const {gridRowActionHistoryConfig} = useGridRowActionHistoryConfig();`
 *        line 48 — `{/_ <GridRowActionHistory data={data} config={gridRowActionHistoryConfig}/> _/}`
 *        (`/_ … _/` stands for the JSX comment markers on the actual line.)
 *      Both lines are commented out, so the History icon is not rendered.
 *
 *   B) FE service: …/BillingSpecs/_services/billingSpecsServices.js:184-236
 *        getHistory() prepares a GET to GET_P1_BILLING_SPEC_HISTORY_ENDPOINT
 *        (`/react/getP1BillingSpecHist.do`) BUT then overrides the response
 *        via `setHandleData(() => fromJS(stressTestData))` with hardcoded
 *        rows (`User 1` / `Notes 1` / …). Flagged in source:
 *          `//TODO: remove after BE completes the task`
 *      Even if A) is fixed, the modal would render mock data — not the
 *      real spec audit trail. That is why we will not ship the FE
 *      uncomment alone.
 *
 *   C) BE: no Struts action for `/react/getP1BillingSpecHist.do` exists
 *      anywhere in `src/main/java`. GEO-7055 owns this work and is still
 *      To Do. Until a real handler returns real audit rows, the case is
 *      unverifiable.
 *
 *   The supporting hook
 *     …/BillingSpecsGrid/Components/_hooks/useGridRowActionHistoryConfig.js
 *   IS implemented and already wires the exact case copy:
 *     modalHeaderTxtPrimary  = 'Billing Specification History'
 *     modalButtonTxt         = 'Close Window'
 *     grid columns (ACTIVITY, ACTIVITY_DATE, ACTIVITY_USER, ACTIVITY_NOTES,
 *                   ACTIVITY_BEFORE, ACTIVITY_AFTER)
 *     service = billingSpecsServices.getHistory
 *   …and the BE service exists too — sister surfaces (StatementTemplates,
 *   StatementCharges) render the same `GridRowActionHistory` component
 *   without the comment-out, so the wiring is one uncomment away.
 *
 *   NB: the case title in the modal as wired is "Billing Specification
 *   History", but the TestRail expected step says "Billing Spec History".
 *   When this gets unblocked, confirm the FE copy with the BA — both
 *   variations have appeared in adjacent surfaces and the BE-driven
 *   surface always wins.
 *
 * To unblock (must happen in order — GEO-7055 first):
 *   1. GEO-7055 (BE): build the `/react/getP1BillingSpecHist.do` Struts
 *      action that reads the billing-spec audit table and returns rows
 *      `{activity, activityDate, activityUser, activityNotes,
 *       activityBefore, activityAfter}`. Confirm Create + Edit events
 *      are captured on the audit table to begin with.
 *   2. FE service: drop the `setHandleData` mock block in
 *      billingSpecsServices.js:194-233 so the real BE response flows
 *      through. (Same file/line range, no other change needed.)
 *   3. FE component: uncomment BillingSpecsRowsActions.js:24,48 and
 *      add the missing imports
 *        `import GridRowActionHistory from '../../../../../../../../GridRowActions/GridRowActionHistory/GridRowActionHistory';`
 *      plus `useGridRowActionHistoryConfig` from `../_hooks`. Mirror
 *      StatementTemplatesRowsActions.js:7,10,80 exactly.
 *   4. Seed the worker firm with 2+ history events on the same spec
 *      (Create + Edit Minimum Fee, reusing the workerFirm pattern from
 *      C26308/C35120).
 *   5. Drive the spec: hover the row → click `span[title="History"]` →
 *      assert modal title, the 6 columns, the Create + Edit rows, and
 *      the "Close Window" button.
 *
 * Scaffolding ready to reuse once the icon ships:
 *   - Login: `loginPlatformOneAdmin` (tim1).
 *   - URL:   /react/indexReact.do#platformOne/billingCenter/specifications/{firmCd}
 *   - Row action: `span[title="History"]` (matches sister surfaces).
 *   - Modal:  the existing `useGridRowActionHistoryConfig` hook drives
 *             `modalSize='XXXL'` and renders inside a portal — assert at
 *             page scope, not inside the trigger row.
 */

const { test } = require('@playwright/test');

test('@regression C26310 View billing spec update history with before/after details', async () => {
  test.fixme(
    true,
    'Blocked on GEO-7055 (BE - Billing Spec view History, status To Do). ' +
      'Even if BillingSpecsRowsActions.js:24,48 are uncommented, the FE ' +
      'service overrides the BE response with hardcoded mock rows ' +
      '(billingSpecsServices.js:194-233, "TODO: remove after BE completes"). ' +
      'Parent story GEO-8263; automation task GEO-23253. See header for ' +
      'the three-layer unblock order (BE first, then FE service, then ' +
      'FE component).'
  );
});
