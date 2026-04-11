/**
 * Build a Billing Bucket Exclusions xlsx in memory from a row
 * description, returning the bytes as a Node `Buffer`. Used by the
 * Bucket Exclusions specs (C25363, C25378, C25380, C25790, C25793,
 * …) which need either a valid happy-path fixture built against a
 * per-worker dummy firm OR a deliberately broken fixture that the
 * backend should reject.
 *
 * Ported from `packages/legacy-poc/tests/_helpers/build-bucket-xlsx.js`.
 * The shape of the output is driven by the canonical xlsx template
 * committed under
 * `packages/framework/src/fixtures/bucket-exclusions/BillingBucketExclusions_Import_Template.xlsx`
 * (same file the app ships at
 * `/docs/upload_samples/uploadTools/bucketExclusions/BillingBucketExclusions_Import_Template.xlsx`).
 *
 * The template is used purely for its xlsx scaffolding — content
 * types, styles, theme, etc. — the builder overwrites
 * `xl/sharedStrings.xml` and `xl/worksheets/sheet1.xml` with the
 * caller-provided row data. This keeps the data model typed in TS
 * while still producing an xlsx that mstches Excel's opinions on
 * every non-data concern.
 *
 * ## Column order (verified against the template)
 *
 *     A: FIRM CODE         (numeric)
 *     B: BILLING BUCKET    (numeric, 1..6)
 *     C: HOUSEHOLD UUID    (shared string)
 *     D: CLIENT UUID       (shared string)
 *     E: ACCOUNT UUID      (shared string)
 *     F: EXCLUDED          (shared string — Y / N / I)
 *     G: Set All Accts to I  (OPTIONAL — emitted only with
 *                              `opts.includeSetAllAccts = true`)
 *
 * Any per-row field can be omitted to produce a deliberately
 * incomplete row — the validation specs rely on that to trigger the
 * FE's "missing required field" error path without having to
 * hand-craft broken xlsx files. Rows are written in order starting
 * from row 2 (row 1 is the header).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

/**
 * Per-row data for a Billing Bucket Exclusions xlsx. Every field is
 * optional so callers can emit partial rows for negative tests.
 *
 * `hh`/`client`/`account` should be UUIDs from a worker firm; `firm`
 * is the numeric firm code; `bucket` is 1..6; `excluded` is `'Y'`,
 * `'N'`, `'I'`, or a deliberately invalid value (the C25793 numeric
 * case uses `'1'`).
 */
export interface BucketExclusionsRow {
  /** FIRM CODE (column A). Omit to trigger the missing-firm validation. */
  firm?: string | number;
  /** BILLING BUCKET (column B). 1..6 in normal use. */
  bucket?: string | number;
  /** HOUSEHOLD UUID (column C). */
  hh?: string;
  /** CLIENT UUID (column D). */
  client?: string;
  /** ACCOUNT UUID (column E). */
  account?: string;
  /** EXCLUDED action (column F). Normally `'Y'`, `'N'`, or `'I'`. */
  excluded?: string;
  /** Set All Accts to I (column G). Only when `includeSetAllAccts` is on. */
  setAllAcctsToI?: string;
}

export interface BuildBucketXlsxOptions {
  /**
   * Override the template xlsx path. Defaults to the committed
   * template under
   * `tests-billing-servicing/src/fixtures/bucket-exclusions/`.
   * Tests that need a non-canonical base (e.g. the "wrong file
   * format" negative spec) supply their own path.
   */
  templatePath?: string;
  /** Write the resulting xlsx to `outFile` and ALSO return the Buffer. */
  outFile?: string;
  /** Include the optional `Set All Accts to I` column G. */
  includeSetAllAccts?: boolean;
}

const DEFAULT_TEMPLATE_PATH = path.resolve(
  __dirname,
  '../fixtures/bucket-exclusions/BillingBucketExclusions_Import_Template.xlsx'
);

const HEADERS = [
  'FIRM CODE',
  'BILLING BUCKET',
  'HOUSEHOLD UUID',
  'CLIENT UUID',
  'ACCOUNT UUID',
  'EXCLUDED',
] as const;

const SET_ALL_ACCTS_HEADER = 'Set All Accts to I';

/**
 * Build a Billing Bucket Exclusions xlsx from the given row
 * descriptors and return the bytes. When `opts.outFile` is set,
 * also writes the file to disk (creating parent directories as
 * needed) for test fixtures that need to live on disk between steps.
 */
export function buildBucketXlsx(
  rows: BucketExclusionsRow[],
  opts: BuildBucketXlsxOptions = {}
): Buffer {
  const templatePath = opts.templatePath ?? DEFAULT_TEMPLATE_PATH;
  const buf = fs.readFileSync(templatePath);
  const files = readZip(buf);

  const headers: string[] = opts.includeSetAllAccts
    ? [...HEADERS, SET_ALL_ACCTS_HEADER]
    : [...HEADERS];
  const lastColLetter = String.fromCharCode(65 + headers.length - 1);

  // Collect every string value we'll emit, in insertion order, so
  // each unique string gets a stable shared-strings index.
  const valueStrings = new Set<string>();
  for (const r of rows) {
    if (r.hh) valueStrings.add(r.hh);
    if (r.client) valueStrings.add(r.client);
    if (r.account) valueStrings.add(r.account);
    if (r.excluded != null && r.excluded !== '') valueStrings.add(String(r.excluded));
    if (opts.includeSetAllAccts && r.setAllAcctsToI != null && r.setAllAcctsToI !== '') {
      valueStrings.add(String(r.setAllAcctsToI));
    }
  }
  const ssList = [...headers, ...valueStrings];
  const ssIdx = new Map<string, number>(ssList.map((s, i) => [s, i]));

  const ssXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `count="${ssList.length}" uniqueCount="${ssList.length}">` +
    ssList.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('') +
    `</sst>`;
  files.set('xl/sharedStrings.xml', Buffer.from(ssXml, 'utf8'));

  const ssCell = (ref: string, str: string) => `<c r="${ref}" t="s"><v>${ssIdx.get(str)}</v></c>`;
  const numCell = (ref: string, n: string | number) => `<c r="${ref}"><v>${n}</v></c>`;

  const sheetRows: string[] = [];
  sheetRows.push(
    `<row r="1">${headers
      .map((h, i) => ssCell(String.fromCharCode(65 + i) + '1', h))
      .join('')}</row>`
  );
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const cells: string[] = [];
    if (r.firm != null && r.firm !== '') cells.push(numCell('A' + rowNum, r.firm));
    if (r.bucket != null && r.bucket !== '') cells.push(numCell('B' + rowNum, r.bucket));
    if (r.hh) cells.push(ssCell('C' + rowNum, r.hh));
    if (r.client) cells.push(ssCell('D' + rowNum, r.client));
    if (r.account) cells.push(ssCell('E' + rowNum, r.account));
    if (r.excluded != null && r.excluded !== '') {
      cells.push(ssCell('F' + rowNum, String(r.excluded)));
    }
    if (
      opts.includeSetAllAccts &&
      r.setAllAcctsToI != null &&
      r.setAllAcctsToI !== ''
    ) {
      cells.push(ssCell('G' + rowNum, String(r.setAllAcctsToI)));
    }
    sheetRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
  });

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastColLetter}${rows.length + 1}"/>` +
    `<sheetData>${sheetRows.join('')}</sheetData>` +
    `</worksheet>`;
  files.set('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf8'));

  const out = writeZip(files);
  if (opts.outFile) {
    fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
    fs.writeFileSync(opts.outFile, out);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Minimal zip read/write
// ──────────────────────────────────────────────────────────────────
//
// Same store/deflate subset used by `readXlsxSheet` — the template
// files ag-grid and FormBuilder produce only use these two methods.
// Kept inline here to avoid cross-dependency between two helpers
// that both have to read zips but don't share output shapes.

function readZip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();

  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('buildBucketXlsx: template zip EOCD not found');

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
      throw new Error(`buildBucketXlsx: unsupported zip compression method ${method}`);
    }
    files.set(name, data);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) {
    c = c ^ b[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeZip(files: Map<string, Buffer>): Buffer {
  const local: Buffer[] = [];
  const entries: Array<{
    name: string;
    crc: number;
    comp: number;
    unc: number;
    off: number;
    m: number;
  }> = [];
  let off = 0;

  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const useDef = compressed.length < data.length;
    const cd = useDef ? compressed : data;
    const m = useDef ? 8 : 0;
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(m, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(cd.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, cd);

    entries.push({ name, crc, comp: cd.length, unc: data.length, off, m });
    off += lh.length + nameBuf.length + cd.length;
  }

  const cdc: Buffer[] = [];
  let cdSize = 0;
  for (const e of entries) {
    const nb = Buffer.from(e.name, 'utf8');
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(e.m, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(e.crc, 16);
    c.writeUInt32LE(e.comp, 20);
    c.writeUInt32LE(e.unc, 24);
    c.writeUInt16LE(nb.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(e.off, 42);
    cdc.push(c, nb);
    cdSize += c.length + nb.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(off, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...local, ...cdc, eocd]);
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
