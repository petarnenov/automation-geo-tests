/**
 * `scaffold-doctor` — drift detector for an existing team package.
 *
 * Re-runs the substitute function against the templates with the existing
 * package's vars and reports the diff. Drift is informational, not a
 * failure (per Section 4.2.5) — but the report is the input to a
 * coordinated bring-up-to-date PR when the framework or templates evolve.
 *
 * Usage:
 *   npm run scaffold:doctor -- --slug reporting
 *
 * Phase 1 minimal implementation: walks the existing package, re-runs
 * the templates with derived vars, and prints which files differ. A
 * future iteration can add a `--fix` flag that re-applies the templates,
 * but for now the report is the deliverable.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { substitute, type SubstituteVars } from './substitute.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEMPLATES_ROOT = path.resolve(__dirname, '..', 'templates', 'team');

interface DoctorOptions {
  slug: string;
}

function parseArgs(argv: string[]): DoctorOptions {
  let slug: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug') slug = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: npm run scaffold:doctor -- --slug <kebab-slug>');
      process.exit(0);
    } else throw new Error(`scaffold-doctor: unknown flag ${a}`);
  }
  if (!slug) throw new Error('scaffold-doctor: --slug is required');
  return { slug };
}

/**
 * Derive the vars from the existing package's package.json + README.
 * Phase 1 minimal implementation: only `slug` is reliable; `name`,
 * `owner`, etc. are extracted on a best-effort basis. A future iteration
 * can read the scaffold-managed CODEOWNERS row to recover `owner`
 * exactly.
 */
function deriveVars(slug: string): SubstituteVars {
  const pkgPath = path.join(WORKSPACE_ROOT, 'packages', `tests-${slug}`, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`scaffold-doctor: tests-${slug} not found at ${pkgPath}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { description?: string };
  // The package.json template puts the team name in description; recover it.
  const nameMatch = pkg.description?.match(/tests for the (.+) team\./i);
  const name = nameMatch?.[1] ?? slug;
  return {
    slug,
    name,
    owner: '@TODO-recovered',
    confluence: '',
    testrail_section: '',
  };
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

function main(): number {
  const opts = parseArgs(process.argv.slice(2));
  const vars = deriveVars(opts.slug);
  const templates = walkTemplateTree(TEMPLATES_ROOT);
  const drifts: { rel: string; reason: string }[] = [];

  for (const tpl of templates) {
    const target = targetPathFor(tpl, opts.slug);
    const rel = path.relative(WORKSPACE_ROOT, target);
    const source = fs.readFileSync(tpl, 'utf8');
    const expected = substitute(source, vars);
    if (!fs.existsSync(target)) {
      drifts.push({ rel, reason: 'missing on disk; template would generate it' });
      continue;
    }
    const actual = fs.readFileSync(target, 'utf8');
    if (actual !== expected) {
      drifts.push({
        rel,
        reason: `byte mismatch (template ${expected.length} vs disk ${actual.length})`,
      });
    }
  }

  console.log(`scaffold-doctor: ${templates.length} template(s) checked against tests-${opts.slug}`);
  if (drifts.length === 0) {
    console.log('scaffold-doctor: no drift detected.');
    return 0;
  }
  console.log(`scaffold-doctor: ${drifts.length} file(s) drift from templates:`);
  for (const d of drifts) console.log(`  ${d.rel}: ${d.reason}`);
  console.log('');
  console.log('Drift is informational. To re-apply the templates, regenerate the package:');
  console.log(`  rm -rf packages/tests-${opts.slug}`);
  console.log(`  npm run scaffold:team -- --slug ${opts.slug} --name "<name>" --owner "<handle>"`);
  return 0; // drift is informational, not a failure
}

try {
  process.exit(main());
} catch (err) {
  console.error(`scaffold-doctor: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
