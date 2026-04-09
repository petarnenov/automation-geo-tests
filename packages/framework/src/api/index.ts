/**
 * `@geowealth/e2e-framework/api` — typed `.do` endpoint clients.
 *
 * Phase 2 step 1.1 (D-37) — populated with `ApiClient` (transport
 * layer with the D-09 production safety guard) and the first typed
 * `/qa/*` wrapper, `DummyFirmApi`. Subsequent wrappers
 * (`InvitationApi`, `CustodianApi`, etc.) are added in their own
 * Phase 2 sub-steps as their consumer specs are ported.
 *
 * Per Decision D-42 the client accepts an `APIRequestContext` from
 * the caller; never logs in by itself.
 */

export { ApiClient, ApiClientGuardError, type ApiClientOptions, type ApiResponse } from './client';
export {
  DummyFirmApi,
  flattenFirm,
  createDummyFirmResponseSchema,
  type CreateDummyFirmResponse,
  type DummyFirm,
  type DummyFirmTuple,
} from './qa/DummyFirmApi';
