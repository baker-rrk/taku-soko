/* app_test49_00_block_common.js — 公開情報とHOで共通のブロック編集の部品
 * 以前は公開情報側（04・08）とHO側（10）に同じ処理が2つずつあったものを、ここ1か所にまとめてある。
 * 片方だけ直して動きが食い違う、という事故を防ぐため、サブ項目・並べ替え・書式の処理は必ずここを通す。 */

// ----- サブ項目（サブタイトル＋本文のペア） -----
const SUB_FIELD = { title: 'title', text: 'val', style: 'style' };   // 画面側の種類名 → データの項目名
const newSub = () => ({ title: '', val: '', style: 'plain' });
// サブ項目の編集UI。attrs(kind, i) が、各画面の操作用の属性文字列を返す（kind: title / text / style / del / add）
function subItemsEditorHtml(subs, attrs) {
  const rows = (subs || []).map((s, i) => `<div class="sub-item" data-si="${i}"><div class="sub-item-head"><input type="text" ${attrs('title', i)} value="${escapeHTML(s.title)}" placeholder="サブタイトル（小見出し）"><select ${attrs('style', i)} title="サブタイトルの表記（引用の外に出ます）"><option value="plain" ${s.style === 'bold' ? '' : 'selected'}>通常文字</option><option value="bold" ${s.style === 'bold' ? 'selected' : ''}>太字</option></select><button type="button" class="btn-sort btn-danger" ${attrs('del', i)}>✕ 削除</button></div><textarea ${attrs('text', i)} placeholder="サブ項目の本文">${escapeHTML(s.val)}</textarea></div>`).join('');
  return rows + `<button type="button" class="btn btn-secondary btn-sm sub-add" ${attrs('add', -1)}>＋ サブ項目を追加</button>`;
}

// ----- 並べ替え -----
const moveItem = (arr, i, dir) => { const j = i + dir; if (i < 0 || j < 0 || j >= arr.length) return false; const [m] = arr.splice(i, 1); arr.splice(j, 0, m); return true; };   // 動かしたら true

// ----- 書式ボタン（太字・スポイラー・引用） -----
// 選択範囲を before/after で囲む。after が空のときは「選択した各行の先頭」に before を付ける（引用など）。値の更新だけ行い、再描画は呼び出し側
function fmtSelection(ta, before, after) {
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e);
  const rep = after ? before + sel + after : sel.split('\n').map(l => before + l).join('\n');
  ta.value = v.slice(0, s) + rep + v.slice(e); ta.focus(); ta.setSelectionRange(s + rep.length, s + rep.length);
}

// ----- 装飾スタイル（組み込み＋自分で作ったフォーマット） -----
const BUILTIN_DECOR = [['default', '通常'], ['simple', 'シンプル'], ['fancy', 'ファンシー'], ['codeblock', 'コードブロック'], ['none', '装飾なし']];
const isDecorStyle = v => ['default', 'simple', 'fancy', 'codeblock', 'none'].includes(v) || /^fmt_[\w-]+$/.test(String(v));   // 自分のフォーマットのIDは fmt_ で始まる
const decorOptions = () => [...BUILTIN_DECOR, ...((typeof appState !== 'undefined' && Array.isArray(appState.formats)) ? appState.formats : []).map(f => [f.id, '🎨 ' + (f.name || '無題')])];
const decorOptionsHtml = cur => decorOptions().map(([v, l]) => `<option value="${escapeHTML(v)}" ${cur === v ? 'selected' : ''}>${escapeHTML(l)}</option>`).join('');
const sanitizeFormats = list => (Array.isArray(list) ? list : []).filter(f => f && typeof f === 'object').map(f => ({ id: String(f.id == null ? '' : f.id).replace(/[^\w-]/g, '_'), name: _s(f.name), headPre: _s(f.headPre), headPost: _s(f.headPost), linePre: _s(f.linePre), wrap: f.wrap === 'code' ? 'code' : 'none' })).filter(f => /^fmt_[\w-]+$/.test(f.id));

// ----- JSONバックアップの「統合」：今のデータをベースに、ファイルの内容を追加・更新する（純粋関数。引数は書き換えない） -----
function mergeCcfRoomsList(baseRooms, incRooms) {
  const map = new Map();
  (Array.isArray(baseRooms) ? baseRooms : []).forEach(r => { if (r && r.id) map.set(r.id, r); });
  (Array.isArray(incRooms) ? incRooms : []).forEach(r => {
    if (!r || !r.id) return;
    const cur = map.get(r.id);
    if (!cur || (Number(r.updatedAt) || 0) >= (Number(cur.updatedAt) || 0)) map.set(r.id, r);
  });
  return [...map.values()];
}
const RE_TITLE_DUP_NUM_SUFFIX = /\s*[(（\[]\s*\d{1,2}\s*[)）\]]\s*$/;
const RE_TITLE_DATE_SUFFIX = /[_\-\s ]*(?:20\d{2}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?|\d{1,2}\s*月\s*\d{1,2}\s*日|20\d{2}[./\-]\d{1,2}(?:[./\-]\d{1,2})?|\d{4,8}\s*(?:更新|修正|改訂|版)|(?:更新|修正|改訂)\s*20\d{2})(?:版|更新|修正|改訂|分)?/gi;
function cleanseScenarioTitleExtras(raw) {
  let s = String(raw == null ? '' : raw).normalize('NFKC').trim();
  if (!s) return '';
  const orig = s;
  for (let i = 0; i < 3; i++) {
    const prev = s;
    s = s.replace(RE_TITLE_DUP_NUM_SUFFIX, '').trim();
    s = s.replace(RE_TITLE_DATE_SUFFIX, '').replace(/[_\-\s]+$/, '').trim();
    if (s === prev) break;
  }
  return s || orig;
}
function getScenarioSourcePathKey(sc) {
  const p = sc && typeof sc === 'object' ? sc.sourcePath : sc;
  return String(p || '').normalize('NFKC').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
function areIndependentSourcePaths(scA, scB) {
  const a = getScenarioSourcePathKey(scA);
  const b = getScenarioSourcePathKey(scB);
  if (!a || !b) return false;
  if (a === b) return false;
  if (b.startsWith(a + '/') || a.startsWith(b + '/')) return false;
  return true;
}
function normalizeShopUrlForDedup(sc) {
  const u = sc && typeof sc === 'object' ? sc.shopUrl : '';
  return String(u || '').trim().split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
}
function canAutoMergeScenarios(scA, scB) {
  if (!scA || !scB || typeof scA !== 'object' || typeof scB !== 'object') return true;
  if (areIndependentSourcePaths(scA, scB)) return false;
  const urlA = normalizeShopUrlForDedup(scA);
  const urlB = normalizeShopUrlForDedup(scB);
  if (urlA && urlB && urlA !== urlB) return false;
  return true;
}
function getScenarioDedupKey(sc) {
  let s = String(typeof sc === 'string' ? sc : (sc && sc.title) || '').normalize('NFKC').trim();
  if (!s) return '';
  // 先頭の記号（☆, ★, ●, ◆ 等）およびソート頭文字を除去
  const beforeLeadingSym = s;
  s = s.replace(/^(?:[☆★●○◆◇■□▲△▼▽◎※・･\-_=+~～!！?？#＃*＊@＠]+\s*)+/, '');
  if (!s.trim()) s = beforeLeadingSym;
  const beforeSortPrefix = s;
  s = s.replace(/^(?:[0-9]{1,3}(?:[._\-:：)）]\s*|\s+)|[ぁ-んァ-ヶa-zA-Z](?:[._\-:：]\s*|\s+)|[（(【\[][ぁ-んァ-ンa-zA-Z0-9]{1,2}[）)\]】]\s*)+/, '');
  if (!s.trim()) s = beforeSortPrefix;
  const beforeLeadingSym2 = s;
  s = s.replace(/^(?:[☆★●○◆◇■□▲△▼▽◎※・･]+\s*)+/, '');
  if (!s.trim()) s = beforeLeadingSym2;
  // システム名括弧・人数括弧・バージョン表記・重複連番・年月表記・配布形態の除去
  s = s.replace(/[（(【\[「『][^）)\]】」』]*(?:coc|クトゥルフ|クトゥルー|cthulhu|エモクロア|インセイン|シノビガミ|マダミス|マーダーミステリー|ダブルクロス|ソード・?ワールド|ソドワ|\bsw\b|\bdx\b|6版|7版|\d+\s*pl|\d+\s*人|ソロ|タイマン|gm|kp|kpc|改変|booth|pdf|zip|ver\.?|第\d+版|修正|改訂|改定|オンライン|オフライン|完全版|新版|旧版|体験版|web版|配布)[^）)\]】」』]*[）)\]】」』]/gi, '');
  s = s.replace(/(?:^|[\s_\-])(?:ver\.?|v)\s*\d+(?:[._]\d+)*[a-z]?/gi, '');
  s = cleanseScenarioTitleExtras(s);
  const beforeTrailingEdition = s;
  for (let i = 0; i < 2; i++) {
    const prev = s;
    s = s.replace(/(?:[_\-\s]+(?:修正版|改訂版|改定版|更新版|オンライン版|オフライン版|完全版|新版|旧版|体験版|booth版|pdf版|配布版|web版)|(?:修正版|改訂版|改定版|オンライン版))\s*$/i, '').trim();
    if (s === prev) break;
  }
  if (!s.trim()) s = beforeTrailingEdition;
  s = s.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
  return s;
}
function mergeScenarioRecords(baseSc, incSc, opts) {
  const b = baseSc || {}, n = incSc || {};
  const bScore = ((b.postedChannels && b.postedChannels.length) ? 1000 : 0) + ((b.ccfRooms && b.ccfRooms.length) ? 500 : 0) + (b.sourcePath ? 100 : 0);
  const nScore = ((n.postedChannels && n.postedChannels.length) ? 1000 : 0) + ((n.ccfRooms && n.ccfRooms.length) ? 500 : 0) + (n.sourcePath ? 100 : 0);
  const preferBase = (opts && opts.preferBase !== undefined) ? opts.preferBase : (bScore >= nScore);
  const primary = preferBase ? b : n;
  const secondary = preferBase ? n : b;
  const pTs = Number(primary.updatedAt) || 0;
  const sTs = Number(secondary.updatedAt) || 0;
  const pickRich = (pv, sv) => {
    const ps = String(pv == null ? '' : pv).trim();
    const ss = String(sv == null ? '' : sv).trim();
    if (!ps) return sv != null ? sv : (pv != null ? pv : '');
    if (!ss) return pv;
    if (ps === ss) return pv;
    if (ss.length > ps.length * 1.2 || (ss.length >= ps.length && sTs > pTs)) return sv;
    if (ps.length > ss.length * 1.2 || (ps.length >= ss.length && pTs >= sTs)) return pv;
    return sTs > pTs ? sv : pv;
  };
  const mergeUniqueArr = (arrA, arrB, keyFn) => {
    const out = [], seen = new Set();
    [...(Array.isArray(arrA) ? arrA : []), ...(Array.isArray(arrB) ? arrB : [])].forEach(it => {
      if (it == null) return;
      const k = keyFn ? keyFn(it) : String(it);
      if (k && seen.has(k)) return;
      if (k) seen.add(k);
      out.push(it);
    });
    return out;
  };
  const mergeDocsList = (arrA, arrB) => {
    const out = [], byKey = new Map();
    const normDocNameKey = d => {
      const raw = String(d.origName || d.name || '').normalize('NFKC').trim();
      const baseFromPath = String(d.path || d.ref || d.rel || '').split(/[\\/]/).pop() || '';
      const src = raw || String(baseFromPath).normalize('NFKC').trim();
      if (!src) return '';
      const m = /^(.*)\.([a-z0-9]{1,8})$/i.exec(src);
      const stem = (m ? m[1] : src).trim().toLowerCase();
      let ext = (m ? m[2] : String(d.ext || '').replace(/^\./, '')).trim().toLowerCase();
      if (!ext && baseFromPath) {
        const pm = /\.([a-z0-9]{1,8})$/i.exec(baseFromPath);
        if (pm) ext = pm[1].toLowerCase();
      }
      if (!stem) return '';
      return 'name:' + (ext ? `${stem}.${ext}` : stem);
    };
    [...(Array.isArray(arrA) ? arrA : []), ...(Array.isArray(arrB) ? arrB : [])].forEach(d => {
      if (!d || typeof d !== 'object') return;
      const relKey = d.rel ? ('rel:' + String(d.rel).replace(/\\/g, '/').toLowerCase()) : '';
      const pathKey = d.path ? ('path:' + String(d.path).replace(/\\/g, '/').toLowerCase()) : '';
      const refKey = d.ref ? ('ref:' + String(d.ref).replace(/\\/g, '/').toLowerCase()) : '';
      const idKey = d.id != null && d.id !== '' ? ('id:' + String(d.id)) : '';
      const nameKey = normDocNameKey(d);
      const hitKey = [relKey, pathKey, refKey, idKey, nameKey].find(k => k && byKey.has(k));
      if (hitKey) {
        const idx = byKey.get(hitKey);
        const cur = out[idx];
        const merged = {
          ...d,
          ...cur,
          id: cur.id || d.id,
          name: cur.name || d.name,
          rel: cur.rel || d.rel || ''
        };
        if (cur.origName || d.origName) merged.origName = cur.origName || d.origName;
        if (cur.path || d.path) merged.path = cur.path || d.path; else delete merged.path;
        if (cur.ref || d.ref) merged.ref = cur.ref || d.ref; else delete merged.ref;
        if (cur.ext || d.ext) merged.ext = cur.ext || d.ext;
        if (cur.category || d.category) merged.category = cur.category || d.category;
        if (cur.cloudSha || d.cloudSha) merged.cloudSha = cur.cloudSha || d.cloudSha; else delete merged.cloudSha;
        if (cur.mtime || d.mtime) merged.mtime = Number(cur.mtime || 0) || Number(d.mtime || 0);
        if (cur.addedAt || d.addedAt) merged.addedAt = Number(cur.addedAt || 0) || Number(d.addedAt || 0);
        if (Array.isArray(cur.tags) || Array.isArray(d.tags)) {
          const tags = mergeUniqueArr(cur.tags, d.tags, x => String(x).normalize('NFKC').trim().toLowerCase());
          if (tags.length) merged.tags = tags;
        }
        out[idx] = merged;
        [relKey, pathKey, refKey, idKey, nameKey].forEach(k => { if (k && !byKey.has(k)) byKey.set(k, idx); });
      } else {
        const idx = out.length;
        out.push({ ...d });
        [relKey, pathKey, refKey, idKey, nameKey].forEach(k => { if (k) byKey.set(k, idx); });
      }
    });
    return out;
  };
  const mergeImgsList = (arrA, arrB) => {
    const out = [], byKey = new Map();
    [...(Array.isArray(arrA) ? arrA : []), ...(Array.isArray(arrB) ? arrB : [])].forEach(im => {
      if (!im || typeof im !== 'object') return;
      const idKey = im.id != null ? ('id:' + String(im.id)) : '';
      const urlKey = im.dataUrl ? ('url:' + String(im.dataUrl)) : '';
      const relKey = im.rel ? ('rel:' + String(im.rel).replace(/\\/g, '/').toLowerCase()) : '';
      const hitKey = [idKey, urlKey, relKey].find(k => k && byKey.has(k));
      if (hitKey) {
        const idx = byKey.get(hitKey);
        out[idx] = { ...out[idx], ...im, id: out[idx].id || im.id };
      } else {
        const idx = out.length;
        out.push({ ...im });
        [idKey, urlKey, relKey].forEach(k => { if (k) byKey.set(k, idx); });
      }
    });
    return out;
  };

  const res = {
    ...(sTs > pTs ? primary : secondary),
    ...(sTs > pTs ? secondary : primary),
    id: primary.id || secondary.id,
    title: pickRich(primary.title, secondary.title),
    author: pickRich(primary.author, secondary.author),
    system: pickRich(primary.system, secondary.system),
    playerCount: pickRich(primary.playerCount, secondary.playerCount),
    playTime: pickRich(primary.playTime, secondary.playTime),
    skills: pickRich(primary.skills, secondary.skills),
    lostRate: pickRich(primary.lostRate, secondary.lostRate),
    synopsis: pickRich(primary.synopsis, secondary.synopsis),
    notes: pickRich(primary.notes, secondary.notes),
    trailer: pickRich(primary.trailer, secondary.trailer),
    shopUrl: primary.shopUrl || secondary.shopUrl || '',
    sourcePath: primary.sourcePath || secondary.sourcePath || '',
    imageUrl: primary.imageUrl || secondary.imageUrl || '',
    favorite: !!(primary.favorite || secondary.favorite),
    playStatus: primary.playStatus || secondary.playStatus || '',
    cloudKeepAssets: !!(primary.cloudKeepAssets || secondary.cloudKeepAssets),
    postedChannels: mergeUniqueArr(primary.postedChannels, secondary.postedChannels, x => String(x)),
    postedInfo: { ...(secondary.postedInfo || {}), ...(primary.postedInfo || {}) },
    tags: mergeUniqueArr(primary.tags, secondary.tags, x => String(x).normalize('NFKC').trim().toLowerCase()),
    hoverImages: mergeUniqueArr(primary.hoverImages, secondary.hoverImages, x => String(x)),
    updatedAt: Math.max(pTs, sTs) || Date.now()
  };
  if (Array.isArray(primary.imageCategories) || Array.isArray(secondary.imageCategories)) {
    const sCats = Array.isArray(secondary.imageCategories) && secondary.imageCategories.length ? sanitizeCats(secondary.imageCategories, DEFAULT_SCENARIO_CATS) : [];
    const pCats = Array.isArray(primary.imageCategories) && primary.imageCategories.length ? sanitizeCats(primary.imageCategories, DEFAULT_SCENARIO_CATS) : [];
    res.imageCategories = [...new Set([...sCats, ...pCats])];
  }
  if (Array.isArray(primary.images) || Array.isArray(secondary.images)) {
    res.images = mergeImgsList(secondary.images, primary.images);
  }
  if (Array.isArray(primary.docs) || Array.isArray(secondary.docs)) {
    res.docs = mergeDocsList(primary.docs, secondary.docs);
  }
  if (Array.isArray(primary.ccfRooms) || Array.isArray(secondary.ccfRooms)) {
    res.ccfRooms = mergeCcfRoomsList(secondary.ccfRooms, primary.ccfRooms);
    const act = primary.ccfActiveRoomId || secondary.ccfActiveRoomId || (res.ccfRooms[0] ? res.ccfRooms[0].id : null);
    if (act !== null) res.ccfActiveRoomId = act;
  }
  if (!Array.isArray(res.fullBlockData) || !res.fullBlockData.length) {
    if (Array.isArray(secondary.fullBlockData) && secondary.fullBlockData.length) res.fullBlockData = secondary.fullBlockData;
  }
  if (!Array.isArray(res.secretHOs) || !res.secretHOs.length) {
    if (Array.isArray(secondary.secretHOs) && secondary.secretHOs.length) res.secretHOs = secondary.secretHOs;
  }
  return res;
}
if (typeof window !== 'undefined') {
  window.cleanseScenarioTitleExtras = cleanseScenarioTitleExtras;
  window.getScenarioDedupKey = getScenarioDedupKey;
  window.getScenarioSourcePathKey = getScenarioSourcePathKey;
  window.areIndependentSourcePaths = areIndependentSourcePaths;
  window.canAutoMergeScenarios = canAutoMergeScenarios;
  window.mergeScenarioRecords = mergeScenarioRecords;
  window.mergeCcfolia = function (bSc, iSc) {
    const rooms = mergeCcfRoomsList(bSc && bSc.ccfRooms, iSc && iSc.ccfRooms);
    const active = (iSc && iSc.ccfActiveRoomId && rooms.some(r => r.id === iSc.ccfActiveRoomId)) ? iSc.ccfActiveRoomId
      : (bSc && bSc.ccfActiveRoomId && rooms.some(r => r.id === bSc.ccfActiveRoomId)) ? bSc.ccfActiveRoomId
      : (rooms[0] ? rooms[0].id : '');
    return { ccfRooms: rooms, ccfActiveRoomId: active };
  };
}
function mergeBackupInto(base, inc) {
  const S = { imgAdded: 0, imgUpdated: 0, scenAdded: 0, scenUpdated: 0, scenSame: 0, scenKeptNewer: 0, chAdded: 0, chUpdated: 0, fmtAdded: 0, fmtUpdated: 0, histAdded: 0 };
  const clone = x => JSON.parse(JSON.stringify(x));
  const b = clone(base || {}), n = clone(inc || {});
  const mergeById = (oldList, newList) => {
    const out = [...(Array.isArray(oldList) ? oldList : [])];
    const pos = new Map(out.map((x, i) => [x && x.id, i]));
    (Array.isArray(newList) ? newList : []).forEach(it => {
      if (!it || it.id == null) return;
      if (pos.has(it.id)) out[pos.get(it.id)] = { ...out[pos.get(it.id)], ...it };
      else { pos.set(it.id, out.length); out.push(it); }
    });
    return out;
  };
  const mergeScenExtra = (w, o) => {
    const res = { ...w, postedChannels: [...new Set([...(w.postedChannels || []), ...(o.postedChannels || [])])], postedInfo: { ...(o.postedInfo || {}), ...(w.postedInfo || {}) } };
    if (Array.isArray(w.imageCategories) || Array.isArray(o.imageCategories)) {
      const oCats = Array.isArray(o.imageCategories) && o.imageCategories.length ? sanitizeCats(o.imageCategories, DEFAULT_SCENARIO_CATS) : [];
      const wCats = Array.isArray(w.imageCategories) && w.imageCategories.length ? sanitizeCats(w.imageCategories, DEFAULT_SCENARIO_CATS) : [];
      res.imageCategories = [...new Set([...oCats, ...wCats])];
    }
    if (Array.isArray(w.images) || Array.isArray(o.images)) {
      res.images = mergeById(o.images, w.images);
    }
    if (Array.isArray(w.docs) || Array.isArray(o.docs)) {
      res.docs = mergeById(o.docs, w.docs);
    }
    if (Array.isArray(w.ccfRooms) || Array.isArray(o.ccfRooms)) {
      res.ccfRooms = mergeCcfRoomsList(o.ccfRooms, w.ccfRooms);
      const act = w.ccfActiveRoomId || o.ccfActiveRoomId || (res.ccfRooms[0] ? res.ccfRooms[0].id : null);
      if (act !== null) res.ccfActiveRoomId = act;
    }
    return res;
  };
  const upsert = (list, items, add, upd, rule, norm = x => x) => {
    const out = [...list], pos = new Map(out.map((x, i) => [x.id, i]));
    (items || []).forEach(it => {
      if (!it || it.id == null) return;
      if (!pos.has(it.id)) { out.push(it); pos.set(it.id, out.length - 1); S[add]++; return; }
      const cur = out[pos.get(it.id)], next = rule(cur, it);
      if (next === null) return;
      if (JSON.stringify(next) === JSON.stringify(norm(cur))) { if (S.scenSame !== undefined && add === 'scenAdded') S.scenSame++; return; }
      out[pos.get(it.id)] = next; S[upd]++;
    });
    return out;
  };
  const retiredScenIds = new Set();
  const scenarios = (() => {
    const out = [...(b.scenarios || []).filter(x => x && x.id != null)];
    const posId = new Map(), posDedup = new Map(), posPath = new Map();
    const indexAt = (sc, i) => {
      if (sc.id != null) posId.set(sc.id, i);
      const dk = getScenarioDedupKey(sc);
      if (dk) {
        if (!posDedup.has(dk)) posDedup.set(dk, []);
        const arr = posDedup.get(dk);
        if (!arr.includes(i)) arr.push(i);
      }
      const pk = getScenarioSourcePathKey(sc);
      if (pk && !posPath.has(pk)) posPath.set(pk, i);
    };
    out.forEach(indexAt);
    (n.scenarios || []).forEach(it => {
      if (!it || it.id == null) return;
      const dk = getScenarioDedupKey(it), pk = getScenarioSourcePathKey(it);
      let idx = posId.has(it.id) ? posId.get(it.id) : undefined;
      if (idx === undefined && pk && posPath.has(pk)) idx = posPath.get(pk);
      if (idx === undefined && dk && posDedup.has(dk)) {
        const cands = posDedup.get(dk);
        idx = cands.find(ci => canAutoMergeScenarios(out[ci], it));
      }
      if (idx === undefined) {
        const nextIdx = out.length;
        out.push(it);
        indexAt(it, nextIdx);
        S.scenAdded++;
        return;
      }
      const cur = out[idx];
      const next = mergeScenarioRecords(cur, it, { preferBase: true });
      if (cur.id !== it.id) {
        const retired = next.id === cur.id ? it.id : cur.id;
        if (retired != null) retiredScenIds.add(retired);
      }
      if (JSON.stringify(next) === JSON.stringify(mergeScenarioRecords(cur, cur, { preferBase: true }))) {
        S.scenSame++;
        return;
      }
      out[idx] = next;
      indexAt(next, idx);
      S.scenUpdated++;
    });
    return out;
  })();
  const channels = upsert((b.channels || []).filter(x => x && x.id != null), n.channels, 'chAdded', 'chUpdated', (cur, it) => ({ ...cur, ...it }));
  const formats = upsert((b.formats || []).filter(x => x && x.id != null), n.formats, 'fmtAdded', 'fmtUpdated', (cur, it) => ({ ...cur, ...it }));
  const imageAssets = upsert((b.imageAssets || []).filter(x => x && x.id != null), n.imageAssets, 'imgAdded', 'imgUpdated', (cur, it) => ({ ...cur, ...it }));
  const imageCategories = [...new Set([...(b.imageCategories || []), ...(n.imageCategories || [])])];   // 共通ギャラリーのカテゴリ：追加のみ
  const historyClearedAt = Math.max(Number(b.historyClearedAt) || 0, Number(n.historyClearedAt) || 0) || b.historyClearedAt;
  const key = h => h.date + '|' + h.title + '|' + h.channels, hm = new Map((b.history || []).filter(Boolean).map(h => [key(h), h]));
  const clearedIso = historyClearedAt ? new Date(historyClearedAt).toISOString() : '';
  (n.history || []).forEach(h => { if (h && !hm.has(key(h)) && !(clearedIso && String(h.date) <= clearedIso)) { hm.set(key(h), h); S.histAdded++; } });
  const history = [...hm.values()].sort((x, y) => String(x.date).localeCompare(String(y.date))).slice(-500);
  const dsc = { ...(b.deletedScenarios || {}) }, dch = { ...(b.deletedChannels || {}) };
  (n.scenarios || []).forEach(s => { if (s && !retiredScenIds.has(s.id)) delete dsc[s.id]; }); (n.channels || []).forEach(c => { if (c) delete dch[c.id]; });   // ファイルに含まれるものは、削除済みの記録を外して戻す
  retiredScenIds.forEach(rid => { dsc[rid] = Date.now(); });
  const mergedObj = { ...b, scenarios, channels, formats, imageAssets, imageCategories, history, deletedScenarios: dsc, deletedChannels: dch };
  if (historyClearedAt !== undefined) mergedObj.historyClearedAt = historyClearedAt;
  if (Array.isArray(b.unlinkedCcfRooms) || Array.isArray(n.unlinkedCcfRooms)) {
    mergedObj.unlinkedCcfRooms = mergeCcfRoomsList(b.unlinkedCcfRooms, n.unlinkedCcfRooms);
    mergedObj.unlinkedCcfActiveRoomId = n.unlinkedCcfActiveRoomId || b.unlinkedCcfActiveRoomId || (mergedObj.unlinkedCcfRooms[0] ? mergedObj.unlinkedCcfRooms[0].id : null);
  }
  return { merged: mergedObj, summary: S };
}
const mergeSummaryText = S => `シナリオ：追加 ${S.scenAdded}件・更新 ${S.scenUpdated}件・変更なし ${S.scenSame}件` + (S.scenKeptNewer ? `・今のデータのほうが新しいため更新しない ${S.scenKeptNewer}件` : '') + `\nチャンネル：追加 ${S.chAdded}件・更新 ${S.chUpdated}件\nフォーマット：追加 ${S.fmtAdded}件・更新 ${S.fmtUpdated}件\n投稿履歴：追加 ${S.histAdded}件` + (S.imgAdded + S.imgUpdated ? `\nギャラリー画像：追加 ${S.imgAdded}件・更新 ${S.imgUpdated}件` : '');

// ----- ギャラリー（画像素材）・資料ファイルのデータ -----
const DEFAULT_COMMON_CATS = ['未分類', '背景', 'パネル'], DEFAULT_SCENARIO_CATS = ['トレーラー', 'NPC', '背景', '前景', 'マップ', '部屋素材'];
const LEGACY_SCENARIO_CATS_SIG = 'トレーラー,NPC,マップ';
if (typeof window !== 'undefined') { window.DEFAULT_COMMON_CATS = DEFAULT_COMMON_CATS; window.DEFAULT_SCENARIO_CATS = DEFAULT_SCENARIO_CATS; }
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const galId = () => 'img_' + Math.random().toString(36).slice(2, 10);
const safeGalId = v => String(v == null ? '' : v).replace(/[^\w-]/g, '_') || galId();
const sanitizeCats = (list, def) => {
  const out = [...new Set((Array.isArray(list) ? list : []).map(_s).map(s => s.trim()).filter(Boolean))];
  if (!out.length) return [...def];
  if (def === DEFAULT_SCENARIO_CATS && out.join(',') === LEGACY_SCENARIO_CATS_SIG) return [...DEFAULT_SCENARIO_CATS];
  return out;
};
const isUnclassifiedCat = c => { const s = _s(c).trim(); return !s || s === '(未分類)' || s === '（未分類）' || s === '未分類'; };
const sanitizeAssets = (list, cats) => (Array.isArray(list) ? list : []).filter(a => a && typeof a === 'object' && /^(data:image\/|blob:|@img:)/.test(String(a.dataUrl || ''))).map(a => {
  const c = _s(a.category).trim();
  const cat = (cats && cats.includes(c)) ? c : (isUnclassifiedCat(c) ? (cats && cats.includes('未分類') ? '未分類' : '(未分類)') : (cats ? '(未分類)' : c));
  const out = { id: safeGalId(a.id), name: _s(a.name), dataUrl: String(a.dataUrl), category: cat };
  if (Array.isArray(a.tags) && a.tags.length) out.tags = [...new Set(a.tags.map(_s).map(t => t.trim()).filter(Boolean))];
  if (a.addedAt) out.addedAt = Number(a.addedAt) || 0;
  if (a.origName) out.origName = _s(a.origName);
  return out;
});
const sanitizeDocs = list => (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object').map(x => {
  const rawRel = _s(x.rel).replace(/\\/g, '/').trim();
  const safeRel = (rawRel && !rawRel.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(rawRel) && !/^[A-Za-z]:/.test(rawRel)) ? rawRel : '';
  const name = _s(x.name).trim();
  const origName = _s(x.origName).trim();
  const docPath = _s(x.path).trim();
  const ref = _s(x.ref).trim();
  const ext = _s(x.ext).trim();
  const category = _s(x.category).trim();
  const cloudSha = _s(x.cloudSha).trim();
  const out = { id: safeGalId(x.id), name: name || origName, rel: safeRel };
  if (origName) out.origName = origName;
  if (docPath) out.path = docPath;
  if (ref) out.ref = ref;
  if (ext) out.ext = ext;
  if (category) out.category = category;
  if (cloudSha) out.cloudSha = cloudSha;
  if (Array.isArray(x.tags) && x.tags.length) out.tags = [...new Set(x.tags.map(_s).map(t => t.trim()).filter(Boolean))];
  if (x.mtime != null && x.mtime !== '' && Number.isFinite(Number(x.mtime))) out.mtime = Number(x.mtime);
  if (x.addedAt != null && x.addedAt !== '' && Number.isFinite(Number(x.addedAt))) out.addedAt = Number(x.addedAt);
  return out;
}).filter(x => !!(x.name || x.rel || x.path || x.ref || x.cloudSha));
const addCategory = (cats, name) => { const n = String(name).trim(); if (n && !cats.includes(n)) cats.push(n); return n; };
const uniqueCategory = (cats, base) => { let n = base, i = 2; while (cats.includes(n)) n = base + ' ' + i++; return n; };
