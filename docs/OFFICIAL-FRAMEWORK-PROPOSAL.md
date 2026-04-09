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
1. Approve TypeScript strict mode (Decision D-01).
2. Authorize an immediate Phase 0 day-1 credential rotation of `testrail.config.json` (Decision D-11). The currently committed credentials must be treated as compromised.
3. Nominate a CI platform and a secret store (Decisions D-02, D-03). CI is now a Phase 1 deliverable, not a Phase 3 chore.
4. Commit a frontend owner for the `data-testid` rollout (Decision D-05). Phase 5 cannot exit without this.
5. Commit a second QA Automation contributor by the end of Phase 2 (Risk R-11, milestone M3). This is the program's hardest non-technical commitment.
6. Confirm the Phase 4 first-area scope (Decision D-06).

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
| Lint and formatting baseline | `eslint.config.mjs`, `.prettierrc.json` | ESLint 9 flat config plus Playwright plugin and Prettier already enforced. |
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
| Linting | **ESLint 9 flat config + `eslint-plugin-playwright` + `@typescript-eslint`** | Continuation of POC baseline plus TypeScript awareness. |
| Formatting | **Prettier** | Already adopted. |
| Package manager | **npm** | Continuation of POC baseline. |

### 4.2 Repository Layout

```
automation-geo-tests/
├── src/
│   ├── config/                    # Environment loading, typed config object
│   │   ├── environments.ts        # qa1–qa10, qatrd, staging definitions
│   │   └── index.ts
│   ├── fixtures/                  # Playwright custom fixtures
│   │   ├── base.ts                # Composes all fixtures into a single `test` export
│   │   ├── auth.fixture.ts        # Storage state per role
│   │   ├── firm.fixture.ts        # workerFirm + per-test firm scopes
│   │   └── api.fixture.ts         # Authenticated API client
│   ├── pages/                     # Page Object Model
│   │   ├── BasePage.ts            # navigate, waitForHashRoute, common waits
│   │   ├── auth/LoginPage.ts
│   │   ├── backoffice/
│   │   │   ├── FirmAdminPage.ts
│   │   │   └── OperationsCentrePage.ts
│   │   ├── accounts/
│   │   │   ├── AccountBillingPage.ts
│   │   │   ├── CreateAccountPage.ts
│   │   │   └── components/        # AgGridEditor, BillingHistoryGrid
│   │   ├── platform-one/
│   │   │   ├── MergeProspectPage.ts
│   │   │   └── AutoLinkPage.ts
│   │   └── components/            # Cross-cutting React widgets
│   │       ├── ReactDatePicker.ts
│   │       ├── ComboBox.ts
│   │       ├── AgGrid.ts
│   │       └── NumericInput.ts
│   ├── api/                       # Typed client for .do endpoints
│   │   ├── client.ts              # Base, auth, retry
│   │   ├── qa/                    # /qa/* QA hooks
│   │   │   ├── DummyFirmApi.ts
│   │   │   ├── InvitationApi.ts
│   │   │   └── CustodianApi.ts
│   │   └── react/                 # /react/* business endpoints
│   │       └── LoginApi.ts
│   ├── data/                      # Test data factories and constants
│   │   ├── factories/
│   │   │   ├── FirmFactory.ts
│   │   │   ├── AccountFactory.ts
│   │   │   └── ProspectFactory.ts
│   │   ├── constants/
│   │   │   ├── instruments.ts     # Apple UUID and other global instruments
│   │   │   └── roles.ts
│   │   └── builders/              # XLSX builders (bucket, unmanaged, bulk)
│   ├── helpers/                   # Generic utilities
│   │   ├── waits.ts
│   │   ├── retry.ts
│   │   └── uuid.ts
│   └── types/                     # Shared TS types mirroring Java entities
│       ├── Firm.ts
│       ├── Account.ts
│       └── User.ts
├── tests/
│   ├── smoke/                     # @smoke — under 5 min, gates every PR
│   ├── regression/                # @regression — full suite, nightly
│   │   ├── account-billing/
│   │   ├── bucket-exclusions/
│   │   ├── create-account/
│   │   ├── platform-one/
│   │   └── unmanaged-assets/
│   └── journeys/                  # @journey — multi-feature user stories
├── reporters/
│   └── testrail-reporter.ts       # Ported from POC, fully typed
├── scripts/                       # CLI utilities (fixture generation, case listing)
├── playwright.config.ts
├── tsconfig.json
├── .env.example                   # Template, no real secrets
├── .github/workflows/             # Or .gitlab-ci.yml — CI matrix per environment
└── docs/
    ├── ARCHITECTURE.md
    ├── WRITING-TESTS.md           # Cookbook for new tests
    ├── PAGE-OBJECTS.md
    └── ONBOARDING.md
```

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
| **Nightly regression** | Cron 02:00 local | `@regression` excluding `@flaky`, against qa2 *and* qa3 in parallel | ≤ 60 minutes per environment | Failures open auto-triage tickets and post to `#qa-alerts`. |
| **Quarantine** | Cron 04:00 local | `@flaky` only | Best-effort | Results inform a weekly stabilization review; never blocks anything. |
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

1. The target environment responds to `GET /react/loginReact.do` within 5 seconds.
2. `tim1` (or the configured seed user) can authenticate.
3. `/qa/createDummyFirm.do` returns within 30 seconds.
4. The internal Confluence link for QA documentation is reachable (best-effort, non-blocking).

Pre-flight failures abort the run with a clear environment-health error rather than hundreds of confusing spec failures, and the on-call Platform engineer is paged.

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

**Scope.**
- Rotate every credential currently committed in `testrail.config.json` and any other tracked file. Coordinate with Security; treat the existing values as compromised.
- Replace `testrail.config.json` secret material with environment-variable lookups; introduce `.env.example`; add `.env*` to `.gitignore`.
- Audit git history with `detect-secrets` (or equivalent); document any historical leaks.
- Add `tsconfig.json` with `strict: true`, `allowJs: true`, `checkJs: false`, `noEmit: true`, and Playwright-compatible module/target settings. Mixed JS/TS coexistence is explicit and tested.
- Scaffold `src/` per Section 4.2: empty `config/`, `fixtures/`, `pages/`, `api/`, `data/`, `helpers/`, `types/`.
- Implement `src/config/environments.ts` and `dotenv-flow` loader covering qa2, qa3, qatrd.
- Implement the **smallest possible walking-skeleton spec**: a `@smoke` test that logs in to qa2 as `tim1` and asserts the dashboard loads. **Not** `C25193` — that spec graduates Phase 2.

**Deliverables.**
- `tsconfig.json`, `.env.example`, rotated `testrail.config.json` (now secret-free).
- `src/` skeleton with one working fixture (`authenticatedPage` for `tim1`).
- One green walking-skeleton spec under `tests/smoke/login.spec.ts`.
- Security-rotation sign-off recorded against decision **D-11** (new, see Section 7).

**Exit criteria.**
- [ ] Zero committed secrets verified by `detect-secrets` against the working tree and against the last 100 commits.
- [ ] `npm run lint`, `tsc --noEmit`, and the walking-skeleton spec all green locally.
- [ ] Existing legacy POC specs still pass unchanged (`allowJs` regression check).
- [ ] Security has confirmed credential rotation in writing.

**Dependencies resolved by entry:** D-01 (TypeScript), D-04 (repo topology), D-07 (run-175 cadence).

---

### 6.3 Phase 1 — CI Bootstrap & Walking Skeleton in CI

**Goal.** Stand up the CI platform and pipelines so that every subsequent change is continuously validated. The Phase 0 walking skeleton runs in CI on every PR.

**Scope.**
- Provision the chosen CI platform (D-02) and secret store namespace (D-03).
- Implement the **PR gate** pipeline (Section 5.1): lint, type check, walking-skeleton smoke against qa2.
- Implement the **nightly regression** pipeline shell — initially executing only the smoke skeleton; it grows as feature areas migrate.
- Implement the **environment health pre-flight** (Section 5.9) and gate nightly runs on it.
- Port the TestRail reporter to TypeScript (`reporters/testrail-reporter.ts`); validate against a TestRail sandbox run before pointing at Run 175.
- Wire `run-summary.json` emission and (best-effort) push to the time-series store. If the time-series store is not yet provisioned, store the JSON as a CI artifact and revisit in Phase 2.
- Establish branch protection on the framework repository per Section 5.4.

**Deliverables.**
- CI workflow files (`.github/workflows/` or `.gitlab-ci.yml`).
- `reporters/testrail-reporter.ts` validated against a sandbox run.
- Pre-flight health-check script in `scripts/`.
- Branch-protection rules applied.
- `run-summary.json` artifact produced by every run.

**Exit criteria.**
- [ ] PR gate runs on every PR in under 8 minutes; failing it blocks merge.
- [ ] Nightly regression runs against qa2 *and* qa3 in parallel.
- [ ] Pre-flight aborts the nightly cleanly when an environment is unhealthy.
- [ ] TestRail reporter posts results from the new pipeline to a sandbox run, then is repointed at Run 175.
- [ ] Branch protection enforces lint + type check + PR gate.

**Dependencies resolved by entry:** D-02 (CI platform), D-03 (secret store).

---

### 6.4 Phase 2 — Component Library, API Client, and Documentation

**Goal.** Build the reusable substrate that all feature-area migrations will depend on, and produce the documentation new contributors will read first.

**Scope.**
- Lift React widget helpers from `tests/_helpers/ui.js` into `src/pages/components/` as TypeScript Component classes (Section 4.4): `ReactDatePicker`, `ComboBox`, `AgGrid`, `NumericInput`, `TypeAhead`.
- Each Component class has unit-style coverage via a *single* dedicated spec under `tests/smoke/components/` that exercises its primary actions on a known qa2 page (no business assertions).
- Keep a thin **CommonJS shim** at `tests/_helpers/ui.js` that re-exports the TypeScript Components via Playwright's TS loader, so existing legacy specs continue to run unmodified. The shim is a one-page file with no logic; verified by CI running the legacy suite green.
- Build the typed `/qa/*` API client (Section 4.6): `DummyFirmApi`, `InvitationApi`, `CustodianApi`, `CostBasisApi`, `MfExecutionApi`. Each wrapper has Zod schema coverage and is used at least once in a smoke spec.
- Implement the production-safety guard in `ApiClient` (Decision **D-09**, already DECIDED).
- Migrate `C25193` (Account Billing — Inception Date) as the **graduation spec** of Phase 2: it exercises Page Object, Component classes, fixtures, API client, and the hybrid isolation model end-to-end.
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
- Land the first batch of `data-testid` attributes on the Account Billing edit modal — the surface area of `C25193` and the Phase 4 starting feature.
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

### 6.6 Phase 4 — Feature-Area Migration

**Goal.** Migrate every feature area in the POC to the new framework, retiring legacy specs as parity is reached.

**Scope.** Migrate areas in this order, **one at a time**:

| Order | Area | Why this order |
|---|---|---|
| 1 | `account-billing` | Most mature; reference patterns already validated by `C25193`. |
| 2 | `create-account` | Heavy ag-Grid usage; validates the Component library under load. |
| 3 | `bucket-exclusions` | XLSX builder logic; validates the `data/builders/` layer. |
| 4 | `unmanaged-assets` | Similar shape to bucket exclusions; consolidates builder reuse. |
| 5 | `platform-one/merge-prospect` | Cross-feature dependencies; validates auth/role matrix. |
| 6 | `platform-one/auto-link` | Currently 100% `test.fixme`; not migrated as-is — handed to Phase 5. |

For each area:
1. Open a tracking issue listing every spec, its TestRail case ID, and its current status.
2. Build any area-specific Page Objects under `src/pages/<area>/`.
3. Rewrite specs into `tests/regression/<area>/`, one PR per spec or per closely related cluster.
4. Run the new spec against qa2 and qa3 in CI for **five consecutive nights**. Failures reset the counter.
5. After the parity gate is met, delete the legacy spec in the same PR that ports the last spec of its file.
6. Update the area's row in the migration tracker with the deletion commit.

**Deliverables.**
- Per-area tracking issue closed.
- All TestRail cases for the area mapped to a spec under `tests/regression/<area>/`.
- Legacy `tests/<area>/` directory deleted.
- Area-specific Page Objects covered by `WRITING-TESTS.md` examples.

**Exit criteria (per area).**
- [ ] 100% of in-scope TestRail cases have a green replacement under `tests/regression/<area>/`.
- [ ] Legacy directory deleted; no orphan helpers remain in `tests/_helpers/`.
- [ ] Area's pass rate ≥ 98% over the trailing 14 nights (Section 9 KPI).

**Exit criteria (phase as a whole).**
- [ ] All six areas above completed except `auto-link`, which is explicitly handed off.
- [ ] Legacy `tests/_helpers/` reduced to only those modules still used by `auto-link` (or fully deleted if none).
- [ ] `data-testid` coverage KPI ≥ 70% across migrated areas.

**Dependencies resolved by entry:** D-06 (first migration scope), Phase 3 frontend kickoff in motion.

---

### 6.7 Phase 5 — Backlog Unblock & POC Sunset

**Goal.** Resolve the `test.fixme` backlog that was deferred from earlier phases, retire the last legacy assets, and declare migration complete.

**Scope.**
- **Auto-link suite (`C26077`–`C26100`).** Implement disposable email pool via `ProspectFactory` (Section 4.2). Verify against qa2 with a fresh dummy firm per spec.
- **Merge Prospect permission-disabled scenarios (`C26060`, `C26085`).** Requires backend cooperation: `/qa/createDummyFirm.do` must accept a `permissions` override or a sibling endpoint must allow toggling MERGE PROSPECT off post-creation. Tracked as a cross-team dependency in Section 8 (new row).
- **Account Billing audit-trail gaps.** Coordinate with backend to confirm whether the qa3 audit pipeline has been fixed (Section 2 / `project_billing_form_quirks`). If yes, replace the `// QA-ARCH-001:waived` skips with real assertions.
- **Sunset the legacy POC.** Delete `tests/_helpers/` entirely. Remove the CommonJS shim. Delete the legacy reporter `reporters/testrail-reporter.js`. Drop `allowJs` from `tsconfig.json`.
- **Final documentation pass.** Update `docs/ARCHITECTURE.md` with the post-migration architecture; record lessons learned in `docs/RETROSPECTIVE.md`.

**Deliverables.**
- Auto-link suite green, no `test.fixme` markers.
- Merge Prospect blockers either resolved or formally accepted as out-of-scope with a recorded waiver.
- Legacy POC fully deleted.
- `tsconfig.json` strict-only (no `allowJs`).
- Retrospective document.

**Exit criteria.**
- [ ] `grep -r 'test\.fixme\|test\.skip' tests/` returns only entries with `QA-ARCH-001:waived <ticket>` markers (Section 5.4 rule 5).
- [ ] `tests/_helpers/` directory removed.
- [ ] CommonJS shim removed; legacy reporter removed.
- [ ] All KPIs in Section 9 meet or exceed targets for the trailing 30 days.
- [ ] Migration formally closed with a retrospective.

**Dependencies resolved by entry:** Backend cooperation on permission toggle (new dependency, Section 8).

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
| **1** | TestRail reporter port produces inconsistent results vs the JS reporter | Keep the JS reporter pointed at Run 175; route the TS reporter at a sandbox run until parity is proven over five nights. Switch is atomic. |
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
7. Stakeholder communication sent to `#qa-alerts` summarizing what changed.

### 6.11 Cross-Phase Workstreams

These run continuously across multiple phases and are not phases in themselves:

| Workstream | Active during | Owner | Notes |
|---|---|---|---|
| **Knowledge transfer (R-11 mitigation)** | Phases 0–5 | QA Lead | Pair-programming on every PR; weekly framework deep-dive sessions; recruit a second QA Automation contributor by end of Phase 2. |
| **Decision register hygiene** | All phases | QA Lead | Every phase entry requires its blocking decisions resolved (Section 7). |
| **Risk review** | Monthly | QA Lead | Reassess Section 10 risks; promote new risks discovered in-flight. |
| **POC stabilization** | Phases 0–4 | QA Automation | The POC continues to deliver Run 175 results; bug fixes only, no new tests after the POC freeze in Phase 2. |
| **Frontend `data-testid` rollout** | Phases 3–5 | Frontend lead | Continues per area as Phase 4 advances. |

### 6.12 Resourcing and Effort Sizing

Effort is expressed in T-shirt sizes against a baseline of one full-time QA Automation engineer. Sizes assume the dependencies in Section 8 are resolved on time; blocked phases are sized separately under "if blocked" notes.

| Phase | Size | Drivers | Required skills | Primary owner | Supporting roles |
|---|---|---|---|---|---|
| **0** Foundation & Security Hotfix | **S** | Security rotation is the long pole, not the scaffold. | TypeScript setup, secret rotation, Playwright config. | QA Automation | Security (rotation), QA Lead (review). |
| **1** CI Bootstrap | **M** | First-time CI setup against the chosen platform; pre-flight script; reporter port. | CI/CD (chosen platform), TS, TestRail API. | QA Automation | Platform / DevOps (provisioning), QA Lead (branch protection). |
| **2** Components, API Client, Docs | **L** | Five Components × five API clients × four docs × the `C25193` graduation spec. The graduation spec is the long pole. | Playwright internals, React widget knowledge, Zod, technical writing. | QA Automation | QA Lead (doc reviews), second QA contributor (R-11). |
| **3** Frontend Coordination Kickoff | **S** (QA effort) / **M** (frontend effort) | Mostly meetings, convention agreement, and a coverage script. Real cost is on the frontend side. | Stakeholder management, simple AST tooling. | QA Lead | Frontend lead (real implementer). |
| **4** Feature-Area Migration | **XL** | Six feature areas × parity gate × CI stabilization. Dominates total effort. | All of the above plus deep familiarity with each feature area. | QA Automation | Per-feature QA contacts, second QA contributor. |
| **5** Backlog Unblock & POC Sunset | **M** | Auto-link and merge-prospect blockers each have unknowns; sunset is mechanical. | Backend coordination, factory design. | QA Automation | Backend leads (toggles, audit fixes). |

**If Phase 4 runs without a second QA contributor**, its size escalates to **XXL** and the phase becomes the dominant single-point-of-failure for the program (Risk R-11). The Cross-Phase Workstream "Knowledge transfer" exists specifically to prevent this; recruiting the second contributor is a *Phase 2 exit criterion* in spirit even though it is not formally listed.

### 6.13 Bus-Factor Mitigation Milestones (R-11)

Risk R-11 (single contributor, score 20) is the highest-scored risk in the register. The migration plan addresses it through these explicit milestones, not through hope:

| Milestone | Phase | Definition of done |
|---|---|---|
| **M1 — Onboarding doc exists** | End of Phase 2 | `docs/ONBOARDING.md` is reviewed by a non-author who, without verbal help, can clone, configure, and run the walking-skeleton spec locally. |
| **M2 — Pair-programming cadence** | Phases 0–5 | At least one PR per week is co-authored or pair-reviewed by a second person. Tracked in the weekly status report. |
| **M3 — Second contributor identified** | End of Phase 2 | A named individual is committed for at least 50% of their time to the framework. If not met, escalate to Engineering Manager and pause Phase 4 entry. |
| **M4 — Knowledge-transfer session series** | Phases 2–4 | Weekly 30-minute deep-dive on one architectural area (fixtures, Components, API client, isolation, CI). Recordings archived in Confluence. |
| **M5 — Architecture decision records** | Phases 0–5 | Every non-obvious architectural choice is captured as an ADR in `docs/adr/` so the rationale survives the original author. |

These milestones promote R-11 from "passive monitoring" to active risk reduction and are reviewed at every phase verification (Section 6.10).

---

## 7. Decision Register

Each decision below is owned, dated, and tracked through to acceptance. The register is the single source of truth — `MAYBE` items block their dependent migration phases until resolved.

| ID | Decision | Status | Recommendation | Owner | Due | Blocks |
|---|---|---|---|---|---|---|
| D-01 | Adopt TypeScript strict mode | OPEN | **Yes** — refactor safety dominates over time. | QA Lead | Pre-Phase 0 | All phases |
| D-02 | CI platform (GitHub Actions / GitLab CI / Jenkins) | OPEN | TBD — depends on existing GeoWealth CI footprint. | Platform lead | Pre-Phase 1 | Phase 1 |
| D-03 | Secret store (GitHub Secrets / Vault / AWS Secrets Manager) | OPEN | Align with whatever the chosen CI uses natively. | Security lead | Pre-Phase 0 | Phases 0 and 1 |
| D-04 | Repository topology (standalone vs `~/nodejs/geowealth/e2e`) | OPEN | **Standalone** — independent release cycle, cleaner permissions. | QA Lead, Eng Mgr | Pre-Phase 0 | Phase 0 |
| D-05 | Frontend `data-testid` rollout owner | OPEN | Nominate one frontend lead; staged adoption per feature area. | Frontend lead | Pre-Phase 3 | Phase 3 |
| D-06 | First migration scope | OPEN | `account-billing` as the reference area. | QA Lead | Pre-Phase 4 | Phase 4 |
| D-07 | TestRail Run 175 cadence during migration | OPEN | Phased approach; POC keeps reporting until each spec is ported. | QA Lead, Product | Pre-Phase 0 | Migration sequencing |
| D-08 | React Query / Redux QA hooks on `window` (`FOR_QA=true`) | OPEN | Frontend exposes `__REACT_QUERY_CLIENT__`; gated by build flag. | Frontend lead | Pre-Phase 2 | Section 4.10.4 patterns |
| D-09 | Production safety: ban `/qa/*` calls when `TEST_ENV=production` | DECIDED | Implemented in `ApiClient` constructor. Never overridable. | QA Automation | 2026-04-09 | — |
| D-10 | Dummy firm naming convention `e2e-<timestamp>` | DECIDED | Documented in Section 5.8. | QA Automation | 2026-04-09 | — |
| D-11 | Treat existing committed credentials in `testrail.config.json` as compromised; rotate before any other Phase 0 work | OPEN | **Yes** — Critical-severity finding (Section 2.2). | Security, QA Lead | Phase 0, day 1 | Phase 0 |
| D-12 | Parity gate: 5 consecutive green nightly runs before deleting any legacy spec | DECIDED | Codified in Section 6.1 principle 4. | QA Lead | 2026-04-09 | Phase 4 |
| D-13 | POC freeze: no new specs in legacy `tests/<feature>/` after Phase 2 exit | DECIDED | Section 6.1 principle 5. | QA Lead | 2026-04-09 | Phase 4 |

Status values: `OPEN` (awaiting decision), `DECIDED` (recorded with rationale), `SUPERSEDED` (replaced by a later decision; cross-reference required).

---

## 8. Cross-Team Dependencies

The framework cannot succeed in isolation. Each dependency below has a named owner and a target resolution date.

| Dependency | Required from | Required by phase | Status |
|---|---|---|---|
| `data-testid` attributes on Account Billing screens (and feature areas thereafter) | Frontend team | Phase 3 → Phase 4 | Not started — gated by D-05 |
| `__REACT_QUERY_CLIENT__` exposed under `FOR_QA=true` | Frontend team | Phase 2 (component layer) | Not started — gated by D-08 |
| Stable `/qa/createDummyFirm.do` under load (no qa2 queueing > 60 s) | Backend / Platform | Phase 0 | Known degradation; mitigated by retries |
| CI platform provisioned and accessible from QA repo | Platform / DevOps | Phase 1 | Pending D-02 |
| Secret store namespace for QA credentials | Security | Phase 0 | Pending D-03 |
| Slack webhook to `#qa-alerts` | Platform | Phase 1 | Not started |
| Time-series store endpoint for run metrics | Platform | Phase 1 (best effort) → Phase 2 (firm) | Not started |
| Confluence space for living documentation | QA Lead | Phase 0 | Not started |
| Second QA Automation contributor (R-11 mitigation, milestone M3) | Engineering Mgr | End of Phase 2 | Not started |
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
| **`data-testid` coverage** | Percentage of Page Object selectors using `getByTestId` | ≥ 70% by end of Phase 2 | Static analysis script |
| **Mean time to triage** | Hours from nightly failure to assigned owner | ≤ 4 working hours | Triage tooling |
| **Quarantine clearance** | `@flaky` specs resolved within 10 working days | ≥ 90% | TestRail / repo audit |
| **Test debt ratio** | `(test.skip + test.fixme) / total specs` | ≤ 5% | Static analysis script |
| **TestRail coverage** | Active `@regression` specs mapped to TestRail cases | 100% | TestRail reporter audit |
| **Parity-gate compliance** | Migrated specs that reached 5 consecutive green nights before legacy deletion | 100% | Migration tracker |
| **Phase exit on time** | Phases closed on or before their planned exit date | ≥ 80% | Phase tracking issues |
| **Bus-factor coverage** | Architectural areas with at least two contributors who can review changes | ≥ 90% by end of Phase 2 | CODEOWNERS audit |

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
| R-11 | Single QA Automation contributor — bus factor of 1 | 4 | 5 | 20 | Bus-factor milestones M1–M5 in Section 6.13. Recruiting a second contributor by end of Phase 2 is the program's hardest non-technical commitment. | Engineering Mgr |

Highest-priority risks (score ≥ 12) — **R-11, R-02, R-07, R-06, R-10** — must have an active mitigation owner before Phase 0 begins.

---

## 11. Open Items Checklist (Pre-Phase-0)

A pragmatic checklist that the QA Lead walks through before declaring Phase 0 ready to start. Each item references the section where it is specified in detail.

**Decisions (Section 7).** Phase 0 cannot begin until these are resolved:
- [ ] **D-01** TypeScript strict mode — DECIDED.
- [ ] **D-04** Repository topology — DECIDED.
- [ ] **D-07** TestRail Run 175 cadence agreed with Product — DECIDED.
- [ ] **D-11** Credential rotation owner committed (Security + QA Lead) — DECIDED.

**Decisions due before later phases** (must have owner + due date, not necessarily decided):
- [ ] **D-03** Secret store — owner committed (blocks Phase 0 day-1 rotation).
- [ ] **D-02** CI platform — owner committed (blocks Phase 1).
- [ ] **D-08** `__REACT_QUERY_CLIENT__` exposure — owner committed (blocks Phase 2).
- [ ] **D-05** Frontend `data-testid` partner — owner committed (blocks Phase 3).
- [ ] **D-06** First migration scope — owner committed (blocks Phase 4).

**Dependencies (Section 8).**
- [ ] Confluence space created and linked from this document.
- [ ] Existing committed credentials inventoried; Security has rotation plan.
- [ ] Engineering Manager has acknowledged the second-contributor commitment (R-11 / M3) target.

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
├── eslint.config.mjs               # ESLint 9 flat config + Playwright plugin
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
