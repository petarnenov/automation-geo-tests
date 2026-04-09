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
| 0.B | POC relocation | Pending |
| 0.C | POC env-var refactor | Pending |
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

## Inventory (filled in Step 0.C)

`grep -rn "testrail.config" packages/legacy-poc/` results:

*(pending Step 0.B relocation; today the path is `tests/` and `reporters/` and `playwright.config.js` at the repo root)*

---

## Notes

- Confluence space is substituted by `docs/` in this repository for the solo phase (per Phase −1 ratification record).
- D-02 (CI platform) defaults to GitHub Actions until Phase 1 entry.
- D-03 (secret store) defaults to GitHub Secrets.
- Bus-factor R-11 is explicitly accepted for Phases 0 and 1; recruitment is the Phase 2 entry gate.
