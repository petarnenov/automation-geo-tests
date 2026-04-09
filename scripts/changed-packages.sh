#!/usr/bin/env bash
#
# changed-packages.sh — thin wrapper around the TypeScript implementation
# at packages/tooling/src/changed-packages.ts.
#
# Per Section 4.2.1 of OFFICIAL-FRAMEWORK-PROPOSAL.md, the affected-package
# detection algorithm lives at packages/tooling/src/changed-packages.ts and
# is exposed to CI via this thin shell wrapper at scripts/changed-packages.sh.
# CI workflows call this wrapper rather than tsx directly so the
# invocation surface is one stable shell command.
#
# All flags pass through unchanged. Common usage from a workflow:
#
#   ./scripts/changed-packages.sh --base "$BASE_SHA" --head HEAD --format json
#
# Output: JSON on stdout (default) — { "packages": [...], "fullFallback": bool }.
# Exit code: 0 on success, non-zero on failure (git errors, parse errors, etc).

set -euo pipefail

# Resolve workspace root from this script's location, regardless of CWD —
# CI workflows often invoke from a subdirectory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${WORKSPACE_ROOT}"

exec npx --no-install tsx packages/tooling/src/changed-packages.ts "$@"
