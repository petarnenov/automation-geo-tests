# Prompt: Implement `provisionClientPortalAccess` Playwright helper

Unblocks TestRail **C26254** (GEO-22184) and any other case that needs a CLIENT with Client Portal login on demand.

## Why no BE work

Probed 2026-06-19 on qa4: `POST /qa/createInvitationToken.do?userEmail=…` returned `200 success:true` with a token. The `DeveloperUtils.isDevelopmentModeEnabled()` gate in `QATrait.java:723` is **inactive on qa4** — the existing invitation flow is reusable. No new endpoint required.

## Goal

Add a single async helper in `tests/_helpers/qa3.js` (or a new `tests/_helpers/client-portal.js`):

```js
/**
 * Provision a CLIENT in `firmCd` with full Client Portal access.
 * Returns the credentials the test can immediately use to log in.
 *
 * @param {import('@playwright/test').Page} page  authenticated as tim1
 * @param {object} opts
 * @param {number} opts.firmCd
 * @param {string} [opts.namePrefix='pepiCli']
 * @param {string} [opts.password='C0w&ch1k3n']
 * @returns {Promise<{clientUUID, email, password, username, firstName, lastName, firmCd}>}
 */
async function provisionClientPortalAccess(page, opts) { ... }
```

## Implementation steps

The helper drives three real qa4 endpoints + one UI surface, all already on the live FE.

### Step 1 — Create the client (`POST /ux/createClient.do`)

The Advisor Portal create-client page (`/react/indexReact.do#/directories/clients/create`) posts here. Mirror its payload shape — reverse-engineer from `WebContent/react/app/src/pages/Contacts/subPages/newContact/helpers/serviceFormDataReshaper.js` + `addPhonesEmailsAddresses.js`.

Minimum required fields:
```js
const username = `${namePrefix}_${Date.now()}`;
const email = `${username}@geowealth.com`;
const body = new URLSearchParams();
body.append('firmCd', String(firmCd));
body.append('givenName', namePrefix);
body.append('surname', 'PortalCli');
body.append('clientType', '1');       // INDIVIDUAL
body.append('contactTypes', '1');     // Individual contact type
// Primary email block — the reshaper expands emailAddresses into
// `email_0_*` form fields; mirror that exactly. See addPhonesEmailsAddresses.js.
body.append('email_0_emailTypeCd', '1');     // Personal/Primary
body.append('email_0_emailName', email);
body.append('email_0_emailAddress', email);
body.append('email_0_emailSequenceNumber', '0');
body.append('email_0_primary_flag', 'true');
// + whichever advisor + address fields the form marks required
const r = await page.request.post('/ux/createClient.do', {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  data: body.toString(),
  timeout: 60_000,
});
const data = await r.json();
const clientUUID = data?.result?.entityId || data?.messages?.[0];
```

Inspect a real successful POST via DevTools the first time to nail down the exact key names — reshaper builds them dynamically.

### Step 2 — Generate invitation token (`POST /qa/createInvitationToken.do`)

```js
const tokenRes = await page.request.post('/qa/createInvitationToken.do', {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  data: `userEmail=${encodeURIComponent(email)}`,
  timeout: 30_000,
});
const tokenData = await tokenRes.json();
const invitationId = tokenData.messages?.[0];  // verified shape on qa4
if (!invitationId) throw new Error(`createInvitationToken failed: ${JSON.stringify(tokenData)}`);
```

### Step 3 — Setup password via `InvitationPasswordModal`

Two sub-paths:

**3a (preferred — direct API)**: figure out the exact endpoint the modal posts to. `invitationPasswordServices.setPassword` (path `WebContent/react/app/src/pages/Login/modals/InvitationPasswordModal/_services/invitationPasswordServices.js`) sends:
```
POST /<something>
form: q={"invitationId":"...", "password":"..."}
```
Replicate via `page.request.post`. Skips the UI modal entirely. ~1 second.

**3b (fallback — drive the UI)**: spawn a fresh context, navigate to `/react/indexReact.do#login?invitationId=<token>`, wait for the modal, fill new + confirm password, submit. ~10 seconds. The InvitationPasswordModal lives in `pages/Login/modals/InvitationPasswordModal/InvitationPasswordModal.js` — selectors visible there.

### Step 4 — Verify login works

Sanity check that the credentials actually authenticate before returning to the test:
```js
const probeCtx = await page.context().browser().newContext({ storageState: { cookies: [], origins: [] } });
const probePage = await probeCtx.newPage();
await probePage.goto('/react/indexReact.do#login');
await probePage.getByPlaceholder(/email|username/i).fill(email);
await probePage.getByPlaceholder(/password/i).fill(password);
await probePage.locator('button[type="submit"], button:has-text("Log In")').first().click();
await probePage.waitForURL(/#(client|dashboard)/, { timeout: 30_000 });
await probeCtx.close();
```

Optional — wrap behind `opts.skipLoginProbe` so callers that don't need the round-trip can shave 5-10 s.

### Step 5 — Return

```js
return {
  clientUUID,
  email,
  password,
  username,
  firstName: namePrefix,
  lastName: 'PortalCli',
  firmCd,
};
```

## C26254 spec wiring (after helper lands)

```js
const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin, login: qaLogin } = require('../_helpers/qa3');
const { provisionClientPortalAccess } = require('../_helpers/client-portal');

test('@pepi C26254 ...', async ({ browser, page, workerFirm }) => {
  await loginPlatformOneAdmin(page);
  const clientA = await provisionClientPortalAccess(page, { firmCd: workerFirm.firmCd });
  const clientG = await provisionClientPortalAccess(page, { firmCd: workerFirm.firmCd });

  // ctxA / ctxG — login each into Client Portal
  // main page — tim1 → ManageContacts → EditClient(clientA) → Disable
  // ctxA reload → expect bounced to #login (session revoked per GEO-22184)
  // ctxG reload → expect still on client portal
});
```

## Verification (acceptance for the helper)

```js
test('helper smoke', async ({ page, workerFirm }) => {
  await loginPlatformOneAdmin(page);
  const c = await provisionClientPortalAccess(page, { firmCd: workerFirm.firmCd });
  expect(c.email).toMatch(/@geowealth\.com$/);
  expect(c.clientUUID).toMatch(/^[0-9A-F]{32}$/);
  // login probe inside the helper already proved auth — assert is implicit
});
```

## Risk notes

- **First-login surfaces** — TOS modal, security questions, password strength. If qa4 forces any, add dismiss logic in step 4 (the UI probe). The InvitationPasswordModal flow itself sets the password as if the user accepted the invite link, so most first-login gating that depends on `EntityPasswordChange` rows is already satisfied.
- **`/ux/createClient.do` form schema** — the FE reshaper is the source of truth. The first run will likely fail with "field X is required" until the payload matches; iterate by reading the FE's actual outgoing payload in DevTools.
- **No teardown** — clients accumulate on qa4 like dummy firms (per `feedback_dummy_firm_cleanup`).
- **MFA** — clients created without `mfaRequiredFlag=1`, so login should bypass MFA. If qa4 forces MFA for clients, add the DB patch `UPDATE entity_tbl SET mfa_required_flag=0 WHERE entity_id=:clientUUID` immediately after step 1.

## Time estimate

| Step | Cost |
|---|---|
| Reverse-engineer `/ux/createClient.do` payload | ~1 hr |
| Wire up steps 1-5 in helper | ~1 hr |
| Hit first-login modals if any surface | ~30 min |
| C26254 spec wiring + green | ~30 min |
| **Total** | **~3 hr**, no BE work |

Ship this helper → flip `test.fixme` in `tests/user-management/C26254.spec.js` to a real implementation → green test.
