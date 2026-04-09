/**
 * `scaffold-team` — the Phase 1 first-class scaffold CLI.
 *
 * Wraps Phase 0's `expand-templates.ts` and additionally mutates:
 *   1. CODEOWNERS — appends a row inside the scaffold-managed section.
 *   2. docs/migration-tracker.md — appends a section header for the new team.
 *   3. .eslintrc.legacy-areas.json — adds the new path to the live (non-legacy) areas list (no-op today; reserved for the Phase 2 freeze enforcement).
 *   4. .github/workflows/pr-gate.yml + nightly.yml — appends the new package to the CI matrix `package` axis (no-op today — workflows land in a later Phase 1 commit; the CLI prints what it WOULD do and continues).
 *   5. docs/CHANGELOG.md — appends a one-line "Onboarded" entry under [Unreleased].
 *
 * The substitute function and template tree are shared with Phase 0's
 * `expand-templates.ts` (D-34, no drift).
 *
 * Per Decision D-26: this CLI is a Phase 1 first-class deliverable with a
 * 30-minute productivity SLA. The CLI itself runs in seconds; the SLA
 * covers the developer experience from `npm run scaffold:team` to a
 * green smoke spec running locally.
 *
 * Usage:
 *   npm run scaffold:team -- --slug reporting --name "Reporting" \
 *     --owner "@geowealth/reporting-qa" --confluence "https://..."
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { substitute, type SubstituteVars } from './substitute.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// packages/tooling/src → packages/tooling → packages → workspace root
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEMPLATES_ROOT = path.resolve(__dirname, '..', 'templates', 'team');

// CODEOWNERS section markers (per Section 6.11)
const CODEOWNERS_BEGIN = '# === BEGIN scaffold-managed: team packages ===';
const CODEOWNERS_END = '# === END scaffold-managed ===';

interface ScaffoldOptions {
  slug: string;
  name: string;
  owner: string;
  confluence?: string;
  testrail_section?: string;
  apply: boolean;
  force: boolean;
}

class ScaffoldError extends Error {}

function parseArgs(argv: string[]): ScaffoldOptions {
  const opts: Partial<ScaffoldOptions> & { apply: boolean; force: boolean } = {
    apply: true,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new ScaffoldError(`scaffold-team: ${a} requires a value`);
      return v;
    };
    if (a === '--slug') opts.slug = next();
    else if (a === '--name') opts.name = next();
    else if (a === '--owner') opts.owner = next();
    else if (a === '--confluence') opts.confluence = next();
    else if (a === '--testrail-section') opts.testrail_section = next();
    else if (a === '--dry-run') opts.apply = false;
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new ScaffoldError(`scaffold-team: unknown flag ${a}`);
    }
  }
  if (!opts.slug) throw new ScaffoldError('scaffold-team: --slug is required');
  if (!opts.name) throw new ScaffoldError('scaffold-team: --name is required');
  if (!opts.owner) throw new ScaffoldError('scaffold-team: --owner is required');
  if (!/^[a-z][a-z0-9-]+$/.test(opts.slug)) {
    throw new ScaffoldError(
      `scaffold-team: --slug "${opts.slug}" must match /^[a-z][a-z0-9-]+$/`
    );
  }
  return opts as ScaffoldOptions;
}

function printHelp(): void {
  console.log(`Usage: npm run scaffold:team -- \\
  --slug <kebab-slug>      (required, e.g. reporting)
  --name "<display name>"  (required, e.g. "Reporting")
  --owner <handle>         (required, e.g. @geowealth/reporting-qa)
  --confluence <url>       (optional)
  --testrail-section <id>  (optional)
  --dry-run                (print planned changes; do not write)
  --force                  (overwrite an existing package — refused otherwise)
  --help                   (this message)

The CLI generates a fully working tests-<slug>/ package and registers
it everywhere it needs to be registered (CODEOWNERS, migration tracker,
CHANGELOG). It is the Phase 1 wrapper around Phase 0's expand-templates.ts;
the substitute function and template tree are shared (D-34, no drift).`);
}

function walkTemplateTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function targetPathFor(templatePath: string, slug: string): string {
  const rel = path.relative(TEMPLATES_ROOT, templatePath);
  const stripped = rel.endsWith('.tpl') ? rel.slice(0, -'.tpl'.length) : rel;
  return path.join(WORKSPACE_ROOT, 'packages', `tests-${slug}`, stripped);
}

interface PlannedChange {
  kind: 'write' | 'mutate-codeowners' | 'mutate-tracker' | 'mutate-changelog';
  path: string;
  bytes?: number;
  detail?: string;
}

function planPackageWrites(opts: ScaffoldOptions, vars: SubstituteVars): PlannedChange[] {
  const targetRoot = path.join(WORKSPACE_ROOT, 'packages', `tests-${opts.slug}`);
  if (fs.existsSync(targetRoot) && !opts.force) {
    throw new ScaffoldError(
      `scaffold-team: target ${path.relative(WORKSPACE_ROOT, targetRoot)} already exists. Use --force to overwrite.`
    );
  }
  const templates = walkTemplateTree(TEMPLATES_ROOT);
  return templates.map((tpl) => {
    const target = targetPathFor(tpl, opts.slug);
    const source = fs.readFileSync(tpl, 'utf8');
    const expanded = substitute(source, vars);
    return { kind: 'write', path: target, bytes: expanded.length };
  });
}

function applyPackageWrites(plans: PlannedChange[], vars: SubstituteVars): void {
  for (const plan of plans) {
    if (plan.kind !== 'write') continue;
    const tplRel = path.relative(
      WORKSPACE_ROOT,
      path.resolve(TEMPLATES_ROOT, path.relative(path.join(WORKSPACE_ROOT, 'packages', `tests-${vars.slug}`), plan.path)) + '.tpl'
    );
    const tpl = path.join(WORKSPACE_ROOT, tplRel);
    const source = fs.readFileSync(tpl, 'utf8');
    const expanded = substitute(source, vars);
    fs.mkdirSync(path.dirname(plan.path), { recursive: true });
    fs.writeFileSync(plan.path, expanded, 'utf8');
  }
}

function mutateCodeOwners(opts: ScaffoldOptions): PlannedChange {
  const codeownersPath = path.join(WORKSPACE_ROOT, 'CODEOWNERS');
  const detail = `/packages/tests-${opts.slug}/  ${opts.owner} @TODO-qa-leads`;
  return {
    kind: 'mutate-codeowners',
    path: codeownersPath,
    detail,
  };
}

function applyCodeOwners(opts: ScaffoldOptions): void {
  const codeownersPath = path.join(WORKSPACE_ROOT, 'CODEOWNERS');
  const original = fs.readFileSync(codeownersPath, 'utf8');
  const beginIdx = original.indexOf(CODEOWNERS_BEGIN);
  const endIdx = original.indexOf(CODEOWNERS_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new ScaffoldError(
      `scaffold-team: CODEOWNERS is missing the scaffold-managed section markers. ` +
        `Expected "${CODEOWNERS_BEGIN}" and "${CODEOWNERS_END}".`
    );
  }
  const before = original.slice(0, beginIdx + CODEOWNERS_BEGIN.length);
  const middle = original.slice(beginIdx + CODEOWNERS_BEGIN.length, endIdx);
  const after = original.slice(endIdx);

  const newRow = `\n/packages/tests-${opts.slug}/  ${opts.owner} @TODO-qa-leads`;
  // Idempotency: skip if the row already exists.
  if (middle.includes(`/packages/tests-${opts.slug}/`)) {
    return;
  }
  // Trim trailing whitespace inside the section, then append the new row,
  // then ensure exactly one newline before the END marker.
  const trimmedMiddle = middle.replace(/\s+$/, '');
  const next = `${before}${trimmedMiddle}${newRow}\n${after}`;
  fs.writeFileSync(codeownersPath, next, 'utf8');
}

function mutateTracker(opts: ScaffoldOptions): PlannedChange {
  const trackerPath = path.join(WORKSPACE_ROOT, 'docs', 'migration-tracker.md');
  return {
    kind: 'mutate-tracker',
    path: trackerPath,
    detail: `### ${opts.name} — empty package (created by scaffold)`,
  };
}

function applyTracker(opts: ScaffoldOptions): void {
  const trackerPath = path.join(WORKSPACE_ROOT, 'docs', 'migration-tracker.md');
  const original = fs.readFileSync(trackerPath, 'utf8');
  const headerPattern = `### ${opts.name} —`;
  if (original.includes(headerPattern)) return; // idempotent
  const insertion =
    `\n### ${opts.name} — empty package (created by scaffold)\n\n` +
    `_Created by \`scaffold-team\` on ${new Date().toISOString().slice(0, 10)}._ No specs yet; team begins authoring tests after Phase 5.\n`;
  // Insert before the "Other team areas" section if it exists, else append.
  const otherIdx = original.indexOf('### Other team areas');
  let next: string;
  if (otherIdx === -1) {
    next = original.trimEnd() + '\n' + insertion;
  } else {
    next = original.slice(0, otherIdx) + insertion + '\n' + original.slice(otherIdx);
  }
  fs.writeFileSync(trackerPath, next, 'utf8');
}

function mutateChangelog(opts: ScaffoldOptions): PlannedChange {
  const changelogPath = path.join(WORKSPACE_ROOT, 'docs', 'CHANGELOG.md');
  return {
    kind: 'mutate-changelog',
    path: changelogPath,
    detail: `- Onboarded team package @geowealth/tests-${opts.slug} (scaffold)`,
  };
}

function applyChangelog(opts: ScaffoldOptions): void {
  const changelogPath = path.join(WORKSPACE_ROOT, 'docs', 'CHANGELOG.md');
  const original = fs.readFileSync(changelogPath, 'utf8');
  const line = `- Onboarded team package \`@geowealth/tests-${opts.slug}\` (scaffold).`;
  if (original.includes(line)) return; // idempotent
  // Insert under [Unreleased] → ### Added (or create the subsection)
  const unreleasedIdx = original.indexOf('## [Unreleased]');
  if (unreleasedIdx === -1) {
    // Just append a new top-level section.
    const next = `${original.trimEnd()}\n\n## [Unreleased]\n\n### Added\n\n${line}\n`;
    fs.writeFileSync(changelogPath, next, 'utf8');
    return;
  }
  // Find the next "##" after [Unreleased] to bound the section.
  const nextSectionIdx = original.indexOf('\n## ', unreleasedIdx + '## [Unreleased]'.length);
  const before = original.slice(0, nextSectionIdx === -1 ? original.length : nextSectionIdx);
  const after = nextSectionIdx === -1 ? '' : original.slice(nextSectionIdx);
  // Append the line at the end of the [Unreleased] section, before any
  // trailing whitespace.
  const trimmedBefore = before.replace(/\s+$/, '');
  const next = `${trimmedBefore}\n${line}\n${after}`;
  fs.writeFileSync(changelogPath, next, 'utf8');
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const vars: SubstituteVars = {
    slug: opts.slug,
    name: opts.name,
    owner: opts.owner,
    confluence: opts.confluence ?? '',
    testrail_section: opts.testrail_section ?? '',
  };

  const targetRoot = path.join(WORKSPACE_ROOT, 'packages', `tests-${opts.slug}`);
  console.log(
    `scaffold-team: target = ${path.relative(WORKSPACE_ROOT, targetRoot)} ` +
      `(${opts.apply ? 'APPLY' : 'DRY-RUN'})`
  );

  const plans: PlannedChange[] = [
    ...planPackageWrites(opts, vars),
    mutateCodeOwners(opts),
    mutateTracker(opts),
    mutateChangelog(opts),
  ];

  // Print plan first.
  for (const p of plans) {
    if (p.kind === 'write') {
      console.log(`  write          ${path.relative(WORKSPACE_ROOT, p.path)}  (${p.bytes} bytes)`);
    } else if (p.kind === 'mutate-codeowners') {
      console.log(`  mutate-codeowners  ${path.relative(WORKSPACE_ROOT, p.path)}: ${p.detail}`);
    } else if (p.kind === 'mutate-tracker') {
      console.log(`  mutate-tracker     ${path.relative(WORKSPACE_ROOT, p.path)}: ${p.detail}`);
    } else if (p.kind === 'mutate-changelog') {
      console.log(`  mutate-changelog   ${path.relative(WORKSPACE_ROOT, p.path)}: ${p.detail}`);
    }
  }

  if (!opts.apply) {
    console.log('scaffold-team: dry run, nothing written.');
    return;
  }

  // Apply in order: writes first, then mutations.
  applyPackageWrites(plans.filter((p) => p.kind === 'write'), vars);
  applyCodeOwners(opts);
  applyTracker(opts);
  applyChangelog(opts);

  console.log('scaffold-team: done.');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Run \`npm install\` at the workspace root to register the new package.`);
  console.log(`  2. Run the smoke spec to validate:`);
  console.log(`       cd packages/tests-${opts.slug} && \\`);
  console.log(`       TESTRAIL_REPORT_RESULTS=0 npx playwright test --grep @smoke`);
  console.log(`  3. The package is owned by ${opts.owner}; replace @TODO-qa-leads in CODEOWNERS when known.`);
}

try {
  main();
} catch (err) {
  console.error(`scaffold-team: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
