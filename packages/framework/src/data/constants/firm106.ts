/**
 * Firm 106 ("Plimsoll FP") static seed data.
 *
 * Phase 2 step 2 (D-37). Firm 106 is the legacy POC's reference
 * firm — its admin is `tim106`, its non-admin advisor is
 * `tyler@plimsollfp.com`, and its primary client/account
 * (Arnold/Delaney) is the test fixture for every read-only assertion
 * in the `account-billing` spec family.
 *
 * Why static (vs worker-firm-provisioned): firm 106 carries
 * Plimsoll-FP-specific custom roles (notably tyler's restricted
 * billing role) that `/qa/createDummyFirm.do` cannot provision. See
 * `users.ts::PLIMSOLL_FP_TYLER` and the `feedback_account_billing
 * _isolation` memory.
 *
 * **The framework's API client refuses to mutate firm 106 unless a
 * spec is explicitly tagged `@phase-2-readonly`** per Section 5.8 of
 * the proposal. firm 106 is reference data; the worker-firm fixture
 * exists precisely so writes go elsewhere. The hybrid isolation
 * pattern (legacy `feedback_account_billing_isolation` memory) is
 * the canonical example: Phase 1 mutates a worker firm, Phase 2
 * reads firm 106 + tyler.
 */

/**
 * The Arnold/Delaney household — firm 106's primary client/account
 * for read-only billing assertions. UUIDs are 32-char hex (entity-id
 * format, not standard UUID with dashes).
 *
 * Used by the legacy POC's `gotoAccountBilling` helper and inherited
 * by the framework's `AccountBillingPage.goto({ static:
 * 'arnold-delaney' })` (Phase 2 step 6).
 */
export const ARNOLD_DELANEY = {
  /** The household-level client UUID. The leading `1` in the URL is
   *  `entityTypeCd` (client = 1), NOT a firm code. */
  clientUuid: 'A80D472B04874979AAA3D8C3FFE9BD3A',
  /** The primary account UUID under Arnold/Delaney. */
  accountUuid: '5588D454741342FBB9AABA8FF17A85EE',
} as const;

/**
 * Build the Account Billing tab URL for the Arnold/Delaney account.
 * Mirrors the legacy POC's `ACCOUNT_BILLING_URL` constant. The hash
 * route uses React Router v5 hash routing per Section 4.10.2.
 */
export function arnoldDelaneyAccountBillingUrl(): string {
  return `/react/indexReact.do#/client/1/${ARNOLD_DELANEY.clientUuid}/accounts/${ARNOLD_DELANEY.accountUuid}/billing`;
}

/**
 * Build the Unmanaged Assets tab URL for the Arnold/Delaney account.
 */
export function arnoldDelaneyUnmanagedAssetsUrl(): string {
  return `/react/indexReact.do#/client/1/${ARNOLD_DELANEY.clientUuid}/accounts/${ARNOLD_DELANEY.accountUuid}/unmanagedAssets`;
}

/**
 * Firm 106 numeric firmCd. Hard-coded because the firm is the
 * Plimsoll FP firm with its specific role definitions; this is not a
 * "any firm" placeholder.
 */
export const FIRM_106_CD = 106 as const;
