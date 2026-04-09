# `@geowealth/legacy-poc`

The original `automation-geo-tests` POC, relocated here from the repo root in **Phase 0 Step 0.B** as a single pure-rename PR. Continues to deliver TestRail Run 175 results unchanged until **Phase 5 sunset**, when the entire package is deleted (D-13, D-35).

This package has **no `tsconfig.json`** — it is pure CommonJS. The workspace root's `tsconfig.base.json` has `allowJs: true` so the workspace `tsc --noEmit` does not balk at the JS files; that flag is dropped at Phase 5 sunset alongside this package's deletion.

## Scope

Owns the entire current Pepi (TestRail Run 175) test surface:

- `tests/account-billing/` (15 specs)
- `tests/billing-specs/` (4 specs)
- `tests/create-account/` (7 specs)
- `tests/bucket-exclusions/` (13 specs, with `validation/` subfolder)
- `tests/unmanaged-assets/` (12 specs, with `validation/` subfolder)
- `tests/platform-one/merge-prospect/` (8 specs)
- `tests/platform-one/auto-link/` (7 specs, all `test.fixme`)

Plus reusable helpers under `tests/_helpers/`, the legacy JS TestRail reporter under `reporters/`, and probe / fixture-generation scripts under `scripts/`.

## Running

From this directory or via the workspace root passthrough:

```bash
# From the workspace root
npm run test:legacy:pepi              # full @pepi suite
npm run test:legacy:pepi:dry          # @pepi without TestRail posting

# Or directly inside this package
cd packages/legacy-poc
npm run test:pepi
```

The legacy POC reads its credentials from the workspace-root `.env.local` (Step 0.C will land that refactor; until then, `testrail.config.json` is the source). The `playwright.config.js` in this package is intentionally still `.js` (D-31) — only the future framework introduces `.ts` configs per team package.

## Hoist policy (D-43)

This package's `package.json` declares **no devDependencies**. Every dependency it needs (`@playwright/test`, `eslint`, `prettier`, etc.) is hoisted from the workspace root. The workspace lockfile is the single source of truth. If the legacy POC ever needs a divergent version, declare it here explicitly and accept the duplication for that one dep.

## End of life

This package is deleted in **Phase 5 sunset**. Before deletion, `tests/_helpers/` and `scripts/` are archived as `docs/historical/legacy-poc-helpers.tar.gz` for future debugging reference. The single-PR cutover from JS-on-Run-175 to TS-on-Run-175 (D-15) lands in the same change.
