// @ts-check
/**
 * Phase 0 Step 0.0 — Walking-skeleton selector reconnaissance.
 *
 * Per OFFICIAL-FRAMEWORK-PROPOSAL.md v1.2 Section 6.2 Step 0.0:
 *
 *   "Manually log into qa2 as `tim1` and inspect the dashboard DOM.
 *    Identify the exact accessible-name selector the walking skeleton
 *    will assert against. Record the chosen selector — its tag, role,
 *    accessible name, and the element's surrounding context — in the
 *    Phase 0 tracking issue. Without this, Step 0.F's walking-skeleton
 *    spec is a blind guess and will fail on day one."
 *
 * Output: docs/phase-0-selector-recon-output.md (committed) plus a
 * Playwright trace under .playwright-recon/.
 *
 * Usage:
 *   TEST_ENV=qa2 node scripts/phase-0-selector-recon.js
 *   TEST_ENV=qa3 node scripts/phase-0-selector-recon.js   # D-23 fallback
 */

const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TRACE_DIR = path.join(REPO_ROOT, '.playwright-recon');
const OUTPUT_MD = path.join(REPO_ROOT, 'docs', 'phase-0-selector-recon-output.md');

const ENV = process.env.TEST_ENV || 'qa2';
const ENV_URLS = {
  qa2: 'https://qa2.geowealth.com',
  qa3: 'https://qa3.geowealth.com',
};
const BASE_URL = ENV_URLS[ENV];
if (!BASE_URL) {
  console.error(`Unknown TEST_ENV=${ENV}. Allowed: qa2, qa3.`);
  process.exit(2);
}

// Step 0.0 reads compromised credentials from the existing POC config.
// They will be rotated in Step 0.D. Using them once more for read-only
// dashboard inspection does not change the threat surface.
const cfg = require(path.join(REPO_ROOT, 'testrail.config.json'));
const USERNAME = cfg.appUnderTest.username;
const PASSWORD = cfg.appUnderTest.password;

if (!fs.existsSync(TRACE_DIR)) fs.mkdirSync(TRACE_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();

  /** @type {Array<{tag: string, role: string|null, name: string|null, level: number|null, classes: string, parentTag: string|null}>} */
  let headings = [];
  let postLoginUrl = '';
  let title = '';
  let error = null;

  try {
    // Pattern lifted verbatim from tests/_helpers/global-setup.js:
    // 1. goto base URL → SPA async-routes to /#login
    // 2. fill placeholder-based form fields
    // 3. click "Login" button
    // 4. wait for /#(platformOne|dashboard) post-login route
    console.log(`[recon] navigating to ${BASE_URL}/`);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    console.log('[recon] waiting for SPA to route to /#login');
    await page.waitForURL(/#login/, { timeout: 30_000 });

    await page.getByPlaceholder(/email|username/i).fill(USERNAME);
    await page.getByPlaceholder(/password/i).fill(PASSWORD);

    console.log('[recon] clicking Login');
    await page.getByRole('button', { name: 'Login' }).click();

    console.log('[recon] waiting for post-login route');
    await page.waitForURL(/#(platformOne|dashboard)/, { timeout: 30_000 });

    // Give the React SPA a moment to hydrate the landing page.
    await page.waitForTimeout(3_000);

    postLoginUrl = page.url();
    title = await page.title();
    console.log(`[recon] post-login URL: ${postLoginUrl}`);
    console.log(`[recon] document title: ${title}`);

    // Walk all heading-like elements and record accessible names + context.
    headings = await page.evaluate(() => {
      const out = [];
      const sel = 'h1, h2, h3, h4, [role="heading"]';
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || (tag.match(/^h[1-6]$/) ? 'heading' : null);
        const ariaLabel = el.getAttribute('aria-label');
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        const name = ariaLabel || text || null;
        const levelAttr = el.getAttribute('aria-level');
        let level = null;
        if (levelAttr) level = Number(levelAttr);
        else if (/^h[1-6]$/.test(tag)) level = Number(tag.slice(1));
        const classes = el.className && typeof el.className === 'string' ? el.className : '';
        const parentTag = el.parentElement ? el.parentElement.tagName.toLowerCase() : null;
        if (name) out.push({ tag, role, name, level, classes, parentTag });
      }
      return out;
    });

    console.log(`[recon] found ${headings.length} heading-like elements with accessible names`);
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`[recon] error: ${error}`);
  } finally {
    const tracePath = path.join(TRACE_DIR, `phase-0-recon-${ENV}.zip`);
    await context.tracing.stop({ path: tracePath });
    const screenshotPath = path.join(TRACE_DIR, `phase-0-recon-${ENV}.png`);
    try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch {}
    await browser.close();

    // Render Markdown report.
    const lines = [];
    lines.push('# Phase 0 Step 0.0 — Selector Reconnaissance Output');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    lines.push(`| TEST_ENV | \`${ENV}\` |`);
    lines.push(`| Base URL | \`${BASE_URL}\` |`);
    lines.push(`| Username | \`${USERNAME}\` |`);
    lines.push(`| Date | ${new Date().toISOString()} |`);
    lines.push(`| Post-login URL | \`${postLoginUrl || 'n/a'}\` |`);
    lines.push(`| Document title | \`${title || 'n/a'}\` |`);
    lines.push(`| Trace artifact | \`${path.relative(REPO_ROOT, tracePath)}\` |`);
    lines.push(`| Screenshot | \`${path.relative(REPO_ROOT, screenshotPath)}\` |`);
    if (error) lines.push(`| **Error** | \`${error}\` |`);
    lines.push('');

    if (headings.length > 0) {
      lines.push('## Heading-like elements with accessible names');
      lines.push('');
      lines.push('| # | Tag | Role | Level | Accessible name | Parent | Classes |');
      lines.push('|---|---|---|---|---|---|---|');
      headings.forEach((h, i) => {
        const safe = (s) => (s || '').replace(/\|/g, '\\|');
        lines.push(`| ${i + 1} | \`${h.tag}\` | \`${h.role || ''}\` | ${h.level ?? ''} | ${safe(h.name)} | \`${h.parentTag || ''}\` | \`${safe(h.classes).slice(0, 60)}\` |`);
      });
      lines.push('');
      lines.push('## Recommended walking-skeleton selector');
      lines.push('');
      // Heuristic: prefer the first h1 or the highest-priority heading element.
      const h1 = headings.find((h) => h.tag === 'h1');
      const top = h1 || headings[0];
      lines.push('```typescript');
      lines.push(`// Phase 0 Step 0.0 — chosen by recon script against ${ENV}.`);
      lines.push(`// Recommendation only; the human Program Owner approves before Step 0.F.`);
      if (top.role === 'heading' && top.name) {
        lines.push(`await expect(page.getByRole('heading', { name: ${JSON.stringify(top.name)} })).toBeVisible();`);
      } else if (top.name) {
        lines.push(`await expect(page.getByText(${JSON.stringify(top.name)})).toBeVisible();`);
      } else {
        lines.push(`// (no usable heading detected; manual inspection required)`);
      }
      lines.push('```');
      lines.push('');
      lines.push(`> Top candidate: tag=\`${top.tag}\`, role=\`${top.role || ''}\`, level=\`${top.level ?? ''}\`, name=\`${top.name}\`.`);
    } else {
      lines.push('## No heading-like elements found.');
      lines.push('');
      lines.push('Possible reasons: login failed, dashboard not loaded, SPA not yet hydrated, or qa2 returned an error page. Inspect the trace artifact and screenshot.');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*Generated by `scripts/phase-0-selector-recon.js`. The script will be relocated into `packages/legacy-poc/scripts/` during Step 0.B.*');

    fs.mkdirSync(path.dirname(OUTPUT_MD), { recursive: true });
    fs.writeFileSync(OUTPUT_MD, lines.join('\n'), 'utf8');
    console.log(`[recon] wrote ${path.relative(REPO_ROOT, OUTPUT_MD)}`);

    process.exit(error ? 1 : 0);
  }
})();
