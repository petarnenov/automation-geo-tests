# TestRail run 220 — failed tests (live)

Source: TestRail run 220, `status_id=5` (Failed) — **10 tests** as of 2026-07-03.

| # | Case | Area | Title | Jira |
|---|------|------|-------|------|
| 1 | C26073 | unmanaged-assets | Update/Add (U action) creates new exclusion record | GEO-19731 |
| 2 | C26074 | unmanaged-assets | Delete (D action) removes exclusion record | GEO-19731 |
| 3 | C26075 | unmanaged-assets | Remove All (RA action) removes all records | GEO-19731 |
| 4 | C25381 | bucket-exclusions | All 6 buckets accept Y/N/I excluded actions | GEO-15798 |
| 5 | C25207 | account-billing | Account Unmanaged Assets — Update Exclude from Performance | GEO-20808 |
| 6 | C25208 | account-billing | Account Unmanaged Assets — Create Exclude from Billing | GEO-20808 |
| 7 | C25018 | billing-runs | Billing Status Progression | GEO-12914 |
| 8 | C25019 | billing-runs | Billing History Replacement for Target Accounts | GEO-12914 |
| 9 | C25021 | billing-runs | Timestamp Superscript for Partial Re-run | GEO-12914 |
| 10 | C25067 | billing-runs | Correct Client Target Type Displayed by Billing Type | GEO-12914 |

## Grouped by cause

- **Unmanaged Assets / Bucket Exclusions (C26073, C26074, C26075, C25381, C25207, C25208)** — GEO-19731 / GEO-15798 / GEO-20808. Advisor permission-cache warmup + exclusion-record flows.
- **Billing Runs (C25018, C25019, C25021, C25067)** — GEO-12914. Billing-run seed data / target-type grids.

TestRail result comments are the generic technology-agnostic string ("result is unsuccessful") — no per-step error stored. Root-cause detail must come from a fresh local run log.
