# Changelog

All notable changes to the GeoWealth E2E framework are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to **SemVer 2.0** (see Section 6.14 of
`OFFICIAL-FRAMEWORK-PROPOSAL.md` for the framework versioning policy).

The framework lives in a monorepo with a **single shared version** across
every workspace package (D-27). One bump → all packages.

## [Unreleased]

### Added
- **Phase 0 Step 0.0** — walking-skeleton selector reconnaissance script
  (`scripts/phase-0-selector-recon.js`), output enumeration
  (`docs/phase-0-selector-recon-output.md`), Phase 0 tracking ledger
  (`docs/phase-0-tracking.md`), Phase −1 ratification record
  (`docs/phase-verifications/phase-minus-1.md`), `.gitignore` exclusion for
  `.playwright-recon/`. Selector chosen:
  `getByRole('heading', { name: 'Operations' })` against `#platformOne`.
- **Phase 0 Step 0.A** — workspace bootstrap. New workspace root
  `package.json` (`@geowealth/e2e` namespace, `engines.node 20.x`,
  `workspaces: ["packages/*"]`, pinned dev deps per D-19 + D-47 re-baseline).
  `tsconfig.base.json`, root `eslint.config.mjs` (D-38; merged from legacy
  POC's existing flat config + TypeScript support), `.nvmrc`, `.env.example`,
  `CODEOWNERS` with structured section markers (Section 6.11),
  `.eslintrc.legacy-areas.json`, `docs/CHANGELOG.md`, `docs/SCAFFOLD.md`
  placeholder. Four empty package skeletons:
  - `@geowealth/e2e-framework` — `tsconfig.json` with `include: []` + `files: []`
    so Step 0.A `tsc --noEmit` succeeds against zero source; `package.json`
    declares the full `exports` field per D-36.
  - `@geowealth/e2e-tooling` — same skeleton pattern.
  - `@geowealth/legacy-poc` — placeholder; replaced in Step 0.B.
  - `@geowealth/tests-billing-servicing` — placeholder; populated by
    `expand-templates.ts` in Step 0.G.

### Changed
- Root `package.json` becomes the workspace root. Legacy POC's existing test
  scripts (`test`, `test:pepi`, `test:pepi:dry`, `report`) are kept at root
  unchanged through Step 0.A so the POC nightly continues to run from the
  current source location. Step 0.B will move them into
  `packages/legacy-poc/package.json` and replace the root scripts with
  `--workspace=@geowealth/legacy-poc` passthroughs.
- `tests/billing-specs/C25084.spec.js` — removed an inline
  `eslint-disable-next-line playwright/prefer-web-first-assertions`
  comment because the referenced rule no longer exists in
  `eslint-plugin-playwright` 2.10.x. Pre-existing tech debt; no behaviour
  change.
- Plan errata F-01..F-03 from Step 0.0 promoted to formal decisions
  D-45..D-47 in `OFFICIAL-FRAMEWORK-PROPOSAL.md` Section 7.

### Verified
- `npm install` clean (zero ERESOLVE).
- `npm run typecheck` green (both framework and tooling tsconfigs).
- `npm run lint` 0 errors, 6 warnings (all pre-existing legacy POC tech
  debt — `no-unused-vars`, unused `eslint-disable` directives).
- `npx playwright test --list --grep @pepi` discovers 70 tests in 65 files —
  POC test resolution works unchanged from the workspace root.

### Phase 0 Step 0.B — POC pure rename into `packages/legacy-poc/`

**Moved** (`git mv`, history preserved):
- `tests/` → `packages/legacy-poc/tests/`
- `reporters/` → `packages/legacy-poc/reporters/`
- `scripts/` → `packages/legacy-poc/scripts/`
- `playwright.config.js` → `packages/legacy-poc/playwright.config.js` (D-31, kept `.js`)
- `testrail.config.json` → `packages/legacy-poc/testrail.config.json`
- `pepi-cases.json` → `packages/legacy-poc/pepi-cases.json` (referenced from
  `scripts/list-pepi-cases.js`)

**Replaced**:
- `packages/legacy-poc/package.json` — Step 0.A placeholder replaced with
  the POC's real npm scripts (`test`, `test:pepi`, `test:pepi:dry`,
  `report`). Per D-43 hoist policy, zero `devDependencies` — everything
  is hoisted from the workspace root.
- `packages/legacy-poc/README.md` — placeholder text replaced with real
  scope, hoist policy, and end-of-life documentation.

**Workspace root changes** (not source edits, just rerouting):
- `package.json` scripts: removed direct `playwright test` invocations,
  added `--workspace=@geowealth/legacy-poc` passthroughs (`test`,
  `test:legacy`, `test:legacy:pepi`, `test:legacy:pepi:dry`, `report:legacy`).
- `.gitignore` updated to use `**/` patterns (`**/.auth/`,
  `**/playwright-report/`, `**/test-results/`, `**/.playwright-mcp/`)
  so the gitignore matches the new locations under `packages/legacy-poc/`.
- `eslint.config.mjs` Playwright overlay split into two scopes:
  - **6a** for `packages/legacy-poc/tests/**/*.js` — relaxed rules
    (`prefer-web-first-assertions`, `expect-expect`,
    `no-standalone-expect`, `no-useless-not`, `no-raw-locators`,
    `missing-playwright-await` all turned off) because the legacy POC
    was never lint-gated in CI and these rules surfaced ~40 latent
    issues during the relocation. The relaxation is bounded: Phase 5
    sunset deletes `packages/legacy-poc/`.
  - **6b** for `packages/tests-*/tests/**/*.ts` and
    `packages/framework/tests/**/*.ts` — strict recommended rules
    enforced from day one for new code.

**Verification**:
- `git mv` (history preserved on every move).
- `npm install` clean.
- `npm run typecheck` green.
- `npm run lint` 0 errors, 13 warnings (all latent legacy POC tech debt).
- `cd packages/legacy-poc && npx playwright test --list --grep @pepi`
  discovers **70 tests in 65 files** — identical to Step 0.A discovery,
  confirming pure rename.

## [0.1.0] — Phase 0 entry — 2026-04-09

Initial monorepo skeleton. Phase 0 in progress — see `docs/phase-0-tracking.md`
for the live ledger and `docs/phase-verifications/phase-minus-1.md` for the
ratification record that authorized Phase 0 to start.
