/* app_test49_00_electron.js — Electron（デスクトップアプリ）用の準備。必ず最初に読み込む。
 * デスクトップ（Electron）で動くときだけ Node.js の fs / path / shell が使える。Webブラウザで開いたときは null になり、
 * ファイル保存（資料ファイル・フォルダの一括登録）以外の機能は、これまでどおり動く。 */
const IS_ELECTRON = typeof require === 'function' && typeof process !== 'undefined' && !!(process.versions && process.versions.electron);
if (typeof window !== 'undefined') window.IS_ELECTRON = IS_ELECTRON;
const fs = IS_ELECTRON ? require('fs') : null;
const path = IS_ELECTRON ? require('path') : null;
const { shell, webUtils } = IS_ELECTRON ? require('electron') : { shell: null, webUtils: null };

// データ保存用のルートフォルダ（アプリの実行ディレクトリの _TRPG_Data）。main.js 側で起動前に作成済み
const DATA_ROOT = IS_ELECTRON ? path.join(__dirname, '_TRPG_Data') : null;
const filePathOf = f => (f && f.path) || (webUtils && webUtils.getPathForFile ? (() => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } })() : '');   // ドロップされたファイル／フォルダのPC上のパス

// ===== Webブラウザ互換ブリッジ（GitHub Pages 等の IS_ELECTRON === false 環境でも全機能を動かす） =====
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  const ASSET_PREFIX = 'idb-asset://';
  const DB_NAME = 'discord_forum_tool';
  const DB_VER = 3;
  const MIME_MAP = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/opus',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html', zip: 'application/zip', json: 'application/json'
  };
  const mimeFromName = n => MIME_MAP[String(n || '').split(/[?#]/)[0].split('.').pop().toLowerCase()] || 'application/octet-stream';
  const isLocalAbsPath = p => /^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/)|file:\/\/)/i.test(String(p || '').trim());
  const isAssetRef = p => typeof p === 'string' && p.startsWith(ASSET_PREFIX);
  const assetKeyOf = p => isAssetRef(p) ? p.slice(ASSET_PREFIX.length).split('/')[0] : '';
  const assetBasename = p => {
    const s = String(p || '');
    if (isAssetRef(s)) { const part = s.slice(ASSET_PREFIX.length).split('/').slice(1).join('/'); try { return decodeURIComponent(part || ''); } catch (_) { return part || ''; } }
    return s.split(/[\\/]/).pop() || '';
  };
  const makeRef = (id, name) => ASSET_PREFIX + id + '/' + encodeURIComponent(String(name || 'file'));

  function hashKey(s) {
    let h1 = 0x811c9dc5, h2 = 0xdeadbeef;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2654435761); }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }

  let _dbP = null;
  function openDb() {
    if (typeof idbOpen === 'function') return idbOpen();
    return _dbP || (_dbP = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        ['kv', 'images', 'thumbs', 'assets'].forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { _dbP = null; reject(req.error); };
    }));
  }

  const assetUrls = new Map();
  const knownAssets = new Set();
  const assetMeta = new Map();
  const loadingUrls = new Map();

  async function putAssetRecord(id, rec) {
    const db = await openDb();
    await new Promise((res, rej) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(rec, id);
      tx.oncomplete = () => res();
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
    knownAssets.add(id);
    assetMeta.set(id, { id, name: rec.name, mime: rec.mime, size: rec.size, mtime: rec.mtime, ref: makeRef(id, rec.name) });
    if (rec.blob && !assetUrls.has(id)) {
      try { assetUrls.set(id, URL.createObjectURL(rec.blob)); } catch (_) {}
    }
  }

  async function getAssetRecord(refOrId) {
    const id = isAssetRef(refOrId) ? assetKeyOf(refOrId) : String(refOrId || '');
    if (!id) return null;
    const db = await openDb();
    return new Promise((res, rej) => {
      const r = db.transaction('assets').objectStore('assets').get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  }

  async function saveAssetFile(file, opts) {
    if (!file) return '';
    const o = opts || {};
    const name = String(o.name || file.name || 'file');
    const mime = String(o.mime || file.type || mimeFromName(name));
    const size = Number(file.size || 0);
    const mtime = Number(o.mtime != null ? o.mtime : (file.lastModified || 0));
    const id = o.id || (mtime && size ? 'a_' + hashKey(name + '|' + size + '|' + mtime) : 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    const blob = file instanceof Blob ? file : new Blob([file], { type: mime });
    await putAssetRecord(id, { id, name, mime, size: blob.size, mtime, blob, updatedAt: Date.now() });
    return makeRef(id, name);
  }

  async function saveAssetBytes(bytes, name, mime, opts) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const m = mime || mimeFromName(name);
    const blob = new Blob([u8], { type: m });
    return saveAssetFile(blob, Object.assign({ name: name || 'file', mime: m }, opts || {}));
  }

  async function readAssetBytes(ref) {
    const rec = await getAssetRecord(ref);
    if (!rec || !rec.blob) throw new Error('ブラウザ内に保存されたファイルが見つかりません：' + assetBasename(ref));
    return new Uint8Array(await rec.blob.arrayBuffer());
  }

  async function readAssetBlob(ref) {
    const rec = await getAssetRecord(ref);
    return (rec && rec.blob) || null;
  }

  async function hasAsset(ref) {
    const id = assetKeyOf(ref);
    if (!id) return false;
    if (knownAssets.has(id)) return true;
    const rec = await getAssetRecord(id);
    if (rec) { knownAssets.add(id); return true; }
    return false;
  }

  function hasAssetSync(ref) {
    const id = assetKeyOf(ref);
    return !!id && knownAssets.has(id);
  }

  async function getAssetUrl(ref) {
    const id = assetKeyOf(ref);
    if (!id) return '';
    if (assetUrls.has(id)) return assetUrls.get(id);
    if (loadingUrls.has(id)) return loadingUrls.get(id);
    const p = (async () => {
      try {
        const rec = await getAssetRecord(id);
        if (!rec || !rec.blob) return '';
        knownAssets.add(id);
        assetMeta.set(id, { id, name: rec.name, mime: rec.mime, size: rec.size, mtime: rec.mtime, ref: makeRef(id, rec.name) });
        const u = URL.createObjectURL(rec.blob);
        assetUrls.set(id, u);
        return u;
      } finally { loadingUrls.delete(id); }
    })();
    loadingUrls.set(id, p);
    return p;
  }

  function peekAssetUrl(ref) {
    const id = assetKeyOf(ref);
    if (!id) return '';
    if (assetUrls.has(id)) return assetUrls.get(id);
    void getAssetUrl(ref);
    return '';
  }

  async function warmAssetUrls() {
    try {
      const db = await openDb();
      const rows = await new Promise((res, rej) => {
        const out = [];
        const tx = db.transaction('assets');
        const req = tx.objectStore('assets').openCursor();
        req.onsuccess = ev => {
          const cur = ev.target.result;
          if (!cur) return res(out);
          out.push({ id: cur.key, val: cur.value });
          cur.continue();
        };
        req.onerror = () => rej(req.error);
      });
      rows.forEach(({ id, val }) => {
        knownAssets.add(String(id));
        if (val && typeof val === 'object') {
          assetMeta.set(String(id), { id: String(id), name: val.name || '', mime: val.mime || '', size: val.size || 0, mtime: val.mtime || 0, ref: makeRef(id, val.name || 'file') });
          if (val.blob && !assetUrls.has(String(id))) {
            try { assetUrls.set(String(id), URL.createObjectURL(val.blob)); } catch (_) {}
          }
        }
      });
      return [...assetMeta.values()];
    } catch (_) { return []; }
  }

  async function listAssets() {
    await warmAssetUrls();
    return [...assetMeta.values()];
  }

  // ---- CRC32 & Pure-JS ZIP Writer / Reader ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function deflateRaw(u8) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const w = cs.writable.getWriter();
      w.write(u8); w.close();
      const buf = await new Response(cs.readable).arrayBuffer();
      return new Uint8Array(buf);
    } catch (_) { return null; }
  }
  async function inflateRaw(u8) {
    if (typeof DecompressionStream !== 'function') throw new Error('お使いのブラウザは ZIP ファイルの解凍に対応していません');
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(u8); w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function buildZipParts(entries, releaseSource) {
    const list = Array.isArray(entries) ? entries : [];
    const te = new TextEncoder();
    const d = new Date();
    const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    const parts = [], central = [], seen = new Set();
    let offset = 0;
    for (const e of list) {
      const name = String(e.name == null ? '' : e.name).replace(/\\/g, '/').replace(/^\/+/, '');
      if (!name || name.split('/').some(p => p === '..')) throw new Error('ZIPに入れられないファイル名です: ' + e.name);
      const lk = name.toLowerCase();
      if (seen.has(lk)) throw new Error('ZIP内のファイル名が重複しています: ' + name);
      seen.add(lk);
      const raw = e.data instanceof Uint8Array ? e.data : (typeof e.data === 'string' ? te.encode(e.data) : new Uint8Array(e.data || []));
      const rawLen = raw.length;
      const crc = crc32(raw);
      let body = raw, method = 0;
      if (!e.store && rawLen >= 64) {
        const z = await deflateRaw(raw);
        if (z && z.length < rawLen) { body = z; method = 8; }
      }
      const nameBuf = te.encode(name);
      const h = new Uint8Array(30), dv = new DataView(h.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, method, true);
      dv.setUint16(10, dosTime, true); dv.setUint16(12, dosDate, true); dv.setUint32(14, crc, true);
      dv.setUint32(18, body.length, true); dv.setUint32(22, rawLen, true); dv.setUint16(26, nameBuf.length, true); dv.setUint16(28, 0, true);
      parts.push(h, nameBuf);
      if (body.length) parts.push(body);
      if (releaseSource) e.data = null;
      central.push({ nameBuf, method, crc, csize: body.length, usize: rawLen, offset });
      offset += 30 + nameBuf.length + body.length;
    }
    const cdStart = offset; let cdSize = 0;
    for (const c of central) {
      const h = new Uint8Array(46), dv = new DataView(h.buffer);
      dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x0800, true); dv.setUint16(10, c.method, true);
      dv.setUint16(12, dosTime, true); dv.setUint16(14, dosDate, true); dv.setUint32(16, c.crc, true);
      dv.setUint32(20, c.csize, true); dv.setUint32(24, c.usize, true); dv.setUint16(28, c.nameBuf.length, true); dv.setUint32(42, c.offset, true);
      parts.push(h, c.nameBuf);
      cdSize += 46 + c.nameBuf.length;
    }
    const end = new Uint8Array(22), edv = new DataView(end.buffer);
    edv.setUint32(0, 0x06054b50, true); edv.setUint16(8, central.length, true); edv.setUint16(10, central.length, true);
    edv.setUint32(12, cdSize, true); edv.setUint32(16, cdStart, true);
    parts.push(end);
    return { parts, totalSize: offset + cdSize + 22 };
  }

  async function buildZipBlob(entries) {
    const { parts } = await buildZipParts(entries, false);
    return new Blob(parts, { type: 'application/zip' });
  }

  async function buildZipBytes(entries) {
    const { parts, totalSize } = await buildZipParts(entries, true);
    if (IS_ELECTRON && typeof Buffer !== 'undefined' && typeof Buffer.concat === 'function') {
      const buf = Buffer.concat(parts, totalSize);
      parts.length = 0;
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const out = new Uint8Array(totalSize);
    let pos = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], pos);
      pos += parts[i].byteLength;
      parts[i] = null;
    }
    parts.length = 0;
    return out;
  }

  async function readZip(source) {
    let u8;
    if (source instanceof Uint8Array) u8 = source;
    else if (source instanceof ArrayBuffer) u8 = new Uint8Array(source);
    else if (source instanceof Blob) u8 = new Uint8Array(await source.arrayBuffer());
    else if (isAssetRef(source)) u8 = await readAssetBytes(source);
    else throw new Error('ZIPデータを読み込めません');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    const minOff = Math.max(0, u8.length - 65557);
    for (let i = u8.length - 22; i >= minOff; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('有効なZIPファイルではありません');
    const total = dv.getUint16(eocd + 10, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    const tdUtf8 = new TextDecoder('utf-8', { fatal: false });
    let tdSjis = null; try { tdSjis = new TextDecoder('shift_jis'); } catch (_) {}
    const entries = [];
    let p = cdOff;
    for (let i = 0; i < total && p + 46 <= u8.length && p < cdOff + cdSize; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lhoff = dv.getUint32(p + 42, true);
      const nameBytes = u8.subarray(p + 46, p + 46 + nlen);
      let name = tdUtf8.decode(nameBytes);
      if (!(flags & 0x0800) && /\uFFFD/.test(name) && tdSjis) {
        try { name = tdSjis.decode(nameBytes); } catch (_) {}
      }
      name = name.replace(/\\/g, '/');
      const dir = name.endsWith('/');
      entries.push({ name, dir, size: usize, csize, method, lhoff });
      p += 46 + nlen + elen + clen;
    }
    async function readEntry(entry) {
      if (!entry || entry.dir) return new Uint8Array(0);
      const off = entry.lhoff;
      if (off + 30 > u8.length || dv.getUint32(off, true) !== 0x04034b50) throw new Error('ZIPファイル内のデータが壊れているか読み込めません: ' + entry.name);
      const nlen = dv.getUint16(off + 26, true);
      const elen = dv.getUint16(off + 28, true);
      const start = off + 30 + nlen + elen;
      const comp = u8.subarray(start, start + entry.csize);
      if (entry.method === 0) return new Uint8Array(comp);
      if (entry.method === 8) return inflateRaw(comp);
      throw new Error('未対応のZIP圧縮方式です (' + entry.method + ')');
    }
    return { entries, readEntry };
  }

  function downloadBlob(data, filename, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || mimeFromName(filename) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 10000);
    return url;
  }

  function pickFiles(opts) {
    const o = opts || {};
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (o.multiple) inp.multiple = true;
      if (o.accept) inp.accept = o.accept;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      let done = false;
      const finish = list => { if (done) return; done = true; inp.remove(); resolve(list); };
      inp.onchange = () => finish([...(inp.files || [])]);
      window.addEventListener('focus', () => setTimeout(() => finish([]), 600), { once: true });
      inp.click();
    });
  }

  async function walkDirHandle(handle, prefix) {
    const out = [];
    for await (const [name, entry] of handle.entries()) {
      if (name.startsWith('.') || name === 'node_modules' || name === '_TRPG_Data') continue;
      const rel = prefix ? prefix + '/' + name : name;
      if (entry.kind === 'directory') {
        if (/^(?:old|旧|backup|bk|archive|アーカイブ)$/i.test(name)) continue;
        const sub = await walkDirHandle(entry, rel);
        out.push(...sub);
      } else if (entry.kind === 'file') {
        try {
          const f = await entry.getFile();
          out.push({ file: f, name: f.name, rel });
        } catch (_) {}
      }
    }
    return out;
  }

  async function kvGet(key) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async function kvSet(key, val) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
  }

  async function pickDirectory(opts) {
    const o = opts || {};
    const canPicker = typeof window.showDirectoryPicker === 'function' && /^https?:$/i.test(location.protocol);
    if (canPicker) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        const files = await walkDirHandle(handle, handle.name);
        return { handle, rootName: handle.name, files };
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
      }
    }
    if (o.strictHandleOnly) return null;
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.webkitdirectory = true;
      inp.multiple = true;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      let done = false;
      const finish = res => { if (done) return; done = true; inp.remove(); resolve(res); };
      inp.onchange = () => {
        const raw = [...(inp.files || [])];
        if (!raw.length) return finish(null);
        const firstRel = raw[0].webkitRelativePath || raw[0].name;
        const rootName = firstRel.split('/').filter(Boolean)[0] || 'folder';
        finish({ handle: null, rootName, files: raw.map(f => ({ file: f, name: f.name, rel: f.webkitRelativePath || f.name })) });
      };
      window.addEventListener('focus', () => setTimeout(() => finish(null), 600), { once: true });
      inp.click();
    });
  }

  async function readDroppedEntries(dt) {
    const items = dt && dt.items ? [...dt.items] : [];
    const entries = items.map(it => it.webkitGetAsEntry ? it.webkitGetAsEntry() : null).filter(Boolean);
    if (!entries.length) {
      return [...(dt && dt.files || [])].map(f => ({ file: f, name: f.name, rel: f.webkitRelativePath || f.name, fromDir: false, rootFolder: '' }));
    }
    const readAllDir = reader => new Promise(res => {
      const acc = [];
      const step = () => reader.readEntries(batch => { if (!batch.length) res(acc); else { acc.push(...batch); step(); } }, () => res(acc));
      step();
    });
    const out = [];
    async function walk(entry, prefix, rootFolder) {
      if (!entry || entry.name.startsWith('.') || entry.name === 'node_modules') return;
      if (entry.isFile) {
        await new Promise(res => entry.file(f => {
          const rel = prefix ? prefix + '/' + f.name : f.name;
          out.push({ file: f, name: f.name, rel, fromDir: !!rootFolder, rootFolder });
          res();
        }, () => res()));
      } else if (entry.isDirectory) {
        if (rootFolder && /^(?:old|旧|backup|bk|archive|アーカイブ)$/i.test(entry.name)) return;
        const list = await readAllDir(entry.createReader());
        list.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
        const nextPrefix = prefix ? prefix + '/' + entry.name : entry.name;
        const rf = rootFolder || entry.name;
        for (const child of list) await walk(child, nextPrefix, rf);
      }
    }
    for (const ent of entries) await walk(ent, '', ent.isDirectory ? ent.name : '');
    return out;
  }

  // ---- 方式B：Web版 クラウド同期ディレクトリハンドル永続化 & 読み書き ----
  const SYNC_DIR_KV_KEY = 'cloud_sync_dir_handle';
  async function saveSyncDirHandle(handle) {
    await kvSet(SYNC_DIR_KV_KEY, handle || null);
  }
  async function loadSyncDirHandle() {
    try { return (await kvGet(SYNC_DIR_KV_KEY)) || null; } catch (_) { return null; }
  }
  async function clearSyncDirHandle() {
    try { await kvSet(SYNC_DIR_KV_KEY, null); } catch (_) {}
  }
  async function ensureDirPermission(handle, ask) {
    if (!handle) return false;
    try {
      const opts = { mode: 'readwrite' };
      if (typeof handle.queryPermission === 'function') {
        const st = await handle.queryPermission(opts);
        if (st === 'granted') return true;
        if (st === 'prompt' && ask && typeof handle.requestPermission === 'function') {
          return (await handle.requestPermission(opts)) === 'granted';
        }
        return false;
      }
      return true;
    } catch (_) { return false; }
  }
  async function pickSyncDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') {
      return { unsupported: true };
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const ok = await ensureDirPermission(handle, true);
      if (!ok) return { denied: true };
      await saveSyncDirHandle(handle);
      return { handle, rootName: handle.name || 'folder' };
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
      throw e;
    }
  }
  async function resolveSubDir(rootHandle, parts, create) {
    let cur = rootHandle;
    for (const seg of (parts || [])) {
      if (!seg) continue;
      cur = await cur.getDirectoryHandle(seg, { create: !!create });
    }
    return cur;
  }
  async function writeHandleFile(rootHandle, relParts, bytes) {
    const arr = (Array.isArray(relParts) ? relParts : String(relParts || '').split('/')).filter(Boolean);
    if (!arr.length) throw new Error('無効なファイルパスです');
    const fileName = arr.pop();
    const dir = await resolveSubDir(rootHandle, arr, true);
    const fh = await dir.getFileHandle(fileName, { create: true });
    const wr = await fh.createWritable();
    try {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
      await wr.write(u8);
      await wr.close();
    } catch (e) {
      try { await wr.abort(); } catch (_) {}
      throw e;
    }
  }
  async function readHandleFile(rootHandle, relParts, opts) {
    const arr = (Array.isArray(relParts) ? relParts : String(relParts || '').split('/')).filter(Boolean);
    if (!arr.length) return null;
    const fileName = arr.pop();
    try {
      const dir = await resolveSubDir(rootHandle, arr, false);
      const fh = await dir.getFileHandle(fileName, { create: false });
      return await readCloudFileAsync(fh, opts);
    } catch (e) {
      if (e && (e.name === 'NotFoundError' || e.code === 'ENOENT')) return null;
      throw e;
    }
  }
  async function listHandleFiles(rootHandle, relParts) {
    const arr = (Array.isArray(relParts) ? relParts : String(relParts || '').split('/')).filter(Boolean);
    try {
      const dir = await resolveSubDir(rootHandle, arr, false);
      const out = [];
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind === 'file') out.push({ name, handle: entry });
      }
      return out;
    } catch (e) {
      if (e && e.name === 'NotFoundError') return [];
      return [];
    }
  }

  // ---- OneDrive / PC版Gドライブ等の「オンライン専用ファイル」フリーズ防止ガード ----
  let _slowToastShownAt = 0;
  function notifyCloudSlow(msg, onSlow, showToast) {
    if (typeof onSlow === 'function') { try { onSlow(msg); } catch (_) {} }
    if (showToast !== true) return;
    const now = Date.now();
    if (now - _slowToastShownAt > 4000) {
      _slowToastShownAt = now;
      try { if (typeof toast === 'function') toast(msg); } catch (_) {}
    }
  }
  async function readCloudFileAsync(source, opts) {
    const o = opts || {};
    const slowMs = Number(o.slowMs) > 0 ? Number(o.slowMs) : 1200;
    const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : 45000;
    let slowTimer = null;
    const startSlowWatch = () => {
      clearTimeout(slowTimer);
      if (o.showToast !== true && typeof o.onSlow !== 'function') return;
      slowTimer = setTimeout(() => notifyCloudSlow('☁️ クラウドドライブからファイルを読み込んでいます...', o.onSlow, o.showToast === true), slowMs);
    };
    const stopSlowWatch = () => { clearTimeout(slowTimer); slowTimer = null; };

    // Electron: 非同期ストリーム読み込み＋無通信タイムアウト検知
    if (typeof source === 'string') {
      if (!IS_ELECTRON || !fs) throw new Error('ファイルシステムが利用できません');
      startSlowWatch();
      try {
        const st = await fs.promises.stat(source);
        if (!st || !st.isFile()) throw new Error('ファイルが見つかりません: ' + source);
        return await new Promise((resolve, reject) => {
          const chunks = [];
          let total = 0;
          let settled = false;
          let inactivityTimer = null;
          const stream = fs.createReadStream(source, { highWaterMark: 256 * 1024 });
          const cleanup = () => { clearTimeout(inactivityTimer); stopSlowWatch(); };
          const resetTimeout = () => {
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => {
              if (settled) return;
              settled = true;
              try { stream.destroy(); } catch (_) {}
              cleanup();
              reject(new Error('クラウドドライブからのファイル取得がタイムアウトしました: ' + source));
            }, timeoutMs);
          };
          resetTimeout();
          stream.on('data', chunk => {
            resetTimeout();
            const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            chunks.push(u8);
            total += u8.byteLength;
          });
          stream.on('end', () => {
            if (settled) return;
            settled = true;
            cleanup();
            const out = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) { out.set(c, off); off += c.byteLength; }
            resolve(out);
          });
          stream.on('error', err => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
          });
        });
      } finally {
        stopSlowWatch();
      }
    }

    // Web: FileSystemFileHandle / File / Blob
    startSlowWatch();
    try {
      const file = (source && typeof source.getFile === 'function')
        ? await Promise.race([
            source.getFile(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('クラウドドライブからのファイル取得がタイムアウトしました')), timeoutMs))
          ])
        : source;
      if (!file || typeof file.arrayBuffer !== 'function') throw new Error('読み込めないファイル形式です');
      if (typeof file.stream === 'function') {
        const reader = file.stream().getReader();
        const chunks = [];
        let total = 0;
        while (true) {
          let tid = null;
          const res = await Promise.race([
            reader.read(),
            new Promise((_, rej) => { tid = setTimeout(() => rej(new Error('クラウドファイルの読み込みがタイムアウトしました')), timeoutMs); })
          ]).finally(() => clearTimeout(tid));
          if (res.done) break;
          if (res.value) { chunks.push(res.value); total += res.value.byteLength; }
        }
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.byteLength; }
        return out;
      }
      const buf = await Promise.race([
        file.arrayBuffer(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('クラウドファイルの読み込みがタイムアウトしました')), timeoutMs))
      ]);
      return new Uint8Array(buf);
    } finally {
      stopSlowWatch();
    }
  }
  window.readCloudFileAsync = readCloudFileAsync;

  // ---- GZIP 圧縮・SHA-256 ハッシュ・WebP 変換ユーティリティ ----
  async function gzipCompress(input) {
    const te = new TextEncoder();
    const u8 = typeof input === 'string' ? te.encode(input) : (input instanceof Uint8Array ? input : new Uint8Array(input || []));
    if (typeof CompressionStream === 'function') {
      try {
        const cs = new CompressionStream('gzip');
        const w = cs.writable.getWriter();
        const writeP = w.write(u8).then(() => w.close());
        const readP = new Response(cs.readable).arrayBuffer();
        const [, buf] = await Promise.all([writeP, readP]);
        return new Uint8Array(buf);
      } catch (_) {}
    }
    if (IS_ELECTRON && typeof require === 'function') {
      const zlib = require('zlib');
      const buf = await new Promise((res, rej) => zlib.gzip(Buffer.from(u8), (e, r) => e ? rej(e) : res(r)));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return u8;
  }
  async function gzipDecompress(input) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
      if (typeof DecompressionStream === 'function') {
        try {
          const ds = new DecompressionStream('gzip');
          const w = ds.writable.getWriter();
          const writeP = w.write(u8).then(() => w.close());
          const readP = new Response(ds.readable).arrayBuffer();
          const [, buf] = await Promise.all([writeP, readP]);
          return new Uint8Array(buf);
        } catch (_) {}
      }
      if (IS_ELECTRON && typeof require === 'function') {
        const zlib = require('zlib');
        const buf = await new Promise((res, rej) => zlib.gunzip(Buffer.from(u8), (e, r) => e ? rej(e) : res(r)));
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      }
    }
    return u8;
  }
  async function gzipDecompressText(input) {
    const u8 = await gzipDecompress(input);
    return new TextDecoder('utf-8').decode(u8);
  }
  async function sha256Hex(input) {
    const u8 = typeof input === 'string'
      ? new TextEncoder().encode(input)
      : (input instanceof Uint8Array ? input : new Uint8Array(input || []));
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      try {
        const hashBuf = await crypto.subtle.digest('SHA-256', u8);
        return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (_) {}
    }
    if (IS_ELECTRON && typeof require === 'function') {
      return require('crypto').createHash('sha256').update(u8).digest('hex').toLowerCase();
    }
    throw new Error('ファイルの確認処理を実行できませんでした');
  }
  async function compressImageToWebp(blobOrU8, mime, opts) {
    const o = opts || {};
    const srcBlob = blobOrU8 instanceof Blob ? blobOrU8 : new Blob([blobOrU8], { type: mime || 'image/png' });
    const srcMime = String(mime || srcBlob.type || '').toLowerCase();
    if (/svg|gif/.test(srcMime)) {
      const origU8 = new Uint8Array(await srcBlob.arrayBuffer());
      return { bytes: origU8, mime: srcMime || 'image/png', compressed: false };
    }
    try {
      const origU8 = new Uint8Array(await srcBlob.arrayBuffer());
      const bmp = await createImageBitmap(srcBlob);
      const maxDim = Number(o.maxDim) > 0 ? Number(o.maxDim) : 0;
      let w = bmp.width, h = bmp.height;
      if (maxDim && Math.max(w, h) > maxDim) {
        const sc = maxDim / Math.max(w, h);
        w = Math.max(1, Math.round(w * sc));
        h = Math.max(1, Math.round(h * sc));
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      const quality = typeof o.quality === 'number' ? o.quality : 0.88;
      const webpBlob = await new Promise(res => c.toBlob(res, 'image/webp', quality));
      if (!webpBlob) return { bytes: origU8, mime: srcMime || 'image/png', compressed: false };
      const webpU8 = new Uint8Array(await webpBlob.arrayBuffer());
      if (o.force || webpU8.byteLength < origU8.byteLength * 0.95) {
        return { bytes: webpU8, mime: 'image/webp', compressed: true };
      }
      return { bytes: origU8, mime: srcMime || 'image/png', compressed: false };
    } catch (_) {
      const origU8 = blobOrU8 instanceof Uint8Array ? blobOrU8 : new Uint8Array(await srcBlob.arrayBuffer());
      return { bytes: origU8, mime: srcMime || 'image/png', compressed: false };
    }
  }
  async function makeCardThumbWebp(blobOrU8, mime) {
    return compressImageToWebp(blobOrU8, mime, { maxDim: 320, quality: 0.72, force: true });
  }
  window.CloudCodec = { gzipCompress, gzipDecompress, gzipDecompressText, sha256Hex, compressImageToWebp, makeCardThumbWebp };

  const AUTH_FILE_NAME = 'gdrive_auth.json';
  function loadGDriveAuthFromDisk() {
    if (!IS_ELECTRON || !fs || !path || !DATA_ROOT) return null;
    try {
      const fp = path.join(DATA_ROOT, AUTH_FILE_NAME);
      if (!fs.existsSync(fp)) return null;
      const raw = fs.readFileSync(fp, 'utf8');
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : null;
    } catch (_) { return null; }
  }
  function saveGDriveAuthToDisk(data) {
    if (!IS_ELECTRON || !fs || !path || !DATA_ROOT) return;
    try {
      fs.mkdirSync(DATA_ROOT, { recursive: true });
      const fp = path.join(DATA_ROOT, AUTH_FILE_NAME);
      const tmp = fp + '.tmp_' + Date.now();
      fs.writeFileSync(tmp, JSON.stringify(data || {}, null, 2), 'utf8');
      fs.renameSync(tmp, fp);
    } catch (_) {}
  }
  function clearGDriveAuthFromDisk() {
    if (!IS_ELECTRON || !fs || !path || !DATA_ROOT) return;
    try {
      const fp = path.join(DATA_ROOT, AUTH_FILE_NAME);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (_) {}
  }
  window.ElectronAuthStorage = {
    loadGDriveAuth: loadGDriveAuthFromDisk,
    saveGDriveAuth: saveGDriveAuthToDisk,
    clearGDriveAuth: clearGDriveAuthFromDisk
  };

  window.WebBridge = {
    ASSET_PREFIX, mimeFromName, isLocalAbsPath, isAssetRef, assetKeyOf, assetBasename, makeRef,
    openDb, kvGet, kvSet, saveAssetFile, saveAssetBytes, getAssetRecord, readAssetBytes, readAssetBlob,
    hasAsset, hasAssetSync, getAssetUrl, peekAssetUrl, warmAssetUrls, listAssets,
    crc32, buildZipBlob, buildZipBytes, readZip, downloadBlob, pickFiles, pickDirectory, walkDirHandle, readDroppedEntries,
    saveSyncDirHandle, loadSyncDirHandle, clearSyncDirHandle, ensureDirPermission, pickSyncDirectory,
    writeHandleFile, readHandleFile, listHandleFiles, readCloudFileAsync
  };
  if (typeof window !== 'undefined' && !IS_ELECTRON) {
    const startWarm = () => { setTimeout(() => { void warmAssetUrls(); }, 800); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWarm);
    else startWarm();
  }
})();
