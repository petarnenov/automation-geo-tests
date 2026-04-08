#!/usr/bin/env node
// @ts-check
/**
 * Builds a Bucket Exclusions xlsx fixture from a JSON spec, using the original
 * BillingBucketExclusions template as the structural skeleton (so we don't have
 * to write the openxml files from scratch).
 *
 * Strategy: copy the source template, then patch sharedStrings.xml so the
 * placeholder UUID slot expands to one entry per real UUID we want to use, and
 * patch sheet1.xml so each row points to the right shared-string index. This
 * keeps the row layout (one row per HouseHold/Client/Account record) intact.
 *
 * Usage:
 *   node scripts/generate-bucket-fixture.js \
 *     --out tests/fixtures/BillingBucketExclusions_C25789.xlsx \
 *     --firm 106 --bucket 1 \
 *     --hh 836CF7A661EE498497B5C19DFD6C6754 --hh-excluded Y \
 *     --client E4727F2E803F457898ACE52C506F3849 --client-excluded I \
 *     --account C714A5247B954130B30EA28C25F978AF --account-excluded I
 *
 * The order of --account flags is preserved; pass it multiple times to add
 * more account rows.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── arg parsing ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, multi = false) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--' + name) {
      out.push(argv[i + 1]);
      i++;
    }
  }
  return multi ? out : out[0];
}

const out = arg('out');
const firm = arg('firm');
const bucket = arg('bucket');
const hh = arg('hh');
const hhExcluded = arg('hh-excluded') || 'Y';
const client = arg('client');
const clientExcluded = arg('client-excluded') || 'I';
const accounts = arg('account', true);
const accountExcluded = arg('account-excluded') || 'I';

if (!out || !firm || !bucket) {
  console.error('Required: --out FILE --firm N --bucket N (and at least one of --hh/--client/--account)');
  process.exit(1);
}

// ── tiny zip read/write (same as generate-action-fixtures.js) ───────────────
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
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad CD sig');
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

// ── build the fixture ──────────────────────────────────────────────────────
const TEMPLATE = '/home/petar/Downloads/BillingBucketExclusions_Import_Template (2).xlsx';
const buf = fs.readFileSync(TEMPLATE);
const files = readZip(buf);

// 1. Build a fresh sharedStrings.xml from the strings we need.
const headers = [
  'FIRM CODE',
  'BILLING BUCKET',
  'HOUSEHOLD UUID',
  'CLIENT UUID',
  'ACCOUNT UUID',
  'EXCLUDED',
];
const valueStrings = new Set();
const rows = [];
if (hh) {
  rows.push({ kind: 'hh', uuid: hh, excluded: hhExcluded });
  valueStrings.add(hh);
  valueStrings.add(hhExcluded);
}
if (client) {
  rows.push({ kind: 'client', uuid: client, excluded: clientExcluded });
  valueStrings.add(client);
  valueStrings.add(clientExcluded);
}
for (const acct of accounts) {
  rows.push({ kind: 'account', uuid: acct, excluded: accountExcluded });
  valueStrings.add(acct);
  valueStrings.add(accountExcluded);
}
const ssList = [...headers, ...valueStrings];
const ssIdx = new Map(ssList.map((s, i) => [s, i]));

const ssXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ssList.length}" uniqueCount="${ssList.length}">` +
  ssList
    .map((s) => `<si><t xml:space="preserve">${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`)
    .join('') +
  `</sst>`;
files.set('xl/sharedStrings.xml', Buffer.from(ssXml, 'utf8'));

// 2. Build sheet1.xml from scratch in the same shape the template uses.
function ssCell(ref, str) {
  return `<c r="${ref}" t="s"><v>${ssIdx.get(str)}</v></c>`;
}
function numCell(ref, n) {
  return `<c r="${ref}"><v>${n}</v></c>`;
}

const sheetRows = [];
sheetRows.push(
  `<row r="1">${headers.map((h, i) => ssCell(String.fromCharCode(65 + i) + '1', h)).join('')}</row>`
);
rows.forEach((r, i) => {
  const rowNum = i + 2;
  const cells = [];
  cells.push(numCell('A' + rowNum, firm));
  cells.push(numCell('B' + rowNum, bucket));
  if (r.kind === 'hh') cells.push(ssCell('C' + rowNum, r.uuid));
  if (r.kind === 'client') cells.push(ssCell('D' + rowNum, r.uuid));
  if (r.kind === 'account') cells.push(ssCell('E' + rowNum, r.uuid));
  cells.push(ssCell('F' + rowNum, r.excluded));
  sheetRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
});

const sheetXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<dimension ref="A1:F${rows.length + 1}"/>` +
  `<sheetData>${sheetRows.join('')}</sheetData>` +
  `</worksheet>`;
files.set('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf8'));

const outAbs = path.resolve(out);
fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, writeZip(files));
console.log(`✓ ${path.relative(process.cwd(), outAbs)}`);
console.log(`  rows: ${rows.length}  (${rows.map((r) => r.kind).join(', ')})`);
