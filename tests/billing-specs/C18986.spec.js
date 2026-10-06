// @ts-check
/**
 * AIO GEO-TC-11791 (C18986) — Billing Specification: Bulk Export.
 *
 * Selects two specs on firm 1's grid, checks the footer actions turn active
 * with the right count, exports, and opens the .xlsx to confirm it holds the
 * selected specs with one column per spec field.
 *
 * Source (BillingSpecsGrid/Components/BillingSpecsGridFooterActions): the
 * footer shows "<n> Selected Billing Spec(s)" with Delete / Export / Clear
 * Selection buttons, styled inactive until a row is ticked. FormBuilder's
 * disabledStyleOnly adds a `disabled___xxx` class without the HTML disabled
 * attribute, so activity is asserted on the class. Export POSTs the selected
 * ids to the export endpoint, which streams an .xlsx attachment.
 *
 * Read-only: rows are only selected and exported; selection is cleared at the
 * end. Spec names are read from the grid at runtime, never hardcoded.
 */

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');
const { readZip } = require('../_helpers/build-bucket-xlsx');

const FIRM_CODE = 1;
const SPECS_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_CODE}`;

/** Decode XML entities in a text node. */
const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Read the first worksheet of an .xlsx into rows of cell strings (shared and
 * inline strings plus raw values).
 * @param {Buffer} buf
 * @returns {string[][]}
 */
function readFirstSheet(buf) {
  const files = readZip(buf);
  const shared = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) {
    for (const si of ss.toString('utf8').match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(
        unescapeXml(
          (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
            .map((t) => t.replace(/<[^>]+>/g, ''))
            .join('')
        )
      );
    }
  }
  const sheetName = [...files.keys()].find((n) => /^xl\/worksheets\/sheet\d*\.xml$/.test(n));
  const xml = files.get(sheetName).toString('utf8');
  return (xml.match(/<row[\s\S]*?<\/row>/g) || []).map((row) =>
    (row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).map((c) => {
      const type = (c.match(/ t="([^"]+)"/) || [])[1];
      const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
      if (inline) return unescapeXml(inline[1]);
      const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (v === undefined) return '';
      return type === 's' ? shared[Number(v)] : unescapeXml(v);
    })
  );
}

test(
  '@pepi C18986 Billing Specification - Bulk Export',
  { annotation: [{ type: 'aio', description: 'GEO-TC-11791' }] },
  async ({ page }) => {
    test.setTimeout(180_000);

    const footer = page
      .locator('section, footer, div')
      .filter({ hasText: /Selected Billing Spec/i })
      .filter({ has: page.getByRole('button', { name: 'Export', exact: true }) })
      .last();
    const footerButton = (name) => footer.getByRole('button', { name, exact: true });
    const rowCheckbox = (i) =>
      page
        .locator(`.ag-center-cols-container .ag-row[row-index="${i}"] .ag-selection-checkbox`)
        .first();
    const specNameCell = (i) =>
      page.locator(`.ag-row[row-index="${i}"] [col-id="specificationDescription"]`).first();

    await loginPlatformOneAdmin(page);

    await test.step('Precondition: open the Billing Specifications grid for a firm', async () => {
      await page.goto(SPECS_URL);
      await expect(page.locator('.ag-center-cols-container .ag-row').nth(1)).toBeVisible({
        timeout: 120_000,
      });
      for (const name of ['Delete', 'Export', 'Clear Selection']) {
        await expect(footerButton(name), `${name} inactive before selection`).toHaveClass(
          /disabled/i
        );
      }
    });

    const selected = [];

    await test.step('Step 1: tick two specs, footer actions become active with the count', async () => {
      for (const i of [0, 1]) {
        selected.push((await specNameCell(i).innerText()).trim());
        await rowCheckbox(i).click();
      }
      expect(selected.every(Boolean), 'spec names read from the grid').toBe(true);
      await expect(footer).toContainText(/2 Selected Billing Specs?/);
      for (const name of ['Delete', 'Export', 'Clear Selection']) {
        await expect(footerButton(name), `${name} active after selection`).not.toHaveClass(
          /disabled/i
        );
      }
    });

    await test.step('Step 2: Export downloads an .xlsx with the selected specs, one column per field', async () => {
      const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
      await footerButton('Export').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);

      const rows = readFirstSheet(fs.readFileSync(await download.path()));
      const [header, ...data] = rows;
      console.log(`[C18986] header (${header.length}): ${JSON.stringify(header)}`);

      // Every field of a spec is its own column: far more than the grid's
      // three default columns, and every header cell is named.
      expect(header.length, 'one column per spec field').toBeGreaterThan(10);
      expect(
        header.filter((h) => !h.trim()),
        'no unnamed columns'
      ).toEqual([]);
      expect(new Set(header).size, 'column names are unique').toBe(header.length);

      const nameCol = header.findIndex((h) => /^SPEC NAME\*?$/i.test(h.trim()));
      expect(nameCol, 'SPEC NAME column present').toBeGreaterThanOrEqual(0);
      const exportedNames = data.map((r) => (r[nameCol] || '').trim()).filter(Boolean);
      for (const name of selected) {
        expect(exportedNames, `export lists "${name}"`).toContain(name);
      }
    });

    await test.step('Clean-up: clear the selection', async () => {
      await footerButton('Clear Selection').click();
      await expect(footerButton('Export')).toHaveClass(/disabled/i);
    });
  }
);
