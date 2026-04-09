#!/usr/bin/env -S npx tsx
/**
 * Verify that the bootstrap `tests-billing-servicing` package on disk
 * is byte-identical to what the substitute function would generate from
 * the templates today.
 *
 * Phase 0 Step 0.G.4. Eliminates D-34's drift problem on day one: if
 * the manually-expanded bootstrap diverges from the templates (or if
 * the future Phase 1 scaffold script's logic diverges from the
 * templates), this check fails CI before merge.
 *
 * Usage:
 *   node packages/tooling/scripts/verify-bootstrap-vs-templates.ts
 *
 * Exit codes:
 *   0 — every file matches
 *   1 — at least one file differs (diff printed to stderr)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { substitute, type SubstituteVars } from '../src/substitute.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEMPLATES_ROOT = path.resolve(__dirname, '..', 'templates', 'team');

const SLUG = 'billing-servicing';
const VARS: SubstituteVars = {
  slug: SLUG,
  name: 'Billing & Servicing',
  owner: '@TODO-billing-servicing-qa',
  confluence: '',
  testrail_section: '',
};

const targetRoot = path.join(WORKSPACE_ROOT, 'packages', `tests-${SLUG}`);

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

function targetPathFor(templatePath: string): string {
  const rel = path.relative(TEMPLATES_ROOT, templatePath);
  const stripped = rel.endsWith('.tpl') ? rel.slice(0, -'.tpl'.length) : rel;
  return path.join(targetRoot, stripped);
}

function main(): number {
  const templates = walkTemplateTree(TEMPLATES_ROOT).sort();
  const failures: { rel: string; reason: string }[] = [];

  for (const tpl of templates) {
    const target = targetPathFor(tpl);
    const rel = path.relative(WORKSPACE_ROOT, target);
    const source = fs.readFileSync(tpl, 'utf8');
    const expected = substitute(source, VARS);

    if (!fs.existsSync(target)) {
      failures.push({ rel, reason: 'missing on disk (template would generate it)' });
      continue;
    }
    const actual = fs.readFileSync(target, 'utf8');
    if (actual !== expected) {
      failures.push({
        rel,
        reason: `byte mismatch (template ${expected.length} bytes vs disk ${actual.length} bytes)`,
      });
    }
  }

  if (failures.length === 0) {
    console.log(
      `verify-bootstrap-vs-templates: ${templates.length} file(s) checked; all match.`
    );
    return 0;
  }

  console.error(
    `verify-bootstrap-vs-templates: ${failures.length} file(s) drift from templates:`
  );
  for (const f of failures) {
    console.error(`  ${f.rel}: ${f.reason}`);
  }
  console.error(
    '\nFix: re-run `node packages/tooling/scripts/expand-templates.ts ' +
      `--slug ${SLUG} --name "Billing & Servicing"` +
      '` and commit the result.'
  );
  return 1;
}

process.exit(main());
