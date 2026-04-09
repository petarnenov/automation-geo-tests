/**
 * Unit tests for ci-matrix (Phase 1.4).
 *
 * Verifies that the matrix builder correctly cross-products affected
 * packages with the configured environment list, filters out non-test
 * packages (framework, tooling), and respects the full-fallback flag.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildMatrix } from '../src/ci-matrix.ts';

interface FakePackage {
  dir: string;
  name: string;
  workspaceDeps?: string[];
}

function makeWorkspace(packages: FakePackage[]): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-matrix-'));
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'workspace-root', version: '0.1.0', private: true, workspaces: ['packages/*'] }),
    'utf8'
  );
  fs.mkdirSync(path.join(tmp, 'packages'));
  for (const pkg of packages) {
    const dir = path.join(tmp, 'packages', pkg.dir);
    fs.mkdirSync(dir, { recursive: true });
    const devDeps: Record<string, string> = {};
    for (const dep of pkg.workspaceDeps ?? []) {
      devDeps[dep] = 'workspace:*';
    }
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: pkg.name, version: '0.1.0', private: true, devDependencies: devDeps }),
      'utf8'
    );
  }
  return tmp;
}

describe('buildMatrix — pr-gate mode', () => {
  it('cross-products affected packages with the qa2-only env list', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@geowealth/e2e-framework' },
      { dir: 'tests-a', name: '@geowealth/tests-a', workspaceDeps: ['@geowealth/e2e-framework'] },
      { dir: 'tests-b', name: '@geowealth/tests-b', workspaceDeps: ['@geowealth/e2e-framework'] },
    ]);
    const matrix = buildMatrix(
      { packages: ['@geowealth/tests-a', '@geowealth/tests-b'], fullFallback: false },
      'pr-gate',
      tmp
    );
    assert.equal(matrix.mode, 'pr-gate');
    assert.equal(matrix.count, 2);
    assert.equal(matrix.include[0].environment, 'qa2');
    assert.equal(matrix.include[1].environment, 'qa2');
    const names = matrix.include.map((j) => j.package).sort();
    assert.deepEqual(names, ['@geowealth/tests-a', '@geowealth/tests-b']);
  });

  it('filters out @geowealth/e2e-framework and @geowealth/e2e-tooling', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@geowealth/e2e-framework' },
      { dir: 'tooling', name: '@geowealth/e2e-tooling', workspaceDeps: ['@geowealth/e2e-framework'] },
      { dir: 'tests-a', name: '@geowealth/tests-a', workspaceDeps: ['@geowealth/e2e-framework'] },
    ]);
    const matrix = buildMatrix(
      {
        packages: ['@geowealth/e2e-framework', '@geowealth/e2e-tooling', '@geowealth/tests-a'],
        fullFallback: false,
      },
      'pr-gate',
      tmp
    );
    assert.equal(matrix.count, 1);
    assert.equal(matrix.include[0].package, '@geowealth/tests-a');
  });
});

describe('buildMatrix — nightly mode', () => {
  it('cross-products with both qa2 and qa3', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@geowealth/e2e-framework' },
      { dir: 'tests-a', name: '@geowealth/tests-a', workspaceDeps: ['@geowealth/e2e-framework'] },
    ]);
    const matrix = buildMatrix(
      { packages: ['@geowealth/tests-a'], fullFallback: false },
      'nightly',
      tmp
    );
    assert.equal(matrix.count, 2);
    const envs = matrix.include.map((j) => j.environment).sort();
    assert.deepEqual(envs, ['qa2', 'qa3']);
  });
});

describe('buildMatrix — packageDir', () => {
  it('emits the correct relDir for each job', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@geowealth/e2e-framework' },
      { dir: 'tests-billing-servicing', name: '@geowealth/tests-billing-servicing' },
    ]);
    const matrix = buildMatrix(
      { packages: ['@geowealth/tests-billing-servicing'], fullFallback: false },
      'pr-gate',
      tmp
    );
    assert.equal(matrix.include[0].packageDir, 'packages/tests-billing-servicing');
  });
});

describe('buildMatrix — fullFallback propagation', () => {
  it('passes the fullFallback flag through to the output', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@geowealth/e2e-framework' },
      { dir: 'tests-a', name: '@geowealth/tests-a' },
    ]);
    const matrix = buildMatrix(
      { packages: ['@geowealth/tests-a'], fullFallback: true, fallbackReason: 'root config changed' },
      'pr-gate',
      tmp
    );
    assert.equal(matrix.fullFallback, true);
  });
});

describe('buildMatrix — empty input', () => {
  it('returns an empty matrix when no packages are affected', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@geowealth/e2e-framework' },
      { dir: 'tests-a', name: '@geowealth/tests-a' },
    ]);
    const matrix = buildMatrix({ packages: [], fullFallback: false }, 'pr-gate', tmp);
    assert.equal(matrix.count, 0);
    assert.deepEqual(matrix.include, []);
  });
});
