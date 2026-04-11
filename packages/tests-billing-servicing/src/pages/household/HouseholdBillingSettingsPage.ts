/**
 * Page Object for the Advisor Portal's Household → Details & Activity →
 * Billing Settings tab. Used by the Bucket Exclusions specs as their
 * Phase 2 verification surface — after uploading a bulk-exclusions
 * xlsx as a Platform One admin, the specs re-authenticate as the
 * firm's advisor and assert the HH-level billing configuration was
 * updated.
 *
 * ## Route
 *
 * The legacy helper navigates to
 * `#/client/5/${householdUuid}/detailsActivity/info` first, then
 * clicks the in-page `"Billing Settings"` link to switch tabs.
 * Navigating directly to the deep Billing Settings URL works on
 * some environments but not others because the SPA routes billing
 * sub-pages through an internal tab router — the link click is the
 * stable path both locally and against qa2.
 *
 * ## Expected sections
 *
 * The page renders one section per billing bucket:
 *
 *   - `ADVISOR BILLING SPEC`          (bucket 1)
 *   - `MONEY MANAGER BILLING SPEC`    (bucket 2)
 *   - `PLATFORM BILLING SPEC`         (bucket 3)
 *   - `INTERNAL ADVISOR BILLING SPEC` (bucket 4)
 *   - `INTERNAL MONEY MANAGER BILLING SPEC` (bucket 5)
 *   - `INTERNAL PLATFORM BILLING SPEC`(bucket 6)
 *
 * If the upload corrupted the HH config, one or more sections fail
 * to render — asserting on all six is a good smoke test for every
 * Bucket Exclusions spec's Phase 2.
 *
 * ## Assertions and waits
 *
 * This POM never calls `expect(...)`. Preconditions use
 * `locator.waitFor`; test-facing state is exposed as Locator getters
 * so callers drive assertions through `await expect(...)`.
 */

import type { Locator, Page } from '@playwright/test';

const DEFAULT_WAIT = 15_000;

/** All six billing-bucket section headings in bucket order (1..6). */
export const BILLING_SPEC_SECTIONS = [
  'ADVISOR BILLING SPEC',
  'MONEY MANAGER BILLING SPEC',
  'PLATFORM BILLING SPEC',
  'INTERNAL ADVISOR BILLING SPEC',
  'INTERNAL MONEY MANAGER BILLING SPEC',
  'INTERNAL PLATFORM BILLING SPEC',
] as const;

export type BillingSpecSectionLabel = (typeof BILLING_SPEC_SECTIONS)[number];

export class HouseholdBillingSettingsPage {
  constructor(private readonly page: Page) {}

  // ────────────────────────────────────────────────────────────────
  // Navigation
  // ────────────────────────────────────────────────────────────────

  /**
   * Navigate to the household detail page and click into Billing
   * Settings. Waits for the `ADVISOR BILLING SPEC` section to render
   * as the ready signal — that section is always present regardless
   * of which buckets have overrides.
   */
  async open(householdUuid: string): Promise<void> {
    await this.page.goto(`/react/indexReact.do#/client/5/${householdUuid}/detailsActivity/info`);
    const billingTab = this.page.getByRole('link', { name: 'Billing Settings' });
    await billingTab.waitFor({ state: 'visible', timeout: DEFAULT_WAIT });
    await billingTab.click();
    await this.sectionHeader('ADVISOR BILLING SPEC').waitFor({
      state: 'visible',
      timeout: DEFAULT_WAIT,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Section lookups
  // ────────────────────────────────────────────────────────────────

  /**
   * Locator for a billing-bucket section heading. Exposed for tests
   * that want to assert `toBeVisible()` on one or all six sections.
   */
  sectionHeader(label: BillingSpecSectionLabel): Locator {
    return this.page.getByText(label, { exact: true }).first();
  }

  /**
   * Locator for the container around a section header — two
   * ancestors up, which is where the legacy spec scopes its
   * per-section text assertions (e.g. "Yes" visible inside Advisor
   * section). Returns a Locator scoped so `.getByText(...)` inside it
   * hits only that section's contents.
   */
  section(label: BillingSpecSectionLabel): Locator {
    return this.sectionHeader(label).locator('..').locator('..');
  }

  /** All six section headers in order, for existence assertions. */
  allSectionHeaders(): Locator[] {
    return BILLING_SPEC_SECTIONS.map((label) => this.sectionHeader(label));
  }
}
