/**
 * `DummyFirmApi` — typed wrapper around `/qa/createDummyFirm.do`.
 *
 * Phase 2 step 1.1 (D-37, Section 6.4.1). Foundation of per-worker
 * test isolation per Section 4.5 — every worker calls this once at
 * startup to provision its own firm + admin + 3 advisors + accounts.
 *
 * Verified live against qa2 on 2026-04-09 (firmCd=326, took ~5.5s).
 * Recorded fixture at
 * `packages/framework/tests/api/qa/__fixtures__/createDummyFirm.qa2.2026-04-09.json`
 * is the input to the unit tests in `packages/tooling/tests/`.
 *
 * Endpoint contract (recorded by hand from a real qa2 response;
 * source-of-truth references in the legacy POC's worker-firm.js
 * (lines 60-126) and the project_apple_global_instrument /
 * reference_create_dummy_firm memories):
 *
 *   - URL:     `/qa/createDummyFirm.do`
 *   - Method:  POST or GET (both work; body is ignored)
 *   - Auth:    Platform One admin session (tim1 storage state)
 *   - Latency: ~6 seconds typical (up to 30+ under parallel load)
 *   - Body:    Content-Type: text/plain;charset=UTF-8, body is JSON
 *              (parsed by ApiClient as text→JSON.parse, NOT
 *              response.json(), so the content-type mismatch does
 *              not break parsing)
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

const advisorSchema = z.object({
  loginName: z.string(),
  name: z.string(),
  adviserId: z.string().nullable(),
  clients: z.array(clientNodeSchema),
});

/**
 * Top-level schema for the createDummyFirm response. Uses `passthrough`
 * to ignore the noise fields (metaData, conversationUUID, portalAlert,
 * portalLockout, rows, totalCount, objectType, nomenclatureSerial)
 * without rejecting future additions.
 */
export const createDummyFirmResponseSchema = z
  .object({
    success: z.literal(true),
    firm: z.object({
      firmCd: z.number(),
      firmName: z.string(),
    }),
    adminUser: z.object({
      loginName: z.string(),
      entityId: z.string(),
    }),
    users: z.array(advisorSchema),
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
 * The fully-flattened firm view returned by `DummyFirmApi.create()`.
 * The first usable tuple is hoisted to the top level for ergonomics;
 * the full list is available via `tuples`.
 */
export interface DummyFirm {
  readonly firmCd: number;
  readonly firmName: string;
  readonly admin: { readonly loginName: string; readonly entityId: string };
  readonly advisor: DummyFirmTuple['advisor'];
  readonly household: DummyFirmTuple['household'];
  readonly client: DummyFirmTuple['client'];
  readonly accounts: DummyFirmTuple['accounts'];
  readonly tuples: ReadonlyArray<DummyFirmTuple>;
  readonly raw: CreateDummyFirmResponse;
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

  // The extended endpoint provisions a firm with Platform One access.
  // Can take 60+ seconds under load or on local servers.
  private static readonly TIMEOUT_MS = 120_000;

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
    return {
      firmCd: raw.firm.firmCd,
      firmName: raw.firm.firmName,
      admin: {
        loginName: raw.adminUser.loginName,
        entityId: raw.adminUser.entityId,
      },
      advisor: primary.advisor,
      household: primary.household,
      client: primary.client,
      accounts: primary.accounts,
      tuples,
      raw,
    };
  }
}
