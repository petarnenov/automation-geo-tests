#!/usr/bin/env bash
#
# ci-matrix.sh — thin wrapper around the TypeScript implementation at
# packages/tooling/src/ci-matrix.ts.
#
# Per Section 4.2.1 of OFFICIAL-FRAMEWORK-PROPOSAL.md, the matrix
# generator lives at packages/tooling/src/ci-matrix.ts and is exposed
# to CI via this shell wrapper. The PR-gate and nightly workflows call
# this wrapper to produce the per-shard job spec for the GitHub Actions
# matrix axes (package, environment).
#
# All flags pass through unchanged. Common usage from a workflow:
#
#   ./scripts/ci-matrix.sh --mode pr-gate \
#       --base "$BASE_SHA" --head HEAD
#
#   ./scripts/ci-matrix.sh --mode nightly \
#       --input changed.json
#
# Output: JSON on stdout, suitable for `fromJSON()` in GitHub Actions
# matrix expressions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${WORKSPACE_ROOT}"

exec npx --no-install tsx packages/tooling/src/ci-matrix.ts "$@"
