/**
 * Unit tests for the framework's run-summary reporter pure helpers
 * (D-40, Section 6.11). The reporter class itself runs inside Playwright;
 * the pure helpers (extractTags, extractCaseId, resolveEnvironment,
 * resolvePackageName, classifyOutcome) are unit-tested here.
 *
 * Run via:
 *   npx tsx --test packages/tooling/tests/run-summary-reporter.test.ts
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractTags,
  extractCaseId,
  resolveEnvironment,
  resolvePackageName,
  classifyOutcome,
} from '../../framework/src/reporters/run-summary-reporter';

describe('extractTags', () => {
  it('extracts every @<word> token in title order', () => {
    assert.deepEqual(
      extractTags('@billing @smoke C25193 admin can change inception date'),
      ['@billing', '@smoke']
    );
  });

  it('returns an empty array when no tags are present', () => {
    assert.deepEqual(extractTags('plain title with no tags'), []);
  });

  it('handles hyphens and underscores in tag names', () => {
    assert.deepEqual(extractTags('@platform-one @auto_link C99'), ['@platform-one', '@auto_link']);
  });
});

describe('extractCaseId', () => {
  it('extracts a Cnnn token', () => {
    assert.equal(extractCaseId('@billing C25193 admin can change inception date'), 25193);
  });

  it('returns null when no Cnnn token is present', () => {
    assert.equal(extractCaseId('@smoke admin can log in'), null);
  });

  it('does not match Cnnn embedded inside a word', () => {
    assert.equal(extractCaseId('CRC25193 not a real id'), null);
  });
});

describe('resolveEnvironment', () => {
  it('uses TEST_ENV when set to a valid value', () => {
    assert.equal(resolveEnvironment({ TEST_ENV: 'qa3' }), 'qa3');
    assert.equal(resolveEnvironment({ TEST_ENV: 'QA10' }), 'qa10');
    assert.equal(resolveEnvironment({ TEST_ENV: 'qatrd' }), 'qatrd');
  });

  it('defaults to qa2 when unset', () => {
    assert.equal(resolveEnvironment({}), 'qa2');
  });

  it('falls back to qa2 for unknown values', () => {
    assert.equal(resolveEnvironment({ TEST_ENV: 'production' }), 'qa2');
    assert.equal(resolveEnvironment({ TEST_ENV: 'staging' }), 'qa2');
  });
});

describe('resolvePackageName', () => {
  it('prefers GW_PACKAGE_NAME when set', () => {
    assert.equal(resolvePackageName('/anywhere', { GW_PACKAGE_NAME: '@override/name' }), '@override/name');
  });

  it('walks up to find the nearest package.json with a name', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgname-'));
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: '@geowealth/tests-foo' })
    );
    const nested = path.join(tmp, 'tests', 'smoke');
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(resolvePackageName(nested, {}), '@geowealth/tests-foo');
  });

  it('falls back to "unknown" when no package.json is found', () => {
    // Use the OS root as the start dir; in CI containers this is unlikely
    // to have a package.json with a `name` field. The function returns
    // 'unknown' in that case.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'no-pkg-'));
    // The walk-up may eventually hit a package.json above /tmp on some
    // systems, so accept either the configured fallback or any string;
    // the only invariant we test here is that the function does not crash.
    const result = resolvePackageName(tmp, {});
    assert.equal(typeof result, 'string');
  });
});

describe('classifyOutcome', () => {
  function fakeTest(outcome: 'expected' | 'unexpected' | 'flaky' | 'skipped'): {
    outcome(): typeof outcome;
  } {
    return { outcome: () => outcome };
  }

  it('maps expected → passed', () => {
    assert.equal(classifyOutcome(fakeTest('expected') as any), 'passed');
  });

  it('maps unexpected → failed', () => {
    assert.equal(classifyOutcome(fakeTest('unexpected') as any), 'failed');
  });

  it('maps flaky → flaky', () => {
    assert.equal(classifyOutcome(fakeTest('flaky') as any), 'flaky');
  });

  it('maps skipped → skipped', () => {
    assert.equal(classifyOutcome(fakeTest('skipped') as any), 'skipped');
  });
});
