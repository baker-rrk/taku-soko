/* zip_store.js — ZIP を「解凍せずに」読むストア（メインプロセス専用）
 *  yauzl（lazyEntries / autoClose:false）で中央ディレクトリだけを読み、必要なエントリだけをストリームで取り出す。
 *  ココフォリアの書き出し ZIP や、素材の ZIP を、フォルダへ展開せずにそのまま閲覧するための基盤。
 *  ファイル名は UTF-8 フラグが無ければ「UTF-8 として厳密に解釈 → だめなら Shift_JIS」の順で復元する（日本語環境の ZIP 対策）。 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), yauzl = require('yauzl');

const MAX_ENTRIES = 50000;
const IDLE_CLOSE_MS = 200;
const zips = new Map();   // id → { id, path, mtime, size, zip, activeStreams, idleTimer, map: Map<name, entry>, list }

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', json: 'application/json', txt: 'text/plain; charset=utf-8', pdf: 'application/pdf' };
const mimeOf = name => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
const idOf = p => crypto.createHash('sha1').update(path.resolve(p).toLowerCase()).digest('hex').slice(0, 16);   // URL のホスト名に使える小文字16進

function decodeName(buf, flags) {
  if (typeof buf === 'string') return buf;
  if (flags & 0x800) return buf.toString('utf8');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { /* UTF-8 ではない */ }
  try { return new TextDecoder('shift_jis').decode(buf); } catch (e) { return buf.toString('latin1'); }
}

/** OSのファイルハンドル（yauzl ZipFile）だけを閉じ、エントリ一覧メタデータは保持する（Windowsでのファイルロック防止） */
function releaseZipHandle(z) {
  if (!z) return;
  if (z.idleTimer) { clearTimeout(z.idleTimer); z.idleTimer = null; }
  if (z.zip) {
    const zf = z.zip;
    z.zip = null;
    try { zf.close(); } catch (e) { /* noop */ }
  }
}

function scheduleIdleClose(z, ms = IDLE_CLOSE_MS) {
  if (!z) return;
  if (z.idleTimer) clearTimeout(z.idleTimer);
  if ((z.activeStreams || 0) > 0) return;
  if (ms <= 0) { releaseZipHandle(z); return; }
  z.idleTimer = setTimeout(() => {
    z.idleTimer = null;
    if ((z.activeStreams || 0) <= 0) releaseZipHandle(z);
  }, ms);
  if (z.idleTimer && typeof z.idleTimer.unref === 'function') z.idleTimer.unref();
}

function closeZip(z) {
  if (!z) return;
  releaseZipHandle(z);
  zips.delete(z.id);
}

/** ZIP を開いて（既に開いていて更新されていなければ再利用して）一覧を返す。読み取り後はファイルハンドルを即座に閉じてロックを防ぐ */
function open(p) {
  return new Promise((resolve, reject) => {
    let st; try { st = fs.statSync(p); } catch (e) { return reject(e); }
    if (!st.isFile()) return reject(new Error('ファイルではありません'));
    const id = idOf(p), old = zips.get(id);
    if (old) {
      if (old.mtime === st.mtimeMs && old.size === st.size) return resolve({ id, path: old.path, entries: old.list });
      closeZip(old);
    }
    yauzl.open(p, { lazyEntries: true, autoClose: false, decodeStrings: false }, (err, zip) => {
      if (err) return reject(err);
      const map = new Map(), list = []; let truncated = false;
      zip.on('entry', entry => {
        const name = decodeName(entry.fileName, entry.generalPurposeBitFlag).replace(/\\/g, '/');
        if (list.length >= MAX_ENTRIES) { truncated = true; return zip.readEntry(); }
        const dir = name.endsWith('/');
        if (!/^__MACOSX\//.test(name)) { map.set(name, entry); list.push({ name, size: entry.uncompressedSize, dir }); }
        zip.readEntry();
      });
      zip.on('end', () => {
        try { zip.close(); } catch (er) { /* noop */ }
        const rec = { id, path: p, mtime: st.mtimeMs, size: st.size, zip: null, activeStreams: 0, idleTimer: null, map, list };
        zips.set(id, rec);
        resolve({ id, path: p, entries: list, truncated });
      });
      zip.on('error', e => { try { zip.close(); } catch (er) { /* noop */ } reject(e); });
      zip.readEntry();
    });
  });
}

function ensureZipHandle(z) {
  if (z.zip && z.zip.isOpen !== false) return Promise.resolve(z.zip);
  if (z.openingPromise) return z.openingPromise;
  z.openingPromise = new Promise((resolve, reject) => {
    yauzl.open(z.path, { lazyEntries: true, autoClose: false, decodeStrings: false }, (err, zip) => {
      z.openingPromise = null;
      if (err) return reject(err);
      z.zip = zip;
      zip.on('error', () => releaseZipHandle(z));
      resolve(zip);
    });
  });
  return z.openingPromise;
}

/** エントリの中身を読み出すストリーム（解凍ファイルは作らない）。ストリーム終了・アイドル時にハンドルを自動クローズする */
function openStream(id, name) {
  return new Promise((resolve, reject) => {
    const z = zips.get(id); if (!z) return reject(new Error('ZIP が開かれていません'));
    const entry = z.map.get(name); if (!entry || name.endsWith('/')) return reject(new Error('エントリが見つかりません'));
    if (z.idleTimer) { clearTimeout(z.idleTimer); z.idleTimer = null; }
    ensureZipHandle(z).then(zip => {
      z.activeStreams = (z.activeStreams || 0) + 1;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        z.activeStreams = Math.max(0, (z.activeStreams || 1) - 1);
        scheduleIdleClose(z);
      };
      zip.openReadStream(entry, (err, stream) => {
        if (err) { finish(); return reject(err); }
        stream.once('end', finish);
        stream.once('close', finish);
        stream.once('error', finish);
        resolve(stream);
      });
    }).catch(reject);
  });
}
/** エントリの中身をバッファとして直接読み出す（IPC 経由の高速読み取り用） */
async function readBuffer(id, name) {
  const stream = await openStream(id, name);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.once('end', () => resolve({ buf: Buffer.concat(chunks), mime: mimeOf(name) }));
    stream.once('error', reject);
  });
}
function closeAll() { [...zips.values()].forEach(closeZip); }
const has = id => zips.has(id);
const isHandleOpen = id => { const z = zips.get(id); return !!(z && z.zip && z.zip.isOpen !== false); };

module.exports = { open, openStream, readBuffer, closeAll, closeZip: id => { const z = zips.get(id); if (z) closeZip(z); }, releaseZipHandle: id => { const z = zips.get(id); if (z) releaseZipHandle(z); }, isHandleOpen, mimeOf, idOf, has, decodeName };
