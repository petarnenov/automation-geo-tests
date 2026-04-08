#!/usr/bin/env node
// @ts-check
/**
 * Generates fixme-marked Playwright spec files for the Pepi cases that are not
 * yet implemented end-to-end. Each generated spec carries the case title, refs,
 * preconds, and steps as a header comment so the implementor has full context
 * inside the file. The body uses test.fixme() so the test is grep-able under
 * @pepi but does not actually execute (and therefore does not produce a result
 * the TestRail reporter would post).
 *
 * Run once: `node scripts/scaffold-pepi-specs.js`
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DETAILS_DIR = '/tmp/c_details';

const GROUPS = [
  {
    dir: 'tests/bucket-exclusions',
    blockReason:
      'Needs the Bucket Exclusions xlsx template + sample HH/Client/Account test data, and confirmation of the Platform One upload route.',
    cases: [25789, 25790, 25791, 25792, 25793],
  },
  {
    dir: 'tests/bucket-exclusions',
    blockReason:
      'Upload mechanics happy paths and full-bucket coverage for Billing Bucket Exclusions. Implementable via the existing helper plus a fixture variant per case.',
    cases: [25363, 25364, 25377, 25381],
  },
  {
    dir: 'tests/bucket-exclusions/validation',
    blockReason:
      'Negative validation tests for the Billing Bucket Exclusions upload. Each case requires a deliberately broken fixture + an assertion on the error message text.',
    cases: [25378, 25379, 25380],
  },
  {
    dir: 'tests/unmanaged-assets',
    blockReason:
      'Upload mechanics happy paths for Unmanaged Assets Exclusions (drag&drop, file explorer). Implementable via the existing helper.',
    cases: [25441, 25445],
  },
  {
    dir: 'tests/unmanaged-assets/validation',
    blockReason:
      'Negative validation tests for the Unmanaged Assets Exclusions upload. Each case requires a deliberately broken fixture + an assertion on the error message text.',
    cases: [25446, 25447, 25448, 25449, 25450, 25451],
  },
  {
    dir: 'tests/platform-one/merge-prospect',
    blockReason:
      'Needs Platform One Merge Prospect UI walkthrough (Manage Contacts route, prospect/client picker), test prospect/client pairs per firm, and the MERGE PROSPECT permission flag.',
    cases: [26057, 26058, 26059, 26060, 26082, 26083, 26084, 26085],
  },
  {
    dir: 'tests/platform-one/auto-link',
    blockReason:
      'Needs the Site 1 admin user creation flow, the User Management filter UI, and a way to provision/teardown a fresh email per run (linking is one-shot).',
    cases: [26077, 26078, 26079, 26080, 26093, 26094, 26100],
  },
];

function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[\]\(.*?\)/g, '[img]')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrap(text, width = 90) {
  if (!text) return [''];
  const out = [];
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > width) {
        out.push(line);
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function buildHeader(c, blockReason) {
  const lines = [];
  lines.push('// @ts-check');
  lines.push('/**');
  lines.push(` * TestRail C${c.id} — ${stripHtml(c.title)}`);
  lines.push(` *`);
  lines.push(
    ` * Source: https://testrail.geowealth.com/index.php?/cases/view/${c.id} (Run 175, label Pepi)`
  );
  if (c.refs) lines.push(` * Refs:   ${c.refs}`);
  lines.push(` *`);

  if (c.custom_preconds) {
    lines.push(' * Preconditions:');
    for (const w of wrap(stripHtml(c.custom_preconds))) lines.push(` *   ${w}`);
    lines.push(' *');
  }

  if (c.custom_steps_separated && c.custom_steps_separated.length > 0) {
    lines.push(' * Steps:');
    c.custom_steps_separated.forEach((s, i) => {
      const content = stripHtml(s.content);
      const expected = stripHtml(s.expected);
      lines.push(` *  ${i + 1}. ${content || '(empty)'}`);
      if (expected) lines.push(` *     → ${expected}`);
    });
    lines.push(' *');
  }

  if (c.custom_summary) {
    lines.push(' * Summary:');
    for (const w of wrap(stripHtml(c.custom_summary))) lines.push(` *   ${w}`);
    lines.push(' *');
  }

  lines.push(' * IMPLEMENTATION STATUS: scaffolded only — test.fixme() until blockers are resolved.');
  lines.push(' * Blockers:');
  for (const w of wrap(blockReason)) lines.push(` *   ${w}`);
  lines.push(' */');
  return lines.join('\n');
}

function buildBody(c) {
  const title = stripHtml(c.title)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[`\\]/g, '');
  return `
const { test } = require('@playwright/test');

test('@pepi C${c.id} ${title.replace(/'/g, "\\'")}', async () => {
  test.fixme(true, 'Scaffold only — see header comment for blockers.');
});
`;
}

let scaffolded = 0;
let skipped = 0;

for (const group of GROUPS) {
  const outDir = path.join(ROOT, group.dir);
  fs.mkdirSync(outDir, { recursive: true });

  for (const id of group.cases) {
    const detailPath = path.join(DETAILS_DIR, `${id}.json`);
    if (!fs.existsSync(detailPath)) {
      console.warn(`! ${id}: missing details at ${detailPath}, skipping`);
      skipped++;
      continue;
    }
    const c = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
    const filePath = path.join(outDir, `C${id}.spec.js`);
    if (fs.existsSync(filePath)) {
      console.log(`= C${id} (already exists, leaving alone)`);
      skipped++;
      continue;
    }
    const content = buildHeader(c, group.blockReason) + buildBody(c);
    fs.writeFileSync(filePath, content);
    console.log(`+ ${path.relative(ROOT, filePath)}`);
    scaffolded++;
  }
}

console.log(`\nDone: ${scaffolded} scaffolded, ${skipped} skipped.`);
