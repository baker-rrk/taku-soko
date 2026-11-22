/* app_test49_01_state_model.js — 設定・定数、検索、ブロックのデータモデル、アプリ全体の状態
 * 読み込み順は 01→07（HTMLの<script>の並び）。全ファイルが同じグローバルスコープを共有します。
 * 各ファイルは、前のファイルで定義された関数・変数を使えます。 */
/* Discord フォーラム概要自動投稿ツール — メインスクリプト（discord_forum_app_test24.html から読み込み）
 * 同じフォルダに HTML と一緒に置いてください。Firebase連携は HTML 内の <script type="module"> にあり、
 * このファイルとは window.* の関数（getAppStateForSync / applyMergedState / cloudScheduleSave など）で連携します。
 */
// escapeHTML / escapeHtml の両表記を常に使えるようにする別名（後続の03で本体 function escapeHTML が上書き定義される）
window.escapeHtml = window.escapeHTML = function (s) {
  if (typeof s === 'number' || typeof s === 'boolean') s = String(s);
  if (typeof s !== 'string') return '';
  return s.replace(/[&<>'"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[m]);
};
const escapeHtml = window.escapeHTML;
window.DB_CHUNK_SIZE = 60;
var DB_CHUNK_SIZE = 60;
// どこからでも参照できるファイル種別判定関数
window.isImageName = window.isImageName || (n => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(n || '')));
window.isAudioName = window.isAudioName || (n => /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(String(n || '')));
window.isVideoName = window.isVideoName || (n => /\.(mp4|webm|mov|m4v|ogv)$/i.test(String(n || '')));
window.isPdfName = window.isPdfName || (n => /\.pdf$/i.test(String(n || '')));
window.isTextDocName = window.isTextDocName || (n => /\.(txt|html?|md)$/i.test(String(n || '')));
// 添付ファイル1件・1通あたりの上限（設定で変更可。サーバーのブースト状況でDiscordの上限が違うため）
const maxAttachBytes = () => (Number(appState.maxAttachMB) > 0 ? Number(appState.maxAttachMB) : 9.5) * 1024 * 1024;
function saveMaxAttach(v) { appState.maxAttachMB = Math.min(500, Math.max(1, Number(v) || 9.5)); saveState(true); }
const APP_VERSION = 'test49';
console.info('Discord forum tool', APP_VERSION);

// ===== 予期しないエラーの見える化（黙って壊れないように。連続表示は3秒に1回まで） =====
(function () {
  let last = 0;
  const report = (label, e) => {
    const msg = (e instanceof Error ? e.message : (e && e.message)) || String(e);
    if (/^Script error\.?$|ResizeObserver/.test(msg)) return;   // 外部スクリプト由来・無害な通知は無視
    console.error('[' + label + ']', e);
    const now = Date.now(); if (now - last < 3000) return; last = now;
    try { toast('❌ 予期しないエラー: ' + msg + '\n入力中の下書きは自動保存されています。続く場合はJSONバックアップを取って再読み込みしてください'); } catch (x) { logSoft('saveMaxAttach', x); }
  };
  window.addEventListener('error', ev => report('error', ev.error || ev.message));
  window.addEventListener('unhandledrejection', ev => report('promise', ev.reason));
})();

  const defaultFormatConfig = { 
    h1: "## ❚ ", quote: "> ", subPre: "【", subPost: "】", // quoteは固定値(記号+半角スペース)。設定画面からは編集不可
    simpleH1: "◆ ", simpleList: "・ ", fancyH1: "━━━━━ ", fancyList: "✧ " 
  };

  // ===== データモデルの要点 =====
  // channels[]: { id(固定), name, webhookUrl, tags:[{name,id}], guildId? }   ※名前を変えても投稿済み情報は壊れない
  // scenarios[]: { id, title, ..., postedChannels:[チャンネルID], postedInfo:{チャンネルID:{name,tags,date}}, tags:[タグ名] }
  const chById = id => appState.channels.find(c => c.id === id);
  const chByName = n => appState.channels.find(c => c.name === n);
  const selectedChannels = () => appState.channels.filter(c => selectedChannelCols.has(c.id));   // 選択中チャンネル（IDで管理。順序はチャンネル設定の並び）
  const selectedChannelIds = () => selectedChannels().map(c => c.id);
  // タイトルが同じか：全角半角・大文字小文字・空白の違いは無視。完全に同じときだけ「同じシナリオ」とし、部分一致を含むそれ以外は別シナリオとして扱う
  const logSoft = (where, e) => console.warn('[soft-fail] ' + where, e);   // 無視してよい失敗も、原因を追えるようコンソールに残す
  const _fallbackNormTitle = t => {
    const raw = String(t == null ? '' : t).normalize('NFKC');
    const cleaned = (typeof window !== 'undefined' && typeof window.cleanseScenarioTitleExtras === 'function')
      ? window.cleanseScenarioTitleExtras(raw)
      : raw;
    return cleaned.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  };
  const _normTitle = t => (typeof window !== 'undefined' && typeof window.getScenarioDedupKey === 'function')
    ? window.getScenarioDedupKey(t)
    : ((typeof window !== 'undefined' && window.CCFModel && typeof window.CCFModel.normalizeForMatch === 'function')
      ? window.CCFModel.normalizeForMatch(t)
      : _fallbackNormTitle(t));
  const titlesSame = (a, b) => { const x = _normTitle(a); return !!x && x === _normTitle(b); };
  const findScenario = title => (currentScenarioId && appState.scenarios.find(s => s.id === currentScenarioId && titlesSame(s.title, title))) || appState.scenarios.find(s => titlesSame(s.title, title));
  function postedLabel(sc, id) { const c = chById(id); return c ? c.name : ((sc.postedInfo && sc.postedInfo[id] && sc.postedInfo[id].name) || String(id)); }
  function resolvePostedChannelName(sc, id) {
    if (id == null) return '';
    const rawId = String(id).trim();
    if (!rawId) return '';
    const c = chById(rawId) || chByName(rawId);
    if (c && String(c.name || '').trim()) return String(c.name).trim();
    const infName = sc && sc.postedInfo && sc.postedInfo[rawId] && String(sc.postedInfo[rawId].name || '').trim();
    if (infName && !/^ch_[0-9a-z_]+$/i.test(infName)) return infName;
    if (!/^ch_[0-9a-z_]+$/i.test(rawId)) return rawId;
    return '';
  }
  function getPostedChannelNames(sc) {
    const list = (sc && Array.isArray(sc.postedChannels)) ? sc.postedChannels : [];
    const names = [];
    list.forEach(id => {
      const nm = resolvePostedChannelName(sc, id);
      if (nm && !names.includes(nm)) names.push(nm);
    });
    return names;
  }
  function formatScenarioPostedDetail(sc) {
    const list = (sc && Array.isArray(sc.postedChannels)) ? sc.postedChannels : [];
    const total = list.length;
    if (!total) return { text: '未投稿', title: '', isPosted: false };
    const names = getPostedChannelNames(sc);
    const title = names.join('・');
    let text = '';
    if (total === 1) {
      text = names.length >= 1 ? `✅ ${names[0]}に投稿済み` : '✅ 1チャンネルに投稿済み';
    } else if (total === 2) {
      text = names.length >= 2 ? `✅ ${names[0]}・${names[1]}に投稿済み` : (names.length === 1 ? `✅ ${names[0]} ほか計2chに投稿済み` : '✅ 2チャンネルに投稿済み');
    } else {
      text = names.length >= 2 ? `✅ ${names[0]}・${names[1]} ほか計${total}chに投稿済み` : (names.length === 1 ? `✅ ${names[0]} ほか計${total}chに投稿済み` : `✅ ${total}チャンネルに投稿済み`);
    }
    return { text, title, isPosted: true };
  }
  function formatScenarioPostedBadge(sc) {
    const list = (sc && Array.isArray(sc.postedChannels)) ? sc.postedChannels : [];
    const total = list.length;
    if (!total) return { text: '未投稿 ✎', title: 'クリックで投稿状態を変更', isPosted: false };
    const names = getPostedChannelNames(sc);
    const allNamesStr = names.join('・');
    const title = allNamesStr ? `${allNamesStr}（クリックで投稿状態を変更）` : 'クリックで投稿状態を変更';
    let text = '';
    if (total === 1) {
      text = names.length >= 1 ? `✓ ${names[0]}に投稿済 ▾` : '✓ 投稿済 (1) ▾';
    } else {
      text = names.length >= 1 ? `✓ ${names[0]}ほか(${total})に投稿済 ▾` : `✓ 投稿済 (${total}) ▾`;
    }
    return { text, title, isPosted: true };
  }
  window.resolvePostedChannelName = resolvePostedChannelName;
  window.getPostedChannelNames = getPostedChannelNames;
  window.formatScenarioPostedDetail = formatScenarioPostedDetail;
  window.formatScenarioPostedBadge = formatScenarioPostedBadge;
  function ensureChannelIds() {   // 旧データ用：名前から決まるIDを付ける（端末ごとに同じIDになる）
    const used = new Set();
    appState.channels.forEach((c, i) => { if (!c.id || used.has(c.id)) { let id = 'ch_' + hashStr(c.name || ''); if (used.has(id)) id += '_' + i; c.id = id; } used.add(c.id); });
  }
  function normalizePosted(sc) {   // 旧形式（チャンネル名）や別環境のIDを、いまのチャンネルIDへ引き直す
    const info = (sc.postedInfo && typeof sc.postedInfo === 'object') ? sc.postedInfo : {}, out = [];
    (Array.isArray(sc.postedChannels) ? sc.postedChannels : []).forEach(e => {
      let id = chById(e) ? e : null;
      if (!id) { const c = chByName((info[e] && info[e].name) || e); if (c) id = c.id; }
      const key = id || e; if (!out.includes(key)) out.push(key);
      if (key !== e && info[e] && !info[key]) info[key] = info[e];
    });
    Object.keys(info).forEach(k => { if (!out.includes(k)) delete info[k]; });
    out.forEach(k => { const c = chById(k), cur = info[k] || {}; info[k] = Object.assign({}, cur, { name: c ? c.name : (cur.name || k), tags: Array.isArray(cur.tags) ? cur.tags : [] }); });
    sc.postedChannels = out; sc.postedInfo = info; if (!Array.isArray(sc.tags)) sc.tags = [];
  }
  function setPosted(sc, chId, on, tags) {
    if (!Array.isArray(sc.postedChannels)) sc.postedChannels = []; if (!sc.postedInfo) sc.postedInfo = {};
    if (on) {
      if (!sc.postedChannels.includes(chId)) sc.postedChannels.push(chId);
      const c = chById(chId), prev = sc.postedInfo[chId] || {};
      sc.postedInfo[chId] = { name: c ? c.name : (prev.name || chId), tags: tags ? [...tags] : (prev.tags || []), date: new Date().toISOString() };
    } else { sc.postedChannels = sc.postedChannels.filter(x => x !== chId); delete sc.postedInfo[chId]; }
  }
  const tagKey = n => String(n == null ? '' : n).normalize('NFKC').toLowerCase().replace(/[\s\u3000\u2010-\u2015\u2212\-_・]/g, '');
  const tagFind = (list, name) => { const k = tagKey(name); return k ? [...(list || [])].find(t => tagKey(t) === k) : undefined; };
  const normTagKey = n => String(n == null ? '' : n).normalize('NFKC').trim().toLowerCase();
  const sameTag = (a, b) => { const k = tagKey(a); return k !== '' && k === tagKey(b); };
  function mergeTagNames(...lists) {
    const out = [], seen = new Set();
    lists.forEach(l => [...(l || [])].forEach(n => {
      const s = String(n == null ? '' : n).trim(), k = tagKey(s);
      if (k && !seen.has(k)) { seen.add(k); out.push(s); }
    }));
    return out;
  }
  const chTagFor = (ch, name) => { const k = tagKey(name); return k ? (ch && ch.tags || []).find(t => t && tagKey(t.name) === k) : undefined; };
  function chTagsActive(ch, names) { const keys = new Set([...(names || [])].map(tagKey)); return (ch && ch.tags || []).filter(t => t && t.name && keys.has(tagKey(t.name))); }
  function tagsForChannel(ch) { return chTagsActive(ch, activeTagNames).map(t => t.name); }
  const DEFAULT_TAG_SYS = ['CoC6版', 'CoC7版', 'エモクロア', 'インセイン', 'シノビガミ', 'マダミス', 'SW2.5', 'DX3rd'];
  const DEFAULT_TAG_PPL = ['ソロ', 'タイマン', '2PL', '3PL', '4PL', '5PL', '6PL'];
  const DEFAULT_TAG_ETC = ['新規', '継続', '秘匿HO', 'R18', 'R18-G', 'うちよそ', '高ロスト', '低ロスト', 'CPシナリオ', 'SAN値回復', 'タイマン改変可', '戦闘あり', 'PVP可能性あり', '周回可', 'KPCあり', 'クローズド', 'シティ', 'クラシック', 'キャンペーン'];
  const DEFAULT_TAG_PRESETS = [...DEFAULT_TAG_SYS, ...DEFAULT_TAG_PPL, ...DEFAULT_TAG_ETC];
  const TAG_GROUP_DEFS = [['sys', '🎲 システム'], ['ppl', '👥 人数'], ['etc', '🏷️ 傾向・その他']];
  const PRESET_SYS_SET = new Set(DEFAULT_TAG_SYS);
  const PRESET_PPL_SET = new Set(DEFAULT_TAG_PPL);
  const PRESET_ETC_SET = new Set(DEFAULT_TAG_ETC);
  const SYSTEM_TAG_KNOWN = new Set(['CoC', 'CoC6版', 'CoC7版', 'CoC6版/7版', 'CoC6版 (7版対応可)', 'CoC7版 (6版対応可)', 'インセイン', 'エモクロア', 'シノビガミ', 'SW', 'SW2.5', 'ダブルクロス', 'DX3rd', 'ストリテラ', 'フタリソウサ', 'ネクロニカ', 'ケダモノオペラ', 'ナイトウィザード', 'マーダーミステリー', 'マダミス', 'アリアンロッド', 'ブレイド・オブ・アルカナ', 'ゴブリンスレイヤー', 'ガープス', 'トーキョーN◎VA', 'パラノイア', 'ログ・ホライズン']);
  const SYS_NAME_RE = /coc|クトゥルフ|クトゥルー|cthulhu|エモクロア|インセイン|シノビガミ|マダミス|マーダーミステリー|ダブルクロス|ソード・?ワールド|\bSW\b|\bDX\b|ストリテラ|フタリソウサ|ケダモノオペラ|ナイトウィザード|ガープス|アリアンロッド|ブレイド・?オブ・?アルカナ|ネクロニカ|サタスペ|ゆうやけ|アルシャード|メタリックガーディアン|フィアスコ|ログ・?ホライズン|トーキョーn◎va|ビーストバインド|ゴブリンスレイヤー|パラノイア/i;
  const PLAYER_TAG_RE = /^(\d{1,2}PL|ソロ|タイマン)$/i;
  function tagGroupOf(t, sysSet) {
    const s = String(t == null ? '' : t).normalize('NFKC').trim();
    if (!s) return 'etc';
    if (PRESET_ETC_SET.has(s) || /^(?:タイマン改変可|KPCあり)$/i.test(s) || /kpc|npc/i.test(s)) return 'etc';
    if ((sysSet && (sysSet.has(s) || sysSet.has(tagKey(s)))) || PRESET_SYS_SET.has(s) || SYSTEM_TAG_KNOWN.has(s) || /^CoC/i.test(s) || SYS_NAME_RE.test(s)) return 'sys';
    if (/改変/i.test(s)) return 'etc';
    if (PRESET_PPL_SET.has(s) || PLAYER_TAG_RE.test(s) || /人|ソロ|タイマン|ペア|サシ|1on1/i.test(s) || /(?:^|[^a-z])(?:pl|pc)(?:[^a-z]|$)/i.test(s)) return 'ppl';
    return 'etc';
  }
  const tagSortNum = (a, b) => {
    const r = s => { const t = String(s).normalize('NFKC'); if (/ソロ/.test(t)) return [0, 0]; if (/タイマン|サシ|1on1/.test(t)) return [1, 0]; const m = /(\d+)/.exec(t); return m ? [2, +m[1]] : [3, 0]; };
    const x = r(a), y = r(b);
    return x[0] - y[0] || x[1] - y[1] || String(a).localeCompare(String(b), 'ja');
  };
  function rawSystemKeys() {
    const s = new Set();
    (appState.scenarios || []).forEach(sc => {
      (sc.autoSystemTags || []).forEach(t => { if (t) { s.add(t); s.add(tagKey(t)); } });
      if (sc.system) {
        const list = typeof deriveSystemTags === 'function' ? deriveSystemTags(sc.system) : [deriveSystemTag(sc.system)];
        list.forEach(d => { if (d) { s.add(d); s.add(tagKey(d)); } });
      }
    });
    return s;
  }
  const allTagNames = extra => mergeTagNames(appState.tagPresets, (appState.channels || []).flatMap(c => (c.tags || []).map(t => t && t.name)), (appState.scenarios || []).flatMap(s => s.tags || []), appState.customTags, extra);
  function addTagPreset(name) {
    const s = String(name == null ? '' : name).trim().replace(/^#+/, '').trim().slice(0, 40);
    if (!s) return '';
    const ex = tagFind(allTagNames(), s);
    if (ex) {
      if (!Array.isArray(appState.tagPresets)) appState.tagPresets = [...DEFAULT_TAG_PRESETS];
      if (!tagFind(appState.tagPresets, ex)) appState.tagPresets.push(ex);
      return ex;
    }
    if (!Array.isArray(appState.tagPresets)) appState.tagPresets = [...DEFAULT_TAG_PRESETS];
    appState.tagPresets.push(s);
    return s;
  }
  const PLAY_STATUS_LIST = [
    { value: '', label: '未設定', badge: '', cls: '' },
    { value: 'unplayed', label: '未通過', badge: '🎯 未通過', cls: 'ps-unplayed' },
    { value: 'planned', label: '通過予定', badge: '📅 通過予定', cls: 'ps-planned' },
    { value: 'played', label: '通過済', badge: '✅ 通過済', cls: 'ps-played' },
    { value: 'can_gm', label: '回せる', badge: '🎲 回せる', cls: 'ps-can-gm' },
    { value: 'stacked', label: '積んでいる', badge: '📚 積んでいる', cls: 'ps-stacked' }
  ];
  const PLAY_STATUS_MAP = Object.fromEntries(PLAY_STATUS_LIST.map(p => [p.value, p]));
  function normalizePlayStatus(v) { return (v && PLAY_STATUS_MAP[v]) ? v : ''; }
  function clampThumbNum(v, min, max, def) { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def; }
  function extractUrlsFromText(text) {
    const out = [], seen = new Set();
    const matches = String(text || '').match(/https?:\/\/[^\s<>"'「」『』【】（）()、。]+/gi) || [];
    matches.forEach(raw => {
      const u = safeUrl(raw.replace(/[.,;:!?)\]」』、。]+$/, ''));
      if (u && !seen.has(u)) { seen.add(u); out.push(u); }
    });
    return out;
  }
  function classifyExternalUrl(url, isShop) {
    const u = safeUrl(url);
    if (!u) return null;
    let host = '';
    try { host = new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); } catch (_) {}
    if (/booth\.pm$/i.test(host) || /\.booth\.pm$/i.test(host)) return { url: u, icon: '🛍️', label: 'BOOTH', kind: 'booth' };
    if (/talto\.cc$/i.test(host)) return { url: u, icon: '📘', label: 'TALTO', kind: 'talto' };
    if (/pixiv\.net$/i.test(host)) return { url: u, icon: '🎨', label: 'Pixiv', kind: 'pixiv' };
    if (/^(x\.com|twitter\.com|mobile\.twitter\.com)$/i.test(host)) return { url: u, icon: '𝕏', label: 'X', kind: 'x' };
    if (/^(youtube\.com|m\.youtube\.com|youtu\.be)$/i.test(host)) return { url: u, icon: '▶️', label: 'YouTube', kind: 'yt' };
    if (/ccfolia\.com$/i.test(host)) return { url: u, icon: '🎲', label: 'ココフォリア', kind: 'ccf' };
    if (/^(drive\.google\.com|docs\.google\.com)$/i.test(host)) return { url: u, icon: '📁', label: 'Google Drive', kind: 'gdrive' };
    return { url: u, icon: '🔗', label: isShop ? 'ショップを開く' : (host || 'リンク'), kind: 'link' };
  }
  function collectScenarioLinks(sc) {
    if (!sc) return [];
    const seen = new Set(), out = [];
    const push = (url, isShop) => {
      const info = classifyExternalUrl(url, isShop);
      if (info && !seen.has(info.url)) { seen.add(info.url); out.push(info); }
    };
    if (sc.shopUrl) push(sc.shopUrl, true);
    extractUrlsFromText(sc.notes).forEach(u => push(u, false));
    extractUrlsFromText(sc.trailer).forEach(u => push(u, false));
    return out;
  }
  function linkifyTextHtml(text) {
    const src = String(text == null ? '' : text);
    const re = /https?:\/\/[^\s<>"'「」『』【】（）()、。]+/gi;
    let out = '', last = 0, m;
    while ((m = re.exec(src)) !== null) {
      out += escapeHTML(src.slice(last, m.index));
      const cleaned = m[0].replace(/[.,;:!?)\]」』、。]+$/, '');
      const tail = m[0].slice(cleaned.length);
      const u = safeUrl(cleaned);
      if (u) out += `<a href="${escapeHTML(u)}" target="_blank" rel="noopener noreferrer" class="sd-inline-link">${escapeHTML(cleaned)}</a>${escapeHTML(tail)}`;
      else out += escapeHTML(m[0]);
      last = m.index + m[0].length;
    }
    out += escapeHTML(src.slice(last));
    return out;
  }

  // ===== 検索（全角/半角・大文字小文字・ひらがな/カタカナを区別しない。スペース区切りはAND） =====
  const normSearch = s => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const parseQuery = s => normSearch(s).split(/\s+/).filter(Boolean);
  function scenarioHaystack(sc) {
    const inf = sc.postedInfo || {};
    const ps = PLAY_STATUS_MAP[normalizePlayStatus(sc.playStatus)];
    const customTxt = Array.isArray(sc.customSpecs) ? sc.customSpecs.map(c => c ? ((c.label || '') + ' ' + (c.value || '')) : '').join(' ') : '';
    return normSearch([sc.title, sc.system, sc.playerCount, sc.playTime, sc.reqSkills, sc.recSkills, sc.semiRecSkills, sc.lostRate, sc.aftereffect, customTxt, sc.trailer, sc.notes, sc.shopUrl, ps ? ps.label : '',
      ...(sc.tags || []), ...(sc.postedChannels || []).map(id => postedLabel(sc, id)), ...Object.values(inf).flatMap(i => (i && i.tags) || [])].join('\n'));
  }
  function matchQuery(sc, terms) { if (!terms.length) return true; const h = scenarioHaystack(sc); return terms.every(t => h.includes(t)); }
  function renderDBChannelFilter() {   // チャンネル別「投稿済み/未投稿」絞り込みの選択肢（チャンネル設定が変わったときだけ作り直す）
    const sel = document.getElementById('dbFilterChannel'); if (!sel) return;
    const sig = appState.channels.map(c => c.id + ':' + c.name).join('|'); if (sel.dataset.sig === sig) return;
    const cur = sel.value; sel.dataset.sig = sig; sel.innerHTML = '';
    sel.appendChild(new Option('すべてのチャンネル', ''));
    appState.channels.forEach(c => sel.appendChild(new Option(`✓ ${c.name} に投稿済み`, 'y:' + c.id)));
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
  }
  function threadLinksHtml(h) {
    const links = Object.assign({}, h.threadLinks || {}); Object.entries(h.threads || {}).forEach(([n, tid]) => { if (!links[n]) { const c = chByName(n); if (c && c.guildId) links[n] = `https://discord.com/channels/${c.guildId}/${tid}`; } });
    const a = Object.entries(links).filter(([n, u]) => safeUrl(u)).map(([n, u]) => `<a href="${escapeHTML(safeUrl(u))}" target="_blank" rel="noopener noreferrer" style="color:var(--dc-accent);">${escapeHTML(n)}</a>`);
    return a.length ? a.join(' / ') : '-';
  }
  // ===== 取り込みデータ（バックアップ／クラウド／下書き）の検証・正規化 =====
  const BLOCK_TYPES = new Set(['text', 'textarea', 'url', 'split', 'image', 'summary_container']);
  const DECOR_STYLES = ['default', 'simple', 'fancy', 'codeblock', 'none'];
  const _s = v => (v == null ? '' : String(v));
  function sanitizeBlock(b) {
    if (!b || typeof b !== 'object') return null;
    if (!BLOCK_TYPES.has(b.type)) b.type = 'text';   // <input type="..."> に未検証の値が入らないようにする
    b.id = _s(b.id); b.label = _s(b.label);
    if (b.keyName != null) b.keyName = _s(b.keyName);
    if (b.decorStyle && !isDecorStyle(b.decorStyle)) b.decorStyle = 'default';
    if (b.file && !(b.file instanceof Blob)) b.file = null;
    if (b.type === 'summary_container') {
      b.items = (Array.isArray(b.items) ? b.items : []).filter(i => i && typeof i === 'object').map(i => ({ keyName: _s(i.keyName), val: _s(i.val), ...(FLAT_FIELDS.includes(i.field) ? { field: i.field } : {}), ...(i.customId ? { customId: _s(i.customId) } : {}) }));
      b.freeText = _s(b.freeText);
    } else if (b.type === 'image') { b.previewUrl = _s(b.previewUrl); }
    else if (b.type !== 'split') { b.val = _s(b.val); if (Array.isArray(b.subItems)) b.subItems = b.subItems.filter(o => o && typeof o === 'object').map(o => ({ title: _s(o.title), val: _s(o.val), style: o.style === 'bold' ? 'bold' : 'plain' })); }
    return b;
  }
  const sanitizeBlocks = arr => (Array.isArray(arr) ? arr : []).map(sanitizeBlock).filter(Boolean);
  function resolveBlobUrlReplacement(v, opts) {
    if (typeof v !== 'string' || !/^blob:/i.test(v.trim())) return { changed: false, val: v };
    if (!(opts && opts.forceClear) && typeof imgUrlToHash !== 'undefined' && imgUrlToHash && typeof imgUrlToHash.get === 'function') {
      const h = imgUrlToHash.get(v);
      if (h) return { changed: true, val: '@img:' + h };
    }
    return { changed: true, val: '' };
  }
  function cleanBlobStringsInTree(node, opts) {
    if (!node || typeof node !== 'object') return false;
    let changed = false;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (typeof v === 'string') {
          const r = resolveBlobUrlReplacement(v, opts);
          if (r.changed) { node[i] = r.val; changed = true; }
        } else if (v && typeof v === 'object') {
          if (cleanBlobStringsInTree(v, opts)) changed = true;
        }
      }
      return changed;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') {
        const r = resolveBlobUrlReplacement(v, opts);
        if (r.changed) { node[k] = r.val; changed = true; }
      } else if (v && typeof v === 'object') {
        if (cleanBlobStringsInTree(v, opts)) changed = true;
      }
    }
    return changed;
  }
  function cleanScenarioBlobUrls(sc, opts) {
    if (!sc || typeof sc !== 'object') return false;
    let changed = false;
    if (typeof sc.imageUrl === 'string') {
      const r = resolveBlobUrlReplacement(sc.imageUrl, opts);
      if (r.changed) { sc.imageUrl = r.val; changed = true; }
    }
    if (Array.isArray(sc.hoverImages)) {
      const next = [];
      let hoverChanged = false;
      for (let i = 0; i < sc.hoverImages.length; i++) {
        const u = sc.hoverImages[i];
        const r = resolveBlobUrlReplacement(u, opts);
        if (r.changed) {
          changed = true;
          hoverChanged = true;
          if (r.val) next.push(r.val);
        } else if (u) {
          next.push(u);
        }
      }
      if (hoverChanged) sc.hoverImages = next;
    }
    if (Array.isArray(sc.images)) {
      sc.images.forEach(im => {
        if (!im || typeof im !== 'object') return;
        ['dataUrl', 'thumbRef', 'path'].forEach(fk => {
          if (typeof im[fk] === 'string') {
            const r = resolveBlobUrlReplacement(im[fk], opts);
            if (r.changed) { im[fk] = r.val; changed = true; }
          }
        });
      });
    }
    ['publicBlocks', 'secretBlocks', 'fullBlockData', 'secretHOs', 'assetCatalog', 'ccfRooms', 'docs', 'blocks'].forEach(key => {
      if (Array.isArray(sc[key]) && cleanBlobStringsInTree(sc[key], opts)) changed = true;
    });
    return changed;
  }
  function cleanStaleBlobUrls(target, opts) {
    if (!target || typeof target !== 'object') return false;
    let changed = false;
    if (Array.isArray(target)) {
      target.forEach(sc => { if (cleanScenarioBlobUrls(sc, opts)) changed = true; });
      return changed;
    }
    if (Array.isArray(target.scenarios)) {
      target.scenarios.forEach(sc => { if (cleanScenarioBlobUrls(sc, opts)) changed = true; });
      if (typeof target.botAvatarData === 'string') {
        const r = resolveBlobUrlReplacement(target.botAvatarData, opts);
        if (r.changed) { target.botAvatarData = r.val; changed = true; }
      }
      if (Array.isArray(target.imageAssets) && cleanBlobStringsInTree(target.imageAssets, opts)) changed = true;
      return changed;
    }
    return cleanScenarioBlobUrls(target, opts);
  }
  window.cleanStaleBlobUrls = cleanStaleBlobUrls;

  // 起動時に読み込んだ保存データの形を整える（旧バージョン・手編集・同期の不具合などで壊れた項目があっても、起動が止まらないように）
  function repairLoadedState(s) {
    if (!s || typeof s !== 'object') return s;
    const objs = a => (Array.isArray(a) ? a : []).filter(x => x && typeof x === 'object' && !Array.isArray(x));
    s.scenarios = objs(s.scenarios); s.channels = objs(s.channels); s.history = objs(s.history);
    const hadBlob = cleanStaleBlobUrls(s, { forceClear: true });
    const r = sanitizeImported(s) || s;
    if (!Array.isArray(r.tagPresets)) r.tagPresets = mergeTagNames(DEFAULT_TAG_PRESETS, r.customTags);
    let hadMojibake = false;
    (r.scenarios || []).forEach(sc => {
      const res = clearScenarioMojibakeFields(sc);
      if (res.cleared) hadMojibake = true;
      if (res.needSynopsisRepair && sc && sc.id) {
        if (!(window.__mojibakeRepairPendingIds instanceof Set)) window.__mojibakeRepairPendingIds = new Set();
        window.__mojibakeRepairPendingIds.add(String(sc.id));
      }
    });
    if (cleanStaleBlobUrls(r, { forceClear: true }) || hadBlob || hadMojibake) {
      setTimeout(() => { try { if (typeof saveState === 'function') saveState(false, { skipDetailEdited: true }); } catch (_) {} }, 0);
    }
    if (hadMojibake && typeof window.repairMojibakeScenariosAsync === 'function') {
      setTimeout(() => { try { void window.repairMojibakeScenariosAsync(); } catch (_) {} }, 500);
    }
    return r;
  }
  function sanitizeImported(o) {
    if (!o || typeof o !== 'object' || !Array.isArray(o.scenarios) || !Array.isArray(o.channels)) return null;
    o.channels = o.channels.filter(c => c && typeof c === 'object').map(c => ({ ...c, id: _s(c.id), name: _s(c.name), webhookUrl: _s(c.webhookUrl).trim(),
      tags: (Array.isArray(c.tags) ? c.tags : []).filter(t => t && typeof t === 'object').map(t => ({ name: _s(t.name), id: _s(t.id).trim() })) }));
    o.scenarios = o.scenarios.filter(x => x && typeof x === 'object').map(x => {
      const out = { ...x };
      ['id', 'title', 'system', 'playerCount', 'playTime', 'shopUrl', 'imageUrl', 'reqSkills', 'recSkills', 'semiRecSkills', 'lostRate', 'aftereffect', 'trailer', 'notes', 'autoReply']
        .forEach(k => { if (k === 'title' || k in out) out[k] = _s(out[k]); });
      if (out.trailer) {
        if (isMojibakeText(out.trailer)) {
          out.trailer = '';
          if (out.id) {
            if (!(window.__mojibakeRepairPendingIds instanceof Set)) window.__mojibakeRepairPendingIds = new Set();
            window.__mojibakeRepairPendingIds.add(String(out.id));
          }
        } else {
          out.trailer = cleanExtractedText(out.trailer, { checkGarbled: true });
        }
      }
      out.postedInfo = (x.postedInfo && typeof x.postedInfo === 'object' && !Array.isArray(x.postedInfo)) ? x.postedInfo : {};
      out.tags = (Array.isArray(x.tags) ? x.tags : []).map(_s); if (Array.isArray(x.secretHOs)) out.secretHOs = sanitizeHOs(x.secretHOs);
      out.postedChannels = (Array.isArray(x.postedChannels) ? x.postedChannels : []).map(_s);
      out.playStatus = normalizePlayStatus(x.playStatus);
      out.thumbPosX = clampThumbNum(x.thumbPosX, 0, 100, 50);
      out.thumbPosY = clampThumbNum(x.thumbPosY, 0, 100, 50);
      out.thumbZoom = clampThumbNum(x.thumbZoom, 25, 250, 100);
      out.thumbFit = (x.thumbFit === 'contain' || (x.thumbSettings && x.thumbSettings.fit === 'contain')) ? 'contain' : 'cover';
      out.spoilerBlur = !!x.spoilerBlur;
      if (Array.isArray(x.specOrder)) out.specOrder = x.specOrder.map(_s).filter(Boolean);
      if (Array.isArray(x.customSpecs)) {
        out.customSpecs = x.customSpecs
          .filter(c => c && typeof c === 'object')
          .map(c => ({ id: _s(c.id), label: _s(c.label), value: _s(c.value) }))
          .filter(c => c.id);
      }
      out.hoverImages = (Array.isArray(x.hoverImages) ? x.hoverImages : []).map(_s).filter(Boolean).slice(0, 4);
      if (x.sourcePath != null) out.sourcePath = _s(x.sourcePath);
      out.detailEdited = !!x.detailEdited;
      out.cloudKeepAssets = !!x.cloudKeepAssets;
      const rawImgs = Array.isArray(x.images) ? x.images : [];
      const imgPinMap = new Map(rawImgs.filter(a => a && a.id).map(a => [String(a.id), !!a.cloudAlwaysCarry]));
      out.imageCategories = sanitizeCats(x.imageCategories, DEFAULT_SCENARIO_CATS); out.images = sanitizeAssets(x.images, out.imageCategories); out.docs = sanitizeDocs(x.docs);
      out.images.forEach(a => { if (a && a.id && imgPinMap.get(String(a.id))) a.cloudAlwaysCarry = true; });
      if (Array.isArray(x.assetCatalog)) {
        out.assetCatalog = x.assetCatalog
          .filter(it => it && typeof it === 'object')
          .map(it => ({
            id: _s(it.id),
            name: _s(it.name),
            origName: _s(it.origName || it.name),
            type: _s(it.type || 'image'),
            category: _s(it.category),
            thumbRef: _s(it.thumbRef),
            cloudSha: _s(it.cloudSha),
            tags: Array.isArray(it.tags) ? it.tags.map(_s).filter(Boolean) : []
          }));
      }
      if (Array.isArray(x.fullBlockData)) out.fullBlockData = sanitizeBlocks(x.fullBlockData);
      if (Array.isArray(x.publicBlocks)) out.publicBlocks = sanitizeBlocks(x.publicBlocks);
      if (Array.isArray(x.ccfRooms)) { out.ccfRooms = x.ccfRooms; out.ccfActiveRoomId = x.ccfActiveRoomId || (x.ccfRooms[0] ? x.ccfRooms[0].id : null); }
      return out;
    });
    o.history = (Array.isArray(o.history) ? o.history : []).filter(h => h && typeof h === 'object');
    o.formats = sanitizeFormats(o.formats);
    if (Array.isArray(o.tagPresets)) o.tagPresets = mergeTagNames(o.tagPresets); else delete o.tagPresets;
    o.customTags = (Array.isArray(o.customTags) ? o.customTags : []).map(_s).filter(Boolean);
    const rawCommon = Array.isArray(o.imageAssets) ? o.imageAssets : [];
    const commonPinMap = new Map(rawCommon.filter(a => a && a.id).map(a => [String(a.id), !!a.cloudAlwaysCarry]));
    o.imageCategories = sanitizeCats(o.imageCategories, DEFAULT_COMMON_CATS); o.imageAssets = sanitizeAssets(o.imageAssets, o.imageCategories);
    o.imageAssets.forEach(a => { if (a && a.id && commonPinMap.get(String(a.id))) a.cloudAlwaysCarry = true; });
    if (Array.isArray(o.ccfCutinPackages)) o.ccfCutinPackages = o.ccfCutinPackages.filter(p => p && typeof p === 'object');
    if (Array.isArray(o.unlinkedCcfRooms)) { o.unlinkedCcfRooms = o.unlinkedCcfRooms; o.unlinkedCcfActiveRoomId = o.unlinkedCcfActiveRoomId || (o.unlinkedCcfRooms[0] ? o.unlinkedCcfRooms[0].id : null); }
    if (o.watchFolders && typeof o.watchFolders === 'object' && !Array.isArray(o.watchFolders)) {
      o.watchFolders = { commonRoot: _s(o.watchFolders.commonRoot), scenarioRoot: _s(o.watchFolders.scenarioRoot) };
    }
    if (o.cloudSettings && typeof o.cloudSettings === 'object' && !Array.isArray(o.cloudSettings)) {
      o.cloudSettings = sanitizeCloudSettings(o.cloudSettings);
    }
    if (!o.deletedScenarios || typeof o.deletedScenarios !== 'object' || Array.isArray(o.deletedScenarios)) o.deletedScenarios = {};
    if (!o.deletedChannels || typeof o.deletedChannels !== 'object' || Array.isArray(o.deletedChannels)) o.deletedChannels = {};
    cleanStaleBlobUrls(o, { forceClear: true });
    if (typeof normalizeAllScenariosSystemData === 'function') normalizeAllScenariosSystemData(o);
    return o;
  }
  function createDefaultBlocks() {
    return [
    { 
      id: 'summary_container', type: 'summary_container', label: 'シナリオ概要 (まとめブロック)', keyName: 'シナリオ概要', sectionType: 'summary_container', collapsed: true, isCustom: false, decorStyle: 'default',
      items: [
        { keyName: 'システム', val: '', field: 'system' }, { keyName: '人数', val: '', field: 'playerCount' }, { keyName: 'プレイ時間', val: '', field: 'playTime' },
        { keyName: '必須技能', val: '', field: 'reqSkills' }, { keyName: '推奨技能', val: '', field: 'recSkills' }, { keyName: '準推奨技能', val: '', field: 'semiRecSkills' },
        { keyName: 'ロスト率', val: '', field: 'lostRate' }, { keyName: '後遺症', val: '', field: 'aftereffect' }
      ],
      freeText: ''
    },
    { id: 'intro', type: 'textarea', label: 'イントロダクション', keyName: 'イントロダクション', val: '', sectionType: 'standalone', collapsed: true, isCustom: true, decorStyle: 'default' },
    { id: 'notes', type: 'textarea', label: '注意事項・備考', keyName: '注意事項・備考', val: '', sectionType: 'standalone', collapsed: true, isCustom: false, decorStyle: 'default' }
  ];
  }
  let blockOrder = createDefaultBlocks();
  const FLAT_MAP = { 'システム':'system','人数':'playerCount','プレイ時間':'playTime','必須技能':'reqSkills','推奨技能':'recSkills','準推奨技能':'semiRecSkills','ロスト率':'lostRate','後遺症':'aftereffect' };   // 概要ブロックの項目名 ⇔ シナリオの項目名

  // ===== シナリオのデータ構造：fullBlockData（ブロック）を正とし、system/playerCount/notes/imageUrl などのフラット項目は =====
  // ===== 検索・一覧表示用の派生値（deriveFlat で作り直す）。title/shopUrl/trailer/tags/autoReply はブロック外の本体データ。 =====
  const FLAT_FIELDS = Object.values(FLAT_MAP);
  const FIELD_LABEL = Object.fromEntries(Object.entries(FLAT_MAP).map(([k, f]) => [f, k]));
  const findSummaryItem = (sum, f) => sum && Array.isArray(sum.items) && sum.items.find(i => i && (i.field === f || FLAT_MAP[i.keyName] === f || i.keyName === FIELD_LABEL[f]));
  function firstLineText(val) {
    return String(val == null ? '' : val).split(/\r?\n/)[0].trim();
  }
  function findSummaryItemInBlocks(blocks, f, customId, customLabel) {
    if (!Array.isArray(blocks)) return null;
    const sum = blocks.find(b => b && b.type === 'summary_container' && Array.isArray(b.items));
    if (!sum) return null;
    if (customId || customLabel) {
      return sum.items.find(i => i && ((customId && i.customId === customId) || (customLabel && i.keyName === customLabel))) || null;
    }
    return findSummaryItem(sum, f) || null;
  }
  function getScenarioSpecFullVal(sc, f, customSpec) {
    if (!sc || typeof sc !== 'object') return '';
    const cid = customSpec && customSpec.id;
    const clbl = customSpec && customSpec.label;
    const pubIt = findSummaryItemInBlocks(sc.publicBlocks, f, cid, clbl);
    const fullIt = findSummaryItemInBlocks(sc.fullBlockData, f, cid, clbl);
    const flatVal = customSpec ? _s(customSpec.value) : _s(sc[f]);
    const flatTrim = flatVal.trim();
    for (const it of [pubIt, fullIt]) {
      if (it && typeof it.val === 'string' && /\r?\n/.test(it.val)) {
        const line1 = firstLineText(it.val);
        const collapsed = it.val.replace(/\s*\r?\n\s*/g, ' ').trim();
        const collapsedNoSpace = it.val.replace(/\s*\r?\n\s*/g, '').trim();
        if (!flatTrim || flatTrim === it.val.trim() || flatTrim === collapsed || flatTrim === collapsedNoSpace || flatTrim === line1 || (!/\r?\n/.test(flatTrim) && line1 && flatTrim.startsWith(line1))) {
          return it.val;
        }
      }
    }
    if (flatTrim) return flatVal;
    if (pubIt && _s(pubIt.val).trim()) return _s(pubIt.val);
    if (fullIt && _s(fullIt.val).trim()) return _s(fullIt.val);
    return '';
  }
  function getScenarioSpecFirstLine(sc, f, customSpec) {
    return firstLineText(getScenarioSpecFullVal(sc, f, customSpec));
  }
  function mergeSpecFirstLine(prevFullVal, newFirstLine) {
    const first = firstLineText(newFirstLine);
    const lines = String(prevFullVal == null ? '' : prevFullVal).split(/\r?\n/);
    if (lines.length <= 1) return first;
    const rest = lines.slice(1).join('\n');
    if (!first && !rest.trim()) return '';
    return first + '\n' + rest;
  }
  window.firstLineText = firstLineText;
  window.findSummaryItemInBlocks = findSummaryItemInBlocks;
  window.getScenarioSpecFullVal = getScenarioSpecFullVal;
  window.getScenarioSpecFirstLine = getScenarioSpecFirstLine;
  window.mergeSpecFirstLine = mergeSpecFirstLine;

  function tagSummaryFields(blocks) {   // 概要項目に、項目名の変更に影響されない固定キー(field)を付ける
    (blocks || []).forEach(b => {
      if (!b || b.type !== 'summary_container' || !Array.isArray(b.items)) return;
      const used = new Set(b.items.map(i => i && i.field).filter(Boolean));
      b.items.forEach(it => { const f = it && FLAT_MAP[it.keyName]; if (it && !it.field && f && !used.has(f)) { it.field = f; used.add(f); } });
    });
  }
  function syncPublicAndFullBlocks(sc) {
    if (!sc || typeof sc !== 'object') return;
    const hasFull = Array.isArray(sc.fullBlockData) && sc.fullBlockData.length > 0;
    const hasPub = Array.isArray(sc.publicBlocks) && sc.publicBlocks.length > 0;
    if (!hasFull && hasPub) {
      sc.fullBlockData = sanitizeBlocks(JSON.parse(JSON.stringify(sc.publicBlocks)));
    } else if (hasFull && hasPub) {
      tagSummaryFields(sc.fullBlockData);
      tagSummaryFields(sc.publicBlocks);
      const fullSum = sc.fullBlockData.find(b => b && b.type === 'summary_container' && Array.isArray(b.items));
      const pubSum = sc.publicBlocks.find(b => b && b.type === 'summary_container' && Array.isArray(b.items));
      if (fullSum && pubSum) {
        pubSum.items.forEach(pIt => {
          if (!pIt) return;
          const f = pIt.field || FLAT_MAP[pIt.keyName];
          const match = f
            ? findSummaryItem(fullSum, f)
            : fullSum.items.find(x => x && ((pIt.customId && x.customId === pIt.customId) || (pIt.keyName && x.keyName === pIt.keyName)));
          if (!match) {
            fullSum.items.push({ ...pIt });
          } else if (pIt.val && (!match.val || (/\r?\n/.test(pIt.val) && !/\r?\n/.test(match.val) && firstLineText(pIt.val) === firstLineText(match.val)))) {
            match.val = pIt.val;
          }
        });
        if (pubSum.freeText && !fullSum.freeText) fullSum.freeText = pubSum.freeText;
      }
      sc.publicBlocks.forEach(pb => {
        if (!pb || pb.type === 'summary_container' || pb.type === 'split') return;
        const kn = String(pb.keyName || pb.label || '').trim();
        const match = sc.fullBlockData.find(fb => fb && fb.type !== 'summary_container' && ((pb.id && fb.id === pb.id) || (kn && String(fb.keyName || fb.label || '').trim() === kn)));
        if (!match) {
          sc.fullBlockData.push(JSON.parse(JSON.stringify(pb)));
        } else {
          if (!String(match.val || '').trim() && String(pb.val || '').trim()) match.val = pb.val;
          if ((!Array.isArray(match.subItems) || !match.subItems.length) && Array.isArray(pb.subItems) && pb.subItems.length) {
            match.subItems = JSON.parse(JSON.stringify(pb.subItems));
          }
        }
      });
    }
  }
  function writeFlatToBlocks(sc, create) {   // フラット項目の値をブロックへ反映（create=true なら無い概要項目は追加）
    if (sc && typeof sc === 'object' && typeof normalizeSystemName === 'function' && sc.system) {
      sc.system = normalizeSystemName(sc.system);
    }
    syncPublicAndFullBlocks(sc);
    const blocks = sc.fullBlockData, sum = blocks.find(b => b.type === 'summary_container');
    if (sum) {
      FLAT_FIELDS.forEach(f => {
        let v = getScenarioSpecFullVal(sc, f);
        if (f === 'system' && typeof normalizeSystemName === 'function') v = normalizeSystemName(v);
        const it = findSummaryItem(sum, f);
        if (it) it.val = v; else if (create && v.trim()) sum.items.push({ keyName: FIELD_LABEL[f], val: v, field: f });
      });
      if (Array.isArray(sc.customSpecs)) {
        sc.customSpecs.forEach(cs => {
          if (!cs || !cs.id) return;
          const v = getScenarioSpecFullVal(sc, '', cs);
          const it = sum.items.find(i => i && (i.customId === cs.id || (!i.field && !FLAT_MAP[i.keyName] && i.keyName === cs.label)));
          if (it) { it.keyName = _s(cs.label || it.keyName); it.val = v; it.customId = cs.id; }
          else if (create && (cs.label || v)) sum.items.push({ keyName: _s(cs.label || '項目'), val: v, customId: cs.id });
        });
      }
    }
    const notes = blocks.find(b => b.id === 'notes' || (b.keyName && /^(?:注意事項・備考|注意事項|備考)$/.test(String(b.keyName).trim())));
    if (notes && _s(sc.notes)) notes.val = _s(sc.notes);
    else if (notes && sc.notes === '') notes.val = '';
    const img = blocks.find(b => b.type === 'image');
    if (img) { img.previewUrl = _s(sc.imageUrl); img.file = null; }
    else if (sc.imageUrl) blocks.push({ id: 'img_' + Date.now(), type: 'image', label: '画像添付', file: null, previewUrl: sc.imageUrl, sectionType: 'image', collapsed: true, isCustom: true });
    if (Array.isArray(sc.publicBlocks)) {
      sc.publicBlocks = sanitizeBlocks(JSON.parse(JSON.stringify(sc.fullBlockData)));
    }
  }
  function ensureScenarioBlocks(sc) {   // ブロックが無い旧データ・手動追加データは、フラット項目からブロックを作る
    syncPublicAndFullBlocks(sc);
    if (Array.isArray(sc.fullBlockData) && sc.fullBlockData.length) { tagSummaryFields(sc.fullBlockData); return sc.fullBlockData; }
    sc.fullBlockData = createDefaultBlocks(); tagSummaryFields(sc.fullBlockData); writeFlatToBlocks(sc, true);
    return sc.fullBlockData;
  }
  function deriveFlat(sc) {   // ブロック → フラット項目（保存のたびにここだけで作る）
    const blocks = ensureScenarioBlocks(sc), sum = blocks.find(b => b.type === 'summary_container');
    FLAT_FIELDS.forEach(f => {
      const it = findSummaryItem(sum, f);
      let v = it ? _s(it.val) : getScenarioSpecFullVal(sc, f);
      if (f === 'system' && typeof normalizeSystemName === 'function') {
        v = normalizeSystemName(v);
        if (it) it.val = v;
      }
      sc[f] = v;
    });
    if (sum && Array.isArray(sum.items)) {
      if (!Array.isArray(sc.customSpecs)) sc.customSpecs = [];
      const nextCustom = [];
      sum.items.forEach((it, idx) => {
        if (!it || it.field || FLAT_MAP[it.keyName]) return;
        const lbl = _s(it.keyName).trim();
        const val = _s(it.val);
        if (!lbl && !val.trim() && !it.customId) return;
        let cid = _s(it.customId).trim();
        let existing = sc.customSpecs.find(c => c && ((cid && c.id === cid) || (!cid && c.label === lbl)));
        if (!cid) cid = (existing && existing.id) || ('cs_' + (idx + 1) + '_' + Math.random().toString(36).slice(2, 6));
        it.customId = cid;
        nextCustom.push({ id: cid, label: lbl || (existing && existing.label) || '項目', value: val });
      });
      sc.customSpecs = nextCustom;
    }
    const notes = blocks.find(b => b.id === 'notes' || (b.keyName && /^(?:注意事項・備考|注意事項|備考)$/.test(String(b.keyName).trim())));
    if (notes) sc.notes = _s(notes.val);
    const img = blocks.find(b => b.type === 'image' && b.previewUrl); if (img) sc.imageUrl = img.previewUrl;
    if (Array.isArray(sc.publicBlocks)) {
      sc.publicBlocks = sanitizeBlocks(JSON.parse(JSON.stringify(sc.fullBlockData)));
    }
    return sc;
  }
  function applyFlatToBlocks(sc) { ensureScenarioBlocks(sc); writeFlatToBlocks(sc, true); deriveFlat(sc); }   // 編集モーダル・手動追加の入力をブロックへ
  function migrateScenarioBlocks(sc) {   // 旧データの一度きりの移行（それまで最後に編集されたフラット項目を優先し、既存項目だけ更新）
    if (Array.isArray(sc.fullBlockData) && sc.fullBlockData.length) { sc.fullBlockData = sanitizeBlocks(sc.fullBlockData); ensureScenarioBlocks(sc); writeFlatToBlocks(sc, false); }
    else ensureScenarioBlocks(sc);
    deriveFlat(sc);
  }

  let sampleScenarios = [
    {
      title: "サンプルシナリオA", system: "サンプルシステム", playerCount: "4人", playTime: "3〜4時間",
      shopUrl: "https://example.com/", imageUrl: "", reqSkills: "必須技能1、必須技能2", recSkills: "推奨技能1、推奨技能2", semiRecSkills: "準推奨技能1、準推奨技能2",
      lostRate: "低", aftereffect: "なし",
      trailer: "これは架空のサンプルシナリオです。\nここにシナリオのあらすじやトレーラー文を入力します。",
      trailerDecor: "default",
      notes: "ここに注意事項や特記事項を入力します。",
      postedChannels: [],
      imageCategories: [...DEFAULT_SCENARIO_CATS]
    }
  ];

  const DEFAULT_CLOUD_SETTINGS = {
    syncFirestoreText: true,
    syncGDriveAssets: true,
    folderSyncEnabled: false,
    localSyncPath: '',
    webDirName: '',
    compressImagesWebp: true,
    uploadScope: 'edited_only',
    gdriveBridgeToken: '',
    gdriveBridgeExpiresAt: 0,
    gdriveBridgeEmail: ''
  };
  function sanitizeCloudSettings(cs) {
    const src = (cs && typeof cs === 'object' && !Array.isArray(cs)) ? cs : {};
    return {
      syncFirestoreText: src.syncFirestoreText !== false,
      syncGDriveAssets: src.syncGDriveAssets !== false,
      folderSyncEnabled: !!src.folderSyncEnabled,
      localSyncPath: _s(src.localSyncPath).trim(),
      webDirName: _s(src.webDirName).trim(),
      compressImagesWebp: src.compressImagesWebp !== false,
      uploadScope: src.uploadScope === 'all' ? 'all' : 'edited_only',
      gdriveBridgeToken: _s(src.gdriveBridgeToken).trim(),
      gdriveBridgeExpiresAt: Number(src.gdriveBridgeExpiresAt) || 0,
      gdriveBridgeEmail: _s(src.gdriveBridgeEmail).trim()
    };
  }
  window.DEFAULT_CLOUD_SETTINGS = DEFAULT_CLOUD_SETTINGS;
  window.sanitizeCloudSettings = sanitizeCloudSettings;

  let appState = {
    botName: "概要投稿Bot", botAvatarData: "",
    formatConfig: { ...defaultFormatConfig },
    tagPresets: [...DEFAULT_TAG_PRESETS],
    channels: [{ name: "サンプル", webhookUrl: "", tags: [{ name: "タグA", id: "" }, { name: "タグB", id: "" }] }],
    scenarios: sampleScenarios, history: [], customTags: [],
    imageCategories: ['未分類', '背景', 'パネル'], imageAssets: [],   // 共通ギャラリー（各シナリオ専用の素材は、シナリオの images / imageCategories）
    ccfCutinPackages: [],
    watchFolders: { commonRoot: '', scenarioRoot: '' },
    cloudSettings: { ...DEFAULT_CLOUD_SETTINGS }
  };

  let selectedChannelCols = new Set();
  let activeTagNames = new Set();
  let dbViewMode = 'card', dbLimit = 60, dbSig = '';
  let currentScenarioId = null;
  window.resetDBViewCache = function () { dbSig = ''; dbLimit = 60; };
  // 互換: 旧名 currentEditingScenarioId
  try { Object.defineProperty(window, 'currentEditingScenarioId', { configurable: true, get: () => currentScenarioId, set: v => { currentScenarioId = v; } }); } catch (_) { }

  
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : ''; }
  function fmtDate(v) { const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString(); }
  const _fu = new WeakMap();
  function revokeFileUrl(f) { if (f && _fu.has(f)) { try { URL.revokeObjectURL(_fu.get(f)); } catch (e) { logSoft('revokeFileUrl', e); } _fu.delete(f); } }
  function fileUrl(f) { if (!_fu.has(f)) _fu.set(f, URL.createObjectURL(f)); return _fu.get(f); }
  function isMojibakeText(rawStr, opts) {
    const s = String(rawStr == null ? '' : rawStr);
    if (!s.trim()) return false;
    if (/\uFFFD/.test(s)) return true;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(s)) return true;
    if (/[\uFFFD].*B$/m.test(s)) return true;
    const hasJp = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(s);
    if (hasJp && /[\uAC00-\uD7AF]/.test(s)) return true;
    const normSpace = s.replace(/[\u00A0\u00B0\u00B1\u00D7\u00F7]/g, ' ');
    if (hasJp && /[\u0080-\u024F]/.test(normSpace)) return true;
    if (opts && opts.checkHiragana === false) return false;
    if (opts && opts.allowUrlOnly && /^(?:https?:\/\/\S+[\s\r\n]*)+$/i.test(s.trim())) return false;
    const bodyChars = s.replace(/[\s\p{P}\p{S}]+/gu, '');
    if (!bodyChars.length) return false;
    const hiraCount = (bodyChars.match(/[\u3041-\u3096]/g) || []).length;
    return (hiraCount / bodyChars.length) < 0.15;
  }
  function isNoteMojibake(rawStr) {
    const s = String(rawStr == null ? '' : rawStr);
    if (!s.trim()) return false;
    if (/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(s)) return true;
    if (s.trim().length < 15 && !/[\uAC00-\uD7AF\u0080-\u024F]/.test(s.replace(/[\u00A0\u00B0\u00B1\u00D7\u00F7]/g, ' ')) && !/B$/m.test(s)) return false;
    return isMojibakeText(s, { allowUrlOnly: true });
  }
  function isGarbageSynopsisText(rawStr) {
    const s = String(rawStr == null ? '' : rawStr).trim();
    if (!s) return false;
    if (isMojibakeText(s)) return true;
    const norm = s.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (/^(?:TRPG|タイトル|開始)(?:\s*[/／|｜・,、\s]+\s*(?:TRPG|タイトル|開始))*$/i.test(norm)) return true;
    if (norm.length <= 24 && /(?:TRPG\s*[/／]\s*タイトル|タイトル\s*[/／]\s*開始)/.test(norm)) return true;
    return false;
  }
  function clearScenarioMojibakeFields(sc) {
    if (!sc || typeof sc !== 'object') return { cleared: false, needSynopsisRepair: false };
    let cleared = false, needSynopsisRepair = false;
    if (typeof sc.trailer === 'string' && isGarbageSynopsisText(sc.trailer)) {
      sc.trailer = '';
      cleared = true;
      needSynopsisRepair = true;
    }
    if (typeof sc.synopsis === 'string' && isGarbageSynopsisText(sc.synopsis)) {
      sc.synopsis = '';
      cleared = true;
      needSynopsisRepair = true;
    }
    if (typeof sc.notes === 'string' && isNoteMojibake(sc.notes)) {
      sc.notes = '';
      cleared = true;
    }
    const cleanBlockArr = arr => {
      if (!Array.isArray(arr)) return;
      arr.forEach(b => {
        if (!b || typeof b !== 'object') return;
        const lbl = String(b.label || b.keyName || b.id || '');
        const isSynBlock = b.id === 'intro' || /あらすじ|概要|トレーラー|イントロ|synopsis|trailer|intro/i.test(lbl);
        const isNoteBlock = b.id === 'notes' || /備考|注意|メモ|notes/i.test(lbl);
        const checkFn = isSynBlock ? (v => isGarbageSynopsisText(v)) : (isNoteBlock ? isNoteMojibake : (v => isMojibakeText(v, { allowUrlOnly: true })));
        if (typeof b.val === 'string' && b.val && (isSynBlock || isNoteBlock || /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(b.val))) {
          if (checkFn(b.val)) {
            b.val = '';
            cleared = true;
            if (isSynBlock) needSynopsisRepair = true;
          }
        }
        if (typeof b.freeText === 'string' && b.freeText && isGarbageSynopsisText(b.freeText)) {
          b.freeText = '';
          cleared = true;
          if (isSynBlock || b.type === 'summary_container') needSynopsisRepair = true;
        }
        if (Array.isArray(b.subItems)) {
          b.subItems.forEach(si => {
            if (si && typeof si.val === 'string' && si.val && checkFn(si.val)) {
              si.val = '';
              cleared = true;
              if (isSynBlock) needSynopsisRepair = true;
            }
          });
        }
      });
    };
    cleanBlockArr(sc.fullBlockData);
    cleanBlockArr(sc.publicBlocks);
    return { cleared, needSynopsisRepair };
  }
  function cleanExtractedText(raw, opts) {
    let s = String(raw == null ? '' : raw).replace(/[\uE000-\uF8FF]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (opts && opts.checkGarbled && isMojibakeText(s)) return '';
    return s.replace(/\uFFFD/g, '');
  }
  function decodeTextBytes(rawBytes) {
    if (typeof rawBytes === 'string') return String(rawBytes).replace(/\r\n?/g, '\n');
    const u8 = rawBytes instanceof Uint8Array ? rawBytes : (rawBytes instanceof ArrayBuffer ? new Uint8Array(rawBytes) : new Uint8Array(rawBytes || []));
    if (!u8.byteLength) return '';
    const normLn = s => String(s || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (u8.byteLength >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      try { return normLn(new TextDecoder('utf-8', { fatal: true }).decode(u8.subarray(3))); } catch (_) { }
      return normLn(new TextDecoder('utf-8').decode(u8.subarray(3)));
    }
    if (u8.byteLength >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
      try { return normLn(new TextDecoder('utf-16le').decode(u8.subarray(2))); } catch (_) { }
    }
    if (u8.byteLength >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
      try { return normLn(new TextDecoder('utf-16be').decode(u8.subarray(2))); } catch (_) { }
    }
    const sampleLen = Math.min(u8.byteLength, 256);
    let oddZeros = 0, evenZeros = 0;
    for (let i = 0; i < sampleLen; i++) {
      if (u8[i] === 0) { if (i % 2 === 1) oddZeros++; else evenZeros++; }
    }
    if (sampleLen >= 8 && oddZeros >= sampleLen / 4) {
      try { return normLn(new TextDecoder('utf-16le').decode(u8)); } catch (_) { }
    }
    if (sampleLen >= 8 && evenZeros >= sampleLen / 4) {
      try { return normLn(new TextDecoder('utf-16be').decode(u8)); } catch (_) { }
    }
    let decoded = '';
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(u8);
      if (!decoded.includes('\uFFFD') && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(decoded)) {
        return normLn(decoded);
      }
    } catch (_) {}
    const tryDec = (enc, fatal) => { try { return new TextDecoder(enc, { fatal: !!fatal }).decode(u8); } catch (_) { return null; } };
    const sjFatal = tryDec('shift-jis', true);
    if (sjFatal != null && !sjFatal.includes('\uFFFD') && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(sjFatal)) {
      return normLn(sjFatal);
    }
    const score = s => s == null ? -1e9 : ((s.match(/[\u3041-\u3096]/g) || []).length * 3 + (s.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || []).length - (s.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) || []).length * 20);
    const cands = [tryDec('shift-jis', false), tryDec('euc-jp', true), decoded || tryDec('utf-8', false)].filter(x => x != null);
    cands.sort((a, b) => score(b) - score(a));
    return normLn(cands[0] || '');
  }
  window.isMojibakeText = isMojibakeText;
  window.isGarbageSynopsisText = isGarbageSynopsisText;
  window.clearScenarioMojibakeFields = clearScenarioMojibakeFields;
  window.cleanExtractedText = cleanExtractedText;
  window.decodeTextBytes = decodeTextBytes;

  async function fetchRetry(url, opts, tries = 3, timeoutMs = 60000) {
    const extSignal = opts && opts.signal;
    for (let t = 0; ; t++) {
      if (extSignal && extSignal.aborted) {
        const err = new Error('Aborted'); err.name = 'AbortError'; throw err;
      }
      const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const onExtAbort = () => { if (ctl) ctl.abort(); };
      if (extSignal && ctl) extSignal.addEventListener('abort', onExtAbort, { once: true });
      const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;   // 応答が返らないまま固まるのを防ぐ
      let res;
      try { res = await fetch(url, ctl ? { ...opts, signal: ctl.signal } : opts); }
      catch (e) {
        if (extSignal && extSignal.aborted) throw e;
        if (t >= tries) throw e;
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      finally {
        if (timer) clearTimeout(timer);
        if (extSignal) extSignal.removeEventListener('abort', onExtAbort);
      }
      if (res.status === 429 && t < tries) {
        let wait = 2000;
        try { const j = await res.clone().json(); wait = Math.ceil((j.retry_after || 2) * 1000) + 200; } catch (e) { logSoft('fetchRetry', e); }
        await new Promise(r => setTimeout(r, wait)); continue;
      }
      return res;
    }
  }
  function renameChannel(i, v) { appState.channels[i].name = v; }   // 投稿済み情報はIDで紐づくので、名前を変えても壊れない
  let draftTimer = null;
  function scheduleDraftSave() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 800); }
  function saveDraft() {
    try {
      const g = id => { const e = document.getElementById(id); return e ? e.value : ''; };
      const d = { title: g('title'), shop: g('topShopUrl'), trailer: g('topTrailer'), decor: g('topTrailerDecor'), reply: g('autoReplyText'),
        vertical: document.getElementById('verticalImageMode').checked, noImage: document.getElementById('noImageMode').checked,
        blocks: blockOrder.map(b => ({ ...b, file: null })),
        channelIds: selectedChannelIds(),
        tags: [...activeTagNames], scenarioId: currentScenarioId, secretHOs: typeof secretHOs !== 'undefined' ? secretHOs : [] };
      window.idbSetRaw('draft', serializeState(d)).catch(e => logSoft('async', e));
    } catch (e) { logSoft('saveDraft', e); }
  }
  async function restoreDraft() {
    try {
      const raw = await window.idbGetRaw('draft'); if (!raw) return;
      const d = JSON.parse(raw); cleanStaleBlobUrls(d, { forceClear: true }); await hydrateRefs(d); const set = (id, v) => { const e = document.getElementById(id); if (e && v !== undefined) e.value = v; };
      set('title', d.title); set('topShopUrl', d.shop); set('topTrailer', d.trailer); set('topTrailerDecor', d.decor || 'default'); set('autoReplyText', d.reply);
      document.getElementById('verticalImageMode').checked = d.vertical !== false; document.getElementById('noImageMode').checked = !!d.noImage;
      if (Array.isArray(d.blocks) && d.blocks.length) { const nb = sanitizeBlocks(d.blocks); if (nb.length) blockOrder = nb; }
      selectedChannelCols = new Set(appState.channels.filter(c => d.channelIds ? d.channelIds.includes(c.id) : (d.channels || []).includes(c.name)).map(c => c.id));
      activeTagNames = new Set(d.tags || []); currentScenarioId = d.scenarioId || null;
      if (Array.isArray(d.secretHOs) && d.secretHOs.length) { secretHOs = sanitizeHOs(d.secretHOs); renderHoAll(); }   // 作業中のHO
    } catch (e) { console.error(e); }
  }

  // ================= 画像ストア（画像は別テーブルにBlobで保存。状態JSONには @img:ID だけ入る） =================


// ================= 人数・システムの実文 → 自動タグ（syncDerivedTagsFromFields）およびシステム名正規化 =================
// sc.playerCount / sc.system から導出したタグを sc.tags に反映し、sc.autoTags（今回付けた自動タグ）に記録する。
// テキストを書き直すと、旧い自動タグだけを外して新しいタグへ付け替える（手動で付けた傾向タグなどは維持）。
const STANDARD_SYSTEM_LIST = [
  'CoC6版',
  'CoC7版',
  'CoC6版/7版',
  'CoC6版 (7版対応可)',
  'CoC7版 (6版対応可)',
  'エモクロア',
  'インセイン',
  'シノビガミ',
  'マダミス',
  'SW2.5',
  'DX3rd',
  'ストリテラ',
  'フタリソウサ',
  'ネクロニカ',
  'ケダモノオペラ',
  'パラノイア',
  'アリアンロッド',
  'ゴブリンスレイヤー'
];
window.STANDARD_SYSTEM_LIST = STANDARD_SYSTEM_LIST;

const SYSTEM_TAG_RULES = [
  [/インセイン/, () => 'インセイン'], [/エモクロア/, () => 'エモクロア'], [/シノビガミ/, () => 'シノビガミ'],
  [/ソード.?ワールド|\bSW\b|SW\s*2/i, s => /2\.?5/.test(s) ? 'SW2.5' : 'SW'], [/ダブルクロス|\bDX\s*3?(?:rd)?\b/i, () => 'DX3rd'],
  [/ストリテラ/, () => 'ストリテラ'], [/フタリソウサ/, () => 'フタリソウサ'], [/ネクロニカ/, () => 'ネクロニカ'], [/ケダモノオペラ/, () => 'ケダモノオペラ'],
  [/ナイトウィザード/, () => 'ナイトウィザード'], [/マーダーミステリー|マダミス/i, () => 'マダミス'], [/アリアンロッド/, () => 'アリアンロッド'],
  [/ブレイド.?オブ.?アルカナ/, () => 'ブレイド・オブ・アルカナ'], [/ゴブリンスレイヤー/, () => 'ゴブリンスレイヤー'], [/ガープス|GURPS/i, () => 'ガープス'],
  [/トーキョーN◎VA|トーキョーNOVA|N◎VA/i, () => 'トーキョーN◎VA'], [/パラノイア/, () => 'パラノイア'], [/ログ・ホライズン|ログホライズン/, () => 'ログ・ホライズン']
];
const toHalfWidth = s => String(s == null ? '' : s).replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

/** システム名を標準表記（CoC系は正式5区分）へ正規化し、誤表記「新CoC7版」を完全に根絶する */
function normalizeSystemName(sys) {
  if (sys == null) return '';
  let raw = String(sys).replace(/新\s*[CcＣｃ][OoＯｏ][CcＣｃ]\s*[7７]\s*版?/g, 'CoC7版');
  if (/\r?\n/.test(raw)) {
    const lines = raw.split(/\r?\n/);
    lines[0] = normalizeSystemName(lines[0]);
    return lines.join('\n');
  }
  let s = raw.trim();
  if (!s) return '';
  const half = toHalfWidth(s).replace(/\s+/g, ' ').trim();
  const isCocWord = /クトゥルフ|クトゥルー|cthulhu|coc/i.test(half) ||
    /^(?:第?\s*[67]\s*版|[67]th)$/i.test(half) ||
    /^(?:6\s*版?\s*[/／・･,&＆]\s*7\s*版?|7\s*版?\s*[/／・･,&＆]\s*6\s*版?)$/i.test(half);
  if (isCocWord) {
    // 括弧内の対応・改変・コンバート表記を先に検査（④ CoC6版 (7版対応可) / ⑤ CoC7版 (6版対応可)）
    const parenMatch = half.match(/^(.+?)[（(]([^）)]+)[）)]\s*$/);
    if (parenMatch) {
      const basePart = parenMatch[1];
      const subPart = parenMatch[2];
      const baseHas7 = /7|新/.test(basePart);
      const baseHas6 = /6|旧/.test(basePart) || (!baseHas7 && /クトゥルフ|クトゥルー|cthulhu|coc/i.test(basePart));
      if (baseHas6 && !baseHas7 && /7/.test(subPart)) return 'CoC6版 (7版対応可)';
      if (baseHas7 && !baseHas6 && /6|旧/.test(subPart)) return 'CoC7版 (6版対応可)';
    }
    if (/6\s*版?\s*(?:ベース|推奨|メイン)?[^/／]*?(?:[（(]?\s*7\s*版\s*(?:対応|改変|コンバート|可|OK|可能)|7\s*版(?:対応|改変|コンバート)可)/i.test(half) && !/7\s*版?\s*[/／・]\s*6\s*版/i.test(half)) {
      return 'CoC6版 (7版対応可)';
    }
    if (/7\s*版?\s*(?:ベース|推奨|メイン)?[^/／]*?(?:[（(]?\s*(?:6\s*版|旧版?)\s*(?:対応|改変|コンバート|可|OK|可能)|(?:6\s*版|旧版?)(?:対応|改変|コンバート)可)/i.test(half) && !/6\s*版?\s*[/／・]\s*7\s*版/i.test(half)) {
      return 'CoC7版 (6版対応可)';
    }
    const has6 = /6\s*版|6th|第\s*6|ver\.?\s*6|coc\s*6(?!\d)|旧\s*coc|旧\s*クトゥルフ|[67]\s*[/／・･,&＆]\s*[67]/i.test(half) || /\b6\b/.test(half);
    const has7 = /7\s*版|7th|第\s*7|ver\.?\s*7|coc\s*7(?!\d)|新\s*クトゥルフ|[67]\s*[/／・･,&＆]\s*[67]/i.test(half) || /\b7\b/.test(half);
    if (has6 && has7) return 'CoC6版/7版';
    if (has7) return 'CoC7版';
    return 'CoC6版';
  }
  if (/^エモクロア(?:TRPG)?$/i.test(half)) return 'エモクロア';
  if (/^(?:マルチジャンル・?ホラーRPG\s*)?インセイン$/i.test(half)) return 'インセイン';
  if (/^(?:忍術バトルRPG\s*)?シノビガミ$/i.test(half)) return 'シノビガミ';
  if (/^(?:マーダーミステリー|マダミス)$/i.test(half)) return 'マダミス';
  if (/^(?:ソード・?ワールド\s*2\.?5|SW\s*2\.?5)$/i.test(half)) return 'SW2.5';
  if (/^(?:ダブルクロス(?:\s*The\s*3rd\s*Edition|\s*3rd)?|DX\s*3(?:rd)?)$/i.test(half)) return 'DX3rd';
  if (/^ストリテラ$/i.test(half)) return 'ストリテラ';
  if (/^フタリソウサ$/i.test(half)) return 'フタリソウサ';
  if (/^(?:永い後日談の)?ネクロニカ$/i.test(half)) return 'ネクロニカ';
  if (/^ケダモノオペラ$/i.test(half)) return 'ケダモノオペラ';
  if (/^パラノイア$/i.test(half)) return 'パラノイア';
  if (/^アリアンロッド(?:\s*RPG|\s*2E)?$/i.test(half)) return 'アリアンロッド';
  if (/^ゴブリンスレイヤー(?:\s*TRPG)?$/i.test(half)) return 'ゴブリンスレイヤー';
  return s;
}
window.normalizeSystemName = normalizeSystemName;

/** システム文字列から自動付与すべきシステムタグ配列を返す
 *  CoC6版 / CoC6版 (7版対応可) -> ['CoC6版']
 *  CoC7版 / CoC7版 (6版対応可) -> ['CoC7版']
 *  CoC6版/7版                 -> ['CoC6版', 'CoC7版'] */
function deriveSystemTags(txt) {
  const line1 = firstLineText(txt);
  const norm = normalizeSystemName(line1);
  const s = toHalfWidth(norm).trim();
  if (!s || /^(未指定|不明|なし|特になし|-|—|－)$/.test(s)) return [];
  if (norm === 'CoC6版' || norm === 'CoC6版 (7版対応可)') return ['CoC6版'];
  if (norm === 'CoC7版' || norm === 'CoC7版 (6版対応可)') return ['CoC7版'];
  if (norm === 'CoC6版/7版') return ['CoC6版', 'CoC7版'];
  if (/クトゥルフ|cthulhu|coc/i.test(s)) {
    const has6 = /6\s*版|6th|第\s*6|ver\.?\s*6|coc\s*6(?!\d)/i.test(s);
    const has7 = /7\s*版|7th|第\s*7|ver\.?\s*7|coc\s*7(?!\d)|新クトゥルフ/i.test(s);
    if (has6 && has7) return ['CoC6版', 'CoC7版'];
    if (has7) return ['CoC7版'];
    return ['CoC6版'];
  }
  for (const [re, fn] of SYSTEM_TAG_RULES) if (re.test(s)) return [fn(s)];
  return [norm.length > 16 ? norm.slice(0, 16) : norm];
}
window.deriveSystemTags = deriveSystemTags;

function deriveSystemTag(txt) {
  const list = deriveSystemTags(txt);
  return list[0] || '';
}
function derivePlayerTags(txt) {
  let s = toHalfWidth(txt).replace(/[（(][^）)]*[）)]/g, ' ').replace(/(GM|KP|KPC|GMC)\s*\d*\s*人?/gi, ' ');
  s = s.replace(/[～~∼–—―−]/g, '〜').replace(/から/g, '〜').replace(/(\d)\s*[-ー]\s*(\d)/g, '$1〜$2');
  const out = [], add = t => { if (t && !out.includes(t)) out.push(t); };
  if (/タイマン/.test(s)) add('タイマン');
  if (/ソロ|1\s*人\s*用/.test(s)) add('ソロ');
  const nums = [];
  s = s.replace(/(\d{1,2})\s*(?:人|PL|pl|名)?\s*〜\s*(\d{1,2})/g, (m, a, b) => { a = +a; b = +b; if (a > b) [a, b] = [b, a]; nums.push([a, Math.min(b, 12)]); return ' '; });
  s.replace(/(\d{1,2})\s*(?:人|PL|pl|名)/g, (m, a) => { nums.push([+a, +a]); return m; });
  if (!nums.length && /^\s*\d{1,2}\s*$/.test(s)) nums.push([+s, +s]);
  nums.forEach(([a, b]) => {
    if (a < 1 || a > 12) return;
    if (a === b) { if (a === 1) add('ソロ'); else add(a + 'PL'); return; }
    if (a === 1) { add('タイマン'); a = 2; }
    for (let n = a; n <= b; n++) add(n + 'PL');
  });
  return out;
}
function deriveTagsFromFields(sc) {
  const sys = deriveSystemTags(sc && sc.system), ppl = derivePlayerTags(sc && sc.playerCount);
  return { system: sys, players: ppl };
}

/** タグ名リスト内の旧CoC表記（新CoC7版、CoC7版/CoC6版 等）を標準タグ（CoC6版 / CoC7版）へクリーンアップ */
function normalizeTagListForSystem(tagList) {
  if (!Array.isArray(tagList)) return [];
  const out = [], push = t => { const v = String(t == null ? '' : t).trim(); if (v && !out.includes(v)) out.push(v); };
  tagList.forEach(rawTag => {
    const t = String(rawTag == null ? '' : rawTag).trim();
    if (!t) return;
    if (/新\s*coc\s*7|クトゥルフ|cthulhu|^coc/i.test(toHalfWidth(t))) {
      const mapped = deriveSystemTags(t);
      if (mapped.length) { mapped.forEach(push); return; }
    }
    push(t.replace(/新\s*[CcＣｃ][OoＯｏ][CcＣｃ]\s*[7７]\s*版?/g, 'CoC7版'));
  });
  return out;
}

/** シナリオ1件の sc.system・概要ブロックのシステム項目・付与タグを正規化する（変更があれば true） */
function normalizeScenarioSystemData(sc) {
  if (!sc || typeof sc !== 'object') return false;
  let changed = false;
  if (typeof sc.system === 'string' && sc.system) {
    const normSys = normalizeSystemName(sc.system);
    if (normSys !== sc.system) { sc.system = normSys; changed = true; }
  }
  [sc.fullBlockData, sc.publicBlocks].forEach(blocks => {
    if (!Array.isArray(blocks)) return;
    const sum = blocks.find(b => b && b.type === 'summary_container' && Array.isArray(b.items));
    if (!sum) return;
    const sysIt = findSummaryItem(sum, 'system');
    if (sysIt && typeof sysIt.val === 'string' && sysIt.val) {
      const normVal = normalizeSystemName(sysIt.val);
      if (normVal !== sysIt.val) { sysIt.val = normVal; changed = true; }
      if (!sc.system && normVal) { sc.system = normVal; changed = true; }
    }
  });
  if (Array.isArray(sc.tags)) {
    const cleanTags = normalizeTagListForSystem(sc.tags);
    if (cleanTags.join('|') !== sc.tags.join('|')) { sc.tags = cleanTags; changed = true; }
  }
  if (Array.isArray(sc.autoTags)) {
    const cleanAuto = normalizeTagListForSystem(sc.autoTags);
    if (cleanAuto.join('|') !== sc.autoTags.join('|')) { sc.autoTags = cleanAuto; changed = true; }
  }
  if (Array.isArray(sc.autoSystemTags)) {
    const cleanAutoSys = normalizeTagListForSystem(sc.autoSystemTags);
    if (cleanAutoSys.join('|') !== sc.autoSystemTags.join('|')) { sc.autoSystemTags = cleanAutoSys; changed = true; }
  }
  return changed;
}
window.normalizeScenarioSystemData = normalizeScenarioSystemData;

function normalizeAllScenariosSystemData(stateObj) {
  const st = stateObj || appState;
  if (!st || typeof st !== 'object') return false;
  let changed = false;
  if (Array.isArray(st.scenarios)) {
    st.scenarios.forEach(sc => {
      if (normalizeScenarioSystemData(sc)) changed = true;
      if (syncDerivedTagsFromFields(sc)) changed = true;
    });
  }
  if (Array.isArray(st.tagPresets)) {
    const cleanPresets = normalizeTagListForSystem(st.tagPresets);
    if (cleanPresets.join('|') !== st.tagPresets.join('|')) { st.tagPresets = cleanPresets; changed = true; }
  }
  if (Array.isArray(st.customTags)) {
    const cleanCustom = normalizeTagListForSystem(st.customTags);
    if (cleanCustom.join('|') !== st.customTags.join('|')) { st.customTags = cleanCustom; changed = true; }
  }
  if (Array.isArray(st.channels)) {
    st.channels.forEach(ch => {
      if (!ch || !Array.isArray(ch.tags)) return;
      ch.tags.forEach(t => {
        if (t && typeof t.name === 'string' && /新\s*coc\s*7/i.test(toHalfWidth(t.name))) {
          t.name = t.name.replace(/新\s*[CcＣｃ][OoＯｏ][CcＣｃ]\s*[7７]\s*版?/g, 'CoC7版');
          changed = true;
        }
      });
    });
  }
  return changed;
}
window.normalizeAllScenariosSystemData = normalizeAllScenariosSystemData;

/** 戻り値: sc.tags を変更したか。force=true で、テキスト未変更でも再判定（手動で外した自動タグも付け直す） */
function syncDerivedTagsFromFields(sc, force) {
  if (!sc || typeof sc !== 'object') return false;
  const normChanged = normalizeScenarioSystemData(sc);
  const sig = String(sc.system || '') + '|' + String(sc.playerCount || '');
  if (!force && !normChanged && Array.isArray(sc.autoTags) && sc.autoTagsSig === sig) return false;
  const d = deriveTagsFromFields(sc), all = [...d.system, ...d.players];
  const old = Array.isArray(sc.autoTags) ? sc.autoTags : [];
  // システム変更時は旧CoC自動タグ（6版/7版の片方が残るケース）も安全に付け替える
  const oldSet = new Set(old);
  if (d.system.length) {
    ['CoC', 'CoC6版', 'CoC7版'].forEach(ct => { if (!d.system.includes(ct)) oldSet.add(ct); });
  }
  const tags = (Array.isArray(sc.tags) ? sc.tags : []).filter(t => !oldSet.has(t));
  all.forEach(t => { if (!tags.includes(t)) tags.push(t); });
  sc.tags = tags; sc.autoTags = all; sc.autoSystemTags = d.system; sc.autoTagsSig = sig;
  return true;
}
function syncAllDerivedTags() {
  if (!appState || !Array.isArray(appState.scenarios)) return false;
  let changed = normalizeAllScenariosSystemData(appState);
  appState.scenarios.forEach(sc => { if (syncDerivedTagsFromFields(sc)) changed = true; });
  if (changed && typeof saveState === 'function') saveState();
  return changed;
}
