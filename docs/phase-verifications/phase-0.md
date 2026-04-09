# Phase 0 Verification Record

| Field | Value |
|---|---|
| **Phase** | 0 — Foundation & Security Hotfix |
| **Status at exit** | **Phase 0 (partial) — D-11 deferred** |
| **Date** | 2026-04-09 |
| **Branch** | `feat/corporate-e2e-migration` |
| **Attendees** | Petar Nenov (Program Owner / acting Security counterpart, solo phase) |
| **Recording** | n/a (solo session) |
| **Exit checklist source** | `OFFICIAL-FRAMEWORK-PROPOSAL.md` v1.2 Section 6.2 + Section 6.10 |
| **Tracker** | `docs/phase-0-tracking.md` |

## Phase 0 exit criteria

| Criterion | Status | Evidence |
|---|---|---|
| Zero committed secrets verified | ✅ | Step 0.E manual `grep` + `git log -S` audit (`docs/phase-0-step-0-E-secrets-audit.md`). One Step 0.C miss in `_helpers.js` was caught and fixed. `detect-secrets` install deferred to Phase 1 (Python tooling unavailable in solo phase). |
| `npm run lint`, `tsc --noEmit`, walking-skeleton spec all green | ✅ | Lint: 0 errors, 13 latent warnings. Typecheck: green. Walking-skeleton spec: passed in 19.7s against qa2 in Step 0.G end-to-end run. |
| Existing legacy POC specs still pass unchanged | ✅ | `npm run discover:legacy:pepi` reports 70 tests in 65 files (unchanged from Step 0.A). Post-Step-0.C/E regression run: 64 passed, 2 known-flaky merge-prospect failures (pre-existing), 1 retry-pass, 3 skipped. |
| Security has confirmed credential rotation in writing | ❌ | **Step 0.D deferred.** D-11 OPEN with target ≤ 90 days. Risks R-07 / R-16 elevated until D-11 closes. |

## Phase 0 → Phase 1 entry checklist (Decision Register Phase Index)

| Required decision | State |
|---|---|
| D-03 Secret store namespace populated | OPEN — defaults to GitHub Secrets per Phase −1 record; provisioned in Phase 1 alongside CI platform |
| D-20 History rewrite/accept decision | ✅ DECIDED — ACCEPT (Step 0.E) |

D-03 is itself a Phase 1 deliverable. Phase 1 entry is **approved** with the understanding that D-03 will be the first Phase 1 work item.

## Decisions confirmed during Phase 0

The Phase −1 ratification record listed every author-recommended `DECIDED` decision. Phase 0 added the following new decisions, all confirmed by the Program Owner:

| ID | Decision | Status | Source step |
|---|---|---|---|
| D-45 | tim1 lands on `#platformOne`, walking-skeleton waitForURL tolerates `#(platformOne\|dashboard)` | DECIDED | 0.0 / 0.A |
| D-46 | Walking-skeleton selector = `getByRole('heading', { name: 'Operations' })` | SUPERSEDED by D-48 | 0.0 / 0.A |
| D-47 | D-19 pin re-baselined: Playwright `~1.59.1`, `@typescript-eslint/* ~8.58.0` | DECIDED | 0.0 / 0.A |
| D-48 | Walking-skeleton selector = `getByRole('heading', { name: 'Welcome to Platform One!' })` (supersedes D-46) | DECIDED | 0.G |
| D-49 | TS source uses extensionless internal imports; framework / tooling are NOT `"type": "module"` | DECIDED | 0.G |
| D-50 | `tsx ~4.19.0` added as workspace devDep for running TS scripts | DECIDED | 0.G |
| D-11 | Credential rotation OPEN-DEFERRED with 2026-07-08 cap | DEFERRED | 0.D |
| D-20 | Git history exposure: ACCEPT | DECIDED | 0.E |

## Decisions deferred or held OPEN

| ID | What | Why |
|---|---|---|
| D-11 | Credential rotation | Program Owner does not have rotation authority on qa2/qa3 in solo phase without coordinating with shared `tim*` consumers. Target ≤ 90 days. |
| D-02 | CI platform | Phase 1 entry decision. Defaults to GitHub Actions per Phase −1 record. |
| D-03 | Secret store | Phase 1 entry decision. Defaults to GitHub Secrets. |
| D-05 | Frontend `data-testid` partner | Phase 3 entry decision. |
| D-06 | First migration scope | Phase 4 entry decision (recommendation: `account-billing` first). |
| D-08 | `__REACT_QUERY_CLIENT__` exposure | Phase 2 component layer dependency. |
| D-18 | Backend cooperation SLA | Phase 5 dependency. |

## Risks reviewed at Phase 0 exit

All score-≥-12 risks reviewed; none new since the Phase −1 record. Three remain elevated and explicitly carried forward:

- **R-07** (committed credential leak) — score 15 — owner Program Owner. Mitigated when D-11 closes.
- **R-11** (single contributor / bus factor 1) — score 20 — owner Engineering Manager. Mitigation: M3 (second contributor by end of Phase 1) — **not yet started**. Phase 2 entry is gated on this.
- **R-16** (historical credential leak unresolved) — score 12 — owner Security. Closed when D-11 closes.

R-21 (TS path-alias footgun) was preemptively mitigated in Section 4.2.3.1 of the proposal and Step 0.A's tsconfig setup; not observed in practice during Phase 0.

R-25 (auth-fixture login pressure) was mitigated by D-41 (workspace-root shared storage state) and the once-per-worker freshness check in `auth.fixture.ts`; not observed during Phase 0 because Phase 0 has only one team package and one walking-skeleton spec.

Two **new risks discovered** during Phase 0 that should be added to the register at the next monthly risk review:

- **R-27 (new)**: Playwright's pirates loader's CJS-only behaviour quietly breaks framework files that use ESM-only constructs (`import.meta.url`, `.js` extensions on internal imports, `"type": "module"`). Mitigated by D-49. Score: 3 × 3 = 9. Owner: QA Automation.
- **R-28 (new)**: Workspace passthrough scripts (`npm run script --workspace=...`) silently drop additional CLI args (`-- --list`), causing accidental full-suite runs against shared destinations like TestRail Run 175. Mitigated by the post-Step-0.B fix that invokes `playwright test --config` directly. Score: 3 × 4 = 12. Owner: QA Automation.

## Stakeholder communication

In solo phase, the agreed channel is "Petar reads `docs/phase-0-tracking.md` and this verification record". When `#qa-alerts` lands in Phase 1, future phase verifications post a one-line summary there.

## Phase 1 readiness

| Item | State |
|---|---|
| Phase 1 plan in proposal | ✅ Section 6.3 (re-sized to L per D-29; planned 2–3 weeks) |
| Workspace + framework foundations to build CI on | ✅ Done (Steps 0.A, 0.F, 0.G) |
| Legacy POC nightly working from new location | ✅ 70 tests in 65 files; 64 passed in latest regression |
| Walking skeleton green end-to-end | ✅ 19.7s against qa2 |
| M3 (second contributor) | ❌ Not started — explicitly carried as Phase 2 entry gate |
| D-02 (CI platform) decision | ⏸️ Defaults to GitHub Actions, to be confirmed |
| D-03 (secret store) decision | ⏸️ Defaults to GitHub Secrets, to be confirmed |

## Decision

**Phase 0 is exited as Phase 0 (partial). Phase 1 is approved to start.**

Carried forward into Phase 1:
- D-11 (credential rotation) — Program Owner schedules within 90 days.
- R-11 (bus factor) — Engineering Manager starts recruitment of second contributor.
- D-02 / D-03 — finalize at Phase 1 kickoff.

---

*Signed (acting Program Owner):* Petar Nenov, 2026-04-09
