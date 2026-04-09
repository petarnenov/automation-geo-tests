# Scaffold (placeholder)

> **Status:** Phase 0 placeholder. Full content lands in **Phase 1** when the
> scaffold script (`npm run scaffold:team`) is delivered as a first-class
> deliverable per Decision **D-26** and Section 4.2.5 of
> `OFFICIAL-FRAMEWORK-PROPOSAL.md`.

## What this document will cover (Phase 1)

- The CLI surface of `npm run scaffold:team` and `npm run scaffold:doctor`
- Required and optional flags
- Generated artifacts (the file tree the script writes per team)
- The 30-minute success SLA
- Pre-conditions a developer must meet before running the script
- The scaffold-test CI workflow that protects the templates from rot

## Step 0.G state (Phase 0)

In Phase 0 Step 0.G, only the **templates** and the **substitute function**
exist; there is no CLI yet. The bootstrap `tests-billing-servicing` package
is generated from the templates by `packages/tooling/scripts/expand-templates.ts`,
not by the CLI.

When the CLI lands in Phase 1, it wraps `expand-templates.ts` and adds
CODEOWNERS / migration tracker / CI matrix mutations on top.

## References

- **Plan section:** `OFFICIAL-FRAMEWORK-PROPOSAL.md` § 4.2.5
- **Templates location:** `packages/tooling/templates/team/` (Phase 0 Step 0.G)
- **Decision:** D-26 (Phase 1 first-class deliverable), D-34 (templates as source of truth)
