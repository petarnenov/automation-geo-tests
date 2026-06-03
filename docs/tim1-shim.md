# tim1 shim — how to skip GW Admin provisioning in `globalSetup`

## Why this exists

`tests/_helpers/global-setup.js` normally:

1. Logs in `tim1`, saves `tests/.auth/tim1.json`.
2. Creates 8 fresh GW Admin users in firm 1 by POST-ing `/platformOne/createUpdateUser.do` (the `createGwAdmin` helper in `tests/_helpers/qa3.js`).
3. Disables their MFA by running a direct Oracle UPDATE against `dbhost:1521/ORCL12VM`.
4. Logs in each GW Admin and saves their cookies into `gwadmin-{0..7}.json`.

Step 2/3 fails in a handful of real-world envs:

- **qa7** — the MFA-disable UPDATE hard-codes the `dbhost` DSN, but qa7's Oracle lives under the `vdb` domain. The UPDATE silently no-ops against the wrong DB, the GW Admin keeps `mfa_required_flag=1`, and login waits 60 s for `#platformOne` that never lands.
- **qa4 Atomatron flakes** — `createUpdateUser.do` periodically returns `success=false` with an internal Atomatron worker stacktrace, even though the same user/firm setup is healthy minutes later.
- **Any env without dbhost reachability** — the MFA-disable shell-out simply fails.

When that happens, the **shim** swaps all 8 per-worker storage states out for copies of `tim1.json`, so every Playwright worker just acts as `tim1`. The merge-prospect / account-billing / account-settings groups all work this way because they re-authenticate inside the spec body, or because `tim1` already has the permissions they exercise.

## File layout

```
tests/.auth/
├── tim1.json            ← refreshed by globalSetup every run
├── gwadmin-0.json       ← shim copy of tim1.json (× 8 worker slots)
├── gwadmin-1.json
├── …
├── gwadmin-7.json
└── gwadmins.json        ← index loaded by loadCachedAdmins()
```

> `tests/.auth/` is in `.gitignore` — these files live only on the dev box.

## What `loadCachedAdmins()` validates

The shim only survives if `gwadmins.json` passes every check in `tests/_helpers/global-setup.js` → `loadCachedAdmins()`:

1. File exists and parses as JSON.
2. Has a `createdAt` ISO timestamp **less than 6 hours old**.
3. `admins` array has **exactly 8** entries.
4. `baseUrl` matches `cfg.appUnderTest.url` **exactly**, including the trailing slash.
5. Every `admin.storageStatePath` points at a file that exists.

If any check fails, `globalSetup` falls back to the real GW Admin provisioning, which is what you're trying to skip — so all five must hold.

## Required JSON shape

`tests/.auth/gwadmins.json`:

```json
{
  "createdAt": "2026-06-03T15:30:00.000Z",
  "baseUrl": "https://qa4.geowealth.com/",
  "admins": [
    {
      "userId": "fake-0",
      "username": "tim1",
      "password": "c0w&ch1k3n",
      "emailAddress": "tim1@geowealth.com",
      "firstName": "tim1",
      "lastName": "GWAdmin",
      "storageStatePath": "/home/petar/automation-geo-tests/tests/.auth/gwadmin-0.json"
    }
    // … 7 more entries, indices 1..7, identical except for the indexed paths
  ]
}
```

Key constraints:

- `baseUrl` must equal `cfg.appUnderTest.url` (from `testrail.config.json`). Switching envs means rewriting this field.
- `username` must be `tim1` (or whatever `cfg.appUnderTest.username` is). `global-setup.js` detects "shim mode" by checking that **every** admin's `username` matches `cfg.appUnderTest.username` and only then auto-resyncs the per-worker files (see "Auto-refresh" below).
- `storageStatePath` must be an absolute path, or at least one Node can `fs.existsSync()` from the test working directory.
- The 8 per-worker files (`gwadmin-{0..7}.json`) must exist before the first test starts. The simplest seed is a copy of `tim1.json` — globalSetup will refresh them on the first run.

## Bootstrap recipe

From the repo root, after at least one successful `tim1` login (which leaves `tim1.json` behind):

```bash
cd ~/automation-geo-tests

# 1. Seed 8 per-worker storage states from the current tim1.json
for i in 0 1 2 3 4 5 6 7; do
  cp tests/.auth/tim1.json tests/.auth/gwadmin-$i.json
done

# 2. Write the index. Match `baseUrl` to whatever `testrail.config.json` points at.
node -e '
const fs = require("fs");
const path = require("path");
const cfg = JSON.parse(fs.readFileSync("testrail.config.json", "utf8"));
const tim1Path = path.resolve("tests/.auth/tim1.json");
const baseDir = path.resolve("tests/.auth");
const admins = Array.from({ length: 8 }, (_, i) => ({
  userId: `fake-${i}`,
  username: cfg.appUnderTest.username,
  password: cfg.appUnderTest.password,
  emailAddress: `${cfg.appUnderTest.username}@geowealth.com`,
  firstName: cfg.appUnderTest.username,
  lastName: "GWAdmin",
  storageStatePath: path.join(baseDir, `gwadmin-${i}.json`),
}));
fs.writeFileSync(
  "tests/.auth/gwadmins.json",
  JSON.stringify(
    { createdAt: new Date().toISOString(), baseUrl: cfg.appUnderTest.url, admins },
    null,
    2,
  ),
);
console.log("wrote tests/.auth/gwadmins.json for", cfg.appUnderTest.url);
'

# 3. Verify
npx playwright test --grep "smoke" --workers=1   # any spec works
```

If `tim1.json` doesn't exist yet, run any `playwright test` invocation once — `globalSetup` step 1 creates it before it tries to create GW Admins. The provisioning step that follows will fail in the same env that needs the shim, but `tim1.json` will already be on disk and you can build the shim around it.

## Auto-refresh — what `globalSetup` does for shims

Stale per-worker cookies were the root cause of the qa4 "Merge With Prospect" disappearance (see commit `b8159a4`): `globalSetup` always refreshes `tim1.json`, but it left the per-worker `gwadmin-N.json` files frozen at whatever JSESSIONIDs they had when the shim was first laid down. After ~30 minutes those cookies expire, the worker fixture falls back to the UI login flow, and the resulting session is missing the permission map needed by SPA gates like `hasPermissionToMergeProspects`.

`global-setup.js` now self-heals:

```js
const shimmed = cached.every((a) => a.username === cfg.appUnderTest.username);
if (shimmed) {
  // every gwadmin-N.json gets overwritten with the fresh tim1.json
}
```

You'll see the log line on every run that hits the shim path:

```
[global-setup] shim detected — refreshed 8 per-worker storage state(s) from tim1.json
```

If you don't see it, the shim isn't being recognized — usually because at least one `admin.username` is something other than `tim1`. Fix the index and re-run.

## Switching envs without losing the shim

1. Edit `testrail.config.json` → `appUnderTest.url` to the new env (e.g. `https://qa7.geowealth.com/`).
2. Edit `tests/.auth/gwadmins.json` → `baseUrl` to **the same** value.
3. Delete `tests/.auth/tim1.json` so the next run logs `tim1` fresh against the new env (the auto-refresh will then push that into the per-worker files).
4. Run any spec. Confirm the log says `shim detected — refreshed 8 …`.

If you skip step 3, the next run reuses the previous env's `tim1.json` and the workers will fail their first request with a 302 to `/login`, fall back to UI login, and the auto-refresh will catch up on the run after that — annoying but not fatal.

## When to **not** use the shim

- **You are testing GW Admin–specific flows** (User Management, Edit User modal, anything where `loggedUser.gwAdminFlag` is checked). Real GW Admins have all permissions auto-granted; `tim1` does not. The shim works for merge-prospect / account-billing / account-settings because `tim1` happens to have the right permissions in firm 1 already.
- **You explicitly want to assert "permission disabled" branches** (e.g. C26060 / C26085). The shim hides those branches behind `tim1`'s effectively-omnipotent permissions.

For everything else in the `@pepi` scope today, the shim is the path of least resistance whenever `createGwAdmin` is broken.
