/**
 * `DummyFirmApi` — typed wrapper around `/qa/createDummyFirmExtended.do`.
 *
 * Phase 2 step 1.1 (D-37, Section 6.4.1). Foundation of per-worker
 * test isolation per Section 4.5 — globalSetup calls this 4× at
 * startup to provision a fixed pool of firms, each with a full role
 * matrix (admin + tim + gwAdmin + nonGwAdmin + 3 advisors).
 *
 * Two recorded fixtures live in
 * `packages/framework/tests/api/qa/__fixtures__/`:
 *
 *   - `createDummyFirm.qa2.2026-04-09.json` — regular endpoint, kept
 *     as a regression corpus because it contains an orphan-account
 *     advisor (advisor 2) that the flatten() filtering rules must
 *     continue to skip.
 *   - `createDummyFirmExtended.qa4.2026-04-11.json` — extended
 *     endpoint, used to validate the 7-login classification.
 *
 * Endpoint contract (captured live from qa4 on 2026-04-11):
 *
 *   - URL:     `/qa/createDummyFirmExtended.do`
 *   - Method:  POST (body is ignored)
 *   - Auth:    Platform One admin session (tim1 storage state)
 *   - Latency: ~5 seconds typical; 4× parallel may push higher
 *   - Body:    Content-Type: text/plain;charset=UTF-8, body is JSON
 *              (parsed by ApiClient as text→JSON.parse, NOT
 *              response.json(), so the content-type mismatch does
 *              not break parsing)
 *
 * Role matrix (extended endpoint only; regular endpoint ships just
 * the admin + 3 advisors):
 *
 *   - `admin_<firmCd>`         → firm admin (top-level `adminUser`)
 *   - `tim<firmCd>`            → per-firm tim variant
 *   - `u<firmCd>_gwadmin`      → GW Admin scoped to this firm
 *   - `u<firmCd>_nongwadmin`   → non-GW-Admin scoped to this firm
 *   - `adv_<firmCd>_{1,2,3}`   → 3 advisors with household/client/accounts
 *
 * `classifyLogins()` bins users[] by loginName regex. When the regular
 * endpoint is fed in, the non-advisor bins are simply `null` — the
 * classification degrades gracefully.
 *
 * Production safety (D-09): the underlying `ApiClient` refuses every
 * `/qa/*` call when `environment === 'production'`. This class
 * inherits that guard transparently.
 *
 * No teardown (settled by `feedback_dummy_firm_cleanup`): the API
 * never deletes a created firm, and the framework does not implement
 * any cleanup helper. Dummy firms accumulate by design per Section
 * 5.8 of the proposal.
 */

import { z } from 'zod';
import type { ApiClient } from '../client';

/**
 * Account inside a client. Note: `hh` may be null for orphan-account
 * advisors (advisors whose accounts have no household wrapper) — the
 * `flatten()` helper below filters those out at the household level
 * before they ever surface to a caller.
 */
const accountSchema = z.object({
  accountID: z.string(),
  accountNum: z.string(),
  accountTitle: z.string(),
  client: z.string(),
  hh: z.string().nullable(),
});

/**
 * The recursive client/household node. Both households (entityTypeCd=5)
 * and clients (entityTypeCd=1) share this shape — the discriminator is
 * the `entityTypeCd` field, and households have nested `clients[]`
 * while terminal clients have empty `clients[]` and populated
 * `accounts[]`.
 *
 * Zod has no native recursive support without `z.lazy`; the type
 * annotation on the schema is required to keep TypeScript happy.
 */
type ClientNode = {
  userId: string;
  name: string;
  entityTypeCd: number;
  adviserID: string;
  adviserName: string;
  accounts: Array<z.infer<typeof accountSchema>>;
  clients: ClientNode[];
};

const clientNodeSchema: z.ZodType<ClientNode> = z.lazy(() =>
  z.object({
    userId: z.string(),
    name: z.string(),
    entityTypeCd: z.number(),
    adviserID: z.string(),
    adviserName: z.string(),
    accounts: z.array(accountSchema),
    clients: z.array(clientNodeSchema),
  })
);

/**
 * Schema for an entry in `users[]`. The extended endpoint ships a
 * mixed array: actual advisors (with populated `clients[]` households)
 * and role-only users like `tim<firmCd>`, `u<firmCd>_gwadmin`,
 * `u<firmCd>_nongwadmin` that have `clients: []` and `adviserId: null`.
 * A single schema validates both shapes.
 */
const userEntrySchema = z.object({
  loginName: z.string(),
  name: z.string(),
  adviserId: z.string().nullable(),
  clients: z.array(clientNodeSchema),
});

/**
 * Top-level schema for the createDummyFirm response. Uses `passthrough`
 * to ignore the noise fields (metaData, conversationUUID, portalAlert,
 * portalLockout, rows, totalCount, objectType, nomenclatureSerial)
 * without rejecting future additions. `firm.firmUrl` is optional
 * because the regular `createDummyFirm.do` endpoint does not set it
 * while the extended endpoint does.
 */
export const createDummyFirmResponseSchema = z
  .object({
    success: z.literal(true),
    firm: z.object({
      firmCd: z.number(),
      firmName: z.string(),
      firmUrl: z.string().optional(),
    }),
    adminUser: z.object({
      loginName: z.string(),
      entityId: z.string(),
    }),
    users: z.array(userEntrySchema),
  })
  .passthrough();

export type CreateDummyFirmResponse = z.infer<typeof createDummyFirmResponseSchema>;

/**
 * Flattened, test-friendly tuple — one per (advisor, household,
 * client, accounts) quadruple. Mirror of the legacy POC's
 * worker-firm.js::flattenFirm() (lines 103-126).
 */
export interface DummyFirmTuple {
  readonly advisor: { readonly loginName: string; readonly name: string };
  readonly household: { readonly uuid: string; readonly name: string };
  readonly client: { readonly uuid: string; readonly name: string };
  readonly accounts: ReadonlyArray<{
    readonly uuid: string;
    readonly num: string;
    readonly title: string;
  }>;
}

/**
 * The full login roster extracted from a createDummyFirmExtended
 * response. Non-advisor bins (`tim`, `gwAdmin`, `nonGwAdmin`) are
 * `null` when the underlying response does not contain them — the
 * regular `createDummyFirm.do` endpoint only ships admin + advisors,
 * so those bins are null for that mode. The `admin` and `advisors`
 * fields are always populated (the schema guarantees `adminUser` and
 * at least a possibly-empty `users[]`).
 */
export interface DummyFirmLogins {
  readonly admin: { readonly loginName: string; readonly entityId: string };
  readonly tim: { readonly loginName: string; readonly name: string } | null;
  readonly gwAdmin: { readonly loginName: string; readonly name: string } | null;
  readonly nonGwAdmin: { readonly loginName: string; readonly name: string } | null;
  readonly advisors: ReadonlyArray<{
    readonly loginName: string;
    readonly name: string;
  }>;
}

/**
 * The fully-flattened firm view returned by `DummyFirmApi.create()`.
 * The first usable tuple is hoisted to the top level for ergonomics;
 * the full list is available via `tuples`. The `logins` field groups
 * every login in the response by role — used by globalSetup to
 * capture per-role storage states.
 */
export interface DummyFirm {
  readonly firmCd: number;
  readonly firmName: string;
  readonly firmUrl: string | null;
  readonly admin: { readonly loginName: string; readonly entityId: string };
  readonly advisor: DummyFirmTuple['advisor'];
  readonly household: DummyFirmTuple['household'];
  readonly client: DummyFirmTuple['client'];
  readonly accounts: DummyFirmTuple['accounts'];
  readonly tuples: ReadonlyArray<DummyFirmTuple>;
  readonly logins: DummyFirmLogins;
  readonly raw: CreateDummyFirmResponse;
}

/**
 * Bin `users[]` by loginName regex into the `DummyFirmLogins` shape.
 *
 * The regular endpoint ships only advisors (`adv_<firmCd>_<n>`), so
 * the non-advisor bins are `null` in that mode. The extended endpoint
 * ships the full matrix; every bin is populated.
 *
 * Multiple matches (shouldn't happen in practice) keep the first one
 * and log a warning — the assumption is that qa endpoints return at
 * most one per role slot.
 *
 * Exported for unit testing.
 */
export function classifyLogins(raw: CreateDummyFirmResponse): DummyFirmLogins {
  const fc = raw.firm.firmCd;
  const timRe = new RegExp(`^tim${fc}$`);
  const gwRe = new RegExp(`^u${fc}_gwadmin$`, 'i');
  const nonGwRe = new RegExp(`^u${fc}_nongwadmin$`, 'i');
  const advRe = new RegExp(`^adv_${fc}_\\d+$`);

  let tim: DummyFirmLogins['tim'] = null;
  let gwAdmin: DummyFirmLogins['gwAdmin'] = null;
  let nonGwAdmin: DummyFirmLogins['nonGwAdmin'] = null;
  const advisors: Array<{ loginName: string; name: string }> = [];

  for (const u of raw.users) {
    const pair = { loginName: u.loginName, name: u.name };
    if (timRe.test(u.loginName)) {
      tim ??= pair;
    } else if (gwRe.test(u.loginName)) {
      gwAdmin ??= pair;
    } else if (nonGwRe.test(u.loginName)) {
      nonGwAdmin ??= pair;
    } else if (advRe.test(u.loginName)) {
      advisors.push(pair);
    }
  }

  // Sort advisors by numeric suffix so `adv_1011_1` precedes `adv_1011_2`.
  advisors.sort((a, b) => {
    const na = Number(a.loginName.split('_').pop() ?? 0);
    const nb = Number(b.loginName.split('_').pop() ?? 0);
    return na - nb;
  });

  return {
    admin: { loginName: raw.adminUser.loginName, entityId: raw.adminUser.entityId },
    tim,
    gwAdmin,
    nonGwAdmin,
    advisors,
  };
}

/**
 * Walk a parsed createDummyFirm response and pull out usable
 * (advisor, household, client, accounts) tuples.
 *
 * Mirrors the legacy POC's flattenFirm exactly (preserves all the
 * filtering rules). The response nests as
 *   users[advisor].clients[household:5].clients[client:1].accounts[]
 * Top-level `clients` entries with `entityTypeCd:5` are households;
 * their nested `clients` with `entityTypeCd:1` are real clients.
 *
 * Skipped:
 *   - Orphan-account advisors (advisors whose `clients[0]` is an
 *     entityTypeCd:1 directly, with no household wrapper). These
 *     show up in real responses (advisor 2 in the recorded fixture)
 *     and are filtered because nearly every Pepi-style test needs a
 *     household-client-accounts triplet, not just an account.
 *   - Households with no terminal clients.
 *   - Terminal clients with no accounts.
 *
 * Exported for unit testing.
 */
export function flattenFirm(raw: CreateDummyFirmResponse): DummyFirmTuple[] {
  const tuples: DummyFirmTuple[] = [];
  for (const advisor of raw.users) {
    for (const householdNode of advisor.clients) {
      if (householdNode.entityTypeCd !== 5) continue; // not a household
      for (const clientNode of householdNode.clients) {
        if (clientNode.entityTypeCd !== 1) continue; // not a client
        const accounts = clientNode.accounts.map((a) => ({
          uuid: a.accountID,
          num: a.accountNum,
          title: a.accountTitle,
        }));
        if (accounts.length === 0) continue;
        tuples.push({
          advisor: { loginName: advisor.loginName, name: advisor.name },
          household: { uuid: householdNode.userId, name: householdNode.name },
          client: { uuid: clientNode.userId, name: clientNode.name },
          accounts,
        });
      }
    }
  }
  return tuples;
}

/**
 * Typed client for `/qa/createDummyFirm.do`. Construct with an
 * `ApiClient` (which carries the Playwright APIRequestContext + the
 * production safety guard) and call `.create()` to provision a fresh
 * dummy firm.
 *
 * Usage from a fixture (Phase 2 step 3):
 *
 *   const firm = await new DummyFirmApi(apiClient).create();
 *   await page.goto(`#/client/1/${firm.client.uuid}/accounts/${firm.accounts[0].uuid}/billing`);
 */
export class DummyFirmApi {
  private static readonly ENDPOINT = '/qa/createDummyFirmExtended.do';

  // The extended endpoint provisions a firm with Platform One access
  // plus the full role matrix (admin + tim + gwAdmin + nonGwAdmin
  // + 3 advisors). Can take 60+ seconds under load or on local
  // servers; 4× parallel from globalSetup may push higher.
  private static readonly TIMEOUT_MS = 180_000;

  constructor(private readonly client: ApiClient) {}

  /**
   * Provision a fresh dummy firm and return a flat, test-friendly
   * view. The returned shape is identical to the legacy POC's
   * setupWorkerFirm() return value (modulo type annotations).
   */
  async create(): Promise<DummyFirm> {
    const { parsed } = await this.client.post<unknown>(DummyFirmApi.ENDPOINT, {
      timeoutMs: DummyFirmApi.TIMEOUT_MS,
    });

    const validated = createDummyFirmResponseSchema.parse(parsed);
    return this.assemble(validated);
  }

  /**
   * Same as `create()` but takes a pre-parsed response. Used by unit
   * tests that drive the assembly logic against a recorded fixture
   * without spinning up an APIRequestContext. Exported as a public
   * method (not a free function) so the type plumbing stays
   * consistent with `create()`.
   */
  static fromRecordedResponse(raw: unknown): DummyFirm {
    const validated = createDummyFirmResponseSchema.parse(raw);
    return DummyFirmApi.assembleStatic(validated);
  }

  private assemble(raw: CreateDummyFirmResponse): DummyFirm {
    return DummyFirmApi.assembleStatic(raw);
  }

  private static assembleStatic(raw: CreateDummyFirmResponse): DummyFirm {
    const tuples = flattenFirm(raw);
    if (tuples.length === 0) {
      throw new Error(
        `DummyFirmApi: createDummyFirm response had no usable household/client/accounts tuple. ` +
          `firmCd=${raw.firm.firmCd}`
      );
    }
    const primary = tuples[0];
    const logins = classifyLogins(raw);
    return {
      firmCd: raw.firm.firmCd,
      firmName: raw.firm.firmName,
      firmUrl: raw.firm.firmUrl ?? null,
      admin: logins.admin,
      advisor: primary.advisor,
      household: primary.household,
      client: primary.client,
      accounts: primary.accounts,
      tuples,
      logins,
      raw,
    };
  }
}
