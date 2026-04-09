# Phase 0 Step 0.E — Git History Secrets Audit

| Field | Value |
|---|---|
| **Date** | 2026-04-09 |
| **Branch** | `feat/corporate-e2e-migration` |
| **Performed by** | QA Automation (acting Program Owner / Security counterpart) |
| **Tool** | `grep` + `git log -S` (custom audit; see "Tooling note" below) |

## Tooling note

Section 6.2 Step 0.E of the proposal calls for `detect-secrets` (a Python tool from Yelp). The tool was not installed and could not be installed during the solo phase:

- `pipx install detect-secrets` — `pipx` not present.
- `pip install --user detect-secrets` — blocked by PEP 668 system protection (Debian/Ubuntu Python).
- `python3 -m venv` — blocked because `python3-venv` package not installed (would need `sudo apt install python3.12-venv`).

Plan permits "`detect-secrets` or equivalent". The equivalent used here is a **manual `grep` + `git log -S` scan** for the known secret literal plus a broader sweep for password-assignment patterns. This is appropriate for the legacy POC's small surface area (one known secret) but is **not as thorough** as `detect-secrets` would be against high-entropy strings or non-obvious patterns. **Follow-up:** install `detect-secrets` properly during Phase 1 (it can be added as a workspace devDep via Docker / pipx / venv once one of those is available) and re-run as part of CI's pre-commit hook.

## Findings

### Working tree (after Step 0.C)

```bash
$ grep -rn 'c0w&ch1k3n' . --include='*.json' --include='*.js' --include='*.ts' --include='*.md' --include='*.mjs' --include='*.cjs'
./packages/legacy-poc/tests/account-billing/_helpers.js:34:const SHARED_PASSWORD = 'c0w&ch1k3n';
```

**One hit.** This is a Step 0.C miss: my Step 0.C inventory was scoped to `grep -rn "testrail.config" packages/legacy-poc/`, which found every file that loaded the JSON config but missed this **second hardcoded copy** of the same password in a helper file. The helper uses it as `SHARED_PASSWORD` for `tim106` (admin firm 106) and `tyler@plimsollfp.com` (non-admin) login flows — both follow the same shared-password convention as `tim1`, so the value is identical to `TIM1_PASSWORD`.

**Remediation in this commit (Step 0.E):**
- `packages/legacy-poc/tests/account-billing/_helpers.js` line 34 is refactored to read from `process.env.TIM1_PASSWORD` with a fail-fast check, mirroring the Step 0.C pattern in the other helpers.
- After this fix, the working tree contains zero literal occurrences of `c0w&ch1k3n`.

### Broader sweep (working tree)

```bash
$ grep -rni "password" packages/legacy-poc --include='*.js' --include='*.json' 2>/dev/null \
  | grep -v "process.env|getByPlaceholder|placeholder|comment|note|fill(|TIM1_PASSWORD|workerFirm.password|loginAs.*PASSWORD|firm.password|admin.password|advisor.password" \
  | grep -E "=.*['\"]"
```

Zero results after the helpers.js fix above. No other password-like literals in the working tree.

### Git history

```bash
$ git log --all --oneline -S 'c0w&ch1k3n'
348988d phase-0(step-0.C): POC env-var refactor
978b222 feat create mini framework
d39b03d test(pepi): extract reusable UI primitives into shared mini-framework
```

Three commits in the history touched the secret string:

| Commit | Action | Path |
|---|---|---|
| `978b222` | **Introduced** in `testrail.config.json` (the original POC config) | repo root → `packages/legacy-poc/testrail.config.json` |
| `d39b03d` | **Introduced** as `SHARED_PASSWORD = 'c0w&ch1k3n'` in account-billing helpers | `tests/account-billing/_helpers.js` → `packages/legacy-poc/tests/account-billing/_helpers.js` |
| `348988d` | **Removed** from `testrail.config.json` (Step 0.C). Did **not** touch `_helpers.js` (the miss). | `packages/legacy-poc/testrail.config.json` |

After the Step 0.E fix in this commit, the working tree is clean. **The git history still contains the secret in commits `978b222` and `d39b03d` (and `348988d` shows it being removed from the JSON only).**

## Decision D-20 — rewrite history vs formally accept

Per Section 6.2 Step 0.E of the proposal, this binary decision is owned by Security (in the solo phase, the Program Owner per Phase −1 ratification record).

### Option A — Rewrite history

**What it means.** Use `git filter-repo` (or BFG) to retroactively remove the literal `c0w&ch1k3n` from every commit in the branch's history. Force-push the rewritten branch. Every developer with a clone must re-clone or rebase locally. The secret no longer appears anywhere in the repository.

**Pros.**
- Clean history. Future audits return zero hits across history, not just the working tree.
- Best practice for credential leaks in repos that may become public or pass through compliance review.

**Cons.**
- **Risky single operation** that touches every commit on the branch. SHA changes for every commit. Anyone who has cloned the branch must re-clone.
- The branch is currently `feat/corporate-e2e-migration` with 14 ad-hoc commits ahead of `master`. None of those commits are landed on `master`. If we rewrite, only **this branch** changes; `master` is unaffected.
- Force-pushing `feat/corporate-e2e-migration` is acceptable because the branch is single-author and not yet merged. But it requires the user to re-clone if they have local checkouts elsewhere.
- The secret is also in `master` (in the original POC commits `978b222`, `d39b03d`). Rewriting only the feature branch leaves `master` polluted.
- A full repo-wide rewrite (including `master`) is a much bigger commitment: it changes every public commit SHA, breaks any external references (PR links, deployment tags, etc.), and requires coordinated re-clone for everyone.

### Option B — Formally accept the historical exposure

**What it means.** Acknowledge the leak in writing, rely on **credential rotation** (Step 0.D) to make the leaked value harmless, and document the decision so future audits know the historical exposure was a known-and-mitigated finding.

**Pros.**
- Zero risk of breaking the repository.
- Mitigation is mechanical: rotate the credential, leaked value becomes meaningless going forward.
- Standard practice for internal-only repos with single-author history.

**Cons.**
- The historical secret value remains discoverable via `git log -p`. Anyone with read access to the repo today, or to a backup tomorrow, can see it.
- If `tim1` is ever rotated *back* to `c0w&ch1k3n` (e.g. by accident, or by a scripted reset), the leak becomes live again.
- If the repository is ever exposed externally (forked, mirrored, or published) without the rotation having happened, the leak is still actionable.

### Recorded decision

**OPTION B — formally accept the historical exposure.**

Rationale:
1. The repository is internal-only and single-author today; no external exposure.
2. **Step 0.D credential rotation is the binding mitigation.** Even though Step 0.D is currently *deferred* (Program Owner does not have rotation authority in solo phase — see Step 0.D defer note), the rotation is a *committed* action with a clear owner (Program Owner) and a clear trigger (when Petar has both rotation authority on qa2/qa3 and a quiet window for the change).
3. Until Step 0.D actually executes, the leaked credential remains live. This is explicit and tracked under Risk **R-07** (already in the register at score 15) and Risk **R-16** (historical leak unresolved, score 12). Both have the Program Owner as mitigation owner.
4. Rewriting history on a single branch (this one) is incomplete because `master` also contains the secret. A full repo rewrite is too disruptive for the marginal benefit on an internal repo with one-person history.
5. **Re-evaluate after Step 0.D executes.** If Step 0.D drags out beyond a quarter or if the repo's exposure model changes (e.g. it becomes accessible to a wider audience, or a compliance review is scheduled), revisit this decision and run the rewrite then.

This decision is recorded as **D-20: ACCEPT** in the proposal Decision Register.

### Conditions under which Option A becomes mandatory

The Program Owner must reverse this decision and execute Option A if **any** of the following becomes true:

1. The repository becomes accessible to anyone outside the QA Automation function (frontend, backend, contractors, vendors, customers, public).
2. A compliance review (SOC 2, ISO 27001, or equivalent) is scheduled and includes git-history audit as a control.
3. The credential cannot be rotated within 90 days of this decision (so the historical leak remains live for an extended window).
4. The repository is ever forked, mirrored, or backed up to an external location.

If any of these triggers fires, schedule the rewrite for a known-quiet window, notify every developer to re-clone, and update the Confluence space (substituted by `docs/` in the solo phase) with the new HEAD SHA.

## Step 0.E summary

| Action | Status |
|---|---|
| Working-tree audit (grep for known secret) | ✅ One hit found in `_helpers.js` |
| Working-tree audit (broader sweep) | ✅ Zero additional hits |
| Git history audit (`git log -S`) | ✅ Three commits identified |
| Fix `_helpers.js` Step 0.C miss | ✅ Refactored to read from `process.env.TIM1_PASSWORD` |
| Decision D-20 recorded | ✅ ACCEPT (Option B) with explicit rotation-dependency and reversal triggers |
| `detect-secrets` installed and CI-wired | ❌ **Deferred to Phase 1** — system Python tooling unavailable in solo phase |

Step 0.E exit: ✅ — working tree clean, history audited, D-20 decided in writing.
