/**
 * `check-versions` — single-monorepo-version enforcement (D-27).
 *
 * Reads every `packages/<pkg>/package.json` and the workspace root
 * `package.json`, asserts that the `version` field is identical across
 * all of them, and exits non-zero with a clear error if not.
 *
 * Phase 1.3. Wired to:
 *   - `npm run check-versions` at the workspace root.
 *   - The husky pre-commit hook (Phase 1.9).
 *   - The CI lint job (Phase 1.8 GitHub workflows).
 *
 * Per the proposal Section 6.11 and Decision D-27, the monorepo follows
 * SemVer 2.0 with a single shared version across every workspace
 * package. One bump → all packages.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// packages/tooling/src → packages/tooling → packages → workspace root
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');

interface PackageInfo {
  /** Path relative to workspace root, for human-readable error output. */
  readonly relPath: string;
  /** The package's `name` field, for grouping in errors. */
  readonly name: string;
  /** The package's `version` field. */
  readonly version: string;
}

/**
 * Read a package.json file and return name + version. Throws if either
 * field is missing — every package in this monorepo MUST declare both.
 */
function readPackage(absPath: string): PackageInfo {
  const raw = fs.readFileSync(absPath, 'utf8');
  let parsed: { name?: string; version?: string };
  try {
    parsed = JSON.parse(raw) as { name?: string; version?: string };
  } catch (e) {
    throw new Error(
      `check-versions: ${path.relative(WORKSPACE_ROOT, absPath)} is not valid JSON: ` +
        (e instanceof Error ? e.message : String(e)),
      { cause: e }
    );
  }
  if (!parsed.name) {
    throw new Error(
      `check-versions: ${path.relative(WORKSPACE_ROOT, absPath)} is missing the "name" field.`
    );
  }
  if (!parsed.version) {
    throw new Error(
      `check-versions: ${path.relative(WORKSPACE_ROOT, absPath)} is missing the "version" field.`
    );
  }
  return {
    relPath: path.relative(WORKSPACE_ROOT, absPath),
    name: parsed.name,
    version: parsed.version,
  };
}

/**
 * Discover every workspace package by listing `packages/*` directories
 * with a `package.json` file. Plus the workspace root itself.
 */
export function collectPackages(workspaceRoot: string = WORKSPACE_ROOT): PackageInfo[] {
  const out: PackageInfo[] = [];

  // Workspace root.
  const rootPkg = path.join(workspaceRoot, 'package.json');
  if (!fs.existsSync(rootPkg)) {
    throw new Error(`check-versions: workspace root has no package.json at ${rootPkg}`);
  }
  out.push(readPackage(rootPkg));

  // packages/*/package.json
  const packagesDir = path.join(workspaceRoot, 'packages');
  if (!fs.existsSync(packagesDir)) {
    throw new Error(`check-versions: no packages/ directory at ${packagesDir}`);
  }
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = path.join(packagesDir, entry.name, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    out.push(readPackage(pkgPath));
  }

  return out;
}

/**
 * Group packages by version. Return a map of version → packages with
 * that version.
 */
export function groupByVersion(packages: PackageInfo[]): Map<string, PackageInfo[]> {
  const groups = new Map<string, PackageInfo[]>();
  for (const pkg of packages) {
    const existing = groups.get(pkg.version);
    if (existing) existing.push(pkg);
    else groups.set(pkg.version, [pkg]);
  }
  return groups;
}

/**
 * Check that every package has the same version. Returns null if so;
 * returns a non-empty error message describing the drift if not.
 */
export function checkVersionConsistency(packages: PackageInfo[]): string | null {
  const groups = groupByVersion(packages);
  if (groups.size <= 1) return null;

  const lines: string[] = [];
  lines.push(
    `check-versions: D-27 violation — ${groups.size} distinct versions across ${packages.length} packages.`
  );
  lines.push('');
  // Sorted for deterministic output.
  const sortedVersions = [...groups.keys()].sort();
  for (const version of sortedVersions) {
    const pkgs = groups.get(version)!;
    lines.push(`  version "${version}" (${pkgs.length} package${pkgs.length === 1 ? '' : 's'}):`);
    for (const pkg of pkgs.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`    - ${pkg.name}  (${pkg.relPath})`);
    }
  }
  lines.push('');
  lines.push(
    'Per Decision D-27, the monorepo follows a single shared version. Bump every'
  );
  lines.push(
    'package together (workspace root + every packages/*/package.json) and re-run.'
  );
  return lines.join('\n');
}

function main(): number {
  const packages = collectPackages();
  const error = checkVersionConsistency(packages);
  if (error) {
    console.error(error);
    return 1;
  }
  const version = packages[0].version;
  console.log(
    `check-versions: ${packages.length} package(s) all at version "${version}". ✓`
  );
  return 0;
}

// Only run main when executed directly, not when imported (so the unit
// test can import collectPackages / checkVersionConsistency without
// triggering a process.exit).
const invokedAsScript =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedAsScript) {
  process.exit(main());
}

export { main };
