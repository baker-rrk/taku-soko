// 共通・シナリオ別画像ギャラリー & 参照資料マネージャ（マイライブラリ監視＆登録素材と完全統合）
const galSel = { common: '*', scenario: '*' };   // '*'=すべて, '__none__'=未分類, それ以外=フォルダ名
const GAL_VIEW_KEY = 'taku_gallery_view_mode_v1';
const galViewMode = {
  common: (() => { try { return localStorage.getItem(GAL_VIEW_KEY) === 'list' ? 'list' : 'folder'; } catch (_) { return 'folder'; } })(),
  scenario: 'list'
};
const galFilter = {
  common: { q: '', tags: [], sort: 'manual', type: '' },
  scenario: { q: '', tags: [], sort: 'manual', type: '' }
};
const galTagPickerOpen = { common: null, scenario: null };
const GAL_INCSUB_KEY = 'taku_gal_incsub_v1';
const galLoadIncSub = () => { try { return localStorage.getItem(GAL_INCSUB_KEY) !== '0'; } catch (_) { return true; } };
const galIncSub = { common: galLoadIncSub(), scenario: galLoadIncSub() };
const galCollapsed = { common: new Set(), scenario: new Set() };
const galAnchor = { common: '', scenario: '' };
let galDragFolder = null;
const galChk = { img: new Set(), doc: new Set() };
const galKept = { common: new Set(), scenario: new Set() };
const GAL_ALL = '*', GAL_NONE = '__none__', GAL_PAGE_SIZE = 40;
let galEdit = null;
const galDirty = { common: false, scenario: false };
const galPageState = { common: null, scenario: null };
const galIsTabActive = tabId => {
  const el = document.getElementById(tabId);
  if (el && el.classList && el.classList.contains('active')) return true;
  return !!(document.body && document.body.dataset && document.body.dataset.activeTab === tabId);
};
const galChkPt = lbl => { try { if (window.AppHistory && typeof window.AppHistory.checkpoint === 'function') window.AppHistory.checkpoint(lbl); } catch (_) { } };
window.imgAttr = window.imgAttr || (typeof imgAttr === 'function' ? imgAttr : (u => { const s = typeof thumbSrc === 'function' ? thumbSrc(u) : (typeof imgSrc === 'function' ? imgSrc(u) : String(u || '')); return 'src="' + escapeHTML(s) + '"' + (String(u || '').startsWith('@img:') ? ' data-img-ref="' + escapeHTML(String(u).slice(5)) + '"' : ''); }));
window.DEFAULT_COMMON_CATS = window.DEFAULT_COMMON_CATS || (typeof DEFAULT_COMMON_CATS !== 'undefined' ? DEFAULT_COMMON_CATS : ['未分類', '背景', 'パネル']);
window.DEFAULT_SCENARIO_CATS = window.DEFAULT_SCENARIO_CATS || (typeof DEFAULT_SCENARIO_CATS !== 'undefined' ? DEFAULT_SCENARIO_CATS : ['トレーラー', 'NPC', '背景', '前景', 'マップ', '部屋素材']);
window.sanitizeCats = window.sanitizeCats || (typeof sanitizeCats === 'function' ? sanitizeCats : ((list, def) => { const out = [...new Set((Array.isArray(list) ? list : []).map(v => String(v == null ? '' : v).trim()).filter(Boolean))]; return out.length ? out : [...(def || [])]; }));
window.uniqueCategory = window.uniqueCategory || (typeof uniqueCategory === 'function' ? uniqueCategory : ((cats, base) => { let n = base, i = 2; while (Array.isArray(cats) && cats.includes(n)) n = base + ' ' + i++; return n; }));
window.galId = window.galId || (typeof galId === 'function' ? galId : (() => (typeof uid === 'function' ? uid() : 'gal_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8))));
window.filePathOf = window.filePathOf || (typeof filePathOf === 'function' ? filePathOf : (f => (f && f.path) || ''));
window.isImageName = window.isImageName || (typeof isImageName === 'function' ? isImageName : (n => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(n || ''))));
window.isAudioName = window.isAudioName || (typeof isAudioName === 'function' ? isAudioName : (n => /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(String(n || ''))));
window.isVideoName = window.isVideoName || (typeof isVideoName === 'function' ? isVideoName : (n => /\.(mp4|webm|mov|m4v|ogv)$/i.test(String(n || ''))));
window.isPdfName = window.isPdfName || (typeof isPdfName === 'function' ? isPdfName : (n => /\.pdf$/i.test(String(n || ''))));
window.isTextDocName = window.isTextDocName || (typeof isTextDocName === 'function' ? isTextDocName : (n => /\.(txt|html?|md)$/i.test(String(n || ''))));
window.imageFileToDataUrl = window.imageFileToDataUrl || (async function imageFileToDataUrl(file) {
  if (!file) return '';
  if (typeof compressImage === 'function') {
    try {
      const res = await compressImage(file);
      if (res) return res;
    } catch (_) { }
  }
  return await new Promise(resolve => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    } catch (_) {
      resolve('');
    }
  });
});
const galFileUrl = p => { try { return require('url').pathToFileURL(p).href; } catch (_) { return ''; } };
const GAL_EXT_STRIP_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|m4a|flac|aac|mp4|webm|mov|pdf|txt|md|html?|docx?|zip|json)$/i;
const galStripAssetExt = n => (window.CCF && CCF.dnd && typeof CCF.dnd.stripAssetExt === 'function')
  ? CCF.dnd.stripAssetExt(n)
  : (String(n == null ? '' : n).trim().replace(GAL_EXT_STRIP_RE, '').trim() || String(n == null ? '' : n).trim());
const galM = () => window.CCFModel || null;
const galNormCat1 = c => (galM() && galM().normalizeStandardCat) ? galM().normalizeStandardCat(c) : ((!c || (galM() && galM().isUnclassifiedCat(c))) ? '' : String(c).trim());
// 階層パス（親フォルダ/小フォルダ）対応：'/' 区切りの各セグメントを個別に正規化
const galNormCat = c => {
  const s = String(c == null ? '' : c).normalize('NFKC');
  return s.includes('/') ? s.split('/').map(x => galNormCat1(x.trim())).filter(Boolean).join('/') : galNormCat1(c);
};
const galParentOf = f => { const s = String(f || ''), i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); };
const galBaseOf = f => { const s = String(f || ''), i = s.lastIndexOf('/'); return i < 0 ? s : s.slice(i + 1); };
const galDepthOf = f => f ? String(f).split('/').length - 1 : 0;
const galJoinPath = (par, name) => galNormCat([par, name].filter(Boolean).join('/'));
const galInFolder = (cat, sel, sub) => cat === sel || (!!sub && String(cat || '').startsWith(sel + '/'));
function galBuildFolderTree(paths) {
  const nodes = new Map(), roots = [];
  const ensure = p => {
    if (nodes.has(p)) return nodes.get(p);
    const n = { path: p, children: [] }; nodes.set(p, n);
    const par = galParentOf(p);
    if (par) ensure(par).children.push(n); else roots.push(n);
    return n;
  };
  (paths || []).forEach(p => { const np = galNormCat(p); if (np) ensure(np); });
  const flat = [];
  (function walk(list) { list.forEach(n => { flat.push(n.path); walk(n.children); }); })(roots);
  return { nodes, roots, flat };
}
const galFolderIndentLabel = f => galDepthOf(f) ? '\u3000'.repeat(galDepthOf(f)) + '└ ' + galBaseOf(f) : '📁 ' + f;
function galFolderOptionsHtml(paths, selected, exclude) {
  const flat = galBuildFolderTree(paths).flat.filter(p => !exclude || !(p === exclude || p.startsWith(exclude + '/')));
  return flat.map(f => `<option value="${escapeHTML(f)}"${f === selected ? ' selected' : ''}>${escapeHTML(galFolderIndentLabel(f))}</option>`).join('');
}
const galItemCat = it => (it && it._normCat !== undefined) ? it._normCat : (it ? (it._normCat = galNormCat(it.category)) : '');
const galCatLabel = c => !c ? '（未分類）' : c;

// 監視フォルダ画像の軽量サムネイルキャッシュ（長辺240px WebP Blob URL・上限600件LRU）
const LOCAL_THUMB_MAX = 600, LOCAL_THUMB_DIM = 240;
const localThumbCache = new Map();
const localThumbPending = new Set();
const localThumbQueue = [];
let localThumbActive = 0;

function galGetLocalThumbUrl(p) {
  if (!p) return '';
  const hit = localThumbCache.get(p);
  if (hit) {
    localThumbCache.delete(p);
    localThumbCache.set(p, hit);
    return hit;
  }
  return '';
}

function galSetLocalThumbUrl(p, blobUrl) {
  if (!p || !blobUrl) return;
  if (localThumbCache.has(p)) {
    const prev = localThumbCache.get(p);
    localThumbCache.delete(p);
    if (prev && prev !== blobUrl) { try { URL.revokeObjectURL(prev); } catch (_) { } }
  } else if (localThumbCache.size >= LOCAL_THUMB_MAX) {
    const oldestKey = localThumbCache.keys().next().value;
    const oldestVal = localThumbCache.get(oldestKey);
    localThumbCache.delete(oldestKey);
    if (oldestVal) { try { URL.revokeObjectURL(oldestVal); } catch (_) { } }
  }
  localThumbCache.set(p, blobUrl);
}

function galPumpLocalThumbQueue() {
  while (localThumbActive < 2 && localThumbQueue.length) {
    const task = localThumbQueue.shift();
    if (!task) continue;
    const { img, pathKey } = task;
    if (localThumbCache.has(pathKey)) { localThumbPending.delete(pathKey); continue; }
    localThumbActive++;
    const finish = () => { localThumbPending.delete(pathKey); localThumbActive--; if (localThumbQueue.length) setTimeout(galPumpLocalThumbQueue, 0); };
    try {
      const w = img.naturalWidth || 0, h = img.naturalHeight || 0;
      if (!w || !h || (w <= LOCAL_THUMB_DIM && h <= LOCAL_THUMB_DIM)) { finish(); continue; }
      const scale = LOCAL_THUMB_DIM / Math.max(w, h);
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) { finish(); continue; }
      ctx2d.drawImage(img, 0, 0, cw, ch);
      canvas.toBlob(blob => {
        try {
          if (blob) galSetLocalThumbUrl(pathKey, URL.createObjectURL(blob));
        } catch (_) { }
        finish();
      }, 'image/webp', 0.72);
    } catch (_) {
      finish();
    }
  }
}

function galScheduleLocalThumb(img) {
  if (!img || !img.dataset) return;
  const pathKey = img.dataset.thumbPath;
  if (!pathKey || localThumbCache.has(pathKey) || localThumbPending.has(pathKey)) return;
  if (!img.complete || !img.naturalWidth) return;
  if (img.naturalWidth <= LOCAL_THUMB_DIM && img.naturalHeight <= LOCAL_THUMB_DIM) return;
  localThumbPending.add(pathKey);
  localThumbQueue.push({ img, pathKey });
  galPumpLocalThumbQueue();
}
const galHasTag = (tags, t) => {
  const tl = String(t || '').toLowerCase();
  return (tags || []).some(x => String(x).toLowerCase() === tl);
};
const galToggleTag = (scope, t) => {
  const val = String(t || '').trim();
  if (!val) return;
  const arr = galFilter[scope].tags || (galFilter[scope].tags = []);
  const idx = arr.findIndex(x => String(x).toLowerCase() === val.toLowerCase());
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(val);
};

function galCtx(scope) {
  if (scope === 'common') {
    appState.commonCats = sanitizeCats(appState.commonCats, DEFAULT_COMMON_CATS);
    if (!Array.isArray(appState.imageAssets)) appState.imageAssets = [];
    return {
      cats: appState.commonCats,
      items: appState.imageAssets,
      save: () => { saveState(); try { if (window.CommonAssets && window.CommonAssets.invalidate) window.CommonAssets.invalidate(); } catch (_) { } },
      label: '共通'
    };
  }
  const sc = appState.scenarios.find(s => s.id === currentScenarioId);
  if (!sc) return null;
  sc.imageCategories = sanitizeCats(sc.imageCategories, DEFAULT_SCENARIO_CATS);
  if (!Array.isArray(sc.images)) sc.images = [];
  return {
    sc,
    cats: sc.imageCategories,
    items: sc.images,
    save: () => {
      try { if (window.CCF && CCF.assets && CCF.assets.invalidateUnified) CCF.assets.invalidateUnified(String(sc.id), false); } catch (_) { }
      saveState();
      try { if (window.CCF && CCF.library) CCF.library.render(); if (CCF.assets && CCF.assets.refreshModal) CCF.assets.refreshModal(); } catch (_) { }
    },
    label: 'シナリオ専用'
  };
}

function galUnifiedItems(scope, ctx) {
  if (scope === 'common') {
    if (window.CommonAssets && typeof window.CommonAssets.getAll === 'function') {
      return window.CommonAssets.getAll();
    }
    return (ctx.items || []).reduce((acc, a, i) => {
      if (!a || /\.(txt|md)$/i.test(String(a.origName || a.name || ''))) return acc;
      if (!a.origName && a.name) a.origName = a.name;
      const dispName = galStripAssetExt(a.name || a.origName || 'image') || 'image';
      if (a.name && a.name !== dispName) a.name = dispName;
      const cat = galNormCat(a.category), customTags = galM() ? galM().cleanTagList(a.tags) : [];
      const tags = [...new Set([...customTags, cat].filter(Boolean))];
      acc.push({ uid: 'cimg:' + a.id, rawId: a.id, srcType: 'cimg', type: 'image', name: dispName, origName: a.origName || dispName, path: '', dataUrl: a.dataUrl || '', category: cat, _normCat: cat, customTags, tags, blob: [dispName, a.origName, cat, ...tags].filter(Boolean).join(' ').toLowerCase(), addedOrder: i, raw: a });
      return acc;
    }, []);
  }
  if (ctx.sc && window.CCF && CCF.assets && typeof CCF.assets.getUnifiedItems === 'function') {
    return CCF.assets.getUnifiedItems(ctx.sc.id);
  }
  return (ctx.items || []).map((a, i) => {
    if (!a.origName && a.name) a.origName = a.name;
    const dispName = galStripAssetExt(a.name || a.origName || 'image') || 'image';
    if (a.name && a.name !== dispName) a.name = dispName;
    const cat = galNormCat(a.category), customTags = galM() ? galM().cleanTagList(a.tags) : [];
    const tags = [...new Set([...customTags, cat].filter(Boolean))];
    return { uid: 'img:' + a.id, rawId: a.id, srcType: 'img', type: 'image', name: dispName, origName: a.origName || dispName, path: '', dataUrl: a.dataUrl || '', category: cat, _normCat: cat, customTags, tags, blob: [dispName, a.origName, cat, ...tags].filter(Boolean).join(' ').toLowerCase(), addedOrder: i, raw: a };
  });
}

function galAllCats(scope, ctx, items) {
  const set = new Set([...(ctx.cats || []), ...galKept[scope]].map(galNormCat).filter(Boolean));
  if (scope === 'scenario' && ctx.sc && window.CCF && CCF.assets && typeof CCF.assets.foldersOf === 'function') {
    CCF.assets.foldersOf(CCF.readProject(String(ctx.sc.id)), ctx.sc.id).forEach(f => { if (f) set.add(f); });
  }
  items.forEach(it => { const c = galItemCat(it); if (c) set.add(c); });
  return [...set];
}

const galSplitCharSortKey = name => {
  const raw = String(name || '').normalize('NFKC').trim();
  const m = raw.match(/^[0-9０-９]+[._．・\s-]*(.*)$/);
  const base = (m && m[1] && m[1].trim()) ? m[1].trim() : raw;
  return { base, full: raw };
};

function galSortItems(scope, items) {
  const f = galFilter[scope] || {};
  const out = items.slice();
  if (f.sort === 'name') {
    out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja', { numeric: true }));
  } else if (f.sort === 'character') {
    out.sort((a, b) => {
      const ka = galSplitCharSortKey(a.name), kb = galSplitCharSortKey(b.name);
      const cmp = ka.base.localeCompare(kb.base, 'ja', { numeric: true });
      if (cmp !== 0) return cmp;
      return ka.full.localeCompare(kb.full, 'ja', { numeric: true });
    });
  } else if (f.sort === 'added') {
    out.sort((a, b) => (a.addedOrder || 0) - (b.addedOrder || 0));
  }
  return out;
}

function galVisibleItems(scope, items) {
  const f = galFilter[scope], selCat = galSel[scope] || GAL_ALL, M = galM();
  const parsed = M ? M.parseSearchQuery(f.q) : null;
  const selTags = Array.isArray(f.tags) ? f.tags : [];
  const incSub = !!galIncSub[scope];
  const out = items.filter(it => {
    if (f.type && it.type !== f.type) return false;
    const cat = galItemCat(it);
    if (selCat === GAL_NONE ? cat : (selCat !== GAL_ALL && !galInFolder(cat, selCat, incSub))) return false;
    if (selTags.length) {
      const itLower = new Set((it.tags || []).map(t => String(t).toLowerCase()));
      if (!selTags.every(st => itLower.has(String(st).toLowerCase()))) return false;
    }
    if (f.q.trim()) {
      if (parsed && M) { if (!M.matchSearchQuery(it.blob || (it.name + ' ' + cat).toLowerCase(), parsed)) return false; }
      else if (!(it.blob || '').includes(f.q.trim().toLowerCase())) return false;
    }
    return true;
  });
  return galSortItems(scope, out);
}

function galIcon(r) { return r.type === 'image' ? '🖼️' : r.type === 'audio' ? '🎵' : r.type === 'pdf' ? '📄' : r.type === 'zip' ? '📦' : '📃'; }

const galItemThumbUrl = it => {
  if (it.type !== 'image' || it.missing) return '';
  if (it.dataUrl) return it.dataUrl;
  if (!it.path) return '';
  return galGetLocalThumbUrl(it.path) || galFileUrl(it.path);
};

function galRenderCardHtml(scope, it, selTags, isLibPlaying) {
  const thumbSrc = galItemThumbUrl(it);
  const thumbAttr = (!it.dataUrl && it.path && !localThumbCache.has(it.path)) ? ` data-thumb-path="${escapeHTML(it.path)}"` : '';
  const media = (it.type === 'image' && thumbSrc)
    ? `<img ${it.dataUrl ? imgAttr(it.dataUrl) : `src="${escapeHTML(thumbSrc)}"${thumbAttr}`} alt="${escapeHTML(it.name)}" loading="lazy" decoding="async" draggable="false">`
    : `<div class="gal-icon-box">${galIcon(it)}</div>`;
  const playBtn = (it.type === 'audio' && it.path) ? `<div class="gal-acts"><button type="button" class="gal-act" data-gal="play" data-path="${escapeHTML(it.path)}" title="試聴">${isLibPlaying(it.path) ? '■' : '▶'}</button></div>` : '';
  const editBtn = `<button type="button" class="gal-edit-btn" data-gal="edit-item" data-gscope="${scope}" data-gid="${escapeHTML(it.uid)}" title="詳細・編集（ダブルクリックでも開けます）">✏️</button>`;
  const mvBtns = `<div class="gal-mvbar"><button type="button" class="gal-mvbtn" data-gal="mv-prev" data-gscope="${scope}" data-gid="${escapeHTML(it.uid)}" title="1つ前へ移動">◀</button><button type="button" class="gal-mvbtn" data-gal="mv-next" data-gscope="${scope}" data-gid="${escapeHTML(it.uid)}" title="1つ後ろへ移動">▶</button></div>`;
  const tagsHtml = (it.tags || []).slice(0, 4).map(t => `<span class="gal-tag${galHasTag(selTags, t) ? ' on' : ''}" data-gal="picktag" data-gscope="${scope}" data-tagv="${escapeHTML(t)}" title="クリックで絞り込みに追加／解除">${escapeHTML(t)}</span>`).join('');
  const checked = galChk.img.has(it.uid);
  return `<div class="gal-item${checked ? ' is-selected' : ''}" draggable="true" data-gid="${escapeHTML(it.uid)}" data-gscope="${scope}" title="${escapeHTML(it.path || it.name)}${it.missing ? '（ファイル未検出）' : ''}">
    <input type="checkbox" class="gal-chk" data-gal="chk-img" data-gid="${escapeHTML(it.uid)}" ${checked ? 'checked' : ''} title="選択">
    ${editBtn}
    ${playBtn}
    ${media}
    <div class="gal-namerow"><div class="gal-name">${escapeHTML(it.name)}${it.missing ? ' ⚠️' : ''}</div>${mvBtns}</div>
    ${tagsHtml ? `<div class="gal-tags">${tagsHtml}</div>` : ''}
  </div>`;
}

function galComputeViewData(scope, ctx) {
  const allItems = galUnifiedItems(scope, ctx), cats = galAllCats(scope, ctx, allItems);
  const tree = galBuildFolderTree(cats);
  const cur = galSel[scope] || GAL_ALL;
  if (cur !== GAL_ALL && cur !== GAL_NONE && !tree.nodes.has(cur)) galSel[scope] = GAL_ALL;
  const curCat = galSel[scope] || GAL_ALL;
  const f = galFilter[scope];
  const selTags = Array.isArray(f.tags) ? f.tags : (f.tags = []);
  const typedItems = f.type ? allItems.filter(it => it.type === f.type) : allItems;
  const byCat = new Map();
  for (let i = 0; i < typedItems.length; i++) {
    const it = typedItems[i];
    const key = galItemCat(it) || GAL_NONE;
    let arr = byCat.get(key);
    if (!arr) { arr = []; byCat.set(key, arr); }
    arr.push(it);
  }
  const totalMap = new Map();
  const calcTotal = n => {
    let t = (byCat.get(n.path) || []).length;
    n.children.forEach(ch => { t += calcTotal(ch); });
    totalMap.set(n.path, t);
    return t;
  };
  tree.roots.forEach(calcTotal);
  const descItemsOf = catKey => {
    const out = [];
    const node = tree.nodes.get(catKey);
    if (!node) return byCat.get(catKey) || [];
    (function collect(n) {
      const own = byCat.get(n.path);
      if (own && own.length) out.push(...own);
      n.children.forEach(collect);
    })(node);
    return out;
  };
  const incSub = !!galIncSub[scope];
  const scopedItems = curCat === GAL_ALL
    ? typedItems
    : curCat === GAL_NONE
      ? (byCat.get(GAL_NONE) || [])
      : typedItems.filter(it => galInFolder(galItemCat(it), curCat, incSub));
  const visible = galVisibleItems(scope, allItems);
  const tagMap = new Map(), tagCounts = new Map();
  scopedItems.forEach(it => {
    const seenInItem = new Set();
    (it.tags || []).forEach(t => {
      const l = String(t).toLowerCase();
      if (!tagMap.has(l)) tagMap.set(l, t);
      if (!seenInItem.has(l)) { seenInItem.add(l); tagCounts.set(l, (tagCounts.get(l) || 0) + 1); }
    });
  });
  const allTags = [...tagMap.values()].filter(t => (tagCounts.get(String(t).toLowerCase()) || 0) > 0)
    .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  const isFolderView = scope === 'common' && galViewMode.common === 'folder';
  const isFiltering = !!(f.q.trim() || selTags.length);
  const showFolderCards = isFolderView && curCat === GAL_ALL && !isFiltering;
  const tagOpen = !!galTagPickerOpen[scope];
  const countOf = catKey => catKey === GAL_ALL ? typedItems.length : catKey === GAL_NONE ? ((byCat.get(GAL_NONE) || []).length) : (totalMap.get(catKey) || 0);
  return { allItems, cats, tree, curCat, f, selTags, typedItems, byCat, scopedItems, visible, tagCounts, allTags, isFolderView, showFolderCards, tagOpen, countOf, descItemsOf };
}

function galFolderSelectOptionsHtml(scope, d, includeRootJump) {
  const { tree, curCat, typedItems, countOf } = d;
  const activeCats = tree.flat.filter(c => countOf(c) > 0 || c === curCat || galKept[scope].has(c));
  const noneCnt = countOf(GAL_NONE);
  if (includeRootJump) {
    return `<option value="" disabled selected>📁 フォルダ切替 ▾</option>`
      + `<option value="${GAL_ALL}">🗂️ フォルダ一覧へ戻る</option>`
      + (noneCnt > 0 ? `<option value="${GAL_NONE}"${curCat === GAL_NONE ? ' disabled' : ''}>📂 （未分類） (${noneCnt})</option>` : '')
      + activeCats.map(c => `<option value="${escapeHTML(c)}"${curCat === c ? ' disabled' : ''}>${escapeHTML(galFolderIndentLabel(c))} (${countOf(c)})</option>`).join('');
  }
  return `<option value="${GAL_ALL}"${curCat === GAL_ALL ? ' selected' : ''}>📁 フォルダ：すべて (${typedItems.length})</option>`
    + ((noneCnt > 0 || curCat === GAL_NONE) ? `<option value="${GAL_NONE}"${curCat === GAL_NONE ? ' selected' : ''}>📂 （未分類） (${noneCnt})</option>` : '')
    + activeCats.map(c => `<option value="${escapeHTML(c)}"${curCat === c ? ' selected' : ''}>${escapeHTML(galFolderIndentLabel(c))} (${countOf(c)})</option>`).join('');
}

function galSelectedTagsInlineHtml(scope, selTags) {
  if (!selTags.length) return '';
  return selTags.map(t => `<button type="button" class="gal-tagchip on" data-gal="toggletag" data-gscope="${scope}" data-tagv="${escapeHTML(t)}" title="クリックで解除">✓ ${escapeHTML(t)} ✕</button>`).join('')
    + (selTags.length > 1 ? `<button type="button" class="gal-tagchip clear" data-gal="cleartags" data-gscope="${scope}" title="選択中タグをすべて解除">全解除</button>` : '');
}

function galTagPopoverInnerHtml(scope, d) {
  const { allTags, selTags, tagCounts } = d;
  const head = `<div class="gal-tagpop-head"><span>複数選択（AND絞り込み）</span>${selTags.length ? `<button type="button" class="gal-tagpop-clr" data-gal="cleartags" data-gscope="${scope}">すべて解除</button>` : ''}</div>`;
  if (!allTags.length) return head + '<div class="gal-hint">この表示範囲の素材に付いているタグはありません</div>';
  const chips = allTags.map(t => {
    const on = galHasTag(selTags, t);
    const cnt = tagCounts.get(String(t).toLowerCase()) || 0;
    return `<button type="button" class="gal-tagchip${on ? ' on' : ''}" data-gal="toggletag" data-gscope="${scope}" data-tagv="${escapeHTML(t)}" aria-pressed="${on}">${on ? '✓ ' : ''}${escapeHTML(t)} <small>${cnt}</small></button>`;
  }).join('');
  return head + `<div class="gal-tagpop-list">${chips}</div>`;
}

function galTreeHtml(scope, d) {
  const { tree, curCat, countOf } = d;
  const collapsedSet = galCollapsed[scope] || (galCollapsed[scope] = new Set());
  const isCustomSel = curCat !== GAL_ALL && curCat !== GAL_NONE;
  const row = (key, label, ico, sortable, node, depth) => {
    const hasKids = !!(node && node.children.length), collapsed = hasKids && collapsedSet.has(key);
    const caret = sortable
      ? (hasKids ? `<span class="gal-tree-caret" data-gal="tree-tg" data-gscope="${scope}" data-gcat="${escapeHTML(key)}" title="${collapsed ? '展開' : '折りたたむ'}">${collapsed ? '▸' : '▾'}</span>` : '<span class="gal-tree-caret ph"></span>')
      : '';
    return `<div class="gal-tree-row${curCat === key ? ' on' : ''}" data-gal="open-folder" data-gscope="${scope}" data-gcat="${escapeHTML(key)}"${sortable ? ' draggable="true"' : ''}${depth ? ` style="padding-left:${8 + depth * 14}px"` : ''} title="${escapeHTML(key === GAL_ALL || key === GAL_NONE ? label : key)}${sortable ? '（ドラッグで並べ替え・小フォルダ化／素材ドロップで移動／右クリックで操作）' : '（ここへ素材をドラッグで移動）'}">
      <span class="gal-tree-name">${caret}${ico} ${escapeHTML(label)}</span>
      <span class="gal-tree-right">${sortable ? `<span class="gal-tree-btns"><button type="button" class="gal-tree-btn" data-gal="add-sub" data-gscope="${scope}" data-gcat="${escapeHTML(key)}" title="この中に小フォルダを作成">＋</button><button type="button" class="gal-tree-btn" data-gal="tree-mv" data-dir="up" data-gscope="${scope}" data-gcat="${escapeHTML(key)}" title="上へ移動">▲</button><button type="button" class="gal-tree-btn" data-gal="tree-mv" data-dir="down" data-gscope="${scope}" data-gcat="${escapeHTML(key)}" title="下へ移動">▼</button></span>` : ''}<small>${countOf(key)}</small></span>
    </div>`;
  };
  const walk = (list, depth) => list.map(n => row(n.path, galBaseOf(n.path), '📁', true, n, depth) + (collapsedSet.has(n.path) ? '' : walk(n.children, depth + 1))).join('');
  return `<aside class="gal-tree-pane" aria-label="フォルダ階層ツリー">
    <div class="gal-tree-head">
      <b>📁 フォルダ</b>
      <span class="gal-tree-head-acts">
        <button type="button" class="gal-tree-btn" data-gal="add-folder" data-gscope="${scope}" title="新規フォルダ（小フォルダも作成できます）">＋</button>
        <button type="button" class="gal-tree-btn" data-gal="rename" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}" title="選択中フォルダ名を変更"${isCustomSel ? '' : ' disabled'}>✎</button>
        <button type="button" class="gal-tree-btn" data-gal="move-cat" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}" title="選択中フォルダを別の親フォルダへ移動"${isCustomSel ? '' : ' disabled'}>⤴</button>
        <button type="button" class="gal-tree-btn danger" data-gal="del-cat" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}" title="選択中フォルダを削除"${isCustomSel ? '' : ' disabled'}>🗑</button>
      </span>
    </div>
    <div class="gal-tree-list">${row(GAL_ALL, 'すべて', '🗂️', false, null, 0)}${row(GAL_NONE, '（未分類）', '📂', false, null, 0)}${walk(tree.roots, 0)}</div>
  </aside>`;
}

function galBreadcrumbHtml(scope, curCat, visLen) {
  if (curCat === GAL_NONE) {
    return `<span class="gal-folder-cur">📂 （未分類） <small>(${visLen}件)</small></span>`;
  }
  const segs = String(curCat || '').split('/').filter(Boolean);
  let acc = '';
  const parts = segs.map((s, idx) => {
    acc = acc ? (acc + '/' + s) : s;
    const isLast = idx === segs.length - 1;
    if (isLast) return `<span class="gal-bc-cur">📁 ${escapeHTML(s)} <small>(${visLen}件)</small></span>`;
    return `<button type="button" class="gal-bc-btn" data-gal="open-folder" data-gscope="${scope}" data-gcat="${escapeHTML(acc)}">📁 ${escapeHTML(s)}</button><span class="gal-bc-sep">›</span>`;
  }).join('');
  return `<div class="gal-bc">${parts}</div>`;
}

function galleryBodyHtml(scope, ctx, d) {
  const { allItems, tree, curCat, f, selTags, byCat, visible, isFolderView, showFolderCards, countOf, descItemsOf } = d;
  const isLibPlaying = p => window.CCF && CCF.library && CCF.library.isPlaying && CCF.library.isPlaying(p);

  const chkIds = visible.filter(it => galChk.img.has(it.uid)).map(it => it.uid);
  const allVisibleChecked = visible.length > 0 && chkIds.length === visible.length;
  const totalSelectedInScope = allItems.filter(it => galChk.img.has(it.uid)).length;

  let bodyGridHtml = '';
  if (galPageState[scope] && galPageState[scope].obs) {
    try { galPageState[scope].obs.disconnect(); } catch (_) { }
  }
  if (showFolderCards) {
    galPageState[scope] = null;
    const rootNodes = tree.roots.filter(n => countOf(n.path) > 0 || n.children.length > 0 || (!f.type && galKept[scope].has(n.path)));
    const folderEntries = rootNodes.map(n => ({ key: n.path, label: galBaseOf(n.path), items: descItemsOf(n.path), childCount: n.children.length, isCustom: true }));
    const noneItems = byCat.get(GAL_NONE) || [];
    if (noneItems.length) folderEntries.push({ key: GAL_NONE, label: '（未分類）', items: noneItems, childCount: 0, isCustom: false });

    const fCards = folderEntries.map(fe => {
      let repImg = null, repSrc = '';
      for (let i = 0; i < fe.items.length; i++) {
        const cand = fe.items[i];
        if (cand && cand.type === 'image' && !cand.missing) {
          const s = galItemThumbUrl(cand);
          if (s) { repImg = cand; repSrc = s; break; }
        }
      }
      let thumbHtml = '';
      if (repImg && repSrc) {
        const thumbAttr = (!repImg.dataUrl && repImg.path && !localThumbCache.has(repImg.path)) ? ` data-thumb-path="${escapeHTML(repImg.path)}"` : '';
        thumbHtml = `<div class="gal-folder-thumb"><img ${repImg.dataUrl ? imgAttr(repImg.dataUrl) : `src="${escapeHTML(repSrc)}"${thumbAttr}`} alt="" loading="lazy" decoding="async" draggable="false"></div>`;
      } else if (fe.items.length) {
        thumbHtml = `<div class="gal-folder-thumb ico">${galIcon(fe.items[0])}</div>`;
      } else {
        thumbHtml = `<div class="gal-folder-thumb ico">📁</div>`;
      }
      const editActs = fe.isCustom
        ? `<div class="gal-folder-acts"><button type="button" class="gal-mini" data-gal="add-sub" data-gscope="${scope}" data-gcat="${escapeHTML(fe.key)}" title="この中に小フォルダを作成">＋</button><button type="button" class="gal-mini" data-gal="rename" data-gscope="${scope}" data-gcat="${escapeHTML(fe.key)}" title="フォルダ名を変更">✎</button><button type="button" class="gal-mini" data-gal="move-cat" data-gscope="${scope}" data-gcat="${escapeHTML(fe.key)}" title="別の親フォルダへ移動">⤴</button><button type="button" class="gal-mini" data-gal="del-cat" data-gscope="${scope}" data-gcat="${escapeHTML(fe.key)}" title="フォルダを削除">✕</button></div>`
        : '';
      const isEditingFolder = fe.isCustom && galEdit && galEdit.scope === scope && galEdit.cat === fe.key;
      const subBadge = fe.childCount ? `<span class="gal-folder-subcnt" title="小フォルダ ${fe.childCount}件">📂${fe.childCount}</span>` : '';
      const nameHtml = isEditingFolder
        ? `<input type="text" class="gal-rename" value="${escapeHTML(galBaseOf(fe.key))}">`
        : `<span class="gal-folder-name">📁 ${escapeHTML(fe.label)}</span>${subBadge}<span class="gal-folder-cnt">${fe.items.length}件</span>`;
      return `<div class="gal-folder-card"${fe.isCustom ? ' draggable="true"' : ''} data-gal="open-folder" data-gscope="${scope}" data-gcat="${escapeHTML(fe.key)}" title="${escapeHTML(fe.key === GAL_NONE ? fe.label : fe.key)}（${fe.items.length}件）">
        <div class="gal-folder-thumbs">${thumbHtml}</div>
        <div class="gal-folder-info">${nameHtml}</div>
        ${editActs}
      </div>`;
    }).join('');
    bodyGridHtml = `<div class="gal-folder-grid">${fCards || `<div class="gal-empty">表示できるフォルダがありません（右上の「📂 監視フォルダ選択」からフォルダを指定するか、素材をドロップしてください）</div>`}</div>`;
    return `<div class="gal-drop" data-gdrop="${scope}">${bodyGridHtml}</div>`;
  }

  const initialCount = Math.min(GAL_PAGE_SIZE, visible.length);
  const initialSlice = visible.slice(0, initialCount);
  if (IS_ELECTRON && window.CCF && CCF.library && CCF.library.ensureAudioTags && initialSlice.some(it => it.type === 'audio' && it.path)) {
    CCF.library.ensureAudioTags(initialSlice.slice(0, 50));
  }
  const initialCards = initialSlice.map(it => galRenderCardHtml(scope, it, selTags, isLibPlaying)).join('');
  const rem = visible.length - initialCount;
  const moreHtml = rem > 0
    ? `<div class="gal-more-wrap" data-gal-morewrap="${scope}"><button type="button" class="btn-sort" data-gal="load-more" data-gscope="${scope}">さらに${GAL_PAGE_SIZE}件を表示（残り${rem}件）</button></div>`
    : '';
  galPageState[scope] = rem > 0
    ? { list: visible, offset: initialCount, selTags: selTags.slice(), isLibPlaying, obs: null }
    : null;
  const emptyHtml = `<div class="gal-empty">表示できる${ctx.label}素材がありません（PCからドラッグ＆ドロップで追加／未指定時は自動仕分け・未分類へ格納）</div>`;
  bodyGridHtml = `<div class="gal-grid">${initialCards ? (initialCards + moreHtml) : emptyHtml}</div>`;

  const isCustomOpen = curCat !== GAL_ALL && curCat !== GAL_NONE;
  const isEditingOpen = isCustomOpen && galEdit && galEdit.scope === scope && galEdit.cat === curCat;
  const curTitleHtml = isEditingOpen
    ? `<input type="text" class="gal-rename" value="${escapeHTML(galBaseOf(curCat))}">`
    : galBreadcrumbHtml(scope, curCat, visible.length);
  const folderNavBar = (isFolderView && curCat !== GAL_ALL)
    ? `<div class="gal-folder-nav">
        <button type="button" class="btn-sort" data-gal="back-folders" data-gscope="${scope}">⬅ フォルダ一覧へ戻る</button>
        ${curTitleHtml}
        <div class="gal-folder-nav-right">
          ${isCustomOpen ? `<button type="button" class="btn-sort" data-gal="add-sub" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}">＋ 小フォルダ</button><button type="button" class="btn-sort" data-gal="rename" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}">✏️ 名前変更</button><button type="button" class="btn-sort" data-gal="move-cat" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}">⤴ 移動</button><button type="button" class="btn-sort btn-danger" data-gal="del-cat" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}">🗑️ 削除</button>` : ''}
          <select class="gal-folder-jump" data-gal-folder="${scope}" aria-label="フォルダ切替">${galFolderSelectOptionsHtml(scope, d, true)}</select>
        </div>
      </div>`
    : '';

  const curNode = isCustomOpen ? tree.nodes.get(curCat) : null;
  const subStrip = (curNode && curNode.children.length)
    ? `<div class="gal-substrip"><span class="gal-substrip-lbl">小フォルダ:</span>${curNode.children.map(ch => `<button type="button" class="gal-subchip" data-gal="open-folder" data-gscope="${scope}" data-gcat="${escapeHTML(ch.path)}" title="クリックで開く／素材をドロップで移動">📁 ${escapeHTML(galBaseOf(ch.path))} <small>(${countOf(ch.path)})</small></button>`).join('')}</div>`
    : '';

  const moveOpts = `<option value="">（未分類へ移動）</option>` + galFolderOptionsHtml(tree.flat, '');
  const bulkBar = `<div class="gal-bulkbar">
      <button type="button" class="btn-sort" data-gal="sel-all" data-gscope="${scope}">${allVisibleChecked ? '☑ 表示中を全解除' : '☐ 表示中を全選択'}</button>
      <select data-gal-dest="${scope}" aria-label="移動先フォルダ">${moveOpts}</select>
      <button type="button" class="btn-sort" data-gal="bulk-move" data-gscope="${scope}" ${totalSelectedInScope ? '' : 'disabled'}>📁 選択を移動 (${totalSelectedInScope})</button>
      <span class="gal-mvgrp"${totalSelectedInScope ? '' : ' hidden'}>
        <button type="button" class="btn-sort" data-gal="mv-first" data-gscope="${scope}" title="選択中を先頭へ移動">⏫ 先頭へ移動</button>
        <button type="button" class="btn-sort" data-gal="mv-prev" data-gscope="${scope}" title="選択中を1つ前へ">◀ 前へ</button>
        <button type="button" class="btn-sort" data-gal="mv-next" data-gscope="${scope}" title="選択中を1つ後ろへ">▶ 次へ</button>
        <button type="button" class="btn-sort" data-gal="mv-last" data-gscope="${scope}" title="選択中を末尾へ移動">⏬ 末尾へ移動</button>
      </span>
      <button type="button" class="btn-sort btn-danger" data-gal="bulk-img" data-gscope="${scope}" ${totalSelectedInScope ? '' : 'disabled'}>🗑 選択を削除 (${totalSelectedInScope})</button>
      ${scope === 'common' && currentScenarioId ? `<button type="button" class="btn-sort" data-gal="copy-to-sc" ${totalSelectedInScope ? '' : 'disabled'}>📌 編集中のシナリオへコピー (${totalSelectedInScope})</button>` : ''}
      ${scope === 'scenario' ? `<button type="button" class="btn-sort" data-gal="send-to-lib" data-gscope="scenario" ${totalSelectedInScope ? '' : 'disabled'} title="選択中の素材をマイライブラリ（共通）へコピー／移動（SHA-256同一画像は自動統合）">🌐 マイライブラリへ送る (${totalSelectedInScope})</button>` : ''}
      <button type="button" class="btn-sort" data-gal="sel-clear"${galChk.img.size ? '' : ' hidden'}>✕ 選択解除</button>
    </div>`;

  return `<div class="gal-split">
    ${galTreeHtml(scope, d)}
    <div class="gal-main-pane">
      ${folderNavBar}
      ${bulkBar}
      ${subStrip}
      <div class="gal-drop" data-gdrop="${scope}">${bodyGridHtml}</div>
    </div>
  </div>`;
}

function galleryHtml(scope) {
  const ctx = galCtx(scope);
  if (!ctx) return '<div class="gal-note">※ このシナリオを先にDBに保存すると、登録素材の一覧や管理が使えます</div>';
  const d = galComputeViewData(scope, ctx);
  const { allItems, curCat, f, selTags, allTags, isFolderView, tagOpen } = d;
  const watchRoot = (window.CCF && CCF.library && CCF.library.state && CCF.library.state.root) ? CCF.library.state.root : '';
  const watchBase = watchRoot ? ((typeof path !== 'undefined' && path && path.basename) ? path.basename(watchRoot) : (String(watchRoot).split(/[\\/]/).filter(Boolean).pop() || watchRoot)) : '';
  const typePills = `<div class="gal-type-pills" role="group" aria-label="種別フィルタ">
    <button type="button" class="gal-type-pill${f.type === '' ? ' on' : ''}" data-gal="set-type" data-gscope="${scope}" data-gtype="">すべて</button>
    <button type="button" class="gal-type-pill${f.type === 'image' ? ' on' : ''}" data-gal="set-type" data-gscope="${scope}" data-gtype="image">🖼️ 画像のみ</button>
    <button type="button" class="gal-type-pill${f.type === 'audio' ? ' on' : ''}" data-gal="set-type" data-gscope="${scope}" data-gtype="audio">🎵 音声のみ</button>
  </div>`;
  const viewToggle = scope === 'common'
    ? `<div class="gal-view-toggle" role="group" aria-label="表示形式切替">
        <button type="button" class="btn-sort${galViewMode.common === 'folder' ? ' on' : ''}" data-gal="set-view" data-gscope="${scope}" data-gview="folder">📁 フォルダ一覧</button>
        <button type="button" class="btn-sort${galViewMode.common === 'list' ? ' on' : ''}" data-gal="set-view" data-gscope="${scope}" data-gview="list">🖼️ 素材一覧</button>
      </div>`
    : '';
  const isCustomListSel = !isFolderView && curCat !== GAL_ALL && curCat !== GAL_NONE;
  const isListRename = isCustomListSel && galEdit && galEdit.scope === scope && galEdit.cat === curCat;
  const listFolderControl = !isFolderView
    ? (isListRename
        ? `<input type="text" class="gal-rename" value="${escapeHTML(galBaseOf(curCat))}">`
        : `<select class="gal-folder-sel" data-gal-folder="${scope}" aria-label="フォルダ絞り込み">${galFolderSelectOptionsHtml(scope, d, false)}</select>`)
      + (isCustomListSel && !isListRename
        ? `<button type="button" class="btn-sort" data-gal="rename" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}" title="選択中フォルダ名を変更">✏️</button><button type="button" class="btn-sort" data-gal="move-cat" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}" title="選択中フォルダを別の親フォルダへ移動">⤴</button><button type="button" class="btn-sort btn-danger" data-gal="del-cat" data-gscope="${scope}" data-gcat="${escapeHTML(curCat)}" title="選択中フォルダを削除">🗑️</button>`
        : '')
    : '';
  const incSubChk = (curCat !== GAL_ALL && curCat !== GAL_NONE)
    ? `<label class="gal-incsub-lbl" title="OFFにするとこのフォルダ直下の素材だけを表示します"><input type="checkbox" data-gal="incsub" data-gscope="${scope}" ${galIncSub[scope] ? 'checked' : ''}> <span>サブフォルダも含めて表示</span></label>`
    : '';
  const selTagsInline = `<div class="gal-seltags-inline" data-gal-seltags="${scope}"${selTags.length ? '' : ' hidden'}>${galSelectedTagsInlineHtml(scope, selTags)}</div>`;
  return `<div class="gal-bar">
      <b>${scope === 'common' ? '🖼️ 共通ギャラリー（マイライブラリ統合）' : `📌 登録素材（全 ${allItems.length}件）`}</b>
      ${viewToggle}
      ${scope === 'common' ? `<button type="button" class="btn-sort" data-gal="pick-root">📂 監視フォルダ選択</button>${watchRoot ? `<button type="button" class="btn-sort btn-danger" data-gal="unwatch-root" title="監視フォルダの設定を解除">✕ 監視解除</button>` : ''}<button type="button" class="btn-sort" data-gal="sync-lib">🔄 同期</button>${watchRoot ? `<span class="gal-hint" title="${escapeHTML(watchRoot)}">監視中: ${escapeHTML(watchBase)}</span>` : ''}` : ''}
      ${scope === 'scenario' ? `<button type="button" class="btn-sort" data-gal="open-am">🗗 登録素材を拡大管理</button>` : ''}
      <span class="gal-hint">${scope === 'common' ? 'マイライブラリ監視フォルダとリアルタイム連動' : '詳細モーダル・ココフォリアタブと100%同期'}</span>
      <button type="button" class="btn-sort" data-gal="merge-dup" data-gscope="${scope}" title="名前が違っても中身が完全に同じ画像（SHA-256一致）を1件に統合します">🧹 同一画像を統合</button>
      <button type="button" class="btn-sort" data-gal="add-folder" data-gscope="${scope}">＋ フォルダ追加</button>
    </div>
    <div class="gal-filters">
      ${typePills}
      ${listFolderControl}
      ${incSubChk}
      <input type="search" data-gal-q="${scope}" placeholder="🔍 検索（スペース / -除外語）" value="${escapeHTML(f.q)}">
      ${selTagsInline}
      <div class="gal-tagpop-wrap" data-gal-tagwrap="${scope}">
        <button type="button" class="btn-sort${tagOpen ? ' on' : ''}" data-gal="toggle-tagbar" data-gscope="${scope}">🏷️ タグ絞り込み (${allTags.length})${selTags.length ? ` [${selTags.length}]` : ''} ▾</button>
        <div class="gal-tagpop" data-gal-tagpop="${scope}"${tagOpen ? '' : ' hidden'}>${galTagPopoverInnerHtml(scope, d)}</div>
      </div>
      <select data-gal-sort="${scope}" aria-label="並び順">
        <option value="manual"${f.sort === 'manual' ? ' selected' : ''}>↕ カスタム順（D&amp;D）</option>
        <option value="name"${f.sort === 'name' ? ' selected' : ''}>🔤 名前順（自然順）</option>
        <option value="character"${f.sort === 'character' ? ' selected' : ''}>👤 キャラ・名前まとまり順（先頭番号を除く）</option>
        <option value="added"${f.sort === 'added' ? ' selected' : ''}>🕒 登録順</option>
      </select>
      <button type="button" class="btn-sort" data-gal="save-order" data-gscope="${scope}" title="現在の並び順をカスタム順として保存">📌 今の並びをカスタム順に保存</button>
      ${(f.q || selTags.length || f.type) ? `<button type="button" class="btn-sort" data-gal="clear-filt" data-gscope="${scope}">✕ 条件クリア</button>` : ''}
    </div>
    <div class="gal-body" data-gal-body="${scope}">${galleryBodyHtml(scope, ctx, d)}</div>`;
}

function galAppendMore(scope) {
  const st = galPageState[scope];
  if (!st || st.offset >= st.list.length) return;
  const hostId = scope === 'common' ? 'galleryTab' : 'scenarioGallery';
  const host = document.getElementById(hostId);
  const moreWrap = host && host.querySelector(`[data-gal-morewrap="${scope}"]`);
  if (!moreWrap) return;
  const nextChunk = st.list.slice(st.offset, st.offset + GAL_PAGE_SIZE);
  if (IS_ELECTRON && window.CCF && CCF.library && CCF.library.ensureAudioTags && nextChunk.some(it => it.type === 'audio' && it.path)) {
    CCF.library.ensureAudioTags(nextChunk.slice(0, 50));
  }
  const html = nextChunk.map(it => galRenderCardHtml(scope, it, st.selTags, st.isLibPlaying)).join('');
  moreWrap.insertAdjacentHTML('beforebegin', html);
  st.offset += nextChunk.length;
  const rem = st.list.length - st.offset;
  if (rem <= 0) {
    if (st.obs) { try { st.obs.disconnect(); } catch (_) { } st.obs = null; }
    moreWrap.remove();
    galPageState[scope] = null;
  } else {
    const btn = moreWrap.querySelector(`[data-gal="load-more"]`);
    if (btn) btn.textContent = `さらに${GAL_PAGE_SIZE}件を表示（残り${rem}件）`;
  }
}

function attachGalleryPager(scope, rootEl) {
  const st = galPageState[scope];
  if (!st || !rootEl) return;
  const moreWrap = rootEl.querySelector(`[data-gal-morewrap="${scope}"]`);
  if (!moreWrap || typeof IntersectionObserver !== 'function') return;
  const obs = new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting)) galAppendMore(scope);
  }, { root: null, rootMargin: '240px' });
  obs.observe(moreWrap);
  st.obs = obs;
}

const docsAbs = rel => rel ? path.resolve(DATA_ROOT, rel) : '';
const docFilePath = d => {
  if (!d) return '';
  if (d.rel) {
    const abs = docsAbs(d.rel);
    if (abs && (!fs || !fs.existsSync || fs.existsSync(abs))) return abs;
  }
  return d.path || d.ref || (d.rel ? docsAbs(d.rel) : '');
};
const fileExt = n => (n.split('.').pop() || '').toLowerCase();
const docFileExt = d => {
  if (!d) return 'DOC';
  const candidates = [d.origName, d.path, d.rel, d.name];
  for (const raw of candidates) {
    const s = String(raw || '').split(/[?#]/)[0].trim();
    if (!s) continue;
    const base = s.split(/[\\/]/).pop() || '';
    const m = /\.([a-z0-9]{1,6})$/i.exec(base);
    if (m && /[a-z]/i.test(m[1])) return m[1].toUpperCase();
  }
  return 'DOC';
};

function docsHtml() {
  const sc = appState.scenarios.find(s => s.id === currentScenarioId);
  if (!sc) return '<div class="gal-note">※ このシナリオを先にDBに保存すると、資料ファイルを登録できます</div>';
  const docs = sc.docs || [], chkN = docs.filter(d => galChk.doc.has(d.id)).length;
  const rows = docs.map(d => {
    const fp = docFilePath(d);
    return `<div class="doc-row" data-did="${escapeHTML(d.id)}">
    <input type="checkbox" class="gal-chk" data-gal-docchk="${escapeHTML(d.id)}" ${galChk.doc.has(d.id) ? 'checked' : ''} title="選択">
    <span class="doc-ext">${escapeHTML(docFileExt(d))}</span>
    <span class="doc-name" title="${escapeHTML(fp || d.name)}">${escapeHTML(d.name)}</span>
    ${IS_ELECTRON && fp ? `<button type="button" class="btn-sort" data-doc="open">開く</button><button type="button" class="btn-sort" data-doc="reveal">場所</button>` : ''}
    <button type="button" class="btn-sort btn-danger" data-doc="del">🗑️</button></div>`;
  }).join('')
    || '<div class="gal-empty">PDF / HTML / テキストファイルをここにドラッグ＆ドロップ（PC内の別場所へ複製保存されます）</div>';
  return `<div class="gal-bar"><b>📄 シナリオ資料（PDF / HTML / TXT）</b><span class="gal-hint">${IS_ELECTRON ? 'クリックで開く（PCの別フォルダに保持されます）' : '※ ローカル保存・閲覧はデスクトップ版で使えます'}</span></div>
    <div class="gal-bulkbar"><button type="button" class="btn-sort" data-doc-bulk="sel-all">${chkN && chkN === docs.length ? '全選択解除' : '全選択'}</button><button type="button" class="btn-sort btn-danger" data-doc-bulk="bulk-del" ${chkN ? '' : 'disabled'}>🗑️ 選択した資料を削除 (${chkN})</button></div>
    <div class="doc-drop" data-docdrop="1">${rows}</div>`;
}

function renderGalleryScope(scope) {
  const id = scope === 'common' ? 'galleryTab' : 'scenarioGallery';
  const el = document.getElementById(id);
  if (!el) return;
  try {
    el.innerHTML = galleryHtml(scope);
    el.dataset.galReady = '1';
    attachGalleryPager(scope, el);
  } catch (e) {
    console.error('gallery render error', id, e);
    el.innerHTML = '<div class="gal-note">※ 描画エラー: ' + escapeHTML(String(e && e.message || e)) + '</div>';
  }
}

function renderGalleryGridOnly(scope) {
  const id = scope === 'common' ? 'galleryTab' : 'scenarioGallery';
  const el = document.getElementById(id);
  if (!el) return;
  const bodyEl = el.querySelector(`[data-gal-body="${scope}"]`);
  if (!bodyEl) return renderGalleryScope(scope);
  const ctx = galCtx(scope);
  if (!ctx) { bodyEl.innerHTML = '<div class="gal-note">※ このシナリオを先にDBに保存すると、登録素材の一覧や管理が使えます</div>'; return; }
  const d = galComputeViewData(scope, ctx);
  try {
    bodyEl.innerHTML = galleryBodyHtml(scope, ctx, d);
    attachGalleryPager(scope, bodyEl);
    const tagBtn = el.querySelector(`[data-gal="toggle-tagbar"][data-gscope="${scope}"]`);
    if (tagBtn) {
      tagBtn.classList.toggle('on', !!d.tagOpen);
      tagBtn.textContent = `🏷️ タグ絞り込み (${d.allTags.length})${d.selTags.length ? ` [${d.selTags.length}]` : ''} ▾`;
    }
    const selTagsEl = el.querySelector(`[data-gal-seltags="${scope}"]`);
    if (selTagsEl) {
      selTagsEl.innerHTML = galSelectedTagsInlineHtml(scope, d.selTags);
      selTagsEl.hidden = !d.selTags.length;
    }
    const tagPopEl = el.querySelector(`[data-gal-tagpop="${scope}"]`);
    if (tagPopEl) {
      tagPopEl.innerHTML = galTagPopoverInnerHtml(scope, d);
      tagPopEl.hidden = !d.tagOpen;
    }
    const filtersEl = el.querySelector('.gal-filters');
    if (filtersEl) {
      const hasFilt = !!(d.f.q || d.selTags.length || d.f.type);
      const clrBtn = filtersEl.querySelector(`[data-gal="clear-filt"][data-gscope="${scope}"]`);
      if (hasFilt && !clrBtn) {
        filtersEl.insertAdjacentHTML('beforeend', `<button type="button" class="btn-sort" data-gal="clear-filt" data-gscope="${scope}">✕ 条件クリア</button>`);
      } else if (!hasFilt && clrBtn) {
        clrBtn.remove();
      }
    }
  } catch (e) {
    console.error('gallery grid render error', id, e);
    bodyEl.innerHTML = '<div class="gal-note">※ 描画エラー: ' + escapeHTML(String(e && e.message || e)) + '</div>';
  }
}

function galUpdateBulkBarOnly(scope) {
  const hostId = scope === 'common' ? 'galleryTab' : 'scenarioGallery';
  const el = document.getElementById(hostId);
  if (!el) return;
  const bar = el.querySelector('.gal-bulkbar');
  if (!bar) return;
  const ctx = galCtx(scope);
  if (!ctx) return;
  const allItems = galUnifiedItems(scope, ctx);
  const visible = galVisibleItems(scope, allItems);
  let checkedVis = 0;
  for (let i = 0; i < visible.length; i++) {
    if (galChk.img.has(visible[i].uid)) checkedVis++;
  }
  const allVisibleChecked = visible.length > 0 && checkedVis === visible.length;
  let totalSelectedInScope = 0;
  for (let i = 0; i < allItems.length; i++) {
    if (galChk.img.has(allItems[i].uid)) totalSelectedInScope++;
  }
  const selAllBtn = bar.querySelector('[data-gal="sel-all"]');
  if (selAllBtn) selAllBtn.textContent = allVisibleChecked ? '☑ 表示中を全解除' : '☐ 表示中を全選択';
  const moveBtn = bar.querySelector('[data-gal="bulk-move"]');
  if (moveBtn) {
    moveBtn.disabled = !totalSelectedInScope;
    moveBtn.textContent = `📁 選択を移動 (${totalSelectedInScope})`;
  }
  const mvGrp = bar.querySelector('.gal-mvgrp');
  if (mvGrp) mvGrp.hidden = !totalSelectedInScope;
  const delBtn = bar.querySelector('[data-gal="bulk-img"]');
  if (delBtn) {
    delBtn.disabled = !totalSelectedInScope;
    delBtn.textContent = `🗑 選択を削除 (${totalSelectedInScope})`;
  }
  const copyBtn = bar.querySelector('[data-gal="copy-to-sc"]');
  if (copyBtn) {
    copyBtn.disabled = !totalSelectedInScope;
    copyBtn.textContent = `📌 編集中のシナリオへコピー (${totalSelectedInScope})`;
  }
  const sendLibBtn = bar.querySelector('[data-gal="send-to-lib"]');
  if (sendLibBtn) {
    sendLibBtn.disabled = !totalSelectedInScope;
    sendLibBtn.textContent = `🌐 マイライブラリへ送る (${totalSelectedInScope})`;
  }
  const clrBtn = bar.querySelector('[data-gal="sel-clear"]');
  if (clrBtn) clrBtn.hidden = !galChk.img.size;
}

function renderDocsScope() {
  const el = document.getElementById('scenarioDocs');
  if (!el) return;
  try { el.innerHTML = docsHtml(); el.dataset.galReady = '1'; } catch (e) { console.error('gallery render error scenarioDocs', e); el.innerHTML = '<div class="gal-note">※ 描画エラー: ' + escapeHTML(String(e && e.message || e)) + '</div>'; }
}

function renderGalleryAll(force) {
  const forceAll = force === true;
  if (forceAll || galIsTabActive('galleryTab')) {
    galDirty.common = false;
    renderGalleryScope('common');
  } else {
    galDirty.common = true;
  }
  if (forceAll || galIsTabActive('postTab')) {
    galDirty.scenario = false;
    renderGalleryScope('scenario');
    renderDocsScope();
  } else {
    galDirty.scenario = true;
  }
}

function renderGalleryScenarioOnly() {
  if (galIsTabActive('postTab')) {
    galDirty.scenario = false;
    renderGalleryScope('scenario');
    renderDocsScope();
  } else {
    galDirty.scenario = true;
  }
}

function flushGalleryOnTabSwitch() {
  if (galIsTabActive('galleryTab')) {
    const el = document.getElementById('galleryTab');
    if (galDirty.common || !el || !el.dataset.galReady) {
      galDirty.common = false;
      renderGalleryScope('common');
    }
  }
  if (galIsTabActive('postTab')) {
    const el = document.getElementById('scenarioGallery');
    const docEl = document.getElementById('scenarioDocs');
    if (galDirty.scenario || !el || !el.dataset.galReady || !docEl || !docEl.dataset.galReady) {
      galDirty.scenario = false;
      renderGalleryScope('scenario');
      renderDocsScope();
    }
  }
}
window.flushGalleryOnTabSwitch = flushGalleryOnTabSwitch;

async function dataUrlFromPath(fp, name) {
  const buf = await fs.promises.readFile(fp), b64 = buf.toString('base64'), ext = fileExt(name || fp);
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  return `data:${mime};base64,${b64}`;
}

function inferDropCat(scope, explicitCat, fileName, parentFolderName) {
  if (explicitCat && explicitCat !== GAL_ALL && explicitCat !== GAL_NONE) return galNormCat(explicitCat);
  const M = galM();
  const dn = String(parentFolderName || '').trim();
  if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(String(fileName || ''))) {
    return (dn && (!M || !M.isUnclassifiedCat(dn))) ? galNormCat(dn) : 'BGM';
  }
  if (scope === 'common') {
    return (dn && (!M || !M.isUnclassifiedCat(dn))) ? galNormCat(dn) : '';
  }
  return M ? galNormCat(M.inferSmartCategory(fileName, parentFolderName)) : '';
}

function galIsSupportedNonImageName(name) {
  return /\.(mp3|wav|ogg|m4a|flac|aac|mp4|webm|mov|pdf|zip)$/i.test(String(name || ''));
}

function galNonImageTypeOf(name) {
  if (window.CCF && CCF.dnd && typeof CCF.dnd.typeOf === 'function') {
    const t = CCF.dnd.typeOf(name);
    if (t && t !== 'image') return t;
  }
  const s = String(name || '');
  if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(s)) return 'audio';
  if (/\.(mp4|webm|mov)$/i.test(s)) return 'video';
  if (/\.pdf$/i.test(s)) return 'pdf';
  if (/\.zip$/i.test(s)) return 'zip';
  return '';
}

function galExtractDroppedSync(dt) {
  const files = dt && dt.files ? [...dt.files] : [];
  const items = dt && dt.items ? [...dt.items] : [];
  const entries = items.map(it => (it && typeof it.webkitGetAsEntry === 'function') ? it.webkitGetAsEntry() : null).filter(Boolean);
  return { files, entries };
}

async function galWalkDroppedEntries(entries, fallbackFiles) {
  const M = galM();
  const mapFallback = () => (fallbackFiles || []).map(f => {
    const rel = f.webkitRelativePath || f.name || '';
    const parts = rel.split('/').filter(Boolean);
    return { file: f, name: f.name, rel, parentDir: parts.length >= 2 ? parts[parts.length - 2] : '' };
  });
  if (!entries || !entries.length) {
    return mapFallback();
  }
  const readAllDir = reader => new Promise(res => {
    const acc = [];
    const step = () => reader.readEntries(batch => { if (!batch.length) res(acc); else { acc.push(...batch); step(); } }, () => res(acc));
    step();
  });
  const out = [];
  let hadFileError = false;
  async function walk(entry, prefix, parentDir, depth) {
    if (!entry || depth > 8) return;
    const nm = entry.name || '';
    if (!nm || nm.startsWith('.') || nm === 'node_modules' || nm === '__MACOSX' || nm === '_TRPG_Data') return;
    if (entry.isFile) {
      await new Promise(res => entry.file(f => {
        const rel = prefix ? prefix + '/' + f.name : f.name;
        out.push({ file: f, name: f.name, rel, parentDir: parentDir || '' });
        res();
      }, () => { hadFileError = true; res(); }));
    } else if (entry.isDirectory) {
      if (M && M.isOldFolderName(nm)) return;
      const list = await readAllDir(entry.createReader());
      list.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
      const nextPrefix = prefix ? prefix + '/' + nm : nm;
      for (const child of list) await walk(child, nextPrefix, nm, depth + 1);
    }
  }
  for (const ent of entries) await walk(ent, '', '', 0);
  if (!out.length && fallbackFiles && fallbackFiles.length) {
    return mapFallback();
  }
  if (hadFileError && fallbackFiles && fallbackFiles.length) {
    const seen = new Set(out.map(x => `${x.name}:${x.file ? x.file.size : 0}`));
    for (const item of mapFallback()) {
      const key = `${item.name}:${item.file ? item.file.size : 0}`;
      if (!seen.has(key)) {
        out.push(item);
        seen.add(key);
      }
    }
  }
  return out;
}

function galCollectDiskFiles(dirPath, rootName, depth, out) {
  if (depth > 8) return;
  const M = galM();
  let ents = [];
  try { ents = fs.readdirSync(dirPath, { withFileTypes: true }); } catch (e) { logSoft('galleryDropDir', e); return; }
  const curDirName = path.basename(dirPath);
  for (const ent of ents) {
    const n = ent.name || '';
    if (!n || n.startsWith('.') || n === 'node_modules' || n === '__MACOSX' || n === '_TRPG_Data') continue;
    const fp = path.join(dirPath, n);
    if (ent.isDirectory()) {
      if (M && M.isOldFolderName(n)) continue;
      galCollectDiskFiles(fp, rootName ? (rootName + '/' + n) : n, depth + 1, out);
    } else if (ent.isFile()) {
      let mtime = 0;
      try { mtime = fs.statSync(fp).mtimeMs || 0; } catch (_) { }
      out.push({ path: fp, name: n, parentDir: curDirName, rel: rootName ? (rootName + '/' + n) : n, mtime });
    }
  }
}

async function galleryDrop(scope, dropPayload, dropCat) {
  const ctx = galCtx(scope); if (!ctx) return toast('先にシナリオをDBに保存してください');
  let added = 0, skipped = 0;
  const M = galM();
  const forceUnclassified = dropCat === GAL_NONE || (dropCat === undefined && galSel[scope] === GAL_NONE);
  const explicit = forceUnclassified
    ? ''
    : ((dropCat !== undefined && dropCat !== GAL_ALL)
      ? galNormCat(dropCat)
      : ((galSel[scope] && galSel[scope] !== GAL_ALL && galSel[scope] !== GAL_NONE) ? galNormCat(galSel[scope]) : ''));
  const resolveCat = (fileName, parentDir) => {
    if (forceUnclassified) return '';
    if (explicit) return explicit;
    return inferDropCat(scope, '', fileName, parentDir);
  };

  const rawFiles = Array.isArray(dropPayload) ? dropPayload : ((dropPayload && dropPayload.files) || []);
  const rawEntries = (!Array.isArray(dropPayload) && dropPayload && dropPayload.entries) || [];
  const hasAllPaths = IS_ELECTRON && rawFiles.length > 0 && rawFiles.every(f => !!filePathOf(f));

  galChkPt(`${ctx.label}ギャラリーへ素材を追加`);
  const refsToAdd = [], docsToAdd = [], browserOtherFiles = [], commonNonImgs = [], fallbackBrowserFiles = [];
  const isDocFileName = n => /\.(pdf|txt|html?|md|docx?)$/i.test(String(n || ''));
  const upsertGalImage = (nm, dataUrl, cat, mtime) => {
    const dispNm = galStripAssetExt(nm);
    const key = galStripAssetExt(nm).toLowerCase();
    const dup = ctx.items.findIndex(x => galStripAssetExt(x.origName || x.name || '').toLowerCase() === key);
    const isUncls = c => !c || c === '未分類' || c === '(未分類)';
    if (dup >= 0) {
      const cur = ctx.items[dup];
      const nextCat = (isUncls(cur.category) && !isUncls(cat)) ? cat : (cur.category || cat);
      const newer = !cur.mtime || (mtime || 0) >= cur.mtime;
      ctx.items[dup] = Object.assign({}, cur, {
        name: dispNm,
        origName: cur.origName || nm,
        category: nextCat,
        ...(newer ? { dataUrl, mtime: mtime || Date.now() } : {})
      });
    } else {
      ctx.items.push({ id: galId(), name: dispNm, origName: nm, dataUrl, category: cat, mtime: mtime || Date.now(), addedAt: Date.now() });
    }
  };

  if (hasAllPaths) {
    for (const f of rawFiles) {
      const p = filePathOf(f);
      let st = null;
      if (p) {
        try { st = fs.statSync(p); } catch (e) { logSoft('galleryDrop', e); }
      }
      if (!p || !st) {
        fallbackBrowserFiles.push(f);
        continue;
      }
      const fileItems = [];
      if (st.isDirectory()) {
        const dirName = path.basename(p);
        if (M && M.isOldFolderName(dirName)) { skipped++; continue; }
        galCollectDiskFiles(p, dirName, 0, fileItems);
      } else if (st.isFile()) {
        fileItems.push({ path: p, name: f.name || path.basename(p), parentDir: path.basename(path.dirname(p)), rel: f.name || path.basename(p), mtime: st.mtimeMs || 0 });
      }
      for (const fi of fileItems) {
        if (isImageName(fi.name)) {
          try {
            const cat = resolveCat(fi.name, fi.parentDir);
            if (cat && !ctx.cats.includes(cat)) ctx.cats.push(cat);
            const dataUrl = await dataUrlFromPath(fi.path, fi.name);
            upsertGalImage(fi.name, dataUrl, cat, fi.mtime || 0);
            added++;
          } catch (e) { logSoft('galleryDrop', e); skipped++; }
        } else if (galIsSupportedNonImageName(fi.name)) {
          const cat = resolveCat(fi.name, fi.parentDir);
          const tp = galNonImageTypeOf(fi.name);
          if (scope === 'common' && tp) {
            commonNonImgs.push({ name: fi.name, path: fi.path, category: cat, rel: fi.rel, mtime: fi.mtime || 0 });
          } else if (scope === 'scenario' && isDocFileName(fi.name)) {
            docsToAdd.push({ name: galStripAssetExt(fi.name), origName: fi.name, path: fi.path, category: cat || '資料', mtime: fi.mtime || 0 });
            added++;
          } else if (scope === 'scenario' && tp) {
            refsToAdd.push({ type: tp, name: galStripAssetExt(fi.name), origName: fi.name, path: fi.path, category: cat, mtime: fi.mtime || 0 });
            added++;
          } else {
            skipped++;
          }
        } else {
          skipped++;
        }
      }
    }
  }
  const browserQueue = !hasAllPaths
    ? await galWalkDroppedEntries(rawEntries, rawFiles)
    : (fallbackBrowserFiles.length ? await galWalkDroppedEntries([], fallbackBrowserFiles) : []);
  if (browserQueue.length) {
    for (const ent of browserQueue) {
      const f = ent.file; if (!f) continue;
      const nm = ent.name || f.name || '';
      if (isImageName(nm) || (f.type && f.type.startsWith('image/'))) {
        const cat = resolveCat(nm, ent.parentDir || '');
        if (cat && !ctx.cats.includes(cat)) ctx.cats.push(cat);
        const dataUrl = await imageFileToDataUrl(f);
        if (dataUrl) {
          upsertGalImage(nm, dataUrl, cat, f.lastModified || 0);
          added++;
        } else {
          skipped++;
        }
      } else if (galIsSupportedNonImageName(nm)) {
        const cat = resolveCat(nm, ent.parentDir || '');
        if (scope === 'common') {
          commonNonImgs.push({ file: f, name: nm, category: cat, rel: ent.rel || nm, mtime: f.lastModified || 0 });
        } else if (scope === 'scenario') {
          browserOtherFiles.push({ file: f, cat });
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    }
  }

  if (commonNonImgs.length && window.CommonAssets && typeof window.CommonAssets.addNonImageFiles === 'function') {
    added += await window.CommonAssets.addNonImageFiles(commonNonImgs);
  }
  if (docsToAdd.length && ctx.sc) {
    if (window.CCF && CCF.dnd && typeof CCF.dnd.upsertScenarioDocs === 'function') {
      CCF.dnd.upsertScenarioDocs(ctx.sc, docsToAdd);
    } else if (window.CCF && CCF.assets && typeof CCF.assets.addDocsToScenario === 'function') {
      CCF.assets.addDocsToScenario(ctx.sc, docsToAdd);
    }
  }
  if (refsToAdd.length && ctx.sc && window.CCF && CCF.withProject && M) {
    CCF.withProject(String(ctx.sc.id), proj => M.addRefs(proj, refsToAdd));
  }
  if (browserOtherFiles.length && ctx.sc && window.CCF && CCF.assets && typeof CCF.assets.addBrowserFiles === 'function') {
    const byCat = new Map();
    browserOtherFiles.forEach(({ file, cat }) => {
      const k = cat || '';
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k).push(file);
    });
    for (const [cat, list] of byCat) {
      added += await CCF.assets.addBrowserFiles(String(ctx.sc.id), list, cat);
    }
  }
  saveState();
  try { if (window.CommonAssets && window.CommonAssets.invalidate) window.CommonAssets.invalidate(); } catch (_) { }
  ctx.save();
  renderGalleryAll();
  toast(added ? `✅ ${added}件の素材を${ctx.label}に追加しました${skipped ? `（対象外 ${skipped}件）` : ''}` : '画像・音声・ZIP等の対応ファイルをドロップしてください');
}

async function docsDrop(files) {
  const sc = appState.scenarios.find(s => s.id === currentScenarioId);
  if (!sc || !IS_ELECTRON) return toast(IS_ELECTRON ? '先にシナリオをDBに保存してください' : '資料登録はデスクトップ版で使えます');
  sc.docs = sc.docs || [];
  const dir = path.join(DATA_ROOT, 'scenarios', String(sc.id).replace(/[^\w-]/g, '_'));
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { logSoft('docsDrop', e); return toast('❌ 保存フォルダを作成できませんでした'); }
  galChkPt('シナリオ資料を追加');
  let n = 0;
  for (const f of files) {
    const p = filePathOf(f); if (!p) continue; let st; try { st = fs.statSync(p); } catch (e) { logSoft('docsDrop', e); continue; } if (!st.isFile()) continue;
    let name = path.basename(p); const base = name.replace(/(\.[^.]+)$/, ''), ext = name.slice(base.length);
    for (let k = 1; fs.existsSync(path.join(dir, name)); k++) name = `${base}_${k}${ext}`;
    try { fs.copyFileSync(p, path.join(dir, name)); sc.docs.push({ id: galId(), name: galStripAssetExt(name), origName: path.basename(p), rel: 'scenarios/' + String(sc.id).replace(/[^\w-]/g, '_') + '/' + name, mtime: st.mtimeMs || Date.now() }); n++; } catch (e) { logSoft('docsDrop', e); toast('❌ コピーできませんでした：' + f.name); }
  }
  if (n) { saveState(); toast('✅ ' + n + '件の資料を保存しました'); } renderGalleryAll();
}

function pickGalleryImage(opts) {
  const targetSid = opts && opts.scenarioId ? String(opts.scenarioId) : '';
  return new Promise(res => {
    const ov = document.createElement('div');
    const getScCtx = () => {
      if (!targetSid) return galCtx('scenario');
      const sc = (appState.scenarios || []).find(s => String(s.id) === targetSid);
      if (!sc) return null;
      sc.imageCategories = sanitizeCats(sc.imageCategories, DEFAULT_SCENARIO_CATS);
      if (!Array.isArray(sc.images)) sc.images = [];
      return { sc, cats: sc.imageCategories, items: sc.images };
    };
    const hasSc = !!getScCtx();
    let scope = hasSc ? 'scenario' : 'common', cat = GAL_ALL, pickObs = null, pickState = null;
    ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const stopObs = () => { if (pickObs) { try { pickObs.disconnect(); } catch (_) { } pickObs = null; } };
    const done = v => { stopObs(); document.removeEventListener('keydown', onK, true); ov.remove(); res(v); };
    const onK = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); } };
    document.addEventListener('keydown', onK, true);
    const cardPickHtml = a => {
      const src = a.dataUrl || ((a.path && window.WebBridge && WebBridge.isAssetRef && WebBridge.isAssetRef(a.path)) ? (WebBridge.peekAssetUrl(a.path) || '') : galFileUrl(a.path));
      return `<div class="gal-item" data-gid="${escapeHTML(a.uid)}"><img ${a.dataUrl ? imgAttr(a.dataUrl) : `src="${escapeHTML(src)}"`} alt="" loading="lazy" decoding="async"><div class="gal-name">${escapeHTML(a.name)}</div></div>`;
    };
    const appendPickMore = () => {
      if (!pickState || pickState.offset >= pickState.list.length) return;
      const moreWrap = ov.querySelector('[data-gal-pickmorewrap]');
      if (!moreWrap) return;
      const chunk = pickState.list.slice(pickState.offset, pickState.offset + GAL_PAGE_SIZE);
      moreWrap.insertAdjacentHTML('beforebegin', chunk.map(cardPickHtml).join(''));
      pickState.offset += chunk.length;
      const rem = pickState.list.length - pickState.offset;
      if (rem <= 0) { stopObs(); moreWrap.remove(); pickState = null; }
      else { const b = moreWrap.querySelector('[data-gal-pickmore]'); if (b) b.textContent = `さらに${GAL_PAGE_SIZE}件を表示（残り${rem}件）`; }
    };
    const draw = () => {
      stopObs();
      const ctx = scope === 'scenario' ? getScCtx() : galCtx('common'), all = ctx ? galUnifiedItems(scope, ctx).filter(it => it.type === 'image' && !it.missing) : [];
      const catsRaw = ctx ? [...new Set([...(ctx.cats || []), ...all.map(x => galItemCat(x))].map(galNormCat).filter(Boolean))] : [];
      const tree = galBuildFolderTree(catsRaw), cats = tree.flat;
      if (cat !== GAL_ALL && cat !== GAL_NONE && !tree.nodes.has(cat)) cat = GAL_ALL;
      const list = all.filter(a => cat === GAL_ALL ? true : cat === GAL_NONE ? !galItemCat(a) : galInFolder(galItemCat(a), cat, true));
      const initCnt = Math.min(GAL_PAGE_SIZE, list.length), rem = list.length - initCnt;
      const moreHtml = rem > 0 ? `<div class="gal-more-wrap" data-gal-pickmorewrap="1"><button type="button" class="btn-sort" data-gal-pickmore="1">さらに${GAL_PAGE_SIZE}件を表示（残り${rem}件）</button></div>` : '';
      pickState = rem > 0 ? { list, offset: initCnt } : null;
      ov.innerHTML = `<div class="app-dialog gal-picker"><div class="app-dialog-title">🖼️ ギャラリーから画像を選ぶ</div>
        <div class="gal-tabs"><button type="button" class="gal-tab${scope === 'common' ? ' on' : ''}" data-gs="common">共通ギャラリー（マイライブラリ含む）</button>${hasSc ? `<button type="button" class="gal-tab${scope === 'scenario' ? ' on' : ''}" data-gs="scenario">シナリオ登録素材</button>` : ''}</div>
        <div class="gal-cats"><div class="gal-cat${cat === GAL_ALL ? ' on' : ''}" data-gcat="${GAL_ALL}">すべて</div><div class="gal-cat${cat === GAL_NONE ? ' on' : ''}" data-gcat="${GAL_NONE}">（未分類）</div>${cats.map(c => `<div class="gal-cat${c === cat ? ' on' : ''}" data-gcat="${escapeHTML(c)}">${escapeHTML(galDepthOf(c) ? galFolderIndentLabel(c) : c)}</div>`).join('')}</div>
        <div class="gal-picker-body gal-drop"><div class="gal-grid">${list.slice(0, initCnt).map(cardPickHtml).join('') + moreHtml || '<div class="gal-empty">画像がありません</div>'}</div></div>
        <div class="app-dialog-actions"><button type="button" class="app-dialog-btn" data-gx="1">閉じる</button></div></div>`;
      const bodyEl = ov.querySelector('.gal-picker-body');
      const moreWrap = ov.querySelector('[data-gal-pickmorewrap]');
      if (bodyEl && moreWrap && typeof IntersectionObserver === 'function') {
        pickObs = new IntersectionObserver(entries => { if (entries.some(en => en.isIntersecting)) appendPickMore(); }, { root: bodyEl, rootMargin: '160px' });
        pickObs.observe(moreWrap);
      }
    };
    ov.addEventListener('click', async e => {
      if (e.target === ov || e.target.closest('[data-gx]')) return done(null);
      if (e.target.closest('[data-gal-pickmore]')) { appendPickMore(); return; }
      const s = e.target.closest('[data-gs]'); if (s) { scope = s.dataset.gs; cat = GAL_ALL; draw(); return; }
      const c = e.target.closest('[data-gcat]'); if (c) { cat = c.dataset.gcat; draw(); return; }
      const it = e.target.closest('.gal-item');
      if (it) {
        const ctx = scope === 'scenario' ? getScCtx() : galCtx('common'), all = ctx ? galUnifiedItems(scope, ctx) : [];
        const a = all.find(x => x.uid === it.dataset.gid);
        if (!a) return;
        if (a.dataUrl) return done(a.dataUrl);
        if (a.path && window.WebBridge && WebBridge.isAssetRef && WebBridge.isAssetRef(a.path) && WebBridge.readAssetBlob) {
          try {
            const blob = await WebBridge.readAssetBlob(a.path);
            if (blob) {
              const du = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result || '')); fr.onerror = () => r(''); fr.readAsDataURL(blob); });
              if (du) return done(du);
            }
          } catch (_) { }
        }
        if (a.path) { try { return done(await dataUrlFromPath(a.path, a.name)); } catch (_) { return done(galFileUrl(a.path)); } }
      }
    });
    document.body.appendChild(ov); draw();
  });
}

function galAskText(title, def) {
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="app-dialog"><div class="app-dialog-title">${escapeHTML(title)}</div><input type="text" value="${escapeHTML(def || '')}" style="width:100%;padding:6px 8px;margin-top:6px;"><div class="app-dialog-actions"><button type="button" class="app-dialog-btn" data-x="0">キャンセル</button><button type="button" class="app-dialog-btn primary" data-x="1">OK</button></div></div>`;
    document.body.appendChild(ov); const inp = ov.querySelector('input'); inp.focus(); inp.select();
    const done = v => { ov.remove(); res(v); };
    ov.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) done(b.dataset.x === '1' ? inp.value.trim() : null); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value.trim()); } else if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
  });
}

(function wireGallery() {
  function galSaveAssetOrder(scope, ctx, orderedUids) {
    const list = (orderedUids || []).filter(Boolean);
    if (scope === 'common') {
      if (window.CommonAssets && window.CommonAssets.setOrder) window.CommonAssets.setOrder(list);
      return;
    }
    if (ctx && ctx.sc) {
      galChkPt('素材の並べ替え');
      ctx.sc.assetOrder = list.slice();
      if (window.CCF && CCF.withProject) {
        CCF.withProject(String(ctx.sc.id), p => { p.assetOrder = list.slice(); });
      } else {
        ctx.save();
      }
    }
  }

  function galReorderItems(scope, dragUids, targetUid, insertAfter) {
    const ctx = galCtx(scope); if (!ctx) return;
    const uids = (Array.isArray(dragUids) ? dragUids : [dragUids]).filter(Boolean);
    if (!uids.length || !targetUid || uids.includes(targetUid)) return;
    const allItems = galUnifiedItems(scope, ctx);
    const baseItems = galFilter[scope].sort !== 'manual' ? galSortItems(scope, allItems) : allItems;
    const list = baseItems.map(x => x.uid);
    const mv = new Set(uids);
    const rest = list.filter(u => !mv.has(u)), moving = list.filter(u => mv.has(u));
    const idx = rest.indexOf(targetUid);
    if (idx < 0 || !moving.length) return;
    rest.splice(insertAfter ? idx + 1 : idx, 0, ...moving);
    galFilter[scope].sort = 'manual';
    galSaveAssetOrder(scope, ctx, rest);
    renderGalleryAll();
  }

  function galMoveRelative(scope, targetUids, dir) {
    const ctx = galCtx(scope); if (!ctx) return;
    const uids = (Array.isArray(targetUids) ? targetUids : [targetUids]).filter(Boolean);
    if (!uids.length) return;
    const allItems = galUnifiedItems(scope, ctx);
    const vis = galVisibleItems(scope, allItems).map(x => x.uid);
    if (vis.length < 2) return;
    const mv = new Set(uids), indices = [];
    vis.forEach((u, i) => { if (mv.has(u)) indices.push(i); });
    if (!indices.length) return;
    let anchorUid = '', insertAfter = false;
    if (dir === 'first') {
      anchorUid = vis.find(u => !mv.has(u)) || '';
      insertAfter = false;
    } else if (dir === 'last') {
      for (let i = vis.length - 1; i >= 0; i--) { if (!mv.has(vis[i])) { anchorUid = vis[i]; break; } }
      insertAfter = true;
    } else if (dir === 'prev') {
      if (indices[0] <= 0) return;
      anchorUid = vis[indices[0] - 1];
      insertAfter = false;
    } else if (dir === 'next') {
      const lastIdx = indices[indices.length - 1];
      if (lastIdx >= vis.length - 1) return;
      anchorUid = vis[lastIdx + 1];
      insertAfter = true;
    }
    if (!anchorUid) return;
    galReorderItems(scope, uids, anchorUid, insertAfter);
  }

  function galSaveCurrentSort(scope) {
    const ctx = galCtx(scope); if (!ctx) return;
    const allItems = galUnifiedItems(scope, ctx);
    const ordered = galSortItems(scope, allItems).map(x => x.uid);
    galFilter[scope].sort = 'manual';
    galSaveAssetOrder(scope, ctx, ordered);
    renderGalleryAll();
    toast('📌 現在の並び順をカスタム順として保存しました');
  }

  function galRemapFolders(scope, ctx, fn, label) {
    const mapC = c => { const o = galNormCat(c); return o ? galNormCat(fn(o)) : o; };
    const nextKept = new Set(), nextCol = new Set();
    galKept[scope].forEach(k => { const m = mapC(k); if (m) nextKept.add(m); });
    galKept[scope] = nextKept;
    (galCollapsed[scope] || new Set()).forEach(k => { const m = mapC(k); if (m) nextCol.add(m); });
    galCollapsed[scope] = nextCol;
    if (scope === 'common' && window.CommonAssets && typeof window.CommonAssets.remapFolders === 'function') {
      window.CommonAssets.remapFolders(fn, label);
      return;
    }
    if (scope === 'scenario' && ctx && ctx.sc && window.CCF && CCF.assets && typeof CCF.assets.remapFolders === 'function') {
      CCF.assets.remapFolders('scenario', String(ctx.sc.id), fn, label);
      return;
    }
    if (!ctx) return;
    galChkPt(label || 'フォルダの再編');
    const dedupe = a => [...new Set((a || []).map(mapC).filter(Boolean))];
    const fix = x => { if (!x || !x.category) return; const o = galNormCat(x.category), n = mapC(o); if (n !== o) x.category = n; };
    if (scope === 'common') {
      appState.commonCats = dedupe(appState.commonCats);
      (appState.imageAssets || []).forEach(fix);
    } else if (ctx.sc) {
      ctx.sc.imageCategories = dedupe(ctx.sc.imageCategories);
      (ctx.sc.images || []).forEach(fix);
      (ctx.sc.docs || []).forEach(fix);
      if (window.CCF && CCF.withProject) {
        CCF.withProject(String(ctx.sc.id), p => {
          p.folders = dedupe(p.folders);
          (p.refs || []).forEach(fix);
        });
      }
    }
    ctx.save();
  }
  const galRenamePathFn = (old, nn) => c => (c === old || c.startsWith(old + '/')) ? nn + c.slice(old.length) : c;
  const galDeletePathFn = old => { const par = galParentOf(old); return c => c === old ? par : (c.startsWith(old + '/') ? (par ? par + '/' : '') + c.slice(old.length + 1) : c); };

  function galFolderDialog(opts) {
    return new Promise(res => {
      const o = opts || {};
      const ov = document.createElement('div'); ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      ov.innerHTML = `<div class="app-dialog"><div class="app-dialog-title">${escapeHTML(o.title || 'フォルダ')}</div>
        ${o.name !== null && o.name !== undefined ? `<label class="ccf-am-dlg-lbl">フォルダ名</label><input type="text" class="ccf-am-input" data-fd="name" value="${escapeHTML(o.name || '')}" style="width:100%">` : ''}
        ${o.parents ? `<label class="ccf-am-dlg-lbl">親フォルダ</label><select data-fd="parent" style="width:100%"><option value="">（なし：トップ階層）</option>${galFolderOptionsHtml(o.parents, o.parent || '', o.exclude)}</select>` : ''}
        <div class="app-dialog-actions"><button type="button" class="app-dialog-btn" data-x="0">キャンセル</button><button type="button" class="app-dialog-btn primary" data-x="1">${escapeHTML(o.okText || 'OK')}</button></div></div>`;
      document.body.appendChild(ov);
      const nameEl = ov.querySelector('[data-fd="name"]'), parEl = ov.querySelector('[data-fd="parent"]');
      (nameEl || parEl).focus(); if (nameEl) nameEl.select();
      const done = v => { ov.remove(); res(v); };
      const ok = () => done({ name: nameEl ? nameEl.value.trim() : '', parent: parEl ? parEl.value : '' });
      ov.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) b.dataset.x === '1' ? ok() : done(null); });
      ov.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); ok(); } else if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    });
  }

  async function galCreateFolderFlow(scope, parentPath) {
    const ctx = galCtx(scope); if (!ctx) return;
    const allItems = galUnifiedItems(scope, ctx), cats = galAllCats(scope, ctx, allItems);
    const parents = galBuildFolderTree(cats).flat;
    const r = await galFolderDialog({ title: parentPath ? `「${parentPath}」に小フォルダを作成` : '新規フォルダ', name: '', parent: parentPath || '', parents, okText: '作成' });
    if (!r || !r.name) return;
    const path = galJoinPath(r.parent, r.name);
    if (!path) return;
    if (cats.includes(path)) return toast('同じ名前のフォルダが既にあります');
    galChkPt('フォルダを作成');
    if (scope === 'common') {
      appState.commonCats = [...new Set([...(appState.commonCats || []), path])];
    } else if (ctx.sc) {
      ctx.cats.push(path);
      if (window.CCF && CCF.withProject) CCF.withProject(String(ctx.sc.id), p => { p.folders = p.folders || []; if (!p.folders.includes(path)) p.folders.push(path); });
    }
    galKept[scope].add(path);
    if (r.parent) galCollapsed[scope].delete(r.parent);
    galSel[scope] = path;
    galAnchor[scope] = '';
    ctx.save();
    renderGalleryAll();
  }

  function galMoveFolderToParent(scope, old, newParent) {
    const ctx = galCtx(scope); if (!ctx) return false;
    if (!old || old === GAL_ALL || old === GAL_NONE) return false;
    const par = galNormCat(newParent);
    if (par === old || par.startsWith(old + '/')) return false;
    const nn = galJoinPath(par, galBaseOf(old));
    if (!nn || nn === old) return false;
    const cats = galAllCats(scope, ctx, galUnifiedItems(scope, ctx));
    if (cats.includes(nn)) { toast('移動先に同じ名前のフォルダが既にあります'); return false; }
    if (par) galCollapsed[scope].delete(par);
    galRemapFolders(scope, ctx, galRenamePathFn(old, nn), 'フォルダを別の親へ移動');
    galKept[scope].add(nn);
    if (galSel[scope] === old || galSel[scope].startsWith(old + '/')) galSel[scope] = nn + galSel[scope].slice(old.length);
    renderGalleryAll();
    return true;
  }

  async function galRenameFolderFlow(scope, old) {
    const ctx = galCtx(scope); if (!ctx) return;
    if (!old || old === GAL_ALL || old === GAL_NONE) return;
    const r = await galFolderDialog({ title: 'フォルダ名を変更', name: galBaseOf(old), okText: '変更' });
    if (!r || !r.name) return;
    const nn = galJoinPath(galParentOf(old), r.name);
    if (!nn || nn === old) return;
    const cats = galAllCats(scope, ctx, galUnifiedItems(scope, ctx));
    if (cats.includes(nn)) return toast('同じ名前のフォルダが既にあります');
    galRemapFolders(scope, ctx, galRenamePathFn(old, nn), 'フォルダ名を変更');
    galKept[scope].add(nn);
    if (galSel[scope] === old || galSel[scope].startsWith(old + '/')) galSel[scope] = nn + galSel[scope].slice(old.length);
    renderGalleryAll();
  }

  async function galMoveFolderParentFlow(scope, old) {
    const ctx = galCtx(scope); if (!ctx) return;
    if (!old || old === GAL_ALL || old === GAL_NONE) return;
    const cats = galAllCats(scope, ctx, galUnifiedItems(scope, ctx));
    const parents = galBuildFolderTree(cats).flat;
    const r = await galFolderDialog({ title: `「${old}」を別の親フォルダへ移動`, name: null, parent: galParentOf(old), parents, exclude: old, okText: '移動' });
    if (!r) return;
    galMoveFolderToParent(scope, old, r.parent);
  }

  async function galDeleteFolderFlow(scope, old) {
    const ctx = galCtx(scope); if (!ctx) return;
    if (!old || old === GAL_ALL || old === GAL_NONE) return;
    const allItems = galUnifiedItems(scope, ctx), cats = galAllCats(scope, ctx, allItems);
    const par = galParentOf(old);
    const cnt = allItems.filter(it => galItemCat(it) === old).length;
    const sub = cats.filter(f => f.startsWith(old + '/')).length;
    if (!(await appConfirm(`フォルダ「${old}」を削除しますか？` + (cnt ? `\n中の素材 ${cnt}件は「${par ? par : '（未分類）'}」へ移ります（ファイルは消えません）。` : '') + (sub ? `\n配下の小フォルダ ${sub}件は「${par ? par : 'トップ階層'}」の直下へ繰り上がります。` : ''), { okText: '削除', danger: true }))) return;
    galRemapFolders(scope, ctx, galDeletePathFn(old), 'フォルダを削除');
    if (galSel[scope] === old || galSel[scope].startsWith(old + '/')) galSel[scope] = par || GAL_ALL;
    renderGalleryAll();
  }

  function galReorderFolder(scope, dragCat, targetCat, insertAfter) {
    const ctx = galCtx(scope); if (!ctx) return;
    if (!dragCat || !targetCat || dragCat === targetCat) return;
    if (galParentOf(dragCat) !== galParentOf(targetCat)) return;
    const flat = galBuildFolderTree(galAllCats(scope, ctx, galUnifiedItems(scope, ctx))).flat;
    if (!flat.includes(dragCat) || !flat.includes(targetCat)) return;
    const block = p => flat.filter(x => x === p || x.startsWith(p + '/'));
    const dBlock = block(dragCat), dSet = new Set(dBlock);
    const rest = flat.filter(x => !dSet.has(x));
    const tBlock = block(targetCat);
    const idx = insertAfter ? rest.indexOf(tBlock[tBlock.length - 1]) + 1 : rest.indexOf(tBlock[0]);
    if (idx < 0 || (insertAfter && idx === 0)) return;
    rest.splice(idx, 0, ...dBlock);
    galChkPt('フォルダの並び替え');
    if (scope === 'common') {
      appState.commonCats = rest.slice();
    } else if (ctx.sc) {
      ctx.sc.imageCategories = rest.slice();
      if (window.CCF && CCF.withProject) CCF.withProject(String(ctx.sc.id), p => { p.folders = rest.slice(); });
    }
    ctx.save();
    renderGalleryAll();
  }

  function galMoveFolderStep(scope, folder, delta) {
    const ctx = galCtx(scope); if (!ctx) return;
    const tree = galBuildFolderTree(galAllCats(scope, ctx, galUnifiedItems(scope, ctx)));
    if (!tree.nodes.has(folder)) return;
    const par = galParentOf(folder);
    const sibs = (par && tree.nodes.get(par) ? tree.nodes.get(par).children : tree.roots).map(n => n.path);
    const i = sibs.indexOf(folder), j = i + delta;
    if (i < 0 || j < 0 || j >= sibs.length) return;
    galReorderFolder(scope, folder, sibs[j], delta > 0);
  }

  function galCloseCtx() { document.querySelectorAll('.gal-ctx').forEach(el => el.remove()); }
  function galOpenCtx(scope, folder, x, y) {
    galCloseCtx();
    const m = document.createElement('div');
    m.className = 'gal-ctx ccf-am-ctx';
    m.dataset.gscope = scope;
    m.dataset.folder = folder;
    m.innerHTML = `<button type="button" data-galctx="sub">📁＋ 小フォルダを作成</button><button type="button" data-galctx="ren">✎ 名前変更</button><button type="button" data-galctx="mov">⤴ 別の親フォルダへ移動</button><button type="button" data-galctx="del" class="danger">🗑 削除</button>`;
    m.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    m.style.top = Math.min(y, window.innerHeight - 170) + 'px';
    document.body.appendChild(m);
  }

  function galSyncSelectionDom(scope) {
    const hostEl = document.getElementById(scope === 'common' ? 'galleryTab' : 'scenarioGallery');
    if (hostEl) {
      hostEl.querySelectorAll('.gal-item[data-gid]').forEach(el => {
        const on = galChk.img.has(el.dataset.gid);
        el.classList.toggle('is-selected', on);
        const cb = el.querySelector('input[data-gal="chk-img"]');
        if (cb) cb.checked = on;
      });
    }
    galUpdateBulkBarOnly(scope);
  }

  // カード本体クリックの選択処理：通常=単一選択 / Ctrl・Cmd=個別トグル / Shift=アンカーからの範囲（Ctrl+Shift=範囲を追加）
  function galCardClick(scope, uid, e) {
    const ctx = galCtx(scope); if (!ctx) return;
    const allItems = galUnifiedItems(scope, ctx);
    const scopeIds = new Set(allItems.map(x => x.uid));
    const clearScopeSel = () => { scopeIds.forEach(u => galChk.img.delete(u)); };
    const ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey;
    if (shift && galAnchor[scope]) {
      const order = galVisibleItems(scope, allItems).map(r => r.uid);
      const a = order.indexOf(galAnchor[scope]), b = order.indexOf(uid);
      if (a >= 0 && b >= 0) {
        if (!ctrl) clearScopeSel();
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) galChk.img.add(order[i]);
        return galSyncSelectionDom(scope);
      }
    }
    if (ctrl) {
      if (galChk.img.has(uid)) galChk.img.delete(uid);
      else galChk.img.add(uid);
    } else {
      clearScopeSel();
      galChk.img.add(uid);
    }
    galAnchor[scope] = uid;
    galSyncSelectionDom(scope);
  }

  function galOpenDetailFor(scope, uid) {
    const ctx2 = galCtx(scope); if (!ctx2) return;
    const all2 = galUnifiedItems(scope, ctx2), vis2 = galVisibleItems(scope, all2);
    openGalleryDetailModal({ scope, uid, items: vis2, scenarioId: ctx2.sc ? String(ctx2.sc.id) : currentScenarioId });
  }

  async function commitRename(input) {
    if (!galEdit) return; const { scope, cat } = galEdit, ctx = galCtx(scope); galEdit = null; if (!ctx) return renderGalleryAll();
    const nn = galJoinPath(galParentOf(cat), input.value.trim());
    if (nn && nn !== cat && !galAllCats(scope, ctx, galUnifiedItems(scope, ctx)).includes(nn)) {
      galRemapFolders(scope, ctx, galRenamePathFn(cat, nn), 'フォルダ名を変更');
      galKept[scope].add(nn);
      if (galSel[scope] === cat || galSel[scope].startsWith(cat + '/')) galSel[scope] = nn + galSel[scope].slice(cat.length);
    } else if (nn && nn !== cat) toast('同じ名前のフォルダが既にあります');
    renderGalleryAll();
  }

  document.addEventListener('mousedown', e => {
    if (e.target && e.target.classList && e.target.classList.contains('gal-chk')) e.stopPropagation();
  }, true);

  document.addEventListener('compositionstart', e => {
    if (e.target && e.target.dataset && e.target.dataset.galQ) e.target._galComposing = true;
  });

  document.addEventListener('compositionend', e => {
    const q = e.target && e.target.dataset && e.target.dataset.galQ;
    if (!q) return;
    e.target._galComposing = false;
    galFilter[q].q = e.target.value;
    renderGalleryGridOnly(q);
  });

  document.addEventListener('input', e => {
    const q = e.target && e.target.dataset && e.target.dataset.galQ;
    if (!q) return;
    if (e.isComposing || e.target._galComposing) return;
    galFilter[q].q = e.target.value;
    renderGalleryGridOnly(q);
  });

  document.addEventListener('load', e => {
    const img = e.target;
    if (img && img.tagName === 'IMG' && img.dataset && img.dataset.thumbPath) {
      galScheduleLocalThumb(img);
    }
  }, true);

  document.addEventListener('change', e => {
    const t = e.target; if (!t) return;
    if (t.dataset.galSort) { galFilter[t.dataset.galSort].sort = t.value; renderGalleryAll(); return; }
    if (t.dataset.galFolder) {
      const scope = t.dataset.galFolder;
      const val = t.value;
      if (val) { galSel[scope] = val; galAnchor[scope] = ''; renderGalleryAll(); }
      return;
    }
    if (t.dataset.gal === 'incsub') {
      const scope = t.dataset.gscope || 'common';
      galIncSub[scope] = !!t.checked;
      try { localStorage.setItem(GAL_INCSUB_KEY, galIncSub[scope] ? '1' : '0'); } catch (_) { }
      renderGalleryAll();
      return;
    }
    if (t.dataset.gal === 'chk-img') {
      e.stopPropagation();
      if (t.checked) galChk.img.add(t.dataset.gid);
      else galChk.img.delete(t.dataset.gid);
      const itemEl = t.closest('.gal-item');
      if (itemEl) itemEl.classList.toggle('is-selected', !!t.checked);
      const scope = (itemEl && itemEl.dataset && itemEl.dataset.gscope) || (t.closest('#galleryTab') ? 'common' : 'scenario');
      galAnchor[scope] = t.dataset.gid || '';
      galUpdateBulkBarOnly(scope);
      return;
    }
    if (t.dataset.galDocchk) { e.stopPropagation(); if (t.checked) galChk.doc.add(t.dataset.galDocchk); else galChk.doc.delete(t.dataset.galDocchk); renderGalleryAll(); return; }
  });

  function closeOpenTagPopovers() {
    let changed = false;
    ['common', 'scenario'].forEach(sc => {
      if (galTagPickerOpen[sc]) {
        galTagPickerOpen[sc] = false;
        changed = true;
      }
      const pop = document.querySelector(`[data-gal-tagpop="${sc}"]`);
      if (pop) pop.hidden = true;
      const btn = document.querySelector(`[data-gal="toggle-tagbar"][data-gscope="${sc}"]`);
      if (btn) btn.classList.remove('on');
    });
    return changed;
  }

  document.addEventListener('click', async e => {
    const ctxBtn = e.target && e.target.closest && e.target.closest('[data-galctx]');
    if (ctxBtn) {
      e.stopPropagation();
      const menu = ctxBtn.closest('.gal-ctx');
      const scope = (menu && menu.dataset.gscope) || 'common';
      const fo = (menu && menu.dataset.folder) || '';
      galCloseCtx();
      const ck = ctxBtn.dataset.galctx;
      if (ck === 'sub') return galCreateFolderFlow(scope, fo);
      if (ck === 'ren') return galRenameFolderFlow(scope, fo);
      if (ck === 'mov') return galMoveFolderParentFlow(scope, fo);
      if (ck === 'del') return galDeleteFolderFlow(scope, fo);
      return;
    }
    galCloseCtx();
    if (e.target && e.target.classList && e.target.classList.contains('gal-chk')) { e.stopPropagation(); return; }
    if (galEdit && !e.target.closest('.gal-rename')) return commitRename(document.querySelector('.gal-rename'));
    if ((galTagPickerOpen.common || galTagPickerOpen.scenario) && !e.target.closest('[data-gal-tagwrap]') && !e.target.closest('[data-gal="toggletag"]') && !e.target.closest('[data-gal="cleartags"]')) {
      closeOpenTagPopovers();
    }

    const db = e.target.closest('[data-doc-bulk]');
    if (db) {
      const sc = appState.scenarios.find(s => s.id === currentScenarioId); if (!sc) return;
      const k = db.dataset.docBulk;
      if (k === 'sel-all') { const all = (sc.docs || []).length > 0 && (sc.docs || []).every(d => galChk.doc.has(d.id)); (sc.docs || []).forEach(d => all ? galChk.doc.delete(d.id) : galChk.doc.add(d.id)); renderGalleryAll(); return; }
      if (k === 'bulk-del') { const sel = (sc.docs || []).filter(d => galChk.doc.has(d.id)); if (!sel.length) return; if (!(await appConfirm('資料 ' + sel.length + '件を一覧から削除しますか？\n（コピー保存済みの資料ファイルも削除されます）', { okText: '削除', danger: true }))) return; galChkPt('シナリオ資料を削除'); sel.forEach(x => { const abs = x.rel ? docsAbs(x.rel) : ''; try { if (abs && fs.existsSync(abs)) fs.unlinkSync(abs); } catch (er) { logSoft('doc', er); } galChk.doc.delete(x.id); }); sc.docs = sc.docs.filter(d => !sel.includes(d)); saveState(); renderGalleryAll(); toast('✅ ' + sel.length + '件の資料を削除しました'); return; }
    }

    const d = e.target.closest('[data-doc]');
    if (d) {
      const sc = appState.scenarios.find(s => s.id === currentScenarioId), row = d.closest('[data-did]');
      const x = sc && (sc.docs || []).find(v => v.id === (row && row.dataset.did));
      const relAbs = x && x.rel ? docsAbs(x.rel) : '';
      const fp = docFilePath(x);
      if (!x) return; const k = d.dataset.doc;
      if (k === 'del') { if (!(await appConfirm('資料「' + x.name + '」を一覧から削除しますか？' + (relAbs ? '\nPCに複製保存したファイルも削除されます。' : ''), { okText: '削除', danger: true }))) return; galChkPt('シナリオ資料を削除'); try { if (relAbs && fs.existsSync(relAbs)) fs.unlinkSync(relAbs); } catch (er) { logSoft('doc', er); } sc.docs = sc.docs.filter(v => v !== x); saveState(); renderGalleryAll(); return; }
      if (!fp || (fs && fs.existsSync && !fs.existsSync(fp))) return toast('❌ ファイルが見つかりません');
      if (k === 'open') shell.openPath(fp); else if (k === 'reveal') shell.showItemInFolder(fp);
      return;
    }

    const g = e.target.closest('[data-gal]');
    if (g && g.dataset.gal !== 'chk-img' && g.dataset.gal !== 'incsub') {
      const k = g.dataset.gal, scope = g.dataset.gscope || (g.closest('[data-gscope]') && g.closest('[data-gscope]').dataset.gscope) || 'common';
      if (k === 'load-more') { galAppendMore(scope); return; }
      if (k === 'pick-root') { if (window.CCF && CCF.library) await CCF.library.pick(); return; }
      if (k === 'unwatch-root') { if (window.CCF && CCF.library && CCF.library.unwatchRoot) await CCF.library.unwatchRoot(); return; }
      if (k === 'sync-lib') { if (window.CommonAssets) await window.CommonAssets.sync(true); return; }
      if (k === 'open-am') { if (window.CCF && CCF.assets) CCF.assets.openModal(currentScenarioId, 'scenario'); return; }
      if (k === 'play') { e.stopPropagation(); if (window.CCF && CCF.library) CCF.library.playToggle(g.dataset.path); return; }
      if (k === 'edit-item') { e.stopPropagation(); galOpenDetailFor(scope, g.dataset.gid); return; }
      if (k === 'tree-tg') {
        e.stopPropagation();
        const fc = g.dataset.gcat;
        if (fc) {
          if (galCollapsed[scope].has(fc)) galCollapsed[scope].delete(fc);
          else galCollapsed[scope].add(fc);
          renderGalleryAll();
        }
        return;
      }
      if (k === 'tree-mv') {
        e.stopPropagation();
        galMoveFolderStep(scope, g.dataset.gcat, g.dataset.dir === 'up' ? -1 : 1);
        return;
      }
      if (k === 'add-sub') { e.stopPropagation(); await galCreateFolderFlow(scope, g.dataset.gcat || ''); return; }
      if (k === 'move-cat') { e.stopPropagation(); await galMoveFolderParentFlow(scope, g.dataset.gcat || ''); return; }
      if (k === 'merge-dup') {
        if (window.CCF && CCF.assets && typeof CCF.assets.mergeDuplicates === 'function') {
          const ctxM = galCtx(scope);
          await CCF.assets.mergeDuplicates(scope, scope === 'scenario' && ctxM && ctxM.sc ? String(ctxM.sc.id) : '');
          renderGalleryAll();
        }
        return;
      }
      if (k === 'set-view') {
        const vm = g.dataset.gview === 'list' ? 'list' : 'folder';
        galViewMode[scope] = vm;
        if (scope === 'common') { try { localStorage.setItem(GAL_VIEW_KEY, vm); } catch (_) { } }
        if (vm === 'folder') { galSel[scope] = GAL_ALL; galAnchor[scope] = ''; }
        renderGalleryAll(); return;
      }
      if (k === 'open-folder') {
        if (e.target.closest('input, button, [data-gal="tree-tg"]') && !g.matches('button')) return;
        galSel[scope] = g.dataset.gcat || GAL_ALL;
        galAnchor[scope] = '';
        renderGalleryAll(); return;
      }
      if (k === 'back-folders') { galSel[scope] = GAL_ALL; galAnchor[scope] = ''; renderGalleryAll(); return; }
      if (k === 'set-type') { galFilter[scope].type = g.dataset.gtype || ''; renderGalleryAll(); return; }
      if (k === 'toggle-tagbar') {
        const nextOpen = !galTagPickerOpen[scope];
        galTagPickerOpen[scope] = nextOpen;
        const pop = document.querySelector(`[data-gal-tagpop="${scope}"]`);
        if (pop) pop.hidden = !nextOpen;
        g.classList.toggle('on', nextOpen);
        return;
      }
      if (k === 'toggletag' || k === 'picktag') { e.stopPropagation(); galToggleTag(scope, g.dataset.tagv || ''); renderGalleryAll(); return; }
      if (k === 'cleartags') { galFilter[scope].tags = []; renderGalleryAll(); return; }
      if (k === 'clear-filt') { galFilter[scope] = { q: '', tags: [], sort: galFilter[scope].sort, type: '' }; renderGalleryAll(); return; }
      if (k === 'save-order') { galSaveCurrentSort(scope); return; }
      if (k === 'mv-first' || k === 'mv-prev' || k === 'mv-next' || k === 'mv-last') {
        e.stopPropagation();
        const gid = g.dataset.gid;
        const ctxMv = galCtx(scope);
        const uids = gid ? [gid] : (ctxMv ? galUnifiedItems(scope, ctxMv).filter(a => galChk.img.has(a.uid)).map(a => a.uid) : []);
        galMoveRelative(scope, uids, k.slice(3));
        return;
      }
      if (k === 'sel-clear') {
        galChk.img.clear();
        galAnchor.common = ''; galAnchor.scenario = '';
        ['galleryTab', 'scenarioGallery'].forEach(hid => {
          const hel = document.getElementById(hid);
          if (!hel) return;
          hel.querySelectorAll('.gal-item.is-selected').forEach(el => el.classList.remove('is-selected'));
          hel.querySelectorAll('input[data-gal="chk-img"]:checked').forEach(cb => { cb.checked = false; });
        });
        galUpdateBulkBarOnly('common');
        galUpdateBulkBarOnly('scenario');
        return;
      }

      const ctx = galCtx(scope); if (!ctx) return;
      const allItems = galUnifiedItems(scope, ctx), visItems = galVisibleItems(scope, allItems);

      if (k === 'add-folder') {
        const par = (galSel[scope] && galSel[scope] !== GAL_ALL && galSel[scope] !== GAL_NONE) ? galSel[scope] : '';
        await galCreateFolderFlow(scope, par);
        return;
      }
      if (k === 'rename') {
        e.stopPropagation();
        await galRenameFolderFlow(scope, g.dataset.gcat);
        return;
      }
      if (k === 'del-cat') {
        e.stopPropagation();
        await galDeleteFolderFlow(scope, g.dataset.gcat);
        return;
      }
      if (k === 'sel-all') {
        const all = visItems.length > 0 && visItems.every(a => galChk.img.has(a.uid));
        visItems.forEach(a => all ? galChk.img.delete(a.uid) : galChk.img.add(a.uid));
        const hostEl = document.getElementById(scope === 'common' ? 'galleryTab' : 'scenarioGallery');
        if (hostEl) {
          hostEl.querySelectorAll('.gal-item[data-gid]').forEach(el => {
            const on = galChk.img.has(el.dataset.gid);
            el.classList.toggle('is-selected', on);
            const cb = el.querySelector('input[data-gal="chk-img"]');
            if (cb) cb.checked = on;
          });
        }
        galUpdateBulkBarOnly(scope); return;
      }
      if (k === 'bulk-move') {
        const destSel = document.querySelector(`[data-gal-dest="${scope}"]`), dest = destSel ? destSel.value : '';
        const uids = allItems.filter(a => galChk.img.has(a.uid)).map(a => a.uid);
        if (!uids.length) return;
        allItems.filter(a => galChk.img.has(a.uid)).forEach(a => { if (a.category) galKept[scope].add(a.category); });
        if (dest) galKept[scope].add(galNormCat(dest));
        galChk.img.clear();
        if (scope === 'common' && window.CommonAssets) window.CommonAssets.moveItems(uids, dest);
        else if (ctx.sc && window.CCF && CCF.assets) CCF.assets.moveIds(String(ctx.sc.id), uids, dest);
        toast(`📁 ${uids.length}件を「${galCatLabel(galNormCat(dest))}」へ移動しました`);
        renderGalleryAll(); return;
      }
      if (k === 'bulk-img') {
        const sel = allItems.filter(a => galChk.img.has(a.uid)); if (!sel.length) return;
        if (!(await appConfirm(`選択中の素材 ${sel.length}件を削除・除外しますか？（PC上の元ファイルは消えません）`, { okText: '削除', danger: true }))) return;
        const uids = sel.map(a => a.uid); uids.forEach(u => galChk.img.delete(u));
        if (scope === 'common' && window.CommonAssets) window.CommonAssets.removeItems(uids);
        else {
          galChkPt('登録素材を削除');
          const idSet = new Set(uids);
          ctx.items.splice(0, ctx.items.length, ...ctx.items.filter(a => !idSet.has('img:' + a.id)));
          if (ctx.sc) {
            ctx.sc.docs = (ctx.sc.docs || []).filter(d => !idSet.has('doc:' + d.id));
            if (Array.isArray(ctx.sc.assetOrder)) ctx.sc.assetOrder = ctx.sc.assetOrder.filter(u => !idSet.has(u));
            if (window.CCF) CCF.withProject(String(ctx.sc.id), p => { p.refs = (p.refs || []).filter(r => !idSet.has('ref:' + r.id)); p.assetOrder = (p.assetOrder || []).filter(u => !idSet.has(u)); });
          }
          ctx.save();
        }
        renderGalleryAll(); if (typeof cleanupUnusedImages === 'function') cleanupUnusedImages();
        toast(`✅ ${sel.length}件を削除しました`); return;
      }
      if (k === 'copy-to-sc') {
        const uids = allItems.filter(a => galChk.img.has(a.uid)).map(a => a.uid);
        if (!uids.length) return toast('コピーする素材にチェックを入れてください');
        await copyCommonToScenario(uids); return;
      }
      if (k === 'send-to-lib') {
        const uids = allItems.filter(a => galChk.img.has(a.uid)).map(a => a.uid);
        if (!uids.length) return toast('マイライブラリへ送る素材を選択してください');
        if (ctx.sc && window.CCF && CCF.assets && typeof CCF.assets.sendToLibrary === 'function') {
          const r = await CCF.assets.sendToLibrary(String(ctx.sc.id), uids);
          if (r && r.done) {
            if (r.moved) uids.forEach(u => galChk.img.delete(u));
            renderGalleryAll();
          }
        }
        return;
      }
      if (k === 'rename-item') {
        e.stopPropagation();
        const it = allItems.find(x => x.uid === g.dataset.gid); if (!it) return;
        const nn = await galAskText('表示名を変更（PC上のファイル名は変更しません）', it.name);
        if (!nn || nn === it.name) return;
        if (scope === 'common' && window.CommonAssets) window.CommonAssets.renameItem(it.uid, nn);
        else if (ctx.sc) {
          galChkPt('素材名を変更');
          if (it.srcType === 'img' && it.raw) { if (!it.raw.origName) it.raw.origName = it.raw.name; it.raw.name = nn; }
          else if (it.srcType === 'ref' && window.CCF) CCF.withProject(String(ctx.sc.id), p => { const r = (p.refs || []).find(x => x.id === it.rawId); if (r) { if (!r.origName) r.origName = r.name; r.name = nn; } });
          ctx.save();
        }
        renderGalleryAll(); return;
      }
      if (k === 'tag-item') {
        e.stopPropagation();
        const it = allItems.find(x => x.uid === g.dataset.gid); if (!it) return;
        const ans = await galAskText('カスタムタグ（カンマ / スペース区切り）', (it.customTags || []).join(', '));
        if (ans === null) return;
        const next = galM() ? galM().cleanTagList(ans.split(/[\s,、，;]+/)) : ans.split(/[\s,]+/).filter(Boolean);
        if (scope === 'common' && window.CommonAssets) window.CommonAssets.setTags(it.uid, next);
        else if (ctx.sc) {
          galChkPt('素材タグを変更');
          if (it.srcType === 'img' && it.raw) it.raw.tags = next;
          else if (it.srcType === 'ref' && window.CCF) CCF.withProject(String(ctx.sc.id), p => { const r = (p.refs || []).find(x => x.id === it.rawId); if (r) r.tags = next; });
          ctx.save();
        }
        renderGalleryAll(); return;
      }
      if (k === 'del-img') {
        e.stopPropagation();
        const uid = g.dataset.gid; galChk.img.delete(uid);
        if (scope === 'common' && window.CommonAssets) window.CommonAssets.removeItems([uid]);
        else {
          galChkPt('登録素材を削除');
          ctx.items.splice(0, ctx.items.length, ...ctx.items.filter(a => ('img:' + a.id) !== uid));
          if (ctx.sc) {
            ctx.sc.docs = (ctx.sc.docs || []).filter(d => ('doc:' + d.id) !== uid);
            if (Array.isArray(ctx.sc.assetOrder)) ctx.sc.assetOrder = ctx.sc.assetOrder.filter(u => u !== uid);
            if (window.CCF) CCF.withProject(String(ctx.sc.id), p => { p.refs = (p.refs || []).filter(r => ('ref:' + r.id) !== uid); p.assetOrder = (p.assetOrder || []).filter(u => u !== uid); });
          }
          ctx.save();
        }
        renderGalleryAll(); if (typeof cleanupUnusedImages === 'function') cleanupUnusedImages(); return;
      }
    }

    const galCard = e.target.closest('.gal-item[data-gid][data-gscope]');
    if (galCard && !e.target.closest('.gal-chk, button, input, [data-gal="picktag"]')) {
      // シングルクリック=選択（詳細モーダルは開かない）。ダブルクリック／✏️ボタンで詳細・編集を開く
      galCardClick(galCard.dataset.gscope, galCard.dataset.gid, e);
      return;
    }

    const c = e.target.closest('.gal-cat[data-gcat]');
    if (c && !e.target.closest('input') && !e.target.closest('button')) {
      const scope = c.dataset.gscope; galSel[scope] = c.dataset.gcat; galAnchor[scope] = ''; renderGalleryAll();
    }
  });

  document.addEventListener('dblclick', e => {
    const galCard = e.target && e.target.closest && e.target.closest('.gal-item[data-gid][data-gscope]');
    if (!galCard) return;
    if (e.target.closest('.gal-chk, .gal-mvbtn, button, input, select, [data-gal="picktag"]')) return;
    e.preventDefault();
    galOpenDetailFor(galCard.dataset.gscope, galCard.dataset.gid);
  });

  document.addEventListener('contextmenu', e => {
    const fr = e.target && e.target.closest && e.target.closest('.gal-tree-row[data-gcat], .gal-folder-card[data-gcat]');
    if (!fr) return;
    const cat = fr.dataset.gcat;
    if (!cat || cat === GAL_ALL || cat === GAL_NONE) return;
    e.preventDefault();
    galOpenCtx(fr.dataset.gscope || 'common', cat, e.clientX, e.clientY);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') galCloseCtx();
    if (e.key === 'Escape' && (galTagPickerOpen.common || galTagPickerOpen.scenario) && !document.querySelector('.gal-detail-ov, .app-dialog-overlay')) {
      closeOpenTagPopovers();
    }
    const i = e.target.closest && e.target.closest('.gal-rename'); if (!i) return;
    if (e.key === 'Enter') { e.preventDefault(); commitRename(i); } else if (e.key === 'Escape') { e.stopImmediatePropagation(); galEdit = null; renderGalleryAll(); }
  }, true);

  async function copyCommonToScenario(idsOrUids, cat, targetScenarioId) {
    const sid = targetScenarioId || currentScenarioId;
    const sc = appState.scenarios.find(s => String(s.id) === String(sid));
    if (!sc) return toast('先にシナリオをDBに保存してください');
    sc.imageCategories = sanitizeCats(sc.imageCategories, DEFAULT_SCENARIO_CATS);
    sc.images = sc.images || [];
    const all = galUnifiedItems('common', galCtx('common'));
    const arr = Array.isArray(idsOrUids) ? idsOrUids : [idsOrUids];
    galChkPt('共通素材をシナリオへコピー');
    const paths = [];
    let n = 0;
    for (const id of arr) {
      const a = all.find(x => x.uid === id || x.rawId === id); if (!a) continue;
      const dest = cat !== undefined ? galNormCat(cat) : galNormCat(a.category);
      if (a.srcType === 'cimg' && a.dataUrl) {
        sc.images.push({ id: galId(), name: a.name, origName: a.origName || a.name, dataUrl: a.dataUrl, category: dest, tags: a.customTags || [], mtime: a.mtime || 0, addedAt: Date.now() });
        n++;
      } else if (a.path) {
        paths.push({ path: a.path, cat: dest });
      }
    }
    if (paths.length && window.CCF && CCF.assets) {
      paths.forEach(p => { n += CCF.assets.addPaths(String(sc.id), [p.path], p.cat); });
    }
    if (n) {
      saveState(); arr.forEach(id => galChk.img.delete(id));
      renderGalleryAll(); try { if (window.CCF && CCF.library) CCF.library.render(); if (CCF.assets && CCF.assets.refreshModal) CCF.assets.refreshModal(); } catch (_) { }
      toast(`✅ ${n}件をシナリオ「${sc.title || '無題'}」へ登録しました`);
    }
  }
  window.copyCommonToScenario = copyCommonToScenario;

  document.addEventListener('dragstart', e => {
    const fc = e.target.closest && e.target.closest('.gal-folder-card[data-gcat][draggable="true"], .gal-tree-row[data-gcat][draggable="true"]');
    if (fc && !e.target.closest('button, input, [data-gal="tree-tg"]')) {
      galDragFolder = { scope: fc.dataset.gscope || 'common', cat: fc.dataset.gcat };
      e.dataTransfer.setData('text/gal-folder', JSON.stringify(galDragFolder));
      e.dataTransfer.effectAllowed = 'move';
      return;
    }
    galDragFolder = null;
    const it = e.target.closest && e.target.closest('.gal-item'); if (!it) return;
    const scope = it.dataset.gscope, gid = it.dataset.gid;
    let uids = [gid];
    if (galChk.img.has(gid)) {
      const ctx = galCtx(scope);
      const allIds = ctx ? new Set(galUnifiedItems(scope, ctx).map(x => x.uid)) : null;
      const sel = allIds ? [...galChk.img].filter(u => allIds.has(u)) : [...galChk.img];
      if (sel.length) uids = sel;
    }
    e.dataTransfer.setData('text/gal-id', JSON.stringify({ scope, uid: gid, uids }));
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  document.addEventListener('dragend', () => { galDragFolder = null; galClearDropMarks(); });
  const galDropTarget = el => {
    if (!el || !el.closest) return null;
    return el.closest('[data-docdrop]')
      || el.closest('.gal-tree-row[data-gcat], .gal-subchip[data-gcat], .gal-cat[data-gcat], .gal-folder-card[data-gcat]')
      || el.closest('.gal-item[data-gid]')
      || el.closest('[data-gdrop]')
      || el.closest('#galleryTab');
  };
  const galClearDropMarks = () => {
    document.querySelectorAll('.gal-drop.dragover,.doc-drop.dragover,.gal-item.drop-before,.gal-item.drop-after,.gal-folder-card.dragover,.gal-folder-card.drop-before,.gal-folder-card.drop-after,.gal-tree-row.drop,.gal-tree-row.drop-f-before,.gal-tree-row.drop-f-after,.gal-subchip.dragover')
      .forEach(x => x.classList.remove('dragover', 'drop', 'drop-before', 'drop-after', 'drop-f-before', 'drop-f-after'));
  };
  document.addEventListener('dragover', e => {
    const z = galDropTarget(e.target);
    if (!z) return;
    const types = [...(e.dataTransfer && e.dataTransfer.types || [])];
    if (!types.includes('Files') && !types.includes('text/gal-id') && !types.includes('text/gal-folder')) return;
    const hl = (z.id === 'galleryTab') ? (z.querySelector('[data-gdrop="common"]') || z) : z;
    if (types.includes('text/gal-folder')) {
      if (hl.classList.contains('gal-tree-row')) {
        const tf = hl.dataset.gcat, df = galDragFolder;
        if (!df || df.scope !== hl.dataset.gscope || tf === GAL_NONE) return;
        if (tf === GAL_ALL) {
          if (!galParentOf(df.cat)) return;
          e.preventDefault(); e.stopPropagation(); galClearDropMarks();
          hl.classList.add('drop');
          return;
        }
        if (tf === df.cat || tf.startsWith(df.cat + '/')) return;
        e.preventDefault(); e.stopPropagation(); galClearDropMarks();
        const rect = hl.getBoundingClientRect();
        const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
        if (galParentOf(df.cat) === galParentOf(tf) && (relY < 0.25 || relY > 0.75)) {
          hl.classList.add(relY > 0.75 ? 'drop-f-after' : 'drop-f-before');
        } else {
          hl.classList.add('drop');
        }
        return;
      }
      if (hl.classList.contains('gal-folder-card') && hl.dataset.gcat !== GAL_NONE && hl.dataset.gcat !== GAL_ALL) {
        const tf = hl.dataset.gcat, df = galDragFolder;
        if (df && (df.scope !== hl.dataset.gscope || tf === df.cat || tf.startsWith(df.cat + '/'))) return;
        e.preventDefault(); e.stopPropagation(); galClearDropMarks();
        const rect = hl.getBoundingClientRect();
        const relX = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
        if (!df || (galParentOf(df.cat) === galParentOf(tf) && (relX < 0.25 || relX > 0.75))) {
          hl.classList.add(relX > 0.75 ? 'drop-after' : 'drop-before');
        } else {
          hl.classList.add('dragover');
        }
        return;
      }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    galClearDropMarks();
    if (hl.classList.contains('gal-item') && types.includes('text/gal-id')) {
      const rect = hl.getBoundingClientRect();
      const isAfter = (e.clientX - rect.left) > (rect.width / 2);
      hl.classList.add(isAfter ? 'drop-after' : 'drop-before');
    } else if (hl.classList.contains('gal-tree-row')) {
      hl.classList.add('drop');
    } else {
      hl.classList.add('dragover');
    }
  });
  document.addEventListener('dragleave', e => {
    const z = e.target.closest && e.target.closest('.dragover,.drop,.drop-before,.drop-after,.drop-f-before,.drop-f-after');
    if (z && !z.contains(e.relatedTarget)) z.classList.remove('dragover', 'drop', 'drop-before', 'drop-after', 'drop-f-before', 'drop-f-after');
  });
  document.addEventListener('drop', async e => {
    const z = galDropTarget(e.target);
    if (!z) return;
    galClearDropMarks();
    const rawFolder = e.dataTransfer && e.dataTransfer.getData('text/gal-folder');
    const dragF = galDragFolder;
    galDragFolder = null;
    if (rawFolder || dragF) {
      let fp = dragF;
      if (rawFolder) { try { fp = JSON.parse(rawFolder); } catch (_) { } }
      if (fp && fp.cat) {
        e.preventDefault(); e.stopPropagation();
        if (z.classList.contains('gal-tree-row') && fp.scope === z.dataset.gscope) {
          const tf = z.dataset.gcat;
          if (tf === GAL_NONE) return;
          if (tf === GAL_ALL) {
            if (galParentOf(fp.cat)) galMoveFolderToParent(fp.scope, fp.cat, '');
            return;
          }
          if (tf === fp.cat || tf.startsWith(fp.cat + '/')) return;
          const rect = z.getBoundingClientRect();
          const relY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
          if (galParentOf(fp.cat) === galParentOf(tf) && (relY < 0.25 || relY > 0.75)) {
            galReorderFolder(fp.scope, fp.cat, tf, relY > 0.75);
          } else {
            galMoveFolderToParent(fp.scope, fp.cat, tf);
          }
          return;
        }
        if (z.classList.contains('gal-folder-card') && fp.scope === z.dataset.gscope && z.dataset.gcat && z.dataset.gcat !== GAL_NONE && z.dataset.gcat !== GAL_ALL) {
          const tf = z.dataset.gcat;
          if (tf === fp.cat || tf.startsWith(fp.cat + '/')) return;
          const rect = z.getBoundingClientRect();
          const relX = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
          if (galParentOf(fp.cat) === galParentOf(tf) && (relX < 0.25 || relX > 0.75)) {
            galReorderFolder(fp.scope, fp.cat, tf, relX > 0.75);
          } else {
            galMoveFolderToParent(fp.scope, fp.cat, tf);
          }
        }
        return;
      }
    }
    const raw = e.dataTransfer && e.dataTransfer.getData('text/gal-id');
    if (raw) {
      e.preventDefault(); e.stopPropagation();
      let payload; try { payload = JSON.parse(raw); } catch (_) { return; }
      const moveUids = (Array.isArray(payload.uids) && payload.uids.length) ? payload.uids : [payload.uid];
      if (z.classList.contains('gal-item') && payload.scope === z.dataset.gscope) {
        const rect = z.getBoundingClientRect();
        const isAfter = (e.clientX - rect.left) > (rect.width / 2);
        galReorderItems(payload.scope, moveUids, z.dataset.gid, isAfter);
        return;
      }
      if (z.dataset.gcat !== undefined) {
        const targetCat = (z.dataset.gcat === GAL_ALL || z.dataset.gcat === GAL_NONE) ? '' : z.dataset.gcat;
        if (payload.scope === 'common' && z.dataset.gscope === 'scenario') { await copyCommonToScenario(moveUids, targetCat); return; }
        if (payload.scope === z.dataset.gscope && z.dataset.gcat !== GAL_ALL) {
          galChk.img.clear();
          if (payload.scope === 'common' && window.CommonAssets) window.CommonAssets.moveItems(moveUids, targetCat);
          else if (payload.scope === 'scenario' && window.CCF && CCF.assets) {
            const ctxSc = galCtx('scenario');
            if (ctxSc && ctxSc.sc) CCF.assets.moveIds(String(ctxSc.sc.id), moveUids, targetCat);
            else CCF.assets.moveIds(moveUids, targetCat);
          }
          renderGalleryAll();
        }
        return;
      }
      if ((z.dataset.gdrop === 'scenario') && payload.scope === 'common') { await copyCommonToScenario(moveUids); return; }
      return;
    }
    // 最初の await より前に同期で files / webkitGetAsEntry を取得
    const syncData = galExtractDroppedSync(e.dataTransfer);
    if (!syncData.files.length && !syncData.entries.length) return;
    e.preventDefault(); e.stopPropagation();
    if (z.dataset.docdrop) {
      await docsDrop(syncData.files);
    } else if (z.dataset.gcat !== undefined) {
      await galleryDrop(z.dataset.gscope || 'common', syncData, z.dataset.gcat);
    } else if (z.dataset.gdrop) {
      await galleryDrop(z.dataset.gdrop, syncData);
    } else if (z.classList.contains('gal-item')) {
      const wrap = z.closest('[data-gdrop]');
      await galleryDrop(z.dataset.gscope || (wrap && wrap.dataset.gdrop) || 'common', syncData);
    } else if (z.id === 'galleryTab' || (z.closest && z.closest('#galleryTab'))) {
      await galleryDrop('common', syncData);
    }
  });
})();

const GAL_TRPG_PRESET_TAGS = [
  { label: '場所', tags: ['屋内', '屋外', '街', '森', '海', '山', '洋館', '学校', '病院', '地下', '廃墟', '神社'] },
  { label: '時間', tags: ['朝', '昼', '夕方', '夜', '深夜'] },
  { label: '雰囲気', tags: ['日常', '探索', '不穏', '恐怖', '神秘', '戦闘', 'クライマックス', '和風'] }
];

function openGalleryDetailModal(opts) {
  const o = opts || {};
  const scope = o.scope === 'scenario' ? 'scenario' : 'common';
  const scenarioId = o.scenarioId ? String(o.scenarioId) : (typeof currentScenarioId !== 'undefined' && currentScenarioId ? String(currentScenarioId) : (window.CCF && CCF.S && CCF.S.key ? String(CCF.S.key) : ''));
  const prevOv = document.querySelector('.gal-detail-ov');
  if (prevOv) { try { prevOv._closeDetail && prevOv._closeDetail(); } catch (_) { prevOv.remove(); } }

  const M = galM();
  const cleanTagArr = arr => M ? M.cleanTagList(arr) : [...new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))];
  const normPath = p => (window.CCF && CCF.assets && CCF.assets.norm) ? CCF.assets.norm(p) : String(p || '').replace(/\//g, '\\').toLowerCase();
  const resolveUrl = it => {
    if (!it || it.missing) return '';
    if (it.dataUrl) return it.dataUrl;
    const p = it.path || '';
    if (!p) return '';
    if (window.WebBridge && WebBridge.isAssetRef(p)) return WebBridge.peekAssetUrl(p) || '';
    if (/^(?:data:|blob:|https?:|file:)/i.test(p)) return p;
    return galFileUrl(p);
  };
  const liveAllItems = () => {
    if (scope === 'common') return galUnifiedItems('common', galCtx('common'));
    if (window.CCF && CCF.assets && scenarioId) return CCF.assets.getUnifiedItems(scenarioId);
    const ctx = galCtx('scenario');
    return ctx ? galUnifiedItems('scenario', ctx) : [];
  };
  let list = Array.isArray(o.items) && o.items.length ? o.items.slice() : liveAllItems();
  let curUid = o.uid || (list[0] && list[0].uid) || '';
  if (!curUid) return;
  if (!list.some(x => x.uid === curUid)) {
    const found = liveAllItems().find(x => x.uid === curUid);
    if (found) list.unshift(found);
  }

  let curIdx = Math.max(0, list.findIndex(x => x.uid === curUid));
  let zoom = 1, panX = 0, panY = 0, dragging = false, moved = false, startX = 0, startY = 0, basePanX = 0, basePanY = 0;
  let scFilter = '';
  let selTargetScId = (typeof currentScenarioId !== 'undefined' && currentScenarioId) ? String(currentScenarioId)
    : (window.CCF && CCF.S && CCF.S.key && CCF.S.key !== '_default') ? String(CCF.S.key)
    : (scenarioId && scenarioId !== '_default') ? scenarioId
    : ((typeof appState !== 'undefined' && Array.isArray(appState.scenarios) && appState.scenarios[0]) ? String(appState.scenarios[0].id) : '');
  let selTargetCat = '__auto__';

  const ov = document.createElement('div');
  ov.className = 'gal-detail-ov';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', '素材拡大プレビュー＆詳細編集');
  ov.innerHTML = '<div class="gal-detail-modal" tabindex="-1"></div>';
  document.body.appendChild(ov);
  const modal = ov.querySelector('.gal-detail-modal');

  const curItem = () => {
    const uid = (list[curIdx] && list[curIdx].uid) || curUid;
    const fresh = liveAllItems().find(x => x.uid === uid);
    if (fresh) { list[curIdx] = fresh; return fresh; }
    return list[curIdx] || null;
  };
  const stopAudio = () => {
    ov.querySelectorAll('audio, video').forEach(m => { try { m.pause(); } catch (_) { } });
  };
  const notifyAfterEdit = () => {
    try { if (scope === 'scenario' && scenarioId && window.CCF && CCF.assets && CCF.assets.invalidateUnified) CCF.assets.invalidateUnified(scenarioId, false); } catch (_) { }
    try { if (typeof saveState === 'function') saveState(); } catch (_) { }
    try { renderGalleryAll(); } catch (_) { }
    try { if (window.CCF && CCF.library) CCF.library.render(); } catch (_) { }
    try { if (window.CCF && CCF.assets && CCF.assets.refreshModal) CCF.assets.refreshModal(); } catch (_) { }
    if (typeof o.onUpdate === 'function') { try { o.onUpdate(); } catch (_) { } }
  };
  const folderOptionsList = () => {
    const set = new Set();
    if (scope === 'common') {
      const ctx = galCtx('common');
      if (ctx) galAllCats('common', ctx, liveAllItems()).forEach(c => { if (c) set.add(c); });
    } else if (scenarioId) {
      const sc = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios.find(s => String(s.id) === scenarioId) : null;
      if (sc && Array.isArray(sc.imageCategories)) sc.imageCategories.forEach(c => { const nc = galNormCat(c); if (nc) set.add(nc); });
      if (window.CCF && CCF.assets && CCF.assets.foldersOf) {
        CCF.assets.foldersOf(CCF.readProject(scenarioId), scenarioId).forEach(c => { const nc = galNormCat(c); if (nc) set.add(nc); });
      }
      galKept.scenario.forEach(c => { const nc = galNormCat(c); if (nc) set.add(nc); });
    }
    const it = curItem();
    if (it && it.category) set.add(galNormCat(it.category));
    return galBuildFolderTree([...set].filter(Boolean)).flat;
  };
  const applyRename = nn => {
    const it = curItem(); if (!it) return;
    const val = String(nn || '').trim();
    if (!val) return toast('表示名を入力してください');
    if (val === it.name) return;
    if (scope === 'common' && window.CommonAssets) {
      window.CommonAssets.renameItem(it.uid, val);
    } else if (scope === 'scenario' && scenarioId) {
      const sc = appState.scenarios.find(s => String(s.id) === scenarioId);
      galChkPt('素材名を変更');
      if (it.srcType === 'img' || it.srcType === 'doc') {
        if (it.raw) { if (!it.raw.origName) it.raw.origName = it.raw.name; it.raw.name = val; }
      } else if (it.srcType === 'ref' && window.CCF) {
        CCF.withProject(scenarioId, p => {
          const r = (p.refs || []).find(x => x.id === it.rawId);
          if (r) { if (!r.origName) r.origName = r.name; r.name = val; }
        });
      } else if (sc && it.raw) {
        if (!it.raw.origName) it.raw.origName = it.raw.name;
        it.raw.name = val;
      }
      notifyAfterEdit();
    }
    toast(`✅ 名前を「${val}」に変更しました`);
    drawModal();
  };
  const applyMove = destRaw => {
    const it = curItem(); if (!it) return;
    const dest = galNormCat(destRaw);
    if (dest) galKept[scope].add(dest);
    if (scope === 'common' && window.CommonAssets) {
      window.CommonAssets.moveItems([it.uid], dest);
    } else if (scope === 'scenario' && scenarioId) {
      const sc = appState.scenarios.find(s => String(s.id) === scenarioId);
      galChkPt('素材のフォルダ移動');
      if (sc) {
        sc.imageCategories = sanitizeCats(sc.imageCategories, DEFAULT_SCENARIO_CATS);
        if (dest && !sc.imageCategories.includes(dest)) sc.imageCategories.push(dest);
        if (it.srcType === 'img') (sc.images || []).forEach(a => { if (('img:' + a.id) === it.uid) a.category = dest; });
        if (it.srcType === 'doc') (sc.docs || []).forEach(d => { if (('doc:' + d.id) === it.uid) d.category = dest; });
      }
      if (window.CCF && CCF.withProject) {
        CCF.withProject(scenarioId, p => {
          p.folders = p.folders || [];
          if (dest && !p.folders.includes(dest)) p.folders.push(dest);
          (p.refs || []).forEach(r => { if (('ref:' + r.id) === it.uid) r.category = dest; });
        });
      }
      notifyAfterEdit();
    }
    toast(`📁 「${galCatLabel(dest)}」へ移動しました`);
    drawModal();
  };
  const applyTags = nextTags => {
    const it = curItem(); if (!it) return;
    const clean = cleanTagArr(nextTags);
    if (scope === 'common' && window.CommonAssets) {
      window.CommonAssets.setTags(it.uid, clean);
    } else if (scope === 'scenario' && scenarioId) {
      galChkPt('素材タグを変更');
      if (it.srcType === 'ref' && window.CCF) {
        CCF.withProject(scenarioId, p => { const r = (p.refs || []).find(x => x.id === it.rawId); if (r) r.tags = clean; });
      } else if (it.raw) {
        it.raw.tags = clean;
      }
      notifyAfterEdit();
    }
    drawModal();
  };
  const applyLinkToScenario = () => {
    const it = curItem(); if (!it) return;
    const scList = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : [];
    const sc = scList.find(s => String(s.id) === String(selTargetScId));
    if (!sc) return toast('結び付けるシナリオを選択してください');
    let destCat = '';
    if (selTargetCat === '__auto__') {
      if (it.type === 'audio') destCat = 'BGM';
      else if (['トレーラー', 'NPC', '背景', '前景', 'マップ', '部屋素材', 'BGM'].includes(it.category)) destCat = it.category;
      else destCat = (M && M.inferSmartCategory ? M.inferSmartCategory(it.name, it.category || '') : '') || galNormCat(it.category);
    } else {
      destCat = galNormCat(selTargetCat);
    }
    sc.imageCategories = sanitizeCats(sc.imageCategories, DEFAULT_SCENARIO_CATS);
    if (destCat && !sc.imageCategories.includes(destCat)) sc.imageCategories.push(destCat);
    sc.images = sc.images || [];
    galChkPt('素材をシナリオへ結び付け');
    let registered = false;
    if (it.dataUrl) {
      const dup = sc.images.find(x => (x.origName || x.name || '') === (it.origName || it.name) && x.dataUrl === it.dataUrl);
      if (dup) {
        dup.category = destCat;
        dup.tags = cleanTagArr([...(dup.tags || []), ...(it.customTags || [])]);
      } else {
        sc.images.push({ id: galId(), name: it.name, origName: it.origName || it.name, dataUrl: it.dataUrl, category: destCat, tags: [...(it.customTags || [])], mtime: it.mtime || 0, addedAt: Date.now() });
      }
      registered = true;
    } else if (it.path && window.CCF && CCF.withProject) {
      CCF.withProject(String(sc.id), p => {
        p.folders = p.folders || [];
        if (destCat && !p.folders.includes(destCat)) p.folders.push(destCat);
        p.refs = p.refs || [];
        const np = normPath(it.path);
        const existing = p.refs.find(r => normPath(r.path) === np);
        if (existing) {
          existing.category = destCat;
          existing.tags = cleanTagArr([...(existing.tags || []), ...(it.customTags || [])]);
          if (it.name && existing.name !== it.name) { if (!existing.origName) existing.origName = existing.name; existing.name = it.name; }
        } else if (M && M.addRefs) {
          M.addRefs(p, [{ type: it.type || 'image', name: it.name, path: it.path, category: destCat, tags: [...(it.customTags || [])], mtime: it.mtime || 0 }]);
        } else {
          p.refs.push({ id: galId(), type: it.type || 'image', name: it.name, origName: it.origName || it.name, path: it.path, category: destCat, tags: [...(it.customTags || [])], mtime: it.mtime || 0 });
        }
      });
      registered = true;
    }
    if (!registered) return toast('❌ この素材はコピーできませんでした');
    try { if (window.CCF && CCF.assets && CCF.assets.invalidateUnified) CCF.assets.invalidateUnified(String(sc.id), false); } catch (_) { }
    notifyAfterEdit();
    toast(`✅ シナリオ「${sc.title || '無題'}」へ追加しました`);
  };
  const applyDelete = async () => {
    const it = curItem(); if (!it) return;
    const msg = scope === 'common'
      ? `素材「${it.name}」を共通ギャラリーから削除・除外しますか？（監視フォルダ内の元ファイル自体は消えません）`
      : `素材「${it.name}」を登録素材から削除・除外しますか？（PC上の元ファイル自体は消えません）`;
    if (!(await appConfirm(msg, { title: '素材の削除確認', okText: '削除する', danger: true }))) return;
    galChk.img.delete(it.uid);
    if (scope === 'common' && window.CommonAssets) {
      window.CommonAssets.removeItems([it.uid]);
    } else if (scope === 'scenario' && scenarioId) {
      const sc = appState.scenarios.find(s => String(s.id) === scenarioId);
      galChkPt('登録素材を削除');
      if (sc) {
        sc.images = (sc.images || []).filter(a => ('img:' + a.id) !== it.uid);
        sc.docs = (sc.docs || []).filter(d => ('doc:' + d.id) !== it.uid);
        if (Array.isArray(sc.assetOrder)) sc.assetOrder = sc.assetOrder.filter(u => u !== it.uid);
      }
      if (window.CCF && CCF.withProject) {
        CCF.withProject(scenarioId, p => {
          p.refs = (p.refs || []).filter(r => ('ref:' + r.id) !== it.uid);
          p.assetOrder = (p.assetOrder || []).filter(u => u !== it.uid);
        });
      }
      if (typeof cleanupUnusedImages === 'function') cleanupUnusedImages();
      notifyAfterEdit();
    }
    if (typeof o.onDelete === 'function') { try { o.onDelete(it.uid); } catch (_) { } }
    toast(`🗑️ 「${it.name}」を削除しました`);
    list.splice(curIdx, 1);
    if (!list.length) return close();
    if (curIdx >= list.length) curIdx = list.length - 1;
    curUid = list[curIdx].uid;
    resetZoom();
    drawModal();
  };

  const resetZoom = () => { zoom = 1; panX = 0; panY = 0; };
  const updateImageTransform = () => {
    const img = modal.querySelector('.gal-detail-img');
    if (img) {
      img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      img.classList.toggle('is-zoomed', zoom > 1.01);
    }
    const zLbl = modal.querySelector('[data-gd-zoom]');
    if (zLbl) zLbl.textContent = `${Math.round(zoom * 100)}%`;
  };
  const stepItem = delta => {
    if (list.length <= 1) return;
    stopAudio();
    curIdx = (curIdx + delta + list.length) % list.length;
    curUid = list[curIdx].uid;
    resetZoom();
    drawModal();
  };

  function close() {
    stopAudio();
    document.removeEventListener('keydown', onKey, true);
    ov.remove();
  }
  ov._closeDetail = close;

  function onKey(e) {
    if (document.querySelector('.app-dialog-overlay')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepItem(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepItem(1); }
  }
  document.addEventListener('keydown', onKey, true);

  function renderScenarioSelectOptions() {
    const scList = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : [];
    const q = scFilter.trim().toLowerCase();
    const filtered = q ? scList.filter(s => String(s.title || '無題').toLowerCase().includes(q) || String(s.system || '').toLowerCase().includes(q)) : scList;
    if (!filtered.length) return '<option value="">（該当するシナリオがありません）</option>';
    if (!filtered.some(s => String(s.id) === selTargetScId)) selTargetScId = String(filtered[0].id);
    return filtered.map(s => `<option value="${escapeHTML(String(s.id))}"${String(s.id) === selTargetScId ? ' selected' : ''}>${escapeHTML(s.title || '無題')}${s.system ? ` [${escapeHTML(s.system)}]` : ''}</option>`).join('');
  }

  function drawModal() {
    const it = curItem();
    if (!it) return close();
    const src = resolveUrl(it);
    const needWebBridge = !src && it.path && window.WebBridge && WebBridge.isAssetRef(it.path);
    const id3 = (it.type === 'audio' && it.path && IS_ELECTRON && window.CCF && CCF.assets && CCF.assets.tagsOf) ? CCF.assets.tagsOf(it.path) : null;

    let previewHtml = '';
    if (it.missing) {
      previewHtml = `<div class="gal-detail-empty"><div class="gal-detail-bigico">⚠️</div><div>ファイルが見つかりません</div><small>${escapeHTML(it.path || it.name)}</small></div>`;
    } else if (it.type === 'image' && (src || needWebBridge)) {
      previewHtml = `<div class="gal-detail-stage" data-gd-stage="1">
        <img class="gal-detail-img" ${it.dataUrl ? imgAttr(it.dataUrl) : `src="${escapeHTML(src)}"`} alt="${escapeHTML(it.name)}" draggable="false">
        <div class="gal-detail-zoombar">
          <button type="button" class="btn-sort" data-gd="zoom-out" title="縮小">－</button>
          <span data-gd-zoom="1">${Math.round(zoom * 100)}%</span>
          <button type="button" class="btn-sort" data-gd="zoom-in" title="拡大">＋</button>
          <button type="button" class="btn-sort" data-gd="zoom-reset">リセット</button>
        </div>
      </div>`;
    } else if (it.type === 'audio') {
      const metaRows = id3 ? [
        id3.title && ['曲名', id3.title],
        id3.artist && ['アーティスト', id3.artist],
        id3.album && ['アルバム', id3.album],
        id3.genre && ['ジャンル', id3.genre],
        id3.comment && ['コメント', id3.comment]
      ].filter(Boolean) : [];
      const metaHtml = metaRows.length
        ? `<div class="gal-detail-id3">${metaRows.map(([k, v]) => `<div><b>${escapeHTML(k)}:</b> ${escapeHTML(v)}</div>`).join('')}</div>`
        : '';
      previewHtml = `<div class="gal-detail-audio">
        <div class="gal-detail-bigico">🎵</div>
        <div class="gal-detail-audioname">${escapeHTML(it.name)}</div>
        ${(src || needWebBridge) ? `<audio class="gal-detail-player" controls preload="metadata" src="${escapeHTML(src)}"></audio>` : '<div class="gal-hint">音声URLを読み込めませんでした</div>'}
        ${metaHtml}
        ${it.path ? `<div class="gal-detail-path" title="${escapeHTML(it.path)}">${escapeHTML(it.path)}</div>` : ''}
      </div>`;
    } else if (it.type === 'video' && (src || needWebBridge)) {
      previewHtml = `<div class="gal-detail-stage"><video class="gal-detail-video" controls src="${escapeHTML(src)}"></video></div>`;
    } else {
      previewHtml = `<div class="gal-detail-empty">
        <div class="gal-detail-bigico">${galIcon(it)}</div>
        <div class="gal-detail-audioname">${escapeHTML(it.name)}</div>
        ${it.path ? `<div class="gal-detail-path">${escapeHTML(it.path)}</div>` : ''}
        ${(IS_ELECTRON && it.path) ? `<button type="button" class="btn btn-secondary" data-gd="open-ext">📂 ファイルを開く</button>` : ''}
      </div>`;
    }

    const folders = folderOptionsList();
    const curCat = galNormCat(it.category);
    const customTags = cleanTagArr(it.customTags);
    const customLower = new Set(customTags.map(t => t.toLowerCase()));
    const autoTags = cleanTagArr(it.tags).filter(t => !customLower.has(t.toLowerCase()));

    const presetHtml = GAL_TRPG_PRESET_TAGS.map(grp => `<div class="gal-detail-pgrp">
      <span class="gal-detail-plbl">${escapeHTML(grp.label)}</span>
      <div class="gal-detail-pchips">${grp.tags.map(t => {
        const on = customLower.has(t.toLowerCase());
        return `<button type="button" class="gal-tagchip${on ? ' on' : ''}" data-gd="preset-tag" data-tag="${escapeHTML(t)}" aria-pressed="${on}">${on ? '✓ ' : ''}${escapeHTML(t)}</button>`;
      }).join('')}</div>
    </div>`).join('');

    modal.innerHTML = `
      <div class="gal-detail-left">
        <div class="gal-detail-pv">${previewHtml}</div>
        <div class="gal-detail-nav">
          <button type="button" class="btn btn-secondary" data-gd="prev" ${list.length <= 1 ? 'disabled' : ''}>◀ 前の素材</button>
          <span class="gal-detail-idx">${curIdx + 1} / ${list.length}</span>
          <button type="button" class="btn btn-secondary" data-gd="next" ${list.length <= 1 ? 'disabled' : ''}>▶ 次の素材</button>
        </div>
      </div>
      <div class="gal-detail-right">
        <div class="gal-detail-rhead">
          <div class="gal-detail-rtitle">${galIcon(it)} 素材の詳細・編集</div>
          <button type="button" class="btn-sort" data-gd="close" aria-label="閉じる">✕ 閉じる</button>
        </div>
        <div class="gal-detail-rscroll">
          <section class="gal-detail-sec">
            <label class="gal-detail-sec-lbl">✏️ 表示名の変更</label>
            <div class="gal-detail-row">
              <input type="text" class="gal-detail-inp" data-gd="name-inp" value="${escapeHTML(it.name)}">
              <button type="button" class="btn btn-secondary" data-gd="save-name">名前を保存</button>
            </div>
            ${it.origName && it.origName !== it.name ? `<div class="gal-hint">元ファイル名: ${escapeHTML(it.origName)}</div>` : ''}
          </section>

          <section class="gal-detail-sec">
            <label class="gal-detail-sec-lbl">📁 所属フォルダ（カテゴリ）の変更</label>
            <div class="gal-detail-row">
              <select class="gal-detail-sel" data-gd="cat-sel">
                <option value=""${curCat === '' ? ' selected' : ''}>（未分類）</option>
                ${folders.map(f => `<option value="${escapeHTML(f)}"${curCat === f ? ' selected' : ''}>${escapeHTML(galFolderIndentLabel(f))}</option>`).join('')}
              </select>
              <button type="button" class="btn btn-secondary" data-gd="new-cat">＋ 新規フォルダへ移動</button>
            </div>
          </section>

          <section class="gal-detail-sec">
            <label class="gal-detail-sec-lbl">🏷️ タグの追加・編集</label>
            <div class="gal-detail-curtags">
              ${customTags.length ? customTags.map(t => `<span class="gal-detail-tag">${escapeHTML(t)}<button type="button" data-gd="rm-tag" data-tag="${escapeHTML(t)}" title="タグを外す">✕</button></span>`).join('') : '<span class="gal-hint">カスタムタグはまだありません</span>'}
              ${autoTags.map(t => `<span class="gal-detail-tag auto" title="フォルダ名・ID3等の自動タグ">${escapeHTML(t)}</span>`).join('')}
            </div>
            <div class="gal-detail-row">
              <input type="text" class="gal-detail-inp" data-gd="tag-inp" placeholder="新しいタグ（スペース区切りで複数追加可）">
              <button type="button" class="btn btn-secondary" data-gd="add-tag">＋ 追加</button>
            </div>
            <div class="gal-detail-presets">${presetHtml}</div>
          </section>

          <section class="gal-detail-sec gal-detail-linkbox">
            <label class="gal-detail-sec-lbl">📌 シナリオへの結び付け（登録素材へコピー）</label>
            <input type="search" class="gal-detail-inp" data-gd="sc-filter" placeholder="🔍 結び付けるシナリオを絞り込み..." value="${escapeHTML(scFilter)}">
            <div class="gal-detail-row">
              <select class="gal-detail-sel" data-gd="sc-sel" aria-label="結び付けるシナリオ">${renderScenarioSelectOptions()}</select>
              <select class="gal-detail-catsel" data-gd="sc-cat" aria-label="追加先カテゴリ">
                <option value="__auto__"${selTargetCat === '__auto__' ? ' selected' : ''}>自動判別</option>
                <option value="背景"${selTargetCat === '背景' ? ' selected' : ''}>背景</option>
                <option value="前景"${selTargetCat === '前景' ? ' selected' : ''}>前景</option>
                <option value="NPC"${selTargetCat === 'NPC' ? ' selected' : ''}>NPC</option>
                <option value="部屋素材"${selTargetCat === '部屋素材' ? ' selected' : ''}>部屋素材</option>
                <option value="マップ"${selTargetCat === 'マップ' ? ' selected' : ''}>マップ</option>
                <option value="トレーラー"${selTargetCat === 'トレーラー' ? ' selected' : ''}>トレーラー</option>
                <option value="BGM"${selTargetCat === 'BGM' ? ' selected' : ''}>BGM</option>
              </select>
            </div>
            <button type="button" class="btn gal-detail-link-btn" data-gd="link-sc">📌 このシナリオの登録素材へ結び付ける（コピー）</button>
          </section>

          ${scope === 'scenario' ? `<section class="gal-detail-sec">
            <label class="gal-detail-sec-lbl">🌐 マイライブラリ（共通）へ送る</label>
            <button type="button" class="btn btn-secondary" data-gd="send-lib" style="width:100%">🌐 マイライブラリへ送る（コピー／移動・SHA-256重複統合）</button>
          </section>` : ''}

          <hr class="gal-detail-sep">
          <div class="gal-detail-danger">
            <button type="button" class="btn btn-danger gal-detail-del-btn" data-gd="del-item">🗑️ この素材を削除</button>
          </div>
        </div>
      </div>`;

    if (needWebBridge && window.WebBridge && WebBridge.getAssetUrl) {
      WebBridge.getAssetUrl(it.path).then(u => {
        if (!u || !document.body.contains(ov)) return;
        const m = modal.querySelector('.gal-detail-img, .gal-detail-player, .gal-detail-video');
        if (m) m.src = u;
      }).catch(() => { });
    }
    updateImageTransform();
  }

  ov.addEventListener('click', async e => {
    if (e.target === ov) return close();
    const actEl = e.target.closest('[data-gd]');
    if (!actEl) return;
    const act = actEl.dataset.gd;
    if (act === 'close') return close();
    if (act === 'prev') return stepItem(-1);
    if (act === 'next') return stepItem(1);
    if (act === 'zoom-in') { zoom = Math.min(4, +(zoom + 0.35).toFixed(2)); return updateImageTransform(); }
    if (act === 'zoom-out') { zoom = Math.max(0.5, +(zoom - 0.35).toFixed(2)); if (zoom <= 1) { panX = 0; panY = 0; } return updateImageTransform(); }
    if (act === 'zoom-reset') { resetZoom(); return updateImageTransform(); }
    if (act === 'save-name') { const inp = modal.querySelector('[data-gd="name-inp"]'); return applyRename(inp && inp.value); }
    if (act === 'new-cat') {
      const n = await galAskText('新しいフォルダ名（「親フォルダ/小フォルダ」の形式でも作成できます）', '');
      if (n && n.trim()) applyMove(n.trim());
      return;
    }
    if (act === 'add-tag') {
      const inp = modal.querySelector('[data-gd="tag-inp"]');
      const raw = inp ? inp.value : '';
      const add = cleanTagArr(raw.split(/[\s,、，;]+/));
      if (!add.length) return;
      const it = curItem(); if (!it) return;
      applyTags([...(it.customTags || []), ...add]);
      return;
    }
    if (act === 'rm-tag') {
      const rm = String(actEl.dataset.tag || '').toLowerCase();
      const it = curItem(); if (!it) return;
      applyTags((it.customTags || []).filter(t => t.toLowerCase() !== rm));
      return;
    }
    if (act === 'preset-tag') {
      const tg = actEl.dataset.tag; if (!tg) return;
      const it = curItem(); if (!it) return;
      const cur = cleanTagArr(it.customTags);
      const exists = cur.some(t => t.toLowerCase() === tg.toLowerCase());
      applyTags(exists ? cur.filter(t => t.toLowerCase() !== tg.toLowerCase()) : [...cur, tg]);
      return;
    }
    if (act === 'link-sc') return applyLinkToScenario();
    if (act === 'send-lib') {
      const it = curItem();
      if (!it || !scenarioId || !(window.CCF && CCF.assets && typeof CCF.assets.sendToLibrary === 'function')) return;
      const r = await CCF.assets.sendToLibrary(scenarioId, [it.uid]);
      if (r && r.done) {
        notifyAfterEdit();
        if (r.moved) {
          list.splice(curIdx, 1);
          if (!list.length) return close();
          if (curIdx >= list.length) curIdx = list.length - 1;
          curUid = list[curIdx].uid;
          resetZoom();
        }
        drawModal();
      }
      return;
    }
    if (act === 'del-item') return applyDelete();
    if (act === 'open-ext') {
      const it = curItem();
      if (it && it.path && IS_ELECTRON) {
        if (it.type === 'pdf' && window.CCF && CCF.openPdfPath) CCF.openPdfPath(it.path);
        else shell.openPath(it.path);
      }
      return;
    }
  });

  ov.addEventListener('change', e => {
    const gd = e.target && e.target.dataset && e.target.dataset.gd;
    if (gd === 'cat-sel') return applyMove(e.target.value);
    if (gd === 'sc-sel') { selTargetScId = e.target.value; return; }
    if (gd === 'sc-cat') { selTargetCat = e.target.value; return; }
  });

  ov.addEventListener('input', e => {
    const gd = e.target && e.target.dataset && e.target.dataset.gd;
    if (gd === 'sc-filter') {
      scFilter = e.target.value;
      const sel = modal.querySelector('[data-gd="sc-sel"]');
      if (sel) sel.innerHTML = renderScenarioSelectOptions();
    }
  });

  ov.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const gd = e.target && e.target.dataset && e.target.dataset.gd;
    if (gd === 'name-inp') { e.preventDefault(); applyRename(e.target.value); }
    else if (gd === 'tag-inp') {
      e.preventDefault();
      const add = cleanTagArr(e.target.value.split(/[\s,、，;]+/));
      if (!add.length) return;
      const it = curItem(); if (it) applyTags([...(it.customTags || []), ...add]);
    }
  });

  ov.addEventListener('wheel', e => {
    const st = e.target.closest && e.target.closest('[data-gd-stage]');
    if (!st || !modal.querySelector('.gal-detail-img')) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    zoom = Math.min(4, Math.max(0.5, +(zoom + delta).toFixed(2)));
    if (zoom <= 1) { panX = 0; panY = 0; }
    updateImageTransform();
  }, { passive: false });

  ov.addEventListener('mousedown', e => {
    const img = e.target.closest && e.target.closest('.gal-detail-img');
    if (!img) return;
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    basePanX = panX; basePanY = panY;
  });
  ov.addEventListener('mousemove', e => {
    if (!dragging || zoom <= 1.01) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    panX = basePanX + dx; panY = basePanY + dy;
    updateImageTransform();
  });
  ov.addEventListener('mouseup', e => {
    if (!dragging) return;
    dragging = false;
    if (!moved && e.target.closest && e.target.closest('.gal-detail-img')) {
      if (zoom > 1.01) resetZoom();
      else zoom = 2;
      updateImageTransform();
    }
  });

  drawModal();
  modal.focus();
}
window.openGalleryDetailModal = openGalleryDetailModal;

function openHistoryModal() {
  const prev = document.querySelector('.app-dialog-overlay.hist-ov');
  if (prev) prev.remove();
  const sc = (typeof currentScenarioId !== 'undefined' && currentScenarioId && typeof appState !== 'undefined')
    ? (appState.scenarios || []).find(s => s && s.id === currentScenarioId)
    : null;
  const allHist = (typeof appState !== 'undefined' && Array.isArray(appState.history)) ? appState.history.slice().reverse() : [];
  const scHist = sc ? allHist.filter(h => h && ((h.scenarioId && String(h.scenarioId) === String(sc.id)) || (h.title && sc.title && h.title === sc.title))) : [];
  const rowsHtml = list => list.length
    ? `<table class="hist-table"><thead><tr><th>投稿日時</th><th>シナリオ名</th><th>投稿先</th><th>タグ</th></tr></thead><tbody>${list.slice(0, 30).map(h => `<tr><td>${escapeHTML(typeof fmtDate === 'function' ? fmtDate(h.date) : String(h.date || ''))}</td><td>${escapeHTML(h.title || '')}</td><td>${escapeHTML(h.channels || '')}</td><td>${escapeHTML(h.tags || '-')}</td></tr>`).join('')}</tbody></table>`
    : '<div class="gal-empty">投稿履歴はまだありません</div>';
  const ov = document.createElement('div');
  ov.className = 'app-dialog-overlay hist-ov';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="app-dialog hist-modal">
    <div class="app-dialog-title">📜 投稿履歴${sc ? `：${escapeHTML(sc.title || '無題')}` : ''}</div>
    <div class="hist-body">
      ${sc ? `<div class="hist-sub">このシナリオの投稿履歴（${scHist.length}件）</div>${rowsHtml(scHist)}` : ''}
      <div class="hist-sub">最近の投稿履歴（全体 ${allHist.length}件）</div>
      ${rowsHtml(allHist)}
    </div>
    <div class="app-dialog-actions">
      <button type="button" class="app-dialog-btn primary" data-hall="1">📜 すべての投稿履歴（全体）を開く</button>
      <button type="button" class="app-dialog-btn" data-hclose="1">閉じる</button>
    </div>
  </div>`;
  const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  ov.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('[data-hclose]')) return close();
    if (e.target.closest && e.target.closest('[data-hall]')) {
      close();
      if (typeof switchTab === 'function') switchTab('historyTab');
    }
  });
  document.body.appendChild(ov);
}
window.openHistoryModal = openHistoryModal;

if (typeof hookAfter === 'function') {
  if (typeof globalThis.switchTab === 'function') hookAfter('switchTab', flushGalleryOnTabSwitch);
  ['loadScenarioFromDB', 'saveCurrentToDB', 'autoSyncToDBOnPost', 'resetForm', 'resetInputs', 'deleteScenarioDB'].forEach(n => { if (typeof globalThis[n] === 'function') hookAfter(n, renderGalleryScenarioOnly); });
}
renderGalleryAll();
