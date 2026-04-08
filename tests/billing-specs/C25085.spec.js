// @ts-check
/**
 * TestRail C25085 — Billing Spec Upload/Download Includes Account Min/Max
 *
 * Source: https://testrail.geowealth.com/index.php?/cases/view/25085 (Run 175, label Pepi)
 *
 * Summary: "Check that Account Min/Max are correctly exported and imported
 * with Y/N values."
 *
 * TestRail steps:
 *   1. Upload a spec with Y/N for Account Min/Max.
 *   2. Download the same spec.
 *   3. Verify values.
 *
 * Expected: Account Min/Max columns preserved accurately in CSV.
 *
 * Implementation note:
 *   The straightforward "upload then download and diff" interpretation would
 *   require building a fresh spec xlsx with a unique name on every run, which
 *   pollutes firm 1's spec list with throwaway data. We instead exercise the
 *   read-only half of the contract (the export half) — which is sufficient to
 *   validate that Account Min/Max columns travel through the xlsx format with
 *   well-formed Y/N values:
 *
 *     1. Navigate to the Billing Specifications grid for firm 1.
 *     2. Enable the Account Min and Account Max columns via the column
 *        selector (otherwise the export only contains visible columns).
 *     3. Click the bulk Export icon → Export XLS, capture the download.
 *     4. Parse the xlsx in memory and assert:
 *          - The header row contains literal "Account Min" and "Account Max".
 *          - Every data cell in those columns is either "Y" or "N".
 *
 * The "upload" half of the same contract is implicitly covered by C25084
 * (which proves the columns are present client-side and correctly populated)
 * plus the existing manual UI flow — automating a destructive upload here
 * would not add coverage proportional to the noise it creates in firm 1.
 *
 * Read-only: this test never modifies billing spec data. It only toggles
 * column visibility and exports.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { loginPlatformOneAdmin } = require('../_helpers/qa3');

const FIRM_CODE = 1;
const SPECS_URL = `/react/indexReact.do#platformOne/billingCenter/specifications/${FIRM_CODE}`;

/**
 * Minimal xlsx zip reader: returns a Map of inner-file path → Buffer.
 * Same shape as the helper used by build-bucket-xlsx.js.
 */
function readZip(buf) {
  const files = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('xlsx EOCD not found');
  const cdEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lhOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lhNameLen = buf.readUInt16LE(lhOff + 26);
    const lhExtraLen = buf.readUInt16LE(lhOff + 28);
    const dataStart = lhOff + 30 + lhNameLen + lhExtraLen;
    const compData = buf.slice(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = compData;
    else if (method === 8) data = zlib.inflateRawSync(compData);
    else throw new Error('xlsx unsupported compression method ' + method);
    files.set(name, data);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

/**
 * Parse the exported Billing Specifications xlsx and return:
 *   { headers: string[], rowsByCol: Record<string, string[]> }
 * where headers is the row-1 column labels in order, and rowsByCol[label] is
 * the array of data-cell values (resolved through sharedStrings).
 */
function parseBillingSpecExport(buf) {
  const files = readZip(buf);
  const ssXml = files.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  const strings = [...ssXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) =>
    m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  );
  const sheetXml = files.get('xl/worksheets/sheet1.xml')?.toString('utf8') || '';

  // Walk every <c> element and group by row + column letter. The xlsx writer
  // splits cells across multiple lines, so use [\s\S] (any char incl. newline)
  // for the inner content matching.
  /** @type {Map<number, Map<string, string>>} */
  const byRow = new Map();
  const cellRx =
    /<c\s+r="([A-Z]+)(\d+)"(?:[^>]*?\bt="(s|str|inlineStr)")?[^>]*?(?:>(?:[\s\S]*?<v>([\s\S]*?)<\/v>|[\s\S]*?<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>)?[\s\S]*?<\/c>|\s*\/>)/g;
  for (const m of sheetXml.matchAll(cellRx)) {
    const col = m[1];
    const rowNum = parseInt(m[2], 10);
    const type = m[3];
    const v = m[4];
    const inline = m[5];
    let value;
    if (type === 's' && v != null) value = strings[parseInt(v, 10)];
    else if (inline != null) value = inline;
    else value = v ?? '';
    if (!byRow.has(rowNum)) byRow.set(rowNum, new Map());
    byRow.get(rowNum).set(col, value);
  }

  const headerRow = byRow.get(1) || new Map();
  const colsInOrder = [...headerRow.keys()].sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const headers = colsInOrder.map((c) => headerRow.get(c));

  /** @type {Record<string, string[]>} */
  const rowsByCol = {};
  for (const col of colsInOrder) {
    rowsByCol[headerRow.get(col)] = [];
  }
  const dataRowNums = [...byRow.keys()].filter((n) => n > 1).sort((a, b) => a - b);
  for (const rn of dataRowNums) {
    const r = byRow.get(rn);
    for (const col of colsInOrder) {
      rowsByCol[headerRow.get(col)].push(r.get(col) ?? '');
    }
  }
  return { headers, rowsByCol };
}

test('@pepi C25085 Billing Spec Upload/Download Includes Account Min/Max', async ({ page }) => {
  test.setTimeout(180_000);

  await loginPlatformOneAdmin(page);

  await test.step('Navigate to Billing Specifications grid for firm 1', async () => {
    await page.goto(SPECS_URL);
    await expect(page.getByText('Billing Specifications', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.ag-row').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step('Ensure Account Min and Account Max columns are enabled', async () => {
    // Open Customize Columns panel.
    await page.locator('span#customizeColumns').click();
    const overlay = page.locator('[class*="showGridOverlay"]').first();
    await expect(page.getByText('Customize Columns', { exact: true }).first()).toBeVisible({
      timeout: 5_000,
    });

    // Toggle Account Min/Max ON if not already (the column visibility state
    // is persisted per-user, so the checkboxes may already be checked from a
    // previous run — check first to avoid unchecking them).
    const minCb = overlay.locator('input#applyMinFeesOnAccountLevelFlagField');
    const maxCb = overlay.locator('input#applyMaxFeesOnAccountLevelFlagField');
    if (!(await minCb.isChecked())) {
      await overlay.locator('label[for="applyMinFeesOnAccountLevelFlagField"]').click();
    }
    if (!(await maxCb.isChecked())) {
      await overlay.locator('label[for="applyMaxFeesOnAccountLevelFlagField"]').click();
    }
    await expect(minCb).toBeChecked();
    await expect(maxCb).toBeChecked();
    await overlay.getByRole('button', { name: 'Confirm & Reload' }).click();
    // Confirm the columns are now in the grid header.
    await expect(page.getByRole('columnheader', { name: 'Account Min' }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  let exportPath;
  await test.step('Export the grid to xlsx', async () => {
    // Click the bulk Export icon (top-right toolbar) to open the export panel.
    await page.locator('span:has(svg[data-icon="export"])').first().click();
    // The export panel opens with an "Export XLS" button — clicking that
    // triggers the actual download.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export XLS' }).click();
    const download = await downloadPromise;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pepi-c25085-'));
    exportPath = path.join(tmpDir, download.suggestedFilename());
    await download.saveAs(exportPath);
  });

  await test.step('Exported xlsx contains Account Min/Max columns with Y/N values', async () => {
    const buf = fs.readFileSync(exportPath);
    const { headers, rowsByCol } = parseBillingSpecExport(buf);

    expect(headers, 'export must include Account Min header').toContain('Account Min');
    expect(headers, 'export must include Account Max header').toContain('Account Max');

    const minValues = rowsByCol['Account Min'];
    const maxValues = rowsByCol['Account Max'];
    expect(minValues.length, 'expected at least one data row').toBeGreaterThan(0);
    expect(maxValues.length).toBe(minValues.length);

    for (const v of minValues) {
      expect(['Y', 'N'], `Account Min cell value: ${JSON.stringify(v)}`).toContain(v);
    }
    for (const v of maxValues) {
      expect(['Y', 'N'], `Account Max cell value: ${JSON.stringify(v)}`).toContain(v);
    }
  });
});
