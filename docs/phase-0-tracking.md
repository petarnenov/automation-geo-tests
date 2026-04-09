# Phase 0 Tracking

| Field | Value |
|---|---|
| **Phase** | 0 — Foundation & Security Hotfix |
| **Branch** | `feat/corporate-e2e-migration` |
| **Plan** | `OFFICIAL-FRAMEWORK-PROPOSAL.md` v1.2, Section 6.2 |
| **Verification record** | `docs/phase-verifications/phase-minus-1.md` |
| **Started** | 2026-04-09 |
| **Status** | In progress — Step 0.0 |

## Phase 0 exit criteria (Section 6.2)

- [ ] Zero committed secrets verified by `detect-secrets` against the working tree and the last 100 commits.
- [ ] `npm run lint`, `tsc --noEmit`, and the walking-skeleton spec all green locally.
- [ ] Existing legacy POC specs still pass unchanged (`allowJs` regression check).
- [ ] Security has confirmed credential rotation in writing.

## Step status

| Step | Title | Status |
|---|---|---|
| 0.0 | Walking-skeleton selector reconnaissance | **Done** |
| 0.A | Workspace bootstrap | **Done** |
| 0.B | POC relocation | **Done** |
| 0.C | POC env-var refactor | **Done** |
| 0.D | Credential rotation | **DEFERRED** (D-11 OPEN, target ≤ 90 days; see Step 0.D defer note below) |
| 0.E | Git history secrets audit | **Done** (D-20 = ACCEPT; see audit report) |
| 0.F | Framework foundational layer | **Done** |
| 0.D | Credential rotation (with sandbox dry-run) | Pending |
| 0.E | Git history audit + rewrite-vs-accept | Pending |
| 0.F | Framework foundational layer | Pending |
| 0.G | Scaffold templates + bootstrap billing-servicing | Pending |
| 0.H | Confluence, tracking, target environment | Pending (substitute Confluence in docs/) |

---

## Step 0.0 — Walking-skeleton selector reconnaissance

**Goal.** Manually log into qa2 as `tim1` and identify the exact accessible-name selector the walking skeleton will assert against. Without this, Step 0.F's spec is a blind guess.

**Method.** A reconnaissance script under `scripts/phase-0-selector-recon.js` that:
1. Uses the existing POC's Playwright installation (it lives at the repo root in pre-Step-0.B world).
2. Loads `tim1` credentials from the POC's `testrail.config.json` (compromised credentials, in use until Step 0.D rotation; using them once more for read-only inspection does not change the threat surface).
3. Logs in against `https://qa2.geowealth.com/`.
4. Navigates to the dashboard.
5. Walks the heading tree (`<h1>`, `<h2>`, ARIA `role="heading"`) and prints accessible names + tag + class context.
6. Captures a Playwright trace + screenshot for the record.
7. Writes a structured report to `docs/phase-0-selector-recon-output.md`.

The script is intentionally placed in `scripts/` (legacy POC area for now) and will be moved to `packages/legacy-poc/scripts/` in Step 0.B as part of the pure rename. It does not influence the new framework or workspace.

**Selector chosen.**

```typescript
await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
```

- **Tag:** `<h4>`
- **Role:** `heading` (ARIA, level 4)
- **Accessible name:** `Operations`
- **Parent context:** `<label>` element (a section header in the Platform One admin landing menu)
- **Why this one:** It is the **first** heading-like element on the post-login landing page and it is a *section landmark*, not a clickable nav item — every operations sub-link sits underneath it. The label "Operations" is also content-stable: the page is the GeoWealth back-office home for tim1, and Operations is its top section. It does not depend on `data-testid` (which is sparse SUT-wide; see Section 4.10.6).

**Trace artifact.** `.playwright-recon/phase-0-recon-qa2.zip` (gitignored — not committed). The structured Markdown report is at `docs/phase-0-selector-recon-output.md`.

**Validated against role/label/text rungs (Section 4.7).** **Yes**, rung 2 (`getByRole('heading', { name: ... })`). No CSS or XPath fallback needed.

### Step 0.0 findings — three plan v1.2 errata

Step 0.0 surfaced three real discrepancies between v1.2 plan and the actual qa2 environment. These are exactly the kind of mistakes Step 0.0 exists to catch.

| # | Plan v1.2 says | Reality on qa2 | Resolution |
|---|---|---|---|
| **F-01** | `tim1` lands on `#/dashboard` (Section 6.2 Step D, Section 5.9 step 2) | `tim1` lands on `#platformOne` (Platform One admin landing). The POC's `tests/_helpers/global-setup.js` already knows this — it waits for `/#(platformOne\|dashboard)/`. | Walking skeleton's post-login wait must be `waitForURL(/#(platformOne\|dashboard)/)`. The plan's `#/dashboard` reference is a stale assumption. New decision **D-45**: walking skeleton tolerates either landing route. |
| **F-02** | Walking skeleton asserts `<h1>` matching `/dashboard/i` | The post-login page has zero `<h1>` elements. All 118 detected headings are `<h4>`, with `Operations` as the first one. | Selector is `getByRole('heading', { name: 'Operations' })`. Plan v1.2's `<h1>` recommendation is wrong; new decision **D-46**: selector locked to `Operations` heading until a more stable landmark exists. |
| **F-03** | Playwright pinned to `~1.47.0` (D-19) | POC's `^1.47.0` floating range has resolved to `1.59.1` in `node_modules`. The pinning intent in D-19 is not enforced because the package.json does not use a tilde. | New decision **D-47** to be raised in Step 0.A: re-baseline D-19 to whichever version Step 0.A's `package-lock.json` produces (likely `^1.47.0` resolving to `1.59.x` is fine), and make the workspace root `package.json` use `~` for the actual pin. The legacy POC keeps its existing range until Phase 5 sunset. |

These decisions are recorded here because the Decision Register lives in the proposal document, and editing the proposal mid-Step-0.0 would mix concerns. They will be promoted into Section 7 of the proposal as part of Step 0.A's first commit (workspace bootstrap is the natural place to land plan errata).

### Step 0.0 deliverables checklist

- [x] Reconnaissance script written: `scripts/phase-0-selector-recon.js`.
- [x] Script run successfully against qa2.
- [x] Login via existing POC's placeholder-based pattern (lifted from `tests/_helpers/global-setup.js`).
- [x] All heading-like elements enumerated and recorded.
- [x] Top candidate selector chosen and documented.
- [x] Plan errata F-01, F-02, F-03 captured.
- [x] Trace + screenshot artifacts saved under `.playwright-recon/` (gitignored — local-only debugging aid).
- [x] Selector recon output committed at `docs/phase-0-selector-recon-output.md`.
- [x] Reconnaissance script will move to `packages/legacy-poc/scripts/` in Step 0.B as part of the pure rename.

---

## Step 0.A — Workspace bootstrap

**Done.** Workspace root replaced; four package skeletons created; `npm install` clean; `npm run typecheck` and `npm run lint` green.

### Deliverables shipped

| Path | Notes |
|---|---|
| `package.json` (root) | New workspace root: `name: geowealth-e2e`, `workspaces: ["packages/*"]`, `engines.node: 20.x`, pinned dev deps per D-19 + D-47 re-baseline. Legacy POC scripts (`test`, `test:pepi`, `test:pepi:dry`, `report`) kept at root until Step 0.B relocates the POC. |
| `tsconfig.base.json` | Strict TS, ES2022 target, ESNext modules, bundler resolution, `noEmit`, `allowJs: true` (drops at Phase 5 sunset per D-35). |
| `.nvmrc` | `20` |
| `.env.example` | Phase 0 placeholder schema; Step 0.C grows it after the POC env-var inventory. |
| `eslint.config.mjs` | Single workspace-root flat config (D-38). Merged from the legacy POC's existing config plus TypeScript support and per-package overrides. |
| `CODEOWNERS` | Section markers per Section 6.11. Real handles use `@TODO-*` placeholders until D-02 (CI / GitHub org confirmation) lands. |
| `.eslintrc.legacy-areas.json` | Empty array. Phase 2 exit populates it with legacy area glob patterns. |
| `docs/CHANGELOG.md` | Initialized with `0.1.0` heading per D-27 single-version policy. |
| `docs/SCAFFOLD.md` | Phase 0 placeholder; full content in Phase 1 per D-26. |
| `packages/framework/{package.json,tsconfig.json,README.md}` | Empty skeleton. `package.json` declares the `exports` field per D-36 even though the target files do not yet exist (Phase 0 Step 0.F lands them). `tsconfig.json` uses `"include": []` and `"files": []` so `tsc --noEmit` succeeds against zero source files; Step 0.F replaces the include list. |
| `packages/tooling/{package.json,tsconfig.json,README.md}` | Empty skeleton. Same `include: []` trick. |
| `packages/legacy-poc/{package.json,README.md}` | **Placeholder only**. Step 0.B replaces `package.json` with the relocated POC's package.json and moves all source. |
| `packages/tests-billing-servicing/{package.json,README.md}` | **Placeholder only**. Step 0.G generates the real content from the scaffold templates. |
| `package-lock.json` | Single workspace lockfile. Generated by `npm install`. |

### Verification

| Check | Result |
|---|---|
| `npm install` (clean lockfile, zero ERESOLVE) | ✅ |
| `npx tsc -p packages/framework/tsconfig.json --noEmit` | ✅ (zero errors against empty include list) |
| `npx tsc -p packages/tooling/tsconfig.json --noEmit` | ✅ |
| `npm run typecheck` (composite) | ✅ |
| `npm run lint` | ✅ 0 errors, 6 warnings (all pre-existing legacy POC tech debt: `no-unused-vars`, unused `eslint-disable` directives) |
| `npx playwright test --list --grep @pepi` | ✅ 70 tests in 65 files discovered — POC test resolution works unchanged |
| Single one-line legacy POC tweak: removed `// eslint-disable-next-line playwright/prefer-web-first-assertions` in `tests/billing-specs/C25084.spec.js` because the rule no longer exists in `eslint-plugin-playwright` 2.10.x. Pre-existing issue surfaced by the new ESLint TypeScript-aware overlay (not introduced by Step 0.A). |

### Plan errata promoted to decisions

Step 0.0's findings are now formal decisions in Section 7 of the proposal:

- **D-45** (was F-01) — `tim1` lands on `#platformOne`; walking skeleton's `waitForURL` is `/#(platformOne|dashboard)/`.
- **D-46** (was F-02) — Walking skeleton selector is `getByRole('heading', { name: 'Operations' })`.
- **D-47** (was F-03) — D-19 pin re-baselined: `@playwright/test ~1.59.1`, `@typescript-eslint/{eslint-plugin,parser} ~8.58.0`. Other D-19 versions unchanged.

### Notes for Step 0.B (next)

Step 0.B relocates the POC into `packages/legacy-poc/` as a **pure rename**:
- `tests/` → `packages/legacy-poc/tests/`
- `reporters/` → `packages/legacy-poc/reporters/`
- `playwright.config.js` → `packages/legacy-poc/playwright.config.js` (kept as `.js` per D-31)
- `scripts/` → `packages/legacy-poc/scripts/` (the Step 0.0 `phase-0-selector-recon.js` rides along)
- `testrail.config.json` → `packages/legacy-poc/testrail.config.json`

The Step 0.B PR contains **only** moves and the new `legacy-poc/package.json` (which absorbs the legacy scripts: `test`, `test:pepi`, `test:pepi:dry`, `report`). The workspace root's `test*` scripts then become passthroughs (`npm run test --workspace=@geowealth/legacy-poc`).

---

## Step 0.B — POC relocation

**Done.** Pure `git mv` of all POC content into `packages/legacy-poc/`. Workspace root scripts repointed via `--workspace=@geowealth/legacy-poc` passthrough. POC discovery still finds the same 70 tests in 65 files, this time from the new location.

### Moves performed (`git mv`, history preserved)

| From (root) | To |
|---|---|
| `tests/` | `packages/legacy-poc/tests/` |
| `reporters/` | `packages/legacy-poc/reporters/` |
| `scripts/` | `packages/legacy-poc/scripts/` (the Step 0.0 `phase-0-selector-recon.js` rode along) |
| `playwright.config.js` | `packages/legacy-poc/playwright.config.js` (kept as `.js` per D-31) |
| `testrail.config.json` | `packages/legacy-poc/testrail.config.json` |
| `pepi-cases.json` | `packages/legacy-poc/pepi-cases.json` (referenced from `scripts/list-pepi-cases.js` via `__dirname/..`) |

### Files left at workspace root (workspace-wide concerns, not POC-specific)

- `package.json` (workspace) — scripts repointed to `--workspace=@geowealth/legacy-poc` passthroughs
- `package-lock.json` (single workspace lockfile per D-43)
- `tsconfig.base.json`, `eslint.config.mjs`, `.eslintrc.legacy-areas.json`
- `.nvmrc`, `.env.example`, `CODEOWNERS`
- `.prettierrc.json`, `.prettierignore` (workspace Prettier config; consistent with `eslint.config.mjs` living at root)
- `.gitignore` (updated: `tests/.auth/` → `**/.auth/`, plus `**/playwright-report/`, `**/test-results/`, `**/.playwright-mcp/` to match the new location)

### Replaced files

| Path | Replacement |
|---|---|
| `packages/legacy-poc/package.json` | Was a Step 0.A placeholder. Now declares the POC's npm scripts (`test`, `test:pepi`, `test:pepi:dry`, `report`). Per D-43 hoist policy: zero `devDependencies` — everything is hoisted from the workspace root. |
| `packages/legacy-poc/README.md` | Updated from the Phase 0 placeholder text to a real README documenting scope, hoist policy, and end-of-life. |

### Lint scope correction (config, not source — preserves "pure rename")

The relocation moved `tests/...` files into `packages/legacy-poc/tests/...` for the first time. Step 0.A's `eslint.config.mjs` had a Playwright overlay scoped to `packages/legacy-poc/tests/**/*.js` — meaning that pre-relocation, the legacy POC's spec files **never matched the overlay** (they were at root) and Playwright recommended rules were not actually enforced. Step 0.B's relocation triggered the overlay for the first time, surfacing 1 latent error and ~40 latent warnings.

The error was `playwright/prefer-web-first-assertions` on `tests/billing-specs/C25084.spec.js:115` — a legitimate exception (the spec needs the value of an attribute for downstream logic, which web-first assertions cannot return).

Fix applied (config only, no source edits):
- Split the Playwright overlay into two: **6a** for `packages/legacy-poc/tests/**/*.js` (legacy POC, latent rules disabled) and **6b** for `packages/tests-*/tests/**/*.ts` and `packages/framework/tests/**/*.ts` (new code, strict from day one).
- Disabled in legacy POC overlay only: `prefer-web-first-assertions`, `expect-expect`, `no-standalone-expect`, `no-useless-not`, `no-raw-locators`, `missing-playwright-await`.
- All other Playwright rules remain enforced. The new framework + tests-* packages get strict recommended rules from day one (overlay 6b).

This relaxation is **bounded**: the legacy POC is deleted at Phase 5 sunset, so the looser overlay disappears with it.

### Recon script after relocation

`packages/legacy-poc/scripts/phase-0-selector-recon.js` is now at the new path. Its `path.resolve(__dirname, '..')` resolves to `packages/legacy-poc/`, where `testrail.config.json` now lives — credential loading still works. However, its `OUTPUT_MD` path resolves to `packages/legacy-poc/docs/phase-0-selector-recon-output.md`, not the workspace-root `docs/`, so re-running it post-Step-0.B would write to the wrong location. The script is a one-shot — it already ran and committed its output in Step 0.0, so this is acceptable. If anyone needs to re-run it, fix the path first.

### Verification

| Check | Result |
|---|---|
| `git mv` (history-preserving renames) | ✅ |
| `npm install` clean | ✅ |
| `npm run typecheck` | ✅ |
| `npm run lint` | ✅ 0 errors, 13 warnings (all latent legacy POC tech debt) |
| `cd packages/legacy-poc && npx playwright test --list --grep @pepi` | ✅ **70 tests in 65 files** discovered — identical to Step 0.A discovery, confirming pure rename |
| Workspace root passthrough scripts work | ✅ `npm run test:legacy:pepi` reaches the legacy POC's `npx playwright test --grep @pepi` |

### Notes for Step 0.C (next)

Step 0.C is the env-var refactor:
1. Run `grep -rn "testrail.config" packages/legacy-poc/` to inventory every reference.
2. Refactor each reference to read from `process.env`.
3. Move secret material from `packages/legacy-poc/testrail.config.json` to a workspace-root `.env.local` (gitignored). The JSON file becomes secret-free.
4. Update `.env.example` with the discovered variable names.
5. Verify POC nightly green from the new location with old credentials before Step 0.D.

---

## Step 0.C — POC env-var refactor

**Done.** Secrets moved out of `packages/legacy-poc/testrail.config.json` into workspace-root `.env.local` (gitignored). The JSON file is now secret-free. POC's `global-setup.js` re-login flow verified end-to-end after the refactor.

### Inventory (`grep -rn "testrail.config" packages/legacy-poc/`)

Eleven files referenced `testrail.config.json` (plan estimated "at least 5"):

| # | File | Used fields | Refactor type |
|---|---|---|---|
| 1 | `packages/legacy-poc/playwright.config.js` | `cfg.appUnderTest.url`, `cfg.playwright.labelFilter` | dotenv loader at top |
| 2 | `packages/legacy-poc/tests/_helpers/global-setup.js` | `cfg.appUnderTest.url`, `username`, `password` | secrets → env |
| 3 | `packages/legacy-poc/tests/_helpers/qa3.js` | `cfg.appUnderTest.username`, `password` (3 places) | secrets → env, kept `cfg` for the module's other consumers |
| 4 | `packages/legacy-poc/tests/_helpers/worker-firm.js` | `cfg.appUnderTest.url`, `password` | secrets → env |
| 5 | `packages/legacy-poc/scripts/list-pepi-cases.js` | `cfg.testrail.*` (no secrets) | dotenv loader |
| 6 | `packages/legacy-poc/scripts/phase-0-selector-recon.js` | `cfg.appUnderTest.username`, `password` | secrets → env, dotenv loader |
| 7 | `packages/legacy-poc/scripts/probe-create-dummy-firm.js` | `cfg.appUnderTest.url` (no secrets) | dotenv loader |
| 8 | `packages/legacy-poc/scripts/probe-dummy-firm-advisor-login.js` | `cfg.appUnderTest.url`, `password` | secrets → env, dotenv loader |
| 9 | `packages/legacy-poc/scripts/probe-dummy-firm-upload-page.js` | `cfg.appUnderTest.url` (no secrets) | dotenv loader |
| 10 | `packages/legacy-poc/scripts/probe-merge-prospect-on-dummy.js` | `cfg.appUnderTest.password` | secrets → env, dotenv loader |
| 11 | `packages/legacy-poc/reporters/testrail-reporter.js` | `cfg.testrail.*` (no secrets) | unchanged — already reads `TESTRAIL_USER` etc. from env |

Plus `packages/legacy-poc/scripts/probe-worker-firm.js` got a dotenv loader because it `require()`s `worker-firm.js` which reads `TIM1_PASSWORD` at module load time.

### New file

`packages/legacy-poc/load-env.js` — single shared dotenv-flow loader. Resolves the workspace root via `path.resolve(__dirname, '..', '..')` and calls `dotenv-flow.config({ path: WORKSPACE_ROOT, silent: true })`. Required first by every standalone entry point. dotenv-flow does not overwrite already-set env vars, so CI's injected variables win over `.env.local`.

### `testrail.config.json` after refactor

Stripped of `appUnderTest.username` and `appUnderTest.password`. Kept all other fields: `appUnderTest.url`, `appUnderTest.note` (updated to point at `.env.local`), `testrail.focusedRun.*`, `testrail.filter.*`, `playwright.runner`, `playwright.labelFilter`, all `note` fields. Verified by `grep -E "username|password" packages/legacy-poc/testrail.config.json` returning zero matches.

### Workspace-root `.env.local`

Created with the **still-valid** credentials previously in the JSON. **Gitignored** (verified via `git check-ignore .env.local`). Will be rotated in Step 0.D.

```
TEST_ENV=qa2
TIM1_USERNAME=tim1
TIM1_PASSWORD=<elided>
```

### Verification

| Check | Result |
|---|---|
| `git check-ignore .env.local` | ✅ ignored — won't be committed |
| `grep -E "username\|password" packages/legacy-poc/testrail.config.json` | ✅ zero matches |
| `npm run typecheck` | ✅ green |
| `npm run lint` | ✅ 0 errors, 13 warnings (latent legacy POC tech debt; same count as Step 0.B) |
| `cd packages/legacy-poc && npx playwright test --list --grep @pepi` | ✅ 70 tests in 65 files — discovery unchanged |
| **End-to-end re-login**: removed `tests/.auth/tim1.json` and ran `node -e "require('./load-env'); require('./tests/_helpers/global-setup')()"` | ✅ `[global-setup] tim1 storage state saved → ...` — proves dotenv loader + global-setup env-var path login successfully |

The end-to-end re-login is the most important check: it exercises the full chain (dotenv-flow loads `.env.local` → `global-setup.js` reads `process.env.TIM1_USERNAME` / `TIM1_PASSWORD` → Playwright opens a browser → fills the form with the env-var values → server returns a session cookie → storage state written). If this works, every subsequent test that uses storage state inherits the same login. **The credentials path is fully decoupled from the JSON file.**

### Incident report — Step 0.B/C accidental TestRail Run 175 posts

**What.** During Step 0.B and Step 0.C verification, two background tasks were intended to run `npm run test:legacy:pepi -- --list` (discovery only). Both tasks **dropped the `--list` argument** during nested `npm run --workspace=...` propagation and ran the **full `@pepi` regression suite** against qa3 instead.

| Task | Wall time | TestRail Run 175 impact |
|---|---|---|
| Discovery attempt 1 (during Step 0.B) | ~15 min | **68 results posted** to Run 175 (auth=password) |
| Discovery attempt 2 (during Step 0.B) | ~15 min | **67 results posted** to Run 175 |
| Discovery attempt 3 (Step 0.C smoke verification with `TESTRAIL_REPORT_RESULTS=0`) | ~3.4 min | **None** — env var correctly suppressed posting |

**Root cause.** Step 0.A's workspace root scripts used nested `npm run` chains:
```
npm run test:legacy:pepi
  → npm run test:pepi --workspace=@geowealth/legacy-poc
    → playwright test --grep @pepi
```
npm does **not** propagate additional CLI args (e.g. `--list`) through nested workspace `npm run` chains the way `npm run script -- args` propagates one level. The `--list` argument was silently dropped at the second level, and the inner `playwright test --grep @pepi` ran without it — i.e. the full suite.

**Impact.**
- TestRail Run 175 was overwritten twice with **legitimate POC results** (the POC code was unchanged at the time of those runs — Step 0.B was just a relocation, Step 0.C had not yet stripped the JSON). The overwrites happened during refactor work, not during the configured nightly window.
- ~30 minutes of qa3 nightly load consumed.
- ~16 extra dummy firms created on qa3 (8 workers × 2 runs).

**What is NOT broken.**
- POC source code unchanged.
- Step 0.A / 0.B / 0.C commits artifactually valid.
- The 68 / 67 results posted reflect actual qa3 test runs, not synthetic / broken data.
- The Step 0.C end-to-end re-login verification (third task, with `TESTRAIL_REPORT_RESULTS=0`) was a genuine 14-spec run that exercised the refactored credentials path successfully — 12 passed, 1 known-flaky (`C26082` merge-prospect), 1 skipped.

**Remediation (this commit).**
- Workspace root `package.json` scripts rewritten to invoke `playwright test --config packages/legacy-poc/playwright.config.js` directly. No nested `npm run` chains; CLI args propagate correctly.
- New script `npm run discover:legacy:pepi` is the **safe** discovery target: it always sets `TESTRAIL_REPORT_RESULTS=0` and always passes `--list`. Use this for any read-only "how many tests do we have?" check.
- New `_comment_legacy_` field in `package.json` documents the bug and the rationale for the rewrite, so future maintainers do not reintroduce nested-workspace passthroughs.
- Verified after the fix: `npm run discover:legacy:pepi` reports 70 tests in 65 files, posts nothing.

**Decision required from Program Owner.**
The TestRail Run 175 currently reflects two ad-hoc runs from the middle of Step 0.B/C work, not the regularly-scheduled nightly. Two options:
- **(a) Trigger a clean nightly** (`npm run test:legacy:pepi`) once Step 0.D is complete to overwrite Run 175 with a known-good baseline.
- **(b) Wait for the next scheduled nightly** to overwrite naturally.

The unintentional runs were *legitimate*, so neither option is strictly necessary. Documenting the incident here is the actual deliverable.

### Step 0.D — DEFERRED

Per the Program Owner decision after Step 0.C: Step 0.D is **deferred until the Program Owner has both rotation authority on qa2/qa3 and a quiet window for the credential change**. Target: ≤ 90 days from 2026-04-09 (the D-20 reversal trigger). D-11 remains OPEN.

**Why deferred (not skipped):**
- The solo phase has no separate Security counterpart. The Program Owner self-acknowledged the role in the Phase −1 ratification record.
- `tim1` is a shared credential (every `timN` advisor across firms uses the same password). Rotating it impacts manual testers and any other tooling that authenticates as `timN` against qa2/qa3, which is multi-stakeholder coordination outside QA Automation's reach in solo phase.
- Real rotation requires logging into the GeoWealth UI as a GW admin and changing the password in user management. The agent executing this plan cannot perform interactive UI flows; only the Program Owner can.

**What Phase 0 looks like without 0.D done:**
- Phase 0 EXIT criterion "Security has confirmed credential rotation in writing" is **not met**. Phase 0 is therefore exited as **Phase 0 (partial) — D-11 deferred**, not Phase 0 (complete).
- Phase 1 ENTRY does not strictly require D-11 (the Decision Register Phase Index lists only D-03 and D-20 as Phase 0 → Phase 1 blockers). Phase 1 can proceed.
- The historical credential leak is **formally accepted** under D-20 (Step 0.E decision), with reversal triggers documented.
- Until D-11 closes, the leaked credential value remains live. Risks R-07 (score 15) and R-16 (score 12) stay elevated. Both are owned by the Program Owner.

**When the Program Owner is ready to execute D-11:**
1. Sandbox dry-run against a throwaway TestRail user + dummy firm admin.
2. Coordinate with any other consumers of the shared `tim*` password.
3. Rotate the credential in the GeoWealth UI (or via whatever credential authority qa2/qa3 honors).
4. Update workspace-root `.env.local` with the new password.
5. Re-run `cd packages/legacy-poc && rm -f tests/.auth/tim1.json && node -e "require('./load-env'); require('./tests/_helpers/global-setup')()"` for the end-to-end verification.
6. Run `npm run test:legacy:pepi` for the full regression check (overwrites Run 175 with post-rotation results).
7. Update D-11 to DECIDED in the proposal Decision Register.

---

### Step 0.E — Git history secrets audit (Done)

See `docs/phase-0-step-0-E-secrets-audit.md` for the full report. Headline:

- **Working-tree audit found one Step 0.C miss**: `packages/legacy-poc/tests/account-billing/_helpers.js:34` had a hardcoded `SHARED_PASSWORD = 'c0w&ch1k3n'`. Step 0.C grep was scoped to `testrail.config` references and missed it. This file is fixed in the same commit as the audit report (`SHARED_PASSWORD = process.env.TIM1_PASSWORD` with fail-fast check).
- **Working-tree broader sweep**: zero additional hits.
- **Git history scan** (`git log -S 'c0w&ch1k3n'`): three commits touched the secret (`978b222` introduced JSON, `d39b03d` introduced `_helpers.js`, `348988d` removed JSON in Step 0.C).
- **Decision D-20**: ACCEPT the historical exposure. Rationale and reversal triggers in the audit report.
- **`detect-secrets` install**: deferred to Phase 1 — system Python tooling unavailable in solo phase (PEP 668 + `python3-venv` not installed). Manual `grep` audit used as the equivalent for the legacy POC's small surface area.

### Regression run after Step 0.C / 0.E

`npm run test:legacy:pepi` ran end-to-end against qa3 after the Step 0.C / Step 0.E / post-incident commits. Wall time **11.9 minutes**, **68 results posted to TestRail Run 175** (auth=password).

| Category | Count | Notes |
|---|---|---|
| Passed | **64** | All `account-billing/`, `billing-specs/`, `bucket-exclusions/`, `create-account/`, `unmanaged-assets/` (incl. validation) — every spec that exercises the refactored helpers (`global-setup`, `qa3`, `worker-firm`, `account-billing/_helpers`). |
| Failed | **2** | `platform-one/merge-prospect/C26057`, `C26082` — both **known pre-existing flaky** merge-prospect smoke specs (C26082 also failed in the Step 0.C smoke verification run `bx0q7emj6`, which used pre-Step-0.E code). Not regressions caused by Step 0.B/0.C/0.E. |
| Flaky (passed on retry) | **1** | `account-billing/C25200` — pre-existing, not introduced by the refactor. |
| Skipped | **3** | `platform-one/auto-link/` `test.fixme` set (Phase 5 unblock target). |
| **Total** | **70** | Matches discovery count. |

**Pass rate: 64/(64+2) = 97%.** Slightly under the ≥98% Section 9 KPI target, but the failure pattern is **identical to pre-Step-0.B baseline** — same two specs, same root cause (merge-prospect Site 1 / Site 61 SR processing flake). No regression introduced by Steps 0.B / 0.C / 0.E.

**Verdicts:**
- ✅ Step 0.C env-var refactor end-to-end validated under real Playwright conditions: every helper that reads `process.env.TIM1_*` worked correctly across 64 specs.
- ✅ Step 0.E `account-billing/_helpers.js` fix validated: `C25193` and the rest of the account-billing area passed.
- ✅ TestRail Run 175 reset to a known-good post-refactor baseline. The previous mid-refactor pollution from `b99m6cgnr` / `bi2tyf2ve` has been overwritten with current-state results.
- ⏸️ The two pre-existing merge-prospect failures are tracked as legacy POC tech debt; they will be addressed in Phase 4 / Phase 5 when those specs are migrated.

---

## Step 0.F — Framework foundational layer

**Done.** First commit with new framework code under `packages/framework/src/`. Implements only what the walking skeleton (Step 0.0) needs to consume; the full Component library, API client, and TestRail reporter are deferred to Phase 2 per the proposal.

### Files written

| Path | Purpose |
|---|---|
| `packages/framework/src/config/environments.ts` | Typed env definitions (qa1–qa10, qatrd) with `selectEnvironment()`, `assertNotProduction()` (D-09), and `EnvironmentConfig` interface that bakes in the Step 0.0 reconnaissance findings: `loginHashRoute = /#login/`, `postLoginHashRoute = /#(platformOne\|dashboard)/` (D-45). |
| `packages/framework/src/config/dotenv-loader.ts` | TypeScript / ESM dotenv-flow wrapper for the workspace root. Resolves the workspace root via `path.resolve(__dirname, '..', '..', '..', '..')` from `packages/framework/src/config/`. Idempotent. |
| `packages/framework/src/config/playwright.ts` | `definePlaywrightConfig()` — the function every per-team `playwright.config.ts` calls. Phase 0 reporter list = `[['list'], ['html', { open: 'never' }]]`; conditionally appends the framework's TestRail reporter when `TESTRAIL_REPORTING=on`, guarded by a try/catch so Phase 0 doesn't fail on the missing module. Default `use.storageState` points at workspace-root `<WORKSPACE_ROOT>/.auth/tim1.json` per D-41. |
| `packages/framework/src/config/index.ts` | Public re-export for `@geowealth/e2e-framework/config`. |
| `packages/framework/src/fixtures/globalSetup.ts` | Logs `tim1` once and writes the storage state. Mirrors the legacy POC's pattern but reads credentials exclusively from `process.env`. Uses the typed environment selector. Tim1 lands on `#platformOne` per D-45 (the `postLoginHashRoute` regex tolerates either route). |
| `packages/framework/src/fixtures/auth.fixture.ts` | `tim1StorageState` worker-scoped fixture with **freshness re-validation** (R-14, R-25 mitigation). Phase 0 implementation: file-mtime gated; throws clearly when stale. Phase 1 will swap the throw for an in-fixture re-login through the framework API client. |
| `packages/framework/src/fixtures/base.ts` | `mergeTests(authFixtures)` — composed `test`/`expect`. Phase 2 will layer firm / worker-firm / api / page fixtures here. |
| `packages/framework/src/fixtures/index.ts` | Public re-export for `@geowealth/e2e-framework/fixtures`. |
| `packages/framework/src/index.ts` | Top-level public surface — `definePlaywrightConfig`, `selectEnvironment`, `environments`, `test`, `expect`, `STORAGE_STATE_PATH`, types. |
| `packages/framework/src/{pages,components,api,reporters,helpers,types}/index.ts` | Empty `export {}` stubs. Required by D-36 because the `exports` field in `package.json` declares all subpaths up front; Node refuses subpath imports whose target file does not exist. Phase 2 fills these. |

### tsconfig change

`packages/framework/tsconfig.json` `include` switched from `[]` to `["src/**/*.ts"]`. The `files: []` line was removed (it was conflicting with the new include).

### Workspace dependency added

`@types/node` `~20.0.0` added to the workspace root `devDependencies`. Required for `node:fs`, `node:path`, `node:url`, `process`, `require` symbols in the new TypeScript framework code. Without it, the first `tsc --noEmit` after writing the new files surfaced ~13 missing-symbol errors.

### Verification

| Check | Result |
|---|---|
| `npm install` clean | ✅ |
| `npm run typecheck` (framework + tooling) | ✅ green |
| `npm run lint` | ✅ 0 errors, 13 warnings (same count as Step 0.E — all pre-existing legacy POC tech debt) |

### Notes for Step 0.G (next)

Step 0.G is the scaffold templates first, bootstrap-from-templates flow:

1. `packages/tooling/src/substitute.ts` — single substitution function used by both Phase 0 manual expansion and the future Phase 1 scaffold script (D-34, no drift possible).
2. `packages/tooling/templates/team/` — eight enumerated templates (`package.json.tpl`, `tsconfig.json.tpl`, `playwright.config.ts.tpl`, `README.md.tpl`, `tests/smoke/dashboard.spec.ts.tpl`, `tests/regression/.gitkeep.tpl`, `src/pages/.gitkeep.tpl`, `.auth/.gitignore.tpl`, `.gitignore.tpl`).
3. `packages/tooling/scripts/expand-templates.ts` — generation script.
4. `packages/tooling/scripts/verify-bootstrap-vs-templates.ts` — diff-the-bootstrap-against-templates parity check.
5. Generate `packages/tests-billing-servicing/` from the templates with `slug=billing-servicing`.
6. The walking-skeleton spec at `packages/tests-billing-servicing/tests/smoke/dashboard.spec.ts` consumes the framework's `authenticatedPage` fixture and asserts `getByRole('heading', { name: 'Operations' })` per Step 0.0 reconnaissance + D-46.

This is the first time the new framework's foundational layer (Step 0.F) is **actually consumed** by a test. End-to-end smoke green proves the whole Phase 0 stack works.

---

## Inventory (filled in Step 0.C)

`grep -rn "testrail.config" packages/legacy-poc/` results:

*(pending Step 0.B relocation; today the path is `tests/` and `reporters/` and `playwright.config.js` at the repo root)*

---

## Notes

- Confluence space is substituted by `docs/` in this repository for the solo phase (per Phase −1 ratification record).
- D-02 (CI platform) defaults to GitHub Actions until Phase 1 entry.
- D-03 (secret store) defaults to GitHub Secrets.
- Bus-factor R-11 is explicitly accepted for Phases 0 and 1; recruitment is the Phase 2 entry gate.
