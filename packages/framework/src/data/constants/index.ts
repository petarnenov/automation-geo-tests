/**
 * `@geowealth/e2e-framework/data/constants` — static identifiers
 * shared across the framework and the team test packages.
 *
 * Phase 2 step 2 (D-37) initial population: firm 106 (Arnold/Delaney),
 * Plimsoll FP users (tim106 + tyler), Apple Inc as the universal
 * instrument. Subsequent additions (Schwab custodian UUIDs, the
 * "55 BPS" billing spec for C25196, etc.) land alongside the specs
 * that need them.
 *
 * Per Section 4.9 of the proposal: "Magic identifiers (UUIDs, firm
 * codes, usernames) live exclusively in `src/data/constants/`." No
 * inline UUIDs in spec files or Page Objects.
 */

export {
  ARNOLD_DELANEY,
  arnoldDelaneyAccountBillingUrl,
  arnoldDelaneyUnmanagedAssetsUrl,
  FIRM_106_CD,
} from './firm106';

export {
  PLIMSOLL_FP_ADMIN,
  PLIMSOLL_FP_TYLER,
  TIM1_ENV_VAR,
} from './users';

export { APPLE_INC } from './instruments';
