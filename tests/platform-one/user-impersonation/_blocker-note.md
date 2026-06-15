# Platform One — User Impersonation (remaining fixme'd specs)

The Tier-1 / Tier-2 / Tier-3 split in the previous revision of this note has
been collapsed: most of the section 2332 cases are now green. This file
captures the residual fixme'd specs and exactly what each needs.

## Pending external action (will be turned green once unblocked)

| Case | Title | Blocker |
|---|---|---|
| C26425 | Menu NOT visible without permission (Negative) | Requires a firm 1 user **without** `IMPERSONATE_EMPLOYEE` (`82_5`). Currently the `All Employees` role (`529`) carries the permission, so every firm 1 user — including the worker `gwa{N}` admins — sees the Impersonate link. Unblock: toggle off Impersonation on the All Employees managed role in BO (Manage Roles → All Employees → uncheck Impersonation → save). Then `gwa0` becomes a faithful "site 1 user without Impersonation" target and the negative passes as-is. |
| C26479 | Direct URL blocked for unauthorized (Negative) | Same unblock as C26425 — when `gwa0` no longer carries the permission, the route guard in `Router.js` skips registration and direct nav lands on an empty content area. |
| C26451 | Session & audit behaviour (Positive) | The audit-log assertion needs Oracle access. The action log table for impersonation events (Admin ID, Impersonated ID, Timestamp) needs confirmation — once the table name + a sample query are known, drop a python3 oracledb probe like the helpers in `tests/_helpers/qa3.js` and assert one row exists for the just-completed impersonation cycle. Until then, C26449/C26450 cover the launch + terminate mechanics. |

## Confirmed fixme (won't be automated by this suite)

| Case | Title | Why not |
|---|---|---|
| C26452 | Failure to create impersonated session (Negative) | TestRail step 7 is literally "Stop the useragents before user impersonation". That's a Jenkins / ops action with no Playwright surface. If a Jenkins job ID for the stop sequence becomes available, this could be revisited as a fixture-style precondition; the user's call (2026-06-10) is to leave this as fixme with this note. |
| C26480 | Load performance for large firms (Non-functional) | Acceptance is "no worse than current loading time" — needs a defined baseline + a designated large firm + a perf budget. Belongs to a dedicated perf job, not the @pepi smoke run. |
| C26481 | Search/filter performance for large firm (Non-functional) | Same as C26480 — needs typing-latency budget + large firm fixture. |

## What's currently green

C26424, C26426, C26427, C26436, C26437, C26438, C26445, C26446, C26447,
C26448 (Tier 1 page surface),
C26449, C26450 (impersonation launch + terminate from P1),
C26453 (cross-browser concurrent session),
C26477 (BO entry page accessibility),
C26482, C26483 (firm-specific landing — Manager Portal / Advisor Portal),
C26596, C26597, C26598 (AP entry — Directories → Non-Customer Contacts →
User Actions → Impersonate flow + terminate).
