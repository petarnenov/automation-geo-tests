/**
 * Static instrument identifiers used by the unmanaged-assets test
 * family.
 *
 * Phase 2 step 2 (D-37). Apple Inc is treated as a globally-available
 * qa instrument that any firm (static firm 106 OR a worker-provisioned
 * dummy firm) can reference. This is a deliberate isolation
 * shortcut — the alternative is to seed instruments per dummy firm,
 * which would need a `createDummySymbol`-style endpoint that does
 * not exist. Recorded in the `project_apple_global_instrument`
 * memory; settled.
 *
 * If a Phase 4 unmanaged-assets test ever fails with "instrument not
 * found" or the expected row doesn't appear in a dummy firm's UA
 * grid, this assumption is wrong — escalate; do **not** silently
 * switch to a different instrument.
 */

/**
 * Apple Inc — the universal instrument reference for unmanaged-
 * assets test isolation. UUID is 32-char hex (entity-id format,
 * matches the `accountID` shape in `createDummyFirm` responses).
 */
export const APPLE_INC = {
  instrumentUuid: '5F5FE5576175486BAE2DA9932CEEDD6A',
  /** Symbol display in qa UI columns ("Symbol" header). */
  symbol: 'US037833EN61',
  /** Holdings display in qa UI columns ("Holdings" / "Description" header). */
  holdingsDisplay: 'APPLE INC.',
} as const;
