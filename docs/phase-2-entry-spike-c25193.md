# Phase 2 entry spike — C25193 inventory

| Field | Value |
|---|---|
| **Document** | QA-ARCH-001 / Phase 2 entry spike |
| **Status** | Draft (read-only inventory; no code changes) |
| **Date** | 2026-04-09 |
| **Author** | QA Automation |
| **Audience** | Phase 2 Component lift + C25193 graduation |
| **Source spec** | `packages/legacy-poc/tests/account-billing/C25193.spec.js` (127 lines) |
| **Target spec** | `packages/tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts` (Phase 2 work order step 5) |

## Why this exists

Per Section 6.4 of OFFICIAL-FRAMEWORK-PROPOSAL.md, **the Phase 2 entry spike is mandatory before lifting any helper**. It exists to:

1. Surface every legacy helper, magic identifier, and product quirk the spec depends on, so the Phase 2 work order can size each step honestly.
2. Prevent the "L-sized but actually XL" risk recorded against R-12 (the C25193 graduation underestimating its true scope).
3. Give the Component lift, the API client, and the fixture port a single source of truth for *what behavior must be preserved*.

This spike is intentionally **not** prescriptive about *how* each piece is ported — it lists what exists. Design decisions (which Component owns which selector, how the fixture composes, etc.) are made during Phase 2 step-by-step against this inventory.

---

## 1. Spec scope (what C25193 actually exercises)

Two phases, hybrid isolation per the comment block at lines 39-53 of the spec:

### Phase 1 — admin write/read flow (worker firm)
1. Login as the worker firm's auto-generated admin (`workerFirm.admin.loginName`).
2. Navigate to the worker firm's primary client/account Billing tab.
3. Read the displayed Billing Inception Date.
   - If empty, seed `12/01/2024`, save, poll the summary card until it shows the seeded value.
4. Compute "next month, same day" via `nextMonthDate()` (avoids leap-year edge cases by using `Date.UTC` and 0-based month arithmetic).
5. Open Edit Billing Settings → set the new date via `setReactDatePicker` → Save.
6. Poll the summary card with `expect.poll` (15s timeout) until it shows the new date.
7. **No revert step** — each worker has its own dummy firm, so audit history accumulation is irrelevant per run.

### Phase 2 — non-admin Edit-button-hidden check (firm 106 + tyler)
1. Login as `tyler@plimsollfp.com` on the **shared** firm 106 (NOT the worker firm — see "Tyler is not advisor" quirk below).
2. Navigate to the static Plimsoll FP Arnold/Delaney account's Billing tab.
3. Assert `Edit Billing Settings` button has count 0.

### What the spec deliberately does NOT do

- **No History grid assertion.** The legacy comment (lines 17-24) notes that the qa3 Account Billing History grid does not record Billing Inception Date changes — verified live 2026-04-07 with 40 history rows scanned across multiple field categories. Root cause is a silent audit pipeline, not a programmatic-fill bug. The spec scope deliberately stops at the summary-card round-trip + the non-admin button-visibility check, "mirroring the spirit of the TestRail steps without depending on a missing audit row".
- **No cleanup of seeded date** in Phase 1. Worker firms accumulate by design.
- **No firm 106 mutation.** Phase 2 is read-only against shared static state.

---

## 2. Helper modules imported (transitive closure)

```
C25193.spec.js
└── account-billing/_helpers.js                       (209 lines, 14 exports)
    ├── _helpers/qa3.js          (login + navigation, 317 lines)
    │   └── (uses TIM1_PASSWORD from env via load-env.js → dotenv-flow)
    └── _helpers/ui.js           (widget primitives, 387 lines, 10 exports)
        └── (uses Playwright expect only; no other internal deps)

C25193.spec.js (also via fixture, NOT explicit import)
└── _helpers/worker-firm.js                           (273 lines, 5 exports)
    ├── packages/legacy-poc/testrail.config.json     (read for appUnderTest.url)
    ├── packages/legacy-poc/tests/.auth/tim1.json    (read for cookies)
    └── (uses TIM1_PASSWORD from env)
```

### Direct imports from C25193.spec.js (line 28-37)

| Symbol | From | What it does | Phase 2 disposition |
|---|---|---|---|
| `loginAsWorkerFirmAdmin(context, page, workerFirm)` | `account-billing/_helpers.js` | Clears cookies, calls `login()`, asserts `#(dashboard\|platformOne)` URL | → fixture: `workerFirmAdminPage` |
| `loginAsNonAdmin(context, page)` | `account-billing/_helpers.js` | Clears cookies, calls `login()` with `tyler@plimsollfp.com`, asserts `#dashboard` URL | → fixture: `tylerPage` (firm-106-scoped read-only role) |
| `gotoWorkerFirmAccountBilling(page, workerFirm)` | `account-billing/_helpers.js` | Navigates to `#/client/1/{client.uuid}/accounts/{accounts[0].uuid}/billing`, waits for History button | → `AccountBillingPage.goto({ workerFirm })` |
| `gotoAccountBilling(page)` | `account-billing/_helpers.js` | Navigates to the static Arnold/Delaney UUID-based URL, waits for History button | → `AccountBillingPage.goto({ static: 'arnold-delaney' })` or constants |
| `openEditBillingSettings(page)` | `account-billing/_helpers.js` | Clicks "Edit Billing Settings" button, waits for "Edit Account Billing Settings" modal title AND the Save button (form fetched async) | → `AccountBillingPage.openEditModal()` |
| `saveEditBillingSettings(page)` | `account-billing/_helpers.js` | Clicks Save, waits for "Account Billing Successfully Updated!" modal, clicks Close, waits for the success modal to be hidden | → `AccountBillingPage.saveEditModal()` |
| `setBillingInceptionDate(page, mmddyyyy)` | `account-billing/_helpers.js` | Thin wrapper over `setReactDatePicker(page, page.locator('#billingInceptionDate'), mmddyyyy)` | → `AccountBillingPage.setInceptionDate(date)` consuming `ReactDatePicker` Component |
| `getDisplayedBillingInceptionDate(page)` | `account-billing/_helpers.js` | Reads the value from the Billing summary card via `text=Billing Inception Date` + `xpath=following-sibling::*[1]` + `innerText()` | → `AccountBillingPage.displayedInceptionDate` (Locator) |

### Indirect dependency chain

- `account-billing/_helpers.js` imports `login` from `_helpers/qa3.js` (line 29) and `setReactDatePicker, setComboBoxValue, setReactNumericInput` from `_helpers/ui.js` (line 30). Of those, **only `setReactDatePicker` is actually used by C25193**; the other two ride along because the file serves the C25193..C25249 family.
- `_helpers/qa3.js::login(page, username, password)` is the basic login flow: `goto('/')` → `waitForURL(/#login/)` → fill username + password → click "Login". This is the variant that **breaks on qa2/qa4** (see preflight fix in commit `d17459d`); the resilient `loginPlatformOneAdmin` lives in the same file and uses a DOM-signal race instead. **C25193 currently routes through the basic variant**, which is one reason the legacy POC is fragile when run outside qa3.
- `_helpers/worker-firm.js` is provided to the spec via the `workerFirm` fixture (monkey-patched in `playwright.config.js`); the spec receives the flattened tuple, not a function. It calls `/qa/createDummyFirm.do` once per worker via Node `fetch` (deliberately NOT Playwright's `APIRequestContext`, see "fetch over APIRequestContext" quirk below).

---

## 3. Magic identifiers

All identifiers the spec/helpers depend on, with the home line they live in today and the Phase 2 target home.

| Identifier | Value | Where today | Why it's magic | Phase 2 target |
|---|---|---|---|---|
| `ADMIN_USERNAME` | `'tim106'` | `account-billing/_helpers.js:32` | Firm 106's GW Admin user. tim{firmCd} is the qa3 convention; firm 106 is the Plimsoll FP firm tyler belongs to. **Used only by `loginAsAdmin` which C25193 does not call** — but it stays exported for sibling specs in the same family. | `framework/src/data/constants/users.ts::PLIMSOLL_FP_ADMIN` |
| `NON_ADMIN_USERNAME` | `'tyler@plimsollfp.com'` | `account-billing/_helpers.js:33` | The Plimsoll FP non-admin advisor. Has a custom restricted role that `createDummyFirm.do` cannot provision. **Cannot be replaced by a worker-firm advisor.** | `framework/src/data/constants/users.ts::PLIMSOLL_FP_TYLER` + a documented quirk note |
| `SHARED_PASSWORD` | `process.env.TIM1_PASSWORD` | `account-billing/_helpers.js:37` | The shared password convention: tim1, tim106, tyler, every firm advisor — all share the same password. Resolved at module load time; throws if missing. Phase 0 Step 0.E discovered this hardcoded fallback. | `framework/src/config/credentials.ts` (env-driven, never hardcoded) |
| `CLIENT_UUID` | `'A80D472B04874979AAA3D8C3FFE9BD3A'` | `account-billing/_helpers.js:45` | The Arnold/Delaney household UUID on firm 106. Static seed data, not provisioned. | `framework/src/data/constants/firm106.ts::ARNOLD_DELANEY.clientUuid` |
| `ACCOUNT_UUID` | `'5588D454741342FBB9AABA8FF17A85EE'` | `account-billing/_helpers.js:46` | The Arnold/Delaney primary account UUID. Same seed data. | `framework/src/data/constants/firm106.ts::ARNOLD_DELANEY.accountUuid` |
| `ACCOUNT_BILLING_URL` | `/react/indexReact.do#/client/1/${CLIENT_UUID}/accounts/${ACCOUNT_UUID}/billing` | `account-billing/_helpers.js:47` | Hash route for the Arnold/Delaney Billing tab. The leading `1` is `entityTypeCd` (client = 1), NOT a firm code. | `AccountBillingPage.goto({ static: 'arnold-delaney' })` builds the URL from the constants above |
| Worker-firm equivalents | `workerFirm.client.uuid`, `workerFirm.accounts[0].uuid` | provided by `worker-firm.js::flattenFirm()` | Pulled from `/qa/createDummyFirm.do` response: `users[advisor].clients[household:5].clients[client:1].accounts[]`. The code skips orphan-account branches (advisors whose accounts have `hh:null`). | `framework/src/api/qa/DummyFirmApi.ts::DummyFirmResponse` Zod schema + `WorkerFirmFixture` |
| `STORAGE` (tim1.json) | `packages/legacy-poc/tests/.auth/tim1.json` | `worker-firm.js:39` | Storage state file produced by `globalSetup.js`. The worker-firm helper reads cookies from disk to drive `fetch()` directly. | `framework/src/fixtures/auth.fixture.ts` already writes to `<workspace>/.auth/tim1.json` (D-41 — single shared file across all team packages) |
| `BASE` (app URL) | `cfg.appUnderTest.url.replace(/\/$/, '')` | `worker-firm.js:40` | Reads from legacy `testrail.config.json::appUnderTest.url`. The legacy POC has no environment switching; the URL is hard-pinned to qa3. | `framework/src/config/environments.ts::env.baseUrl` (already plumbed) |
| Billing form selector ids | `#billingInceptionDate`, `#firstNameField`, `#lastNameField` | inline in helpers | Plain CSS id selectors. Section 4.10.6 notes the GeoWealth SPA has fewer than ten `data-testid` attributes, so these CSS hooks are the current contract. | Frontend D-05 rollout; until then `AccountBillingPage` uses the same `#billingInceptionDate` selector (documented as a known fallback per Section 4.7) |
| Edit modal copy | `'Edit Account Billing Settings'`, `'Account Billing Successfully Updated'`, `'Edit Billing Settings'` (button) | inline in helpers | Verbatim button/title text. These are user-facing strings — moderately stable but not contract. | Page Object exposes them as named locators (`editButton`, `editModalTitle`, `successModal`) so a copy change is one line in one place |
| History grid copy | `'History'` (button), `'Billing Settings History'` (modal title) | inline in `openHistory`/`closeHistory` | Same. **Not used by C25193** but loaded through the helper file. | `AccountBillingPage.historyButton` (named, even though C25193 will not call it post-port) |

---

## 4. Product quirks worked around

The legacy POC has accumulated a number of qa-environment- and frontend-implementation-specific workarounds. Each one is real load-bearing knowledge that the Phase 2 Component lift must preserve.

| # | Quirk | Where today | Workaround | Phase 2 Component owner |
|---|---|---|---|---|
| **Q1** | **react-date-picker swallows synthetic clicks**: filling the spinbuttons or the hidden input does NOT commit through React's controlled state — only clicking a day cell in the popup fires the onChange that Save picks up. | `_helpers/ui.js:36-104` (`setReactDatePicker`) | Open the popup by dispatching a full `mousedown`/`mouseup`/`click` MouseEvent burst on `button.react-date-picker__calendar-button`, retry until `.react-calendar` is visible (`expect.poll` with intervals 100/200/400/800ms, 5s budget). Then navigate the calendar header by clicking prev/next until the displayed month-year matches, and click `abbr[aria-label="<Month> <Day>, <Year>"]`. | `framework/src/components/ReactDatePicker.ts` |
| **Q2** | **calendar opens to "today" when picker is empty**: when the date picker has no value, the spinbuttons render empty but the popup still opens at the current month. The navigation loop must read the month from `.react-calendar__navigation__label` rather than from the picker's own state. | `_helpers/ui.js:80-97` | Read `navLabel.textContent()`, parse via `new Date('Month 1 UTC')`, compute month-diff against the target, click prev/next accordingly. Safety bound: 240 iterations (≈20 years either direction). Throws on stuck nav. | Same Component class |
| **Q3** | **summary card uses sibling-axis layout, not labelled-input**: the displayed Billing Inception Date is rendered as `<text>Billing Inception Date</text>` followed by a sibling element holding the value. There is no label/input pairing; `getByLabel` returns nothing. | `account-billing/_helpers.js:179-185` (`getDisplayedBillingInceptionDate`) | `page.locator('text=Billing Inception Date').first().locator('xpath=following-sibling::*[1]').innerText()`. Single XPath sibling step; documented per Section 4.7 as a justified rung-5 selector. | `AccountBillingPage.displayedInceptionDate` Locator (XPath documented inline) |
| **Q4** | **Edit modal form is fetched async after the title appears**: clicking "Edit Billing Settings" surfaces the modal title `Edit Account Billing Settings` immediately, but the form content (date pickers, radios, dropdowns) is fetched asynchronously and only renders when the Save button appears. Touching form fields before Save is visible triggers selector-not-found races. | `account-billing/_helpers.js:113-124` (`openEditBillingSettings`) | After the title becomes visible, additionally wait for `getByRole('button', { name: 'Save', exact: true })` to be visible (30s timeout — the form fetch can be slow under load). | `AccountBillingPage.openEditModal()` encapsulates both waits |
| **Q5** | **Save flow has a two-step modal dance**: clicking Save closes the Edit modal AND opens a "Account Billing Successfully Updated!" success modal that must be explicitly dismissed via Close. Skipping the Close leaves the success modal in the DOM and the next assertion races against an old DOM. | `account-billing/_helpers.js:126-137` (`saveEditBillingSettings`) | Click Save → wait for success modal text → click Close → assert success modal is hidden. | `AccountBillingPage.saveEditModal()` |
| **Q6** | **post-save value is not immediately visible on the summary card**: even after Save returns and the success modal closes, the summary card may briefly still show the old value while the React Query cache invalidates. A direct `expect(...).toHaveText(newDate)` races. | `C25193.spec.js:92-96, 112-116` (uses `expect.poll`) | `expect.poll(async () => (await getDisplayedBillingInceptionDate(page)).trim(), { timeout: 15_000 }).toBe(newDate)`. Polling smooths over the cache lag. | When the framework wires `__REACT_QUERY_CLIENT__` (D-08, Phase 2 dependency), this can be replaced by `await page.waitForFunction(() => (window as any).__REACT_QUERY_CLIENT__.isFetching() === 0)` followed by a single `expect(...).toHaveText(newDate)`. Until then the polling stays. |
| **Q7** | **Tyler cannot be substituted with a dummy-firm advisor**: empirically verified that `adv_<firmCd>_1` from `createDummyFirm.do` has full billing edit rights, while tyler has a Plimsoll-FP-specific restricted custom role. `createDummyFirm.do` has no `permissions` parameter to provision a restricted role. | `C25193.spec.js:47-53` (comment block) | Hybrid isolation: Phase 1 (write/read) on worker firm; Phase 2 (read-only button-visibility check) **stays** on the shared firm 106 + tyler. Read-only access cannot race under parallel load. | `framework/src/fixtures/auth.fixture.ts::tylerPage` is a per-test fixture against firm 106; the `WorkerFirmFixture` is unrelated. The spec consumes both. |
| **Q8** | **post-login URL differs across qa branches**: tim1 lands on `#dashboard` on some qa branches and `#platformOne` on others. tyler lands on `#dashboard`. The dummy firm admin lands on either. | `account-billing/_helpers.js:62-68, 90-94` | All login helpers assert `/#(dashboard\|platformOne)/` rather than a single specific hash. | The framework's auth fixture already handles this via the DOM-signal race in preflight (`d17459d`). |
| **Q9** | **`fetch` over `APIRequestContext` for the dummy-firm endpoint**: creating a Playwright `APIRequestContext` inside a worker fixture conflicts with the worker's trace artifact cleanup — silent ENOENTs on `.trace` and `.network` files surface much later as `apiRequestContext._wrapApiCall` errors. The legacy worker-firm uses Node's built-in `fetch` with cookies pulled from the storage state file. | `_helpers/worker-firm.js:60-88` (`createDummyFirm`) | Read `tim1.json` storage state → build a single `Cookie:` header → `fetch(BASE + ENDPOINT, { method: 'POST', headers: { Cookie: ... } })`. Parse JSON manually; throw on `success: false` or non-JSON body. | **Phase 2 design decision needed.** D-42 says the API client accepts a Playwright `APIRequestContext` from the caller; the legacy quirk suggests doing that *inside the worker fixture* may regress. The framework's `WorkerFirmFixture` (Phase 2 step 3) should reproduce the legacy `fetch`-based approach, OR the trace-cleanup race must be re-verified against current Playwright. **Open question for the Phase 2 work order step 1 author.** |
| **Q10** | **`createDummyFirm.do` response shape: nested users → households → clients → accounts**: the response nests as `users[advisor].clients[household:entityTypeCd=5].clients[client:entityTypeCd=1].accounts[]`. Top-level `clients` entries with `entityTypeCd:5` are households; their nested `clients` with `entityTypeCd:1` are real clients. Some advisors have orphan accounts (`hh:null`) that must be skipped because nearly every Pepi test needs a household + client + account triplet. | `_helpers/worker-firm.js:103-126` (`flattenFirm`) | Walk the tree, filter to `entityTypeCd === 5` then `=== 1`, drop tuples with empty `accounts`, return the flat list. The first usable tuple is hoisted to the top-level fields for convenience. | `framework/src/api/qa/DummyFirmApi.ts` Zod schema + a `flatten()` method on the typed response. **Phase 2 work order step 1 deliverable.** |
| **Q11** | **`raw.firm.firmCd`, `raw.adminUser.loginName`, `raw.adminUser.entityId` are top-level**: separate from the nested users tree. The legacy `setupWorkerFirm()` reads them directly. | `_helpers/worker-firm.js:155-172` | Direct property access on the parsed JSON. | Same Zod schema must include these top-level fields. |
| **Q12** | **dummy firms accumulate by design — no teardown**: per Section 5.8 of the proposal, dummy firms are never deleted. Each worker creates one per nightly, multiplied by 8 workers × N nights × 2 envs = real growth. Platform team has agreed quarterly review of growth. | `_helpers/worker-firm.js:10` (comment) | None — accumulation is the contract. | Same — `framework/src/fixtures/workerFirm.fixture.ts` does not implement a teardown hook. |

---

## 5. Cross-cutting observations

### O1 — `_helpers/ui.js` is wider than C25193 needs
The legacy ui.js exports 10 symbols. C25193 uses **only** `setReactDatePicker`. The other nine (`setComboBoxValue`, `setReactNumericInput`, `selectFirmInTypeAhead`, `validationErrorRegex`, the five ag-grid helpers) are pulled in by sibling specs and ride along through the shared `account-billing/_helpers.js`. Phase 2 step 4 (Component lift) lifts **all five** Components — not just `ReactDatePicker` — because the rest of the account-billing family will need them in Phase 4. C25193 itself is the simplest possible consumer of `ReactDatePicker`.

### O2 — `account-billing/_helpers.js` is multi-spec scaffolding, not C25193-specific
14 exports, of which C25193 calls 8. The other 6 (`historyRow`, `openHistory`, `closeHistory`, `loginAsAdmin`, `setComboBoxValue`, `setReactNumericInput`) are for the C25194..C25249 family. **The Phase 2 Page Object (`AccountBillingPage`) must absorb all of these**, not just the ones C25193 touches, because the deletion PR (Phase 4 cohort) will retire the helper file as a whole.

### O3 — `loginPlatformOneAdmin` (the resilient version) is NOT used by C25193
C25193 uses the basic `login()` from `qa3.js`, which is the URL-pattern variant that broke preflight on qa2/qa4 (fixed in `d17459d`). The resilient DOM-signal race (`loginPlatformOneAdmin`, lines 59-86 of `qa3.js`) was added later for tests that needed it. **The Phase 2 `auth.fixture` should use the resilient pattern unconditionally**, mirroring the preflight fix. C25193's port should not be the first place where the basic pattern survives — the basic variant is dead code post-port.

### O4 — Storage state path mismatch between legacy and framework
- Legacy worker-firm reads `packages/legacy-poc/tests/.auth/tim1.json` (legacy-poc-scoped).
- Framework auth fixture writes `<workspace>/.auth/tim1.json` (workspace-root, D-41).

These are intentionally different so the legacy POC can keep running after Phase 2. The C25193 port reads from the workspace-root path; the legacy spec keeps reading the legacy-poc path. **No code change needed — they coexist by path, not content.**

### O5 — `project_billing_form_quirks` memory is stale on this clone
The proposal (Section 4.10.3 line 644 and Section 6.4 line 1058) references a `project_billing_form_quirks` memory containing the Commission Fee combo CDP-click discovery and similar quirks. **This memory does not exist in `~/.claude/projects/-Users-petarpetrov-automation-geo-tests/memory/` on the home machine** (the directory itself is missing). The Component lift will rediscover those quirks empirically as it ports each helper; the spike notes the gap as an information loss between the two machines. Re-creating the memory directory and re-capturing the quirks is a Phase 2 sub-task.

---

## 6. Phase 2 work order — recommended sequencing for C25193 specifically

This refines Section 6.4.1 (D-37) for the C25193-specific subset. The full Phase 2 work order covers all 5 Components; this is the C25193 critical path.

| Step | Deliverable | Depends on | Notes |
|---|---|---|---|
| 1 | `framework/src/api/qa/DummyFirmApi.ts` + Zod schema + `flatten()` | nothing internal | Open question Q9: decide whether the framework `WorkerFirmFixture` uses Playwright `APIRequestContext` or Node `fetch`. Recommend starting with `APIRequestContext` per D-42 and falling back to `fetch` only if the legacy trace-cleanup race reproduces against current Playwright. |
| 2 | `framework/src/data/constants/firm106.ts` (Arnold/Delaney UUIDs, Plimsoll FP users) | nothing | Pure data; one PR. |
| 3 | `framework/src/fixtures/workerFirm.fixture.ts` | step 1 | Mirror legacy `setupWorkerFirm()`; emit the same flattened shape. |
| 4 | `framework/src/fixtures/auth.fixture.ts::tylerPage` | nothing internal | Per-test scope; uses the resilient login pattern from O3. |
| 5 | `framework/src/components/ReactDatePicker.ts` | nothing internal | Lift `setReactDatePicker` from `_helpers/ui.js` verbatim into a class. Smoke spec under `framework/tests/components/ReactDatePicker.spec.ts` exercises the day-cell click on a known qa2 page. **Q1+Q2 must be preserved exactly** — the dispatch-burst loop and the 240-iteration calendar nav bound. |
| 6 | `tests-billing-servicing/src/pages/account-billing/AccountBillingPage.ts` | steps 2, 5 | Absorbs **all 14** legacy helper exports per O2, not just C25193's 8. Selectors per the magic-identifier table above. Quirks Q3, Q4, Q5, Q6 encapsulated in the methods. |
| 7 | `tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts` | steps 1, 3, 4, 5, 6 | The graduation port. Same two-phase shape as the legacy spec; consumes `workerFirm` (via fixture), `tylerPage` (via fixture), `accountBillingPage` (via fixture), and the 5 Component classes (via the page). **Must merge in week 1 of Phase 2 per Section 6.4.1 step 5** so the 5-night gating window runs in parallel with the rest of Phase 2. |

---

## 7. Definition of done (for this spike, not for the port)

- [x] Every helper module imported by C25193 has been read in full (4 files, 986 lines total).
- [x] Every magic identifier used by C25193 (directly or transitively) is enumerated with its current home and Phase 2 target home.
- [x] Every product quirk worked around is named, located, and assigned a Phase 2 Component owner.
- [x] Cross-cutting observations (O1–O5) capture the things that are not specific to C25193 but matter for the Phase 2 work order.
- [x] The C25193-specific work order in §6 is consistent with the global Phase 2 work order in proposal §6.4.1 (D-37) and adds spec-level granularity, not new direction.

## 8. Open questions surfaced for Phase 2 step 1

**OQ-1.** Should the framework `WorkerFirmFixture` use Playwright `APIRequestContext` (per D-42) or Node `fetch` (per the legacy quirk Q9)? Re-verify the trace-cleanup race against current Playwright (1.59.x) before committing to either path.

**OQ-2.** Does the `project_billing_form_quirks` memory on the old machine (192.168.1.223) have additional quirks not surfaced by reading the source files alone? Pull it (or its equivalent on disk) before Phase 2 step 4 begins.

**OQ-3.** Is the `__REACT_QUERY_CLIENT__` window exposure (D-08) committed by the frontend team for Phase 2 entry? If yes, Q6's polling can be replaced with a single deterministic wait. If no, the polling stays — and that becomes a permanent shape of the Page Object.

These questions do not block this spike — they block the *port*. They are recorded here so the Phase 2 step 1 author has them in front of them.
