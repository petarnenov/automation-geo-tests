/**
 * `changed-packages` — affected-package detection for the PR gate.
 *
 * Algorithm (per OFFICIAL-FRAMEWORK-PROPOSAL.md v1.2 Section 6.3):
 *
 *   1. Compute the changed file set: git diff --name-only BASE_SHA HEAD.
 *   2. Map each changed file to its owning workspace package by walking
 *      up to the nearest package.json. Files outside packages/ (root
 *      config, workflows, docs/adr, tooling templates) trigger the
 *      "all packages" fallback because their effect on dependents is
 *      hard to bound.
 *   3. Build the workspace dependency graph by reading every
 *      packages/<pkg>/package.json's dependencies and devDependencies
 *      for `workspace:*` references.
 *   4. Compute the transitive closure of dependents for each directly-
 *      affected package.
 *   5. Emit JSON: {"packages": ["@geowealth/...", ...], "fullFallback": false}.
 *
 * The CI matrix consumer (ci-matrix.ts) reads this JSON and produces
 * the per-shard job spec for the PR gate.
 *
 * Phase 1.4. Wired to:
 *   - `npm run changed-packages` (with optional `--base <sha>` flag).
 *   - `scripts/changed-packages.sh` (CI shell wrapper, Phase 1.8).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// packages/tooling/src → packages/tooling → packages → workspace root
const WORKSPACE_ROOT_DEFAULT = path.resolve(__dirname, '..', '..', '..');

export interface ChangedPackagesResult {
  /** Sorted list of affected workspace package names. */
  readonly packages: readonly string[];
  /** True iff a full-workspace fallback was triggered. */
  readonly fullFallback: boolean;
  /** Optional reason for the fallback, for human-readable output. */
  readonly fallbackReason?: string;
}

interface PackageNode {
  /** Package name (e.g. `@geowealth/e2e-framework`). */
  readonly name: string;
  /** Absolute path of the package directory. */
  readonly absDir: string;
  /** Path of the package directory relative to workspace root. */
  readonly relDir: string;
  /** workspace:* dependency names (both deps + devDeps). */
  readonly workspaceDeps: ReadonlySet<string>;
}

/**
 * Read every `packages/<pkg>/package.json` and the workspace root, return
 * a map of package-name to PackageNode plus a path-prefix index for fast
 * file → package mapping.
 */
export function buildPackageGraph(workspaceRoot: string = WORKSPACE_ROOT_DEFAULT): {
  byName: Map<string, PackageNode>;
  byPathPrefix: Array<{ prefix: string; name: string }>;
} {
  const byName = new Map<string, PackageNode>();
  const byPathPrefix: Array<{ prefix: string; name: string }> = [];

  const packagesDir = path.join(workspaceRoot, 'packages');
  if (!fs.existsSync(packagesDir)) {
    throw new Error(`changed-packages: no packages/ directory at ${packagesDir}`);
  }

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absDir = path.join(packagesDir, entry.name);
    const pkgPath = path.join(absDir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;

    const raw = fs.readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (!parsed.name) continue;

    const workspaceDeps = new Set<string>();
    const collect = (deps?: Record<string, string>): void => {
      if (!deps) return;
      for (const [name, range] of Object.entries(deps)) {
        if (range.startsWith('workspace:') || range === '*') {
          workspaceDeps.add(name);
        }
      }
    };
    collect(parsed.dependencies);
    collect(parsed.devDependencies);

    const node: PackageNode = {
      name: parsed.name,
      absDir,
      relDir: `packages/${entry.name}`,
      workspaceDeps,
    };
    byName.set(parsed.name, node);
    byPathPrefix.push({ prefix: `packages/${entry.name}/`, name: parsed.name });
  }

  // Sort by descending prefix length so the longest match wins (defensive,
  // though packages/* directories cannot nest in this monorepo).
  byPathPrefix.sort((a, b) => b.prefix.length - a.prefix.length);

  return { byName, byPathPrefix };
}

/**
 * Compute the inverse dependency graph: for each package, the set of
 * packages that depend on it (directly or transitively).
 */
export function buildDependentClosure(
  byName: Map<string, PackageNode>
): Map<string, Set<string>> {
  // Direct dependents: pkg → { all pkgs that import it }.
  const direct = new Map<string, Set<string>>();
  for (const [name] of byName) direct.set(name, new Set());
  for (const [consumer, node] of byName) {
    for (const dep of node.workspaceDeps) {
      const set = direct.get(dep);
      if (set) set.add(consumer);
    }
  }

  // Transitive dependents via BFS from each package.
  const transitive = new Map<string, Set<string>>();
  for (const [name] of byName) {
    const visited = new Set<string>();
    const queue = [name];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const consumers = direct.get(cur);
      if (!consumers) continue;
      for (const c of consumers) {
        if (visited.has(c)) continue;
        visited.add(c);
        queue.push(c);
      }
    }
    transitive.set(name, visited);
  }
  return transitive;
}

/**
 * Map a changed file (path relative to workspace root) to its owning
 * workspace package, or null if the file is outside packages/.
 */
export function mapFileToPackage(
  file: string,
  byPathPrefix: Array<{ prefix: string; name: string }>
): string | null {
  for (const { prefix, name } of byPathPrefix) {
    if (file === prefix.replace(/\/$/, '') || file.startsWith(prefix)) {
      return name;
    }
  }
  return null;
}

/**
 * Run `git diff --name-only BASE..HEAD` to compute the changed file
 * list. Returns an empty array if BASE === HEAD.
 *
 * @param base Git ref to diff against (default: `origin/master`).
 * @param head Git ref to diff to (default: `HEAD`).
 * @param workspaceRoot Working directory for the git command.
 */
export function gitChangedFiles(
  base: string,
  head: string = 'HEAD',
  workspaceRoot: string = WORKSPACE_ROOT_DEFAULT
): string[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      'git',
      ['diff', '--name-only', `${base}...${head}`],
      { cwd: workspaceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    throw new Error(
      `changed-packages: git diff failed (base=${base}, head=${head}): ` +
        (e instanceof Error ? e.message : String(e)),
      { cause: e }
    );
  }
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Pure function: given a list of changed files and a workspace root,
 * return the affected-package set. Used by both the CLI entry point and
 * the unit tests.
 */
export function computeChangedPackages(
  changedFiles: readonly string[],
  workspaceRoot: string = WORKSPACE_ROOT_DEFAULT
): ChangedPackagesResult {
  const { byName, byPathPrefix } = buildPackageGraph(workspaceRoot);
  const closure = buildDependentClosure(byName);

  if (changedFiles.length === 0) {
    return { packages: [], fullFallback: false };
  }

  const directlyAffected = new Set<string>();
  let fullFallback = false;
  let fallbackReason: string | undefined;

  for (const file of changedFiles) {
    const owner = mapFileToPackage(file, byPathPrefix);
    if (owner) {
      directlyAffected.add(owner);
    } else {
      // Files outside packages/ are hard to bound — workspace root config,
      // CI workflows, docs, tooling templates that affect generation.
      // Trigger the "all packages" fallback.
      fullFallback = true;
      fallbackReason = `file outside packages/: ${file}`;
      break;
    }
  }

  if (fullFallback) {
    const allNames = [...byName.keys()].sort();
    return { packages: allNames, fullFallback: true, fallbackReason };
  }

  // Add transitive consumers.
  const all = new Set<string>(directlyAffected);
  for (const direct of directlyAffected) {
    const consumers = closure.get(direct);
    if (consumers) {
      for (const c of consumers) all.add(c);
    }
  }

  return {
    packages: [...all].sort(),
    fullFallback: false,
  };
}

interface CliOptions {
  base: string;
  head: string;
  format: 'json' | 'text';
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { base: 'origin/master', head: 'HEAD', format: 'json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`changed-packages: ${a} requires a value`);
      return v;
    };
    if (a === '--base') opts.base = next();
    else if (a === '--head') opts.head = next();
    else if (a === '--format') {
      const f = next();
      if (f !== 'json' && f !== 'text') throw new Error(`changed-packages: --format must be json or text`);
      opts.format = f;
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: npm run changed-packages -- [options]
  --base <ref>     Git ref to diff against (default: origin/master)
  --head <ref>     Git ref to diff to     (default: HEAD)
  --format <fmt>   Output format: json (default) or text
  --help           This message`);
      process.exit(0);
    } else {
      throw new Error(`changed-packages: unknown flag ${a}`);
    }
  }
  return opts;
}

function main(): number {
  const opts = parseArgs(process.argv.slice(2));
  const changed = gitChangedFiles(opts.base, opts.head);
  const result = computeChangedPackages(changed);

  if (opts.format === 'json') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(`changed-packages: base=${opts.base} head=${opts.head}`);
    console.log(`changed-packages: ${changed.length} file(s) changed`);
    if (result.fullFallback) {
      console.log(`changed-packages: FULL FALLBACK (${result.fallbackReason})`);
    }
    console.log(`changed-packages: ${result.packages.length} affected package(s):`);
    for (const p of result.packages) console.log(`  - ${p}`);
  }
  return 0;
}

const invokedAsScript =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedAsScript) {
  process.exit(main());
}
