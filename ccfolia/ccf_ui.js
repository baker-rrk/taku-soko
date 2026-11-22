/* ccf_ui.js — ココフォリア特化ツール Phase 1：画面の骨組み（黄金レイアウト）・プロジェクト保存・抽出バッファ・シナリオテキスト一覧
 *
 *   ┌───────────── ツールバー（プロジェクト選択／Z軸タブ） ─────────────┐
 *   │ 左：PDFビューア │ 中央：データ入力（抽出バッファ／ストック／NPC） │ 右：設定 │
 *   ├───────────────────── 下部トレイ：マイライブラリ ─────────────────────┤
 *
 *  - PDF ビューアの本体は ccf_pdf_viewer.js（左ペインと、切り離した別ウィンドウで共用）。
 *    別ウィンドウに切り離している間は、そちらで選んだ文字列が IPC（ccf:extract）でここへ届き、同じ抽出バッファに入る。
 *  - Phase 2 以降（プレビュー画面・シーン構築・全体装飾・カットイン）は、ボタンを無効表示にするだけで未実装。
 *  - 既存アプリのグローバル（IS_ELECTRON / fs / path / DATA_ROOT / appState / switchTab / toast / appConfirm）を再利用する。 */
(function () {
  'use strict';
  const T = window.CCFText, N = window.CCFNpc, M = window.CCFModel;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = m => { try { if (typeof toast === 'function') return toast(m); } catch (e) { if (typeof logSoft === 'function') logSoft('ccfSay', e); } console.log(m); };
  const electron = IS_ELECTRON ? require('electron') : {};
  const ipc = electron.ipcRenderer || null;
  const CCF = window.CCF = { $, esc, say, electron, S: { key: '_default', roomId: null, rooms: [], proj: M.sanitizeProject(null), bufRaw: '', bufDirty: false, view: 'stocks', popped: false }, viewer: null };
  const S = CCF.S;

  // ======================================================================
  // 1. プロジェクト・部屋データの保存（シナリオごとの1対多管理）
  // ======================================================================
  const safeKey = k => String(k || '_default').replace(/[^\w-]/g, '_');
  const APP_DIR = IS_ELECTRON ? path.dirname(DATA_ROOT) : '';
  const projFile = k => IS_ELECTRON ? path.join(DATA_ROOT, 'ccfolia', 'projects', safeKey(k) + '.json') : '';
  const isAssetRef = p => !!(window.WebBridge && WebBridge.isAssetRef(p));
  const isCloudRef = p => !!(window.CloudSync && CloudSync.isCloudAssetRef && CloudSync.isCloudAssetRef(p));
  const isDocTextRef = p => /^doc-text:\/\//i.test(String(p || ''));
  const baseName = p => {
    if (isDocTextRef(p)) { const dt = findDocTextForPath(p); return (dt && dt.name) || '同期テキスト'; }
    if (isCloudRef(p)) { const parsed = CloudSync.parseCloudAssetRef(p); return (parsed && parsed.name) || 'asset'; }
    return isAssetRef(p) ? WebBridge.assetBasename(p) : ((IS_ELECTRON && path) ? path.basename(p) : String(p || '').split(/[\\/]/).pop());
  };
  const normDocTextName = s => String(s || '').normalize('NFKC').trim().toLowerCase();
  function findDocTextForPath(p, name) {
    try {
      const sc = scenarioObj(S && S.key);
      const list = (sc && Array.isArray(sc.docTexts)) ? sc.docTexts : [];
      if (!list.length) return null;
      const sp = String(p || '');
      if (isDocTextRef(sp)) {
        const id = sp.slice('doc-text://'.length);
        const byId = list.find(d => d && d.text && String(d.id || '') === id);
        if (byId) return byId;
      }
      const rawName = name || (isCloudRef(sp) ? ((CloudSync.parseCloudAssetRef(sp) || {}).name || '') : (isAssetRef(sp) ? WebBridge.assetBasename(sp) : sp.split(/[\\/]/).pop()));
      const nm = normDocTextName(rawName);
      return nm ? (list.find(d => d && d.text && normDocTextName(d.name) === nm) || null) : null;
    } catch (_) { return null; }
  }
  const canOpenLocalOrCloudDoc = p => {
    if (!p || isDocTextRef(p)) return false;
    const canCloud = !!(window.CloudSync && CloudSync.canDownloadFromCloud && CloudSync.canDownloadFromCloud());
    if (isCloudRef(p)) return canCloud || !!(window.CloudSync && CloudSync.isAssetRefLocallyCachedSync && CloudSync.isAssetRefLocallyCachedSync(p));
    if (isAssetRef(p)) return !window.WebBridge || WebBridge.hasAssetSync(p) || canCloud;
    return !!(IS_ELECTRON && fs && (fs.existsSync(p) || canCloud));
  };
  const canOpenDocPath = p => !!(canOpenLocalOrCloudDoc(p) || findDocTextForPath(p));
  CCF.safeKey = safeKey; CCF.APP_DIR = APP_DIR;

  function scenarioObj(k) {
    return scenarioList().find(s => String(s.id) === String(k));
  }

  // 未オープンのシナリオ（ccfRooms 無し）の毎回のディスク読込を防ぐ読み取りキャッシュ
  const roomContainerCache = new Map();
  CCF.invalidateRoomCache = k => { if (k == null) roomContainerCache.clear(); else roomContainerCache.delete(String(k || '_default')); };

  function getRoomContainer(k) {
    k = k || '_default';
    const sc = scenarioObj(k);
    if (sc && Array.isArray(sc.ccfRooms) && sc.ccfRooms.length) {
      return M.sanitizeRoomContainer({
        version: 2,
        activeRoomId: sc.ccfActiveRoomId,
        rooms: sc.ccfRooms
      });
    }
    if (k === '_default' && typeof appState !== 'undefined' && Array.isArray(appState.unlinkedCcfRooms) && appState.unlinkedCcfRooms.length) {
      return M.sanitizeRoomContainer({
        version: 2,
        activeRoomId: appState.unlinkedCcfActiveRoomId,
        rooms: appState.unlinkedCcfRooms
      });
    }
    const ck = String(k);
    if (roomContainerCache.has(ck)) return roomContainerCache.get(ck);
    let raw = null;
    try {
      if (IS_ELECTRON) {
        const f = projFile(k);
        if (fs.existsSync(f)) raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      } else {
        const s = localStorage.getItem('ccf_project_' + safeKey(k));
        if (s) raw = JSON.parse(s);
      }
    } catch (e) {
      console.warn('[ccf] 保存データを読めませんでした', e);
    }
    // 読み取り関数なので saveState() は呼ばない（保存は saveRoomContainer のみ）。結果はメモリにキャッシュして再読込を防ぐ
    const container = M.sanitizeRoomContainer(raw);
    roomContainerCache.set(ck, container);
    return container;
  }

  /** JSON 化・複製用：先頭が _ の親参照キー（_rooms / _currentRoom など）を除外して循環参照を切る */
  const ccfReplacer = (key, v) => (typeof key === 'string' && key.charAt(0) === '_') ? undefined : v;
  const ccfClone = x => JSON.parse(JSON.stringify(x, ccfReplacer));
  CCF.ccfReplacer = ccfReplacer; CCF.ccfClone = ccfClone;

  function saveRoomContainer(k, container, opts) {
    const pdfPosOnly = !!(opts && opts.pdfPosOnly);
    k = k || '_default';
    container = M.sanitizeRoomContainer(container);
    roomContainerCache.delete(String(k));
    const sc = scenarioObj(k);
    if (sc) {
      sc.ccfRooms = container.rooms;
      sc.ccfActiveRoomId = container.activeRoomId;
      if (!pdfPosOnly && typeof saveState === 'function') saveState();
    } else if (k === '_default' && typeof appState !== 'undefined') {
      appState.unlinkedCcfRooms = container.rooms;
      appState.unlinkedCcfActiveRoomId = container.activeRoomId;
      if (!pdfPosOnly && typeof saveState === 'function') saveState();
    }
    if (String(k) === String(S.key)) {
      S.rooms = container.rooms;
      if (container.activeRoomId && S.rooms.some(r => r.id === container.activeRoomId)) {
        S.roomId = container.activeRoomId;
      }
    }
    try {
      const edited = isProjectActuallyEdited(container);
      if (IS_ELECTRON) {
        const f = projFile(k);
        if (!edited) {
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) { }
          try { if (fs.existsSync(f + '.tmp')) fs.unlinkSync(f + '.tmp'); } catch (_) { }
          return true;
        }
        const json = JSON.stringify(container, ccfReplacer, 2);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        try { if (fs.existsSync(f + '.tmp')) fs.unlinkSync(f + '.tmp'); } catch (_) { }
        fs.writeFileSync(f + '.tmp', json, 'utf8');
        try {
          fs.renameSync(f + '.tmp', f);
        } catch (_) {
          fs.writeFileSync(f, json, 'utf8');
          try { if (fs.existsSync(f + '.tmp')) fs.unlinkSync(f + '.tmp'); } catch (_e) { }
        }
      } else {
        if (!edited) localStorage.removeItem('ccf_project_' + safeKey(k));
        else localStorage.setItem('ccf_project_' + safeKey(k), JSON.stringify(container, ccfReplacer, 2));
      }
      if (!pdfPosOnly && edited && window.CloudSync && typeof window.CloudSync.onRoomSaved === 'function') {
        window.CloudSync.onRoomSaved(k, container);
      }
      return true;
    } catch (e) {
      console.error('[ccf] 保存失敗', e);
      return false;
    }
  }

  function readProject(k, roomId) {
    const container = getRoomContainer(k);
    const room = (roomId && container.rooms.find(r => r.id === roomId))
      || container.rooms.find(r => r.id === container.activeRoomId)
      || container.rooms[0];
    const proj = room ? room.project : M.sanitizeProject(null);
    // 親参照（_rooms / _currentRoom）は列挙不可にして、JSON.stringify・Object.assign・ディープコピーに巻き込まれないようにする（循環参照の防止）
    const hide = (k, v) => Object.defineProperty(proj, k, { value: v, enumerable: false, writable: true, configurable: true });
    hide('_rooms', container.rooms); hide('_activeRoomId', container.activeRoomId); hide('_currentRoom', room);
    return proj;
  }

  // ---- PDF閲覧位置（page / zoom / pdfPos）の軽量保存（localStorage）と遅延反映 ----
  let pdfPosDirty = false;
  const pdfPosStorageKey = (k, roomId) => 'ccf_pdf_pos_' + safeKey(k || '_default') + '_' + safeKey(roomId || 'default');
  function savePdfPosLocal(k, roomId, proj, extra) {
    if (!proj) return;
    try {
      const payload = Object.assign({
        pdf: proj.pdf ? { path: String(proj.pdf.path || ''), page: Number(proj.pdf.page) || 1, zoom: Number(proj.pdf.zoom) || 1.2 } : { path: '', page: 1, zoom: 1.2 },
        pdfPos: proj.pdfPos || {},
        updatedAt: Date.now()
      }, extra || {});
      localStorage.setItem(pdfPosStorageKey(k, roomId), JSON.stringify(payload));
    } catch (_) { }
  }
  function applyLocalPdfPos(k, roomId, proj, roomUpdatedAt) {
    if (!proj) return;
    try {
      const raw = localStorage.getItem(pdfPosStorageKey(k, roomId));
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      if (saved.pdfPos && typeof saved.pdfPos === 'object') {
        proj.pdfPos = Object.assign({}, proj.pdfPos || {}, saved.pdfPos);
      }
      const savedAt = Number(saved.updatedAt) || 0;
      const roomAt = Number(roomUpdatedAt) || 0;
      if (saved.pdf && typeof saved.pdf === 'object') {
        const sp = String(saved.pdf.path || '');
        const curPath = (proj.pdf && proj.pdf.path) ? String(proj.pdf.path) : '';
        if (sp && (!curPath || curPath === sp || savedAt >= roomAt)) {
          proj.pdf = {
            path: sp,
            page: Math.max(1, Number(saved.pdf.page) || 1),
            zoom: Math.min(4, Math.max(0.4, Number(saved.pdf.zoom) || 1.2))
          };
        } else if (saved.cleared && savedAt >= roomAt) {
          proj.pdf = { path: '', page: 1, zoom: Math.min(4, Math.max(0.4, Number(saved.pdf.zoom) || (proj.pdf && proj.pdf.zoom) || 1.2)) };
        }
      }
    } catch (_) { }
  }
  function flushPdfPosToRoom() {
    if (saveTimer) { saveProject(true); return; }
    if (!pdfPosDirty) return;
    pdfPosDirty = false;
    if (!S.proj) return;
    writeProject(S.key, S.proj, S.roomId, { pdfPosOnly: true });
  }

  function writeProject(k, proj, roomId, opts) {
    const pdfPosOnly = !!(opts && opts.pdfPosOnly);
    k = k || S.key || '_default';
    const container = getRoomContainer(k);
    const rId = roomId || S.roomId || container.activeRoomId;
    const now = Date.now();
    let room = container.rooms.find(r => r.id === rId);
    if (!room) {
      room = { id: rId || M.newId(), name: 'メイン部屋', createdAt: now, updatedAt: now, project: proj };
      container.rooms.push(room);
    } else {
      room.project = proj;
      if (!pdfPosOnly) room.updatedAt = now;
    }
    container.activeRoomId = room.id;
    if (String(k) === String(S.key) && Array.isArray(S.rooms)) {
      const sr = S.rooms.find(r => r.id === room.id);
      if (sr) { sr.project = proj; if (!pdfPosOnly) sr.updatedAt = now; }
      else S.rooms.push(room);
      if (room.id === S.roomId) {
        S.proj = proj;
        pdfPosDirty = false;
      }
    }
    const ok = saveRoomContainer(k, container, opts);
    if (!pdfPosOnly) {
      if (CCF.assets && CCF.assets.invalidateUnified) CCF.assets.invalidateUnified(k);
      if (String(k) === String(S.key) && typeof renderRoomSelect === 'function') {
        try { renderRoomSelect(); } catch (e) { if (typeof logSoft === 'function') logSoft('renderRoomSelect', e); }
      }
    }
    return ok;
  }

  let saveTimer = null;
  function saveProject(now) {
    clearTimeout(saveTimer);
    if (now) { saveTimer = null; writeProject(S.key, S.proj, S.roomId); }
    else saveTimer = setTimeout(() => { saveTimer = null; writeProject(S.key, S.proj, S.roomId); }, 400);
  }
  window.addEventListener('beforeunload', () => { flushPdfPosToRoom(); });
  window.addEventListener('pagehide', () => { flushPdfPosToRoom(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushPdfPosToRoom(); });

  function withProject(key, fn) {
    key = key || '_default';
    if (key === S.key) { const r = fn(S.proj); saveProject(true); return r; }
    const p = readProject(key), r = fn(p); writeProject(key, p, p._activeRoomId); return r;
  }
  CCF.saveProject = saveProject; CCF.flushSave = () => { flushPdfPosToRoom(); }; CCF.readProject = readProject; CCF.withProject = withProject;
  CCF.getRoomContainer = getRoomContainer; CCF.saveRoomContainer = saveRoomContainer;

  // ======================================================================
  // 2. 画面の骨組み（2ペイン＋上部サブタブ）
  // ======================================================================
  const cp = label => { if (typeof window !== 'undefined' && window.AppHistory) window.AppHistory.checkpoint(label); };
  function buildShell() {
    const root = $('ccfTab'); if (!root || root.dataset.built) return; root.dataset.built = '1';
    root.innerHTML = `
<div class="ccf-root">
  <div class="ccf-toolbar">
    <div class="ccf-proj-bar">
      <div class="ccf-proj-selector">
        <span class="ccf-bar-label">📖 シナリオ</span>
        <div class="qs-wrap ccf-qs-wrap" id="ccfScenarioQsWrap">
          <input type="text" id="ccfScenarioSearch" placeholder="🔍 シナリオを検索・選択（スペースでAND）" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="ccfScenarioResults">
          <div id="ccfScenarioResults" class="qs-results" role="listbox"></div>
        </div>
        <button type="button" class="ccf-btn" id="ccfResetProjectBtn" title="編集中プロジェクトを自動保存して未選択の初期画面へ戻ります">✕ 選択解除</button>
      </div>
      <div class="ccf-room-selector">
        <span class="ccf-bar-label">🏠 部屋</span>
        <select id="ccfRoomSelect" aria-label="部屋データ選択"></select>
        <button type="button" class="ccf-btn" id="ccfAddRoomBtn" title="このシナリオに新しい部屋設定データを追加">＋ 新規</button>
        <button type="button" class="ccf-btn" id="ccfRenameRoomBtn" title="現在の部屋データの名前を変更">✏️ 変更</button>
        <button type="button" class="ccf-btn" id="ccfCopyRoomBtn" title="現在の部屋データを複製（同シナリオまたは別シナリオへ使い回し）">📋 複製</button>
        <button type="button" class="ccf-btn" id="ccfLinkRoomBtn" title="この部屋データを別のシナリオへ紐付け・移動" style="display:none;">🔗 シナリオへ紐付け</button>
        <button type="button" class="ccf-btn danger" id="ccfDelRoomBtn" title="現在の部屋データを削除">🗑️</button>
      </div>
    </div>
    <span class="ccf-hint">PDF・TXT・HTML・フォルダ・ZIP をドラッグ＆ドロップで登録 ／ Ctrl+Zで元に戻す</span>
  </div>
  <div class="ccf-main">
    <section class="ccf-pane ccf-left" id="ccfLeft" aria-label="シナリオビューア"></section>

    <section class="ccf-pane ccf-center ccf-right" id="ccfCenter" aria-label="作業エリア">
      <div class="ccf-rtabs" role="tablist">
        <button type="button" role="tab" class="ccf-rtab active" data-view="stocks" aria-selected="true" title="テキスト・情報駒"><span class="ccf-rtab-lbl">📝 テキスト・情報駒</span><span class="ccf-rtab-cnt">(<span id="ccfStockCount">0</span>)</span></button>
        <button type="button" role="tab" class="ccf-rtab" data-view="npcs" aria-selected="false" title="NPC管理"><span class="ccf-rtab-lbl">👤 NPC管理</span><span class="ccf-rtab-cnt">(<span id="ccfNpcCount">0</span>)</span></button>
        <button type="button" role="tab" class="ccf-rtab" data-view="scene" aria-selected="false" title="シーン・部屋構築"><span class="ccf-rtab-lbl">🎬 シーン・部屋構築</span><span class="ccf-rtab-cnt">(<span id="ccfSceneCount">0</span>)</span></button>
        <button type="button" role="tab" class="ccf-rtab" data-view="assets" aria-selected="false" title="素材確認"><span class="ccf-rtab-lbl">📌 素材確認</span><span class="ccf-rtab-cnt">(<span id="ccfAssetCount">0</span>)</span></button>
        <button type="button" class="ccf-btn ccf-zoom-btn" data-zoom="1" title="作業エリアを画面いっぱいに拡大します（Esc で戻る）">🗗 拡大表示</button>
      </div>
      <div class="ccf-buffer" id="ccfBufferBox">
        <div class="ccf-pane-head ccf-buf-head"><b>✂️ 抽出バッファ</b><span class="ccf-muted" id="ccfBufInfo"></span>
          <div class="ccf-buf-extchks" aria-label="抽出オプション">
            <label class="ccf-chk" title="選択範囲の本文フォントサイズ（中央値）の70%未満の極小文字をルビとみなして除外します"><input type="checkbox" data-ext="ruby"> ルビを除外</label>
            <label class="ccf-chk" title="左右2段組と判定したら「左段の上→下 → 右段の上→下」の順に並べます"><input type="checkbox" data-ext="twoCol"> 2段組を自動整列</label>
            <label class="ccf-chk" title="1行目が短い見出し行（30文字以下、または【】▼■などで始まる）なら、1行目をタイトル欄・2行目以降を本文欄へ振り分けます"><input type="checkbox" data-ext="autoTitle"> 1行目を自動タイトル化</label>
          </div>
          <span class="ccf-spacer"></span>
          <button type="button" class="ccf-btn" data-b="clean" title="改行・空白の整形を実行">🧹 整形</button>
          <button type="button" class="ccf-btn" data-b="clear">クリア</button></div>
        <div class="ccf-buf-fields">
          <input type="text" id="ccfBufTitle" class="ccf-buf-title" placeholder="タイトル（テキスト一覧の見出し）" aria-label="タイトル欄" autocomplete="off">
          <textarea id="ccfBuf" rows="3" placeholder="PDF/TXT/HTMLで選択したテキストがここに入ります。直接入力・修正もできます。"></textarea>
        </div>
        <div class="ccf-tools ccf-buf-tools" aria-label="テキスト変換ツール">
          <span class="ccf-tools-label">🔤 英数字</span>
          <button type="button" class="ccf-btn" data-b="half" title="全角の英数字（ＨＯ１ ＡＢＣ １２３）をすべて半角にそろえる">半角にそろえる</button>
          <button type="button" class="ccf-btn" data-b="full" title="半角の英数字（HO1 ABC 123）をすべて全角にそろえる">全角にそろえる</button>
          <span class="ccf-sep"></span>
          <span class="ccf-tools-label">{ } 変数化</span>
          <input type="text" id="ccfWrapWord" placeholder="単語（例: HO1）" aria-label="波括弧で囲む単語" autocomplete="off">
          <button type="button" class="ccf-btn" data-b="wrap" title="テキスト内のその単語をすべて {単語} に置き換える">{ } で囲む</button>
          <label class="ccf-chk" title="HO1 を HO10 の中では置換しない"><input type="checkbox" id="ccfWrapWhole" checked> 単語単位</label>
          <label class="ccf-chk" title="下のシナリオテキスト一覧の全文にも同じ変換を行う"><input type="checkbox" id="ccfApplyAll"> 一覧のテキストにも適用</label>
        </div>
        <div class="ccf-buffer-actions">
          <button type="button" class="ccf-btn primary" data-b="stock">📝 テキスト一覧に追加</button>
          <button type="button" class="ccf-btn accent" data-b="npc">👤 NPC生成</button>
          <span class="ccf-muted">NPCのステータスブロックを選択して「NPC生成」→ 確認・修正ウィンドウが開きます</span>
        </div>
      </div>
      <div class="ccf-list" id="ccfList"></div>
      <div class="ccf-subpanel" id="ccfScenePanel" hidden>
        <div class="ccf-scene-scroll">
          <div class="ccf-scene-card" id="ccfSceneSummary"></div>
          <div class="ccf-scene-ztabs" id="ccfSceneSubtabs" role="tablist">
            <button type="button" role="tab" class="ccf-ztab active" data-zsub="board">🖥️ ① 盤面・シーン編集</button>
            <button type="button" role="tab" class="ccf-ztab" data-zsub="scenes">📑 ② シーン分割・本文整理</button>
            <button type="button" role="tab" class="ccf-ztab" data-zsub="cutin">⚡ ③ 演出・カットイン</button>
          </div>
          <div id="ccfSceneWorkspace"></div>
        </div>
      </div>
      <div class="ccf-subpanel" id="ccfAssetsPanel" hidden>
        <div class="ccf-assets-head">
          <div class="ccf-assets-title">
            <b>📌 シナリオ登録素材</b>
            <span class="ccf-muted" id="ccfAssetsSummary"></span>
          </div>
          <div class="ccf-assets-head-btns">
            <button type="button" class="ccf-btn" data-sync-assets="1" title="マイライブラリ・監視フォルダを再スキャンします">🔄 フォルダ同期</button>
            <button type="button" class="ccf-btn" data-add-assets="1" title="PCからファイルを選んで素材に追加します">📥 追加</button>
            <button type="button" class="ccf-btn primary" data-open-assets-modal="1" title="登録素材・マイライブラリを大画面の2ペインで整理します">🗗 拡大管理</button>
          </div>
        </div>
        <div class="ccf-tray-body" id="ccfTrayBody"></div>
      </div>
    </section>
  </div>
</div>`;
    createViewer(); renderProps();
    { const eo = window.CCFPdfViewer.extOpts(); root.querySelectorAll('[data-ext]').forEach(c => { c.checked = !!eo[c.dataset.ext]; }); }
  }

  function settingHelpers() {
    const s = S.proj.settings;
    const sel = (k, opts) => `<select data-set="${k}">${opts.map(([v, l]) => `<option value="${v}"${String(s[k]) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const chk = (k, label) => `<label class="ccf-chk"><input type="checkbox" data-set="${k}"${s[k] ? ' checked' : ''}> ${label}</label>`;
    const num = (k, min, max) => `<input type="number" data-set="${k}" min="${min}" max="${max}" value="${esc(s[k])}">`;
    return { s, sel, chk, num };
  }
  function textSettingsHtml() {
    const { s, sel, chk, num } = settingHelpers();
    return `<div class="ccf-props ccf-settings-drawer" data-ccf-settings="text">
<fieldset><legend>✂️ 抽出・整形</legend>
  <label>改行の除去 ${sel('joinLines', [['smart', 'スマート（折り返しだけ除去）'], ['all', 'すべて除去（段落は残す）'], ['none', '除去しない']])}</label>
  ${chk('stripSpaces', '不要な空白を除去（日本語の間・連続空白）')}
  ${chk('autoClean', '抽出と同時に自動整形する')}
  ${chk('alwaysAppend', '常に追記する（OFFならShift+選択で追記）')}
</fieldset>
<fieldset><legend>🧩 ダミー駒（シナリオテキスト）</legend>
  <label>駒の名前 <input type="text" data-set="pieceName" value="${esc(s.pieceName)}"></label>
  ${chk('includeTitle', '各行の先頭に【見出し】を付ける')}
  <label>1行の最大文字数 ${num('maxChars', 50, 5000)}</label>
  <label>1体あたりの最大行数 ${num('maxLines', 1, 200)}</label>
  <div class="ccf-muted">チャットパレットの複数行は「\\n」で1行にまとめます。</div>
</fieldset></div>`;
  }
  function npcSettingsHtml() {
    const { s, sel, chk } = settingHelpers();
    return `<div class="ccf-props ccf-settings-drawer" data-ccf-settings="npc">
<fieldset><legend>👤 NPC生成</legend>
  <label>ゲームシステム（この部屋） ${sel('system', window.CCFSys.SYSTEMS.map(x => [x.id, x.name]))}</label>
  ${chk('statusPublic', 'ステータスを公開する（OFFで非公開）')}
  ${chk('secretDice', 'シークレットダイス（コマンド先頭に s）')}
  ${['coc6'].includes(s.system) ? chk('renda', '連撃（x2）を攻撃技能に併記') + chk('cbrb', 'CBRB（組み合わせ）を自動併記') + chk('resb', '対抗ロール RESB を併記') : ''}
  ${s.system === 'coc7' ? chk('hardExt', 'ハード/イクストリームを併記') + chk('bpDice', 'ボーナス/ペナルティダイス B1/P1') : ''}
  ${s.system === 'stratera' || s.system === 'madamis' ? '<div class="ccf-muted">このシステムはダイス出力なし（メモ欄・宣言チャパレ中心）</div>' : ''}
  ${chk('abilityRolls', '能力値・SANチェックのロールもチャパレに入れる')}
</fieldset></div>`;
  }
  CCF.textSettingsHtml = textSettingsHtml;
  CCF.npcSettingsHtml = npcSettingsHtml;

  // ---- 右ペイン：シーン・部屋構築サマリ（シーンタブ表示時のみシーンUIを描画） ----
  function renderProps() {
    const scBox = $('ccfSceneSummary');
    if (scBox) {
      const sc = scenarioObj(S.key), curRoom = S.rooms.find(r => r.id === S.roomId);
      scBox.innerHTML = `<div class="ccf-scene-card-head">
        <div><b>🎬 部屋・シーン構築</b> <span class="ccf-muted">${esc(sc ? (sc.title || '無題') : '（シナリオ未選択）')} / ${esc(curRoom ? curRoom.name : 'メイン部屋')}</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="ccf-btn accent" data-scene-act="dummy"${S.proj.stocks.length ? '' : ' disabled'}>🧩 ダミー駒を生成</button>
          <button type="button" class="ccf-btn" data-scene-act="add-room">＋ 新規部屋</button>
          <button type="button" class="ccf-btn" data-scene-act="dup-room">📋 部屋を複製</button>
          <button type="button" class="ccf-btn accent" data-scene-act="zip-export" title="ココフォリア v1.1.0 形式のルーム／駒ZIPを書き出し（欲しい要素だけ選べます）">📦 ココフォリアZIP出力</button>
          <button type="button" class="ccf-btn" data-scene-act="zip-import" title="ココフォリアから出力したルームZIPを部屋として取り込む（ZIPのドラッグ＆ドロップでも可）">📥 ココフォリアZIPを取り込む</button>
          <button type="button" class="ccf-btn" data-scene-act="doc-export" title="GM進行用HTML／しおり付きPDF／整形TXT">📤 シナリオ資料を再出力</button>
        </div>
      </div>
      <div class="ccf-muted">シーン ${(S.proj.scenes || []).length}件 / カットイン ${(S.proj.cutins || []).length}件 / テキスト ${S.proj.stocks.length}件 / NPC ${S.proj.npcs.length}体 / しおり ${(S.proj.bookmarks || []).length}件</div>`;
    }
    if (S.view === 'scene' && CCF.sceneUI) { CCF.sceneUI.wire(); CCF.sceneUI.render(); }
  }
  function onSetting(e) {
    const el = e.target.closest('[data-set]'); if (!el) return;
    cp('設定変更');
    const k = el.dataset.set; let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') { if (v === '') return; v = Number(v); }
    S.proj.settings = M.sanitizeSettings(Object.assign({}, S.proj.settings, { [k]: v }));
    saveProject(); if (k === 'system') renderCenter();
  }

  // ======================================================================
  // 3. プロジェクト・部屋切り替え（サジェスト付き検索・1対多管理）
  // ======================================================================
  function scenarioList() { try { return (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : []; } catch (e) { return []; } }

  function renderScenarioSearch() {
    const inp = $('ccfScenarioSearch'), rst = $('ccfResetProjectBtn'), lnk = $('ccfLinkRoomBtn');
    if (!inp) return;
    if (S.key === '_default') {
      inp.value = '';
      inp.placeholder = '🔍 （シナリオ未選択）検索して切替…';
      if (rst) rst.disabled = true;
      if (lnk) lnk.style.display = 'inline-block';
    } else {
      const sc = scenarioList().find(s => String(s.id) === S.key);
      inp.value = sc ? sc.title : S.key;
      inp.placeholder = '🔍 シナリオを検索・切替…';
      if (rst) rst.disabled = false;
      if (lnk) lnk.style.display = 'none';
    }
  }

  function wireScenarioSearch() {
    const inp = $('ccfScenarioSearch'), box = $('ccfScenarioResults'), rst = $('ccfResetProjectBtn');
    if (!inp || !box || inp.dataset.wired) return;
    inp.dataset.wired = '1';
    let items = [], active = -1;
    const close = () => { box.style.display = 'none'; active = -1; inp.setAttribute('aria-expanded', 'false'); };
    const pick = i => {
      const it = items[i]; if (!it) return;
      close();
      switchProject(it.key);
    };
    const paint = () => {
      box.querySelectorAll('.qs-item').forEach((e, i) => {
        e.classList.toggle('active', i === active);
        e.setAttribute('aria-selected', String(i === active));
      });
      const a = box.querySelector('.qs-item.active'); if (a) a.scrollIntoView({ block: 'nearest' });
    };
    const render = () => {
      const q = inp.value.trim();
      const terms = (typeof parseQuery === 'function') ? parseQuery(q) : q.toLowerCase().split(/\s+/).filter(Boolean);
      const titleHit = sc => terms.every(t => (sc.title || '').toLowerCase().includes(t)) ? 0 : 1;
      let list = scenarioList();
      if (terms.length) {
        list = list.filter(sc => (typeof matchQuery === 'function') ? matchQuery(sc, terms) : terms.every(t => (sc.title || '').toLowerCase().includes(t)));
        list.sort((a, b) => (titleHit(a) - titleHit(b)) || ((b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)));
      } else {
        list = list.slice().reverse().sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
      }
      items = [{ key: '_default', title: '（シナリオ未選択）', meta: '初期画面・下書き用' }].concat(list.map(sc => ({
        key: String(sc.id),
        title: sc.title || '無題',
        meta: [sc.system, sc.playerCount, sc.playTime].filter(Boolean).join(' / '),
        favorite: !!sc.favorite,
        posted: (sc.postedChannels || []).length
      })));
      active = items.length ? 0 : -1;
      box.innerHTML = items.map((it, i) => `<div class="qs-item" role="option" id="ccf_qs_${i}" data-i="${i}">
        <span class="qs-title">${it.favorite ? '<span style="color:#f0b232;">★</span> ' : ''}${esc(it.title)}</span>
        <span class="qs-meta">${esc(it.meta)}</span>
        ${it.posted ? `<span class="badge badge-posted">✓ ${it.posted}</span>` : ''}
      </div>`).join('');
      box.style.display = 'block'; inp.setAttribute('aria-expanded', 'true'); paint();
    };
    inp.addEventListener('focus', () => { inp.select(); render(); });
    inp.addEventListener('input', render);
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (box.style.display !== 'block') render();
        else if (items.length) {
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          paint();
        }
      } else if (e.key === 'Enter') {
        if (box.style.display === 'block' && active >= 0) { e.preventDefault(); pick(active); }
      } else if (e.key === 'Escape') {
        if (box.style.display === 'block') { e.stopPropagation(); close(); renderScenarioSearch(); }
      }
    });
    box.addEventListener('mousedown', e => {
      const it = e.target.closest('.qs-item');
      if (it) { e.preventDefault(); pick(Number(it.dataset.i)); }
    });
    document.addEventListener('mousedown', e => {
      if (!box.contains(e.target) && e.target !== inp) { close(); renderScenarioSearch(); }
    });
    if (rst) {
      rst.addEventListener('click', () => {
        saveProject(true);
        switchProject('_default');
        say('初期画面（シナリオ未選択）に戻りました');
      });
    }
  }

  function renderRoomSelect() {
    const sel = $('ccfRoomSelect'); if (!sel) return;
    sel.innerHTML = S.rooms.map(r => {
      const nStocks = (r.project && r.project.stocks) ? r.project.stocks.length : 0;
      const nNpcs = (r.project && r.project.npcs) ? r.project.npcs.length : 0;
      return `<option value="${esc(r.id)}"${r.id === S.roomId ? ' selected' : ''}>🏠 ${esc(r.name)} (${nStocks}テキスト / ${nNpcs}NPC)</option>`;
    }).join('');
    const delBtn = $('ccfDelRoomBtn');
    if (delBtn) delBtn.disabled = S.rooms.length <= 1;
    const lnk = $('ccfLinkRoomBtn');
    if (lnk) lnk.style.display = S.key === '_default' ? 'inline-block' : 'none';
  }

  function buildProjectSelect() {
    renderScenarioSearch();
    renderRoomSelect();
  }

  const docListCache = { key: '', base: null };
  function invalidateDocListCache() { docListCache.key = ''; docListCache.base = null; }

  /** ビューアの「表示PDF切り替え」一覧：シナリオの資料（コピー保存分）＋ D&D で登録した絶対パスの PDF（value は絶対パス）。メインPDFを先頭にする */
  function docList() {
    const sc = scenarioList().find(x => String(x.id) === S.key);
    const scDocsCount = (sc && Array.isArray(sc.docs)) ? sc.docs.length : 0;
    const scDocTextsCount = (sc && Array.isArray(sc.docTexts)) ? sc.docTexts.length : 0;
    const refsCount = (S.proj && Array.isArray(S.proj.refs)) ? S.proj.refs.length : 0;
    const curPdfPath = (S.proj && S.proj.pdf && S.proj.pdf.path) ? String(S.proj.pdf.path) : '';
    const cacheKey = `${S.key}|${scDocsCount}|${scDocTextsCount}|${refsCount}|${curPdfPath}`;
    const kindOf = n => { const m = /\.([a-z0-9]+)$/i.exec(n); const e = (m ? m[1] : '').toLowerCase(); return e === 'pdf' ? ['📕', 'PDF'] : e === 'txt' ? ['📃', 'TXT'] : e === 'md' ? ['📝', 'MD'] : ['🌐', 'HTML']; };
    const formatDocs = base => base.map(it => {
      const [ic, tg] = kindOf(it.name);
      const syncTag = (it.isDocText || (!canOpenLocalOrCloudDoc(it.path) && findDocTextForPath(it.path, it.name))) ? '（同期テキスト）' : '';
      return { value: it.path, label: (it.isMain ? '⭐ ' : '') + ic + ' ' + it.name + ' [' + tg + ']' + syncTag + (S.proj.pdfPos && S.proj.pdfPos[it.path] && S.proj.pdfPos[it.path].page > 1 ? '（p.' + S.proj.pdfPos[it.path].page + '）' : '') };
    });
    if (docListCache.base && docListCache.key === cacheKey) {
      return formatDocs(docListCache.base);
    }
    const items = [], byName = new Map(), seenP = new Set();
    const DOCRE = /\.(pdf|txt|md|html?)$/i;
    const isLocalP = p => !!p && !isCloudRef(p) && !isAssetRef(p);
    const nameWithExt = (nm, p, ext) => {
      let n = String(nm || '') || baseName(p || '');
      if (DOCRE.test(n)) return n;
      const bp = baseName(p || ''); if (DOCRE.test(bp)) return bp;
      if (ext) return (n || bp || 'doc') + '.' + String(ext).replace(/^\./, '');
      return n || bp;
    };
    const add = (p, name, ext) => {
      if (!p) return;
      const nm = nameWithExt(name, p, ext); if (!DOCRE.test(nm)) return;
      const pk = String(p).toLowerCase(), nk = nm.toLowerCase();
      if (seenP.has(pk)) return;
      const ex = byName.get(nk);
      if (ex) { if (!isLocalP(ex.path) && isLocalP(p)) { seenP.delete(String(ex.path).toLowerCase()); ex.path = p; seenP.add(pk); } return; }
      seenP.add(pk); const it = { path: p, name: nm }; byName.set(nk, it); items.push(it);
    };
    const exists = p => { try { return !!(fs && fs.existsSync(p)); } catch (e) { return false; } };
    const scanDir = (dir, depth) => {
      if (!(IS_ELECTRON && fs && dir && exists(dir))) return;
      let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      ents.forEach(e => { const fp = path.join(dir, e.name); if (e.isDirectory()) { if (depth > 1 && !/^(node_modules|\.)/.test(e.name)) scanDir(fp, depth - 1); } else if (DOCRE.test(e.name)) add(fp, e.name); });
    };
    ((sc && sc.docs) || []).forEach(d => {
      if (!d) return;
      const rawNm = d.origName || d.name || baseName(d.path || d.ref || d.rel || '') || (d.ext ? (d.name + '.' + d.ext) : '');
      const nm = nameWithExt(rawNm, d.path || d.ref || d.rel, d.ext);
      if (!DOCRE.test(nm)) return;
      let addedLocal = false;
      if (IS_ELECTRON && path && DATA_ROOT && d.rel) {
        try { const abs = path.resolve(DATA_ROOT, d.rel); if (exists(abs)) { add(abs, nm); addedLocal = true; } } catch (e) { if (typeof logSoft === 'function') logSoft('docListDocs', e); }
      }
      if (!addedLocal && d.path && isLocalP(d.path) && exists(d.path)) { add(d.path, nm); addedLocal = true; }
      if (!addedLocal && d.ref) add(d.ref, nm);
      if (!addedLocal && d.cloudSha) add(`cloud-asset://${d.cloudSha}/${encodeURIComponent(nm)}`, nm);
      if (!addedLocal && d.path) add(d.path, nm);
    });
    if (IS_ELECTRON && path && DATA_ROOT && sc && sc.id) scanDir(path.join(DATA_ROOT, 'scenarios', safeKey(sc.id)), 2);
    const docLike = it => it && (it.type === 'pdf' || it.type === 'doc' || DOCRE.test(it.origName || it.name || it.path || ''));
    const addRef = r => { if (r && (r.type === 'pdf' || r.type === 'doc' || DOCRE.test(r.origName || r.name || r.path || ''))) add(r.path || (r.cloudSha ? `cloud-asset://${r.cloudSha}/${encodeURIComponent(nameWithExt(r.origName || r.name, r.path, r.type === 'pdf' ? 'pdf' : 'txt'))}` : ''), r.origName || r.name, r.type === 'pdf' ? 'pdf' : ''); };
    (S.proj.refs || []).forEach(addRef);
    (S.rooms || []).forEach(rm => ((rm && rm.project && rm.project.refs) || []).forEach(addRef));
    ((sc && sc.ccfRooms) || []).forEach(rm => ((rm && rm.project && rm.project.refs) || []).forEach(addRef));
    try {
      (CCF.assets && CCF.assets.getUnifiedItems ? CCF.assets.getUnifiedItems(S.key) : []).filter(docLike).forEach(it => add(it.path || it.ref || it.value, it.origName || it.name, it.type === 'pdf' ? 'pdf' : ''));
    } catch (e) { if (typeof logSoft === 'function') logSoft('docListUnified', e); }
    if (S.proj.pdf && S.proj.pdf.path) add(S.proj.pdf.path);
    if (IS_ELECTRON && sc && scDocsCount === 0 && sc.sourcePath && exists(sc.sourcePath)) scanDir(sc.sourcePath, 2);
    ((sc && Array.isArray(sc.docTexts)) ? sc.docTexts : []).forEach(dt => {
      if (!dt || !dt.text || !dt.name) return;
      const nk = normDocTextName(dt.name);
      if (!nk || byName.has(nk)) return;
      const dp = 'doc-text://' + String(dt.id || dt.name);
      const it = { path: dp, name: dt.name, isDocText: true };
      seenP.add(dp.toLowerCase());
      byName.set(nk, it);
      items.push(it);
    });
    let main = null; try { if (CCF.scan && items.length > 1) { const r = CCF.scan.pickMainPdf(items, sc ? sc.title : ''); main = r.main; const rest = r.ranked; items.length = 0; rest.forEach(x => items.push(x)); } } catch (e) { if (typeof logSoft === 'function') logSoft('pickMainPdf', e); }
    const base = items.map(it => ({ path: it.path, name: it.name, isMain: it === main, isDocText: !!it.isDocText }));
    docListCache.key = cacheKey;
    docListCache.base = base;
    return formatDocs(base);
  }
  function buildDocSelect() {
    if (!CCF.viewer) return;
    const docs = docList();
    CCF.viewer.setDocs(docs);
    CCF.viewer.setBookmarks(S.proj.bookmarks || []);
    refreshMarks(true);
    if (S.popped) sendPopout('ccf:popout-docs', { docs, pos: S.proj.pdfPos, bookmarks: S.proj.bookmarks || [], marks: marksList() });
  }
  // ---- 抽出済みマーカー（登録済みテキスト・NPCの抽出元範囲をPDF上に描く）／しおり・画像切り抜きの連携 ----
  function marksList() {
    const out = [], one = (kind, label, id, s) => { if (s && s.path && s.rect) out.push({ id, kind, label, path: s.path, page: s.page, rect: s.rect }); };
    S.proj.stocks.forEach((st, i) => (st.srcs || []).forEach(s => one('text', '📝 #' + (i + 1) + (st.title ? ' ' + st.title.slice(0, 10) : ''), st.id, s)));
    S.proj.npcs.forEach(n => (n.srcs || []).forEach(s => one('npc', '👤 ' + n.name, n.id, s)));
    return out;
  }
  let lastMarksJson = '';
  function refreshMarks(force) {
    if (!CCF.viewer) return; const list = marksList(), j = JSON.stringify(list); if (!force && j === lastMarksJson) return; lastMarksJson = j;
    CCF.viewer.setMarks(list); syncPopout(list);
  }
  function syncPopout(marks) { if (S.popped) sendPopout('ccf:popout-docs', { bookmarks: S.proj.bookmarks || [], marks: marks || marksList() }); }
  /** 「📄 P.○」：登録済みテキスト／NPCの抽出元PDFの該当ページへ逆ジャンプ（その範囲を点滅表示） */
  function jumpToSrc(item) {
    const s = item && item.srcs && item.srcs[0], pg = s ? s.page : (item && item.page);
    if (!pg) return say('抽出元のページが記録されていません');
    const targetPath = (s && s.path) ? s.path : ((CCF.viewer && CCF.viewer.state && CCF.viewer.state.path) || (S.proj.pdf && S.proj.pdf.path) || '');
    if (s && s.path && !canOpenDocPath(s.path)) return say('⚠️ 抽出元の資料が見つかりません：' + baseName(s.path));
    if (!targetPath) return say('⚠️ 左ペインで資料を開いてください');
    if (!canOpenLocalOrCloudDoc(targetPath) && findDocTextForPath(targetPath)) {
      return void openPdfPath(targetPath, { page: pg });
    }
    CCF.viewer.navigate(targetPath, pg, s && s.rect ? { rect: s.rect } : null);
  }
  CCF.jumpToSrc = jumpToSrc;

  function getDocIdx(docPath) {
    const target = String(docPath || '').trim().toLowerCase();
    if (!target) return null;
    const docs = docList();
    const idx = docs.findIndex(d => String(d.value || '').toLowerCase() === target);
    return idx >= 0 ? idx : 0;
  }

  const pageLinesCache = new Map();
  function pageCacheKey(docPath, page) {
    return String(docPath || '').trim().toLowerCase() + ':' + (Number(page) || 1);
  }
  function getCachedPageLines(docPath, page) {
    if (CCF.sceneUI && typeof CCF.sceneUI.getPageLines === 'function') {
      const fromScene = CCF.sceneUI.getPageLines(docPath, page);
      if (fromScene && fromScene.length) return fromScene;
    }
    return pageLinesCache.get(pageCacheKey(docPath, page)) || null;
  }
  async function warmPageLinesCache(docPath, page) {
    if (!docPath || !page) return null;
    const existing = getCachedPageLines(docPath, page);
    if (existing) return existing;
    const key = pageCacheKey(docPath, page);
    const SM = window.CCFSceneMatch;
    if (!SM) return null;
    let lines = null;
    try {
      const vSt = CCF.viewer && CCF.viewer.state;
      if (vSt && vSt.doc && String(vSt.path || '').toLowerCase() === String(docPath).toLowerCase()) {
        const pg = await vSt.doc.getPage(Number(page));
        const tc = await pg.getTextContent();
        lines = SM.buildPdfLines([{ page: Number(page), items: tc.items }]);
        try { if (typeof pg.cleanup === 'function') pg.cleanup(); } catch (_) { }
      } else if (isCloudRef(docPath) && window.CloudSync && CloudSync.readCloudAssetBytes) {
        const buf = await CloudSync.readCloudAssetBytes(docPath, { download: true });
        if (buf) {
          if (/\.(?:txt|md)$/i.test(baseName(docPath))) {
            const d = T.loadTextDoc(baseName(docPath), buf);
            lines = SM.extractTxtLines(d.text);
          } else if (/\.html?$/i.test(baseName(docPath))) {
            const dec = T.decodeBytes(buf);
            lines = SM.extractHtmlLines(dec.text);
          }
        }
      } else if (isAssetRef(docPath) && window.WebBridge) {
        if (/\.(?:txt|md)$/i.test(baseName(docPath))) {
          const buf = await WebBridge.readAssetBytes(docPath);
          const d = T.loadTextDoc(baseName(docPath), buf);
          lines = SM.extractTxtLines(d.text);
        } else if (/\.html?$/i.test(baseName(docPath))) {
          const buf = await WebBridge.readAssetBytes(docPath);
          const dec = T.decodeBytes(buf);
          lines = SM.extractHtmlLines(dec.text);
        }
      } else if (IS_ELECTRON && typeof fs !== 'undefined' && fs.existsSync(docPath)) {
        if (/\.(?:txt|md)$/i.test(docPath)) {
          const buf = fs.promises ? await fs.promises.readFile(docPath) : fs.readFileSync(docPath);
          const d = T.loadTextDoc(docPath, buf);
          lines = SM.extractTxtLines(d.text);
        } else if (/\.html?$/i.test(docPath)) {
          const buf = fs.promises ? await fs.promises.readFile(docPath) : fs.readFileSync(docPath);
          const dec = T.decodeBytes(buf);
          lines = SM.extractHtmlLines(dec.text);
        }
      }
    } catch (_) { }
    if (lines && lines.length) {
      if (pageLinesCache.size > 120) {
        const firstKey = pageLinesCache.keys().next().value;
        if (firstKey !== undefined) pageLinesCache.delete(firstKey);
      }
      pageLinesCache.set(key, lines);
    }
    return lines;
  }
  function findLineIdxFromLines(pageLines, rawText) {
    if (!Array.isArray(pageLines) || !pageLines.length || !rawText) return null;
    const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, '');
    const firstRaw = String(rawText).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).find(Boolean) || '';
    const key = norm(firstRaw);
    if (!key) return null;
    const headKey = key.slice(0, 24);
    for (let i = 0; i < pageLines.length; i++) {
      const ln = norm(pageLines[i].text);
      if (!ln) continue;
      if (ln === key || ln.includes(headKey) || (ln.length >= 3 && key.includes(ln))) {
        return pageLines[i].pageLineIdx != null ? pageLines[i].pageLineIdx : i;
      }
    }
    return null;
  }
  /** 切り抜いた画像（PNG）を保存し、現在のシナリオの「📌 登録素材」へ追加する */
  function saveCropImage(img) {
    try {
      if (!S.key || S.key === '_default') return say('⚠️ 先にシナリオを選択してください（登録素材はシナリオごとに保存されます）');
      if (!IS_ELECTRON) {
        const sc = scenarioObj(S.key);
        if (!sc) return say('⚠️ シナリオが見つかりません');
        const d = new Date(), p2 = n => String(n).padStart(2, '0'), stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
        const base = String(img.name || 'pdf').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
        const fname = base + '_p' + (img.page || 1) + '_' + stamp + '.png';
        const dataUrl = typeof urlToRef === 'function' ? urlToRef(String(img.dataUrl || '')) : String(img.dataUrl || '');
        sc.images = sc.images || [];
        sc.imageCategories = sc.imageCategories || ['トレーラー', 'NPC', '背景', '前景', 'マップ', '部屋素材'];
        if (!sc.imageCategories.includes('切り抜き')) sc.imageCategories.push('切り抜き');
        sc.images.push({ id: (typeof galId === 'function' ? galId() : M.newId()), name: fname, origName: fname, dataUrl, category: '切り抜き', tags: [], addedAt: Date.now() });
        if (typeof saveState === 'function') saveState();
        if (CCF.assets && CCF.assets.invalidateUnified) CCF.assets.invalidateUnified(S.key);
        window.dispatchEvent(new Event('ccf-refs-changed'));
        if (CCF.library) CCF.library.render();
        say('🖼️ 切り抜き画像を「📌 登録素材」へ追加しました（' + fname + '）');
        return;
      }
      if (!CCF.assets || !CCF.assets.addPaths) return say('⚠️ 登録素材の機能を使えません');
      const dir = path.join(DATA_ROOT, 'ccfolia', 'crops', safeKey(S.key)); fs.mkdirSync(dir, { recursive: true });
      const d = new Date(), p2 = n => String(n).padStart(2, '0'), stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
      const base = String(img.name || 'pdf').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40), file = path.join(dir, base + '_p' + (img.page || 1) + '_' + stamp + '.png');
      fs.writeFileSync(file, Buffer.from(String(img.dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64'));
      const n = CCF.assets.addPaths(S.key, [file], '切り抜き'); if (n) say('🖼️ 切り抜き画像を「📌 登録素材」へ追加しました（' + path.basename(file) + '）');
    } catch (e) { console.error('[ccf] 画像の保存に失敗', e); say('❌ 画像を保存できませんでした：' + (e.message || e)); }
  }

  let cloudCacheTimer = null;
  function needsImmediateCloudPdf(p) {
    if (!p) return false;
    if (isCloudRef(p)) {
      return !(window.CloudSync && typeof CloudSync.isAssetRefLocallyCachedSync === 'function' && CloudSync.isAssetRefLocallyCachedSync(p));
    }
    if (isAssetRef(p)) {
      return !!(window.WebBridge && typeof WebBridge.hasAssetSync === 'function' && !WebBridge.hasAssetSync(p));
    }
    if (IS_ELECTRON && fs) {
      try { return !fs.existsSync(p); } catch (_) { return true; }
    }
    return false;
  }

  async function switchProject(key, targetRoomId, opts) {
    flushPdfPosToRoom();
    if (cloudCacheTimer) { clearTimeout(cloudCacheTimer); cloudCacheTimer = null; }
    invalidateDocListCache();
    S.key = key || '_default';
    const container = getRoomContainer(S.key);
    S.rooms = container.rooms;
    if (targetRoomId && S.rooms.some(r => r.id === targetRoomId)) {
      S.roomId = targetRoomId;
    } else if (container.activeRoomId && S.rooms.some(r => r.id === container.activeRoomId)) {
      S.roomId = container.activeRoomId;
    } else {
      S.roomId = S.rooms[0] ? S.rooms[0].id : M.newId();
    }
    container.activeRoomId = S.roomId;
    const curRoom = S.rooms.find(r => r.id === S.roomId);
    S.proj = curRoom ? curRoom.project : M.sanitizeProject(null);
    applyLocalPdfPos(S.key, S.roomId, S.proj, curRoom && curRoom.updatedAt);
    S.bufRaw = ''; S.bufSrc = []; S.bufDirty = false;
    const ta = $('ccfBuf'); if (ta) ta.value = '';
    try { localStorage.setItem('ccf_last_project', S.key); } catch (e) { if (typeof logSoft === 'function') logSoft('setLastProject', e); }
    if (CCF.sceneUI && CCF.sceneUI.onProjectSwitch) CCF.sceneUI.onProjectSwitch();
    renderScenarioSearch();
    renderRoomSelect();
    renderProps();
    renderCenter();
    if (CCF.library) { try { CCF.library.restore(); } catch (e) { /* noop */ } }
    buildDocSelect();
    updateBufInfo();
    let pdfPath = S.proj.pdf && S.proj.pdf.path;
    const pdfPage = S.proj.pdf && S.proj.pdf.page;
    const pdfZoom = S.proj.pdf && S.proj.pdf.zoom;
    let usedFallback = false;
    const canAutoOpenPdf = p => {
      if (!p) return false;
      if (isCloudRef(p)) return true;
      if (isAssetRef(p)) return true;
      return !!(IS_ELECTRON && fs && (fs.existsSync(p) || (window.CloudSync && CloudSync.canDownloadFromCloud && CloudSync.canDownloadFromCloud())));
    };
    if (!pdfPath || !canAutoOpenPdf(pdfPath) || (IS_ELECTRON && fs && !isCloudRef(pdfPath) && !isAssetRef(pdfPath) && !fs.existsSync(pdfPath))) {
      const dl = docList();
      if (dl.length) { pdfPath = dl[0].value; usedFallback = true; }
    }
    const expectKey = S.key, expectRoom = S.roomId;
    const triggerCloudAssetsCache = () => {
      if (!(expectKey && expectKey !== '_default' && window.CloudSync && typeof CloudSync.ensureScenarioAssetsCached === 'function')) return;
      if (needsImmediateCloudPdf(pdfPath)) {
        void CloudSync.ensureScenarioAssetsCached(expectKey, { showProgress: !(opts && opts.deferPdf) });
      } else {
        cloudCacheTimer = setTimeout(() => {
          cloudCacheTimer = null;
          if (S.key === expectKey) {
            void CloudSync.ensureScenarioAssetsCached(expectKey, { showProgress: !(opts && opts.deferPdf) });
          }
        }, 1500);
      }
    };
    if (opts && opts.deferPdf && !usedFallback) {
      if (CCF.viewer) CCF.viewer.clear();
      if (pdfPath) {
        setTimeout(() => {
          if (S.key !== expectKey || S.roomId !== expectRoom || !S.proj.pdf || S.proj.pdf.path !== pdfPath) return;
          const check = (isCloudRef(pdfPath) || (window.CloudSync && CloudSync.canDownloadFromCloud && CloudSync.canDownloadFromCloud()))
            ? Promise.resolve()
            : (isAssetRef(pdfPath) && window.WebBridge
              ? WebBridge.hasAsset(pdfPath).then(ok => ok ? Promise.resolve() : Promise.reject())
              : (IS_ELECTRON && fs ? (fs.promises ? fs.promises.access(pdfPath) : (fs.existsSync(pdfPath) ? Promise.resolve() : Promise.reject())) : Promise.reject()));
          check.then(() => {
            if (S.key === expectKey && S.roomId === expectRoom && S.proj.pdf && S.proj.pdf.path === pdfPath) {
              triggerCloudAssetsCache();
              openPdfPath(pdfPath, { page: pdfPage, zoom: pdfZoom, skipBuildDocSelect: true });
            }
          }).catch(() => { triggerCloudAssetsCache(); });
        }, 120);
      } else {
        triggerCloudAssetsCache();
      }
    } else if (canAutoOpenPdf(pdfPath)) {
      triggerCloudAssetsCache();
      await openPdfPath(pdfPath, { page: pdfPage, zoom: pdfZoom, skipBuildDocSelect: true });
    } else {
      triggerCloudAssetsCache();
      if (CCF.viewer) CCF.viewer.clear();
    }
  }

  async function switchRoom(roomId) {
    flushPdfPosToRoom();
    if (!S.rooms.some(r => r.id === roomId)) return;
    invalidateDocListCache();
    S.roomId = roomId;
    const container = getRoomContainer(S.key);
    container.activeRoomId = S.roomId;
    saveRoomContainer(S.key, container);
    const curRoom = S.rooms.find(r => r.id === S.roomId);
    S.proj = curRoom ? curRoom.project : M.sanitizeProject(null);
    applyLocalPdfPos(S.key, S.roomId, S.proj, curRoom && curRoom.updatedAt);
    if (CCF.sceneUI && CCF.sceneUI.onProjectSwitch) CCF.sceneUI.onProjectSwitch();
    renderRoomSelect();
    renderProps();
    renderCenter();
    buildDocSelect();
    if (S.proj.pdf && S.proj.pdf.path && (isCloudRef(S.proj.pdf.path) || (isAssetRef(S.proj.pdf.path) && window.WebBridge && (await WebBridge.hasAsset(S.proj.pdf.path) || (window.CloudSync && CloudSync.canDownloadFromCloud()))) || (IS_ELECTRON && fs && (fs.existsSync(S.proj.pdf.path) || (window.CloudSync && CloudSync.canDownloadFromCloud()))))) {
      await openPdfPath(S.proj.pdf.path, { page: S.proj.pdf.page, zoom: S.proj.pdf.zoom, skipBuildDocSelect: true });
    } else if (CCF.viewer) {
      CCF.viewer.clear();
    }
    say(`🏠 部屋「${curRoom ? curRoom.name : ''}」に切り替えました`);
  }

  function addRoom(name, initialProject) {
    cp('部屋の作成');
    saveProject(true);
    const container = getRoomContainer(S.key);
    const newRoom = {
      id: M.newId(),
      name: (name || `部屋 ${container.rooms.length + 1}`).trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      project: initialProject ? ccfClone(initialProject) : M.sanitizeProject(null)
    };
    container.rooms.push(newRoom);
    container.activeRoomId = newRoom.id;
    saveRoomContainer(S.key, container);
    S.rooms = container.rooms;
    switchRoom(newRoom.id);
    say(`✅ 部屋「${newRoom.name}」を作成しました`);
    return newRoom;
  }

  function renameRoom(roomId, newName) {
    newName = (newName || '').trim();
    if (!newName) return;
    cp('部屋名の変更');
    const container = getRoomContainer(S.key);
    const r = container.rooms.find(x => x.id === roomId);
    if (!r) return;
    r.name = newName;
    r.updatedAt = Date.now();
    saveRoomContainer(S.key, container);
    S.rooms = container.rooms;
    renderRoomSelect();
    say(`✅ 部屋名を「${newName}」に変更しました`);
  }

  function deleteRoom(roomId) {
    const container = getRoomContainer(S.key);
    if (container.rooms.length <= 1) {
      return say('⚠️ 部屋データは最低1つ必要です（削除できません）');
    }
    cp('部屋の削除');
    const idx = container.rooms.findIndex(x => x.id === roomId);
    if (idx < 0) return;
    const [del] = container.rooms.splice(idx, 1);
    if (container.activeRoomId === roomId) {
      container.activeRoomId = container.rooms[0].id;
    }
    saveRoomContainer(S.key, container);
    S.rooms = container.rooms;
    switchRoom(container.activeRoomId);
    say(`🗑️ 部屋「${del.name}」を削除しました`);
  }

  function duplicateRoom(roomId, targetKey, newName) {
    cp('部屋の複製');
    saveProject(true);
    targetKey = targetKey || S.key;
    const srcContainer = getRoomContainer(S.key);
    const srcRoom = srcContainer.rooms.find(x => x.id === roomId) || S.rooms.find(x => x.id === S.roomId);
    if (!srcRoom) return;
    const name = (newName || `${srcRoom.name} (コピー)`).trim();
    const clonedProject = ccfClone(srcRoom.project);
    const targetContainer = getRoomContainer(targetKey);
    const newRoom = {
      id: M.newId(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      project: clonedProject
    };
    targetContainer.rooms.push(newRoom);
    targetContainer.activeRoomId = newRoom.id;
    saveRoomContainer(targetKey, targetContainer);
    if (targetKey === S.key) {
      S.rooms = targetContainer.rooms;
      switchRoom(newRoom.id);
      say(`📋 部屋「${name}」を複製しました`);
    } else {
      const destSc = scenarioObj(targetKey);
      const destName = destSc ? destSc.title : '（シナリオ未選択）';
      say(`📋 部屋「${name}」を「${destName}」に複製しました`);
      switchProject(targetKey, newRoom.id);
    }
    return newRoom;
  }

  function linkRoomToScenario(roomId, targetKey) {
    if (!targetKey || targetKey === S.key) return;
    cp('部屋の紐付け');
    saveProject(true);
    const srcContainer = getRoomContainer(S.key);
    const roomIdx = srcContainer.rooms.findIndex(x => x.id === roomId);
    if (roomIdx < 0) return;
    const [room] = srcContainer.rooms.splice(roomIdx, 1);
    if (!srcContainer.rooms.length) {
      srcContainer.rooms.push({
        id: M.newId(),
        name: 'メイン部屋',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        project: M.sanitizeProject(null)
      });
    }
    srcContainer.activeRoomId = srcContainer.rooms[0].id;
    saveRoomContainer(S.key, srcContainer);
    const targetContainer = getRoomContainer(targetKey);
    targetContainer.rooms.push(room);
    targetContainer.activeRoomId = room.id;
    saveRoomContainer(targetKey, targetContainer);
    const destSc = scenarioObj(targetKey);
    const destName = destSc ? destSc.title : '（シナリオ未選択）';
    say(`🔗 部屋「${room.name}」を「${destName}」に紐付けました`);
    switchProject(targetKey, room.id);
  }

  function openDuplicateRoomDialog(key, roomId) {
    key = key || S.key;
    const container = getRoomContainer(key);
    const room = (roomId && container.rooms.find(r => r.id === roomId)) || S.rooms.find(r => r.id === S.roomId) || container.rooms[0];
    if (!room) return;
    const scenarios = scenarioList();
    const ov = document.createElement('div');
    ov.className = 'app-dialog-overlay';
    ov.setAttribute('role', 'dialog');
    ov.innerHTML = `
      <div class="app-dialog" style="width:min(480px,94vw);">
        <div class="app-dialog-title">📋 部屋データの複製</div>
        <div class="app-dialog-msg">
          <label style="display:block; margin:8px 0 4px; font-size:0.8rem; font-weight:bold;">複製後の部屋名</label>
          <input type="text" id="ccfDupName" value="${esc(room.name)} (コピー)" style="width:100%; padding:6px 10px; margin-bottom:12px;">
          <label style="display:block; margin:8px 0 4px; font-size:0.8rem; font-weight:bold;">複製先のシナリオ</label>
          <select id="ccfDupDest" style="width:100%; padding:6px 10px; margin-bottom:12px;">
            <option value="${esc(key)}">現在のシナリオ（このシナリオ内の別パターンとして作成）</option>
            ${key !== '_default' ? '<option value="_default">（シナリオ未選択）</option>' : ''}
            ${scenarios.filter(s => String(s.id) !== String(key)).map(s => `<option value="${esc(s.id)}">${esc(s.title || '無題')}</option>`).join('')}
          </select>
        </div>
        <div class="app-dialog-actions">
          <button type="button" class="app-dialog-btn" data-act="cancel">キャンセル</button>
          <button type="button" class="app-dialog-btn primary" data-act="ok">複製する</button>
        </div>
      </div>
    `;
    const close = () => ov.remove();
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'cancel') return close();
      if (b.dataset.act === 'ok') {
        const name = (ov.querySelector('#ccfDupName').value || '').trim() || `${room.name} (コピー)`;
        const destKey = ov.querySelector('#ccfDupDest').value;
        close();
        duplicateRoom(room.id, destKey, name);
      }
    });
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    const inp = ov.querySelector('#ccfDupName');
    if (inp) { inp.focus(); inp.select(); }
  }

  function openLinkRoomDialog(key, roomId) {
    key = key || S.key;
    const container = getRoomContainer(key);
    const room = (roomId && container.rooms.find(r => r.id === roomId)) || S.rooms.find(r => r.id === S.roomId) || container.rooms[0];
    if (!room) return;
    const scenarios = scenarioList();
    if (!scenarios.length) return say('登録済みのシナリオがありません');
    const ov = document.createElement('div');
    ov.className = 'app-dialog-overlay';
    ov.setAttribute('role', 'dialog');
    ov.innerHTML = `
      <div class="app-dialog" style="width:min(480px,94vw);">
        <div class="app-dialog-title">🔗 部屋データのシナリオ紐付け</div>
        <div class="app-dialog-msg">
          <p style="margin-bottom:10px;">部屋「<b>${esc(room.name)}</b>」を紐付ける登録済みシナリオを選択してください。<br><small style="color:var(--dc-text-muted);">※選択したシナリオの部屋データとして移動・登録されます。</small></p>
          <label style="display:block; margin:8px 0 4px; font-size:0.8rem; font-weight:bold;">移動先シナリオ</label>
          <select id="ccfLinkDest" style="width:100%; padding:6px 10px; margin-bottom:12px;">
            ${scenarios.map(s => `<option value="${esc(s.id)}">${esc(s.title || '無題')}</option>`).join('')}
          </select>
        </div>
        <div class="app-dialog-actions">
          <button type="button" class="app-dialog-btn" data-act="cancel">キャンセル</button>
          <button type="button" class="app-dialog-btn primary" data-act="ok">紐付けて移動</button>
        </div>
      </div>
    `;
    const close = () => ov.remove();
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'cancel') return close();
      if (b.dataset.act === 'ok') {
        const destKey = ov.querySelector('#ccfLinkDest').value;
        close();
        linkRoomToScenario(room.id, destKey);
      }
    });
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }

  // ======================================================================
  // 4. PDF ビューア（左ペイン）と、別ウィンドウへのポップアウト
  // ======================================================================
  const popoutBc = (!ipc && typeof BroadcastChannel === 'function') ? new BroadcastChannel('ccf_pdf_popout') : null;
  let popoutWin = null, pendingPopoutOpen = null;
  function sendPopout(ch, payload) {
    if (ipc) return ipc.send(ch, payload);
    if (popoutBc) popoutBc.postMessage({ ch, payload });
    else if (popoutWin && !popoutWin.closed) popoutWin.postMessage({ __ccfPopout: true, ch, payload }, '*');
  }
  function createViewer() {
    CCF.viewer = CCFPdfViewer.create($('ccfLeft'), {
      appDir: APP_DIR,
      popout: { label: '⧉ 別ウィンドウ', title: 'PDFビューアを別ウィンドウに切り離します（抽出したテキストはこの画面へ届きます）', onClick: popOut },
      onExtract: (raw, info) => pushExtract(raw, info.shift || S.proj.settings.alwaysAppend, info.src),
      onState: s => {
        if (s && s.path) {
          const nextPage = s.page || 1, nextZoom = s.zoom || 1.2;
          const prev = S.proj.pdf || {};
          const changed = prev.path !== s.path || prev.page !== nextPage || prev.zoom !== nextZoom;
          S.proj.pdf = { path: s.path, page: nextPage, zoom: nextZoom };
          recordPdfPos(s, changed);
        }
      },
      onOpenRequest: (p, ov) => openPdfPath(p, ov),
      getBookmarks: () => S.proj.bookmarks || [],
      onBookmarks: list => { S.proj.bookmarks = list; saveProject(); syncPopout(); },
      onSaveImage: img => saveCropImage(img),
      onClose: had => {   // 「✕ 選択解除」：表示中のPDFを閉じて初期表示へ。次回起動時に勝手に開き直さないよう、保存済みの記録も消す
        if (CCF.viewer) CCF.viewer.setOverlay(null);
        S.proj.pdf = { path: '', page: 1, zoom: (S.proj.pdf && S.proj.pdf.zoom) || 1.2 };
        savePdfPosLocal(S.key, S.roomId, S.proj, { cleared: true });
        pdfPosDirty = true;
        flushPdfPosToRoom();
        if (CCF.library && CCF.library.clearSelection) CCF.library.clearSelection();
        if (had) say('PDFの選択を解除しました');
      },
      onPickDoc: async val => {
        if (canOpenLocalOrCloudDoc(val) || findDocTextForPath(val)) return openPdfPath(val);
        say('⚠️ ファイルが見つかりません：' + baseName(val));
      },
      onNotice: m => say(m),
      onError: e => say('❌ PDFを開けませんでした：' + (e.message || e))
    });
    CCF.V = CCF.viewer.state;
  }
  /** 同期テキスト（sc.docTexts）を左ペインのフォールバックビューワで表示する */
  function splitDocTextPagesForViewer(raw) {
    const text = String(raw || '');
    const re = /^=== P\.(\d+) ===\s*$/gm;
    const matches = [...text.matchAll(re)];
    if (!matches.length) return [{ page: 1, body: text }];
    const pages = [];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const start = m.index + m[0].length;
      const end = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
      pages.push({ page: Number(m[1]) || (i + 1), body: text.slice(start, end).replace(/^\n+|\n+$/g, '') });
    }
    return pages;
  }
  function openSyncedDocTextViewer(docPath, dt, ov) {
    if (!CCF.viewer || !dt || !dt.text) return false;
    ov = ov || {};
    const pages = splitDocTextPagesForViewer(dt.text);
    const targetPage = Number(ov.page) || (S.proj.pdf && S.proj.pdf.page) || 1;
    const pageOpts = pages.map(p => `<option value="${p.page}"${p.page === targetPage ? ' selected' : ''}>P.${p.page}</option>`).join('');
    const html = `<div class="ccf-doctext-wrap" style="display:flex;flex-direction:column;width:100%;height:100%;background:var(--ccf-bg,#1b1e26);color:var(--ccf-fg,#e5e7eb);text-align:left;overflow:hidden;">
      <div class="ccf-doctext-bar" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.22);font-size:12px;">
        <span style="font-weight:700;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(dt.name)}">📄 ${esc(dt.name)}</span>
        <span style="font-size:11px;padding:1px 6px;border-radius:10px;background:rgba(99,102,241,0.25);color:#c7d2fe;">同期テキスト (${dt.pageCount || pages.length}P)</span>
        <select class="ccf-doctext-psel" title="ページジャンプ" style="font-size:12px;padding:2px 4px;border-radius:4px;background:rgba(255,255,255,0.08);color:inherit;border:1px solid rgba(255,255,255,0.18);">${pageOpts}</select>
        <input type="search" class="ccf-doctext-search" placeholder="キーワード検索..." style="flex:1;min-width:110px;max-width:190px;font-size:12px;padding:3px 6px;border-radius:4px;background:rgba(255,255,255,0.08);color:inherit;border:1px solid rgba(255,255,255,0.18);">
        <button type="button" class="ccf-mini" data-dt="prev" title="前の候補">▲</button>
        <button type="button" class="ccf-mini" data-dt="next" title="次の候補">▼</button>
        <span class="ccf-doctext-hits" style="font-size:11px;opacity:0.75;min-width:36px;">0/0</span>
        <button type="button" class="ccf-mini" data-dt="copy" title="選択テキスト（未選択時は表示中のページ）を整形コピー">📋 整形コピー</button>
        <button type="button" class="ccf-mini" data-dt="close" title="同期テキストを閉じる">✕</button>
      </div>
      <div class="ccf-doctext-hint" style="padding:4px 10px;font-size:11px;opacity:0.75;border-bottom:1px solid rgba(255,255,255,0.08);">💡 テキストをドラッグ選択すると中央の抽出バッファへ転送されます（Shift+選択で追記）</div>
      <div class="ccf-doctext-body" style="flex:1;overflow:auto;padding:12px 14px;user-select:text;white-space:pre-wrap;word-break:break-word;line-height:1.75;font-size:13px;"></div>
    </div>`;
    CCF.viewer.setOverlay(html);
    const ovEl = CCF.viewer.els && CCF.viewer.els.overlay;
    if (!ovEl) return false;
    const bodyEl = ovEl.querySelector('.ccf-doctext-body');
    const psel = ovEl.querySelector('.ccf-doctext-psel');
    const searchEl = ovEl.querySelector('.ccf-doctext-search');
    const hitsEl = ovEl.querySelector('.ccf-doctext-hits');
    let curHits = [], curHitIdx = -1, activePage = targetPage;

    const renderBody = q => {
      const query = String(q || '').trim();
      const escReg = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = query ? new RegExp(escReg(query), 'gi') : null;
      const highlight = txt => {
        if (!re) return esc(txt);
        let out = '', last = 0;
        re.lastIndex = 0;
        for (const m of txt.matchAll(re)) {
          out += esc(txt.slice(last, m.index)) + `<mark class="ccf-doctext-hit" style="background:#facc15;color:#111;border-radius:2px;padding:0 1px;">${esc(m[0])}</mark>`;
          last = m.index + m[0].length;
        }
        return out + esc(txt.slice(last));
      };
      bodyEl.innerHTML = pages.map(p => `<div class="ccf-doctext-page" data-page="${p.page}" style="margin-bottom:18px;">
        <div class="ccf-doctext-phead" style="font-size:11px;font-weight:700;opacity:0.7;border-bottom:1px dashed rgba(255,255,255,0.18);padding-bottom:2px;margin-bottom:6px;">=== P.${p.page} ===</div>
        <div class="ccf-doctext-content">${highlight(p.body)}</div>
      </div>`).join('');
      curHits = [...bodyEl.querySelectorAll('mark.ccf-doctext-hit')];
      curHitIdx = curHits.length ? 0 : -1;
      updateHitUI();
    };
    const updateHitUI = () => {
      if (hitsEl) hitsEl.textContent = curHits.length ? `${curHitIdx + 1}/${curHits.length}` : '0/0';
      curHits.forEach((m, i) => { m.style.background = i === curHitIdx ? '#f97316' : '#facc15'; });
      if (curHitIdx >= 0 && curHits[curHitIdx]) curHits[curHitIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const jumpPage = pg => {
      activePage = Number(pg) || 1;
      const el = bodyEl.querySelector(`.ccf-doctext-page[data-page="${activePage}"]`);
      if (el) el.scrollIntoView({ block: 'start' });
      if (psel) psel.value = String(activePage);
      if (CCF.viewer && CCF.viewer.state) CCF.viewer.state.page = activePage;
      recordPdfPos({ path: docPath, page: activePage, zoom: 1.2 }, false);
    };

    renderBody('');
    if (CCF.viewer.state) {
      CCF.viewer.state.path = docPath;
      CCF.viewer.state.page = targetPage;
      CCF.viewer.state.total = pages.length;
    }
    if (CCF.viewer.els && CCF.viewer.els.docsel) CCF.viewer.els.docsel.value = docPath;
    if (targetPage > 1) setTimeout(() => jumpPage(targetPage), 0);

    if (psel) psel.addEventListener('change', () => jumpPage(psel.value));
    if (searchEl) searchEl.addEventListener('input', () => renderBody(searchEl.value));
    ovEl.addEventListener('click', async e => {
      const b = e.target.closest('[data-dt]');
      if (!b) return;
      const act = b.dataset.dt;
      if (act === 'close') { CCF.viewer.setOverlay(null); return; }
      if (act === 'prev' && curHits.length) { curHitIdx = (curHitIdx - 1 + curHits.length) % curHits.length; updateHitUI(); return; }
      if (act === 'next' && curHits.length) { curHitIdx = (curHitIdx + 1) % curHits.length; updateHitUI(); return; }
      if (act === 'copy') {
        const sel = window.getSelection ? String(window.getSelection().toString() || '').trim() : '';
        const pgObj = pages.find(p => p.page === activePage) || pages[0];
        const rawCopy = sel || (pgObj ? pgObj.body : '');
        const cleaned = (T && T.cleanText) ? T.cleanText(rawCopy, cleanOpts()) : rawCopy;
        try { await navigator.clipboard.writeText(cleaned); say('📋 整形コピーしました（' + cleaned.length + '文字）'); }
        catch (_) { say('⚠️ クリップボードへのコピーに失敗しました'); }
      }
    });
    bodyEl.addEventListener('mouseup', e => {
      const sel = window.getSelection ? window.getSelection() : null;
      const raw = sel ? String(sel.toString() || '') : '';
      if (!raw.trim()) return;
      let pg = activePage;
      try {
        const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
        const pEl = node && node.closest ? node.closest('.ccf-doctext-page') : null;
        if (pEl && pEl.dataset.page) pg = Number(pEl.dataset.page) || activePage;
      } catch (_) {}
      const append = !!(e.shiftKey || (S.proj && S.proj.settings && S.proj.settings.alwaysAppend));
      pushExtract(raw, append, { path: docPath, name: dt.name, page: pg, rect: null });
    });
    return true;
  }
  /** PDFごとの前回のページ位置・倍率を、メモリ上と軽量 localStorage に記憶する（重い saveState / CloudSync は発火しない） */
  function recordPdfPos(s, forceSave) {
    if (!s || !s.path) return;
    S.proj.pdfPos = S.proj.pdfPos || {};
    const page = s.page || 1, zoom = s.zoom || 1.2;
    const prev = S.proj.pdfPos[s.path];
    if (!forceSave && prev && prev.page === page && prev.zoom === zoom) return;
    S.proj.pdfPos[s.path] = { page, zoom };
    pdfPosDirty = true;
    savePdfPosLocal(S.key, S.roomId, S.proj);
  }
  /** PDF をメイン画面のビューアで開く（別ウィンドウとは独立）。ページ位置の指定が無ければ、この部屋で前回開いていた位置を使う。 */
  async function openPdfPath(p, ov) {
    ov = ov || {}; const pos = (S.proj.pdfPos && S.proj.pdfPos[p]) || {};
    S.proj.pdf = { path: p, page: ov.page || pos.page || 1, zoom: ov.zoom || pos.zoom || (S.proj.pdf && S.proj.pdf.zoom) || 1.2 };
    let addedRef = false;
    if (!IS_ELECTRON && isAssetRef(p) && S.proj) {
      S.proj.refs = S.proj.refs || [];
      if (!S.proj.refs.some(r => r && r.path === p)) {
        const nm = baseName(p);
        S.proj.refs.push({ id: M.newId(), type: /\.(txt|html?|md)$/i.test(nm) ? 'doc' : 'pdf', name: nm, path: p, category: '', mtime: Date.now() });
        addedRef = true;
      }
    }
    savePdfPosLocal(S.key, S.roomId, S.proj);
    pdfPosDirty = true;
    if (addedRef) {
      invalidateDocListCache();
      saveProject();
    }
    if (!canOpenLocalOrCloudDoc(p)) {
      const dt = findDocTextForPath(p);
      if (dt && openSyncedDocTextViewer(p, dt, { page: S.proj.pdf.page })) {
        if (!ov.skipBuildDocSelect) buildDocSelect();
        return true;
      }
    }
    if (CCF.viewer) CCF.viewer.setOverlay(null);
    let ok = false;
    try {
      ok = await CCF.viewer.openPath(p, { page: S.proj.pdf.page, zoom: S.proj.pdf.zoom });
    } catch (_) { ok = false; }
    if (!ok) {
      const dt = findDocTextForPath(p);
      if (dt && openSyncedDocTextViewer(p, dt, { page: S.proj.pdf.page })) {
        if (!ov.skipBuildDocSelect) buildDocSelect();
        return true;
      }
    }
    if (!ov.skipBuildDocSelect) buildDocSelect();
    return ok;
  }
  /** 別ウィンドウが開いている間も、メイン画面のビューアはそのまま使える（それぞれ別のPDFを開ける） */
  function showPopped(on) { S.popped = !!on; if (CCF.viewer) CCF.viewer.setOverlay(null); }
  async function popOut() {
    const st = CCF.viewer.state, cur = st.path ? { path: st.path, page: st.page, zoom: st.zoom } : (S.proj.pdf.path ? { path: S.proj.pdf.path, page: S.proj.pdf.page, zoom: S.proj.pdf.zoom } : {});
    const payload = Object.assign({ docs: docList(), pos: S.proj.pdfPos, bookmarks: S.proj.bookmarks || [], marks: marksList() }, cur);
    if (ipc) {
      if (S.popped) { await ipc.invoke('ccf:popout', null); return; }   // すでにあるなら前面へ
      await ipc.invoke('ccf:popout', payload);
      showPopped(true); say('⧉ 別ウィンドウで開きました（メイン画面とは別のPDFを開けます）');
      return;
    }
    if (popoutWin && !popoutWin.closed) { popoutWin.focus(); sendPopout('ccf:pdf-open', payload); return; }
    pendingPopoutOpen = payload;
    popoutWin = window.open('ccfolia/pdf_window.html?browser=1', 'ccf_pdf_popout', 'width=1120,height=820,resizable=yes,scrollbars=yes');
    if (!popoutWin) { pendingPopoutOpen = null; return say('⚠️ ポップアップがブロックされました。ブラウザのポップアップを許可してください'); }
    showPopped(true);
    say('⧉ 別ウィンドウで開きました（メイン画面とは別のPDFを開けます）');
  }
  function wireIpc() {
    const handlePopoutMsg = (ch, p) => {
      if (ch === 'ccf:popout-ready') { if (pendingPopoutOpen) { sendPopout('ccf:pdf-open', pendingPopoutOpen); pendingPopoutOpen = null; } return; }
      if (ch === 'ccf:bookmarks') { S.proj.bookmarks = M.sanitizeBookmarks(p); saveProject(); if (CCF.viewer) CCF.viewer.setBookmarks(S.proj.bookmarks); return; }
      if (ch === 'ccf:save-image') { if (p && p.dataUrl) saveCropImage(p); return; }
      if (ch === 'ccf:extract') {
        if (!p || !p.raw) return; pushExtract(p.raw, !!p.shift || S.proj.settings.alwaysAppend, p.src);
        const ta = $('ccfBuf'); if (ta) { ta.classList.add('flash'); setTimeout(() => ta.classList.remove('flash'), 600); }
        return;
      }
      if (ch === 'ccf:pdf-state') { if (p && p.path) { recordPdfPos(p); } return; }
      if (ch === 'ccf:popout-closed') { popoutWin = null; showPopped(false); }
    };
    if (!ipc) {
      if (popoutBc) popoutBc.onmessage = ev => { if (ev.data && ev.data.ch) handlePopoutMsg(ev.data.ch, ev.data.payload); };
      window.addEventListener('message', ev => { if (ev.data && ev.data.__ccfPopout && ev.data.ch) handlePopoutMsg(ev.data.ch, ev.data.payload); });
      return;
    }
    ipc.on('ccf:bookmarks', (e, list) => handlePopoutMsg('ccf:bookmarks', list));   // 別ウィンドウで編集したしおり
    ipc.on('ccf:save-image', (e, img) => handlePopoutMsg('ccf:save-image', img));   // 別ウィンドウで切り抜いた画像 → 登録素材
    ipc.on('ccf:extract', (e, p) => handlePopoutMsg('ccf:extract', p));
    ipc.on('ccf:pdf-state', (e, s) => handlePopoutMsg('ccf:pdf-state', s));
    ipc.on('ccf:popout-closed', () => handlePopoutMsg('ccf:popout-closed'));
    ipc.invoke('ccf:popout-state').then(on => { if (on) showPopped(true); }).catch(e => { if (typeof logSoft === 'function') logSoft('popoutState', e); });
  }

  // ======================================================================
  // 5. 中央エリア：抽出バッファ／テキスト変換ツール／シナリオテキスト一覧
  // ======================================================================
  const bufferText = () => $('ccfBuf').value;
  function updateBufInfo() { const n = $('ccfBuf') ? $('ccfBuf').value.length : 0; const el = $('ccfBufInfo'); if (el) el.textContent = n ? n + '文字' : ''; }
  const cleanOpts = () => { const s = S.proj.settings; return { joinLines: s.joinLines, stripSpaces: s.stripSpaces }; };
  /** 抽出したテキストをバッファへ入れる。append=true なら末尾に追記。 */
  function pushExtract(raw, append, src) {
    if (!raw || !String(raw).trim()) return false;
    if (S.view === 'assets') setView('stocks');
    const had = !!(append && S.bufRaw); let body = String(raw);
    // 抽出元（PDF名・ページ・座標）を記録。登録時にテキスト／NPCのデータへ引き継ぐ（追記なら複数）
    S.bufSrc = had ? (S.bufSrc || []) : [];
    if (src && typeof src === 'object') {
      const rec = { path: src.path || '', name: src.name || '', page: src.page || 1, rect: src.rect || null };
      if (src.lineIdx != null) rec.lineIdx = Number(src.lineIdx);
      S.bufSrc.push(rec);
      if (rec.path && rec.page) void warmPageLinesCache(rec.path, rec.page);
    }
    if (!had && window.CCFPdfViewer.extOpts().autoTitle) {   // 1行目が短い見出し行なら「タイトル欄」へ、2行目以降を本文欄へ（NPC生成は見出し行も含む原文 bufRaw を使う）
      const sp = T.splitTitleBody(body), ti = $('ccfBufTitle'); if (sp && ti) { ti.value = sp.title; body = sp.body; }
    }
    S.bufRaw = had ? S.bufRaw + '\n' + raw : String(raw);
    S.bufBody = had ? (S.bufBody != null ? S.bufBody : '') + '\n' + body : body;
    S.bufDirty = false;
    $('ccfBuf').value = S.proj.settings.autoClean ? T.cleanText(S.bufBody, cleanOpts()) : S.bufBody;
    updateBufInfo(); return true;
  }
  const rectExtract = (rect, append) => CCF.viewer.extractRect(rect, append);
  /** テキストエリアの内容を置き換える（Ctrl+Z で元に戻せるよう、可能なら execCommand で入力として置換する） */
  function replaceBuffer(text) {
    const ta = $('ccfBuf'); if (ta.value === text) return;
    ta.focus(); ta.select();
    const ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
    if (!ok || ta.value !== text) ta.value = text;
    S.bufDirty = true; updateBufInfo();
  }
  /** 変換ツールの共通処理。fn(text) → { text, count }。「一覧のテキストにも適用」ならストック全件にも行う。 */
  function applyTransform(fn, doneMsg) {
    const before = bufferText(), r = fn(before); let n = r.count; const alsoAll = $('ccfApplyAll') && $('ccfApplyAll').checked;
    if (r.text !== before) replaceBuffer(r.text);
    if (alsoAll) {
      const willChange = S.proj.stocks.some(s => fn(s.text).text !== s.text);
      if (willChange) cp('テキスト一括変換');
      let ch = false; S.proj.stocks.forEach(s => { const x = fn(s.text); if (x.text !== s.text) { s.text = x.text; n += x.count; ch = true; } }); if (ch) { saveProject(); renderCenter(); }
    }
    say(n ? doneMsg(n, alsoAll) : '変換する箇所がありませんでした');
    return n;
  }
  const diffCount = (a, b) => { let c = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) c++; return c; };
  const widthFn = f => t => { const o = f(t); return { text: o, count: diffCount(t, o) }; };
  const toHalf = () => applyTransform(widthFn(T.toHalfWidthAlnum), (n, all) => '🔤 英数字 ' + n + '文字を半角にそろえました' + (all ? '（一覧も含む）' : ''));
  const toFull = () => applyTransform(widthFn(T.toFullWidthAlnum), (n, all) => '🔤 英数字 ' + n + '文字を全角にそろえました' + (all ? '（一覧も含む）' : ''));
  function wrapWordCmd() {
    const w = $('ccfWrapWord').value.trim(); if (!w) { $('ccfWrapWord').focus(); return say('囲みたい単語を入力してください（例: HO1）'); }
    const whole = $('ccfWrapWhole').checked;
    applyTransform(t => T.wrapWord(t, w, { wholeWord: whole }), (n, all) => '{ } ' + n + '箇所を {' + T.toHalfWidthAlnum(w.replace(/^\{+|\}+$/g, '')) + '} にしました' + (all ? '（一覧も含む）' : ''));
  }
  function addStockItems(items, opts) {
    const o = opts || {};
    const list = (Array.isArray(items) ? items : [items]).map(raw => {
      const st = M.sanitizeStock(raw);
      if (!st) return null;
      if (st.docIdx == null && st.srcs && st.srcs[0] && st.srcs[0].path) {
        st.docIdx = getDocIdx(st.srcs[0].path);
      }
      return st;
    }).filter(Boolean);
    if (!list.length) return [];
    const autoInsert = S.proj.settings.autoInsertStock !== false;
    list.forEach(item => {
      if (autoInsert) {
        let pos = S.proj.stocks.length;
        for (let i = 0; i < S.proj.stocks.length; i++) {
          if (compareStocksByOrder(item, S.proj.stocks[i]) < 0) { pos = i; break; }
        }
        S.proj.stocks.splice(pos, 0, item);
      } else {
        S.proj.stocks.push(item);
      }
    });
    if (!o.silentSave) saveProject();
    if (!o.silentRender) renderCenter();
    return list;
  }

  async function addStock() {
    const text = bufferText().trim(); if (!text) return say('抽出バッファが空です。PDFでテキストを選択してください');
    cp('テキスト追加');
    const ti = $('ccfBufTitle'), title = ti ? ti.value.trim() : '';
    const src0 = (S.bufSrc && S.bufSrc[0]) || null;
    const srcPath = (src0 && src0.path) || (CCF.viewer && CCF.viewer.state && CCF.viewer.state.path) || (S.proj.pdf && S.proj.pdf.path) || '';
    const page = (src0 && src0.page) || (CCF.viewer && CCF.viewer.state && CCF.viewer.state.doc ? CCF.viewer.state.page : (S.proj.pdf && S.proj.pdf.page)) || null;
    const docIdx = srcPath ? getDocIdx(srcPath) : null;
    let lineIdx = (src0 && src0.lineIdx != null) ? Number(src0.lineIdx) : null;
    if (lineIdx == null && srcPath && page) {
      const pgLines = await warmPageLinesCache(srcPath, page);
      lineIdx = findLineIdxFromLines(pgLines, S.bufRaw || text);
    }
    addStockItems([{
      id: M.newId(),
      title,
      text,
      page,
      lineIdx,
      docIdx,
      srcs: (S.bufSrc || []).slice(0, 10),
      createdAt: Date.now()
    }], { silentSave: true, silentRender: true });
    S.bufSrc = []; S.bufRaw = ''; S.bufBody = ''; S.bufDirty = false; $('ccfBuf').value = ''; if (ti) ti.value = ''; updateBufInfo(); saveProject(); setView('stocks'); renderCenter();
    const l = $('ccfList'); if (l) l.scrollTop = l.scrollHeight; say('📝 テキスト一覧に追加しました');
  }
  function generateNpc() {
    const src = (!S.bufDirty && S.bufRaw) ? S.bufRaw : bufferText();   // 手で直していなければ、整形前の「行構造が生きた」原文で解析する
    if (!src.trim()) return say('抽出バッファが空です。NPCのステータスブロックを選択してください');
    const s = S.proj.settings, blocks = N.splitNpcBlocks(src);
    const drafts = blocks.map(b => N.parseNpc(b, Object.assign({ edition: s.edition, rollPrefix: s.rollPrefix, abilityRolls: s.abilityRolls }, window.CCFSys.parseOpts(s))));
    drafts.forEach(d => { d.srcs = (S.bufSrc || []).slice(0, 10).map(x => Object.assign({}, x)); });   // 抽出元PDF・ページ・座標をNPCに記録
    CCF.openNpcReview(drafts, { mode: 'new' });
  }
  function updateAssetCount() {
    const el = $('ccfAssetCount');
    const sum = $('ccfAssetsSummary');
    const scnItems = (CCF.assets && CCF.assets.getUnifiedItems) ? CCF.assets.getUnifiedItems(S.key) : [];
    const n = (CCF.assets && CCF.assets.countFor) ? CCF.assets.countFor(S.key) : ((S.proj.refs || []).length);
    if (el) el.textContent = n;
    if (sum) {
      const isCommon = !!(CCF.library && CCF.library.state && CCF.library.state.source === 'common');
      const items = isCommon && window.CommonAssets ? window.CommonAssets.getAll() : scnItems;
      const imgN = items.filter(r => r.type === 'image').length;
      const audN = items.filter(r => r.type === 'audio').length;
      const vidN = items.filter(r => r.type === 'video').length;
      const docN = items.filter(r => r.type === 'pdf' || r.type === 'doc' || r.type === 'zip').length;
      const parts = [`🖼️ 画像 ${imgN}枚`, `🎵 音声 ${audN}件`];
      if (vidN) parts.push(`🎬 動画 ${vidN}件`);
      if (docN) parts.push(`📄 資料 ${docN}件`);
      const sc = scenarioObj(S.key);
      const prefix = isCommon ? 'マイライブラリ' : (sc ? (sc.title || '無題') : '（シナリオ未選択）');
      sum.textContent = `${prefix} — 計 ${items.length}件（${parts.join(' / ')}）`;
    }
  }
  function updateTabCounts() {
    const stEl = $('ccfStockCount');
    const npEl = $('ccfNpcCount');
    const scEl = $('ccfSceneCount');
    const stockCnt = ((S.proj && Array.isArray(S.proj.stocks)) ? S.proj.stocks.length : 0)
      + ((S.proj && Array.isArray(S.proj.pieces)) ? S.proj.pieces.length : 0);
    if (stEl) stEl.textContent = stockCnt;
    if (npEl) npEl.textContent = (S.proj && Array.isArray(S.proj.npcs)) ? S.proj.npcs.length : 0;
    if (scEl) scEl.textContent = (S.proj && Array.isArray(S.proj.scenes)) ? S.proj.scenes.length : 0;
    updateAssetCount();
  }
  function setView(v) {
    S.view = v || 'stocks';
    document.querySelectorAll('#ccfCenter .ccf-rtab').forEach(b => {
      const on = b.dataset.view === S.view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    const buf = $('ccfBufferBox'), list = $('ccfList'), sceneP = $('ccfScenePanel'), assetsP = $('ccfAssetsPanel');
    if (buf) buf.hidden = S.view !== 'stocks';
    if (list) list.hidden = (S.view !== 'stocks' && S.view !== 'npcs');
    if (sceneP) sceneP.hidden = S.view !== 'scene';
    if (assetsP) assetsP.hidden = S.view !== 'assets';
    if (S.view === 'assets' && CCF.library) CCF.library.render();
    renderCenter();
    if (S.view === 'scene' && CCF.sceneUI && typeof CCF.sceneUI.refitCamera === 'function') {
      requestAnimationFrame(() => CCF.sceneUI.refitCamera(false));
    }
  }
  function renderCenter() {
    const box = $('ccfList'); if (!box) return;
    updateTabCounts(); refreshMarks();
    if (S.view === 'scene') { renderProps(); return; }
    if (S.view === 'assets') { if (CCF.library) CCF.library.render(); return; }
    S.sel = S.sel || new Set();
    { const ids = new Set((S.view === 'npcs' ? S.proj.npcs : S.proj.stocks).map(x => x.id)); [...S.sel].forEach(id => { if (!ids.has(id)) S.sel.delete(id); }); }
    if (S.view === 'npcs') {
      box.innerHTML = CCF.npcListHtml();
      return;
    }
    const all = S.proj.stocks, st = visibleStocks(), reorder = (S.stockSort || 'manual') === 'manual' && !String(S.stockFilter || '').trim();
    box.innerHTML = `<div class="ccf-list-bar"><button type="button" class="ccf-btn accent" data-s="dummy"${all.length ? '' : ' disabled'}>🧩 ダミー駒（チャパレ）を生成</button>
      <button type="button" class="ccf-btn accent" data-s="dummy-sel" data-selbtn="1" data-label="🧩 選択を個別のダミー駒に"${S.sel.size ? '' : ' disabled'}>🧩 選択を個別のダミー駒に（${S.sel.size}）</button>
      <button type="button" class="ccf-btn" data-s="clue-sel" data-selbtn="1" data-label="🔎 選択を手がかり駒に"${S.sel.size ? '' : ' disabled'} title="調査箇所テキストを、本文入りのオブジェクト駒として生成します">🔎 選択を手がかり駒に（${S.sel.size}）</button>
      <button type="button" class="ccf-btn" data-s="sort-order"${all.length > 1 ? '' : ' disabled'} title="資料順 → ページ順 → 登場順で一覧を並び替えます（Ctrl+Zで元に戻せます）">📑 ページ・登場順に整列</button>
      <label class="ccf-chk" title="テキスト追加時に自動でページ・登場順の位置へ挿入します"><input type="checkbox" id="ccfAutoInsertStock"${S.proj.settings.autoInsertStock !== false ? ' checked' : ''}> 追加時に自動でページ・登場順の位置へ挿入</label>
      <button type="button" class="ccf-btn" data-s="clear"${all.length ? '' : ' disabled'}>全削除</button>
      <button type="button" class="ccf-btn${S.showTextSettings ? ' primary' : ''}" data-toggle-set="text" title="抽出・整形およびダミー駒の設定を開閉します">⚙️ 抽出・ダミー駒設定 ${S.showTextSettings ? '▴' : '▾'}</button>
      ${CCF.bulkBarHtml('s', all.length)}
      <input type="search" id="ccfStockFilter" value="${esc(S.stockFilter || '')}" placeholder="🔍 絞り込み（例：HO1）" aria-label="キーワード絞り込み" style="width:150px">
      <select id="ccfStockSort" aria-label="並び替え">${[['manual', '並び：手動'], ['title', '見出し順'], ['page', 'ページ順'], ['created', '追加順'], ['length', '文字数順']].map(([v, l]) => `<option value="${v}"${(S.stockSort || 'manual') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <span class="ccf-muted">${st.length === all.length ? all.length + '件' : st.length + '/' + all.length + '件'}。${reorder ? '⠿ をドラッグして並べ替え（順番どおりにチャットパレットへ並びます）' : '※並べ替え（⠿▲▼）は「並び：手動」かつ絞り込みなしのときだけ使えます'}</span></div>` +
      (S.showTextSettings ? textSettingsHtml() : '') +
      (st.map((s, i) => {
        const jumpPg = (s.srcs && s.srcs[0] && s.srcs[0].page) || s.page;
        const jumpName = (s.srcs && s.srcs[0] && s.srcs[0].name) || '表示中の資料';
        return `<div class="ccf-stock" data-id="${esc(s.id)}">
        <div class="ccf-stock-head"><input type="checkbox" class="ccf-selchk" data-sel="${esc(s.id)}" aria-label="選択"${S.sel.has(s.id) ? ' checked' : ''}><span class="ccf-grip" ${reorder ? 'draggable="true"' : 'style="opacity:.35"'} title="ドラッグで並べ替え">⠿</span><span class="ccf-no">#${all.indexOf(s) + 1}</span><input type="text" class="ccf-stock-title" data-f="title" value="${esc(s.title)}" placeholder="${esc(T.stockTitle({ text: s.text }, 14))}" aria-label="見出し">
          ${jumpPg ? `<button type="button" class="ccf-badge ccf-page-badge ccf-jump" data-s="jump" title="抽出元（${esc(jumpName)}）の該当ページへジャンプします">📄 P.${jumpPg}</button>` : ''}
          <span class="ccf-actions"><button type="button" class="ccf-mini" data-s="up" title="上へ"${reorder && i ? '' : ' disabled'}>▲</button><button type="button" class="ccf-mini" data-s="down" title="下へ"${reorder && i < st.length - 1 ? '' : ' disabled'}>▼</button><button type="button" class="ccf-mini danger" data-s="del" title="削除">🗑</button></span></div>
        <textarea class="ccf-stock-text" data-f="text" rows="3" aria-label="本文">${esc(s.text)}</textarea></div>`;
      }).join('') || '<div class="ccf-empty">まだテキストがありません。PDFでテキストを選択 →「📝 テキスト一覧に追加」</div>');
  }
  function effectiveDocIdx(item) {
    if (item && item.docIdx != null && Number.isFinite(Number(item.docIdx))) return Number(item.docIdx);
    const p = item && item.srcs && item.srcs[0] && item.srcs[0].path;
    if (p) {
      const idx = getDocIdx(p);
      return idx != null ? idx : 0;
    }
    if (item && (item.page != null || (item.srcs && item.srcs[0] && item.srcs[0].page))) return 0;
    return 1e9;
  }
  function effectivePage(item) {
    if (item && item.page != null && Number(item.page) > 0) return Number(item.page);
    const sp = item && item.srcs && item.srcs[0] && item.srcs[0].page;
    return sp && Number(sp) > 0 ? Number(sp) : 1e9;
  }
  function effectiveLineIdx(item) {
    if (item && item.lineIdx != null && Number.isFinite(Number(item.lineIdx))) return Number(item.lineIdx);
    return 1e9;
  }
  function compareStocksByOrder(a, b) {
    const da = effectiveDocIdx(a), db = effectiveDocIdx(b);
    if (da !== db) return da - db;
    const pa = effectivePage(a), pb = effectivePage(b);
    if (pa !== pb) return pa - pb;
    const la = effectiveLineIdx(a), lb = effectiveLineIdx(b);
    if (la !== lb) return la - lb;
    return (a.createdAt || 0) - (b.createdAt || 0);
  }
  /** シナリオテキスト一覧の並び替え（表示順のみ。保存順は変えない）とキーワード絞り込み */
  function orderStocks(arr) {
    const m = S.stockSort || 'manual'; if (m === 'manual') return arr.slice();
    const ttl = s => s.title || T.stockTitle({ text: s.text }, 14);
    const cmp = { title: (x, y) => ttl(x).localeCompare(ttl(y), 'ja', { numeric: true }), page: compareStocksByOrder, created: (x, y) => x.createdAt - y.createdAt, length: (x, y) => y.text.length - x.text.length }[m];
    return arr.slice().sort(cmp);
  }
  function visibleStocks() {
    const kws = String(S.stockFilter || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return orderStocks(S.proj.stocks.filter(s => !kws.length || kws.every(k => (s.title + '\n' + s.text).toLowerCase().includes(k))));
  }
  CCF.visibleStocks = visibleStocks;
  async function onStockClick(e) {
    const b = e.target.closest('[data-s]'); if (!b) return; const k = b.dataset.s, row = b.closest('.ccf-stock'), st = S.proj.stocks;
    if (k === 'dummy') return CCF.openDummyPieces();
    if (k === 'dummy-sel' || k === 'clue-sel') {   // 選択したテキストを統合せず、1つずつ独立した駒にする
      const picked = orderStocks(st.filter(s => S.sel.has(s.id))); if (!picked.length) return say('チェックボックスで駒にするテキストを選んでください');
      if (k === 'clue-sel') return CCF.openDummyPieces({ pieces: M.buildCluePieces(picked), title: '🔎 手がかり駒', clue: true });
      return CCF.openDummyPieces({ pieces: M.buildDummyPieces(picked, S.proj.settings, { each: true }), title: '🧩 個別ダミー駒（' + picked.length + '件）' });
    }
    if (k === 'bulkall' || k === 'bulkdel') return CCF.onBulk(k, 'stocks', 'シナリオテキスト');
    if (k === 'sort-order') {
      if (st.length <= 1) return;
      cp('ページ・登場順に整列');
      st.sort(compareStocksByOrder);
      S.stockSort = 'manual';
      saveProject(); renderCenter();
      return say('📑 ページ・登場順に整列しました');
    }
    if (k === 'clear') { if (await appConfirm('シナリオテキスト一覧を全件削除しますか？', { okText: '削除', danger: true })) { cp('テキスト全削除'); S.proj.stocks = []; saveProject(); renderCenter(); } return; }
    const i = row ? st.findIndex(s => s.id === row.dataset.id) : -1; if (i < 0) return;
    if (k === 'jump') return jumpToSrc(st[i]);
    if (k === 'del') { cp('テキスト削除'); st.splice(i, 1); }
    else if (k === 'up' && i > 0) { cp('テキスト並べ替え'); [st[i - 1], st[i]] = [st[i], st[i - 1]]; }
    else if (k === 'down' && i < st.length - 1) { cp('テキスト並べ替え'); [st[i + 1], st[i]] = [st[i], st[i + 1]]; }
    saveProject(); renderCenter();
  }
  // ---- 一括選択・一括削除・D&D 並べ替え（シナリオテキスト／NPC 共通） ----
  CCF.bulkBarHtml = (pre, total) => `<button type="button" class="ccf-btn" data-${pre}="bulkall"${total ? '' : ' disabled'}>☑ 全選択/解除</button><button type="button" class="ccf-btn danger" data-${pre}="bulkdel" data-bulk="1"${S.sel.size ? '' : ' disabled'}>🗑 選択を削除（${S.sel.size}）</button>`;
  function refreshBulk() {
    document.querySelectorAll('#ccfList [data-bulk]').forEach(b => { b.disabled = !S.sel.size; b.textContent = '🗑 選択を削除（' + S.sel.size + '）'; });
    document.querySelectorAll('#ccfList [data-selbtn]').forEach(b => { b.disabled = !S.sel.size; b.textContent = b.dataset.label + '（' + S.sel.size + '）'; });
  }
  CCF.onBulk = async function (k, key, label) {
    const arr = S.proj[key];
    if (k === 'bulkall') { const vis = key === 'stocks' ? visibleStocks() : arr; if (vis.length && vis.every(x => S.sel.has(x.id))) vis.forEach(x => S.sel.delete(x.id)); else vis.forEach(x => S.sel.add(x.id)); return renderCenter(); }
    if (!S.sel.size) return;
    if (!(await appConfirm(label + ' ' + S.sel.size + '件を削除しますか？', { okText: '削除', danger: true }))) return;
    cp(label + '一括削除');
    S.proj[key] = arr.filter(x => !S.sel.has(x.id)); S.sel.clear(); saveProject(); renderCenter();
  };
  /** 一覧エリア（#ccfCenter）を画面いっぱいのポップアップにする／戻す（同じ要素のまま拡大するので、並べ替え・選択・一括削除・確認修正はそのまま使える） */
  function toggleZoom(on) {
    const c = $('ccfCenter'); if (!c) return; on = on === undefined ? !c.classList.contains('ccf-zoom') : !!on;
    c.classList.toggle('ccf-zoom', on); document.body.classList.toggle('ccf-zooming', on);
    c.querySelectorAll('.ccf-zoom-btn, [data-zoom]').forEach(b => {
      b.textContent = on ? '✕ 拡大を閉じる' : '🗗 拡大表示';
    });
    if (S.view === 'scene' && CCF.sceneUI && typeof CCF.sceneUI.refitCamera === 'function') {
      CCF.sceneUI.refitCamera(true);
      requestAnimationFrame(() => {
        if (CCF.sceneUI && typeof CCF.sceneUI.refitCamera === 'function') CCF.sceneUI.refitCamera(true);
      });
    }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('ccf-zooming') && !document.querySelector('.ccf-overlay,.app-dialog-overlay')) toggleZoom(false); });
  function wireListDnd() {
    const box = $('ccfList'); if (!box || box.dataset.dnd) return; box.dataset.dnd = '1';
    let from = null; const rowOf = e => e.target.closest && e.target.closest('.ccf-stock,.ccf-npc'), arrOf = () => S.view === 'npcs' ? S.proj.npcs : S.proj.stocks;
    const clear = () => box.querySelectorAll('.ccf-dragging,.ccf-over-top,.ccf-over-bottom').forEach(x => x.classList.remove('ccf-dragging', 'ccf-over-top', 'ccf-over-bottom'));
    box.addEventListener('dragstart', e => { const g = e.target.closest && e.target.closest('.ccf-grip'), r = g && rowOf(e); if (!r) return; from = r.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/ccf-reorder', from); try { e.dataTransfer.setDragImage(r, 20, 20); } catch (x) { if (typeof logSoft === 'function') logSoft('setDragImage', x); } r.classList.add('ccf-dragging'); });
    box.addEventListener('dragend', () => { from = null; clear(); });
    box.addEventListener('dragover', e => { const r = rowOf(e); if (from === null || !r) return; e.preventDefault(); e.stopPropagation(); const b = r.getBoundingClientRect(), top = e.clientY < b.top + b.height / 2; r.classList.toggle('ccf-over-top', top); r.classList.toggle('ccf-over-bottom', !top); });
    box.addEventListener('dragleave', e => { const r = rowOf(e); if (r) r.classList.remove('ccf-over-top', 'ccf-over-bottom'); });
    box.addEventListener('drop', e => {
      const r = rowOf(e); if (from === null || !r) return; e.preventDefault(); e.stopPropagation();
      const arr = arrOf(), a = arr.findIndex(x => x.id === from); let b = arr.findIndex(x => x.id === r.dataset.id); const bb = r.getBoundingClientRect(); if (e.clientY >= bb.top + bb.height / 2) b++;
      from = null; clear(); if (a < 0 || b < 0) return; cp(S.view === 'npcs' ? 'NPC並べ替え' : 'テキスト並べ替え'); const [m] = arr.splice(a, 1); if (a < b) b--; arr.splice(b, 0, m); saveProject(); renderCenter();
    });
    box.addEventListener('change', e => { const c = e.target.closest && e.target.closest('[data-sel]'); if (!c) return; if (c.checked) S.sel.add(c.dataset.sel); else S.sel.delete(c.dataset.sel); refreshBulk(); });
    const applyFilter = el => { S.stockFilter = el.value; const pos = el.selectionStart; renderCenter(); const f = $('ccfStockFilter'); if (f) { f.focus(); try { f.setSelectionRange(pos, pos); } catch (x) { if (typeof logSoft === 'function') logSoft('setSelectionRange', x); } } };
    box.addEventListener('input', e => { if (e.target.id === 'ccfStockFilter' && !e.isComposing) applyFilter(e.target); });
    box.addEventListener('compositionend', e => { if (e.target.id === 'ccfStockFilter') applyFilter(e.target); });
    box.addEventListener('change', e => {
      if (e.target.id === 'ccfStockSort') { S.stockSort = e.target.value; renderCenter(); return; }
      if (e.target.id === 'ccfAutoInsertStock') {
        cp('自動位置挿入設定変更');
        S.proj.settings = M.sanitizeSettings(Object.assign({}, S.proj.settings, { autoInsertStock: !!e.target.checked }));
        saveProject();
      }
    });
  }
  function onStockInput(e) {
    const el = e.target.closest('[data-f]'); const row = el && el.closest('.ccf-stock'); if (!row) return;
    const s = S.proj.stocks.find(x => x.id === row.dataset.id); if (!s) return; s[el.dataset.f] = el.value; saveProject();
  }

  // ======================================================================
  // 6. 起動・イベント配線
  // ======================================================================
  function layoutHeight() { const r = $('ccfTab'); if (!r || !r.classList.contains('active')) return; const top = r.getBoundingClientRect().top; r.style.height = Math.max(560, window.innerHeight - top - 40) + 'px'; }
  let readyPromise = null;
  async function onShow() {
    buildShell(); wireScenarioSearch(); buildProjectSelect(); if (S.ready) buildDocSelect(); layoutHeight();
    if (CCF.sceneUI) { CCF.sceneUI.wire(); if (S.view === 'scene') CCF.sceneUI.render(); }
    if (!S.ready) {
      S.ready = true;
      readyPromise = (async () => {
        let last = '_default'; try { last = localStorage.getItem('ccf_last_project') || '_default'; } catch (e) { if (typeof logSoft === 'function') logSoft('getLastProject', e); }
        if (!scenarioList().some(sc => String(sc.id) === last)) last = '_default';
        S.key = last;
        await switchProject(last, null, { deferPdf: true });
        if (CCF.library) CCF.library.init();
      })();
      await readyPromise;
    } else if (readyPromise) {
      await readyPromise;
    }
  }
  function openDocExportWithCloudDirect() {
    if (!CCF.docExport || typeof CCF.docExport.openMenu !== 'function') return;
    const before = new Set(document.querySelectorAll('.ccf-overlay'));
    CCF.docExport.openMenu();
    const ov = [...document.querySelectorAll('.ccf-overlay')].find(el => !before.has(el));
    if (!ov) return;
    const foot = ov.querySelector('.ccf-modal-foot') || ov.querySelector('.ccf-modal-body') || ov.querySelector('.ccf-modal');
    if (!foot || ov.querySelector('#ccfDocSaveCloud')) return;
    const bar = document.createElement('div');
    bar.className = 'ccf-doc-cloud-bar';
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-right:auto;';
    bar.innerHTML = `<label class="ccf-chk" title="出力したGM進行用HTML / しおり付きPDF / 整形TXTをクラウドの専用フォルダ（exports）へも直接保存します"><input type="checkbox" id="ccfDocSaveCloud"> ☁️ クラウドにも直接保存</label><span class="ccf-muted" id="ccfDocCloudStatus"></span>`;
    foot.prepend(bar);

    let disarmTimer = null;
    let restoreFns = null;
    const disarm = () => {
      clearTimeout(disarmTimer); disarmTimer = null;
      if (restoreFns) { restoreFns(); restoreFns = null; }
    };
    const pushCloud = async (fname, data, mime) => {
      if (!window.CloudSync || typeof CloudSync.uploadExportFile !== 'function') return;
      const stEl = ov.querySelector('#ccfDocCloudStatus');
      if (stEl) stEl.textContent = '☁️ クラウドへ保存中…';
      try {
        const res = await CloudSync.uploadExportFile(fname, data, mime);
        if (res && res.ok) {
          say(`✅ クラウドへ直接保存しました：${res.fileName}`);
          if (stEl) { stEl.style.color = 'var(--dc-green)'; stEl.textContent = `☁️ 保存済み: ${res.fileName}`; }
        }
      } catch (err) {
        console.error('[ccf] 資料のクラウド直接保存エラー', err);
        say('❌ クラウド保存に失敗しました: ' + (err && err.message || err));
        if (stEl) { stEl.style.color = 'var(--dc-red)'; stEl.textContent = '⚠️ 保存失敗'; }
      }
    };
    const armCapture = () => {
      disarm();
      const origDl = window.WebBridge && WebBridge.downloadBlob;
      const origCreate = URL.createObjectURL;
      const origAnchorClick = HTMLAnchorElement.prototype.click;
      const origWriteSync = IS_ELECTRON && fs ? fs.writeFileSync : null;
      const origWriteAsync = IS_ELECTRON && fs && fs.promises ? fs.promises.writeFile : null;
      const blobUrls = new Map();
      let captured = false;
      const onCaptured = (name, data, mime) => {
        if (captured) return;
        captured = true;
        disarm();
        void pushCloud(name, data, mime);
      };
      if (window.WebBridge && origDl) {
        WebBridge.downloadBlob = function (blob, fname, mime) {
          try { onCaptured(fname || 'scenario_doc', blob, mime || (blob && blob.type)); } catch (_) {}
          return origDl.apply(this, arguments);
        };
      }
      URL.createObjectURL = function (obj) {
        const u = origCreate.apply(this, arguments);
        if (obj instanceof Blob) blobUrls.set(u, obj);
        return u;
      };
      HTMLAnchorElement.prototype.click = function () {
        try {
          if (this.download && this.href && blobUrls.has(this.href)) {
            const b = blobUrls.get(this.href);
            onCaptured(this.download, b, b.type);
          }
        } catch (_) {}
        return origAnchorClick.apply(this, arguments);
      };
      if (origWriteSync) {
        fs.writeFileSync = function (file, data) {
          const r = origWriteSync.apply(this, arguments);
          try {
            const p = String(file || '');
            if (/\.(html?|pdf|txt)$/i.test(p)) {
              const nm = path ? path.basename(p) : p.split(/[\\/]/).pop();
              const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
              onCaptured(nm, bytes, '');
            }
          } catch (_) {}
          return r;
        };
      }
      if (origWriteAsync) {
        fs.promises.writeFile = async function (file, data) {
          const r = await origWriteAsync.apply(this, arguments);
          try {
            const p = String(file || '');
            if (/\.(html?|pdf|txt)$/i.test(p)) {
              const nm = path ? path.basename(p) : p.split(/[\\/]/).pop();
              const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
              onCaptured(nm, bytes, '');
            }
          } catch (_) {}
          return r;
        };
      }
      restoreFns = () => {
        if (window.WebBridge && origDl) WebBridge.downloadBlob = origDl;
        URL.createObjectURL = origCreate;
        HTMLAnchorElement.prototype.click = origAnchorClick;
        if (origWriteSync) fs.writeFileSync = origWriteSync;
        if (origWriteAsync) fs.promises.writeFile = origWriteAsync;
      };
      disarmTimer = setTimeout(disarm, 20000);
    };

    ov.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const chk = ov.querySelector('#ccfDocSaveCloud');
      if (!chk || !chk.checked) return;
      const txt = (btn.textContent || '');
      if (/閉じる|キャンセル|✕/.test(txt)) return;
      armCapture();
    }, true);
    new MutationObserver(() => {
      if (!document.body.contains(ov)) disarm();
    }).observe(document.body, { childList: true });
  }
  function wire() {
    const root = $('ccfTab'); if (!root) return;
    root.addEventListener('click', e => {
      const pb = e.target.closest('[data-pop]'); if (pb) { if (pb.dataset.pop === 'back') ipc.send('ccf:popout-close'); else ipc.invoke('ccf:popout', null); return; }
      if (e.target.id === 'ccfAddRoomBtn') {
        const ask = typeof appPrompt === 'function' ? appPrompt : (msg, def) => Promise.resolve(prompt(msg, def));
        ask('新しい部屋データの名前を入力してください', `部屋 ${S.rooms.length + 1}`, { title: '🏠 新規部屋の作成', okText: '作成' }).then(name => {
          if (name && name.trim()) addRoom(name.trim());
        });
        return;
      }
      if (e.target.id === 'ccfRenameRoomBtn') {
        const cur = S.rooms.find(r => r.id === S.roomId);
        const ask = typeof appPrompt === 'function' ? appPrompt : (msg, def) => Promise.resolve(prompt(msg, def));
        ask('部屋データの新しい名前を入力してください', cur ? cur.name : '', { title: '✏️ 部屋名の変更', okText: '変更' }).then(name => {
          if (name && name.trim()) renameRoom(S.roomId, name.trim());
        });
        return;
      }
      if (e.target.id === 'ccfCopyRoomBtn') {
        openDuplicateRoomDialog(S.key, S.roomId);
        return;
      }
      if (e.target.id === 'ccfLinkRoomBtn') {
        openLinkRoomDialog(S.key, S.roomId);
        return;
      }
      if (e.target.id === 'ccfDelRoomBtn') {
        const cur = S.rooms.find(r => r.id === S.roomId);
        if (!cur) return;
        if (S.rooms.length <= 1) return say('⚠️ 部屋データは最低1つ必要です（削除できません）');
        appConfirm(`部屋データ「${cur.name}」を削除しますか？`, { okText: '削除', danger: true }).then(ok => {
          if (ok) deleteRoom(S.roomId);
        });
        return;
      }
      const b = e.target.closest('[data-b]'); if (b) {
        const k = b.dataset.b;
        if (k === 'clean') { replaceBuffer(T.cleanText(bufferText(), cleanOpts())); }
        else if (k === 'clear') { S.bufSrc = []; S.bufRaw = ''; S.bufBody = ''; S.bufDirty = false; $('ccfBuf').value = ''; { const ti = $('ccfBufTitle'); if (ti) ti.value = ''; } updateBufInfo(); if (CCF.viewer && CCF.viewer.clearSelection) CCF.viewer.clearSelection(); if (S.popped) sendPopout('ccf:clear-selection'); }
        else if (k === 'half') toHalf(); else if (k === 'full') toFull(); else if (k === 'wrap') wrapWordCmd();
        else if (k === 'stock') addStock(); else if (k === 'npc') generateNpc(); else if (k === 'scan') { if (CCF.scan && CCF.scan.open) CCF.scan.open(); else say('NPC一括検出はデスクトップ版で使えます'); } return;
      }
      if (e.target.closest('[data-zoom]')) return toggleZoom();
      const ts = e.target.closest('[data-toggle-set]');
      if (ts) {
        if (ts.dataset.toggleSet === 'text') S.showTextSettings = !S.showTextSettings;
        else if (ts.dataset.toggleSet === 'npc') S.showNpcSettings = !S.showNpcSettings;
        renderCenter();
        return;
      }
      if (e.target.closest('[data-open-assets-modal]')) { if (CCF.assets) CCF.assets.openModal(S.key, (CCF.library && CCF.library.state && CCF.library.state.source) || 'scenario'); return; }
      if (e.target.closest('[data-sync-assets]')) { if (CCF.library && CCF.library.syncAll) CCF.library.syncAll(true); else if (CCF.library) CCF.library.render(); return; }
      if (e.target.closest('[data-add-assets]')) { if (CCF.library && CCF.library.addAssets) CCF.library.addAssets(); else if (CCF.assets && CCF.assets.pickAddFiles) CCF.assets.pickAddFiles(S.key); return; }
      const sa = e.target.closest('[data-scene-act]');
      if (sa) {
        const sk = sa.dataset.sceneAct;
        if (sk === 'dummy' && CCF.openDummyPieces) return CCF.openDummyPieces();
        if (sk === 'add-room') return void ($('ccfAddRoomBtn') && $('ccfAddRoomBtn').click());
        if (sk === 'dup-room') return void ($('ccfCopyRoomBtn') && $('ccfCopyRoomBtn').click());
        if ((sk === 'zip-export' || sk === 'zip-room') && CCF.ccfExport) return CCF.ccfExport.openWizard('room');
        if (sk === 'zip-pieces' && CCF.ccfExport) return CCF.ccfExport.openWizard('pieces');
        if (sk === 'zip-import' && CCF.ccfImport) return void CCF.ccfImport.pickAndImport();
        if (sk === 'doc-export' && CCF.docExport) return openDocExportWithCloudDirect();
        return;
      }
      const sv = e.target.closest('#ccfCenter .ccf-rtab'); if (sv) return setView(sv.dataset.view);
      if (e.target.closest('#ccfList [data-s]')) return onStockClick(e);
      if (e.target.closest('#ccfList [data-n]')) return CCF.onNpcClick(e);
    });
    window.addEventListener('ccf-refs-changed', () => { invalidateDocListCache(); updateAssetCount(); try { buildDocSelect(); } catch (e) { /* noop */ } });
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'ccfWrapWord') { e.preventDefault(); wrapWordCmd(); } });
    root.addEventListener('input', e => {
      if (e.target.id === 'ccfBuf') { S.bufDirty = true; updateBufInfo(); return; }
      if (e.target.closest('#ccfList .ccf-stock')) return onStockInput(e);
      if (e.target.closest('.ccf-props') && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') onSetting(e);
    });
    root.addEventListener('change', e => {
      if (e.target.dataset && e.target.dataset.ext) { const p = {}; p[e.target.dataset.ext] = e.target.checked; window.CCFPdfViewer.setExtOpts(p); return; }
      if (e.target.id === 'ccfRoomSelect') return void switchRoom(e.target.value);
      if (e.target.id === 'ccfProject') return void switchProject(e.target.value);
      if (e.target.closest('.ccf-props')) onSetting(e);
    });
    wireListDnd(); window.addEventListener('resize', layoutHeight); wireIpc();
  }
  function init() {
    const root = $('ccfTab'); if (!root) return;
    if (typeof PAGE_NAMES !== 'undefined') PAGE_NAMES.ccfTab = '🎲 ココフォリア準備ツール';
    const btn = document.querySelector('[data-tab="ccfTab"]');
    if (btn && !btn.dataset.ccfTabWired) {
      btn.dataset.ccfTabWired = '1';
      btn.addEventListener('click', () => {
        if (!document.body || document.body.dataset.activeTab !== 'ccfTab') switchTab('ccfTab');
      });
    }
    if (!switchTab._ccfWrapped) {
      const orig = switchTab;
      switchTab = function (tabId, evt) {
        const prevTab = (document.body && document.body.dataset) ? document.body.dataset.activeTab : '';
        if (prevTab === 'ccfTab' && tabId !== 'ccfTab') flushPdfPosToRoom();
        orig(tabId, evt);
        if (tabId === 'ccfTab') onShow();
      };
      switchTab._ccfWrapped = true;
    }
    buildShell(); wire();
  }
  /** 他モジュール（D&D 登録など）から、指定シナリオのプロジェクトを開いてココフォリアタブへ移る */
  async function activateProject(key, roomId) { buildProjectSelect(); if (!document.body || document.body.dataset.activeTab !== 'ccfTab') switchTab('ccfTab'); await onShow(); if (key !== S.key || (roomId && roomId !== S.roomId)) await switchProject(key, roomId); else { renderCenter(); buildDocSelect(); if (CCF.library) CCF.library.render(); } }
  function onScenarioDeleted(id, sc) {
    invalidateDocListCache();
    try {
      if (IS_ELECTRON && fs && id != null) {
        const f = projFile(id);
        if (f && fs.existsSync(f)) fs.unlinkSync(f);
      }
      roomContainerCache.delete(String(id));
    } catch (e) { if (typeof logSoft === 'function') logSoft('delProjFile', e); }
    try {
      const paths = [];
      if (sc && Array.isArray(sc.docs) && IS_ELECTRON) {
        sc.docs.forEach(d => { try { if (d && d.rel) paths.push(path.resolve(DATA_ROOT, d.rel)); } catch (e) { if (typeof logSoft === 'function') logSoft('delDocPath', e); } });
      }
      if (sc && Array.isArray(sc.ccfRooms)) {
        sc.ccfRooms.forEach(rm => {
          const p = rm && rm.project; if (!p) return;
          if (p.pdf && p.pdf.path) paths.push(p.pdf.path);
          (p.refs || []).forEach(r => { if (r && r.path) paths.push(r.path); });
        });
      }
      if (CCF.viewer && typeof CCF.viewer.evictPaths === 'function' && paths.length) CCF.viewer.evictPaths(paths);
      if (String(S.key) === String(id)) switchProject('_default');
    } catch (e) { if (typeof logSoft === 'function') logSoft('onScenarioDeleted', e); }
  }
  function onCloudSyncApplied() {
    try {
      roomContainerCache.clear();
      invalidateDocListCache();
      if (CCF.assets && CCF.assets.invalidateUnified) CCF.assets.invalidateUnified(null, false);
      if (S.ready) {
        if (S.key !== '_default' && !scenarioObj(S.key)) S.key = '_default';
        const container = getRoomContainer(S.key);
        S.rooms = container.rooms;
        if (!S.rooms.some(r => r.id === S.roomId)) {
          S.roomId = (container.activeRoomId && S.rooms.some(r => r.id === container.activeRoomId)) ? container.activeRoomId : (S.rooms[0] ? S.rooms[0].id : M.newId());
        }
        const curRoom = S.rooms.find(r => r.id === S.roomId);
        S.proj = curRoom ? curRoom.project : M.sanitizeProject(null);
        applyLocalPdfPos(S.key, S.roomId, S.proj, curRoom && curRoom.updatedAt);
        if (CCF.sceneUI && CCF.sceneUI.onProjectSwitch) CCF.sceneUI.onProjectSwitch();
        buildProjectSelect(); renderProps(); renderCenter(); buildDocSelect();
        if (CCF.library) CCF.library.render();
      }
    } catch (e) { if (typeof logSoft === 'function') logSoft('onCloudSyncApplied', e); }
  }
  const hasNonEmptyArr = v => Array.isArray(v) && v.length > 0;
  function hasSceneAssetVal(v) {
    if (!v) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'object') {
      return Boolean(v.path || v.url || v.src || v.dataUrl || v.id || v.hash || v.name || hasNonEmptyArr(v.items));
    }
    return false;
  }
  function isSceneActuallyEdited(s) {
    if (!s || typeof s !== 'object') return false;
    if (hasSceneAssetVal(s.bg) || hasSceneAssetVal(s.fg) || hasSceneAssetVal(s.bgm)) return true;
    if (s.board && hasNonEmptyArr(s.board.items)) return true;
    if (hasNonEmptyArr(s.screenPanels) || hasNonEmptyArr(s.screens) || hasNonEmptyArr(s.markers)) return true;
    return false;
  }
  function isSingleProjActuallyEdited(p) {
    if (!p || typeof p !== 'object') return false;
    if (hasNonEmptyArr(p.items) || hasNonEmptyArr(p.stocks)) return true;
    if (hasNonEmptyArr(p.npcs)) return true;
    if (p.board && hasNonEmptyArr(p.board.items)) return true;
    if (hasNonEmptyArr(p.screenPanels) || hasNonEmptyArr(p.screens) || hasNonEmptyArr(p.markers)) return true;
    if (Array.isArray(p.scenes)) {
      if (p.scenes.length >= 2) return true;
      if (p.scenes.some(isSceneActuallyEdited)) return true;
    }
    if (hasNonEmptyArr(p.cutins)) return true;
    return false;
  }
  function isProjectActuallyEdited(projData) {
    if (!projData || typeof projData !== 'object') return false;
    if (Array.isArray(projData)) return projData.some(isProjectActuallyEdited);
    if (Array.isArray(projData.rooms)) return projData.rooms.some(r => isProjectActuallyEdited((r && r.project) || r));
    if (projData.project && typeof projData.project === 'object') return isSingleProjActuallyEdited(projData.project);
    return isSingleProjActuallyEdited(projData);
  }
  window.isProjectActuallyEdited = isProjectActuallyEdited;
  function isEmptyProjObj(p) { return !isSingleProjActuallyEdited(p); }
  function isEmptyProjectContainer(raw) { return !isProjectActuallyEdited(raw); }
  function cleanupEmptyScenarioDirs() {
    if (!IS_ELECTRON || typeof fs === 'undefined' || typeof path === 'undefined' || !DATA_ROOT) return 0;
    const scenDir = path.join(DATA_ROOT, 'scenarios');
    if (!fs.existsSync(scenDir)) return 0;
    let removed = 0;
    const prune = dir => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const ent of entries) {
        if (ent.isDirectory()) prune(path.join(dir, ent.name));
      }
      try {
        if (fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
          removed++;
        }
      } catch (_) { }
    };
    prune(scenDir);
    return removed;
  }
  window.cleanupEmptyScenarioDirs = cleanupEmptyScenarioDirs;
  function buildValidScenarioIdSets() {
    const validIds = new Set();
    const validSafeIds = new Set();
    if (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) {
      appState.scenarios.forEach(sc => {
        if (!sc || sc.id == null) return;
        const sid = String(sc.id);
        if (!sid) return;
        validIds.add(sid);
        validSafeIds.add(safeKey(sid));
      });
    }
    return { validIds, validSafeIds };
  }
  function purgeUnlinkedRoomsInMemory(validIds) {
    let changed = false;
    if (typeof appState !== 'undefined' && appState.unlinkedCcfRooms && typeof appState.unlinkedCcfRooms === 'object') {
      if (Array.isArray(appState.unlinkedCcfRooms)) {
        const prevLen = appState.unlinkedCcfRooms.length;
        appState.unlinkedCcfRooms = appState.unlinkedCcfRooms.filter(r => {
          if (!r || typeof r !== 'object') return false;
          const rSid = r.scenarioId != null ? String(r.scenarioId) : (r.scId != null ? String(r.scId) : '');
          if (rSid && !validIds.has(rSid)) return false;
          return isProjectActuallyEdited(r);
        });
        if (appState.unlinkedCcfRooms.length !== prevLen) changed = true;
      } else {
        for (const uk of Object.keys(appState.unlinkedCcfRooms)) {
          if (!validIds.has(String(uk))) {
            delete appState.unlinkedCcfRooms[uk];
            changed = true;
          }
        }
      }
    }
    if (S.key && S.key !== '_default' && !validIds.has(String(S.key))) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      S.rooms = [];
      S.roomId = null;
      S.proj = M.sanitizeProject(null);
      changed = true;
    } else if (S.key === '_default' && Array.isArray(S.rooms) && S.rooms.length) {
      const prevLen = S.rooms.length;
      S.rooms = S.rooms.filter(r => {
        if (!r || typeof r !== 'object') return false;
        const rSid = r.scenarioId != null ? String(r.scenarioId) : (r.scId != null ? String(r.scId) : '');
        if (rSid && !validIds.has(rSid)) return false;
        return isProjectActuallyEdited(r);
      });
      if (S.rooms.length !== prevLen) changed = true;
    }
    return changed;
  }
  function cleanupOrphanProjectFiles() {
    const out = { deletedOrphans: 0, deletedEmpty: 0, totalDeleted: 0, deletedDirs: 0, removedImages: 0 };
    if (typeof appState === 'undefined' || !Array.isArray(appState.scenarios)) return out;
    const { validIds, validSafeIds } = buildValidScenarioIdSets();
    const memChanged = purgeUnlinkedRoomsInMemory(validIds);
    if (IS_ELECTRON && typeof fs !== 'undefined' && typeof path !== 'undefined' && DATA_ROOT) {
      const projDir = path.join(DATA_ROOT, 'ccfolia', 'projects');
      if (fs.existsSync(projDir)) {
        let entries = [];
        try { entries = fs.readdirSync(projDir); } catch (_) { entries = []; }
        entries.forEach(file => {
          if (!/\.json$/i.test(file)) return;
          const key = file.slice(0, -5);
          const fullPath = path.join(projDir, file);
          const isValidScenario = validIds.has(key) || validSafeIds.has(key);
          const dropFile = kind => {
            if (saveTimer && safeKey(S.key) === key) { clearTimeout(saveTimer); saveTimer = null; }
            fs.unlinkSync(fullPath);
            roomContainerCache.delete(key);
            if (safeKey(S.key) === key) S.rooms = [];
            if (kind === 'orphan') out.deletedOrphans++;
            else out.deletedEmpty++;
          };
          if (!isValidScenario) {
            try { dropFile('orphan'); } catch (e) { if (typeof logSoft === 'function') logSoft('cleanupOrphanProj', e); }
            return;
          }
          try {
            const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            if (!isProjectActuallyEdited(raw)) {
              dropFile('empty');
            }
          } catch (e) {
            if (typeof logSoft === 'function') logSoft('cleanupReadProj', e);
          }
        });
      }
      out.deletedDirs = cleanupEmptyScenarioDirs();
    }
    if (memChanged && typeof saveState === 'function') {
      try { saveState(false, { skipDetailEdited: true }); } catch (_) { }
    }
    out.totalDeleted = out.deletedOrphans + out.deletedEmpty;
    if (out.totalDeleted > 0 || out.deletedDirs > 0) {
      console.log(`[ccf] 不要なプロジェクトJSONを整理しました (孤立: ${out.deletedOrphans}件, 未編集: ${out.deletedEmpty}件, 空フォルダ: ${out.deletedDirs}件)`);
    }
    return out;
  }
  window.cleanupOrphanProjectFiles = cleanupOrphanProjectFiles;
  async function purgeOrphanAndEmptyProjects() {
    const out = cleanupOrphanProjectFiles();
    if (typeof window.cleanupUnusedImages === 'function') {
      try {
        out.removedImages = await window.cleanupUnusedImages({ skipAutosave: true });
      } catch (e) { if (typeof logSoft === 'function') logSoft('purgeOrphanIdbImages', e); }
    }
    return out;
  }
  window.purgeOrphanAndEmptyProjects = purgeOrphanAndEmptyProjects;

  function hookAssetCleanup() {
    if (!CCF.assets || typeof CCF.assets.cleanupAllScenarioAssets !== 'function') return;
    if (CCF.assets.cleanupAllScenarioAssets._orphanWrapped) return;
    const origCleanupAll = CCF.assets.cleanupAllScenarioAssets;
    const wrapped = function (opts) {
      const res = origCleanupAll.apply(this, arguments);
      try {
        const pRes = cleanupOrphanProjectFiles();
        if (pRes && pRes.totalDeleted > 0 && !(opts && opts.silentProjectCleanup) && typeof toast === 'function') {
          toast(`🧹 不要なココフォリア部屋JSONを ${pRes.totalDeleted}件 整理しました`);
        }
      } catch (e) { if (typeof logSoft === 'function') logSoft('hookOrphanCleanup', e); }
      return res;
    };
    wrapped._orphanWrapped = true;
    CCF.assets.cleanupAllScenarioAssets = wrapped;
  }

  function scheduleStartupProjectCleanup() {
    if (window.appReady && typeof window.appReady.then === 'function') {
      window.appReady.then(() => { hookAssetCleanup(); });
    } else {
      setTimeout(hookAssetCleanup, 1500);
    }
  }

  Object.assign(CCF, { onShow, onCloudSyncApplied, switchProject, switchRoom, activateProject, onScenarioDeleted, writeProject, addRoom, renameRoom, deleteRoom, duplicateRoom, linkRoomToScenario, getRoomContainer, saveRoomContainer, openDuplicateRoomDialog, openLinkRoomDialog, renderScenarioSearch, renderRoomSelect, openPdfPath, pushExtract, rectExtract, addStock, addStockItems, getDocIdx, compareStocksByOrder, generateNpc, renderCenter, renderProps, updateTabCounts, updateAssetCount, setView, bufferText, buildDocSelect, buildProjectSelect, popOut, showPopped, toHalf, toFull, wrapWordCmd, replaceBuffer, scenarioList, isProjectActuallyEdited, cleanupOrphanProjectFiles, purgeOrphanAndEmptyProjects });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { init(); hookAssetCleanup(); scheduleStartupProjectCleanup(); });
  else { init(); hookAssetCleanup(); scheduleStartupProjectCleanup(); }
})();
