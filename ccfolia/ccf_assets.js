// ココフォリア素材管理（仮想フォルダ・使用シナリオ逆引き・拡大モーダル・共通素材切替）
(function () {
  'use strict';
  const CCF = window.CCF; if (!CCF) return;
  const { esc, say } = CCF, M = window.CCFModel;
  const AUDIO = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
  const IMG = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
  const VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i;
  const DOC = /\.(pdf|txt|html?|md|docx?)$/i;
  const NONE = '__none__', ALL = '*', PAGE_SIZE = 80;
  const norm = p => String(p || '').replace(/\//g, '\\').toLowerCase();
  const baseName = p => (window.WebBridge && WebBridge.isAssetRef(p)) ? WebBridge.assetBasename(p) : ((typeof path !== 'undefined' && path) ? path.basename(p || '') : String(p || '').split(/[\\/]/).pop());
  const isDocEntry = (name, type, p) => type === 'pdf' || type === 'doc' || DOC.test(String(name || '')) || (p ? DOC.test(baseName(p)) : false);
  /** 資料エントリから必ず拡張子付きのファイル名を解決する（origName → name → path/ref/rel のベース名 → name+ext） */
  const docNameWithExt = (d, type) => {
    const has = s => /\.(pdf|txt|md|html?|docx?)$/i.test(String(s || ''));
    const cands = [d.origName, d.name, baseName(d.path || d.ref || d.rel || '')];
    for (const c of cands) if (c && has(c)) return String(c);
    const base = String(d.origName || d.name || baseName(d.path || d.ref || d.rel || '') || 'doc');
    const ext = String(d.ext || '').replace(/^\./, '');
    if (ext) return base + '.' + ext;
    return base + ((type === 'pdf' || d.type === 'pdf') ? '.pdf' : '.txt');
  };
  const pickBetterCat = (curCat, nextCat) => {
    const a = normFolder(curCat), b = normFolder(nextCat);
    if (!a) return b;
    if (!b) return a;
    if (a === 'トレーラー' && b === 'NPC') return b;
    if (a === '部屋素材' && b !== '部屋素材') return b;
    return a;
  };
  const NPC_PORTRAIT_FALLBACK_RE = /(?:npc|kpc|立ち絵|立絵|キャラ|chara|人物|バストアップ|アイコン|icon|tachie|差分|表情|通常|笑顔|微笑|怒り?|哀|悲しみ?|泣き?|照れ?|驚き?|困り?|焦り?|呆れ?|真顔|真剣|目閉じ|ウインク|シルエット|全身|衣装|私服|制服|戦闘服|礼装|着物|水着|(?:^|[\s_\-(（【\[])(?:ho|pc)\s*[1-9１-９](?:$|[\s_\-)）】\]]))/i;
  const isNpcPortraitItem = (item, scTitle) => {
    if (!item) return false;
    const nm = String(item.origName || item.name || '').normalize('NFKC').trim();
    if (nm && ((M && M.NPC_PORTRAIT_RE) ? M.NPC_PORTRAIT_RE.test(nm) : NPC_PORTRAIT_FALLBACK_RE.test(nm))) return true;
    const p = String(item.path || item.rel || '');
    if (p) {
      const parent = baseName(p.replace(/[\\/][^\\/]+$/, ''));
      const sameTitle = scTitle && M && M.normalizeForMatch && M.normalizeForMatch(parent) === M.normalizeForMatch(scTitle);
      if (parent && !sameTitle && ((M && M.NPC_PORTRAIT_RE) ? M.NPC_PORTRAIT_RE.test(parent.normalize('NFKC')) : NPC_PORTRAIT_FALLBACK_RE.test(parent.normalize('NFKC')))) {
        return true;
      }
    }
    return false;
  };
  const fileUrl = p => {
    if (!p) return '';
    if (window.WebBridge && WebBridge.isAssetRef(p)) return WebBridge.peekAssetUrl(p) || '';
    if (/^(?:data:|blob:|https?:|file:|cloud-asset:)/i.test(p)) return p;
    if (!IS_ELECTRON) return '';
    try { return require('url').pathToFileURL(p).href; } catch (e) { if (typeof logSoft === 'function') logSoft('assetsFileUrl', e); return ''; }
  };
  const icon = r => r.type === 'image' ? '🖼️' : r.type === 'video' ? '🎬' : r.type === 'audio' ? '🎵' : r.type === 'pdf' ? '📄' : r.type === 'zip' ? '📦' : '📃';
  const folderLabel = f => !f || M.isUnclassifiedCat(f) ? '（未分類）' : f;
  const normFolder1 = f => (M && M.normalizeStandardCat) ? M.normalizeStandardCat(f) : (!f || M.isUnclassifiedCat(f) ? '' : String(f).trim());
  // 階層パス（親フォルダ/小フォルダ）対応：'/' 区切りの各セグメントを個別に正規化（フラット名は従来どおり）
  const normFolder = f => {
    const s = String(f == null ? '' : f).normalize('NFKC');
    return s.includes('/') ? s.split('/').map(x => normFolder1(x.trim())).filter(Boolean).join('/') : normFolder1(f);
  };
  const parentOf = f => { const i = String(f || '').lastIndexOf('/'); return i < 0 ? '' : f.slice(0, i); };
  const baseOf = f => { const i = String(f || '').lastIndexOf('/'); return i < 0 ? f : f.slice(i + 1); };
  const depthOf = f => f ? String(f).split('/').length - 1 : 0;
  const inFolder = (cat, sel, sub) => cat === sel || (!!sub && String(cat || '').startsWith(sel + '/'));
  const joinPath = (parent, name) => normFolder([parent, name].filter(Boolean).join('/'));
  // フォルダ一覧（パス配列）→ 親が先・子が後の階層ツリー（元の並び順を維持。親が未登録でも暗黙の親ノードを補う）
  function buildFolderTree(paths) {
    const nodes = new Map(), roots = [];
    const ensure = p => {
      if (nodes.has(p)) return nodes.get(p);
      const n = { path: p, children: [] }; nodes.set(p, n);
      const par = parentOf(p);
      if (par) ensure(par).children.push(n); else roots.push(n);
      return n;
    };
    (paths || []).forEach(p => { if (p) ensure(p); });
    const flat = [];
    (function walk(list) { list.forEach(n => { flat.push(n.path); walk(n.children); }); })(roots);
    return { nodes, roots, flat };
  }
  const folderIndentLabel = f => depthOf(f) ? '\u3000'.repeat(depthOf(f)) + '└ ' + baseOf(f) : '📁 ' + f;
  const toArr = v => Array.isArray(v) ? v : (v instanceof Set ? [...v] : (v && typeof v[Symbol.iterator] === 'function' && typeof v !== 'string' ? [...v] : (v != null ? [v] : [])));
  const ASSET_EXT_STRIP_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|m4a|flac|aac|mp4|webm|mov|pdf|txt|md|html?|docx?|zip|json)$/i;
  const stripAssetExt = n => (CCF.dnd && typeof CCF.dnd.stripAssetExt === 'function')
    ? CCF.dnd.stripAssetExt(n)
    : (String(n == null ? '' : n).trim().replace(ASSET_EXT_STRIP_RE, '').trim() || String(n == null ? '' : n).trim());
  const isOldVersionAsset = n => (CCF.dnd && typeof CCF.dnd.isOldVersionName === 'function')
    ? CCF.dnd.isOldVersionName(n)
    : /(?:旧版|旧ver|旧バージョン|旧データ|旧ファイル|初期版|過去版|修正前|改訂前|差替前|差し替え前|更新前|エラッタ前|バックアップ|[（(\[【_\-\s](?:旧|old|backup|bak|archive|obsolete)[）)\]】_\-\s.]|^old[_\-\s]|^backup[_\-\s])/i.test(String(n || '').normalize('NFKC'));
  const filterLatestAssets = arr => (CCF.dnd && typeof CCF.dnd.filterLatestVersionEntries === 'function') ? CCF.dnd.filterLatestVersionEntries(arr) : arr;
  const unifiedFileKey = (name, origName, p) => stripAssetExt(String(origName || name || (p ? baseName(p) : '') || '')).normalize('NFKC').trim().toLowerCase();
  const docFileKey = (d, type) => docNameWithExt(d || {}, type).normalize('NFKC').trim().toLowerCase();
  const unignoreDocNames = (sc, docs) => {
    if (!sc || !Array.isArray(sc.ignoredDocNames) || !sc.ignoredDocNames.length || !Array.isArray(docs) || !docs.length) return;
    const rm = new Set(docs.map(d => docFileKey(d, /\.pdf$/i.test(String((d && (d.origName || d.name || d.path)) || '')) ? 'pdf' : 'doc')).filter(Boolean));
    if (!rm.size) return;
    sc.ignoredDocNames = sc.ignoredDocNames.filter(x => !rm.has(String(x || '').normalize('NFKC').trim().toLowerCase()));
  };
  let cpSuppress = 0;   // >0 の間は checkpoint を抑止（複合操作を Ctrl+Z 1回で戻すため）
  const checkpoint = lbl => { if (cpSuppress > 0) return; try { if (window.AppHistory && typeof window.AppHistory.checkpoint === 'function') window.AppHistory.checkpoint(lbl); } catch (_) { } };
  const scenarioOf = key => (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios.find(s => String(s.id) === String(key)) : null;

  // ================= ID3 タグ（Node.js バッファの簡易解析・ゴミデータ除外） =================
  const GENRES = 'Blues,Classic Rock,Country,Dance,Disco,Funk,Grunge,Hip-Hop,Jazz,Metal,New Age,Oldies,Other,Pop,R&B,Rap,Reggae,Rock,Techno,Industrial,Alternative,Ska,Death Metal,Pranks,Soundtrack,Euro-Techno,Ambient,Trip-Hop,Vocal,Jazz+Funk,Fusion,Trance,Classical,Instrumental,Acid,House,Game,Sound Clip,Gospel,Noise,AlternRock,Bass,Soul,Punk,Space,Meditative,Instrumental Pop,Instrumental Rock,Ethnic,Gothic,Darkwave,Techno-Industrial,Electronic,Pop-Folk,Eurodance,Dream,Southern Rock,Comedy,Cult,Gangsta,Top 40,Christian Rap,Pop/Funk,Jungle,Native American,Cabaret,New Wave,Psychadelic,Rave,Showtunes,Trailer,Lo-Fi,Tribal,Acid Punk,Acid Jazz,Polka,Retro,Musical,Rock & Roll,Hard Rock'.split(',');
  const SYS_COMM_DESC = /^(?:iTunNORM|iTunPGAP|iTunSMPB|iTunes_CDDB|replaygain_|MusicMatch|UFID|PRIV|WXXX|Encoding)/i;

  function decodeText(b) {
    if (!b || !b.length) return '';
    const enc = b[0], d = b.slice(1); let s;
    if (enc === 1 || enc === 2) {
      let x = Buffer.from(d);
      if (x[0] === 0xFE && x[1] === 0xFF) { x = x.slice(2); if (x.length % 2) x = x.slice(0, -1); x.swap16(); }
      else if (x[0] === 0xFF && x[1] === 0xFE) x = x.slice(2);
      else if (enc === 2) { if (x.length % 2) x = x.slice(0, -1); x.swap16(); }
      s = x.toString('utf16le');
    } else s = enc === 3 ? d.toString('utf8') : d.toString('latin1');
    return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+$/g, '').replace(/\0/g, ';').trim();
  }
  function decodeComment(b) {   // enc(1) lang(3) 短い説明\0 本文
    if (!b || b.length < 5) return '';
    const enc = b[0], rest = b.slice(4), wide = enc === 1 || enc === 2; let i = -1;
    for (let k = 0; k < rest.length; k += wide ? 2 : 1) { if (rest[k] === 0 && (!wide || rest[k + 1] === 0)) { i = k; break; } }
    const descRaw = i < 0 ? Buffer.alloc(0) : rest.slice(0, i);
    const desc = decodeText(Buffer.concat([Buffer.from([enc]), descRaw]));
    if (desc && SYS_COMM_DESC.test(desc)) return '';
    const text = i < 0 ? rest : rest.slice(i + (wide ? 2 : 1));
    const val = decodeText(Buffer.concat([Buffer.from([enc]), text]));
    return M.isJunkTag(val) ? '' : val;
  }
  function readId3(p) {
    const out = { title: '', artist: '', album: '', genre: '', comment: '' }, comments = []; let fd;
    try {
      fd = fs.openSync(p, 'r'); const st = fs.fstatSync(fd), h = Buffer.alloc(10);
      if (st.size >= 10) fs.readSync(fd, h, 0, 10, 0);
      if (h.toString('latin1', 0, 3) === 'ID3') {
        const ver = h[3], size = ((h[6] & 127) << 21) | ((h[7] & 127) << 14) | ((h[8] & 127) << 7) | (h[9] & 127), len = Math.max(0, Math.min(size, 1024 * 1024, st.size - 10));
        const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, 10);
        const idl = ver === 2 ? 3 : 4, hl = ver === 2 ? 6 : 10, map = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TCON: 'genre', TCO: 'genre' };
        let o = 0;
        while (o + hl <= len) {
          const id = b.toString('latin1', o, o + idl); if (!/^[A-Z0-9]+$/.test(id)) break;
          const sz = ver === 2 ? (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5] : ver === 4 ? ((b[o + 4] & 127) << 21) | ((b[o + 5] & 127) << 14) | ((b[o + 6] & 127) << 7) | (b[o + 7] & 127) : b.readUInt32BE(o + 4);
          if (sz <= 0 || o + hl + sz > len) break;
          const d = b.slice(o + hl, o + hl + sz); o += hl + sz;
          if (map[id]) { const v = M.cleanTagValue(decodeText(d)); if (v && !out[map[id]]) out[map[id]] = v; }
          else if (id === 'COMM' || id === 'COM') { const c = decodeComment(d); if (c) comments.push(c); }
        }
      }
      if (st.size >= 128) {
        const t = Buffer.alloc(128); fs.readSync(fd, t, 0, 128, st.size - 128);
        if (t.toString('latin1', 0, 3) === 'TAG') {
          const s = (a, z) => M.cleanTagValue(t.toString('latin1', a, z).replace(/\0.*$/, '').trim());
          out.title = out.title || s(3, 33); out.artist = out.artist || s(33, 63); out.album = out.album || s(63, 93);
          const c1 = s(97, 127); if (c1) comments.push(c1);
          if (!out.genre && t[127] < GENRES.length) out.genre = GENRES[t[127]];
        }
      }
    } catch (e) { if (typeof logSoft === 'function') logSoft('readId3', e); } finally { try { if (fd !== undefined) fs.closeSync(fd); } catch (e) { if (typeof logSoft === 'function') logSoft('closeId3Fd', e); } }
    out.comment = comments.join(' ').trim();
    out.genre = out.genre.replace(/\((\d{1,3})\)/g, (m, n) => (GENRES[+n] ? GENRES[+n] + ';' : '')).replace(/\((RX|CR)\)/g, '').replace(/^\d{1,3}$/, n => GENRES[+n] || '').replace(/;+$/, '');
    return out;
  }

  const EMPTY_TAGS = Object.freeze({ title: '', artist: '', album: '', genre: '', comment: '', folder: '', tags: [], tagStrings: [], blob: '' });
  /** 解析済みキャッシュだけを参照（ファイルI/Oなし）。未解析なら空の結果を返す */
  function peekTags(p) { if (!p || !IS_ELECTRON) return EMPTY_TAGS; return tagCache.get(norm(p)) || EMPTY_TAGS; }
  const hasTags = p => !!p && tagCache.has(norm(p));
  const tagCache = new Map();
  /** { title, artist, album, genre, comment, folder, tags:[{k,v}], tagStrings:string[], blob } */
  function tagsOf(p) {
    if (!p || !IS_ELECTRON) return { title: '', artist: '', album: '', genre: '', comment: '', folder: '', tags: [], tagStrings: [], blob: '' };
    const key = norm(p); if (tagCache.has(key)) return tagCache.get(key);
    const t = AUDIO.test(p) ? readId3(p) : { title: '', artist: '', album: '', genre: '', comment: '' };
    t.folder = M.cleanTagValue(path.basename(path.dirname(p)));
    const tags = [], seen = new Set();
    const push = (k, raw) => {
      const v = M.cleanTagValue(raw); if (!v) return;
      const id = v.toLowerCase(); if (seen.has(id)) return;
      seen.add(id); tags.push({ k, v });
    };
    String(t.genre || '').split(/[;,、，]/).forEach(v => push('genre', v));
    push('artist', t.artist);
    if (t.comment && t.comment.length <= 160) t.comment.split(/[\s,;、，　/|]+/).filter(Boolean).slice(0, 8).forEach(v => push('comment', v));
    push('folder', t.folder);
    t.tags = tags;
    t.tagStrings = tags.map(x => x.v);
    t.blob = [path.basename(p), t.title, t.artist, t.album, t.genre, t.comment, t.folder, ...t.tagStrings].filter(Boolean).join(' ').toLowerCase();
    tagCache.set(key, t); return t;
  }
  const KLABEL = { genre: '🎼', artist: '🎤', comment: '💬', folder: '📁', custom: '🏷️' };
  const customBadges = arr => M.cleanTagList(arr).map(v => `<span class="ccf-tagbadge k-custom" data-tagv="${esc(v)}" title="タグ：${esc(v)}（クリックで絞り込み）">🏷️ ${esc(v)}</span>`).join('');
  const tagBadges = (p, extra, peekOnly) => {
    const id3 = IS_ELECTRON && p && AUDIO.test(p) ? (peekOnly ? peekTags(p) : tagsOf(p)).tags.map(t => `<span class="ccf-tagbadge k-${t.k}" data-tagv="${esc(t.v)}" title="${esc(t.k)}：${esc(t.v)}（クリックで絞り込み）">${KLABEL[t.k] || '🏷️'} ${esc(t.v)}</span>`).join('') : '';
    return id3 + customBadges(extra);
  };

  // ================= 使用シナリオ逆引き（画像・BGM・動画 共通素材対応） =================
  let uCache = null, uAt = 0;
  const USAGE_CACHE_TTL_MS = 120000;
  const GENERIC_ASSET_NAMES = new Set(['素材', 'パネル', '要素', '名称未設定', '画像', '音声', '動画', '無題', 'image', 'audio', 'video', 'file', 'asset', 'bgm', 'se', 'スクリーン', 'スクリーンパネル', 'マーカー', 'マーカーパネル', '背景', '前景']);
  function walkAudio(o, name, cb, depth) {
    if (!o || depth > 5) return;
    if (Array.isArray(o)) return o.forEach(x => walkAudio(x, name, cb, depth + 1));
    if (typeof o !== 'object') return;
    const nm = o.name || o.title || name;
    Object.keys(o).forEach(k => {
      const v = o[k];
      if (typeof v === 'string') { if (/bgm|se|sound|audio|music/i.test(k) && AUDIO.test(v)) cb(v, nm); }
      else if (v && typeof v === 'object') { if (typeof v.path === 'string' && AUDIO.test(v.path)) cb(v.path, nm); walkAudio(v, nm, cb, depth + 1); }
    });
  }
  const normCommonKey = s => {
    const k = stripAssetExt(String(s || '')).normalize('NFKC').trim().toLowerCase();
    if (!k || k.length < 2 || GENERIC_ASSET_NAMES.has(k)) return '';
    return k;
  };
  const dataUrlSig = s => {
    const v = String(s || '').trim();
    if (!v) return '';
    if (/^@img:/i.test(v)) return v.toLowerCase();
    if (v.length <= 160) return v;
    return v.length + ':' + v.slice(0, 64) + ':' + v.slice(-64);
  };
  // 軽量版：ディスク読込（CCF.readProject / fs）は一切行わず、メモリ上の sc.ccfRooms / 現在開いている CCF.S.proj / sc.rooms だけを走査する。
  // 変更通知 ccf-refs-changed が来るか、TTL超過／件数変化時に自動で作り直す。
  const unifiedCache = new Map();
  const existsCache = new Map();
  const localFileMapCache = new Map();
  const watchEntriesCache = new Map(); // normRoot -> { at, byDedupKey, entries }
  const inferredWatchRootsCache = { at: 0, scenCount: -1, roots: [] };
  const WATCH_CACHE_TTL_MS = 10 * 60 * 1000;
  function pathExistsCached(p) {
    if (!p || !IS_ELECTRON) return true;
    const k = norm(p);
    if (existsCache.has(k)) return existsCache.get(k);
    let ok = false;
    try { ok = fs.existsSync(p); } catch (_) { ok = false; }
    existsCache.set(k, ok);
    return ok;
  }
  function invalidateUnified(key, clearExists) {
    if (clearExists) {
      existsCache.clear();
      watchEntriesCache.clear();
      inferredWatchRootsCache.at = 0;
      inferredWatchRootsCache.scenCount = -1;
      inferredWatchRootsCache.roots = [];
    }
    if (key != null) {
      unifiedCache.delete(String(key));
      localFileMapCache.delete(String(key));
    } else {
      unifiedCache.clear();
      localFileMapCache.clear();
    }
  }
  const isCloudOrVirtualPath = p => /^(?:cloud-asset|idb-asset|doc-text|missing-doc|zipview|https?|data|blob):/i.test(String(p || ''));
  const INFER_CAT_FALLBACK_RE = /^(?:[☆★●◆◎○■□▲△▼▽・\-_\s]*)?(?:[0-9]+(?:[\s~〜\-ー・,、]+[0-9]+)?\s*(?:PL|人|名)(?:用|向け|シナリオ|固定|以上|以下|程度)?|人数可変|人数固定|可変人数|大人数|多人数|複数人|少人数|ソロ|タイマン|ペア|デュオ|KPレス(?:シナリオ)?|GMレス(?:シナリオ)?|CoC(?:\s*[67]版?)?|クトゥルフ(?:神話)?(?:TRPG)?|エモクロア(?:TRPG)?|インセイン|シノビガミ|マダミス|ストリテラ|(?:TRPG)?シナリオ(?:一覧|まとめ|集|置き場|フォルダ)?|TRPG)$/i;
  function isCategoryDirForRootInfer(dirName) {
    const raw = String(dirName || '').normalize('NFKC').trim();
    if (!raw) return false;
    if (CCF.dnd && typeof CCF.dnd.isCategoryFolderName === 'function' && CCF.dnd.isCategoryFolderName(raw)) return true;
    return INFER_CAT_FALLBACK_RE.test(raw);
  }
  function getEffectiveScenarioWatchRoot() {
    try {
      const fromLib = (CCF.library && typeof CCF.library.getScenarioWatchRoot === 'function')
        ? String(CCF.library.getScenarioWatchRoot() || '').trim()
        : '';
      if (fromLib) return fromLib;
    } catch (_) { }
    try {
      const fromState = (typeof appState !== 'undefined' && appState && appState.watchFolders && appState.watchFolders.scenarioRoot)
        ? String(appState.watchFolders.scenarioRoot || '').trim()
        : '';
      if (fromState) return fromState;
    } catch (_) { }
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        const fromLs = String(localStorage.getItem('ccf_scenario_watch_root') || localStorage.getItem('ccf_scn_watch_root') || '').trim();
        if (fromLs) return fromLs;
      }
    } catch (_) { }
    return '';
  }
  function getEffectiveScenarioWatchRoots() {
    const out = [];
    const seen = new Set();
    const pushRoot = r => {
      const s = String(r || '').trim();
      if (!s) return;
      const k = norm(s);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(s);
    };
    const configured = getEffectiveScenarioWatchRoot();
    if (configured) pushRoot(configured);
    if (typeof IS_ELECTRON === 'undefined' || !IS_ELECTRON || typeof fs === 'undefined' || !fs || typeof path === 'undefined' || !path) {
      return out;
    }
    const scenarios = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : [];
    const now = Date.now();
    if (inferredWatchRootsCache.scenCount === scenarios.length && (now - inferredWatchRootsCache.at) < WATCH_CACHE_TTL_MS) {
      inferredWatchRootsCache.roots.forEach(pushRoot);
      return out;
    }
    const dataRootNorm = (typeof DATA_ROOT !== 'undefined' && DATA_ROOT) ? norm(DATA_ROOT) : '';
    const isInsideDataRoot = p => !!(dataRootNorm && norm(p).startsWith(dataRootNorm));
    const inferred = [];
    const inferredSeen = new Set();
    const addInferred = r => {
      const s = String(r || '').trim();
      if (!s || isInsideDataRoot(s)) return;
      const k = norm(s);
      if (!k || inferredSeen.has(k) || !pathExistsCached(s)) return;
      inferredSeen.add(k);
      inferred.push(s);
    };
    const collectTopCategoryFromStart = startPath => {
      if (!startPath || isCloudOrVirtualPath(startPath) || isInsideDataRoot(startPath) || !pathExistsCached(startPath)) return;
      let cur = startPath;
      let topCat = '';
      for (let step = 0; step < 3; step++) {
        const parent = path.dirname(cur);
        if (!parent || parent === cur) break;
        const bn = path.basename(parent);
        if (!bn) break;
        if (isCategoryDirForRootInfer(bn)) topCat = parent;
        cur = parent;
      }
      if (topCat) addInferred(topCat);
    };
    for (const sc of scenarios) {
      if (!sc || inferred.length >= 8) break;
      if (sc.sourcePath && !isCloudOrVirtualPath(sc.sourcePath) && !isInsideDataRoot(sc.sourcePath) && pathExistsCached(sc.sourcePath)) {
        collectTopCategoryFromStart(sc.sourcePath);
        continue;
      }
      if (Array.isArray(sc.docs)) {
        for (const d of sc.docs) {
          if (!d) continue;
          const dp = d.path || d.ref || '';
          if (!dp || isCloudOrVirtualPath(dp) || isInsideDataRoot(dp) || !pathExistsCached(dp)) continue;
          let baseDir = path.dirname(dp);
          if (baseDir && CCF.dnd && typeof CCF.dnd.isAssetSubdirName === 'function' && CCF.dnd.isAssetSubdirName(path.basename(baseDir))) {
            const up = path.dirname(baseDir);
            if (up && up !== baseDir) baseDir = up;
          }
          collectTopCategoryFromStart(baseDir);
          break;
        }
      }
    }
    inferredWatchRootsCache.at = now;
    inferredWatchRootsCache.scenCount = scenarios.length;
    inferredWatchRootsCache.roots = inferred;
    inferred.forEach(pushRoot);
    return out;
  }
  function getWatchRootDedupMap(watchRoot) {
    if (!watchRoot || !pathExistsCached(watchRoot)) return null;
    if (!CCF.dnd || typeof CCF.dnd.discoverScenarioEntries !== 'function') return null;
    if (typeof window === 'undefined' || typeof window.getScenarioDedupKey !== 'function') return null;
    const normRoot = norm(watchRoot);
    const now = Date.now();
    const cached = watchEntriesCache.get(normRoot);
    if (cached && (now - cached.at) < WATCH_CACHE_TTL_MS) {
      return cached.byDedupKey;
    }
    const byDedupKey = new Map();
    let entries = [];
    try {
      entries = CCF.dnd.discoverScenarioEntries(watchRoot, { maxDepth: 7, isWatchRoot: true }) || [];
    } catch (_) { entries = []; }
    const rankEntry = ent => ent && ent.dir ? 3 : (ent && ent.type === 'zip' ? 1 : 2);
    const registerKey = (rawTitle, ent) => {
      const dk = window.getScenarioDedupKey(rawTitle);
      if (!dk) return;
      const prev = byDedupKey.get(dk);
      if (!prev || rankEntry(ent) > rankEntry(prev)) {
        byDedupKey.set(dk, ent);
      }
    };
    for (const ent of entries) {
      if (!ent || !ent.p) continue;
      const bn = path.basename(ent.p);
      const baseTitle = ent.dir ? bn : bn.replace(/\.(?:pdf|zip|txt|md|markdown|html?|docx?)$/i, '');
      registerKey(baseTitle, ent);
      if (M && typeof M.extractTitleAndSystem === 'function') {
        try {
          const ex = M.extractTitleAndSystem(baseTitle);
          if (ex && ex.title && ex.title !== baseTitle) registerKey(ex.title, ent);
        } catch (_) { }
      }
    }
    watchEntriesCache.set(normRoot, { at: now, entries, byDedupKey });
    return byDedupKey;
  }
  function findScenarioSourceFromWatchRoot(sc) {
    if (!sc) return '';
    if (typeof IS_ELECTRON === 'undefined' || !IS_ELECTRON || typeof fs === 'undefined' || !fs || typeof path === 'undefined' || !path) return '';
    if (typeof window === 'undefined' || typeof window.getScenarioDedupKey !== 'function') return '';
    const watchRoots = getEffectiveScenarioWatchRoots();
    if (!watchRoots.length) return '';
    const candKeys = [];
    const pushCandTitle = raw => {
      const s = String(raw || '').trim().replace(/\.(?:pdf|zip|txt|md|markdown|html?|docx?)$/i, '').trim();
      if (!s) return;
      const dk = window.getScenarioDedupKey(s);
      if (dk && !candKeys.includes(dk)) candKeys.push(dk);
      if (M && typeof M.extractTitleAndSystem === 'function') {
        try {
          const ex = M.extractTitleAndSystem(s);
          const dk1 = (ex && ex.title) ? window.getScenarioDedupKey(ex.title) : '';
          if (dk1 && !candKeys.includes(dk1)) candKeys.push(dk1);
        } catch (_) { }
      }
    };
    const pathSegments = rawP => String(rawP || '').replace(/[\\/]+$/, '').split(/[\\/]/).map(x => x.trim()).filter(Boolean);
    if (sc.title) pushCandTitle(sc.title);
    if (sc.sourcePath && !isCloudOrVirtualPath(sc.sourcePath)) {
      const segs = pathSegments(sc.sourcePath);
      const tail = segs.length ? segs[segs.length - 1] : '';
      if (tail && !isCategoryDirForRootInfer(tail)) pushCandTitle(tail);
    }
    if (Array.isArray(sc.docs)) {
      for (const d of sc.docs) {
        if (!d) continue;
        const dp = d.path || d.ref || '';
        if (!dp || isCloudOrVirtualPath(dp)) continue;
        const segs = pathSegments(dp);
        if (segs.length >= 2) {
          let parentIdx = segs.length - 2;
          let parentNm = segs[parentIdx];
          if (parentNm && CCF.dnd && typeof CCF.dnd.isAssetSubdirName === 'function' && CCF.dnd.isAssetSubdirName(parentNm) && parentIdx >= 1) {
            parentIdx--;
            parentNm = segs[parentIdx];
          }
          if (parentNm && !/^[a-z]:$/i.test(parentNm) && !isCategoryDirForRootInfer(parentNm) && !(CCF.dnd && typeof CCF.dnd.isAssetSubdirName === 'function' && CCF.dnd.isAssetSubdirName(parentNm))) {
            pushCandTitle(parentNm);
          }
        }
      }
    }
    if (!candKeys.length) return '';
    const maps = [];
    for (const root of watchRoots) {
      const map = getWatchRootDedupMap(root);
      if (map && map.size) maps.push(map);
    }
    if (!maps.length) return '';
    for (const map of maps) {
      for (const dk of candKeys) {
        const hit = map.get(dk);
        if (hit && hit.p && pathExistsCached(hit.p)) return hit.p;
      }
    }
    // 完全一致しない場合は、2文字以上のキーに対する最長包含一致でフォールバック
    const rankEnt = ent => ent && ent.dir ? 3 : (ent && ent.type === 'zip' ? 1 : 2);
    let bestEnt = null, bestLen = 0, bestRank = -1, bestDiff = Infinity;
    for (const map of maps) {
      for (const dk of candKeys) {
        if (dk.length < 2) continue;
        for (const [k, ent] of map.entries()) {
          if (!k || k.length < 2 || !ent || !ent.p) continue;
          if (dk.includes(k) || k.includes(dk)) {
            const mLen = Math.min(k.length, dk.length);
            const r = rankEnt(ent);
            const diff = Math.abs(k.length - dk.length);
            if (mLen > bestLen || (mLen === bestLen && (r > bestRank || (r === bestRank && diff < bestDiff)))) {
              if (pathExistsCached(ent.p)) {
                bestEnt = ent;
                bestLen = mLen;
                bestRank = r;
                bestDiff = diff;
              }
            }
          }
        }
      }
    }
    if (bestEnt && bestEnt.p) return bestEnt.p;
    return '';
  }
  function getScenarioLocalFileMap(key, sc) {
    if (typeof IS_ELECTRON === 'undefined' || !IS_ELECTRON || typeof fs === 'undefined' || !fs || typeof path === 'undefined' || !path || !sc) return null;
    const watchRootsSig = getEffectiveScenarioWatchRoots().join('|');
    const cacheKey = String(key || sc.id || '');
    const cacheSig = `${String((sc && sc.sourcePath) || '')}|${watchRootsSig}`;
    if (watchRootsSig || (sc && sc.sourcePath)) {
      const cached = localFileMapCache.get(cacheKey);
      if (cached && cached.sig === cacheSig) return cached.map;
    }
    const byName = new Map(), byStem = new Map();
    const reg = (fp, fileName) => {
      if (!fp || !fileName || /^~\$/.test(fileName)) return;
      const k1 = String(fileName).normalize('NFKC').trim().toLowerCase();
      const k2 = String(fileName).trim().toLowerCase();
      if (k1 && !byName.has(k1)) byName.set(k1, fp);
      if (k2 && !byName.has(k2)) byName.set(k2, fp);
      const sk = stripAssetExt(fileName).normalize('NFKC').trim().toLowerCase();
      if (sk) {
        if (!byStem.has(sk)) byStem.set(sk, []);
        byStem.get(sk).push(fp);
      }
    };
    const siblingBaseKey = (name, isDir) => {
      const raw = isDir ? String(name || '') : stripAssetExt(name);
      const normKey = raw.normalize('NFKC').toLowerCase()
        .replace(/(?:[（(\[【_\-\s]*(?:v|ver\.?|version|rev\.?|r|第|改訂?|修正|更新|確定|最終|final|new|latest|fix|fixed|copy|コピー|バックアップ|backup|bak|old|旧)[_\-\s]*\d*(?:\.\d+)*[）)\]】]?)/gi, '')
        .replace(/(?:[_\-\s]*(?:20\d{2}[.\-_]?\d{2}[.\-_]?\d{2}|\d{6,8}|[（(]\d+[）)]|\d+))$/g, '')
        .replace(/[\s_\-・.]+/g, '')
        .trim();
      return (isDir ? 'd:' : 'f:') + (normKey || raw.normalize('NFKC').toLowerCase().trim());
    };
    const walk = (dir, depth, maxDepth, skipOld) => {
      if (!dir || depth > maxDepth) return;
      let list = [];
      try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      let items = [];
      for (const ent of list) {
        const n = ent.name || '';
        if (!n || n.startsWith('.') || /^~\$/.test(n) || n === 'node_modules' || n === '__MACOSX' || n === '_TRPG_Data') continue;
        const isDir = ent.isDirectory();
        const isFile = ent.isFile();
        if (!isDir && !isFile) continue;
        if (isDir && skipOld && M && M.isOldFolderName && M.isOldFolderName(n)) continue;
        const fp = path.join(dir, n);
        items.push({ name: n, isDir, isFile, fp, mtime: 0 });
      }
      if (skipOld && items.length > 1) {
        const groups = new Map();
        let hasOldOrDup = false;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (isOldVersionAsset(it.name)) hasOldOrDup = true;
          const bk = siblingBaseKey(it.name, it.isDir);
          let arr = groups.get(bk);
          if (!arr) { arr = []; groups.set(bk, arr); }
          arr.push(it);
          if (arr.length === 2) hasOldOrDup = true;
        }
        if (hasOldOrDup) {
          for (const arr of groups.values()) {
            if (arr.length < 2) continue;
            for (let i = 0; i < arr.length; i++) {
              try { arr[i].mtime = fs.statSync(arr[i].fp).mtimeMs || 0; } catch (_) { }
            }
          }
          items = filterLatestAssets(items);
        }
      }
      for (const it of items) {
        if (it.isDir) {
          walk(it.fp, depth + 1, maxDepth, skipOld);
        } else if (it.isFile) {
          reg(it.fp, it.name);
        }
      }
    };
    if (typeof DATA_ROOT !== 'undefined' && DATA_ROOT && sc.id) {
      const scDir = path.join(DATA_ROOT, 'scenarios', String(sc.id).replace(/[^\w-]/g, '_'));
      if (pathExistsCached(scDir)) walk(scDir, 0, 6, false);
    }
    let resolvedSourcePath = (sc.sourcePath && pathExistsCached(sc.sourcePath)) ? sc.sourcePath : '';
    if (!resolvedSourcePath) {
      const recovered = findScenarioSourceFromWatchRoot(sc);
      if (recovered) {
        resolvedSourcePath = recovered;
        sc.sourcePath = recovered;
      }
    }
    if (resolvedSourcePath && pathExistsCached(resolvedSourcePath)) {
      try {
        const st = fs.statSync(resolvedSourcePath);
        if (st.isFile()) reg(resolvedSourcePath, path.basename(resolvedSourcePath));
        else if (st.isDirectory()) walk(resolvedSourcePath, 0, 6, true);
      } catch (_) { }
    }
    const map = { byName, byStem };
    if (watchRootsSig || (sc && sc.sourcePath)) {
      const finalSig = `${String((sc && sc.sourcePath) || '')}|${watchRootsSig}`;
      localFileMapCache.set(cacheKey, { sig: finalSig, map });
    }
    return map;
  }
  function resolveScenarioLocalDocPath(scenarioId, fileNameOrPath) {
    if (typeof IS_ELECTRON === 'undefined' || !IS_ELECTRON || typeof fs === 'undefined' || !fs || typeof path === 'undefined' || !path) return '';
    const raw = String(fileNameOrPath || '').trim();
    if (!raw) return '';
    const isMissingRef = /^missing-doc:\/\//i.test(raw);
    const isDocText = /^doc-text:\/\//i.test(raw);
    if (!isMissingRef && !isDocText && !isCloudOrVirtualPath(raw) && pathExistsCached(raw)) {
      try { if (fs.statSync(raw).isFile()) return raw; } catch (_) { }
    }
    const sid = String(keyOr(scenarioId) || '');
    const sc = (sid && sid !== '_default') ? scenarioOf(sid) : null;
    if (!sc) return '';
    let candName = raw;
    if (isMissingRef) {
      try { candName = decodeURIComponent(raw.slice('missing-doc://'.length)); } catch (_) { candName = raw.slice('missing-doc://'.length); }
    } else if (/^cloud-asset:\/\//i.test(raw) && window.CloudSync && CloudSync.parseCloudAssetRef) {
      const parsed = CloudSync.parseCloudAssetRef(raw);
      candName = (parsed && parsed.name) || '';
    } else if (isDocText) {
      const dtId = raw.slice('doc-text://'.length);
      const dtList = Array.isArray(sc.docTexts) ? sc.docTexts : [];
      const dtHit = dtList.find(d => d && (String(d.id || '') === dtId || String(d.name || '') === dtId));
      candName = (dtHit && dtHit.name) ? String(dtHit.name) : '';
      if (!candName && dtId) {
        let decoded = dtId;
        try { decoded = decodeURIComponent(dtId); } catch (_) { }
        if (/\.(?:pdf|txt|md|markdown|html?)$/i.test(decoded)) candName = decoded;
      }
    }
    const bn = baseName(candName);
    if (!bn) return '';
    if (Array.isArray(sc.docs)) {
      const bnNorm = bn.normalize('NFKC').trim().toLowerCase();
      const bnStem = stripAssetExt(bn).normalize('NFKC').trim().toLowerCase();
      for (const d of sc.docs) {
        if (!d) continue;
        const dNames = [d.origName, d.name, baseName(d.path || ''), baseName(d.ref || ''), baseName(d.rel || '')].filter(Boolean);
        const matched = dNames.some(dn => {
          const n1 = String(dn).normalize('NFKC').trim().toLowerCase();
          if (n1 === bnNorm) return true;
          const s1 = stripAssetExt(dn).normalize('NFKC').trim().toLowerCase();
          return !!(bnStem && s1 === bnStem);
        });
        if (!matched) continue;
        if (typeof DATA_ROOT !== 'undefined' && DATA_ROOT && d.rel) {
          try {
            const abs = path.resolve(DATA_ROOT, d.rel);
            if (pathExistsCached(abs)) return abs;
          } catch (_) { }
        }
        if (d.path && !isCloudOrVirtualPath(d.path) && pathExistsCached(d.path)) return d.path;
        if (d.ref && !isCloudOrVirtualPath(d.ref) && pathExistsCached(d.ref)) return d.ref;
      }
    }
    const localMap = getScenarioLocalFileMap(String(sc.id), sc);
    const expectedType = /\.pdf$/i.test(bn) ? 'pdf' : 'doc';
    return findScenarioLocalPath(localMap, expectedType, bn, candName);
  }
  function findScenarioLocalPath(localMap, expectedType, ...names) {
    if (!localMap || !localMap.byName.size) return '';
    for (const cand of names) {
      const b = baseName(cand);
      if (!b) continue;
      const hit = localMap.byName.get(String(b).normalize('NFKC').trim().toLowerCase())
        || localMap.byName.get(String(b).trim().toLowerCase());
      if (hit && pathExistsCached(hit)) return hit;
    }
    for (const cand of names) {
      const b = baseName(cand);
      if (!b) continue;
      const sk = stripAssetExt(b).normalize('NFKC').trim().toLowerCase();
      const cands = sk ? localMap.byStem.get(sk) : null;
      if (!cands || !cands.length) continue;
      for (const fp of cands) {
        if (!pathExistsCached(fp)) continue;
        const bn = baseName(fp);
        const fpIsDoc = isDocEntry(bn, '', fp);
        const fpType = fpIsDoc ? (/\.pdf$/i.test(bn) ? 'pdf' : 'doc') : inferType(fp);
        if (!expectedType || fpType === expectedType || ((expectedType === 'pdf' || expectedType === 'doc') && fpIsDoc)) return fp;
      }
    }
    return '';
  }
  function invalidateUsage() { uCache = null; uAt = 0; }
  window.addEventListener('ccf-refs-changed', () => { invalidateUsage(); invalidateUnified(null, false); });

  function usage(force) {
    const list = CCF.scenarioList();
    const commonItems = (window.CommonAssets && typeof window.CommonAssets.getAll === 'function') ? window.CommonAssets.getAll() : [];
    const now = Date.now();
    if (!force && uCache && uCache.n === list.length && uCache.cn === commonItems.length && (now - uAt) < USAGE_CACHE_TTL_MS) {
      return uCache;
    }

    const byPath = new Map(), byScn = new Map(), scns = [], seenPath = new Set();
    const byCommonUid = new Map();       // commonUid -> [{ id, scenarioId, title, room, place, detail }]
    const byScenarioCommon = new Map();  // scenarioId -> Map<commonUid, { item, usages: [] }>
    const commonByUid = new Map();
    const commonByPath = new Map();
    const commonByDataSig = new Map();
    const commonByName = new Map();      // normName -> [commonItem, ...]
    const seenCommonHit = new Set();
    const scById = new Map();
    const scByTitle = new Map();

    list.forEach(sc => {
      if (!sc || sc.id == null) return;
      const sid = String(sc.id), ttl = sc.title || '無題';
      scns.push({ id: sid, title: ttl });
      scById.set(sid, { id: sid, title: ttl });
      const nt = String(ttl).normalize('NFKC').trim().toLowerCase();
      if (nt && !scByTitle.has(nt)) scByTitle.set(nt, { id: sid, title: ttl });
    });

    if (commonItems.length === 0) {
      uCache = { byPath, byScn, scns, byCommonUid, byScenarioCommon, n: list.length, cn: 0 };
      uAt = now;
      return uCache;
    }

    const pushNameIdx = (nk, ci) => {
      if (!nk) return;
      let arr = commonByName.get(nk);
      if (!arr) { arr = []; commonByName.set(nk, arr); }
      if (!arr.includes(ci)) arr.push(ci);
    };

    commonItems.forEach(ci => {
      if (!ci || !ci.uid) return;
      commonByUid.set(ci.uid, ci);
      if (ci.rawId) {
        const alt = String(ci.rawId);
        if (!commonByUid.has(alt)) commonByUid.set(alt, ci);
      }
      if (ci.path) {
        const pk = norm(ci.path);
        if (pk) {
          let arr = commonByPath.get(pk);
          if (!arr) { arr = []; commonByPath.set(pk, arr); }
          arr.push(ci);
        }
      }
      const dSig = dataUrlSig(ci.dataUrl || (ci.raw && ci.raw.dataUrl));
      if (dSig) {
        let arr = commonByDataSig.get(dSig);
        if (!arr) { arr = []; commonByDataSig.set(dSig, arr); }
        arr.push(ci);
      }
      pushNameIdx(normCommonKey(ci.name), ci);
      pushNameIdx(normCommonKey(ci.origName), ci);
      if (ci.path) pushNameIdx(normCommonKey(baseName(ci.path)), ci);
    });

    const recordCommonHit = (ci, sid, sTitle, room, place) => {
      if (!ci || !ci.uid || !sid) return;
      const roomLbl = String(room || '').trim();
      const placeLbl = String(place || '').trim();
      const detail = (roomLbl && placeLbl && roomLbl !== placeLbl)
        ? `${roomLbl}（${placeLbl}）`
        : (placeLbl || roomLbl || '使用中');
      const sig = `${ci.uid}|${sid}|${detail}`;
      if (seenCommonHit.has(sig)) return;
      seenCommonHit.add(sig);
      const entry = { id: sid, scenarioId: sid, title: sTitle || '無題', room: roomLbl, place: placeLbl, detail };
      let listU = byCommonUid.get(ci.uid);
      if (!listU) { listU = []; byCommonUid.set(ci.uid, listU); }
      listU.push(entry);

      let scMap = byScenarioCommon.get(sid);
      if (!scMap) { scMap = new Map(); byScenarioCommon.set(sid, scMap); }
      let rec = scMap.get(ci.uid);
      if (!rec) { rec = { item: ci, usages: [] }; scMap.set(ci.uid, rec); }
      rec.usages.push(entry);
    };

    // ① マイライブラリ各素材の usedIn（シナリオへコピーした履歴・登録元履歴）
    commonItems.forEach(ci => {
      if (!ci) return;
      const usedArr = Array.isArray(ci.usedIn) ? ci.usedIn : (ci.raw && Array.isArray(ci.raw.usedIn) ? ci.raw.usedIn : []);
      usedArr.forEach(u => {
        if (!u) return;
        let sid = '', ttl = '', place = '登録履歴';
        if (typeof u === 'string' || typeof u === 'number') {
          const s = String(u);
          const hit = scById.get(s) || scByTitle.get(s.normalize('NFKC').trim().toLowerCase());
          if (hit) { sid = hit.id; ttl = hit.title; }
        } else if (typeof u === 'object') {
          const rawId = u.scenarioId != null ? String(u.scenarioId) : (u.id != null ? String(u.id) : '');
          const rawTitle = String(u.title || u.scenarioTitle || u.name || '').trim();
          const hit = (rawId && scById.get(rawId)) || (rawTitle && scByTitle.get(rawTitle.normalize('NFKC').trim().toLowerCase()));
          if (hit) { sid = hit.id; ttl = hit.title; }
          else if (rawId && rawTitle) { sid = rawId; ttl = rawTitle; }
          if (u.place || u.room) place = String(u.place || u.room);
        }
        if (sid) recordCommonHit(ci, sid, ttl, 'マイライブラリ連携', place);
      });
    });

    const matchCommonTargets = (cand, expectedType) => {
      if (!cand || !commonItems.length) return [];
      const hits = new Set();
      const typeOk = ci => !expectedType || expectedType === 'any' || !ci.type || ci.type === expectedType;
      const uids = [cand.assetUid, cand.assetId, cand.uid, cand.visualUid, cand.seUid].map(x => String(x || '').trim()).filter(Boolean);
      for (const u of uids) {
        const hit = commonByUid.get(u);
        if (hit && typeOk(hit)) hits.add(hit);
      }
      if (hits.size) return [...hits];
      const paths = [cand.path, cand.filePath, cand.visualPath, cand.sePath].map(x => norm(x)).filter(Boolean);
      for (const pk of paths) {
        const arr = commonByPath.get(pk);
        if (arr) arr.forEach(ci => { if (typeOk(ci)) hits.add(ci); });
      }
      if (hits.size) return [...hits];
      const dSigs = [cand.dataUrl, cand.thumbRef, cand.iconDataUrl, cand.visualDataUrl, cand.seDataUrl].map(dataUrlSig).filter(Boolean);
      for (const ds of dSigs) {
        const arr = commonByDataSig.get(ds);
        if (arr) arr.forEach(ci => { if (typeOk(ci)) hits.add(ci); });
      }
      if (hits.size) return [...hits];
      const nameCands = [
        cand.name, cand.origName, cand.label, cand.fileName,
        cand.path ? baseName(cand.path) : '',
        cand.filePath ? baseName(cand.filePath) : ''
      ].map(normCommonKey).filter(Boolean);
      for (const nk of nameCands) {
        const arr = commonByName.get(nk);
        if (arr) arr.forEach(ci => { if (typeOk(ci)) hits.add(ci); });
      }
      return [...hits];
    };

    const roomsGlobal = (typeof appState !== 'undefined' && Array.isArray(appState.rooms)) ? appState.rooms : [];
    const curKey = String(CCF.S && CCF.S.key || '');
    const curRoomId = String(CCF.S && CCF.S.roomId || '');

    list.forEach(sc => {
      if (!sc || sc.id == null) return;
      const id = String(sc.id), title = sc.title || '無題';
      const addPath = (p, room) => {
        const k = norm(p), sig = id + '|' + room + '|' + k; if (!k || seenPath.has(sig)) return; seenPath.add(sig);
        if (!byPath.has(k)) byPath.set(k, []); byPath.get(k).push({ id, title, room });
        if (!byScn.has(id)) byScn.set(id, new Map()); byScn.get(id).set(k, p);
      };
      const matchAndRecord = (cand, expectedType, roomName, place) => {
        if (!cand) return;
        const matched = matchCommonTargets(cand, expectedType);
        for (let i = 0; i < matched.length; i++) {
          recordCommonHit(matched[i], id, title, roomName, place);
        }
      };

      // ② シナリオの登録素材（sc.images / sc.assetCatalog）
      if (Array.isArray(sc.images)) {
        sc.images.forEach(im => { if (im) matchAndRecord(im, 'image', '登録素材', '登録素材'); });
      }
      if (Array.isArray(sc.assetCatalog)) {
        sc.assetCatalog.forEach(cat => { if (cat) matchAndRecord(cat, cat.type || 'any', '登録素材', '登録素材'); });
      }

      // 走査対象の部屋リストを構築（sc.ccfRooms ＋ 現在編集中の CCF.S.proj）
      const roomEntries = [];
      const seenRoomIds = new Set();
      if (id === curKey && CCF.S && CCF.S.proj) {
        const curRm = Array.isArray(CCF.S.rooms) ? CCF.S.rooms.find(r => String(r.id) === curRoomId) : null;
        const rName = (curRm && curRm.name) || 'メイン部屋';
        roomEntries.push({ id: curRoomId || 'active', name: rName, project: CCF.S.proj });
        if (curRoomId) seenRoomIds.add(curRoomId);
      }
      if (Array.isArray(sc.ccfRooms)) {
        sc.ccfRooms.forEach((rm, ri) => {
          if (!rm || !rm.project) return;
          const rid = rm.id ? String(rm.id) : ('rm_' + ri);
          if (seenRoomIds.has(rid)) return;
          seenRoomIds.add(rid);
          roomEntries.push({ id: rid, name: rm.name || 'メイン部屋', project: rm.project });
        });
      }

      // ③ 各部屋プロジェクト内の refs・共通設定・シーン・NPC・盤面駒・カットインを横断走査
      roomEntries.forEach(rm => {
        const p = rm.project;
        if (!p || typeof p !== 'object') return;
        const rn = rm.name || 'メイン部屋';

        // proj.refs
        if (Array.isArray(p.refs)) {
          p.refs.forEach(r => {
            if (!r) return;
            if (r.type === 'audio' && r.path) addPath(r.path, '登録素材');
            matchAndRecord(r, r.type || 'any', '登録素材', '登録素材');
          });
        }

        // globalDecor（共通背景・共通前景・共通BGM・スクリーンパネル・共通マーカー）
        const gd = p.globalDecor || {};
        if (gd.bg) matchAndRecord(gd.bg, 'image', rn, '共通背景');
        if (gd.fg) matchAndRecord(gd.fg, 'image', rn, '共通前景');
        if (gd.bgm) {
          if (gd.bgm.path) addPath(gd.bgm.path, rn + '（共通BGM）');
          matchAndRecord(gd.bgm, 'audio', rn, '共通BGM');
        }
        (gd.screens || []).forEach(sr => { if (sr) matchAndRecord(sr, 'image', rn, 'スクリーンパネル'); });
        (gd.markers || []).forEach(mk => { if (mk) matchAndRecord(mk, 'image', rn, 'マーカーパネル'); });

        // scenes（シーン別前景・背景・BGM・マーカー・スクリーン）
        (p.scenes || []).forEach((s, si) => {
          if (!s) return;
          const no = '#' + (si + 1);
          if (s.fg) matchAndRecord(s.fg, 'image', rn, `${no} 前景`);
          if (s.bg) matchAndRecord(s.bg, 'image', rn, `${no} 背景`);
          if (s.bgm) {
            if (s.bgm.path) addPath(s.bgm.path, `${rn}（${no} BGM）`);
            matchAndRecord(s.bgm, 'audio', rn, `${no} BGM`);
          }
          (s.markers || []).forEach(mk => { if (mk) matchAndRecord(mk, 'image', rn, `${no} マーカー`); });
          (s.screens || []).forEach(sr => { if (sr) matchAndRecord(sr, 'image', rn, `${no} スクリーン`); });
        });

        // npcs（NPC立ち絵・表情差分）
        (p.npcs || []).forEach(n => {
          if (!n) return;
          const npcPlace = `NPC立ち絵（${n.name || 'NPC'}）`;
          if (Array.isArray(n.images) && n.images.length) {
            n.images.forEach(im => { if (im) matchAndRecord(im, 'image', rn, npcPlace); });
          }
          if (n.iconDataUrl || n.imagePath || n.iconPath) {
            matchAndRecord({ dataUrl: n.iconDataUrl, path: n.imagePath || n.iconPath, name: n.iconName || n.name }, 'image', rn, npcPlace);
          }
        });

        // board.pieces（盤面駒）
        if (p.board && Array.isArray(p.board.pieces)) {
          p.board.pieces.forEach(bp => {
            if (!bp) return;
            matchAndRecord(bp, 'image', rn, `盤面駒（${bp.name || '駒'}）`);
          });
        }

        // cutins（カットイン映像・SE）
        if (Array.isArray(p.cutins)) {
          p.cutins.forEach(c => {
            if (!c) return;
            const cNm = c.name || 'カットイン';
            if (c.visualPath || c.visualDataUrl || c.visualUrl || c.visualUid) {
              matchAndRecord(
                { path: c.visualPath, dataUrl: c.visualDataUrl, assetUid: c.visualUid, name: c.visualName },
                c.visualType === 'video' ? 'video' : 'any',
                rn,
                `カットイン（${cNm}）`
              );
            }
            if (c.sePath || c.seDataUrl || c.seUrl || c.seUid) {
              if (c.sePath) addPath(c.sePath, `${rn}（カットインSE）`);
              matchAndRecord(
                { path: c.sePath, dataUrl: c.seDataUrl, assetUid: c.seUid, name: c.seName },
                'audio',
                rn,
                `カットインSE（${cNm}）`
              );
            }
          });
        }
      });

      walkAudio(sc.rooms, '部屋', (p, nm) => {
        addPath(p, nm || '部屋');
        matchAndRecord({ path: p }, 'audio', nm || '部屋', 'BGM');
      }, 0);
      roomsGlobal.filter(r => r && String(r.scenarioId) === id).forEach(r => walkAudio(r, r.name || '部屋', (p, nm) => {
        addPath(p, nm || '部屋');
        matchAndRecord({ path: p }, 'audio', nm || '部屋', 'BGM');
      }, 0));
    });

    uCache = { byPath, byScn, scns, byCommonUid, byScenarioCommon, n: list.length, cn: commonItems.length };
    uAt = now;
    return uCache;
  }

  function usageByCommonItem(itemOrUid) {
    if (!itemOrUid) return [];
    const u = usage();
    if (typeof itemOrUid === 'string') {
      return u.byCommonUid.get(itemOrUid) || [];
    }
    if (itemOrUid.uid && u.byCommonUid.has(itemOrUid.uid)) {
      return u.byCommonUid.get(itemOrUid.uid) || [];
    }
    if (itemOrUid.path) {
      return (u.byPath.get(norm(itemOrUid.path)) || []).map(x => ({
        id: x.id, scenarioId: x.id, title: x.title, room: x.room, place: '', detail: x.room
      }));
    }
    return [];
  }

  function scenariosUsingCommonAssets() {
    const u = usage();
    const out = [];
    u.scns.forEach(s => {
      const m = u.byScenarioCommon.get(s.id);
      if (m && m.size > 0) {
        out.push({
          id: s.id,
          title: s.title,
          count: m.size,
          itemUids: new Set(m.keys()),
          items: [...m.values()]
        });
      }
    });
    out.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ja', { numeric: true }));
    return out;
  }

  function commonAssetsUsedByScenario(scenarioId) {
    const sid = String(scenarioId || '');
    if (!sid) return [];
    const m = usage().byScenarioCommon.get(sid);
    return m ? [...m.values()] : [];
  }

  const usageList = pOrItem => {
    if (!pOrItem) return [];
    if (typeof pOrItem === 'object') {
      if (pOrItem.uid && (pOrItem.uid.startsWith('cimg:') || pOrItem.uid.startsWith('lib:'))) {
        return usageByCommonItem(pOrItem);
      }
      return pOrItem.path ? (usage().byPath.get(norm(pOrItem.path)) || []) : [];
    }
    const s = String(pOrItem);
    if (s.startsWith('cimg:') || s.startsWith('lib:')) return usageByCommonItem(s);
    return usage().byPath.get(norm(s)) || [];
  };

  function usageBadge(itemOrPath) {
    if (!itemOrPath) return '';
    let key = '', list = [];
    if (typeof itemOrPath === 'object') {
      const uid = String(itemOrPath.uid || '');
      const isCommon = uid.startsWith('cimg:') || uid.startsWith('lib:');
      if (isCommon) {
        key = uid;
        list = usageByCommonItem(itemOrPath);
      } else if (itemOrPath.path && AUDIO.test(itemOrPath.path)) {
        key = itemOrPath.path;
        list = usageList(itemOrPath.path);
      } else {
        return '';
      }
    } else {
      const s = String(itemOrPath);
      if (s.startsWith('cimg:') || s.startsWith('lib:')) {
        key = s;
        list = usageByCommonItem(s);
      } else if (AUDIO.test(s)) {
        key = s;
        list = usageList(s);
      } else {
        return '';
      }
    }
    const n = new Set(list.map(x => x.id)).size;
    const tip = n
      ? list.map(x => `${x.title} / ${x.detail || x.room}`).join('\n')
      : 'どのシナリオ・部屋でも未使用';
    return `<span class="ccf-usage${n ? '' : ' none'}" data-usage="${esc(key)}" title="${esc(tip)}">📚 ${n}</span>`;
  }
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function showUsage(el, p) {
    closePop(); const l = usageList(p);
    pop = document.createElement('div'); pop.className = 'ccf-usage-pop';
    pop.innerHTML = `<b>📚 使用シナリオ／部屋</b>` + (l.length ? l.map(x => `<div>${esc(x.title)} / ${esc(x.detail || x.room)}</div>`).join('') : '<div class="ccf-muted">未使用です</div>');
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px'; pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 4)) + 'px';
  }
  document.addEventListener('click', e => { const u = e.target.closest && e.target.closest('[data-usage]'); if (u) { e.stopPropagation(); showUsage(u, u.dataset.usage); } else if (!(e.target.closest && e.target.closest('.ccf-usage-pop'))) closePop(); }, true);

  // ================= 統合登録素材 API（sc.images + proj.refs + sc.docs 一元化） =================
  const keyOr = k => k || CCF.S.key;
  const projOf = key => key === CCF.S.key ? CCF.S.proj : CCF.readProject(key);
  function saveProj(key, proj) {
    if (key === CCF.S.key) { CCF.S.proj = proj; if (CCF.ui) CCF.ui.writeProject(proj); }
    else if (CCF.ui && typeof CCF.ui.saveRoomContainer === 'function') {
      const box = CCF.ui.getRoomContainer(key);
      if (box && box.rooms && box.rooms.length) { box.rooms[0].project = proj; box.rooms[0].updatedAt = Date.now(); CCF.ui.saveRoomContainer(key, box); }
    }
  }
  function assetImgTag(src, cls, extra) {
    const s = String(src || '');
    const c = cls ? ` class="${cls}"` : '';
    const rawEx = String(extra || '');
    const dragAttr = /\bdraggable\s*=/.test(rawEx) ? '' : ' draggable="false"';
    const ex = (rawEx ? ' ' + rawEx : '') + dragAttr;
    if (s.startsWith('@img:') && typeof window.imgAttr === 'function') {
      return `<img${c} ${window.imgAttr(s)}${ex}>`;
    }
    if (window.CloudSync && CloudSync.isCloudAssetRef && CloudSync.isCloudAssetRef(s)) {
      return `<img${c} src="${typeof PLACEHOLDER !== 'undefined' ? PLACEHOLDER : ''}" data-cloud-asset="${esc(s)}"${ex}>`;
    }
    return `<img${c} src="${esc(s)}"${ex}>`;
  }
  async function fillCloudAssetsIn(container) {
    if (!container || !window.CloudSync || !CloudSync.readCloudAssetBytes) return;
    for (const img of container.querySelectorAll('img[data-cloud-asset]')) {
      const ref = img.dataset.cloudAsset;
      if (!ref) continue;
      try {
        const u8 = await CloudSync.readCloudAssetBytes(ref, { download: true });
        if (u8 && document.body.contains(img)) {
          const parsed = CloudSync.parseCloudAssetRef(ref);
          const mime = (window.WebBridge && parsed && WebBridge.mimeFromName(parsed.name)) || 'image/webp';
          img.src = URL.createObjectURL(new Blob([u8], { type: mime }));
          img.removeAttribute('data-cloud-asset');
        }
      } catch (_) {}
    }
  }
  function afterChange(key) {
    const k = String(keyOr(key) || '');
    if (k && k !== '_default') {
      const sc = scenarioOf(k);
      if (sc) {
        sc.detailEdited = true;
        if (typeof window.syncScenarioAssetCatalog === 'function') {
          window.syncScenarioAssetCatalog(sc, { authoritative: false });
        }
        if (window.CloudSync && typeof window.CloudSync.scheduleAutoWebSync === 'function') {
          window.CloudSync.scheduleAutoWebSync(k);
        }
      }
    }
    uCache = null; invalidateUnified(null, false); window.dispatchEvent(new Event('ccf-refs-changed'));
    try { if (typeof saveState === 'function') saveState(); } catch (_) { }
    try { if (typeof renderGalleryAll === 'function') renderGalleryAll(); } catch (_) { }
    if (CCF.library) CCF.library.render();
    if (AM.el) draw();
  }
  function mutate(key, fn, label) {
    checkpoint(label || '登録素材の編集');
    const r = CCF.withProject(key, p => { p.folders = p.folders || []; p.assetOrder = p.assetOrder || []; return fn(p); });
    afterChange(key); return r;
  }

  function itemTags(item) {
    const base = Array.isArray(item.customTags) ? item.customTags : [];
    const id3 = (item.type === 'audio' && item.path && IS_ELECTRON) ? tagsOf(item.path).tagStrings : [];
    const auto = [];
    if (item.category) auto.push(item.category);
    return M.cleanTagList([...base, ...id3, ...auto]);
  }
  function itemBlob(item) {
    const id3Blob = (item.path && IS_ELECTRON && item.type === 'audio') ? tagsOf(item.path).blob : '';
    return [item.name, item.origName, item.category, item.path, ...itemTags(item), id3Blob].filter(Boolean).join(' ').toLowerCase();
  }
  function getUnifiedItems(key) {
    key = String(keyOr(key) || '');
    const sc = scenarioOf(key), p = projOf(key) || { refs: [], folders: [], assetOrder: [] };
    const scOrd = (sc && Array.isArray(sc.assetOrder)) ? sc.assetOrder : [];
    const pOrd = Array.isArray(p.assetOrder) ? p.assetOrder : [];
    const ordSig = (a) => a.length ? `${a.length}:${a[0]}:${a[a.length - 1]}` : '0';
    const watchRoot = getEffectiveScenarioWatchRoot();
    const sig = (sc ? `${(sc.images && sc.images.length) || 0}:${(sc.docs && sc.docs.length) || 0}:${(sc.assetCatalog && sc.assetCatalog.length) || 0}:${sc.sourcePath || ''}:${ordSig(scOrd)}` : 'n') + '|' + `${(p.refs && p.refs.length) || 0}:${ordSig(pOrd)}|${watchRoot}`;
    const cached = unifiedCache.get(key);
    if (cached && cached.sig === sig && (!IS_ELECTRON || watchRoot || (sc && sc.sourcePath))) return cached.items;
    const localMap = getScenarioLocalFileMap(key, sc);
    const isLocalOk = fp => !!fp && (isCloudOrVirtualPath(fp) || !IS_ELECTRON || pathExistsCached(fp));
    const out = [];
    const byPath = new Map(), byName = new Map();
    const docByPath = new Map(), docByName = new Map();
    let idx = 0;

    const registerItem = (it, isDoc) => {
      const pMap = isDoc ? docByPath : byPath;
      const nMap = isDoc ? docByName : byName;
      const pk = it.path ? norm(it.path) : '';
      const nk = isDoc ? docFileKey(it, it.type) : unifiedFileKey(it.name, it.origName, it.path);
      const ex = (pk && pMap.get(pk)) || (nk && nMap.get(nk)) || null;
      if (ex) {
        ex.category = isDoc ? '資料' : pickBetterCat(ex.category, it.category);
        ex.customTags = M.cleanTagList([...(ex.customTags || []), ...(it.customTags || [])]);
        const exLocalOk = ex.path && !ex.missing && isLocalOk(ex.path);
        const itLocalOk = it.path && !it.missing && isLocalOk(it.path);
        if (itLocalOk && (!exLocalOk || (!isCloudOrVirtualPath(it.path) && isCloudOrVirtualPath(ex.path)))) {
          ex.path = it.path;
          ex.missing = false;
        }
        if (!ex.dataUrl && it.dataUrl) ex.dataUrl = it.dataUrl;
        if (!ex.cloudSha && it.cloudSha) ex.cloudSha = it.cloudSha;
        if (ex.missing && (!it.missing || ex.dataUrl || ex.cloudSha)) ex.missing = false;
        ex.mergedUids = [...new Set([...(ex.mergedUids || [ex.uid]), ...(it.mergedUids || [it.uid])])];
        ex.tags = itemTags(ex);
        ex.blob = itemBlob(ex);
        if (pk && !pMap.has(pk)) pMap.set(pk, ex);
        if (nk && !nMap.has(nk)) nMap.set(nk, ex);
        return;
      }
      if (pk) pMap.set(pk, it);
      if (nk) nMap.set(nk, it);
      out.push(it);
    };

    if (sc && Array.isArray(sc.images)) {
      sc.images.forEach(a => {
        if (!a) return;
        const onm = a.origName || a.name || 'image', nm = stripAssetExt(a.name || onm) || 'image';
        if (isDocEntry(onm, '', '') || isDocEntry(nm, '', '')) return;
        const cat = normFolder(a.category), tags = M.cleanTagList(a.tags);
        const du = a.dataUrl || a.thumbRef || '';
        let imgPath = a.path || '';
        if (imgPath && IS_ELECTRON && !isCloudOrVirtualPath(imgPath) && !pathExistsCached(imgPath)) {
          const hit = findScenarioLocalPath(localMap, 'image', onm, a.name, baseName(imgPath));
          if (hit) imgPath = hit;
        }
        const it = { uid: 'img:' + a.id, rawId: a.id, srcType: 'img', type: 'image', name: nm, origName: onm, path: imgPath, dataUrl: du, cloudSha: a.cloudSha || '', category: cat, customTags: tags, mtime: Number(a.mtime || a.addedAt || 0), addedOrder: idx++, missing: false, raw: a, mergedUids: ['img:' + a.id] };
        it.tags = itemTags(it); it.blob = itemBlob(it);
        registerItem(it, false);
      });
    }
    (p.refs || []).forEach(r => {
      if (!r) return;
      const type = r.type || inferType(r.path || r.origName || r.name) || 'image';
      const rawRefNm = (isDocEntry(r.origName || r.name || r.path, type, r.path) ? docNameWithExt(r, type) : '') || r.origName || r.name || baseName(r.path) || 'file';
      const dispRefNm = stripAssetExt(r.name || rawRefNm) || 'file';
      const cloudPath = r.cloudSha ? ('cloud-asset://' + r.cloudSha + '/' + encodeURIComponent(rawRefNm)) : '';
      let fp = r.path || cloudPath || '';
      if (isDocEntry(rawRefNm, type, fp)) {
        const dType = /\.pdf$/i.test(rawRefNm || fp || '') ? 'pdf' : 'doc';
        let missing = (r.path && IS_ELECTRON && !r.cloudSha) ? !pathExistsCached(r.path) : false;
        if (missing || (IS_ELECTRON && (!fp || (!isCloudOrVirtualPath(fp) && !pathExistsCached(fp))))) {
          const hit = findScenarioLocalPath(localMap, dType, rawRefNm, r.origName, r.name, baseName(r.path));
          if (hit) { fp = hit; missing = false; }
        }
        const it = { uid: 'ref:' + r.id, rawId: r.id, srcType: 'ref', type: dType, name: dispRefNm, origName: rawRefNm, path: fp, dataUrl: '', cloudSha: r.cloudSha || '', category: '資料', customTags: M.cleanTagList(r.tags), mtime: Number(r.mtime || 0), addedOrder: idx++, missing, raw: r, mergedUids: ['ref:' + r.id] };
        it.tags = itemTags(it); it.blob = itemBlob(it);
        registerItem(it, true);
        return;
      }
      const cat = normFolder(r.category), tags = M.cleanTagList(r.tags);
      const du = r.dataUrl || r.thumbRef || '';
      let missing = (r.path && IS_ELECTRON && !du && !r.cloudSha) ? !pathExistsCached(r.path) : false;
      if (missing || (IS_ELECTRON && fp && !isCloudOrVirtualPath(fp) && !pathExistsCached(fp))) {
        const hit = findScenarioLocalPath(localMap, type, rawRefNm, r.origName, r.name, baseName(r.path));
        if (hit) { fp = hit; missing = false; }
      }
      const it = { uid: 'ref:' + r.id, rawId: r.id, srcType: 'ref', type, name: dispRefNm, origName: rawRefNm, path: fp, dataUrl: du, cloudSha: r.cloudSha || '', category: cat, customTags: tags, mtime: Number(r.mtime || 0), addedOrder: idx++, missing, raw: r, mergedUids: ['ref:' + r.id] };
      it.tags = itemTags(it); it.blob = itemBlob(it);
      registerItem(it, false);
    });
    if (sc && Array.isArray(sc.docs)) {
      sc.docs.forEach(d => {
        if (!d) return;
        const tags = M.cleanTagList(d.tags);
        const rawDocNm = docNameWithExt(d, 'doc');
        const dispDocNm = stripAssetExt(d.name || rawDocNm) || 'doc';
        const type = (d.ext === 'pdf' || /\.pdf$/i.test(rawDocNm)) ? 'pdf' : 'doc';
        let fp = d.path || d.ref || '';
        if (typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON && typeof path !== 'undefined' && path && typeof DATA_ROOT !== 'undefined' && DATA_ROOT && d.rel) {
          try { const abs = path.resolve(DATA_ROOT, d.rel); if (pathExistsCached(abs)) fp = abs; } catch (e) { /* noop */ }
        }
        if (IS_ELECTRON && (!fp || (!isCloudOrVirtualPath(fp) && !pathExistsCached(fp)))) {
          const hit = findScenarioLocalPath(localMap, type, rawDocNm, d.origName, d.name, baseName(fp));
          if (hit) fp = hit;
        }
        if (!fp && d.cloudSha) fp = 'cloud-asset://' + d.cloudSha + '/' + encodeURIComponent(rawDocNm);
        const it = { uid: 'doc:' + d.id, rawId: d.id, srcType: 'doc', type, name: dispDocNm, origName: rawDocNm, path: fp, dataUrl: d.dataUrl || '', cloudSha: d.cloudSha || '', category: '資料', customTags: tags, mtime: Number(d.mtime || d.addedAt || 0), addedOrder: idx++, missing: false, raw: d, mergedUids: ['doc:' + d.id] };
        it.tags = itemTags(it); it.blob = itemBlob(it);
        registerItem(it, true);
      });
    }
    if (sc && Array.isArray(sc.assetCatalog)) {
      sc.assetCatalog.forEach((c, ci) => {
        if (!c || !c.name) return;
        const tp = c.type || inferType(c.name) || 'image';
        const isDoc = isDocEntry(c.origName || c.name, tp, '');
        const dType = isDoc ? ((tp === 'pdf' || /\.pdf$/i.test(c.origName || c.name || '')) ? 'pdf' : 'doc') : tp;
        const cid = c.id || ('cat:' + ci + '_' + c.name);
        const docNm = isDoc ? docNameWithExt(c, dType) : '';
        const localPath = findScenarioLocalPath(localMap, dType, c.origName, docNm, c.name);
        const cloudPath = c.cloudSha ? ('cloud-asset://' + c.cloudSha + '/' + encodeURIComponent(isDoc ? docNm : (c.origName || c.name || 'asset'))) : '';
        const it = {
          uid: cid,
          rawId: cid,
          srcType: 'catalog',
          type: dType,
          name: c.name,
          origName: isDoc ? docNm : (c.origName || c.name),
          path: localPath || cloudPath,
          dataUrl: c.thumbRef || '',
          cloudSha: c.cloudSha || '',
          category: isDoc ? '資料' : normFolder(c.category),
          customTags: M.cleanTagList(c.tags),
          mtime: 0,
          addedOrder: idx++,
          missing: false,
          raw: c,
          mergedUids: [cid]
        };
        it.tags = itemTags(it); it.blob = itemBlob(it);
        registerItem(it, isDoc);
      });
    }
    const ord = scOrd.length ? scOrd : pOrd;
    if (ord.length || pOrd.length) {
      const rank = new Map();
      ord.forEach((u, i) => { if (u && !rank.has(u)) rank.set(u, i); });
      if (ord !== pOrd && pOrd.length) {
        const base = ord.length;
        pOrd.forEach((u, i) => { if (u && !rank.has(u)) rank.set(u, base + i); });
      }
      const getRank = it => {
        if (rank.has(it.uid)) return rank.get(it.uid);
        if (Array.isArray(it.mergedUids)) {
          for (const mu of it.mergedUids) {
            if (rank.has(mu)) return rank.get(mu);
          }
        }
        const fk = unifiedFileKey(it.name, it.origName, it.path);
        if (fk && (rank.has('fn:' + fk) || rank.has(fk))) return rank.has('fn:' + fk) ? rank.get('fn:' + fk) : rank.get(fk);
        return 1e9 + it.addedOrder;
      };
      out.sort((a, b) => getRank(a) - getRank(b));
    }
    unifiedCache.set(key, { sig, items: out });
    return out;
  }

  function addDocsToScenario(sc, docs) {
    if (!sc || !Array.isArray(docs) || !docs.length) return 0;
    unignoreDocNames(sc, docs);
    sc.docs = Array.isArray(sc.docs) ? sc.docs : [];
    const byPath = new Map(), byName = new Map();
    sc.docs.forEach(d => {
      if (!d) return;
      const dp = (d.path || d.ref) ? norm(d.path || d.ref) : '';
      const dn = docFileKey(d, d.ext === 'pdf' ? 'pdf' : 'doc');
      if (dp) byPath.set(dp, d);
      if (dn && !byName.has(dn)) byName.set(dn, d);
    });
    const hasFs = typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON && typeof fs !== 'undefined' && fs;
    const isMissingOnThisPc = (exPath, newFp) => {
      if (!exPath) return true;
      if (hasFs && !fs.existsSync(exPath)) return true;
      if ((typeof IS_ELECTRON === 'undefined' || !IS_ELECTRON) && /^(?:idb-asset|cloud-asset|https?):/i.test(String(newFp || '')) && !/^(?:https?:|idb-asset|cloud-asset|blob):/i.test(String(exPath))) return true;
      return false;
    };
    let updated = 0;
    if (CCF.dnd && typeof CCF.dnd.upsertScenarioDocs === 'function') {
      docs.forEach(it => {
        if (!it || !it.name) return;
        const fp = it.path || it.ref || '';
        if (!fp) return;
        const pk = norm(fp);
        const nk = docFileKey(it, /\.pdf$/i.test(String(it.origName || it.name || fp)) ? 'pdf' : 'doc');
        const ex = (pk && byPath.get(pk)) || (nk && byName.get(nk));
        if (ex && isMissingOnThisPc(ex.path, fp)) {
          const nextRel = it.rel || '';
          const nextMtime = Number(it.mtime || 0);
          if (ex.path !== fp || ex.ref !== fp || (ex.rel || '') !== nextRel || Number(ex.mtime || 0) !== nextMtime) {
            ex.path = fp;
            ex.ref = fp;
            ex.rel = nextRel;
            ex.mtime = nextMtime;
            updated++;
          }
        }
      });
      return (CCF.dnd.upsertScenarioDocs(sc, docs) || 0) + updated;
    }
    let added = 0;
    docs.forEach(it => {
      if (!it || !it.name) return;
      const fp = it.path || it.ref || '';
      const pk = fp ? norm(fp) : '';
      const nk = docFileKey(it, /\.pdf$/i.test(String(it.origName || it.name || fp)) ? 'pdf' : 'doc');
      const ex = (pk && byPath.get(pk)) || (nk && byName.get(nk));
      if (ex) {
        if (fp && isMissingOnThisPc(ex.path, fp)) {
          const nextRel = it.rel || '';
          const nextMtime = Number(it.mtime || 0);
          if (ex.path !== fp || ex.ref !== fp || (ex.rel || '') !== nextRel || Number(ex.mtime || 0) !== nextMtime) {
            ex.path = fp;
            ex.ref = fp;
            ex.rel = nextRel;
            ex.mtime = nextMtime;
            added++;
          }
        }
        return;
      }
      const extM = String(it.name).match(/\.([^.]+)$/);
      const dObj = { id: M.newId(), name: it.name, origName: it.origName || it.name, path: fp, ref: fp, rel: it.rel || '', ext: extM ? extM[1].toLowerCase() : 'pdf', category: '資料', mtime: Number(it.mtime || 0), addedAt: Date.now() };
      sc.docs.push(dObj);
      if (pk) byPath.set(pk, dObj);
      if (nk) byName.set(nk, dObj);
      added++;
    });
    return added;
  }

  function cleanupScenarioAssets(key) {
    key = String(keyOr(key) || '');
    const sc = scenarioOf(key);
    if (!sc) return { changed: false, removedDupRefs: 0, removedDupImgs: 0, movedDocs: 0, removedOldAssets: 0 };
    let changed = false, removedDupRefs = 0, removedDupImgs = 0, movedDocs = 0, removedOldAssets = 0;
    const ignoredDocs = new Set((Array.isArray(sc.ignoredDocNames) ? sc.ignoredDocNames : []).map(x => String(x || '').normalize('NFKC').trim().toLowerCase()).filter(Boolean));

    // 1) sc.docs の重複排除・旧版除外・拡張子除去
    if (Array.isArray(sc.docs) && sc.docs.length) {
      const docSeenP = new Map(), docSeenN = new Map(), nextDocs = [];
      sc.docs.forEach(d => {
        if (!d) return;
        const fp = d.path || d.ref || d.rel || '';
        const rawNm = d.origName || d.name || (fp ? baseName(fp) : '');
        if (isOldVersionAsset(rawNm)) { removedOldAssets++; changed = true; return; }
        if (!d.origName && rawNm) { d.origName = rawNm; changed = true; }
        const stripped = stripAssetExt(d.name || rawNm);
        if (stripped && d.name !== stripped) { d.name = stripped; changed = true; }
        const pk = fp ? norm(fp) : '';
        const nk = docFileKey(d, d.ext === 'pdf' ? 'pdf' : 'doc');
        if (nk && ignoredDocs.has(nk)) { changed = true; return; }
        const ex = (pk && docSeenP.get(pk)) || (nk && docSeenN.get(nk));
        if (ex) {
          if (fp && !ex.path && d.path) ex.path = d.path;
          if (fp && !ex.ref && d.ref) ex.ref = d.ref;
          if (!ex.rel && d.rel) ex.rel = d.rel;
          if (!ex.cloudSha && d.cloudSha) ex.cloudSha = d.cloudSha;
          changed = true;
          return;
        }
        if (pk) docSeenP.set(pk, d);
        if (nk) docSeenN.set(nk, d);
        nextDocs.push(d);
      });
      const verFilteredDocs = filterLatestAssets(nextDocs.map(d => ({ name: docNameWithExt(d, d.ext === 'pdf' ? 'pdf' : 'doc'), isDir: false, mtime: Number(d.mtime || d.addedAt || 0), doc: d }))).map(x => x.doc);
      if (verFilteredDocs.length !== nextDocs.length) {
        removedOldAssets += (nextDocs.length - verFilteredDocs.length);
        changed = true;
      }
      if (verFilteredDocs.length !== sc.docs.length) { sc.docs = verFilteredDocs; changed = true; }
    }

    // 2) sc.images のドキュメント混入除去＆重複排除（カテゴリ違いを1件に統合）＆ NPC立ち絵のトレーラー誤混入修正
    const imgByName = new Map();
    const movedNpcUrls = new Set(), movedNpcNames = new Set();
    if (Array.isArray(sc.images) && sc.images.length) {
      const nextImgs = [];
      sc.images.forEach(a => {
        if (!a) return;
        const nm = a.origName || a.name || '';
        if (isDocEntry(nm, '', a.path || '')) {
          const dk = docFileKey(a, /\.pdf$/i.test(nm || a.path || '') ? 'pdf' : 'doc');
          if ((a.path || a.rel) && !(dk && ignoredDocs.has(dk))) movedDocs += addDocsToScenario(sc, [{ name: a.name || nm, origName: nm, path: a.path || '', rel: a.rel || '', mtime: a.mtime || 0 }]);
          removedDupImgs++; changed = true;
          return;
        }
        let cat = normFolder(a.category);
        if (isNpcPortraitItem(a, sc.title) && (cat === 'トレーラー' || !cat)) {
          if (cat === 'トレーラー') {
            if (a.dataUrl) movedNpcUrls.add(a.dataUrl);
            if (a.thumbRef) movedNpcUrls.add(a.thumbRef);
            if (nm) movedNpcNames.add(unifiedFileKey(a.name, a.origName, a.path));
          }
          cat = 'NPC';
          if (Array.isArray(sc.imageCategories) && !sc.imageCategories.includes('NPC')) sc.imageCategories.push('NPC');
        }
        if (cat !== a.category) { a.category = cat; changed = true; }
        if (!a.origName && nm) { a.origName = nm; changed = true; }
        const strippedImg = stripAssetExt(a.name || nm);
        if (strippedImg && a.name !== strippedImg) { a.name = strippedImg; changed = true; }
        const nk = unifiedFileKey(a.name, a.origName, a.path);
        const ex = nk ? imgByName.get(nk) : null;
        if (ex) {
          const better = pickBetterCat(ex.category, cat);
          if (better !== ex.category) { ex.category = better; changed = true; }
          if (!ex.dataUrl && a.dataUrl) { ex.dataUrl = a.dataUrl; changed = true; }
          if (!ex.path && a.path) { ex.path = a.path; changed = true; }
          ex.tags = M.cleanTagList([...(ex.tags || []), ...(a.tags || [])]);
          removedDupImgs++; changed = true;
          return;
        }
        if (nk) imgByName.set(nk, a);
        nextImgs.push(a);
      });
      if (nextImgs.length !== sc.images.length) { sc.images = nextImgs; changed = true; }
    }

    // 3) proj.refs（部屋プロジェクト群）からドキュメント誤混入を除外・移管し、同一ファイルの重複登録（部屋素材 vs 未分類 等）を1件に統合
    const dedupeRefsInProj = proj => {
      if (!proj || !Array.isArray(proj.refs)) return;
      const byP = new Map(), byN = new Map(), nextRefs = [];
      proj.refs.forEach(r => {
        if (!r) return;
        const rawNm = r.origName || r.name || baseName(r.path);
        if (isOldVersionAsset(rawNm)) { removedOldAssets++; changed = true; return; }
        if (!r.origName && rawNm) { r.origName = rawNm; changed = true; }
        const strippedRef = stripAssetExt(r.name || rawNm);
        if (strippedRef && r.name !== strippedRef) { r.name = strippedRef; changed = true; }
        const tp = r.type || inferType(r.path || rawNm) || 'image';
        if (isDocEntry(rawNm, tp, r.path)) {
          const dk = docFileKey(r, tp);
          if (!(dk && ignoredDocs.has(dk))) {
            movedDocs += addDocsToScenario(sc, [{ name: r.name || baseName(r.path), origName: r.origName || r.name, path: r.path || '', mtime: r.mtime || 0 }]);
          }
          removedDupRefs++; changed = true;
          return;
        }
        let cat = normFolder(r.category);
        if (tp === 'image' && isNpcPortraitItem(r, sc.title) && (cat === 'トレーラー' || !cat)) {
          if (cat === 'トレーラー') {
            if (r.dataUrl) movedNpcUrls.add(r.dataUrl);
            const rnk = unifiedFileKey(r.name, r.origName, r.path);
            if (rnk) movedNpcNames.add(rnk);
          }
          cat = 'NPC';
          if (Array.isArray(sc.imageCategories) && !sc.imageCategories.includes('NPC')) sc.imageCategories.push('NPC');
        }
        if (cat !== r.category) { r.category = cat; changed = true; }
        const pk = r.path ? norm(r.path) : '';
        const nk = unifiedFileKey(r.name, r.origName, r.path);

        // sc.images に同一画像が既にあり、より具体的なカテゴリがある場合は同期する
        const imgMatch = (tp === 'image' && nk) ? imgByName.get(nk) : null;
        if (imgMatch) {
          const better = pickBetterCat(imgMatch.category, cat);
          if (better !== imgMatch.category) { imgMatch.category = better; changed = true; }
        }

        const ex = (pk && byP.get(pk)) || (nk && byN.get(nk)) || null;
        if (ex) {
          const better = pickBetterCat(ex.category, cat);
          if (better !== ex.category) { ex.category = better; changed = true; }
          if (!ex.path && r.path) { ex.path = r.path; changed = true; }
          ex.tags = M.cleanTagList([...(ex.tags || []), ...(r.tags || [])]);
          removedDupRefs++; changed = true;
          return;
        }
        if (pk) byP.set(pk, r);
        if (nk) byN.set(nk, r);
        nextRefs.push(r);
      });
      const verFilteredRefs = filterLatestAssets(nextRefs.map(r => ({ name: r.origName || r.name || baseName(r.path || ''), isDir: false, mtime: Number(r.mtime || 0), refObj: r }))).map(x => x.refObj);
      if (verFilteredRefs.length !== nextRefs.length) {
        removedOldAssets += (nextRefs.length - verFilteredRefs.length);
        changed = true;
      }
      if (verFilteredRefs.length !== proj.refs.length) {
        proj.refs = verFilteredRefs;
        changed = true;
      }
    };

    if (String(CCF.S.key) === key && CCF.S.proj) {
      dedupeRefsInProj(CCF.S.proj);
    }
    if (Array.isArray(sc.ccfRooms)) {
      sc.ccfRooms.forEach(rm => { if (rm && rm.project) dedupeRefsInProj(rm.project); });
    }

    // 4) NPC立ち絵がトレーラーサムネイル（sc.imageUrl / sc.hoverImages）にセットされていた場合の除去・差し替え
    const npcThumbUrls = new Set(movedNpcUrls);
    (sc.images || []).forEach(im => {
      if (!im) return;
      if (normFolder(im.category) === 'NPC' || isNpcPortraitItem(im, sc.title)) {
        if (im.dataUrl) npcThumbUrls.add(im.dataUrl);
        if (im.thumbRef) npcThumbUrls.add(im.thumbRef);
      }
    });
    if (Array.isArray(sc.hoverImages) && sc.hoverImages.length && npcThumbUrls.size) {
      const nextHover = sc.hoverImages.filter(u => u && !npcThumbUrls.has(u));
      if (nextHover.length !== sc.hoverImages.length) { sc.hoverImages = nextHover; changed = true; }
    }
    if (sc.imageUrl && (movedNpcUrls.has(sc.imageUrl) || (!sc.detailEdited && npcThumbUrls.has(sc.imageUrl)))) {
      const cands = [];
      (sc.images || []).forEach(im => {
        if (im && (im.dataUrl || im.thumbRef || im.path)) {
          cands.push({ name: im.origName || im.name || '', relPath: im.path || '', category: normFolder(im.category), dataUrl: im.dataUrl || im.thumbRef || '', path: im.path || '' });
        }
      });
      const curP = projOf(key);
      ((curP && curP.refs) || []).forEach(r => {
        if (r && (r.type === 'image' || IMG.test(r.name || r.path || ''))) {
          cands.push({ name: r.origName || r.name || '', relPath: r.path || '', category: normFolder(r.category), dataUrl: r.dataUrl || r.thumbRef || '', path: r.path || '' });
        }
      });
      const best = (CCF.dnd && CCF.dnd.pickTrailer) ? CCF.dnd.pickTrailer(cands) : null;
      const bestUrl = best ? (best.dataUrl || '') : '';
      if (bestUrl && bestUrl !== sc.imageUrl) {
        if (CCF.dnd && CCF.dnd.setTrailerImage) CCF.dnd.setTrailerImage(sc, bestUrl, best.name);
        else sc.imageUrl = bestUrl;
        changed = true;
      } else {
        sc.imageUrl = '';
        if (Array.isArray(sc.fullBlockData)) {
          const imgB = sc.fullBlockData.find(b => b && b.type === 'image');
          if (imgB) { imgB.previewUrl = ''; imgB.file = null; }
        }
        changed = true;
      }
    }

    if (changed) invalidateUnified(key, false);
    return { changed, removedDupRefs, removedDupImgs, movedDocs, removedOldAssets };
  }

  function cleanupAllScenarioAssets() {
    let fixedScenarios = 0, removedDupRefs = 0, removedDupImgs = 0, movedDocs = 0, removedOldAssets = 0;
    const list = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : [];
    list.forEach(sc => {
      if (!sc || !sc.id) return;
      const r = cleanupScenarioAssets(sc.id);
      if (r.changed) {
        fixedScenarios++;
        removedDupRefs += r.removedDupRefs;
        removedDupImgs += r.removedDupImgs;
        movedDocs += r.movedDocs;
        removedOldAssets += (r.removedOldAssets || 0);
      }
    });
    if (fixedScenarios > 0) {
      uCache = null;
      invalidateUnified(null, false);
    }
    return { fixedScenarios, removedDupRefs, removedDupImgs, movedDocs, removedOldAssets };
  }
  const countFor = key => getUnifiedItems(key).length;

  const foldersOf = (p, key) => {
    const sc = key ? scenarioOf(key) : null;
    const list = new Set([...((sc && sc.imageCategories) || []), ...(p && p.folders || [])].map(normFolder).filter(Boolean));
    getUnifiedItems(key).forEach(r => { if (r.category) list.add(r.category); });
    if (AM.el && String(AM.key) === String(keyOr(key))) AM.keptFolders.forEach(f => { if (f) list.add(f); });
    return [...list];
  };

  function inferType(fp) {
    const nm = baseName(fp || '');
    if (IMG.test(nm)) return 'image';
    if (VIDEO.test(nm)) return 'video';
    if (AUDIO.test(nm)) return 'audio';
    if (/\.pdf$/i.test(nm)) return 'pdf';
    if (/\.zip$/i.test(nm)) return 'zip';
    if (DOC.test(nm)) return 'doc';
    return CCF.dnd ? CCF.dnd.typeOf(nm) : '';
  }

  async function addBrowserFiles(key, files, folder) {
    const targetKey = String(keyOr(key) || '');
    if (!targetKey || targetKey === '_default') { say('シナリオを先に選んでください'); return 0; }
    const sc = scenarioOf(targetKey);
    if (!sc) return 0;
    const exp = normFolder(folder), refsToAdd = [], docsToAdd = [];
    let added = 0;
    checkpoint('登録素材を追加');
    for (const f of (files || [])) {
      const tp = inferType(f.name); if (!tp) continue;
      if (isDocEntry(f.name, tp, '')) {
        if (window.WebBridge && WebBridge.saveAssetFile) {
          const ref = await WebBridge.saveAssetFile(f);
          if (ref) docsToAdd.push({ name: f.name, origName: f.name, path: ref, mtime: f.lastModified || 0 });
        } else {
          docsToAdd.push({ name: f.name, origName: f.name, path: '', mtime: f.lastModified || 0 });
        }
        continue;
      }
      const cat = exp || (tp === 'audio' ? 'BGM' : M.inferSmartCategory(f.name, ''));
      if (tp === 'image') {
        const dataUrl = await new Promise(res => {
          if (typeof compressImage === 'function') compressImage(f, 1000, 1000, 0.82).then(res).catch(() => res(''));
          else { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.onerror = () => res(''); fr.readAsDataURL(f); }
        });
        if (dataUrl) {
          sc.images = sc.images || [];
          sc.imageCategories = sc.imageCategories || [...(window.DEFAULT_SCENARIO_CATS || ['トレーラー', 'NPC', '背景', '前景', 'マップ', '部屋素材'])];
          if (cat && !sc.imageCategories.includes(cat)) sc.imageCategories.push(cat);
          const fk = unifiedFileKey(f.name, f.name, '');
          const dup = fk ? sc.images.find(x => x && unifiedFileKey(x.name, x.origName, '') === fk) : null;
          if (dup) {
            dup.dataUrl = typeof urlToRef === 'function' ? urlToRef(dataUrl) : dataUrl;
            dup.category = pickBetterCat(dup.category, cat);
            if (f.lastModified) dup.mtime = f.lastModified;
          } else {
            sc.images.push({ id: M.newId(), name: stripAssetExt(f.name), origName: f.name, dataUrl: typeof urlToRef === 'function' ? urlToRef(dataUrl) : dataUrl, category: cat, tags: [], addedAt: Date.now() });
          }
          added++;
        }
      } else if (window.WebBridge && WebBridge.saveAssetFile) {
        const ref = await WebBridge.saveAssetFile(f);
        if (ref) refsToAdd.push({ type: tp, name: stripAssetExt(f.name), origName: f.name, path: ref, category: cat, mtime: f.lastModified || 0 });
      }
    }
    if (docsToAdd.length) { unignoreDocNames(sc, docsToAdd); added += addDocsToScenario(sc, docsToAdd); }
    if (refsToAdd.length) {
      added += CCF.withProject(targetKey, p => {
        p.folders = p.folders || []; p.assetOrder = p.assetOrder || [];
        const c = M.addRefs(p, refsToAdd);
        refsToAdd.forEach(r => { if (r.category && !p.folders.includes(r.category)) p.folders.push(r.category); });
        return c;
      });
    }
    if (added) { cleanupScenarioAssets(targetKey); afterChange(targetKey); }
    say(added ? `📌 ${added}件を登録素材へ追加しました` : '追加できるファイルがありませんでした');
    return added;
  }

  function addPaths(key, paths, folder) {
    key = String(keyOr(key) || ''); if (!key || key === '_default') { say('シナリオを先に選んでください'); return 0; }
    const exp = normFolder(folder);
    const sc = scenarioOf(key);
    const scTitleNorm = (sc && sc.title && M && M.normalizeForMatch) ? M.normalizeForMatch(sc.title) : '';
    const list = [], docs = [];
    (paths || []).forEach(p => {
      const t = inferType(p); if (!t) return;
      let mtime = 0; try { mtime = fs.statSync(p).mtimeMs || 0; } catch (_) { }
      const nm = path.basename(p);
      if (isDocEntry(nm, t, p)) {
        docs.push({ name: nm, origName: nm, path: p, mtime });
        return;
      }
      const rawParent = path.basename(path.dirname(p));
      const parent = (scTitleNorm && M && M.normalizeForMatch && M.normalizeForMatch(rawParent) === scTitleNorm) ? '' : rawParent;
      const cat = exp || (t === 'audio' ? ((parent && !M.isUnclassifiedCat(parent)) ? parent : 'BGM') : M.inferSmartCategory(nm, parent));
      const id3t = (t === 'audio' && IS_ELECTRON) ? tagsOf(p).tagStrings : [];
      list.push({ type: t, name: stripAssetExt(nm), origName: nm, path: p, category: cat, mtime, tags: id3t });
    });
    if (!list.length && !docs.length) { say('対応しているファイル形式（画像・音声・PDF・テキスト・ZIP）がありません'); return 0; }
    let n = 0;
    if (docs.length && sc) {
      unignoreDocNames(sc, docs);
      n += addDocsToScenario(sc, docs);
    }
    if (list.length) {
      n += mutate(key, p => {
        const c = M.addRefs(p, list);
        list.forEach(r => {
          if (r.category && !p.folders.includes(r.category)) p.folders.push(r.category);
          if (sc && r.category && Array.isArray(sc.imageCategories) && !sc.imageCategories.includes(r.category)) sc.imageCategories.push(r.category);
        });
        return c;
      }, '登録素材を追加');
    } else if (n) {
      afterChange(key);
    }
    if (n) { cleanupScenarioAssets(key); if (typeof window.syncScenarioAssetCatalog === 'function' && sc) window.syncScenarioAssetCatalog(sc, { authoritative: true }); }
    say(n ? `📌 ${n}件を登録素材へ追加・更新しました` : 'すでに同じパス（同等更新日時）の素材が登録済みです');
    return n;
  }

  function askName(title, def) {
    return new Promise(res => {
      const ov = document.createElement('div'); ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      ov.innerHTML = `<div class="app-dialog"><div class="app-dialog-title">${esc(title)}</div><input type="text" class="ccf-am-input" value="${esc(def || '')}" style="width:100%"><div class="app-dialog-actions"><button type="button" class="app-dialog-btn" data-x="0">キャンセル</button><button type="button" class="app-dialog-btn primary" data-x="1">OK</button></div></div>`;
      document.body.appendChild(ov); const inp = ov.querySelector('input'); inp.focus(); inp.select();
      const done = v => { ov.remove(); res(v); };
      ov.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) done(b.dataset.x === '1' ? inp.value.trim() : null); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value.trim()); } else if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    });
  }

  // ================= 拡大モーダル（シナリオ素材 ⇔ マイライブラリ切替・D&D並べ替え・名前変更・タグ絞り込み） =================
  const PICKER_VIEW_KEY = 'ccf_picker_view_mode_v1';
  const loadPickerView = () => { try { return localStorage.getItem(PICKER_VIEW_KEY) === 'list' ? 'list' : 'folder'; } catch (_) { return 'folder'; } };
  const savePickerView = v => { try { localStorage.setItem(PICKER_VIEW_KEY, v); } catch (_) { } };
  const AM_INCSUB_KEY = 'ccf_am_incsub_v1';
  const loadIncSub = () => { try { return localStorage.getItem(AM_INCSUB_KEY) !== '0'; } catch (_) { return true; } };
  const AM = { mode: 'scenario', key: '', folder: ALL, sel: new Set(), prev: '', q: '', tag: '', usedScn: '', sort: 'manual', viewMode: loadPickerView(), openGroups: new Set(), el: null, dragIds: [], dragFolder: '', keptFolders: new Set(), anchor: '', incSub: loadIncSub(), collapsed: new Set() };

  function groupByFolder(list) {
    const groups = new Map();
    list.forEach(r => {
      const fk = normFolder(r.category) || NONE;
      if (!groups.has(fk)) groups.set(fk, []);
      groups.get(fk).push(r);
    });
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === NONE) return 1;
      if (b === NONE) return -1;
      return a.localeCompare(b, 'ja', { numeric: true });
    });
    return { groups, keys };
  }

  function renderFolderGroupsHtml(list, cardRenderer, openSet, isFiltering) {
    if (!list.length) return '';
    const { groups, keys } = groupByFolder(list);
    const autoOpenAll = isFiltering || list.length <= 40 || keys.length <= 1;
    return keys.map(fk => {
      const gList = groups.get(fk) || [];
      const open = autoOpenAll || openSet.has(fk);
      const label = fk === NONE ? '（未分類）' : folderLabel(fk);
      const thumbs = !open ? gList.slice(0, 4).map(r => {
        const src = r.dataUrl || (r.path && !r.missing ? fileUrl(r.path) : '');
        return r.type === 'image' && src
          ? assetImgTag(src, 'ccf-pick-gimg', 'loading="lazy" decoding="async" alt=""')
          : `<span class="ccf-pick-gico">${icon(r)}</span>`;
      }).join('') : '';
      const initCnt = Math.min(PAGE_SIZE, gList.length);
      const rem = gList.length - initCnt;
      const moreHtml = rem > 0
        ? `<div class="ccf-more-wrap" data-ccf-gmorewrap="${esc(fk)}"><button type="button" class="ccf-btn" data-ccf-gmore="${esc(fk)}">さらに${PAGE_SIZE}件を表示（残り${rem}件）</button></div>`
        : '';
      return `<div class="ccf-pick-group${open ? ' open' : ''}">
        <button type="button" class="ccf-pick-ghead" data-gtoggle="${esc(fk)}" aria-expanded="${open}">
          <span class="ccf-pick-gtitle">${open ? '▾' : '▸'} 📁 ${esc(label)}</span>
          <small class="ccf-pick-gcnt">(${gList.length})</small>
          ${thumbs ? `<span class="ccf-pick-gthumbs">${thumbs}</span>` : ''}
        </button>
        ${open ? `<div class="ccf-pick-ggrid">${gList.slice(0, initCnt).map(cardRenderer).join('')}${moreHtml}</div>` : ''}
      </div>`;
    }).join('');
  }

  function mountGridView(gridEl, list, renderer, opts) {
    if (!gridEl) return;
    if (gridEl._pagerObs) { try { gridEl._pagerObs.disconnect(); } catch (_) { } gridEl._pagerObs = null; }
    const o = opts || {};
    const isGrouped = !!o.isGrouped;
    gridEl.classList.toggle('is-grouped', isGrouped);
    if (!list.length) {
      gridEl._pagerState = null;
      gridEl.innerHTML = o.emptyHtml || '<div class="ccf-empty">該当する素材がありません。</div>';
      return;
    }

    if (!gridEl.dataset.pagerWired) {
      gridEl.dataset.pagerWired = '1';
      gridEl.addEventListener('click', e => {
        const st = gridEl._pagerState;
        if (!st) return;
        const flatBtn = e.target.closest('[data-ccf-more]');
        if (flatBtn && st.flat) {
          e.stopPropagation();
          st.appendFlat();
          return;
        }
        const grpBtn = e.target.closest('[data-ccf-gmore]');
        if (grpBtn && st.groups) {
          e.stopPropagation();
          st.appendGroup(grpBtn.dataset.ccfGmore || NONE);
        }
      });
    }

    if (isGrouped) {
      const { groups } = groupByFolder(list);
      const offsets = new Map();
      groups.forEach((gList, fk) => offsets.set(fk, Math.min(PAGE_SIZE, gList.length)));
      gridEl.innerHTML = renderFolderGroupsHtml(list, renderer, o.openSet, !!o.isFiltering);
      const appendGroup = fk => {
        const gList = groups.get(fk);
        const cur = offsets.get(fk) || 0;
        if (!gList || cur >= gList.length) return;
        const wrap = Array.from(gridEl.querySelectorAll('[data-ccf-gmorewrap]')).find(w => w.dataset.ccfGmorewrap === fk);
        if (!wrap) return;
        const chunk = gList.slice(cur, cur + PAGE_SIZE);
        wrap.insertAdjacentHTML('beforebegin', chunk.map(renderer).join(''));
        const nextOff = cur + chunk.length;
        offsets.set(fk, nextOff);
        const rem = gList.length - nextOff;
        if (rem <= 0) {
          if (gridEl._pagerObs) try { gridEl._pagerObs.unobserve(wrap); } catch (_) { }
          wrap.remove();
        } else {
          const btn = wrap.querySelector('[data-ccf-gmore]');
          if (btn) btn.textContent = `さらに${PAGE_SIZE}件を表示（残り${rem}件）`;
        }
      };
      gridEl._pagerState = { groups, appendGroup };
      const wraps = gridEl.querySelectorAll('[data-ccf-gmorewrap]');
      if (wraps.length && typeof IntersectionObserver === 'function') {
        const obs = new IntersectionObserver(entries => {
          entries.forEach(en => {
            if (en.isIntersecting) appendGroup(en.target.dataset.ccfGmorewrap || NONE);
          });
        }, { root: gridEl, rootMargin: '160px' });
        wraps.forEach(w => obs.observe(w));
        gridEl._pagerObs = obs;
      }
      return;
    }

    const initCnt = Math.min(PAGE_SIZE, list.length);
    const rem = list.length - initCnt;
    const moreHtml = rem > 0
      ? `<div class="ccf-more-wrap" data-ccf-morewrap="1"><button type="button" class="ccf-btn" data-ccf-more="1">さらに${PAGE_SIZE}件を表示（残り${rem}件）</button></div>`
      : '';
    gridEl.innerHTML = list.slice(0, initCnt).map(renderer).join('') + moreHtml;
    let offset = initCnt;
    const appendFlat = () => {
      if (offset >= list.length) return;
      const wrap = gridEl.querySelector('[data-ccf-morewrap]');
      if (!wrap) return;
      const chunk = list.slice(offset, offset + PAGE_SIZE);
      wrap.insertAdjacentHTML('beforebegin', chunk.map(renderer).join(''));
      offset += chunk.length;
      const left = list.length - offset;
      if (left <= 0) {
        if (gridEl._pagerObs) { try { gridEl._pagerObs.disconnect(); } catch (_) { } gridEl._pagerObs = null; }
        wrap.remove();
      } else {
        const btn = wrap.querySelector('[data-ccf-more]');
        if (btn) btn.textContent = `さらに${PAGE_SIZE}件を表示（残り${left}件）`;
      }
    };
    gridEl._pagerState = rem > 0 ? { flat: true, appendFlat } : null;
    const moreWrap = gridEl.querySelector('[data-ccf-morewrap]');
    if (moreWrap && typeof IntersectionObserver === 'function') {
      const obs = new IntersectionObserver(entries => {
        if (entries.some(en => en.isIntersecting)) appendFlat();
      }, { root: gridEl, rootMargin: '160px' });
      obs.observe(moreWrap);
      gridEl._pagerObs = obs;
    }
  }

  function pickerLeftHtml(allItems, curFolder) {
    const fl = [...new Set(allItems.map(r => normFolder(r.category)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
    const tree = buildFolderTree(fl);
    const cnt = f => allItems.filter(r => f === ALL ? true : f === NONE ? !normFolder(r.category) : inFolder(normFolder(r.category), f, true)).length;
    const row = (f, label, ico, depth) => `<div class="ccf-am-f${curFolder === f ? ' on' : ''}" data-pf="${esc(f)}"${depth ? ` style="padding-left:${8 + depth * 14}px"` : ''} title="${esc(f === ALL || f === NONE ? label : f)}"><span class="ccf-am-fname">${ico} ${esc(label)}</span><small>${cnt(f)}</small></div>`;
    const walk = (list, d) => list.map(n => row(n.path, baseOf(n.path), '📁', d) + walk(n.children, d + 1)).join('');
    return row(ALL, 'すべて', '🗂️', 0) + (cnt(NONE) ? row(NONE, '（未分類）', '📂', 0) : '') + walk(tree.roots, 0);
  }

  function modeItems() {
    if (AM.mode === 'common') return window.CommonAssets ? window.CommonAssets.getAll() : [];
    return getUnifiedItems(AM.key);
  }
  function modeFolders() {
    if (AM.mode === 'common') {
      const items = modeItems();
      const set = new Set([...((typeof appState !== 'undefined' && Array.isArray(appState.commonCats)) ? appState.commonCats : []), ...AM.keptFolders].map(normFolder).filter(Boolean));
      items.forEach(i => { const c = normFolder(i.category); if (c) set.add(c); });
      return [...set];
    }
    return foldersOf(projOf(AM.key), AM.key);
  }
  const splitCharSortKey = name => {
    const raw = String(name || '').normalize('NFKC').trim();
    const m = raw.match(/^[0-9０-９]+[._．・\s-]*(.*)$/);
    const base = (m && m[1] && m[1].trim()) ? m[1].trim() : raw;
    return { base, full: raw };
  };
  function sortItems(arr) {
    const out = arr.slice();
    if (AM.sort === 'name') out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja', { numeric: true }));
    else if (AM.sort === 'character') {
      out.sort((a, b) => {
        const ka = splitCharSortKey(a.name), kb = splitCharSortKey(b.name);
        const cmp = ka.base.localeCompare(kb.base, 'ja', { numeric: true });
        if (cmp !== 0) return cmp;
        return ka.full.localeCompare(kb.full, 'ja', { numeric: true });
      });
    }
    else if (AM.sort === 'added') out.sort((a, b) => (a.addedOrder || 0) - (b.addedOrder || 0));
    return out;
  }
  function visible() {
    const parsed = M.parseSearchQuery(AM.q);
    let usedUidSet = null;
    if (AM.mode === 'common' && AM.usedScn) {
      const m = usage().byScenarioCommon.get(String(AM.usedScn));
      usedUidSet = m ? new Set(m.keys()) : new Set();
    }
    const items = modeItems().filter(r => {
      if (usedUidSet && !usedUidSet.has(r.uid)) return false;
      const cat = normFolder(r.category);
      if (AM.folder === NONE ? cat : (AM.folder !== ALL && !inFolder(cat, AM.folder, AM.incSub))) return false;
      if (AM.tag && !(r.tags || []).some(t => t.toLowerCase() === AM.tag.toLowerCase())) return false;
      if (AM.q && !M.matchSearchQuery(r.blob || (r.name + ' ' + cat).toLowerCase(), parsed)) return false;
      return true;
    });
    return sortItems(items);
  }
  function allTagsInMode() {
    const set = new Map();
    modeItems().forEach(r => (r.tags || []).forEach(t => { const l = t.toLowerCase(); if (!set.has(l)) set.set(l, t); }));
    return [...set.values()].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  }

  function leftHtml() {
    const items = modeItems(), fl = modeFolders();
    const own = new Map();
    items.forEach(r => { const c = normFolder(r.category) || NONE; own.set(c, (own.get(c) || 0) + 1); });
    const tree = buildFolderTree(fl);
    const totalOf = new Map();
    const calc = n => { let t = own.get(n.path) || 0; n.children.forEach(ch => { t += calc(ch); }); totalOf.set(n.path, t); return t; };
    tree.roots.forEach(calc);
    const cnt = f => f === ALL ? items.length : f === NONE ? (own.get(NONE) || 0) : (totalOf.get(f) || 0);
    const row = (f, label, ico, sortable, node, depth) => {
      const hasKids = !!(node && node.children.length), collapsed = hasKids && AM.collapsed.has(f);
      const caret = sortable ? (hasKids ? `<span class="ccf-am-caret" data-amf-tg="${esc(f)}" title="${collapsed ? '展開' : '折りたたむ'}">${collapsed ? '▸' : '▾'}</span>` : '<span class="ccf-am-caret ph"></span>') : '';
      return `<div class="ccf-am-f${AM.folder === f ? ' on' : ''}" data-amf="${esc(f)}"${sortable ? ' draggable="true"' : ''}${depth ? ` style="padding-left:${8 + depth * 14}px"` : ''} title="${esc(f === ALL || f === NONE ? label : f)}${sortable ? '（上下ドラッグまたは▲▼で並び替え／素材ドロップで移動／右クリックで操作）' : '（ここへ素材をドラッグで移動）'}">
      <span class="ccf-am-fname">${caret}${ico} ${esc(label)}</span>
      <span class="ccf-am-fright">${sortable ? `<span class="ccf-am-fbtns"><button type="button" class="ccf-am-fbtn ccf-am-fadd" data-amf-add="${esc(f)}" title="この中に小フォルダを追加">＋</button><button type="button" class="ccf-am-fbtn" data-amf-mv="up" data-folder="${esc(f)}" title="上へ移動">▲</button><button type="button" class="ccf-am-fbtn" data-amf-mv="down" data-folder="${esc(f)}" title="下へ移動">▼</button></span>` : ''}<small>${cnt(f)}</small></span>
    </div>`;
    };
    const walk = (list, depth) => list.map(n => row(n.path, baseOf(n.path), depth ? '📁' : '📁', true, n, depth) + (AM.collapsed.has(n.path) ? '' : walk(n.children, depth + 1))).join('');
    return row(ALL, 'すべて', '🗂️', false) + row(NONE, '（未分類）', '📂', false) + walk(tree.roots, 0);
  }
  // 階層インデント付きのフォルダ選択肢（移動先 / 親フォルダ選択用）
  function folderOptionsHtml(paths, selected, exclude) {
    const flat = buildFolderTree(paths).flat.filter(p => !exclude || !(p === exclude || p.startsWith(exclude + '/')));
    return flat.map(f => `<option value="${esc(f)}"${f === selected ? ' selected' : ''}>${esc(folderIndentLabel(f))}</option>`).join('');
  }
  // 並び順（DOM上の表示順）：フォルダ別表示のときはグループ順に並べ替えた全件リスト
  function displayList(list) {
    if (AM.folder === ALL && AM.viewMode === 'folder' && list.length) {
      const { groups, keys } = groupByFolder(list);
      return keys.reduce((acc, k) => acc.concat(groups.get(k) || []), []);
    }
    return list;
  }
  function cardHtml(r) {
    const missing = !!r.missing;
    const src = r.dataUrl || (r.path && !missing ? fileUrl(r.path) : '');
    const pv = r.type === 'image' && src ? assetImgTag(src, '', 'loading="lazy" decoding="async" alt="" draggable="false"') : `<div class="ccf-am-ico">${icon(r)}</div>`;
    const isSel = AM.sel.has(r.uid);
    const playKey = r.path || src;
    const isPlaying = !!(r.type === 'audio' && playKey && CCF.library && CCF.library.isPlaying && CCF.library.isPlaying(playKey));
    const playBtn = (r.type === 'audio' && playKey) ? `<button type="button" class="ccf-am-act${isPlaying ? ' is-playing' : ''}" data-amact="play" data-path="${esc(playKey)}" title="試聴">${isPlaying ? '■ 停止' : '▶ 試聴'}</button>` : '';
    const mvBtns = `<button type="button" class="ccf-am-act ccf-am-mv" data-amact="mv-prev" data-uid="${esc(r.uid)}" title="1つ前へ移動">◀</button><button type="button" class="ccf-am-act ccf-am-mv" data-amact="mv-next" data-uid="${esc(r.uid)}" title="1つ後ろへ移動">▶</button>`;
    return `<div class="ccf-am-card${isSel ? ' sel' : ''}${AM.prev === r.uid ? ' prev' : ''}${missing ? ' missing' : ''}" draggable="true" data-amid="${esc(r.uid)}" title="${esc(r.path || r.name)}${missing ? '（ファイルが見つかりません）' : ''}">
      <input type="checkbox" class="ccf-am-chk" data-amchk="${esc(r.uid)}" aria-label="選択"${isSel ? ' checked' : ''}>
      <button type="button" class="ccf-am-edit" data-amact="edit" data-uid="${esc(r.uid)}" title="詳細・編集（ダブルクリックでも開けます）">✏️</button>
      ${pv}
      <div class="ccf-am-nm">${esc(r.name)}${missing ? ' ⚠️' : ''}</div>
      <div class="ccf-am-fdrow">
        <div class="ccf-am-fd">📁 ${esc(folderLabel(r.category))}</div>
        <div class="ccf-am-acts">${playBtn}${mvBtns}</div>
      </div>
      <div class="ccf-am-tags">${tagBadges(r.path, r.customTags, true)}${usageBadge(r)}</div>
    </div>`;
  }
  function previewHtml() {
    const r = modeItems().find(x => x.uid === AM.prev);
    if (!r) return '<span class="ccf-muted">素材をクリックするとプレビュー／カード端ドラッグで並べ替え・フォルダへ移動</span>';
    if (r.missing) return '<span class="ccf-muted">⚠️ ファイルが見つかりません：' + esc(r.path) + '</span>';
    const src = r.dataUrl || (r.path ? fileUrl(r.path) : '');
    if (r.type === 'image' && src) return `${assetImgTag(src, '', 'alt=""')}<span class="ccf-muted">${esc(r.name)}</span>${usageBadge(r)}`;
    if (r.type === 'audio' && src) return `<audio controls src="${esc(src)}"></audio><span>${esc(r.name)} ${tagBadges(r.path, r.customTags)}${usageBadge(r)}</span>`;
    return `<span>${icon(r)} ${esc(r.name)}</span><span class="ccf-muted">${esc(r.path || 'シナリオ内蔵データ（クラウドメタ情報）')}</span>${usageBadge(r)}`;
  }
  function drawGrid() {
    if (!AM.el) return;
    const list = visible(), g = AM.el.querySelector('.ccf-am-grid'); if (!g) return;
    const isGrouped = AM.folder === ALL && AM.viewMode === 'folder';
    mountGridView(g, list, cardHtml, {
      isGrouped,
      openSet: AM.openGroups,
      isFiltering: !!(AM.q.trim() || AM.tag || (AM.mode === 'common' && AM.usedScn)),
      emptyHtml: '<div class="ccf-empty">表示できる素材がありません。ファイルをここへドラッグ＆ドロップするか、条件を変更してください。</div>'
    });
    syncAmBar(list);
    const pv = AM.el.querySelector('.ccf-am-prev'); if (pv) pv.innerHTML = previewHtml();
    void fillCloudAssetsIn(AM.el);
  }
  // 選択状態に連動するボタン・全選択チェックの更新（カードは再描画しない）
  function syncAmBar(list) {
    if (!AM.el) return;
    list = list || visible();
    const visSelected = list.filter(r => AM.sel.has(r.uid)).length;
    const del = AM.el.querySelector('[data-am="bulkdel"]');
    if (del) { del.disabled = !AM.sel.size; del.textContent = AM.mode === 'common' ? `🗑 共通アセット削除（${AM.sel.size}）` : `🗑 選択を削除（${AM.sel.size}）`; }
    const mv = AM.el.querySelector('[data-am="move"]'); if (mv) mv.disabled = !AM.sel.size;
    const cp = AM.el.querySelector('[data-am="copytosc"]'); if (cp) cp.disabled = !AM.sel.size;
    const sl = AM.el.querySelector('[data-am="sendlib"]'); if (sl) sl.disabled = !AM.sel.size;
    const mvgrp = AM.el.querySelector('.ccf-am-mvgrp'); if (mvgrp) mvgrp.hidden = !AM.sel.size;
    const all = AM.el.querySelector('[data-am="selall"]'); if (all) all.checked = !!list.length && visSelected === list.length;
  }
  // 選択変更をカードのDOMへ反映（再描画なし）
  function syncAmSelectionDom() {
    if (!AM.el) return;
    AM.el.querySelectorAll('.ccf-am-card[data-amid]').forEach(c => {
      const id = c.dataset.amid, on = AM.sel.has(id);
      c.classList.toggle('sel', on); c.classList.toggle('prev', AM.prev === id);
      const cb = c.querySelector('.ccf-am-chk'); if (cb) cb.checked = on;
    });
    syncAmBar();
    const pv = AM.el.querySelector('.ccf-am-prev'); if (pv) pv.innerHTML = previewHtml();
  }
  // カード本体クリックの選択処理：通常=単一選択 / Ctrl・Cmd=個別トグル / Shift=アンカーからの範囲（Ctrl+Shift=範囲を追加）
  function amCardClick(uid, e) {
    const ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey;
    if (shift && AM.anchor) {
      const order = displayList(visible()).map(r => r.uid);
      const a = order.indexOf(AM.anchor), b = order.indexOf(uid);
      if (a >= 0 && b >= 0) {
        if (!ctrl) AM.sel.clear();
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) AM.sel.add(order[i]);
        AM.prev = uid;
        return syncAmSelectionDom();
      }
    }
    if (ctrl) { if (AM.sel.has(uid)) AM.sel.delete(uid); else AM.sel.add(uid); }
    else { AM.sel.clear(); AM.sel.add(uid); }
    AM.anchor = uid; AM.prev = uid;
    syncAmSelectionDom();
  }
  function openAmDetail(uid) {
    AM.prev = uid; syncAmSelectionDom();
    if (typeof window.openGalleryDetailModal === 'function') {
      window.openGalleryDetailModal({ scope: AM.mode, uid, items: displayList(visible()), scenarioId: AM.key, onUpdate: () => draw(), onDelete: () => draw() });
    }
  }
  function draw() {
    if (!AM.el) return;
    const sc = CCF.scenarioList().find(x => String(x.id) === AM.key), fl = modeFolders();
    if (AM.folder !== ALL && AM.folder !== NONE && !buildFolderTree(fl).nodes.has(AM.folder)) AM.folder = ALL;
    const live = new Set(modeItems().map(r => r.uid)); [...AM.sel].forEach(i => { if (!live.has(i)) AM.sel.delete(i); });
    const keep = AM.el.querySelector('.ccf-am-grid'), top = keep ? keep.scrollTop : 0, qv = AM.el.querySelector('.ccf-am-q'), hadFocus = qv && document.activeElement === qv;
    const tags = allTagsInMode();
    const isScn = AM.mode === 'scenario';
    const usedScns = !isScn ? scenariosUsingCommonAssets() : [];
    if (!isScn && AM.usedScn && !usedScns.some(s => s.id === String(AM.usedScn))) AM.usedScn = '';
    const usedScnSelectHtml = !isScn
      ? `<select class="ccf-am-scn" aria-label="使用シナリオ絞り込み"><option value="">📚 使用シナリオ：すべて</option>${usedScns.map(s => `<option value="${esc(s.id)}"${String(AM.usedScn) === s.id ? ' selected' : ''}>${esc(s.title)}（${s.count}件）</option>`).join('')}</select>`
      : '';
    AM.el.querySelector('.ccf-am-modal').innerHTML = `
      <div class="ccf-am-head">
        <div class="ccf-am-mtabs">
          <button type="button" class="ccf-am-mtab${isScn ? ' on' : ''}" data-am="mode:scenario">📌 このシナリオの素材（${getUnifiedItems(AM.key).length}）</button>
          <button type="button" class="ccf-am-mtab${!isScn ? ' on' : ''}" data-am="mode:common">🌍 マイライブラリ / 共通（${window.CommonAssets ? window.CommonAssets.getAll().length : 0}）</button>
        </div>
        <span class="ccf-muted">${isScn ? esc(sc ? sc.title || '無題' : 'シナリオ未選択') : 'フォルダ監視と共通ギャラリーがリアルタイム同期'}</span>
        <span class="ccf-spacer"></span>
        ${isScn ? '<button type="button" class="ccf-btn" data-am="websync" title="登録素材画像を軽量WebP化してFirebaseへ同期（別PC・file://閲覧用）">☁️ このシナリオの登録素材画像をWeb同期（別PC・file://閲覧用）</button>' : '<button type="button" class="ccf-mini" data-am="sync">🔄 再スキャン</button>'}
        <button type="button" class="ccf-btn" data-am="close">✕ 閉じる</button>
      </div>
      <div class="ccf-am-body">
        <div class="ccf-am-left">
          <div class="ccf-am-bar"><b>📁 フォルダ一覧</b>
            <button type="button" class="ccf-mini" data-am="newf" title="新規フォルダ（親フォルダを指定して小フォルダも作成できます）">＋</button>
            <button type="button" class="ccf-mini" data-am="renf" title="選択中のフォルダ名を変更"${AM.folder === ALL || AM.folder === NONE ? ' disabled' : ''}>✎</button>
            <button type="button" class="ccf-mini" data-am="movf" title="選択中のフォルダを別の親フォルダへ移動"${AM.folder === ALL || AM.folder === NONE ? ' disabled' : ''}>⤴</button>
            <button type="button" class="ccf-mini danger" data-am="delf" title="選択中のフォルダを削除（配下の素材は親フォルダ／未分類へ退避）"${AM.folder === ALL || AM.folder === NONE ? ' disabled' : ''}>🗑</button>
          </div>
          <div class="ccf-am-flist">${leftHtml()}</div>
        </div>
        <div class="ccf-am-right">
          <div class="ccf-am-bar">
            <label class="ccf-chk-label ccf-am-all"><input type="checkbox" data-am="selall"> <span>全選択</span></label>
            ${(AM.folder !== ALL && AM.folder !== NONE) ? `<label class="ccf-chk-label ccf-am-incsub" title="OFFにするとこのフォルダ直下の素材だけを表示します"><input type="checkbox" data-am="incsub"${AM.incSub ? ' checked' : ''}> <span>☑ サブフォルダも含めて表示</span></label>` : ''}
            <input type="search" class="ccf-am-q" placeholder="🔍 検索（スペース区切り / -除外語）" value="${esc(AM.q)}">
            ${usedScnSelectHtml}
            <select class="ccf-am-tag" aria-label="タグ絞り込み"><option value="">🏷 すべてのタグ（${tags.length}）</option>${tags.map(t => `<option value="${esc(t)}"${t === AM.tag ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
            <select class="ccf-am-sort" aria-label="並び順">
              <option value="manual"${AM.sort === 'manual' ? ' selected' : ''}>↕ カスタム順（D&amp;D）</option>
              <option value="name"${AM.sort === 'name' ? ' selected' : ''}>🔤 名前順（自然順）</option>
              <option value="character"${AM.sort === 'character' ? ' selected' : ''}>👤 キャラ・名前まとまり順（先頭番号を除く）</option>
              <option value="added"${AM.sort === 'added' ? ' selected' : ''}>🕒 登録順</option>
            </select>
            <button type="button" class="ccf-mini" data-am="saveorder" title="現在の並び順をカスタム順として保存">📌 今の並びをカスタム順に保存</button>
            <span class="ccf-am-mvgrp"${AM.sel.size ? '' : ' hidden'}>
              <button type="button" class="ccf-mini" data-am="mv-first" title="選択中を先頭へ移動">⏫ 先頭へ移動</button>
              <button type="button" class="ccf-mini" data-am="mv-prev" title="選択中を1つ前へ">◀ 前へ</button>
              <button type="button" class="ccf-mini" data-am="mv-next" title="選択中を1つ後ろへ">▶ 次へ</button>
              <button type="button" class="ccf-mini" data-am="mv-last" title="選択中を末尾へ移動">⏬ 末尾へ移動</button>
            </span>
            ${AM.folder === ALL ? `<div class="ccf-view-toggle" role="group" aria-label="表示切替">
              <button type="button" class="ccf-mini${AM.viewMode === 'folder' ? ' active' : ''}" data-am="view:folder">📁 フォルダ別表示</button>
              <button type="button" class="ccf-mini${AM.viewMode === 'list' ? ' active' : ''}" data-am="view:list">🖼️ フラット一覧</button>
            </div>` : ''}
            <select class="ccf-am-dest" aria-label="移動先フォルダ"><option value="${NONE}">（未分類）</option>${folderOptionsHtml(fl, '')}</select>
            <button type="button" class="ccf-btn" data-am="move" disabled>➡ 移動</button>
            ${isScn
              ? `<button type="button" class="ccf-btn" data-am="sendlib" disabled title="選択中の素材をマイライブラリ（共通）へコピー／移動します。中身が同一の画像（SHA-256一致）は自動で既存素材に統合されます">🌐 マイライブラリへ送る</button>
                 <button type="button" class="ccf-btn" data-am="addfile" title="PCからファイルを選択して追加">＋ 追加</button>`
              : `<button type="button" class="ccf-btn" data-am="copytosc" disabled>📌 選択中をシナリオへコピー登録</button>`}
            <button type="button" class="ccf-btn" data-am="mergedup" title="名前が違っても中身が完全に同じ画像（SHA-256一致）を1件に統合します">🧹 同一画像を統合</button>
            <button type="button" class="ccf-mini danger" data-am="bulkdel" disabled>🗑 選択を削除（0）</button>
          </div>
          <div class="ccf-am-grid"></div>
          <div class="ccf-am-prev"></div>
        </div>
      </div>`;
    drawGrid(); const g = AM.el.querySelector('.ccf-am-grid'); if (g) g.scrollTop = top;
    if (hadFocus) { const q = AM.el.querySelector('.ccf-am-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  }

  function moveIds(uids, folder) {
    let targetKey = AM.key || CCF.S.key;
    if (arguments.length >= 3) { targetKey = arguments[0]; uids = arguments[1]; folder = arguments[2]; }
    uids = toArr(uids).filter(Boolean);
    if (!uids.length) return;
    folder = normFolder(folder);
    const idSet = new Set(uids);
    if (AM.mode === 'common') {
      AM.sel.clear();
      if (window.CommonAssets && window.CommonAssets.moveItems(uids, folder)) {
        if (folder) AM.keptFolders.add(folder);
        say('📁 ' + uids.length + '件を「' + folderLabel(folder) + '」へ移動しました');
        draw();
      }
      return;
    }
    targetKey = keyOr(targetKey);
    const sc = scenarioOf(targetKey);
    getUnifiedItems(targetKey).forEach(it => {
      if (idSet.has(it.uid)) {
        if (it.category) AM.keptFolders.add(it.category);
        if (Array.isArray(it.mergedUids)) it.mergedUids.forEach(mu => idSet.add(mu));
      }
    });
    if (folder) AM.keptFolders.add(folder);
    AM.sel.clear();
    mutate(targetKey, p => {
      let n = 0;
      (p.refs || []).forEach(r => { if (idSet.has('ref:' + r.id) && normFolder(r.category) !== folder) { r.category = folder; n++; } });
      if (sc && Array.isArray(sc.images)) sc.images.forEach(a => { if (idSet.has('img:' + a.id) && normFolder(a.category) !== folder) { a.category = folder; n++; } });
      if (sc && Array.isArray(sc.docs)) sc.docs.forEach(d => { if (idSet.has('doc:' + d.id) && normFolder(d.category) !== folder) { d.category = folder; n++; } });
      if (folder && !p.folders.includes(folder)) p.folders.push(folder);
      if (sc && folder && Array.isArray(sc.imageCategories) && !sc.imageCategories.includes(folder)) sc.imageCategories.push(folder);
      return n;
    }, '素材のフォルダ移動');
    say('📁 ' + uids.length + '件を「' + folderLabel(folder) + '」へ移動しました');
  }

  function saveAssetOrder(key, orderedUids, mode) {
    const m = mode || AM.mode;
    const list = toArr(orderedUids).filter(Boolean);
    if (m === 'common') {
      if (window.CommonAssets && window.CommonAssets.setOrder) window.CommonAssets.setOrder(list);
      return;
    }
    const targetKey = keyOr(key || AM.key);
    const sc = scenarioOf(targetKey);
    mutate(targetKey, p => {
      p.assetOrder = list;
      if (sc) sc.assetOrder = list.slice();
    }, '素材の並べ替え');
  }

  function reorderUid(dragUids, targetUid, insertAfter) {
    dragUids = toArr(dragUids).filter(Boolean);
    if (!dragUids.length || !targetUid || dragUids.includes(targetUid)) return;
    const baseItems = AM.sort !== 'manual' ? sortItems(modeItems()) : modeItems();
    const list = baseItems.map(x => x.uid);
    const moveSet = new Set(dragUids), rest = list.filter(u => !moveSet.has(u)), moving = list.filter(u => moveSet.has(u));
    const idx = rest.indexOf(targetUid);
    if (idx < 0 || !moving.length) return;
    rest.splice(insertAfter ? idx + 1 : idx, 0, ...moving);
    AM.sort = 'manual';
    saveAssetOrder(AM.key, rest, AM.mode);
    if (AM.mode === 'common') draw();
  }

  function moveOrderRelative(targetUids, dir) {
    const uids = toArr(targetUids).filter(Boolean);
    if (!uids.length) return;
    const vis = visible().map(x => x.uid);
    if (vis.length < 2) return;
    const moveSet = new Set(uids);
    const indices = [];
    vis.forEach((u, i) => { if (moveSet.has(u)) indices.push(i); });
    if (!indices.length) return;
    let anchorUid = '', insertAfter = false;
    if (dir === 'first') {
      anchorUid = vis.find(u => !moveSet.has(u)) || '';
      insertAfter = false;
    } else if (dir === 'last') {
      for (let i = vis.length - 1; i >= 0; i--) { if (!moveSet.has(vis[i])) { anchorUid = vis[i]; break; } }
      insertAfter = true;
    } else if (dir === 'prev') {
      const firstIdx = indices[0];
      if (firstIdx <= 0) return;
      anchorUid = vis[firstIdx - 1];
      insertAfter = false;
    } else if (dir === 'next') {
      const lastIdx = indices[indices.length - 1];
      if (lastIdx >= vis.length - 1) return;
      anchorUid = vis[lastIdx + 1];
      insertAfter = true;
    }
    if (!anchorUid) return;
    reorderUid(uids, anchorUid, insertAfter);
  }

  function saveCurrentSortAsCustom() {
    const ordered = sortItems(modeItems()).map(x => x.uid);
    AM.sort = 'manual';
    saveAssetOrder(AM.key, ordered, AM.mode);
    if (AM.mode === 'common') draw();
    say('📌 現在の並び順をカスタム順として保存しました');
  }

  function saveFolderOrder(nextFolders) {
    const clean = [...new Set((nextFolders || []).map(normFolder).filter(Boolean))];
    if (AM.mode === 'common') {
      if (typeof appState !== 'undefined') {
        checkpoint('共通フォルダの並び替え');
        appState.commonCats = clean;
        if (typeof saveState === 'function') saveState();
        try { if (typeof renderGalleryAll === 'function') renderGalleryAll(); } catch (_) { }
        draw();
      }
      return;
    }
    const sc = scenarioOf(AM.key);
    mutate(AM.key, p => {
      p.folders = clean.slice();
      if (sc) sc.imageCategories = clean.slice();
    }, 'フォルダの並び替え');
  }

  // 並び替えは同じ親フォルダ内の兄弟どうしでのみ行う（小フォルダは親のブロックごと移動）
  function reorderFolder(dragFolder, targetFolder, insertAfter) {
    if (!dragFolder || !targetFolder || dragFolder === targetFolder) return;
    if (parentOf(dragFolder) !== parentOf(targetFolder)) return;
    const flat = buildFolderTree(modeFolders()).flat;
    if (!flat.includes(dragFolder) || !flat.includes(targetFolder)) return;
    const block = p => flat.filter(x => x === p || x.startsWith(p + '/'));
    const dBlock = block(dragFolder), dSet = new Set(dBlock);
    const rest = flat.filter(x => !dSet.has(x));
    const tBlock = block(targetFolder);
    const idx = insertAfter ? rest.indexOf(tBlock[tBlock.length - 1]) + 1 : rest.indexOf(tBlock[0]);
    if (idx < 0 || (insertAfter && idx === 0)) return;
    rest.splice(idx, 0, ...dBlock);
    saveFolderOrder(rest);
  }

  function moveFolderStep(folder, delta) {
    const tree = buildFolderTree(modeFolders());
    const node = tree.nodes.get(folder); if (!node) return;
    const par = parentOf(folder), sibs = (par && tree.nodes.get(par) ? tree.nodes.get(par).children : tree.roots).map(n => n.path);
    const i = sibs.indexOf(folder), j = i + delta;
    if (i < 0 || j < 0 || j >= sibs.length) return;
    reorderFolder(folder, sibs[j], delta > 0);
  }

  // ---- 階層フォルダ操作（作成・名前変更・親フォルダ移動・削除）----
  // fn: 正規化済みフォルダパス → 新パス。モード（共通/シナリオ）を問わずカテゴリ・フォルダ一覧・素材をまとめて付け替える
  function remapFoldersFor(mode, key, fn, label) {
    if (mode === 'common') { if (window.CommonAssets) window.CommonAssets.remapFolders(fn, label); return; }
    const k = String(keyOr(key) || ''), sc = scenarioOf(k);
    const mapC = c => { const o = normFolder(c); return o ? normFolder(fn(o)) : o; };
    const dedupe = a => [...new Set((a || []).map(mapC).filter(Boolean))];
    const fix = x => { if (!x || !x.category) return; const o = normFolder(x.category), n = mapC(o); if (n !== o) x.category = n; };
    mutate(k, p => {
      p.folders = dedupe(p.folders);
      (p.refs || []).forEach(fix);
      if (sc) {
        if (Array.isArray(sc.imageCategories)) sc.imageCategories = dedupe(sc.imageCategories);
        (sc.images || []).forEach(fix);
        (sc.docs || []).forEach(fix);
      }
    }, label || 'フォルダの再編');
  }
  const renamePathFn = (old, nn) => c => (c === old || c.startsWith(old + '/')) ? nn + c.slice(old.length) : c;
  const deletePathFn = old => { const par = parentOf(old); return c => c === old ? par : (c.startsWith(old + '/') ? (par ? par + '/' : '') + c.slice(old.length + 1) : c); };
  function createFolderPath(path) {
    AM.keptFolders.add(path);
    if (AM.mode === 'common') { if (typeof appState !== 'undefined') { checkpoint('フォルダ作成'); appState.commonCats = [...new Set([...(appState.commonCats || []), path])]; afterChange(); } }
    else { const sc = scenarioOf(AM.key); mutate(AM.key, p => { if (!p.folders.includes(path)) p.folders.push(path); if (sc && Array.isArray(sc.imageCategories) && !sc.imageCategories.includes(path)) sc.imageCategories.push(path); }, 'フォルダ作成'); }
  }
  // 名前入力＋親フォルダ選択ダイアログ（opts: title, name(null=名前欄なし), parent, parents[], exclude, okText）
  function folderDialog(opts) {
    return new Promise(res => {
      const o = opts || {};
      const ov = document.createElement('div'); ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      ov.innerHTML = `<div class="app-dialog"><div class="app-dialog-title">${esc(o.title || 'フォルダ')}</div>
        ${o.name !== null && o.name !== undefined ? `<label class="ccf-am-dlg-lbl">フォルダ名</label><input type="text" class="ccf-am-input" data-fd="name" value="${esc(o.name || '')}" style="width:100%">` : ''}
        ${o.parents ? `<label class="ccf-am-dlg-lbl">親フォルダ</label><select data-fd="parent" style="width:100%"><option value="">（なし：トップ階層）</option>${folderOptionsHtml(o.parents, o.parent || '', o.exclude)}</select>` : ''}
        <div class="app-dialog-actions"><button type="button" class="app-dialog-btn" data-x="0">キャンセル</button><button type="button" class="app-dialog-btn primary" data-x="1">${esc(o.okText || 'OK')}</button></div></div>`;
      document.body.appendChild(ov);
      const nameEl = ov.querySelector('[data-fd="name"]'), parEl = ov.querySelector('[data-fd="parent"]');
      (nameEl || parEl).focus(); if (nameEl) nameEl.select();
      const done = v => { ov.remove(); res(v); };
      const ok = () => done({ name: nameEl ? nameEl.value.trim() : '', parent: parEl ? parEl.value : '' });
      ov.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) b.dataset.x === '1' ? ok() : done(null); });
      ov.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); ok(); } else if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    });
  }
  async function folderCreateFlow(parentPath) {
    const parents = buildFolderTree(modeFolders()).flat;
    const r = await folderDialog({ title: parentPath ? `「${parentPath}」に小フォルダを作成` : '新規フォルダ', name: '', parent: parentPath || '', parents, okText: '作成' });
    if (!r || !r.name) return;
    const path = joinPath(r.parent, r.name);
    if (!path) return;
    if (buildFolderTree(modeFolders()).nodes.has(path) && modeFolders().includes(path)) return say('同じ名前のフォルダが既にあります');
    if (r.parent) AM.collapsed.delete(r.parent);
    createFolderPath(path);
    AM.folder = path; draw();
  }
  function remapAmFolderSets(fn) {
    const nextKept = new Set(), nextCol = new Set();
    AM.keptFolders.forEach(k => { const m = normFolder(fn(normFolder(k))); if (m) nextKept.add(m); });
    AM.collapsed.forEach(k => { const m = normFolder(fn(normFolder(k))); if (m) nextCol.add(m); });
    AM.keptFolders = nextKept; AM.collapsed = nextCol;
  }
  function moveFolderToParent(old, newParent) {
    if (!old || old === ALL || old === NONE) return false;
    const par = normFolder(newParent);
    if (par === old || par.startsWith(old + '/')) return false;
    const nn = joinPath(par, baseOf(old));
    if (!nn || nn === old) return false;
    if (modeFolders().includes(nn)) { say('移動先に同じ名前のフォルダが既にあります'); return false; }
    const fn = renamePathFn(old, nn);
    remapAmFolderSets(fn);
    AM.keptFolders.add(nn);
    if (par) AM.collapsed.delete(par);
    remapFoldersFor(AM.mode, AM.key, fn, 'フォルダを別の親へ移動');
    if (AM.folder === old || AM.folder.startsWith(old + '/')) AM.folder = nn + AM.folder.slice(old.length);
    draw();
    return true;
  }
  async function folderRenameFlow(old) {
    if (!old || old === ALL || old === NONE) return;
    const r = await folderDialog({ title: 'フォルダ名を変更', name: baseOf(old), okText: '変更' });
    if (!r || !r.name) return;
    const nn = joinPath(parentOf(old), r.name);
    if (!nn || nn === old) return;
    if (modeFolders().includes(nn)) return say('同じ名前のフォルダが既にあります');
    const fn = renamePathFn(old, nn);
    remapAmFolderSets(fn); AM.keptFolders.add(nn);
    remapFoldersFor(AM.mode, AM.key, fn, 'フォルダ名変更');
    if (AM.folder === old || AM.folder.startsWith(old + '/')) AM.folder = nn + AM.folder.slice(old.length);
    draw();
  }
  async function folderMoveParentFlow(old) {
    if (!old || old === ALL || old === NONE) return;
    const parents = buildFolderTree(modeFolders()).flat;
    const r = await folderDialog({ title: `「${old}」を別の親フォルダへ移動`, name: null, parent: parentOf(old), parents, exclude: old, okText: '移動' });
    if (!r) return;
    moveFolderToParent(old, r.parent);
  }
  async function folderDeleteFlow(old) {
    if (!old || old === ALL || old === NONE) return;
    const par = parentOf(old);
    const c = modeItems().filter(r => normFolder(r.category) === old).length;
    const sub = modeFolders().filter(f => f.startsWith(old + '/')).length;
    if (!(await appConfirm(`フォルダ「${old}」を削除しますか？` + (c ? `\n中の素材 ${c}件は「${par ? par : '（未分類）'}」へ移ります（ファイルは消えません）。` : '') + (sub ? `\n配下の小フォルダ ${sub}件は「${par ? par : 'トップ階層'}」の直下へ繰り上がります。` : ''), { okText: '削除', danger: true }))) return;
    const fn = deletePathFn(old);
    remapAmFolderSets(fn);
    remapFoldersFor(AM.mode, AM.key, fn, 'フォルダ削除');
    AM.folder = (AM.folder === old || AM.folder.startsWith(old + '/')) ? (par || ALL) : AM.folder;
    draw();
  }
  // フォルダの右クリックメニュー
  function closeAmCtx() { const m = AM.el && AM.el.querySelector('.ccf-am-ctx'); if (m) m.remove(); }
  function openAmCtx(folder, x, y) {
    closeAmCtx();
    const m = document.createElement('div'); m.className = 'ccf-am-ctx'; m.dataset.folder = folder;
    m.innerHTML = `<button type="button" data-amctx="sub">📁＋ 小フォルダを作成</button><button type="button" data-amctx="ren">✎ 名前変更</button><button type="button" data-amctx="mov">⤴ 別の親フォルダへ移動</button><button type="button" data-amctx="del" class="danger">🗑 削除</button>`;
    m.style.left = Math.min(x, window.innerWidth - 220) + 'px'; m.style.top = Math.min(y, window.innerHeight - 170) + 'px';
    AM.el.appendChild(m);
  }

  async function renameItem(uid) {
    const it = modeItems().find(x => x.uid === uid); if (!it) return;
    const nn = await askName('表示名を変更（元のPCファイル名は変更されません）', it.name);
    if (!nn || nn === it.name) return;
    if (AM.mode === 'common') { if (window.CommonAssets) { window.CommonAssets.renameItem(uid, nn); draw(); } return; }
    mutate(AM.key, p => {
      if (it.srcType === 'ref') { const r = (p.refs || []).find(x => x.id === it.rawId); if (r) { if (!r.origName) r.origName = r.name; r.name = nn; } }
      else if (it.srcType === 'img' || it.srcType === 'doc') { if (it.raw) { if (!it.raw.origName) it.raw.origName = it.raw.name; it.raw.name = nn; } }
    }, '素材の名前変更');
  }

  async function editTags(uid) {
    const it = modeItems().find(x => x.uid === uid); if (!it) return;
    const cur = (it.customTags || []).join(', ');
    const ans = await askName('カスタムタグ（カンマ / スペース区切り）', cur);
    if (ans === null) return;
    const next = M.cleanTagList(ans.split(/[\s,、，;]+/));
    if (AM.mode === 'common') { if (window.CommonAssets) { window.CommonAssets.setTags(uid, next); draw(); } return; }
    mutate(AM.key, p => {
      if (it.srcType === 'ref') { const r = (p.refs || []).find(x => x.id === it.rawId); if (r) r.tags = next; }
      else if (it.raw) it.raw.tags = next;
    }, '素材のタグ変更');
  }

  function removeScenarioItems(key, uids) {
    if (Array.isArray(key) || key instanceof Set || (key && typeof key[Symbol.iterator] === 'function' && typeof key !== 'string')) {
      uids = key;
      key = CCF.S.key;
    } else if (uids === undefined && typeof key === 'string' && /^(?:img|ref|doc|cimg|lib|cat):/.test(key)) {
      uids = [key];
      key = CCF.S.key;
    }
    const uidList = toArr(uids).filter(Boolean);
    if (!uidList.length) return 0;
    key = keyOr(key);
    const ids = new Set(uidList);
    const delPaths = new Set();
    const delDocNames = new Set();
    const recordDocTarget = (obj, tpHint) => {
      if (!obj) return;
      const fp = obj.path || obj.ref || '';
      const nm = obj.origName || obj.name || (fp ? baseName(fp) : '');
      const tp = tpHint || obj.type || inferType(fp || nm);
      if (!isDocEntry(nm, tp, fp)) return;
      if (fp) delPaths.add(norm(fp));
      const dk = docFileKey(obj, tp === 'pdf' || /\.pdf$/i.test(nm || fp) ? 'pdf' : 'doc');
      if (dk) delDocNames.add(dk);
      if (fp) {
        const bn = baseName(fp).normalize('NFKC').trim().toLowerCase();
        if (bn && DOC.test(bn)) delDocNames.add(bn);
      }
    };
    getUnifiedItems(key).forEach(it => {
      if (ids.has(it.uid)) {
        if (Array.isArray(it.mergedUids)) it.mergedUids.forEach(mu => ids.add(mu));
        recordDocTarget(it, it.type);
      }
    });
    const sc = scenarioOf(key);
    if (sc) {
      (sc.docs || []).forEach(d => { if (d && ids.has('doc:' + d.id)) recordDocTarget(d, d.ext === 'pdf' ? 'pdf' : 'doc'); });
      (sc.assetCatalog || []).forEach((c, ci) => {
        if (!c) return;
        const cid = c.id || ('cat:' + ci + '_' + c.name);
        if (ids.has(cid) || (c.id && ids.has(c.id))) recordDocTarget(c, c.type || inferType(c.name));
      });
      if (Array.isArray(sc.ccfRooms)) {
        sc.ccfRooms.forEach(rm => {
          ((rm && rm.project && rm.project.refs) || []).forEach(r => {
            if (r && ids.has('ref:' + r.id)) recordDocTarget(r, r.type);
          });
        });
      }
    }
    const curProj = projOf(key);
    ((curProj && curProj.refs) || []).forEach(r => {
      if (r && ids.has('ref:' + r.id)) recordDocTarget(r, r.type);
    });
    const matchDocRef = r => {
      if (!r) return false;
      if (ids.has('ref:' + r.id)) return true;
      const tp = r.type || inferType(r.path || r.origName || r.name);
      if (!isDocEntry(r.origName || r.name || r.path, tp, r.path)) return false;
      if (r.path && delPaths.has(norm(r.path))) return true;
      return delDocNames.has(docFileKey(r, tp));
    };
    const matchDocEntry = d => {
      if (!d) return false;
      if (ids.has('doc:' + d.id)) return true;
      const fp = d.path || d.ref || '';
      if (fp && delPaths.has(norm(fp))) return true;
      return delDocNames.has(docFileKey(d, d.ext === 'pdf' ? 'pdf' : 'doc'));
    };
    const matchCatalogEntry = (c, ci) => {
      if (!c) return false;
      const cid = c.id || ('cat:' + ci + '_' + c.name);
      if (ids.has(cid) || (c.id && ids.has(c.id))) return true;
      const tp = c.type || inferType(c.name);
      if (!isDocEntry(c.origName || c.name, tp, '')) return false;
      return delDocNames.has(docFileKey(c, tp));
    };
    let removed = 0;
    mutate(key, p => {
      let roomBefore = 0, roomAfter = 0;
      const before = (p.refs || []).length
        + (sc && Array.isArray(sc.images) ? sc.images.length : 0)
        + (sc && Array.isArray(sc.docs) ? sc.docs.length : 0)
        + (sc && Array.isArray(sc.assetCatalog) ? sc.assetCatalog.length : 0);
      p.refs = (p.refs || []).filter(r => !matchDocRef(r));
      p.assetOrder = (p.assetOrder || []).filter(u => !ids.has(u));
      if (sc && Array.isArray(sc.ccfRooms)) {
        sc.ccfRooms.forEach(rm => {
          const rp = rm && rm.project;
          if (!rp || !Array.isArray(rp.refs)) return;
          roomBefore += rp.refs.length;
          rp.refs = rp.refs.filter(r => !matchDocRef(r));
          if (Array.isArray(rp.assetOrder)) rp.assetOrder = rp.assetOrder.filter(u => !ids.has(u));
          roomAfter += rp.refs.length;
        });
      }
      if (sc && Array.isArray(sc.assetOrder)) sc.assetOrder = sc.assetOrder.filter(u => !ids.has(u));
      if (sc && Array.isArray(sc.images)) sc.images = sc.images.filter(a => !ids.has('img:' + a.id));
      if (sc && Array.isArray(sc.docs)) sc.docs = sc.docs.filter(d => !matchDocEntry(d));
      if (sc && Array.isArray(sc.assetCatalog)) sc.assetCatalog = sc.assetCatalog.filter((c, ci) => !matchCatalogEntry(c, ci));
      if (sc && delDocNames.size) {
        const ign = new Set((Array.isArray(sc.ignoredDocNames) ? sc.ignoredDocNames : []).map(x => String(x || '').normalize('NFKC').trim().toLowerCase()).filter(Boolean));
        delDocNames.forEach(n => ign.add(n));
        sc.ignoredDocNames = [...ign];
      }
      const after = (p.refs || []).length
        + (sc && Array.isArray(sc.images) ? sc.images.length : 0)
        + (sc && Array.isArray(sc.docs) ? sc.docs.length : 0)
        + (sc && Array.isArray(sc.assetCatalog) ? sc.assetCatalog.length : 0);
      removed = Math.max(0, (before - after) + (roomBefore - roomAfter));
    }, '登録素材を削除');
    return removed;
  }

  function bulkUpdateTags(key, uids, rawTags, op) {
    if (Array.isArray(key) || key instanceof Set || (key && typeof key[Symbol.iterator] === 'function' && typeof key !== 'string')) {
      op = rawTags; rawTags = uids; uids = key; key = CCF.S.key;
    }
    const tags = M.cleanTagList(Array.isArray(rawTags) ? rawTags : String(rawTags || '').split(/[\s,、，;]+/));
    if (!tags.length) return 0;
    const idList = [...new Set(toArr(uids).filter(Boolean))];
    if (!idList.length) return 0;
    const commonIds = idList.filter(u => u.startsWith('cimg:') || u.startsWith('lib:'));
    const scnIds = new Set(idList.filter(u => !u.startsWith('cimg:') && !u.startsWith('lib:')));
    let changed = 0;
    if (commonIds.length && window.CommonAssets && typeof window.CommonAssets.bulkUpdateTags === 'function') {
      changed += window.CommonAssets.bulkUpdateTags(commonIds, tags, op);
    }
    if (scnIds.size) {
      key = keyOr(key);
      const sc = scenarioOf(key);
      const rmSet = new Set(tags.map(t => t.toLowerCase()));
      mutate(key, p => {
        const applyTo = obj => {
          if (!obj) return;
          const cur = M.cleanTagList(obj.tags);
          const next = op === 'remove'
            ? cur.filter(t => !rmSet.has(t.toLowerCase()))
            : M.cleanTagList([...cur, ...tags]);
          if (next.length !== cur.length || next.some((v, i) => v !== cur[i])) {
            obj.tags = next;
            changed++;
          }
        };
        (p.refs || []).forEach(r => { if (scnIds.has('ref:' + r.id)) applyTo(r); });
        if (sc && Array.isArray(sc.images)) sc.images.forEach(a => { if (scnIds.has('img:' + a.id)) applyTo(a); });
        if (sc && Array.isArray(sc.docs)) sc.docs.forEach(d => { if (scnIds.has('doc:' + d.id)) applyTo(d); });
      }, op === 'remove' ? '素材のタグを一括解除' : '素材にタグを一括追加');
    }
    return changed;
  }

  function copyCommonItemsToScenario(key, uids) {
    if (Array.isArray(key) || key instanceof Set || (key && typeof key[Symbol.iterator] === 'function' && typeof key !== 'string')) {
      uids = key; key = CCF.S.key;
    } else if (uids === undefined && typeof key === 'string' && /^(?:cimg|lib):/.test(key)) {
      uids = [key]; key = CCF.S.key;
    }
    key = String(keyOr(key) || '');
    if (!key || key === '_default') { say('シナリオを先に選んでください'); return 0; }
    const idSet = new Set(toArr(uids).filter(Boolean));
    if (!idSet.size || !window.CommonAssets) return 0;
    const selList = window.CommonAssets.getAll().filter(x => idSet.has(x.uid));
    const paths = [], imgItems = [];
    selList.forEach(x => { if (x.path) paths.push(x.path); else if (x.raw) imgItems.push(x); });
    let n = 0;
    if (paths.length) n += addPaths(key, paths, '');
    if (imgItems.length && typeof copyCommonToScenario === 'function') {
      checkpoint('共通アセットをシナリオへコピー');
      imgItems.forEach(it => { copyCommonToScenario([it.uid], it.category, key); n++; });
    }
    if (n) say(`📌 ${n}件を現在のシナリオへ登録しました`);
    return n;
  }

  async function bulkDelete() {
    if (!AM.sel.size) return;
    const ids = new Set(AM.sel);
    if (AM.mode === 'common') {
      if (!(await appConfirm(`選択中の共通アセットをギャラリーから除外・削除しますか？（監視フォルダ内の元ファイル自体は削除されません）`, { okText: '削除', danger: true }))) return;
      if (window.CommonAssets) window.CommonAssets.removeItems([...ids]);
      AM.sel.clear(); return draw();
    }
    if (!(await appConfirm(`登録素材 ${ids.size}件を登録から外しますか？（PC上のファイルは消えません）`, { okText: '外す', danger: true }))) return;
    AM.sel.clear();
    removeScenarioItems(AM.key, ids);
  }

  // ================= マイライブラリへ送る（コピー / 移動）・同一画像（SHA-256一致）の統合 =================
  function commonFolderList() {
    const set = new Set(((typeof appState !== 'undefined' && Array.isArray(appState.commonCats)) ? appState.commonCats : []).map(normFolder).filter(Boolean));
    (window.CommonAssets ? window.CommonAssets.getAll() : []).forEach(i => { const c = normFolder(i.category); if (c) set.add(c); });
    return [...set];
  }
  // 送り先フォルダ（既存／小フォルダ選択＋その場で新規作成）とコピー／移動の選択ダイアログ
  function sendDialog(count, initCat) {
    return new Promise(res => {
      const flat = buildFolderTree(commonFolderList()).flat, init = normFolder(initCat), exists = !!init && flat.includes(init);
      const ov = document.createElement('div'); ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      ov.innerHTML = `<div class="app-dialog ccf-send-dlg"><div class="app-dialog-title">🌐 マイライブラリへ送る（${count}件）</div>
        <label class="ccf-am-dlg-lbl">① 送り先フォルダ（既存フォルダ／小フォルダから選択）</label>
        <select data-sd="sel" style="width:100%"><option value="">（未分類）</option>${folderOptionsHtml(flat, exists ? init : '')}</select>
        <label class="ccf-am-dlg-lbl">または新規フォルダ名（「親フォルダ/小フォルダ」の形式でも作成できます）</label>
        <input type="text" class="ccf-am-input" data-sd="new" placeholder="例: NPC/主要キャラ" value="${exists ? '' : esc(init)}" style="width:100%">
        <label class="ccf-am-dlg-lbl">② 操作方法</label>
        <div class="ccf-send-modes">
          <label><input type="radio" name="ccfSendMode" value="copy" checked> 📋 コピー（シナリオにも残す）</label>
          <label><input type="radio" name="ccfSendMode" value="move"> ➡️ 移動（シナリオ固有から外して共通化）</label>
        </div>
        <div class="ccf-muted" style="margin-top:6px">※ 名前が違っても中身が同じ画像（SHA-256一致）は、新規登録せず既存のマイライブラリ素材へ自動統合されます。</div>
        <div class="app-dialog-actions"><button type="button" class="app-dialog-btn" data-x="0">キャンセル</button><button type="button" class="app-dialog-btn primary" data-x="1">送る</button></div></div>`;
      document.body.appendChild(ov);
      const selEl = ov.querySelector('[data-sd="sel"]'), newEl = ov.querySelector('[data-sd="new"]');
      const done = v => { ov.remove(); res(v); };
      const ok = () => done({ folder: newEl.value.trim() ? normFolder(newEl.value) : selEl.value, mode: (ov.querySelector('input[name="ccfSendMode"]:checked') || {}).value === 'move' ? 'move' : 'copy' });
      selEl.addEventListener('change', () => { newEl.value = ''; });
      ov.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) b.dataset.x === '1' ? ok() : done(null); });
      ov.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); ok(); } else if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
      selEl.focus();
    });
  }
  async function sendItemsToLibrary(key, items, folder, mode) {
    const CA = window.CommonAssets, sc = scenarioOf(key), from = sc ? { id: sc.id, title: sc.title || '' } : null;
    let added = 0, merged = 0, skipped = 0;
    const okUids = [], map = {}, nonImg = [], nonImgUids = [];
    checkpoint('マイライブラリへ送る');   // 1回だけ記録（以降の内部処理は抑止して Ctrl+Z 1回で戻せるようにする）
    cpSuppress++;
    try {
      for (const it of items) {
        if (it.type === 'image') {
          let du = it.dataUrl || '';
          if (!du && it.path && !it.missing && typeof dataUrlFromPath === 'function') { try { du = await dataUrlFromPath(it.path, it.name); } catch (_) { du = ''; } }
          if (!du) { skipped++; continue; }
          const r = await CA.addImageDedup({ name: it.name, origName: it.origName || it.name, dataUrl: du, category: folder, tags: it.customTags || [], mtime: it.mtime || 0, fromScenario: from });
          if (!r) { skipped++; continue; }
          if (r.merged) merged++; else added++;
          okUids.push(it.uid); map[it.uid] = r.uid;
          if (Array.isArray(it.mergedUids)) it.mergedUids.forEach(mu => { map[mu] = r.uid; okUids.push(mu); });
        } else if (IS_ELECTRON && it.path && !it.missing && !/^(?:cloud-asset:|data:|blob:|https?:)/i.test(it.path) && !(window.WebBridge && WebBridge.isAssetRef(it.path)) && /\.(mp4|webm|mov|m4v|ogv|mp3|wav|ogg|m4a|flac|aac|pdf|zip)$/i.test(String(it.origName || it.name || it.path))) {
          nonImg.push({ name: it.origName || (baseName(it.path) || it.name), path: it.path, category: folder, mtime: it.mtime || 0 }); nonImgUids.push(it.uid);
          if (Array.isArray(it.mergedUids)) nonImgUids.push(...it.mergedUids);
        } else skipped++;
      }
      if (nonImg.length) { const n = await CA.addNonImageFiles(nonImg); added += n; okUids.push(...nonImgUids); }
      CA.flush();
      if (mode === 'move' && Object.keys(map).length) CA.rewireAssetRefs(map, key);
      if (mode === 'move' && okUids.length) removeScenarioItems(key, okUids);
      else afterChange(key);
    } finally { cpSuppress--; }
    say(`🌐 マイライブラリ「${folderLabel(folder)}」へ${mode === 'move' ? '移動' : 'コピー'}しました：新規 ${added}件 / 既存の同一画像へ統合 ${merged}件${skipped ? ` / 対象外 ${skipped}件` : ''}`);
    return { added, merged, skipped, moved: mode === 'move' && okUids.length > 0, uids: okUids };
  }
  async function sendToLibraryFlow(key, uids) {
    key = String(keyOr(key) || '');
    uids = [...new Set(toArr(uids).filter(Boolean))];
    if (!uids.length) { say('マイライブラリへ送る素材を選択してください'); return null; }
    if (!key || key === '_default') { say('シナリオを先に選んでください'); return null; }
    if (!window.CommonAssets || typeof window.CommonAssets.addImageDedup !== 'function') { say('マイライブラリ機能が利用できません'); return null; }
    const idSet = new Set(uids), items = getUnifiedItems(key).filter(it => idSet.has(it.uid));
    if (!items.length) return null;
    const r = await sendDialog(items.length, items[0].category);
    if (!r) return null;
    return Object.assign({ done: true }, await sendItemsToLibrary(key, items, r.folder, r.mode));
  }
  // 登録済みの「名前違い・中身同一」画像を SHA-256 で検出して1件に統合（共通 = appState.imageAssets / シナリオ = sc.images）
  async function mergeDuplicatesFlow(mode, key) {
    const CA = window.CommonAssets;
    if (!CA || typeof CA.planImageMerge !== 'function') { say('統合機能が利用できません'); return null; }
    mode = mode === 'common' ? 'common' : 'scenario';
    let list, prefix;
    if (mode === 'common') {
      if (typeof appState === 'undefined' || !appState) return null;
      list = appState.imageAssets = Array.isArray(appState.imageAssets) ? appState.imageAssets : []; prefix = 'cimg:'; key = '';
    } else {
      key = String(keyOr(key) || '');
      const sc = scenarioOf(key);
      if (!sc) { say('シナリオを先に選んでください'); return null; }
      list = sc.images = Array.isArray(sc.images) ? sc.images : []; prefix = 'img:';
    }
    say('🧹 画像のSHA-256ハッシュを照合しています…');
    const groups = await CA.planImageMerge(list);
    if (!groups.length) { say('🧹 名前違い・中身同一の画像（SHA-256一致）は見つかりませんでした'); return { groups: 0, removed: 0 }; }
    const removed = groups.reduce((s, g) => s + g.others.length, 0);
    const nm = a => stripAssetExt(a.name || a.origName || '') || '(無題)';
    const sample = groups.slice(0, 5).map(g => `・${nm(g.keeper)} ← ${g.others.map(nm).join(' / ')}`).join('\n');
    if (!(await appConfirm(`中身が完全に同じ画像が ${groups.length}組（重複 ${removed}件）見つかりました。1件に統合しますか？\n（具体的なフォルダ分類を優先して残し、タグは合算、部屋データ・NPC立ち絵などの参照先は自動で張り替えます）\n\n${sample}${groups.length > 5 ? '\n…' : ''}`, { okText: '統合する' }))) return null;
    checkpoint('同一画像を統合');
    cpSuppress++;
    try {
      const map = CA.applyImageMerge(list, groups, prefix);
      CA.rewireAssetRefs(map, mode === 'scenario' ? key : '');
      if (mode === 'common') CA.flush(); else afterChange(key);
    } finally { cpSuppress--; }
    say(`🧹 同一画像 ${groups.length}組（${removed}件の重複）を統合しました`);
    return { groups: groups.length, removed };
  }

  async function pickAddFiles(key, folder) {
    const targetKey = String(keyOr(key !== undefined ? key : AM.key) || '');
    const targetFolder = folder !== undefined ? folder : (AM.folder === ALL || AM.folder === NONE ? '' : AM.folder);
    if (!targetKey || targetKey === '_default') { say('シナリオを先に選んでください'); return 0; }
    try {
      const ipc = CCF.electron && CCF.electron.ipcRenderer;
      if (ipc) {
        const r = await ipc.invoke('ccf:pick', { title: '登録素材に追加するファイルを選択', properties: ['openFile', 'multiSelections'] });
        if (Array.isArray(r) && r.length > 0) return addPaths(targetKey, r, targetFolder);
        return 0;
      }
      return await new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.multiple = true;
        inp.accept = 'image/*,audio/*,video/*,.pdf,.txt,.html,.htm,.md,.zip';
        inp.onchange = () => {
          const files = [...(inp.files || [])];
          if (!files.length) return resolve(0);
          const paths = IS_ELECTRON ? files.map(f => typeof filePathOf === 'function' ? filePathOf(f) : f.path).filter(Boolean) : [];
          if (paths.length) return resolve(addPaths(targetKey, paths, targetFolder));
          resolve(addBrowserFiles(targetKey, files, targetFolder));
        };
        inp.click();
      });
    } catch (e) { if (typeof logSoft === 'function') logSoft('amPickAdd', e); return 0; }
  }

  async function onClick(e) {
    const t = e.target;
    if (t === AM.el) return closeModal();
    if (t.classList && t.classList.contains('ccf-am-chk')) { e.stopPropagation(); return; }
    const ctxBtn = t.closest('[data-amctx]');
    if (ctxBtn) {
      e.stopPropagation();
      const fo = (ctxBtn.closest('.ccf-am-ctx') || {}).dataset ? ctxBtn.closest('.ccf-am-ctx').dataset.folder : '';
      closeAmCtx();
      const ck = ctxBtn.dataset.amctx;
      if (ck === 'sub') return folderCreateFlow(fo);
      if (ck === 'ren') return folderRenameFlow(fo);
      if (ck === 'mov') return folderMoveParentFlow(fo);
      if (ck === 'del') return folderDeleteFlow(fo);
      return;
    }
    closeAmCtx();
    const fadd = t.closest('[data-amf-add]');
    if (fadd) { e.stopPropagation(); return folderCreateFlow(fadd.dataset.amfAdd); }
    const ftg = t.closest('[data-amf-tg]');
    if (ftg) { e.stopPropagation(); const fp = ftg.dataset.amfTg; if (AM.collapsed.has(fp)) AM.collapsed.delete(fp); else AM.collapsed.add(fp); return draw(); }
    const fmv = t.closest('[data-amf-mv]');
    if (fmv) {
      e.stopPropagation();
      moveFolderStep(fmv.dataset.folder, fmv.dataset.amfMv === 'up' ? -1 : 1);
      return;
    }
    const act = t.closest('[data-amact]');
    if (act) {
      e.stopPropagation();
      const k = act.dataset.amact, uid = act.dataset.uid;
      if (k === 'play') {
        if (CCF.library && CCF.library.playToggle) await CCF.library.playToggle(act.dataset.path);
        drawGrid();
        return;
      }
      if (k === 'mv-prev') return moveOrderRelative([uid], 'prev');
      if (k === 'mv-next') return moveOrderRelative([uid], 'next');
      if (k === 'edit') return openAmDetail(uid);
      if (k === 'rename') return renameItem(uid);
      if (k === 'tag') return editTags(uid);
      return;
    }
    const a = t.closest('[data-am]'), proj = () => projOf(AM.key);
    if (a && a.dataset.am !== 'selall') {
      const k = a.dataset.am;
      if (k === 'mode:scenario' || k === 'mode:common') { AM.mode = k.split(':')[1]; AM.folder = ALL; AM.sel.clear(); AM.prev = ''; AM.anchor = ''; AM.tag = ''; AM.usedScn = ''; AM.openGroups.clear(); return draw(); }
      if (k === 'view:folder' || k === 'view:list') { AM.viewMode = k.split(':')[1]; savePickerView(AM.viewMode); return draw(); }
      if (k === 'sync') { if (window.CommonAssets) await window.CommonAssets.sync(true); return draw(); }
      if (k === 'websync') {
        if (!AM.key || AM.key === '_default') { say('シナリオを先に選んでください'); return; }
        if (typeof window.syncScenarioAssetsToWeb !== 'function') { say('Web同期機能が利用できません'); return; }
        a.disabled = true;
        const prevTxt = a.textContent;
        a.textContent = '☁️ WebP化・同期中…';
        try { await window.syncScenarioAssetsToWeb(AM.key); }
        finally { a.disabled = false; a.textContent = prevTxt; draw(); }
        return;
      }
      if (k === 'close') return closeModal();
      if (k === 'newf') return folderCreateFlow((AM.folder !== ALL && AM.folder !== NONE) ? AM.folder : '');
      if (k === 'renf') return folderRenameFlow(AM.folder);
      if (k === 'movf') return folderMoveParentFlow(AM.folder);
      if (k === 'delf') return folderDeleteFlow(AM.folder);
      if (k === 'sendlib') { const r = await sendToLibraryFlow(AM.key, [...AM.sel]); if (r && r.done) { if (r.moved) AM.sel.clear(); draw(); } return; }
      if (k === 'mergedup') { await mergeDuplicatesFlow(AM.mode, AM.key); return draw(); }
      if (k === 'move') { const d = AM.el.querySelector('.ccf-am-dest').value; return moveIds([...AM.sel], d === NONE ? '' : d); }
      if (k === 'saveorder') return saveCurrentSortAsCustom();
      if (k === 'mv-first' || k === 'mv-prev' || k === 'mv-next' || k === 'mv-last') return moveOrderRelative([...AM.sel], k.slice(3));
      if (k === 'bulkdel') return bulkDelete();
      if (k === 'addfile') return pickAddFiles();
      if (k === 'copytosc') {
        copyCommonItemsToScenario(AM.key, [...AM.sel]);
        return draw();
      }
      return;
    }
    const gt = t.closest('[data-gtoggle]'); if (gt) { const fk = gt.dataset.gtoggle; if (AM.openGroups.has(fk)) AM.openGroups.delete(fk); else AM.openGroups.add(fk); return drawGrid(); }
    const f = t.closest('[data-amf]'); if (f) { AM.folder = f.dataset.amf; AM.anchor = ''; return draw(); }
    const tag = t.closest('[data-tagv]'); if (tag) { AM.tag = tag.dataset.tagv; return draw(); }
    const c = t.closest('[data-amid]');
    if (c && !t.closest('[data-usage], button, input')) {
      // シングルクリック=選択（詳細モーダルは開かない）。ダブルクリック／✏️ボタンで詳細・編集を開く
      amCardClick(c.dataset.amid, e);
    }
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.amchk) {
      e.stopPropagation();
      const id = t.dataset.amchk;
      if (t.checked) AM.sel.add(id); else AM.sel.delete(id);
      AM.anchor = id;
      return syncAmSelectionDom();
    }
    if (t.dataset.am === 'incsub') { AM.incSub = !!t.checked; try { localStorage.setItem(AM_INCSUB_KEY, AM.incSub ? '1' : '0'); } catch (_) { } return draw(); }
    if (t.dataset.am === 'selall') {
      const list = visible();
      list.forEach(r => t.checked ? AM.sel.add(r.uid) : AM.sel.delete(r.uid));
      return drawGrid();
    }
    if (t.classList.contains('ccf-am-scn')) { AM.usedScn = t.value; return drawGrid(); }
    if (t.classList.contains('ccf-am-tag')) { AM.tag = t.value; return drawGrid(); }
    if (t.classList.contains('ccf-am-sort')) { AM.sort = t.value; return drawGrid(); }
  }
  function openModal(key, mode) {
    key = keyOr(key);
    if (!key || key === '_default') {
      if (mode !== 'common') return say('シナリオを選んでから開いてください（登録素材はシナリオごとに管理します）');
    }
    closeModal();
    if (key && key !== '_default' && mode !== 'common') {
      const cleanRes = cleanupScenarioAssets(key);
      if (cleanRes && cleanRes.changed) {
        if (typeof saveState === 'function') saveState();
      }
    }
    const initFolders = new Set();
    if (key && key !== '_default') {
      const p = projOf(key), sc = scenarioOf(key);
      ((p && p.folders) || []).forEach(f => { const nf = normFolder(f); if (nf) initFolders.add(nf); });
      ((sc && sc.imageCategories) || []).forEach(f => { const nf = normFolder(f); if (nf) initFolders.add(nf); });
    }
    Object.assign(AM, { mode: mode || 'scenario', key: key || '', folder: ALL, sel: new Set(), prev: '', q: '', tag: '', usedScn: '', sort: 'manual', viewMode: loadPickerView(), openGroups: new Set(), dragFolder: '', keptFolders: initFolders, anchor: '', collapsed: new Set(), incSub: loadIncSub() });
    const el = AM.el = document.createElement('div'); el.className = 'ccf-am-ov'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="ccf-am-modal" tabindex="-1"></div>'; document.body.appendChild(el); draw();
    el.addEventListener('mousedown', e => { if (e.target.classList && e.target.classList.contains('ccf-am-chk')) e.stopPropagation(); });
    el.addEventListener('click', onClick); el.addEventListener('change', onChange);
    let amComposing = false;
    el.addEventListener('compositionstart', e => { if (e.target.classList && e.target.classList.contains('ccf-am-q')) amComposing = true; });
    el.addEventListener('compositionend', e => { if (e.target.classList && e.target.classList.contains('ccf-am-q')) { amComposing = false; AM.q = e.target.value; drawGrid(); } });
    el.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('ccf-am-q') && !amComposing && !e.isComposing) { AM.q = e.target.value; drawGrid(); } });
    el.addEventListener('dblclick', e => {
      // ダブルクリックで「素材の詳細・編集」を開く（チェックボックス・◀▶・ボタン上は除外）
      const c = e.target.closest('[data-amid]'); if (!c) return;
      if (e.target.closest('.ccf-am-chk, .ccf-am-mv, button, input, select, [data-usage]')) return;
      e.preventDefault();
      openAmDetail(c.dataset.amid);
    });
    el.addEventListener('contextmenu', e => {
      const fr = e.target.closest('.ccf-am-f[data-amf]');
      if (!fr || fr.dataset.amf === ALL || fr.dataset.amf === NONE) return;
      e.preventDefault();
      openAmCtx(fr.dataset.amf, e.clientX, e.clientY);
    });
    el.addEventListener('dragstart', e => {
      const fRow = e.target.closest('.ccf-am-f[data-amf][draggable="true"]');
      if (fRow && !e.target.closest('button')) {
        AM.dragFolder = fRow.dataset.amf || '';
        e.dataTransfer.setData('text/ccf-folder', AM.dragFolder);
        e.dataTransfer.effectAllowed = 'move';
        return;
      }
      AM.dragFolder = '';
      const c = e.target.closest('[data-amid]'); if (!c) return;
      AM.dragIds = AM.sel.has(c.dataset.amid) ? [...AM.sel] : [c.dataset.amid];
      e.dataTransfer.setData('text/ccf-amids', AM.dragIds.join(','));
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { AM.dragFolder = ''; clearDropMarks(); });
    const dropFolder = e => e.target.closest('[data-amf]');
    const dropCard = e => e.target.closest('[data-amid]');
    const clearDropMarks = () => {
      el.querySelectorAll('.ccf-am-f.drop,.ccf-am-f.drop-f-before,.ccf-am-f.drop-f-after,.ccf-am-card.drop-before,.ccf-am-card.drop-after').forEach(x => x.classList.remove('drop', 'drop-f-before', 'drop-f-after', 'drop-before', 'drop-after'));
    };
    const accepts = e => { const ty = [...(e.dataTransfer.types || [])]; return ty.includes('text/ccf-amids') || ty.includes('text/ccf-folder') || ty.includes('text/ccf-path') || ty.includes('Files'); };
    el.addEventListener('dragover', e => {
      const z = dropFolder(e), c = dropCard(e), g = e.target.closest('.ccf-am-grid');
      if ((z || c || g) && accepts(e)) {
        const ty = [...(e.dataTransfer.types || [])];
        if (z && ty.includes('text/ccf-folder')) {
          const tf = z.dataset.amf, df = AM.dragFolder;
          if (tf === NONE) return;
          if (tf === ALL) {
            if (!df || !parentOf(df)) return;
            e.preventDefault(); e.stopPropagation(); clearDropMarks();
            z.classList.add('drop');
            return;
          }
          if (df && (tf === df || tf.startsWith(df + '/'))) return;
          e.preventDefault(); e.stopPropagation(); clearDropMarks();
          const rect = z.getBoundingClientRect();
          const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
          if (df && parentOf(df) === parentOf(tf) && (relY < 0.25 || relY > 0.75)) {
            z.classList.add(relY > 0.75 ? 'drop-f-after' : 'drop-f-before');
          } else {
            z.classList.add('drop');
          }
          return;
        }
        e.preventDefault(); e.stopPropagation();
        clearDropMarks();
        if (z) z.classList.add('drop');
        else if (c && ty.includes('text/ccf-amids')) {
          const rect = c.getBoundingClientRect();
          const isAfter = (e.clientX - rect.left) > (rect.width / 2);
          c.classList.add(isAfter ? 'drop-after' : 'drop-before');
        }
      }
    });
    el.addEventListener('dragleave', e => {
      const z = dropFolder(e), c = dropCard(e);
      if (z && !z.contains(e.relatedTarget)) z.classList.remove('drop', 'drop-f-before', 'drop-f-after');
      if (c && !c.contains(e.relatedTarget)) c.classList.remove('drop-before', 'drop-after');
    });
    el.addEventListener('drop', e => {
      const z = dropFolder(e), c = dropCard(e), g = e.target.closest('.ccf-am-grid');
      if (!z && !c && !g) return; if (!accepts(e)) return;
      e.preventDefault(); e.stopPropagation();
      clearDropMarks();
      const dragFolder = e.dataTransfer.getData('text/ccf-folder') || AM.dragFolder;
      AM.dragFolder = '';
      if (dragFolder && z) {
        const tf = z.dataset.amf;
        if (tf === NONE) return;
        if (tf === ALL) {
          if (parentOf(dragFolder)) moveFolderToParent(dragFolder, '');
          return;
        }
        if (tf === dragFolder || tf.startsWith(dragFolder + '/')) return;
        const rect = z.getBoundingClientRect();
        const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
        if (parentOf(dragFolder) === parentOf(tf) && (relY < 0.25 || relY > 0.75)) {
          reorderFolder(dragFolder, tf, relY > 0.75);
        } else {
          moveFolderToParent(dragFolder, tf);
        }
        return;
      }
      const idsRaw = e.dataTransfer.getData('text/ccf-amids') || e.dataTransfer.getData('text/ccf-refid');
      const lp = e.dataTransfer.getData('text/ccf-path');
      if (c && idsRaw && !z) {
        const rect = c.getBoundingClientRect();
        const isAfter = (e.clientX - rect.left) > (rect.width / 2);
        reorderUid(idsRaw.split(',').filter(Boolean), c.dataset.amid, isAfter);
        return;
      }
      const dest = z ? (z.dataset.amf === ALL || z.dataset.amf === NONE ? '' : z.dataset.amf) : (AM.folder === ALL || AM.folder === NONE ? '' : AM.folder);
      if (idsRaw) { if (z && z.dataset.amf === ALL) return; moveIds(idsRaw.split(',').filter(Boolean), dest); }
      else if (lp) { if (AM.mode === 'scenario') addPaths(AM.key, [lp], dest); }
      else if (e.dataTransfer.files && e.dataTransfer.files.length && AM.mode === 'scenario') {
        const fps = [...e.dataTransfer.files].map(f => typeof filePathOf === 'function' ? filePathOf(f) : f.path).filter(Boolean);
        if (fps.length) addPaths(AM.key, fps, dest);
      }
    });
    document.addEventListener('keydown', onKey, true); el.querySelector('.ccf-am-modal').focus();
  }
  function onKey(e) { if (e.key === 'Escape' && AM.el && !document.querySelector('.app-dialog-overlay, .gal-detail-ov')) { e.preventDefault(); e.stopImmediatePropagation(); closeModal(); } }
  function closeModal() { if (!AM.el) return; AM.keptFolders.clear(); document.removeEventListener('keydown', onKey, true); AM.el.remove(); AM.el = null; }
  function refreshModal() { if (AM.el) draw(); }

  // ================= NPC 立ち絵ピッカー（統合登録素材から画像を選ぶ） =================
  function pickImage() {
    return new Promise(resolve => {
      const key = CCF.S.key; if (!key || key === '_default') { say('シナリオを選ぶと、そのシナリオの登録素材から選べます'); return resolve(null); }
      let folder = ALL, q = '', viewMode = loadPickerView();
      const openGroups = new Set();
      const ov = document.createElement('div'); ov.className = 'ccf-am-ov ccf-am-pick'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      const done = v => { document.removeEventListener('keydown', onK, true); ov.remove(); resolve(v); };
      const onK = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); } };
      const cardImg = r => {
        const src = r.dataUrl || fileUrl(r.path);
        return `<div class="ccf-am-card" data-pick="${esc(r.uid)}" title="${esc(r.name)}">${assetImgTag(src, '', 'alt="" loading="lazy" decoding="async"')}<div class="ccf-am-nm">${esc(r.name)}</div><div class="ccf-am-fd">📁 ${esc(folderLabel(r.category))}</div></div>`;
      };
      const drawGrid2 = () => {
        const g = ov.querySelector('.ccf-am-grid'); if (!g) return;
        const imgs = getUnifiedItems(key).filter(r => r.type === 'image' && !r.missing);
        const parsed = M.parseSearchQuery(q);
        const list = imgs.filter(r => (folder === ALL || (folder === NONE ? !normFolder(r.category) : inFolder(normFolder(r.category), folder, true))) && (!q.trim() || M.matchSearchQuery(r.blob || (r.name + ' ' + r.category).toLowerCase(), parsed)));
        const isGrouped = folder === ALL && viewMode === 'folder';
        mountGridView(g, list, cardImg, {
          isGrouped,
          openSet: openGroups,
          isFiltering: !!q.trim(),
          emptyHtml: '<div class="ccf-empty">画像がありません。「📌 登録素材」へ画像を登録してください。</div>'
        });
        void fillCloudAssetsIn(ov);
      };
      const draw2 = () => {
        const imgs = getUnifiedItems(key).filter(r => r.type === 'image' && !r.missing);
        const qv = ov.querySelector('[data-pq]'), hadFocus = qv && document.activeElement === qv;
        ov.innerHTML = `<div class="ccf-am-modal ccf-am-small ccf-am-pickmodal">
          <div class="ccf-am-head">
            <b>📌 登録素材から立ち絵を選ぶ（${imgs.length}件）</b>
            <span class="ccf-spacer"></span>
            <button type="button" class="ccf-btn" data-x="1">キャンセル</button>
          </div>
          <div class="ccf-am-body">
            <div class="ccf-am-left">
              <div class="ccf-am-bar"><b>📁 フォルダ</b></div>
              <div class="ccf-am-flist">${pickerLeftHtml(imgs, folder)}</div>
            </div>
            <div class="ccf-am-right">
              <div class="ccf-am-bar">
                <input type="search" class="ccf-am-q" data-pq="1" placeholder="🔍 検索..." value="${esc(q)}">
                ${folder === ALL ? `<div class="ccf-view-toggle" role="group" aria-label="表示切替">
                  <button type="button" class="ccf-mini${viewMode === 'folder' ? ' active' : ''}" data-pview="folder">📁 フォルダ別表示</button>
                  <button type="button" class="ccf-mini${viewMode === 'list' ? ' active' : ''}" data-pview="list">🖼️ フラット一覧</button>
                </div>` : ''}
              </div>
              <div class="ccf-am-grid"></div>
            </div>
          </div></div>`;
        drawGrid2();
        if (hadFocus) { const nq = ov.querySelector('[data-pq]'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } }
      };
      ov.addEventListener('click', async e => {
        if (e.target === ov || e.target.closest('[data-x]')) return done(null);
        const pf = e.target.closest('[data-pf]'); if (pf) { folder = pf.dataset.pf; return draw2(); }
        const pvBtn = e.target.closest('[data-pview]'); if (pvBtn) { viewMode = pvBtn.dataset.pview; savePickerView(viewMode); return draw2(); }
        const gt = e.target.closest('[data-gtoggle]'); if (gt) { const fk = gt.dataset.gtoggle; if (openGroups.has(fk)) openGroups.delete(fk); else openGroups.add(fk); return drawGrid2(); }
        const c = e.target.closest('[data-pick]'); if (!c) return;
        const r = getUnifiedItems(key).find(x => x.uid === c.dataset.pick); if (!r) return done(null);
        let du = r.dataUrl || '';
        if (du.startsWith('@img:') && typeof window.ensureLocalImageByHash === 'function') {
          const h = du.slice(5);
          await window.ensureLocalImageByHash(h);
          du = (window.getLocalImageBlobUrl && window.getLocalImageBlobUrl(h)) || du;
        }
        done({ uid: r.uid || '', assetId: r.uid || '', path: r.path || '', dataUrl: du, name: r.name || '' });
      });
      let pqComposing = false;
      ov.addEventListener('compositionstart', e => { if (e.target.dataset && e.target.dataset.pq) pqComposing = true; });
      ov.addEventListener('compositionend', e => { if (e.target.dataset && e.target.dataset.pq) { pqComposing = false; q = e.target.value; drawGrid2(); } });
      ov.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.pq && !pqComposing && !e.isComposing) { q = e.target.value; drawGrid2(); } });
      document.body.appendChild(ov); document.addEventListener('keydown', onK, true); draw2();
    });
  }

  /** 指定素材（登録素材 または マイライブラリ）にカスタムタグを追記する */
  function appendTagsToAsset(key, uid, newTags) {
    const cleanAdd = M.cleanTagList(newTags);
    if (!uid || !cleanAdd.length) return false;
    key = keyOr(key);
    if (uid.startsWith('cimg:') || uid.startsWith('lib:')) {
      if (!window.CommonAssets) return false;
      const cur = window.CommonAssets.getAll().find(x => x.uid === uid);
      const merged = M.cleanTagList([...(cur ? cur.customTags : []), ...cleanAdd]);
      return window.CommonAssets.setTags(uid, merged);
    }
    const items = getUnifiedItems(key);
    const it = items.find(x => x.uid === uid);
    if (!it) return false;
    const merged = M.cleanTagList([...(it.customTags || []), ...cleanAdd]);
    mutate(key, p => {
      if (it.srcType === 'ref') { const r = (p.refs || []).find(x => x.id === it.rawId); if (r) r.tags = merged; }
      else if (it.raw) it.raw.tags = merged;
    }, '素材にシーンタグを追加');
    return true;
  }

  /** 汎用素材ピッカー（登録素材 ⇔ マイライブラリ切替・タイプ絞り込み・検索・音声試聴・PCから追加・multi複数選択対応） */
  function pickAsset(opts) {
    const o = Object.assign({ key: CCF.S.key, types: ['image'], title: '素材を選択', multi: false }, opts || {});
    const isMulti = !!o.multi;
    const allowed = new Set(o.types || ['image']);
    return new Promise(resolve => {
      let mode = (o.key && o.key !== '_default') ? 'scenario' : 'common';
      let folder = ALL, q = '', pvAudio = null, pvKey = '', viewMode = loadPickerView();
      let anchorUid = '';
      const openGroups = new Set();
      const selectedOrder = [];      // multi: true 時の選択順 uid 配列
      const selectedItemMap = new Map(); // uid -> item（登録素材・マイライブラリ横断保持用）
      const ov = document.createElement('div');
      ov.className = 'ccf-am-ov ccf-am-pick' + (isMulti ? ' is-multi' : '');
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      const stopAudio = () => { if (pvAudio) { try { pvAudio.pause(); } catch (_) { } pvAudio = null; pvKey = ''; } };
      const done = v => { stopAudio(); document.removeEventListener('keydown', onK, true); ov.remove(); resolve(v); };
      const onK = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); } };
      const getItems = () => {
        const list = mode === 'scenario'
          ? getUnifiedItems(o.key)
          : (window.CommonAssets ? window.CommonAssets.getAll() : []);
        return list.filter(r => !r.missing && allowed.has(r.type));
      };
      const getVisibleList = () => {
        const all = getItems();
        const parsed = M.parseSearchQuery(q);
        return all.filter(r => (folder === ALL || (folder === NONE ? !normFolder(r.category) : inFolder(normFolder(r.category), folder, true))) && (!q.trim() || M.matchSearchQuery(r.blob || (r.name + ' ' + r.category).toLowerCase(), parsed)));
      };
      const getDisplayOrder = list => {
        if (folder === ALL && viewMode === 'folder' && list.length) {
          const { groups, keys } = groupByFolder(list);
          return keys.reduce((acc, k) => acc.concat(groups.get(k) || []), []);
        }
        return list;
      };
      const toggleSelectItem = (r, forceState) => {
        if (!r || !r.uid) return;
        const idx = selectedOrder.indexOf(r.uid);
        const want = forceState !== undefined ? !!forceState : (idx < 0);
        if (want && idx < 0) {
          selectedOrder.push(r.uid);
          selectedItemMap.set(r.uid, r);
        } else if (!want && idx >= 0) {
          selectedOrder.splice(idx, 1);
          selectedItemMap.delete(r.uid);
        }
      };
      const syncMultiDom = () => {
        if (!isMulti) return;
        const orderIndex = new Map();
        selectedOrder.forEach((u, i) => orderIndex.set(u, i + 1));
        ov.querySelectorAll('.ccf-am-card[data-pick]').forEach(el => {
          const uid = el.dataset.pick;
          const ord = orderIndex.get(uid) || 0;
          el.classList.toggle('sel', ord > 0);
          let badge = el.querySelector('.ccf-pick-ord');
          if (ord > 0) {
            if (!badge) {
              badge = document.createElement('span');
              badge.className = 'ccf-pick-ord';
              el.prepend(badge);
            }
            badge.textContent = String(ord);
          } else if (badge) {
            badge.remove();
          }
        });
        const cnt = selectedOrder.length;
        const sumEl = ov.querySelector('[data-pmsum]');
        if (sumEl) sumEl.textContent = cnt ? `${cnt}枚を選択中（選択順に追加されます）` : '追加する画像を複数クリックして選択してください（Shift+クリックで範囲選択）';
        const clrBtn = ov.querySelector('[data-psel="clear"]');
        if (clrBtn) clrBtn.disabled = !cnt;
        const okBtn = ov.querySelector('[data-pconfirm]');
        if (okBtn) {
          okBtn.disabled = !cnt;
          okBtn.textContent = `選択した ${cnt}枚 を決定`;
        }
      };
      const cardPick = r => {
        const src = r.dataUrl || (r.path ? fileUrl(r.path) : '');
        const pv = r.type === 'image' && src ? assetImgTag(src, '', 'alt="" loading="lazy" decoding="async"') : `<div class="ccf-am-ico">${icon(r)}</div>`;
        const play = r.type === 'audio' && src ? `<button type="button" class="ccf-mini" data-pplay="${esc(r.path || src)}" title="試聴">${pvKey === (r.path || src) ? '■ 停止' : '▶ 試聴'}</button>` : '';
        const ordIdx = isMulti ? selectedOrder.indexOf(r.uid) : -1;
        const ordBadge = ordIdx >= 0 ? `<span class="ccf-pick-ord">${ordIdx + 1}</span>` : '';
        return `<div class="ccf-am-card${ordIdx >= 0 ? ' sel' : ''}" data-pick="${esc(r.uid)}" title="${esc(r.path || r.name)}">${ordBadge}${pv}<div class="ccf-am-nm">${esc(r.name)}</div><div class="ccf-am-fdrow"><span class="ccf-am-fd">📁 ${esc(folderLabel(r.category))}</span>${play}</div></div>`;
      };
      const drawGrid2 = () => {
        const g = ov.querySelector('.ccf-am-grid');
        if (!g) return;
        const list = getVisibleList();
        const isGrouped = folder === ALL && viewMode === 'folder';
        mountGridView(g, list, cardPick, {
          isGrouped,
          openSet: openGroups,
          isFiltering: !!q.trim(),
          emptyHtml: '<div class="ccf-empty">該当する素材がありません。</div>'
        });
        syncMultiDom();
        void fillCloudAssetsIn(ov);
      };
      const draw2 = () => {
        const all = getItems();
        const hasScn = !!(o.key && o.key !== '_default');
        const qv = ov.querySelector('[data-pq]'), hadFocus = qv && document.activeElement === qv;
        const multiBarBtns = isMulti
          ? `<button type="button" class="ccf-mini" data-psel="all">☑ 表示中を全選択</button><button type="button" class="ccf-mini" data-psel="clear"${selectedOrder.length ? '' : ' disabled'}>☐ 選択解除</button>`
          : '';
        const multiFooter = isMulti
          ? `<div class="ccf-am-pickfoot"><span class="ccf-muted" data-pmsum></span><span class="ccf-spacer"></span><button type="button" class="ccf-btn" data-x="1">キャンセル</button><button type="button" class="ccf-btn primary" data-pconfirm="1"${selectedOrder.length ? '' : ' disabled'}>選択した ${selectedOrder.length}枚 を決定</button></div>`
          : '';
        ov.innerHTML = `<div class="ccf-am-modal ccf-am-small ccf-am-pickmodal">
          <div class="ccf-am-head">
            <b>${esc(o.title)}</b>
            <div class="ccf-am-mtabs">
              ${hasScn ? `<button type="button" class="ccf-am-mtab${mode === 'scenario' ? ' on' : ''}" data-pmode="scenario">📌 登録素材</button>` : ''}
              <button type="button" class="ccf-am-mtab${mode === 'common' ? ' on' : ''}" data-pmode="common">🌍 マイライブラリ</button>
            </div>
            <button type="button" class="ccf-btn" data-pfile="1">📂 ${IS_ELECTRON ? 'PCファイルから選ぶ' : 'ファイルから選ぶ'}</button>
            <span class="ccf-spacer"></span>
            <button type="button" class="ccf-btn" data-x="1">キャンセル</button>
          </div>
          <div class="ccf-am-body">
            <div class="ccf-am-left">
              <div class="ccf-am-bar"><b>📁 フォルダ</b></div>
              <div class="ccf-am-flist">${pickerLeftHtml(all, folder)}</div>
            </div>
            <div class="ccf-am-right">
              <div class="ccf-am-bar">
                ${multiBarBtns}
                <input type="search" class="ccf-am-q" data-pq="1" placeholder="🔍 検索..." value="${esc(q)}">
                ${folder === ALL ? `<div class="ccf-view-toggle" role="group" aria-label="表示切替">
                  <button type="button" class="ccf-mini${viewMode === 'folder' ? ' active' : ''}" data-pview="folder">📁 フォルダ別表示</button>
                  <button type="button" class="ccf-mini${viewMode === 'list' ? ' active' : ''}" data-pview="list">🖼️ フラット一覧</button>
                </div>` : ''}
              </div>
              <div class="ccf-am-grid"></div>
              ${multiFooter}
            </div>
          </div></div>`;
        drawGrid2();
        if (hadFocus) { const nq = ov.querySelector('[data-pq]'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } }
      };
      const hydratePicked = async r => {
        let du = r.dataUrl || '';
        if (du.startsWith('@img:') && typeof window.ensureLocalImageByHash === 'function') {
          const h = du.slice(5);
          await window.ensureLocalImageByHash(h);
          du = (window.getLocalImageBlobUrl && window.getLocalImageBlobUrl(h)) || du;
        }
        return Object.assign({}, r, { dataUrl: du, isManual: true });
      };
      ov.addEventListener('click', async e => {
        if (e.target === ov || e.target.closest('[data-x]')) return done(null);
        const pm = e.target.closest('[data-pmode]');
        if (pm) { mode = pm.dataset.pmode; folder = ALL; anchorUid = ''; openGroups.clear(); return draw2(); }
        const pf = e.target.closest('[data-pf]');
        if (pf) { folder = pf.dataset.pf; anchorUid = ''; return draw2(); }
        const pvBtn = e.target.closest('[data-pview]');
        if (pvBtn) { viewMode = pvBtn.dataset.pview; savePickerView(viewMode); return draw2(); }
        const gt = e.target.closest('[data-gtoggle]');
        if (gt) { const fk = gt.dataset.gtoggle; if (openGroups.has(fk)) openGroups.delete(fk); else openGroups.add(fk); return drawGrid2(); }
        const psel = e.target.closest('[data-psel]');
        if (psel && isMulti) {
          if (psel.dataset.psel === 'all') {
            getDisplayOrder(getVisibleList()).forEach(r => toggleSelectItem(r, true));
          } else if (psel.dataset.psel === 'clear') {
            selectedOrder.length = 0;
            selectedItemMap.clear();
            anchorUid = '';
          }
          return syncMultiDom();
        }
        if (e.target.closest('[data-pconfirm]') && isMulti) {
          if (!selectedOrder.length) return;
          const results = [];
          for (const u of selectedOrder) {
            const it = selectedItemMap.get(u);
            if (it) results.push(await hydratePicked(it));
          }
          return done(results);
        }
        const pp = e.target.closest('[data-pplay]');
        if (pp) {
          e.stopPropagation();
          const p = pp.dataset.pplay;
          const same = pvKey === p;
          stopAudio();
          if (!same) {
            pvKey = p; pvAudio = new Audio(/^(?:file:|data:|blob:|https?:)/.test(p) ? p : fileUrl(p));
            pvAudio.volume = 0.65;
            pvAudio.onended = () => { pvKey = ''; pvAudio = null; drawGrid2(); };
            pvAudio.play().catch(() => { pvKey = ''; pvAudio = null; });
          }
          return drawGrid2();
        }
        if (e.target.closest('[data-pfile]')) {
          try {
            const ipc = IS_ELECTRON && CCF.electron && CCF.electron.ipcRenderer;
            if (ipc) {
              const r = await ipc.invoke('ccf:pick', { title: o.title, properties: isMulti ? ['openFile', 'multiSelections'] : ['openFile'] });
              if (Array.isArray(r) && r.length > 0) {
                const picked = r.filter(Boolean).map(fp => {
                  const tp = inferType(fp) || (allowed.has('video') && VIDEO.test(fp) ? 'video' : allowed.has('audio') ? 'audio' : 'image');
                  return { uid: 'file:' + fp, name: stripAssetExt(baseName(fp)), origName: baseName(fp), path: fp, dataUrl: '', type: tp, isManual: true };
                });
                if (isMulti) return done(picked);
                if (picked[0]) return done(picked[0]);
              }
            } else if (window.WebBridge) {
              const acc = [];
              if (allowed.has('image')) acc.push('image/*');
              if (allowed.has('audio')) acc.push('audio/*');
              if (allowed.has('video')) acc.push('video/*');
              const files = await WebBridge.pickFiles({ accept: acc.join(','), multiple: isMulti });
              const list = Array.isArray(files) ? files : (files ? [files] : []);
              if (list.length) {
                const picked = [];
                for (const f of list) {
                  if (!f) continue;
                  const tp = inferType(f.name) || (allowed.has('audio') ? 'audio' : allowed.has('video') ? 'video' : 'image');
                  if (tp === 'image') {
                    const du = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.onerror = () => res(''); fr.readAsDataURL(f); });
                    picked.push({ uid: 'file:' + f.name + '_' + picked.length, name: stripAssetExt(f.name), origName: f.name, path: '', dataUrl: du, type: 'image', isManual: true });
                  } else {
                    const ref = await WebBridge.saveAssetFile(f);
                    picked.push({ uid: 'file:' + ref, name: stripAssetExt(f.name), origName: f.name, path: ref, dataUrl: '', type: tp, isManual: true });
                  }
                }
                if (isMulti && picked.length) return done(picked);
                if (picked[0]) return done(picked[0]);
              }
            }
          } catch (_) { }
          return;
        }
        const c = e.target.closest('[data-pick]'); if (!c) return;
        const uid = c.dataset.pick;
        const visOrdered = getDisplayOrder(getVisibleList());
        const r = visOrdered.find(x => x.uid === uid) || getItems().find(x => x.uid === uid);
        if (!r) return isMulti ? undefined : done(null);
        if (isMulti) {
          if (e.shiftKey && anchorUid) {
            const a = visOrdered.findIndex(x => x.uid === anchorUid);
            const b = visOrdered.findIndex(x => x.uid === uid);
            if (a >= 0 && b >= 0) {
              const step = a <= b ? 1 : -1;
              for (let i = a; step > 0 ? i <= b : i >= b; i += step) {
                toggleSelectItem(visOrdered[i], true);
              }
              anchorUid = uid;
              return syncMultiDom();
            }
          }
          toggleSelectItem(r);
          anchorUid = uid;
          return syncMultiDom();
        }
        done(await hydratePicked(r));
      });
      ov.addEventListener('change', e => { if (e.target.dataset.pf) { folder = e.target.value; drawGrid2(); } });
      let pqComposing = false;
      ov.addEventListener('compositionstart', e => { if (e.target.dataset && e.target.dataset.pq) pqComposing = true; });
      ov.addEventListener('compositionend', e => {
        if (e.target.dataset && e.target.dataset.pq) {
          pqComposing = false;
          q = e.target.value;
          drawGrid2();
        }
      });
      ov.addEventListener('input', e => {
        if (e.target.dataset && e.target.dataset.pq) {
          if (pqComposing || e.isComposing) return;
          q = e.target.value;
          drawGrid2();
        }
      });
      document.body.appendChild(ov); document.addEventListener('keydown', onK, true); draw2();
    });
  }
  function pickAssets(opts) {
    return pickAsset(Object.assign({}, opts || {}, { multi: true }));
  }

  CCF.assets = { openModal, closeModal, refreshModal, pickImage, pickAsset, pickAssets, pickAddFiles, addBrowserFiles, appendTagsToAsset, bulkUpdateTags, removeScenarioItems, removeItems: removeScenarioItems, copyCommonItemsToScenario, sendToLibrary: sendToLibraryFlow, mergeDuplicates: mergeDuplicatesFlow, remapFolders: remapFoldersFor, tagsOf, peekTags, hasTags, tagBadges, usageBadge, usage, usageList, usageByCommonItem, scenariosUsingCommonAssets, commonAssetsUsedByScenario, invalidateUsage, addPaths, foldersOf: (p, k) => foldersOf(p, k), getUnifiedItems, invalidateUnified, cleanupScenarioAssets, cleanupAllScenarioAssets, syncAssetCatalog: (k, o) => (typeof window.syncScenarioAssetCatalog === 'function' ? window.syncScenarioAssetCatalog(scenarioOf(keyOr(k)), o) : []), countFor, moveIds, moveItems: moveIds, reorderUid, renameItem, editTags, norm, normFolder, folderLabel, assetImgTag, fillCloudAssetsIn, resolveScenarioLocalDocPath };
})();
