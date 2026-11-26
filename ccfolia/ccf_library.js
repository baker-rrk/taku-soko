/* ccf_library.js — マイライブラリ監視・共通ギャラリー統合・登録素材タブ */
(function () {
  'use strict';
  const CCF = window.CCF, { $, esc, say, S } = CCF, M = window.CCFModel;
  const KINDS = { img: /\.(png|jpe?g|gif|webp|bmp|svg)$/i, video: /\.(mp4|webm|mov|m4v|ogv)$/i, audio: /\.(mp3|wav|ogg|m4a|flac|aac)$/i, pdf: /\.(pdf|txt|html?|md|docx?)$/i, zip: /\.zip$/i, json: /\.json$/i };
  const nameIcon = n => KINDS.img.test(n) ? '🖼️' : KINDS.video.test(n) ? '🎬' : KINDS.audio.test(n) ? '🎵' : KINDS.pdf.test(n) ? '📄' : KINDS.zip.test(n) ? '📦' : KINDS.json.test(n) ? '🗂️' : '📎';
  const MAX_ENTRIES = 3000, MAX_SCAN = 6000, PAGE_SIZE = 40, NONE = '__none__';
  const META_KEY = 'ccf_common_meta_v1';
  const CUTIN_PKG_KEY = 'ccf_cutin_packages_v1';
  const ASSETS_VIEW_KEY = 'ccf_assets_view_mode_v1';
  const WEB_COMMON_HANDLE_KEY = 'web_common_watch_dir_handle';
  const WEB_COMMON_REFS_KEY = 'ccf_web_common_refs_v1';
  const toArr = v => Array.isArray(v) ? v : (v instanceof Set ? [...v] : (v && typeof v[Symbol.iterator] === 'function' && typeof v !== 'string' ? [...v] : (v != null ? [v] : [])));
  const normStdCat1 = c => (M && M.normalizeStandardCat) ? M.normalizeStandardCat(c) : ((!c || (M && M.isUnclassifiedCat(c))) ? '' : String(c).trim());
  // 階層パス（親フォルダ/小フォルダ）対応：'/' 区切りの各セグメントを個別に正規化（フラット名は従来どおり）
  const normStdCat = c => {
    const s = String(c == null ? '' : c).normalize('NFKC');
    return s.includes('/') ? s.split('/').map(x => normStdCat1(x.trim())).filter(Boolean).join('/') : normStdCat1(c);
  };
  const inCatPath = (cat, sel) => cat === sel || String(cat || '').startsWith(sel + '/');
  const catPathLabel = c => { const parts = String(c || '').split('/'); return parts.length > 1 ? '\u3000'.repeat(parts.length - 1) + '└ ' + parts[parts.length - 1] : c; };
  const baseOfPath = p => (typeof path !== 'undefined' && path && path.basename) ? path.basename(p) : (String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || ''));
  const loadAssetsViewMode = () => { try { return localStorage.getItem(ASSETS_VIEW_KEY) === 'list' ? 'list' : 'folder'; } catch (_) { return 'folder'; } };
  const Lib = { root: '', scnWatch: '', open: new Set(), cache: new Map(), selected: '', loading: new Set(), sel: new Set(), refOpen: new Set(), source: 'scenario', viewMode: loadAssetsViewMode(), typeFilter: '', refFolder: '*', q: '', tag: '', tagInput: '', scn: '', scan: null, webRefs: [], rootExists: false, tagsDone: false, commonCache: null, commonSig: '' };
  const A = () => CCF.assets;
  let audio = null, audioKey = '', watcher = null, scnWatcher = null, libWatchTimer = null, scnWatchTimer = null, metaVer = 0, tagGen = 0, listObs = null, listPager = null;
  let isSyncingLib = false, isSyncingScn = false, ignoreWatchUntil = 0;
  const markSelfSave = (ms = 2000) => { const until = Date.now() + ms; if (until > ignoreWatchUntil) ignoreWatchUntil = until; };
  const isCloudSyncBusy = () => !!(window.CloudSync && typeof window.CloudSync.isSyncing === 'function' && window.CloudSync.isSyncing());
  const deferUntilCloudIdle = (fn, delayMs = 1500) => {
    if (!isCloudSyncBusy()) { fn(); return; }
    if (window.CloudSync && typeof window.CloudSync.onSyncIdle === 'function') {
      window.CloudSync.onSyncIdle(() => setTimeout(() => deferUntilCloudIdle(fn, delayMs), delayMs));
    } else {
      setTimeout(() => deferUntilCloudIdle(fn, delayMs), Math.max(2000, delayMs));
    }
  };
  const ASSET_EXT_STRIP_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|m4a|flac|aac|mp4|webm|mov|pdf|txt|md|html?|docx?|zip|json)$/i;
  const stripAssetExt = n => (CCF.dnd && typeof CCF.dnd.stripAssetExt === 'function')
    ? CCF.dnd.stripAssetExt(n)
    : (String(n == null ? '' : n).trim().replace(ASSET_EXT_STRIP_RE, '').trim() || String(n == null ? '' : n).trim());
  const isOldVersionLib = n => (CCF.dnd && typeof CCF.dnd.isOldVersionName === 'function')
    ? CCF.dnd.isOldVersionName(n)
    : (M.isOldFolderName(n) || /(?:旧版|旧ver|旧バージョン|旧データ|旧ファイル|初期版|過去版|修正前|改訂前|差替前|差し替え前|更新前|エラッタ前|バックアップ|[（(\[【_\-\s](?:旧|old|backup|bak|archive|obsolete)[）)\]】_\-\s.]|^old[_\-\s]|^backup[_\-\s])/i.test(String(n || '').normalize('NFKC')));
  const filterLatestLib = arr => (CCF.dnd && typeof CCF.dnd.filterLatestVersionEntries === 'function') ? CCF.dnd.filterLatestVersionEntries(arr) : arr;
  const shouldIgnoreWatchPath = fn => !!(fn && (isOldVersionLib(baseOfPath(fn)) || M.isOldFolderName(fn) || /(?:^|[\\/])(?:_TRPG_Data|node_modules|\.git|__MACOSX)(?:[\\/]|$)/i.test(fn) || /(?:autosave_|\.(?:tmp|part|crdownload)$)/i.test(fn)));
  const folderPagers = new Map();
  const fileUrl = p => {
    if (!p) return '';
    if (window.WebBridge && WebBridge.isAssetRef(p)) return WebBridge.peekAssetUrl(p) || '';
    if (/^(?:file:|data:|blob:|https?:|cloud-asset:)/i.test(p)) return p;
    if (!IS_ELECTRON) return '';
    try { return require('url').pathToFileURL(p).href; } catch (_) { return ''; }
  };
  function resolveAssetImgSrc(r) {
    if (!r) return '';
    let src = r.dataUrl || (r.path && !r.missing ? fileUrl(r.path) : '');
    if (!src && r.raw) {
      src = r.raw.thumbRef || r.raw.dataUrl || '';
    }
    if (!src && r.type === 'image' && typeof appState !== 'undefined' && Array.isArray(appState.scenarios) && S && S.key) {
      const sc = appState.scenarios.find(s => s && String(s.id) === String(S.key));
      if (sc && Array.isArray(sc.images)) {
        const rawNames = new Set([r.origName, r.name, r.path ? baseOfPath(r.path) : ''].filter(Boolean).map(x => String(x).normalize('NFKC').trim().toLowerCase()));
        const stripNames = new Set([r.origName, r.name, r.path ? baseOfPath(r.path) : ''].filter(Boolean).map(x => stripAssetExt(String(x)).normalize('NFKC').trim().toLowerCase()));
        const hit = sc.images.find(im => {
          if (!im || !(im.dataUrl || im.thumbRef)) return false;
          const imRaw = String(im.origName || im.name || '').normalize('NFKC').trim().toLowerCase();
          const imStrip = stripAssetExt(im.origName || im.name || '').normalize('NFKC').trim().toLowerCase();
          return (imRaw && rawNames.has(imRaw)) || (imStrip && stripNames.has(imStrip));
        });
        if (hit) src = hit.dataUrl || hit.thumbRef || '';
      }
    }
    if (!src && r.cloudSha) {
      src = 'cloud-asset://' + r.cloudSha + '/' + encodeURIComponent(r.origName || r.name || 'asset');
    }
    return src;
  }
  const isZipOpen = p => Lib.open.has('zip:' + p);

  // ================= 共通アセット統合（画像ストア + 監視フォルダ参照） =================
  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        const m = { byUid: o.byUid || {}, order: Array.isArray(o.order) ? o.order : [], ver: Number(o.ver || 0) };
        if (m.ver < 2) {
          const stdSet = new Set(Array.isArray(M.STANDARD_SCENARIO_CATS) ? M.STANDARD_SCENARIO_CATS : ['トレーラー', 'NPC', '背景', '前景', 'マップ', '部屋素材']);
          let dirty = false;
          Object.keys(m.byUid).forEach(uid => {
            const ov = m.byUid[uid];
            if (ov && typeof ov === 'object') {
              if ('category' in ov) {
                const c = String(ov.category || '').trim();
                if (!c || M.isUnclassifiedCat(c) || stdSet.has(c)) {
                  delete ov.category;
                  dirty = true;
                }
              }
              if (ov.name) {
                const sn = stripAssetExt(ov.name);
                if (sn && sn !== ov.name) { ov.name = sn; dirty = true; }
              }
            }
          });
          m.ver = 2;
          try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (_) { }
          if (dirty) { metaVer++; Lib.commonCache = null; }
        }
        return m;
      }
    } catch (_) { }
    return { byUid: {}, order: [], ver: 2 };
  }
  function saveMeta(m) {
    metaVer++;
    Lib.commonCache = null;
    try { localStorage.setItem(META_KEY, JSON.stringify(Object.assign({}, m, { ver: 2 }))); } catch (_) { }
  }
  function invalidateCommonCache() {
    Lib.commonCache = null;
  }
  function commonAssetsSig() {
    const imgs = (typeof appState !== 'undefined' && Array.isArray(appState.imageAssets)) ? appState.imageAssets : null;
    const imgSig = imgs ? (imgs.length + ':' + (imgs[0] ? imgs[0].id : '') + ':' + (imgs[imgs.length - 1] ? imgs[imgs.length - 1].id : '')) : '0';
    return `${metaVer}|${Lib.root}|${Lib.scan ? Lib.scan.length : -1}|${Lib.webRefs ? Lib.webRefs.length : 0}|${Lib.tagsDone ? 1 : 0}|${imgSig}`;
  }
  function notifyCommon() {
    invalidateCommonCache();
    try { if (typeof renderGalleryAll === 'function') renderGalleryAll(); } catch (_) { }
    try { if (A() && A().refreshModal) A().refreshModal(); } catch (_) { }
    render();
  }

  function commonItems() {
    const sig = commonAssetsSig();
    if (Lib.commonCache && Lib.commonSig === sig) return Lib.commonCache;
    const meta = loadMeta(), out = [];
    let idx = 0;
    if (typeof appState !== 'undefined' && Array.isArray(appState.imageAssets)) {
      appState.imageAssets.forEach(a => {
        if (!a) return;
        const rawName = String(a.origName || a.name || '');
        if (/\.(txt|md)$/i.test(rawName)) return;
        if (!a.origName && a.name) a.origName = a.name;
        const dispName = stripAssetExt(a.name || rawName || 'image') || 'image';
        if (a.name && a.name !== dispName) a.name = dispName;
        const cat = normStdCat(a.category);
        const customTags = M.cleanTagList(a.tags);
        const tags = M.cleanTagList([...customTags, cat]);
        const blob = [dispName, a.origName, cat, ...tags, ...(Array.isArray(a.aliases) ? a.aliases : [])].filter(Boolean).join(' ').toLowerCase();
        out.push({ uid: 'cimg:' + a.id, rawId: a.id, srcType: 'cimg', type: 'image', name: dispName, origName: a.origName || dispName, path: '', dataUrl: a.dataUrl || '', category: cat, _normCat: cat, customTags, tags, blob, mtime: Number(a.mtime || a.addedAt || 0), addedOrder: idx++, missing: false, raw: a });
      });
    }
    const seenPath = new Set();
    if (IS_ELECTRON && Lib.root) {
      let scanned = Lib.scan;
      if (!scanned) {
        if (!scanAsyncPromise) {
          const targetRoot = Lib.root;
          void scanFilesAsync().then(() => {
            if (Lib.root === targetRoot && Lib.scan) notifyCommon();
          });
        }
        scanned = Array.isArray(Lib.lastScan) ? Lib.lastScan : [];
      }
      scanned.forEach(f => {
        const key = A() ? A().norm(f.full) : f.full.toLowerCase();
        if (seenPath.has(key)) return; seenPath.add(key);
        const uid = 'lib:' + key;
        const ov = meta.byUid[uid] || {};
        if (ov.hidden) return;
        const type = KINDS.img.test(f.name) ? 'image' : KINDS.video.test(f.name) ? 'video' : KINDS.audio.test(f.name) ? 'audio' : /\.pdf$/i.test(f.name) ? 'pdf' : KINDS.zip.test(f.name) ? 'zip' : 'doc';
        const cat = ov.category !== undefined ? normStdCat(ov.category) : normStdCat(f.category || '');
        const customTags = M.cleanTagList(ov.tags);
        const id3Tags = (type === 'audio' && A()) ? A().peekTags(f.full).tagStrings : [];
        const tags = M.cleanTagList([...customTags, ...id3Tags, cat]);
        const id3Blob = (type === 'audio' && A()) ? A().peekTags(f.full).blob : '';
        const name = stripAssetExt(ov.name || f.name) || f.name;
        const blob = [name, f.name, cat, f.parent, f.full, ...tags, id3Blob].filter(Boolean).join(' ').toLowerCase();
        out.push({ uid, rawId: f.full, srcType: 'lib', type, name, origName: f.name, path: f.full, dataUrl: '', category: cat, _normCat: cat, customTags, tags, blob, mtime: f.mtime || 0, addedOrder: idx++, missing: false });
      });
    }
    if (Array.isArray(Lib.webRefs) && Lib.webRefs.length) {
      Lib.webRefs.forEach(r => {
        if (!r || !r.uid) return;
        if (/\.(txt|md)$/i.test(String(r.origName || r.name || ''))) return;
        if (IS_ELECTRON && r.path && seenPath.has(A() ? A().norm(r.path) : r.path.toLowerCase())) return;
        if (!r.origName && r.name) r.origName = r.name;
        const cleanRNm = stripAssetExt(r.name || r.origName || '');
        if (r.name && cleanRNm && r.name !== cleanRNm) r.name = cleanRNm;
        const ov = meta.byUid[r.uid] || {};
        if (ov.hidden) return;
        const cat = ov.category !== undefined ? normStdCat(ov.category) : normStdCat(r.category || '');
        const customTags = M.cleanTagList(ov.tags);
        const tags = M.cleanTagList([...customTags, cat]);
        const name = stripAssetExt(ov.name || r.name || r.origName) || r.name;
        const blob = [name, r.origName, cat, r.rel, ...tags].filter(Boolean).join(' ').toLowerCase();
        out.push({ uid: r.uid, rawId: r.path || r.uid, srcType: 'lib', type: r.type || 'doc', name, origName: r.origName || r.name, path: r.path || '', dataUrl: '', category: cat, _normCat: cat, customTags, tags, blob, mtime: Number(r.mtime || 0), addedOrder: idx++, missing: false });
      });
    }
    if (meta.order && meta.order.length) {
      const rank = new Map(meta.order.map((u, i) => [u, i]));
      out.sort((a, b) => (rank.has(a.uid) ? rank.get(a.uid) : 1e9 + a.addedOrder) - (rank.has(b.uid) ? rank.get(b.uid) : 1e9 + b.addedOrder));
    }
    Lib.commonCache = out;
    Lib.commonSig = commonAssetsSig();
    return out;
  }

  window.CommonAssets = {
    getAll: commonItems,
    invalidate: invalidateCommonCache,
    sync: async (manual) => {
      if (!IS_ELECTRON) {
        if (manual) return syncWebCommonFolder(false);
        notifyCommon();
        return;
      }
      Lib.cache.clear(); Lib.scan = null; Lib.rootExists = false; Lib.tagsDone = false; invalidateCommonCache();
      if (A() && A().invalidateUnified) A().invalidateUnified(null, true);
      if (Lib.root) await scanFilesAsync();
      notifyCommon();
      if (manual) say('🔄 フォルダを再スキャンして共通ギャラリーを更新しました');
    },
    renameItem(uid, newName) {
      if (!newName) return false;
      if (uid.startsWith('cimg:') && typeof appState !== 'undefined') {
        if (window.AppHistory) window.AppHistory.checkpoint('共通素材の名前変更');
        const id = uid.slice(5), it = (appState.imageAssets || []).find(x => String(x.id) === id);
        if (it) { if (!it.origName) it.origName = it.name; it.name = newName; if (typeof saveState === 'function') saveState(); notifyCommon(); return true; }
      } else {
        const meta = loadMeta(); meta.byUid[uid] = Object.assign({}, meta.byUid[uid], { name: newName }); saveMeta(meta); notifyCommon(); return true;
      }
      return false;
    },
    setTags(uid, tags) {
      const clean = M.cleanTagList(tags);
      if (uid.startsWith('cimg:') && typeof appState !== 'undefined') {
        if (window.AppHistory) window.AppHistory.checkpoint('共通素材のタグ変更');
        const id = uid.slice(5), it = (appState.imageAssets || []).find(x => String(x.id) === id);
        if (it) { it.tags = clean; if (typeof saveState === 'function') saveState(); notifyCommon(); return true; }
      } else {
        const meta = loadMeta(); meta.byUid[uid] = Object.assign({}, meta.byUid[uid], { tags: clean }); saveMeta(meta); notifyCommon(); return true;
      }
      return false;
    },
    bulkUpdateTags(uids, tags, op) {
      uids = toArr(uids).filter(Boolean);
      const cleanTags = M.cleanTagList(tags);
      if (!cleanTags.length || !uids.length) return 0;
      const rmSet = new Set(cleanTags.map(t => t.toLowerCase()));
      const meta = loadMeta();
      let changedImg = false, changedMeta = false, count = 0;
      const apply = cur => {
        const c = M.cleanTagList(cur);
        const next = op === 'remove'
          ? c.filter(t => !rmSet.has(t.toLowerCase()))
          : M.cleanTagList([...c, ...cleanTags]);
        const diff = next.length !== c.length || next.some((v, i) => v !== c[i]);
        return { next, diff };
      };
      if (uids.some(u => u.startsWith('cimg:')) && window.AppHistory) {
        window.AppHistory.checkpoint(op === 'remove' ? '共通素材のタグを一括解除' : '共通素材にタグを一括追加');
      }
      uids.forEach(uid => {
        if (uid.startsWith('cimg:') && typeof appState !== 'undefined') {
          const id = uid.slice(5), it = (appState.imageAssets || []).find(x => String(x.id) === id);
          if (it) {
            const r = apply(it.tags);
            if (r.diff) { it.tags = r.next; changedImg = true; count++; }
          }
        } else if (uid.startsWith('lib:')) {
          const ov = meta.byUid[uid] || {};
          const r = apply(ov.tags);
          if (r.diff) { meta.byUid[uid] = Object.assign({}, ov, { tags: r.next }); changedMeta = true; count++; }
        }
      });
      if (changedMeta) saveMeta(meta);
      if (changedImg && typeof saveState === 'function') saveState();
      if (count) notifyCommon();
      return count;
    },
    moveItems(uids, folder) {
      uids = toArr(uids).filter(Boolean);
      if (!uids.length) return false;
      const dest = normStdCat(folder);
      const meta = loadMeta(); let changedImg = false;
      if (uids.some(u => u.startsWith('cimg:')) && window.AppHistory) window.AppHistory.checkpoint('共通素材のフォルダ移動');
      uids.forEach(uid => {
        if (uid.startsWith('cimg:') && typeof appState !== 'undefined') {
          const id = uid.slice(5), it = (appState.imageAssets || []).find(x => String(x.id) === id);
          if (it) { it.category = dest; changedImg = true; }
        } else {
          meta.byUid[uid] = Object.assign({}, meta.byUid[uid], { category: dest });
        }
      });
      if (dest && typeof appState !== 'undefined') { appState.commonCats = [...new Set([...(appState.commonCats || []), dest])]; changedImg = true; }
      saveMeta(meta);
      if (changedImg && typeof saveState === 'function') saveState();
      notifyCommon(); return true;
    },
    removeItems(uids, maybeUids) {
      const list = toArr(maybeUids !== undefined ? maybeUids : uids).filter(Boolean);
      if (!list.length) return false;
      const idSet = new Set(list), meta = loadMeta(); let changedImg = false;
      if (list.some(u => u.startsWith('cimg:')) && typeof appState !== 'undefined') {
        if (window.AppHistory) window.AppHistory.checkpoint('共通素材の削除');
        appState.imageAssets = (appState.imageAssets || []).filter(a => !idSet.has('cimg:' + a.id));
        changedImg = true;
      }
      let changedRefs = false;
      if (Array.isArray(Lib.webRefs) && Lib.webRefs.length) {
        const beforeLen = Lib.webRefs.length;
        Lib.webRefs = Lib.webRefs.filter(r => !r || !idSet.has(r.uid));
        changedRefs = Lib.webRefs.length !== beforeLen;
      }
      list.forEach(u => {
        if (u.startsWith('lib:') && !u.startsWith('lib:web:') && !u.startsWith('lib:ref:')) {
          meta.byUid[u] = Object.assign({}, meta.byUid[u], { hidden: true });
        }
      });
      if (changedRefs) saveWebRefs();
      saveMeta(meta);
      if (changedImg && typeof saveState === 'function') saveState();
      notifyCommon(); return true;
    },
    async addNonImageFiles(entries) {
      if (!Array.isArray(entries) || !entries.length) return 0;
      if (!Array.isArray(Lib.webRefs)) loadWebRefs();
      const meta = loadMeta();
      let added = 0, metaChanged = false;
      for (const ent of entries) {
        if (!ent || !ent.name) continue;
        const name = String(ent.name);
        const type = KINDS.video.test(name) ? 'video' : KINDS.audio.test(name) ? 'audio' : /\.pdf$/i.test(name) ? 'pdf' : KINDS.zip.test(name) ? 'zip' : '';
        if (!type) continue;
        const cat = normStdCat(ent.category || '');
        const mtime = Number(ent.mtime || (ent.file && ent.file.lastModified) || 0);
        const rel = String(ent.rel || name);
        let refPath = ent.path || '';
        let uid = '';
        if (IS_ELECTRON && refPath) {
          uid = 'lib:ref:' + (A() ? A().norm(refPath) : refPath.toLowerCase());
        } else if (ent.file && window.WebBridge && WebBridge.saveAssetFile) {
          refPath = await WebBridge.saveAssetFile(ent.file);
          if (!refPath) continue;
          const dupIdx = Lib.webRefs.findIndex(r => r && (r.origName || r.name || '').toLowerCase() === name.toLowerCase() && normStdCat(r.category) === cat);
          if (dupIdx >= 0) {
            Lib.webRefs[dupIdx] = Object.assign({}, Lib.webRefs[dupIdx], { path: refPath, mtime, category: cat, rel });
            added++;
            continue;
          }
          uid = 'lib:web:' + name.trim().toLowerCase() + ':' + M.newId();
        } else {
          continue;
        }
        if (meta.byUid[uid] && meta.byUid[uid].hidden) {
          delete meta.byUid[uid].hidden;
          metaChanged = true;
        }
        const idx = Lib.webRefs.findIndex(r => r && r.uid === uid);
        if (idx >= 0) {
          Lib.webRefs[idx] = Object.assign({}, Lib.webRefs[idx], { path: refPath, mtime, category: cat, rel });
        } else {
          Lib.webRefs.push({ uid, type, name: stripAssetExt(name), origName: name, path: refPath, category: cat, rel, mtime });
        }
        if (cat && typeof appState !== 'undefined') {
          appState.commonCats = [...new Set([...(appState.commonCats || []), cat])];
        }
        added++;
      }
      if (metaChanged) saveMeta(meta);
      if (added) {
        saveWebRefs();
        if (typeof saveState === 'function') saveState();
        invalidateCommonCache();
        notifyCommon();
      }
      return added;
    },
    reorderItems(dragUids, targetUid, insertAfter) {
      dragUids = toArr(dragUids).filter(Boolean);
      if (!dragUids.length || !targetUid) return false;
      const all = commonItems().map(x => x.uid);
      const mv = new Set(dragUids);
      if (mv.has(targetUid)) return false;
      const rest = all.filter(u => !mv.has(u)), moving = all.filter(u => mv.has(u));
      const idx = rest.indexOf(targetUid); if (idx < 0) return false;
      rest.splice(insertAfter ? idx + 1 : idx, 0, ...moving);
      const meta = loadMeta(); meta.order = rest; saveMeta(meta); notifyCommon(); return true;
    },
    setOrder(orderedUids) {
      const list = toArr(orderedUids).filter(Boolean);
      const meta = loadMeta(); meta.order = list; saveMeta(meta); notifyCommon(); return true;
    },
    // 階層対応：フォルダパスを一括で付け替える（改名・親フォルダ移動・削除時の退避すべてこれで処理）。fn: 正規化済みパス → 新パス
    remapFolders(fn, label) {
      const mapC = c => { const o = normStdCat(c); return o ? normStdCat(fn(o)) : o; };
      const items = commonItems();
      if (window.AppHistory) window.AppHistory.checkpoint(label || '共通フォルダの再編');
      const meta = loadMeta();
      let changedImg = false;
      if (typeof appState !== 'undefined' && appState) {
        appState.commonCats = [...new Set((appState.commonCats || []).map(mapC).filter(Boolean))];
        (appState.imageAssets || []).forEach(a => {
          if (!a) return;
          const o = normStdCat(a.category), n = o ? mapC(o) : o;
          if (n !== o) a.category = n;
        });
        changedImg = true;
      }
      Object.keys(meta.byUid).forEach(u => {
        const ov = meta.byUid[u];
        if (ov && ov.category) { const o = normStdCat(ov.category), n = mapC(o); if (n !== o) ov.category = n; }
      });
      items.forEach(it => {
        if (it.srcType !== 'lib') return;
        const ov = meta.byUid[it.uid] || {};
        if (ov.category !== undefined) return;
        const o = normStdCat(it.category), n = o ? mapC(o) : o;
        if (n !== o) meta.byUid[it.uid] = Object.assign({}, ov, { category: n });
      });
      saveMeta(meta);
      if (changedImg && typeof saveState === 'function') saveState();
      notifyCommon();
      return true;
    },
    renameFolder(oldName, newName) {
      return window.CommonAssets.remapFolders(c => (c === oldName || c.startsWith(oldName + '/')) ? newName + c.slice(oldName.length) : c, '共通フォルダ名変更');
    },
    // 削除：直下の素材は親フォルダ（無ければ未分類）へ、配下の小フォルダは親フォルダ直下へ繰り上げる
    deleteFolder(oldName) {
      const parent = oldName.includes('/') ? oldName.slice(0, oldName.lastIndexOf('/')) : '';
      return window.CommonAssets.remapFolders(c => c === oldName ? parent : (c.startsWith(oldName + '/') ? (parent ? parent + '/' : '') + c.slice(oldName.length + 1) : c), '共通フォルダ削除');
    },
    // ---- SHA-256 による「名前違い・中身同一」画像の判定／統合 ----
    // spec: { name, origName, dataUrl, category, tags, mtime, fromScenario:{id,title} } → { item, merged, uid }（保存・再描画は呼び出し側で flush()）
    async addImageDedup(spec) {
      if (typeof appState === 'undefined' || !appState || !spec || !spec.dataUrl) return null;
      appState.imageAssets = Array.isArray(appState.imageAssets) ? appState.imageAssets : [];
      const sha = window.ImageSha ? await window.ImageSha.ofSource(spec.dataUrl) : '';
      const nm = stripAssetExt(spec.name || spec.origName || 'image') || 'image';
      const cat = normStdCat(spec.category);
      const sc = spec.fromScenario;
      const markUsed = a => {
        if (!sc || sc.id == null) return;
        const arr = Array.isArray(a.usedIn) ? a.usedIn.filter(x => x && String(x.id) !== String(sc.id)) : [];
        arr.push({ id: String(sc.id), title: sc.title || '' });
        a.usedIn = arr;
      };
      let hit = null;
      if (sha && window.ImageSha) {
        for (const a of appState.imageAssets) {
          if (!a || !a.dataUrl) continue;
          if (a.dataUrl === spec.dataUrl || (await window.ImageSha.ofItem(a)) === sha) { hit = a; break; }
        }
      }
      if (hit) {
        const own = stripAssetExt(hit.name || hit.origName || '');
        if (nm && nm !== own) hit.aliases = [...new Set([...(hit.aliases || []), nm])].filter(x => x && x !== own);
        if (Array.isArray(spec.tags) && spec.tags.length) hit.tags = M.cleanTagList([...(hit.tags || []), ...spec.tags]);
        if (!normStdCat(hit.category) && cat) { hit.category = cat; appState.commonCats = [...new Set([...(appState.commonCats || []), cat])]; }
        markUsed(hit);
        return { item: hit, merged: true, uid: 'cimg:' + hit.id };
      }
      const item = { id: M.newId(), name: nm, origName: spec.origName || nm, dataUrl: spec.dataUrl, category: cat, tags: M.cleanTagList(spec.tags), mtime: Number(spec.mtime || 0), addedAt: Date.now() };
      markUsed(item);
      appState.imageAssets.push(item);
      if (cat) appState.commonCats = [...new Set([...(appState.commonCats || []), cat])];
      return { item, merged: false, uid: 'cimg:' + item.id };
    },
    flush() { if (typeof saveState === 'function') saveState(); notifyCommon(); },
    // list（appState.imageAssets / sc.images）から SHA-256 一致グループを検出。具体フォルダ（深い階層）・タグ数の多いものを残す側に選ぶ
    async planImageMerge(list) {
      const bySha = new Map();
      for (const a of (list || [])) {
        if (!a || !a.dataUrl || !window.ImageSha) continue;
        const sha = await window.ImageSha.ofItem(a);
        if (!sha) continue;
        if (!bySha.has(sha)) bySha.set(sha, []);
        bySha.get(sha).push(a);
      }
      const groups = [];
      bySha.forEach((arr, sha) => {
        if (arr.length < 2) return;
        const score = a => { const c = normStdCat(a.category); return [c ? 1 : 0, c ? c.split('/').length : 0, M.cleanTagList(a.tags).length]; };
        const sorted = arr.slice().sort((a, b) => {
          const sa = score(a), sb = score(b);
          for (let i = 0; i < 3; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
          return arr.indexOf(a) - arr.indexOf(b);
        });
        groups.push({ sha, keeper: sorted[0], others: sorted.slice(1) });
      });
      return groups;
    },
    // グループを統合（list を破壊的に更新）。戻り値: 旧uid→残すuid のマップ
    applyImageMerge(list, groups, prefix) {
      const map = {}, rm = new Set();
      groups.forEach(g => {
        const k = g.keeper, kname = stripAssetExt(k.name || k.origName || '');
        let cat = normStdCat(k.category), tags = M.cleanTagList(k.tags);
        const aliases = new Set(k.aliases || []), used = new Map();
        const addUsed = u => { if (!u) return; const o = (typeof u === 'object') ? u : { id: String(u), title: '' }; if (!used.has(String(o.id))) used.set(String(o.id), o); };
        (k.usedIn || []).forEach(addUsed);
        g.others.forEach(o => {
          tags = M.cleanTagList([...tags, ...M.cleanTagList(o.tags)]);
          const on = stripAssetExt(o.name || o.origName || '');
          if (on && on !== kname) aliases.add(on);
          (o.aliases || []).forEach(x => { if (x && x !== kname) aliases.add(x); });
          (o.usedIn || []).forEach(addUsed);
          if (!cat) cat = normStdCat(o.category);
          map[prefix + o.id] = prefix + k.id;
          rm.add(o);
        });
        k.tags = tags;
        if (cat && normStdCat(k.category) !== cat) k.category = cat;
        if (aliases.size) k.aliases = [...aliases];
        if (used.size) k.usedIn = [...used.values()];
      });
      list.splice(0, list.length, ...list.filter(a => !rm.has(a)));
      return map;
    },
    // 部屋データ・NPC立ち絵などの assetId / assetUid が旧uidを指していたら、残した素材のuidへ張り替える
    rewireAssetRefs(map, onlyScenarioKey) {
      const keys = Object.keys(map || {});
      if (!keys.length) return 0;
      let n = 0;
      const SKIP = new Set(['images', 'docs', 'assetCatalog', 'imageAssets']);
      const walk = root => {
        const seen = new Set();
        (function w(o, d, top) {
          if (!o || typeof o !== 'object' || d > 14 || seen.has(o)) return;
          seen.add(o);
          if (Array.isArray(o)) { o.forEach(v => w(v, d + 1, false)); return; }
          for (const k in o) {
            if (top && SKIP.has(k)) continue;
            const v = o[k];
            if (typeof v === 'string') { if ((k === 'assetId' || k === 'assetUid') && map[v]) { o[k] = map[v]; n++; } }
            else if (v && typeof v === 'object') w(v, d + 1, false);
          }
        })(root, 0, true);
      };
      const remapOrder = a => [...new Set((a || []).map(u => map[u] || u))];
      const scs = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : [];
      scs.forEach(sc => {
        if (!sc || (onlyScenarioKey && String(sc.id) !== String(onlyScenarioKey))) return;
        walk(sc);
        if (Array.isArray(sc.assetOrder)) sc.assetOrder = remapOrder(sc.assetOrder);
        try {
          if (CCF.readProject && CCF.withProject) {
            const pj = CCF.readProject(String(sc.id)), s = pj ? JSON.stringify(pj) : '';
            if (s && keys.some(k => s.includes(k))) CCF.withProject(String(sc.id), p => { walk(p); if (Array.isArray(p.assetOrder)) p.assetOrder = remapOrder(p.assetOrder); });
          }
        } catch (e) { if (typeof logSoft === 'function') logSoft('rewireAssetRefs', e); }
      });
      const meta = loadMeta();
      if (Array.isArray(meta.order) && meta.order.some(u => map[u])) { meta.order = remapOrder(meta.order); saveMeta(meta); }
      return n;
    },
    getCutinPackages() {
      const fromApp = (typeof appState !== 'undefined' && Array.isArray(appState.ccfCutinPackages)) ? appState.ccfCutinPackages : null;
      let fromLs = [];
      try { const raw = localStorage.getItem(CUTIN_PKG_KEY); if (raw) fromLs = JSON.parse(raw); } catch (_) { }
      const rawList = (fromApp && fromApp.length) ? fromApp : (Array.isArray(fromLs) ? fromLs : []);
      return rawList.map(M.sanitizeCutinPackage).filter(Boolean);
    },
    saveCutinPackage(cutin) {
      const pkg = M.sanitizeCutinPackage(Object.assign({}, cutin, { id: M.newId(), savedAt: Date.now() }));
      if (!pkg) return null;
      const list = this.getCutinPackages();
      list.unshift(pkg);
      if (typeof appState !== 'undefined') {
        if (window.AppHistory) window.AppHistory.checkpoint('カットインをマイライブラリに保存');
        appState.ccfCutinPackages = list;
        if (typeof saveState === 'function') saveState();
      }
      try { localStorage.setItem(CUTIN_PKG_KEY, JSON.stringify(list)); } catch (_) { }
      return pkg;
    },
    deleteCutinPackage(id) {
      const list = this.getCutinPackages().filter(x => x.id !== id);
      if (typeof appState !== 'undefined') {
        if (window.AppHistory) window.AppHistory.checkpoint('カットインパッケージ削除');
        appState.ccfCutinPackages = list;
        if (typeof saveState === 'function') saveState();
      }
      try { localStorage.setItem(CUTIN_PKG_KEY, JSON.stringify(list)); } catch (_) { }
      return list;
    }
  };

  // ================= フォルダツリー＆監視（旧版フォルダ除外） =================
  function readDir(dir) {
    if (Lib.cache.has(dir)) return Lib.cache.get(dir);
    let list = [];
    try {
      list = fs.readdirSync(dir, { withFileTypes: true }).filter(d => !d.name.startsWith('.') && d.name !== 'desktop.ini' && d.name !== 'Thumbs.db' && d.name !== 'node_modules' && d.name !== '_TRPG_Data' && d.name !== '__MACOSX' && !isOldVersionLib(d.name)).slice(0, MAX_ENTRIES).map(d => {
        const isDir = d.isDirectory();
        return { name: d.name, full: path.join(dir, d.name), isDir };
      });
    } catch (e) { list = [{ name: '（読み込めません：' + (e.code || e.message) + '）', full: '', isDir: false, err: true }]; }
    list.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'ja', { numeric: true }));
    Lib.cache.set(dir, list); return list;
  }
  const pad = d => `padding-left:${d * 16 + 8}px`;

  function zipNodesHtml(zipPath, z, node, depth) {
    return node.children.map(n => {
      if (n.dir) {
        const key = 'zip:' + zipPath + '!' + n.path, open = Lib.open.has(key);
        return `<div class="ccf-tr dir${open ? ' open' : ''}" style="${pad(depth)}" data-lib="toggle" data-key="${esc(key)}" title="${esc(n.path)}"><span class="ccf-caret">${open ? '▾' : '▸'}</span>📁 ${esc(n.name)}</div>` + (open ? zipNodesHtml(zipPath, z, n, depth + 1) : '');
      }
      const u = CCF.zip.url(z.id, n.path), isImg = CCF.zip.isImageName(n.name);
      return `<div class="ccf-tr file zfile" style="${pad(depth)}" draggable="true" data-lib="zfile" data-zipurl="${esc(u)}" data-name="${esc(n.name)}" title="${esc(zipPath + ' ▸ ' + n.path)}"><span class="ccf-caret"></span>${isImg ? `<img class="ccf-thumb" src="${esc(u)}" loading="lazy" decoding="async" alt="">` : nameIcon(n.name)} ${esc(n.name)}</div>`;
    }).join('');
  }
  function zipRowHtml(p, name, depth) {
    const open = isZipOpen(p), z = CCF.zip.cache.get(p);
    let inner = '';
    if (open) inner = Lib.loading.has(p) ? `<div class="ccf-tr err" style="${pad(depth + 1)}">読み込み中…</div>` : z ? (zipNodesHtml(p, z, z.tree, depth + 1) || `<div class="ccf-tr err" style="${pad(depth + 1)}">（空のZIP）</div>`) : `<div class="ccf-tr err" style="${pad(depth + 1)}">（開けませんでした）</div>`;
    return `<div class="ccf-tr dir zip${open ? ' open' : ''}" style="${pad(depth)}" data-lib="ztoggle" data-path="${esc(p)}" title="${esc(p)}（解凍せずに中身を表示します）"><span class="ccf-caret">${open ? '▾' : '▸'}</span>📦 ${esc(name)}</div>` + inner;
  }

  function treeHtml(dir, depth) {
    return readDir(dir).map(e => {
      if (e.err) return `<div class="ccf-tr err" style="${pad(depth)}">${esc(e.name)}</div>`;
      if (e.isDir) {
        const open = Lib.open.has(e.full);
        return `<div class="ccf-tr dir${open ? ' open' : ''}" style="${pad(depth)}" data-lib="toggle" data-key="${esc(e.full)}" title="${esc(e.full)}"><span class="ccf-caret">${open ? '▾' : '▸'}</span>📁 ${esc(e.name)}</div>` + (open ? treeHtml(e.full, depth + 1) : '');
      }
      if (KINDS.zip.test(e.name)) return zipRowHtml(e.full, e.name, depth);
      return `<div class="ccf-tr file${Lib.selected === e.full ? ' sel' : ''}" style="${pad(depth)}" draggable="true" data-lib="file" data-path="${esc(e.full)}" data-name="${esc(e.name)}" title="${esc(e.full)}"><span class="ccf-caret"></span>${nameIcon(e.name)} ${esc(e.name)}${KINDS.audio.test(e.name) && A() ? ' ' + A().tagBadges(e.full, null, true) + A().usageBadge(e.full) : ''}</div>`;
    }).join('');
  }

  // ---- 検索・タグ絞り込み（旧版除外・スマートカテゴリ・-除外語対応） ----
  const filtering = () => !!(Lib.q.trim() || Lib.tag || Lib.scn);
  function scanFiles() {
    if (Lib.scan) return Lib.scan;
    const files = []; let n = 0;
    Lib.rootExists = !!(Lib.root && fs.existsSync(Lib.root));
    if (!Lib.rootExists) return (Lib.scan = files);
    const rootNorm = path.basename(Lib.root);
    (function walk(dir, d) {
      if (d > 8 || n > MAX_SCAN) return; let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (typeof logSoft === 'function') logSoft('scanFilesDir', e); return; }
      const rawList = [];
      for (const e of es) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '_TRPG_Data' || e.name === '__MACOSX' || isOldVersionLib(e.name)) continue;
        const isDir = e.isDirectory();
        if (!isDir && (/\.(txt|md)$/i.test(e.name) || !(KINDS.audio.test(e.name) || KINDS.img.test(e.name) || KINDS.video.test(e.name) || KINDS.pdf.test(e.name) || KINDS.zip.test(e.name)))) continue;
        rawList.push({ e, name: e.name, isDir, mtime: 0 });
      }
      const filtered = filterLatestLib(rawList);
      for (const item of filtered) {
        if (n > MAX_SCAN) break;
        const full = path.join(dir, item.name);
        if (item.isDir) {
          walk(full, d + 1);
        } else {
          const parent = path.basename(dir);
          const isRootDir = d === 0;
          const folderName = isRootDir ? (rootNorm || (KINDS.audio.test(item.name) ? 'BGM' : '')) : parent;
          files.push({ full, name: item.name, parent: isRootDir ? '' : parent, category: folderName, mtime: 0 }); n++;
        }
      }
    })(Lib.root, 0);
    return (Lib.scan = files);
  }

  let scanAsyncPromise = null;
  async function scanFilesAsync() {
    if (Lib.scan) return Lib.scan;
    if (scanAsyncPromise) return scanAsyncPromise;
    if (!IS_ELECTRON || !fs || !Lib.root) return (Lib.scan = []);
    const targetRoot = Lib.root;
    scanAsyncPromise = (async () => {
      const files = []; let n = 0, dirOps = 0;
      try {
        await fs.promises.access(targetRoot);
        Lib.rootExists = true;
      } catch (_) {
        Lib.rootExists = false;
        if (Lib.root === targetRoot) Lib.scan = files;
        return files;
      }
      const rootNorm = path.basename(targetRoot);
      const walk = async (dir, d) => {
        if (d > 8 || n > MAX_SCAN || Lib.root !== targetRoot) return;
        let es;
        try { es = await fs.promises.readdir(dir, { withFileTypes: true }); }
        catch (e) { if (typeof logSoft === 'function') logSoft('scanFilesAsyncDir', e); return; }
        dirOps++;
        if (dirOps % 8 === 0) {
          if (isCloudSyncBusy()) await new Promise(r => deferUntilCloudIdle(r, 1000));
          else await new Promise(r => setTimeout(r, 0));
        }
        const rawList = [];
        for (const e of es) {
          if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '_TRPG_Data' || e.name === '__MACOSX' || isOldVersionLib(e.name)) continue;
          const isDir = e.isDirectory();
          if (!isDir && (/\.(txt|md)$/i.test(e.name) || !(KINDS.audio.test(e.name) || KINDS.img.test(e.name) || KINDS.video.test(e.name) || KINDS.pdf.test(e.name) || KINDS.zip.test(e.name)))) continue;
          rawList.push({ e, name: e.name, isDir, mtime: 0 });
        }
        const filtered = filterLatestLib(rawList);
        for (const item of filtered) {
          if (n > MAX_SCAN || Lib.root !== targetRoot) break;
          const full = path.join(dir, item.name);
          if (item.isDir) {
            await walk(full, d + 1);
          } else {
            const parent = path.basename(dir);
            const isRootDir = d === 0;
            const folderName = isRootDir ? (rootNorm || (KINDS.audio.test(item.name) ? 'BGM' : '')) : parent;
            files.push({ full, name: item.name, parent: isRootDir ? '' : parent, category: folderName, mtime: 0 }); n++;
          }
        }
      };
      await walk(targetRoot, 0);
      if (Lib.root === targetRoot) { Lib.scan = files; Lib.lastScan = files; }
      return files;
    })().finally(() => { scanAsyncPromise = null; });
    return scanAsyncPromise;
  }

  let tagging = false;
  const MAX_ID3_ON_DEMAND = 50;
  // ID3タグの自動一括走査を廃止し、表示中の音声カード／音声タブ（最大50件ずつ）のみをオンデマンドで軽量読み取りする
  function ensureAudioTags(itemsOrPaths) {
    if (!IS_ELECTRON || !A() || tagging) return;
    const list = Array.isArray(itemsOrPaths) ? itemsOrPaths : [];
    const paths = [], seen = new Set();
    for (const item of list) {
      const p = typeof item === 'string' ? item : (item && item.type === 'audio' ? item.path : '');
      if (!p || !KINDS.audio.test(p) || seen.has(p) || A().hasTags(p)) continue;
      seen.add(p);
      paths.push(p);
      if (paths.length >= MAX_ID3_ON_DEMAND) break;
    }
    if (!paths.length) return;
    tagging = true;
    const myGen = tagGen;
    let i = 0, parsedAny = false;
    const step = () => {
      if (myGen !== tagGen) { tagging = false; return; }
      const end = Math.min(paths.length, i + 5);
      try {
        for (; i < end; i++) {
          if (!A().hasTags(paths[i])) { A().tagsOf(paths[i]); parsedAny = true; }
        }
      } catch (e) { i = end; }
      if (i < paths.length) {
        setTimeout(step, 24);
      } else {
        tagging = false;
        if (parsedAny) {
          invalidateCommonCache();
          if (CCF.S && CCF.S.view === 'assets') renderAssetListOnly();
          try { if (document.body && document.body.dataset.activeTab === 'galleryTab' && typeof renderGalleryAll === 'function') renderGalleryAll(); } catch (_) { }
          try { if (A() && A().refreshModal) A().refreshModal(); } catch (_) { }
        }
      }
    };
    setTimeout(step, 0);
  }
  function ensureTags(arg) {
    if (Array.isArray(arg)) return ensureAudioTags(arg);
    if (CCF.S && CCF.S.view === 'assets' && Lib.typeFilter === 'audio') {
      ensureAudioTags(filteredItems().slice(0, MAX_ID3_ON_DEMAND));
    }
  }

  function currentSourceItems() {
    if (Lib.source === 'common') return window.CommonAssets ? window.CommonAssets.getAll() : [];
    return A() ? A().getUnifiedItems(S.key) : [];
  }
  function matchesTypeFilter(item, typeFilter) {
    if (!typeFilter) return true;
    if (typeFilter === 'doc') return item.type === 'pdf' || item.type === 'doc' || item.type === 'zip';
    return item.type === typeFilter;
  }
  function filteredItems() {
    const all = currentSourceItems();
    const parsed = M.parseSearchQuery(Lib.q);
    const fsel = Lib.refFolder;
    const tg = String(Lib.tag || '').trim().toLowerCase();
    return all.filter(r => {
      if (!matchesTypeFilter(r, Lib.typeFilter)) return false;
      const cat = A() ? A().normFolder(r.category) : (r.category || '');
      if (fsel === NONE ? !!cat : (fsel !== '*' && !inCatPath(cat, fsel))) return false;
      if (tg && !(r.tags || []).some(x => String(x).toLowerCase() === tg)) return false;
      if (Lib.q.trim()) {
        const blob = r.blob || [r.name, r.origName, cat, r.path, ...(r.tags || [])].filter(Boolean).join(' ').toLowerCase();
        if (!M.matchSearchQuery(blob, parsed)) return false;
      }
      return true;
    });
  }
  function collectCategories(allItems) {
    const stdAll = Array.isArray(M.STANDARD_SCENARIO_CATS) ? M.STANDARD_SCENARIO_CATS : ['トレーラー', 'NPC', '背景', '前景', 'マップ', '部屋素材'];
    const stdSet = new Set(stdAll);
    const std = Lib.source === 'scenario' ? stdAll : [];
    const extra = new Set();
    if (Lib.source === 'scenario' && A()) {
      A().foldersOf(S.proj, S.key).forEach(f => { if (f && !stdSet.has(f)) extra.add(f); });
    } else if (typeof appState !== 'undefined' && Array.isArray(appState.commonCats)) {
      appState.commonCats.forEach(f => { if (f) extra.add(f); });
    }
    (allItems || []).forEach(r => {
      const c = A() ? A().normFolder(r.category) : (r.category || '');
      if (c && (Lib.source !== 'scenario' || !stdSet.has(c))) extra.add(c);
    });
    const extraList = [...extra].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
    const validSet = new Set(['*', NONE, ...std, ...extraList]);
    return { std, extraList, validSet };
  }
  function catOptions(allItems, cats) {
    const { std, extraList } = cats || collectCategories(allItems);
    const countOf = val => (allItems || []).filter(r => {
      const c = A() ? A().normFolder(r.category) : (r.category || '');
      return val === NONE ? !c : inCatPath(c, val);
    }).length;
    return `<option value="*">カテゴリ：すべて</option>`
      + std.map(c => `<option value="${esc(c)}"${Lib.refFolder === c ? ' selected' : ''}>${esc(c)}（${countOf(c)}）</option>`).join('')
      + extraList.map(c => `<option value="${esc(c)}"${Lib.refFolder === c ? ' selected' : ''}>${esc(catPathLabel(c))}（${countOf(c)}）</option>`).join('')
      + `<option value="${NONE}"${Lib.refFolder === NONE ? ' selected' : ''}>（未分類）（${countOf(NONE)}）</option>`;
  }

  function renderAssetRow(r) {
    const folderLbl = A() ? A().folderLabel : (f => f || '（未分類）');
    if (r.type === 'zip' && r.path && (IS_ELECTRON || (window.WebBridge && WebBridge.isAssetRef(r.path)))) {
      return `<div class="ccf-asset-row is-zip"><div class="ccf-asset-main">${zipRowHtml(r.path, r.name, 0)}</div></div>`;
    }
    const src = resolveAssetImgSrc(r);
    const playKey = r.path || src;
    const play = r.type === 'audio' && playKey ? `<button type="button" class="ccf-mini${audioKey === playKey ? ' is-playing' : ''}" data-lib="play" data-path="${esc(playKey)}" title="試聴">${audioKey === playKey ? '■' : '▶'}</button>` : '';
    const thumb = r.type === 'image' && src
      ? (A() && A().assetImgTag ? A().assetImgTag(src, 'ccf-asset-thumb', 'loading="lazy" decoding="async" alt=""') : `<img class="ccf-asset-thumb" src="${esc(src)}" loading="lazy" decoding="async" alt="">`)
      : `<span class="ccf-asset-ico">${nameIcon(r.name)}</span>`;
    const tagsHtml = A() ? A().tagBadges(r.path, r.customTags, true) : '';
    const usageHtml = (r.type === 'audio' && r.path && A()) ? A().usageBadge(r.path) : '';
    return `<div class="ccf-asset-row${r.missing ? ' missing' : ''}" draggable="true" data-lib="file" data-uid="${esc(r.uid)}" data-path="${esc(r.path || '')}" data-name="${esc(r.name)}" title="${esc(r.path || r.name)}${r.missing ? '（ファイルが見つかりません）' : ''}">
      ${thumb}
      <div class="ccf-asset-main">
        <div class="ccf-asset-top">
          <span class="ccf-asset-name">${esc(r.name)}${r.missing ? ' ⚠️' : ''}</span>
          <span class="ccf-asset-cat">📁 ${esc(folderLbl(r.category))}</span>
        </div>
        ${(tagsHtml || usageHtml) ? `<div class="ccf-asset-meta">${tagsHtml}${usageHtml}</div>` : ''}
      </div>
      ${play ? `<div class="ccf-asset-acts">${play}</div>` : ''}
    </div>`;
  }

  function assetListHtml(vis, allSourceItems) {
    if (listObs) { try { listObs.disconnect(); } catch (_) { } listObs = null; }
    listPager = null;
    folderPagers.clear();
    if (!vis.length) {
      if (!allSourceItems.length) {
        if (Lib.source === 'common') {
          return IS_ELECTRON && !Lib.root
            ? '<div class="ccf-empty">マイライブラリ（共通素材）がありません。<br>上の「📂 フォルダ選択」から共通素材フォルダを選ぶか、フォルダをここへドロップすると自動同期します。</div>'
            : '<div class="ccf-empty">マイライブラリ（共通素材）がまだありません。「📥 追加」から画像を追加できます。</div>';
        }
        return '<div class="ccf-empty">このシナリオに登録された素材がありません。<br>上の「📥 追加」または PDF・BGM・フォルダのドラッグ＆ドロップで登録できます。</div>';
      }
      return '<div class="ccf-empty">条件に一致する素材がありません。種類・カテゴリ・検索語を見直してください。</div>';
    }
    if (Lib.viewMode === 'folder') {
      const normF = A() ? A().normFolder : (c => c || '');
      const folderLbl = A() ? A().folderLabel : (f => f || '（未分類）');
      const groups = new Map();
      vis.forEach(r => {
        const key = normF(r.category) || NONE;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      });
      const keys = [...groups.keys()].sort((a, b) => {
        if (a === NONE) return 1;
        if (b === NONE) return -1;
        return a.localeCompare(b, 'ja', { numeric: true });
      });
      const forceOpen = !!(Lib.q.trim() || Lib.tag || Lib.refFolder !== '*');
      const audioOnDemand = [];
      const html = keys.map(fk => {
        const list = groups.get(fk) || [];
        const label = fk === NONE ? '（未分類）' : folderLbl(fk);
        const open = forceOpen || Lib.refOpen.has(fk);
        const catDrop = fk === NONE ? '' : fk;
        const thumbs = !open ? list.slice(0, 4).map(r => {
          const src = r.type === 'image' ? resolveAssetImgSrc(r) : '';
          return r.type === 'image' && src
            ? (A() && A().assetImgTag ? A().assetImgTag(src, 'ccf-folder-miniimg', 'loading="lazy" decoding="async" alt=""') : `<img class="ccf-folder-miniimg" src="${esc(src)}" loading="lazy" decoding="async" alt="">`)
            : `<span class="ccf-folder-miniico">${nameIcon(r.name)}</span>`;
        }).join('') : '';
        let bodyHtml = '';
        if (open) {
          const initCnt = Math.min(PAGE_SIZE, list.length);
          const chunk = list.slice(0, initCnt);
          if (audioOnDemand.length < MAX_ID3_ON_DEMAND) {
            chunk.forEach(r => { if (r.type === 'audio' && r.path && audioOnDemand.length < MAX_ID3_ON_DEMAND) audioOnDemand.push(r); });
          }
          const rem = list.length - initCnt;
          const moreHtml = rem > 0
            ? `<div class="ccf-more-wrap" data-lib-morewrap="folder" data-folder="${esc(fk)}"><button type="button" class="ccf-btn" data-lib="fmore" data-folder="${esc(fk)}">さらに${PAGE_SIZE}件を表示（残り${rem}件）</button></div>`
            : '';
          if (rem > 0) folderPagers.set(fk, { list, offset: initCnt });
          bodyHtml = `<div class="ccf-folder-body">${chunk.map(renderAssetRow).join('')}${moreHtml}</div>`;
        }
        return `<div class="ccf-folder-sec${open ? ' open' : ''}">
          <button type="button" class="ccf-folder-head" data-lib="foldertoggle" data-folder="${esc(fk)}" data-libdrop="refcat" data-cat="${esc(catDrop)}" aria-expanded="${open}">
            <span class="ccf-caret">${open ? '▾' : '▸'}</span>
            <span class="ccf-folder-title">📁 ${esc(label)}</span>
            <span class="ccf-folder-cnt">(${list.length})</span>
            ${thumbs ? `<span class="ccf-folder-thumbs">${thumbs}</span>` : ''}
          </button>
          ${bodyHtml}
        </div>`;
      }).join('');
      if (audioOnDemand.length) setTimeout(() => ensureAudioTags(audioOnDemand), 0);
      return html;
    }
    const initCnt = Math.min(PAGE_SIZE, vis.length);
    const chunk = vis.slice(0, initCnt);
    const rem = vis.length - initCnt;
    const moreHtml = rem > 0
      ? `<div class="ccf-more-wrap" data-lib-morewrap="list"><button type="button" class="ccf-btn" data-lib="loadmore">さらに${PAGE_SIZE}件を表示（残り${rem}件）</button></div>`
      : '';
    if (rem > 0) listPager = { list: vis, offset: initCnt };
    if (IS_ELECTRON && chunk.some(r => r.type === 'audio' && r.path)) {
      setTimeout(() => ensureAudioTags(chunk), 0);
    }
    return chunk.map(renderAssetRow).join('') + moreHtml;
  }

  function appendListMore() {
    const body = $('ccfTrayBody');
    if (!body || !listPager || listPager.offset >= listPager.list.length) return;
    const wrap = body.querySelector('[data-lib-morewrap="list"]');
    if (!wrap) return;
    const chunk = listPager.list.slice(listPager.offset, listPager.offset + PAGE_SIZE);
    wrap.insertAdjacentHTML('beforebegin', chunk.map(renderAssetRow).join(''));
    if (IS_ELECTRON && chunk.some(r => r.type === 'audio' && r.path)) {
      setTimeout(() => ensureAudioTags(chunk), 0);
    }
    listPager.offset += chunk.length;
    const rem = listPager.list.length - listPager.offset;
    if (rem <= 0) {
      if (listObs) { try { listObs.unobserve(wrap); } catch (_) { } }
      wrap.remove();
      listPager = null;
    } else {
      const btn = wrap.querySelector('[data-lib="loadmore"]');
      if (btn) btn.textContent = `さらに${PAGE_SIZE}件を表示（残り${rem}件）`;
    }
    if (A() && A().fillCloudAssetsIn) void A().fillCloudAssetsIn(body);
  }

  function appendFolderMore(fk) {
    const body = $('ccfTrayBody');
    const st = folderPagers.get(fk);
    if (!body || !st || st.offset >= st.list.length) return;
    const wrap = Array.from(body.querySelectorAll('[data-lib-morewrap="folder"]')).find(w => w.dataset.folder === fk);
    if (!wrap) return;
    const chunk = st.list.slice(st.offset, st.offset + PAGE_SIZE);
    wrap.insertAdjacentHTML('beforebegin', chunk.map(renderAssetRow).join(''));
    if (IS_ELECTRON && chunk.some(r => r.type === 'audio' && r.path)) {
      setTimeout(() => ensureAudioTags(chunk), 0);
    }
    st.offset += chunk.length;
    const rem = st.list.length - st.offset;
    if (rem <= 0) {
      if (listObs) { try { listObs.unobserve(wrap); } catch (_) { } }
      wrap.remove();
      folderPagers.delete(fk);
    } else {
      const btn = wrap.querySelector('[data-lib="fmore"]');
      if (btn) btn.textContent = `さらに${PAGE_SIZE}件を表示（残り${rem}件）`;
    }
    if (A() && A().fillCloudAssetsIn) void A().fillCloudAssetsIn(body);
  }

  function attachListPager(listEl) {
    if (listObs) { try { listObs.disconnect(); } catch (_) { } listObs = null; }
    if (!listEl || typeof IntersectionObserver !== 'function') return;
    const wraps = listEl.querySelectorAll('[data-lib-morewrap]');
    if (!wraps.length) return;
    listObs = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const w = en.target;
        if (w.dataset.libMorewrap === 'list') appendListMore();
        else if (w.dataset.libMorewrap === 'folder') appendFolderMore(w.dataset.folder || NONE);
      });
    }, { root: listEl, rootMargin: '160px' });
    wraps.forEach(w => listObs.observe(w));
  }

  function syncBulkControls(vis) {
    const body = $('ccfTrayBody'); if (!body) return;
    const list = vis || filteredItems();
    const visAllSel = list.length > 0 && list.every(r => Lib.sel.has(r.uid));
    const allChk = body.querySelector('[data-lib="refall"]');
    if (allChk) { allChk.checked = visAllSel; allChk.disabled = !list.length; }
    const hasSel = Lib.sel.size > 0;
    const tagAdd = body.querySelector('[data-lib="tagadd"]'); if (tagAdd) tagAdd.disabled = !hasSel;
    const tagRm = body.querySelector('[data-lib="tagrm"]'); if (tagRm) tagRm.disabled = !hasSel;
    const delBtn = body.querySelector('[data-lib="refbulk"]');
    if (delBtn) {
      delBtn.disabled = !hasSel;
      delBtn.textContent = hasSel ? `🗑️ 選択を削除（${Lib.sel.size}）` : '🗑️ 選択を削除';
    }
  }

  function renderAssetListOnly() {
    const body = $('ccfTrayBody'); if (!body) return;
    if (CCF.S && CCF.S.view !== 'assets') return;
    const listEl = body.querySelector('.ccf-assets-list');
    if (!listEl) return render();
    const all = currentSourceItems();
    const vis = filteredItems();
    const keepTop = listEl.scrollTop;
    listEl.classList.toggle('is-folder-mode', Lib.viewMode === 'folder');
    listEl.innerHTML = assetListHtml(vis, all);
    listEl.scrollTop = keepTop;
    attachListPager(listEl);
    const hitEl = body.querySelector('#ccfAssetsHit');
    if (hitEl) hitEl.textContent = (vis.length === all.length ? `${all.length}件` : `${vis.length} / ${all.length}件`);
    syncBulkControls(vis);
    if (typeof CCF.updateAssetCount === 'function') CCF.updateAssetCount();
    if (A() && A().fillCloudAssetsIn) void A().fillCloudAssetsIn(body);
  }

  function refreshTree() { renderAssetListOnly(); }
  function refreshTagOptions() { }

  function render(force) {
    const body = $('ccfTrayBody'); if (!body) return;
    if (!force && CCF.S && CCF.S.view !== 'assets') return;
    const prevList = body.querySelector('.ccf-assets-list');
    const keepTop = prevList ? prevList.scrollTop : 0;
    const qInput = body.querySelector('[data-lib-q]');
    const hadQFocus = qInput && document.activeElement === qInput;
    const qSelStart = hadQFocus ? qInput.selectionStart : null;

    const scnItems = A() ? A().getUnifiedItems(S.key) : [];
    const commonList = window.CommonAssets ? window.CommonAssets.getAll() : [];
    const allSourceItems = Lib.source === 'common' ? commonList : scnItems;
    const liveIds = new Set(allSourceItems.map(r => r.uid));
    [...Lib.sel].forEach(uid => { if (!liveIds.has(uid)) Lib.sel.delete(uid); });
    const cats = collectCategories(allSourceItems);
    if (!cats.validSet.has(Lib.refFolder)) Lib.refFolder = '*';

    const vis = filteredItems();
    const hitText = vis.length === allSourceItems.length ? `${allSourceItems.length}件` : `${vis.length} / ${allSourceItems.length}件`;
    const dropCat = (Lib.refFolder === '*' || Lib.refFolder === NONE) ? '' : Lib.refFolder;

    const srcBar = `<div class="ccf-assets-srcbar">
      <div class="ccf-src-pills" role="tablist" aria-label="素材ソース切替">
        <button type="button" role="tab" class="ccf-src-pill${Lib.source === 'scenario' ? ' active' : ''}" data-lib="src:scenario" aria-selected="${Lib.source === 'scenario'}">📌 このシナリオの素材 <span class="ccf-src-cnt">(${scnItems.length})</span></button>
        <button type="button" role="tab" class="ccf-src-pill${Lib.source === 'common' ? ' active' : ''}" data-lib="src:common" aria-selected="${Lib.source === 'common'}">🌍 マイライブラリ（共通素材） <span class="ccf-src-cnt">(${commonList.length})</span></button>
      </div>
      ${Lib.source === 'common' ? `<div class="ccf-lib-watchmini">
        <span class="ccf-muted" title="${esc(Lib.root || '監視フォルダ未設定')}">${Lib.root ? '📁 ' + esc(baseOfPath(Lib.root)) : '📁 監視フォルダ未設定'}</span>
        <button type="button" class="ccf-mini" data-lib="pick" title="共通素材監視フォルダを選択・変更">${Lib.root ? '変更' : '📂 フォルダ選択'}</button>
        <button type="button" class="ccf-mini" data-lib="sync" title="監視フォルダを同期">🔄</button>
        ${Lib.root ? `${IS_ELECTRON ? '<button type="button" class="ccf-mini" data-lib="reveal" title="監視フォルダを開く">開く</button>' : ''}<button type="button" class="ccf-mini danger" data-lib="unwatch" title="監視フォルダの設定を解除">✕ 監視解除</button>` : ''}
      </div>` : ''}
    </div>`;

    const filterBar = `<div class="ccf-assets-filterbar">
      <select data-libsel="type" aria-label="種類で絞り込み">
        <option value=""${Lib.typeFilter === '' ? ' selected' : ''}>種類：すべて</option>
        <option value="image"${Lib.typeFilter === 'image' ? ' selected' : ''}>🖼️ 画像</option>
        <option value="audio"${Lib.typeFilter === 'audio' ? ' selected' : ''}>🎵 音声</option>
        <option value="video"${Lib.typeFilter === 'video' ? ' selected' : ''}>🎬 動画</option>
        <option value="doc"${Lib.typeFilter === 'doc' ? ' selected' : ''}>📄 資料</option>
      </select>
      <select data-libsel="reffolder" aria-label="カテゴリで絞り込み">
        ${catOptions(allSourceItems, cats)}
      </select>
      <input type="search" class="ccf-assets-q" data-lib-q="1" value="${esc(Lib.q)}" placeholder="🔍 名前・タグ検索（例: 洋館 夜 -BGM）" aria-label="名前・タグ検索">
      <div class="ccf-view-toggle" role="group" aria-label="表示切替">
        <button type="button" class="ccf-mini${Lib.viewMode === 'folder' ? ' active' : ''}" data-lib="view:folder" title="フォルダごとにまとめて表示">📁 フォルダ別</button>
        <button type="button" class="ccf-mini${Lib.viewMode === 'list' ? ' active' : ''}" data-lib="view:list" title="すべてを一覧表示">🖼️ 一覧</button>
      </div>
      ${Lib.tag ? `<button type="button" class="ccf-tag-active" data-lib="cleartag" title="クリックでタグ絞り込みを解除">🏷️ ${esc(Lib.tag)} ✕</button>` : ''}
      <span class="ccf-muted ccf-assets-hit" id="ccfAssetsHit">${hitText}</span>
    </div>`;

    body.innerHTML = `${srcBar}${filterBar}
      <div class="ccf-assets-list${Lib.viewMode === 'folder' ? ' is-folder-mode' : ''}" data-libdrop="refcat" data-cat="${esc(dropCat)}">${assetListHtml(vis, allSourceItems)}</div>`;

    const newList = body.querySelector('.ccf-assets-list');
    if (newList) { newList.scrollTop = keepTop; attachListPager(newList); }
    if (hadQFocus) {
      const nq = body.querySelector('[data-lib-q]');
      if (nq) {
        nq.focus();
        if (qSelStart != null) { try { nq.setSelectionRange(qSelStart, qSelStart); } catch (_) { } }
      }
    }
    if (typeof CCF.updateAssetCount === 'function') CCF.updateAssetCount();
    if (A() && A().fillCloudAssetsIn) void A().fillCloudAssetsIn(body);
  }

  // ---- fs.watch（マイライブラリ監視） ----
  function stopWatch() {
    if (libWatchTimer) { clearTimeout(libWatchTimer); libWatchTimer = null; }
    if (watcher) { try { watcher.close(); } catch (_) { } watcher = null; }
  }
  function startWatch() {
    stopWatch();
    if (!IS_ELECTRON || !Lib.root || !fs.existsSync(Lib.root)) return;
    try {
      watcher = fs.watch(Lib.root, { recursive: true }, (_ev, fname) => {
        if (isSyncingLib || isSyncingScn || Date.now() < ignoreWatchUntil) return;
        if (shouldIgnoreWatchPath(fname)) return;
        clearTimeout(libWatchTimer);
        const runLibWatch = () => {
          libWatchTimer = null;
          if (isSyncingLib || isSyncingScn || Date.now() < ignoreWatchUntil) return;
          if (isCloudSyncBusy()) {
            deferUntilCloudIdle(() => {
              if (!libWatchTimer) libWatchTimer = setTimeout(runLibWatch, 800);
            }, 1500);
            return;
          }
          isSyncingLib = true;
          try {
            Lib.cache.clear(); Lib.scan = null; Lib.rootExists = false; Lib.tagsDone = false; invalidateCommonCache();
            if (A() && A().invalidateUnified) A().invalidateUnified(null, true);
            if ((CCF.S && CCF.S.view === 'assets') || document.querySelector('.ccf-am-ov') || (document.body && document.body.dataset.activeTab === 'galleryTab')) {
              void scanFilesAsync().then(() => notifyCommon());
            }
          } finally {
            isSyncingLib = false;
            ignoreWatchUntil = Date.now() + 1500;
          }
        };
        libWatchTimer = setTimeout(runLibWatch, 1600);
      });
    } catch (e) {
      if (typeof logSoft === 'function') logSoft('libWatch', e);
    }
  }

  function saveWatchFoldersToState(skipSave) {
    try {
      if (Lib.root) {
        localStorage.setItem('ccf_library_root', Lib.root);
        localStorage.setItem('ccf_lib_root', Lib.root);
      } else {
        localStorage.removeItem('ccf_library_root');
        localStorage.removeItem('ccf_lib_root');
      }
      if (Lib.scnWatch) {
        localStorage.setItem('ccf_scenario_watch_root', Lib.scnWatch);
        localStorage.setItem('ccf_scn_watch_root', Lib.scnWatch);
      } else {
        localStorage.removeItem('ccf_scenario_watch_root');
        localStorage.removeItem('ccf_scn_watch_root');
      }
    } catch (_) { }
    if (typeof appState !== 'undefined' && appState) {
      appState.watchFolders = { commonRoot: Lib.root || '', scenarioRoot: Lib.scnWatch || '' };
      if (!skipSave && typeof saveState === 'function') saveState(true);
    }
  }
  function loadWebRefs() {
    try {
      const raw = localStorage.getItem(WEB_COMMON_REFS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      Lib.webRefs = Array.isArray(parsed) ? parsed : [];
    } catch (_) { Lib.webRefs = []; }
  }
  function saveWebRefs() {
    try { localStorage.setItem(WEB_COMMON_REFS_KEY, JSON.stringify(Lib.webRefs || [])); } catch (_) { }
  }
  async function webKvGet(key) {
    if (typeof window.idbGetRaw === 'function') return window.idbGetRaw(key);
    if (window.WebBridge && typeof WebBridge.kvGet === 'function') return WebBridge.kvGet(key);
    return null;
  }
  async function webKvSet(key, val) {
    if (typeof window.idbSetRaw === 'function') return window.idbSetRaw(key, val);
    if (window.WebBridge && typeof WebBridge.kvSet === 'function') return WebBridge.kvSet(key, val);
  }
  async function webFileToDataUrl(f) {
    if (typeof compressImage === 'function') {
      try { const u = await compressImage(f, 1000, 1000, 0.82); if (u) return typeof urlToRef === 'function' ? urlToRef(u) : u; } catch (_) { }
    }
    if (typeof imageFileToDataUrl === 'function') {
      try { const u = await imageFileToDataUrl(f); if (u) return typeof urlToRef === 'function' ? urlToRef(u) : u; } catch (_) { }
    }
    return new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => { const u = String(fr.result || ''); res(u && typeof urlToRef === 'function' ? urlToRef(u) : u); };
      fr.onerror = () => res('');
      fr.readAsDataURL(f);
    });
  }
  async function importWebCommonFiles(fileEntries, rootName) {
    if (typeof appState === 'undefined' || !appState) return { added: 0, updated: 0, skipped: 0 };
    appState.imageAssets = Array.isArray(appState.imageAssets) ? appState.imageAssets : [];
    appState.commonCats = Array.isArray(appState.commonCats) ? appState.commonCats : ['未分類', '背景', 'パネル'];
    if (!Array.isArray(Lib.webRefs)) loadWebRefs();

    const byImgName = new Map();
    appState.imageAssets.forEach((a, i) => {
      if (!a) return;
      const k = String(a.origName || a.name || '').trim().toLowerCase();
      if (k && !byImgName.has(k)) byImgName.set(k, i);
    });
    const byRefName = new Map();
    Lib.webRefs.forEach((r, i) => {
      if (!r) return;
      const k = String(r.origName || r.name || '').trim().toLowerCase();
      if (k && !byRefName.has(k)) byRefName.set(k, i);
    });

    let added = 0, updated = 0, skipped = 0;
    for (const ent of (fileEntries || [])) {
      const f = ent && (ent.file || ent);
      if (!f || !f.name) continue;
      const rel = String((ent && ent.rel) || f.webkitRelativePath || f.name);
      const parts = rel.split('/').filter(Boolean);
      if (parts.some(p => p.startsWith('.') || p === 'node_modules' || p === '__MACOSX' || p === '_TRPG_Data' || M.isOldFolderName(p))) continue;
      if (/\.(txt|md)$/i.test(f.name)) continue;
      const isImg = KINDS.img.test(f.name);
      const type = isImg ? 'image' : KINDS.video.test(f.name) ? 'video' : KINDS.audio.test(f.name) ? 'audio' : /\.pdf$/i.test(f.name) ? 'pdf' : KINDS.zip.test(f.name) ? 'zip' : '';
      if (!type) continue;
      const parent = parts.length >= 2 ? parts[parts.length - 2] : '';
      const cat = normStdCat((parent && parent !== rootName) ? parent : (type === 'audio' ? 'BGM' : ''));
      const mtime = Number(f.lastModified || 0);
      const key = f.name.trim().toLowerCase();

      if (isImg) {
        if (byImgName.has(key)) {
          const idx = byImgName.get(key), cur = appState.imageAssets[idx];
          if (!mtime || !cur.mtime || mtime <= cur.mtime) { skipped++; continue; }
          const du = await webFileToDataUrl(f);
          if (du) {
            appState.imageAssets[idx] = Object.assign({}, cur, { dataUrl: du, mtime, category: cat || cur.category || '' });
            updated++;
          }
          continue;
        }
        const du = await webFileToDataUrl(f);
        if (du) {
          if (cat && !appState.commonCats.includes(cat)) appState.commonCats.push(cat);
          byImgName.set(key, appState.imageAssets.length);
          appState.imageAssets.push({ id: M.newId(), name: f.name, origName: f.name, dataUrl: du, category: cat, tags: [], mtime, addedAt: Date.now() });
          added++;
        }
      } else if (window.WebBridge && WebBridge.saveAssetFile) {
        if (byRefName.has(key)) {
          const idx = byRefName.get(key), cur = Lib.webRefs[idx];
          if (!mtime || !cur.mtime || mtime <= cur.mtime) { skipped++; continue; }
          const ref = await WebBridge.saveAssetFile(f);
          if (ref) {
            Lib.webRefs[idx] = Object.assign({}, cur, { path: ref, mtime, category: cat || cur.category || '', rel });
            updated++;
          }
          continue;
        }
        const ref = await WebBridge.saveAssetFile(f);
        if (ref) {
          if (cat && !appState.commonCats.includes(cat)) appState.commonCats.push(cat);
          const uid = 'lib:web:' + key + ':' + M.newId();
          byRefName.set(key, Lib.webRefs.length);
          Lib.webRefs.push({ uid, type, name: f.name, origName: f.name, path: ref, category: cat, rel, mtime });
          added++;
        }
      }
    }
    if (added || updated) {
      if (typeof saveState === 'function') saveState();
      saveWebRefs();
    }
    invalidateCommonCache();
    notifyCommon();
    say(`🔄 同期完了：新規 ${added}件 / 更新 ${updated}件（スキップ ${skipped}件）`);
    return { added, updated, skipped };
  }
  async function pickWebCommonFolder() {
    if (!window.WebBridge || !WebBridge.pickDirectory) return '';
    const picked = await WebBridge.pickDirectory({});
    if (!picked || !picked.files) return '';
    if (picked.handle) {
      try { await webKvSet(WEB_COMMON_HANDLE_KEY, picked.handle); } catch (_) { }
    }
    Lib.root = picked.rootName || 'ブラウザ監視フォルダ';
    saveWatchFoldersToState();
    await importWebCommonFiles(picked.files, Lib.root);
    return Lib.root;
  }
  async function syncWebCommonFolder(forcePick) {
    if (!window.WebBridge) return;
    const canPicker = typeof window.showDirectoryPicker === 'function' && /^https?:$/i.test(location.protocol);
    if (!forcePick && canPicker) {
      let handle = null;
      try { handle = await webKvGet(WEB_COMMON_HANDLE_KEY); } catch (_) { handle = null; }
      if (handle) {
        try {
          let perm = await handle.queryPermission({ mode: 'read' });
          if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
          if (perm === 'granted') {
            Lib.root = handle.name || Lib.root || 'ブラウザ監視フォルダ';
            saveWatchFoldersToState();
            const files = await WebBridge.walkDirHandle(handle, handle.name);
            return importWebCommonFiles(files, Lib.root);
          }
        } catch (_) { }
      }
    }
    return pickWebCommonFolder();
  }

  function clearRoot() {
    stopWatch();
    tagGen++; tagging = false;
    Lib.root = ''; Lib.cache.clear(); Lib.open.clear(); Lib.scan = null; Lib.webRefs = []; Lib.rootExists = false; Lib.tagsDone = false;
    try { localStorage.removeItem(WEB_COMMON_REFS_KEY); } catch (_) { }
    if (!IS_ELECTRON) { try { void webKvSet(WEB_COMMON_HANDLE_KEY, null); } catch (_) { } }
    saveWatchFoldersToState();
    invalidateCommonCache();
    if (A() && A().invalidateUnified) A().invalidateUnified(null, true);
    notifyCommon();
  }
  async function unwatchRoot() {
    if (!Lib.root) return false;
    const label = baseOfPath(Lib.root);
    const msg = `素材監視フォルダ「${label}」の監視を解除しますか？\n（PC上の元ファイルは削除されません。手動追加した画像は残ります）`;
    if (typeof appConfirm === 'function' && !(await appConfirm(msg, { title: '素材監視フォルダの解除', okText: '監視解除', danger: true }))) return false;
    clearRoot();
    say('🛑 素材監視フォルダの監視を解除しました');
    return true;
  }

  async function syncScenarioWatch(manual) {
    if (!IS_ELECTRON || !Lib.scnWatch || !fs.existsSync(Lib.scnWatch)) return 0;
    if (isSyncingScn) return 0;
    isSyncingScn = true;
    if (typeof window.beginSuppressDetailEdited === 'function') window.beginSuppressDetailEdited();
    try {
      const dnd = CCF.dnd;
      const isCatDir = name => (dnd && typeof dnd.isCategoryFolderName === 'function') ? dnd.isCategoryFolderName(name) : (M && M.isCategoryFolderName ? M.isCategoryFolderName(name) : false);
      const isDocNm = (name, type) => (dnd && typeof dnd.isDocAssetName === 'function') ? (type === 'pdf' || type === 'doc' || dnd.isDocAssetName(name)) : (type === 'pdf' || type === 'doc' || /\.(pdf|txt|html?|md|docx?)$/i.test(String(name || '')));
      const normPathKey = p => String(p || '').replace(/\//g, '\\').trim().toLowerCase();
      const normFileKey = n => String(n || '').normalize('NFKC').trim().toLowerCase();

      const entries = (dnd && typeof dnd.discoverScenarioEntries === 'function')
        ? dnd.discoverScenarioEntries(Lib.scnWatch, { maxDepth: 5, isWatchRoot: true })
        : fs.readdirSync(Lib.scnWatch, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.') && !M.isOldFolderName(d.name) && !isCatDir(d.name))
          .map(d => ({ p: path.join(Lib.scnWatch, d.name), dir: true, type: 'dir', inheritedSystem: '', inheritedPlayerCount: '', inheritedTags: [] }));

      const getDedupKey = s => (typeof window.getScenarioDedupKey === 'function')
        ? window.getScenarioDedupKey(s)
        : ((dnd && dnd.normalizeForMatch) ? dnd.normalizeForMatch(typeof s === 'string' ? s : (s && s.title)) : String(typeof s === 'string' ? s : (s && s.title) || '').trim().toLowerCase());
      const getPathKey = p => (typeof window.getScenarioSourcePathKey === 'function')
        ? window.getScenarioSourcePathKey(p)
        : String(p || '').trim().toLowerCase();

      const areIndependentPaths = (pkA, pkB) => {
        if (!pkA || !pkB || pkA === pkB) return false;
        if (pkB.startsWith(pkA + '/') || pkA.startsWith(pkB + '/')) return false;
        return true;
      };

      const list = CCF.scenarioList();
      const byPath = new Map(), byTitle = new Map();
      const addByTitle = (k, s) => {
        if (!k || !s) return;
        if (!byTitle.has(k)) byTitle.set(k, []);
        const arr = byTitle.get(k);
        if (!arr.includes(s)) arr.push(s);
      };
      list.forEach(s => {
        if (!s) return;
        const pk = getPathKey(s.sourcePath);
        if (pk && !byPath.has(pk)) byPath.set(pk, s);
        addByTitle(getDedupKey(s), s);
      });

      let updated = 0, created = 0;
      const touchedIds = [];
      for (const ent of entries) {
        const rawBase = ent.dir ? path.basename(ent.p) : path.basename(ent.p, path.extname(ent.p));
        if (ent.dir && isCatDir(rawBase)) continue;
        const rawParent = path.basename(path.dirname(ent.p));
        const parentName = (rawParent && rawParent !== path.parse(ent.p).root) ? rawParent : '';
        const parsedTitle = (M && M.extractTitleAndSystem)
          ? M.extractTitleAndSystem(rawBase, parentName)
          : { title: ((dnd && dnd.cleanseTitle) ? dnd.cleanseTitle(rawBase) : '') || rawBase, system: '' };
        const title = parsedTitle.title || rawBase;
        const detectedSystem = ent.inheritedSystem || parsedTitle.system || '';
        const detectedMeta = {
          system: detectedSystem,
          playerCount: ent.inheritedPlayerCount || '',
          lostRate: ent.inheritedLostRate || '',
          tags: Array.isArray(ent.inheritedTags) ? ent.inheritedTags : []
        };
        const entPathKey = getPathKey(ent.p);
        const normKey = getDedupKey(title);
        const titleHits = normKey ? (byTitle.get(normKey) || []) : [];
        let sc = (entPathKey ? byPath.get(entPathKey) : null)
          || titleHits.find(cand => !areIndependentPaths(getPathKey(cand.sourcePath), entPathKey))
          || null;
        const isNewSc = !sc;
        if (!sc && typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) {
          sc = {
            id: typeof uid === 'function' ? uid() : M.newId(),
            title,
            system: detectedSystem,
            playerCount: detectedMeta.playerCount,
            lostRate: detectedMeta.lostRate,
            postedChannels: [],
            postedInfo: {},
            tags: [],
            imageCategories: typeof DEFAULT_SCENARIO_CATS !== 'undefined' ? [...DEFAULT_SCENARIO_CATS] : [...M.STANDARD_SCENARIO_CATS],
            sourcePath: ent.p
          };
          appState.scenarios.push(sc);
          if (entPathKey) byPath.set(entPathKey, sc);
          if (normKey) addByTitle(normKey, sc);
          created++;
        }
        if (!sc) continue;
        if (!sc.sourcePath) sc.sourcePath = ent.p;
        let scDirty = false;
        if (typeof window.clearScenarioMojibakeFields === 'function' && window.clearScenarioMojibakeFields(sc)) {
          scDirty = true;
        }
        if (A() && typeof A().cleanupScenarioAssets === 'function') {
          const preClean = A().cleanupScenarioAssets(String(sc.id));
          if (preClean && preClean.changed) scDirty = true;
        }
        if (dnd && typeof dnd.applyInheritedMeta === 'function') {
          if (dnd.applyInheritedMeta(sc, detectedMeta)) scDirty = true;
        } else if (detectedSystem && !String(sc.system || '').trim()) {
          sc.system = detectedSystem;
          scDirty = true;
        }
        const ignoredDocs = new Set((Array.isArray(sc.ignoredDocNames) ? sc.ignoredDocNames : []).map(normFileKey).filter(Boolean));
        if (ent.dir && dnd && typeof dnd.scanFolder === 'function') {
          const scan = dnd.scanFolder(ent.p, { skipStat: true });
          const imgs = scan.items.filter(i => i.type === 'image');
          const zips = scan.items.filter(i => i.type === 'zip');
          const docItems = scan.items.filter(i => isDocNm(i.name, i.type) && !ignoredDocs.has(normFileKey(i.origName || i.name || baseOfPath(i.path))));
          const nonDocItems = scan.items.filter(i => i && i.path && !isDocNm(i.name, i.type));
          if (!sc.imageUrl) {
            const cand = (dnd.pickTrailer ? dnd.pickTrailer(imgs) : null) || null;
            if (cand && cand.path && typeof dataUrlFromPath === 'function') {
              try {
                const du = await dataUrlFromPath(cand.path, cand.name);
                if (du) {
                  if (dnd.setTrailerImage) dnd.setTrailerImage(sc, du, cand.name);
                  else sc.imageUrl = du;
                  scDirty = true;
                }
              } catch (_) { }
            }
          }
          if ((!sc.imageUrl && zips.length) && dnd.inspectZipsForScenario) {
            const zInfo = await dnd.inspectZipsForScenario(zips, { needTrailer: !sc.imageUrl, fallbackFirstImage: false });
            if (!sc.imageUrl && zInfo.trailerDataUrl) {
              if (dnd.setTrailerImage) dnd.setTrailerImage(sc, zInfo.trailerDataUrl, zInfo.trailerName || 'trailer.png');
              else sc.imageUrl = zInfo.trailerDataUrl;
              scDirty = true;
            }
          }
          if (docItems.length && dnd.upsertScenarioDocs) {
            if (dnd.upsertScenarioDocs(sc, docItems)) scDirty = true;
          }
          if (nonDocItems.length) {
            const curProj = CCF.readProject ? CCF.readProject(String(sc.id)) : null;
            const existingPaths = new Set(), existingByName = new Map();
            ((curProj && curProj.refs) || []).forEach(r => {
              if (!r) return;
              if (r.path) existingPaths.add(normPathKey(r.path));
              const fnk = normFileKey(r.origName || r.name || baseOfPath(r.path));
              if (fnk && !existingByName.has(fnk)) existingByName.set(fnk, r);
            });
            const newItems = [];
            nonDocItems.forEach(it => {
              const pk = normPathKey(it.path);
              const fnk = normFileKey(it.name);
              if (existingPaths.has(pk)) return;
              const nameHit = fnk ? existingByName.get(fnk) : null;
              if (nameHit) {
                if (!normStdCat(nameHit.category) && normStdCat(it.category)) {
                  nameHit.category = normStdCat(it.category);
                  scDirty = true;
                }
                return;
              }
              existingPaths.add(pk);
              if (fnk) existingByName.set(fnk, it);
              newItems.push(it);
            });
            if (newItems.length) {
              const newZips = newItems.filter(it => it.type === 'zip' && !it.category);
              if (newZips.length && dnd.inspectZipsForScenario) {
                await dnd.inspectZipsForScenario(newZips, { needTrailer: false });
              }
              CCF.withProject(String(sc.id), proj => { const n = M.addRefs(proj, newItems); if (n) scDirty = true; });
            }
          }
        } else if (!ent.dir) {
          if (isDocNm(ent.p, ent.type)) {
            if (!ignoredDocs.has(normFileKey(path.basename(ent.p))) && dnd && dnd.upsertScenarioDocs) {
              if (dnd.upsertScenarioDocs(sc, [{ name: path.basename(ent.p), path: ent.p, mtime: 0 }])) scDirty = true;
            }
          } else {
            let zipCat = '';
            if (ent.type === 'zip' && CCF.zip && CCF.zip.inspectDeep) {
              const curProj0 = CCF.readProject ? CCF.readProject(String(sc.id)) : null;
              const existing0 = new Set(((curProj0 && curProj0.refs) || []).map(r => r && normPathKey(r.path)));
              if (!sc.imageUrl || !existing0.has(normPathKey(ent.p))) {
                try {
                  const zInfo = await CCF.zip.inspectDeep(ent.p, { maxDepth: 2, toDataUrl: true, fallbackFirstImage: false });
                  if (zInfo.isRoomZip) zipCat = 'ココフォリア部屋ZIP';
                  else if (!sc.imageUrl && zInfo.trailerDataUrl) {
                    if (dnd && dnd.setTrailerImage) dnd.setTrailerImage(sc, zInfo.trailerDataUrl, zInfo.trailerName || 'trailer.png');
                    else sc.imageUrl = zInfo.trailerDataUrl;
                    scDirty = true;
                  }
                } catch (_) { }
              }
            }
            const curProj = CCF.readProject ? CCF.readProject(String(sc.id)) : null;
            const existing = new Set(((curProj && curProj.refs) || []).map(r => r && normPathKey(r.path)));
            if (!existing.has(normPathKey(ent.p))) {
              const tp = ent.type === 'zip' ? 'zip' : 'pdf';
              if (tp !== 'pdf' || !ignoredDocs.has(normFileKey(path.basename(ent.p)))) {
                CCF.withProject(String(sc.id), proj => { const n = M.addRefs(proj, [{ type: tp, name: path.basename(ent.p), path: ent.p, category: zipCat, mtime: 0 }]); if (n) scDirty = true; });
              }
            }
          }
        }
        if (A() && typeof A().cleanupScenarioAssets === 'function') {
          const cleanRes = A().cleanupScenarioAssets(String(sc.id));
          if (cleanRes && cleanRes.changed) scDirty = true;
        }
        if (typeof applyFlatToBlocks === 'function') applyFlatToBlocks(sc);
        if (typeof syncDerivedTagsFromFields === 'function') {
          if (syncDerivedTagsFromFields(sc)) scDirty = true;
        } else if (detectedSystem) {
          sc.tags = Array.isArray(sc.tags) ? sc.tags : [];
          if (!sc.tags.includes(detectedSystem)) { sc.tags.push(detectedSystem); scDirty = true; }
        }
        if (isNewSc || scDirty) touchedIds.push(sc.id);
        if (!isNewSc && scDirty) updated++;
      }
      if (typeof window.runSilentScenarioAutoCleanup === 'function') {
        const autoFixed = window.runSilentScenarioAutoCleanup();
        if (autoFixed > 0) updated += autoFixed;
      }
      if (A() && typeof A().cleanupAllScenarioAssets === 'function') {
        A().cleanupAllScenarioAssets({ silentProjectCleanup: true });
      }
      if ((created || updated) && typeof window.cleanupOrphanProjectFiles === 'function') {
        try { window.cleanupOrphanProjectFiles(); } catch (_) { }
      }
      if (A() && A().invalidateUnified) A().invalidateUnified(null, true);
      if (typeof window.primeScenarioSigs === 'function' && touchedIds.length) {
        window.primeScenarioSigs(touchedIds);
      }
      if (created || updated || manual) {
        markSelfSave(2500);
        if (typeof window.resetDBViewCache === 'function') window.resetDBViewCache();
        try { if (typeof saveState === 'function') saveState(false, { skipDetailEdited: true }); } catch (_) { }
        try { if (typeof populateScenarioDBSelect === 'function') populateScenarioDBSelect(); } catch (_) { }
        try { if (typeof renderDBView === 'function') renderDBView(true); } catch (_) { }
        try { if (typeof renderSidebarTags === 'function') renderSidebarTags(); } catch (_) { }
        try { if (typeof renderGalleryAll === 'function') renderGalleryAll(); } catch (_) { }
        if (CCF.S && CCF.S.ready) {
          try { CCF.buildProjectSelect(); } catch (_) { }
          if (CCF.S.view === 'assets') render();
        }
        if (manual || created || updated) {
          if (typeof toast === 'function') toast(`✅ 監視フォルダを同期しました（新規追加: ${created}件 / 更新: ${updated}件）`);
        }
      }
      return created + updated;
    } catch (e) { if (typeof logSoft === 'function') logSoft('scnWatch', e); return 0; }
    finally {
      if (typeof window.endSuppressDetailEdited === 'function') window.endSuppressDetailEdited();
      isSyncingScn = false;
      markSelfSave(2000);
    }
  }
  function clearScenarioWatch() {
    if (scnWatchTimer) { clearTimeout(scnWatchTimer); scnWatchTimer = null; }
    if (scnWatcher) { try { scnWatcher.close(); } catch (_) { } scnWatcher = null; }
    Lib.scnWatch = '';
    saveWatchFoldersToState();
    if (typeof window.updateScnWatchButtonTitle === 'function') window.updateScnWatchButtonTitle();
  }
  function setScenarioWatchRoot(p, opts) {
    if (!p) return;
    if (IS_ELECTRON) {
      try { if (!fs.statSync(p).isDirectory()) return say('フォルダを選んでください'); } catch (_) { return say('⚠️ フォルダを開けません'); }
    }
    Lib.scnWatch = p;
    saveWatchFoldersToState(!!(opts && opts.skipSave));
    if (scnWatcher) { try { scnWatcher.close(); } catch (_) { } scnWatcher = null; }
    if (IS_ELECTRON) {
      try {
        scnWatcher = fs.watch(p, { recursive: true }, (_ev, fname) => {
          if (isSyncingScn || isSyncingLib || Date.now() < ignoreWatchUntil) return;
          if (shouldIgnoreWatchPath(fname)) return;
          clearTimeout(scnWatchTimer);
          const runScnWatch = () => {
            scnWatchTimer = null;
            if (isSyncingScn || isSyncingLib || Date.now() < ignoreWatchUntil) return;
            if (isCloudSyncBusy()) {
              deferUntilCloudIdle(() => {
                if (!scnWatchTimer) scnWatchTimer = setTimeout(runScnWatch, 1000);
              }, 1500);
              return;
            }
            syncScenarioWatch(false);
          };
          scnWatchTimer = setTimeout(runScnWatch, 1800);
        });
      } catch (_) { }
    }
    if (!(opts && opts.skipSync)) syncScenarioWatch(true);
  }

  function setRoot(p) {
    if (!p) return;
    if (IS_ELECTRON) {
      try { if (!fs.statSync(p).isDirectory()) return say('フォルダを選んでください'); } catch (e) { if (typeof logSoft === 'function') logSoft('setRootStat', e); return say('⚠️ フォルダを開けません'); }
    }
    Lib.root = p; Lib.cache.clear(); Lib.open = new Set([p]); Lib.scan = null; Lib.lastScan = null; Lib.tagsDone = false;
    saveWatchFoldersToState();
    if (IS_ELECTRON) {
      startWatch();
      setTimeout(async () => { await scanFilesAsync(); notifyCommon(); }, 30);
    }
    render();
  }
  let deferredBootStarted = false;
  function startDeferredWatchAndScan() {
    if (deferredBootStarted) return;
    deferredBootStarted = true;
    if (!IS_ELECTRON) return;
    const runDeferredScan = async () => {
      if (isCloudSyncBusy()) {
        deferUntilCloudIdle(runDeferredScan, 1500);
        return;
      }
      if (Lib.scnWatch && !scnWatcher) {
        try {
          await fs.promises.access(Lib.scnWatch);
          setScenarioWatchRoot(Lib.scnWatch, { skipSync: true, skipSave: true });
        } catch (_) { }
      }
      if (Lib.root) {
        try {
          await fs.promises.access(Lib.root);
          if (!watcher) startWatch();
          if (!Lib.scan) {
            if (isCloudSyncBusy()) {
              deferUntilCloudIdle(runDeferredScan, 1500);
              return;
            }
            await scanFilesAsync();
            invalidateCommonCache();
            if (document.body && document.body.dataset.activeTab === 'galleryTab' && typeof renderGalleryAll === 'function') {
              renderGalleryAll();
            } else if (typeof renderGalleryAll === 'function') {
              try { renderGalleryAll(); } catch (_) { }
            }
            if (CCF.S && CCF.S.view === 'assets') render();
            if (A() && A().refreshModal) A().refreshModal();
          }
        } catch (_) { }
      }
    };
    setTimeout(runDeferredScan, 800);
  }
  function restore(opts) {
    const wf = (typeof appState !== 'undefined' && appState && appState.watchFolders && typeof appState.watchFolders === 'object') ? appState.watchFolders : {};
    let p = '', sp = '';
    try {
      p = localStorage.getItem('ccf_library_root') || localStorage.getItem('ccf_lib_root') || '';
      sp = localStorage.getItem('ccf_scenario_watch_root') || localStorage.getItem('ccf_scn_watch_root') || '';
    } catch (e) { if (typeof logSoft === 'function') logSoft('restoreRoot', e); }
    if (!p && wf.commonRoot) p = String(wf.commonRoot);
    if (!sp && wf.scenarioRoot) sp = String(wf.scenarioRoot);

    if (sp && sp !== Lib.scnWatch) {
      if (opts && opts.deferWatch) Lib.scnWatch = sp;
      else if (!IS_ELECTRON || fs.existsSync(sp)) setScenarioWatchRoot(sp, { skipSync: true, skipSave: true });
      else Lib.scnWatch = sp;
    }
    if (p && p !== Lib.root) {
      Lib.root = p; Lib.cache.clear(); Lib.open = new Set([p]); Lib.scan = null; Lib.lastScan = null; Lib.tagsDone = false;
      if (IS_ELECTRON && !(opts && opts.deferWatch)) startWatch();
    }
    loadWebRefs();
    if (p || sp) saveWatchFoldersToState(true);
    if (CCF.S && CCF.S.view === 'assets') render();
    if (typeof window.updateScnWatchButtonTitle === 'function') window.updateScnWatchButtonTitle();
  }
  async function pick() {
    if (!IS_ELECTRON) return pickWebCommonFolder();
    const r = await CCF.electron.ipcRenderer.invoke('ccf:pick', { title: 'マイライブラリ／共通素材フォルダを選ぶ', properties: ['openDirectory'] });
    if (r && r[0]) { setRoot(r[0]); return r[0]; }
    return '';
  }
  async function pickScenarioWatch(opts) {
    const r = await CCF.electron.ipcRenderer.invoke('ccf:pick', { title: 'シナリオ用監視フォルダを選ぶ', properties: ['openDirectory'] });
    if (r && r[0]) {
      setScenarioWatchRoot(r[0], opts);
      if (!(opts && opts.quiet)) say('📁 シナリオ監視フォルダを設定しました：' + r[0]);
      return r[0];
    }
    return '';
  }
  async function toggleZip(p) {
    const key = 'zip:' + p;
    if (Lib.open.has(key)) {
      Lib.open.delete(key);
      const z = CCF.zip.cache.get(p);
      if (z && CCF.zip.close) { try { CCF.zip.close(z.id); } catch (e) { if (typeof logSoft === 'function') logSoft('closeZip', e); } }
      return render();
    }
    Lib.open.add(key);
    if (!CCF.zip.cache.has(p)) {
      Lib.loading.add(p); render();
      try {
        const z = await CCF.zip.open(p);
        if (z && z.isMem && CCF.zip.resolveUrl) {
          for (const e of z.entries.filter(x => !x.dir && CCF.zip.isImageName(x.name)).slice(0, 80)) {
            await CCF.zip.resolveUrl(CCF.zip.url(z.id, e.name));
          }
        }
      } catch (e) { say('⚠️ ZIPを開けませんでした：' + (e.message || e)); }
      Lib.loading.delete(p);
    }
    render();
  }
  async function playToggle(p) {
    if (audio) { audio.pause(); audio = null; }
    if (audioKey === p) { audioKey = ''; renderAssetListOnly(); return; }
    let u = fileUrl(p);
    if (!u && window.WebBridge && WebBridge.isAssetRef(p)) u = await WebBridge.getAssetUrl(p);
    if (!u) { say('⚠️ 音声ファイルを読み込めませんでした'); return; }
    audioKey = p; audio = new Audio(u); audio.volume = 0.6; audio.onended = () => { audioKey = ''; audio = null; renderAssetListOnly(); };
    audio.play().catch(e => { if (typeof logSoft === 'function') logSoft('audioPlay', e); say('⚠️ 再生できませんでした'); audioKey = ''; audio = null; renderAssetListOnly(); });
    renderAssetListOnly();
  }
  function clearSelection() {
    if (!Lib.selected) return; Lib.selected = '';
    const body = $('ccfTrayBody'); if (!body) return;
    body.querySelectorAll('.ccf-tr.sel, .ccf-asset-row.sel').forEach(x => x.classList.remove('sel'));
  }

  function addImagesToCommonGallery(entries, folder) {
    if (!entries || !entries.length || typeof appState === 'undefined') return 0;
    if (window.AppHistory) window.AppHistory.checkpoint('共通素材を追加');
    appState.imageAssets = appState.imageAssets || [];
    const cat = (folder && folder !== '*' && folder !== NONE) ? folder : '';
    let added = 0;
    entries.forEach(({ name, dataUrl }) => {
      if (!name || !dataUrl) return;
      const c = cat || '';
      appState.imageAssets.push({ id: M.newId(), name, origName: name, dataUrl, category: c, tags: [], addedAt: Date.now() });
      added++;
    });
    if (added) {
      if (typeof saveState === 'function') saveState();
      invalidateCommonCache();
      notifyCommon();
    }
    return added;
  }

  async function addAssets() {
    const folder = (Lib.refFolder === '*' || Lib.refFolder === NONE) ? '' : Lib.refFolder;
    if (Lib.source !== 'common') {
      if (A() && typeof A().pickAddFiles === 'function') return A().pickAddFiles(S.key, folder);
      return 0;
    }
    try {
      const ipc = IS_ELECTRON && CCF.electron && CCF.electron.ipcRenderer;
      if (ipc) {
        const r = await ipc.invoke('ccf:pick', { title: 'マイライブラリへ追加する画像を選択', properties: ['openFile', 'multiSelections'] });
        if (!Array.isArray(r) || !r.length) return 0;
        const imgs = [], skipped = [];
        const mimeOf = ext => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext] || 'image/png');
        r.forEach(fp => {
          const nm = path.basename(fp);
          if (!KINDS.img.test(nm)) { skipped.push(nm); return; }
          try {
            const ext = path.extname(nm).replace('.', '').toLowerCase();
            const b64 = fs.readFileSync(fp).toString('base64');
            imgs.push({ name: nm, dataUrl: `data:${mimeOf(ext)};base64,${b64}` });
          } catch (_) { }
        });
        const added = addImagesToCommonGallery(imgs, folder);
        if (added) say(`🌍 ${added}件の画像をマイライブラリへ追加しました`);
        if (skipped.length) say('ℹ️ 画像以外のファイルは「📌 このシナリオの素材」または監視フォルダへ追加してください');
        return added;
      }
      return await new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.multiple = true;
        inp.accept = 'image/*';
        inp.onchange = () => {
          const files = [...(inp.files || [])].filter(f => KINDS.img.test(f.name));
          if (!files.length) return resolve(0);
          Promise.all(files.map(f => new Promise(res => {
            const reader = new FileReader();
            reader.onload = () => res({ name: f.name, dataUrl: String(reader.result || '') });
            reader.onerror = () => res(null);
            reader.readAsDataURL(f);
          }))).then(list => {
            const added = addImagesToCommonGallery(list.filter(Boolean), folder);
            if (added) say(`🌍 ${added}件の画像をマイライブラリへ追加しました`);
            resolve(added);
          });
        };
        inp.click();
      });
    } catch (e) { if (typeof logSoft === 'function') logSoft('libAddAssets', e); return 0; }
  }

  function applyBulkTagOp(op) {
    const body = $('ccfTrayBody');
    const inp = body && body.querySelector('[data-lib-taginp]');
    if (inp) Lib.tagInput = inp.value;
    if (!Lib.sel.size) return say('チェックボックスで素材を選択してください');
    const tags = M.cleanTagList(String(Lib.tagInput || '').split(/[\s,、，;]+/));
    if (!tags.length) {
      if (inp) inp.focus();
      return say(op === 'remove' ? '外すタグを入力してください' : '付けるタグを入力してください');
    }
    const n = A() && typeof A().bulkUpdateTags === 'function' ? A().bulkUpdateTags(S.key, [...Lib.sel], tags, op) : 0;
    if (n) say(op === 'remove' ? `🏷️ ${n}件からタグ「${tags.join(', ')}」を外しました` : `🏷️ ${n}件にタグ「${tags.join(', ')}」を付けました`);
    else say(op === 'remove' ? '指定されたタグが付いている素材はありませんでした' : 'すでに同じタグが付いています');
  }

  function wire() {
    const body = $('ccfTrayBody'); if (!body || body.dataset.wired) return; body.dataset.wired = '1';
    body.addEventListener('mousedown', e => { if (e.target.classList && e.target.classList.contains('ccf-selchk')) e.stopPropagation(); });
    body.addEventListener('click', e => {
      if (e.target.classList && e.target.classList.contains('ccf-selchk')) {
        e.stopPropagation();
        const uid = e.target.dataset.uid;
        if (e.target.checked) Lib.sel.add(uid); else Lib.sel.delete(uid);
        const row = e.target.closest('.ccf-asset-row');
        if (row) row.classList.toggle('sel', e.target.checked);
        syncBulkControls();
        return;
      }
      const tv = e.target.closest('[data-tagv]');
      if (tv) {
        const val = tv.dataset.tagv || '';
        Lib.tag = (Lib.tag === val) ? '' : val;
        if (IS_ELECTRON) ensureTags();
        return render();
      }
      const t = e.target.closest('[data-lib]'); if (!t) return; const k = t.dataset.lib;
      if (k === 'src:scenario' || k === 'src:common') {
        const nextSrc = k.split(':')[1];
        if (Lib.source !== nextSrc) {
          Lib.source = nextSrc;
          Lib.sel.clear();
          Lib.refFolder = '*';
          Lib.tag = '';
          if (nextSrc === 'common' && IS_ELECTRON) ensureTags();
          render();
        }
        return;
      }
      if (k === 'view:folder' || k === 'view:list') {
        Lib.viewMode = k.split(':')[1];
        try { localStorage.setItem(ASSETS_VIEW_KEY, Lib.viewMode); } catch (_) { }
        return render();
      }
      if (k === 'loadmore') return appendListMore();
      if (k === 'fmore') return appendFolderMore(t.dataset.folder || NONE);
      if (k === 'foldertoggle') {
        const fk = t.dataset.folder || NONE;
        if (Lib.refOpen.has(fk)) Lib.refOpen.delete(fk); else Lib.refOpen.add(fk);
        return renderAssetListOnly();
      }
      if (k === 'cleartag') { Lib.tag = ''; return render(); }
      if (k === 'qclear') { Lib.q = ''; Lib.tag = ''; Lib.typeFilter = ''; Lib.refFolder = '*'; return render(); }
      if (k === 'pick') return void pick();
      if (k === 'sync') { if (window.CommonAssets) void window.CommonAssets.sync(true); return; }
      if (k === 'reveal') { if (Lib.root && IS_ELECTRON) shell.openPath(Lib.root); return; }
      if (k === 'unwatch') return void unwatchRoot();
      if (k === 'ztoggle') return void toggleZip(t.dataset.path);
      if (k === 'play') return playToggle(t.dataset.path);
      if (k === 'tagadd') return applyBulkTagOp('add');
      if (k === 'tagrm') return applyBulkTagOp('remove');
      if (k === 'copyone') {
        const uid = t.dataset.uid;
        if (uid && A() && A().copyCommonItemsToScenario) A().copyCommonItemsToScenario(S.key, [uid]);
        return;
      }
      if (k === 'refall') {
        const vis = filteredItems();
        const allOn = vis.length > 0 && vis.every(r => Lib.sel.has(r.uid));
        vis.forEach(r => allOn ? Lib.sel.delete(r.uid) : Lib.sel.add(r.uid));
        return renderAssetListOnly();
      }
      if (k === 'refbulk') {
        if (!Lib.sel.size) return;
        const ids = [...Lib.sel];
        const isCommon = Lib.source === 'common';
        return void (async () => {
          const msg = isCommon
            ? `選択中の共通素材 ${ids.length}件をギャラリーから除外・削除しますか？（監視フォルダ内の元ファイル自体は削除されません）`
            : `登録素材 ${ids.length}件を登録から外しますか？（PC上のファイルは消えません）`;
          if (!(await appConfirm(msg, { okText: isCommon ? '削除' : '外す', danger: true }))) return;
          Lib.sel.clear();
          if (isCommon) {
            if (window.CommonAssets) window.CommonAssets.removeItems(ids);
          } else if (A() && A().removeScenarioItems) {
            A().removeScenarioItems(S.key, ids);
          }
          render();
        })();
      }
      if (k === 'refdel') {
        const uid = t.dataset.uid; if (!uid) return;
        Lib.sel.delete(uid);
        if (Lib.source === 'common') {
          if (window.CommonAssets) window.CommonAssets.removeItems([uid]);
        } else if (A() && A().removeScenarioItems) {
          A().removeScenarioItems(S.key, [uid]);
        }
        return render();
      }
      if (k === 'file' || k === 'zfile') {
        Lib.selected = t.dataset.path || t.dataset.zipurl || '';
        if (k === 'file' && t.dataset.uid && !e.target.closest('button, input, [data-tagv], [data-usage]') && typeof window.openGalleryDetailModal === 'function') {
          window.openGalleryDetailModal({
            scope: Lib.source,
            uid: t.dataset.uid,
            items: filteredItems(),
            scenarioId: S.key,
            onUpdate: () => render(),
            onDelete: () => render()
          });
        }
      }
    });
    body.addEventListener('dblclick', e => {
      if (e.target.closest('button, input, [data-tagv], [data-usage]')) return;
      const z = e.target.closest('[data-lib="zfile"]');
      if (z) { if (KINDS.img.test(z.dataset.name) && document.getElementById('ccfReview')) CCF.setNpcIconFromUrl(z.dataset.zipurl, z.dataset.name); return; }
      const t = e.target.closest('[data-lib="file"]'); if (!t) return; const p = t.dataset.path;
      if (!p) return;
      if (/\.(pdf|txt|html?|md)$/i.test(p)) return void CCF.openPdfPath(p);
      if (KINDS.img.test(p) && document.getElementById('ccfReview')) return void CCF.setNpcIconFromPath(p);
      if (KINDS.audio.test(p)) return playToggle(p);
      if (!KINDS.img.test(p) && IS_ELECTRON) shell.openPath(p);
    });
    body.addEventListener('dragstart', e => {
      const z = e.target.closest('[data-lib="zfile"]');
      if (z) { e.dataTransfer.setData('text/ccf-zipview', z.dataset.zipurl); e.dataTransfer.setData('text/ccf-zipname', z.dataset.name); e.dataTransfer.effectAllowed = 'copy'; return; }
      const t = e.target.closest('[data-lib="file"]'); if (!t) return;
      if (t.dataset.uid) e.dataTransfer.setData('text/ccf-amids', t.dataset.uid);
      if (t.dataset.path) { e.dataTransfer.setData('text/ccf-path', t.dataset.path); e.dataTransfer.setData('text/plain', t.dataset.path); }
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    let qTimer = null, qComposing = false;
    body.addEventListener('compositionstart', e => { if (e.target.matches('[data-lib-q]')) qComposing = true; });
    body.addEventListener('compositionend', e => {
      if (!e.target.matches('[data-lib-q]')) return;
      qComposing = false;
      Lib.q = e.target.value;
      clearTimeout(qTimer);
      if (Lib.q.trim() && IS_ELECTRON) ensureTags();
      renderAssetListOnly();
    });
    body.addEventListener('input', e => {
      if (e.target.matches('[data-lib-taginp]')) {
        Lib.tagInput = e.target.value;
        return;
      }
      if (!e.target.matches('[data-lib-q]')) return;
      if (qComposing || e.isComposing) return;
      Lib.q = e.target.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        if (Lib.q.trim() && IS_ELECTRON) ensureTags();
        renderAssetListOnly();
      }, 120);
    });
    body.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('[data-lib-taginp]')) {
        e.preventDefault();
        if (Lib.sel.size) applyBulkTagOp('add');
      }
    });
    body.addEventListener('change', e => {
      const s = e.target.dataset && e.target.dataset.libsel; if (!s) return;
      if (s === 'type') { Lib.typeFilter = e.target.value; return render(); }
      if (s === 'reffolder') { Lib.refFolder = e.target.value; return render(); }
    });
    const refDropOk = e => { const ty = [...(e.dataTransfer.types || [])]; return ty.includes('text/ccf-amids') || ty.includes('text/ccf-path') || ty.includes('Files'); };
    body.addEventListener('dragover', e => { if (e.target.closest('[data-libdrop="refcat"]') && refDropOk(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; } });
    body.addEventListener('drop', async e => {
      const z = e.target.closest('[data-libdrop="refcat"]'); if (!z || !refDropOk(e)) return; e.preventDefault(); e.stopPropagation();
      const cat = z.dataset.cat || '', uids = e.dataTransfer.getData('text/ccf-amids'), lp = e.dataTransfer.getData('text/ccf-path');
      if (uids && A() && Lib.source === 'scenario') { Lib.sel.clear(); A().moveIds(uids.split(',').filter(Boolean), cat); return; }
      if (lp && A() && Lib.source === 'scenario') { A().addPaths(S.key, [lp], cat); return; }
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        if (IS_ELECTRON) {
          const fps = [...e.dataTransfer.files].map(f => typeof filePathOf === 'function' ? filePathOf(f) : f.path).filter(Boolean);
          if (!fps.length) return;
          if (Lib.source === 'common') {
            try { if (fs.statSync(fps[0]).isDirectory()) setRoot(fps[0]); else say('監視フォルダを設定するにはフォルダをドロップしてください'); } catch (er) { if (typeof logSoft === 'function') logSoft('dropRoot', er); say('⚠️ フォルダを開けません'); }
          } else if (A()) {
            A().addPaths(S.key, fps, cat);
          }
        } else if (Lib.source === 'scenario' && A() && typeof A().addBrowserFiles === 'function') {
          await A().addBrowserFiles(S.key, [...e.dataTransfer.files], cat);
        } else if (Lib.source === 'common') {
          const imgs = [...e.dataTransfer.files].filter(f => KINDS.img.test(f.name));
          if (imgs.length) {
            const list = await Promise.all(imgs.map(f => new Promise(res => { const fr = new FileReader(); fr.onload = () => res({ name: f.name, dataUrl: String(fr.result || '') }); fr.onerror = () => res(null); fr.readAsDataURL(f); })));
            const added = addImagesToCommonGallery(list.filter(Boolean), cat);
            if (added) say(`🌍 ${added}件の画像をマイライブラリへ追加しました`);
          }
        }
      }
    });
  }
  CCF.library = { init() { wire(); restore({ deferWatch: true }); startDeferredWatchAndScan(); }, restore, setRoot, clearRoot, unwatchRoot, pick, pickScenarioWatch, setScenarioWatchRoot, clearScenarioWatch, syncScenarioWatch, getScenarioWatchRoot: () => Lib.scnWatch, ensureAudioTags, markSelfSave, setSyncing: v => { isSyncingScn = !!v; if (!v) markSelfSave(2000); }, isSyncing: () => isSyncingLib || isSyncingScn, render, addAssets, syncAll: m => window.CommonAssets ? window.CommonAssets.sync(m) : null, clearSelection, playToggle, isPlaying: p => audioKey === p, state: Lib, readDir, toggleZip };
  const onBootReady = () => {
    restore({ deferWatch: true });
    if (typeof renderGalleryAll === 'function') { try { renderGalleryAll(); } catch (_) { } }
    startDeferredWatchAndScan();
  };
  if (typeof window !== 'undefined') {
    if (window.appReady && typeof window.appReady.then === 'function') window.appReady.then(onBootReady);
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onBootReady);
    else onBootReady();
  }
  function hookImageCleanupOnAssetCleanup() {
    const a = A();
    if (!a || typeof a.cleanupAllScenarioAssets !== 'function' || a.cleanupAllScenarioAssets._imgWrapped) return;
    const orig = a.cleanupAllScenarioAssets;
    const wrapped = function (opts) {
      const res = orig.apply(this, arguments);
      if (!(opts && (opts.silentProjectCleanup || opts.skipImageCleanup))) {
        if (typeof window.cleanupUnusedImages === 'function') {
          void window.cleanupUnusedImages({ forceAutosave: true });
        }
      }
      return res;
    };
    wrapped._imgWrapped = true;
    a.cleanupAllScenarioAssets = wrapped;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookImageCleanupOnAssetCleanup);
  else hookImageCleanupOnAssetCleanup();
})();
