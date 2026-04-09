#!/usr/bin/env -S npx tsx
/**
 * Expand the team templates into a real team package.
 *
 * Usage:
 *   node packages/tooling/scripts/expand-templates.ts \
 *     --slug billing-servicing \
 *     --name "Billing & Servicing" \
 *     --owner "@geowealth/billing-servicing-qa"
 *
 * Phase 0 Step 0.G.3. The future Phase 1 `scaffold-team` CLI (D-26)
 * wraps this same flow and additionally mutates CODEOWNERS / migration
 * tracker / CI matrix. The substitute function and template tree are
 * shared (D-34).
 *
 * The script intentionally only WRITES the package files. CODEOWNERS /
 * tracker / CI matrix updates are done manually in Phase 0 — the CLI
 * automates them in Phase 1.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { substitute, type SubstituteVars } from '../src/substitute.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// packages/tooling/scripts → packages/tooling → packages → workspace root
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEMPLATES_ROOT = path.resolve(__dirname, '..', 'templates', 'team');

interface ExpandOptions {
  slug: string;
  name: string;
  owner?: string;
  confluence?: string;
  testrail_section?: string;
  /** If true, write to disk; if false, dry-run. */
  apply: boolean;
}

function parseArgs(argv: string[]): ExpandOptions {
  const opts: Partial<ExpandOptions> & { apply: boolean } = { apply: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`expand-templates: ${a} requires a value`);
      return v;
    };
    if (a === '--slug') opts.slug = next();
    else if (a === '--name') opts.name = next();
    else if (a === '--owner') opts.owner = next();
    else if (a === '--confluence') opts.confluence = next();
    else if (a === '--testrail-section') opts.testrail_section = next();
    else if (a === '--dry-run') opts.apply = false;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`expand-templates: unknown flag ${a}`);
    }
  }
  if (!opts.slug) throw new Error('expand-templates: --slug is required');
  if (!opts.name) throw new Error('expand-templates: --name is required');
  if (!/^[a-z][a-z0-9-]+$/.test(opts.slug)) {
    throw new Error(
      `expand-templates: --slug "${opts.slug}" must match /^[a-z][a-z0-9-]+$/`
    );
  }
  return opts as ExpandOptions;
}

function printHelp(): void {
  console.log(`Usage: node packages/tooling/scripts/expand-templates.ts \\
  --slug <kebab-slug>      (required, e.g. billing-servicing)
  --name "<display name>"  (required, e.g. "Billing & Servicing")
  --owner <handle>         (optional, e.g. @geowealth/billing-servicing-qa)
  --confluence <url>       (optional)
  --testrail-section <id>  (optional)
  --dry-run                (print planned files, do not write)
  --help                   (this message)`);
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
  return out;
}

function targetPathFor(templatePath: string, slug: string): string {
  // packages/tooling/templates/team/<rel>.tpl  →  packages/tests-<slug>/<rel>
  const rel = path.relative(TEMPLATES_ROOT, templatePath);
  const stripped = rel.endsWith('.tpl') ? rel.slice(0, -'.tpl'.length) : rel;
  return path.join(WORKSPACE_ROOT, 'packages', `tests-${slug}`, stripped);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const vars: SubstituteVars = {
    slug: opts.slug,
    name: opts.name,
    owner: opts.owner ?? '@TODO-team-qa',
    confluence: opts.confluence ?? '',
    testrail_section: opts.testrail_section ?? '',
  };

  const targetRoot = path.join(WORKSPACE_ROOT, 'packages', `tests-${opts.slug}`);
  const templates = walkTemplateTree(TEMPLATES_ROOT).sort();

  console.log(`expand-templates: target = ${path.relative(WORKSPACE_ROOT, targetRoot)}`);
  console.log(`expand-templates: ${templates.length} template file(s)`);

  for (const tpl of templates) {
    const target = targetPathFor(tpl, opts.slug);
    const rel = path.relative(WORKSPACE_ROOT, target);
    const source = fs.readFileSync(tpl, 'utf8');
    const expanded = substitute(source, vars);
    if (opts.apply) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, expanded, 'utf8');
      console.log(`  write  ${rel}`);
    } else {
      console.log(`  would-write  ${rel}  (${expanded.length} bytes)`);
    }
  }

  console.log(opts.apply ? 'expand-templates: done.' : 'expand-templates: dry run, nothing written.');
}

try {
  main();
} catch (err) {
  console.error(`expand-templates: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
