/* ccf_zip.js — ZIP を解凍せずに扱うレンダラー側の窓口
 *  ZIP の中身の読み出しはメインプロセス（yauzl）が行い、画像などは独自プロトコル zipview://<zipId>/<エントリ> で直接表示できる。
 *    const z = await CCF.zip.open('C:\\素材\\立ち絵.zip');   // → { id, entries, tree }
 *    img.src = CCF.zip.url(z.id, 'chara/001.png');           // 解凍せずにそのまま表示
 *  ルートフォルダのツリーや、D&D 登録した ZIP の「仮想フォルダ」表示（ccf_library.js）、NPC の立ち絵への取り込みで使う。 */
(function () {
  'use strict';
  const CCF = window.CCF, ipc = (CCF && CCF.electron && CCF.electron.ipcRenderer) || null;
  const cache = new Map();   // 絶対パスまたはファイルキー → { id, path, entries, tree, mtime }
  const memZips = new Map(); // zipId → { entries, entryMap, readEntry, urlCache }
  let memSeq = 0;

  /** エントリ一覧 → 階層ツリー { name, path, dir, children[] }（フォルダ→ファイルの順、名前順） */
  function buildTree(entries) {
    const root = { name: '', path: '', dir: true, children: [] }, dirs = new Map([['', root]]);
    const ensureDir = p => {
      if (dirs.has(p)) return dirs.get(p);
      const i = p.lastIndexOf('/'), parent = ensureDir(i < 0 ? '' : p.slice(0, i)), node = { name: p.slice(i + 1), path: p, dir: true, children: [] };
      parent.children.push(node); dirs.set(p, node); return node;
    };
    entries.forEach(e => {
      const clean = e.name.replace(/\/+$/, ''); if (!clean) return;
      if (e.dir) { ensureDir(clean); return; }
      const i = clean.lastIndexOf('/'), parent = ensureDir(i < 0 ? '' : clean.slice(0, i));
      parent.children.push({ name: clean.slice(i + 1), path: clean, dir: false, size: e.size, children: [] });
    });
    const sort = n => { n.children.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'ja', { numeric: true })); n.children.forEach(sort); };
    sort(root); return root;
  }
  const url = (id, name) => {
    const mz = memZips.get(id);
    if (mz) {
      if (mz.urlCache.has(name)) return mz.urlCache.get(name);
      return 'zipmem://' + id + '/' + String(name).split('/').map(encodeURIComponent).join('/');
    }
    return 'zipview://' + id + '/' + String(name).split('/').map(encodeURIComponent).join('/');
  };

  function parseMemUrl(u) {
    const m = /^zipmem:\/\/([^/]+)\/(.+)$/.exec(String(u || ''));
    if (!m) return null;
    const id = m[1], name = m[2].split('/').map(decodeURIComponent).join('/');
    return { id, name };
  }

  async function open(p) {
    const isMemSource = (typeof p !== 'string') || (window.WebBridge && WebBridge.isAssetRef(p)) || !ipc;
    if (isMemSource) {
      if (!window.WebBridge || !WebBridge.readZip) throw new Error('ブラウザZIPリーダーを利用できません');
      const cacheKey = typeof p === 'string' ? p : ('mem:' + (p && p.name || 'zip') + ':' + (p && p.size || 0) + ':' + (p && p.lastModified || 0));
      const hit = typeof p === 'string' ? cache.get(cacheKey) : null;
      if (hit && memZips.has(hit.id)) return hit;
      const zr = await WebBridge.readZip(p);
      const id = 'mz' + (++memSeq);
      const entryMap = new Map(zr.entries.map(e => [e.name, e]));
      const mz = { entries: zr.entries, entryMap, readEntry: zr.readEntry, urlCache: new Map(), blobToName: new Map() };
      memZips.set(id, mz);
      const z = { id, path: typeof p === 'string' ? p : (p && p.name || cacheKey), entries: zr.entries, truncated: false, tree: buildTree(zr.entries), isMem: true };
      if (typeof p === 'string') cache.set(cacheKey, z);
      return z;
    }
    const hit = cache.get(p);
    const r = await ipc.invoke('ccf:zip-open', p);
    if (!r || !r.ok) throw new Error((r && r.error) || 'ZIPを開けませんでした');
    if (hit && hit.id === r.id && hit.entries.length === r.entries.length) return hit;
    const z = { id: r.id, path: p, entries: r.entries, truncated: r.truncated, tree: buildTree(r.entries) };
    cache.set(p, z); return z;
  }

  async function readMemBuffer(u) {
    const parsed = parseMemUrl(u);
    if (parsed) {
      const mz = memZips.get(parsed.id);
      if (!mz) throw new Error('ZIPセッションが閉じられています');
      const ent = mz.entryMap.get(parsed.name);
      if (!ent) throw new Error('ZIP内にファイルが見つかりません: ' + parsed.name);
      const u8 = await mz.readEntry(ent);
      const mime = window.WebBridge ? WebBridge.mimeFromName(parsed.name) : '';
      return { buf: typeof Buffer !== 'undefined' ? Buffer.from(u8) : u8, mime, name: parsed.name };
    }
    for (const mz of memZips.values()) {
      const nm = mz.blobToName.get(u);
      if (nm) {
        const u8 = await mz.readEntry(mz.entryMap.get(nm));
        const mime = window.WebBridge ? WebBridge.mimeFromName(nm) : '';
        return { buf: typeof Buffer !== 'undefined' ? Buffer.from(u8) : u8, mime, name: nm };
      }
    }
    return null;
  }

  async function resolveUrl(u) {
    const parsed = parseMemUrl(u);
    if (!parsed) return u;
    const mz = memZips.get(parsed.id);
    if (!mz) return '';
    if (mz.urlCache.has(parsed.name)) return mz.urlCache.get(parsed.name);
    const ent = mz.entryMap.get(parsed.name);
    if (!ent) return '';
    const u8 = await mz.readEntry(ent);
    const mime = window.WebBridge ? WebBridge.mimeFromName(parsed.name) : 'application/octet-stream';
    const bu = URL.createObjectURL(new Blob([u8], { type: mime }));
    mz.urlCache.set(parsed.name, bu);
    mz.blobToName.set(bu, parsed.name);
    return bu;
  }

  /** zipview:// または zipmem:// の中身を data URL にする（立ち絵への取り込み用。大きい画像は縮小） */
  async function toDataUrl(u) {
    const mem = await readMemBuffer(u);
    if (mem) {
      const blob = new Blob([mem.buf], { type: mem.mime || 'image/png' });
      const f = new File([blob], (mem.name || 'image').split('/').pop(), { type: blob.type });
      if (typeof imageFileToDataUrl === 'function') return imageFileToDataUrl(f);
      return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
    }
    const res = await fetch(u);
    if (!res.ok) throw new Error('ZIP内の画像を読み込めませんでした (HTTP ' + res.status + ')');
    const blob = await res.blob();
    const f = new File([blob], decodeURIComponent(u.split('/').pop()), { type: blob.type || 'image/png' });
    if (typeof imageFileToDataUrl === 'function') return imageFileToDataUrl(f);
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); });
  }
  const isImageName = n => /\.(png|jpe?g|gif|webp|bmp)$/i.test(n), isAudioName = n => /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(n);
  /** zipview:// または zipmem:// の中身をそのままのバイト列で読む（音声・JSON などの取り出し用）。HTTP エラーは必ず例外にする */
  async function readBuffer(u) {
    const mem = await readMemBuffer(u);
    if (mem) return { buf: mem.buf, mime: mem.mime };
    const res = await fetch(u);
    if (!res.ok) throw new Error('ZIP内のファイルを読み込めませんでした (HTTP ' + res.status + ')');
    const ab = await res.arrayBuffer();
    return { buf: typeof Buffer !== 'undefined' ? Buffer.from(ab) : new Uint8Array(ab), mime: (res.headers.get('content-type') || '').split(';')[0].trim() };
  }
  /** ココフォリアのルームZIP（__data.json と .token を持つ ZIP）かどうか。ZIP直下、または1階層下の __data.json のエントリ名を返す（無ければ ''） */
  function roomDataEntry(z) {
    const ents = (z && z.entries || []).filter(e => !e.dir).map(e => e.name);
    return ents.find(n => n === '__data.json') || ents.find(n => /^[^/]+\/__data\.json$/.test(n)) || '';
  }
  function isRoomZip(z) {
    const ents = (z && z.entries || []).filter(e => !e.dir).map(e => e.name);
    const hasData = ents.some(n => n === '__data.json' || /^[^/]+\/__data\.json$/.test(n));
    if (!hasData) return false;
    const hasToken = ents.some(n => n === '.token' || /^[^/]+\/\.token$/.test(n));
    return hasToken || !!roomDataEntry(z);
  }
  const DEEP_NPC_RE = /(?:npc|kpc|立ち絵|立絵|キャラ|chara|人物|バストアップ|アイコン|icon|tachie|差分|表情|通常|笑顔|微笑|怒り?|哀|悲しみ?|泣き?|照れ?|驚き?|困り?|焦り?|呆れ?|真顔|真剣|目閉じ|ウインク|シルエット|全身|衣装|私服|制服|戦闘服|礼装|着物|水着|(?:^|[\s_\-(（【\[])(?:ho|pc)\s*[1-9１-９](?:$|[\s_\-)）】\]]))/i;
  const DEEP_EXCL_DIR_RE = /(?:マップ|map|見取り図|間取り|地図|フロア|floor|前景|foreground|fg|部屋素材|カード|card|アイテム|item|パネル|panel|マーカー|marker|カットイン|cutin|駒|コマ|piece|token|トークン)/i;
  const DEEP_TRAILER_RANKS = [/trailer|トレーラー/i, /title|タイトル|サムネ|thumb|表紙|cover|概要|お品書き|メイン|main|ロゴ|logo/i, /背景|background|スチル|still/i];
  const deepTrailerRank = entryPath => {
    const norm = String(entryPath || '').normalize('NFKC');
    const fn = norm.split('/').pop() || '';
    if (DEEP_NPC_RE.test(norm) || DEEP_EXCL_DIR_RE.test(norm)) return 99;
    const i = DEEP_TRAILER_RANKS.findIndex(re => re.test(fn));
    if (i >= 0) return i;
    if (/トレーラー|trailer/i.test(norm)) return 0;
    if (/背景|background/i.test(norm)) return 2;
    return 99;
  };
  function pickTrailerEntry(entries) {
    const imgs = (entries || []).filter(e => !e.dir && !/__MACOSX/i.test(e.name) && isImageName(e.name));
    const ranked = imgs.map(e => ({ e, r: deepTrailerRank(e.name) })).filter(a => a.r < 99);
    ranked.sort((a, b) => a.r - b.r || String(a.e.name).localeCompare(String(b.e.name), 'ja', { numeric: true }));
    const nonNpc = imgs.filter(e => !DEEP_NPC_RE.test(String(e.name).normalize('NFKC')) && !DEEP_EXCL_DIR_RE.test(String(e.name).normalize('NFKC')));
    return { best: ranked.length ? ranked[0].e : null, first: nonNpc[0] || null };
  }
  /** ZIP を最大深さ2段階まで透過検査し、ココフォリア部屋ZIP判定とトレーラー画像抽出を行う */
  async function inspectDeep(source, opts) {
    const o = opts || {};
    const maxDepth = Math.min(2, Math.max(1, Number(o.maxDepth || 2)));
    const wantDataUrl = o.toDataUrl !== false;
    const fallbackFirst = !!o.fallbackFirstImage;
    const z = await open(source);
    if (isRoomZip(z)) {
      return { isRoomZip: true, trailerZipUrl: '', trailerDataUrl: '', trailerName: '', roomZips: [typeof source === 'string' ? source : (source && source.name || 'room.zip')] };
    }
    const roomZips = [];
    const p1 = pickTrailerEntry(z.entries);
    if (p1.best) {
      const zipUrl = url(z.id, p1.best.name);
      const dataUrl = wantDataUrl ? await toDataUrl(zipUrl).catch(() => '') : '';
      return { isRoomZip: false, trailerZipUrl: z.isMem ? '' : zipUrl, trailerDataUrl: dataUrl, trailerName: p1.best.name.split('/').pop(), roomZips };
    }
    let fallbackDataUrl = '', fallbackName = '';
    if (fallbackFirst && p1.first) {
      fallbackName = p1.first.name.split('/').pop();
      fallbackDataUrl = wantDataUrl ? await toDataUrl(url(z.id, p1.first.name)).catch(() => '') : '';
      if (!wantDataUrl) {
        return { isRoomZip: false, trailerZipUrl: z.isMem ? '' : url(z.id, p1.first.name), trailerDataUrl: '', trailerName: fallbackName, roomZips };
      }
    }
    if (maxDepth >= 2) {
      const innerZips = (z.entries || []).filter(e => !e.dir && !/__MACOSX/i.test(e.name) && /\.zip$/i.test(e.name) && (!e.size || e.size <= 150 * 1024 * 1024));
      innerZips.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja', { numeric: true }));
      for (const ze of innerZips) {
        let iz = null;
        try {
          const r = await readBuffer(url(z.id, ze.name));
          const u8 = r.buf instanceof Uint8Array ? r.buf : new Uint8Array(r.buf);
          iz = await open(u8);
          if (isRoomZip(iz)) { roomZips.push(ze.name); continue; }
          const p2 = pickTrailerEntry(iz.entries);
          if (p2.best) {
            const du = await toDataUrl(url(iz.id, p2.best.name)).catch(() => '');
            if (du) return { isRoomZip: false, trailerZipUrl: '', trailerDataUrl: du, trailerName: p2.best.name.split('/').pop(), roomZips };
          }
          if (fallbackFirst && !fallbackDataUrl && p2.first) {
            const du = await toDataUrl(url(iz.id, p2.first.name)).catch(() => '');
            if (du) { fallbackDataUrl = du; fallbackName = p2.first.name.split('/').pop(); }
          }
        } catch (_) { }
        finally { if (iz && iz.id) { try { await close(iz.id); } catch (_) { } } }
      }
    }
    if (fallbackDataUrl) {
      return { isRoomZip: false, trailerZipUrl: '', trailerDataUrl: fallbackDataUrl, trailerName: fallbackName, roomZips };
    }
    return { isRoomZip: false, trailerZipUrl: '', trailerDataUrl: '', trailerName: '', roomZips };
  }
  function close(id) {
    const mz = memZips.get(id);
    if (mz) {
      mz.urlCache.forEach(bu => { try { URL.revokeObjectURL(bu); } catch (_) {} });
      memZips.delete(id);
      return Promise.resolve();
    }
    return ipc && ipc.invoke('ccf:zip-close', id);
  }
  CCF.zip = { open, url, resolveUrl, buildTree, toDataUrl, readBuffer, roomDataEntry, isRoomZip, inspectDeep, cache, isImageName, isAudioName, close };
})();
