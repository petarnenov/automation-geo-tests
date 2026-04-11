/**
 * Unit tests for DummyFirmApi (Phase 2 step 1, D-37).
 *
 * The HTTP transport layer (ApiClient) is exercised against a fake
 * APIRequestContext mock; the parsing layer (Zod schema + flatten())
 * is exercised against a recorded fixture from a real qa2 response
 * captured 2026-04-09 (firmCd=326, 3 advisors with mixed
 * household/orphan-account shapes).
 *
 * Run via:
 *   npx tsx --test packages/tooling/tests/dummy-firm-api.test.ts
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ApiClient,
  ApiClientGuardError,
  DummyFirmApi,
  flattenFirm,
  classifyLogins,
  createDummyFirmResponseSchema,
} from '../../framework/src/api/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGULAR_FIXTURE_PATH = path.resolve(
  __dirname,
  '../../framework/tests/api/qa/__fixtures__/createDummyFirm.qa2.2026-04-09.json'
);
const EXTENDED_FIXTURE_PATH = path.resolve(
  __dirname,
  '../../framework/tests/api/qa/__fixtures__/createDummyFirmExtended.qa4.2026-04-11.json'
);

/** Load the old regular-endpoint fixture (firmCd 326, orphan advisor). */
function loadFixture(): unknown {
  return JSON.parse(fs.readFileSync(REGULAR_FIXTURE_PATH, 'utf8'));
}

/** Load the extended-endpoint fixture (firmCd 1011, full role matrix). */
function loadExtendedFixture(): unknown {
  return JSON.parse(fs.readFileSync(EXTENDED_FIXTURE_PATH, 'utf8'));
}

// ─────────────────────────────────────────────────────────────────────
// Schema parsing against the recorded fixture
// ─────────────────────────────────────────────────────────────────────

describe('createDummyFirmResponseSchema', () => {
  it('parses the recorded qa2 response without throwing', () => {
    const raw = loadFixture();
    const parsed = createDummyFirmResponseSchema.parse(raw);
    assert.equal(parsed.success, true);
    assert.equal(parsed.firm.firmCd, 326);
    assert.equal(parsed.firm.firmName, 'Firm-20260409162244');
    assert.equal(parsed.adminUser.loginName, 'admin_326');
    assert.equal(parsed.users.length, 3);
  });

  it('passes through unknown top-level fields without rejecting', () => {
    const raw = loadFixture() as Record<string, unknown>;
    raw.someFutureField = 'should not break the schema';
    raw.anotherFutureField = 42;
    const parsed = createDummyFirmResponseSchema.parse(raw);
    assert.equal(parsed.firm.firmCd, 326);
  });

  it('rejects responses where success is false', () => {
    const raw = loadFixture() as Record<string, unknown>;
    raw.success = false;
    assert.throws(() => createDummyFirmResponseSchema.parse(raw));
  });

  it('rejects responses with wrong-typed firmCd', () => {
    const raw = loadFixture() as Record<string, unknown>;
    (raw.firm as Record<string, unknown>).firmCd = '326'; // string, not number
    assert.throws(() => createDummyFirmResponseSchema.parse(raw));
  });

  it('accepts accounts with hh:null (orphan-account variant)', () => {
    const raw = loadFixture();
    const parsed = createDummyFirmResponseSchema.parse(raw);
    // Advisor 2 in the recorded fixture has orphan accounts: client
    // directly under advisor with hh:null on every account.
    const advisor2 = parsed.users[1];
    const orphanClient = advisor2.clients[0];
    assert.equal(orphanClient.entityTypeCd, 1);
    for (const acct of orphanClient.accounts) {
      assert.equal(acct.hh, null);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// flattenFirm() — preserves the legacy worker-firm.js filtering rules
// ─────────────────────────────────────────────────────────────────────

describe('flattenFirm', () => {
  it('produces 2 tuples from the recorded fixture (advisors 1 and 3 — advisor 2 is orphan-account, skipped)', () => {
    const parsed = createDummyFirmResponseSchema.parse(loadFixture());
    const tuples = flattenFirm(parsed);
    assert.equal(tuples.length, 2);
    assert.equal(tuples[0].advisor.loginName, 'adv_326_1');
    assert.equal(tuples[1].advisor.loginName, 'adv_326_3');
    // Each tuple has the right shape and 3 accounts.
    for (const t of tuples) {
      assert.equal(t.accounts.length, 3);
      assert.match(t.household.uuid, /^[0-9A-F]{32}$/);
      assert.match(t.client.uuid, /^[0-9A-F]{32}$/);
      for (const a of t.accounts) {
        assert.match(a.uuid, /^[0-9A-F]{32}$/);
      }
    }
  });

  it('skips orphan-account advisors (entityTypeCd:1 directly under advisor.clients)', () => {
    const parsed = createDummyFirmResponseSchema.parse(loadFixture());
    const tuples = flattenFirm(parsed);
    // adv_326_2 is the orphan-account advisor in the fixture.
    assert.equal(
      tuples.some((t) => t.advisor.loginName === 'adv_326_2'),
      false
    );
  });

  it('skips households whose terminal client has no accounts', () => {
    const parsed = createDummyFirmResponseSchema.parse(loadFixture());
    // Mutate the deep clone: empty out client[1]'s accounts under advisor 1.
    const mutated = structuredClone(parsed);
    mutated.users[0].clients[0].clients[0].accounts = [];
    const tuples = flattenFirm(mutated);
    // Now only advisor 3 yields a tuple.
    assert.equal(tuples.length, 1);
    assert.equal(tuples[0].advisor.loginName, 'adv_326_3');
  });

  it('returns an empty array when nothing usable exists', () => {
    const parsed = createDummyFirmResponseSchema.parse(loadFixture());
    const mutated = structuredClone(parsed);
    // Empty out all advisors' clients.
    for (const u of mutated.users) u.clients = [];
    assert.deepEqual(flattenFirm(mutated), []);
  });
});

// ─────────────────────────────────────────────────────────────────────
// DummyFirmApi.fromRecordedResponse — assembly + hoisting
// ─────────────────────────────────────────────────────────────────────

describe('DummyFirmApi.fromRecordedResponse', () => {
  it('hoists the first usable tuple to the top-level fields', () => {
    const firm = DummyFirmApi.fromRecordedResponse(loadFixture());
    assert.equal(firm.firmCd, 326);
    assert.equal(firm.firmName, 'Firm-20260409162244');
    assert.equal(firm.admin.loginName, 'admin_326');
    assert.match(firm.admin.entityId, /^[0-9A-F]{32}$/);
    assert.equal(firm.advisor.loginName, 'adv_326_1');
    assert.equal(firm.accounts.length, 3);
    assert.equal(firm.tuples.length, 2);
  });

  it('throws with a clear message when no usable tuples exist', () => {
    const raw = loadFixture() as Record<string, unknown>;
    // Empty out every advisor's clients[].
    for (const u of raw.users as Array<Record<string, unknown>>) u.clients = [];
    assert.throws(
      () => DummyFirmApi.fromRecordedResponse(raw),
      /no usable household\/client\/accounts tuple/
    );
  });

  it('preserves the raw response on the returned object', () => {
    const firm = DummyFirmApi.fromRecordedResponse(loadFixture());
    assert.equal(firm.raw.firm.firmCd, 326);
    assert.equal(firm.raw.users.length, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// ApiClient — production safety guard (D-09) and content-type quirk
// ─────────────────────────────────────────────────────────────────────

/**
 * A minimal mock of Playwright's APIRequestContext. We only stub the
 * methods ApiClient touches: post, get. The mock returns a fake
 * APIResponse-like object with text(), ok(), status(), headers().
 */
function makeMockRequest(opts: {
  bodyText: string;
  status?: number;
  contentType?: string;
}): {
  request: any;
  postCalls: Array<{ url: string; opts: unknown }>;
  getCalls: Array<{ url: string; opts: unknown }>;
} {
  const postCalls: Array<{ url: string; opts: unknown }> = [];
  const getCalls: Array<{ url: string; opts: unknown }> = [];
  const status = opts.status ?? 200;
  const contentType = opts.contentType ?? 'text/plain;charset=UTF-8';
  const fakeResponse = {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    statusText: () => (status === 200 ? 'OK' : 'ERR'),
    text: async () => opts.bodyText,
    headers: () => ({ 'content-type': contentType }),
  };
  const request = {
    post: async (url: string, o: unknown) => {
      postCalls.push({ url, opts: o });
      return fakeResponse;
    },
    get: async (url: string, o: unknown) => {
      getCalls.push({ url, opts: o });
      return fakeResponse;
    },
  };
  return { request, postCalls, getCalls };
}

describe('ApiClient — production safety guard (D-09)', () => {
  it('refuses to POST any /qa/* path when environment=production', async () => {
    const { request } = makeMockRequest({ bodyText: '{}' });
    const client = new ApiClient({ request, environment: 'production' });
    await assert.rejects(
      () => client.post('/qa/createDummyFirm.do'),
      (err: unknown) => err instanceof ApiClientGuardError
    );
  });

  it('refuses GET /qa/* on production too (the alias `prod` also blocks)', async () => {
    const { request } = makeMockRequest({ bodyText: '{}' });
    const client = new ApiClient({ request, environment: 'prod' });
    await assert.rejects(() => client.get('/qa/createDummyFirm.do'), ApiClientGuardError);
  });

  it('does NOT block /qa/* on qa2/qa3/qatrd', async () => {
    for (const env of ['qa2', 'qa3', 'qatrd']) {
      const { request, postCalls } = makeMockRequest({ bodyText: '{"ok":true}' });
      const client = new ApiClient({ request, environment: env });
      await client.post('/qa/createDummyFirm.do');
      assert.equal(postCalls.length, 1, `${env} should have allowed the POST`);
    }
  });

  it('does NOT block non-/qa/* paths on production (the guard is /qa/* specific)', async () => {
    const { request, postCalls } = makeMockRequest({ bodyText: '{"ok":true}' });
    const client = new ApiClient({ request, environment: 'production' });
    await client.post('/react/somethingElse.do');
    assert.equal(postCalls.length, 1);
  });
});

describe('ApiClient — content-type quirk', () => {
  it('parses a JSON body even when content-type is text/plain;charset=UTF-8', async () => {
    const { request } = makeMockRequest({
      bodyText: '{"firmCd":42,"firmName":"Test"}',
      contentType: 'text/plain;charset=UTF-8',
    });
    const client = new ApiClient({ request, environment: 'qa2' });
    const { parsed } = await client.post<{ firmCd: number; firmName: string }>(
      '/qa/createDummyFirm.do'
    );
    assert.deepEqual(parsed, { firmCd: 42, firmName: 'Test' });
  });

  it('throws a descriptive error on malformed JSON, including the content-type header', async () => {
    const { request } = makeMockRequest({
      bodyText: '<html>error page</html>',
      contentType: 'text/html',
    });
    const client = new ApiClient({ request, environment: 'qa2' });
    await assert.rejects(
      () => client.post('/qa/createDummyFirm.do'),
      /did not return valid JSON.*text\/html/
    );
  });

  it('throws on non-2xx with the body included', async () => {
    const { request } = makeMockRequest({
      bodyText: 'session expired',
      status: 500,
    });
    const client = new ApiClient({ request, environment: 'qa2' });
    await assert.rejects(
      () => client.post('/qa/createDummyFirm.do'),
      /500.*session expired/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// DummyFirmApi.create() end-to-end against the mock transport
// ─────────────────────────────────────────────────────────────────────

describe('DummyFirmApi.create() with mock transport', () => {
  it('drives the full path: post → text→JSON.parse → schema validate → flatten → assemble', async () => {
    const { request, postCalls } = makeMockRequest({
      bodyText: fs.readFileSync(EXTENDED_FIXTURE_PATH, 'utf8'),
      contentType: 'text/plain;charset=UTF-8',
    });
    const client = new ApiClient({ request, environment: 'qa2' });
    const dummyFirmApi = new DummyFirmApi(client);
    const firm = await dummyFirmApi.create();

    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0].url, '/qa/createDummyFirmExtended.do');
    assert.equal(firm.firmCd, 1011);
    // `firm.advisor` is hoisted from flattenFirm()'s first tuple,
    // which walks users[] in response order. The extended fixture
    // lists advisors in the order adv_1011_3, adv_1011_2, adv_1011_1,
    // so the hoisted primary is adv_1011_3. The important assertion
    // here is that SOME advisor is hoisted — classifyLogins handles
    // the sorted-by-suffix order separately.
    assert.match(firm.advisor.loginName, /^adv_1011_\d+$/);
    assert.ok(firm.tuples.length >= 1);
  });

  it('uses the per-endpoint 180s timeout, not the default 30s', async () => {
    const { request, postCalls } = makeMockRequest({
      bodyText: fs.readFileSync(EXTENDED_FIXTURE_PATH, 'utf8'),
    });
    const client = new ApiClient({ request, environment: 'qa2' });
    await new DummyFirmApi(client).create();
    const opts = postCalls[0].opts as { timeout?: number };
    assert.equal(opts.timeout, 180_000);
  });

  it('inherits the production safety guard via the underlying ApiClient', async () => {
    const { request } = makeMockRequest({ bodyText: '{}' });
    const client = new ApiClient({ request, environment: 'production' });
    await assert.rejects(() => new DummyFirmApi(client).create(), ApiClientGuardError);
  });
});

// ─────────────────────────────────────────────────────────────────────
// classifyLogins — role binning against the extended fixture
// ─────────────────────────────────────────────────────────────────────

describe('classifyLogins (extended fixture)', () => {
  it('parses the extended response without throwing', () => {
    const raw = loadExtendedFixture();
    const parsed = createDummyFirmResponseSchema.parse(raw);
    assert.equal(parsed.success, true);
    assert.equal(parsed.firm.firmCd, 1011);
    assert.equal(parsed.firm.firmName, 'Firm-20260411142037');
    assert.equal(parsed.firm.firmUrl, 'f1011qa.geowealth.com');
    assert.equal(parsed.adminUser.loginName, 'admin_1011');
    assert.equal(parsed.users.length, 6);
  });

  it('bins all 7 roles correctly', () => {
    const parsed = createDummyFirmResponseSchema.parse(loadExtendedFixture());
    const logins = classifyLogins(parsed);

    assert.equal(logins.admin.loginName, 'admin_1011');
    assert.match(logins.admin.entityId, /^[0-9A-F]{32}$/);

    assert.ok(logins.tim, 'tim should be populated');
    assert.equal(logins.tim!.loginName, 'tim1011');

    assert.ok(logins.gwAdmin, 'gwAdmin should be populated');
    assert.equal(logins.gwAdmin!.loginName, 'u1011_gwadmin');

    assert.ok(logins.nonGwAdmin, 'nonGwAdmin should be populated');
    assert.equal(logins.nonGwAdmin!.loginName, 'u1011_nongwadmin');

    assert.equal(logins.advisors.length, 3);
    assert.equal(logins.advisors[0].loginName, 'adv_1011_1');
    assert.equal(logins.advisors[1].loginName, 'adv_1011_2');
    assert.equal(logins.advisors[2].loginName, 'adv_1011_3');
  });

  it('degrades gracefully when fed the regular (non-extended) fixture — only admin + advisors are populated', () => {
    const parsed = createDummyFirmResponseSchema.parse(loadFixture());
    const logins = classifyLogins(parsed);

    assert.equal(logins.admin.loginName, 'admin_326');
    assert.equal(logins.tim, null);
    assert.equal(logins.gwAdmin, null);
    assert.equal(logins.nonGwAdmin, null);
    // Regular fixture has 3 advisor entries; all should be captured
    // even though advisor 2 is an orphan-account shape.
    assert.equal(logins.advisors.length, 3);
  });

  it('populates DummyFirm.logins and DummyFirm.firmUrl from the extended fixture', () => {
    const firm = DummyFirmApi.fromRecordedResponse(loadExtendedFixture());
    assert.equal(firm.firmCd, 1011);
    assert.equal(firm.firmUrl, 'f1011qa.geowealth.com');
    assert.equal(firm.logins.gwAdmin!.loginName, 'u1011_gwadmin');
    assert.equal(firm.logins.nonGwAdmin!.loginName, 'u1011_nongwadmin');
    assert.equal(firm.logins.advisors.length, 3);
  });

  it('DummyFirm.firmUrl is null when the fixture is the regular endpoint (no firmUrl field)', () => {
    const firm = DummyFirmApi.fromRecordedResponse(loadFixture());
    assert.equal(firm.firmUrl, null);
  });
});
