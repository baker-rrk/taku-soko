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
      if (kind === 'audio' ? tp !== 'audio' : (tp && tp !== 'image')) return;
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
  const W = { el: null, mode: 'room', busy: false };
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
      scenarioTitle: sc.title || '', npcs: p.npcs, dummies, clues, scenes: p.scenes || [],
      cutins: Array.isArray(p.cutins) ? p.cutins : [], boardItems, boardPieces, globalDecor: gd
    };
  }
  const groupHtml = (g, title, rows) => `<fieldset class="ccf-wiz-grp"><legend><label><input type="checkbox" data-wg="${g}"> ${title}（${rows.length}）</label></legend>${rows.length ? rows.join('') : '<div class="ccf-muted">（ありません）</div>'}</fieldset>`;
  const rowHtml = (key, label, sub) => `<label class="ccf-wiz-row"><input type="checkbox" data-wk="${esc(key)}"> <span>${esc(label)}</span>${sub ? ` <span class="ccf-muted">${esc(sub)}</span>` : ''}</label>`;

  function openWizard(mode) {
    if (W.el) closeWizard();
    const d = collect(); W.mode = mode === 'pieces' ? 'pieces' : 'room'; W.data = d;
    const ov = document.createElement('div'); ov.className = 'ccf-overlay'; ov.id = 'ccfZipWiz'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const imgN = n => (n.images || []).length;
    ov.innerHTML = `<div class="ccf-modal narrow"><div class="ccf-modal-head"><b>📦 ココフォリアZIP出力</b><span class="ccf-muted">ココフォリア v1.1.0 形式（欲しい要素だけ選べます）</span><span class="ccf-spacer"></span><button type="button" class="ccf-mini" data-w="close">✕</button></div>
      <div class="ccf-modal-body single" data-wbody>
        <div class="ccf-wiz-presets"><button type="button" class="ccf-btn" data-w="all">🏠 部屋全体</button><button type="button" class="ccf-btn" data-w="pieces">♟️ 駒だけ（NPC＋ダミー駒）</button><button type="button" class="ccf-btn" data-w="none">☐ すべて解除</button></div>
        ${groupHtml('room', '🏠 部屋設定（背景・前景・BGM）', [rowHtml('room', d.roomName + ' の部屋設定', '共通の背景／前景と、最初のBGM付きシーンのBGM')])}
        ${groupHtml('npc', '👤 NPC駒', d.npcs.map(n => rowHtml('npc:' + n.id, n.name, (n.status || []).length + '項目・立ち絵' + imgN(n) + '枚')))}
        ${groupHtml('piece', '🧩 ダミー駒／🔍 手がかり駒', d.dummies.map((p, i) => rowHtml('dummy:' + i, p.name, 'チャパレ ' + String(p.commands).split('\n').length + '行')).concat(d.clues.map((p, i) => rowHtml('clue:' + i, p.name, '手がかり'))))}
        ${groupHtml('scene', '🎬 シーン', d.scenes.map(s => rowHtml('scene:' + s.id, s.title, [s.fg && '前景', s.bg && '背景', s.bgm && 'BGM', (s.markers && s.markers.length) && ('マーカー' + s.markers.length + '件')].filter(Boolean).join('・'))))}
        ${groupHtml('item', '🧱 盤面オブジェクト', d.boardItems.map(b => rowHtml(b.key, b.label)))}
        <div data-wbgm-res></div>
      </div>
      <div class="ccf-modal-foot"><span class="ccf-muted" data-wsum></span><label class="ccf-chk" style="margin-left:8px;" title="出力時にクラウドの exports/ フォルダへも直接保存します"><input type="checkbox" id="ccfZipSaveCloud"> ☁️ クラウド（exports/）へも保存</label><span class="ccf-spacer"></span><button type="button" class="ccf-btn" data-w="export-bgm" title="部屋・全シーン・カットインで使用している音声ファイルをフォルダへ一括コピーします">🎵 使用BGMファイルをフォルダへまとめて書き出す</button><button type="button" class="ccf-btn" data-w="go-cloud" title="ローカル保存せず直接クラウドの exports/ フォルダへZIPを保存します">☁️ クラウドへ直接保存</button><button type="button" class="ccf-btn primary" data-w="go">📦 ZIPを書き出す</button><button type="button" class="ccf-btn" data-w="close">閉じる</button></div></div>`;
    ov.addEventListener('click', onClick); ov.addEventListener('change', onChange);
    W.onKey = e => { if (e.key === 'Escape' && !W.busy) { e.preventDefault(); e.stopImmediatePropagation(); closeWizard(); } };
    document.body.appendChild(ov); document.addEventListener('keydown', W.onKey, true); W.el = ov;
    preset(W.mode === 'pieces' ? 'pieces' : 'all');
  }
  function closeWizard() { if (!W.el) return; document.removeEventListener('keydown', W.onKey, true); W.el.remove(); W.el = null; }
  const boxes = () => [...W.el.querySelectorAll('[data-wk]')];
  function preset(k) {
    boxes().forEach(b => { const key = b.dataset.wk; b.checked = k === 'all' ? true : k === 'pieces' ? /^(npc|dummy|clue):/.test(key) : false; });
    refreshGroups();
  }
  function refreshGroups() {
    W.el.querySelectorAll('[data-wg]').forEach(g => {
      const grp = g.dataset.wg, mine = boxes().filter(b => (grp === 'piece' ? /^(dummy|clue):/ : grp === 'item' ? /^item:/ : new RegExp('^' + grp + '(:|$)')).test(b.dataset.wk));
      const on = mine.filter(b => b.checked).length; g.checked = !!mine.length && on === mine.length; g.indeterminate = on > 0 && on < mine.length; g.disabled = !mine.length;
    });
    const n = boxes().filter(b => b.checked).length, sum = W.el.querySelector('[data-wsum]'); if (sum) sum.textContent = n + '件を選択中';
    const go = W.el.querySelector('[data-w="go"]'); if (go) go.disabled = !n || W.busy;
    const gc = W.el.querySelector('[data-w="go-cloud"]'); if (gc) gc.disabled = !n || W.busy;
    const eb = W.el.querySelector('[data-w="export-bgm"]'); if (eb) eb.disabled = W.busy;
  }
  function onChange(e) {
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
    const b = e.target.closest('[data-w]'); if (!b || W.busy) return; const k = b.dataset.w;
    if (k === 'close') return closeWizard();
    if (k === 'all' || k === 'pieces' || k === 'none') return preset(k);
    if (k === 'open') { showItem(b.dataset.path); return; }
    if (k === 'open-dir') { openFolder(b.dataset.path, b.dataset.first || ''); return; }
    if (k === 'dl-zip' && lastZipBlob && window.WebBridge) { WebBridge.downloadBlob(lastZipBlob, lastZipName, 'application/zip'); return; }
    if (k === 'dl-bgm' && lastBgmBlob && window.WebBridge) { WebBridge.downloadBlob(lastBgmBlob, lastBgmName, 'application/zip'); return; }
    if (k === 'upload-zip-cloud') return void uploadLastZipToCloud();
    if (k === 'export-bgm') return exportBgmFolder();
    if (k === 'go') return run(false);
    if (k === 'go-cloud') return run(true);
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
  const MIME_AUDIO_EXT = {
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 'application/ogg': '.ogg',
    'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
    'audio/flac': '.flac', 'audio/mp4': '.m4a', 'audio/aac': '.m4a', 'audio/webm': '.webm', 'audio/opus': '.opus'
  };
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
  function collectAudioEntries(d) {
    const out = [];
    if (d.globalDecor && d.globalDecor.bgm) {
      out.push({ tag: '00_共通', label: '部屋設定BGM', src: d.globalDecor.bgm });
    }
    (d.scenes || []).forEach((s, i) => {
      if (s && s.bgm) {
        out.push({ tag: String(i + 1).padStart(2, '0'), label: `シーン#${i + 1}「${s.title || '無題'}」`, src: s.bgm });
      }
    });
    (d.cutins || []).forEach((c, i) => {
      if (c && (c.sePath || c.seDataUrl || c.seUrl || c.seUid)) {
        out.push({
          tag: 'SE' + String(i + 1).padStart(2, '0'),
          label: `カットイン「${c.name || 'カットイン' + (i + 1)}」`,
          src: { path: c.sePath || '', dataUrl: c.seDataUrl || '', url: c.seUrl || '', assetUid: c.seUid || '', name: c.seName || '' }
        });
      }
    });
    return out;
  }

  async function exportBgmFolder() {
    const d = W.data || collect();
    const entries = collectAudioEntries(d);
    if (!entries.length) {
      say('⚠️ 現在の部屋・シーン・カットインにBGM・音声ファイルが設定されていません');
      return null;
    }
    W.busy = true; if (W.el) refreshGroups();
    say('🎵 使用BGM・音声ファイルを集めています…');
    try {
      if (S && S.key && S.key !== '_default' && window.CloudSync && typeof CloudSync.ensureScenarioAssetsCached === 'function') {
        try { await CloudSync.ensureScenarioAssetsCached(S.key, { silent: true }); } catch (_) {}
      }
      const groups = new Map();
      const warnings = [];
      for (const ent of entries) {
        const res = await resolveSource(ent.src, 'audio');
        if (!res || !res.buf || !res.buf.length) {
          warnings.push(`${ent.label}: ${ent.src.name || ent.src.path || '音声ファイル'} を読み込めませんでした`);
          continue;
        }
        const hash = await (P.sha256HexAsync ? P.sha256HexAsync(res.buf) : P.sha256Hex(res.buf));
        const ext = audioExt(ent.src, res);
        const rawName = ent.src.name || res.name || (ent.src.path ? baseName(ent.src.path) : '') || 'audio';
        const trackName = safePart(stripExt(rawName), 48) || 'audio';
        let g = groups.get(hash);
        if (!g) {
          g = { buf: res.buf, ext, trackName, tags: [], labels: [] };
          groups.set(hash, g);
        }
        if (!g.tags.includes(ent.tag)) g.tags.push(ent.tag);
        g.labels.push(ent.label);
      }
      if (!groups.size) {
        const resBox = W.el && W.el.querySelector('[data-wbgm-res]');
        if (resBox && warnings.length) {
          resBox.innerHTML = `<div class="ccf-wiz-warn"><b>⚠️ 音声ファイルを読み込めませんでした（${warnings.length}件）</b>${warnings.slice(0, 20).map(w => '<div>' + esc(w) + '</div>').join('')}</div>`;
        }
        say('⚠️ 書き出せる音声ファイルが見つかりませんでした');
        return null;
      }
      const usedNames = new Set();
      const namedItems = [];
      for (const g of groups.values()) {
        const tagPrefix = g.tags.length <= 3
          ? g.tags.join('_')
          : g.tags.slice(0, 3).join('_') + '_他' + (g.tags.length - 3) + '件';
        const base = safePart(tagPrefix + '_' + g.trackName, 90) || 'bgm';
        let fname = base + g.ext;
        let n = 2;
        while (usedNames.has(fname.toLowerCase())) {
          fname = base + '_' + n + g.ext;
          n++;
        }
        usedNames.add(fname.toLowerCase());
        namedItems.push({ fname, buf: g.buf });
      }
      if (!isElec) {
        const zipName = 'BGM_' + safeName(d.roomName) + '_' + ts() + '.zip';
        const zipBlob = await WebBridge.buildZipBlob(namedItems.map(x => ({ name: x.fname, data: x.buf, store: true })));
        lastBgmBlob = zipBlob; lastBgmName = zipName;
        WebBridge.downloadBlob(zipBlob, zipName, 'application/zip');
        const resBox = W.el && W.el.querySelector('[data-wbgm-res]');
        if (resBox) {
          resBox.innerHTML = `<div class="ccf-wiz-result"><b>🎵 使用BGM・音声ファイルをZIPでダウンロードしました（${namedItems.length}件）</b>
            <div class="ccf-wiz-path">${esc(zipName)}</div>
            <div><button type="button" class="ccf-btn" data-w="dl-bgm">💾 もう一度ダウンロード</button></div>
            ${warnings.length ? `<div class="ccf-wiz-warn"><b>⚠️ 読み込めなかった音声（${warnings.length}件）</b>${warnings.slice(0, 20).map(w => '<div>' + esc(w) + '</div>').join('')}</div>` : ''}
            <div class="ccf-muted">※ 展開したフォルダ内の音声ファイルをココフォリアのBGM設定画面へドラッグ＆ドロップしてください。</div></div>`;
        }
        say(`🎵 使用BGM ${namedItems.length}件をダウンロードしました：${zipName}`);
        return { files: namedItems.map(x => x.fname), warnings };
      }
      const dir = path.join(exportDir(), 'BGM_' + safeName(d.roomName) + '_' + ts());
      fs.mkdirSync(dir, { recursive: true });
      const written = [];
      for (const item of namedItems) {
        const dest = path.join(dir, item.fname);
        fs.writeFileSync(dest, item.buf);
        written.push(dest);
      }
      const resBox = W.el && W.el.querySelector('[data-wbgm-res]');
      if (resBox) {
        resBox.innerHTML = `<div class="ccf-wiz-result"><b>🎵 使用BGM・音声ファイルを書き出しました（${written.length}件）</b>
          <div class="ccf-wiz-path">${esc(dir)}</div>
          <div><button type="button" class="ccf-btn" data-w="open-dir" data-path="${esc(dir)}" data-first="${esc(written[0] || '')}">📂 BGMフォルダを開く</button></div>
          ${warnings.length ? `<div class="ccf-wiz-warn"><b>⚠️ 読み込めなかった音声（${warnings.length}件）</b>${warnings.slice(0, 20).map(w => '<div>' + esc(w) + '</div>').join('')}</div>` : ''}
          <div class="ccf-muted">※ 開いたフォルダ内の音声ファイルをココフォリアのBGM設定画面へドラッグ＆ドロップしてください。</div></div>`;
      }
      say(`🎵 使用BGM ${written.length}件を書き出しました：${dir}`);
      await openFolder(dir, written[0]);
      return { dir, files: written, warnings };
    } catch (e) {
      console.error('[ccf] BGM書き出しに失敗', e);
      say('❌ 使用BGMの書き出しに失敗しました：' + (e.message || e));
      return null;
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
      const c = res.counts, body = W.el && W.el.querySelector('[data-wbody]');
      if (body) body.innerHTML = `<div class="ccf-wiz-result"><b>✅ ${cloudOnly ? 'クラウドへ保存しました' : (isElec ? '書き出しました' : 'ダウンロードしました')}</b><div class="ccf-muted">駒 ${c.characters}・シーン ${c.scenes}・オブジェクト ${c.items}・素材 ${res.files.size}点（${Math.round(byteLen / 1024).toLocaleString()} KB）</div>
        <div class="ccf-wiz-path">${esc(fileLabel)}</div>
        <div data-wcloud-res>${cloudMsg}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${isElec ? `<button type="button" class="ccf-btn" data-w="open" data-path="${esc(fileLabel)}">📂 フォルダで表示</button>` : `<button type="button" class="ccf-btn" data-w="dl-zip">💾 ${cloudOnly ? 'PCにもダウンロード' : 'もう一度ダウンロード'}</button>`}
          ${!saveToCloudToo ? `<button type="button" class="ccf-btn" data-w="upload-zip-cloud">☁️ クラウド（exports/）へ直接保存</button>` : ''}
          <button type="button" class="ccf-btn" data-w="export-bgm" title="部屋・全シーン・カットインで使用している音声ファイルをまとめて書き出します">🎵 使用BGMファイルをまとめて書き出す</button>
        </div>
        ${res.warnings.length ? `<div class="ccf-wiz-warn"><b>⚠️ 読み込めなかった素材（${res.warnings.length}件）</b>${res.warnings.slice(0, 30).map(w => '<div>' + esc(w) + '</div>').join('')}</div>` : ''}
        <div class="ccf-muted">※ ココフォリアの「ルーム」→「ルームデータの読み込み」でこのZIPを選んでください。</div></div>
        <div data-wbgm-res></div>`;
      const go = W.el && W.el.querySelector('[data-w="go"]'); if (go) go.style.display = 'none';
      const gc = W.el && W.el.querySelector('[data-w="go-cloud"]'); if (gc) gc.style.display = 'none';
      const sc = W.el && W.el.querySelector('#ccfZipSaveCloud'); if (sc && sc.parentElement) sc.parentElement.style.display = 'none';
      const eb = W.el && W.el.querySelector('.ccf-modal-foot [data-w="export-bgm"]'); if (eb) eb.style.display = 'none';
      say(cloudOnly ? `☁️ クラウドへ保存しました：${fname}` : ((isElec ? '💾 保存しました：' : '💾 ダウンロードしました：') + fileLabel));
      if (isElec && !cloudOnly) showItem(fileLabel);
    } catch (e) { console.error('[ccf] ZIP出力に失敗', e); say('❌ ZIPの書き出しに失敗しました：' + (e.message || e)); }
    finally { W.busy = false; if (W.el) refreshGroups(); }
  }

  CCF.ccfExport = { openWizard, closeWizard, resolveSource, readRef, collect, exportDir, safeName, ts, exportBgmFolder };
})();
