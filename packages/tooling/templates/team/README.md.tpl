# `@geowealth/tests-{{slug}}`

GeoWealth E2E tests for the **{{name}}** team.

> Generated from `packages/tooling/templates/team/` in Phase 0 Step 0.G (or via `npm run scaffold:team` in Phase 1+). The generation script and the future scaffold CLI share a single substitute function (D-34, no drift).

## First 30 minutes

```bash
# 1. Make sure Node 20 LTS is active.
nvm use            # reads .nvmrc

# 2. Make sure the workspace .env.local is populated.
#    See docs/ONBOARDING.md for the variables and where to get them.
cat ../../.env.local

# 3. Run the smoke spec to validate the setup.
npm run test:smoke
```

The smoke spec at `tests/smoke/dashboard.spec.ts` logs in as `tim1`, navigates to the post-login landing page, and asserts that the **Operations** heading is visible. If the spec is green, your environment is ready.

## Adding a new spec

See `docs/WRITING-TESTS.md` (Phase 5 deliverable) for the canonical cookbook. In short:

1. Place the spec under `tests/regression/<area>/C<id>.spec.ts`.
2. `import { test, expect } from '@geowealth/e2e-framework/fixtures';`
3. Tag with `@smoke` or `@regression` plus `@{{slug}}`.
4. Use the framework's Page Objects and fixtures; never call `@playwright/test` directly.

## Ownership

This package is owned by the {{name}} team. Cross-team Page Objects belong in `@geowealth/e2e-framework`, not here. See Section 4.2.2 of `docs/OFFICIAL-FRAMEWORK-PROPOSAL.md` for the promotion rule.
