/**
 * Unit tests for the testrail-aggregator (D-30 post-processing job).
 *
 * Phase 1.7. The HTTP POST path is exercised against the framework
 * reporter's twin in `testrail-reporter.test.ts`; here we cover the
 * pure orchestration: discovery, parsing, grouping, and arg parsing.
 *
 * Run via:
 *   npx tsx --test packages/tooling/tests/testrail-aggregator.test.ts
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildAttempts,
  discoverPackageRoots,
  findWorkspaceRoot,
  groupByRun,
  parseArgs,
  readPerPackageFiles,
  shouldPostResults,
} from '../src/testrail-aggregator.ts';

/**
 * Build a fake workspace with a marker tsconfig.base.json plus the
 * given set of package directories under packages/.
 */
function makeWorkspace(packageNames: readonly string[]): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'testrail-aggregator-'));
  fs.writeFileSync(path.join(tmp, 'tsconfig.base.json'), '{}');
  fs.mkdirSync(path.join(tmp, 'packages'));
  for (const name of packageNames) {
    fs.mkdirSync(path.join(tmp, 'packages', name));
  }
  return tmp;
}

function writePerPackageFile(
  packageRoot: string,
  payload: { runId: number; baseUrl: string; results: Array<{ case_id: number; status_id: number; comment: string; elapsed: string }> }
): void {
  const dir = path.join(packageRoot, 'test-results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'testrail-results.json'), JSON.stringify(payload));
}

describe('parseArgs', () => {
  it('returns an empty roots array when no flags are passed', () => {
    assert.deepEqual(parseArgs([]), { roots: [] });
  });

  it('collects multiple --root flags in order', () => {
    assert.deepEqual(parseArgs(['--root', 'a', '--root', 'b']), { roots: ['a', 'b'] });
  });

  it('throws when --root has no argument', () => {
    assert.throws(() => parseArgs(['--root']), /requires a directory/);
  });
});

describe('findWorkspaceRoot', () => {
  it('finds the workspace root via the tsconfig.base.json marker', () => {
    const ws = makeWorkspace([]);
    const nested = path.join(ws, 'packages', 'tests-foo', 'src');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(findWorkspaceRoot(nested), ws);
  });

  it('throws when no marker is found', () => {
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'no-marker-'));
    assert.throws(() => findWorkspaceRoot(stray), /cannot find workspace root/);
  });
});

describe('discoverPackageRoots', () => {
  it('returns framework + every tests-* dir, sorted, excluding legacy-poc and tooling', () => {
    const ws = makeWorkspace([
      'framework',
      'tooling',
      'legacy-poc',
      'tests-billing-servicing',
      'tests-platform',
      'tests-trading',
    ]);
    const roots = discoverPackageRoots(ws).map((r) => path.basename(r));
    assert.deepEqual(roots, [
      'framework',
      'tests-billing-servicing',
      'tests-platform',
      'tests-trading',
    ]);
  });

  it('returns an empty array when packages/ does not exist', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    assert.deepEqual(discoverPackageRoots(tmp), []);
  });
});

describe('readPerPackageFiles', () => {
  it('skips packages without a result file', () => {
    const ws = makeWorkspace(['tests-a', 'tests-b']);
    writePerPackageFile(path.join(ws, 'packages', 'tests-a'), {
      runId: 999,
      baseUrl: 'https://sandbox.testrail.example',
      results: [{ case_id: 1, status_id: 1, comment: 'ok', elapsed: '1s' }],
    });
    const files = readPerPackageFiles([
      path.join(ws, 'packages', 'tests-a'),
      path.join(ws, 'packages', 'tests-b'),
    ]);
    assert.equal(files.length, 1);
    assert.equal(files[0].payload.runId, 999);
  });

  it('throws on malformed JSON with the path included', () => {
    const ws = makeWorkspace(['tests-a']);
    const dir = path.join(ws, 'packages', 'tests-a', 'test-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'testrail-results.json'), '{not json');
    assert.throws(
      () => readPerPackageFiles([path.join(ws, 'packages', 'tests-a')]),
      /not valid JSON/
    );
  });

  it('throws on schema mismatch', () => {
    const ws = makeWorkspace(['tests-a']);
    const dir = path.join(ws, 'packages', 'tests-a', 'test-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'testrail-results.json'), JSON.stringify({ runId: 'not-a-number' }));
    assert.throws(
      () => readPerPackageFiles([path.join(ws, 'packages', 'tests-a')]),
      /does not match the per-package result schema/
    );
  });
});

describe('groupByRun', () => {
  it('merges results from packages targeting the same (baseUrl, runId)', () => {
    const groups = groupByRun([
      {
        packageDir: '/ws/packages/tests-a',
        payload: {
          runId: 175,
          baseUrl: 'https://sandbox',
          results: [{ case_id: 1, status_id: 1, comment: '', elapsed: '1s' }],
        },
      },
      {
        packageDir: '/ws/packages/tests-b',
        payload: {
          runId: 175,
          baseUrl: 'https://sandbox',
          results: [{ case_id: 2, status_id: 5, comment: '', elapsed: '2s' }],
        },
      },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].results.length, 2);
    assert.deepEqual(
      groups[0].sources.sort(),
      ['/ws/packages/tests-a', '/ws/packages/tests-b']
    );
  });

  it('keeps groups separate when runId or baseUrl differs', () => {
    const groups = groupByRun([
      {
        packageDir: '/ws/packages/tests-a',
        payload: {
          runId: 175,
          baseUrl: 'https://sandbox',
          results: [{ case_id: 1, status_id: 1, comment: '', elapsed: '1s' }],
        },
      },
      {
        packageDir: '/ws/packages/tests-b',
        payload: {
          runId: 200,
          baseUrl: 'https://sandbox',
          results: [{ case_id: 2, status_id: 1, comment: '', elapsed: '1s' }],
        },
      },
      {
        packageDir: '/ws/packages/tests-c',
        payload: {
          runId: 175,
          baseUrl: 'https://other-sandbox',
          results: [{ case_id: 3, status_id: 1, comment: '', elapsed: '1s' }],
        },
      },
    ]);
    assert.equal(groups.length, 3);
  });
});

describe('buildAttempts', () => {
  it('puts password before api_key (legacy lockout discovery)', () => {
    const attempts = buildAttempts({
      TESTRAIL_PASSWORD: 'pw',
      TESTRAIL_API_KEY: 'key',
    });
    assert.deepEqual(
      attempts.map((a) => a.label),
      ['password', 'api_key']
    );
  });

  it('returns an empty list when no credentials are present', () => {
    assert.deepEqual(buildAttempts({}), []);
  });
});

describe('shouldPostResults', () => {
  it('defaults to enabled', () => {
    assert.equal(shouldPostResults({}), true);
  });

  it('respects the disabled tokens', () => {
    assert.equal(shouldPostResults({ TESTRAIL_REPORT_RESULTS: '0' }), false);
    assert.equal(shouldPostResults({ TESTRAIL_REPORT_RESULTS: 'false' }), false);
    assert.equal(shouldPostResults({ TESTRAIL_REPORT_RESULTS: 'NO' }), false);
  });
});
