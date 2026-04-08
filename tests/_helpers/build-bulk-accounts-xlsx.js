// @ts-check
/**
 * Builds a Bulk Open Accounts xlsx in memory and returns its bytes (or writes
 * to disk). Used by C24943 (Create account using upload) and the related
 * negative-validation specs.
 *
 * The Platform One bulk-create-accounts upload expects a 7-column xlsx with
 * the following columns:
 *
 *   A *AccountNumber       string
 *   B *ClientUUID          string (32-char hex without dashes)
 *   C *AccountNickname     string
 *   D *AccountType         string ("Individual Taxable", "Roth IRA", …)
 *   E *Custodian           string ("Manual Input", "Charles Schwab", …)
 *   F *AccountOpenDate     EXCEL DATE — must be a numeric cell with date
 *                          formatting; the server uses
 *                          `cell.getLocalDateTimeCellValue()` (Apache POI)
 *                          which throws on string cells.
 *   G *DefaultMoneyOption  string (cash equivalent symbol, e.g. "MMDA15")
 *
 * Verified against:
 *   - the canonical template at
 *     `/docs/upload_samples/uploadAccounts/BulkAccountsTemplate.xlsx`
 *   - `CreateAccountAction.parseRow()` in the geowealth source
 *   - `ValidateAccountUtils.validateAccountJto()` for the field-name
 *     expectations
 *
 * Public API:
 *   buildBulkAccountsXlsx(rows, opts) → Buffer
 *
 *   rows: Array<{
 *     accountNumber: string,
 *     clientUuid: string,
 *     accountNickname: string,
 *     accountType: string,
 *     custodian: string,
 *     accountOpenDate: Date | string ('YYYY-MM-DD' or 'MM/DD/YYYY'),
 *     defaultMoneyOption: string,
 *   }>
 *   opts.outFile: optional path to also write to disk
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const HEADERS = [
  '*AccountNumber',
  '*ClientUUID',
  '*AccountNickname',
  '*AccountType',
  '*Custodian',
  '*AccountOpenDate',
  '*DefaultMoneyOption',
];

// ── tiny zip writer (no template needed; we synthesize the whole xlsx) ─────
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) {
    c = c ^ b[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeZip(files) {
  const local = [];
  const entries = [];
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
  const cdc = [];
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

// ── date helpers ───────────────────────────────────────────────────────────
/**
 * Convert a JS Date to an Excel serial number (days since 1899-12-30, UTC).
 * Apache POI on the server interprets numeric cells with date format as
 * java.util.Date via `cell.getLocalDateTimeCellValue()`.
 */
function toExcelSerial(date) {
  const epoch = Date.UTC(1899, 11, 30);
  return Math.floor((date.getTime() - epoch) / 86400000);
}

function parseDateInput(d) {
  if (d instanceof Date) return d;
  // Accept YYYY-MM-DD or MM/DD/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day));
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d)) {
    const [m, day, y] = d.split('/').map(Number);
    return new Date(Date.UTC(y, m - 1, day));
  }
  throw new Error(`buildBulkAccountsXlsx: unsupported date format "${d}"`);
}

// ── xlsx parts ─────────────────────────────────────────────────────────────
const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>` +
  `</workbook>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

// styles.xml has TWO cellXfs entries:
//   index 0 (default): no formatting — used for string cells
//   index 1 (date): numFmtId=14 (built-in m/d/yyyy) — used for the date cell.
//                   Apache POI uses this to detect that the numeric value
//                   represents a date.
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="1"><font><sz val="10"/><name val="Arial"/></font></fonts>` +
  `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

const COL_KEYS = [
  'accountNumber',
  'clientUuid',
  'accountNickname',
  'accountType',
  'custodian',
  'accountOpenDate',
  'defaultMoneyOption',
];

/**
 * @param {Array<Record<string, any>>} rows
 * @param {{outFile?: string}} [opts]
 * @returns {Buffer}
 */
function buildBulkAccountsXlsx(rows, opts = {}) {
  // Collect every distinct string we'll need into the shared-strings table
  // (POI is happy if string cells reference sharedStrings rather than inlining
  // the value, and it matches the canonical template).
  const valueStrings = new Set();
  for (const r of rows) {
    for (const key of COL_KEYS) {
      if (key === 'accountOpenDate') continue;
      const v = r[key];
      if (v != null && v !== '') valueStrings.add(String(v));
    }
  }
  const ssList = [...HEADERS, ...valueStrings];
  const ssIdx = new Map(ssList.map((s, i) => [s, i]));
  const escape = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const ssXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ssList.length}" uniqueCount="${ssList.length}">` +
    ssList
      .map((s) => `<si><t xml:space="preserve">${escape(s)}</t></si>`)
      .join('') +
    `</sst>`;

  const colLetter = (i) => String.fromCharCode(65 + i);
  const ssCell = (ref, str) =>
    `<c r="${ref}" t="s"><v>${ssIdx.get(str)}</v></c>`;
  const dateCell = (ref, serial) =>
    `<c r="${ref}" s="1"><v>${serial}</v></c>`;

  const sheetRows = [];
  sheetRows.push(
    `<row r="1">${HEADERS.map((h, i) => ssCell(colLetter(i) + '1', h)).join('')}</row>`
  );

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const cells = [];
    COL_KEYS.forEach((key, ci) => {
      const v = r[key];
      if (v == null || v === '') return;
      const ref = colLetter(ci) + rowNum;
      if (key === 'accountOpenDate') {
        cells.push(dateCell(ref, toExcelSerial(parseDateInput(v))));
      } else {
        cells.push(ssCell(ref, String(v)));
      }
    });
    sheetRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
  });

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:G${rows.length + 1}"/>` +
    `<sheetData>${sheetRows.join('')}</sheetData>` +
    `</worksheet>`;

  const files = new Map();
  files.set('[Content_Types].xml', Buffer.from(CONTENT_TYPES, 'utf8'));
  files.set('_rels/.rels', Buffer.from(ROOT_RELS, 'utf8'));
  files.set('xl/workbook.xml', Buffer.from(WORKBOOK, 'utf8'));
  files.set('xl/_rels/workbook.xml.rels', Buffer.from(WORKBOOK_RELS, 'utf8'));
  files.set('xl/sharedStrings.xml', Buffer.from(ssXml, 'utf8'));
  files.set('xl/styles.xml', Buffer.from(STYLES, 'utf8'));
  files.set('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf8'));

  const out = writeZip(files);
  if (opts.outFile) {
    fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
    fs.writeFileSync(opts.outFile, out);
  }
  return out;
}

module.exports = { buildBulkAccountsXlsx, HEADERS, COL_KEYS };
