#!/usr/bin/env node
// @ts-check
/**
 * Derives D-action and RA-action xlsx fixtures from the existing U-action template
 * by replacing the single "U" shared string with "D" / "RA". The rest of the workbook
 * (firm code, account UUID, instrument UUID, portfolio types) is unchanged.
 *
 * Run once: `node scripts/generate-action-fixtures.js`
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FIXTURE_DIR = path.join(__dirname, '..', 'tests', 'fixtures');
const SOURCE = path.join(FIXTURE_DIR, 'UnmanagedAssetsExclusions_C26073_U.xlsx');

// Minimal zip read/write — just enough to swap one inner file's bytes.
function readZip(buf) {
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  // Locate End of Central Directory record (EOCD).
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('EOCD not found');
  const cdEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central dir signature at ' + p);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // Local file header
    if (buf.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error('Bad local header for ' + name);
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
    const compData = buf.slice(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = compData;
    else if (method === 8) data = zlib.inflateRawSync(compData);
    else throw new Error('Unknown method ' + method + ' for ' + name);
    if (data.length !== uncSize) throw new Error('Decompressed size mismatch for ' + name);
    files.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crc ^ buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeZip(files) {
  const localChunks = [];
  /** @type {Array<{name: string, crc: number, comp: number, unc: number, offset: number, method: number}>} */
  const entries = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const compData = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0x21, 12); // mod date (arbitrary)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compData.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localChunks.push(lh, nameBuf, compData);
    entries.push({
      name,
      crc,
      comp: compData.length,
      unc: data.length,
      offset,
      method,
    });
    offset += lh.length + nameBuf.length + compData.length;
  }

  const cdChunks = [];
  let cdSize = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(e.method, 10);
    cd.writeUInt16LE(0, 12); // time
    cd.writeUInt16LE(0x21, 14); // date
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.comp, 20);
    cd.writeUInt32LE(e.unc, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(e.offset, 42);
    cdChunks.push(cd, nameBuf);
    cdSize += cd.length + nameBuf.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk start
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localChunks, ...cdChunks, eocd]);
}

function generate(action, outBase) {
  const buf = fs.readFileSync(SOURCE);
  const files = readZip(buf);
  const ssXml = files.get('xl/sharedStrings.xml');
  if (!ssXml) throw new Error('xl/sharedStrings.xml not found');
  const text = ssXml.toString('utf8');

  // Replace the standalone "U" string. The shared string for the U action is
  // the only one whose <t> body is exactly "U", so this swap is safe.
  const updated = text.replace(/<t([^>]*)>U<\/t>/, `<t$1>${action}</t>`);
  if (updated === text) {
    throw new Error(`Could not find <t>U</t> in sharedStrings.xml for action=${action}`);
  }
  files.set('xl/sharedStrings.xml', Buffer.from(updated, 'utf8'));

  const out = path.join(FIXTURE_DIR, outBase);
  fs.writeFileSync(out, writeZip(files));
  console.log(`✓ ${outBase}  (action=${action})`);
}

generate('D', 'UnmanagedAssetsExclusions_C26074_D.xlsx');
generate('RA', 'UnmanagedAssetsExclusions_C26075_RA.xlsx');
