# `@geowealth/e2e-tooling`

CLI utilities for the GeoWealth E2E monorepo. **Not consumed at test runtime** — every artifact here is a build / CI tool.

**Status:** Phase 0 skeleton. The substantive content lands in **Phase 1** per D-26:
- `src/scaffold-team.ts` — the scaffold script
- `src/scaffold-doctor.ts` — drift detector
- `src/changed-packages.ts` — affected-package detection for the PR gate
- `src/ci-matrix.ts` — dynamic CI matrix generator
- `src/check-versions.ts` — single-version enforcement (D-27)
- `src/testrail-aggregator.ts` — per-package TestRail result aggregator (D-30)
- `src/preflight.ts` — environment health pre-flight (Section 5.9)
- `src/substitute.ts` — template substitution function (Phase 0 Step 0.G.1)
- `src/eslint-rules/` — local ESLint rules (`no-cross-team-import`, `no-new-legacy-spec`, `framework-exports-only`, `duplicate-paths-block`)
- `templates/team/` — scaffold templates (Phase 0 Step 0.G.2)
- `scripts/expand-templates.ts`, `scripts/verify-bootstrap-vs-templates.ts`, `scripts/pre-commit-secrets.sh`

In Phase 0, only Step 0.G.1–0.G.4 (substitute function + templates + bootstrap generation + verification) are required. The CLI wrapping arrives in Phase 1.
