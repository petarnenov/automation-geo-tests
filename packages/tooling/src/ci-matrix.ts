/**
 * `ci-matrix` — generate the CI matrix dynamically per PR / nightly.
 *
 * Reads `changed-packages` output (or accepts a JSON file via --input)
 * and produces the per-shard job spec for the GitHub Actions matrix.
 *
 * Phase 1.4. Wired to:
 *   - `npm run ci-matrix` at the workspace root.
 *   - `scripts/ci-matrix.sh` (CI shell wrapper, Phase 1.8).
 *
 * The output format matches GitHub Actions' `strategy.matrix` JSON
 * shape: a `package` axis with one entry per affected package, plus a
 * fixed `environment` axis (qa2, qa3) for the nightly job. The PR-gate
 * job uses only the package axis (smoke specs run against a single
 * env per PR).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPackageGraph,
  computeChangedPackages,
  gitChangedFiles,
  type ChangedPackagesResult,
} from './changed-packages.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT_DEFAULT = path.resolve(__dirname, '..', '..', '..');

export type MatrixMode = 'pr-gate' | 'nightly';

export interface MatrixJob {
  /** Workspace package name (e.g. `@geowealth/tests-billing-servicing`). */
  readonly package: string;
  /** Path of the package directory relative to workspace root. */
  readonly packageDir: string;
  /** Target environment for this job. */
  readonly environment: string;
}

export interface MatrixOutput {
  /** All matrix jobs (cross-product of affected packages × environments). */
  readonly include: readonly MatrixJob[];
  /** Mode this matrix was generated for. */
  readonly mode: MatrixMode;
  /** Total job count. */
  readonly count: number;
  /** True iff a full-workspace fallback was triggered upstream. */
  readonly fullFallback: boolean;
}

const PR_GATE_ENVIRONMENTS = ['qa2'] as const;
const NIGHTLY_ENVIRONMENTS = ['qa2', 'qa3'] as const;

/**
 * Filter packages that have a runnable Playwright config — only these
 * are emitted in the matrix. The framework + tooling + legacy-poc
 * packages are excluded from the matrix because:
 *   - framework: tested separately via its own playwright.config (Phase 2).
 *   - tooling: pure CLI / unit tests, run via `npm run test:tooling`.
 *   - legacy-poc: still needed; runs as its own matrix entry but uses
 *     the legacy `playwright.config.js` (Phase 1.8 workflow).
 *
 * For Phase 1.4 we include legacy-poc and every tests-* package; the
 * workflow can subset further if needed.
 */
function isMatrixPackage(name: string): boolean {
  if (name === '@geowealth/e2e-framework') return false;
  if (name === '@geowealth/e2e-tooling') return false;
  return true;
}

/**
 * Build the matrix from a ChangedPackagesResult.
 */
export function buildMatrix(
  changed: ChangedPackagesResult,
  mode: MatrixMode,
  workspaceRoot: string = WORKSPACE_ROOT_DEFAULT
): MatrixOutput {
  const { byName } = buildPackageGraph(workspaceRoot);
  const environments = mode === 'pr-gate' ? PR_GATE_ENVIRONMENTS : NIGHTLY_ENVIRONMENTS;

  const filtered = changed.packages.filter(isMatrixPackage);
  const include: MatrixJob[] = [];
  for (const pkgName of filtered) {
    const node = byName.get(pkgName);
    if (!node) continue;
    for (const env of environments) {
      include.push({
        package: pkgName,
        packageDir: node.relDir,
        environment: env,
      });
    }
  }

  return {
    include,
    mode,
    count: include.length,
    fullFallback: changed.fullFallback,
  };
}

interface CliOptions {
  mode: MatrixMode;
  /** Optional pre-computed input JSON path; if absent, derive via git. */
  input?: string;
  base: string;
  head: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { mode: 'pr-gate', base: 'origin/master', head: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`ci-matrix: ${a} requires a value`);
      return v;
    };
    if (a === '--mode') {
      const m = next();
      if (m !== 'pr-gate' && m !== 'nightly') {
        throw new Error(`ci-matrix: --mode must be pr-gate or nightly`);
      }
      opts.mode = m;
    } else if (a === '--input') {
      opts.input = next();
    } else if (a === '--base') {
      opts.base = next();
    } else if (a === '--head') {
      opts.head = next();
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: npm run ci-matrix -- [options]
  --mode <pr-gate|nightly>  CI mode (default: pr-gate)
  --input <path>            Path to a pre-computed changed-packages JSON
                            (if absent, runs git diff)
  --base <ref>              Git ref to diff against (default: origin/master)
  --head <ref>              Git ref to diff to     (default: HEAD)
  --help                    This message

Output: GitHub Actions strategy.matrix JSON on stdout.`);
      process.exit(0);
    } else {
      throw new Error(`ci-matrix: unknown flag ${a}`);
    }
  }
  return opts;
}

function main(): number {
  const opts = parseArgs(process.argv.slice(2));

  let changed: ChangedPackagesResult;
  if (opts.input) {
    const raw = fs.readFileSync(opts.input, 'utf8');
    changed = JSON.parse(raw) as ChangedPackagesResult;
  } else {
    const files = gitChangedFiles(opts.base, opts.head);
    changed = computeChangedPackages(files);
  }

  const matrix = buildMatrix(changed, opts.mode);
  process.stdout.write(JSON.stringify(matrix, null, 2) + '\n');
  return 0;
}

const invokedAsScript =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedAsScript) {
  process.exit(main());
}
