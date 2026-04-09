/**
 * `ApiClient` — the framework's transport layer for `.do` action endpoints.
 *
 * Phase 2 step 1.1 (D-37, Section 6.4.1). Per Decision D-42, the API
 * client accepts a Playwright `APIRequestContext` from the caller; it
 * NEVER logs in by itself. The caller (typically a fixture) provides
 * a context constructed with the storage state from `auth.fixture.ts`.
 *
 * There is exactly one auth path in the program — through storage
 * states — and the API client is a thin transport over a
 * pre-authenticated context.
 *
 * Production safety guard (D-09): the client refuses to call any
 * `/qa/*` endpoint when the configured environment is `production`.
 * This is enforced unconditionally — never overridable. Section
 * 4.10.7 of the proposal lists every `/qa/*` endpoint and ends with:
 * "the framework's API client must refuse to call any /qa/* endpoint
 * when the configured environment is production."
 *
 * Quirk Q9 (from the C25193 entry spike): the legacy POC's
 * worker-firm.js uses Node `fetch` instead of Playwright's
 * `APIRequestContext` because creating an APIRequestContext inside a
 * worker fixture conflicted with the worker's trace artifact cleanup —
 * silent ENOENTs on .trace and .network files surfaced much later as
 * apiRequestContext._wrapApiCall errors. The framework starts with
 * `APIRequestContext` (per D-42) and trusts the caller to provide a
 * context that is not subject to that race. The risk is documented
 * in OQ-1 of the spike; if the trace cleanup race reproduces against
 * current Playwright (1.59.x) when the workerFirm fixture lifts in
 * Phase 2 step 3, the fallback is to provide a Node-fetch backed
 * alternative transport at the `ApiClient` constructor level.
 *
 * Quirk: createDummyFirm and many other `.do` endpoints return
 * `Content-Type: text/plain;charset=UTF-8` even though the body is
 * JSON. The client therefore reads the body as text and runs
 * `JSON.parse` itself, rather than relying on `response.json()` which
 * may enforce content-type matching in some Playwright versions.
 */

import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * Reasons the client refuses to make a call before it even hits the
 * network. The caller can `instanceof` this to distinguish between a
 * client-side guard and a backend failure.
 */
export class ApiClientGuardError extends Error {
  constructor(
    message: string,
    public readonly endpoint: string
  ) {
    super(message);
    this.name = 'ApiClientGuardError';
  }
}

export interface ApiClientOptions {
  /**
   * The Playwright APIRequestContext the client will use for every
   * call. Caller-owned: the client does not dispose it.
   */
  readonly request: APIRequestContext;
  /**
   * Environment slug — used for the production safety guard. Must be
   * one of `qa1..qa10 | qatrd | production`. Anything else is treated
   * as a non-production env (the guard is conservative: if you mistype
   * `prodution` you get the dev experience, not the safety lock).
   */
  readonly environment: string;
  /**
   * Default per-request timeout in milliseconds. Defaults to 30s,
   * which covers `/qa/createDummyFirm.do`'s ~6s typical latency with
   * generous headroom for qa-environment slowdowns under load.
   */
  readonly defaultTimeoutMs?: number;
}

/**
 * Result of a successful POST. The client returns the parsed JSON
 * body and the original APIResponse so callers can inspect headers /
 * status if they need to.
 */
export interface ApiResponse<T = unknown> {
  readonly raw: APIResponse;
  readonly parsed: T;
  readonly status: number;
}

const PRODUCTION_ENVIRONMENTS = new Set(['production', 'prod']);
const QA_PATH_PREFIX = '/qa/';

export class ApiClient {
  private readonly request: APIRequestContext;
  private readonly environment: string;
  private readonly defaultTimeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.request = options.request;
    this.environment = options.environment.toLowerCase();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  /**
   * POST to a `.do` action endpoint. Reads the response body as text
   * and JSON.parses it (the content-type quirk above). Throws
   * ApiClientGuardError on the production safety guard, and Error on
   * any other failure (non-2xx, malformed JSON, network).
   */
  async post<T = unknown>(
    path: string,
    options: { timeoutMs?: number; data?: unknown } = {}
  ): Promise<ApiResponse<T>> {
    this.assertNotProductionForQaPath(path);

    const res = await this.request.post(path, {
      timeout: options.timeoutMs ?? this.defaultTimeoutMs,
      data: options.data,
    });

    return this.parseResponse<T>(res, path);
  }

  /**
   * GET equivalent. Some `.do` actions accept GET as well as POST
   * (notably `/qa/createDummyFirm.do` per the legacy memory).
   */
  async get<T = unknown>(
    path: string,
    options: { timeoutMs?: number } = {}
  ): Promise<ApiResponse<T>> {
    this.assertNotProductionForQaPath(path);

    const res = await this.request.get(path, {
      timeout: options.timeoutMs ?? this.defaultTimeoutMs,
    });

    return this.parseResponse<T>(res, path);
  }

  private assertNotProductionForQaPath(path: string): void {
    if (PRODUCTION_ENVIRONMENTS.has(this.environment) && path.startsWith(QA_PATH_PREFIX)) {
      throw new ApiClientGuardError(
        `ApiClient: refusing to call ${path} in environment=${this.environment}. ` +
          `The /qa/* namespace is gated to non-production environments only ` +
          `(Decision D-09; Section 4.10.7).`,
        path
      );
    }
  }

  private async parseResponse<T>(res: APIResponse, path: string): Promise<ApiResponse<T>> {
    if (!res.ok()) {
      const body = await res.text().catch(() => '<no body>');
      throw new Error(
        `ApiClient: ${path} returned ${res.status()} ${res.statusText()}: ` +
          `${body.slice(0, 500)}`
      );
    }

    // Read as text and parse manually — many `.do` endpoints return
    // Content-Type: text/plain;charset=UTF-8 even though the body is
    // JSON.
    const text = await res.text();
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch (err) {
      throw new Error(
        `ApiClient: ${path} did not return valid JSON ` +
          `(content-type=${res.headers()['content-type']}): ${text.slice(0, 500)}`,
        { cause: err }
      );
    }

    return { raw: res, parsed, status: res.status() };
  }
}
