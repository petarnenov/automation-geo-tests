# Platform One Auto-link suite — implementation blocker

The seven Auto-link cases (C26077, C26078, C26079, C26080, C26093, C26094,
C26100) verify that creating a GW Admin user with a specific email in any qa3
firm automatically links that user to a matching Site 1 admin account. Each
case is a destructive end-to-end flow:

  1. Pre-existing GW Admin user in Site 1 with email **X**
  2. Create a new GW Admin user in firm Y with email **X**
  3. Verify the new user is linked to the Site 1 user (via the User Management
     filter showing both rows joined)

Why a UI smoke (similar to the Merge Prospect safety stop) is NOT useful here:

- The interesting behaviour (auto-link, delink, re-link) only fires AFTER the
  Create User form is submitted. Stopping before submit verifies only the
  form's existence, not any of the case's expected behaviour.
- Each case asserts a different POST-creation state. C26079 needs the
  GW Admin checkbox to be unchecked; C26080 needs a non-matching email to
  produce no link; C26093 needs both users to have NO email and asserts
  no link; C26094 needs an empty email; C26100 explicitly delinks then
  re-links — all of these require a real, persisted user.

What it would take to automate the suite:

1. **A pool of disposable email addresses** that can be recycled between runs
   (e.g. `qa-autolink-{N}@geowealth.com` where N comes from a counter or a
   per-run UUID).
2. **A pre-existing Site 1 admin user** for each scenario, owned by the test
   suite, whose email is one of the pool addresses. The matching cases use
   that user as the linking target; the non-matching cases verify it is NOT
   a target.
3. **A teardown step** (probably an internal API or DB script) that deletes
   the user created by the test before the next run. Without this, the
   second run of the same case fails because the email is already in use.
4. **Documented expected fields** for the User Management grid after auto-link
   (which row joins look like, where the link state is rendered) so the
   verification step can be precise.

Until these are in place all seven specs are intentionally test.fixme().
The qa3 User Management page is reachable at
`#platformOne/firmAdmin/userManagement` (verified manually as `tim1`), and
the page mounts correctly with the firm/email filters and an empty grid —
the missing piece is everything needed to drive a Create User flow safely.
