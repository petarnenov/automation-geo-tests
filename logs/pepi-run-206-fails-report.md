# @pepi Run 206 — Failure Report

**Run:** TestRail run 206 (Billing&Services Regression 2026-04 / 2) on qa4
**Suite totals:** 81 passed · 13 failed · 3 skipped · 8.7 min (8 workers, parallel)
**Log:** `logs/pepi-run-206-v2.log`

## TL;DR

13 fails clustered into **4 root causes**:

| # | Group | Tests | Root cause |
|---|---|---|---|
| A | account-billing login | 6 | Shared `login()` helper doesn't dismiss the qa4 "password expires in 9 days" Warning modal (same modal global-setup now handles) |
| B | upload toast missing | 3 | `imported successfully` toast never rendered within 180s — toast contention under parallel load |
| C | HH Billing Settings click timeout | 2 | A click in `_helpers/qa3.js:260` exceeded 240s — HH Settings page hangs under parallel load |
| D | advisor view missing new account | 2 | Newly-created account UUID not visible in advisor's account list within 30s |

**6 of 13** share the SAME root cause as today's global-setup fix and need a 3-line patch in one helper.

---

## Group A — account-billing login redirects back to `#login` (6 tests)

**Cases:** C25196, C25200, C25206, C25207, C25249, C26490
**Symptom (identical for all 6):**

```
Error: expect(page).toHaveURL(expected) failed
Expected pattern: /#dashboard|#platformOne/
Received string:  "https://qa4.geowealth.com/react/indexReact.do#login"
Timeout: 30000ms
```

**Trigger:** All 6 specs open Phase 1 with `loginAsAdmin(context, page)` → `loginAs()` → `login()` (in `tests/_helpers/qa3.js:24`). After the Login click, the spec immediately asserts the landing URL — but on qa4 the password-expiry Warning modal renders and *blocks* the SPA redirect. The URL stays on `#login` until the X (`svg#circle_close_btn`) is clicked.

This is the **same modal** that broke global-setup today. global-setup is patched (`dismissPasswordWarning` helper); the shared `login()` helper is not.

**Fix (recommended):** add the same dismiss call inside `tests/_helpers/qa3.js login()` immediately after the Login button click. One change covers every spec that uses `login()`, not just account-billing.

```js
// in tests/_helpers/qa3.js after await getByRole('button', { name: 'Login' }).click();
await page.locator('#circle_close_btn').click({ timeout: 4000 }).catch(() => {});
```

---

## Group B — upload "imported successfully" toast never appears (3 tests)

**Cases:** C25364 (bucket-exclusions), C26074, C26075 (unmanaged-assets)
**Symptom:**

```
Error: expect(locator).toBeVisible() failed
  Locator: getByText(/imported successfully/i).first()
  Expected: visible
  Timeout: 180000ms  (C26074, C26075) — C25364 hit test-level timeout
  Error: element(s) not found
  at _helpers/qa3.js:208
```

**Trigger:** `_uploadExclusionsXlsx` / `uploadUnmanagedAssetsExclusions` waits 180s for the toast, doesn't get it. Matches the documented **C25441 load flake** pattern (`project_c25441_load_flake.md`): the toast is reliable solo but contended under the full parallel @pepi run. Three of these uploads happening at once on qa4 push past the 180s budget.

**Options:**
- Rerun the 3 specs in isolation to confirm flake (probably green).
- Lengthen the wait to 240s.
- Serialize uploads through a mutex (heaviest fix).

---

## Group C — HH Billing Settings click hangs (2 tests)

**Cases:** C25790, C25792 (bucket-exclusions, both "Phase 2: HH Billing Settings…")
**Symptom:**

```
Error: locator.click: Test timeout of 240000ms exceeded.
  at _helpers/qa3.js:260
```

**Trigger:** A click inside the HH Billing Settings flow (qa3.js:260) blocked for 240s — same kind of qa4 backend slowness as Group B, hitting a different surface (HH page render instead of upload toast). Per-spec retries (Phase 2 uses tyler on firm 106) probably racing against Phase 1 workers on the same shared firm.

**Action:** Rerun solo to distinguish "qa4 transient" vs "structural deadlock with another worker".

---

## Group D — Advisor's account list doesn't show new account (2 tests)

**Cases:** C24940 (Create new account manually), C24943 (Create new account using upload)
**Symptom:**

```
Error: expect(locator).toBeVisible() failed
  Locator: getByText('PA1781002284173').first()      // C24940
  Locator: getByText('PUA1781002295471').first()     // C24943
  Expected: visible
  Timeout: 30000ms
  Error: element(s) not found
```

**Trigger:** Both fail at the "Switch to advisor, verify account appears under the client" step — the advisor session loads, the test searches for the newly-created account ID, doesn't find it within 30s. Two plausible causes:

- **Replication / search-index lag** on qa4: account exists in DB but isn't indexed for the advisor's account-tree yet.
- **Advisor login hit the same Warning modal** as Group A, so the page being asserted on is `#login` not the account tree (but the error message says element not found, not URL mismatch — so probably indexing, not login).

**Action:** Add a short retry/poll for the locator (e.g. 60s instead of 30s) or trigger a page reload between create and verify.

---

## Recommended next steps

1. **Fix Group A** by adding `await page.locator('#circle_close_btn').click({ timeout: 4000 }).catch(() => {});` inside `tests/_helpers/qa3.js login()`. Single 3-line patch unblocks 6 tests deterministically.
2. **Rerun the remaining 7** (Groups B/C/D) in isolation — most are documented qa4 load flakes (Group B matches `project_c25441_load_flake.md`), expect 4-6 of them to go green solo.
3. **Investigate Group D's 30s wait** — extend to ~60s and/or add a reload; if still flaky, treat as a qa4 indexing-lag bug, not a test issue.
