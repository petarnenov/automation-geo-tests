/**
 * `ReactDatePicker` Component class.
 *
 * Phase 2 step 5 (D-37). Lifted verbatim from the legacy POC's
 * `packages/legacy-poc/tests/_helpers/ui.js::setReactDatePicker`
 * (lines 36-104). The legacy version was discovered the hard way
 * through live qa3 probing on 2026-04-07; this lift preserves every
 * quirk and the inline rationale.
 *
 * Per Section 4.4 of the proposal:
 *   - MUST be safe to instantiate multiple times on the same page.
 *   - MUST expose semantic verbs (setValue, ...) rather than
 *     mechanical clicks.
 *   - MUST internally absorb React-hydration races so spec authors
 *     never call waitForTimeout.
 *
 * Quirks preserved (Q1+Q2 in the C25193 entry spike):
 *
 *   Q1 (filling does NOT commit through React state). The picker's
 *       spinbuttons and hidden input do NOT fire the React onChange
 *       that Save picks up — only clicking a day cell in the popup
 *       calendar does. Therefore: open the calendar via the icon
 *       button, navigate to the target month, click the day cell.
 *
 *   Q1' (synthetic clicks swallowed). Some pickers — especially
 *       ones whose section was just re-enabled by a combo change —
 *       silently swallow Locator.click() because their React
 *       onClick handler hasn't re-attached after a parent re-render.
 *       Workaround: dispatch a full mousedown/mouseup/click
 *       MouseEvent burst on `button.react-date-picker__calendar
 *       -button` and retry until the calendar actually appears.
 *       expect.poll runs the action+check pair on its own interval
 *       schedule (replaces a previous waitForTimeout(200) raw sleep).
 *
 *   Q2 (calendar opens to "today" when picker is empty). When the
 *       picker has no value, the spinbuttons render empty but the
 *       calendar still opens at the current month. The navigation
 *       loop must read the displayed month from
 *       `.react-calendar__navigation__label` rather than from the
 *       picker's own state. Safety bound: 240 iterations (≈20 years
 *       in either direction). Throws on stuck nav.
 *
 * Usage from a Page Object (Phase 2 step 6):
 *
 *   class AccountBillingPage {
 *     readonly inceptionDate: ReactDatePicker;
 *     constructor(page: Page) {
 *       this.inceptionDate = new ReactDatePicker(page, '#billingInceptionDate');
 *     }
 *     async setInceptionDate(date: string) {
 *       await this.inceptionDate.setValue(date);
 *     }
 *   }
 */

import { expect, type Page, type Locator } from '@playwright/test';

export class ReactDatePicker {
  private readonly page: Page;
  private readonly section: Locator;

  /**
   * @param page Playwright Page.
   * @param scope The wrapping picker section. Pass either a CSS
   *   selector (e.g. `'#billingInceptionDate'`) or a Locator. The
   *   selector form is the common case — every qa picker has a
   *   stable id on its outer section.
   */
  constructor(page: Page, scope: string | Locator) {
    this.page = page;
    this.section = typeof scope === 'string' ? page.locator(scope) : scope;
  }

  /**
   * Set the picker to the given date by opening the calendar popup
   * and clicking the day cell. Idempotent against React-hydration
   * races (Q1+Q1') and stale calendar state (Q2).
   *
   * @param mmddyyyy The target date in `MM/DD/YYYY` format
   *   (e.g. `'02/14/2025'`). Throws if the format is wrong.
   */
  async setValue(mmddyyyy: string): Promise<void> {
    const [m, d, y] = mmddyyyy.split('/').map((v) => parseInt(v, 10));
    if (!m || !d || !y || Number.isNaN(m) || Number.isNaN(d) || Number.isNaN(y)) {
      throw new Error(
        `ReactDatePicker.setValue: invalid date format "${mmddyyyy}". Expected MM/DD/YYYY.`
      );
    }

    const targetDate = new Date(Date.UTC(y, m - 1, d));
    const targetLabel = targetDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const targetMonthYear = targetDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    // Q1' — open the popup with a dispatch-burst loop, retry until
    // the calendar becomes visible. expect.poll handles the retry
    // schedule; the inner closure is what we want to retry.
    const calendarBtn = this.section.locator('button.react-date-picker__calendar-button');
    const calendar = this.page.locator('.react-calendar');

    await expect
      .poll(
        async () => {
          await calendarBtn.evaluate((btn: Element) => {
            const el = btn as HTMLElement;
            el.scrollIntoView({ block: 'center' });
            el.focus();
            for (const t of ['mousedown', 'mouseup', 'click']) {
              btn.dispatchEvent(
                new MouseEvent(t, { bubbles: true, cancelable: true, view: window })
              );
            }
          });
          return await calendar.isVisible().catch(() => false);
        },
        { timeout: 5000, intervals: [100, 200, 400, 800] }
      )
      .toBe(true);

    // Q2 — read the displayed month from the calendar header (not
    // from the picker's state, which may be empty), then navigate
    // month-by-month until it matches the target.
    const navLabel = this.page.locator('.react-calendar__navigation__label').first();
    const parseMonthYear = (s: string): { m: number; y: number } => {
      const dt = new Date(`${s} 1 UTC`);
      return { m: dt.getUTCMonth() + 1, y: dt.getUTCFullYear() };
    };

    let displayed = (await navLabel.textContent())?.trim() ?? '';
    for (let safety = 0; safety < 240; safety++) {
      if (displayed === targetMonthYear) break;
      const cur = parseMonthYear(displayed);
      const monthsDiff = (y - cur.y) * 12 + (m - cur.m);
      const navBtn =
        monthsDiff < 0
          ? '.react-calendar__navigation__prev-button'
          : '.react-calendar__navigation__next-button';
      await this.page.locator(navBtn).click();
      displayed = (await navLabel.textContent())?.trim() ?? '';
    }
    if (displayed !== targetMonthYear) {
      throw new Error(
        `ReactDatePicker.setValue: calendar nav stuck at "${displayed}", target "${targetMonthYear}"`
      );
    }

    await this.page.locator(`.react-calendar abbr[aria-label="${targetLabel}"]`).click();
    await expect(calendar).toBeHidden({ timeout: 5000 });
  }
}
