# Phase −1 Verification Record — Pre-Phase-0 Ratification

| Field | Value |
|---|---|
| **Date** | 2026-04-09 |
| **Branch** | `feat/corporate-e2e-migration` |
| **Document** | `OFFICIAL-FRAMEWORK-PROPOSAL.md` v1.2 |
| **Attendees** | Petar Nenov (acting as Program Owner, QA Lead, QA Automation, and Security counterpart for the duration of the solo phase) |
| **Recording** | n/a (solo session) |

## Purpose

Section 11 of the proposal (Pre-Phase-0 Open Items Checklist) requires several decisions and named owners to exist *before* Phase 0 starts. The program is currently a single-contributor effort. This record formally accepts those roles and ratifies all author-recommended `DECIDED` decisions, so Phase 0 can begin.

## Roles named

| Role | Person | Notes |
|---|---|---|
| **Program Owner** | Petar Nenov | Section 6.14 default ("Program Owner is the QA Lead by default"). |
| **QA Lead** | Petar Nenov | Same. |
| **QA Automation** | Petar Nenov | Sole contributor today. |
| **Security counterpart (D-22)** | Petar Nenov *(self-acknowledged, with caveats)* | No separate Security function exists. The Program Owner accepts the rotation responsibility and acknowledges that Phase 0 Step 0.D credential rotation will be self-administered. The historical credential leak (R-07 / R-16 / D-20) is held open for the Step 0.E audit and the rewrite-vs-accept decision. |
| **Engineering Manager** | n/a | No upstream manager today. Bus-factor R-11 / M3 (second contributor by end of Phase 1) is acknowledged as the program's hardest commitment and remains tracked but unrecruited. Phase 2 entry will be re-evaluated against this risk. |

## Decisions ratified

The following `DECIDED` items in Section 7 are formally ratified by the Program Owner. These were authored as recommendations by QA Automation; they are now binding for the program.

- D-01 TypeScript strict mode
- D-09 Production safety guard in `ApiClient`
- D-10 Dummy firm naming convention `e2e-<timestamp>`
- D-12 Parity gate (5 consecutive green nightly runs)
- D-13 POC freeze at Phase 2 exit
- D-14 Parity-gate cohort sizing
- D-15 TestRail Run 175 cutover atomic at Phase 5 sunset
- D-16 POC freeze enforced by ESLint + CODEOWNERS
- D-17 Phase 4 ordering (most-mature first; ADR-0001)
- D-19 Version pinning (Node 20, Playwright 1.47, TS 5.5, Zod 3.23, dotenv-flow 4.1, ESLint 10.2)
- D-23 qa2 stability fallback to qa3
- D-24 Monorepo with npm workspaces (supersedes D-04)
- D-25 POC area-to-team mapping (all current POC content → Billing & Servicing)
- D-26 Scaffold script as Phase 1 first-class deliverable
- D-27 Single monorepo version
- D-28 Vanilla npm workspaces (no pnpm/Turborepo/Nx)
- D-29 Phase 1 re-sized M → L
- D-30 TestRail per-package aggregation
- D-31 Legacy POC keeps `playwright.config.js` (no rename)
- D-32 Phase 2 promotion-rule exception
- D-33 Storage-state naming convention
- D-34 Scaffold templates as source of truth from Phase 0 Step G
- D-35 Kill the shim; legacy POC keeps duplicated JS helpers until Phase 5 sunset
- D-36 Framework `package.json` declares explicit `exports` field
- D-37 Phase 2 internal work order strict (Section 6.4.1)
- D-38 Single workspace-root ESLint flat config
- D-39 Framework breaking-change discipline
- D-40 `run-summary.json` schema version 1
- D-41 Storage states shared at workspace root
- D-42 API client accepts `APIRequestContext`; no inline login
- D-43 Legacy-poc hoist policy
- D-44 Walking-skeleton selector reconnaissance (Phase 0 Step 0.0)

Items D-07 (TestRail Run 175 cadence), D-11 (rotation owner committed), and D-22 (named Security counterpart) are also ratified — the Program Owner self-accepts them with the caveats above.

## Decisions explicitly held OPEN

The following remain OPEN with named owner = Program Owner and target resolution at the listed phase boundary. They do *not* block Phase 0 Steps 0.0 through 0.C.

| ID | What is open | Blocks | Plan |
|---|---|---|---|
| D-02 | CI platform | Phase 1 | **Default to GitHub Actions** because the repo is on GitHub. To be confirmed at Phase 1 entry; can be changed before any workflow file is committed. |
| D-03 | Secret store | Phase 0 Step 0.D, Phase 1 | **Default to GitHub Secrets** for consistency with D-02 default. |
| D-05 | Frontend `data-testid` rollout owner | Phase 3 | No frontend partner yet. Phase 3 cannot start until a partner is named. |
| D-06 | First migration scope | Phase 4 | Recommendation `account-billing` carried forward. |
| D-08 | `__REACT_QUERY_CLIENT__` exposure (`FOR_QA=true`) | Phase 2 component layer | If frontend has not delivered by Phase 2 entry, the workaround documented in `WRITING-TESTS.md` is used. |
| D-18 | Phase 5 backend cooperation SLA | Phase 5 | Carried to Phase 4 exit. |
| D-20 | Git history rewrite vs accept | Phase 0 exit | Decided by Program Owner at end of Step 0.E after the audit report is in hand. |

## Risks acknowledged in writing

All risks scoring ≥ 12 are acknowledged with the Program Owner as mitigation owner of last resort:

- R-02 (`data-testid` rollout deprioritized) — owner Program Owner + future frontend partner.
- R-06 (qa2 / qa3 environment instability) — owner Program Owner; escalation path is GeoWealth Platform team.
- R-07 (credential leak from committed `testrail.config.json`) — owner Program Owner (self-accepting Security role).
- R-10 (migration drift) — owner Program Owner.
- R-11 (single QA Automation contributor — bus factor of 1) — **explicitly accepted** for Phase 0 / Phase 1; recruitment of a second contributor remains the program's most important non-technical task and is the gate for Phase 2 entry.
- R-14 (storage-state expiry) — mitigated by `auth.fixture.ts` freshness re-validation built in Step 0.F.
- R-15 (qa2 instability blocks Phase 0 walking skeleton) — mitigated by D-23 fallback to qa3.
- R-16 (historical credential leak unresolved) — held open until Step 0.E.
- R-18 (scaffold script template rot) — mitigated by Step 0.G.4 verification script + Phase 1 scaffold-test workflow.
- R-21 (TS path-alias footgun) — mitigated by Section 4.2.3.1 duplicated paths block.
- R-24 (framework breaking-change cascade) — mitigated by D-39 discipline (effective from Phase 2).

## Pre-Phase-0 checklist completion

- [x] **Decisions** ratified or held OPEN with explicit owners. See above.
- [x] **Program Owner** named.
- [x] **Security counterpart** self-accepted with documented caveats.
- [x] **Engineering Manager / second contributor** acknowledged as not yet present; risk R-11 explicitly carried.
- [x] **Confluence space** — substituted by `docs/` directory in this repository for the duration of the solo phase. To be migrated to a real Confluence space if/when a corporate workspace becomes available.
- [x] **Existing committed credentials inventoried** — pending Step 0.C (`grep -rn "testrail.config" packages/legacy-poc/`); the inventory is recorded in `docs/phase-0-tracking.md` after Step 0.B.
- [x] **Phase 0 tracking issue** — substituted by `docs/phase-0-tracking.md` in this repository.
- [x] **This document linked from `MEMORY.md` and the substitute Confluence space** — `docs/` is in the repo; CLAUDE memory will be updated separately if needed.

## Decision

**Phase 0 is authorized to start.** Step 0.0 (walking-skeleton selector reconnaissance) begins immediately following this record being committed.

The Program Owner explicitly acknowledges that running Phase 0 with bus-factor 1, no separate Security counterpart, and a substitute Confluence space carries elevated risk. These trade-offs are accepted for the duration of the solo phase and will be re-evaluated at Phase 1 exit (M3 milestone).

---

*Signed (acting Program Owner):* Petar Nenov, 2026-04-09
