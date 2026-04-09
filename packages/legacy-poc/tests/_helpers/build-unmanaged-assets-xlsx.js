// @ts-check
/**
 * Builds an Unmanaged Assets Exclusions xlsx in memory and returns its bytes
 * (or writes to disk).
 *
 * Used by the validation specs (C25446, C25448, C25449, C25450, C25451) which
 * need deliberately broken fixtures generated at test time. Reuses the original
 * template's structural skeleton (zip + worksheet shape).
 *
 * Public API:
 *
 *   buildUnmanagedAssetsXlsx(rows, opts) → Buffer
 *
 *   `rows` is an array of partial row objects, each with optional fields:
 *     {
 *       firmCode, accountUuid, ignoreFirm, instrumentUuid, action,
 *       excludeFromPerformance,
 *       advisorPortfolioType, platformPortfolioType, mmPortfolioType,
 *       internalAdvisorPortfolioType, internalPlatformType, internalMmPortfolioType,
 *     }
 *   Any field can be omitted to produce a deliberately incomplete row.
 *
 *   `opts.outFile` (optional) writes the xlsx to disk and also returns it.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEMPLATE = '/home/petar/Downloads/UnmanagedAssetsExclusions_Import_Template (15).xlsx';

const HEADERS = [
  'Firm Code', // A
  'Account UUID', // B
  'Ignore Firm', // C
  'Instrument UUID', // D
  'Action', // E
  'Exclude from Performance', // F
  'Advisor Portfolio Type', // G
  'Platform portfolio Type', // H
  'MM Portfolio Type', // I
  'Internal Advisor Portfolio Type', // J
  'Internal Platform Type', // K
  'Internal MM Portfolio Type', // L
];

const COL_KEYS = [
  'firmCode',
  'accountUuid',
  'ignoreFirm',
  'instrumentUuid',
  'action',
  'excludeFromPerformance',
  'advisorPortfolioType',
  'platformPortfolioType',
  'mmPortfolioType',
  'internalAdvisorPortfolioType',
  'internalPlatformType',
  'internalMmPortfolioType',
];

const NUMERIC_KEYS = new Set([
  'firmCode',
  'advisorPortfolioType',
  'platformPortfolioType',
  'mmPortfolioType',
  'internalAdvisorPortfolioType',
  'internalPlatformType',
  'internalMmPortfolioType',
]);

// ── tiny zip read/write (same as build-bucket-xlsx.js) ─────────────────────
function readZip(buf) {
  const files = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD not found');
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
    else throw new Error('method ' + method);
    files.set(name, data);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

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

/**
 * @param {Array<Record<string, any>>} rows
 * @param {{outFile?: string}} [opts]
 * @returns {Buffer}
 */
function buildUnmanagedAssetsXlsx(rows, opts = {}) {
  const buf = fs.readFileSync(TEMPLATE);
  const files = readZip(buf);

  const valueStrings = new Set();
  for (const r of rows) {
    for (const key of COL_KEYS) {
      if (NUMERIC_KEYS.has(key)) continue;
      const v = r[key];
      if (v != null && v !== '') valueStrings.add(String(v));
    }
  }
  const ssList = [...HEADERS, ...valueStrings];
  const ssIdx = new Map(ssList.map((s, i) => [s, i]));
  const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const ssXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ssList.length}" uniqueCount="${ssList.length}">` +
    ssList.map((s) => `<si><t xml:space="preserve">${escape(s)}</t></si>`).join('') +
    `</sst>`;
  files.set('xl/sharedStrings.xml', Buffer.from(ssXml, 'utf8'));

  const colLetter = (i) => String.fromCharCode(65 + i);
  const ssCell = (ref, str) => `<c r="${ref}" t="s"><v>${ssIdx.get(str)}</v></c>`;
  const numCell = (ref, n) => `<c r="${ref}"><v>${n}</v></c>`;

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
      if (NUMERIC_KEYS.has(key)) cells.push(numCell(ref, v));
      else cells.push(ssCell(ref, String(v)));
    });
    sheetRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
  });

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:L${rows.length + 1}"/>` +
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

/**
 * Convenience: returns a fully-populated valid row (the C26073 reference data).
 * Tests use this as a base and override fields to introduce specific defects.
 */
function validRow() {
  return {
    firmCode: 106,
    accountUuid: '338BD8AB82A244158A5687959967CC59',
    ignoreFirm: 'N',
    instrumentUuid: '5F5FE5576175486BAE2DA9932CEEDD6A',
    action: 'U',
    excludeFromPerformance: 'N',
    advisorPortfolioType: 5,
    platformPortfolioType: 4,
    mmPortfolioType: 3,
    internalAdvisorPortfolioType: 2,
    internalPlatformType: 1,
    internalMmPortfolioType: 5,
  };
}

module.exports = { buildUnmanagedAssetsXlsx, validRow, HEADERS, COL_KEYS };
