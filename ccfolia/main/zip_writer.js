/* zip_writer.js — 依存ライブラリ無しの ZIP 書き出し（Node 標準の zlib / fs のみ）。ココフォリアのルーム／駒 ZIP の出力用。
 *  ・ファイル名は UTF-8（汎用ビット 11）／圧縮は deflate、圧縮しても小さくならないものと音声・画像など圧縮済みは無圧縮（store）
 *  ・一時ファイルへ書いてから rename し、途中で失敗しても壊れた ZIP を残さない（ファイルハンドルは必ず close する）
 *  ・ZIP64 は使わない（4GB 超・65535 エントリ超はエラーにする）
 *    const { writeZip } = require('./zip_writer.js');  writeZip('out.zip', [{ name: '__data.json', data: Buffer }, { name: '<sha256>', data: Buffer, store: true }]); */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function dosDateTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return { time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, date: (((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF };
}
function safeEntryName(n) {
  const s = String(n == null ? '' : n).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.split('/').some(p => p === '..')) throw new Error('ZIPに入れられないファイル名です: ' + n);
  return s;
}
function writeAll(fd, buf) { let off = 0; while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off); }

/** entries: [{ name, data: Buffer|Uint8Array, store?: boolean }] を file へ書き出す。戻り値 { bytes, count } */
function writeZip(file, entries, opts) {
  const o = opts || {}, list = Array.isArray(entries) ? entries : [];
  if (list.length > 65534) throw new Error('エントリが多すぎます（' + list.length + '）');
  const now = dosDateTime(o.mtime instanceof Date ? o.mtime : new Date());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  let fd = null, ok = false;
  try {
    fd = fs.openSync(tmp, 'w');
    const central = [], seen = new Set(); let offset = 0;
    for (const e of list) {
      const name = safeEntryName(e.name), key = name.toLowerCase();
      if (seen.has(key)) throw new Error('ZIP内のファイル名が重複しています: ' + name); seen.add(key);
      const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || []);
      if (data.length >= 0xFFFFFFFF) throw new Error('4GB以上のファイルは入れられません: ' + name);
      const crc = crc32(data); let body = data, method = 0;
      if (!e.store && !o.store && data.length >= 64) { const z = zlib.deflateRawSync(data, { level: 6 }); if (z.length < data.length) { body = z; method = 8; } }
      const nameBuf = Buffer.from(name, 'utf8'), h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
      h.writeUInt16LE(now.time, 10); h.writeUInt16LE(now.date, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22);
      h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
      writeAll(fd, h); writeAll(fd, nameBuf); if (body.length) writeAll(fd, body);
      central.push({ nameBuf, method, crc, csize: body.length, usize: data.length, offset });
      offset += 30 + nameBuf.length + body.length;
      if (offset >= 0xFFFFFFFF) throw new Error('ZIPが4GBを超えます');
    }
    const cdStart = offset; let cdSize = 0;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(now.time, 12); h.writeUInt16LE(now.date, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.usize, 24);
      h.writeUInt16LE(c.nameBuf.length, 28); h.writeUInt32LE(c.offset, 42);
      writeAll(fd, h); writeAll(fd, c.nameBuf); cdSize += 46 + c.nameBuf.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(cdStart, 16);
    writeAll(fd, end);
    fs.closeSync(fd); fd = null;
    fs.renameSync(tmp, file); ok = true;
    return { bytes: cdStart + cdSize + 22, count: central.length };
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (e) { /* noop */ } }
    if (!ok) { try { fs.unlinkSync(tmp); } catch (e) { /* noop */ } }
  }
}

module.exports = { writeZip, crc32 };
