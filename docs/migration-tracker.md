# Migration Tracker

> **Status**: Phase 1 — schema ready, populated as Phase 4 specs flow through the parity gate.

## Schema

One row per legacy spec being migrated from `packages/legacy-poc/` into a `packages/tests-<team>/` package. Per Section 6.11 of `OFFICIAL-FRAMEWORK-PROPOSAL.md`:

| Column | Meaning |
|---|---|
| `area` | POC feature area (`account-billing`, `bucket-exclusions`, etc.) |
| `case_id` | TestRail case ID (`C25193`, etc.) |
| `legacy_path` | Always under `packages/legacy-poc/tests/<area>/...` |
| `target_package` | Consuming `tests-<team>/` package — currently always `tests-billing-servicing` per D-25 |
| `new_path` | Full path under the target package |
| `state` | One of: `pending` → `ported` → `gating` → `gated` → `deleted` |
| `owner` | Person responsible for moving this spec through its current state |
| `last_state_change` | ISO date of the last state transition (filled by CI hook at merge time) |
| `notes` | Free text |

## Workflow

1. **Port PR** moves the spec from `pending` → `ported`. The legacy spec stays in place; the new spec runs in CI.
2. **Gating window** (5 consecutive green nightly runs on qa2 *and* qa3) moves the spec from `ported` → `gating` → `gated`. Failures reset the counter.
3. **Deletion PR** moves the spec from `gated` → `deleted`. The legacy spec is removed in this PR.

The port PR and the deletion PR are intentionally separate (per the v0.6 plan revision) so the gating window is visible in git history.

Cohort sizing per area: `min(5, ceil(area_size / 3))` in-flight `gating` specs at a time. New port PRs into an area pause when the gating queue is full or one in-flight spec has failed in the last two nights.

## Areas — populated by Phase 4

The seven POC areas land in `packages/tests-billing-servicing/` per D-25.

### Billing & Servicing — `account-billing/` (15 specs)

| case_id | legacy_path | new_path | state | owner | last_state_change | notes |
|---|---|---|---|---|---|---|
| C25193 | `packages/legacy-poc/tests/account-billing/C25193.spec.js` | `packages/tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts` | `ported` | QA Automation | 2026-04-10 | Phase 2 graduation spec (commit `9b9de4e`). |
| C25194 | `packages/legacy-poc/tests/account-billing/C25194.spec.js` | `packages/tests-billing-servicing/tests/regression/account-billing/C25194.spec.ts` | `ported` | QA Automation | 2026-04-10 | Phase 4 — Billing Method combo (icon-only variant). |
| C25195 | `packages/legacy-poc/tests/account-billing/C25195.spec.js` | `packages/tests-billing-servicing/tests/regression/account-billing/C25195.spec.ts` | `ported` | QA Automation | 2026-04-10 | Phase 4 — Account for Billing combo (icon-only variant). |
| C25196 | `packages/legacy-poc/tests/account-billing/C25196.spec.js` | `packages/tests-billing-servicing/tests/regression/account-billing/C25196.spec.ts` | `ported` | QA Automation | 2026-04-10 | Phase 4 — Adviser Billing Spec combo (typeAhead) + Active Date. Firm 106 only (no workerFirm). |
| C25197 | `packages/legacy-poc/tests/account-billing/C25197.spec.js` | `packages/tests-billing-servicing/tests/regression/account-billing/C25197.spec.ts` | `ported` | QA Automation | 2026-04-10 | Phase 4 — 6 billing-bucket exclude radios + History check. |
| C25198 | `packages/legacy-poc/tests/account-billing/C25198.spec.js` | `packages/tests-billing-servicing/tests/regression/account-billing/C25198.spec.ts` | `ported` | QA Automation | 2026-04-10 | Phase 4 — Adjustment Percent + Expiration Date (ComboBox + NumericInput + DatePicker). |
| C25199 | `packages/legacy-poc/tests/account-billing/C25199.spec.js` | `packages/tests-billing-servicing/tests/regression/account-billing/C25199.spec.ts` | `ported` | QA Automation | 2026-04-10 | Phase 4 — Adjustment Amount [$] mirror of C25198. |
| C25200 | `packages/legacy-poc/tests/account-billing/C25200.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | Pre-existing flaky in legacy POC. |
| C25201 | `packages/legacy-poc/tests/account-billing/C25201.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25206 | `packages/legacy-poc/tests/account-billing/C25206.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25207 | `packages/legacy-poc/tests/account-billing/C25207.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25208 | `packages/legacy-poc/tests/account-billing/C25208.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25209 | `packages/legacy-poc/tests/account-billing/C25209.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25249 | `packages/legacy-poc/tests/account-billing/C25249.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C26490 | `packages/legacy-poc/tests/account-billing/C26490.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |

### Billing & Servicing — `billing-specs/` (4 specs)

| case_id | legacy_path | new_path | state | owner | last_state_change | notes |
|---|---|---|---|---|---|---|
| C24935 | `packages/legacy-poc/tests/billing-specs/C24935.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25084 | `packages/legacy-poc/tests/billing-specs/C25084.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25085 | `packages/legacy-poc/tests/billing-specs/C25085.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C26306 | `packages/legacy-poc/tests/billing-specs/C26306.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |

### Billing & Servicing — `create-account/` (7 specs)

| case_id | legacy_path | new_path | state | owner | last_state_change | notes |
|---|---|---|---|---|---|---|
| C24940 | `packages/legacy-poc/tests/create-account/C24940.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C24941 | `packages/legacy-poc/tests/create-account/C24941.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C24943 | `packages/legacy-poc/tests/create-account/C24943.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C24996 | `packages/legacy-poc/tests/create-account/C24996.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C24997 | `packages/legacy-poc/tests/create-account/C24997.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25065 | `packages/legacy-poc/tests/create-account/C25065.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25102 | `packages/legacy-poc/tests/create-account/C25102.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |

### Billing & Servicing — `bucket-exclusions/` (13 specs)

| case_id | legacy_path | new_path | state | owner | last_state_change | notes |
|---|---|---|---|---|---|---|
| C25363 | `packages/legacy-poc/tests/bucket-exclusions/C25363.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25364 | `packages/legacy-poc/tests/bucket-exclusions/C25364.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25377 | `packages/legacy-poc/tests/bucket-exclusions/C25377.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25378 | `packages/legacy-poc/tests/bucket-exclusions/validation/C25378.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25379 | `packages/legacy-poc/tests/bucket-exclusions/validation/C25379.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25380 | `packages/legacy-poc/tests/bucket-exclusions/validation/C25380.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25381 | `packages/legacy-poc/tests/bucket-exclusions/C25381.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25789 | `packages/legacy-poc/tests/bucket-exclusions/C25789.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25790 | `packages/legacy-poc/tests/bucket-exclusions/C25790.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25791 | `packages/legacy-poc/tests/bucket-exclusions/C25791.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25792 | `packages/legacy-poc/tests/bucket-exclusions/C25792.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25793 | `packages/legacy-poc/tests/bucket-exclusions/C25793.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |

### Billing & Servicing — `unmanaged-assets/` (12 specs)

| case_id | legacy_path | new_path | state | owner | last_state_change | notes |
|---|---|---|---|---|---|---|
| C25441 | `packages/legacy-poc/tests/unmanaged-assets/C25441.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25445 | `packages/legacy-poc/tests/unmanaged-assets/C25445.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25446 | `packages/legacy-poc/tests/unmanaged-assets/validation/C25446.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25447 | `packages/legacy-poc/tests/unmanaged-assets/validation/C25447.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25448 | `packages/legacy-poc/tests/unmanaged-assets/validation/C25448.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | Three sub-tests in this file. |
| C25449 | `packages/legacy-poc/tests/unmanaged-assets/validation/C25449.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25450 | `packages/legacy-poc/tests/unmanaged-assets/validation/C25450.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C25451 | `packages/legacy-poc/tests/unmanaged-assets/validation/C25451.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C26073 | `packages/legacy-poc/tests/unmanaged-assets/C26073.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C26074 | `packages/legacy-poc/tests/unmanaged-assets/C26074.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C26075 | `packages/legacy-poc/tests/unmanaged-assets/C26075.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |

### Billing & Servicing — `merge-prospect/` (8 specs)

| case_id | legacy_path | new_path | state | owner | last_state_change | notes |
|---|---|---|---|---|---|---|
| C26057 | `packages/legacy-poc/tests/platform-one/merge-prospect/C26057.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | Pre-existing flaky in legacy POC. |
| C26058 | `packages/legacy-poc/tests/platform-one/merge-prospect/C26058.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C26059 | `packages/legacy-poc/tests/platform-one/merge-prospect/C26059.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C26060 | `packages/legacy-poc/tests/platform-one/merge-prospect/C26060.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | Permission-disabled scenario; Phase 5 backend cooperation needed. |
| C26082 | `packages/legacy-poc/tests/platform-one/merge-prospect/C26082.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | Pre-existing flaky in legacy POC. |
| C26083 | `packages/legacy-poc/tests/platform-one/merge-prospect/C26083.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C26084 | `packages/legacy-poc/tests/platform-one/merge-prospect/C26084.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | |
| C26085 | `packages/legacy-poc/tests/platform-one/merge-prospect/C26085.spec.js` | _pending_ | `pending` | QA Automation | 2026-04-09 | Permission-disabled scenario; Phase 5 backend cooperation needed. |

### Billing & Servicing — `auto-link/` (7 specs, all `test.fixme`)

| case_id | legacy_path | new_path | state | owner | last_state_change | notes |
|---|---|---|---|---|---|---|
| C26077 | `packages/legacy-poc/tests/platform-one/auto-link/C26077.spec.js` | _Phase 5 unblock_ | `pending` | QA Automation | 2026-04-09 | All `test.fixme`; Phase 5 disposable email pool. |
| C26078 | `packages/legacy-poc/tests/platform-one/auto-link/C26078.spec.js` | _Phase 5 unblock_ | `pending` | QA Automation | 2026-04-09 | |
| C26079 | `packages/legacy-poc/tests/platform-one/auto-link/C26079.spec.js` | _Phase 5 unblock_ | `pending` | QA Automation | 2026-04-09 | |
| C26080 | `packages/legacy-poc/tests/platform-one/auto-link/C26080.spec.js` | _Phase 5 unblock_ | `pending` | QA Automation | 2026-04-09 | |
| C26093 | `packages/legacy-poc/tests/platform-one/auto-link/C26093.spec.js` | _Phase 5 unblock_ | `pending` | QA Automation | 2026-04-09 | |
| C26094 | `packages/legacy-poc/tests/platform-one/auto-link/C26094.spec.js` | _Phase 5 unblock_ | `pending` | QA Automation | 2026-04-09 | |
| C26100 | `packages/legacy-poc/tests/platform-one/auto-link/C26100.spec.js` | _Phase 5 unblock_ | `pending` | QA Automation | 2026-04-09 | |


### Platform — empty package (created by scaffold)

_Created by `scaffold-team` on 2026-04-09._ No specs yet; team begins authoring tests after Phase 5.


### Trading — empty package (created by scaffold)

_Created by `scaffold-team` on 2026-04-09._ No specs yet; team begins authoring tests after Phase 5.


### Reporting — empty package (created by scaffold)

_Created by `scaffold-team` on 2026-04-09._ No specs yet; team begins authoring tests after Phase 5.


### Investments — empty package (created by scaffold)

_Created by `scaffold-team` on 2026-04-09._ No specs yet; team begins authoring tests after Phase 5.


### Integrations — empty package (created by scaffold)

_Created by `scaffold-team` on 2026-04-09._ No specs yet; team begins authoring tests after Phase 5.


### Custody & PA — empty package (created by scaffold)

_Created by `scaffold-team` on 2026-04-09._ No specs yet; team begins authoring tests after Phase 5.

### Other team areas

The other six team packages (`tests-platform`, `tests-trading`, `tests-reporting`, `tests-investments`, `tests-integrations`, `tests-custody-pa`) currently have **no specs** — they exist as empty bootstraps. This tracker grows section headers for them as the scaffold script is invoked for each, and rows as those teams begin authoring tests post-Phase-5.

> **Total currently-tracked specs**: 66 (15 + 4 + 7 + 13 + 12 + 8 + 7), all in the Billing & Servicing target package.
