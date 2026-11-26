/* ccf_zip_export.js — 「📦 ルームZIP ／ ♟️ 駒ZIP」ココフォリア v1.1.0 形式の書き出し ＋ 差分選択ウィザード
 *  ・出力したい要素（部屋設定・NPC駒・ダミー駒・シーン・盤面オブジェクト）をチェックボックスで選び、ZIP（__data.json ＋ .token ＋ SHA-256 名の素材）にする。
 *  ・組み立て本体は ccf_pkg.js（純粋ロジック）、ZIP の書き込みは main/zip_writer.js（依存ライブラリなし）。
 *  ・素材（立ち絵・背景・BGM）は data URL／ローカルファイル／zipview:／登録素材（assetId）から実体を読み、SHA-256 のファイル名で ZIP 直下に置く。 */
(function () {
  'use strict';
  const isElec = typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON;
  const CCF = window.CCF, M = window.CCFModel, P = window.CCFPkg, { esc, say, S } = CCF;
  const toBytes = ab => typeof Buffer !== 'undefined' ? Buffer.from(ab) : new Uint8Array(ab);
  const baseName = p => {
    if (window.CloudSync && CloudSync.isCloudAssetRef && CloudSync.isCloudAssetRef(p)) {
      const parsed = CloudSync.parseCloudAssetRef(p);
      return (parsed && parsed.name) || 'asset';
    }
    return (window.WebBridge && WebBridge.isAssetRef(p)) ? WebBridge.assetBasename(p) : ((isElec && path) ? path.basename(p) : String(p || '').split(/[\\/]/).pop());
  };
  const zipWriter = () => require(path.join(CCF.APP_DIR, 'ccfolia', 'main', 'zip_writer.js'));
  const ts = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };
  const safeName = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 60) || 'room';
  const exportDir = () => { if (!isElec || !DATA_ROOT) return ''; const d = path.join(DATA_ROOT, 'ccfolia', 'exports'); fs.mkdirSync(d, { recursive: true }); return d; };
  const showItem = p => {
    if (!p) return;
    const ipc = CCF.electron && CCF.electron.ipcRenderer;
    if (ipc && ipc.invoke) { ipc.invoke('ccf:show-item', p).catch(() => { try { shell.showItemInFolder(p); } catch (_) { /* noop */ } }); return; }
    try { shell.showItemInFolder(p); } catch (e) { if (typeof logSoft === 'function') logSoft('showItemInFolder', e); }
  };
  const openFolder = async (dirPath, firstFilePath) => {
    if (!dirPath) return;
    if (typeof shell !== 'undefined' && typeof shell.openPath === 'function') {
      try {
        const err = await shell.openPath(dirPath);
        if (!err) return;
      } catch (_) { /* fall through */ }
    }
    showItem(firstFilePath || dirPath);
  };

  // ---------- 素材の実体を読む ----------
  async function readBlobOrIdb(blobUrl, hash) {
    if (blobUrl && typeof fetch === 'function') {
      try {
        const res = await fetch(blobUrl);
        if (res && res.ok) {
          const ab = await res.arrayBuffer();
          if (ab && ab.byteLength) return { buf: toBytes(ab), mime: res.headers.get('content-type') || '', name: '' };
        }
      } catch (e) { /* fall through */ }
    }
    const dbg = typeof window !== 'undefined' ? window._imgStoreDebug : null;
    const h = hash || (blobUrl && dbg && dbg.imgUrlToHash && dbg.imgUrlToHash.get(blobUrl));
    if (h && typeof idbGet === 'function') {
      try {
        let blob = await idbGet('images', h);
        if (!blob && typeof window.ensureLocalImageByHash === 'function') {
          await window.ensureLocalImageByHash(h);
          blob = await idbGet('images', h);
        }
        if (blob && typeof blob.arrayBuffer === 'function') {
          const ab = await blob.arrayBuffer();
          if (ab && ab.byteLength) return { buf: toBytes(ab), mime: blob.type || '', name: '' };
        }
      } catch (e) { /* noop */ }
    }
    if (!blobUrl && h && dbg && dbg.hashToUrl && typeof fetch === 'function') {
      const u = dbg.hashToUrl.get(h);
      if (u) {
        try {
          const res = await fetch(u);
          if (res && res.ok) {
            const ab = await res.arrayBuffer();
            if (ab && ab.byteLength) return { buf: toBytes(ab), mime: res.headers.get('content-type') || '', name: '' };
          }
        } catch (e) { /* noop */ }
      }
    }
    return null;
  }

  /** 1つの参照（data:／zipview:／zipmem:／idb-asset:／cloud-asset:／http(s)／file:／絶対パス／blob:／@img:）→ { buf, mime, name } 。読めなければ null */
  async function readRef(v) {
    v = String(v || '').trim(); if (!v) return null;
    if (/^data:/i.test(v)) return P.parseDataUrl(v);
    const scIdHint = S && S.key && S.key !== '_default' ? String(S.key) : '';
    if (window.CloudSync && CloudSync.isCloudAssetRef && CloudSync.isCloudAssetRef(v)) {
      try {
        const u8 = await CloudSync.readCloudAssetBytes(v, { download: true, scenarioId: scIdHint });
        const p = CloudSync.parseCloudAssetRef(v);
        const nm = (p && p.name) || 'asset';
        return u8 && u8.length ? { buf: toBytes(u8), mime: (window.WebBridge ? WebBridge.mimeFromName(nm) : ''), name: nm } : null;
      } catch (e) { return null; }
    }
    if (window.WebBridge && WebBridge.isAssetRef(v)) {
      try {
        const u8 = await WebBridge.readAssetBytes(v), nm = WebBridge.assetBasename(v);
        if (u8 && u8.length) return { buf: u8, mime: WebBridge.mimeFromName(nm), name: nm };
      } catch (e) { /* fall through */ }
      if (window.CloudSync && CloudSync.ensureAssetByIdbRef) {
        try {
          const u8c = await CloudSync.ensureAssetByIdbRef(v, { scenarioId: scIdHint }), nm = WebBridge.assetBasename(v);
          if (u8c && u8c.length) return { buf: toBytes(u8c), mime: WebBridge.mimeFromName(nm), name: nm };
        } catch (_) {}
      }
      return null;
    }
    if (/^(?:zipview|zipmem|https?):\/\//i.test(v)) { try { const r = await CCF.zip.readBuffer(v); r.name = decodeURIComponent(v.split('?')[0].split('/').pop() || ''); return r.buf && r.buf.length ? r : null; } catch (e) { return null; } }
    if (/^blob:/i.test(v)) return readBlobOrIdb(v, '');
    if (/^@img:/i.test(v)) return readBlobOrIdb('', v.slice(5).trim());
    if (!isElec || !path || !fs) return null;
    let p = v;
    if (/^file:\/\//i.test(v)) { try { p = require('url').fileURLToPath(v); } catch (e) { return null; } }
    if (!path.isAbsolute(p)) return null;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const buf = fs.readFileSync(p);
        return buf.length ? { buf, mime: '', name: path.basename(p) } : null;
      }
    } catch (e) { /* fall through */ }
    if (window.CloudSync && CloudSync.readByPathOrName) {
      try {
        const u8c = await CloudSync.readByPathOrName(p, { scenarioId: scIdHint });
        if (u8c && u8c.length) return { buf: toBytes(u8c), mime: '', name: path.basename(p) };
      } catch (_) {}
    }
    return null;
  }

  async function readItemRefs(it) {
    if (!it) return null;
    for (const v of [it.path, it.filePath, it.dataUrl, it.url]) {
      const r = await readRef(v);
      if (r) return r;
    }
    return null;
  }

  function collectAssetPool(kind) {
    const pool = [];
    const push = (it, defaultType) => {
      if (!it || typeof it !== 'object') return;
      const tp = it.type || defaultType || '';
      if (kind === 'audio') { if (tp !== 'audio') return; }
      else if (kind === 'video') { if (tp !== 'video') return; }
      else if (kind !== 'any') { if (tp && tp !== 'image') return; }
      pool.push(it);
    };
    (S.proj && Array.isArray(S.proj.refs) ? S.proj.refs : []).forEach(r => push(r, r && r.type));
    if (CCF.assets && CCF.assets.getUnifiedItems) {
      try { (CCF.assets.getUnifiedItems(S.key) || []).forEach(it => push(it, it && it.type)); } catch (e) { /* noop */ }
    }
    if (typeof window !== 'undefined' && window.CommonAssets && typeof window.CommonAssets.getAll === 'function') {
      try { (window.CommonAssets.getAll() || []).forEach(it => push(it, it && it.type)); } catch (e) { /* noop */ }
    }
    const sc = CCF.scenarioList ? CCF.scenarioList().find(x => String(x.id) === String(S.key)) : null;
    if (sc && Array.isArray(sc.images)) sc.images.forEach(img => push(img, 'image'));
    return pool;
  }

  /** 素材の元情報（実パス／dataUrl／blob:／@img:／assetId・assetUid／正規化名逆引き）から実体を探す */
  async function resolveSource(src, kind, owner) {
    if (!src || typeof src !== 'object') return null;
    // ① data: / 絶対パス / file: / zipview: ② blob: / @img:
    for (const v of [src.dataUrl, src.path, src.filePath, src.url]) {
      if (v && !/^(?:blob:|@img:)/i.test(String(v).trim())) {
        const r = await readRef(v);
        if (r) return r;
      }
    }
    for (const v of [src.dataUrl, src.url]) {
      if (v && /^(?:blob:|@img:)/i.test(String(v).trim())) {
        const r = await readRef(v);
        if (r) return r;
      }
    }
    // ③ 登録素材 ID (assetId / assetUid) および 登録素材・sc.images からの正規化名逆引き
    const pool = collectAssetPool(kind || 'image');
    const uid = String(src.assetId || src.assetUid || '').trim();
    if (uid) {
      const hit = pool.find(x => x.uid === uid || String(x.rawId) === uid || String(x.id) === uid || x.uid === 'img:' + uid || x.uid === 'ref:' + uid || 'ref:' + x.id === uid || 'img:' + x.id === uid);
      const r = await readItemRefs(hit);
      if (r) return r;
    }
    const tryByNames = async rawNames => {
      const keys = new Set(rawNames.map(x => P.normName(x)).filter(Boolean));
      if (!keys.size) return null;
      for (const it of pool) {
        const names = [it.name, it.origName, it.label, it.path ? baseName(it.path) : ''];
        if (names.some(n => keys.has(P.normName(n)))) {
          const r = await readItemRefs(it);
          if (r) return r;
        }
      }
      return null;
    };
    const srcHit = await tryByNames([src.name, src.label, src.fileName, src.path ? baseName(src.path) : '']);
    if (srcHit) return srcHit;
    if (owner) {
      const ownerHit = await tryByNames([owner.iconName, owner.npcName]);
      if (ownerHit) return ownerHit;
    }
    return null;
  }

  // ---------- 選択ウィザード ----------
  const W = { el: null, mode: 'room', tab: 'room', bgmPrefixMode: 'scene', busy: false, doneView: false };
  const ASSET_FOLDER_DEFS = [
    { key: 'fg', dir: '01_前景', label: '前景画像', sub: '共通前景・各シーン前景 → 01_前景/' },
    { key: 'bg', dir: '02_背景', label: '背景画像', sub: '共通背景・各シーン背景 → 02_背景/' },
    { key: 'panel', dir: '03_パネル', label: 'パネル画像', sub: 'スクリーンパネル・マーカーパネル → 03_パネル/' },
    { key: 'npc', dir: '04_NPC立ち絵', label: 'NPC立ち絵', sub: 'アイコン・表情差分 → 04_NPC立ち絵/' },
    { key: 'bgm', dir: '05_BGM・SE', label: 'BGM・SE音源', sub: '共通BGM・シーンBGM・カットインSE → 05_BGM・SE/' },
    { key: 'cutin', dir: '06_カットイン', label: 'カットイン', sub: 'カットイン画像・動画 → 06_カットイン/' }
  ];
  function collect() {
    const p = S.proj, sc = (CCF.scenarioList().find(x => String(x.id) === String(S.key)) || {}), room = S.rooms.find(r => r.id === S.roomId);
    let dummies = [], clues = [];
    try { dummies = M.buildDummyPieces(p.stocks, p.settings); } catch (e) { dummies = []; }
    try { clues = M.buildCluePieces(p.stocks); } catch (e) { clues = []; }
    const gd = p.globalDecor || {};
    const boardItems = (gd.screens || []).map(d => ({ key: 'item:g:' + d.id, it: d, label: '📺 スクリーンパネル：' + (d.name || 'スクリーン') }));
    const boardPieces = (p.board && Array.isArray(p.board.pieces)) ? p.board.pieces : [];
    return {
      roomName: (room && room.name) || sc.title || 'ルーム',
      grid: (p.board && p.board.grid) || 24,
      boardWidth: (p.board && p.board.width) || 960,
      boardHeight: (p.board && p.board.height) || 720,
      scenarioTitle: sc.title || '', npcs: p.npcs || [], dummies, clues, scenes: p.scenes || [],
      cutins: Array.isArray(p.cutins) ? p.cutins : [], boardItems, boardPieces, globalDecor: gd
    };
  }
  const groupHtml = (g, title, rows) => `<fieldset class="ccf-wiz-grp"><legend><label><input type="checkbox" data-wg="${g}"> ${title}（${rows.length}）</label></legend>${rows.length ? rows.join('') : '<div class="ccf-muted">（ありません）</div>'}</fieldset>`;
  const rowHtml = (key, label, sub) => `<label class="ccf-wiz-row"><input type="checkbox" data-wk="${esc(key)}"> <span>${esc(label)}</span>${sub ? ` <span class="ccf-muted">${esc(sub)}</span>` : ''}</label>`;
  const bgmPrefixRadiosHtml = (radioName) => `<div class="ccf-wiz-radio-grp" role="radiogroup" aria-label="BGM・SEファイル名形式">
    <label class="ccf-wiz-radio"><input type="radio" name="${radioName}" value="scene" data-wbgm-prefix="scene"${W.bgmPrefixMode !== 'none' ? ' checked' : ''}> <span><b>🔢 シーン番号プレフィックス付き（シーンごとに個別ファイル化・ネタバレ配慮）</b><small class="ccf-muted">同じ曲もシーンごとに別ファイルで複製出力（例：00_共通_曲名.mp3 / 01_曲名.mp3 / 05_曲名.mp3 / SE01_効果音.mp3）</small></span></label>
    <label class="ccf-wiz-radio"><input type="radio" name="${radioName}" value="none" data-wbgm-prefix="none"${W.bgmPrefixMode === 'none' ? ' checked' : ''}> <span><b>🎵 プレフィックスなし（元の曲名のまま1曲1ファイル）</b><small class="ccf-muted">元のファイル名のまま重複排除して出力（同名別ファイル衝突時のみ _2 等を付与）</small></span></label>
  </div>`;

  function countAssetFolderItems(d) {
    const hasSrc = x => !!(x && (x.path || x.filePath || x.dataUrl || x.url || x.assetUid || x.assetId));
    const fg = (hasSrc(d.globalDecor && d.globalDecor.fg) ? 1 : 0) + (d.scenes || []).filter(s => s && hasSrc(s.fg)).length;
    const bg = (hasSrc(d.globalDecor && d.globalDecor.bg) ? 1 : 0) + (d.scenes || []).filter(s => s && hasSrc(s.bg)).length;
    let panel = ((d.globalDecor && d.globalDecor.screens) || []).filter(hasSrc).length
      + ((d.globalDecor && d.globalDecor.markers) || []).filter(hasSrc).length;
    (d.scenes || []).forEach(s => {
      if (!s) return;
      panel += (s.markers || []).filter(hasSrc).length + (s.screens || []).filter(hasSrc).length;
    });
    let npc = 0;
    (d.npcs || []).forEach(n => {
      if (!n) return;
      const imgs = Array.isArray(n.images) ? n.images.filter(hasSrc) : [];
      if (imgs.length) npc += imgs.length;
      else if (n.iconDataUrl || n.imagePath || n.iconPath) npc += 1;
    });
    const bgm = collectAudioEntries(d).length;
    const cutin = (d.cutins || []).filter(c => c && (c.visualPath || c.visualDataUrl || c.visualUrl || c.visualUid)).length;
    return { fg, bg, panel, npc, bgm, cutin };
  }

  function openWizard(mode) {
    if (W.el) closeWizard();
    const d = collect();
    W.tab = mode === 'assets' ? 'assets' : 'room';
    W.mode = mode === 'pieces' ? 'pieces' : 'room';
    W.bgmPrefixMode = W.bgmPrefixMode || 'scene';
    W.data = d;
    W.doneView = false;
    const ov = document.createElement('div'); ov.className = 'ccf-overlay'; ov.id = 'ccfZipWiz'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const imgN = n => (n.images || []).length;
    const cnts = countAssetFolderItems(d);
    const assetRowsHtml = ASSET_FOLDER_DEFS.map(def => `<label class="ccf-wiz-row"><input type="checkbox" data-wasset="${def.key}" checked> <span><b>${esc(def.label)}</b>（${cnts[def.key] || 0}件）</span> <span class="ccf-muted">${esc(def.sub)}</span></label>`).join('');
    ov.innerHTML = `<div class="ccf-modal narrow"><div class="ccf-modal-head"><b>📦 ZIP出力</b><span class="ccf-muted" data-wsub>ココフォリア v1.1.0 形式（欲しい要素だけ選べます）</span><span class="ccf-spacer"></span><button type="button" class="ccf-mini" data-w="close">✕</button></div>
      <div class="ccf-wiz-tabs" role="tablist" aria-label="ZIP出力モード">
        <button type="button" role="tab" class="ccf-wiz-tab${W.tab === 'room' ? ' active' : ''}" data-wtab="room" aria-selected="${W.tab === 'room'}">🎮 ルームZIP<small>ココフォリア v1.1.0 形式</small></button>
        <button type="button" role="tab" class="ccf-wiz-tab${W.tab === 'assets' ? ' active' : ''}" data-wtab="assets" aria-selected="${W.tab === 'assets'}">📁 素材＆セトリZIP<small>整理フォルダ＋シーン別セットリスト一覧</small></button>
      </div>
      <div class="ccf-modal-body single" data-wbody>
        <div data-wpanel="room"${W.tab === 'room' ? '' : ' hidden'}>
          <div class="ccf-wiz-presets"><button type="button" class="ccf-btn" data-w="all">🏠 部屋全体</button><button type="button" class="ccf-btn" data-w="pieces">♟️ 駒だけ（NPC＋ダミー駒）</button><button type="button" class="ccf-btn" data-w="none">☐ すべて解除</button></div>
          ${groupHtml('room', '🏠 部屋設定（背景・前景・BGM）', [rowHtml('room', d.roomName + ' の部屋設定', '共通の背景／前景と、最初のBGM付きシーンのBGM')])}
          ${groupHtml('npc', '👤 NPC駒', d.npcs.map(n => rowHtml('npc:' + n.id, n.name, (n.status || []).length + '項目・立ち絵' + imgN(n) + '枚')))}
          ${groupHtml('piece', '🧩 ダミー駒／🔍 手がかり駒', d.dummies.map((p, i) => rowHtml('dummy:' + i, p.name, 'チャパレ ' + String(p.commands).split('\n').length + '行')).concat(d.clues.map((p, i) => rowHtml('clue:' + i, p.name, '手がかり'))))}
          ${groupHtml('scene', '🎬 シーン', d.scenes.map(s => rowHtml('scene:' + s.id, s.title, [s.fg && '前景', s.bg && '背景', s.bgm && 'BGM', (s.markers && s.markers.length) && ('マーカー' + s.markers.length + '件')].filter(Boolean).join('・'))))}
          ${groupHtml('item', '🧱 盤面オブジェクト', d.boardItems.map(b => rowHtml(b.key, b.label)))}
          <fieldset class="ccf-wiz-grp ccf-wiz-bgm-box">
            <legend>🎵 使用BGM・SEの別ZIP書き出し（${cnts.bgm}件）</legend>
            ${bgmPrefixRadiosHtml('ccfBgmPrefixRoom')}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;">
              <button type="button" class="ccf-btn" data-w="export-bgm" title="部屋・全シーン・カットインで使用している音声ファイルを別ZIP（BGM_${esc(safeName(d.roomName))}_*.zip）で書き出します">🎵 使用BGM・SEを別ZIPで書き出す</button>
              <span class="ccf-muted" style="font-size:.74rem;">※ ルーム本体ZIPと並べて管理できる音声専用ZIPを書き出します</span>
            </div>
            <div data-wbgm-res></div>
          </fieldset>
        </div>
        <div data-wpanel="assets"${W.tab === 'assets' ? '' : ' hidden'}>
          <fieldset class="ccf-wiz-grp">
            <legend>📂 同梱する素材フォルダ（選択した種別を番号付きフォルダへ整理）</legend>
            ${assetRowsHtml}
          </fieldset>
          <fieldset class="ccf-wiz-grp">
            <legend>🎵 BGM・SEのファイル名形式（05_BGM・SE/）</legend>
            ${bgmPrefixRadiosHtml('ccfBgmPrefixAssets')}
          </fieldset>
          <div class="ccf-wiz-note">
            <b>📋 セットリスト一覧を自動同梱</b>
            <div class="ccf-muted">ZIP直下に <code>00_セットリスト・使用素材一覧.txt</code> と表形式の <code>00_セットリスト・使用素材一覧.html</code> を自動同梱します（部屋名・盤面サイズ・共通設定・シーン別セットリスト・使用NPC一覧・カットイン一覧・警告）。</div>
          </div>
        </div>
        <div data-wresult hidden></div>
      </div>
      <div class="ccf-modal-foot"><span class="ccf-muted" data-wsum></span><label class="ccf-chk" style="margin-left:8px;" title="出力時にクラウドの exports/ フォルダへも直接保存します"><input type="checkbox" id="ccfZipSaveCloud"> ☁️ クラウド（exports/）へも保存</label><span class="ccf-spacer"></span><button type="button" class="ccf-btn" data-w="go-cloud" title="ローカル保存せず直接クラウドの exports/ フォルダへZIPを保存します">☁️ クラウドへ直接保存</button><button type="button" class="ccf-btn primary" data-w="go">📦 ZIPを書き出す</button><button type="button" class="ccf-btn" data-w="close">閉じる</button></div></div>`;
    ov.addEventListener('click', onClick); ov.addEventListener('change', onChange);
    W.onKey = e => { if (e.key === 'Escape' && !W.busy) { e.preventDefault(); e.stopImmediatePropagation(); closeWizard(); } };
    document.body.appendChild(ov); document.addEventListener('keydown', W.onKey, true); W.el = ov;
    preset(W.mode === 'pieces' ? 'pieces' : 'all');
    syncWizardTabUi();
  }
  function closeWizard() { if (!W.el) return; document.removeEventListener('keydown', W.onKey, true); W.el.remove(); W.el = null; }
  const boxes = () => [...W.el.querySelectorAll('[data-wk]')];
  const assetBoxes = () => [...W.el.querySelectorAll('[data-wasset]')];
  function syncBgmPrefixRadios(val) {
    W.bgmPrefixMode = val === 'none' ? 'none' : 'scene';
    if (!W.el) return;
    W.el.querySelectorAll('[data-wbgm-prefix]').forEach(r => { r.checked = r.dataset.wbgmPrefix === W.bgmPrefixMode; });
  }
  function syncWizardTabUi() {
    if (!W.el) return;
    const isAssets = W.tab === 'assets';
    W.el.querySelectorAll('[data-wtab]').forEach(btn => {
      const on = btn.dataset.wtab === W.tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    const sub = W.el.querySelector('[data-wsub]');
    if (sub) sub.textContent = isAssets ? '素材を種別フォルダへ整理＋シーン別セットリスト一覧を同梱' : 'ココフォリア v1.1.0 形式（欲しい要素だけ選べます）';
    const pRoom = W.el.querySelector('[data-wpanel="room"]');
    const pAssets = W.el.querySelector('[data-wpanel="assets"]');
    const pRes = W.el.querySelector('[data-wresult]');
    if (pRoom) pRoom.hidden = W.doneView || isAssets;
    if (pAssets) pAssets.hidden = W.doneView || !isAssets;
    if (pRes) pRes.hidden = !W.doneView;
    const go = W.el.querySelector('[data-w="go"]');
    const gc = W.el.querySelector('[data-w="go-cloud"]');
    const sc = W.el.querySelector('#ccfZipSaveCloud');
    if (go) {
      go.style.display = W.doneView ? 'none' : '';
      go.textContent = isAssets ? '📁 素材＆セトリZIPを書き出す' : '📦 ZIPを書き出す';
    }
    if (gc) gc.style.display = W.doneView ? 'none' : '';
    if (sc && sc.parentElement) sc.parentElement.style.display = W.doneView ? 'none' : '';
    refreshGroups();
  }
  function preset(k) {
    boxes().forEach(b => { const key = b.dataset.wk; b.checked = k === 'all' ? true : k === 'pieces' ? /^(npc|dummy|clue):/.test(key) : false; });
    refreshGroups();
  }
  function refreshGroups() {
    if (!W.el) return;
    W.el.querySelectorAll('[data-wg]').forEach(g => {
      const grp = g.dataset.wg, mine = boxes().filter(b => (grp === 'piece' ? /^(dummy|clue):/ : grp === 'item' ? /^item:/ : new RegExp('^' + grp + '(:|$)')).test(b.dataset.wk));
      const on = mine.filter(b => b.checked).length; g.checked = !!mine.length && on === mine.length; g.indeterminate = on > 0 && on < mine.length; g.disabled = !mine.length;
    });
    const sum = W.el.querySelector('[data-wsum]');
    const go = W.el.querySelector('[data-w="go"]');
    const gc = W.el.querySelector('[data-w="go-cloud"]');
    const eb = W.el.querySelector('[data-w="export-bgm"]');
    if (W.tab === 'assets') {
      const an = assetBoxes().filter(b => b.checked).length;
      if (sum) sum.textContent = W.doneView ? '' : `フォルダ ${an}種＋セットリスト一覧`;
      if (go) go.disabled = W.busy;
      if (gc) gc.disabled = W.busy;
    } else {
      const n = boxes().filter(b => b.checked).length;
      if (sum) sum.textContent = W.doneView ? '' : (n + '件を選択中');
      if (go) go.disabled = !n || W.busy;
      if (gc) gc.disabled = !n || W.busy;
    }
    if (eb) eb.disabled = W.busy;
  }
  function onChange(e) {
    const pr = e.target.closest('[data-wbgm-prefix]');
    if (pr) { syncBgmPrefixRadios(pr.dataset.wbgmPrefix); return; }
    const g = e.target.closest('[data-wg]');
    if (g) { const grp = g.dataset.wg; boxes().forEach(b => { if ((grp === 'piece' ? /^(dummy|clue):/ : grp === 'item' ? /^item:/ : new RegExp('^' + grp + '(:|$)')).test(b.dataset.wk)) b.checked = g.checked; }); }
    refreshGroups();
  }
  let lastZipBlob = null, lastZipName = '', lastZipFilePath = '', lastBgmBlob = null, lastBgmName = '';
  async function uploadLastZipToCloud() {
    if (!window.CloudSync || typeof CloudSync.uploadExportFile !== 'function') {
      return say('⚠️ クラウド連携機能が利用できません');
    }
    try {
      let data = lastZipBlob;
      if (!data && isElec && lastZipFilePath && fs && fs.existsSync(lastZipFilePath)) {
        data = fs.readFileSync(lastZipFilePath);
      }
      if (!data || !lastZipName) return say('⚠️ 先にZIPを作成してください');
      say('☁️ クラウドの exports/ へアップロードしています…');
      const res = await CloudSync.uploadExportFile(lastZipName, data, 'application/zip');
      if (res && res.ok) {
        say(`✅ クラウドの exports/ に保存しました: ${res.fileName}`);
        const statusEl = W.el && W.el.querySelector('[data-wcloud-res]');
        if (statusEl) statusEl.innerHTML = `<div class="ccf-muted" style="color:var(--dc-green);font-weight:bold;">☁️ クラウド保存済み：${esc(res.destinations.join(' / '))}</div>`;
      }
    } catch (err) {
      console.error('[ccf] クラウド保存失敗', err);
      say('❌ クラウド保存に失敗しました: ' + (err && err.message || err));
    }
  }
  function onClick(e) {
    const tb = e.target.closest('[data-wtab]');
    if (tb && !W.busy) {
      W.tab = tb.dataset.wtab === 'assets' ? 'assets' : 'room';
      W.doneView = false;
      syncWizardTabUi();
      return;
    }
    const b = e.target.closest('[data-w]'); if (!b || W.busy) return; const k = b.dataset.w;
    if (k === 'close') return closeWizard();
    if (k === 'all' || k === 'pieces' || k === 'none') return preset(k);
    if (k === 'open') { showItem(b.dataset.path); return; }
    if (k === 'open-dir') { openFolder(b.dataset.path, b.dataset.first || ''); return; }
    if (k === 'dl-zip' && lastZipBlob && window.WebBridge) { WebBridge.downloadBlob(lastZipBlob, lastZipName, 'application/zip'); return; }
    if (k === 'dl-bgm' && lastBgmBlob && window.WebBridge) { WebBridge.downloadBlob(lastBgmBlob, lastBgmName, 'application/zip'); return; }
    if (k === 'upload-zip-cloud') return void uploadLastZipToCloud();
    if (k === 'export-bgm') return exportBgmFolder();
    if (k === 'go') return W.tab === 'assets' ? runAssetsSetlistZip(false) : run(false);
    if (k === 'go-cloud') return W.tab === 'assets' ? runAssetsSetlistZip(true) : run(true);
  }

  /** ウィザードのチェック状態 → buildPackage に渡す選択内容 */
  function selection() {
    const d = W.data, on = new Set(boxes().filter(b => b.checked).map(b => b.dataset.wk));
    const scenes = d.scenes.filter(s => on.has('scene:' + s.id)), gd = d.globalDecor;
    const grid = d.grid || 24;
    const fieldWidth = Math.max(1, Math.round((d.boardWidth || 960) / grid)) || 40;
    const fieldHeight = Math.max(1, Math.round((d.boardHeight || 720) / grid)) || 30;
    const room = on.has('room')
      ? { name: d.roomName, bg: gd.bg || null, fg: gd.fg || null, bgm: (scenes.concat(d.scenes).find(s => s.bgm) || {}).bgm || null, fieldWidth, fieldHeight }
      : { name: d.roomName, bg: null, fg: null, bgm: null, fieldWidth, fieldHeight };
    const pieceByNpc = new Map();
    (d.boardPieces || []).forEach(bp => {
      if (bp && bp.npcId && !pieceByNpc.has(bp.npcId)) pieceByNpc.set(bp.npcId, bp);
    });
    const npcs = d.npcs.filter(n => on.has('npc:' + n.id)).map(n => {
      const bp = pieceByNpc.get(n.id);
      if (bp && bp.visible !== false) {
        return Object.assign({}, n, { onBoard: true, x: bp.x, y: bp.y, width: bp.width, height: bp.height, invisible: !!bp.invisible || !!n.invisible });
      }
      return n;
    });
    return {
      room, npcs,
      pieces: d.dummies.filter((p, i) => on.has('dummy:' + i)).concat(d.clues.filter((p, i) => on.has('clue:' + i))),
      scenes, items: d.boardItems.filter(b => on.has(b.key)).map(b => b.it)
    };
  }

  const AUDIO_EXT_RE = /\.(mp3|ogg|wav|m4a|aac|flac|webm|opus|mid|midi)$/i;
  const MEDIA_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|mp4|webm|mov|m4v|ogv)$/i;
  const MIME_AUDIO_EXT = {
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 'application/ogg': '.ogg',
    'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
    'audio/flac': '.flac', 'audio/mp4': '.m4a', 'audio/aac': '.m4a', 'audio/webm': '.webm', 'audio/opus': '.opus'
  };
  const MIME_MEDIA_EXT = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/bmp': '.bmp', 'image/svg+xml': '.svg', 'image/avif': '.avif',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/ogg': '.ogv'
  };
  const strToBytes = s => typeof Buffer !== 'undefined' ? Buffer.from(String(s || ''), 'utf8') : new TextEncoder().encode(String(s || ''));
  const safePart = (s, maxLen) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, maxLen || 60);
  const stripExt = s => String(s || '').replace(/\.[^./\\]{1,8}$/, '');
  function audioExt(src, res) {
    for (const cand of [src && src.path, res && res.name, src && src.name, src && src.fileName]) {
      const m = String(cand || '').trim().match(AUDIO_EXT_RE);
      if (m) return '.' + m[1].toLowerCase();
    }
    const mime = String((res && res.mime) || '').split(';')[0].trim().toLowerCase();
    return MIME_AUDIO_EXT[mime] || '.mp3';
  }
  function mediaExt(src, res, fallback) {
    for (const cand of [src && src.path, src && src.filePath, res && res.name, src && src.name, src && src.fileName]) {
      const m = String(cand || '').trim().match(MEDIA_EXT_RE);
      if (m) return '.' + (m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase());
    }
    const mime = String((res && res.mime) || '').split(';')[0].trim().toLowerCase();
    return MIME_MEDIA_EXT[mime] || fallback || '.png';
  }
  function allocUniqueName(usedSet, baseNameStr, ext) {
    const cleanBase = safePart(baseNameStr, 90) || 'asset';
    let fname = cleanBase + ext;
    let n = 2;
    while (usedSet.has(fname.toLowerCase())) {
      fname = cleanBase + '_' + n + ext;
      n++;
    }
    usedSet.add(fname.toLowerCase());
    return fname;
  }
  function collectAudioEntries(d) {
    const out = [];
    if (d.globalDecor && d.globalDecor.bgm) {
      out.push({ key: 'global', tag: '00_共通', label: '部屋設定BGM', src: d.globalDecor.bgm });
    }
    (d.scenes || []).forEach((s, i) => {
      if (s && s.bgm) {
        out.push({ key: 'scene:' + i, sceneIdx: i, tag: String(i + 1).padStart(2, '0'), label: `シーン#${i + 1}「${s.title || '無題'}」`, src: s.bgm });
      }
    });
    (d.cutins || []).forEach((c, i) => {
      if (c && (c.sePath || c.seDataUrl || c.seUrl || c.seUid)) {
        out.push({
          key: 'cutin:' + i,
          cutinIdx: i,
          tag: 'SE' + String(i + 1).padStart(2, '0'),
          label: `カットイン「${c.name || 'カットイン' + (i + 1)}」`,
          src: { path: c.sePath || '', dataUrl: c.seDataUrl || '', url: c.seUrl || '', assetUid: c.seUid || '', name: c.seName || '' }
        });
      }
    });
    return out;
  }

  async function resolveAudioItemsForExport(entries, prefixMode) {
    const mode = prefixMode === 'none' ? 'none' : 'scene';
    const warnings = [];
    const namedItems = [];
    const outNameByKey = new Map();
    const usedNames = new Set();

    if (mode === 'scene') {
      for (const ent of entries) {
        const res = await resolveSource(ent.src, 'audio');
        if (!res || !res.buf || !res.buf.length) {
          warnings.push(`${ent.label}: ${ent.src.name || ent.src.path || '音声ファイル'} を読み込めませんでした`);
          continue;
        }
        const ext = audioExt(ent.src, res);
        const rawName = ent.src.name || res.name || (ent.src.path ? baseName(ent.src.path) : '') || 'audio';
        const trackName = safePart(stripExt(rawName), 54) || 'audio';
        const fname = allocUniqueName(usedNames, ent.tag + '_' + trackName, ext);
        namedItems.push({ fname, buf: res.buf, entry: ent });
        outNameByKey.set(ent.key, fname);
      }
      return { namedItems, warnings, outNameByKey };
    }

    // プレフィックスなし：SHA-256 で重複排除し 1曲1ファイル（同名別ファイル衝突時のみ _2 等を付与）
    const hashToFname = new Map();
    for (const ent of entries) {
      const res = await resolveSource(ent.src, 'audio');
      if (!res || !res.buf || !res.buf.length) {
        warnings.push(`${ent.label}: ${ent.src.name || ent.src.path || '音声ファイル'} を読み込めませんでした`);
        continue;
      }
      const hash = await (P.sha256HexAsync ? P.sha256HexAsync(res.buf) : P.sha256Hex(res.buf));
      if (hashToFname.has(hash)) {
        outNameByKey.set(ent.key, hashToFname.get(hash));
        continue;
      }
      const ext = audioExt(ent.src, res);
      const rawName = ent.src.name || res.name || (ent.src.path ? baseName(ent.src.path) : '') || 'audio';
      const trackName = safePart(stripExt(rawName), 70) || 'audio';
      const fname = allocUniqueName(usedNames, trackName, ext);
      hashToFname.set(hash, fname);
      namedItems.push({ fname, buf: res.buf, entry: ent });
      outNameByKey.set(ent.key, fname);
    }
    return { namedItems, warnings, outNameByKey };
  }

  async function exportBgmFolder() {
    const d = W.data || collect();
    const entries = collectAudioEntries(d);
    if (!entries.length) {
      say('⚠️ 現在の部屋・シーン・カットインにBGM・音声ファイルが設定されていません');
      return null;
    }
    const prefixMode = W.bgmPrefixMode === 'none' ? 'none' : 'scene';
    W.busy = true; if (W.el) refreshGroups();
    say('🎵 使用BGM・SEをZIPにまとめています…');
    try {
      if (S && S.key && S.key !== '_default' && window.CloudSync && typeof CloudSync.ensureScenarioAssetsCached === 'function') {
        try { await CloudSync.ensureScenarioAssetsCached(S.key, { silent: true }); } catch (_) {}
      }
      const { namedItems, warnings } = await resolveAudioItemsForExport(entries, prefixMode);
      const resBoxes = W.el ? [...W.el.querySelectorAll('[data-wbgm-res]')] : [];
      const paintRes = html => resBoxes.forEach(box => { box.innerHTML = html; });
      if (!namedItems.length) {
        if (warnings.length) {
          paintRes(`<div class="ccf-wiz-warn"><b>⚠️ 音声ファイルを読み込めませんでした（${warnings.length}件）</b>${warnings.slice(0, 20).map(w => '<div>' + esc(w) + '</div>').join('')}</div>`);
        }
        say('⚠️ 書き出せる音声ファイルが見つかりませんでした');
        return null;
      }
      const zipName = 'BGM_' + safeName(d.roomName) + '_' + ts() + '.zip';
      const zipEntries = namedItems.map(x => ({ name: x.fname, data: x.buf, store: true }));
      const modeDesc = prefixMode === 'scene' ? 'シーン番号プレフィックス付き・個別ファイル化' : 'プレフィックスなし・1曲1ファイル';
      if (!isElec) {
        const zipBlob = await WebBridge.buildZipBlob(zipEntries);
        lastBgmBlob = zipBlob; lastBgmName = zipName;
        WebBridge.downloadBlob(zipBlob, zipName, 'application/zip');
        paintRes(`<div class="ccf-wiz-result"><b>🎵 使用BGM・SEを別ZIPでダウンロードしました（${namedItems.length}ファイル / ${modeDesc}）</b>
          <div class="ccf-wiz-path">${esc(zipName)}（${Math.round(zipBlob.size / 1024).toLocaleString()} KB）</div>
          <div><button type="button" class="ccf-btn" data-w="dl-bgm">💾 もう一度ダウンロード</button></div>
          ${warnings.length ? `<div class="ccf-wiz-warn"><b>⚠️ 読み込めなかった音声（${warnings.length}件）</b>${warnings.slice(0, 20).map(w => '<div>' + esc(w) + '</div>').join('')}</div>` : ''}
          <div class="ccf-muted">※ 展開した音声ファイルをココフォリアのBGM設定画面へドラッグ＆ドロップしてください。</div></div>`);
        say(`🎵 使用BGM・SE ${namedItems.length}件をZIPでダウンロードしました：${zipName}`);
        return { files: namedItems.map(x => x.fname), zipName, warnings };
      }
      const file = path.join(exportDir(), zipName);
      const r = zipWriter().writeZip(file, zipEntries);
      paintRes(`<div class="ccf-wiz-result"><b>🎵 使用BGM・SEを別ZIPで書き出しました（${namedItems.length}ファイル / ${modeDesc}）</b>
        <div class="ccf-wiz-path">${esc(file)}（${Math.round(r.bytes / 1024).toLocaleString()} KB）</div>
        <div><button type="button" class="ccf-btn" data-w="open" data-path="${esc(file)}">📂 フォルダで表示</button></div>
        ${warnings.length ? `<div class="ccf-wiz-warn"><b>⚠️ 読み込めなかった音声（${warnings.length}件）</b>${warnings.slice(0, 20).map(w => '<div>' + esc(w) + '</div>').join('')}</div>` : ''}
        <div class="ccf-muted">※ ZIPを展開した音声ファイルをココフォリアのBGM設定画面へドラッグ＆ドロップしてください。</div></div>`);
      say(`🎵 使用BGM・SE ${namedItems.length}件を書き出しました：${file}`);
      showItem(file);
      return { file, files: namedItems.map(x => x.fname), warnings };
    } catch (e) {
      console.error('[ccf] BGM書き出しに失敗', e);
      say('❌ 使用BGM・SEの書き出しに失敗しました：' + (e.message || e));
      return null;
    } finally {
      W.busy = false;
      if (W.el) refreshGroups();
    }
  }

  function formatDateTimeJa(dt) {
    const p2 = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}/${p2(dt.getMonth() + 1)}/${p2(dt.getDate())} ${p2(dt.getHours())}:${p2(dt.getMinutes())}:${p2(dt.getSeconds())}`;
  }

  function buildSetlistDocs(info) {
    const { d, grid, cols, rows, prefixMode, generatedAt, globalFiles, sceneRows, npcRows, cutinRows, panelRows, warnings } = info;
    const lines = [];
    lines.push('================================================================');
    lines.push(`セットリスト・使用素材一覧：${d.roomName}`);
    if (d.scenarioTitle) lines.push(`シナリオ名：${d.scenarioTitle}`);
    lines.push(`出力日時　：${generatedAt}`);
    lines.push(`盤面サイズ：${cols} × ${rows} マス（${d.boardWidth}×${d.boardHeight}px / 1マス=${grid}px）`);
    lines.push(`BGM出力形式：${prefixMode === 'scene' ? 'シーン番号プレフィックス付き（シーンごとに個別ファイル化）' : 'プレフィックスなし（元の曲名のまま1曲1ファイル）'}`);
    lines.push('================================================================');
    lines.push('');
    lines.push('■ 共通設定');
    lines.push(`  ・共通前景　　：${globalFiles.fg || '（未設定）'}`);
    lines.push(`  ・共通背景　　：${globalFiles.bg || '（未設定）'}`);
    lines.push(`  ・共通BGM 　　：${globalFiles.bgm || '（未設定）'}`);
    lines.push(`  ・スクリーンパネル（${panelRows.screens.length}件）：${panelRows.screens.length ? panelRows.screens.join(' / ') : '（なし）'}`);
    lines.push('');
    lines.push(`■ シーン別セットリスト（全 ${sceneRows.length}シーン）`);
    if (!sceneRows.length) {
      lines.push('  （シーンは登録されていません）');
    } else {
      sceneRows.forEach(sr => {
        lines.push(`----------------------------------------------------------------`);
        lines.push(`${sr.no} ${sr.title}`);
        lines.push(`  前景　　：${sr.fg || '（共通前景を使用）'}`);
        lines.push(`  背景　　：${sr.bg || '（共通背景を使用）'}`);
        lines.push(`  BGM 　　：${sr.bgm || '（なし）'}`);
        lines.push(`  マーカー：${sr.markers.length ? sr.markers.join(' / ') : '（なし）'}`);
        if (sr.message) {
          lines.push(`  切替メッセージ：`);
          sr.message.split(/\r?\n/).forEach(l => lines.push('    ' + l));
        }
      });
    }
    lines.push('');
    lines.push(`■ 使用NPC一覧（全 ${npcRows.length}体）`);
    if (!npcRows.length) lines.push('  （なし）');
    else npcRows.forEach((n, i) => lines.push(`  ${String(i + 1).padStart(2, '0')}. ${n.name}（立ち絵 ${n.imgCount}枚${n.files.length ? '：' + n.files.join(', ') : ''}）`));
    lines.push('');
    lines.push(`■ カットイン一覧（全 ${cutinRows.length}件）`);
    if (!cutinRows.length) lines.push('  （なし）');
    else cutinRows.forEach((c, i) => lines.push(`  ${String(i + 1).padStart(2, '0')}. ${c.name}［位置:${c.position} / ${c.durationMs}ms］ 映像:${c.visual || 'なし'} / SE:${c.se || 'なし'}`));
    if (warnings.length) {
      lines.push('');
      lines.push(`■ 読み込みエラー警告（${warnings.length}件）`);
      warnings.forEach(w => lines.push('  ⚠️ ' + w));
    }
    const txt = lines.join('\r\n') + '\r\n';

    const h = s => esc(String(s == null ? '' : s));
    const nl2br = s => h(s).replace(/\r?\n/g, '<br>');
    const sceneTrs = sceneRows.length
      ? sceneRows.map(sr => `<tr>
          <td class="num">${h(sr.no)}</td>
          <td class="title">${h(sr.title)}</td>
          <td>${sr.fg ? h(sr.fg) : '<span class="muted">（共通）</span>'}</td>
          <td>${sr.bg ? h(sr.bg) : '<span class="muted">（共通）</span>'}</td>
          <td>${sr.bgm ? h(sr.bgm) : '<span class="muted">（なし）</span>'}</td>
          <td>${sr.markers.length ? sr.markers.map(m => `<span class="pill">${h(m)}</span>`).join(' ') : '<span class="muted">（なし）</span>'}</td>
          <td class="msg">${sr.message ? nl2br(sr.message) : '<span class="muted">（なし）</span>'}</td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="muted">シーンは登録されていません</td></tr>';
    const npcTrs = npcRows.length
      ? npcRows.map((n, i) => `<tr><td class="num">${String(i + 1).padStart(2, '0')}</td><td class="title">${h(n.name)}</td><td>${n.imgCount}枚</td><td>${n.files.length ? n.files.map(f => `<code>${h(f)}</code>`).join('<br>') : '<span class="muted">（立ち絵なし）</span>'}</td></tr>`).join('')
      : '<tr><td colspan="4" class="muted">NPCは登録されていません</td></tr>';
    const cutinTrs = cutinRows.length
      ? cutinRows.map((c, i) => `<tr><td class="num">${String(i + 1).padStart(2, '0')}</td><td class="title">${h(c.name)}</td><td>${h(c.position)} / ${h(c.durationMs)}ms</td><td>${c.visual ? h(c.visual) : '<span class="muted">なし</span>'}</td><td>${c.se ? h(c.se) : '<span class="muted">なし</span>'}</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted">カットインは登録されていません</td></tr>';
    const warnHtml = warnings.length
      ? `<section class="warn"><h2>⚠️ 読み込みエラー警告（${warnings.length}件）</h2><ul>${warnings.map(w => `<li>${h(w)}</li>`).join('')}</ul></section>`
      : '';

    const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>セットリスト・使用素材一覧 - ${h(d.roomName)}</title>
<style>
  body { font-family: "Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif; margin: 0; padding: 24px; background: #f6f7fb; color: #1e2230; line-height: 1.55; }
  .wrap { max-width: 1200px; margin: 0 auto; background: #fff; border: 1px solid #e0e4ef; border-radius: 12px; padding: 22px 26px; box-shadow: 0 4px 18px rgba(20,30,60,.06); }
  h1 { margin: 0 0 8px; font-size: 1.35rem; }
  h2 { margin: 24px 0 10px; font-size: 1.05rem; border-left: 4px solid #5865f2; padding-left: 9px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: .86rem; color: #4b5568; margin-bottom: 14px; }
  .box { background: #f8f9fd; border: 1px solid #e4e8f2; border-radius: 8px; padding: 12px 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 14px; font-size: .88rem; }
  table { width: 100%; border-collapse: collapse; font-size: .84rem; margin-top: 6px; }
  th, td { border: 1px solid #dfe3ee; padding: 7px 9px; vertical-align: top; text-align: left; }
  th { background: #eef1fa; font-weight: 700; white-space: nowrap; }
  tr:nth-child(even) td { background: #fbfcff; }
  td.num { font-weight: 700; white-space: nowrap; color: #4f5bd5; text-align: center; }
  td.title { font-weight: 700; min-width: 110px; }
  td.msg { min-width: 160px; max-width: 320px; word-break: break-word; }
  .muted { color: #7a8396; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 999px; background: #eef1ff; color: #3c48b8; font-size: .76rem; margin: 1px 0; }
  code { font-family: Consolas, monospace; font-size: .8rem; background: #f0f2f8; padding: 1px 4px; border-radius: 4px; }
  .warn { margin-top: 20px; background: #fff6f5; border: 1px solid #f5c2be; border-radius: 8px; padding: 12px 16px; color: #a12622; }
  .warn h2 { margin-top: 0; border-left-color: #d93025; }
  @media print { body { background: #fff; padding: 0; } .wrap { box-shadow: none; border: none; padding: 0; } }
</style></head><body><div class="wrap">
  <h1>📁 セットリスト・使用素材一覧：${h(d.roomName)}</h1>
  <div class="meta">
    ${d.scenarioTitle ? `<span><b>シナリオ：</b>${h(d.scenarioTitle)}</span>` : ''}
    <span><b>盤面サイズ：</b>${cols} × ${rows} マス（${d.boardWidth}×${d.boardHeight}px）</span>
    <span><b>BGM形式：</b>${prefixMode === 'scene' ? 'シーン番号プレフィックス付き（個別化）' : 'プレフィックスなし（1曲1ファイル）'}</span>
    <span><b>出力日時：</b>${h(generatedAt)}</span>
  </div>
  <h2>🏠 共通設定</h2>
  <div class="box">
    <div><b>共通前景：</b>${globalFiles.fg ? h(globalFiles.fg) : '<span class="muted">（未設定）</span>'}</div>
    <div><b>共通背景：</b>${globalFiles.bg ? h(globalFiles.bg) : '<span class="muted">（未設定）</span>'}</div>
    <div><b>共通BGM：</b>${globalFiles.bgm ? h(globalFiles.bgm) : '<span class="muted">（未設定）</span>'}</div>
    <div><b>スクリーンパネル（${panelRows.screens.length}件）：</b>${panelRows.screens.length ? panelRows.screens.map(s => `<span class="pill">${h(s)}</span>`).join(' ') : '<span class="muted">（なし）</span>'}</div>
  </div>
  <h2>🎬 シーン別セットリスト（${sceneRows.length}件）</h2>
  <table><thead><tr><th>#</th><th>シーン名</th><th>前景</th><th>背景</th><th>BGM（音量・ループ）</th><th>マーカーパネル</th><th>シーン切替メッセージ</th></tr></thead><tbody>${sceneTrs}</tbody></table>
  <h2>👤 使用NPC一覧（${npcRows.length}体）</h2>
  <table><thead><tr><th>#</th><th>NPC名</th><th>枚数</th><th>立ち絵ファイル</th></tr></thead><tbody>${npcTrs}</tbody></table>
  <h2>⚡ カットイン一覧（${cutinRows.length}件）</h2>
  <table><thead><tr><th>#</th><th>名称</th><th>位置 / 表示時間</th><th>映像</th><th>SE（音量）</th></tr></thead><tbody>${cutinTrs}</tbody></table>
  ${warnHtml}
</div></body></html>`;
    return { txt, html };
  }

  async function runAssetsSetlistZip(cloudOnly) {
    const d = W.data || collect();
    const saveToCloudToo = !!cloudOnly || !!(W.el && W.el.querySelector('#ccfZipSaveCloud') && W.el.querySelector('#ccfZipSaveCloud').checked);
    const inc = {};
    assetBoxes().forEach(b => { inc[b.dataset.wasset] = !!b.checked; });
    const prefixMode = W.bgmPrefixMode === 'none' ? 'none' : 'scene';

    W.busy = true; refreshGroups();
    say('📁 素材＆セットリストを集めてZIPを作成しています…');
    try {
      if (S && S.key && S.key !== '_default' && window.CloudSync && typeof CloudSync.ensureScenarioAssetsCached === 'function') {
        try { await CloudSync.ensureScenarioAssetsCached(S.key, { silent: true }); } catch (_) {}
      }
      const zipEntries = [];
      const warnings = [];
      const counts = { fg: 0, bg: 0, panel: 0, npc: 0, bgm: 0, cutin: 0 };
      const hasSrc = x => !!(x && (x.path || x.filePath || x.dataUrl || x.url || x.assetUid || x.assetId));

      // フォルダ別重複排除ヘルパー（同一バイナリはフォルダ内で1ファイルに整理）
      const makeFolderCollector = (dir, kind, fallbackExt) => {
        const used = new Set();
        const hashToPath = new Map();
        return async (src, displayHint, warnLabel, owner) => {
          if (!hasSrc(src)) return '';
          const res = await resolveSource(src, kind, owner);
          if (!res || !res.buf || !res.buf.length) {
            warnings.push(`${warnLabel}: ${displayHint || src.name || src.path || '素材'} を読み込めませんでした`);
            return '';
          }
          const hash = await (P.sha256HexAsync ? P.sha256HexAsync(res.buf) : P.sha256Hex(res.buf));
          if (hashToPath.has(hash)) return hashToPath.get(hash);
          const ext = mediaExt(src, res, fallbackExt);
          const rawNm = displayHint || src.name || res.name || (src.path ? baseName(src.path) : '') || 'asset';
          const fname = allocUniqueName(used, stripExt(rawNm), ext);
          const fullPath = `${dir}/${fname}`;
          hashToPath.set(hash, fullPath);
          zipEntries.push({ name: fullPath, data: res.buf, store: true });
          return fullPath;
        };
      };

      const addFg = makeFolderCollector('01_前景', 'image', '.png');
      const addBg = makeFolderCollector('02_背景', 'image', '.png');
      const addPanel = makeFolderCollector('03_パネル', 'image', '.png');
      const addCutinMedia = makeFolderCollector('06_カットイン', 'any', '.png');

      // 01_前景 / 02_背景
      const gd = d.globalDecor || {};
      let gFgOut = '', gBgOut = '';
      if (inc.fg && hasSrc(gd.fg)) {
        gFgOut = await addFg(gd.fg, gd.fg.name, '共通前景');
        if (gFgOut) counts.fg++;
      }
      if (inc.bg && hasSrc(gd.bg)) {
        gBgOut = await addBg(gd.bg, gd.bg.name, '共通背景');
        if (gBgOut) counts.bg++;
      }

      // 03_パネル（スクリーンパネル）
      const screenLabels = [];
      for (const sr of (gd.screens || [])) {
        if (!sr) continue;
        let outP = '';
        if (inc.panel && hasSrc(sr)) {
          const before = zipEntries.length;
          outP = await addPanel(sr, sr.name || 'スクリーン', `スクリーンパネル「${sr.name || '無題'}」`);
          if (zipEntries.length > before) counts.panel++;
        }
        screenLabels.push(outP ? `${sr.name || 'スクリーン'}（${outP}）` : (sr.name || 'スクリーン'));
      }
      for (const mk of (gd.markers || [])) {
        if (inc.panel && hasSrc(mk)) {
          const before = zipEntries.length;
          await addPanel(mk, mk.name || 'マーカー', `共通マーカー「${mk.name || '無題'}」`);
          if (zipEntries.length > before) counts.panel++;
        }
      }

      // 05_BGM・SE
      const audioEntries = collectAudioEntries(d);
      let audioOutMap = new Map();
      if (inc.bgm && audioEntries.length) {
        const audioRes = await resolveAudioItemsForExport(audioEntries, prefixMode);
        warnings.push(...audioRes.warnings);
        audioOutMap = audioRes.outNameByKey;
        audioRes.namedItems.forEach(item => {
          zipEntries.push({ name: `05_BGM・SE/${item.fname}`, data: item.buf, store: true });
          counts.bgm++;
        });
      }

      // シーン別処理
      const sceneRows = [];
      for (let i = 0; i < (d.scenes || []).length; i++) {
        const sc = d.scenes[i];
        if (!sc) continue;
        const no = '#' + String(i + 1).padStart(2, '0');
        let fgText = '';
        if (sc.fg) {
          let outP = '';
          if (inc.fg && hasSrc(sc.fg)) {
            const before = zipEntries.length;
            outP = await addFg(sc.fg, sc.fg.name, `シーン${no}「${sc.title || '無題'}」前景`);
            if (zipEntries.length > before) counts.fg++;
          }
          fgText = outP ? `${sc.fg.name || baseName(outP)}（${outP}）` : (sc.fg.name || '設定あり');
        }
        let bgText = '';
        if (sc.bg) {
          let outP = '';
          if (inc.bg && hasSrc(sc.bg)) {
            const before = zipEntries.length;
            outP = await addBg(sc.bg, sc.bg.name, `シーン${no}「${sc.title || '無題'}」背景`);
            if (zipEntries.length > before) counts.bg++;
          }
          bgText = outP ? `${sc.bg.name || baseName(outP)}（${outP}）` : (sc.bg.name || '設定あり');
        }
        let bgmText = '';
        if (sc.bgm) {
          const vol = sc.bgm.volume != null ? Math.round(Number(sc.bgm.volume)) : 35;
          const loopStr = sc.bgm.loop === false ? 'ループOFF' : 'ループON';
          const outNm = audioOutMap.get('scene:' + i);
          const nm = sc.bgm.name || (sc.bgm.path ? baseName(sc.bgm.path) : 'BGM');
          bgmText = `${nm}（音量 ${vol}% / ${loopStr}${outNm ? ` / 05_BGM・SE/${outNm}` : ''}）`;
        }
        const markerNames = [];
        for (const mk of (sc.markers || [])) {
          if (!mk) continue;
          let outP = '';
          if (inc.panel && hasSrc(mk)) {
            const before = zipEntries.length;
            outP = await addPanel(mk, mk.name || 'マーカー', `シーン${no}「${sc.title || '無題'}」マーカー「${mk.name || ''}」`);
            if (zipEntries.length > before) counts.panel++;
          }
          const lbl = mk.name || mk.text || 'マーカー';
          markerNames.push(outP ? `${lbl}（${outP}）` : lbl);
        }
        for (const sr of (sc.screens || [])) {
          if (inc.panel && hasSrc(sr)) {
            const before = zipEntries.length;
            await addPanel(sr, sr.name || 'スクリーン', `シーン${no}「${sc.title || '無題'}」スクリーン`);
            if (zipEntries.length > before) counts.panel++;
          }
        }
        sceneRows.push({
          no,
          title: sc.title || '無題のシーン',
          fg: fgText,
          bg: bgText,
          bgm: bgmText,
          markers: markerNames,
          message: String(sc.sceneMessage || '').trim()
        });
      }

      // 04_NPC立ち絵
      const npcRows = [];
      const npcUsedNames = new Set();
      for (const npc of (d.npcs || [])) {
        if (!npc) continue;
        const rawImgs = Array.isArray(npc.images) && npc.images.length
          ? npc.images
          : ((npc.iconDataUrl || npc.imagePath || npc.iconPath) ? [{ name: npc.iconName || npc.name, dataUrl: npc.iconDataUrl || '', path: npc.imagePath || npc.iconPath || '' }] : []);
        const npcFiles = [];
        const seenHashInNpc = new Set();
        for (let j = 0; j < rawImgs.length; j++) {
          const im = rawImgs[j];
          if (!im || !hasSrc(im)) continue;
          if (!inc.npc) continue;
          const res = await resolveSource(im, 'image', { iconName: npc.iconName, npcName: npc.name });
          if (!res || !res.buf || !res.buf.length) {
            warnings.push(`NPC「${npc.name || '無題'}」立ち絵#${j + 1}: 読み込めませんでした`);
            continue;
          }
          const hash = await (P.sha256HexAsync ? P.sha256HexAsync(res.buf) : P.sha256Hex(res.buf));
          if (seenHashInNpc.has(hash)) continue;
          seenHashInNpc.add(hash);
          const ext = mediaExt(im, res, '.png');
          const diffPart = safePart(stripExt(im.label || im.name || res.name || String(j + 1).padStart(2, '0')), 36);
          const npcPart = safePart(npc.name || 'NPC', 36);
          const base = (diffPart && diffPart.toLowerCase() !== npcPart.toLowerCase()) ? `${npcPart}_${diffPart}` : `${npcPart}_${String(j + 1).padStart(2, '0')}`;
          const fname = allocUniqueName(npcUsedNames, base, ext);
          const fullPath = `04_NPC立ち絵/${fname}`;
          zipEntries.push({ name: fullPath, data: res.buf, store: true });
          npcFiles.push(fullPath);
          counts.npc++;
        }
        npcRows.push({ name: npc.name || '無題NPC', imgCount: rawImgs.length, files: npcFiles });
      }

      // 06_カットイン
      const cutinRows = [];
      for (let i = 0; i < (d.cutins || []).length; i++) {
        const c = d.cutins[i];
        if (!c) continue;
        let visText = '';
        const visSrc = { path: c.visualPath || '', dataUrl: c.visualDataUrl || '', url: c.visualUrl || '', assetUid: c.visualUid || '', name: c.visualName || '' };
        if (hasSrc(visSrc)) {
          let outP = '';
          if (inc.cutin) {
            const before = zipEntries.length;
            const fbExt = c.visualType === 'video' ? '.mp4' : '.png';
            outP = await addCutinMedia(visSrc, c.visualName || c.name || `cutin_${i + 1}`, `カットイン「${c.name || i + 1}」映像`);
            if (!outP && fbExt) { /* already warned */ }
            if (zipEntries.length > before) counts.cutin++;
          }
          visText = outP ? `${c.visualName || baseName(outP)}（${outP}）` : (c.visualName || baseName(c.visualPath || '') || '設定あり');
        }
        let seText = '';
        if (c.sePath || c.seDataUrl || c.seUrl || c.seUid || c.seName) {
          const outNm = audioOutMap.get('cutin:' + i);
          const seVol = c.seVolume != null ? Math.round(Number(c.seVolume)) : 80;
          const nm = c.seName || (c.sePath ? baseName(c.sePath) : 'SE');
          seText = `${nm}（音量 ${seVol}%${outNm ? ` / 05_BGM・SE/${outNm}` : ''}）`;
        }
        cutinRows.push({
          name: c.name || `カットイン${i + 1}`,
          position: c.position || 'center',
          durationMs: c.durationMs || 2500,
          visual: visText,
          se: seText
        });
      }

      // 00_セットリスト・使用素材一覧（TXT / HTML）
      const grid = d.grid || 24;
      const cols = Math.max(1, Math.round((d.boardWidth || 960) / grid)) || 40;
      const rows = Math.max(1, Math.round((d.boardHeight || 720) / grid)) || 30;
      const gBgmOut = audioOutMap.get('global');
      const globalFiles = {
        fg: gd.fg ? (gFgOut ? `${gd.fg.name || baseName(gFgOut)}（${gFgOut}）` : (gd.fg.name || '設定あり')) : '',
        bg: gd.bg ? (gBgOut ? `${gd.bg.name || baseName(gBgOut)}（${gBgOut}）` : (gd.bg.name || '設定あり')) : '',
        bgm: gd.bgm ? `${gd.bgm.name || (gd.bgm.path ? baseName(gd.bgm.path) : 'BGM')}${gBgmOut ? `（05_BGM・SE/${gBgmOut}）` : ''}` : ''
      };
      const docs = buildSetlistDocs({
        d, grid, cols, rows, prefixMode,
        generatedAt: formatDateTimeJa(new Date()),
        globalFiles, sceneRows, npcRows, cutinRows,
        panelRows: { screens: screenLabels },
        warnings
      });
      zipEntries.unshift(
        { name: '00_セットリスト・使用素材一覧.txt', data: strToBytes(docs.txt), store: false },
        { name: '00_セットリスト・使用素材一覧.html', data: strToBytes(docs.html), store: false }
      );

      const fname = 'assets_setlist_' + safeName(d.roomName) + '_' + ts() + '.zip';
      let fileLabel = fname, byteLen = 0, cloudData = null;
      lastZipName = fname; lastZipFilePath = ''; lastZipBlob = null;
      if (isElec) {
        const file = path.join(exportDir(), fname);
        const r = zipWriter().writeZip(file, zipEntries);
        fileLabel = file; byteLen = r.bytes; lastZipFilePath = file;
        if (saveToCloudToo) cloudData = fs.readFileSync(file);
      } else {
        const blob = await WebBridge.buildZipBlob(zipEntries);
        lastZipBlob = blob; byteLen = blob.size; cloudData = blob;
        if (!cloudOnly) WebBridge.downloadBlob(blob, fname, 'application/zip');
      }
      let cloudMsg = '';
      if (saveToCloudToo && window.CloudSync && typeof CloudSync.uploadExportFile === 'function') {
        say('☁️ クラウドの exports/ へ保存しています…');
        try {
          const upRes = await CloudSync.uploadExportFile(fname, cloudData, 'application/zip');
          if (upRes && upRes.ok) {
            cloudMsg = `<div class="ccf-muted" style="color:var(--dc-green);font-weight:bold;">☁️ クラウド保存済み：${esc(upRes.destinations.join(' / '))}</div>`;
          }
        } catch (ce) {
          console.error('[ccf] クラウド直接保存エラー', ce);
          cloudMsg = `<div class="ccf-wiz-warn">⚠️ クラウド保存に失敗: ${esc(ce && ce.message || ce)}</div>`;
        }
      }
      const totalMedia = counts.fg + counts.bg + counts.panel + counts.npc + counts.bgm + counts.cutin;
      const resEl = W.el && W.el.querySelector('[data-wresult]');
      if (resEl) {
        resEl.innerHTML = `<div class="ccf-wiz-result"><b>✅ 素材＆セトリZIPを${cloudOnly ? 'クラウドへ保存しました' : (isElec ? '書き出しました' : 'ダウンロードしました')}</b>
          <div class="ccf-muted">前景 ${counts.fg}・背景 ${counts.bg}・パネル ${counts.panel}・NPC立ち絵 ${counts.npc}・BGM/SE ${counts.bgm}・カットイン ${counts.cutin}（計 ${totalMedia}ファイル＋セトリTXT/HTML / ${Math.round(byteLen / 1024).toLocaleString()} KB）</div>
          <div class="ccf-wiz-path">${esc(fileLabel)}</div>
          <div data-wcloud-res>${cloudMsg}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            ${isElec ? `<button type="button" class="ccf-btn" data-w="open" data-path="${esc(fileLabel)}">📂 フォルダで表示</button>` : `<button type="button" class="ccf-btn" data-w="dl-zip">💾 ${cloudOnly ? 'PCにもダウンロード' : 'もう一度ダウンロード'}</button>`}
            ${!saveToCloudToo ? `<button type="button" class="ccf-btn" data-w="upload-zip-cloud">☁️ クラウド（exports/）へ直接保存</button>` : ''}
          </div>
          ${warnings.length ? `<div class="ccf-wiz-warn"><b>⚠️ 読み込めなかった素材（${warnings.length}件）</b>${warnings.slice(0, 30).map(w => '<div>' + esc(w) + '</div>').join('')}</div>` : ''}
          <div class="ccf-muted">※ ZIP直下の <code>00_セットリスト・使用素材一覧.html</code> をブラウザで開くと、シーン別の使用素材一覧を表形式で確認できます。</div></div>`;
      }
      W.doneView = true;
      syncWizardTabUi();
      say(cloudOnly ? `☁️ クラウドへ保存しました：${fname}` : ((isElec ? '💾 保存しました：' : '💾 ダウンロードしました：') + fileLabel));
      if (isElec && !cloudOnly) showItem(fileLabel);
    } catch (e) {
      console.error('[ccf] 素材＆セトリZIP出力に失敗', e);
      say('❌ 素材＆セトリZIPの書き出しに失敗しました：' + (e.message || e));
    } finally {
      W.busy = false;
      if (W.el) refreshGroups();
    }
  }

  async function run(cloudOnly) {
    if (!boxes().some(b => b.checked)) return say('出力する要素を選んでください');
    const saveToCloudToo = !!cloudOnly || !!(W.el && W.el.querySelector('#ccfZipSaveCloud') && W.el.querySelector('#ccfZipSaveCloud').checked);
    const sel = selection(), d = W.data;
    W.busy = true; refreshGroups(); say('📦 素材を集めてZIPを作っています…');
    try {
      if (S && S.key && S.key !== '_default' && window.CloudSync && typeof CloudSync.ensureScenarioAssetsCached === 'function') {
        try { await CloudSync.ensureScenarioAssetsCached(S.key, { silent: true }); } catch (_) {}
      }
      const res = await P.buildPackage(sel, resolveSource, { grid: d.grid, roomName: d.roomName, boardWidth: d.boardWidth, boardHeight: d.boardHeight });
      const entries = P.buildZipEntries(res);   // __data.json / .token (66B) / <sha256>.<ext> を ZIP 直下へ
      const fname = (W.mode === 'pieces' ? 'ccfolia_pieces_' : 'ccfolia_room_') + safeName(d.roomName) + '_' + ts() + '.zip';
      let fileLabel = fname, byteLen = 0, cloudData = null;
      lastZipName = fname; lastZipFilePath = ''; lastZipBlob = null;
      if (isElec) {
        const file = path.join(exportDir(), fname);
        const r = zipWriter().writeZip(file, entries);
        fileLabel = file; byteLen = r.bytes; lastZipFilePath = file;
        if (saveToCloudToo) cloudData = fs.readFileSync(file);
      } else {
        const blob = await WebBridge.buildZipBlob(entries);
        lastZipBlob = blob; byteLen = blob.size; cloudData = blob;
        if (!cloudOnly) WebBridge.downloadBlob(blob, fname, 'application/zip');
      }
      let cloudMsg = '';
      if (saveToCloudToo && window.CloudSync && typeof CloudSync.uploadExportFile === 'function') {
        say('☁️ クラウドの exports/ へ保存しています…');
        try {
          const upRes = await CloudSync.uploadExportFile(fname, cloudData, 'application/zip');
          if (upRes && upRes.ok) {
            cloudMsg = `<div class="ccf-muted" style="color:var(--dc-green);font-weight:bold;">☁️ クラウド保存済み：${esc(upRes.destinations.join(' / '))}</div>`;
          }
        } catch (ce) {
          console.error('[ccf] クラウド直接保存エラー', ce);
          cloudMsg = `<div class="ccf-wiz-warn">⚠️ クラウド保存に失敗: ${esc(ce && ce.message || ce)}</div>`;
        }
      }
      const c = res.counts, resEl = W.el && W.el.querySelector('[data-wresult]');
      if (resEl) resEl.innerHTML = `<div class="ccf-wiz-result"><b>✅ ${cloudOnly ? 'クラウドへ保存しました' : (isElec ? '書き出しました' : 'ダウンロードしました')}</b><div class="ccf-muted">駒 ${c.characters}・シーン ${c.scenes}・オブジェクト ${c.items}・素材 ${res.files.size}点（${Math.round(byteLen / 1024).toLocaleString()} KB）</div>
        <div class="ccf-wiz-path">${esc(fileLabel)}</div>
        <div data-wcloud-res>${cloudMsg}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${isElec ? `<button type="button" class="ccf-btn" data-w="open" data-path="${esc(fileLabel)}">📂 フォルダで表示</button>` : `<button type="button" class="ccf-btn" data-w="dl-zip">💾 ${cloudOnly ? 'PCにもダウンロード' : 'もう一度ダウンロード'}</button>`}
          ${!saveToCloudToo ? `<button type="button" class="ccf-btn" data-w="upload-zip-cloud">☁️ クラウド（exports/）へ直接保存</button>` : ''}
          <button type="button" class="ccf-btn" data-w="export-bgm" title="部屋・全シーン・カットインで使用している音声ファイルを別ZIPで書き出します">🎵 使用BGM・SEを別ZIPで書き出す</button>
        </div>
        ${res.warnings.length ? `<div class="ccf-wiz-warn"><b>⚠️ 読み込めなかった素材（${res.warnings.length}件）</b>${res.warnings.slice(0, 30).map(w => '<div>' + esc(w) + '</div>').join('')}</div>` : ''}
        <div class="ccf-muted">※ ココフォリアの「ルーム」→「ルームデータの読み込み」でこのZIPを選んでください。</div></div>
        <div data-wbgm-res></div>`;
      W.doneView = true;
      syncWizardTabUi();
      say(cloudOnly ? `☁️ クラウドへ保存しました：${fname}` : ((isElec ? '💾 保存しました：' : '💾 ダウンロードしました：') + fileLabel));
      if (isElec && !cloudOnly) showItem(fileLabel);
    } catch (e) { console.error('[ccf] ZIP出力に失敗', e); say('❌ ZIPの書き出しに失敗しました：' + (e.message || e)); }
    finally { W.busy = false; if (W.el) refreshGroups(); }
  }

  CCF.ccfExport = { openWizard, closeWizard, resolveSource, readRef, collect, exportDir, safeName, ts, exportBgmFolder, exportBgmZip: exportBgmFolder, runAssetsSetlistZip };
})();
