/**
 * Unit tests for the framework's TestRail reporter pure functions.
 *
 * Phase 1.6. The reporter class itself runs inside Playwright; the
 * pure helpers (buildResult, buildAttempts, shouldPostResults,
 * resolveRunConfig) are unit-tested here against synthetic inputs.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildResult,
  buildAttempts,
  shouldPostResults,
  resolveRunConfig,
} from '../../framework/src/reporters/testrail-reporter';

// Build a fake Playwright TestCase + TestResult shape — only the fields
// the reporter actually reads. The full Playwright type is huge.
function fakeTest(title: string, ancestors: string[] = []): { title: string; titlePath(): string[] } {
  return {
    title,
    titlePath: () => [...ancestors, title],
  };
}

function fakeResult(opts: {
  status: 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped';
  duration: number;
  error?: { message: string };
}): { status: 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped'; duration: number; error?: { message: string } } {
  return opts;
}

describe('buildResult', () => {
  it('extracts the C-id from the test title', () => {
const r = buildResult(fakeTest('@pepi C25193 admin can change inception date') as any, fakeResult({ status: 'passed', duration: 1234 }) as any, { reportSkipped: false });
    assert.notEqual(r, null);
    assert.equal(r!.case_id, 25193);
    assert.equal(r!.status_id, 1); // passed
    assert.equal(r!.elapsed, '1s');
  });

  it('returns null when the test title has no C-id', () => {
const r = buildResult(fakeTest('walking skeleton — Platform One landing renders') as any, fakeResult({ status: 'passed', duration: 1234 }) as any, { reportSkipped: false });
    assert.equal(r, null);
  });

  it('drops skipped tests by default', () => {
const r = buildResult(fakeTest('@pepi C26077 auto-link test (fixme)') as any, fakeResult({ status: 'skipped', duration: 0 }) as any, { reportSkipped: false });
    assert.equal(r, null);
  });

  it('reports skipped tests when reportSkipped=true', () => {
const r = buildResult(fakeTest('@pepi C26077 auto-link test (fixme)') as any, fakeResult({ status: 'skipped', duration: 0 }) as any, { reportSkipped: true });
    assert.notEqual(r, null);
    assert.equal(r!.case_id, 26077);
    assert.equal(r!.status_id, 2); // blocked
  });

  it('maps failed/timedOut/interrupted to status 5 (Failed)', () => {
    for (const status of ['failed', 'timedOut', 'interrupted'] as const) {
    const r = buildResult(fakeTest(`@pepi C99999 some test`) as any, fakeResult({ status, duration: 5000 }) as any, { reportSkipped: false });
      assert.notEqual(r, null);
      assert.equal(r!.status_id, 5, `${status} should map to 5`);
    }
  });

  it('rounds elapsed up to at least 1 second', () => {
const r = buildResult(fakeTest('@pepi C12345 quick test') as any, fakeResult({ status: 'passed', duration: 100 }) as any, { reportSkipped: false });
    assert.equal(r!.elapsed, '1s'); // 100ms → 1s minimum
  });

  it('embeds the error message in the comment when present', () => {
const r = buildResult(fakeTest('@pepi C12345 failing test', ['suite']) as any, fakeResult({ status: 'failed', duration: 1000, error: { message: 'expected true to be false' } }) as any, { reportSkipped: false });
    assert.notEqual(r, null);
    assert.match(r!.comment, /expected true to be false/);
    assert.match(r!.comment, /Status: failed/);
    assert.match(r!.comment, /Duration: 1000 ms/);
    assert.match(r!.comment, /suite > @pepi C12345 failing test/);
  });
});

describe('buildAttempts', () => {
  it('puts password before api_key (legacy lockout discovery)', () => {
    const attempts = buildAttempts({ TESTRAIL_PASSWORD: 'pw', TESTRAIL_API_KEY: 'k' } as Record<string, string | undefined>);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].label, 'password');
    assert.equal(attempts[1].label, 'api_key');
  });

  it('returns only password when only password is set', () => {
    const attempts = buildAttempts({ TESTRAIL_PASSWORD: 'pw' } as Record<string, string | undefined>);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].label, 'password');
  });

  it('returns only api_key when only api_key is set', () => {
    const attempts = buildAttempts({ TESTRAIL_API_KEY: 'k' } as Record<string, string | undefined>);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].label, 'api_key');
  });

  it('returns empty when no credentials are set', () => {
    assert.deepEqual(buildAttempts({} as Record<string, string | undefined>), []);
  });
});

describe('shouldPostResults', () => {
  it('returns true by default', () => {
    assert.equal(shouldPostResults({} as Record<string, string | undefined>), true);
  });

  it('returns false for "0", "false", "no" (case-insensitive)', () => {
    for (const v of ['0', 'false', 'no', 'NO', 'False']) {
      assert.equal(shouldPostResults({ TESTRAIL_REPORT_RESULTS: v } as Record<string, string | undefined>), false, `"${v}" should disable`);
    }
  });

  it('returns true for "1", "true", "yes", or any other value', () => {
    assert.equal(shouldPostResults({ TESTRAIL_REPORT_RESULTS: '1' } as Record<string, string | undefined>), true);
    assert.equal(shouldPostResults({ TESTRAIL_REPORT_RESULTS: 'true' } as Record<string, string | undefined>), true);
  });
});

describe('resolveRunConfig', () => {
  it('prefers env vars when both TESTRAIL_RUN_ID and TESTRAIL_URL are set', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-config-'));
    const orig = { runId: process.env.TESTRAIL_RUN_ID, url: process.env.TESTRAIL_URL };
    process.env.TESTRAIL_RUN_ID = '999';
    process.env.TESTRAIL_URL = 'https://testrail.example.com/index.php?/runs/view/999';
    try {
      const cfg = resolveRunConfig(tmp);
      assert.equal(cfg.runId, 999);
      assert.equal(cfg.baseUrl, 'https://testrail.example.com');
    } finally {
      if (orig.runId === undefined) delete process.env.TESTRAIL_RUN_ID;
      else process.env.TESTRAIL_RUN_ID = orig.runId;
      if (orig.url === undefined) delete process.env.TESTRAIL_URL;
      else process.env.TESTRAIL_URL = orig.url;
    }
  });

  it('falls back to legacy POC config when env vars are unset', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-config-'));
    const legacyDir = path.join(tmp, 'packages', 'legacy-poc');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'testrail.config.json'),
      JSON.stringify({
        testrail: {
          focusedRun: {
            url: 'https://testrail.geowealth.com/index.php?/runs/view/175',
            runId: 175,
          },
        },
      }),
      'utf8'
    );
    const orig = { runId: process.env.TESTRAIL_RUN_ID, url: process.env.TESTRAIL_URL };
    delete process.env.TESTRAIL_RUN_ID;
    delete process.env.TESTRAIL_URL;
    try {
      const cfg = resolveRunConfig(tmp);
      assert.equal(cfg.runId, 175);
      assert.equal(cfg.baseUrl, 'https://testrail.geowealth.com');
    } finally {
      if (orig.runId !== undefined) process.env.TESTRAIL_RUN_ID = orig.runId;
      if (orig.url !== undefined) process.env.TESTRAIL_URL = orig.url;
    }
  });

  it('throws when neither env vars nor legacy config is available', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-config-'));
    const orig = { runId: process.env.TESTRAIL_RUN_ID, url: process.env.TESTRAIL_URL };
    delete process.env.TESTRAIL_RUN_ID;
    delete process.env.TESTRAIL_URL;
    try {
      assert.throws(() => resolveRunConfig(tmp), /cannot resolve TestRail run id/);
    } finally {
      if (orig.runId !== undefined) process.env.TESTRAIL_RUN_ID = orig.runId;
      if (orig.url !== undefined) process.env.TESTRAIL_URL = orig.url;
    }
  });
});
