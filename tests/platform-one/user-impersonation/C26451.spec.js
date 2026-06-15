// @ts-check
/**
 * TestRail C26451 — Platform One: Session & audit behaviour with enabled
 *   Impersonation permission (Positive).
 *
 * Drives a full impersonation cycle (launch → terminate) and asserts that
 * the `LOGIN_HISTORY_TBL` audit log gained a new successful impersonation
 * event with tim1 as `IMPERSONATED_BY`. The TestRail expected outcome lists:
 *   - Admin user ID
 *   - Impersonated user ID
 *   - Timestamp (start or end)
 *
 * `LOGIN_HISTORY_TBL` schema (qa4 / Oracle):
 *   LOGIN_HISTORY_ID, ENTITY_ID (impersonated), LOGIN_ATTEMPTED_DATE,
 *   LOGIN_SUCCESS_FLAG, LOGIN_TYPE_CD, IMPERSONATED_BY (admin), …
 *
 * Audit assertion: the count of rows where IMPERSONATED_BY = tim1's UUID
 * and LOGIN_SUCCESS_FLAG = 1 and LOGIN_ATTEMPTED_DATE > test start time
 * must increase by at least 1 across the impersonation cycle.
 */

const { test, expect } = require('@playwright/test');
const {
  gotoImpersonatePageAsTim1,
  selectFirmInImpersonate,
  impersonateFirstNonSelfEmployee,
  terminateImpersonationFromUserMenu,
  countTim1ImpersonationEventsSince,
  FIRM_CD_GEOWEALTH,
} = require('./_helpers');

test('@pepi C26451 Platform One Impersonation session & audit behaviour (Positive)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Snapshot the audit log baseline BEFORE the cycle. We compare a 1-second
  // delta to absorb any in-flight events from concurrent runs (none in
  // workers=1, but cheap insurance).
  const startIso = new Date().toISOString();
  const baseline = countTim1ImpersonationEventsSince(startIso);

  await gotoImpersonatePageAsTim1(page);
  await selectFirmInImpersonate(page, FIRM_CD_GEOWEALTH);

  const target = await impersonateFirstNonSelfEmployee(page, []);
  console.log(`[C26451] impersonated: ${target}`);

  await expect(page).not.toHaveURL(/firmAdmin\/userImpersonation/, { timeout: 30_000 });
  await terminateImpersonationFromUserMenu(page);

  // Re-query the audit log — the impersonation event should now be there.
  // The backend writes LOGIN_HISTORY_TBL synchronously during the
  // impersonation handshake, so the event is durable by the time terminate
  // returns. Tiny retry window for write-then-read commit visibility.
  await expect
    .poll(() => countTim1ImpersonationEventsSince(startIso) - baseline, {
      timeout: 15_000,
      message: 'LOGIN_HISTORY_TBL should have a new tim1-initiated impersonation row',
    })
    .toBeGreaterThanOrEqual(1);
});
