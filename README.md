# GeoWealth regression suite

Playwright end-to-end tests for the GeoWealth app, tagged `@regression`.
Results of green tests are reported to the AIO Tests cycle in Jira.

Everything an operator needs goes through `make`:

```
make help
```

## 1. First-time setup

You need **Node 24** (the version in `.nvmrc`) and, for the OCI databases
(qabis1 and friends), **Oracle Instant Client** — see _Database access_ below.
Without Node, or with the wrong version, `make setup` / `make doctor` stop
and print the install commands for your OS (nvm, Homebrew on macOS,
NodeSource on Debian/Ubuntu and Fedora/RHEL).

```bash
make setup
```

`make setup` runs `npm ci`, downloads Playwright's Chromium, creates
`.env.local` from `.env.example` if it is missing, and ends with
`make doctor`. Fix whatever doctor still marks with ✘.

### `.env.local`

Gitignored, never committed. Fill in at least:

| Variable                 | What it is                                                                 |
| ------------------------ | -------------------------------------------------------------------------- |
| `TIM1_USERNAME`          | Platform One admin of the env under test                                   |
| `TIM1_PASSWORD`          | its password (also used by dummy-firm users and `timN`)                    |
| `GEO_DB_USER`            | Oracle user for the direct-DB helpers                                      |
| `GEO_DB_PASSWORD`        | its password                                                               |
| `GEO_TEST_USER_PASSWORD` | password the suite sets on users it creates (upper, lower, digit, special) |

`.env.example` documents the optional ones.

### AIO token

Generate an API token in AIO Tests and save it:

```bash
echo '<token>' > ~/.aio-tests-token
```

(or set `AIO_TOKEN` in `.env.local`).

### Database access (OCI envs only)

The OCI databases enforce Oracle Native Network Encryption, so the DB
helpers need thick mode, and they are reachable only through an SSH bastion.
Add to `.env.local`:

```bash
# Oracle Instant Client directory (switches node-oracledb to thick mode)
ORACLE_CLIENT_LIB=~/oracle/instantclient_23_26

# SSH tunnel to the DB; make test starts it when it is down
DB_TUNNEL_HOST=<bastion address>
DB_TUNNEL_USER=<bastion login>
DB_TUNNEL_KEY=~/.ssh/<private key>
DB_TUNNEL_CERT=~/<ssh certificate>.pub
DB_TUNNEL_FORWARD=1821:qadb:1521
GEO_DB_DSN=localhost:1821/<service name>
```

Without `ORACLE_CLIENT_LIB` the helpers run in thin mode, which is enough
for the on-prem QA databases (qa4, qa5...).

## 2. Check the machine

```bash
make doctor
```

```
Doctor
  ✔ Node                 v24.21.0 (needs >=24 <25)
  ✔ npm packages         installed, matches package-lock.json
  ✔ Playwright browser   ~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
  ✔ Oracle driver        oracledb 7.0.1, thick, client 23.26.2.0.0
  ✔ .env.local           5 required credentials set
  ✔ AIO token            ~/.aio-tests-token
  ✔ Oracle client        ~/oracle/instantclient_23_26
  ✔ DB tunnel            ssh ok, key files present
  all good
```

Every ✘ line is followed by the command that fixes it. `make test` runs
doctor first and stops if anything is missing.

## 3. Run the suite

```bash
make test                         # whole @regression suite
make test RUNAS=pepi              # say up front who the run is for
make test random 5                # 5 tests picked at random
make test ARGS="tests/billing-runs --workers=2"
make test ARGS="-g C25017"        # one TestRail case id
```

What happens:

1. **Doctor** checks the machine.
2. **Who is it for?** Pick a person from `aio.config.json` → `assignees`
   (or pass `RUNAS=<key>`). Every reported result is assigned to them and
   the comment names them. There is no default.
3. **Configuration** — app URL, DB, AIO cycle, what greens will get.
4. **Confirm the run** — default **No**.
5. The DB tunnel is started if it is configured and down.
6. **Playwright runs.** Nothing is posted yet; green results are saved to
   `test-results/aio-pending.json`.
7. **Confirm the AIO post** — default **Yes**. Only green tests are
   posted, as `Passed`, to the cycle in `aio.config.json`. Cases that are
   not in the cycle are skipped with a warning.

Declined the post, or it failed? Post the saved results later:

```bash
make aio-post
```

## Results

```bash
npx playwright show-report        # HTML report of the last run
```

Failures keep a screenshot and a video under `test-results/`.

## Switching environment

- **App** — `appUnderTest.url` in `testrail.config.json`.
- **DB** — derived from the app URL, or forced with `GEO_DB_DSN` in
  `.env.local`.
- **AIO cycle** — `aio.cycleKey` in `aio.config.json`.

`make config` shows what the next run will use.

## Troubleshooting

- **Many reds on a full run** — usually load from 8 parallel workers.
  Re-run the reds with `ARGS="... --workers=2"` before investigating.
- **Do not pass `--reporter=` in `ARGS`** — it replaces the reporters from
  `playwright.config.js` and silently drops the AIO reporter.
- **DB helper errors** (`ORA-…`, `DPI-…`) — run `make doctor`, then
  `make tunnel` to see whether the tunnel comes up.
