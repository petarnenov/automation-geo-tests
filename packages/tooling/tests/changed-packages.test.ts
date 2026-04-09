/**
 * Unit tests for changed-packages (Phase 1.4).
 *
 * Per OFFICIAL-FRAMEWORK-PROPOSAL.md v1.2 Section 6.3, changed-packages
 * has explicit unit tests covering:
 *   - a framework-only change → framework + every dependent
 *   - a single-team change → that team only
 *   - a tooling-only change → tooling + (full fallback if applicable)
 *   - a root-config change → full workspace fallback
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildPackageGraph,
  buildDependentClosure,
  computeChangedPackages,
  mapFileToPackage,
} from '../src/changed-packages.ts';

interface FakePackage {
  dir: string;
  name: string;
  workspaceDeps?: string[];
}

function makeWorkspace(packages: FakePackage[]): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'changed-packages-'));
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'workspace-root', version: '0.1.0', private: true, workspaces: ['packages/*'] }),
    'utf8'
  );
  fs.mkdirSync(path.join(tmp, 'packages'), { recursive: true });
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

describe('buildPackageGraph', () => {
  it('reads every packages/* directory', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@scope/framework' },
      { dir: 'tooling', name: '@scope/tooling', workspaceDeps: ['@scope/framework'] },
      { dir: 'tests-a', name: '@scope/tests-a', workspaceDeps: ['@scope/framework'] },
    ]);
    const { byName, byPathPrefix } = buildPackageGraph(tmp);
    assert.equal(byName.size, 3);
    assert.ok(byName.has('@scope/framework'));
    assert.ok(byName.has('@scope/tooling'));
    assert.ok(byName.has('@scope/tests-a'));
    assert.equal(byName.get('@scope/tooling')!.workspaceDeps.has('@scope/framework'), true);
    // Path prefix index
    assert.equal(byPathPrefix.length, 3);
  });
});

describe('buildDependentClosure', () => {
  it('returns empty consumer set for a leaf package', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@scope/framework' },
      { dir: 'tests-a', name: '@scope/tests-a', workspaceDeps: ['@scope/framework'] },
    ]);
    const { byName } = buildPackageGraph(tmp);
    const closure = buildDependentClosure(byName);
    assert.deepEqual([...closure.get('@scope/tests-a')!], []);
  });

  it('returns direct consumers for a single-level dependency', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@scope/framework' },
      { dir: 'tests-a', name: '@scope/tests-a', workspaceDeps: ['@scope/framework'] },
      { dir: 'tests-b', name: '@scope/tests-b', workspaceDeps: ['@scope/framework'] },
    ]);
    const { byName } = buildPackageGraph(tmp);
    const closure = buildDependentClosure(byName);
    const fwConsumers = [...closure.get('@scope/framework')!].sort();
    assert.deepEqual(fwConsumers, ['@scope/tests-a', '@scope/tests-b']);
  });

  it('returns transitive consumers for a deep chain', () => {
    const tmp = makeWorkspace([
      { dir: 'core', name: '@scope/core' },
      { dir: 'framework', name: '@scope/framework', workspaceDeps: ['@scope/core'] },
      { dir: 'tests-a', name: '@scope/tests-a', workspaceDeps: ['@scope/framework'] },
    ]);
    const { byName } = buildPackageGraph(tmp);
    const closure = buildDependentClosure(byName);
    // core's transitive consumers: framework + tests-a
    const coreConsumers = [...closure.get('@scope/core')!].sort();
    assert.deepEqual(coreConsumers, ['@scope/framework', '@scope/tests-a']);
  });
});

describe('mapFileToPackage', () => {
  it('maps a file inside packages/<name>/ to the package', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@scope/framework' },
      { dir: 'tests-a', name: '@scope/tests-a' },
    ]);
    const { byPathPrefix } = buildPackageGraph(tmp);
    assert.equal(mapFileToPackage('packages/framework/src/index.ts', byPathPrefix), '@scope/framework');
    assert.equal(mapFileToPackage('packages/tests-a/tests/smoke/x.spec.ts', byPathPrefix), '@scope/tests-a');
  });

  it('returns null for files outside packages/', () => {
    const tmp = makeWorkspace([{ dir: 'framework', name: '@scope/framework' }]);
    const { byPathPrefix } = buildPackageGraph(tmp);
    assert.equal(mapFileToPackage('package.json', byPathPrefix), null);
    assert.equal(mapFileToPackage('docs/foo.md', byPathPrefix), null);
    assert.equal(mapFileToPackage('.github/workflows/pr-gate.yml', byPathPrefix), null);
  });
});

describe('computeChangedPackages', () => {
  it('framework-only change → framework + every dependent', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@scope/framework' },
      { dir: 'tests-a', name: '@scope/tests-a', workspaceDeps: ['@scope/framework'] },
      { dir: 'tests-b', name: '@scope/tests-b', workspaceDeps: ['@scope/framework'] },
      { dir: 'unrelated', name: '@scope/unrelated' },
    ]);
    const result = computeChangedPackages(['packages/framework/src/index.ts'], tmp);
    assert.equal(result.fullFallback, false);
    assert.deepEqual(
      [...result.packages].sort(),
      ['@scope/framework', '@scope/tests-a', '@scope/tests-b']
    );
    // unrelated is NOT in the result.
    assert.equal(result.packages.includes('@scope/unrelated'), false);
  });

  it('single-team change → that team only', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@scope/framework' },
      { dir: 'tests-a', name: '@scope/tests-a', workspaceDeps: ['@scope/framework'] },
      { dir: 'tests-b', name: '@scope/tests-b', workspaceDeps: ['@scope/framework'] },
    ]);
    const result = computeChangedPackages(
      ['packages/tests-a/tests/smoke/login.spec.ts'],
      tmp
    );
    assert.equal(result.fullFallback, false);
    assert.deepEqual(result.packages, ['@scope/tests-a']);
  });

  it('tooling-only change → tooling + dependents (which is no test pkgs)', () => {
    // In the real workspace, tooling has no consumers among the test
    // packages. The dependent closure for tooling should be empty.
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@scope/framework' },
      { dir: 'tooling', name: '@scope/tooling', workspaceDeps: ['@scope/framework'] },
      { dir: 'tests-a', name: '@scope/tests-a', workspaceDeps: ['@scope/framework'] },
    ]);
    const result = computeChangedPackages(['packages/tooling/src/scaffold-team.ts'], tmp);
    assert.equal(result.fullFallback, false);
    assert.deepEqual(result.packages, ['@scope/tooling']);
  });

  it('root-config change → full workspace fallback', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@scope/framework' },
      { dir: 'tests-a', name: '@scope/tests-a', workspaceDeps: ['@scope/framework'] },
    ]);
    const result = computeChangedPackages(['package.json'], tmp);
    assert.equal(result.fullFallback, true);
    assert.match(result.fallbackReason!, /package\.json/);
    assert.deepEqual(
      [...result.packages].sort(),
      ['@scope/framework', '@scope/tests-a']
    );
  });

  it('docs change → full workspace fallback', () => {
    const tmp = makeWorkspace([{ dir: 'framework', name: '@scope/framework' }]);
    const result = computeChangedPackages(['docs/CHANGELOG.md'], tmp);
    assert.equal(result.fullFallback, true);
  });

  it('empty diff → empty result, no fallback', () => {
    const tmp = makeWorkspace([{ dir: 'framework', name: '@scope/framework' }]);
    const result = computeChangedPackages([], tmp);
    assert.equal(result.fullFallback, false);
    assert.deepEqual(result.packages, []);
  });

  it('mixed changes (test pkg + framework) → union of affected', () => {
    const tmp = makeWorkspace([
      { dir: 'framework', name: '@scope/framework' },
      { dir: 'tests-a', name: '@scope/tests-a', workspaceDeps: ['@scope/framework'] },
      { dir: 'tests-b', name: '@scope/tests-b', workspaceDeps: ['@scope/framework'] },
    ]);
    const result = computeChangedPackages(
      [
        'packages/framework/src/config/playwright.ts',
        'packages/tests-b/tests/smoke/login.spec.ts',
      ],
      tmp
    );
    assert.equal(result.fullFallback, false);
    assert.deepEqual(
      [...result.packages].sort(),
      ['@scope/framework', '@scope/tests-a', '@scope/tests-b']
    );
  });
});
