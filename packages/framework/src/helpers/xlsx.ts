/**
 * Minimal xlsx reader for parsing GwGrid-exported spreadsheets in
 * tests. Avoids pulling a heavyweight dep (`exceljs`, `xlsx`) for the
 * tiny subset of xlsx we actually need: read `sheet1`, map column
 * headers to row values.
 *
 * xlsx is a zip of XML files; GwGrid's ag-grid excel export always
 * produces a single-sheet workbook at `xl/worksheets/sheet1.xml` with
 * shared strings at `xl/sharedStrings.xml`. Cells are either shared-
 * string (`t="s"`, value is an index into sharedStrings) or inline
 * (`<is><t>…`) or numeric (no `t`, raw value under `<v>`).
 *
 * Public API:
 *
 *   - {@link readXlsxSheet} — read a Buffer, return `{ headers,
 *     rowsByCol }`. Header row is the first populated row; data rows
 *     are every row after it. Missing cells become empty strings.
 *
 * Non-goals: this reader does NOT support formatted values, cell
 * styles, multiple sheets, formulas, dates (raw serial number is
 * returned), merged cells, or encrypted workbooks. Extend only when a
 * spec needs one of those.
 *
 * Verified against ag-grid's `gridApi.exportDataAsExcel()` output for
 * the Billing Specifications grid (C25085).
 */

import * as zlib from 'node:zlib';

export interface XlsxSheet {
  /** Ordered headers from the first populated row. */
  headers: string[];
  /**
   * Column header → array of string values, one entry per data row,
   * in sheet order. Missing cells in a row become `''`.
   */
  rowsByCol: Record<string, string[]>;
}

/**
 * Parse a GwGrid-exported xlsx buffer into headers + column-keyed
 * rows. Throws if the file isn't a valid zip or the sheet cannot be
 * found.
 *
 * @example
 *   const buf = fs.readFileSync(exportPath);
 *   const { headers, rowsByCol } = readXlsxSheet(buf);
 *   expect(headers).toContain('Account Min');
 *   for (const v of rowsByCol['Account Min']) expect(['Y','N']).toContain(v);
 */
export function readXlsxSheet(buf: Buffer): XlsxSheet {
  const files = readZip(buf);
  const ss = files.get('xl/sharedStrings.xml');
  const sheet = files.get('xl/worksheets/sheet1.xml');
  if (!sheet) {
    throw new Error('readXlsxSheet: xl/worksheets/sheet1.xml not found in archive');
  }
  const strings = parseSharedStrings(ss?.toString('utf8') ?? '');
  return parseSheet(sheet.toString('utf8'), strings);
}

// ──────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────

/**
 * Read a zip archive into a map of inner-file path → decompressed
 * Buffer. Supports `store` (method 0) and `deflate` (method 8), which
 * are the only methods ag-grid's excel export emits.
 */
function readZip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();

  // Locate End Of Central Directory record — it sits at the very end
  // of the archive but can be up to 65557 bytes back when a comment
  // is present. Scan backwards until we find the EOCD signature.
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('readXlsxSheet: zip EOCD signature not found');

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
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    const lhNameLen = buf.readUInt16LE(lhOff + 26);
    const lhExtraLen = buf.readUInt16LE(lhOff + 28);
    const dataStart = lhOff + 30 + lhNameLen + lhExtraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0) {
      data = compData;
    } else if (method === 8) {
      data = zlib.inflateRawSync(compData);
    } else {
      throw new Error(`readXlsxSheet: unsupported zip compression method ${method}`);
    }

    files.set(name, data);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

/** Extract the string table from `xl/sharedStrings.xml`. */
function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => decodeXmlEntities(m[1]));
}

/**
 * Parse a sheet XML into headers + column-keyed rows. The cell regex
 * handles three value shapes:
 *
 *   - `<c r="A1" t="s"><v>3</v></c>` — shared string by index
 *   - `<c r="A1" t="inlineStr"><is><t>foo</t></is></c>` — inline
 *   - `<c r="A1"><v>42</v></c>` — numeric, raw
 *   - `<c r="A1"/>` — empty, ignored
 */
function parseSheet(xml: string, strings: string[]): XlsxSheet {
  // Row number → column letter → value.
  const byRow = new Map<number, Map<string, string>>();
  const cellRx =
    /<c\s+r="([A-Z]+)(\d+)"(?:[^>]*?\bt="(s|str|inlineStr)")?[^>]*?(?:>(?:[\s\S]*?<v>([\s\S]*?)<\/v>|[\s\S]*?<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>)?[\s\S]*?<\/c>|\s*\/>)/g;

  for (const m of xml.matchAll(cellRx)) {
    const col = m[1];
    const rowNum = parseInt(m[2], 10);
    const type = m[3];
    const rawV = m[4];
    const inline = m[5];

    let value: string;
    if (type === 's' && rawV != null) {
      value = strings[parseInt(rawV, 10)] ?? '';
    } else if (inline != null) {
      value = decodeXmlEntities(inline);
    } else {
      value = rawV ?? '';
    }

    if (!byRow.has(rowNum)) byRow.set(rowNum, new Map());
    byRow.get(rowNum)!.set(col, value);
  }

  const headerRow = byRow.get(1) ?? new Map<string, string>();
  // Column letters must be sorted by xlsx column order: shorter first
  // (A..Z before AA..AZ), then lexical within the same length.
  const colsInOrder = [...headerRow.keys()].sort((a, b) =>
    a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0
  );
  const headers = colsInOrder.map((c) => headerRow.get(c)!);

  const rowsByCol: Record<string, string[]> = {};
  for (const col of colsInOrder) {
    rowsByCol[headerRow.get(col)!] = [];
  }

  const dataRowNums = [...byRow.keys()].filter((n) => n > 1).sort((a, b) => a - b);
  for (const rn of dataRowNums) {
    const row = byRow.get(rn)!;
    for (const col of colsInOrder) {
      rowsByCol[headerRow.get(col)!].push(row.get(col) ?? '');
    }
  }
  return { headers, rowsByCol };
}

/** Minimal XML entity decoder for the five predefined entities. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
