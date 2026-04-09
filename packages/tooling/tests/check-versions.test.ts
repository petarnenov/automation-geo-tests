/**
 * Unit tests for check-versions (D-27 single-monorepo-version enforcement).
 *
 * Phase 1.3. Uses Node's built-in `node:test` runner to keep the test
 * stack minimal — no jest, no vitest. Run via:
 *
 *   npx tsx --test packages/tooling/tests/check-versions.test.ts
 *
 * The framework's own component smoke specs use Playwright (Phase 2),
 * but pure-logic tooling tests like this one are CLI-runner-friendly
 * via node:test.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkVersionConsistency, collectPackages, groupByVersion } from '../src/check-versions.ts';

/**
 * Build a fake workspace under a temp dir, with a workspace root
 * package.json and N package.json files under packages/<name>/.
 */
function makeWorkspace(
  layout: { root: { name: string; version: string }; packages: Array<{ dir: string; name: string; version: string }> }
): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-versions-'));
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: layout.root.name, version: layout.root.version, private: true }),
    'utf8'
  );
  fs.mkdirSync(path.join(tmp, 'packages'), { recursive: true });
  for (const pkg of layout.packages) {
    const dir = path.join(tmp, 'packages', pkg.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: pkg.name, version: pkg.version, private: true }),
      'utf8'
    );
  }
  return tmp;
}

describe('checkVersionConsistency', () => {
  it('returns null when every package has the same version', () => {
    const tmp = makeWorkspace({
      root: { name: 'workspace-root', version: '0.1.0' },
      packages: [
        { dir: 'a', name: '@scope/a', version: '0.1.0' },
        { dir: 'b', name: '@scope/b', version: '0.1.0' },
        { dir: 'c', name: '@scope/c', version: '0.1.0' },
      ],
    });
    const pkgs = collectPackages(tmp);
    assert.equal(pkgs.length, 4); // root + 3
    assert.equal(checkVersionConsistency(pkgs), null);
  });

  it('returns a clear error message when one package drifts', () => {
    const tmp = makeWorkspace({
      root: { name: 'workspace-root', version: '0.1.0' },
      packages: [
        { dir: 'a', name: '@scope/a', version: '0.1.0' },
        { dir: 'b', name: '@scope/b', version: '0.2.0' }, // drifted
        { dir: 'c', name: '@scope/c', version: '0.1.0' },
      ],
    });
    const pkgs = collectPackages(tmp);
    const err = checkVersionConsistency(pkgs);
    assert.notEqual(err, null);
    assert.match(err!, /D-27 violation/);
    assert.match(err!, /2 distinct versions/);
    assert.match(err!, /version "0\.1\.0" \(3 packages\)/);
    assert.match(err!, /version "0\.2\.0" \(1 package\)/);
    assert.match(err!, /@scope\/b/);
  });

  it('returns an error when many packages drift in different directions', () => {
    const tmp = makeWorkspace({
      root: { name: 'workspace-root', version: '0.1.0' },
      packages: [
        { dir: 'a', name: '@scope/a', version: '0.2.0' },
        { dir: 'b', name: '@scope/b', version: '0.3.0' },
        { dir: 'c', name: '@scope/c', version: '0.1.0' },
      ],
    });
    const pkgs = collectPackages(tmp);
    const err = checkVersionConsistency(pkgs);
    assert.notEqual(err, null);
    assert.match(err!, /3 distinct versions/);
    assert.match(err!, /4 packages/);
  });
});

describe('collectPackages', () => {
  it('reads workspace root + every packages/* directory with a package.json', () => {
    const tmp = makeWorkspace({
      root: { name: 'workspace-root', version: '1.0.0' },
      packages: [
        { dir: 'alpha', name: '@scope/alpha', version: '1.0.0' },
        { dir: 'beta', name: '@scope/beta', version: '1.0.0' },
      ],
    });
    // Add a directory under packages/ that has NO package.json — should be skipped.
    fs.mkdirSync(path.join(tmp, 'packages', 'gamma-no-pkg'), { recursive: true });

    const pkgs = collectPackages(tmp);
    assert.equal(pkgs.length, 3);
    const names = pkgs.map((p) => p.name).sort();
    assert.deepEqual(names, ['@scope/alpha', '@scope/beta', 'workspace-root']);
  });

  it('throws if workspace root has no package.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-versions-'));
    assert.throws(() => collectPackages(tmp), /workspace root has no package.json/);
  });

  it('throws if a package.json is missing the version field', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-versions-'));
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'workspace-root' }), // no version
      'utf8'
    );
    fs.mkdirSync(path.join(tmp, 'packages'));
    assert.throws(() => collectPackages(tmp), /missing the "version" field/);
  });
});

describe('groupByVersion', () => {
  it('returns one group when all packages share a version', () => {
    const groups = groupByVersion([
      { relPath: 'package.json', name: 'r', version: '1.0.0' },
      { relPath: 'packages/a/package.json', name: 'a', version: '1.0.0' },
    ]);
    assert.equal(groups.size, 1);
    assert.equal(groups.get('1.0.0')!.length, 2);
  });

  it('returns multiple groups when versions differ', () => {
    const groups = groupByVersion([
      { relPath: 'package.json', name: 'r', version: '1.0.0' },
      { relPath: 'packages/a/package.json', name: 'a', version: '2.0.0' },
    ]);
    assert.equal(groups.size, 2);
    assert.equal(groups.get('1.0.0')!.length, 1);
    assert.equal(groups.get('2.0.0')!.length, 1);
  });
});
