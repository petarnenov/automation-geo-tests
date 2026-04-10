/**
 * GeoWealth environment definitions.
 *
 * Selecting an environment at runtime: TEST_ENV=qa2 npm run test --workspace=...
 *
 * Per Decision D-09 (production safety guard) and Section 4.10 of the
 * proposal, the API client and any QA-only utility MUST refuse to call
 * `/qa/*` endpoints when the configured environment is `production`. This
 * file does not export a `production` entry by design; if a `production`
 * value is ever configured (e.g. for a release-verification smoke), it
 * goes into a separate file with explicit safeguards.
 */

export type EnvironmentName =
  | 'local'
  | 'qa1'
  | 'qa2'
  | 'qa3'
  | 'qa4'
  | 'qa5'
  | 'qa6'
  | 'qa7'
  | 'qa8'
  | 'qa9'
  | 'qa10'
  | 'qatrd';

export interface EnvironmentConfig {
  /** Short slug — used in run-summary.json and CI matrix. */
  readonly name: EnvironmentName;
  /** Base URL for navigation, ending in `/`. */
  readonly baseUrl: string;
  /** Login form action endpoint. */
  readonly loginPath: string;
  /** Hash route the SPA navigates to before login. */
  readonly loginHashRoute: RegExp;
  /** Hash routes considered "successfully logged in" for tim1. */
  readonly postLoginHashRoute: RegExp;
}

const makeQa = (n: number): EnvironmentConfig => ({
  name: `qa${n}` as EnvironmentName,
  baseUrl: `https://qa${n}.geowealth.com/`,
  loginPath: '/react/loginReact.do',
  loginHashRoute: /#login/,
  // Per Step 0.0 reconnaissance (D-45 / D-46):
  // tim1 lands on #platformOne; advisor users land on #dashboard.
  postLoginHashRoute: /#(platformOne|dashboard)/,
});

export const environments = {
  local: {
    name: 'local',
    baseUrl: 'http://192.168.1.223:8080/',
    loginPath: '/react/loginReact.do',
    loginHashRoute: /#login/,
    postLoginHashRoute: /#(platformOne|dashboard)/,
  } satisfies EnvironmentConfig,
  qa1: makeQa(1),
  qa2: makeQa(2),
  qa3: makeQa(3),
  qa4: makeQa(4),
  qa5: makeQa(5),
  qa6: makeQa(6),
  qa7: makeQa(7),
  qa8: makeQa(8),
  qa9: makeQa(9),
  qa10: makeQa(10),
  qatrd: {
    name: 'qatrd',
    baseUrl: 'https://qatrd.geowealth.com/',
    loginPath: '/react/loginReact.do',
    loginHashRoute: /#login/,
    postLoginHashRoute: /#(platformOne|dashboard)/,
  } satisfies EnvironmentConfig,
} as const satisfies Record<EnvironmentName, EnvironmentConfig>;

/**
 * Pick the active environment from `process.env.TEST_ENV`. Default: `qa2`
 * (per Section 6.2 Step 0.H — D-23 fallback to qa3 only on Phase 0 night
 * failures).
 */
export function selectEnvironment(): EnvironmentConfig {
  const requested = (process.env.TEST_ENV ?? 'local') as EnvironmentName;
  const env = environments[requested];
  if (!env) {
    throw new Error(
      `selectEnvironment: unknown TEST_ENV="${requested}". Allowed: ${Object.keys(
        environments
      ).join(', ')}.`
    );
  }
  return env;
}

/**
 * Decision D-09 production safety guard. Used by ApiClient and any QA-only
 * helper that calls `/qa/*` endpoints. The guard is intentionally simple and
 * never overridable.
 */
export function assertNotProduction(env: EnvironmentConfig): void {
  // The framework currently has no `production` entry in environments. The
  // guard exists as a defense-in-depth check in case a downstream consumer
  // ever introduces one. If it ever fires, the calling test must be
  // re-examined.
  if ((env.name as string).startsWith('prod')) {
    throw new Error(
      `assertNotProduction: refusing to operate against "${env.name}". ` +
        `/qa/* endpoints are gated to non-production environments only (D-09).`
    );
  }
}
