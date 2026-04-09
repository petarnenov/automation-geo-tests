# `@geowealth/e2e-framework`

The shared substrate consumed by every per-team test package and by the legacy POC's eventual migration target. Contains Page Objects for cross-team screens, Component classes for React widgets, fixtures, the typed `/qa/*` API client, factories, types, and the TestRail reporter.

**Status:** Phase 0 skeleton. The foundational layer (auth fixture, globalSetup, `definePlaywrightConfig`, environments, dotenv loader) lands in **Phase 0 Step 0.F**. The full Component library and API client land in **Phase 2**.

The `tsconfig.json` in this package currently has `"include": []` and `"files": []` because there is no source code yet. Step 0.F replaces the include list with `["src/**/*.ts"]` when the foundational files arrive.

The `exports` field in `package.json` (D-36) declares the public surface up front so consuming packages can refer to subpaths like `@geowealth/e2e-framework/config` from day one. Subpaths whose target files do not yet exist will fail to resolve at consumption time — that is intentional and protects against accidentally importing internals.

## Conventions

- **Promotion rule (Section 4.2.2):** new code lands here only by promotion from a `tests-<team>/` package once a *second* team needs it. Phase 2 has an exception for the foundational lift (D-32).
- **Breaking-change discipline (D-39):** any breaking change to an exported symbol requires a two-step deprecation, a framework-change PR template, a consumer impact preview, and an approving cross-team review.
