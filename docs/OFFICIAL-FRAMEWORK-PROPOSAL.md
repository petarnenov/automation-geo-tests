# GeoWealth E2E Test Framework — Architecture Proposal

| Field | Value |
|---|---|
| **Document ID** | QA-ARCH-001 |
| **Status** | Draft for review |
| **Version** | 0.1 (Iteration 1 of 5) |
| **Last updated** | 2026-04-09 |
| **Author** | QA Automation |
| **Audience** | QA leads, Engineering managers, Platform / DevOps, Frontend leads |
| **Branch** | `feat/corporate-e2e-migration` |

---

## Executive Summary

The current `automation-geo-tests` repository is a **proof of concept** that has successfully delivered a tagged subset of automated tests (TestRail Run 175, `@pepi` label) against the GeoWealth qa2/qa3 environments. It validates that Playwright is a viable runner for the GeoWealth stack and has produced reusable assets — most notably a hybrid per-worker test isolation model and a library of React widget primitives.

This document proposes the evolution from POC to an **official, corporate-grade end-to-end (E2E) test framework**. The proposal:

1. Inventories the POC's strengths and the structural debt that blocks scaling.
2. Aligns the framework design with the architecture of the system under test (Struts 2 + React 18 monolith).
3. Defines a target architecture, technology stack, repository layout, and engineering conventions.
4. Specifies day-to-day operations: pipelines, secrets, observability, ownership, and flake management.
5. Lays out a phased, non-disruptive migration plan that preserves the POC's TestRail reporting throughout the transition.
6. Records decisions, dependencies, risks, and success metrics so the program is measurable from day one.

The intended outcome is a maintainable, reviewable, and scalable test asset that the QA, Engineering, and Platform organizations can jointly own.

**Headline asks of stakeholders:**
1. Approve TypeScript strict mode and the version-pinning policy (Decisions D-01, D-19).
2. **Approve the monorepo with npm workspaces** (Decision D-24, supersedes D-04) and the seven team packages (Trading, Platform, Billing & Servicing, Reporting, Investments, Integrations, Custody & PA), with the scaffold script as a Phase 1 deliverable (D-26).
3. Authorize an immediate Phase 0 day-1 credential rotation of `testrail.config.json` (Decisions D-11, D-22) and pre-decide whether the historical leak in git is rewritten or formally accepted (Decision D-20).
4. Name a single Program Owner accountable for the migration (Section 6.14) and a named Security counterpart (D-22). Phase 0 cannot start without both.
5. Nominate a CI platform and a secret store (Decisions D-02, D-03). CI is a Phase 1 deliverable, not a Phase 3 chore.
6. Commit a frontend owner for the `data-testid` rollout (Decision D-05) — and acknowledge that with seven teams this may need to be split per team. Phase 5 cannot exit without this.
7. Commit a second QA Automation contributor by the end of Phase 1 (Risk R-11, milestone M3). This is the program's hardest non-technical commitment.
8. Acknowledge the kill criteria in Section 6.14 — the program is allowed to stop, and the conditions for stopping are explicit.

---

## 1. Glossary

| Term | Definition |
|---|---|
| **SUT** | System Under Test — the GeoWealth web application (`~/nodejs/geowealth`). |
| **POC** | The current proof-of-concept suite at `~/automation-geo-tests`. |
| **POM** | Page Object Model — design pattern that encapsulates page selectors and actions in classes. |
| **Fixture** | A Playwright construct that provides setup/teardown and shared state to a test or worker. |
| **Worker** | A Playwright-managed Node.js process that executes tests in parallel. |
| **firmCd** | GeoWealth's primary multi-tenant identifier (firm code). |
| **`/qa/*`** | Struts namespace exposing test-only data-seeding endpoints, gated by GW admin role. |
| **TestRail Run 175** | The TestRail run currently mirroring the `@pepi` regression scope. |
| **Hash route** | React Router v5 hash-based URL such as `#/login`, `#/advisors`. |

---

## 2. Current State (POC) Assessment

### 2.1 Assets to Preserve

| Asset | Location | Why it stays |
|---|---|---|
| Per-worker dummy firm isolation | `tests/_helpers/worker-firm.js` | Eliminates cross-test races under parallel load by giving each worker an isolated firm via `/qa/createDummyFirm.do`. |
| React widget primitives | `tests/_helpers/ui.js` | Battle-tested helpers for `react-date-picker`, ComboBox, ag-Grid editors, numeric inputs. Hardened against several React-hydration races. |
| TestRail reporter | `reporters/testrail-reporter.js` | Working integration with retry, dual-auth (password/API key) fallback, configurable result mapping. |
| Lint and formatting baseline | `eslint.config.mjs`, `.prettierrc.json` | ESLint 10 flat config plus Playwright plugin and Prettier already enforced. |
| Hybrid isolation pattern | Documented across `account-billing/` specs | Phase 1 mutates per-worker firms; Phase 2 reads from a static shared firm. Pattern is sound and should be formalized. |

### 2.2 Structural Debt Blocking Scale-up

| Issue | Impact | Severity |
|---|---|---|
| No TypeScript (CommonJS only, JSDoc-only types) | No compile-time refactor safety; IDE assistance limited. | High |
| No Page Object Model | Selectors and workflows duplicated inline across specs. | High |
| Credentials committed in `testrail.config.json` | Security and compliance risk. | Critical |
| Hardcoded environment (`qa3.geowealth.com`) | No multi-environment switching; manual edit required to retarget. | High |
| Pattern duplication across spec families | Each `account-billing` and `create-account` spec re-implements the same outer shape. | Medium |
| Magic identifiers scattered through helpers | Apple instrument UUID, Firm 106 IDs, role usernames. | Medium |
| Ad-hoc test data generation | `Date.now().slice(-6)` for uniqueness; no factories. | Medium |
| No CI configuration | Suite is run locally only; no shared, reproducible execution. | High |
| No secret management discipline | Single `.json` file holds all credentials. | Critical |

---

## 3. System Under Test — Architectural Context

These properties of the GeoWealth application (`~/nodejs/geowealth`) directly shape framework design choices.

| Layer | Technology | Test-relevant implications |
|---|---|---|
| Backend | Java 17, Apache Struts 2 (`.do` extension), Akka actors, Gradle | Test endpoints are `.do` actions, not REST. Responses are typically JSON. |
| Frontend | React 18, Redux, React Query 5, React Router v5 (hash routing), ag-Grid Enterprise | Hash routes (`#/...`); ag-Grid Enterprise is widespread; `data-testid` coverage is sparse and inconsistent. |
| Auth | Session/cookie based, `LoginInterceptor` on every action | Multi-tenant scoping is per `firmCd`. Roles: GW admin, firm admin, advisor, client. |
| Test data hooks | `/qa/*` Struts namespace gated by `CommonGwAdminQaAction.canExecuteAction()` | `createDummyFirm`, `createInvitationToken`, `importCustodianAccount`, `simulateSchwabTransaction`, `executeMFs`, `uploadTPAMFile`, `createCrntCostBasis*`, etc. |
| Environments | `qa1`–`qa10`, `qatrd`, staging, production; each with a server template under `conf/server_templates/` | Multi-environment is a first-class need. |
| Existing QA tooling | Backend JUnit, frontend Jest. **No existing E2E framework.** | Greenfield — no legacy E2E suite to maintain or migrate. |
| Documentation | Internal Confluence under `development.geowealth.com/confluence` | Framework documentation should cross-reference Confluence where authoritative. |

---

## 4. Target Architecture

### 4.1 Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | **TypeScript (strict mode)** | Compile-time safety is essential for a long-lived suite; refactor cost dominates over time. |
| Test runner | **Playwright Test** | Already adopted, mature parallelism, built-in tracing, fixtures, and reporters. |
| Schema validation | **Zod** | Runtime validation of `/qa/*` responses; protects tests from silent backend contract drift. |
| Environment management | **`dotenv-flow`** | Layered `.env.<env>`, `.env.local`, `.env.<env>.local` semantics map naturally to qa1–qa10. |
| Test data faking | **`@faker-js/faker`** | Industry standard for synthetic names, addresses, emails. |
| Linting | **ESLint 10 flat config + `eslint-plugin-playwright` + `@typescript-eslint`** | Continuation of POC baseline (the POC already runs ESLint 10) plus TypeScript awareness. |
| Formatting | **Prettier** | Already adopted. |
| Package manager | **npm** | Continuation of POC baseline. |

### 4.2 Repository Topology — Monorepo with npm Workspaces

GeoWealth E2E is a **monorepo** built on **npm workspaces** (Decision **D-24**, supersedes D-04). It hosts one shared framework package and one test package per consuming team. New teams onboard via a scaffold script (Section 4.2.4) and are productive within minutes.

#### 4.2.1 Top-Level Layout

```
geowealth-e2e/                          ← monorepo root
├── package.json                        ← workspace root: workspaces, scripts, tooling
├── package-lock.json                   ← single lockfile for the whole monorepo
├── tsconfig.base.json                  ← shared compiler options; each package extends
├── .nvmrc                              ← Node 20 LTS pin
├── .env.example                        ← template; never holds real secrets
├── .gitignore
├── .eslintrc.legacy-areas.json         ← machine-readable freeze list (Section 6.11)
├── CODEOWNERS                          ← per-package review routing
├── packages/
│   ├── framework/                      ← @geowealth/e2e-framework — the shared substrate
│   │   ├── src/
│   │   │   ├── config/                 ← environments, dotenv-flow loader
│   │   │   ├── fixtures/               ← base, auth, firm, api fixtures + globalSetup
│   │   │   ├── pages/                  ← shared Page Objects (Login, Navigation, FirmAdmin, ...)
│   │   │   ├── components/             ← React widget primitives (ReactDatePicker, ComboBox, AgGrid, NumericInput, TypeAhead)
│   │   │   ├── api/                    ← typed clients for .do endpoints (qa/, react/, bo/)
│   │   │   ├── data/                   ← factories, constants, XLSX builders
│   │   │   ├── helpers/                ← waits, retry, uuid, cdp
│   │   │   ├── types/                  ← shared TS types mirroring Java entities
│   │   │   ├── reporters/              ← testrail-reporter (the framework owns it)
│   │   │   └── index.ts                ← public surface; what teams may import
│   │   ├── tests/                      ← framework's *own* unit/smoke tests (component classes, API client)
│   │   ├── package.json                ← name: "@geowealth/e2e-framework", version: synced
│   │   ├── tsconfig.json               ← extends ../../tsconfig.base.json
│   │   └── README.md
│   ├── tooling/                        ← @geowealth/e2e-tooling — CLI utilities (NOT consumed by tests)
│   │   ├── src/
│   │   │   ├── scaffold-team.ts        ← THE scaffold script (Section 4.2.4)
│   │   │   ├── testid-coverage.ts      ← Section 4.10.6 KPI emitter
│   │   │   ├── tracker-update.ts       ← migration tracker writer used by CI
│   │   │   └── eslint-rules/           ← local ESLint plugins (no-new-legacy-spec, ...)
│   │   └── package.json
│   ├── tests-billing-servicing/        ← @geowealth/tests-billing-servicing  (owns the entire current POC scope)
│   │   ├── tests/
│   │   │   ├── smoke/
│   │   │   ├── regression/
│   │   │   │   ├── account-billing/
│   │   │   │   ├── billing-specs/
│   │   │   │   ├── create-account/
│   │   │   │   ├── bucket-exclusions/
│   │   │   │   ├── unmanaged-assets/
│   │   │   │   ├── merge-prospect/      ← from platform-one/merge-prospect
│   │   │   │   └── auto-link/           ← from platform-one/auto-link (Phase 5 unblock)
│   │   │   └── journeys/
│   │   ├── src/pages/                  ← team-specific Page Objects
│   │   ├── playwright.config.ts        ← extends framework base config
│   │   ├── package.json                ← depends on "@geowealth/e2e-framework": "workspace:*"
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── tests-platform/                 ← @geowealth/tests-platform
│   ├── tests-trading/                  ← @geowealth/tests-trading
│   ├── tests-reporting/                ← @geowealth/tests-reporting
│   ├── tests-investments/              ← @geowealth/tests-investments
│   ├── tests-integrations/             ← @geowealth/tests-integrations
│   ├── tests-custody-pa/               ← @geowealth/tests-custody-pa
│   └── legacy-poc/                     ← @geowealth/legacy-poc — interim home for the existing POC
│       ├── tests/                      ← lifted unchanged from the current repo root tests/
│       ├── reporters/                  ← legacy JS reporter (deleted at Phase 5 sunset)
│       ├── playwright.config.js        ← legacy JS config; runs as a Playwright "project"
│       └── package.json                ← name: "@geowealth/legacy-poc", private, deleted at Phase 5 sunset
├── .github/workflows/                  ← CI matrix: per-package, per-environment, per-shard
│   ├── pr-gate.yml
│   ├── nightly.yml
│   └── scaffold-test.yml               ← runs the scaffold script in CI to detect template rot
├── docs/
│   ├── ARCHITECTURE.md
│   ├── WRITING-TESTS.md
│   ├── PAGE-OBJECTS.md
│   ├── ONBOARDING.md
│   ├── SCAFFOLD.md                     ← how to onboard a new team
│   ├── migration-tracker.md
│   ├── status-report-template.md
│   ├── CHANGELOG.md
│   ├── adr/
│   │   ├── 0000-template.md
│   │   ├── 0001-feature-area-ordering.md
│   │   └── 0002-monorepo-with-npm-workspaces.md
│   └── phase-verifications/
└── scripts/                            ← workspace-root convenience wrappers (npm scripts call these)
    ├── changed-packages.sh             ← affected-package detection for PR-gate
    └── ci-matrix.ts                    ← generates the CI matrix dynamically per PR
```

#### 4.2.2 Package Boundaries — What Goes Where

The single most important rule of the monorepo: **the framework package does not know about any team package, but every team package depends on the framework**. Dependencies flow one way only.

| Package | Depends on | Owned by | What goes here |
|---|---|---|---|
| `framework/` | (nothing internal) | QA Automation | Anything that is **reusable across two or more teams**: Page Objects for shared screens (Login, Navigation, FirmAdmin), Component classes, API client (`qa/`, `react/`, `bo/`), fixtures, factories, types, the TestRail reporter. |
| `tooling/` | `framework/` (devDep only) | QA Automation | CLI utilities. Never imported from tests. The scaffold script lives here. |
| `tests-<team>/` | `framework/` | The team | The team's specs, the team's *team-specific* Page Objects (the ones that don't generalize to other teams), the team's `playwright.config.ts` (extends a framework base config), the team's tracking issues. |
| `legacy-poc/` | (nothing) | QA Automation (interim) | The existing JS POC, lifted unchanged. Deleted at Phase 5 sunset. |

**Promotion rule.** A Page Object or helper that starts in `tests-<team>/src/` may be promoted to `framework/src/` once a *second* team needs it. Promotion is a single PR, owned by QA Automation, with the originating team listed as a co-author. Promotion is the *only* way new code lands in `framework/`.

**Anti-pattern: cross-team imports.** A spec in `tests-billing-servicing/` may **not** import from `tests-trading/`. If two teams share state or flows, the shared piece is promoted to `framework/`. CI enforces this with an ESLint rule (`local-rules/no-cross-team-import`) shipped from `packages/tooling/`.

#### 4.2.3 TypeScript and Playwright Config Hierarchy

A single `tsconfig.base.json` at the root captures every shared compiler option; each package's `tsconfig.json` extends it.

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@geowealth/e2e-framework": ["./packages/framework/src/index.ts"],
      "@geowealth/e2e-framework/*": ["./packages/framework/src/*"]
    }
  }
}
```

Each `tests-<team>/playwright.config.ts` imports a base config from the framework and overrides only what is team-specific:

```typescript
// packages/tests-billing-servicing/playwright.config.ts
import { definePlaywrightConfig } from '@geowealth/e2e-framework/config';

export default definePlaywrightConfig({
  projectName: 'billing-servicing',
  testDir: './tests',
  // Team-specific overrides ONLY:
  workers: 6,
  use: { storageState: '.auth/billing-servicing.json' },
});
```

`definePlaywrightConfig` in `framework/src/config/playwright.ts` centralizes timeouts, retries, reporters, and the production safety guard so every team inherits the same defaults.

##### 4.2.3.1 Path-Alias Pitfall (a Day-1 Footgun)

TypeScript path aliases declared in a base `tsconfig.json` are **not** automatically re-resolved relative to an extending file. They remain anchored to the file that *defined* them — which, for `tsconfig.base.json` at the workspace root, would be the workspace root. Two consequences:

1. If a path alias uses `./packages/framework/src/...` in the base config, an extending package's `tsc` will look for that path *under the package directory*, not the workspace root, and fail to resolve.
2. Putting the `paths` block only in `tsconfig.base.json` is therefore not enough. Every package's `tsconfig.json` must **duplicate** the `paths` block (with absolute or correctly-anchored paths) for IDE and `tsc` resolution to work.

The framework ships a small helper at `packages/tooling/src/tsconfig-paths.ts` that emits the correct `paths` block per package; the scaffold script writes it into every generated package's tsconfig. Manually edited tsconfigs are linted with a custom rule (`local-rules/duplicate-paths-block`) that fails CI if a package's tsconfig is missing the block.

#### 4.2.3.2 Storage-State Naming Convention

Storage states are role-keyed and per-package, written to `<package-root>/.auth/<role>.json` (gitignored). Naming rules, enforced by `auth.fixture.ts`:

| Role | File path (within a `tests-<team>` package) |
|---|---|
| `tim1` (the seed firm-106 advisor) | `.auth/tim1.json` |
| Worker dummy firm admin | `.auth/dummy-admin-<workerIndex>.json` |
| Worker dummy firm advisor | `.auth/dummy-advisor-<workerIndex>.json` |
| GW admin | `.auth/gw-admin.json` |

The framework's freshness re-validation handles expiry; a stale state file is overwritten in place, never deleted.

#### 4.2.3.3 Workspace Root Scripts

The workspace root `package.json` exposes the following scripts. Per-package scripts are invoked via `npm run <script> --workspace=@geowealth/<pkg>`.

| Script | Purpose |
|---|---|
| `npm install` | Install all workspace dependencies and link `workspace:*` packages. |
| `npm run lint` | Lint every workspace via `eslint`. |
| `npm run typecheck` | Run `tsc --noEmit` against every package's tsconfig. |
| `npm run test` | Run the smoke set across every populated package, in parallel, via the per-package matrix. |
| `npm run test:nightly` | Run the full regression set across every populated package, used by the nightly job. |
| `npm run scaffold:team -- <args>` | Invoke `packages/tooling/src/scaffold-team.ts`. |
| `npm run scaffold:doctor -- <args>` | Invoke the drift detector. |
| `npm run check-versions` | Run the single-version enforcement script (D-27). |
| `npm run changed-packages` | Print the affected-package set for the current diff. |

#### 4.2.4 Self-Service Onboarding — Goal

A single command produces a fully working package for a new team and registers it everywhere it needs to be registered, so a new team is productive within 30 minutes of running it. The detailed specification follows.

#### 4.2.5 Scaffold Script Specification

The scaffold script is a **first-class engineering deliverable**, not a one-time helper. It is owned, tested, versioned, and documented like any other piece of the framework.

##### CLI surface

```bash
# Onboard a brand new team:
npm run scaffold:team -- \
  --name "Reporting" \
  --slug reporting \
  --owner "@reporting-qa-leads" \
  --confluence "https://development.geowealth.com/confluence/display/REP" \
  --testrail-section 412

# Dry run (prints the file tree it would create, makes no changes):
npm run scaffold:team -- --name "Reporting" --slug reporting --dry-run

# Validate a previously scaffolded team is still healthy:
npm run scaffold:doctor -- --slug reporting
```

| Flag | Required | Purpose |
|---|---|---|
| `--name` | yes | Display name; used in READMEs, status reports, package descriptions. |
| `--slug` | yes | kebab-case identifier; becomes the package directory name and the npm package name suffix. Validated against `/^[a-z][a-z0-9-]+$/`. |
| `--owner` | yes | A GitHub team handle (e.g. `@geowealth/reporting-qa`); written into CODEOWNERS. |
| `--confluence` | no | Optional documentation pointer; written into the team package's README. |
| `--testrail-section` | no | Optional TestRail section ID; informs the reporter which section results post to. |
| `--dry-run` | no | Print the planned file tree, exit without writing. |
| `--force` | no | Overwrite an existing package — refuses unless explicitly given. |

##### What the script generates

For `--slug reporting`, the script produces (and verifies non-existence of) the following artifacts atomically — either all writes succeed or none do:

| Path | Source | Content |
|---|---|---|
| `packages/tests-reporting/package.json` | template | Name `@geowealth/tests-reporting`, version synced to monorepo, devDep on framework `workspace:*`. |
| `packages/tests-reporting/playwright.config.ts` | template | Calls `definePlaywrightConfig({ projectName: 'reporting', ... })`. |
| `packages/tests-reporting/tsconfig.json` | template | Extends `../../tsconfig.base.json`. |
| `packages/tests-reporting/README.md` | template | Filled with `--name`, `--owner`, `--confluence`. Includes the "first 30 minutes" checklist. |
| `packages/tests-reporting/src/pages/.gitkeep` | template | Empty `src/pages` for team-specific Page Objects. |
| `packages/tests-reporting/tests/smoke/login.spec.ts` | template | A copy of the framework's walking-skeleton spec, retagged `@reporting @smoke`. **This is the team's first green test.** |
| `packages/tests-reporting/tests/regression/.gitkeep` | template | Empty regression tree. |
| `packages/tests-reporting/.auth/.gitignore` | template | Ensures storage states are gitignored locally. |
| `CODEOWNERS` | mutate | Append `packages/tests-reporting/ @geowealth/reporting-qa @geowealth/qa-leads`. |
| `docs/migration-tracker.md` | mutate | Append a "Reporting" section header so the team's specs have a home. |
| `.eslintrc.legacy-areas.json` | mutate | Add `packages/tests-reporting` to the live (non-legacy) areas list. |
| `.github/workflows/pr-gate.yml` | mutate | Append the new package to the CI matrix `package` axis. |
| `.github/workflows/nightly.yml` | mutate | Same. |
| `package.json` (root) | mutate | (No-op — workspaces wildcard `packages/*` already matches.) |
| `docs/CHANGELOG.md` | append | One line: `- Onboarded team package @geowealth/tests-reporting (scaffold v<X>)`. |

After writing, the script:
1. Runs `npm install` at the workspace root to register the new package.
2. Runs `npm run lint --workspace=@geowealth/tests-reporting` to confirm the new package compiles cleanly.
3. Runs `npm run test:smoke --workspace=@geowealth/tests-reporting` against the configured `TEST_ENV` to confirm the sample spec is green.
4. Prints a "Next steps" message: link to `docs/WRITING-TESTS.md`, the team's README, and the migration tracker section.

##### Success SLA

> A team that runs `npm run scaffold:team` against a clean clone has a green smoke spec running locally within **30 minutes**, **provided the developer has met the following pre-conditions**:
> - Node 20 LTS installed (matches `.nvmrc`).
> - Network access to qa2 (or qa3 via `TEST_ENV` override).
> - A populated `.env.local` at the workspace root with the variables listed in `.env.example` — most importantly `TIM1_USERNAME` and `TIM1_PASSWORD`. The `docs/ONBOARDING.md` document walks new developers through populating `.env.local` from the secret store *before* running the scaffold script.
> - The `feat/corporate-e2e-migration` branch checked out (or a later branch).
>
> The 30-minute clock starts at `npm run scaffold:team` and includes `npm install`, package generation, and the smoke spec's full execution. If any pre-condition is unmet, the script exits with a clear "missing pre-condition" message and a link to `docs/ONBOARDING.md` — it does not silently fail later inside the smoke spec.

This SLA is enforced by the **scaffold-test CI workflow** (`.github/workflows/scaffold-test.yml`): on every PR that touches `packages/tooling/src/scaffold-team.ts`, any template under `packages/tooling/templates/`, or any file the script mutates, CI:

1. Runs `npm run scaffold:team -- --name "ScaffoldTest" --slug scaffold-test --owner @geowealth/qa-leads`.
2. Runs the generated package's smoke spec end-to-end.
3. Compares wall-clock time to the 30-minute SLA; fails the PR if it exceeds.
4. Cleans up: deletes the generated package and reverts the mutated files in the CI workspace.

If the scaffold-test workflow is red, the affected PR cannot merge. Template rot is impossible.

##### Templates

Templates live at `packages/tooling/templates/team/` and are valid TypeScript / JSON / YAML files with `{{name}}`, `{{slug}}`, `{{owner}}`, `{{confluence}}`, `{{testrail_section}}` placeholders. The script uses a small, dependency-free string-replace pass — no Handlebars, no Mustache, to keep the surface tiny and the failure modes obvious.

Template changes are reviewed by QA Automation; the scaffold-test workflow is the safety net. Adding a *new* artifact to the scaffold output is a single PR that updates `packages/tooling/src/scaffold-team.ts`, adds the template, and runs scaffold-test.

##### `scaffold:doctor` — drift detection

A team's package can drift over time as the framework evolves (new fixtures, new config keys, new CI matrix axes). `scaffold:doctor` re-runs the generation logic against a `--slug` and reports the diff between what the script would generate today versus what exists. Teams run it at the start of any major framework upgrade. Drift is informational, not a failure — but the report is the input to a coordinated bring-up-to-date PR.

##### Ownership and versioning

- The script lives at `packages/tooling/src/scaffold-team.ts`, owned by **QA Automation**.
- Templates are versioned via the monorepo's single version (Section 6.14 framework SemVer); a major bump to the templates requires running `scaffold:doctor` against every existing team package and producing the upgrade PRs.
- The script's CLI is documented in `docs/SCAFFOLD.md`, itself a Phase 1 deliverable.

##### Why the scaffold script is a Phase 1 deliverable, not Phase 4

Without the script, onboarding the second team is manual labour. The whole point of the monorepo is to make new-team onboarding cheap. Moving the script to Phase 1 (right after CI bootstrap) means **every team after the first is bootstrapped via the script, not by hand**. Phase 4 then exercises the scaffold across seven real teams, which is the best validation we can run.

### 4.3 Key Architectural Decisions

**Lean Page Object Model.**
Page classes encapsulate **selectors and actions only**. Assertions live in spec files so that reports show meaningful failure context. Reusable React widgets are modeled as Component classes consumed by Page classes.

**Layered fixtures (Playwright merge pattern).**
- *Worker scope*: `workerFirm`, `apiClient`.
- *Test scope*: `authenticatedPage` (per role), `testFirm` (when a fresh firm is required).
- Composition: `test = base.extend<AuthFixtures>().extend<DataFixtures>().extend<PageFixtures>()`.

**Three-tier test data strategy.**
1. **Static seeds** — Firm 106 with `tyler@plimsollfp.com` for read-only tests (fastest).
2. **Worker dummy firm** — for write-path tests, shared across the worker's lifetime.
3. **Per-test firm** — opt-in for tests that tolerate no state contamination (slowest).

**Auth via storage state and a role matrix.**
`globalSetup` logs in once for every key role (GW admin, firm admin, advisor, client) and persists their storage states. Fixtures select the right state on demand.

**Environment management.**
```typescript
// src/config/environments.ts
export const environments = {
  qa2:   { baseUrl: 'https://qa2.geowealth.com',   ... },
  qa3:   { baseUrl: 'https://qa3.geowealth.com',   ... },
  qatrd: { baseUrl: 'https://qatrd.geowealth.com', ... },
} as const satisfies Record<string, EnvironmentConfig>;
// Selection: TEST_ENV=qa2 npm test
```
No credentials in the repository. `.env.example` documents the expected variables; real `.env.<env>` files are gitignored. CI injects values from a managed secret store.

**Tagging strategy.**
- `@smoke` — critical-path scenarios under five minutes total; runs on every commit.
- `@regression` — full suite; runs nightly.
- `@billing`, `@platform-one`, `@pepi` — feature-area tags.
- `@slow` — tests exceeding sixty seconds; isolated to dedicated shards.
- `@flaky` — quarantine bucket with controlled retries until stabilized or removed.

**Reporting.**
Primary: TestRail (preserved from POC). Secondary: HTML report, Git provider annotations, Slack webhook for nightly failures. Optional: Allure if the team requests trend history.

**CI matrix.**
Sharded execution across 4–8 workers, parameterized by environment (qa2, qa3) and tag (smoke on every PR; regression nightly).

### 4.4 Page Object and Component Contracts

**Contract for Page classes.** A `Page` class is a thin façade over a single SPA route or top-level modal.

- *MUST* accept a `Page` (Playwright) in its constructor and expose only methods that perform user-meaningful actions or return locators.
- *MUST NOT* contain `expect()` assertions. Assertions remain in spec files so failure messages map to user intent.
- *MUST* expose locators as readonly properties typed `Locator`, named after the user concept (`saveButton`, `inceptionDateField`), not the implementation (`#btn-2`).
- *SHOULD* compose Component classes for any reusable widget rather than reimplement selectors inline.
- *MAY* expose a `goto()` method that internally calls `BasePage.navigateToHashRoute()`.

```typescript
// src/pages/accounts/AccountBillingPage.ts
export class AccountBillingPage extends BasePage {
  readonly editButton: Locator;
  readonly saveButton: Locator;
  readonly inceptionDate: ReactDatePicker;
  readonly historyGrid: AgGrid;

  constructor(page: Page) {
    super(page);
    this.editButton  = page.getByTestId('account-billing-edit');
    this.saveButton  = page.getByTestId('account-billing-save');
    this.inceptionDate = new ReactDatePicker(page, 'inception-date');
    this.historyGrid   = new AgGrid(page, 'billing-history-grid');
  }

  async goto(accountId: string): Promise<void> {
    await this.navigateToHashRoute(`/accounts/${accountId}/billing`);
    await this.editButton.waitFor({ state: 'visible' });
  }

  async openEditModal(): Promise<void> {
    await this.editButton.click();
  }
}
```

**Contract for Component classes.** A `Component` wraps a single reusable widget (date picker, ComboBox, ag-Grid editor) and is constructed with the `Page` plus a stable scope (`testId`, role, or container locator).

- *MUST* be safe to instantiate multiple times on the same page.
- *MUST* expose semantic verbs (`select`, `setValue`, `clear`) rather than mechanical clicks.
- *MUST* internally absorb React-hydration races so spec authors never call `waitForTimeout`.

### 4.5 Fixture Composition

The framework exports a single `test` symbol. Specs always import from `@/fixtures/base`, never from `@playwright/test` directly.

```typescript
// src/fixtures/base.ts
import { test as base, mergeTests } from '@playwright/test';
import { authFixtures }    from './auth.fixture';
import { firmFixtures }    from './firm.fixture';
import { apiFixtures }     from './api.fixture';
import { pageFixtures }    from './pages.fixture';

export const test = mergeTests(
  base,
  apiFixtures,
  authFixtures,
  firmFixtures,
  pageFixtures,
);
export { expect } from '@playwright/test';
```

```typescript
// src/fixtures/firm.fixture.ts
type FirmFixtures = {
  workerFirm: ProvisionedFirm;   // worker scope, lazy
  freshFirm:  ProvisionedFirm;   // test scope, opt-in
};

export const firmFixtures = base.extend<{}, FirmFixtures>({
  workerFirm: [async ({ apiClient }, use) => {
    const firm = await apiClient.qa.dummyFirm.create();
    await use(firm);
    // No teardown — accumulating dummy firms is an accepted product behavior.
  }, { scope: 'worker' }],

  freshFirm: async ({ apiClient }, use) => {
    const firm = await apiClient.qa.dummyFirm.create();
    await use(firm);
  },
});
```

Specs opt in by destructuring only the fixtures they need; Playwright's lazy fixture instantiation guarantees no unused setup runs.

### 4.6 Typed API Client and Schema Validation

`/qa/*` endpoints are not part of a published contract — they evolve with backend changes. The framework wraps every call in a Zod schema so contract drift fails loudly.

```typescript
// src/api/qa/DummyFirmApi.ts
const dummyFirmResponse = z.object({
  firmCd: z.number(),
  firmName: z.string(),
  admin: z.object({ username: z.string(), password: z.string() }),
  advisors: z.array(z.object({ username: z.string(), password: z.string() })),
  households: z.array(z.object({ uuid: z.string(), accounts: z.array(/* ... */) })),
});
export type DummyFirm = z.infer<typeof dummyFirmResponse>;

export class DummyFirmApi {
  constructor(private readonly client: ApiClient) {}
  async create(): Promise<DummyFirm> {
    const raw = await this.client.post('/qa/createDummyFirm.do');
    return dummyFirmResponse.parse(raw);
  }
}
```

A Zod failure surfaces a clear path-and-cause error, which is far easier to triage than a downstream `undefined.uuid` exception three layers deeper in the test.

### 4.7 Selector Strategy

Selectors are chosen using a strict priority ladder. Tests should never reach the lower rungs without justification recorded in the page object as a comment.

1. **`getByTestId('…')`** — preferred for any element under our control. Frontend coordination required (Section 6.5).
2. **`getByRole(role, { name })`** — for elements with semantic accessibility (buttons, inputs, headings, dialogs).
3. **`getByLabel('…')`** — for form fields associated with a `<label>`.
4. **`getByText('…', { exact })`** — only for content the user demonstrably reads (headings, status banners).
5. **CSS / XPath** — last resort, restricted to third-party widgets (ag-Grid Enterprise, react-date-picker) where neither test IDs nor roles are available. Each such selector is documented inline.

### 4.8 Timeouts, Retries, and Tracing

| Concern | Policy |
|---|---|
| Default test timeout | 60 s; specs that need more must call `test.setTimeout()` and document why. |
| Default action timeout | 15 s. |
| Default navigation timeout | 30 s. |
| Expect timeout | 10 s. |
| Retries | 0 locally; 1 in CI for `@regression`; 2 for `@flaky` (quarantined). Smoke tests get **zero** retries — flakes there block PRs. |
| Trace | `on-first-retry` in CI, `retain-on-failure` for smoke. |
| Screenshot | `only-on-failure`. |
| Video | `retain-on-failure`. |
| Hard waits (`waitForTimeout`) | **Banned by ESLint rule** (`playwright/no-wait-for-timeout: error`). Existing usages must be replaced with deterministic waits during migration. |

### 4.9 Test Authoring Conventions

- One spec file per TestRail case: `C<id>.spec.ts`. Title format: `@<area> C<id> <human description>`.
- Top-level structure of every spec:
  ```typescript
  test('@billing C25193 admin can change inception date', async ({
    accountBillingPage, workerFirm,
  }) => {
    await test.step('Arrange: open billing for fresh account', async () => { /* ... */ });
    await test.step('Act: edit inception date', async () => { /* ... */ });
    await test.step('Assert: change is persisted and audited', async () => { /* ... */ });
  });
  ```
- AAA structure (`Arrange → Act → Assert`) is enforced by code review, not tooling, but `test.step` titles must reflect it.
- No conditional control flow inside tests (`if`, `try`/`catch`) unless capturing state for a later assertion. The ESLint Playwright plugin enforces this.
- Magic identifiers (UUIDs, firm codes, usernames) live exclusively in `src/data/constants/`.

### 4.10 GeoWealth-Specific Patterns

The framework must absorb several quirks of the system under test so spec authors do not relearn them every time.

#### 4.10.1 Struts `.do` Action Contracts

`.do` endpoints are not REST. They behave as follows and the API client must handle each case explicitly.

| Behavior | Implication for the client |
|---|---|
| Default success: HTTP 200 with a JSON body whose top-level shape varies by action. | Every action has a dedicated Zod schema. There is no one-size envelope. |
| Validation failure: HTTP 200 with `{"errors":[…]}` or a redirect to a server-rendered error page. | The client must check for `errors` before parsing the success schema. |
| Session expiry: HTTP 302 to `/react/loginReact.do`. | The client must detect redirects and surface a typed `SessionExpiredError` instead of failing parsing. |
| File upload actions: `multipart/form-data`, max 2 GB. | The client exposes a separate `postMultipart()` path. |
| All actions require an authenticated session. | The API client always reuses the storage state of the role under which it was constructed. |

#### 4.10.2 React Router v5 Hash Routing

The SPA uses **hash-based routing** (`#/login`, `#/advisors`, `#/accounts`). Standard `page.waitForURL()` works but the predicate must compare against `page.url()` post-`#`. `BasePage.waitForHashRoute()` centralizes this:

```typescript
async waitForHashRoute(pattern: string | RegExp): Promise<void> {
  await this.page.waitForFunction(
    (p) => {
      const hash = window.location.hash.replace(/^#/, '');
      return typeof p === 'string' ? hash === p : new RegExp(p).test(hash);
    },
    typeof pattern === 'string' ? pattern : pattern.source,
  );
}
```

Lazy-loaded modules are common; navigation must wait for the route **and** for a route-anchor element (a heading or top-level container) before any further interaction.

#### 4.10.3 ag-Grid Enterprise

ag-Grid is the dominant data-grid component. The framework's `AgGrid` component must wrap the following non-obvious behaviors documented in POC tribal knowledge:

- **Virtual scrolling**: rows outside the viewport are not in the DOM. `getRow(index)` must scroll the row into view via `ensureIndexVisible()` exposed through `evaluate()` against the grid API.
- **Rich-select editors**: open the popover, wait for `.ag-rich-select-list` to be visible, then click the option by accessible text.
- **In-cell editors are double-click activated** for many columns; the component must encapsulate the right activation gesture per column type.
- **Column resizing and pinning** can change selectors silently — the component never selects by visual column index, only by `colId`.
- **Commission Fee combo only opens via a real CDP click**, not `Locator.click()` (POC discovery, kept in `project_billing_form_quirks`). The Component class must invoke `page.mouse.click()` against bounding-box coordinates as a documented fallback.

#### 4.10.4 Redux and React Query State Awareness

When DOM signals are insufficient (typically: data is in flight, no spinner), tests can subscribe to React Query's cache or Redux state via `page.evaluate`:

```typescript
// Wait for any in-flight React Query to settle.
await page.waitForFunction(() =>
  (window as any).__REACT_QUERY_CLIENT__?.isFetching() === 0
);
```

This requires the frontend to expose `__REACT_QUERY_CLIENT__` on `window` in QA builds (`FOR_QA=true`). Coordination item — see Section 6.

#### 4.10.5 Multi-Tenant Role Matrix

Every spec must declare both the **firm scope** and the **user role** it requires. The framework provides one fixture per combination:

| Role | Storage state file | Fixture name | Typical use |
|---|---|---|---|
| GW admin | `auth/gw-admin.json` | `gwAdminPage` | Access `/qa/*`, cross-firm operations. |
| Firm admin | `auth/firm-admin.json` (per firm) | `firmAdminPage` | Manage advisors, firm settings. |
| Advisor | `auth/advisor.json` (per firm) | `advisorPage` | Day-to-day account operations. |
| Client | `auth/client.json` (per firm) | `clientPage` | Client portal flows. |

Storage states for per-firm roles are produced lazily by the `workerFirm` fixture: provisioning a dummy firm yields its admin and advisor credentials, which are then logged in once and cached for the worker's lifetime.

#### 4.10.6 `data-testid` Coverage Reality

Audit of the GeoWealth React tree shows fewer than ten `data-testid` attributes across the entire SPA, all concentrated in unit tests. In practice the framework must:

1. Ship today using the role/label/CSS rungs of the selector ladder (Section 4.7).
2. Negotiate a phased `data-testid` rollout with frontend leads, prioritized by feature areas already in scope for `@regression`.
3. Track adoption as a KPI in the Section 9 metrics so the dependency is visible to leadership.

#### 4.10.7 `/qa/*` Endpoint Catalog (Test-Relevant Subset)

Sourced from `src/main/resources/struts-qa.xml`. The POC currently exercises only a few of these.

| Endpoint | Action class | Use case |
|---|---|---|
| `createDummyFirm.do` | `CommonGwAdminQaAction` | Provision an isolated firm + admin + advisors + accounts. **Foundation of worker isolation.** |
| `createInvitationToken.do` | `UserInvitationTokenQAAction` | Generate onboarding/invitation links. Required for Auto-link suite. |
| `invalidateToken.do` | `UserInvitationTokenQAAction` | Revoke tokens. |
| `importCustodianAccount.do` | `ImportCustodianCommonAction` | Seed custodian accounts on a firm. |
| `createCrntCostBasis*.do` | `CreateCrntCostBasisQAAction` | Seed cost-basis lots, daily finalization, gain/loss. |
| `executeMFs.do` | `ExecuteMFQAAction` | Simulate mutual-fund order execution. |
| `simulateSchwabTransaction.do` | `TradingMiscellaneousQAAction` | Mock Schwab broker activity. |
| `uploadTPAMFile.do` | `TradingMiscellaneousQAAction` | Test file uploads through the trading pipeline. |
| `createChildServiceRequests.do` | `ServiceRequestToolsAction` | Seed service request workflows. |
| `runTestReports.do` | `ReportsTestToolsAction` | Trigger reporting pipeline. |

The framework's `src/api/qa/` directory must grow a typed wrapper for each endpoint *before* its first consumer test, so that knowledge does not silently regress into spec files.

> ⚠️ All `/qa/*` actions are gated by `CommonGwAdminQaAction.canExecuteAction()` (GW admin role). They are **available on production** as well as QA — the framework's API client must refuse to call any `/qa/*` endpoint when the configured environment is `production`.

---

## 5. Operations

This section defines how the framework runs day to day: pipelines, secrets, observability, ownership, and the failure-handling protocols that keep the suite trustworthy.

### 5.1 Pipeline Topology

| Pipeline | Trigger | Scope | Target duration | Failure policy |
|---|---|---|---|---|
| **PR gate** | Pull request open / push | `@smoke` only, against the PR's target environment | ≤ 8 minutes wall clock | Any failure blocks merge. Zero retries. |
| **Nightly regression** | Cron `0 22 * * *` UTC (midnight CET, 17:00 US Eastern, 01:00 EET — covers the QA team's morning and the US team's previous afternoon) | `@regression` excluding `@flaky`, against qa2 *and* qa3 in parallel | ≤ 60 minutes per environment | Failures open auto-triage tickets and post to `#qa-alerts`. |
| **Quarantine** | Cron `0 0 * * *` UTC (two hours after nightly regression) | `@flaky` only | Best-effort | Results inform a weekly stabilization review; never blocks anything. |
| **On-demand** | Manual dispatch (env + tag inputs) | Caller-defined | Caller-defined | Results visible to caller, not posted to alerting. |
| **Release verification** | Triggered by deploy webhook | `@smoke + @journey`, against the deployed environment | ≤ 15 minutes | Failure rolls back the deploy via the deploy pipeline. |

### 5.2 Sharding and Parallelism

- Workers per shard: **6** (validated by POC under qa2/qa3 load).
- Shards per environment: **4** for nightly regression → effective parallelism of 24.
- Shard distribution: by spec file (Playwright's default), not by project, so duration balancing is automatic.
- Per-environment quota: nightly regression must not consume more than **40 worker-minutes per environment**, to leave headroom for ad-hoc developer runs.
- Hard cap: a single spec exceeding **5 minutes** must carry the `@slow` tag and is segregated to its own shard.

### 5.3 Secrets and Credential Management

| Secret | Storage | Injection | Rotation |
|---|---|---|---|
| `TIM1_PASSWORD`, role passwords for shared seed users | CI secret store (chosen platform's native vault) | Environment variables at job start; never written to disk except as `.env.<env>.local` inside the runner sandbox. | Quarterly, coordinated with the GeoWealth security team. |
| `TESTRAIL_USER`, `TESTRAIL_API_KEY` | CI secret store | Same | Annually, or on team membership change. |
| `/qa/*` admin credentials | CI secret store, separate scope from above | Same | Quarterly. |
| Local developer credentials | Personal `.env.<env>.local` (gitignored) | Loaded by `dotenv-flow` | Personal responsibility. |

Hardcoded credentials in `testrail.config.json` (current POC state) are removed in Phase 3 of the migration. The file becomes config-only and ships in version control with no secret material.

The framework includes a pre-commit hook (`detect-secrets` or equivalent) that fails commits introducing high-entropy strings into tracked files.

### 5.4 Branch Protection and Quality Gates

Required checks on the framework repository's default branch:

1. **Lint** — ESLint + Prettier, zero warnings.
2. **Type check** — `tsc --noEmit`, zero errors.
3. **PR gate pipeline** — `@smoke` green on at least one environment.
4. **Coverage of changed Page Objects** — any new Page Object class must be exercised by at least one spec in the same PR.
5. **No skipped specs added** — `test.skip` and `test.fixme` introductions require an explicit `// QA-ARCH-001:waived <ticket>` comment, enforced by a custom ESLint rule.
6. **Two reviewers**: one QA, one engineer from the feature's owning team (per Section 5.7 ownership map).

### 5.5 Observability

| Signal | Where it lands | Retention |
|---|---|---|
| Playwright HTML report | CI artifact | 14 days |
| Playwright trace (`.zip`) | CI artifact, only on failure or first retry | 14 days |
| Screenshots and videos | CI artifact, on failure | 14 days |
| TestRail results | TestRail | Permanent |
| Structured run metadata (env, sha, duration, pass/fail counts) | Time-series store (Prometheus push gateway, Datadog, or equivalent — TBD) | 1 year |
| Slack notifications | `#qa-alerts` (failures), `#qa-trends` (weekly summary) | Slack default |

The framework emits a final JSON summary per run (`run-summary.json`) that the CI uploader forwards to the time-series store. This unblocks the KPIs in Section 9.

### 5.6 Flake Management

- **Definition.** A spec is `@flaky` when it fails non-deterministically more than once in any rolling 14-day window without an associated product change.
- **Quarantine SLA.** Within 24 hours of a flake being identified, the spec is tagged `@flaky` and no longer gates PRs.
- **Stabilization SLA.** Quarantined specs must be either fixed, rewritten, or deleted within **10 working days**. The owning team is notified at days 3, 7, and 10.
- **Flake budget.** The aggregate `@regression` flake rate must stay below **2%** week over week. Crossing the budget freezes new test additions until the rate recovers.
- **Triage automation.** Nightly failures are clustered by failure signature; clusters with three or more occurrences in seven days are auto-tagged `@flaky` for human review.

### 5.7 Ownership and RACI

| Concern | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Framework core (`src/`) | QA Automation | QA Lead | Engineering, Platform | All engineering |
| Spec correctness per feature area | Feature team's QA contact | Feature team lead | QA Automation | Product |
| `data-testid` adoption | Frontend leads | Frontend team lead | QA Automation | QA Lead |
| `/qa/*` endpoint stability | Backend team owning each action | Backend team lead | QA Automation | QA Lead |
| Environment health (qa2, qa3, qatrd) | Platform / DevOps | Platform lead | QA Automation | All teams |
| Secret rotation | Security | Security lead | QA Automation | QA Lead |
| TestRail integration | QA Automation | QA Lead | — | Product |

A `CODEOWNERS` file in the framework repository encodes this map for PR review routing.

### 5.8 Test Data Lifecycle

- **Dummy firms accumulate by design** (POC decision, preserved). The framework does not delete them.
- **Audit cadence.** Quarterly review with the Platform team to confirm dummy firm growth is not impacting environment performance.
- **Naming.** All firms created by the framework carry an `e2e-` name prefix and a creation timestamp, so manual cleanup remains possible if ever needed.
- **Static seed protection.** Firm 106 and `tyler@plimsollfp.com` are reference data. The framework's API client refuses to mutate either when a spec is not explicitly tagged `@phase-2-readonly`.

### 5.9 Environment Health Pre-flight

Before any nightly run begins, a **pre-flight job** verifies:

1. **The target environment is reachable.** A `GET /` against the base URL returns within 5 seconds. (The previous "GET /react/loginReact.do" was wrong — that endpoint expects a POST and a bare GET returns the login form, which would mask auth failures.)
2. **`tim1` can authenticate end-to-end.** Pre-flight performs a real `POST /react/loginReact.do` with credentials and asserts that the response sets a session cookie and redirects to `#/dashboard` or equivalent. This is the only check that proves the env is *actually usable*.
3. **`/qa/createDummyFirm.do` returns within 30 seconds** (with the GW-admin storage state attached).
4. **The internal Confluence link for QA documentation is reachable** (best-effort, non-blocking).

Pre-flight failures abort the run with a clear environment-health error rather than hundreds of confusing spec failures, and the on-call Platform engineer is paged.

**Transient-degradation caveat.** Pre-flight runs once at the *start* of the nightly. If the environment degrades after pre-flight passes but before specs finish, the rest of the run continues against an unhealthy environment. This is intentional: pre-flight catches durable degradation, not transient flicker. Spec-level retries (Section 4.8) and the flake budget (Section 5.6) absorb transient blips. Don't argue this in incident retros — the trade-off is documented.

**Manual override.** Decision D-23 / Section 6.9: an on-call QA engineer can set `SKIP_PREFLIGHT=1` to force a run when pre-flight has a known false positive. The override is audited in `run-summary.json` and triggers a follow-up issue against pre-flight if used twice in any rolling 7-day window.

---

## 6. Migration Plan

The migration is **incremental and non-disruptive**. The existing POC continues to deliver TestRail Run 175 results throughout the transition; legacy specs are retired only after their replacements satisfy a documented parity gate.

### 6.1 Guiding Principles

1. **Security first.** Committed credentials are a Critical-severity finding (Section 2.2) and are addressed in Phase 0, not at the end.
2. **CI before content.** Continuous validation must exist before the first migrated spec lands, so quality is enforced from the first commit, not retrofitted.
3. **Walking skeleton, then breadth.** Phase 0 ends with the smallest possible vertical slice that exercises every architectural layer end-to-end.
4. **Parity gate before deletion.** Legacy specs are deleted only after their replacements run green for **five consecutive nightly runs** on the target environment.
5. **POC freeze.** Once the migration enters feature-area work, no new tests are added to the legacy `tests/<feature>/` directories — only bug fixes and stabilization.
6. **One feature area in flight at a time.** Concurrent migration of multiple areas multiplies risk and review burden; sequence them.

### 6.2 Phase 0 — Foundation & Security Hotfix

**Goal.** Make the repository safe and lay the TypeScript foundation. End with a single trivial smoke spec running locally under the new architecture.

**Technical preconditions (version pins, recorded as decision D-19).**

| Tool | Pinned version | Why |
|---|---|---|
| Node.js | `20.x LTS` (declared in `package.json` `engines` and `.nvmrc`) | Matches Playwright 1.47 baseline; LTS lifecycle until 2026-04. |
| `@playwright/test` | `~1.47.0` | POC baseline; `mergeTests` is stable from 1.45 onward. |
| TypeScript | `~5.5` | Required for Playwright 1.47 type compatibility. |
| Zod | `~3.23` | Last stable 3.x; pinned to avoid 4.x breaking changes. |
| `dotenv-flow` | `~4.1` | CJS-compatible; verified against Playwright's loader. |
| ESLint | `~10.2` (matches POC) | Avoid lockfile churn; the POC already runs ESLint 10. |

A `package-lock.json` is committed; CI uses `npm ci` exclusively. No floating ranges.

**Scope (executed in this strict order — each step is one PR or one logical PR cluster, and the POC nightly is verified green at every step boundary).**

The two cardinal rules:
- **Rule 1:** *Never mix relocation with content change in the same commit.* Moves are pure renames; refactors happen at the new path.
- **Rule 2:** *The framework's foundational layer (auth fixture, globalSetup, `definePlaywrightConfig`) is built **before** the bootstrap consumer needs it.* Phase 0 builds a functional `packages/framework/` — it is not "empty until Phase 2".

*Step 0.0 — Walking-skeleton selector reconnaissance (must complete before Step 0.A starts).*
- Manually log into qa2 as `tim1` and inspect the dashboard DOM. **Identify the exact accessible-name selector** the walking skeleton will assert against. Record the chosen selector — its tag, role, accessible name, and the element's surrounding context — in the Phase 0 tracking issue. Without this, Step 0.F's walking-skeleton spec is a blind guess and will fail on day one.
- The selector must be reachable via Playwright's role/label/text rungs (Section 4.7); CSS-only fallbacks are recorded as a risk and re-attempted after the first `data-testid` rollout in Phase 3.
- This 30-minute reconnaissance is the cheapest possible insurance against a Phase 0 demo failure.

*Step 0.A — Workspace bootstrap (no POC changes yet).*
- Initialize the npm workspace at the repository root: workspace `package.json` with `"workspaces": ["packages/*"]`, `engines.node = "20.x"`, the pinned dependency block (D-19), `tsconfig.base.json`, root `.gitignore`, **a single workspace-root `eslint.config.mjs` flat config** (D-38) that absorbs the existing POC's `eslint.config.mjs` content and adds per-package overrides for the new packages, `.nvmrc`, `.env.example`, `CODEOWNERS` (initially empty for legacy paths) with the structured section markers (Section 6.11), `.eslintrc.legacy-areas.json` (empty array), `docs/CHANGELOG.md` (initialized with a `0.1.0` heading), `docs/SCAFFOLD.md` (placeholder explaining the templates exist, full content lands in Phase 1).
- `tsconfig.base.json` is configured per Section 4.2.3, with **the path-alias caveat from Section 4.2.3.1 explicitly applied** — paths are duplicated in each extending `tsconfig.json`, not inherited.
- Create the four package skeletons as empty directories with valid `package.json` files only (no source code yet): `packages/framework/`, `packages/tooling/`, `packages/legacy-poc/`, `packages/tests-billing-servicing/`. The framework's `src/index.ts` is **not** created in Step 0.A — it lands in Step 0.F as the real public-surface re-export defined by D-36. Step 0.A's tsc walk uses the empty directory itself as the input. The six other team packages (`tests-platform`, `tests-trading`, `tests-reporting`, `tests-investments`, `tests-integrations`, `tests-custody-pa`) are **not** created in Step 0.A — they are generated by the scaffold script in Phase 1 from a known-good template.
- Verify `npm install` at the root produces a clean lockfile and `tsc -p packages/framework/tsconfig.json --noEmit` succeeds against the empty skeleton.
- The POC at the repository root is **not touched** in Step 0.A. It continues to run from `tests/`, `reporters/`, `playwright.config.js` exactly as before.

*Step 0.B — POC relocation (pure rename, single PR).*
- Move the existing POC into `packages/legacy-poc/` as a **pure rename**: `tests/` → `packages/legacy-poc/tests/`, `reporters/` → `packages/legacy-poc/reporters/`, `playwright.config.js` → `packages/legacy-poc/playwright.config.js` (still `.js`, **not renamed to `.ts`** — see decision D-31), `scripts/` → `packages/legacy-poc/scripts/`, `testrail.config.json` → `packages/legacy-poc/testrail.config.json`. The legacy `eslint.config.mjs` is **not** moved — its rules were merged into the workspace root config in Step 0.A (D-38).
- `package.json` and `package-lock.json` at the root are *replaced* (not moved) by the workspace root files from Step 0.A. **Legacy-poc hoist policy (D-43):** `packages/legacy-poc/package.json` declares **only** the dependencies that diverge from the workspace root pin (today: none — the legacy POC and the framework target the same Playwright version). All shared dependencies are hoisted from the root. This avoids dual-dependency drift; the single lockfile at the workspace root is authoritative. If the legacy POC ever needs a divergent version, declare it explicitly in `packages/legacy-poc/package.json` and accept the duplication for that one dep.
- The relocation PR contains **only** moves and the new `legacy-poc/package.json`. No source-code edits. `git mv` preserves history.
- Verify the POC nightly runs green from `packages/legacy-poc/` via `npm run test --workspace=@geowealth/legacy-poc`. If it doesn't, the PR is reverted and the relocation strategy is re-examined before any further work.

*Step 0.C — POC env-var refactor (in the new location).*
- **Inventory first.** Run `grep -rn "testrail.config" packages/legacy-poc/` and produce a list of every reference. The POC has at least five files reading `testrail.config.json` (`reporters/testrail-reporter.js`, `playwright.config.js`, `tests/_helpers/global-setup.js`, `tests/_helpers/qa3.js`, `tests/_helpers/worker-firm.js`); the inventory is recorded in the Phase 0 tracking issue.
- Refactor every reference to read from `process.env`. The values in `packages/legacy-poc/testrail.config.json` are temporarily moved into a workspace-root `.env.local` (gitignored) and the JSON file becomes secret-free.
- Verify POC nightly is green from the new location with old credentials before Step 0.D.

*Step 0.D — Credential rotation (with sandbox dry-run first).*
- **Dry-run first** against a throwaway TestRail user and a throwaway GeoWealth dummy admin per the dry-run requirement in Section 6.14. The dry-run validates that (a) the env-var refactor reaches every reference, (b) the secret-store handoff works end-to-end, (c) the rollback path is exercised.
- Coordinate with the named Security counterpart (D-22) to rotate every credential previously committed. Treat the old values as compromised.
- Update the secret store and every developer's `.env.local` in lockstep with the rotation.
- Verify POC nightly is green within 24 hours of rotation; if not, restore from the secret store and root-cause before proceeding.

*Step 0.E — Git history audit and rewrite-vs-accept decision.*
- Add `detect-secrets` as a workspace devDependency at Phase 0 entry. Wire it into a `husky` (or equivalent) **pre-commit hook** at `packages/tooling/scripts/pre-commit-secrets.sh`; the hook fails any commit that introduces a high-entropy string into a tracked file. The hook is committed in Step 0.A as part of the workspace bootstrap, *before* any rotation work begins.
- Run `detect-secrets scan --all-files` against the working tree and `git log --all -p | detect-secrets scan` against the history. Produce a report.
- **Binary decision recorded as D-20**, owned by Security: *rewrite history* (`git filter-repo`, force-push, every clone re-clones) or *formally accept* the historical exposure (rotated credentials are no longer valid, so the leak is harmless going forward). The plan does not pre-decide.
- If rewrite is chosen: schedule for a known-quiet window; notify every developer to re-clone; update the Confluence space with the new HEAD SHA.

*Step 0.F — Framework foundational layer (the bare minimum for the walking skeleton).*
- Build the framework's *foundational* surface only — not the full Component library, not the full API client. Phase 0's framework deliverables are exactly what the walking skeleton needs to consume:
  - `packages/framework/src/config/environments.ts` — typed environment definitions covering qa2, qa3, qatrd.
  - `packages/framework/src/config/playwright.ts` — exports `definePlaywrightConfig(opts)`, the function every team's `playwright.config.ts` calls. Centralizes timeouts, retries, reporters, and the production safety guard (D-09). **In Phase 0 the reporter list is just `[['list'], ['html', { open: 'never' }]]`** — the framework's TS TestRail reporter does not exist yet (Phase 1 deliverable). `definePlaywrightConfig` reads an env var `TESTRAIL_REPORTING=on` and *conditionally* appends the TestRail reporter only when present, so Phase 0 specs run cleanly without referencing an unbuilt reporter.
  - `packages/framework/src/config/dotenv-loader.ts` — `dotenv-flow` wrapper that resolves `.env.<env>.local` from the workspace root.
  - `packages/framework/src/fixtures/globalSetup.ts` — logs in `tim1` once per execution and writes a storage state under `<package-root>/.auth/<role>.json`.
  - `packages/framework/src/fixtures/auth.fixture.ts` — exposes `authenticatedPage` per role, with **storage-state freshness re-validation**. The check runs **once per worker per execution**, not per test, by reading the storage-state file's `mtime` and skipping re-validation if it is newer than `(GW_SESSION_TTL_MINUTES − safety_margin)`. Only when the cached state is potentially stale does the fixture issue a real authenticated request (`GET /react/index.do` with the storage state attached, expecting a 200 with a non-redirected URL); a 302 to login re-runs the login and rewrites the file. This bounds the extra HTTP volume to **N workers per nightly**, not N × tests, and protects qa2 from unnecessary login pressure (R-15 / Section 6.2 Step 0.H).
  - `packages/framework/src/fixtures/base.ts` — the composed `test` and `expect` exports that every spec imports.
  - `packages/framework/src/index.ts` — public surface re-export.
  - `packages/framework/package.json` — name `@geowealth/e2e-framework`, version synced with the monorepo, and an explicit **`exports` field** (D-36) listing every importable subpath:
    ```json
    "exports": {
      ".":            "./src/index.ts",
      "./config":     "./src/config/index.ts",
      "./fixtures":   "./src/fixtures/index.ts",
      "./pages":      "./src/pages/index.ts",
      "./components": "./src/components/index.ts",
      "./api":        "./src/api/index.ts",
      "./reporters":  "./src/reporters/index.ts",
      "./helpers":    "./src/helpers/index.ts",
      "./types":      "./src/types/index.ts"
    }
    ```
    Subpath imports outside this list are forbidden by Node's resolver and by an ESLint rule (`local-rules/framework-exports-only`). The `exports` field grows in lockstep with the framework.
  - `packages/framework/tsconfig.json` — extends `../../tsconfig.base.json` *with the paths block duplicated locally* (Section 4.2.3.1).
- The framework's TestRail reporter, full Component library, full API client, factories, and types are deferred to Phase 2 — they are *not* Phase 0 deliverables. Phase 0 builds only what the walking skeleton needs.

*Step 0.G — Scaffold templates first, bootstrap billing-servicing from them.*
- **Step 0.G.1 — Substitution function first.** Before any template is authored or any package is generated, write `packages/tooling/src/substitute.ts` exporting a single pure function `substitute(template: string, vars: Record<string, string>): string`. This is the **one substitution mechanism** used by both the manual Phase 0 expansion and the future Phase 1 scaffold script. Two callers, one implementation, no drift possible. The function ships with unit tests covering the placeholder set (`{{name}}`, `{{slug}}`, `{{owner}}`, `{{confluence}}`, `{{testrail_section}}`).
- **Step 0.G.2 — Author the templates** at `packages/tooling/templates/team/` and enumerate them explicitly:
  - `package.json.tpl` — name `@geowealth/tests-{{slug}}`, version synced, devDep on framework `workspace:*`.
  - `tsconfig.json.tpl` — extends `../../tsconfig.base.json` with the path-block duplicated locally (Section 4.2.3.1).
  - `playwright.config.ts.tpl` — calls `definePlaywrightConfig({ projectName: '{{slug}}', ... })`.
  - `README.md.tpl` — fills `{{name}}`, `{{owner}}`, `{{confluence}}`, includes the "first 30 minutes" checklist.
  - `tests/smoke/dashboard.spec.ts.tpl` — the walking-skeleton spec, named **`dashboard.spec.ts` not `login.spec.ts`** so future team specs at `tests/smoke/login.spec.ts` do not collide and so the per-team spec count is honest about what it tests.
  - `tests/regression/.gitkeep.tpl`, `src/pages/.gitkeep.tpl`, `.auth/.gitignore.tpl`, `.gitignore.tpl`.
- **Step 0.G.3 — Generate the bootstrap.** A tiny Node script `packages/tooling/scripts/expand-templates.ts` reads every template, calls `substitute` with `slug=billing-servicing`, and writes the output under `packages/tests-billing-servicing/`. The same script is invoked by the future scaffold-team CLI in Phase 1 — the CLI is a thin wrapper that adds CODEOWNERS / tracker / CI matrix mutations on top.
- **Step 0.G.4 — Verify parity.** `packages/tooling/scripts/verify-bootstrap-vs-templates.ts` re-runs `substitute` over the templates and diffs the result against the on-disk `packages/tests-billing-servicing/` files. The script runs in CI on every PR that touches templates, the bootstrap, or the substitute function itself, and fails if any byte differs. **This eliminates D-34's drift problem on day one.**
- **Walking-skeleton naming-collision policy:** the walking-skeleton spec is `dashboard.spec.ts`, not `login.spec.ts`. When teams add their own smoke specs (`login.spec.ts`, `home.spec.ts`, etc.), no collision is possible. The scaffold script still refuses to overwrite an existing package without `--force`.
- **Login pressure across seven team packages.** Even with distinct spec names, every per-team smoke nightly logs in `tim1` to verify the dashboard. Seven teams × N workers × every nightly = real load on qa2's `/react/loginReact.do`. The framework's `auth.fixture.ts` writes its storage state to the **workspace-root** `.auth/tim1.json` (D-41, see below) so every team package shares one file and one login per nightly, not seven.
- The walking-skeleton spec consumes the framework's `authenticatedPage` fixture and asserts `getByRole('heading', { name: /dashboard/i })`. **Inline login is forbidden** so future spec authors copy the right pattern.

*Step 0.H — Confluence, tracking, and target environment.*
- Create the Confluence space for living documentation; link this proposal as the first page.
- Open the Phase 0 tracking issue with the exit-criteria checklist below.
- Set `TEST_ENV=qa2` as the default for the walking skeleton. **qa2 stability fallback (D-23):** if qa2 is unhealthy for two consecutive Phase 0 nights, switch to qa3 via `TEST_ENV=qa3` and escalate qa2 to Platform.

**Deliverables.**
- Workspace root: `package.json` with `"workspaces": ["packages/*"]` and `engines.node = "20.x"`, `package-lock.json`, `tsconfig.base.json` (with framework path aliases), `.env.example`, `.nvmrc`, `CODEOWNERS`, `.eslintrc.legacy-areas.json`.
- `packages/legacy-poc/` containing the entire former POC, nightly green from its new home.
- `packages/framework/` empty skeleton (`@geowealth/e2e-framework`).
- `packages/tooling/` empty skeleton (`@geowealth/e2e-tooling`).
- `packages/tests-billing-servicing/` hand-written bootstrap consumer (`@geowealth/tests-billing-servicing`), with `playwright.config.ts`, the walking-skeleton smoke spec, and `globalSetup` + `authenticatedPage` fixture in the framework package.
- POC refactored to read credentials from environment variables; nightly green from `packages/legacy-poc/` before *and* after credential rotation.
- Storage-state freshness re-validation built into the framework `auth.fixture.ts`.
- `docs/adr/` directory created with `0000-template.md`; ADR-0001 (Phase 4 ordering rationale) and ADR-0002 (monorepo with npm workspaces) authored.
- `docs/status-report-template.md`, `docs/phase-verifications/` directory, `docs/migration-tracker.md` (with the schema header but no rows yet — populated during Phase 4), `docs/RETROSPECTIVE.md` template (sections: scope and outcomes, what worked, what hurt, decisions to revisit, next-program asks).
- `docs/SCAFFOLD.md` placeholder (filled in Phase 1 when the script lands).
- Confluence space created and linked to this document.
- Security-rotation sign-off recorded against decision **D-11**; history-rewrite decision recorded as **D-20**.
- Repository tagged `v0.1.0` at Phase 0 exit.

**Exit criteria.**
- [ ] Zero committed secrets verified by `detect-secrets` against the working tree and against the last 100 commits.
- [ ] `npm run lint`, `tsc --noEmit`, and the walking-skeleton spec all green locally.
- [ ] Existing legacy POC specs still pass unchanged (`allowJs` regression check).
- [ ] Security has confirmed credential rotation in writing.

**Dependencies resolved by entry:** D-01 (TypeScript), D-04 (repo topology), D-07 (run-175 cadence).

---

### 6.3 Phase 1 — CI Bootstrap, Per-Package Matrix, and Scaffold Script

**Goal.** Stand up the CI platform with per-package matrix support, ship the scaffold script as a first-class deliverable, and ensure every subsequent change to any package is continuously validated.

**Phase 1 size note.** Phase 1 was previously sized M (CI bootstrap only). With the scaffold script, the affected-detection plumbing, the TestRail reporter port, and the per-package CI matrix all in scope, **Phase 1 is re-sized to L** (D-29). Planned relative duration is 2–3 working weeks.

**Scope.**
- Provision the chosen CI platform (D-02) and secret store namespace (D-03).
- Implement the **PR gate** pipeline (Section 5.1) with **per-package affected detection** (see "Affected-package detection" below). Lint and type-check the entire workspace; run smoke specs only for packages whose source (or whose framework dependencies) changed in the PR. The walking-skeleton spec in `packages/tests-billing-servicing/` is the initial gating spec.
- Implement the **nightly regression** pipeline shell with the same per-package matrix; initially only `legacy-poc` and `tests-billing-servicing` have content, but the matrix is generated dynamically so adding a new team package via the scaffold script automatically extends the matrix without CI edits.
- Implement the **environment health pre-flight** (Section 5.9) and gate nightly runs on it.
- Port the TestRail reporter to TypeScript at `packages/framework/src/reporters/testrail-reporter.ts`; validate against a *separate* TestRail sandbox run created for the migration. **The TS reporter never points at Run 175 while the JS reporter is also pointed at it** — two reporters writing to the same run produces interleaved, contradictory results. The cutover from JS-on-Run-175 to TS-on-Run-175 is atomic, single-PR, and happens at the moment of POC sunset (Phase 5), not during Phase 1 or Phase 2.
- Wire `run-summary.json` emission per-package and (best-effort) push to the time-series store. If the time-series store is not yet provisioned, store the JSON as a CI artifact and revisit in Phase 2.
- Establish branch protection on the framework repository per Section 5.4, including per-package CODEOWNERS.
- **Build the scaffold script** at `packages/tooling/src/scaffold-team.ts` per Section 4.2.5. Author all templates under `packages/tooling/templates/team/` (re-using the templates already authored in Phase 0 Step G). Implement `scaffold:doctor`. Add the **scaffold-test workflow** that runs the script end-to-end on every PR touching the templates and validates the 30-minute SLA — with the secrets-injection contract below.
- Author `docs/SCAFFOLD.md` documenting the CLI surface, template structure, and onboarding flow.
- **Scaffold the six empty team packages.** Once the script is green via the scaffold-test workflow, run it six times: `npm run scaffold:team -- --slug platform --name "Platform" --owner @geowealth/platform-qa`, then `--slug trading --name "Trading"`, `--slug reporting`, `--slug investments`, `--slug integrations`, `--slug custody-pa`. Each run produces a complete package with a green `dashboard.spec.ts` smoke spec, a CODEOWNERS row, a CI matrix entry, and a migration tracker section header. The six packages remain empty of regression content until their teams begin authoring tests post-Phase-5.

**Affected-package detection (`scripts/changed-packages.ts`).**
The script is real work, not a hand-wave. It is implemented in TypeScript under `packages/tooling/src/changed-packages.ts` and exposed to CI via a thin shell wrapper at `scripts/changed-packages.sh`. Algorithm:

1. Compute the changed file set: `git diff --name-only "$BASE_SHA" HEAD`.
2. Map each changed file to its owning workspace package by walking up to the nearest `package.json`. Files outside `packages/` (root config, workflows, docs/adr, tooling templates) trigger the **"all packages"** fallback because their effect on dependents is hard to bound.
3. Build the workspace dependency graph by reading every `packages/*/package.json`'s `dependencies` and `devDependencies` for `workspace:*` references.
4. Compute the **transitive closure** of dependents for each directly-affected package. Example: a change in `packages/framework/src/components/AgGrid.ts` directly affects `framework`; transitively it affects every team package that depends on `framework`.
5. Emit JSON to stdout: `{"packages": ["@geowealth/framework", "@geowealth/tests-billing-servicing", ...]}`.
6. The CI matrix consumes this JSON via `scripts/ci-matrix.ts` and produces the per-shard job spec.

The script has **its own unit tests** under `packages/tooling/tests/changed-packages.test.ts` covering: a framework-only change, a single-team change, a tooling-only change (full fallback), and a root-config change (full fallback).

**Multi-package CI invocation.**
Each package owns its own `playwright.config.ts` (or `playwright.config.js` for `legacy-poc`). CI invokes them per-package with `npm run test --workspace=<pkg>`. There is **no top-level `playwright.config.ts`** that aggregates multiple packages — multi-config aggregation is fragile and obscures per-package failure attribution. The trade-off is that CI runs N Playwright invocations in parallel; this is fine because each is sandboxed and reports independently.

**TestRail aggregation across packages (D-30).**
Per-package nightly runs each emit their own TestRail payload via the framework's TS reporter. To avoid race conditions on TestRail's `add_results_for_cases` endpoint, the per-package reporters write to **per-package result files** under `<package-root>/test-results/testrail-results.json`, and a single **post-processing job** at the end of the nightly aggregates all per-package result files and POSTs to TestRail Run 175 in **one** call. The post-processing job lives at `packages/tooling/src/testrail-aggregator.ts`. Phase 5 sunset removes the old JS reporter; the aggregator stays.

**Single-version enforcement (D-27).**
A pre-commit hook and a CI lint check both run `packages/tooling/src/check-versions.ts`, which reads every `packages/*/package.json` and the workspace root `package.json`, asserts that `version` is identical across all of them, and fails the commit / PR if not. The enforcement script is part of the Phase 1 deliverables.

**Scaffold-test secrets-injection contract.**
The scaffold-test CI workflow generates a fresh `tests-scaffold-test` package and runs its smoke spec. The smoke spec needs working credentials. The contract:

1. CI passes `TIM1_USERNAME`, `TIM1_PASSWORD`, and `TEST_ENV` as job-level env vars from the secret store.
2. The scaffold script's generated package reads these from `process.env` via the framework's `dotenv-loader`. There is **no** `.env.local` file in CI; `dotenv-flow` falls through to `process.env` when no file exists.
3. After the smoke spec finishes (green or red), the workflow deletes the generated package, reverts CODEOWNERS / migration tracker / `.eslintrc.legacy-areas.json` / CI matrix mutations, and exits with the smoke spec's exit code.
4. Cleanup runs in `if: always()` so a failed smoke spec still leaves the workspace clean.
5. The entire workflow runs in an isolated GitHub Actions / GitLab CI runner — never on a self-hosted runner, to prevent state leakage.

**Deliverables.**
- CI workflow files (`.github/workflows/pr-gate.yml`, `nightly.yml`, `scaffold-test.yml`).
- Per-package CI matrix generated dynamically from the workspace; the `framework` package itself is one matrix entry, with its own component-class smoke specs running on the same nightly cadence.
- `packages/tooling/src/changed-packages.ts` (with unit tests) and `scripts/changed-packages.sh` thin wrapper.
- `packages/tooling/src/ci-matrix.ts` and the corresponding shell wrapper.
- `packages/framework/src/reporters/testrail-reporter.ts` validated against a sandbox run.
- `packages/tooling/src/testrail-aggregator.ts` (the post-processing step that aggregates per-package result files into one TestRail POST per nightly).
- `packages/tooling/src/check-versions.ts` (single-version enforcement) wired into pre-commit and CI.
- Pre-flight health-check script under `packages/tooling/src/preflight.ts`.
- Branch-protection rules applied; per-package CODEOWNERS in place with the structured section markers (Section 6.11).
- `run-summary.json` artifact produced by every run, per package.
- `packages/tooling/src/scaffold-team.ts` + templates + `docs/SCAFFOLD.md`.
- Scaffold-test workflow green; SLA budget enforced; secrets-injection contract honored.

**Exit criteria.**
- [ ] PR gate runs on every PR in under 8 minutes for the smallest affected matrix; failing it blocks merge. **Scaffold-test runs in a parallel job, not in series with the gate**, so its wall clock does not count against the 8-minute budget.
- [ ] Nightly regression runs against qa2 *and* qa3 in parallel for every populated package, including the `framework` package's own component smoke specs.
- [ ] Pre-flight aborts the nightly cleanly when an environment is unhealthy.
- [ ] TestRail reporter posts results from the new pipeline to a dedicated migration sandbox run for **at least 5 consecutive nights** with **logically equivalent** payloads (same case IDs, same statuses, same comments — payload byte-identity is *not* required because reporter timing and worker IDs differ between processes). Run 175 itself is untouched until Phase 5 sunset.
- [ ] TestRail aggregator (`testrail-aggregator.ts`) verified to produce a single POST per nightly, regardless of how many packages reported.
- [ ] Single-version enforcement script (`check-versions.ts`) catches a deliberately-misversioned package in CI test.
- [ ] Branch protection enforces lint + type check + PR gate per package.
- [ ] **Scaffold script is green:** `npm run scaffold:team -- --name "ScaffoldTest" --slug scaffold-test --owner @geowealth/qa-leads` produces a working package whose smoke spec passes within the 30-minute SLA, exercised by the scaffold-test workflow on every PR that touches templates. The scaffold-test workflow honors the secrets-injection contract.
- [ ] **The six other team packages exist** (`tests-platform`, `tests-trading`, `tests-reporting`, `tests-investments`, `tests-integrations`, `tests-custody-pa`), each generated by the scaffold script and each with a green smoke spec running nightly. They are empty of regression content.
- [ ] **M3 milestone met** (Section 6.15): named second QA contributor committed for at least 50% of their time.

**Dependencies resolved by entry:** D-02 (CI platform), D-03 (secret store).

---

### 6.4 Phase 2 — Component Library, API Client, and Documentation

**Goal.** Build the reusable substrate that all feature-area migrations will depend on, and produce the documentation new contributors will read first.

**Scope.**
- **Phase 2 entry spike (mandatory before lifting any helper):** scope the legacy `packages/legacy-poc/tests/account-billing/C25193.spec.js` end-to-end. Produce a one-page note in the Phase 2 tracking issue listing every helper module it imports, every magic identifier it uses, and every product quirk it works around. This spike is the input to the C25193 graduation effort and prevents the "L sized but actually XL" risk recorded against R-12.
- **Component rewrite, not a lift.** Per D-35 (no shim), the legacy POC keeps its JS helpers untouched. Phase 2 builds **new TypeScript Component classes** under `packages/framework/src/components/*.ts` (`ReactDatePicker`, `ComboBox`, `AgGrid`, `NumericInput`, `TypeAhead`), using the legacy `packages/legacy-poc/tests/_helpers/ui.js` as a *behavioural reference*, not a source migration. The framework Components and the legacy helpers run side by side — the legacy POC consumes only the JS, the new tests consume only the TS. Each new Component is validated by its own framework smoke spec (below); the legacy POC is not affected by Component PRs and does not need re-verification on each merge.
- **Promotion rule Phase 2 exception.** The promotion rule from Section 4.2.2 — *new code lands in `framework/` only by promotion from a `tests-*` package* — has an explicit exception for Phase 2: the framework's foundational code is *lifted* from `packages/legacy-poc/`, not promoted from a team package. This is the only phase where direct framework writes by QA Automation are permitted. After Phase 2 exit, the promotion rule applies without exception.
- Each Component class has unit-style coverage via a *single* dedicated spec under `packages/framework/tests/components/` that exercises its primary actions on a known qa2 page (no business assertions). These framework-own tests run in CI as a dedicated package shard alongside the team packages.
- **CDP-access policy.** Where a Component class needs raw Chrome DevTools Protocol access (e.g., the Commission Fee combo workaround that requires `page.mouse.click()` against bounding-box coordinates), the access is encapsulated by a single helper `withCdpClick(locator, options)` exposed from `packages/framework/src/helpers/cdp.ts`. Component classes call the helper; they do **not** open `CDPSession` themselves. The helper documents the trade-off (works only on Chromium; ignored under WebKit) and adds a `@chromium-only` tag annotation to any test that consumes it.
- **No CommonJS shim (D-35).** The legacy POC's `tests/_helpers/*.js` files are **left untouched** during Phase 2. They keep their existing JS implementations (date picker, ComboBox, ag-Grid, worker-firm, etc.) and continue serving the legacy POC's nightly until Phase 5 sunset. The framework's TS Components are *new code*, lifted-and-rewritten from the JS originals, not consumed by the legacy POC. **Duplication during the migration window is the accepted trade-off.** Because the POC freeze (D-13) takes effect at Phase 2 exit, the duplicated JS helpers do not evolve — only the framework's TS versions do — so the duplication has bounded blast radius.
- **C25193 graduation lands at** `packages/tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts`. From Phase 2 exit onward, this is its permanent home — Phase 4 will *not* re-migrate it.

#### 6.4.1 Phase 2 Internal Work Order (D-37)

Phase 2's deliverables have a strict dependency order. The Phase 2 tracking issue must follow this sequence:

1. **API client first.** Build `packages/framework/src/api/client.ts` (retry, env-aware base URL, the production safety guard from D-09) and the typed `/qa/*` wrappers used by `C25193`'s isolation model: `DummyFirmApi`, `InvitationApi`. Each ships with its Zod schema and a unit test that asserts schema parsing against a recorded fixture from a real qa2 response. **Authentication path (D-42):** the API client accepts a Playwright `APIRequestContext` from the caller, never logs in by itself. The caller (typically a fixture) provides a context constructed with the storage state from `auth.fixture.ts`. There is exactly one auth path in the program — through storage states — and the API client is a thin transport over a pre-authenticated context.
1.1. **Framework playwright config.** Build `packages/framework/playwright.config.ts` so the framework's own component smoke specs (under `packages/framework/tests/`) run as a dedicated package shard in CI. This config also calls `definePlaywrightConfig` and provisions a workspace-root storage state under `<workspace>/.auth/tim1.json`.
2. **Factories.** Build `FirmFactory` and `ProspectFactory` on top of the API client.
3. **`firm.fixture` and `worker-firm.fixture`.** Build `packages/framework/src/fixtures/workerFirm.fixture.ts` as a typed worker-scoped fixture, using the legacy `packages/legacy-poc/tests/_helpers/worker-firm.js` (~300 LOC, the program's most valuable asset) as a behavioural reference. The legacy version stays in place per D-35, so during Phase 2-4 **both implementations create dummy firms in parallel** — this doubles dummy firm accumulation on qa2/qa3, which is acceptable per the existing "dummy firms accumulate, no cleanup" product behaviour. The duplication ends at Phase 5 sunset. This fixture is not optional and must not be deferred to Phase 4.
4. **Component lift.** Build the `ReactDatePicker`, `ComboBox`, `AgGrid`, `NumericInput`, `TypeAhead` Component classes (Section 4.4) under `packages/framework/src/components/`. Each ships with its smoke spec under `packages/framework/tests/components/`.
5. **C25193 port.** Port the legacy `C25193.spec.js` to `packages/tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts`, consuming the API client, factories, fixtures, and Components built in steps 1–4. **The port PR must be merged in week 1 of Phase 2** so the 5-night gating window (R-12 / Section 6.13) runs in parallel with the rest of Phase 2's work, not at the end.
6. **Cookbook.** With C25193 graduated, write `docs/WRITING-TESTS.md` using C25193 as the canonical worked example. The cookbook is a Phase 2 deliverable; if C25193 ports late, the cookbook risks slipping to Phase 4 — hence the week-1 rule.

Steps 1, 2, 3 are tightly coupled (each depends on the prior). Step 4 (Component lift) is independent of steps 1–3 and *may* run in parallel if the second contributor (M3) takes one track and the primary takes the other. Steps 5–6 must be sequential and gate Phase 2 exit.
- Build the typed `/qa/*` API client (Section 4.6): `DummyFirmApi`, `InvitationApi`, `CustodianApi`, `CostBasisApi`, `MfExecutionApi`. Each wrapper has Zod schema coverage and is used at least once in a smoke spec.
- Implement the production-safety guard in `ApiClient` (Decision **D-09**, already DECIDED).
- Migrate `C25193` (Account Billing — Inception Date) as the **graduation spec** of Phase 2: it exercises Page Object, Component classes, fixtures, API client, and the hybrid isolation model end-to-end. The migrated `C25193` lives at `tests/regression/account-billing/C25193.spec.ts` from day one and is the property of the `account-billing` area's tracker — it does **not** get re-migrated in Phase 4. Phase 4's account-billing ordering is documented to start *with the deletion of the legacy* `C25193` rather than its port (see Section 6.6, step 7).
- Known product quirks of `C25193` (Inception Date not appearing in History grid; see `project_billing_form_quirks` memory) are *not* failures of the parity gate. The graduation spec asserts only on the documented product behaviour; any waived assertions carry a `QA-ARCH-001:waived` marker pointing at the relevant TestRail comment.
- Author `docs/ARCHITECTURE.md`, `docs/WRITING-TESTS.md`, `docs/PAGE-OBJECTS.md`, `docs/ONBOARDING.md`. Each is reviewed by at least one person who did not write it.

**Deliverables.**
- Five Component classes with smoke coverage.
- CommonJS shim for legacy compatibility, with green legacy CI run as proof.
- Five API client wrappers with Zod schemas.
- `C25193` migrated, green for five consecutive nights against qa2.
- Four documentation files in `docs/`.

**Exit criteria.**
- [ ] Legacy POC suite still passes in CI (proves the shim).
- [ ] New `C25193` parity gate met (5 consecutive green nights).
- [ ] Component smoke specs green against qa2 *and* qa3.
- [ ] All `/qa/*` calls go through typed clients; grep for direct `request.post('/qa/')` returns zero hits in `src/`.
- [ ] Documentation reviewed and merged.
- [ ] **POC freeze** declared and announced — no new tests added to `tests/<legacy-feature>/` from this point.

**Dependencies resolved by entry:** D-08 (`__REACT_QUERY_CLIENT__` exposure) — if not delivered, document the workaround in `WRITING-TESTS.md` and proceed.

---

### 6.5 Phase 3 — Frontend Coordination & `data-testid` Kickoff

**Goal.** Establish the frontend partnership that unblocks selector stability for the rest of the migration. Run in parallel with Phase 4 once kicked off.

**Scope.**
- Identify the frontend owner (Decision **D-05**); schedule a kickoff meeting.
- Agree the `data-testid` naming convention (proposed: `data-testid="<area>-<element>-<action>"`, e.g. `account-billing-edit-save`).
- Land the first batch of `data-testid` attributes on the Account Billing edit modal. The first batch is **enumerated explicitly** in `docs/PAGE-OBJECTS.md` and is sized at exactly the elements consumed by `C25193` and the surrounding `account-billing` Page Object: edit-modal trigger button, save button, cancel button, inception-date field, active-date field, commission-fee combo, and the History grid container. Roughly 7–10 attributes — small enough that frontend can deliver in one PR, large enough to validate the convention end-to-end.
- Subsequent batches are sized one feature area at a time and tracked in `docs/PAGE-OBJECTS.md` under a "Rollout Status" table that mirrors the migration tracker's area ordering.
- Add a static-analysis script (`scripts/testid-coverage.ts`) that walks `src/pages/` and reports the proportion of selectors using `getByTestId` versus other rungs. Wire it into the run summary so KPI tracking begins.
- Document the convention in `docs/PAGE-OBJECTS.md`.

**Deliverables.**
- Naming convention document in `docs/PAGE-OBJECTS.md`.
- `data-testid` attributes merged into the Account Billing edit modal in the GeoWealth repo.
- `scripts/testid-coverage.ts` and KPI emission.

**Exit criteria.**
- [ ] First batch of `data-testid` attributes deployed to qa2 and qa3.
- [ ] Coverage script reports a baseline number for the KPI.
- [ ] Frontend owner (Decision D-05) acknowledged and on a recurring sync.

**Dependencies resolved by entry:** D-05.

---

### 6.6 Phase 4 — Per-Team Migration into `tests-billing-servicing`

**Goal.** Migrate every feature area of the current POC into `packages/tests-billing-servicing/`, retiring legacy specs as parity is reached. The other six team packages (Trading, Platform, Reporting, Investments, Integrations, Custody & PA) are *scaffolded but empty* during Phase 4 — they have packages, CI matrix entries, and CODEOWNERS rows, but no test content yet, because no other team has implemented tests today.

**POC area-to-team mapping (Decision D-25, owned by Program Owner).** All currently implemented POC areas belong to **Billing & Servicing**:

| POC area | Spec count | Target package | Phase 4 order |
|---|---|---|---|
| `account-billing` | 15 | `packages/tests-billing-servicing/tests/regression/account-billing/` | 1 (most mature; `C25193` already gated) |
| `create-account` | 7 | `packages/tests-billing-servicing/tests/regression/create-account/` | 2 (heavy ag-Grid; validates Components under load) |
| `billing-specs` | 4 | `packages/tests-billing-servicing/tests/regression/billing-specs/` | 3 (small; consolidates billing helpers) |
| `bucket-exclusions` | 13 | `packages/tests-billing-servicing/tests/regression/bucket-exclusions/` | 4 (validates XLSX builder layer) |
| `unmanaged-assets` | 12 | `packages/tests-billing-servicing/tests/regression/unmanaged-assets/` | 5 (similar shape to bucket exclusions; reuse builders) |
| `platform-one/merge-prospect` | 8 | `packages/tests-billing-servicing/tests/regression/merge-prospect/` | 6 (cross-feature dependencies; auth/role matrix) |
| `platform-one/auto-link` | 7 (all `test.fixme`) | `packages/tests-billing-servicing/tests/regression/auto-link/` | Handed to Phase 5 |

> **Why all areas land in `tests-billing-servicing` despite the seven-team layout.** As of 2026-04-09, only the Billing & Servicing team has implemented E2E content; the other six team packages exist as empty bootstraps so the monorepo plumbing is exercised end-to-end. As other teams begin authoring tests post-Phase-5, they will scaffold their own packages via the script (Section 4.2.5) and own their content from the start. The plan does **not** speculatively re-home POC content that the owning team has not asked for.

**For each area, follow the parity-gate workflow:**

1. **One Phase 4 epic, seven area sub-tasks.** Phase 4 opens a single epic in the issue tracker; each of the seven areas above is a sub-task linked to the epic. The migration tracker (`docs/migration-tracker.md`) is the per-spec ledger; the issue tracker holds the high-level rollup. This avoids seven nearly-identical tracking issues with their own labels and lifecycle.
2. Build any area-specific Page Objects under `packages/tests-billing-servicing/src/pages/<area>/<PageName>.ts` — **nested by area** for navigability (a single team package may eventually have 50+ Page Objects across seven areas; flat is unworkable). Cross-area Page Objects (Login, Navigation, FirmAdmin) live under `packages/framework/src/pages/` and are promoted via the rule in Section 4.2.2. The Section 4.2.1 layout shows `src/pages/` flat at the team-package level for brevity; the Phase 4 reality is `src/pages/<area>/`.
3. **Port PR.** Rewrite the spec under `packages/tests-billing-servicing/tests/regression/<area>/` and merge. Spec moves to `ported`. The legacy spec in `packages/legacy-poc/tests/<area>/` continues to run unchanged.
4. **Gating window.** The new spec runs in CI for **five consecutive nightly runs** on qa2 *and* qa3. Failures reset the counter. Spec moves to `gating` on entry, `gated` on success.
5. **Deletion PR (separate from the port PR).** Once a spec is `gated`, a follow-up PR deletes the legacy spec from `packages/legacy-poc/tests/<area>/`, removes any helper modules used only by it, and updates the migration tracker. Spec moves to `deleted`. The port and deletion PRs are intentionally separate so the gating window is visible in git history.
6. **Cohort flow.** Multiple specs from the same area may be in the `gating` state in parallel; only the *port PRs* are reviewed serially within an area. Cohort size is `min(5, ceil(area_size / 3))` per area, capped at 12 across the program (Section 6.13).
7. **`account-billing` head start.** `C25193` was migrated and gated during Phase 2 (already at `packages/tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts`). It enters Phase 4 already in the `gated` state and is the first spec moved to `deleted` for the area.

> **ADR note (recorded as `docs/adr/0001-feature-area-ordering.md`).** This ordering optimizes for *successful early wins* (most-mature first) at the cost of *late discovery of architectural weaknesses*. The opposing strategy — start with the hardest area (`bucket-exclusions` XLSX builder or `platform-one/merge-prospect` cross-feature auth) to stress-test the framework first — was considered and rejected for two reasons:
> 1. The walking skeleton (Phase 0) and `C25193` graduation (Phase 2) already exercise the riskiest architectural surfaces (Components, fixtures, hybrid isolation, Page Object pattern) before Phase 4 begins.
> 2. The first feature area carries the highest *process* risk, not the highest *technical* risk; the team needs a confidence-building win to validate the migration cadence before tackling unfamiliar areas.
>
> If `account-billing` migration in Phase 4 surfaces a foundational defect, that is itself a useful early signal — and the rollback path in Section 6.9 covers it.

**Deliverables.**
- Per-area tracking issue closed for each of the seven areas above.
- All TestRail cases for each area mapped to a spec under `packages/tests-billing-servicing/tests/regression/<area>/`.
- Legacy directory `packages/legacy-poc/tests/<area>/` deleted per area as parity is reached.
- Area-specific Page Objects covered by `WRITING-TESTS.md` examples.
- Migration tracker `docs/migration-tracker.md` reflects all spec state transitions.
- The six other team packages (`tests-platform`, `tests-trading`, `tests-reporting`, `tests-investments`, `tests-integrations`, `tests-custody-pa`) exist as empty bootstraps with green smoke specs (created via the scaffold script in Phase 1) and CODEOWNERS rows.

**Exit criteria (per area).**
- [ ] 100% of in-scope TestRail cases have a green replacement under `packages/tests-billing-servicing/tests/regression/<area>/`.
- [ ] Legacy directory `packages/legacy-poc/tests/<area>/` deleted; no orphan helpers remain in `packages/legacy-poc/tests/_helpers/`.
- [ ] Area's pass rate ≥ 98% over the trailing 14 nights (Section 9 KPI).

**Exit criteria (phase as a whole).**
- [ ] **Six of the seven areas** above completed (`account-billing`, `create-account`, `billing-specs`, `bucket-exclusions`, `unmanaged-assets`, `merge-prospect`); `auto-link` is explicitly handed off to Phase 5 because every spec is `test.fixme` and requires the disposable email pool.
- [ ] `packages/legacy-poc/tests/_helpers/` reduced to only those modules still used by `auto-link` (or fully deleted if none).
- [ ] `data-testid` coverage KPI ≥ 70% across migrated areas.
- [ ] All utilities under `packages/legacy-poc/scripts/` either ported to TypeScript (and moved to `packages/tooling/`) or explicitly waived with `// allowJs-permanent: <reason>` comments. This preempts the Phase 5 `allowJs` drop and prevents a tooling break at the final sunset step.
- [ ] **PR-gate latency re-baselined.** The 8-minute target was set in Phase 1 against a single walking-skeleton spec. With the smoke set grown to dozens of specs, the target is re-measured at Phase 4 exit. If the median exceeds 8 minutes, either reshard or shrink the smoke set; do not silently move the target.

**Dependencies resolved by entry:** D-06 (first migration scope), D-25 (POC area-to-team mapping), Phase 3 frontend kickoff in motion.

---

### 6.7 Phase 5 — Backlog Unblock & POC Sunset

**Goal.** Resolve the `test.fixme` backlog that was deferred from earlier phases, retire the last legacy assets, and declare migration complete.

**Scope.**
- **Auto-link suite (`C26077`–`C26100`).** Implement disposable email pool via `ProspectFactory` (Section 4.2). Verify against qa2 with a fresh dummy firm per spec.
- **Merge Prospect permission-disabled scenarios (`C26060`, `C26085`).** Requires backend cooperation: `/qa/createDummyFirm.do` must accept a `permissions` override or a sibling endpoint must allow toggling MERGE PROSPECT off post-creation. Tracked as a cross-team dependency in Section 8 (new row).
- **Account Billing audit-trail gaps.** Coordinate with backend to confirm whether the qa3 audit pipeline has been fixed (Section 2 / `project_billing_form_quirks`). If yes, replace the `// QA-ARCH-001:waived` skips with real assertions.
- **Sunset the legacy POC.** Before deletion, archive the legacy helpers as `docs/historical/legacy-poc-helpers.tar.gz` (a single tarball of `packages/legacy-poc/tests/_helpers/` and `packages/legacy-poc/scripts/`) so future debugging that needs to compare framework behaviour to the original JS reference still has it. The tarball is committed once and never edited.
- Delete the entire `packages/legacy-poc/` package: removes its `tests/`, `tests/_helpers/`, the legacy JS reporter, the legacy `playwright.config.js`, and the legacy `scripts/`. Remove the `legacy-poc` entry from the workspace `package.json`. Drop `allowJs` from `tsconfig.base.json`. The single-PR cutover from JS-on-Run-175 to TS-on-Run-175 (the framework's TS reporter, decision D-15) lands in the same change.
- **Final documentation pass.** Update `docs/ARCHITECTURE.md` with the post-migration architecture; record lessons learned in `docs/RETROSPECTIVE.md`.
- **Post-migration test-authoring cookbook.** Update `docs/WRITING-TESTS.md` with a "**Adding a new spec to an existing team package**" section that walks a developer from `npm run scaffold:team` (or "I already have a team package") through writing a new Page Object, consuming framework fixtures, choosing the right isolation tier, tagging, running locally against qa2/qa3, and merging with the parity-gate-equivalent stability check (5 consecutive green nights for a *new* spec is not required, but a `@flaky` spec must stabilize before merging out of quarantine). This is the framework's day-1 user manual.
- **Framework `v1.0.0` tag.** At Phase 5 exit, the monorepo is tagged `v1.0.0`. The version means: legacy POC removed, all seven Billing & Servicing areas migrated, the `auto-link` backlog resolved or formally waived, the framework's public surface is stable, and the post-migration cookbook is complete. From `v1.0.0` onward, breaking changes to the framework follow the discipline in Section 6.11.

**Deliverables.**
- Auto-link suite green, no `test.fixme` markers.
- Merge Prospect blockers either resolved or formally accepted as out-of-scope with a recorded waiver.
- Legacy POC fully deleted.
- `tsconfig.json` strict-only (no `allowJs`).
- Retrospective document.

**Exit criteria.**
- [ ] `grep -r 'test\.fixme\|test\.skip' packages/` returns only entries with `QA-ARCH-001:waived <ticket>` markers (Section 5.4 rule 5).
- [ ] `packages/legacy-poc/` directory removed entirely.
- [ ] CommonJS shim removed; legacy JS reporter removed.
- [ ] `tsconfig.base.json` no longer sets `allowJs`.
- [ ] TestRail Run 175 is now driven by the framework's TS reporter (atomic cutover, D-15).
- [ ] All KPIs in Section 9 meet or exceed targets for the trailing 30 days.
- [ ] Migration formally closed with a retrospective.

**Backend cooperation SLA.** The Phase 5 backend dependencies (MERGE PROSPECT permission toggle and Account Billing audit-trail fix) carry an explicit response SLA agreed at Phase 4 exit:

| Backend ask | Acknowledgement SLA | Decision SLA | Implementation SLA |
|---|---|---|---|
| MERGE PROSPECT permission override on `/qa/createDummyFirm.do` | 5 working days from Phase 4 exit | 10 working days | 30 working days |
| Account Billing Inception Date audit-trail fix | 5 working days | 10 working days | Tracked but not blocking — Phase 5 closes with a waiver if not delivered |

If either ask misses its acknowledgement SLA, escalate to the responsible backend team lead and Engineering Manager. Phase 5 cannot close without either delivery or a recorded waiver per ask.

**Dependencies resolved by entry:** Backend cooperation on permission toggle, with the SLA above accepted in writing (Section 8).

---

### 6.8 Phase Dependency Graph and Parallelism

```
Phase 0 ──► Phase 1 ──► Phase 2 ──┬──► Phase 3 ──┐
                                   │              ├──► Phase 4 ──► Phase 5
                                   └──────────────┘
                                          (Phase 3 may run in parallel with the
                                           first area of Phase 4 once kicked off)
```

**Strict ordering** (cannot be parallelized):
- Phase 0 → Phase 1: CI cannot exist without a TS toolchain and a green walking skeleton.
- Phase 1 → Phase 2: Component and API client work must run in CI from the first commit.
- Phase 2 → Phase 4: Feature migration cannot start without the Component library, the API client, and the documentation set.

**Permitted parallelism:**
- Phase 3 (frontend coordination) may begin during the second half of Phase 2 — the kickoff meeting and convention agreement do not block Phase 2 deliverables.
- Within Phase 4, **only one feature area is in flight at a time** (principle 6.1.6). However, Page Object scaffolding for the *next* area may begin while the current area is in its parity-gate window.
- Cross-phase workstreams (Section 6.11) run continuously and never block phase transitions.

**Forbidden parallelism:**
- Two feature areas migrated simultaneously — review burden, conflicting helper changes, and ambiguous parity attribution.
- Phase 5 backlog work before Phase 4 has retired the dependent legacy areas — risks duplicate fixes.

### 6.9 Rollback and Contingency

Each phase has a defined rollback path. Migration is reversible up to the point where legacy specs are deleted.

| Phase | Failure mode | Rollback / Contingency |
|---|---|---|
| **0** | TypeScript toolchain incompatible with mixed JS/TS in Playwright | Revert `tsconfig.json` and `src/` skeleton on the feature branch; reopen D-01 with concrete reproduction; consider stricter JSDoc fallback. POC suite is untouched, so revert is a no-op for production. |
| **0** | Credential rotation breaks the POC nightly | Restore rotated values via the new secret store; the POC reads from env vars introduced in Phase 0. POC behavior must be verified within 24 hours of rotation. |
| **1** | Chosen CI platform cannot meet PR-gate latency target (≤ 8 min) | Re-evaluate sharding and runner sizing; if still over budget, escalate D-02 and consider an alternative platform. Walking skeleton remains runnable locally. |
| **1** | TestRail reporter port produces inconsistent results vs the JS reporter | Keep the JS reporter pointed at Run 175; route the TS reporter at a sandbox run until parity is proven over five nights. Switch is atomic and only happens at Phase 5 sunset. |
| **1** | Pre-flight health-check has a false positive and aborts an otherwise valid nightly run | Manual override: `SKIP_PREFLIGHT=1` env var allows the on-call QA engineer to force a run, with the override audited in the run summary. Repeated false positives within a week pause the pre-flight gate (not the nightly itself) until the script is fixed. |
| **2** | Component shim breaks legacy specs | Revert the affected Component file; legacy `_helpers/ui.js` is restored from git; investigate root cause without phase pressure. |
| **2** | `C25193` cannot reach the parity gate (5 green nights) | Analyze failure pattern: if environment-driven, escalate to Platform; if architectural, treat as a foundational defect and pause Phase 3 / 4 entries. |
| **3** | Frontend cannot commit to `data-testid` rollout | Phase 4 still proceeds, but selectors fall back to the role/label rungs of Section 4.7. KPI 4.10.6 is reset to "blocked" and escalated monthly. Phase 5 cannot exit without a resolution. |
| **4** | Migrated area fails the parity gate repeatedly | Pause migration of *that area only*; revert to the legacy spec serving Run 175; root-cause without freezing the rest of Phase 4. The phase is still gated by the area completing eventually. |
| **4** | Legacy spec already deleted but new spec regressed in production | Restore the legacy spec from git (`git revert` of the deletion commit) until the regression is fixed. The parity gate exists to make this rare. |
| **5** | Backend permission-toggle for MERGE PROSPECT not delivered | Record a formal waiver against C26060 / C26085 with a TestRail comment and a `QA-ARCH-001:waived` marker; close Phase 5 without those two cases and reopen as a future workstream. |
| **5** | Auto-link disposable email pool unreliable | Quarantine `auto-link` under `@flaky` until stabilized; do not block Phase 5 sunset on this single area. |

### 6.10 Phase Verification Checklist (Operational)

A short, mechanical checklist used at every phase transition. The QA Lead walks through it on a recorded call with at least one second reviewer.

1. All phase exit criteria checked off in the tracking issue.
2. Decision register has no `OPEN` entries blocking the next phase.
3. Section 8 dependencies for the next phase are resolved or have an accepted workaround.
4. Section 9 KPIs have not regressed since the last phase entry.
5. Section 10 risks reviewed; no new risk scored ≥ 12 without an owner.
6. Retrospective notes captured in `docs/RETROSPECTIVE.md` (Phase 5 only) or in the tracking issue (other phases).
7. Stakeholder communication sent to **the agreed channel** summarizing what changed. For Phase 0 transitions the channel is the QA team's existing email distribution list (or equivalent), because `#qa-alerts` is itself a Phase 1 deliverable; from Phase 1 onward it is `#qa-alerts`. The channel for each phase is recorded in the phase tracking issue.

### 6.11 Cross-Phase Workstreams

These run continuously across multiple phases and are not phases in themselves:

| Workstream | Active during | Owner | Notes |
|---|---|---|---|
| **Knowledge transfer (R-11 mitigation)** | Phases 0–5 | QA Lead | Pair-programming on every PR; weekly framework deep-dive sessions; recruit a second QA Automation contributor by end of Phase 1 (M3). |
| **Decision register hygiene** | All phases | QA Lead | Every phase entry requires its blocking decisions resolved (Section 7). |
| **Risk review** | Monthly | QA Lead | Reassess Section 10 risks; promote new risks discovered in-flight. |
| **POC stabilization** | Phases 0–4 | QA Automation | The POC continues to deliver Run 175 results; **enforced** by an ESLint rule and CODEOWNERS — see "POC Freeze Enforcement" below. |
| **Frontend `data-testid` rollout** | Phases 3–5 | Frontend lead | Continues per area as Phase 4 advances. |
| **Migration tracker maintenance** | Phases 2–5 | QA Lead | Single source of truth for spec status; see "Migration Tracker" below. |

**Migration Tracker (artifact).** A single Markdown file at `docs/migration-tracker.md`, committed to the workspace root and updated by every port and deletion PR. One row per legacy spec, columns: `area`, `case_id`, `legacy_path` (always under `packages/legacy-poc/`), `target_package` (the consuming `tests-<team>/` package, currently always `tests-billing-servicing` per D-25), `new_path` (full path under the target package), `state` (`pending` | `ported` | `gating` | `gated` | `deleted`), `owner`, `last_state_change`, `notes`. The `last_state_change` field is **filled by a CI hook** at merge time, never by humans, so the source of truth is the merge commit's authored date — readers can always cross-reference `git log`. The PR template requires every Phase 4 PR to update its row in the same commit (modulo the hook-managed timestamp); CI fails the PR if the tracker row is missing or out of date. The tracker is the input for Section 9 KPI "Parity-gate compliance" and is the source of truth that the scaffold script reads when generating a new team's section header.

**Backup and disaster recovery.** The framework code, the migration tracker, the templates, and every config file live in git — `git history` is the backup of record. Three things are *not* in git and have explicit recovery paths:
1. **Developer `.env.local` files.** Lost? Re-issue from the secret store. Owner: every developer.
2. **CI secrets in the secret store.** Lost? Re-issue from Security. Owner: Security.
3. **qa2 / qa3 environment data** (firms, accounts, custodian seeds). Lost? The POC and the new framework both call `/qa/createDummyFirm.do` to provision per-worker isolation, so a wiped environment is recovered by re-running the suite. Static seed data (Firm 106, `tyler`) is owned by the GeoWealth Platform team's environment-restore process; the QA program does not back it up.

The migration tracker file itself is checked into git and reviewed in every PR — accidental truncation is caught by `git diff`. No external backup is needed.

**Framework breaking-change discipline (D-39).** With single-version (D-27) and `workspace:*` consumption, every framework change reaches every team package on the same nightly. There is no "pin and upgrade later" escape valve. The discipline:

1. **Two-step deprecation.** A breaking change to any exported framework symbol requires a deprecation warning to land *one nightly run before* the symbol is removed. The `@deprecated` JSDoc tag plus a runtime `console.warn` are both required.
2. **Framework-change PR template.** Any PR touching `packages/framework/src/` adds a "Breaking change?" checkbox; if checked, the PR is held for explicit QA Lead approval and a `docs/CHANGELOG.md` entry is mandatory.
3. **Consumer impact preview.** The PR description must list every team package that imports the affected symbol (a CI check runs `grep` across `packages/tests-*/` and prints the list as a PR comment).
4. **Cross-team review.** Breaking-change PRs require an approving review from at least one consuming team owner (not just QA Automation). The CODEOWNERS file is the routing.

**`run-summary.json` schema (D-40).** Every per-package CI invocation emits a `run-summary.json` artifact. Schema:

```typescript
interface RunSummary {
  schemaVersion: '1';
  package:       string;            // e.g. "@geowealth/tests-billing-servicing"
  environment:   'qa1' | 'qa2' | 'qa3' | 'qa4' | 'qa5' | 'qa6' | 'qa7' | 'qa8' | 'qa9' | 'qa10' | 'qatrd';
  commitSha:     string;
  startedAt:     string;            // ISO-8601 UTC
  durationMs:    number;
  totals:        { passed: number; failed: number; skipped: number; flaky: number };
  byTag:         Record<string, { passed: number; failed: number; durationMs: number }>;
  preflightSkipped: boolean;        // true iff SKIP_PREFLIGHT=1 was used
  testRailCaseIds: number[];        // for the per-nightly aggregator (D-30)
}
```

The aggregator (`testrail-aggregator.ts`) and the time-series push both consume this contract; producer and consumer are pinned to `schemaVersion: '1'`. A breaking schema change bumps the version field and is treated as a framework breaking change (above).

**POC Freeze Enforcement (Phase 2 exit onward).** "No new tests in `packages/legacy-poc/tests/<feature>/`" is enforced mechanically, not by review discipline:

1. A custom ESLint rule (`local-rules/no-new-legacy-spec`) flags any newly created `.spec.js` file under directories listed in a sidecar config file `.eslintrc.legacy-areas.json` at the workspace root. The sidecar is a flat JSON array of glob patterns rooted at the workspace, e.g. `["packages/legacy-poc/tests/account-billing/**", "packages/legacy-poc/tests/bucket-exclusions/**"]`. ESLint rules are JavaScript and cannot parse Markdown, so the migration tracker is **not** the ESLint input — the sidecar JSON is, and a CI job updates the sidecar in lockstep when an area's state changes in the tracker. The tracker remains the human-readable source of truth and the JSON is its machine-readable mirror.
2. CODEOWNERS uses **structured section markers** so the scaffold script and humans can both edit it without conflicts:
   ```
   # === BEGIN scaffold-managed: team packages ===
   /packages/tests-billing-servicing/  @geowealth/billing-servicing-qa @geowealth/qa-leads
   /packages/tests-platform/           @geowealth/platform-qa          @geowealth/qa-leads
   ...
   # === END scaffold-managed ===

   # === BEGIN human-managed: framework, tooling, legacy ===
   /packages/framework/                @geowealth/qa-leads
   /packages/tooling/                  @geowealth/qa-leads
   /packages/legacy-poc/               @geowealth/qa-leads
   # === END human-managed ===
   ```
   The scaffold script edits **only** the section between the scaffold-managed markers; everything else is human-edited. The script's idempotency check refuses to run if either marker is missing.
3. Bug-fix PRs to legacy specs must reference the original spec's TestRail case ID and link to a defect ticket; the PR template enforces this (a CI check rejects PRs to legacy paths without the required references).
4. The freeze is announced to the agreed channel at Phase 2 exit, with the tracker linked.

### 6.12 Resourcing and Effort Sizing

Effort is expressed in T-shirt sizes against a baseline of one full-time QA Automation engineer. Sizes assume the dependencies in Section 8 are resolved on time; blocked phases are sized separately under "if blocked" notes.

| Phase | Size | Drivers | Required skills | Primary owner | Supporting roles |
|---|---|---|---|---|---|
| **0** Foundation & Security Hotfix | **S** | Security rotation is the long pole, not the scaffold. | TypeScript setup, secret rotation, Playwright config. | QA Automation | Security (rotation), QA Lead (review). |
| **1** CI Bootstrap + Scaffold | **L** (re-sized per D-29) | CI provisioning + scaffold script + affected-detection + reporter port + TestRail aggregator + version-check + scaffold-test workflow. | CI/CD, TS, TestRail API, monorepo tooling. | QA Automation | Platform / DevOps, QA Lead, second QA contributor (M3 mandatory). |
| **2** Components, API Client, Docs | **L** | Five Components × five API clients × four docs × the `C25193` graduation spec. The graduation spec is the long pole. | Playwright internals, React widget knowledge, Zod, technical writing. | QA Automation | QA Lead (doc reviews), second QA contributor (R-11). |
| **3** Frontend Coordination Kickoff | **S** (QA effort) / **M** (frontend effort) | Mostly meetings, convention agreement, and a coverage script. Real cost is on the frontend side. | Stakeholder management, simple AST tooling. | QA Lead | Frontend lead (real implementer). |
| **4** Feature-Area Migration | **XL** | Six feature areas × parity gate × CI stabilization. Dominates total effort. | All of the above plus deep familiarity with each feature area. | QA Automation | Per-feature QA contacts, second QA contributor. |
| **5** Backlog Unblock & POC Sunset | **M** | Auto-link and merge-prospect blockers each have unknowns; sunset is mechanical. | Backend coordination, factory design. | QA Automation | Backend leads (toggles, audit fixes). |

**If Phase 2 or Phase 4 runs without a second QA contributor**, the phase size escalates by one notch (Phase 2: L → XL; Phase 4: XL → XXL) and the program becomes a single-point-of-failure (Risk R-11). M3 (Section 6.15) makes the second-contributor commitment a hard gate for Phase 2 entry, not an aspiration.

### 6.13 Parity Gate — Calendar Reality and Cohort Sizing

The parity gate of "5 consecutive green nightly runs" is the program's quality keystone, but it has a calendar cost that must be planned for, not stumbled into.

**Per-spec cost.** A spec entering the gate on a Monday earliest reaches `gated` on Saturday morning (5 nightly runs over 5 calendar nights). A failure on any night resets the counter, so the realistic per-spec gate budget is **7–10 calendar days**, not 5.

**Throughput math.** If Phase 4 has roughly 50 specs across six areas and they were run sequentially through the gate, total gate time alone would be 50 × 7 = 350 days — clearly unworkable. The plan therefore allows multiple specs to be in the `gating` state in parallel, with these guardrails:

| Concurrency policy | Value | Reason |
|---|---|---|
| Max in-flight `gating` specs per area | `min(5, ceil(area_size / 3))` | Scales with area size — small areas (`billing-specs`, 4 specs) gate at most 2 in parallel; large areas (`account-billing`, 15 specs) gate at most 5. Keeps failure attribution proportional. |
| Hold-back rule | New port PRs into an area pause when that area's gating queue is full *or* one in-flight gating spec has failed in the last two nights | Forces stabilization before piling on. |

> The earlier cohort policy included a "max 12 in-flight `gating` specs across the program" cap. With the rule "only one feature area in flight at a time" (Section 6.6), the program-wide cap is unreachable — the per-area cap (≤ 5) always wins. The program-wide cap was dead code and has been removed. If "one area at a time" is ever loosened, restore the program-wide cap simultaneously.

**Time-to-`gated` is a tracked metric.** Median per-spec gate duration is reported in the migration tracker; if it exceeds 14 calendar days for two weeks running, the gate definition is reviewed (the 5-night threshold may be loosened to 3 for low-risk specs, with a recorded waiver per spec).

### 6.14 Program Governance

This subsection captures the program-management questions that the technical phases assume are answered.

**Single accountable program owner.** One named individual — the **Program Owner** — is accountable for the migration's success. The Program Owner is the QA Lead by default, but the role may be delegated by name in the Phase 0 tracking issue. The Program Owner:
- Chairs the weekly status report and the phase verification calls.
- Holds the kill-criteria decision (see below).
- Resolves cross-team escalations within 48 hours.
- Maintains the Decision Register and the migration tracker.

**Kill criteria — when the program is abandoned and the POC is kept as-is.** The migration is **stopped** if any of the following becomes true:
1. **Critical security finding cannot be remediated within Phase 0.** If credential rotation cannot be completed and the historical leak cannot be either rewritten or formally accepted, the program is paused indefinitely until Security clears the path.
2. **Two consecutive phases miss their planned exit by more than 100% of their planned duration.** This signals systemic estimation failure.
3. **R-11 cannot be mitigated.** If a second QA contributor cannot be recruited by the end of Phase 1 *and* the Engineering Manager cannot offer an alternative (loaned engineer, contractor), Phase 2 does not start. The program waits.
4. **Backend cooperation fails categorically.** If neither MERGE PROSPECT toggle nor audit-trail fix is delivered after one full SLA cycle plus one extension, Phase 5 closes with two waivers and the program is declared complete-with-known-gaps. *This is a partial kill, not a full one.*
5. **Cumulative phase duration exceeds 200% of the planned working-week budget** (Section 6.14 schedule) without producing a green Phase 4 area. Measured against the relative-week plan, not engineering hours, because hours are not tracked by this program. This signals fundamental architectural mismatch.

A kill decision is the Program Owner's, made in consultation with the Engineering Manager and recorded as a `KILLED` decision in Section 7. POC and TestRail Run 175 continue to operate; the framework branch is parked, not deleted, so a future restart can build on the work done.

**Phase scheduling.** Each phase carries a *planned relative duration* expressed in working weeks, recorded in the phase tracking issue at phase entry. Absolute calendar dates are not in this document because they depend on team availability, but relative durations make the "phase exit on time" KPI measurable:

| Phase | Planned relative duration | Notes |
|---|---|---|
| 0 | 1–2 weeks | Long pole is Security availability for credential rotation; workspace bootstrap and POC relocation are mechanical. |
| 1 | **2–3 weeks** (re-baselined per D-29) | CI bootstrap + scaffold script + affected detection + TestRail reporter port + per-package matrix. |
| 2 | 4–6 weeks | Cross-package Component lift + C25193 graduation; also the latest acceptable point for the second contributor (M3 commitment is hard-gated at *Phase 1 exit*). |
| 3 | 1 week of QA effort, runs in parallel with start of Phase 4 | Frontend effort outside QA's accounting. |
| 4 | 8–12 weeks | Seven areas × parity gate × cohort throughput. |
| 5 | 2–4 weeks | Driven by backend SLA; the SLA itself is the long pole. |

These are sized in *working weeks of the assumed team* (one full-time QA Automation engineer plus the second contributor from M3 onward). Sizes are reviewed and re-baselined at the end of every phase verification.

**Status reporting cadence.** A weekly status report is published every Friday by the Program Owner to the agreed channel. The report uses the template at `docs/status-report-template.md` (created in Phase 0) and contains:
- Current phase, week N of M planned weeks.
- Exit criteria checked off vs. remaining.
- New risks and decisions since last report.
- Asks of stakeholders (decisions needed, dependencies waiting).
- A single "RAG" indicator (Red / Amber / Green) for the program as a whole, with a one-line rationale.

Three consecutive Amber or any Red triggers an escalation review with the Engineering Manager.

**Phase verification artifact.** Section 6.10 requires "a recorded call". The artifact is a **signed verification record** committed to `docs/phase-verifications/phase-N.md`, containing: date, attendees, every checklist item with pass/fail, decisions confirmed, decisions deferred, link to call recording (or notes if no recording). The next phase cannot enter without the previous phase's verification record merged to `master`.

**Dry-run / pilot for credential rotation.** Phase 0 Step B (the credential rotation) is rehearsed first against a **non-production sandbox account** (a throwaway TestRail user, a throwaway GeoWealth dummy admin) before touching the real `tim1` and TestRail credentials. The sandbox rehearsal validates: (a) the env-var refactor reaches all references, (b) the secret-store handoff works, (c) the rollback path is exercised. Only then is the real rotation attempted. The dry-run is part of Step B, not a separate phase.

**Framework versioning.** The framework repository follows **SemVer 2.0**. The first tagged release is `v0.1.0` at the end of Phase 0 (foundation only). Phase exits produce minor bumps; spec migrations are patch bumps; breaking changes to Page Object or fixture APIs require a major bump and an entry in `docs/CHANGELOG.md`. Tags are not yet consumed by external clients, but the discipline starts now so future shared-library reuse is friction-free.

### 6.15 Bus-Factor Mitigation Milestones (R-11)

Risk R-11 (single contributor, score 20) is the highest-scored risk in the register. The migration plan addresses it through these explicit milestones, not through hope:

| Milestone | Phase | Definition of done |
|---|---|---|
| **M1 — Onboarding doc exists** | End of Phase 2 | `docs/ONBOARDING.md` is reviewed by a non-author who, without verbal help, can clone, configure, and run the walking-skeleton spec locally. |
| **M2 — Pair-programming cadence** | Phases 0–5 | At least one PR per week is co-authored or pair-reviewed by a second person. Tracked in the weekly status report. |
| **M3 — Second contributor identified** | **End of Phase 1** | A named individual is committed for at least 50% of their time to the framework. Phase 1 is the latest acceptable point because Phase 2 is the largest single phase (size L) and one person carrying it alone is the exact bus-factor failure mode this milestone exists to prevent. If not met by end of Phase 1, escalate to Engineering Manager and **pause Phase 2 entry** until resolved. |
| **M4 — Knowledge-transfer session series** | Phases 2–4 | Weekly 30-minute deep-dive on one architectural area (fixtures, Components, API client, isolation, CI). Recordings archived in Confluence. |
| **M5 — Architecture decision records** | Phases 0–5 | Every non-obvious architectural choice is captured as an ADR in `docs/adr/` so the rationale survives the original author. |

These milestones promote R-11 from "passive monitoring" to active risk reduction and are reviewed at every phase verification (Section 6.10).

---

## 7. Decision Register

Each decision below is owned, dated, and tracked through to acceptance. The register is the single source of truth — `OPEN` items block their dependent migration phases until resolved.

**Phase index — which decisions block which phase (quick navigation):**

| Phase | OPEN decisions blocking entry |
|---|---|
| Pre-Phase 0 | D-01, D-04 (superseded → see D-24), D-07, D-11, D-19, D-22, D-24, D-25, D-26, D-27, D-28, D-31, D-34 |
| Phase 0 → Phase 1 | D-03 (secret store namespace populated), D-20 (history rewrite/accept) |
| Phase 1 → Phase 2 | D-02 (CI platform live), D-08 (`__REACT_QUERY_CLIENT__` exposed) |
| Phase 2 → Phase 3 | D-37 (Phase 2 internal order completed), D-32 (promotion-rule exception observed) |
| Phase 3 → Phase 4 | D-05 (frontend `data-testid` owner committed), D-06 (first migration scope confirmed) |
| Phase 4 → Phase 5 | D-18 (backend cooperation SLA accepted) |

Decisions marked **DECIDED** below were authored as recommendations by QA Automation; rows with the QA Lead or Program Owner as owner await formal ratification at the Phase 0 kickoff. The kickoff verification record (Section 6.10) lists every decision under "Decisions confirmed".


| ID | Decision | Status | Recommendation | Owner | Due | Blocks |
|---|---|---|---|---|---|---|
| D-01 | Adopt TypeScript strict mode | OPEN | **Yes** — refactor safety dominates over time. | QA Lead | Pre-Phase 0 | All phases |
| D-02 | CI platform (GitHub Actions / GitLab CI / Jenkins) | DECIDED | **GitHub Actions** — repo is hosted on github.com; no other corporate CI footprint applies to the QA repo. Workflows landed in commit `6765f91` (Phase 1.9). | QA Automation | 2026-04-09 | — |
| D-03 | Secret store (GitHub Secrets / Vault / AWS Secrets Manager) | OPEN | Align with whatever the chosen CI uses natively. | Security lead | Pre-Phase 0 | Phases 0 and 1 |
| D-04 | Repository topology (standalone vs `~/nodejs/geowealth/e2e`) | SUPERSEDED by D-24 (multi-team monorepo with npm workspaces) | See D-24 in this register | — | — | — |
| D-05 | Frontend `data-testid` rollout owner | OPEN | Nominate one frontend lead; staged adoption per feature area. | Frontend lead | Pre-Phase 3 | Phase 3 |
| D-06 | First migration scope | OPEN | `account-billing` as the reference area. | QA Lead | Pre-Phase 4 | Phase 4 |
| D-07 | TestRail Run 175 cadence during migration | OPEN | Phased approach; POC keeps reporting until each spec is ported. | QA Lead, Product | Pre-Phase 0 | Migration sequencing |
| D-08 | React Query / Redux QA hooks on `window` (`FOR_QA=true`) | OPEN | Frontend exposes `__REACT_QUERY_CLIENT__`; gated by build flag. | Frontend lead | Pre-Phase 2 | Section 4.10.4 patterns |
| D-09 | Production safety: ban `/qa/*` calls when `TEST_ENV=production` | DECIDED | Implemented in `ApiClient` constructor. Never overridable. | QA Automation | 2026-04-09 | — |
| D-10 | Dummy firm naming convention `e2e-<timestamp>` | DECIDED | Documented in Section 5.8. | QA Automation | 2026-04-09 | — |
| D-11 | Treat existing committed credentials in `testrail.config.json` as compromised; rotate before any other Phase 0 work | **OPEN — DEFERRED** | Step 0.D rotation deferred in solo phase: Program Owner does not have rotation authority on qa2/qa3 GeoWealth UI without coordinating with shared-credential consumers (other manual testers / tools). Step 0.E formally accepted the historical exposure (D-20) on the condition that D-11 *will* be executed. New target: **Program Owner triggers rotation when they have both authority and a quiet window**, with no later than 90 days from 2026-04-09 per D-20's reversal trigger. R-07 and R-16 score remain elevated until D-11 closes. | Program Owner | 2026-07-08 (90-day cap from D-20) | Phase 0 exit |
| D-12 | Parity gate: 5 consecutive green nightly runs before deleting any legacy spec | DECIDED | Codified in Section 6.1 principle 4. | QA Lead | 2026-04-09 | Phase 4 |
| D-13 | POC freeze: no new specs in legacy `tests/<feature>/` after Phase 2 exit | DECIDED | Section 6.1 principle 5. | QA Lead | 2026-04-09 | Phase 4 |
| D-14 | Parity-gate cohort sizing (max 5 in-flight gating per area, 12 across program) | DECIDED | Section 6.13. Loosenable to 3 nights for low-risk specs by waiver. | QA Lead | 2026-04-09 | Phase 4 throughput |
| D-15 | TestRail Run 175 cutover from JS to TS reporter is single-PR atomic at Phase 5 sunset | DECIDED | Sections 6.3 and 6.7. Two reporters never write to Run 175 simultaneously. | QA Automation | 2026-04-09 | Phase 5 |
| D-16 | POC freeze enforced by ESLint rule + CODEOWNERS, not review discipline | DECIDED | Section 6.11 "POC Freeze Enforcement". | QA Lead | 2026-04-09 | Phase 4 |
| D-17 | Phase 4 ordering favors mature areas first (account-billing); rationale recorded as ADR-0001 | DECIDED | Section 6.6 ADR note. | QA Lead | 2026-04-09 | Phase 4 |
| D-18 | Phase 5 backend cooperation SLA (5d ack / 10d decision / 30d implementation) | OPEN | Yes — accepted by backend leads at Phase 4 exit. | Backend leads, QA Lead | Phase 4 exit | Phase 5 |
| D-19 | Pin Node 20 LTS, Playwright 1.47, TS 5.5, Zod 3.23, dotenv-flow 4.1, ESLint 10.2; commit `package-lock.json`; CI uses `npm ci` | DECIDED | Section 6.2 technical preconditions. | QA Automation | 2026-04-09 | Phase 0 |
| D-20 | Git history: rewrite versus formally accept the historical credential leak | **DECIDED — ACCEPT** | Step 0.E audit (`docs/phase-0-step-0-E-secrets-audit.md`) found the secret in three commits (978b222, d39b03d, 348988d). Decision: formally accept the historical exposure; rely on Step 0.D credential rotation as the binding mitigation. Reversal triggers (external access, compliance review, rotation > 90d, mirror/fork) are documented in the audit report. | Program Owner | 2026-04-09 | — |
| D-21 | ~~CommonJS↔TS shim via dynamic import~~ — **SUPERSEDED by D-35**. The shim is technically unworkable: framework has `noEmit: true` (no JS to import) and the legacy POC runs the JS Playwright runner which does not compile imported `.ts` source. | SUPERSEDED by D-35 | — | — | — | — |
| D-22 | Named Security counterpart for credential rotation must exist before Phase 0 starts | OPEN | Yes — without a named individual, Phase 0 cannot begin. | Engineering Mgr | Pre-Phase 0 | Phase 0 |
| D-23 | qa2 stability fallback: switch the walking skeleton to qa3 if qa2 fails for two consecutive Phase 0 nights | DECIDED | Section 6.2 Step G. `TEST_ENV` is the override. | QA Automation | 2026-04-09 | Phase 0 |
| D-24 | **Monorepo with npm workspaces** (supersedes D-04). One repo, `packages/framework/`, `packages/tooling/`, one `packages/tests-<team>/` per consuming team, `packages/legacy-poc/` as the interim home for the existing POC. | DECIDED | Section 4.2 + ADR-0002. Multiple teams (Trading, Platform, Billing & Servicing, Reporting, Investments, Integrations, Custody & PA) consume a shared framework; per-team CI scoping; atomic cross-package refactors. | QA Lead, Eng Mgr | 2026-04-09 | All phases |
| D-25 | POC area-to-team mapping: **all currently implemented POC areas belong to Billing & Servicing**; the other six team packages exist as empty bootstraps in Phase 0 and remain empty until those teams begin authoring tests | DECIDED | Section 6.6. Confirmed by Program Owner on 2026-04-09. The plan does not speculatively re-home POC content. | Program Owner | 2026-04-09 | Phase 4 |
| D-26 | Scaffold script (`npm run scaffold:team`) is a Phase 1 first-class deliverable, not an afterthought, with a 30-minute productivity SLA enforced by a CI workflow on every template-touching PR | DECIDED | Section 4.2.5. The script generates `packages/tests-<slug>/` and registers it in CODEOWNERS, the migration tracker, and the CI matrix atomically. | QA Automation | 2026-04-09 | Phase 1 |
| D-27 | Single monorepo version (one `version` field, synced across all packages); per-package independent versioning is not adopted at this stage | DECIDED | Section 6.14 framework SemVer. Re-evaluate at Phase 5 retrospective. | QA Lead | 2026-04-09 | All phases |
| D-28 | Workspace tooling: vanilla npm workspaces (no pnpm, Turborepo, or Nx at this stage) | DECIDED | Section 4.2. Re-evaluate if CI times become a bottleneck at Phase 4 exit. | QA Automation | 2026-04-09 | All phases |
| D-29 | Phase 1 re-sized from **M to L** (planned 2–3 working weeks). Driver: scaffold script + affected-detection plumbing + TestRail port + per-package matrix. | DECIDED | Section 6.3 size note and Section 6.14 phase scheduling. | QA Lead | 2026-04-09 | Phase 1 |
| D-30 | TestRail per-package aggregation: each package writes its own results file; one post-processing job aggregates and POSTs to TestRail Run 175 once per nightly | DECIDED | Section 6.3 "TestRail aggregation". Eliminates race conditions on `add_results_for_cases`. | QA Automation | 2026-04-09 | Phase 1 |
| D-31 | The legacy POC keeps its existing `playwright.config.js` (no rename). Only the framework introduces a new `playwright.config.ts` per consuming team package. | DECIDED | Section 6.2 Step 0.B. Resolves the conflict between Phase 0's TS rename and the POC relocation. | QA Automation | 2026-04-09 | Phase 0 |
| D-32 | Phase 2 promotion-rule exception: framework foundational code is **lifted** from `packages/legacy-poc/` (not promoted from a `tests-*` package). After Phase 2 exit, the promotion rule applies without exception. | DECIDED | Section 6.4. | QA Lead | 2026-04-09 | Phase 2 |
| D-33 | Storage state naming convention (`.auth/<role>.json` per package, role-keyed) | DECIDED | Section 4.2.3.2. | QA Automation | 2026-04-09 | All phases |
| D-34 | Scaffold templates are the source of truth from Phase 0 Step G; the bootstrap `tests-billing-servicing` is **generated** from the templates (not hand-written), so the future scaffold script in Phase 1 produces a byte-identical package | DECIDED | Section 6.2 Step 0.G. Eliminates drift between bootstrap and future-scaffolded packages. | QA Automation | 2026-04-09 | Phase 0, Phase 1 |
| D-35 | **Kill the shim. The legacy POC keeps its own JS helpers, duplicated from the framework's TS Components, until Phase 5 sunset.** Duplication during the migration window is the accepted cost; it eliminates the entire `noEmit`/`workspace:*`/JS-runner contradiction. The legacy POC is frozen at Phase 2 exit (D-13), so the duplicated helpers do not drift in functionality — only the framework version evolves. | DECIDED | Section 6.4 (Phase 2 scope). Supersedes D-21. | QA Automation | 2026-04-09 | Phase 2 |
| D-36 | `packages/framework/package.json` declares an explicit `exports` field listing every importable subpath (`.`, `./config`, `./fixtures`, `./pages`, `./components`, `./api`, `./reporters`, `./helpers`, `./types`). Subpath imports outside this list are forbidden by the resolver. | DECIDED | Phase 0 Step 0.F deliverable. | QA Automation | 2026-04-09 | Phase 0 |
| D-37 | Phase 2 internal work order is *strict*: framework foundations (already in Phase 0) → API client (`DummyFirmApi`, `InvitationApi`, etc.) → factories → `firm.fixture` → Component lift → `worker-firm.fixture` → C25193 graduation → cookbook. Documented as Section 6.4.1. | DECIDED | Section 6.4.1. | QA Lead | 2026-04-09 | Phase 2 |
| D-38 | ESLint configuration: a single workspace-root flat config (`eslint.config.mjs`) covers every package via per-package overrides. The legacy POC's existing `eslint.config.mjs` is **merged into** the workspace root in Phase 0 Step 0.A, not relocated as a sibling. | DECIDED | Phase 0 Step 0.A. Avoids dual-config resolution conflicts. | QA Automation | 2026-04-09 | Phase 0 |
| D-39 | Framework breaking-change discipline: two-step deprecation, framework-change PR template, consumer impact preview, mandatory cross-team review for breaking changes | DECIDED | Section 6.11. Compensates for the lack of a "pin and upgrade later" escape valve under D-27 single version + `workspace:*`. | QA Lead | 2026-04-09 | All phases from Phase 2 |
| D-40 | `run-summary.json` schema version 1, with explicit producer/consumer contract; bumping the version is a framework breaking change | DECIDED | Section 6.11. Producer is each per-package CI invocation; consumers are the TestRail aggregator (D-30) and the time-series push. | QA Automation | 2026-04-09 | Phase 1 |
| D-41 | Storage states are shared at the workspace root (`<workspace>/.auth/<role>.json`), not duplicated per package. Each per-package `playwright.config.ts` references the absolute workspace-root path. | DECIDED | Section 6.2 Step 0.G. Eliminates seven `tim1` logins per nightly; mitigates R-25. | QA Automation | 2026-04-09 | Phase 0 |
| D-42 | API client accepts a Playwright `APIRequestContext` from the caller; it never logs in by itself. There is exactly one auth path through the program — the storage-state fixture. | DECIDED | Section 6.4.1 step 1. Eliminates the dual-auth-path failure mode. | QA Automation | 2026-04-09 | Phase 2 |
| D-43 | Legacy-poc hoist policy: `packages/legacy-poc/package.json` declares only the dependencies that diverge from the workspace root pin. Today: none. The single workspace lockfile is authoritative. | DECIDED | Section 6.2 Step 0.B. Avoids dual-dependency drift. | QA Automation | 2026-04-09 | Phase 0 |
| D-44 | Phase 0 starts with a walking-skeleton selector reconnaissance (Step 0.0): manually log into qa2 and identify the exact accessible-name selector before any code is written | DECIDED | Section 6.2 Step 0.0. Cheapest possible insurance against a Phase 0 demo failure (R-13). | QA Automation | 2026-04-09 | Phase 0 |
| D-45 | **Plan erratum F-01 (from Step 0.0):** `tim1` lands on `#platformOne`, not `#/dashboard`. The walking skeleton's post-login wait is `waitForURL(/#(platformOne\|dashboard)/)`, matching the legacy POC's `tests/_helpers/global-setup.js` pattern. Section 6.2 Step D's `#/dashboard` mention is corrected by this decision. | DECIDED | Recorded against Step 0.0 output (`docs/phase-0-selector-recon-output.md`). | Program Owner | 2026-04-09 | Phase 0 Step 0.F |
| D-46 | **Plan erratum F-02 (from Step 0.0):** the walking-skeleton spec asserts `getByRole('heading', { name: 'Operations' })` — there is **no `<h1>`** on tim1's post-login landing page; all 118 detected headings are `<h4>`. Section 6.2 Step D's `<h1>` + `/dashboard/i` recommendation is wrong and is replaced by this decision. | DECIDED | Recorded against Step 0.0 output. The selector is the first heading-like element on `#platformOne` and is reachable via `getByRole` (Section 4.7 rung 2). | Program Owner | 2026-04-09 | Phase 0 Step 0.F |
| D-47 | **Plan erratum F-03 (from Step 0.0):** D-19 pinned Playwright to `~1.47.0`, but the legacy POC's `^1.47.0` floating range had already resolved to `1.59.1` in `node_modules`. The workspace root `package.json` (Phase 0 Step 0.A) re-baselines D-19 to: `@playwright/test ~1.59.1`, `@typescript-eslint/{eslint-plugin,parser} ~8.58.0` (the rest of D-19's pin block stays at the original values: Node 20.x, TS 5.5, Zod 3.23, dotenv-flow 4.1, ESLint 10.2). All workspace packages now resolve through this single lockfile. | DECIDED | Recorded against Step 0.0 + Step 0.A. The legacy POC keeps its existing `^1.47.0` range until Phase 5 sunset. | Program Owner | 2026-04-09 | All phases |
| D-48 | **Correction to D-46 (from Step 0.G end-to-end run):** The walking-skeleton selector is `getByRole('heading', { name: 'Welcome to Platform One!' })`, **not** `getByRole('heading', { name: 'Operations' })`. Step 0.0 recon enumerated 118 `<h4>` menu items but those only appear after the SPA hydrates the menu — the first thing that renders is the `<h1>` "Welcome to Platform One!" splash heading. The h1 is a more stable landmark and a semantically clearer "you reached the landing page" check. D-46 stands as the original recon finding; D-48 supersedes it for the walking-skeleton spec. | DECIDED | Step 0.G walking-skeleton end-to-end run on qa2: with the Operations h4, the test failed because the menu had not yet hydrated; with the Welcome h1, the test passed in 19.7s. | QA Automation | 2026-04-09 | Phase 0 Step 0.G |
| D-49 | Workspace TS source files use **extensionless internal imports** (`from './foo'` not `from './foo.js'`) and the framework / tooling packages **do not** declare `"type": "module"`. Reason: Playwright's pirates-based TS loader transforms files as CJS at runtime; ESM-style `.js` extensions on TS imports cause `Cannot find module` errors when the test runner loads framework files transitively from spec files. The CJS-default + extensionless pattern works in both Playwright's CJS transform and tsx (used by tooling scripts). `tsconfig.base.json` has `allowImportingTsExtensions: true` for tooling scripts that explicitly use `.ts` extensions. | DECIDED | Discovered in Step 0.G end-to-end run. | QA Automation | 2026-04-09 | All phases |
| D-50 | `tsx` `~4.19.0` added as a workspace devDependency. Used to run TypeScript scripts under `packages/tooling/scripts/` (`expand-templates.ts`, `verify-bootstrap-vs-templates.ts`) directly via `npx tsx`. Node 20.19 LTS lacks `--experimental-strip-types` (Node 22.6+ feature), and bringing in a separate Python-based or build-step toolchain is heavier than a single npm dep. | DECIDED | Step 0.G.3. | QA Automation | 2026-04-09 | All phases |

Status values: `OPEN` (awaiting decision), `DECIDED` (recorded with rationale), `SUPERSEDED` (replaced by a later decision; cross-reference required).

---

## 8. Cross-Team Dependencies

The framework cannot succeed in isolation. Each dependency below has a named owner and a target resolution date.

| Dependency | Required from | Required by phase | Status |
|---|---|---|---|
| `data-testid` attributes on Account Billing screens (and feature areas thereafter) | Frontend team | Phase 3 → Phase 4 | Not started — gated by D-05 |
| `__REACT_QUERY_CLIENT__` exposed under `FOR_QA=true` | Frontend team | Phase 2 (component layer) | Not started — gated by D-08 |
| Stable `/qa/createDummyFirm.do` under load (no qa2 queueing > 60 s) | Backend / Platform | Phase 0 | Known degradation; mitigated by retries |
| CI platform provisioned and accessible from QA repo | Platform / DevOps | Phase 1 | D-02 = GitHub Actions; workflows landed in `6765f91`. Awaiting secret provisioning + branch protection (manual GitHub UI) |
| Secret store namespace for QA credentials | Security | Phase 0 | Pending D-03 |
| Slack webhook to `#qa-alerts` | Platform | Phase 1 | Not started |
| Time-series store endpoint for run metrics | Platform | Phase 1 (best effort) → Phase 2 (firm) | Not started |
| Confluence space for living documentation | QA Lead | Phase 0 Step E | Not started |
| Named Security counterpart for credential rotation (D-22) | Engineering Mgr | Pre-Phase 0 | Not started — **Phase 0 cannot start without this** |
| Sandbox TestRail user + sandbox GeoWealth admin for the credential-rotation dry run | QA Lead | Pre-Phase 0 | Not started |
| Single named Program Owner committed (Section 6.14) | Engineering Mgr | Pre-Phase 0 | Not started |
| Frontend leads identified for each of the seven team feature surfaces (R-02 expanded for monorepo) | Frontend leads | Phase 3 → Phase 4 | Not started — D-05 may need to be split per team |
| Confirmation that the six non-Billing-Servicing team contacts know they are getting an empty bootstrap package in Phase 0 (no surprise) | Program Owner | Pre-Phase 1 | Not started |
| Throwaway TestRail user + throwaway GeoWealth dummy admin for the Phase 0 Step 0.D credential-rotation dry run | TestRail admin + Program Owner | Pre-Phase 0 Step 0.D | Not started |
| Pre-flight `tim1` credentials usable from a non-developer machine (CI runner identity) | Security + Platform | Phase 1 entry | Not started |
| Second QA Automation contributor (R-11 mitigation, milestone M3) | Engineering Mgr | End of Phase 1 | Not started |
| Backend permission-toggle for `MERGE PROSPECT` (per-firm) | Backend team | Phase 5 | Not started — required to unblock C26060 / C26085 |
| Audit-trail fix for Account Billing Inception Date in qa3 | Backend team | Phase 5 | Open from POC notes |

---

## 9. Success Metrics and KPIs

The framework's value is measurable. The following KPIs are reviewed monthly by the QA Lead and quarterly with engineering leadership.

| KPI | Definition | Target | Source |
|---|---|---|---|
| **Suite size** | Count of `@regression` specs | Quarterly growth aligned with feature delivery | Playwright run summary |
| **Pass rate (regression)** | `passed / (passed + failed)` over the last 14 nightly runs | ≥ 98% | Time-series store |
| **Flake rate** | Specs failing then passing on retry / total specs | ≤ 2% week over week | Time-series store |
| **Mean spec duration** | Median over `@regression` | ≤ 45 s; p95 ≤ 120 s | Playwright run summary |
| **Wall-clock for nightly** | End-to-end pipeline duration per environment | ≤ 60 min | CI metadata |
| **PR gate latency** | Median PR-gate pipeline duration | ≤ 8 min | CI metadata |
| **`data-testid` coverage** | Percentage of Page Object selectors using `getByTestId` | Baseline reported by end of Phase 3; ≥ 70% by end of Phase 4 | Static analysis script |
| **Mean time to triage** | Hours from nightly failure to assigned owner | ≤ 4 working hours | Triage tooling |
| **Quarantine clearance** | `@flaky` specs resolved within 10 working days | ≥ 90% | TestRail / repo audit |
| **Test debt ratio** | `(test.skip + test.fixme) / total specs` | ≤ 5% | Static analysis script |
| **TestRail coverage** | Active `@regression` specs mapped to TestRail cases | 100% | TestRail reporter audit |
| **Parity-gate compliance** | Migrated specs that reached 5 consecutive green nights before legacy deletion | 100% | Migration tracker |
| **Phase exit on time** | Phases closed within +25% of their planned relative duration (Section 6.14) | ≥ 80% | Phase tracking issues + verification records |
| **Bus-factor coverage** | Architectural areas with at least two contributors who can review changes | ≥ 50% by end of Phase 2; ≥ 90% by end of Phase 4 | CODEOWNERS audit |

---

## 10. Risk Register

Risks are scored on a 1–5 scale for likelihood (L) and impact (I). Score = L × I.

| ID | Risk | L | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-01 | TypeScript adoption stalls migration if team is unfamiliar | 2 | 4 | 8 | Pair-programming during Phase 0; code-review checklist; team training session before Phase 2. | QA Lead |
| R-02 | `data-testid` rollout deprioritized by frontend team | 4 | 4 | 16 | Phase 3 kickoff (Section 6.5) commits a frontend owner; track in Section 9 KPI; escalate to engineering management at 60 days no movement. Phase 5 cannot exit without resolution. | QA Lead, Frontend lead |
| R-03 | Dummy firm accumulation degrades qa2 / qa3 performance | 2 | 4 | 8 | Quarterly Platform audit (Section 5.8); contingency cleanup script kept ready. | Platform lead |
| R-04 | `/qa/*` endpoints change shape without notice | 3 | 3 | 9 | Zod schemas (Section 4.6); add `/qa/*` change notifications to backend team's PR template. | Backend leads |
| R-05 | ag-Grid Enterprise upgrade breaks selectors and editor activation | 2 | 5 | 10 | Component class isolates the surface; nightly run will detect within 24 h; ag-Grid changelog subscription. | QA Automation |
| R-06 | qa2 / qa3 environment instability causes false negatives | 4 | 3 | 12 | Pre-flight job (Section 5.9, built in Phase 1); environment quarantine workflow; clearly distinguishable env-failure errors. | Platform lead |
| R-07 | Credential leak from POC's committed `testrail.config.json` | 3 | 5 | 15 | **Phase 0 day-1 rotation** (Decision D-11) plus secret-scanning pre-commit hook; full git history audit by Security before public-facing release. | Security |
| R-08 | Flake budget breached, freezing test additions | 3 | 3 | 9 | Stabilization SLA (Section 5.6); weekly review meeting; fast-track quarantine. | QA Lead |
| R-09 | TestRail integration failure during nightly | 2 | 2 | 4 | Existing reporter retry/fallback (POC); TS port validated against sandbox in Phase 1 before pointing at Run 175; local artifact retained for manual import. | QA Automation |
| R-10 | Migration goes long; POC and new framework drift | 3 | 4 | 12 | Time-boxed phases; POC freeze at Phase 2 exit (D-13); weekly status report; explicit sunset criteria in Phase 5. | QA Lead |
| R-11 | Single QA Automation contributor — bus factor of 1 | 4 | 5 | 20 | Bus-factor milestones M1–M5 in Section 6.15. Recruiting a second contributor by end of Phase 1 (M3) is the program's hardest non-technical commitment. | Engineering Mgr |
| R-12 | C25193 lift effort is larger than the L sizing assumes (hidden helper sprawl, magic identifiers, product quirks) | 3 | 3 | 9 | Mandatory Phase 2 entry spike (Section 6.4) produces a one-page scoping note before any helper is lifted. If the spike reveals XL+ effort, Phase 2 is re-baselined and the second contributor (M3) is non-negotiable. | QA Lead |
| R-13 | Walking skeleton selector breaks because no `data-testid` exists | 3 | 2 | 6 | Walking skeleton uses `getByRole('heading', { name: /dashboard/i })` (Section 6.2 Step D), which is stable without `data-testid`. Re-validated at Phase 1 exit. | QA Automation |
| R-14 | Storage state expires between nightly runs and breaks the suite the next morning | 4 | 3 | 12 | Storage-state freshness re-validation built into `auth.fixture.ts` in Phase 0 Step D. Refresh-on-expiry is the default behaviour, not an opt-in. | QA Automation |
| R-15 | qa2 instability blocks Phase 0 walking skeleton | 3 | 4 | 12 | Decision D-23: TEST_ENV fallback to qa3 after two consecutive bad nights; Platform escalation in parallel. | Platform lead |
| R-16 | Historical credential leak in git history is never resolved | 3 | 4 | 12 | Decision D-20 forces an explicit choice (rewrite vs. accept) at Phase 0 Step C. The plan does not allow indefinite deferral. | Security |
| R-17 | Monorepo per-package CI matrix becomes unmanageable as the number of team packages grows | 3 | 3 | 9 | Affected-package detection (`scripts/changed-packages.sh`) keeps PR-gate cost proportional; `ci-matrix.ts` generates the matrix dynamically so adding a new team package via the scaffold script never requires a workflow edit. Re-evaluate at Phase 4 exit (D-28). | QA Automation |
| R-18 | Scaffold script template rot (templates drift from framework reality, new teams scaffold broken packages) | 3 | 4 | 12 | The scaffold-test CI workflow runs the script end-to-end on every PR touching the templates and validates the 30-minute SLA. Template rot fails CI before merge. `scaffold:doctor` lets existing teams detect drift between their package and the current templates. | QA Automation |
| R-19 | Cross-team Page Object promotion creates merge conflicts and review-thrash (one team needs a Page Object the other team owns) | 3 | 3 | 9 | Section 4.2.2 promotion rule: any reusable code is promoted to `framework/` in a single QA-Automation-owned PR. The originating team is co-author; the consuming team is reviewer. ESLint rule `no-cross-team-import` prevents the anti-pattern. | QA Lead |
| R-20 | Six empty team packages bit-rot before their teams write tests | 2 | 3 | 6 | The scaffold-generated smoke spec is *real* — it logs in and asserts a dashboard heading. Each empty team package's smoke spec runs nightly. If it goes red, the framework has a problem the team would have hit on day one anyway. `scaffold:doctor` is run quarterly against every empty package to detect template drift. | QA Automation |
| R-21 | TypeScript path-alias footgun: aliases declared only in `tsconfig.base.json` are not re-resolved by extending tsconfigs, breaking IDE go-to-definition and `tsc` resolution silently in extending packages | 4 | 3 | 12 | Section 4.2.3.1 documents the pitfall; every package's tsconfig duplicates the `paths` block (the scaffold script writes it). A custom ESLint rule (`local-rules/duplicate-paths-block`) fails CI if a package's tsconfig is missing the block. | QA Automation |
| R-22 | Scaffold-test workflow secrets-injection misconfigured; the scaffolded smoke spec fails not because the script is broken but because credentials are missing | 3 | 3 | 9 | Explicit secrets-injection contract documented in Phase 1 scope. The scaffold script's "missing pre-condition" detection (Section 4.2.5) prints a clear error pointing at the contract instead of failing inside the smoke spec. | QA Automation |
| R-23 | Single-version drift across `packages/*/package.json` files goes unnoticed until release | 3 | 2 | 6 | `check-versions.ts` runs as a pre-commit hook and a CI lint check (D-27, Phase 1 deliverable). A deliberately-misversioned-package CI test verifies the enforcement works before Phase 1 exit. | QA Automation |
| R-24 | A single framework breaking-change PR cascades and breaks every team package's nightly on the same night | 3 | 4 | 12 | Framework breaking-change discipline (D-39): two-step deprecation, framework-change PR template, consumer impact preview, mandatory cross-team review. ESLint deprecation warnings flag usage of soon-to-be-removed symbols at the consumer site. | QA Lead |
| R-25 | Storage-state freshness re-validation overloads qa2's `/react/loginReact.do` under parallel nightly load | 3 | 3 | 9 | Per-worker (not per-test) re-validation, gated by `mtime` against `GW_SESSION_TTL_MINUTES` minus a safety margin. Bounds extra HTTP volume to N workers per nightly. Re-evaluated at Phase 1 exit when real CI volume is observable. | QA Automation |
| R-26 | Bootstrap-vs-templates drift (D-34): the manually-expanded `tests-billing-servicing` package diverges from what the Phase 1 scaffold script will later produce | 2 | 4 | 8 | Phase 0 Step 0.G ships `verify-bootstrap-vs-templates.sh` that diffs the bootstrap against the templates (with placeholders substituted) on every PR. Drift fails CI before merge. | QA Automation |

Highest-priority risks (score ≥ 12) — **R-11, R-02, R-07, R-06, R-10, R-14, R-15, R-16, R-18, R-21, R-24** — must have an active mitigation owner before Phase 0 begins.

---

## 11. Open Items Checklist (Pre-Phase-0)

A pragmatic checklist that the QA Lead walks through before declaring Phase 0 ready to start. Each item references the section where it is specified in detail.

**Decisions (Section 7).** Phase 0 cannot begin until these are resolved:
- [ ] **D-01** TypeScript strict mode — DECIDED.
- [ ] **D-24** Monorepo with npm workspaces (supersedes D-04) — DECIDED.
- [ ] **D-25** POC area-to-team mapping (all current POC → Billing & Servicing) — DECIDED.
- [ ] **D-26** Scaffold script as Phase 1 deliverable — DECIDED.
- [ ] **D-27** Single monorepo version — DECIDED.
- [ ] **D-28** npm workspaces (no pnpm/Turborepo/Nx initially) — DECIDED.
- [ ] **D-29** Phase 1 re-sized to L (2–3 weeks) acknowledged by Engineering Manager.
- [ ] **D-31** Legacy POC keeps `playwright.config.js` (no rename) — DECIDED.
- [ ] **D-34** Scaffold templates as the source of truth from Phase 0 Step G — DECIDED.
- [ ] **D-35** Shim killed; legacy POC keeps duplicated JS helpers until Phase 5 sunset — DECIDED.
- [ ] **D-36** Framework `package.json` declares explicit `exports` field — DECIDED.
- [ ] **D-37** Phase 2 internal work order strict (Section 6.4.1) — DECIDED.
- [ ] **D-38** Single workspace-root ESLint flat config — DECIDED.
- [ ] **D-39** Framework breaking-change discipline — DECIDED.
- [ ] **D-40** `run-summary.json` schema version 1 — DECIDED.
- [ ] **D-41** Storage states shared at workspace root — DECIDED.
- [ ] **D-42** API client accepts `APIRequestContext`; no inline login — DECIDED.
- [ ] **D-43** Legacy-poc hoist policy — DECIDED.
- [ ] **D-44** Walking-skeleton selector reconnaissance complete (Phase 0 Step 0.0) — DECIDED.
- [ ] **D-07** TestRail Run 175 cadence agreed with Product — DECIDED.
- [ ] **D-11** Credential rotation owner committed (Security + QA Lead) — DECIDED.
- [ ] **D-22** Named Security counterpart confirmed in writing — DECIDED.
- [ ] **D-19** Version pinning approved and `package-lock.json` policy accepted — DECIDED.
- [ ] **Program Owner** named (Section 6.14) — recorded in Phase 0 tracking issue.

**Decisions due before later phases** (must have owner + due date, not necessarily decided):
- [ ] **D-03** Secret store — owner committed (blocks Phase 0 day-1 rotation).
- [x] **D-02** CI platform — DECIDED: GitHub Actions (2026-04-09).
- [ ] **D-08** `__REACT_QUERY_CLIENT__` exposure — owner committed (blocks Phase 2).
- [ ] **D-05** Frontend `data-testid` partner — owner committed (blocks Phase 3).
- [ ] **D-06** First migration scope — owner committed (blocks Phase 4).

**Dependencies (Section 8).**
- [ ] Confluence space created and linked from this document.
- [ ] Existing committed credentials inventoried; Security has rotation plan.
- [ ] Engineering Manager has acknowledged the second-contributor commitment (R-11 / M3) — **end of Phase 1**, blocking Phase 2 entry.

**Risks (Section 10).**
- [ ] All score-≥-12 risks (R-02, R-06, R-07, R-10, R-11) have a named mitigation owner who has acknowledged in writing.

**Operational.**
- [ ] Phase 0 tracking issue created with the Section 6.2 exit criteria as a checklist.
- [ ] Phase 0 kickoff meeting scheduled.
- [ ] This document linked from `MEMORY.md` and the Confluence space.

---

## 12. Appendix — Detailed POC Inventory

### 12.1 Current File Structure

```
automation-geo-tests/
├── package.json                    # 10 npm scripts
├── playwright.config.js            # Worker-scoped workerFirm fixture (monkey-patched)
├── testrail.config.json            # Run 175, base URL (qa3), credentials (committed)
├── eslint.config.mjs               # ESLint 10 flat config + Playwright plugin
├── .prettierrc.json                # 100-char width, trailing comma es5
├── tests/
│   ├── _helpers/                   # 7 files, ~1200 LOC
│   │   ├── index.js                # Barrel re-export
│   │   ├── global-setup.js         # Storage state init
│   │   ├── qa3.js                  # Login, navigation, billing workflows (~400 LOC)
│   │   ├── ui.js                   # React widget primitives (~600 LOC)
│   │   ├── worker-firm.js          # Dummy firm provisioning + prospect cache (~300 LOC)
│   │   └── build-*.js              # XLSX builders
│   ├── .auth/tim1.json             # Storage state (gitignored)
│   ├── fixtures/                   # Static xlsx templates
│   ├── account-billing/            # 15 specs
│   ├── billing-specs/              # 4 specs
│   ├── bucket-exclusions/          # 13 specs
│   ├── create-account/             # 7 specs
│   ├── unmanaged-assets/           # 12 specs
│   └── platform-one/
│       ├── auto-link/              # 7 specs (all test.fixme)
│       └── merge-prospect/         # 8 specs
├── reporters/testrail-reporter.js  # ~180 LOC
└── scripts/                        # 9 utilities
```

### 12.2 Hybrid Isolation Model

| Phase | Pattern | Isolation | Risk |
|---|---|---|---|
| Phase 1 (write/read) | `workerFirm` (per-worker dummy firm) | Each worker owns its firm | Low |
| Phase 2 (read-only) | Static Firm 106 + `tyler@plimsollfp.com` | Shared across workers | None (read-only) |

Phase 1 was migrated away from Firm 106 after a parallel-load race condition: eight workers concurrently mutating the same Arnold/Delaney account.

### 12.3 GeoWealth Backend Surface (Test-Relevant)

- **Struts 2** with `.do` extension; namespaces: `/react`, `/bo`, `/qa`, `/portal`.
- **Login flow:** `POST /react/loginReact.do` → `ReactIndexAction.login()`.
- **QA endpoints (gated by `CommonGwAdminQaAction.canExecuteAction()`):**
  - `/qa/createDummyFirm.do` — firm + advisor + accounts (~6s)
  - `/qa/createInvitationToken.do` — onboarding tokens
  - `/qa/invalidateToken.do`
  - `/qa/importCustodianAccount.do`
  - `/qa/createCrntCostBasis*.do`
  - `/qa/executeMFs.do`
  - `/qa/simulateSchwabTransaction.do`
  - `/qa/uploadTPAMFile.do`
- **Auth:** session/cookie, `LoginInterceptor` on every request, multi-tenancy by `firmCd`.
- **React routes:** hash-based (`#/login`, `#/advisors`, `#/accounts`), lazy-loaded modules.
- **Domain core:** Firm → Advisor/Client → Account → Custodian/Instrument; Strategy/Model; AccessSet/Role.

---

## 13. Revision History

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1 | 2026-04-09 | QA Automation | Iteration 1: translation to English, corporate document structure, executive summary, glossary, revision history. |
| 0.2 | 2026-04-09 | QA Automation | Iteration 2: added Page/Component contracts, fixture composition example, Zod-validated API client, selector ladder, timeout/retry/trace policy, test authoring conventions. |
| 0.3 | 2026-04-09 | QA Automation | Iteration 3: added GeoWealth-specific patterns — Struts `.do` contracts, hash-routing waits, ag-Grid Enterprise quirks, Redux/React Query awareness, role matrix, `data-testid` reality, and a `/qa/*` endpoint catalog with a production safety guard. |
| 0.4 | 2026-04-09 | QA Automation | Iteration 4: added Operations section — pipeline topology, sharding, secrets, branch protection, observability, flake management with SLAs, RACI ownership map, test data lifecycle, environment health pre-flight. Renumbered downstream sections. |
| 0.5 | 2026-04-09 | QA Automation | Iteration 5: converted Open Decisions to a Decision Register; added Cross-Team Dependencies, Success Metrics & KPIs, Risk Register, and a Pre-Phase-0 Checklist. Strengthened the Executive Summary with headline asks. Final renumbering of the appendix and revision history. |
| 0.6 | 2026-04-09 | QA Automation | Migration plan deep revision (5 iterations focused on Section 6). Restructured into six phases (0–5) addressing fifteen findings: security-first day-1 rotation, CI before content, walking skeleton, parity gate, POC freeze, frontend kickoff phase, backlog/sunset phase. Added per-phase deliverables and exit criteria, dependency graph, rollback table, verification checklist, resourcing/T-shirt sizing, and explicit R-11 bus-factor milestones. Added decisions D-11/D-12/D-13 and aligned the Decision Register, Dependencies, KPIs, Risks, and Pre-Phase-0 Checklist with the new phase numbering. Updated executive summary headline asks. |
| 0.7 | 2026-04-09 | QA Automation | Second migration-plan deep revision (5 iterations) addressing 18 surviving findings. Fixes: parity-gate vs same-PR deletion mechanics (split into port and deletion PRs); `data-testid` KPI/phase mismatch; `C25193` double-migration ambiguity; M3 retimed to end of Phase 1; Phase 5 `allowJs` drop preempted by `scripts/` conversion in Phase 4; explicit credential rotation ordering (Steps A–E in Phase 0); migration tracker artifact defined; POC freeze made mechanically enforced; dual TestRail reporter coexistence forbidden until Phase 5 sunset; Phase 3 frontend batch sized explicitly; Phase 5 backend cooperation SLA. Adds: Section 6.13 parity-gate calendar reality and cohort sizing; ADR-0001 inline note on Phase 4 ordering; PR-gate latency re-baseline at Phase 4 exit; pre-flight false-positive override; decisions D-14 through D-18; renumbered Section 6.13/6.14. |
| 0.8 | 2026-04-09 | QA Automation | Third migration-plan deep revision (5 iterations) focused on day-1 readiness — making Phase 0 and Phase 1 bulletproof. Fixes 28 findings: technical preconditions (Node 20, Playwright 1.47, TS 5.5, Zod 3.23, dotenv-flow 4.1, ESLint 10.2 — pinned; `package-lock.json`; `npm ci`); explicit `playwright.config.js → .ts` rename; tsconfig `paths` alias; storage-state freshness re-validation; credential rotation Step A inventory + named Security counterpart; explicit git-history rewrite-vs-accept decision; CommonJS↔TS shim mechanics via `legacy-shim.ts` + dynamic import; `#qa-alerts` circular dependency resolved; ESLint rule reads sidecar JSON not Markdown; CDP access encapsulated in `withCdpClick` helper; Phase 2 entry spike for C25193 lift discovery; relative cohort sizing scaled to area size; qa2 stability fallback to qa3 (D-23). Adds Section 6.14 Program Governance: single accountable Program Owner, kill criteria, planned phase durations (working weeks), status reporting cadence, phase verification artifact, credential-rotation dry run, framework SemVer. Adds CODEOWNERS, `docs/adr/`, status-report template, `docs/phase-verifications/` to Phase 0 deliverables; tags `v0.1.0` at Phase 0 exit. Decisions D-19 through D-23. New risks R-12 through R-16. Fixed ESLint 9 → 10 typo throughout. Renumbered Section 6.14 → 6.15. |
| 0.9 | 2026-04-09 | QA Automation | **Multi-team monorepo restructure (5 iterations).** New requirement: the framework will be consumed by seven teams (Trading, Platform, Billing & Servicing, Reporting, Investments, Integrations, Custody & PA), with a self-service scaffold script that onboards new teams within 30 minutes. Section 4.2 rebuilt around `packages/framework/`, `packages/tooling/`, `packages/tests-<team>/` (one per team), and `packages/legacy-poc/` (interim home for the existing POC). Added 4.2.2 (package boundaries, one-way dependency rule, promotion rule), 4.2.3 (tsconfig hierarchy + `definePlaywrightConfig`), 4.2.5 (scaffold script spec: CLI surface, generated artifacts, 30-minute SLA, scaffold-test CI workflow, `scaffold:doctor` drift detection). Phase 0 now bootstraps the workspace and relocates the POC into `packages/legacy-poc/`. Phase 1 ships the scaffold script as a first-class deliverable with M3 as a hard exit gate. Phase 4 rewritten as per-team migration with explicit POC area-to-team mapping (D-25: all current POC content → Billing & Servicing); the other six packages remain empty bootstraps. Phase 5 sunset deletes `packages/legacy-poc/`. D-04 SUPERSEDED by D-24 (monorepo). New decisions D-24 through D-28. New risks R-17 (CI matrix), R-18 (scaffold rot), R-19 (cross-team promotion), R-20 (empty package bit-rot). ADR-0002 (monorepo with npm workspaces). Pre-Phase-0 checklist refreshed; executive summary headline asks expanded. |
| 1.0 | 2026-04-09 | QA Automation | **Fourth migration-plan deep revision (5 iterations) — post-monorepo hardening.** Addresses 30 surviving findings, most introduced by the v0.9 monorepo restructure or surfaced when reading Phase 0/1 through a multi-package lens. **Critical contradiction fixes:** Phase 0 step ordering rewritten as 0.A–0.H to enforce two cardinal rules — *never mix relocation with content change in one commit* and *the framework's foundational layer is built **before** the bootstrap consumer needs it*. Workspace is bootstrapped before the POC is touched (0.A); POC relocation is a pure rename (0.B); env-var refactor happens at the new path (0.C); credential rotation has an explicit dry-run (0.D); framework foundational layer (`auth.fixture`, `globalSetup`, `definePlaywrightConfig`, environments, dotenv loader) is now a Phase 0 deliverable (0.F). Resolved contradiction that "framework is empty until Phase 2" — Phase 0 now builds exactly what the walking skeleton needs, deferring the full Component library and API client to Phase 2. **D-31** decided: legacy POC keeps its `playwright.config.js`; only the framework introduces `.ts` configs per team package. **D-34** decided: scaffold templates are the source of truth from Phase 0 Step G; bootstrap `tests-billing-servicing` is **generated from templates**, not hand-written. **Section 4.2.3.1** added: TypeScript path-alias footgun in extending tsconfigs documented; ESLint rule and scaffold-script auto-write mitigate. **Section 4.2.3.2** added: storage-state naming convention (D-33). **Section 4.2.3.3** added: workspace root scripts table. D-21 wording fixed (shim uses `@geowealth/e2e-framework/legacy-shim`, not the obsolete `@/*` alias). **Phase 1 deep plumbing**: affected-package detection (`changed-packages.ts`) specified in detail with algorithm and unit tests; multi-package CI invocation (no top-level Playwright config); TestRail aggregation across packages via `testrail-aggregator.ts` (D-30, eliminates race on `add_results_for_cases`); single-version enforcement (`check-versions.ts`, D-27); scaffold-test secrets-injection contract. **Phase 1 re-sized M → L** (D-29, 2–3 weeks); planned phase durations and resourcing tables updated. **Phase 2 cross-package work** acknowledged: Component lift is `packages/legacy-poc/tests/_helpers/ui.js` → `packages/framework/src/components/`; promotion-rule Phase 2 exception (D-32) recorded. C25193 graduation lands explicitly at `packages/tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts` and is **not** re-migrated in Phase 4. **POC freeze enforcement** updated for monorepo paths (`packages/legacy-poc/tests/<area>/`). **CODEOWNERS structured section markers** added so the scaffold script and humans can both edit safely. **Migration tracker schema** gets a `target_package` column. **Scaffold success SLA pre-conditions** documented (Node 20, network to qa2, `.env.local`, branch checked out). **PR-gate latency target** clarified: scaffold-test runs in a parallel job, not in series with the gate. **Phase 1 exit criteria expanded**: framework-own tests run in CI, byte-identical reporter payload requirement softened to "logically equivalent", aggregator and version-check verified. New decisions D-29 through D-34. New risks R-21 (TS path-alias footgun), R-22 (scaffold-test secrets misconfig), R-23 (single-version drift). |
| 1.1 | 2026-04-09 | QA Automation | **Fifth migration-plan deep revision (5 iterations) — kill the broken shim, harden Phase 2 internals, document the operational realities.** Addresses 26 findings. **Day-1 blocker fixes:** D-21 (CommonJS shim) is **SUPERSEDED by D-35** — the shim cannot work because framework has `noEmit: true` and the legacy POC runs the JS Playwright runner, which does not compile imported `.ts` source. Replacement: legacy POC keeps duplicated JS helpers until Phase 5 sunset; duplication during the migration window is the accepted cost. **D-36** added: `packages/framework/package.json` declares an explicit `exports` field listing every importable subpath; out-of-list imports rejected by Node and by `local-rules/framework-exports-only`. **D-37** added and **Section 6.4.1** added: Phase 2 internal work order is now strict — API client → factories → firm/worker-firm fixtures → Component lift → C25193 port (week 1 of Phase 2) → cookbook. **D-38** added: ESLint configuration is a single workspace-root flat config; the legacy POC's `eslint.config.mjs` is *merged into* the workspace root in Step 0.A, not relocated. **`worker-firm.js` lift** is now an explicit Phase 2 deliverable (was implicit). **Operational fixes:** auth-fixture freshness check is **once per worker, not per test** (R-25); pre-flight uses a real `POST /react/loginReact.do` (the previous bare GET was wrong); nightly cron is **UTC with explicit offsets** (`0 22 * * *`); `detect-secrets` is wired into a pre-commit hook in Step 0.A; the dead-code program-wide cohort cap is removed; Phase 4 area-count off-by-one fixed (six of seven, not "all six"); Phase 4 opens **one epic with seven sub-tasks**, not seven separate issues. **Polish:** **D-39** framework breaking-change discipline added (two-step deprecation, PR template, consumer impact preview, cross-team review). **D-40** `run-summary.json` schema versioned. D-04 SUPERSEDED row gets an explicit "see D-24" pointer. Bus-factor coverage KPI relaxed to "≥ 50% by end of Phase 2; ≥ 90% by end of Phase 4". Phase 5 grows two new deliverables: post-migration test-authoring cookbook section in `WRITING-TESTS.md`, and a **`v1.0.0` framework tag** at Phase 5 exit. New risks R-24 (framework breaking-change cascade), R-25 (auth-fixture login pressure), R-26 (bootstrap-vs-templates drift). |
| 1.2 | 2026-04-09 | QA Automation | **Sixth migration-plan deep revision (5 iterations) — clean up shim aftermath, fix Phase 0 reconnaissance, formalize template mechanics, harden governance details.** Addresses 27 findings. **Critical:** Phase 2 wording changed from "Component lift" to "Component rewrite using JS as a behavioural reference" — the lift language was inherited from the pre-shim-killed era and was misleading. Dead "shim verification CI job" sentence removed from Phase 2 scope. `framework/src/index.ts` contradiction resolved (Step 0.A no longer creates a no-op marker; the real public-surface re-export lands in Step 0.F per D-36). **New Phase 0 Step 0.0** added: walking-skeleton selector reconnaissance — manually log into qa2 and identify the exact accessible-name selector **before** any code is written, recorded as **D-44** (R-13 mitigation). **Step 0.G fully reorganized** as 0.G.1–0.G.4: substitution function first (one implementation, two callers, no drift), templates enumerated explicitly with all eight files named, generation script `expand-templates.ts`, parity verification rewritten in TypeScript (was a bash script that couldn't reproduce the substitution logic). Walking-skeleton spec renamed `dashboard.spec.ts` (was `login.spec.ts`) to eliminate the future scaffold-collision with team smoke specs. **D-41** added: storage states shared at workspace root, not duplicated per package — eliminates seven `tim1` logins per nightly. **D-42** added: API client accepts an `APIRequestContext` from the caller and never logs in by itself — exactly one auth path in the program. **D-43** added: legacy-poc hoist policy (declare only divergent deps; today none). Phase 4 Page Object structure clarified as nested under `<area>/`. Phase 5 sunset now archives `legacy-poc/tests/_helpers/` and `scripts/` as `docs/historical/legacy-poc-helpers.tar.gz` before deletion. **Worker-firm dual provisioning during Phase 2-4** acknowledged (parallel implementations both create dummy firms). **Phase 1 explicit step:** scaffold the six empty team packages by running the script six times once it is green. **Phase 0 deliverables** grow: `docs/migration-tracker.md` (created with header, populated in Phase 4), `docs/RETROSPECTIVE.md` template, six framework-foundation files via the framework's own playwright config. Framework `playwright.config.ts` now an explicit Phase 2 deliverable. **Governance:** kill criterion #5 rewritten to use phase-duration overrun instead of unmeasurable engineering hours. Section 7 grows a "Phase index" navigation table mapping decisions to phase boundaries. Migration tracker `last_state_change` is filled by a CI hook at merge time, never by humans. Backup-and-disaster-recovery section added (developer .env.local, CI secrets, qa env data). Section 8 grows three new dependencies: throwaway TestRail user, throwaway dummy admin, CI runner identity for `tim1`. Pre-Phase-0 checklist refreshed with D-35 through D-44. |
