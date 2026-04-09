# Scaffold — onboarding a new team

> **Status**: Phase 1 Step 1 — full content. Per Decision **D-26**, the scaffold script is a Phase 1 first-class deliverable with a 30-minute productivity SLA.

The `scaffold-team` CLI generates a fully working `tests-<slug>/` package and registers it everywhere it needs to be registered, so a new team is productive within 30 minutes of running it.

## Quick start

```bash
npm run scaffold:team -- \
  --slug reporting \
  --name "Reporting" \
  --owner "@geowealth/reporting-qa" \
  --confluence "https://development.geowealth.com/confluence/display/REP" \
  --testrail-section 412
```

## CLI surface

| Flag | Required | Purpose |
|---|---|---|
| `--slug` | ✅ | kebab-case identifier; becomes the package directory name (`packages/tests-<slug>/`) and the npm package name suffix (`@geowealth/tests-<slug>`). Validated against `/^[a-z][a-z0-9-]+$/`. |
| `--name` | ✅ | Display name; used in READMEs, status reports, package descriptions. |
| `--owner` | ✅ | A team handle (typically a GitHub team like `@geowealth/reporting-qa`). Written into CODEOWNERS. |
| `--confluence` | optional | Link to the team's Confluence space; written into the team package's README. |
| `--testrail-section` | optional | TestRail section ID; informs the future TestRail reporter which section results post to. |
| `--dry-run` | optional | Print the planned file tree and mutations; do not write. |
| `--force` | optional | Overwrite an existing package — refused unless explicitly given. |
| `--help` / `-h` | optional | Print the usage message and exit. |

## What the script does

For `--slug reporting`, the script produces (and verifies non-existence of) the following artifacts atomically — either all writes succeed or none do:

| Action | Path | Source |
|---|---|---|
| **write** | `packages/tests-reporting/package.json` | `packages/tooling/templates/team/package.json.tpl` |
| **write** | `packages/tests-reporting/tsconfig.json` | template |
| **write** | `packages/tests-reporting/playwright.config.ts` | template (calls `definePlaywrightConfig({ projectName: 'reporting' })`) |
| **write** | `packages/tests-reporting/README.md` | template (filled with name / owner / confluence) |
| **write** | `packages/tests-reporting/tests/smoke/dashboard.spec.ts` | template (the walking-skeleton spec; this is the team's first green test) |
| **write** | `packages/tests-reporting/tests/regression/.gitkeep` | template |
| **write** | `packages/tests-reporting/src/pages/.gitkeep` | template |
| **write** | `packages/tests-reporting/.auth/.gitignore` | template |
| **write** | `packages/tests-reporting/.gitignore` | template |
| **mutate** | `CODEOWNERS` | append `/packages/tests-reporting/  @geowealth/reporting-qa @TODO-qa-leads` inside the `# === BEGIN scaffold-managed: team packages ===` section |
| **mutate** | `docs/migration-tracker.md` | append a `### Reporting — empty package (created by scaffold)` section header |
| **mutate** | `docs/CHANGELOG.md` | append `- Onboarded team package @geowealth/tests-reporting (scaffold).` under `[Unreleased]` |

The CLI prints the full plan first, then applies it. `--dry-run` stops after the plan and writes nothing.

## Idempotency

Re-running the script for the same `--slug` is safe with respect to mutations:

- **CODEOWNERS**: appends only if the row is not already present.
- **`docs/migration-tracker.md`**: appends only if the section header is not already present.
- **`docs/CHANGELOG.md`**: appends only if the line is not already present.

For the package files themselves, re-running requires `--force`.

## Success SLA (D-26)

A team that runs `npm run scaffold:team` against a clean clone has a green smoke spec running locally within **30 minutes**, **provided the developer has met the following pre-conditions**:

1. **Node 20 LTS installed** (matches `.nvmrc`).
2. **Network access** to `qa2.geowealth.com` (or `qa3` via `TEST_ENV=qa3`).
3. **`.env.local` populated** at the workspace root with `TIM1_USERNAME` and `TIM1_PASSWORD`. See `docs/ONBOARDING.md` (Phase 2 deliverable) for how to retrieve them from the secret store.
4. **`feat/corporate-e2e-migration` branch** checked out (or a later branch).

The 30-minute clock starts at `npm run scaffold:team` and includes `npm install`, package generation, and the smoke spec's full execution.

## Pre-condition check

If any pre-condition is unmet, the script exits with a clear "missing pre-condition" message and a link to this document — **it does not silently fail later inside the smoke spec**.

## After scaffolding

The script prints a "Next steps" message:

```
Next steps:
  1. Run `npm install` at the workspace root to register the new package.
  2. Run the smoke spec to validate:
       cd packages/tests-<slug> && \
       TESTRAIL_REPORT_RESULTS=0 npx playwright test --grep @smoke
  3. The package is owned by <owner>; replace @TODO-qa-leads in CODEOWNERS when known.
```

A successful smoke spec output looks like this:

```
[framework globalSetup] tim1 storage state saved → /home/.../.auth/tim1.json

Running 1 test using 1 worker

  ✓ 1 [<slug>] tests/smoke/dashboard.spec.ts
      @smoke @<slug> walking skeleton — Platform One landing renders (~20s)

  1 passed
```

## `scaffold:doctor` — drift detection

A team's package can drift over time as the framework evolves (new fixtures, new config keys, new CI matrix axes). `scaffold:doctor` re-runs the substitute function against the templates and reports the diff between what the script would generate today versus what exists on disk.

```bash
npm run scaffold:doctor -- --slug reporting
```

Drift is **informational**, not a failure — but the report is the input to a coordinated bring-up-to-date PR. To re-apply the templates after seeing drift:

```bash
rm -rf packages/tests-reporting
npm run scaffold:team -- --slug reporting --name "Reporting" --owner "@geowealth/reporting-qa"
```

## Templates

Templates live at `packages/tooling/templates/team/` and are valid TypeScript / JSON / Markdown / YAML files with `{{name}}`, `{{slug}}`, `{{owner}}`, `{{confluence}}`, `{{testrail_section}}` placeholders. The substitute function is **dependency-free** and **fail-fast** on undefined placeholders — there are no conditionals, loops, or escaping rules.

Adding a new artifact to the scaffold output is a single PR that:

1. Adds a new `*.tpl` file under `packages/tooling/templates/team/`.
2. (Optional) Adds a new placeholder to `packages/tooling/src/substitute.ts`'s known set.
3. Re-runs `scaffold-team` against an existing slug to verify byte-parity.
4. Lands. The Phase 1 scaffold-test CI workflow (a follow-up commit) catches template rot before merge.

## Ownership and versioning

- **Script**: `packages/tooling/src/scaffold-team.ts` and `packages/tooling/src/scaffold-doctor.ts`. Owned by **QA Automation**.
- **Templates**: `packages/tooling/templates/team/`. Versioned via the monorepo's single version (D-27).
- **Substitute function**: `packages/tooling/src/substitute.ts`. Shared with Phase 0's `expand-templates.ts` (D-34, no drift).

## Why scaffold is a Phase 1 deliverable, not Phase 4

Without the script, onboarding the second team is manual labour. The whole point of the monorepo is to make new-team onboarding cheap. Moving the script to Phase 1 (right after CI bootstrap) means **every team after the first is bootstrapped via the script, not by hand**. Phase 4 then exercises the scaffold across seven real teams, which is the best validation we can run.

## Relationship to Phase 0

Phase 0 Step 0.G shipped:

- `packages/tooling/src/substitute.ts` — the substitute function.
- `packages/tooling/templates/team/` — the templates.
- `packages/tooling/scripts/expand-templates.ts` — a minimal generation script that just writes the package files.
- `packages/tooling/scripts/verify-bootstrap-vs-templates.ts` — the parity verification.

Phase 1 (this commit) adds:

- `packages/tooling/src/scaffold-team.ts` — the CLI that wraps `expand-templates.ts` and additionally mutates CODEOWNERS / migration tracker / CHANGELOG.
- `packages/tooling/src/scaffold-doctor.ts` — drift detection.
- This document (`docs/SCAFFOLD.md`).
- `npm run scaffold:team` and `npm run scaffold:doctor` script wiring at the workspace root.
