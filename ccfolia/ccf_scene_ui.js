/* ccf_scene_ui.js — Phase 2-A：シーン自動組み立て・✨これかも？仮配置・WYSIWYG盤面プレビュー・マーカー同期・カットイン管理 */
(function () {
  'use strict';
  const CCF = window.CCF; if (!CCF) return;
  const { $, esc, say, S } = CCF;
  const M = window.CCFModel, T = window.CCFText, SM = window.CCFSceneMatch;
  const cp = lbl => { try { if (window.AppHistory && typeof window.AppHistory.checkpoint === 'function') window.AppHistory.checkpoint(lbl); } catch (_) { } };
  const fileUrl = p => {
    if (!p) return '';
    if (window.WebBridge && WebBridge.isAssetRef(p)) return WebBridge.peekAssetUrl(p) || '';
    if (/^(?:data:|file:|https?:|blob:|zipview:)/i.test(p)) return p;
    if (!IS_ELECTRON) return '';
    try { return require('url').pathToFileURL(p).href; } catch (_) { return p; }
  };
  const assetSrc = item => {
    if (!item) return '';
    if (item.dataUrl) return item.dataUrl;
    if (item.path) return fileUrl(item.path);
    return '';
  };

  // ======================================================================
  // 状態（ドキュメント解析の一時保持・展開状態・選択中要素・試聴Audio）
  // ======================================================================
  const UI = {
    subView: 'board',         // 'board' (①盤面・シーン編集) | 'scenes' (②シーン分割・本文整理) | 'cutin' (③演出・カットイン)
    parsedLines: null,        // 最後に解析した行データ
    parsedOutline: [],        // 最後に解析したPDFしおり
    parsedPath: '',
    parsedName: '',
    parsedRange: null,        // { startPage, endPage }
    headingStats: null,
    lastSplitMethod: '',      // 'outline' | 'toc' | 'heading'
    expandedScenes: new Set(),
    expandedSlotScenes: new Set(),
    sceneLimit: 50,
    boardTarget: 'global',    // 'global' | scene.id
    selectedItemId: '',
    selectedIds: new Set(),
    lastCheckedIdx: -1,
    batchSlots: { fg: true, bgm: true, bg: false, marker: false },
    showHiddenGhost: true,
    snapGrid: true,
    zoomScale: 1,             // カメラ拡大倍率 (0.2〜2.5)
    panX: 0,                  // カメラX座標
    panY: 0,                  // カメラY座標
    marqueeMode: false,       // ▭ 範囲選択モード（OFF時は余白/固定パネルドラッグで視点移動・Shift+ドラッグで範囲選択）
    cameraFitted: false,      // 初期フィット済みか
    _fittedStageW: 0,         // フィット時のステージ幅
    _fittedStageH: 0,         // フィット時のステージ高さ
    _savedInlineCam: null,    // モーダル中のインラインカメラ退避
    defaultBgmVolume: 35,     // 新規BGM既定音量(%)
    modalOpen: false,
    modalEl: null,
    audio: null,
    audioKey: '',
    audioSceneId: '',
    cutinStageEl: null,
    cutinStageAudio: null,
    cutinStageTimer: null
  };
  const candidateCache = new Map();
  const candKey = sc => `${S.key || ''}:${S.roomId || ''}:${sc && sc.id ? sc.id : ''}`;
  const getCachedCandidates = sc => (sc && sc.id ? candidateCache.get(candKey(sc)) || null : null);
  function invalidateCandidate(sc) { if (sc && sc.id) candidateCache.delete(candKey(sc)); }
  function computeCandidatesForScene(sc, sources) {
    if (!sc || !sc.id) return { fg: [], bg: [], marker: [], screen: [], bgm: [], extracted: { keywords: [] } };
    const m = SM.scoreAssetsForScene(sc, sources || getMatchSources(), 6);
    const fgRe = /前景|foreground|\bfg\b|マップ|map|見取り図|間取り|背景|室内|室外|風景/i;
    const fgNegRe = /マーカー|marker|駒|token|立ち絵|npc|ハンドアウト|\bho\d*\b|切り抜き/i;
    const fgMap = new Map();
    [...(m.screen || []), ...(m.bg || [])].forEach(c => {
      if (!c || !c.item) return;
      const k = c.item.uid || c.item.path || c.item.name;
      const meta = [c.item.category || '', c.item.name || '', c.item.origName || ''].join(' ');
      const adj = (fgRe.test(meta) ? 45 : 0) - (fgNegRe.test(meta) ? 120 : 0);
      const entry = Object.assign({}, c, { _fgScore: c.score + adj });
      const prev = fgMap.get(k);
      if (!prev || entry._fgScore > prev._fgScore) fgMap.set(k, entry);
    });
    const fg = [...fgMap.values()].sort((a, b) => b._fgScore - a._fgScore || a.tier - b.tier).slice(0, 3);
    const marker = (m.screen || []).slice(0, 3);
    const out = {
      extracted: m.extracted,
      fg,
      bg: (m.bg || []).slice(0, 3),
      marker,
      screen: marker,
      bgm: (m.bgm || []).slice(0, 3)
    };
    candidateCache.set(candKey(sc), out);
    return out;
  }

  function cleanSceneTextWithHeading(sc, text) {
    const raw = String(text || '').replace(/\r\n?/g, '\n');
    if (!raw.trim()) return '';
    const cfg = (S && S.proj && S.proj.sceneParseConfig) || {};
    const lines = raw.split('\n');
    const first = lines[0] ? lines[0].trim() : '';
    const hasHeadingLine = lines.length > 1 && first && (
      (sc && sc.headingPattern && sc.headingPattern !== 'intro' && sc.headingPattern !== 'manual') ||
      (sc && SM.cleanHeadingTitle(first) === String(sc.title || '').trim())
    );
    const bodyLines = hasHeadingLine ? lines.slice(1) : lines;
    // シーン内の小見出し（情報テキスト候補・カスタム記号見出し）行の前後でも確実に改行を保持して T.cleanText を適用
    const chunks = [];
    let seg = [];
    const flushSeg = () => {
      if (!seg.length) return;
      const cleaned = T.cleanText(seg.join('\n'), { joinLines: 'smart', stripSpaces: true });
      if (cleaned) chunks.push(cleaned);
      seg = [];
    };
    bodyLines.forEach(ln => {
      const trimmed = String(ln || '').trim();
      if (trimmed && SM && typeof SM.matchHeadingRole === 'function' && SM.matchHeadingRole(trimmed, 'any', { patternRoles: cfg.patternRoles, customPrefixes: cfg.customPrefixes })) {
        flushSeg();
        chunks.push(trimmed);
      } else {
        seg.push(ln);
      }
    });
    flushSeg();
    const rest = chunks.join('\n');
    if (hasHeadingLine) return rest ? (first + '\n' + rest) : first;
    return rest;
  }

  function getLeftOrBufferSelection() {
    const vSt = (CCF.viewer && CCF.viewer.state) || {};
    const curPath = vSt.path || (S.proj.pdf && S.proj.pdf.path) || '';
    const curName = vSt.name || (curPath ? curPath.split(/[\\/]/).pop() : '');
    const curPage = vSt.page || (S.proj.pdf && S.proj.pdf.page) || 1;
    let liveText = '';
    try {
      const sel = window.getSelection();
      const left = $('ccfLeft');
      if (sel && sel.rangeCount && left && left.contains(sel.anchorNode)) {
        liveText = sel.toString();
      }
    } catch (_) { }
    const bufEl = $('ccfBuf');
    const bufText = bufEl ? bufEl.value : '';
    const src0 = (S.bufSrc && S.bufSrc[0]) || null;
    if (bufText && bufText.trim()) {
      return {
        text: bufText,
        page: (src0 && src0.page) || curPage,
        sourceName: (src0 && src0.name) || curName,
        sourcePath: (src0 && src0.path) || curPath
      };
    }
    return {
      text: liveText || '',
      page: curPage,
      sourceName: curName,
      sourcePath: curPath
    };
  }

  function ensureProjShape() {
    if (!S || !S.proj) return;
    if (!Array.isArray(S.proj.scenes)) S.proj.scenes = [];
    if (!S.proj.sceneParseConfig) S.proj.sceneParseConfig = M.sanitizeSceneParseConfig(null);
    if (!S.proj.globalDecor) S.proj.globalDecor = M.sanitizeGlobalDecor(null);
    if (!S.proj.board) S.proj.board = M.sanitizeBoard(null);
    if (!Array.isArray(S.proj.cutins)) S.proj.cutins = [];
  }

  function syncPreviewAudioButtons() {
    if (typeof document === 'undefined') return;
    const activeKey = UI.audio && UI.audioKey ? UI.audioKey : '';
    const activeScId = UI.audio && UI.audioSceneId ? UI.audioSceneId : '';
    document.querySelectorAll('[data-scn-play]').forEach(btn => {
      const btnKey = btn.dataset.scnPlay || '';
      const btnIdx = btn.dataset.scnPlayIdx != null ? Number(btn.dataset.scnPlayIdx) : -1;
      const btnSc = btnIdx >= 0 && S && S.proj && S.proj.scenes ? S.proj.scenes[btnIdx] : null;
      const btnScId = btnSc ? btnSc.id : '';
      const isPlaying = !!(activeKey && btnKey === activeKey && (!activeScId || !btnScId || btnScId === activeScId));
      btn.textContent = isPlaying ? '■' : '▶';
      btn.classList.toggle('is-playing', isPlaying);
    });
  }

  function stopPreviewAudio() {
    if (UI.audio) { try { UI.audio.pause(); } catch (_) { } UI.audio = null; }
    UI.audioKey = '';
    UI.audioSceneId = '';
    syncPreviewAudioButtons();
  }

  function setBoardTarget(nextId) {
    const next = nextId || 'global';
    if (UI.boardTarget !== next) stopPreviewAudio();
    UI.boardTarget = next;
  }

  function togglePreviewAudio(pathOrUrl, rerenderFn, opts) {
    const key = String(pathOrUrl || '');
    if (!key) return;
    const o = opts || {};
    const same = UI.audioKey === key && (!o.sceneId || UI.audioSceneId === o.sceneId);
    stopPreviewAudio();
    if (same) return;
    const url = fileUrl(key);
    const volPct = o.volumePct != null ? Number(o.volumePct) : UI.defaultBgmVolume;
    UI.audioKey = key;
    UI.audioSceneId = o.sceneId || '';
    UI.audio = new Audio(url);
    UI.audio.volume = Math.min(1, Math.max(0, volPct / 100));
    UI.audio.loop = o.loop !== undefined ? !!o.loop : false;
    UI.audio.onended = () => { UI.audioKey = ''; UI.audioSceneId = ''; UI.audio = null; syncPreviewAudioButtons(); };
    UI.audio.play().catch(() => { UI.audioKey = ''; UI.audioSceneId = ''; UI.audio = null; say('⚠️ 音声を再生できませんでした'); syncPreviewAudioButtons(); });
    syncPreviewAudioButtons();
  }

  function captureScrollState(root) {
    if (typeof document === 'undefined') return [];
    const scopes = [];
    const selectors = ['.ccf-scene-scroll', '.ccf-bp-side', '.ccf-bp-scnlist', '.ccf-bp-layers', '.ccf-bp-mk-list', '.ccf-scn-list', '.ccf-bp-modal-body'];
    const pushScope = (key, el) => {
      if (!el) return;
      const items = [];
      selectors.forEach(sel => {
        if (el.matches && el.matches(sel)) {
          items.push({ self: true, sel, idx: 0, top: el.scrollTop, left: el.scrollLeft });
        }
        el.querySelectorAll(sel).forEach((node, idx) => {
          items.push({ sel, idx, top: node.scrollTop, left: node.scrollLeft });
        });
      });
      el.querySelectorAll('.ccf-scn-card[data-scn-id] .ccf-scn-lines').forEach(node => {
        const card = node.closest('[data-scn-id]');
        if (card) items.push({ scnId: card.dataset.scnId, top: node.scrollTop, left: node.scrollLeft });
      });
      scopes.push({ key, el, items });
    };
    if (root) {
      pushScope('root', root);
      const outerScroll = $('ccfScenePanel') && $('ccfScenePanel').querySelector('.ccf-scene-scroll');
      if (outerScroll && root !== outerScroll && !root.contains(outerScroll)) {
        pushScope('outerScroll', outerScroll);
      }
    } else {
      const panel = $('ccfScenePanel');
      if (panel) pushScope('panel', panel);
      if (UI.modalOpen && UI.modalEl) pushScope('modal', UI.modalEl);
    }
    return scopes;
  }

  function restoreScrollState(scopes) {
    (scopes || []).forEach(sc => {
      const el = sc.key === 'panel' ? $('ccfScenePanel')
        : sc.key === 'modal' ? UI.modalEl
        : sc.key === 'outerScroll' ? ($('ccfScenePanel') && $('ccfScenePanel').querySelector('.ccf-scene-scroll'))
        : sc.el;
      if (!el || !el.isConnected) return;
      sc.items.forEach(it => {
        let target = null;
        if (it.self) target = el;
        else if (it.scnId) {
          const card = Array.from(el.querySelectorAll('.ccf-scn-card[data-scn-id]')).find(c => c.dataset.scnId === it.scnId);
          target = card ? card.querySelector('.ccf-scn-lines') : null;
        } else {
          target = el.querySelectorAll(it.sel)[it.idx] || null;
        }
        if (target) {
          target.scrollTop = it.top;
          target.scrollLeft = it.left;
        }
      });
    });
  }

  function withPreservedScroll(fn, root) {
    const snap = captureScrollState(root);
    try {
      return fn();
    } finally {
      restoreScrollState(snap);
    }
  }

  function insertScenesAfterSelection(newScenes) {
    const list = Array.isArray(newScenes) ? newScenes.filter(Boolean) : (newScenes ? [newScenes] : []);
    if (!list.length) return [];
    ensureProjShape();
    const curIdx = (UI.boardTarget && UI.boardTarget !== 'global')
      ? S.proj.scenes.findIndex(s => s.id === UI.boardTarget)
      : -1;
    if (curIdx >= 0) {
      S.proj.scenes.splice(curIdx + 1, 0, ...list);
    } else {
      S.proj.scenes.push(...list);
    }
    setBoardTarget(list[0].id);
    return list;
  }

  function duplicateSceneById(sceneId) {
    ensureProjShape();
    const idx = S.proj.scenes.findIndex(s => s.id === sceneId);
    if (idx < 0) return say('⚠️ 複製するシーンを選択してください');
    const src = S.proj.scenes[idx];
    cp('シーンを複製');
    const cloneBoardItem = (it, kind) => it ? M.sanitizeBoardItem(Object.assign({}, it, { id: M.newId() }), kind) : null;
    const dup = M.sanitizeScene({
      title: (src.title || '無題のシーン') + ' (コピー)',
      text: src.text || '',
      sceneMessage: src.sceneMessage || '',
      page: src.page,
      lineIdx: src.lineIdx,
      docIdx: src.docIdx,
      sourceName: src.sourceName || '',
      sourcePath: src.sourcePath || '',
      headingPattern: src.headingPattern || 'manual',
      checked: false,
      tags: Array.isArray(src.tags) ? src.tags.slice() : [],
      manualSlots: src.manualSlots ? Object.assign({}, src.manualSlots) : undefined,
      bg: cloneBoardItem(src.bg, 'bg'),
      fg: cloneBoardItem(src.fg, 'fg'),
      screens: (src.screens || []).map(x => cloneBoardItem(x, 'screen')).filter(Boolean),
      markers: (src.markers || []).map(x => cloneBoardItem(x, 'marker')).filter(Boolean),
      bgm: src.bgm ? M.sanitizeSceneAudio(src.bgm) : null
    });
    S.proj.scenes.splice(idx + 1, 0, dup);
    setBoardTarget(dup.id);
    setSelectionIds([], '');
    CCF.saveProject();
    if (UI.subView === 'board' || UI.modalOpen) refreshBoardContainers();
    if (UI.subView === 'scenes') render();
    say(`📋 シーン「${dup.title}」を複製しました`);
    return dup;
  }

  function deleteSceneById(sceneId) {
    ensureProjShape();
    const idx = S.proj.scenes.findIndex(s => s.id === sceneId);
    if (idx < 0) return false;
    const sc = S.proj.scenes[idx];
    cp('シーン削除');
    S.proj.scenes.splice(idx, 1);
    if (UI.boardTarget === sceneId) {
      setBoardTarget((S.proj.scenes[idx] && S.proj.scenes[idx].id) || (S.proj.scenes[idx - 1] && S.proj.scenes[idx - 1].id) || 'global');
    }
    invalidateCandidate(sc);
    UI.expandedScenes.delete(sceneId);
    UI.expandedSlotScenes.delete(sceneId);
    CCF.saveProject();
    if (UI.subView === 'board' || UI.modalOpen) refreshBoardContainers();
    if (UI.subView === 'scenes') render();
    say(`🗑️「${sc.title || '無題のシーン'}」を削除しました（Ctrl+Zで元に戻せます）`);
    return true;
  }

  function moveSceneByOffset(sceneId, delta) {
    ensureProjShape();
    const idx = S.proj.scenes.findIndex(s => s.id === sceneId);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= S.proj.scenes.length) return;
    cp('シーンの順序を変更');
    const [item] = S.proj.scenes.splice(idx, 1);
    S.proj.scenes.splice(nextIdx, 0, item);
    CCF.saveProject();
    if (UI.subView === 'board' || UI.modalOpen) refreshBoardContainers();
    if (UI.subView === 'scenes') render();
  }

  function reorderSceneIndex(fromIdx, toIdx) {
    ensureProjShape();
    const len = S.proj.scenes.length;
    if (fromIdx < 0 || fromIdx >= len || toIdx < 0 || toIdx >= len || fromIdx === toIdx) return;
    cp('シーンをドラッグで並べ替え');
    const [item] = S.proj.scenes.splice(fromIdx, 1);
    S.proj.scenes.splice(toIdx, 0, item);
    CCF.saveProject();
    if (UI.subView === 'board' || UI.modalOpen) refreshBoardContainers();
    if (UI.subView === 'scenes') render();
  }

  function applySceneMessageAction(sc, action, textEl, msgEl) {
    if (!sc) return;
    let nextVal = sc.sceneMessage || '';
    if (action === 'copy') {
      let copied = '';
      if (textEl) {
        const s0 = (typeof textEl.selectionStart === 'number' && textEl.selectionEnd > textEl.selectionStart)
          ? textEl.selectionStart
          : (textEl._lastCursor != null && textEl._lastCursorEnd > textEl._lastCursor ? textEl._lastCursor : 0);
        const s1 = (typeof textEl.selectionStart === 'number' && textEl.selectionEnd > textEl.selectionStart)
          ? textEl.selectionEnd
          : (textEl._lastCursor != null && textEl._lastCursorEnd > textEl._lastCursor ? textEl._lastCursorEnd : 0);
        if (s1 > s0) copied = String(textEl.value || '').slice(s0, s1);
      }
      if (!copied) copied = String(sc.text || '');
      nextVal = copied;
      cp('シーン切替メッセージへ本文をコピー');
    } else if (action === 'title') {
      nextVal = String(sc.title || '');
      cp('シーン切替メッセージにシーン名をセット');
    } else if (action === 'clear') {
      nextVal = '';
      cp('シーン切替メッセージをクリア');
    }
    sc.sceneMessage = nextVal;
    if (msgEl) msgEl.value = nextVal;
    CCF.saveProject();
    if (action === 'copy') say('📋 シーン切替メッセージへコピーしました');
    else if (action === 'title') say('📋 シーン名をセットしました');
    else if (action === 'clear') say('✕ シーン切替メッセージをクリアしました');
  }

  // ======================================================================
  // 1. ドキュメント（PDF / TXT / HTML）読み込み・見出し解析・自動シーン分割
  // ======================================================================
  const docBaseName = p => (window.WebBridge && WebBridge.isAssetRef(p)) ? WebBridge.assetBasename(p) : ((typeof path !== 'undefined' && path) ? path.basename(p) : String(p || '').split(/[\\/]/).pop());
  function collectSourceDocs() {
    const out = [], seen = new Set();
    const add = (p, name) => {
      if (!p) return;
      const k = String(p).toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ path: p, name: name || docBaseName(p) });
    };
    const cur = (CCF.viewer && CCF.viewer.state && CCF.viewer.state.path) || (S.proj.pdf && S.proj.pdf.path);
    if (cur) add(cur);
    if (IS_ELECTRON && typeof path !== 'undefined' && path && typeof DATA_ROOT !== 'undefined' && DATA_ROOT) {
      try {
        const sc = CCF.scenarioList().find(x => String(x.id) === String(S.key));
        ((sc && sc.docs) || []).filter(d => /\.(pdf|txt|html?|md)$/i.test(d.name || '')).forEach(d => add(path.resolve(DATA_ROOT, d.rel), d.name));
      } catch (_) { }
    }
    (S.proj.refs || []).filter(r => r.type === 'pdf' || r.type === 'doc').forEach(r => add(r.path, r.name));
    try {
      const sc = CCF.scenarioList().find(x => String(x.id) === String(S.key));
      const seenNames = new Set(out.map(x => String(x.name || '').normalize('NFKC').trim().toLowerCase()));
      ((sc && Array.isArray(sc.docTexts)) ? sc.docTexts : []).forEach(dt => {
        if (!dt || !dt.text || !dt.name) return;
        const nk = String(dt.name).normalize('NFKC').trim().toLowerCase();
        if (seenNames.has(nk)) return;
        seenNames.add(nk);
        add('doc-text://' + dt.id, dt.name);
      });
    } catch (_) { }
    return out;
  }

  function findSyncedDocText(docPath) {
    try {
      const sc = CCF.scenarioList().find(x => String(x.id) === String(S.key));
      const list = (sc && Array.isArray(sc.docTexts)) ? sc.docTexts : [];
      if (!list.length) return null;
      const sp = String(docPath || '');
      if (/^doc-text:\/\//i.test(sp)) {
        const id = sp.slice('doc-text://'.length);
        const byId = list.find(d => d && d.text && String(d.id || '') === id);
        if (byId) return byId;
      }
      const nm = docBaseName(sp).normalize('NFKC').trim().toLowerCase();
      return nm ? (list.find(d => d && d.text && String(d.name || '').normalize('NFKC').trim().toLowerCase() === nm) || null) : null;
    } catch (_) { return null; }
  }

  function buildLinesFromSyncedDocText(dt, docPath, opts) {
    const o = opts || {};
    const raw = String((dt && dt.text) || '');
    const lines = [];
    let curPage = 1, maxPage = 1, pageLineIdx = 0;
    const rawLines = raw.split(/\r?\n/);
    for (const rl of rawLines) {
      const m = /^=== P\.(\d+) ===\s*$/.exec(rl.trim());
      if (m) {
        curPage = Math.max(1, Number(m[1]) || 1);
        if (curPage > maxPage) maxPage = curPage;
        pageLineIdx = 0;
        continue;
      }
      const trimmed = rl.replace(/[ \t]+$/g, '').trim();
      if (!trimmed) continue;
      lines.push({ text: trimmed, page: curPage, pageLineIdx: pageLineIdx++, fontSize: 0, htmlTag: '', isLargeFont: false });
    }
    const total = Math.max(maxPage, Number(dt && dt.pageCount) || 1);
    const sp = o.startPage ? Math.max(1, Math.min(total, Math.round(Number(o.startPage)))) : 1;
    const ep = o.endPage ? Math.max(sp, Math.min(total, Math.round(Number(o.endPage)))) : total;
    const filtered = (sp > 1 || ep < total) ? lines.filter(l => l.page >= sp && l.page <= ep) : lines;
    return { lines: filtered, outline: [], name: (dt && dt.name) || docBaseName(docPath), path: docPath, totalPages: total, startPage: sp, endPage: ep };
  }

  async function readDocumentLines(docPath, opts) {
    if (!docPath) throw new Error('資料ファイルが選択されていません');
    const isDocText = /^doc-text:\/\//i.test(String(docPath));
    const isAsset = !isDocText && !!(window.WebBridge && WebBridge.isAssetRef(docPath));
    const isLocalFile = !isDocText && !isAsset && IS_ELECTRON && typeof fs !== 'undefined' && fs.existsSync(docPath);
    if (isDocText || (!isAsset && !isLocalFile)) {
      const dt = findSyncedDocText(docPath);
      if (dt) return buildLinesFromSyncedDocText(dt, docPath, opts);
      if (!IS_ELECTRON || typeof fs === 'undefined') throw new Error('ファイル読み込みはブラウザ内ライブラリまたはデスクトップ版で使えます');
      throw new Error('ファイルが見つかりません：' + docPath);
    }
    const o = opts || {};
    const name = docBaseName(docPath);
    const readBytes = async () => isAsset ? WebBridge.readAssetBytes(docPath) : (fs.promises ? await fs.promises.readFile(docPath) : fs.readFileSync(docPath));
    if (/\.html?$/i.test(name)) {
      const buf = await readBytes();
      const dec = T.decodeBytes(buf);
      let html = dec.text;
      const m = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(html.slice(0, 2000));
      if (m && /shift|sjis|932/i.test(m[1]) && dec.enc.startsWith('UTF-8') && /\uFFFD/.test(html)) {
        try { html = new TextDecoder('shift_jis').decode(buf); } catch (_) { }
      }
      return { lines: SM.extractHtmlLines(html), outline: [], name, path: docPath, totalPages: 1, startPage: 1, endPage: 1 };
    }
    if (/\.(?:txt|md)$/i.test(name)) {
      const buf = await readBytes();
      const d = T.loadTextDoc(name, buf);
      return { lines: SM.extractTxtLines(d.text), outline: [], name, path: docPath, totalPages: 1, startPage: 1, endPage: 1 };
    }
    // PDF（指定ページ範囲のみ走査して高速化）
    if (!CCF.pdfText || !CCF.pdfText.openDoc) throw new Error('PDF解析モジュールが利用できません');
    let doc = null;
    try {
      doc = await CCF.pdfText.openDoc(docPath);
      const total = doc.numPages;
      const sp = o.startPage ? Math.max(1, Math.min(total, Math.round(Number(o.startPage)))) : 1;
      const epRaw = o.endPage ? Math.max(sp, Math.min(total, Math.round(Number(o.endPage)))) : total;
      const ep = Math.min(epRaw, sp + 299);
      const outlineEntries = [];
      try {
        if (typeof doc.getOutline === 'function') {
          const rawOutline = await doc.getOutline();
          if (Array.isArray(rawOutline) && rawOutline.length) {
            const flattenOutline = async (items, level) => {
              for (const it of items) {
                if (!it) continue;
                let pgNo = null;
                try {
                  let dest = it.dest;
                  if (typeof dest === 'string' && typeof doc.getDestination === 'function') {
                    dest = await doc.getDestination(dest);
                  }
                  if (Array.isArray(dest) && dest[0] != null && typeof doc.getPageIndex === 'function') {
                    const pi = await doc.getPageIndex(dest[0]);
                    if (Number.isFinite(pi) && pi >= 0) pgNo = pi + 1;
                  }
                } catch (_) { }
                const title = String(it.title || '').replace(/\s+/g, ' ').trim();
                if (title && pgNo && pgNo >= 1 && pgNo <= total) {
                  outlineEntries.push({ title, page: pgNo, level: level || 0, source: 'outline' });
                }
                if (Array.isArray(it.items) && it.items.length) {
                  await flattenOutline(it.items, (level || 0) + 1);
                }
              }
            };
            await flattenOutline(rawOutline, 0);
          }
        }
      } catch (_) { }
      const pagesData = [];
      for (let i = sp; i <= ep; i++) {
        const pg = await doc.getPage(i);
        const tc = await pg.getTextContent();
        pagesData.push({ page: i, items: tc.items });
        try { if (typeof pg.cleanup === 'function') pg.cleanup(); } catch (_) { }
        if ((i - sp + 1) % 15 === 0) await new Promise(r => setTimeout(r, 0));
      }
      return { lines: SM.buildPdfLines(pagesData), outline: outlineEntries, name, path: docPath, totalPages: total, startPage: sp, endPage: ep };
    } finally {
      try { if (doc) doc.destroy(); } catch (_) { }
    }
  }

  function filterLinesByConfigRange(lines, cfg) {
    const arr = Array.isArray(lines) ? lines : [];
    const sp = cfg && cfg.startPage ? Number(cfg.startPage) : 1;
    const ep = cfg && cfg.endPage ? Number(cfg.endPage) : Infinity;
    return arr.filter(l => {
      const p = Number(l.page || 1);
      return p >= sp && p <= ep;
    });
  }

  function rangeCovers(parsedRange, sp, ep) {
    if (!parsedRange) return false;
    const pStart = parsedRange.startPage || 1;
    const pEnd = parsedRange.endPage || Infinity;
    const reqStart = sp || 1;
    const reqEnd = ep || Infinity;
    return pStart <= reqStart && pEnd >= reqEnd;
  }

  async function ensureParsedForRange(srcPath) {
    const cfg = S.proj.sceneParseConfig;
    const sp = cfg.startPage || null, ep = cfg.endPage || null;
    if (UI.parsedLines && UI.parsedPath === srcPath && rangeCovers(UI.parsedRange, sp, ep)) {
      return { lines: filterLinesByConfigRange(UI.parsedLines, cfg), outline: UI.parsedOutline || [], name: UI.parsedName, path: UI.parsedPath };
    }
    const res = await readDocumentLines(srcPath, { startPage: sp, endPage: ep });
    UI.parsedLines = res.lines;
    UI.parsedOutline = res.outline || [];
    UI.parsedPath = res.path;
    UI.parsedName = res.name;
    UI.parsedRange = { startPage: res.startPage, endPage: res.endPage };
    return { lines: filterLinesByConfigRange(res.lines, cfg), outline: UI.parsedOutline, name: res.name, path: res.path };
  }

  async function analyzeDocument(docPath, autoBuildIfEmpty) {
    ensureProjShape();
    const srcPath = docPath || S.proj.sceneParseConfig.sourcePath || ((collectSourceDocs()[0] || {}).path) || '';
    if (!srcPath) return say('⚠️ 先にPDF / TXT / HTML資料を開くか登録してください');
    try {
      say('🔍 見出しパターンを解析しています…');
      const cfg = S.proj.sceneParseConfig;
      const res = await readDocumentLines(srcPath, { startPage: cfg.startPage, endPage: cfg.endPage });
      UI.parsedLines = res.lines;
      UI.parsedOutline = res.outline || [];
      UI.parsedPath = res.path;
      UI.parsedName = res.name;
      UI.parsedRange = { startPage: res.startPage, endPage: res.endPage };
      cfg.sourcePath = res.path;
      const filtered = filterLinesByConfigRange(res.lines, cfg);
      UI.headingStats = SM.detectHeadingStats(filtered, cfg.customPrefixes);
      const roles = SM.recommendPatternRoles(UI.headingStats, cfg.granularity || 'standard');
      cfg.patternRoles = roles;
      cfg.enabledPatterns = Object.keys(roles).filter(k => roles[k] === 'scene');
      if (autoBuildIfEmpty && !S.proj.scenes.length) {
        await redetectScenesFromParsed(true);
      } else {
        CCF.saveProject();
        render();
        const rangeTxt = (cfg.startPage || cfg.endPage) ? `（p.${res.startPage}〜${res.endPage}）` : '';
        const olTxt = UI.parsedOutline.length ? `／PDFしおり ${UI.parsedOutline.length}件` : '';
        say(`✅ 見出し候補を抽出しました${rangeTxt}（${filtered.length}行${olTxt}）`);
      }
    } catch (e) {
      console.error('[ccf_scene] 解析エラー', e);
      say('❌ 解析に失敗しました：' + (e.message || e));
    }
  }

  async function redetectScenesFromParsed(silent) {
    ensureProjShape();
    const cfg = S.proj.sceneParseConfig;
    const srcPath = cfg.sourcePath || UI.parsedPath || ((collectSourceDocs()[0] || {}).path) || '';
    if (!UI.parsedLines || !UI.parsedLines.length) {
      if (!srcPath) return say('先に「🔍 見出し候補を解析」を実行してください');
    }
    try {
      let filtered = UI.parsedLines ? filterLinesByConfigRange(UI.parsedLines, cfg) : [];
      if (srcPath && (!UI.parsedLines || UI.parsedPath !== srcPath || !rangeCovers(UI.parsedRange, cfg.startPage, cfg.endPage))) {
        const loaded = await ensureParsedForRange(srcPath);
        filtered = loaded.lines;
      }
      if (!filtered.length) return say('⚠️ 指定ページ範囲にテキストが見つかりませんでした');
      UI.headingStats = SM.detectHeadingStats(filtered, cfg.customPrefixes);
      cp('シーンを自動検出');
      const docIdx = CCF.getDocIdx ? CCF.getDocIdx(UI.parsedPath || srcPath) : null;
      const rawScenes = SM.buildScenesFromLines(filtered, {
        granularity: cfg.granularity || 'standard',
        patternRoles: cfg.patternRoles,
        enabledPatterns: cfg.enabledPatterns,
        customPrefixes: cfg.customPrefixes,
        useOutline: cfg.useOutline !== false,
        autoGuard: cfg.autoGuard !== false,
        outline: UI.parsedOutline || [],
        docIdx,
        sourceName: UI.parsedName,
        sourcePath: UI.parsedPath,
        startPage: cfg.startPage,
        endPage: cfg.endPage
      });
      UI.lastSplitMethod = rawScenes._splitMethod || 'heading';
      S.proj.scenes = rawScenes.map(s => {
        const sc = M.sanitizeScene(s);
        if (sc && cfg.cleanLineBreaks) sc.text = cleanSceneTextWithHeading(sc, sc.text);
        return sc;
      }).filter(Boolean);
      UI.expandedScenes.clear();
      UI.expandedSlotScenes.clear();
      UI.sceneLimit = 50;
      candidateCache.clear();
      if (S.proj.scenes[0]) UI.boardTarget = S.proj.scenes[0].id;
      CCF.saveProject();
      render();
      if (!silent) {
        const methodNote = UI.lastSplitMethod === 'outline' ? '（PDFしおり優先）' : (UI.lastSplitMethod === 'toc' ? '（目次ページ優先）' : '');
        say(`🎬 ${S.proj.scenes.length}件のシーンを検出しました${methodNote}`);
      }
    } catch (e) {
      console.error('[ccf_scene] 再検出エラー', e);
      say('❌ シーン再検出に失敗しました：' + (e.message || e));
    }
  }

  async function importPageRangeAsScenes(mode) {
    ensureProjShape();
    const cfg = S.proj.sceneParseConfig;
    const sel = $('ccfSceneDocSel');
    const srcPath = (sel && sel.value) || cfg.sourcePath || ((collectSourceDocs()[0] || {}).path) || '';
    if (!srcPath) return say('⚠️ 先にPDF / TXT / HTML資料を開くか登録してください');
    try {
      say('📥 指定ページ範囲の本文を取り込んでいます…');
      cfg.sourcePath = srcPath;
      const loaded = await ensureParsedForRange(srcPath);
      const lines = loaded.lines;
      if (!lines.length) return say('⚠️ 指定ページ範囲にテキストがありませんでした');
      const pagesMap = new Map();
      lines.forEach(l => {
        const p = Number(l.page || 1);
        if (!pagesMap.has(p)) pagesMap.set(p, []);
        pagesMap.get(p).push(l.text);
      });
      const sortedPages = [...pagesMap.keys()].sort((a, b) => a - b);
      cp(mode === 'per-page' ? 'ページ単位でシーン取り込み' : '指定範囲を1シーンとして取り込み');
      const added = [];
      if (mode === 'per-page') {
        sortedPages.forEach(pg => {
          let txt = pagesMap.get(pg).join('\n').trim();
          if (!txt) return;
          if (cfg.cleanLineBreaks) txt = T.cleanText(txt, { joinLines: 'smart', stripSpaces: true });
          const first = (txt.split('\n').find(x => x.trim()) || '').trim();
          const title = (first && Array.from(first).length <= 28) ? SM.cleanHeadingTitle(first) : `p.${pg}`;
          const sc = M.sanitizeScene({
            title,
            text: txt,
            page: pg,
            sourceName: loaded.name,
            sourcePath: loaded.path,
            headingPattern: 'manual'
          });
          S.proj.scenes.push(sc);
          added.push(sc);
        });
      } else {
        let txt = sortedPages.map(pg => pagesMap.get(pg).join('\n')).join('\n\n').trim();
        if (cfg.cleanLineBreaks) txt = T.cleanText(txt, { joinLines: 'smart', stripSpaces: true });
        const sp = sortedPages[0], ep = sortedPages[sortedPages.length - 1];
        const title = sp === ep ? `${loaded.name} p.${sp}` : `${loaded.name} p.${sp}〜${ep}`;
        const sc = M.sanitizeScene({
          title,
          text: txt,
          page: sp,
          sourceName: loaded.name,
          sourcePath: loaded.path,
          headingPattern: 'manual'
        });
        S.proj.scenes.push(sc);
        added.push(sc);
      }
      if (!added.length) return say('⚠️ 取り込める本文がありませんでした');
      UI.boardTarget = added[0].id;
      CCF.saveProject();
      render();
      say(`📥 ${added.length}件のシーンを取り込みました`);
    } catch (e) {
      console.error('[ccf_scene] 取り込みエラー', e);
      say('❌ 取り込みに失敗しました：' + (e.message || e));
    }
  }

  // ======================================================================
  // 2. 「✨これかも？」素材マッチング・一括仮配置・タグ追加補助
  // ======================================================================
  function getMatchSources() {
    const registeredItems = (CCF.assets && CCF.assets.getUnifiedItems) ? CCF.assets.getUnifiedItems(S.key) : [];
    const commonItems = (window.CommonAssets && window.CommonAssets.getAll) ? window.CommonAssets.getAll() : [];
    return { registeredItems, commonItems };
  }

  function measureImageSize(src) {
    return new Promise(resolve => {
      if (!src) return resolve(null);
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        } else resolve(null);
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function fitRectInsideBoard(natW, natH, bw, bh) {
    if (!(natW > 0 && natH > 0)) return { x: 0, y: 0, width: bw, height: bh };
    const scale = Math.min(bw / natW, bh / natH);
    const width = Math.max(16, Math.round(natW * scale));
    const height = Math.max(16, Math.round(natH * scale));
    const x = Math.round((bw - width) / 2);
    const y = Math.round((bh - height) / 2);
    return { x, y, width, height };
  }

  let _fitRefreshTimer = null;
  function autoFitBoardItemToImage(item, opts) {
    const src = assetSrc(item);
    if (!src) return Promise.resolve(false);
    return measureImageSize(src).then(dim => {
      if (!dim) return false;
      const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
      const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
      const rect = fitRectInsideBoard(dim.width, dim.height, bw, bh);
      item.x = rect.x;
      item.y = rect.y;
      item.width = rect.width;
      item.height = rect.height;
      item.lockAspect = true;
      if (!opts || opts.save !== false) CCF.saveProject();
      if (!opts || opts.refresh !== false) {
        clearTimeout(_fitRefreshTimer);
        _fitRefreshTimer = setTimeout(() => {
          if (S && S.view === 'scene' && (UI.subView === 'board' || UI.modalOpen)) refreshBoardContainers();
        }, 20);
      }
      return true;
    });
  }

  function panelInitialSize(natW, natH, kind, bw, bh) {
    const maxW = kind === 'marker' ? Math.max(160, Math.round(bw * 0.35)) : Math.max(240, Math.round(bw * 0.45));
    const maxH = kind === 'marker' ? Math.max(160, Math.round(bh * 0.35)) : Math.max(240, Math.round(bh * 0.45));
    if (!(natW > 0 && natH > 0)) {
      return kind === 'marker' ? { width: 160, height: 160 } : { width: 320, height: 200 };
    }
    const scale = Math.min(1, maxW / natW, maxH / natH);
    return {
      width: Math.max(24, Math.round(natW * scale)),
      height: Math.max(24, Math.round(natH * scale))
    };
  }

  function autoFitPanelItemToImage(item, opts) {
    const src = assetSrc(item);
    if (!src) return Promise.resolve(false);
    return measureImageSize(src).then(dim => {
      if (!dim) return false;
      const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
      const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
      const sz = panelInitialSize(dim.width, dim.height, item.kind, bw, bh);
      item.width = sz.width;
      item.height = sz.height;
      item.lockAspect = true;
      if (opts && opts.center) {
        item.x = Math.round((bw - sz.width) / 2);
        item.y = Math.round((bh - sz.height) / 2);
      }
      if (!opts || opts.save !== false) CCF.saveProject();
      if (!opts || opts.refresh !== false) {
        clearTimeout(_fitRefreshTimer);
        _fitRefreshTimer = setTimeout(() => {
          if (S && S.view === 'scene' && (UI.subView === 'board' || UI.modalOpen)) refreshBoardContainers();
        }, 20);
      }
      return true;
    });
  }

  function buildBoardItemFromAsset(asset, kind, existing) {
    const prev = existing || {};
    const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
    const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
    const defW = kind === 'bg' || kind === 'fg' ? bw : kind === 'marker' ? 160 : 320;
    const defH = kind === 'bg' || kind === 'fg' ? bh : kind === 'marker' ? 160 : 200;
    const defZ = kind === 'bg' || kind === 'fg' ? 0 : kind === 'marker' ? 20 : 10;
    const raw = {
      id: prev.id || M.newId(),
      syncId: prev.syncId || '',
      kind,
      assetUid: asset.uid || '',
      name: asset.name || '素材',
      text: prev.text != null ? prev.text : '',
      path: asset.path || '',
      dataUrl: asset.dataUrl || '',
      x: prev.x != null ? prev.x : (kind === 'bg' || kind === 'fg' ? 0 : 420),
      y: prev.y != null ? prev.y : (kind === 'bg' || kind === 'fg' ? 0 : 200),
      width: prev.width != null ? prev.width : defW,
      height: prev.height != null ? prev.height : defH,
      zIndex: prev.zIndex != null ? prev.zIndex : defZ,
      visible: prev.visible !== false,
      locked: !!prev.locked,
      lockAspect: prev.lockAspect !== false
    };
    if (kind === 'fg') raw.fitMode = prev.fitMode === 'fill' ? 'fill' : 'cover';
    return M.sanitizeBoardItem(raw, kind);
  }

  function assignSlotAsset(scene, slot, asset, isManual, matchSources) {
    if (!scene || !asset) return;
    scene.manualSlots = scene.manualSlots || { bg: false, fg: false, screen: false, marker: false, bgm: false };
    if (slot === 'bg' || slot === 'fg') {
      const prev = scene[slot];
      const sameAsset = prev && ((asset.uid && prev.assetUid === asset.uid) || (asset.path && prev.path === asset.path));
      const keepMeta = prev ? (sameAsset ? prev : { id: prev.id, syncId: prev.syncId, zIndex: prev.zIndex, visible: prev.visible, fitMode: prev.fitMode }) : null;
      scene[slot] = buildBoardItemFromAsset(asset, slot, keepMeta);
      scene.manualSlots[slot] = !!isManual;
    } else if (slot === 'marker' || slot === 'screen') {
      const prev = scene.markers && scene.markers[0];
      const item = buildBoardItemFromAsset(asset, 'marker', prev);
      scene.markers = scene.markers && scene.markers.length ? [item, ...scene.markers.slice(1)] : [item];
      autoFitPanelItemToImage(item, { center: !prev });
      scene.manualSlots.marker = !!isManual;
    } else if (slot === 'bgm') {
      scene.bgm = M.sanitizeSceneAudio({
        assetUid: asset.uid || '',
        name: asset.name || 'BGM',
        path: asset.path || '',
        volume: scene.bgm ? scene.bgm.volume : UI.defaultBgmVolume,
        loop: scene.bgm ? scene.bgm.loop !== false : true
      });
      scene.manualSlots.bgm = !!isManual;
    }
    if (isManual && matchSources) {
      scene.manualSlots[slot] = true;
    }
  }

  function cleanLineBreaksInScenes() {
    ensureProjShape();
    if (!S.proj.scenes.length) return say('⚠️ シーンがありません');
    const hasChecked = S.proj.scenes.some(s => s.checked);
    const targets = hasChecked ? S.proj.scenes.filter(s => s.checked) : S.proj.scenes;
    let changed = 0;
    const plan = targets.map(sc => {
      const next = cleanSceneTextWithHeading(sc, sc.text);
      if (next !== sc.text) changed++;
      return { sc, next };
    });
    if (!changed) return say('整形が必要な改行はありませんでした');
    cp('シーン本文の不自然な改行を一括除去');
    plan.forEach(({ sc, next }) => {
      sc.text = next;
      invalidateCandidate(sc);
    });
    CCF.saveProject();
    render();
    say(`🧹 ${changed}件のシーン本文から不自然な改行を除去しました`);
  }

  function createSceneFromSelection() {
    ensureProjShape();
    const sel = getLeftOrBufferSelection();
    if (!sel.text || !sel.text.trim()) {
      return say('⚠️ 左ペインのPDF/TXTで文字を選択するか、抽出バッファにテキストを入れてください');
    }
    const cfg = S.proj.sceneParseConfig;
    let text = String(sel.text).replace(/\r\n?/g, '\n').trim();
    if (cfg.cleanLineBreaks) text = T.cleanText(text, { joinLines: 'smart', stripSpaces: true });
    const first = (text.split('\n').find(l => l.trim()) || '').trim();
    const title = (first && Array.from(first).length <= 36) ? SM.cleanHeadingTitle(first) : ('シーン ' + (S.proj.scenes.length + 1));
    cp('選択テキストから新規シーンを作成');
    const sc = M.sanitizeScene({
      title,
      text,
      page: sel.page || 1,
      sourceName: sel.sourceName || '',
      sourcePath: sel.sourcePath || '',
      headingPattern: 'manual'
    });
    insertScenesAfterSelection(sc);
    computeCandidatesForScene(sc, getMatchSources());
    CCF.saveProject();
    render();
    say(`📥 新規シーン「${sc.title}」を作成しました`);
    return sc;
  }

  function applySelectionToScene(sceneId, mode) {
    ensureProjShape();
    const sc = S.proj.scenes.find(s => s.id === sceneId);
    if (!sc) return say('⚠️ 先に対象のシーンを選択してください');
    const sel = getLeftOrBufferSelection();
    if (!sel.text || !sel.text.trim()) {
      return say('⚠️ 左ペインのPDF/TXTで文字を選択するか、抽出バッファにテキストを入れてください');
    }
    const cfg = S.proj.sceneParseConfig;
    let chunk = String(sel.text).replace(/\r\n?/g, '\n').trim();
    if (cfg.cleanLineBreaks) chunk = T.cleanText(chunk, { joinLines: 'smart', stripSpaces: true });
    cp(mode === 'replace' ? '選択テキストでシーン本文を置換' : '選択テキストをシーン本文へ追記');
    if (mode === 'replace') {
      sc.text = chunk;
    } else {
      sc.text = sc.text && sc.text.trim() ? (sc.text.trim() + '\n\n' + chunk) : chunk;
    }
    if (!sc.page && sel.page) sc.page = sel.page;
    invalidateCandidate(sc);
    computeCandidatesForScene(sc, getMatchSources());
    CCF.saveProject();
    render();
    say(mode === 'replace' ? '📥 本文を選択テキストで置換しました' : '📥 本文へ選択テキストを追記しました');
  }

  function openStockToSceneDialog() {
    ensureProjShape();
    const stocks = S.proj.stocks || [];
    if (!stocks.length) return say('⚠️ 先に「📝 テキスト・情報駒」にテキストを登録してください');
    const ov = document.createElement('div');
    ov.className = 'app-dialog-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    const rowsHtml = stocks.map((st, idx) => {
      const ttl = st.title || T.stockTitle({ text: st.text }, 18) || `テキスト #${idx + 1}`;
      const preview = String(st.text || '').replace(/\s+/g, ' ').slice(0, 80);
      return `<label class="ccf-stock-pick-row">
        <input type="checkbox" data-stp-chk="${idx}" checked>
        <div class="ccf-stock-pick-meta">
          <div><b>#${idx + 1} ${esc(ttl)}</b>${st.page ? ` <span class="ccf-badge">p.${st.page}</span>` : ''}</div>
          <div class="ccf-muted" style="font-size:.74rem;">${esc(preview)}</div>
        </div>
      </label>`;
    }).join('');
    ov.innerHTML = `<div class="app-dialog" style="width:min(620px,94vw);">
      <div class="app-dialog-title">📋 登録テキストからシーンを追加</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <button type="button" class="ccf-mini" data-stp-all="1">☑ 全選択</button>
        <button type="button" class="ccf-mini" data-stp-all="0">☐ 全解除</button>
        <span class="ccf-muted">取り込むテキストを選んで追加方法を押してください</span>
      </div>
      <div class="ccf-stock-pick-list" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">${rowsHtml}</div>
      <div class="app-dialog-actions" style="flex-wrap:wrap;gap:6px;">
        <button type="button" class="app-dialog-btn" data-stp-act="cancel">キャンセル</button>
        <button type="button" class="app-dialog-btn" data-stp-act="merge">📥 選択を1つのシーンにまとめて追加</button>
        <button type="button" class="app-dialog-btn primary" data-stp-act="each">📥 1件＝1シーンとして個別に追加</button>
      </div>
    </div>`;
    const close = () => ov.remove();
    ov.addEventListener('click', e => {
      const allBtn = e.target.closest('[data-stp-all]');
      if (allBtn) {
        const on = allBtn.dataset.stpAll === '1';
        ov.querySelectorAll('[data-stp-chk]').forEach(c => { c.checked = on; });
        return;
      }
      const actBtn = e.target.closest('[data-stp-act]');
      if (!actBtn) return;
      const act = actBtn.dataset.stpAct;
      if (act === 'cancel') return close();
      const picked = [...ov.querySelectorAll('[data-stp-chk]:checked')].map(c => stocks[+c.dataset.stpChk]).filter(Boolean);
      if (!picked.length) return say('⚠️ 少なくとも1件のテキストを選択してください');
      close();
      cp('登録テキストからシーンを追加');
      const cfg = S.proj.sceneParseConfig;
      const added = [];
      if (act === 'each') {
        picked.forEach((st, i) => {
          let text = String(st.text || '').trim();
          if (cfg.cleanLineBreaks) text = T.cleanText(text, { joinLines: 'smart', stripSpaces: true });
          const sc = M.sanitizeScene({
            title: st.title || T.stockTitle({ text }, 18) || `シーン ${S.proj.scenes.length + i + 1}`,
            text,
            page: st.page || null,
            headingPattern: 'manual'
          });
          S.proj.scenes.push(sc);
          added.push(sc);
        });
      } else {
        const merged = picked.map(st => (st.title ? `【${st.title}】\n` : '') + String(st.text || '').trim()).join('\n\n');
        const text = cfg.cleanLineBreaks ? T.cleanText(merged, { joinLines: 'smart', stripSpaces: true }) : merged;
        const sc = M.sanitizeScene({
          title: picked[0].title || `シーン ${S.proj.scenes.length + 1}`,
          text,
          page: picked[0].page || null,
          headingPattern: 'manual'
        });
        S.proj.scenes.push(sc);
        added.push(sc);
      }
      if (added[0]) UI.boardTarget = added[0].id;
      CCF.saveProject();
      render();
      say(`📋 登録テキストから ${added.length}件のシーンを追加しました`);
    });
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }

  function getPageLines(docPath, page) {
    if (!UI.parsedLines || !UI.parsedLines.length) return null;
    if (docPath && UI.parsedPath && String(UI.parsedPath).toLowerCase() !== String(docPath).toLowerCase()) return null;
    const pg = Number(page || 1);
    return UI.parsedLines.filter(l => Number(l.page || 1) === pg);
  }

  function resolveSubheadingMeta(sc, headingText, lineOffset) {
    const srcPath = (sc && sc.sourcePath) || UI.parsedPath || '';
    const docIdx = CCF.getDocIdx ? CCF.getDocIdx(srcPath) : (sc && sc.docIdx != null ? sc.docIdx : null);
    const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, '');
    const key = norm(headingText);
    if (key && UI.parsedLines && UI.parsedLines.length && (!srcPath || !UI.parsedPath || String(srcPath).toLowerCase() === String(UI.parsedPath).toLowerCase())) {
      const startPg = (sc && sc.page) ? Number(sc.page) : 1;
      let startIdx = UI.parsedLines.findIndex(l => Number(l.page || 1) >= startPg);
      if (startIdx < 0) startIdx = 0;
      for (let i = startIdx; i < UI.parsedLines.length; i++) {
        const ln = norm(UI.parsedLines[i].text);
        if (ln && (ln === key || ln.includes(key) || (ln.length >= 3 && key.includes(ln)))) {
          return {
            page: UI.parsedLines[i].page || startPg,
            lineIdx: UI.parsedLines[i].pageLineIdx != null ? UI.parsedLines[i].pageLineIdx : 0,
            docIdx
          };
        }
      }
    }
    return {
      page: (sc && sc.page) || null,
      lineIdx: (sc && sc.lineIdx != null) ? (sc.lineIdx + lineOffset) : lineOffset,
      docIdx
    };
  }

  function addSubheadingToStock(sceneIdx, lineIdxInScene) {
    ensureProjShape();
    const sc = S.proj.scenes[sceneIdx];
    if (!sc) return;
    const cfg = S.proj.sceneParseConfig;
    const lines = String(sc.text || '').replace(/\r\n?/g, '\n').split('\n');
    const headingLine = lines[lineIdxInScene];
    if (!headingLine || !headingLine.trim()) return;
    const title = SM.cleanHeadingTitle(headingLine);
    const bodyLines = [];
    for (let j = lineIdxInScene + 1; j < lines.length; j++) {
      const ln = lines[j];
      if (ln.trim() && SM.matchHeadingRole(ln, 'any', { patternRoles: cfg.patternRoles, customPrefixes: cfg.customPrefixes })) {
        break;
      }
      bodyLines.push(ln);
    }
    const rawBody = bodyLines.join('\n').trim();
    const text = rawBody ? T.cleanText(rawBody, { joinLines: 'smart', stripSpaces: true }) : title;
    const meta = resolveSubheadingMeta(sc, headingLine, lineIdxInScene);
    const srcPath = sc.sourcePath || UI.parsedPath || '';
    const srcName = sc.sourceName || UI.parsedName || (srcPath ? srcPath.split(/[\\/]/).pop() : '');
    cp('情報テキストへ登録');
    const item = {
      id: M.newId(),
      title,
      text,
      page: meta.page,
      lineIdx: meta.lineIdx,
      docIdx: meta.docIdx,
      srcs: srcPath ? [{ path: srcPath, name: srcName, page: meta.page || 1, rect: null }] : [],
      createdAt: Date.now()
    };
    if (CCF.addStockItems) {
      CCF.addStockItems([item]);
    } else {
      S.proj.stocks.push(M.sanitizeStock(item));
      CCF.saveProject();
      CCF.renderCenter();
    }
    say(`📝「${title}」をテキスト・情報駒へ登録しました`);
  }

  async function openExtractInfoModal() {
    ensureProjShape();
    const cfg = S.proj.sceneParseConfig;
    const sel = $('ccfSceneDocSel');
    const srcPath = (sel && sel.value) || cfg.sourcePath || UI.parsedPath || ((collectSourceDocs()[0] || {}).path) || '';
    if (!srcPath) return say('⚠️ 先にPDF / TXT / HTML資料を開くか登録してください');
    cfg.sourcePath = srcPath;

    let currentBlocks = [];
    let currentName = '';
    const loadBlocks = async (sp, ep) => {
      cfg.startPage = sp >= 1 ? sp : null;
      cfg.endPage = ep >= 1 ? ep : null;
      const loaded = await ensureParsedForRange(srcPath);
      currentName = loaded.name;
      const docIdx = CCF.getDocIdx ? CCF.getDocIdx(loaded.path) : 0;
      currentBlocks = SM.extractInfoBlocksFromLines(loaded.lines, {
        patternRoles: cfg.patternRoles,
        customPrefixes: cfg.customPrefixes,
        sourceName: loaded.name,
        sourcePath: loaded.path,
        docIdx,
        startPage: cfg.startPage,
        endPage: cfg.endPage
      });
      const anyHasBody = currentBlocks.some(b => b.hasBody);
      currentBlocks.forEach(b => {
        b._checked = anyHasBody ? b.hasBody : true;
        b._expanded = false;
      });
    };

    try {
      say('🔍 小見出しブロックを抽出しています…');
      await loadBlocks(cfg.startPage, cfg.endPage);
    } catch (e) {
      console.error('[ccf_scene] 小見出し一括抽出エラー', e);
      return say('❌ 抽出に失敗しました：' + (e.message || e));
    }

    const patLabelMap = new Map(SM.HEADING_PATTERNS.map(p => [p.id, p.label]));
    patLabelMap.set('custom', 'カスタム先頭記号');
    const ov = document.createElement('div');
    ov.className = 'app-dialog-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    const makePreview = text => {
      const flat = String(text || '').replace(/\s+/g, ' ').trim();
      return flat.length > 80 ? flat.slice(0, 80) + '…' : flat;
    };

    const renderRowInnerHtml = (b, idx) => {
      const patName = patLabelMap.get(b.patternId) || b.patternId;
      const txt = String(b.text || '');
      const charLen = Array.from(txt).length;
      const lineCount = txt ? txt.replace(/\r\n?/g, '\n').split('\n').length : 0;
      const rows = Math.min(14, Math.max(4, lineCount + 1));
      const preview = makePreview(txt);
      return `<div class="ccf-ib-row-head">
          <label class="ccf-ib-chk-lbl" title="登録対象に含める">
            <input type="checkbox" data-ib-chk="${idx}"${b._checked ? ' checked' : ''}>
            <b>#${idx + 1}</b>
          </label>
          ${b._expanded
            ? `<input type="text" class="ccf-ib-title-inp" data-ib-title="${idx}" value="${esc(b.title)}" placeholder="見出しタイトル">`
            : `<span class="ccf-ib-title-txt">${esc(b.title)}</span>`}
          <span class="ccf-badge">📄 P.${b.page}</span>
          <span class="ccf-chip dim" style="font-size:.68rem;">${esc(patName)}</span>
          <span class="ccf-muted ccf-ib-len" data-ib-len="${idx}" style="font-size:.7rem;">(${txt.trim() ? `${charLen}文字 / ${lineCount}行` : '本文なし'})</span>
          <span class="ccf-spacer"></span>
          <button type="button" class="ccf-mini ccf-ib-toggle" data-ib-toggle="${idx}">${b._expanded ? '▴ 折りたたむ' : '▾ 全文表示'}</button>
        </div>
        ${b._expanded
          ? `<div class="ccf-ib-full">
              <textarea class="ccf-ib-textarea" data-ib-text="${idx}" rows="${rows}" placeholder="情報テキスト本文（改行を保持したまま編集できます）">${esc(txt)}</textarea>
            </div>`
          : `<div class="ccf-ib-preview" data-ib-preview="${idx}">${esc(preview || '（本文なし）')}</div>`}`;
    };

    const renderBody = () => {
      const listElPrev = ov.querySelector('.ccf-stock-pick-list');
      const prevScroll = listElPrev ? listElPrev.scrollTop : 0;
      const allExpanded = currentBlocks.length > 0 && currentBlocks.every(b => b._expanded);
      const listHtml = currentBlocks.length ? currentBlocks.map((b, idx) =>
        `<div class="ccf-ib-row${b._expanded ? ' expanded' : ''}" data-ib-row="${idx}">${renderRowInnerHtml(b, idx)}</div>`
      ).join('') : '<div class="ccf-empty">指定ページ範囲に「📝 情報テキスト候補」に一致する小見出しが見つかりませんでした。<br>見出しパターンの役割設定で「📝 情報テキスト候補」を有効にしてください。</div>';

      const checkedCnt = currentBlocks.filter(b => b._checked).length;
      ov.innerHTML = `<div class="app-dialog ccf-ib-dialog" style="width:min(880px,95vw);">
        <div class="app-dialog-title">📋 見出しから情報テキストを一括抽出</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;font-size:.8rem;">
          <span>📄 <b>${esc(currentName)}</b></span>
          <label class="ccf-inline-field"><span class="ccf-inline-lbl">範囲:</span> <input type="number" id="ccfIbStart" min="1" value="${cfg.startPage || ''}" placeholder="開始p." style="width:68px;"> 〜 <input type="number" id="ccfIbEnd" min="1" value="${cfg.endPage || ''}" placeholder="終了p." style="width:68px;"></label>
          <button type="button" class="ccf-mini" data-ib-act="refresh">🔄 再抽出</button>
          <button type="button" class="ccf-mini${allExpanded ? ' active' : ''}" data-ib-act="toggle-all-expand" title="すべての候補の全文表示を一括で展開／折りたたみます">${allExpanded ? '📖 すべて折りたたむ' : '📖 すべて全文展開'}</button>
          <span class="ccf-spacer"></span>
          <button type="button" class="ccf-mini" data-ib-all="1">☑ 全選択</button>
          <button type="button" class="ccf-mini" data-ib-all="0">☐ 全解除</button>
          <span class="ccf-muted" id="ccfIbCount">${checkedCnt} / ${currentBlocks.length}件選択</span>
        </div>
        <div class="ccf-stock-pick-list ccf-ib-list">${listHtml}</div>
        <div class="app-dialog-actions" style="flex-wrap:wrap;gap:6px;">
          <button type="button" class="app-dialog-btn" data-ib-act="cancel">キャンセル</button>
          <button type="button" class="app-dialog-btn primary" data-ib-act="register"${checkedCnt ? '' : ' disabled'}>📝 選択した項目を情報テキストへ一括登録（${checkedCnt}件）</button>
        </div>
      </div>`;
      const listElNext = ov.querySelector('.ccf-stock-pick-list');
      if (listElNext && prevScroll) listElNext.scrollTop = prevScroll;
    };
    const refreshCount = () => {
      const checked = currentBlocks.filter(b => b._checked).length;
      const cEl = ov.querySelector('#ccfIbCount');
      if (cEl) cEl.textContent = `${checked} / ${currentBlocks.length}件選択`;
      const regBtn = ov.querySelector('[data-ib-act="register"]');
      if (regBtn) {
        regBtn.disabled = !checked;
        regBtn.textContent = `📝 選択した項目を情報テキストへ一括登録（${checked}件）`;
      }
    };
    const syncAllExpandBtn = () => {
      const btn = ov.querySelector('[data-ib-act="toggle-all-expand"]');
      if (!btn) return;
      const allExpanded = currentBlocks.length > 0 && currentBlocks.every(b => b._expanded);
      btn.classList.toggle('active', allExpanded);
      btn.textContent = allExpanded ? '📖 すべて折りたたむ' : '📖 すべて全文展開';
    };
    renderBody();
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      ov.remove();
    };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('change', e => {
      const chk = e.target.closest('[data-ib-chk]');
      if (chk) {
        const b = currentBlocks[+chk.dataset.ibChk];
        if (b) b._checked = !!chk.checked;
        refreshCount();
      }
    });
    ov.addEventListener('input', e => {
      const ta = e.target.closest('[data-ib-text]');
      if (ta) {
        const idx = +ta.dataset.ibText;
        const b = currentBlocks[idx];
        if (!b) return;
        b.text = ta.value;
        b.hasBody = !!ta.value.trim();
        const lenEl = ov.querySelector(`[data-ib-len="${idx}"]`);
        if (lenEl) {
          const charLen = Array.from(b.text).length;
          const lineCount = b.text ? b.text.replace(/\r\n?/g, '\n').split('\n').length : 0;
          lenEl.textContent = b.text.trim() ? `(${charLen}文字 / ${lineCount}行)` : '(本文なし)';
        }
        return;
      }
      const titleInp = e.target.closest('[data-ib-title]');
      if (titleInp) {
        const idx = +titleInp.dataset.ibTitle;
        const b = currentBlocks[idx];
        if (b) b.title = titleInp.value;
      }
    });
    ov.addEventListener('click', async e => {
      const togBtn = e.target.closest('[data-ib-toggle]');
      if (togBtn) {
        const idx = +togBtn.dataset.ibToggle;
        const b = currentBlocks[idx];
        if (!b) return;
        b._expanded = !b._expanded;
        const rowEl = ov.querySelector(`[data-ib-row="${idx}"]`);
        if (rowEl) {
          rowEl.classList.toggle('expanded', b._expanded);
          rowEl.innerHTML = renderRowInnerHtml(b, idx);
        }
        syncAllExpandBtn();
        return;
      }
      const allBtn = e.target.closest('[data-ib-all]');
      if (allBtn) {
        const on = allBtn.dataset.ibAll === '1';
        currentBlocks.forEach(b => { b._checked = on; });
        ov.querySelectorAll('[data-ib-chk]').forEach(c => { c.checked = on; });
        refreshCount();
        return;
      }
      const actBtn = e.target.closest('[data-ib-act]');
      if (!actBtn) return;
      const act = actBtn.dataset.ibAct;
      if (act === 'cancel') return close();
      if (act === 'toggle-all-expand') {
        if (!currentBlocks.length) return;
        const nextExpanded = !currentBlocks.every(b => b._expanded);
        currentBlocks.forEach(b => { b._expanded = nextExpanded; });
        renderBody();
        return;
      }
      if (act === 'refresh') {
        const sp = Math.floor(Number((ov.querySelector('#ccfIbStart') || {}).value) || 0);
        const ep = Math.floor(Number((ov.querySelector('#ccfIbEnd') || {}).value) || 0);
        await loadBlocks(sp, ep);
        CCF.saveProject();
        renderBody();
        return;
      }
      if (act === 'register') {
        const picked = currentBlocks.filter(b => b._checked);
        if (!picked.length) return say('⚠️ 登録する見出しをチェックしてください');
        close();
        cp('見出しから情報テキストを一括登録');
        const items = picked.map((b, i) => ({
          id: M.newId(),
          title: String(b.title || '').trim() || ('情報テキスト ' + (i + 1)),
          text: String(b.text || ''),
          page: b.page,
          lineIdx: b.lineIdx,
          docIdx: b.docIdx,
          srcs: b.sourcePath ? [{ path: b.sourcePath, name: b.sourceName || '', page: b.page || 1, rect: null }] : [],
          createdAt: Date.now() + i
        }));
        if (CCF.addStockItems) {
          CCF.addStockItems(items);
        } else {
          items.forEach(it => { const s = M.sanitizeStock(it); if (s) S.proj.stocks.push(s); });
          CCF.saveProject();
          CCF.renderCenter();
        }
        render();
        say(`📋 ${items.length}件の情報テキストを「📝 テキスト・情報駒」へ登録しました`);
      }
    });
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }

  function splitSceneAtCursorById(sceneId, taEl) {
    ensureProjShape();
    const idx = S.proj.scenes.findIndex(s => s.id === sceneId);
    if (idx < 0) return;
    const sc = S.proj.scenes[idx];
    const val = taEl ? taEl.value : String(sc.text || '');
    const pos = taEl ? (taEl._lastCursor != null ? taEl._lastCursor : (taEl.selectionStart || 0)) : 0;
    const head = val.slice(0, pos).trim();
    const tail = val.slice(pos).trim();
    if (!head || !tail) {
      return say('⚠️ 本文内の「分割したい位置」にカーソルを置いてから押してください（前後に文章が必要です）');
    }
    cp('カーソル位置でシーン分割');
    sc.text = head;
    invalidateCandidate(sc);
    const firstTail = (tail.split('\n').find(l => l.trim()) || '').trim();
    const newTitle = (firstTail && Array.from(firstTail).length <= 40)
      ? SM.cleanHeadingTitle(firstTail)
      : ('シーン ' + (idx + 2));
    const nextScene = M.sanitizeScene({
      title: newTitle,
      text: tail,
      page: sc.page || null,
      sourceName: sc.sourceName || '',
      sourcePath: sc.sourcePath || '',
      headingPattern: 'manual',
      checked: !!sc.checked
    });
    S.proj.scenes.splice(idx + 1, 0, nextScene);
    UI.boardTarget = nextScene.id;
    computeCandidatesForScene(sc, getMatchSources());
    computeCandidatesForScene(nextScene, getMatchSources());
    CCF.saveProject();
    render();
    say(`✂️ カーソル位置で新シーン「${nextScene.title}」に分割しました`);
  }

  function insertDelimiterInTextarea(sceneId, taEl) {
    ensureProjShape();
    const sc = S.proj.scenes.find(s => s.id === sceneId);
    if (!sc || !taEl) return;
    const val = taEl.value;
    const start = taEl._lastCursor != null ? taEl._lastCursor : (taEl.selectionStart || val.length);
    const end = taEl._lastCursorEnd != null ? taEl._lastCursorEnd : (taEl.selectionEnd || start);
    const before = val.slice(0, start);
    const after = val.slice(end);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const suffix = after && !after.startsWith('\n') ? '\n' : '';
    const ins = prefix + '---\n' + suffix;
    taEl.value = before + ins + after;
    sc.text = taEl.value;
    const newPos = before.length + ins.length;
    taEl._lastCursor = newPos;
    taEl._lastCursorEnd = newPos;
    taEl.focus();
    try { taEl.setSelectionRange(newPos, newPos); } catch (_) { }
    CCF.saveProject();
    say('➕ カーソル位置に区切り線（---）を挿入しました');
  }

  function splitSceneAtDelimitersById(sceneId) {
    ensureProjShape();
    const idx = S.proj.scenes.findIndex(s => s.id === sceneId);
    if (idx < 0) return;
    const beforeLen = S.proj.scenes.length;
    const nextList = SM.splitSceneByDelimiter(S.proj.scenes, idx).map(M.sanitizeScene).filter(Boolean);
    const addedCount = nextList.length - beforeLen;
    if (addedCount <= 0) {
      return say('⚠️ 本文内に「---」のみの区切り行が見つかりませんでした');
    }
    cp('区切り線（---）で一括シーン分割');
    S.proj.scenes = nextList;
    candidateCache.clear();
    CCF.saveProject();
    render();
    say(`✂️ 区切り線（---）で ${addedCount + 1}個のシーンに一括分割しました`);
  }

  function openSceneSplitEditorModal(initialSceneId) {
    ensureProjShape();
    if (!S.proj.scenes.length) return say('⚠️ 編集・分割できるシーンがありません');
    const prevOv = document.querySelector('.ccf-se-ov');
    if (prevOv && prevOv._cleanup) prevOv._cleanup();
    else if (prevOv) prevOv.remove();

    let activeSceneId = initialSceneId || S.proj.scenes[0].id;
    let syncTimer = null;

    const getActiveIdx = () => {
      if (!S.proj.scenes.length) return -1;
      let idx = S.proj.scenes.findIndex(s => s.id === activeSceneId);
      if (idx < 0) {
        idx = 0;
        activeSceneId = S.proj.scenes[0].id;
      }
      return idx;
    };

    const ov = document.createElement('div');
    ov.className = 'ccf-overlay ccf-se-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    const cfg = S.proj.sceneParseConfig || {};
    const roles = cfg.patternRoles || {};

    const renderLinesListHtml = sc => {
      const lines = String(sc.text || '').replace(/\r\n?/g, '\n').split('\n');
      return lines.map((ln, li) => {
        const isDelim = /^\s*-{3,}\s*$/.test(ln);
        const infoHit = !isDelim && SM.matchHeadingRole(ln, 'info', { patternRoles: roles, customPrefixes: cfg.customPrefixes });
        return `<div class="ccf-se-line${li === 0 ? ' first' : ''}${isDelim ? ' is-delim' : ''}${infoHit ? ' is-info-heading' : ''}" data-se-line="${li}">
          <span class="ccf-scn-lno">${li + 1}</span>
          <span class="ccf-scn-ltxt">${esc(ln || '（空行）')}</span>
          ${li > 0 ? `<button type="button" class="ccf-mini ccf-se-split-btn" data-se-split-line="${li}">✂️ ここから新シーンに分割</button>` : '<span class="ccf-muted" style="font-size:.7rem;flex-shrink:0;">シーン先頭</span>'}
        </div>`;
      }).join('');
    };

    const renderScenesListHtml = () => {
      const scenes = S.proj.scenes;
      return scenes.map((s, sIdx) => {
        const txt = String(s.text || '');
        const lineCnt = txt ? txt.replace(/\r\n?/g, '\n').split('\n').length : 0;
        const charCnt = Array.from(txt).length;
        const isAct = s.id === activeSceneId;
        return `<div class="ccf-se-scn-row${isAct ? ' active' : ''}" data-se-scn-row="${esc(s.id)}">
          <button type="button" class="ccf-mini ccf-se-scn-pick${isAct ? ' primary' : ''}" data-se-select-scene="${esc(s.id)}" title="このシーンを左ペインで編集">#${sIdx + 1}${isAct ? ' 編集中' : ''}</button>
          <input type="text" class="ccf-se-scn-title" data-se-scn-title="${sIdx}" value="${esc(s.title)}" placeholder="シーン名">
          <span class="ccf-muted ccf-se-scn-meta" data-se-scn-meta="${esc(s.id)}">${lineCnt}行 / ${charCnt}字</span>
          <span class="ccf-se-scn-merge-acts">
            ${sIdx > 0 ? `<button type="button" class="ccf-mini" data-se-merge-prev="${sIdx}" title="直前のシーン（#${sIdx}）と結合">⬆ 前のシーンと結合</button>` : ''}
            ${sIdx + 1 < scenes.length ? `<button type="button" class="ccf-mini" data-se-merge-next="${sIdx}" title="次のシーン（#${sIdx + 2}）と結合">⬇ 次のシーンと結合</button>` : ''}
          </span>
        </div>`;
      }).join('');
    };

    const syncRightListsFromCurrentText = () => {
      const idx = getActiveIdx();
      if (idx < 0) return;
      const sc = S.proj.scenes[idx];
      const txt = String(sc.text || '');
      const lineCnt = txt ? txt.replace(/\r\n?/g, '\n').split('\n').length : 0;
      const charCnt = Array.from(txt).length;

      const linesHost = ov.querySelector('[data-se-lines-host]');
      if (linesHost) {
        const prevTop = linesHost.scrollTop;
        linesHost.innerHTML = renderLinesListHtml(sc);
        linesHost.scrollTop = prevTop;
      }
      const linesHead = ov.querySelector('[data-se-lines-count]');
      if (linesHead) linesHead.textContent = `(${lineCnt}行)`;
      const statsEl = ov.querySelector('[data-se-stats]');
      if (statsEl) statsEl.textContent = `${lineCnt}行 / ${charCnt}文字`;
      const metaEl = ov.querySelector(`[data-se-scn-meta="${CSS.escape ? CSS.escape(sc.id) : sc.id}"]`);
      if (metaEl) metaEl.textContent = `${lineCnt}行 / ${charCnt}字`;
    };

    const renderModal = () => {
      const idx = getActiveIdx();
      if (idx < 0) { close(); return; }
      const sc = S.proj.scenes[idx];
      const scenes = S.proj.scenes;
      const txt = String(sc.text || '');
      const lineCnt = txt ? txt.replace(/\r\n?/g, '\n').split('\n').length : 0;
      const charCnt = Array.from(txt).length;

      const prevLinesScroll = (ov.querySelector('[data-se-lines-host]') || {}).scrollTop || 0;
      const prevScenesScroll = (ov.querySelector('[data-se-scenes-host]') || {}).scrollTop || 0;

      ov.innerHTML = `<div class="ccf-modal ccf-se-modal">
        <div class="ccf-modal-head">
          <b>🗗 広い画面で本文分割・編集</b>
          <span class="ccf-badge">#${idx + 1} / ${scenes.length}</span>
          <button type="button" class="ccf-mini" data-se-act="prev-scene"${idx > 0 ? '' : ' disabled'}>◀ 前のシーン</button>
          <button type="button" class="ccf-mini" data-se-act="next-scene"${idx + 1 < scenes.length ? '' : ' disabled'}>次のシーン ▶</button>
          <span class="ccf-muted" style="font-size:.76rem;">左で本文編集・カーソル分割／右の行クリックで即分割＆シーン結合</span>
          <span class="ccf-spacer"></span>
          <button type="button" class="ccf-btn" data-se-act="close">✕ 閉じる</button>
        </div>
        <div class="ccf-se-body">
          <div class="ccf-se-left">
            <div class="ccf-se-title-row">
              <span class="ccf-muted" style="font-weight:700;white-space:nowrap;">シーン名</span>
              <input type="text" class="ccf-se-title-inp" data-se-title="1" value="${esc(sc.title)}" placeholder="シーン名">
              ${sc.page ? `<span class="ccf-badge">p.${sc.page}</span>` : ''}
              <span class="ccf-muted" data-se-stats="1" style="white-space:nowrap;">${lineCnt}行 / ${charCnt}文字</span>
            </div>
            <div class="ccf-se-toolbar">
              <button type="button" class="ccf-btn primary" data-se-act="split-cursor" title="テキストエリア内のカーソル位置より後半を新しいシーンに分割します">✂️ ここで新シーンに分割</button>
              <button type="button" class="ccf-btn" data-se-act="insert-delim" title="カーソル位置に区切り線（---）を挿入します">＋ --- 区切り挿入</button>
              <button type="button" class="ccf-btn" data-se-act="split-delim" title="本文中の「---」の位置で一気に複数シーンへ分割します">✂️ --- で一括分割</button>
              <button type="button" class="ccf-btn" data-se-act="clean-breaks" title="このシーン本文の不自然な折り返し改行を除去します">🧹 不自然な改行除去</button>
            </div>
            <textarea class="ccf-se-textarea" data-se-textarea="1" placeholder="シーン本文・描写・演出メモを入力または編集...">${esc(txt)}</textarea>
          </div>
          <div class="ccf-se-right">
            <div class="ccf-se-panel ccf-se-lines-panel">
              <div class="ccf-se-panel-head">
                <b>📃 全文行リスト <span data-se-lines-count="1">(${lineCnt}行)</span></b>
                <span class="ccf-muted" style="font-size:.74rem;">行の「✂️ ここから新シーンに分割」クリックで即分割</span>
              </div>
              <div class="ccf-se-lines-list" data-se-lines-host="1">${renderLinesListHtml(sc)}</div>
            </div>
            <div class="ccf-se-panel ccf-se-scenes-panel">
              <div class="ccf-se-panel-head">
                <b>📚 分割後のシーン一覧（${scenes.length}件）</b>
                <span class="ccf-muted" style="font-size:.74rem;">タイトル編集・前後のシーンとの結合が可能</span>
              </div>
              <div class="ccf-se-scenes-list" data-se-scenes-host="1">${renderScenesListHtml()}</div>
            </div>
          </div>
        </div>
      </div>`;

      const linesHost = ov.querySelector('[data-se-lines-host]');
      if (linesHost && prevLinesScroll) linesHost.scrollTop = prevLinesScroll;
      const scenesHost = ov.querySelector('[data-se-scenes-host]');
      if (scenesHost && prevScenesScroll) scenesHost.scrollTop = prevScenesScroll;
      const activeRow = scenesHost && scenesHost.querySelector(`[data-se-scn-row="${CSS.escape ? CSS.escape(activeSceneId) : activeSceneId}"]`);
      if (activeRow && activeRow.scrollIntoView) {
        try { activeRow.scrollIntoView({ block: 'nearest' }); } catch (_) { }
      }
    };

    const close = () => {
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
      document.removeEventListener('keydown', onKey, true);
      ov.remove();
      render();
      if (UI.subView === 'board' || UI.modalOpen) refreshBoardContainers();
    };
    const onKey = e => {
      if (e.key === 'Escape' && !document.querySelector('.app-dialog-overlay,.ccf-am-ov')) {
        e.preventDefault();
        close();
      }
    };
    ov._cleanup = close;
    document.addEventListener('keydown', onKey, true);

    renderModal();

    const saveCursorFromEl = el => {
      if (!el || !el.matches || !el.matches('[data-se-textarea]')) return;
      el._lastCursor = el.selectionStart || 0;
      el._lastCursorEnd = el.selectionEnd != null ? el.selectionEnd : el._lastCursor;
    };
    ov.addEventListener('keyup', e => saveCursorFromEl(e.target));
    ov.addEventListener('click', e => saveCursorFromEl(e.target));
    ov.addEventListener('mouseup', e => saveCursorFromEl(e.target));
    ov.addEventListener('select', e => saveCursorFromEl(e.target));

    ov.addEventListener('input', e => {
      const idx = getActiveIdx();
      if (idx < 0) return;
      const sc = S.proj.scenes[idx];

      if (e.target.matches('[data-se-textarea]')) {
        saveCursorFromEl(e.target);
        sc.text = e.target.value;
        invalidateCandidate(sc);
        CCF.saveProject();
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(syncRightListsFromCurrentText, 120);
        return;
      }
      if (e.target.matches('[data-se-title]')) {
        sc.title = e.target.value;
        invalidateCandidate(sc);
        const listTitle = ov.querySelector(`[data-se-scn-title="${idx}"]`);
        if (listTitle) listTitle.value = sc.title;
        CCF.saveProject();
        return;
      }
      const listTitleInp = e.target.closest('[data-se-scn-title]');
      if (listTitleInp) {
        const sIdx = +listTitleInp.dataset.seScnTitle;
        const targetSc = S.proj.scenes[sIdx];
        if (!targetSc) return;
        targetSc.title = listTitleInp.value;
        invalidateCandidate(targetSc);
        if (sIdx === idx) {
          const leftTitle = ov.querySelector('[data-se-title]');
          if (leftTitle) leftTitle.value = targetSc.title;
        }
        CCF.saveProject();
      }
    });

    ov.addEventListener('click', e => {
      if (e.target === ov) return close();
      const idx = getActiveIdx();
      if (idx < 0) return;
      const sc = S.proj.scenes[idx];

      const selBtn = e.target.closest('[data-se-select-scene]');
      if (selBtn) {
        activeSceneId = selBtn.dataset.seSelectScene;
        UI.boardTarget = activeSceneId;
        renderModal();
        return;
      }

      const splitLineBtn = e.target.closest('[data-se-split-line]');
      if (splitLineBtn) {
        const li = +splitLineBtn.dataset.seSplitLine;
        if (!(li >= 1)) return;
        cp('シーン分割');
        S.proj.scenes = SM.splitSceneAtLine(S.proj.scenes, idx, li).map(M.sanitizeScene).filter(Boolean);
        const nextSc = S.proj.scenes[idx + 1] || S.proj.scenes[idx];
        if (nextSc) {
          activeSceneId = nextSc.id;
          UI.boardTarget = nextSc.id;
        }
        candidateCache.clear();
        CCF.saveProject();
        renderModal();
        say('✂️ 新しいシーンに分割しました');
        return;
      }

      const mergePrevBtn = e.target.closest('[data-se-merge-prev]');
      if (mergePrevBtn) {
        const sIdx = +mergePrevBtn.dataset.seMergePrev;
        if (sIdx <= 0 || sIdx >= S.proj.scenes.length) return;
        cp('シーン結合');
        const removedId = S.proj.scenes[sIdx].id;
        const keptId = S.proj.scenes[sIdx - 1].id;
        S.proj.scenes = SM.mergeSceneWithPrev(S.proj.scenes, sIdx).map(M.sanitizeScene).filter(Boolean);
        if (activeSceneId === removedId) activeSceneId = keptId;
        UI.boardTarget = activeSceneId;
        candidateCache.clear();
        CCF.saveProject();
        renderModal();
        say('🗑️ 前のシーンと結合しました');
        return;
      }

      const mergeNextBtn = e.target.closest('[data-se-merge-next]');
      if (mergeNextBtn) {
        const sIdx = +mergeNextBtn.dataset.seMergeNext;
        if (sIdx < 0 || sIdx + 1 >= S.proj.scenes.length) return;
        cp('シーン結合');
        const removedId = S.proj.scenes[sIdx + 1].id;
        const keptId = S.proj.scenes[sIdx].id;
        S.proj.scenes = SM.mergeSceneWithPrev(S.proj.scenes, sIdx + 1).map(M.sanitizeScene).filter(Boolean);
        if (activeSceneId === removedId) activeSceneId = keptId;
        UI.boardTarget = activeSceneId;
        candidateCache.clear();
        CCF.saveProject();
        renderModal();
        say('🗑️ 次のシーンと結合しました');
        return;
      }

      const actBtn = e.target.closest('[data-se-act]');
      if (!actBtn) return;
      const act = actBtn.dataset.seAct;
      if (act === 'close') return close();
      if (act === 'prev-scene' && idx > 0) {
        activeSceneId = S.proj.scenes[idx - 1].id;
        UI.boardTarget = activeSceneId;
        renderModal();
        return;
      }
      if (act === 'next-scene' && idx + 1 < S.proj.scenes.length) {
        activeSceneId = S.proj.scenes[idx + 1].id;
        UI.boardTarget = activeSceneId;
        renderModal();
        return;
      }

      const ta = ov.querySelector('[data-se-textarea]');
      if (act === 'split-cursor') {
        const val = ta ? ta.value : String(sc.text || '');
        const pos = ta ? (ta._lastCursor != null ? ta._lastCursor : (ta.selectionStart || 0)) : 0;
        const head = val.slice(0, pos).trim();
        const tail = val.slice(pos).trim();
        if (!head || !tail) {
          return say('⚠️ 本文内の「分割したい位置」にカーソルを置いてから押してください（前後に文章が必要です）');
        }
        cp('カーソル位置でシーン分割');
        sc.text = head;
        invalidateCandidate(sc);
        const firstTail = (tail.split('\n').find(l => l.trim()) || '').trim();
        const newTitle = (firstTail && Array.from(firstTail).length <= 40)
          ? SM.cleanHeadingTitle(firstTail)
          : ('シーン ' + (idx + 2));
        const nextScene = M.sanitizeScene({
          title: newTitle,
          text: tail,
          page: sc.page || null,
          sourceName: sc.sourceName || '',
          sourcePath: sc.sourcePath || '',
          headingPattern: 'manual',
          checked: !!sc.checked
        });
        S.proj.scenes.splice(idx + 1, 0, nextScene);
        activeSceneId = nextScene.id;
        UI.boardTarget = nextScene.id;
        candidateCache.clear();
        CCF.saveProject();
        renderModal();
        say(`✂️ カーソル位置で新シーン「${nextScene.title}」に分割しました`);
        return;
      }
      if (act === 'insert-delim' && ta) {
        const val = ta.value;
        const start = ta._lastCursor != null ? ta._lastCursor : (ta.selectionStart || val.length);
        const end = ta._lastCursorEnd != null ? ta._lastCursorEnd : (ta.selectionEnd || start);
        const before = val.slice(0, start);
        const after = val.slice(end);
        const prefix = before && !before.endsWith('\n') ? '\n' : '';
        const suffix = after && !after.startsWith('\n') ? '\n' : '';
        const ins = prefix + '---\n' + suffix;
        ta.value = before + ins + after;
        sc.text = ta.value;
        invalidateCandidate(sc);
        const newPos = before.length + ins.length;
        ta._lastCursor = newPos;
        ta._lastCursorEnd = newPos;
        ta.focus();
        try { ta.setSelectionRange(newPos, newPos); } catch (_) { }
        CCF.saveProject();
        syncRightListsFromCurrentText();
        say('➕ カーソル位置に区切り線（---）を挿入しました');
        return;
      }
      if (act === 'split-delim') {
        const beforeLen = S.proj.scenes.length;
        const nextList = SM.splitSceneByDelimiter(S.proj.scenes, idx).map(M.sanitizeScene).filter(Boolean);
        const addedCount = nextList.length - beforeLen;
        if (addedCount <= 0) {
          return say('⚠️ 本文内に「---」のみの区切り行が見つかりませんでした');
        }
        cp('区切り線（---）で一括シーン分割');
        S.proj.scenes = nextList;
        activeSceneId = S.proj.scenes[idx] ? S.proj.scenes[idx].id : activeSceneId;
        UI.boardTarget = activeSceneId;
        candidateCache.clear();
        CCF.saveProject();
        renderModal();
        say(`✂️ 区切り線（---）で ${addedCount + 1}個のシーンに一括分割しました`);
        return;
      }
      if (act === 'clean-breaks') {
        const curVal = ta ? ta.value : String(sc.text || '');
        const next = cleanSceneTextWithHeading(sc, curVal);
        if (next === curVal) return say('整形が必要な改行はありませんでした');
        cp('シーン本文の不自然な改行を除去');
        sc.text = next;
        if (ta) {
          ta.value = next;
          ta._lastCursor = 0;
          ta._lastCursorEnd = 0;
        }
        invalidateCandidate(sc);
        CCF.saveProject();
        syncRightListsFromCurrentText();
        say('🧹 不自然な改行を除去しました');
      }
    });

    document.body.appendChild(ov);
  }

  function batchApplyAssetsToChecked(srcSceneId) {
    ensureProjShape();
    const src = S.proj.scenes.find(s => s.id === srcSceneId);
    if (!src) return say('⚠️ コピー元のシーンを選択してください');
    const targets = S.proj.scenes.filter(s => s.checked && s.id !== srcSceneId);
    if (!targets.length) return say('⚠️ 適用先のシーンにチェックを入れてください');
    const bs = UI.batchSlots || { fg: true, bgm: true, bg: false, marker: false };
    if (!bs.fg && !bs.bgm && !bs.bg && !bs.marker) return say('⚠️ 適用する素材種別（前景/BGM/背景/マーカーパネル）を1つ以上選んでください');
    cp('複数シーンへ素材を一括適用');
    const cloneItem = (it, kind) => it ? M.sanitizeBoardItem(Object.assign({}, it, { id: M.newId() }), kind) : null;
    targets.forEach(t => {
      if (bs.fg) t.fg = cloneItem(src.fg, 'fg');
      if (bs.bgm) t.bgm = src.bgm ? M.sanitizeSceneAudio(src.bgm) : null;
      if (bs.bg) t.bg = cloneItem(src.bg, 'bg');
      if (bs.marker) t.markers = (src.markers || []).map(x => cloneItem(x, 'marker')).filter(Boolean);
    });
    CCF.saveProject();
    if (UI.subView === 'board' || UI.modalOpen) refreshBoardContainers();
    if (UI.subView === 'scenes') render();
    say(`📋 ${targets.length}件のシーンへ選択した素材を一括適用しました`);
  }

  async function batchApplySingleSlot(srcSceneId, slot) {
    ensureProjShape();
    const src = S.proj.scenes.find(s => s.id === srcSceneId);
    if (!src) return say('⚠️ コピー元のシーンを選択してください');
    const slotLabels = { fg: '前景', bgm: 'BGM', bg: '背景', marker: 'マーカーパネル' };
    const label = slotLabels[slot];
    if (!label) return;
    const hasVal = slot === 'fg' ? !!src.fg
      : slot === 'bgm' ? !!src.bgm
      : slot === 'bg' ? !!src.bg
      : (Array.isArray(src.markers) && src.markers.length > 0);
    if (!hasVal) return say(`⚠️ コピー元に${label}が設定されていません`);

    const checkedAll = S.proj.scenes.filter(s => s.checked);
    const checkedTargets = checkedAll.filter(s => s.id !== srcSceneId);
    let targets = checkedTargets;
    let isAllConfirm = false;
    if (!targets.length) {
      if (checkedAll.length > 0) {
        return say('⚠️ 適用先の他のシーンにチェックを入れてください');
      }
      const allOthers = S.proj.scenes.filter(s => s.id !== srcSceneId);
      if (!allOthers.length) return say('⚠️ 適用先の他のシーンがありません');
      const ok = typeof appConfirm === 'function'
        ? await appConfirm(`チェックされたシーンがありません。他の全シーン（${allOthers.length}件）へ「${label}」のみを一括適用しますか？`, { okText: '一括適用' })
        : confirm(`チェックされたシーンがありません。他の全シーン（${allOthers.length}件）へ「${label}」のみを一括適用しますか？`);
      if (!ok) return;
      targets = allOthers;
      isAllConfirm = true;
    }

    cp(`他シーンへ${label}のみ一括適用`);
    const cloneItem = (it, kind) => it ? M.sanitizeBoardItem(Object.assign({}, it, { id: M.newId() }), kind) : null;
    targets.forEach(t => {
      if (slot === 'fg') t.fg = cloneItem(src.fg, 'fg');
      else if (slot === 'bgm') t.bgm = src.bgm ? M.sanitizeSceneAudio(src.bgm) : null;
      else if (slot === 'bg') t.bg = cloneItem(src.bg, 'bg');
      else if (slot === 'marker') t.markers = (src.markers || []).map(x => cloneItem(x, 'marker')).filter(Boolean);
    });
    CCF.saveProject();
    if (UI.subView === 'board' || UI.modalOpen) refreshBoardContainers();
    if (UI.subView === 'scenes') render();
    say(`📋 ${isAllConfirm ? '他の全' : 'チェック済み'}シーン（${targets.length}件）へ「${label}」のみを一括適用しました`);
  }

  function unifyBgmVolumeFromScene(sc) {
    if (!sc || !sc.bgm) return;
    ensureProjShape();
    const vol = Math.min(100, Math.max(0, Math.round(Number(sc.bgm.volume != null ? sc.bgm.volume : UI.defaultBgmVolume))));
    UI.defaultBgmVolume = vol;
    const checkedScenes = S.proj.scenes.filter(s => s.checked);
    const useChecked = checkedScenes.length > 0;
    const targets = (useChecked ? checkedScenes : S.proj.scenes).filter(s => s && s.bgm);
    if (!targets.length) return say('⚠️ 対象のシーンにBGMが設定されていません');
    cp('BGM音量を一括統一');
    targets.forEach(t => { t.bgm.volume = vol; });
    if (UI.audio && UI.audioKey) {
      const playingTarget = targets.find(t => t.bgm && t.bgm.path === UI.audioKey);
      if (playingTarget) UI.audio.volume = vol / 100;
    }
    CCF.saveProject();
    if (UI.subView === 'board' || UI.modalOpen) refreshBoardContainers();
    if (UI.subView === 'scenes') render();
    say(`🔊 ${useChecked ? 'チェック済み' : '全'}シーンのBGM（${targets.length}件）の音量を ${vol}% に統一しました`);
  }

  function applyBgmVolumeLive(sc, rawVol, sourceEl) {
    if (!sc || !sc.bgm) return;
    const vol = Math.min(100, Math.max(0, Math.round(Number(rawVol) || 0)));
    sc.bgm.volume = vol;
    UI.defaultBgmVolume = vol;
    const ctrl = sourceEl ? sourceEl.closest('[data-bgm-ctrl]') : null;
    if (ctrl) {
      const r = ctrl.querySelector('[data-bgm-vol-range]');
      const n = ctrl.querySelector('[data-bgm-vol-num]');
      if (r && r !== sourceEl) r.value = String(vol);
      if (n && n !== sourceEl) n.value = String(vol);
      const ubtn = ctrl.querySelector('[data-bgm-apply-all]');
      if (ubtn) ubtn.textContent = `🔊 音量を統一 (${vol}%)`;
    }
    document.querySelectorAll(`[data-bp="unify-bgm-vol"][data-scn-id="${sc.id}"]`).forEach(btn => {
      const checkedCount = S.proj.scenes.filter(s => s.checked).length;
      btn.textContent = `🔊 ${checkedCount ? `チェック済み(${checkedCount}件)` : '全シーン'}の音量を ${vol}% に統一`;
    });
    if (UI.audio && (UI.audioSceneId === sc.id || (sc.bgm.path && UI.audioKey === sc.bgm.path))) {
      UI.audio.volume = vol / 100;
    }
    CCF.saveProject();
  }

  function renderSlotRowHtml(sc, idx, slot, label, assigned, candidates, extracted, opts) {
    const o = opts || {};
    const compact = !!o.compact;
    const assignedSrc = assigned ? (assigned.dataUrl || fileUrl(assigned.path)) : '';
    const isPlayingCur = !!(assigned && assigned.path && UI.audioKey === assigned.path && (!UI.audioSceneId || UI.audioSceneId === sc.id));
    const showTagBtn = !!(sc.manualSlots && sc.manualSlots[slot] && assigned && assigned.assetUid);
    const suggestTags = showTagBtn ? suggestTagsForScene(sc, extracted) : [];
    const slotShort = slot === 'fg' ? '前景' : slot === 'bgm' ? 'BGM' : slot === 'bg' ? '背景' : 'マーカー';

    const assignedHtml = assigned
      ? `<div class="ccf-slot-cur">
          ${slot !== 'bgm' && assignedSrc ? `<img class="ccf-slot-thumb" src="${esc(assignedSrc)}" alt="">` : (slot === 'bgm' ? `<button type="button" class="ccf-mini" data-scn-play="${esc(assigned.path)}" data-scn-play-idx="${idx}" title="試聴">${isPlayingCur ? '■' : '▶'}</button>` : '')}
          <span class="ccf-slot-name" title="${esc(assigned.path || assigned.name)}">${esc(assigned.name)}</span>
          <button type="button" class="ccf-mini danger" data-scn-clear="${slot}" data-i="${idx}" title="割り当て解除">✕</button>
        </div>`
      : '<span class="ccf-muted">未設定</span>';

    const bgmVol = slot === 'bgm' && assigned
      ? Math.min(100, Math.max(0, Math.round(Number(assigned.volume != null ? assigned.volume : UI.defaultBgmVolume))))
      : UI.defaultBgmVolume;
    const bgmLoop = slot === 'bgm' && assigned ? assigned.loop !== false : true;
    const bgmCtrlHtml = slot === 'bgm'
      ? (assigned
        ? `<div class="ccf-bgm-ctrl" data-bgm-ctrl="${idx}" data-bgm-scnid="${esc(sc.id)}">
            <label class="ccf-bgm-vol-lbl ccf-inline-field"><span class="ccf-inline-lbl">🔊 音量:</span>
              <input type="range" class="ccf-bgm-range" min="0" max="100" value="${bgmVol}" data-bgm-vol-range="${idx}" data-bgm-scnid="${esc(sc.id)}">
              <input type="number" class="ccf-bgm-num" min="0" max="100" value="${bgmVol}" data-bgm-vol-num="${idx}" data-bgm-scnid="${esc(sc.id)}">%
            </label>
            <label class="ccf-chk ccf-bgm-loop-lbl">
              <input type="checkbox" data-bgm-loop="${idx}" data-bgm-scnid="${esc(sc.id)}"${bgmLoop ? ' checked' : ''}> 🔁 ループ
            </label>
            <button type="button" class="ccf-mini" data-bgm-apply-all="${idx}" data-bgm-scnid="${esc(sc.id)}" title="チェック済みシーン（未選択時は全シーン）のBGM音量をこの音量に統一">🔊 音量を統一 (${bgmVol}%)</button>
          </div>`
        : `<span class="ccf-muted ccf-inline-lbl" style="font-size:.72rem;">（初期音量: 🔊${UI.defaultBgmVolume}% / 🔁ループ）</span>`)
      : '';

    const candHtml = (candidates || []).slice(0, compact ? 2 : 3).map(c => {
      const it = c.item, src = assetSrc(it);
      const isPlayingCand = !!(it.path && UI.audioKey === it.path && (!UI.audioSceneId || UI.audioSceneId === sc.id));
      const playBtn = slot === 'bgm' && it.path
        ? `<button type="button" class="ccf-mini${isPlayingCand ? ' is-playing' : ''}" data-scn-play="${esc(it.path)}" data-scn-play-idx="${idx}" title="BGM試聴">${isPlayingCand ? '■' : '▶'}</button>`
        : '';
      return `<div class="ccf-cand-card" data-scn-pickcand="${slot}" data-i="${idx}" data-uid="${esc(it.uid)}" title="一致: ${esc(c.matchedKeywords.join(', '))} / ${esc(c.tierLabel)}">
        ${slot !== 'bgm' && src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : `<span class="ccf-cand-ico">${slot === 'bgm' ? '🎵' : '🖼️'}</span>`}
        <div class="ccf-cand-meta">
          <div class="ccf-cand-nm">${esc(it.name)}</div>
          <div class="ccf-cand-sub"><span class="ccf-cand-tier t${c.tier}">${esc(c.tierLabel)}</span> <small>${esc(c.matchedKeywords.slice(0, 2).join(','))}</small></div>
        </div>
        ${playBtn}
      </div>`;
    }).join('');

    return `<div class="ccf-slot-row">
      <div class="ccf-slot-head">
        <b>${label}</b>
        ${assignedHtml}
        <button type="button" class="ccf-mini" data-scn-browse="${slot}" data-i="${idx}">📁 選択</button>
        <button type="button" class="ccf-mini" data-scn-apply-one="${slot}" data-scn-id="${esc(sc.id)}"${assigned ? '' : ' disabled'} title="チェック済みシーン（未チェック時は全シーン確認）へこの${slotShort}だけ一括適用">📋 他シーンへこの${slotShort}だけ適用</button>
        ${showTagBtn && suggestTags.length ? `<button type="button" class="ccf-mini ccf-tag-helper" data-scn-addtag="${slot}" data-i="${idx}" data-tags="${esc(suggestTags.join(','))}" title="手動選択した素材に現在のシーンタグを記憶させます">🏷️「${esc(suggestTags[0])}」タグ追加</button>` : ''}
      </div>
      ${bgmCtrlHtml}
      ${candHtml ? `<div class="ccf-cand-strip"><span class="ccf-cand-badge">✨これかも？</span>${candHtml}</div>` : ''}
    </div>`;
  }

  async function recalcAllCandidates() {
    ensureProjShape();
    if (!S.proj.scenes.length) return say('先にシーンを検出または追加してください');
    const sources = getMatchSources();
    const list = S.proj.scenes;
    for (let i = 0; i < list.length; i++) {
      computeCandidatesForScene(list[i], sources);
      if ((i + 1) % 30 === 0) await new Promise(r => setTimeout(r, 0));
    }
    render();
    say(`✨ ${list.length}件のシーンの素材候補を再計算しました`);
  }

  async function autoAssignTopCandidates() {
    ensureProjShape();
    if (!S.proj.scenes.length) return say('先にシーンを検出または追加してください');
    const bs = UI.batchSlots || { fg: true, bgm: true, bg: false, marker: false };
    if (!bs.fg && !bs.bgm && !bs.bg && !bs.marker) return say('⚠️ 一括仮配置の対象種別（前景/BGM/背景/マーカーパネル）を1つ以上チェックしてください');
    const sources = getMatchSources();
    let count = 0;
    const plan = [];
    for (let i = 0; i < S.proj.scenes.length; i++) {
      const sc = S.proj.scenes[i];
      const m = computeCandidatesForScene(sc, sources);
      const upd = {};
      if (bs.fg && !sc.fg && m.fg && m.fg.length) { upd.fg = m.fg[0].item; count++; }
      if (bs.bgm && !sc.bgm && m.bgm && m.bgm.length) { upd.bgm = m.bgm[0].item; count++; }
      if (bs.bg && !sc.bg && m.bg && m.bg.length) { upd.bg = m.bg[0].item; count++; }
      if (bs.marker && (!sc.markers || !sc.markers.length) && m.marker && m.marker.length) { upd.marker = m.marker[0].item; count++; }
      plan.push({ sc, upd });
      if ((i + 1) % 30 === 0) await new Promise(r => setTimeout(r, 0));
    }
    if (!count) { render(); return say('未設定の枠に一致する素材候補が見つかりませんでした（登録素材やマイライブラリを確認してください）'); }
    cp('✨これかも？一括仮配置');
    plan.forEach(({ sc, upd }) => {
      if (upd.fg) assignSlotAsset(sc, 'fg', upd.fg, false);
      if (upd.bgm) assignSlotAsset(sc, 'bgm', upd.bgm, false);
      if (upd.bg) assignSlotAsset(sc, 'bg', upd.bg, false);
      if (upd.marker) assignSlotAsset(sc, 'marker', upd.marker, false);
    });
    CCF.saveProject();
    render();
    say(`🪄 未設定シーンに候補1位を ${count}件 仮配置しました（Ctrl+Zで元に戻せます）`);
  }

  function suggestTagsForScene(scene, extracted) {
    const raw = (extracted && extracted.keywords && extracted.keywords.length)
      ? extracted.keywords.slice(0, 3)
      : [SM.cleanHeadingTitle(scene.title)].filter(x => x && x.length <= 20);
    return M.cleanTagList(raw);
  }

  // ======================================================================
  // 3. 軽量 WYSIWYG 盤面プレビュー画面（ドラッグ・リサイズ🔒・表示👁️・同期・Undo/Redo）
  // ======================================================================
  function getBoardTargetScene(targetId) {
    ensureProjShape();
    if (!targetId || targetId === 'global') return null;
    return S.proj.scenes.find(s => s.id === targetId) || null;
  }

  /** ココフォリア仕様の重なり優先度：パネル0〜100 < キャラ駒(100.5) < パネル101以上 */
  function effectiveLayerPriority(it) {
    if (!it) return 0;
    if (it.kind === 'piece') {
      const sub = Math.max(-0.4, Math.min(0.4, (Number(it.zIndex) || 0) * 0.001));
      return 100.5 + sub;
    }
    return Number(it.zIndex) || 0;
  }

  function cssZIndexOf(it, pieceRank) {
    if (!it) return 10;
    if (it.kind === 'piece') {
      return 200500 + Math.min(499, Math.max(0, pieceRank || 0));
    }
    const z = Math.round(Number(it.zIndex) || 0);
    return Math.max(10, 100000 + z * 1000);
  }

  /** 盤面プレビューに表示する可動パネル・駒レイヤーを集める（背景・前景はステージ/盤面ベースのため含めない） */
  function collectBoardLayers(targetId) {
    ensureProjShape();
    const g = S.proj.globalDecor;
    const sc = getBoardTargetScene(targetId);
    const layers = [];
    const push = (item, origin, arrName, idx) => {
      if (!item) return;
      layers.push({ item, origin, arrName, idx });
    };
    (g.screens || []).forEach((it, i) => push(it, 'global', 'screens', i));
    if (sc) (sc.markers || []).forEach((it, i) => push(it, 'scene', 'markers', i));
    if (sc && Array.isArray(sc.screens) && sc.screens.length) sc.screens.forEach((it, i) => push(it, 'scene', 'screens', i));
    if (!sc && Array.isArray(g.markers) && g.markers.length) g.markers.forEach((it, i) => push(it, 'global', 'markers', i));
    (S.proj.board.pieces || []).forEach((it, i) => push(it, 'board', 'pieces', i));
    layers.sort((a, b) => effectiveLayerPriority(a.item) - effectiveLayerPriority(b.item));
    return layers;
  }

  function findLayerById(targetId, itemId) {
    return collectBoardLayers(targetId).find(l => l.item.id === itemId) || null;
  }

  function syncSelectionToLayers(layers) {
    const valid = new Set(layers.map(l => l.item.id));
    if (!(UI.selectedIds instanceof Set)) UI.selectedIds = new Set();
    for (const id of [...UI.selectedIds]) {
      if (!valid.has(id)) UI.selectedIds.delete(id);
    }
    if (UI.selectedItemId && !valid.has(UI.selectedItemId)) UI.selectedItemId = '';
    if (!UI.selectedItemId && UI.selectedIds.size) {
      UI.selectedItemId = [...UI.selectedIds][UI.selectedIds.size - 1];
    }
    if (UI.selectedItemId && !UI.selectedIds.has(UI.selectedItemId)) {
      UI.selectedIds.add(UI.selectedItemId);
    }
    return layers.filter(l => UI.selectedIds.has(l.item.id));
  }

  function setSingleSelection(id) {
    UI.selectedIds = id ? new Set([id]) : new Set();
    UI.selectedItemId = id || '';
  }

  function setSelectionIds(ids, primaryId) {
    UI.selectedIds = new Set((ids || []).filter(Boolean));
    UI.selectedItemId = primaryId && UI.selectedIds.has(primaryId)
      ? primaryId
      : ([...UI.selectedIds][UI.selectedIds.size - 1] || '');
  }

  function closeActiveMenu() {
    if (UI._activeMenuCleanup) {
      try { UI._activeMenuCleanup(); } catch (_) { }
      UI._activeMenuCleanup = null;
    }
    if (UI._activeMenuEl) {
      try { UI._activeMenuEl.remove(); } catch (_) { }
      UI._activeMenuEl = null;
    }
  }

  function removeLayersByIds(targetId, idList) {
    const wanted = new Set((idList || []).filter(Boolean));
    if (!wanted.size) return 0;
    const hits = collectBoardLayers(targetId).filter(l => wanted.has(l.item.id));
    if (!hits.length) return 0;
    cp(hits.length > 1 ? '選択要素を一括削除' : '盤面要素の削除');
    hits.sort((a, b) => b.idx - a.idx).forEach(hit => {
      const host = hit.origin === 'global' ? S.proj.globalDecor : hit.origin === 'board' ? S.proj.board : getBoardTargetScene(targetId);
      if (!host) return;
      if (hit.arrName === 'bg' || hit.arrName === 'fg') host[hit.arrName] = null;
      else if (Array.isArray(host[hit.arrName])) host[hit.arrName].splice(hit.idx, 1);
    });
    for (const id of wanted) UI.selectedIds.delete(id);
    if (wanted.has(UI.selectedItemId)) {
      UI.selectedItemId = [...UI.selectedIds][UI.selectedIds.size - 1] || '';
    }
    CCF.saveProject();
    return hits.length;
  }

  function removeLayerById(targetId, itemId) {
    return removeLayersByIds(targetId, [itemId]) > 0;
  }

  function syncItemToCheckedScenes(item) {
    ensureProjShape();
    const targets = S.proj.scenes.filter(s => s.checked);
    if (!targets.length) return say('⚠️ 「🎬 シーン構築」タブで同期先のシーンにチェックを入れてください');
    cp('マーカーパネル一括同期配置');
    const syncId = item.syncId || ('sync_' + item.id);
    item.syncId = syncId;
    const arrKey = item.kind === 'marker' ? 'markers' : 'screens';
    targets.forEach(sc => {
      if (!Array.isArray(sc[arrKey])) sc[arrKey] = [];
      const exIdx = sc[arrKey].findIndex(x => x.syncId === syncId || x.id === item.id);
      const cloned = M.sanitizeBoardItem(Object.assign({}, item, {
        id: exIdx >= 0 ? sc[arrKey][exIdx].id : M.newId(),
        syncId
      }), item.kind);
      if (exIdx >= 0) sc[arrKey][exIdx] = cloned;
      else sc[arrKey].push(cloned);
    });
    CCF.saveProject();
    refreshBoardContainers();
    say(`📌 ${targets.length}件のシーンへ同じ座標・サイズで一括同期配置しました`);
  }

  function buildNpcPieceItem(npc, idx, opts) {
    const head = (npc.images && npc.images[0]) || {};
    const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
    const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
    const existingCount = (S.proj.board.pieces || []).length;
    let x, y;
    if (opts && opts.center) {
      const off = (existingCount % 6) * 24;
      x = Math.max(0, Math.round((bw - 96) / 2) + off - 48);
      y = Math.max(0, Math.round((bh - 96) / 2) + off - 48);
    } else {
      const col = idx % 6, row = Math.floor(idx / 6);
      x = 120 + col * 140;
      y = Math.min(Math.max(40, bh - 140), 420) + row * 120;
    }
    return M.sanitizeBoardItem({
      id: M.newId(),
      kind: 'piece',
      npcId: npc.id,
      name: npc.name || 'NPC',
      path: head.filePath || head.path || npc.imagePath || '',
      dataUrl: head.dataUrl || npc.iconDataUrl || '',
      x,
      y,
      width: 96,
      height: 96,
      zIndex: existingCount,
      visible: true,
      lockAspect: true,
      invisible: false
    }, 'piece');
  }

  function syncNpcsToBoard() {
    ensureProjShape();
    if (!S.proj.npcs.length) return say('先に「👤 NPC管理」でNPCを登録してください');
    cp('NPC駒を初期盤面へ配置');
    const existing = new Set((S.proj.board.pieces || []).map(p => p.npcId).filter(Boolean));
    let added = 0;
    S.proj.npcs.forEach((npc, idx) => {
      if (existing.has(npc.id)) return;
      S.proj.board.pieces.push(buildNpcPieceItem(npc, idx, { center: false }));
      added++;
    });
    if (!added) return say('すべてのNPC駒がすでに盤面に配置されています');
    CCF.saveProject();
    refreshBoardContainers();
    say(`♟️ ${added}体のNPC駒を初期盤面へ配置しました`);
  }

  function placeSingleNpcOnBoard(npc) {
    if (!npc) return;
    ensureProjShape();
    cp('NPC駒を個別配置');
    const piece = buildNpcPieceItem(npc, (S.proj.board.pieces || []).length, { center: true });
    S.proj.board.pieces.push(piece);
    setSingleSelection(piece.id);
    CCF.saveProject();
    refreshBoardContainers();
    say(`♟️「${piece.name}」を盤面に配置しました`);
  }

  function buildDummyBoardPieceItem(dummy) {
    const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
    const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
    const existingCount = (S.proj.board.pieces || []).length;
    const off = (existingCount % 6) * 24;
    const x = Math.max(0, Math.round((bw - 96) / 2) + off - 48);
    const y = Math.max(0, Math.round((bh - 96) / 2) + off - 48);
    return M.sanitizeBoardItem({
      id: M.newId(),
      kind: 'piece',
      name: (dummy && dummy.name) || 'ダミー駒',
      color: (dummy && dummy.color) || '#888888',
      text: (dummy && dummy.memo) || '',
      x,
      y,
      width: 96,
      height: 96,
      zIndex: existingCount,
      visible: true,
      lockAspect: true,
      invisible: !!(dummy && dummy.invisible)
    }, 'piece');
  }

  function placeSingleDummyPieceOnBoard(dummy) {
    if (!dummy) return;
    ensureProjShape();
    cp('ダミー駒を盤面に配置');
    const piece = buildDummyBoardPieceItem(dummy);
    S.proj.board.pieces.push(piece);
    setSingleSelection(piece.id);
    CCF.saveProject();
    refreshBoardContainers();
    say(`♟️「${piece.name}」を盤面に配置しました`);
  }

  function addPanelViaPicker(kind, targetId) {
    if (!CCF.assets || !CCF.assets.pickAsset) return;
    const sc = getBoardTargetScene(targetId);
    if (kind === 'marker' && !sc) {
      return say('📌 マーカーパネルは各シーンに属します。右の「シーン切り替え一覧」からシーンを選択して追加してください');
    }
    const label = kind === 'bg' ? '背景画像' : kind === 'fg' ? '前景画像（盤面）' : kind === 'marker' ? 'マーカーパネル画像' : 'スクリーンパネル画像';
    CCF.assets.pickAsset({ key: S.key, types: ['image'], title: label + 'を選択' }).then(async asset => {
      if (!asset) return;
      if (kind === 'bg' || kind === 'fg') {
        const host = sc || S.proj.globalDecor;
        cp(kind === 'bg' ? '背景画像を設定' : '前景画像を設定');
        host[kind] = buildBoardItemFromAsset(asset, kind, host[kind]);
        CCF.saveProject();
        refreshBoardContainers();
        return;
      }
      const host = kind === 'screen' ? S.proj.globalDecor : sc;
      const arrName = kind === 'marker' ? 'markers' : 'screens';
      const dim = await measureImageSize(assetSrc(asset));
      const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
      const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
      const sz = panelInitialSize(dim && dim.width, dim && dim.height, kind, bw, bh);
      const layers = collectBoardLayers(targetId);
      const maxNormalZ = layers.filter(l => l.item.kind !== 'piece' && (l.item.zIndex || 0) < 101).reduce((m, l) => Math.max(m, l.item.zIndex || 0), -1);
      const nextZ = maxNormalZ < 0 ? 0 : Math.min(100, maxNormalZ + 1);
      const n = (host[arrName] || []).length;
      const x = Math.max(0, Math.round((bw - sz.width) / 2) + ((n % 5) - 2) * 24);
      const y = Math.max(0, Math.round((bh - sz.height) / 2) + ((n % 4) - 1) * 24);
      cp(kind === 'marker' ? 'マーカーパネル追加' : 'スクリーンパネル追加');
      const item = buildBoardItemFromAsset(asset, kind, { x, y, width: sz.width, height: sz.height, zIndex: nextZ, lockAspect: true });
      host[arrName] = host[arrName] || [];
      host[arrName].push(item);
      setSingleSelection(item.id);
      CCF.saveProject();
      refreshBoardContainers();
    });
  }

  function addBlankMarker(targetId) {
    ensureProjShape();
    const sc = getBoardTargetScene(targetId);
    if (!sc) {
      return say('📌 マーカーパネルは各シーンに属します。右の「シーン切り替え一覧」からシーンを選択して追加してください');
    }
    cp('マーカーパネル追加');
    const layers = collectBoardLayers(targetId);
    const maxNormalZ = layers.filter(l => l.item.kind !== 'piece' && (l.item.zIndex || 0) < 101).reduce((m, l) => Math.max(m, l.item.zIndex || 0), -1);
    const nextZ = maxNormalZ < 0 ? 0 : Math.min(100, maxNormalZ + 1);
    const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
    const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
    const n = (sc.markers || []).length;
    const item = M.sanitizeBoardItem({
      id: M.newId(),
      syncId: 'sync_' + M.newId(),
      kind: 'marker',
      name: 'マーカーパネル ' + (n + 1),
      color: 'rgba(88, 101, 242, 0.40)',
      text: '',
      x: Math.max(0, Math.round((bw - 180) / 2) + ((n % 5) - 2) * 24),
      y: Math.max(0, Math.round((bh - 180) / 2) + ((n % 4) - 1) * 24),
      width: 180,
      height: 180,
      zIndex: nextZ,
      visible: true,
      locked: false,
      lockAspect: false
    }, 'marker');
    sc.markers = sc.markers || [];
    sc.markers.push(item);
    setSingleSelection(item.id);
    CCF.saveProject();
    refreshBoardContainers();
  }

  async function fitBoardToForeground(targetId) {
    ensureProjShape();
    const g = S.proj.globalDecor;
    const sc = getBoardTargetScene(targetId);
    const activeFg = (sc && sc.fg) ? sc.fg : g.fg;
    if (!activeFg) return say('⚠️ 先に前景画像を設定してください');
    const dim = await measureImageSize(assetSrc(activeFg));
    if (!dim) return say('⚠️ 前景画像のサイズを読み取れませんでした');
    const grid = Number(S.proj.board.grid) || 24;
    const maxCells = Math.floor(4000 / grid);
    const scale = Math.min(1, 3840 / Math.max(dim.width, dim.height));
    const cols = Math.max(4, Math.min(maxCells, Math.round((dim.width * scale) / grid)));
    const rows = Math.max(4, Math.min(maxCells, Math.round((dim.height * scale) / grid)));
    cp('前景画像に盤面サイズを合わせる');
    S.proj.board.width = cols * grid;
    S.proj.board.height = rows * grid;
    S.proj.board.customSize = true;
    CCF.saveProject();
    UI.cameraFitted = false;
    refreshBoardContainers();
    say(`📐 盤面サイズを ${cols} × ${rows} マス（${S.proj.board.width}×${S.proj.board.height}px）に合わせました`);
  }

  async function loadImageForOffscreenCanvas(item) {
    const src = assetSrc(item);
    if (!src) return null;
    let urlToLoad = src;
    let revokeUrl = '';
    if (!/^data:/i.test(src) && CCF.ccfExport && CCF.ccfExport.readRef) {
      try {
        const ref = await CCF.ccfExport.readRef(item.path || src);
        if (ref && ref.buf && ref.buf.length) {
          const mime = ref.mime || 'image/png';
          const blob = new Blob([ref.buf], { type: mime });
          urlToLoad = URL.createObjectURL(blob);
          revokeUrl = urlToLoad;
        }
      } catch (_) { /* fallback to src */ }
    }
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => { if (revokeUrl) URL.revokeObjectURL(revokeUrl); resolve(img); };
      img.onerror = () => { if (revokeUrl) URL.revokeObjectURL(revokeUrl); resolve(null); };
      img.src = urlToLoad;
    });
  }

  async function combineSelectedPanels(targetId) {
    const layers = collectBoardLayers(targetId);
    const selPanels = layers.filter(l => UI.selectedIds.has(l.item.id) && (l.item.kind === 'screen' || l.item.kind === 'marker'));
    if (selPanels.length < 2) return say('⚠️ 結合するには2枚以上のパネル（スクリーン／マーカー）を選択してください');

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selPanels.forEach(l => {
      minX = Math.min(minX, l.item.x);
      minY = Math.min(minY, l.item.y);
      maxX = Math.max(maxX, l.item.x + l.item.width);
      maxY = Math.max(maxY, l.item.y + l.item.height);
    });
    const outW = Math.max(16, Math.round(maxX - minX));
    const outH = Math.max(16, Math.round(maxY - minY));
    const renderScale = Math.min(1, 2400 / Math.max(outW, outH));
    const cw = Math.max(1, Math.round(outW * renderScale));
    const ch = Math.max(1, Math.round(outH * renderScale));

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return say('⚠️ Canvasコンテキストの初期化に失敗しました');
    ctx.clearRect(0, 0, cw, ch);

    const loadedImgs = await Promise.all(selPanels.map(l => loadImageForOffscreenCanvas(l.item)));
    selPanels.forEach((l, i) => {
      const it = l.item;
      const dx = (it.x - minX) * renderScale;
      const dy = (it.y - minY) * renderScale;
      const dw = it.width * renderScale;
      const dh = it.height * renderScale;
      const img = loadedImgs[i];
      ctx.save();
      if (it.angle) {
        ctx.translate(dx + dw / 2, dy + dh / 2);
        ctx.rotate((it.angle * Math.PI) / 180);
        ctx.translate(-(dx + dw / 2), -(dy + dh / 2));
      }
      if (img) {
        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = it.color || 'rgba(88, 101, 242, 0.35)';
        ctx.fillRect(dx, dy, dw, dh);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = Math.max(1, renderScale);
        ctx.strokeRect(dx, dy, dw, dh);
      }
      const txt = String(it.text || '').trim();
      if (txt) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.max(11, Math.round(14 * renderScale))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, dx + dw / 2, dy + dh / 2, Math.max(12, dw - 8));
      }
      ctx.restore();
    });

    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (err) {
      return say('⚠️ 画像の結合に失敗しました（出力制限）');
    }
    if (!dataUrl) return;

    const sc = getBoardTargetScene(targetId);
    const hasMarker = selPanels.some(l => l.item.kind === 'marker');
    const targetKind = (hasMarker && sc) ? 'marker' : 'screen';
    const targetHost = targetKind === 'marker' ? sc : S.proj.globalDecor;
    const targetArr = targetKind === 'marker' ? 'markers' : 'screens';
    const maxZ = selPanels.reduce((m, l) => Math.max(m, l.item.zIndex || 0), 0);

    cp('選択したパネルを1枚に結合');
    const removeSet = new Set(selPanels.map(l => l.item.id));
    selPanels.slice().sort((a, b) => b.idx - a.idx).forEach(hit => {
      const host = hit.origin === 'global' ? S.proj.globalDecor : sc;
      if (host && Array.isArray(host[hit.arrName])) host[hit.arrName].splice(hit.idx, 1);
    });

    const combined = M.sanitizeBoardItem({
      id: M.newId(),
      kind: targetKind,
      name: (selPanels[0].item.name || 'パネル') + ' (結合)',
      dataUrl,
      path: '',
      assetUid: '',
      x: Math.round(minX),
      y: Math.round(minY),
      width: outW,
      height: outH,
      zIndex: maxZ,
      visible: true,
      lockAspect: true
    }, targetKind);
    targetHost[targetArr] = targetHost[targetArr] || [];
    targetHost[targetArr].push(combined);
    for (const rid of removeSet) UI.selectedIds.delete(rid);
    setSingleSelection(combined.id);
    CCF.saveProject();
    refreshBoardContainers();
    say(`🧩 ${selPanels.length}枚のパネルを1枚の透過PNGに結合しました（Ctrl+Zで元に戻せます）`);
  }

  function renderFgControlsHtml(b, activeFg, isSceneFallback) {
    const grid = Number(b.grid) || 24;
    const cols = Math.max(4, Math.round((b.width || 960) / grid));
    const rows = Math.max(4, Math.round((b.height || 720) / grid));
    const fgFit = (activeFg && activeFg.fitMode === 'fill') ? 'fill' : 'cover';
    return `<div class="ccf-bp-fg-ctrls">
      <div class="ccf-bp-fg-row">
        <span class="ccf-inline-lbl">盤面サイズ：横</span>
        <input type="number" min="4" max="166" class="ccf-bp-cell-inp" data-bp-board-dim="cols" value="${cols}" aria-label="盤面横マス数">
        <span class="ccf-inline-lbl">× 縦</span>
        <input type="number" min="4" max="166" class="ccf-bp-cell-inp" data-bp-board-dim="rows" value="${rows}" aria-label="盤面縦マス数">
        <span class="ccf-inline-lbl">マス <small class="ccf-muted">(${b.width}×${b.height}px)</small></span>
        <button type="button" class="ccf-mini" data-bp="reset-board-40x30" title="盤面サイズを標準の40×30マス（960×720px）に戻します">↺ 40×30(標準)</button>
      </div>
      <div class="ccf-bp-fg-row ccf-fg-opts">
        <button type="button" class="ccf-mini" data-bp="fit-board-to-fg"${activeFg ? '' : ' disabled'} title="前景画像のピクセルサイズ・縦横比に合わせて盤面マス数（1マス=${grid}px）を変更します">📐 前景画像のサイズ・比率に盤面を合わせる</button>
        <label class="ccf-bp-fg-fit ccf-inline-field"><span class="ccf-inline-lbl">表示方式:</span>
          <select data-bp-fg-fit="1"${activeFg ? '' : ' disabled'}>
            <option value="cover"${fgFit === 'cover' ? ' selected' : ''}>切り抜き(cover)</option>
            <option value="fill"${fgFit === 'fill' ? ' selected' : ''}>引き伸ばし(fill)</option>
          </select>
        </label>
        ${isSceneFallback ? '<span class="ccf-muted ccf-inline-lbl" style="font-size:.68rem;">※共通前景を表示中</span>' : ''}
      </div>
    </div>`;
  }

  function renderBoardQuickActionsHtml(sc) {
    return `<div class="ccf-bp-quick-grid">
      <button type="button" class="ccf-btn" data-bp="add-screen" title="全シーン共通の部屋常駐スクリーンパネルを追加">＋ 🖼️ スクリーンパネル（部屋常駐）</button>
      <button type="button" class="ccf-btn" data-bp="add-marker" title="${sc ? '選択中シーン固有のマーカーパネルを追加' : '先に上のシーン一覧からシーンを選択してください'}">＋ 📌 マーカーパネル（シーン別）</button>
      <button type="button" class="ccf-btn" data-bp="pick-npc-menu" title="登録NPC・ダミー駒から1体選んで盤面へ追加">♟️ 駒を個別配置 ▾</button>
      <button type="button" class="ccf-btn primary" data-bp="sync-npcs" title="登録済みNPCをまとめて初期盤面へ配置">♟️ 登録NPCを一括配置</button>
    </div>`;
  }

  function renderPanelListRowHtml(it, idx, isMarker) {
    const src = assetSrc(it);
    const isSel = UI.selectedIds && UI.selectedIds.has(it.id);
    const defName = (isMarker ? 'マーカーパネル ' : 'スクリーンパネル ') + (idx + 1);
    const dispName = it.name || defName;
    const panelTxt = isMarker ? String(it.text || '').trim() : '';
    const isVis = it.visible !== false;
    const isLocked = !!it.locked;
    return `<div class="ccf-bp-mk-row${isSel ? ' sel' : ''}" data-bp-midsel="${esc(it.id)}" title="クリックで盤面上の該当パネルを選択／ダブルクリックで管理名を編集">
      ${src ? `<img class="ccf-bp-mk-thumb" src="${esc(src)}" alt="">` : `<span class="ccf-bp-mk-swatch" style="background:${esc(it.color || '#5865f2')};"></span>`}
      <div class="ccf-bp-mk-meta">
        <div class="ccf-bp-mk-name" title="${esc(dispName)}">${esc(dispName)}</div>
        ${panelTxt ? `<div class="ccf-bp-mk-text" title="${esc(panelTxt)}">${esc(panelTxt)}</div>` : ''}
      </div>
      <div class="ccf-bp-mk-acts">
        <button type="button" class="ccf-mini${isLocked ? ' active' : ''}" data-bp="pin" data-id="${esc(it.id)}" aria-pressed="${isLocked}" title="${isLocked ? '固定中（クリックで固定解除）' : '位置・サイズを固定'}">📌固定</button>
        <button type="button" class="ccf-mini${isVis ? '' : ' is-hidden'}" data-bp="eye" data-id="${esc(it.id)}" title="${isVis ? '表示中（クリックで非表示）' : '非表示中（クリックで表示）'}">${isVis ? '👁️表示' : '🚫非表示'}</button>
        <button type="button" class="ccf-mini danger" data-bp="del" data-id="${esc(it.id)}" title="削除">✕削除</button>
      </div>
    </div>`;
  }

  function renderGlobalScreensCardHtml() {
    const g = S.proj.globalDecor || {};
    const screens = Array.isArray(g.screens) ? g.screens : [];
    const listHtml = screens.length
      ? `<div class="ccf-bp-mk-list">${screens.map((sr, si) => renderPanelListRowHtml(sr, si, false)).join('')}</div>`
      : '<div class="ccf-bp-panel-empty">なし（全シーン共通枠など）</div>';
    return `<div class="ccf-bp-panel-card" data-bp-card="screen">
      <div class="ccf-bp-panel-head">
        <b>🖼️ スクリーンパネル（部屋常駐・${screens.length}枚）</b>
        <button type="button" class="ccf-mini" data-bp="add-screen" title="全シーン共通の部屋常駐スクリーンパネルを追加">＋ 追加</button>
      </div>
      ${listHtml}
    </div>`;
  }

  function renderSceneMarkersBlockHtml(sc, idx, m) {
    const g = S.proj.globalDecor || {};
    const markers = sc ? (Array.isArray(sc.markers) ? sc.markers : []) : (Array.isArray(g.markers) ? g.markers : []);
    const candHtml = (sc && m && m.marker || []).slice(0, 2).map(c => {
      const it = c.item, src = assetSrc(it);
      return `<div class="ccf-cand-card" data-scn-pickcand="marker" data-i="${idx}" data-uid="${esc(it.uid)}" title="一致: ${esc(c.matchedKeywords.join(', '))} / ${esc(c.tierLabel)}">
        ${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : '<span class="ccf-cand-ico">📌</span>'}
        <div class="ccf-cand-meta">
          <div class="ccf-cand-nm">${esc(it.name)}</div>
          <div class="ccf-cand-sub"><span class="ccf-cand-tier t${c.tier}">${esc(c.tierLabel)}</span> <small>${esc(c.matchedKeywords.slice(0, 2).join(','))}</small></div>
        </div>
      </div>`;
    }).join('');

    const listHtml = markers.length
      ? `<div class="ccf-bp-mk-list">${markers.map((mk, mi) => renderPanelListRowHtml(mk, mi, true)).join('')}</div>`
      : '<div class="ccf-bp-panel-empty">なし（場所固有パネル等）</div>';

    const extraActs = sc ? `<div class="ccf-bp-panel-subacts">
      <button type="button" class="ccf-mini" data-scn-apply-one="marker" data-scn-id="${esc(sc.id)}"${markers.length ? '' : ' disabled'} title="チェック済みシーン（未チェック時は全シーン確認）へこのマーカーだけ一括適用">📋 他シーンへこのマーカーだけ適用</button>
      ${markers.length ? `<button type="button" class="ccf-mini danger" data-scn-clear="marker" data-i="${idx}" title="このシーンのマーカーパネルをすべて解除">✕ 全解除</button>` : ''}
    </div>` : '';

    return `<div class="ccf-bp-panel-card" data-bp-card="marker">
      <div class="ccf-bp-panel-head">
        <b>📌 マーカーパネル（シーン別・${markers.length}枚）</b>
        <button type="button" class="ccf-mini" data-bp="add-marker-menu" title="画像または色・テキスト枠のマーカーパネルを追加">＋ 追加</button>
      </div>
      ${listHtml}
      ${extraActs}
      ${candHtml ? `<div class="ccf-cand-strip"><span class="ccf-cand-badge">✨これかも？</span>${candHtml}</div>` : ''}
    </div>`;
  }

  function renderBoardPanelCardsHtml(sc, idx, m) {
    return `<div class="ccf-bp-panel-cards">
      ${renderGlobalScreensCardHtml()}
      ${renderSceneMarkersBlockHtml(sc, idx, m)}
    </div>`;
  }

  function renderBoardMiddlePanel(sc, idx, checkedCount) {
    const b = S.proj.board;
    const g = S.proj.globalDecor;
    if (!sc) {
      const pieces = (b && b.pieces) || [];
      return `<div class="ccf-bp-sec">
        <div class="ccf-bp-sechead"><b>🌐 共通盤面（全体装飾・初期盤面）</b><span class="ccf-muted">初期駒 ${pieces.length}体</span></div>
        <div class="ccf-muted" style="font-size:.74rem;line-height:1.4;">全シーンで共通表示されるベース背景・共通前景（盤面テーブル）・常駐スクリーンパネルと、初期配置のNPC駒を編集します。</div>
        ${renderBoardQuickActionsHtml(null)}
        <div class="ccf-bp-global-grid">
          <div class="ccf-bp-gslot"><span>🖼️ 共通背景:</span> <b>${esc(g.bg ? g.bg.name : '未設定')}</b> <button type="button" class="ccf-mini" data-bp="add-bg">選択</button>${g.bg ? '<button type="button" class="ccf-mini danger" data-bp="clr-g-bg">✕</button>' : ''}</div>
          <div class="ccf-bp-gslot"><span>🪟 共通前景:</span> <b>${esc(g.fg ? g.fg.name : '未設定')}</b> <button type="button" class="ccf-mini" data-bp="add-fg">選択</button>${g.fg ? '<button type="button" class="ccf-mini danger" data-bp="clr-g-fg">✕</button>' : ''}</div>
          ${renderFgControlsHtml(b, g.fg, false)}
        </div>
        ${renderBoardPanelCardsHtml(null, -1, null)}
      </div>`;
    }
    let m = getCachedCandidates(sc);
    if (!m) m = computeCandidatesForScene(sc, getMatchSources());
    const bs = UI.batchSlots || { fg: true, bgm: true, bg: false, marker: false };
    const activeFg = sc.fg || g.fg || null;
    const isFallbackFg = !sc.fg && !!g.fg;
    return `<div class="ccf-bp-sec">
      <div class="ccf-bp-sechead" style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
        <b>🎨 シーン #${idx + 1} 編集＆素材設定</b>
        <span style="display:flex;align-items:center;gap:4px;">
          ${sc.page ? `<span class="ccf-badge">p.${sc.page}</span>` : ''}
          <button type="button" class="ccf-mini" data-bp="open-split-editor" title="広い画面で本文の編集や手動シーン分割を行います">🗗 広い画面で本文分割・編集</button>
        </span>
      </div>
      ${renderBoardQuickActionsHtml(sc)}
      <input type="text" class="ccf-bp-scn-title" data-bp-scn-title="${esc(sc.id)}" value="${esc(sc.title)}" placeholder="シーン名">
      <div class="ccf-scn-field-lbl">📖 シナリオ本文・メモ（分割・素材候補の抽出用 ※ココフォリアには出力されません）</div>
      <textarea class="ccf-bp-scn-text" data-bp-scn-text="${esc(sc.id)}" rows="4" placeholder="シーン本文・演出メモ・キーワード（例：夜の図書館で探索、病院の屋上で戦闘）">${esc(sc.text)}</textarea>
      <div class="ccf-bp-txt-acts">
        <button type="button" class="ccf-mini" data-bp="split-cursor" title="本文テキストエリア内のカーソル位置より後ろを新しいシーンに分割します">✂️ カーソル分割</button>
        <button type="button" class="ccf-mini" data-bp="insert-delim" title="カーソル位置に区切り線（---）を挿入します">＋ ---</button>
        <button type="button" class="ccf-mini" data-bp="split-delim" title="本文中の「---」の位置で一気に複数シーンへ分割します">✂️ ---一括分割</button>
        <button type="button" class="ccf-mini" data-bp="append-sel" title="左ペインで選択中のテキスト／抽出バッファを末尾に追記">📥 選択追記</button>
        <button type="button" class="ccf-mini" data-bp="replace-sel" title="左ペインで選択中のテキスト／抽出バッファで本文を置換">📥 置換</button>
        <button type="button" class="ccf-mini primary" data-bp="calc-cands" title="入力された本文から前景・BGM・背景・マーカー候補を再計算">✨ 候補更新</button>
      </div>
      <div class="ccf-scn-msg-box">
        <div class="ccf-scn-msg-head">
          <span class="ccf-scn-field-lbl">💬 シーン切替メッセージ（ココフォリア表示用・初期空欄）</span>
          <span class="ccf-scn-msg-btns">
            <button type="button" class="ccf-mini" data-scn-msg-copy="${esc(sc.id)}" title="シナリオ本文（選択中は選択部分）をコピー">📋 本文（または選択部分）をコピー</button>
            <button type="button" class="ccf-mini" data-scn-msg-title="${esc(sc.id)}" title="シーン名をセット">📋 シーン名をセット</button>
            <button type="button" class="ccf-mini danger" data-scn-msg-clear="${esc(sc.id)}" title="空欄に戻す">✕ クリア</button>
          </span>
        </div>
        <textarea class="ccf-bp-scn-msg" data-bp-scn-msg="${esc(sc.id)}" rows="2" placeholder="空欄のままにすると、ココフォリアでシーン切り替え時にメッセージが表示されません">${esc(sc.sceneMessage || '')}</textarea>
      </div>
      <div class="ccf-slots" data-bp-cands-host="${esc(sc.id)}">
        ${renderSlotRowHtml(sc, idx, 'fg', '🪟 前景（盤面）', sc.fg, m.fg, m.extracted, { compact: true })}
        ${renderFgControlsHtml(b, activeFg, isFallbackFg)}
        ${renderSlotRowHtml(sc, idx, 'bgm', '🎵 BGM', sc.bgm, m.bgm, m.extracted, { compact: true })}
        ${renderSlotRowHtml(sc, idx, 'bg', '🖼️ 背景（任意）', sc.bg, m.bg, m.extracted, { compact: true })}
        ${renderBoardPanelCardsHtml(sc, idx, m)}
      </div>
      <div class="ccf-bp-batch">
        <div class="ccf-bp-batch-head">
          <button type="button" class="ccf-mini accent" data-bp="auto-assign" title="全未設定シーンにチェックした種別の候補1位を一括仮配置">🪄 未設定を一括仮配置</button>
          ${sc.bgm ? `<button type="button" class="ccf-mini" data-bp="unify-bgm-vol" data-scn-id="${esc(sc.id)}" title="チェック済みシーン（未選択時は全シーン）のBGM音量を現在の音量に統一">🔊 ${checkedCount ? `チェック済み(${checkedCount}件)` : '全シーン'}の音量を ${Math.round(Number(sc.bgm.volume != null ? sc.bgm.volume : UI.defaultBgmVolume))}% に統一</button>` : ''}
        </div>
        <div class="ccf-bp-batch-chks">
          <label class="ccf-chk"><input type="checkbox" data-bp-batch="fg"${bs.fg ? ' checked' : ''}> 前景</label>
          <label class="ccf-chk"><input type="checkbox" data-bp-batch="bgm"${bs.bgm ? ' checked' : ''}> BGM</label>
          <label class="ccf-chk"><input type="checkbox" data-bp-batch="bg"${bs.bg ? ' checked' : ''}> 背景</label>
          <label class="ccf-chk"><input type="checkbox" data-bp-batch="marker"${bs.marker ? ' checked' : ''}> マーカーパネル</label>
        </div>
        <button type="button" class="ccf-btn accent" data-bp="batch-apply" style="width:100%;"${checkedCount ? '' : ' disabled'}>📋 現在の素材をチェック済み（${checkedCount}件）へ一括適用</button>
      </div>
    </div>`;
  }

  function boardEditorHtml(targetId, inModal) {
    ensureProjShape();
    const b = S.proj.board;
    const g = S.proj.globalDecor;
    const sc = getBoardTargetScene(targetId);
    const scIdx = sc ? S.proj.scenes.findIndex(s => s.id === sc.id) : -1;
    const effTarget = sc ? sc.id : 'global';
    const layers = collectBoardLayers(effTarget);
    const selLayers = syncSelectionToLayers(layers);
    const sel = selLayers.length === 1 ? selLayers[0].item : null;
    const scenes = S.proj.scenes;
    const checkedCount = scenes.filter(s => s.checked).length;
    const allChecked = scenes.length > 0 && checkedCount === scenes.length;

    const activeBg = (sc && sc.bg) ? sc.bg : g.bg;
    const activeBgSrc = activeBg && activeBg.visible !== false ? assetSrc(activeBg) : '';
    const activeFg = (sc && sc.fg) ? sc.fg : g.fg;
    const activeFgSrc = activeFg && activeFg.visible !== false ? assetSrc(activeFg) : '';
    const fgFit = (activeFg && activeFg.fitMode === 'fill') ? 'fill' : 'cover';

    const kindLabel = k => k === 'screen' ? 'スクリーン' : k === 'marker' ? 'マーカー' : 'キャラ駒';

    let pieceRank = 0;
    const stageItems = layers.map(l => {
      const it = l.item;
      if (!it.visible && !UI.showHiddenGhost) return '';
      const src = assetSrc(it);
      const isSel = UI.selectedIds.has(it.id);
      const showHandles = isSel && selLayers.length === 1 && !it.locked;
      const cssZ = cssZIndexOf(it, it.kind === 'piece' ? pieceRank++ : 0);
      const cls = `ccf-bp-item kind-${it.kind}${isSel ? ' sel' : ''}${!it.visible ? ' hidden-ghost' : ''}${it.locked ? ' locked' : ''}`;
      const style = `left:${it.x}px;top:${it.y}px;width:${it.width}px;height:${it.height}px;z-index:${cssZ};`;
      const bgStyle = it.kind === 'marker' && !src ? `background:${esc(it.color || 'rgba(88,101,242,.35)')};` : '';
      const panelText = (it.kind !== 'piece' && String(it.text || '').trim())
        ? `<div class="ccf-bp-paneltext">${esc(it.text)}</div>`
        : '';
      const content = src
        ? `<img src="${esc(src)}" alt="" draggable="false">${panelText}`
        : (it.kind === 'piece'
          ? `<div class="ccf-bp-ph">♟️<span>${esc(it.name)}</span></div>`
          : `<div class="ccf-bp-ph">${panelText}</div>`);
      const lockBadge = it.locked ? '<span class="ccf-bp-lockbadge" title="固定中（ドラッグで視点移動）">📌</span>' : '';
      const handles = showHandles
        ? '<span class="ccf-bp-h nw" data-bph="nw"></span><span class="ccf-bp-h ne" data-bph="ne"></span><span class="ccf-bp-h sw" data-bph="sw"></span><span class="ccf-bp-h se" data-bph="se"></span>'
        : '';
      return `<div class="${cls}" data-bpid="${esc(it.id)}" style="${style}${bgStyle}" title="${esc(it.name)} (${kindLabel(it.kind)})${it.locked ? ' [固定中]' : ''}">
        ${content}
        ${lockBadge}
        ${it.kind === 'piece' ? `<div class="ccf-bp-nametag">${esc(it.name)}</div>` : ''}
        ${handles}
      </div>`;
    }).join('');

    const sceneListHtml = `
      <div class="ccf-bp-scn-row fixed${effTarget === 'global' ? ' active' : ''}" data-bp-pick="global">
        <span class="ccf-bp-scn-ico">🌐</span>
        <span class="ccf-bp-scn-name"><b>共通盤面</b>（全体装飾・初期盤面：常駐スクリーンパネル／NPC駒配置）</span>
      </div>
      ${scenes.map((s, i) => {
        const icons = [s.fg ? '🪟' : '', s.bgm ? '🎵' : '', s.bg ? '🖼️' : '', (s.markers && s.markers.length) ? '📌' : ''].filter(Boolean).join('');
        return `<div class="ccf-bp-scn-row${effTarget === s.id ? ' active' : ''}" data-bp-pick="${esc(s.id)}" data-bp-scn-idx="${i}">
          <span class="ccf-scn-drag" draggable="true" data-bp-scn-drag="${i}" title="ドラッグして順序を並べ替え">⠿</span>
          <input type="checkbox" class="ccf-selchk" data-bp-schk="${i}"${s.checked ? ' checked' : ''} title="クリックで選択 / Shift+クリックで範囲選択">
          <span class="ccf-no">#${i + 1}</span>
          <span class="ccf-bp-scn-name" title="${esc(s.title)}">${esc(s.title || '無題のシーン')}</span>
          ${icons ? `<span class="ccf-bp-scn-icons">${icons}</span>` : ''}
          ${s.page ? `<span class="ccf-badge">p.${s.page}</span>` : ''}
          <span class="ccf-bp-scn-btns">
            <button type="button" class="ccf-mini" data-bp="dup-scn" data-scn-id="${esc(s.id)}" title="📋 シーンを複製">📋</button>
            <button type="button" class="ccf-mini danger" data-bp="del-one-scn" data-scn-id="${esc(s.id)}" title="🗑️ このシーンを削除 (Ctrl+Zで元に戻せます)">🗑️</button>
          </span>
        </div>`;
      }).join('') || '<div class="ccf-muted" style="padding:8px;font-size:.74rem;">シーンがありません。「＋ 空シーン」や「📥 選択テキストから追加」で作成できます。</div>'}`;

    const layerRows = layers.slice().reverse().map(l => {
      const it = l.item;
      const isSel = UI.selectedIds.has(it.id);
      const originTag = l.origin === 'global' ? '共通' : l.origin === 'board' ? '初期' : 'ｼｰﾝ';
      const prioTag = it.kind === 'piece' ? '100.5' : String(it.zIndex || 0);
      return `<div class="ccf-bp-layer${isSel ? ' sel' : ''}${!it.visible ? ' muted' : ''}" data-bpl="${esc(it.id)}" title="クリックで選択 / Ctrl+クリックで複数選択">
        <button type="button" class="ccf-mini" data-bp="eye" data-id="${esc(it.id)}" title="一時表示/非表示切替">${it.visible ? '👁️' : '🚫'}</button>
        <button type="button" class="ccf-mini${it.locked ? ' active' : ''}" data-bp="pin" data-id="${esc(it.id)}" aria-pressed="${!!it.locked}" title="${it.locked ? '固定中（クリックで固定解除）' : '📌 位置・サイズを固定'}">${it.locked ? '📌固定' : '📌'}</button>
        <span class="ccf-badge">${originTag}:${kindLabel(it.kind)}</span>
        <span class="ccf-bp-lname" title="${esc(it.name)}">${esc(it.name || kindLabel(it.kind))}</span>
        <span class="ccf-muted" style="font-size:.66rem;">z:${prioTag}</span>
        <button type="button" class="ccf-mini" data-bp="zup" data-id="${esc(it.id)}" title="前面へ">▲</button>
        <button type="button" class="ccf-mini" data-bp="zdn" data-id="${esc(it.id)}" title="背面へ">▼</button>
        <button type="button" class="ccf-mini danger" data-bp="del" data-id="${esc(it.id)}" title="削除">🗑</button>
      </div>`;
    }).join('') || '<div class="ccf-muted" style="padding:8px;">パネル・駒がありません。上部ボタンから追加してください。</div>';

    const selPanelCount = selLayers.filter(l => l.item.kind === 'screen' || l.item.kind === 'marker').length;
    const inspectorHtml = sel ? `<div class="ccf-bp-inspector">
      <div class="ccf-muted" style="font-size:.74rem;font-weight:700;">🎛️ ${esc(sel.name || kindLabel(sel.kind))}${sel.locked ? ' <span class="ccf-badge">📌 固定中</span>' : ''}</div>
      <div class="ccf-bp-props">
        <label>X <input type="number" data-bp-f="x" value="${sel.x}"></label>
        <label>Y <input type="number" data-bp-f="y" value="${sel.y}"></label>
        <label>幅(W) <input type="number" min="16" data-bp-f="width" value="${sel.width}"></label>
        <label>高さ(H) <input type="number" min="16" data-bp-f="height" value="${sel.height}"></label>
        <label>Z順 <input type="number" data-bp-f="zIndex" value="${sel.zIndex}"${sel.kind === 'piece' ? ' title="キャラ駒は実質優先度100.5で常に通常パネル(0〜100)より前面に描画されます"' : ''}></label>
        <label>🏷️ 管理名（ツール用） <input type="text" data-bp-f="name" value="${esc(sel.name)}"></label>
        ${sel.kind !== 'piece' ? `<label class="ccf-bp-prop-wide">💬 パネル内テキスト（盤面表示・空欄で非表示） <textarea rows="2" data-bp-f="text" placeholder="空欄で盤面上に文字を表示しない">${esc(sel.text || '')}</textarea></label>` : ''}
      </div>
      <div class="ccf-bp-scale-acts">
        <span class="ccf-muted" style="font-size:.72rem;">倍率:</span>
        <button type="button" class="ccf-mini" data-bp="scale-50" data-id="${esc(sel.id)}" title="元画像サイズの50%に設定">50%</button>
        <button type="button" class="ccf-mini" data-bp="scale-100" data-id="${esc(sel.id)}" title="元画像サイズの100%（等倍）に設定">100%</button>
        <button type="button" class="ccf-mini" data-bp="fit-board" data-id="${esc(sel.id)}" title="元画像の縦横比を保って盤面内にぴったり収めます">盤面サイズに合わせる</button>
        <button type="button" class="ccf-mini" data-bp="center-item" data-id="${esc(sel.id)}" title="現在のサイズで盤面中央へ配置">中央に配置</button>
      </div>
      <div class="ccf-bp-toggles">
        <button type="button" class="ccf-btn${sel.locked ? ' active' : ''}" data-bp="pin" data-id="${esc(sel.id)}" aria-pressed="${!!sel.locked}" title="ONで位置・サイズを固定し、パネル上のドラッグで視点移動できるようにします">${sel.locked ? '📌 固定 ON' : '📌 固定'}</button>
        <button type="button" class="ccf-btn${sel.lockAspect ? ' active' : ''}" data-bp="lock" data-id="${esc(sel.id)}" aria-pressed="${sel.lockAspect}">${sel.lockAspect ? '🔒 比率固定 ON' : '🔓 比率自由'}</button>
        <button type="button" class="ccf-btn${sel.visible ? ' active' : ''}" data-bp="eye" data-id="${esc(sel.id)}">${sel.visible ? '👁️ 表示' : '🚫 非表示'}</button>
        ${sel.kind !== 'piece'
          ? `<button type="button" class="ccf-btn${(sel.zIndex || 0) >= 101 ? ' active' : ''}" data-bp="toggle-z101" data-id="${esc(sel.id)}" title="優先度0（駒より下）と優先度101（駒より上）を切り替えます">${(sel.zIndex || 0) >= 101 ? '🔺 駒より上(101) ⇔ 駒より下(0)' : '🔻 駒より下(0) ⇔ 駒より上(101)'}</button>`
          : '<span class="ccf-muted" style="font-size:.7rem;">♟️ 駒は実質優先度100.5（最前面）</span>'}
        <button type="button" class="ccf-mini" data-bp="ztop" data-id="${esc(sel.id)}">⤒ 前面</button>
        <button type="button" class="ccf-mini" data-bp="zbot" data-id="${esc(sel.id)}">⤓ 背面</button>
      </div>
      ${sel.kind === 'marker' ? `<div class="ccf-bp-syncbox">
        <button type="button" class="ccf-btn accent" data-bp="sync-scenes" data-id="${esc(sel.id)}" style="width:100%;">📌 チェック済みシーン（${checkedCount}件）へ座標同期</button>
      </div>` : ''}
    </div>` : (selLayers.length > 1 ? `<div class="ccf-bp-inspector">
      <div class="ccf-muted" style="font-size:.74rem;font-weight:700;">🎛️ ${selLayers.length}件を選択中（未固定要素をドラッグで一括移動・Deleteで削除・右クリックで詳細）</div>
      ${selPanelCount >= 2 ? `<div class="ccf-bp-syncbox"><button type="button" class="ccf-btn primary" data-bp="combine-panels" style="width:100%;">🧩 選択したパネル(${selPanelCount}枚)を1枚に結合</button></div>` : ''}
      <div class="ccf-bp-toggles">
        <button type="button" class="ccf-mini" data-bp="pin-selected">📌 固定切替</button>
        <button type="button" class="ccf-mini" data-bp="align-sel" data-align="left">左揃え</button>
        <button type="button" class="ccf-mini" data-bp="align-sel" data-align="hcenter">左右中央</button>
        <button type="button" class="ccf-mini" data-bp="align-sel" data-align="right">右揃え</button>
        <button type="button" class="ccf-mini" data-bp="align-sel" data-align="top">上揃え</button>
        <button type="button" class="ccf-mini" data-bp="align-sel" data-align="vcenter">上下中央</button>
        <button type="button" class="ccf-mini" data-bp="align-sel" data-align="bottom">下揃え</button>
        <button type="button" class="ccf-mini danger" data-bp="del-selected">🗑️ 選択削除</button>
      </div>
    </div>` : '');

    const canUndo = window.AppHistory && window.AppHistory.canUndo ? window.AppHistory.canUndo() : false;
    const canRedo = window.AppHistory && window.AppHistory.canRedo ? window.AppHistory.canRedo() : false;
    const safeBgCss = activeBgSrc ? activeBgSrc.replace(/'/g, '%27').replace(/"/g, '%22') : '';
    const zoomPct = Math.round((UI.zoomScale || 1) * 100);
    return `<div class="ccf-bp-wrap" data-bp-target="${esc(effTarget)}">
      <div class="ccf-bp-bar">
        <button type="button" class="ccf-btn" data-bp="add-bg">＋背景</button>
        <button type="button" class="ccf-btn" data-bp="add-fg">＋前景</button>
        <button type="button" class="ccf-btn" data-bp="add-screen" title="全シーン共通の常駐スクリーンパネルを追加">＋スクリーンパネル</button>
        <button type="button" class="ccf-btn" data-bp="add-marker" title="現在のシーン専用のマーカーパネルを追加">＋マーカーパネル</button>
        <button type="button" class="ccf-btn" data-bp="sync-npcs">♟️登録NPCを一括配置</button>
        <button type="button" class="ccf-btn" data-bp="pick-npc-menu">♟️ 駒を個別配置 ▾</button>
        <span class="ccf-sep"></span>
        <div class="ccf-bp-zoom" title="盤面表示の拡大・縮小（ホイール回転でも可）">
          <button type="button" class="ccf-mini" data-bp="zoom-out" title="縮小">－</button>
          <input type="range" min="20" max="250" step="5" data-bp-zoom-slider value="${zoomPct}" aria-label="盤面ズーム倍率">
          <span class="ccf-bp-zoom-pct" data-bp-zoom-pct>${zoomPct}%</span>
          <button type="button" class="ccf-mini" data-bp="zoom-in" title="拡大">＋</button>
          <button type="button" class="ccf-mini" data-bp="zoom-fit" title="盤面全体をステージ中央にフィット">🎯 中央フィット</button>
        </div>
        <button type="button" class="ccf-mini${UI.marqueeMode ? ' active' : ''}" data-bp="marquee-mode" aria-pressed="${UI.marqueeMode}" title="ONで左ドラッグが矩形範囲選択になります（OFF時はShift+ドラッグで範囲選択／余白・固定パネルドラッグで視点移動）">▭ 範囲選択</button>
        <span class="ccf-sep"></span>
        <label class="ccf-chk"><input type="checkbox" data-bp-opt="grid"${b.showGrid ? ' checked' : ''}> グリッド</label>
        <label class="ccf-chk"><input type="checkbox" data-bp-opt="snap"${UI.snapGrid ? ' checked' : ''}> スナップ</label>
        <label class="ccf-chk"><input type="checkbox" data-bp-opt="ghost"${UI.showHiddenGhost ? ' checked' : ''}> 非表示を薄く</label>
        <span class="ccf-spacer"></span>
        <button type="button" class="ccf-mini" data-bp="undo"${canUndo ? '' : ' disabled'} title="元に戻す (Ctrl+Z)">↩️ Undo</button>
        <button type="button" class="ccf-mini" data-bp="redo"${canRedo ? '' : ' disabled'} title="やり直す (Ctrl+Y)">↪️ Redo</button>
        ${inModal ? '<button type="button" class="ccf-btn" data-bp="close-modal">✕ 閉じる</button>' : ''}
      </div>
      <div class="ccf-bp-body">
        <div class="ccf-bp-stage-wrap${UI.marqueeMode ? ' marquee-mode' : ''}">
          ${safeBgCss ? `<div class="ccf-bp-stage-bg" style="background-image:url('${esc(safeBgCss)}');"></div>` : ''}
          <div class="ccf-bp-canvas" data-bp-canvas="1" style="width:${b.width}px;height:${b.height}px;--ccf-grid:${b.grid}px;">
            <div class="ccf-bp-fg-layer">${activeFgSrc ? `<img class="ccf-bp-fg-img fit-${fgFit}" src="${esc(activeFgSrc)}" alt="" draggable="false">` : ''}</div>
            <div class="ccf-bp-grid-layer${b.showGrid ? ' grid' : ''}"></div>
            ${stageItems}
            <div class="ccf-bp-guides" data-bp-guides="1"></div>
          </div>
        </div>
        <div class="ccf-bp-side">
          <div class="ccf-bp-sec">
            <div class="ccf-bp-sechead" style="display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:wrap;">
              <b>🎬 シーン切り替え一覧（${scenes.length}件）</b>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button type="button" class="ccf-mini" data-bp="add-empty-scn">＋空シーン</button>
                <button type="button" class="ccf-mini" data-bp="add-sel-scn" title="左のPDF/TXT選択テキストから新規シーンを作成">📥選択テキストから追加</button>
                <button type="button" class="ccf-mini" data-bp="dup-cur-scn"${sc ? '' : ' disabled'} title="選択中のシーンを丸ごと複製してすぐ下に挿入">📋 シーンを複製</button>
                <button type="button" class="ccf-mini danger" data-bp="del-cur-scn"${sc ? '' : ' disabled'} title="選択中のシーンを削除 (Ctrl+Zで元に戻せます)">🗑️ このシーンを削除</button>
                <button type="button" class="ccf-mini" data-bp="chk-all-scn"${scenes.length ? '' : ' disabled'}>${allChecked ? '☑解除' : '☐全選択'}</button>
                <button type="button" class="ccf-mini danger" data-bp="del-chk-scn"${checkedCount ? '' : ' disabled'}>🗑️選択削除(${checkedCount})</button>
              </div>
            </div>
            <div class="ccf-bp-scnlist">${sceneListHtml}</div>
          </div>

          ${renderBoardMiddlePanel(sc, scIdx, checkedCount)}

          <div class="ccf-bp-sec">
            <div class="ccf-bp-sechead"><b>📚 レイヤー（重ね順・表示👁️・比率固定🔒・座標/サイズ）</b></div>
            <div class="ccf-bp-layers">${layerRows}</div>
            ${inspectorHtml}
          </div>
        </div>
      </div>
    </div>`;
  }

  const MIN_BOARD_ZOOM = 0.2;
  const MAX_BOARD_ZOOM = 2.5;
  const clampBoardZoom = z => Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, Number(z) || 1));

  function fitBoardCamera(container) {
    if (!container) return false;
    const wrap = container.querySelector('.ccf-bp-stage-wrap');
    if (!wrap) return false;
    const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
    const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 40 || h < 40) return false;
    const pad = 28;
    const fit = clampBoardZoom(Math.min((w - pad) / bw, (h - pad) / bh));
    UI.zoomScale = Math.round(fit * 1000) / 1000;
    UI.panX = Math.round((w - bw * UI.zoomScale) / 2);
    UI.panY = Math.round((h - bh * UI.zoomScale) / 2);
    UI._fittedStageW = w;
    UI._fittedStageH = h;
    UI.cameraFitted = true;
    return true;
  }

  function refitCamera(force) {
    const host = (UI.modalOpen && UI.modalEl) ? UI.modalEl.querySelector('.ccf-bp-modal-body') : $('ccfBoardInlineHost');
    if (!host) return false;
    const wrap = host.querySelector('.ccf-bp-stage-wrap');
    if (!wrap || wrap.clientWidth < 40 || wrap.clientHeight < 40) return false;
    if (force || !UI.cameraFitted || wrap.clientWidth !== UI._fittedStageW || wrap.clientHeight !== UI._fittedStageH) {
      applyBoardCanvasScale(host, true);
      return true;
    }
    return false;
  }

  function applyBoardCanvasScale(container, forceFit) {
    if (!container) return;
    const wrap = container.querySelector('.ccf-bp-stage-wrap');
    const cv = container.querySelector('.ccf-bp-canvas');
    if (!wrap || !cv) return;
    if (forceFit || !UI.cameraFitted) {
      fitBoardCamera(container);
    }
    const sc = clampBoardZoom(UI.zoomScale);
    UI.zoomScale = sc;
    cv.style.transformOrigin = '0 0';
    cv.style.transform = `translate(${UI.panX}px, ${UI.panY}px) scale(${sc})`;
    cv.style.setProperty('--ccf-inv-zoom', String(1 / sc));
    cv.dataset.scale = String(sc);
    const pct = Math.round(sc * 100);
    const pctEl = container.querySelector('[data-bp-zoom-pct]');
    if (pctEl) pctEl.textContent = pct + '%';
    const slider = container.querySelector('[data-bp-zoom-slider]');
    if (slider) slider.value = String(pct);
  }

  function zoomBoardTo(container, nextScale, clientX, clientY) {
    const wrap = container && container.querySelector('.ccf-bp-stage-wrap');
    if (!wrap) return;
    const prev = clampBoardZoom(UI.zoomScale);
    const next = clampBoardZoom(nextScale);
    const rect = wrap.getBoundingClientRect();
    const mx = (clientX != null) ? (clientX - rect.left) : (wrap.clientWidth / 2);
    const my = (clientY != null) ? (clientY - rect.top) : (wrap.clientHeight / 2);
    const bx = (mx - UI.panX) / prev;
    const by = (my - UI.panY) / prev;
    UI.zoomScale = Math.round(next * 1000) / 1000;
    UI.panX = Math.round(mx - bx * UI.zoomScale);
    UI.panY = Math.round(my - by * UI.zoomScale);
    UI.cameraFitted = true;
    applyBoardCanvasScale(container, false);
  }

  async function applyInspectorScaleAction(container, act, it) {
    if (!it) return;
    const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
    const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
    if (act === 'center-item') {
      cp('盤面要素を中央に配置');
      it.x = Math.round((bw - it.width) / 2);
      it.y = Math.round((bh - it.height) / 2);
      CCF.saveProject();
      refreshBoardContainers();
      return;
    }
    let natW = 0, natH = 0;
    const escId = CSS.escape ? CSS.escape(it.id) : it.id;
    const imgEl = container && container.querySelector(`[data-bpid="${escId}"] img`);
    if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
      natW = imgEl.naturalWidth;
      natH = imgEl.naturalHeight;
    } else {
      const dim = await measureImageSize(assetSrc(it));
      if (dim) { natW = dim.width; natH = dim.height; }
    }
    cp('盤面要素のサイズ調整');
    if (act === 'fit-board') {
      if (natW > 0 && natH > 0) {
        const r = fitRectInsideBoard(natW, natH, bw, bh);
        it.x = r.x; it.y = r.y; it.width = r.width; it.height = r.height;
      } else {
        it.x = 0; it.y = 0; it.width = bw; it.height = bh;
      }
    } else {
      const mul = act === 'scale-50' ? 0.5 : 1;
      const baseW = natW || (it.kind === 'bg' || it.kind === 'fg' ? bw : it.width);
      const baseH = natH || (it.kind === 'bg' || it.kind === 'fg' ? bh : it.height);
      const nw = Math.max(16, Math.round(baseW * mul));
      const nh = Math.max(16, Math.round(baseH * mul));
      const cx = it.x + it.width / 2;
      const cy = it.y + it.height / 2;
      it.width = nw;
      it.height = nh;
      it.x = Math.round(cx - nw / 2);
      it.y = Math.round(cy - nh / 2);
    }
    CCF.saveProject();
    refreshBoardContainers();
  }

  function handleSlotActionClick(e, refreshFn) {
    const playBtn = e.target.closest('[data-scn-play]');
    if (playBtn) {
      const idx = playBtn.dataset.scnPlayIdx != null ? Number(playBtn.dataset.scnPlayIdx) : -1;
      const sc = idx >= 0 ? S.proj.scenes[idx] : null;
      const volumePct = (sc && sc.bgm && sc.bgm.volume != null) ? sc.bgm.volume : UI.defaultBgmVolume;
      const loop = (sc && sc.bgm) ? sc.bgm.loop !== false : true;
      togglePreviewAudio(playBtn.dataset.scnPlay, refreshFn, { volumePct, loop, sceneId: sc ? sc.id : '' });
      return true;
    }

    const unifyBtn = e.target.closest('[data-bgm-apply-all]');
    if (unifyBtn) {
      const sc = S.proj.scenes.find(s => s.id === unifyBtn.dataset.bgmScnid) || S.proj.scenes[+unifyBtn.dataset.bgmApplyAll];
      unifyBgmVolumeFromScene(sc);
      return true;
    }

    const applyOneBtn = e.target.closest('[data-scn-apply-one]');
    if (applyOneBtn) {
      batchApplySingleSlot(applyOneBtn.dataset.scnId, applyOneBtn.dataset.scnApplyOne);
      return true;
    }

    const clrBtn = e.target.closest('[data-scn-clear]');
    if (clrBtn) {
      const slot = clrBtn.dataset.scnClear, idx = +clrBtn.dataset.i, sc = S.proj.scenes[idx];
      if (!sc) return true;
      cp('シーン素材解除');
      if (slot === 'bg') sc.bg = null;
      else if (slot === 'fg') sc.fg = null;
      else if (slot === 'marker' || slot === 'screen') { sc.markers = []; sc.screens = []; }
      else if (slot === 'bgm') sc.bgm = null;
      if (sc.manualSlots) sc.manualSlots[slot] = false;
      CCF.saveProject(); refreshFn(); return true;
    }

    const candEl = e.target.closest('[data-scn-pickcand]');
    if (candEl) {
      const slot = candEl.dataset.scnPickcand, idx = +candEl.dataset.i, uid = candEl.dataset.uid;
      const sc = S.proj.scenes[idx]; if (!sc) return true;
      const sources = getMatchSources();
      const asset = sources.registeredItems.find(x => x.uid === uid) || sources.commonItems.find(x => x.uid === uid);
      if (!asset) return true;
      cp('✨これかも？素材配置');
      assignSlotAsset(sc, slot, asset, false);
      CCF.saveProject(); refreshFn();
      say(`✨「${asset.name}」を配置しました`);
      return true;
    }

    const browseBtn = e.target.closest('[data-scn-browse]');
    if (browseBtn && CCF.assets && CCF.assets.pickAsset) {
      const slot = browseBtn.dataset.scnBrowse, idx = +browseBtn.dataset.i, sc = S.proj.scenes[idx];
      if (!sc) return true;
      CCF.assets.pickAsset({
        key: S.key,
        types: slot === 'bgm' ? ['audio'] : ['image'],
        title: (slot === 'bgm' ? 'BGM' : slot === 'fg' ? '前景（盤面画像）' : (slot === 'marker' || slot === 'screen') ? 'マーカーパネル画像' : '背景画像') + 'を選択'
      }).then(asset => {
        if (!asset) return;
        cp('シーン素材を手動割り当て');
        assignSlotAsset(sc, slot, asset, true, getMatchSources());
        CCF.saveProject(); refreshFn();
      });
      return true;
    }

    const addTagBtn = e.target.closest('[data-scn-addtag]');
    if (addTagBtn && CCF.assets && CCF.assets.appendTagsToAsset) {
      const slot = addTagBtn.dataset.scnAddtag, idx = +addTagBtn.dataset.i, sc = S.proj.scenes[idx];
      if (!sc) return true;
      const tags = String(addTagBtn.dataset.tags || '').split(',').filter(Boolean);
      const uid = slot === 'bg' ? (sc.bg && sc.bg.assetUid)
        : slot === 'fg' ? (sc.fg && sc.fg.assetUid)
        : (slot === 'marker' || slot === 'screen') ? (sc.markers && sc.markers[0] && sc.markers[0].assetUid)
        : (sc.bgm && sc.bgm.assetUid);
      if (uid && CCF.assets.appendTagsToAsset(S.key, uid, tags)) {
        if (sc.manualSlots) sc.manualSlots[slot] = false;
        CCF.saveProject(); refreshFn();
        say(`🏷️ 素材にタグ「${tags.join(', ')}」を追加しました`);
      } else {
        say('⚠️ この素材にはタグを追加できません（登録素材またはマイライブラリ素材を選択してください）');
      }
      return true;
    }
    return false;
  }

  function promptTextModal(title, initialVal) {
    if (typeof appPrompt === 'function') return appPrompt(title, initialVal);
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'app-dialog-overlay';
      ov.innerHTML = `<div class="app-dialog-box" role="dialog" aria-modal="true" style="min-width:min(380px,92vw);padding:14px;background:var(--bg-card,#fff);border-radius:10px;border:1px solid var(--border,#ccc);box-shadow:0 12px 32px rgba(0,0,0,.28);">
        <div style="font-weight:700;margin-bottom:8px;">${esc(title || '入力')}</div>
        <input type="text" class="ccf-prompt-inp" value="${esc(initialVal || '')}" style="width:100%;box-sizing:border-box;padding:6px 8px;margin-bottom:10px;">
        <div style="display:flex;justify-content:flex-end;gap:6px;">
          <button type="button" class="ccf-btn" data-pm="cancel">キャンセル</button>
          <button type="button" class="ccf-btn primary" data-pm="ok">OK</button>
        </div>
      </div>`;
      document.body.appendChild(ov);
      const inp = ov.querySelector('.ccf-prompt-inp');
      const done = val => { ov.remove(); resolve(val); };
      ov.addEventListener('click', e => {
        if (e.target === ov || e.target.closest('[data-pm="cancel"]')) done(null);
        else if (e.target.closest('[data-pm="ok"]')) done(inp.value);
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); done(inp.value); }
        else if (e.key === 'Escape') { e.preventDefault(); done(null); }
      });
      setTimeout(() => { inp.focus(); inp.select(); }, 10);
    });
  }

  function alignBoardItems(targetId, idSet, mode) {
    const layers = collectBoardLayers(targetId).filter(l => idSet && idSet.has(l.item.id));
    if (!layers.length) return;
    const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
    const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
    cp('盤面要素を整列');
    if (layers.length === 1 || mode === 'board-center') {
      layers.forEach(l => {
        const it = l.item;
        if (mode === 'left') it.x = 0;
        else if (mode === 'hcenter' || mode === 'board-center') it.x = Math.round((bw - it.width) / 2);
        else if (mode === 'right') it.x = Math.round(bw - it.width);
        if (mode === 'top') it.y = 0;
        else if (mode === 'vcenter' || mode === 'board-center') it.y = Math.round((bh - it.height) / 2);
        else if (mode === 'bottom') it.y = Math.round(bh - it.height);
      });
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      layers.forEach(l => {
        const it = l.item;
        minX = Math.min(minX, it.x);
        maxX = Math.max(maxX, it.x + it.width);
        minY = Math.min(minY, it.y);
        maxY = Math.max(maxY, it.y + it.height);
      });
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      layers.forEach(l => {
        const it = l.item;
        if (mode === 'left') it.x = Math.round(minX);
        else if (mode === 'hcenter') it.x = Math.round(midX - it.width / 2);
        else if (mode === 'right') it.x = Math.round(maxX - it.width);
        else if (mode === 'top') it.y = Math.round(minY);
        else if (mode === 'vcenter') it.y = Math.round(midY - it.height / 2);
        else if (mode === 'bottom') it.y = Math.round(maxY - it.height);
      });
    }
    CCF.saveProject();
    refreshBoardContainers();
  }

  function duplicateBoardItems(targetId, idSet) {
    const hits = collectBoardLayers(targetId).filter(l => idSet && idSet.has(l.item.id));
    if (!hits.length) return;
    const sc = getBoardTargetScene(targetId);
    cp(hits.length > 1 ? '選択要素を複製' : '盤面要素を複製');
    const newIds = [];
    hits.forEach(hit => {
      const host = hit.origin === 'global' ? S.proj.globalDecor : hit.origin === 'board' ? S.proj.board : sc;
      if (!host || !Array.isArray(host[hit.arrName])) return;
      const cloned = M.sanitizeBoardItem(Object.assign({}, hit.item, {
        id: M.newId(),
        syncId: '',
        name: (hit.item.name || '要素') + ' (複製)',
        x: Math.round(hit.item.x + 24),
        y: Math.round(hit.item.y + 24)
      }), hit.item.kind);
      host[hit.arrName].push(cloned);
      newIds.push(cloned.id);
    });
    if (newIds.length) setSelectionIds(newIds, newIds[newIds.length - 1]);
    CCF.saveProject();
    refreshBoardContainers();
    say(`📋 ${newIds.length}件を複製しました`);
  }

  async function changeItemImageViaPicker(item) {
    if (!item || !CCF.assets || !CCF.assets.pickAsset) return;
    const asset = await CCF.assets.pickAsset({
      key: S.key,
      types: ['image'],
      title: `「${item.name || '要素'}」の画像を変更`
    });
    if (!asset) return;
    const dim = await measureImageSize(assetSrc(asset));
    cp('画像を変更');
    item.path = asset.path || '';
    item.dataUrl = asset.dataUrl || '';
    item.assetUid = asset.uid || '';
    if (!item.name) item.name = asset.name || '要素';
    if (dim && dim.width > 0 && dim.height > 0 && item.kind !== 'piece') {
      const cx = item.x + item.width / 2;
      const cy = item.y + item.height / 2;
      const nh = Math.max(24, Math.round(item.width * (dim.height / dim.width)));
      item.height = nh;
      item.x = Math.round(cx - item.width / 2);
      item.y = Math.round(cy - nh / 2);
    }
    CCF.saveProject();
    refreshBoardContainers();
    say(`🖼️「${item.name}」の画像を変更しました`);
  }

  function computeMoveSmartGuides(rawBox, others, bw, bh, tol, snapStep) {
    const snapGridVal = v => (snapStep > 1 ? Math.round(v / snapStep) * snapStep : Math.round(v));
    const xCands = [];
    const yCands = [];

    // 盤面中心・盤面端ターゲット
    const pushX = (target, boxOffset, spanY1, spanY2, label) => {
      const cur = rawBox.x + boxOffset;
      const dist = Math.abs(cur - target);
      if (dist <= tol) xCands.push({ dist, snapPos: target - boxOffset, linePos: target, y1: spanY1, y2: spanY2, label: label || '' });
    };
    const pushY = (target, boxOffset, spanX1, spanX2, label) => {
      const cur = rawBox.y + boxOffset;
      const dist = Math.abs(cur - target);
      if (dist <= tol) yCands.push({ dist, snapPos: target - boxOffset, linePos: target, x1: spanX1, x2: spanX2, label: label || '' });
    };

    pushX(bw / 2, rawBox.w / 2, 0, bh, '盤面中央');
    pushX(0, 0, 0, bh, '左端');
    pushX(bw, rawBox.w, 0, bh, '右端');
    pushY(bh / 2, rawBox.h / 2, 0, bw, '盤面中央');
    pushY(0, 0, 0, bw, '上端');
    pushY(bh, rawBox.h, 0, bw, '下端');

    others.forEach(o => {
      const oPtsX = [o.x, o.x + o.w / 2, o.x + o.w];
      const bPtsX = [0, rawBox.w / 2, rawBox.w];
      const sy1 = Math.min(rawBox.y, o.y), sy2 = Math.max(rawBox.y + rawBox.h, o.y + o.h);
      oPtsX.forEach((tx, ti) => {
        bPtsX.forEach((bo, bi) => {
          const cur = rawBox.x + bo;
          const dist = Math.abs(cur - tx);
          if (dist <= tol) {
            xCands.push({
              dist: dist + (ti === 1 && bi === 1 ? 0 : 0.05),
              snapPos: tx - bo,
              linePos: tx,
              y1: sy1,
              y2: sy2,
              label: (ti === 1 && bi === 1) ? '中心揃え' : '端揃え',
              cyan: true
            });
          }
        });
      });

      const oPtsY = [o.y, o.y + o.h / 2, o.y + o.h];
      const bPtsY = [0, rawBox.h / 2, rawBox.h];
      const sx1 = Math.min(rawBox.x, o.x), sx2 = Math.max(rawBox.x + rawBox.w, o.x + o.w);
      oPtsY.forEach((ty, ti) => {
        bPtsY.forEach((bo, bi) => {
          const cur = rawBox.y + bo;
          const dist = Math.abs(cur - ty);
          if (dist <= tol) {
            yCands.push({
              dist: dist + (ti === 1 && bi === 1 ? 0 : 0.05),
              snapPos: ty - bo,
              linePos: ty,
              x1: sx1,
              x2: sx2,
              label: (ti === 1 && bi === 1) ? '中心揃え' : '端揃え',
              cyan: true
            });
          }
        });
      });
    });

    let outX = snapGridVal(rawBox.x);
    let outY = snapGridVal(rawBox.y);
    const vlines = [];
    const hlines = [];

    if (xCands.length) {
      xCands.sort((a, b) => a.dist - b.dist);
      const bestSnap = Math.round(xCands[0].snapPos);
      outX = bestSnap;
      const seen = new Map();
      xCands.forEach(c => {
        if (Math.abs(Math.round(c.snapPos) - bestSnap) > 1) return;
        const key = Math.round(c.linePos * 2) / 2;
        const y1 = Math.min(c.y1, rawBox.y), y2 = Math.max(c.y2, rawBox.y + rawBox.h);
        const ex = seen.get(key);
        if (ex) { ex.y1 = Math.min(ex.y1, y1); ex.y2 = Math.max(ex.y2, y2); if (c.label && !ex.label) ex.label = c.label; if (!c.cyan) ex.cyan = false; }
        else seen.set(key, { x: c.linePos, y1, y2, label: c.label, cyan: !!c.cyan });
      });
      seen.forEach(v => vlines.push(v));
    }

    if (yCands.length) {
      yCands.sort((a, b) => a.dist - b.dist);
      const bestSnap = Math.round(yCands[0].snapPos);
      outY = bestSnap;
      const seen = new Map();
      yCands.forEach(c => {
        if (Math.abs(Math.round(c.snapPos) - bestSnap) > 1) return;
        const key = Math.round(c.linePos * 2) / 2;
        const x1 = Math.min(c.x1, rawBox.x), x2 = Math.max(c.x2, rawBox.x + rawBox.w);
        const ex = seen.get(key);
        if (ex) { ex.x1 = Math.min(ex.x1, x1); ex.x2 = Math.max(ex.x2, x2); if (c.label && !ex.label) ex.label = c.label; if (!c.cyan) ex.cyan = false; }
        else seen.set(key, { y: c.linePos, x1, x2, label: c.label, cyan: !!c.cyan });
      });
      seen.forEach(h => hlines.push(h));
    }

    return { x: outX, y: outY, vlines, hlines, sizeMatches: [] };
  }

  function computeResizeSmartGuides(orig, dir, dx, dy, lockAspect, ratio, others, bw, bh, tol, snapStep) {
    const snapGridVal = v => (snapStep > 1 ? Math.round(v / snapStep) * snapStep : Math.round(v));
    let nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;
    if (dir.includes('e')) nw = Math.max(24, orig.w + dx);
    if (dir.includes('s')) nh = Math.max(24, orig.h + dy);
    if (dir.includes('w')) { nw = Math.max(24, orig.w - dx); nx = orig.x + (orig.w - nw); }
    if (dir.includes('n')) { nh = Math.max(24, orig.h - dy); ny = orig.y + (orig.h - nh); }

    const vlines = [];
    const hlines = [];
    const sizeMatches = [];
    let snappedX = false, snappedY = false;
    let bestWMatch = null, bestHMatch = null;

    if (dir.includes('e') || dir.includes('w')) {
      others.forEach(o => {
        const dW = Math.abs(nw - o.w);
        if (dW <= tol && (!bestWMatch || dW < bestWMatch.dist)) {
          bestWMatch = { dist: dW, w: o.w, other: o };
        }
      });
      if (bestWMatch) {
        nw = Math.max(24, Math.round(bestWMatch.w));
        if (dir.includes('w')) nx = orig.x + (orig.w - nw);
        snappedX = true;
      } else {
        const edgeX = dir.includes('e') ? (nx + nw) : nx;
        const xTargets = [bw / 2, 0, bw];
        others.forEach(o => { xTargets.push(o.x, o.x + o.w / 2, o.x + o.w); });
        let bestT = null;
        xTargets.forEach(t => {
          const dist = Math.abs(edgeX - t);
          if (dist <= tol && (!bestT || dist < bestT.dist)) bestT = { dist, t };
        });
        if (bestT) {
          if (dir.includes('e')) nw = Math.max(24, Math.round(bestT.t - nx));
          else { nw = Math.max(24, Math.round(orig.x + orig.w - bestT.t)); nx = orig.x + orig.w - nw; }
          snappedX = true;
          vlines.push({ x: bestT.t, y1: 0, y2: bh, label: bestT.t === bw / 2 ? '盤面中央' : '' });
        }
      }
    }

    if (dir.includes('s') || dir.includes('n')) {
      others.forEach(o => {
        const dH = Math.abs(nh - o.h);
        if (dH <= tol && (!bestHMatch || dH < bestHMatch.dist)) {
          bestHMatch = { dist: dH, h: o.h, other: o };
        }
      });
      if (bestHMatch) {
        nh = Math.max(24, Math.round(bestHMatch.h));
        if (dir.includes('n')) ny = orig.y + (orig.h - nh);
        snappedY = true;
      } else {
        const edgeY = dir.includes('s') ? (ny + nh) : ny;
        const yTargets = [bh / 2, 0, bh];
        others.forEach(o => { yTargets.push(o.y, o.y + o.h / 2, o.y + o.h); });
        let bestT = null;
        yTargets.forEach(t => {
          const dist = Math.abs(edgeY - t);
          if (dist <= tol && (!bestT || dist < bestT.dist)) bestT = { dist, t };
        });
        if (bestT) {
          if (dir.includes('s')) nh = Math.max(24, Math.round(bestT.t - ny));
          else { nh = Math.max(24, Math.round(orig.y + orig.h - bestT.t)); ny = orig.y + orig.h - nh; }
          snappedY = true;
          hlines.push({ y: bestT.t, x1: 0, x2: bw, label: bestT.t === bh / 2 ? '盤面中央' : '' });
        }
      }
    }

    if (!snappedX) {
      nw = Math.max(24, snapGridVal(nw));
      if (dir.includes('w')) nx = orig.x + (orig.w - nw);
    }
    if (!snappedY) {
      nh = Math.max(24, snapGridVal(nh));
      if (dir.includes('n')) ny = orig.y + (orig.h - nh);
    }

    if (lockAspect && ratio > 0) {
      const useW = (snappedX && !snappedY) || (!(snappedY && !snappedX) && Math.abs(dx) >= Math.abs(dy));
      if (useW) {
        nh = Math.max(24, Math.round(nw / ratio));
        if (dir.includes('n')) ny = orig.y + (orig.h - nh);
      } else {
        nw = Math.max(24, Math.round(nh * ratio));
        if (dir.includes('w')) nx = orig.x + (orig.w - nw);
      }
    }

    nx = Math.round(nx); ny = Math.round(ny); nw = Math.round(nw); nh = Math.round(nh);
    others.forEach(o => {
      const wEq = Math.abs(nw - o.w) <= 1;
      const hEq = Math.abs(nh - o.h) <= 1;
      if (wEq || hEq) {
        const tags = [wEq ? `W:${nw}` : '', hEq ? `H:${nh}` : ''].filter(Boolean).join(' ');
        sizeMatches.push({ x: o.x, y: o.y, w: o.w, h: o.h, label: `${tags} 同一サイズ` });
      }
    });
    if (sizeMatches.length) {
      sizeMatches.push({ x: nx, y: ny, w: nw, h: nh, label: `${nw}×${nh}px`, cyan: true });
    }

    return { x: nx, y: ny, w: nw, h: nh, vlines, hlines, sizeMatches };
  }

  function renderSmartGuides(guidesEl, guides) {
    if (!guidesEl) return;
    if (!guides) { guidesEl.innerHTML = ''; return; }
    const html = [];
    (guides.vlines || []).forEach(v => {
      const cy = v.cyan ? ' cyan' : '';
      html.push(`<div class="ccf-bp-gline v${cy}" style="left:${v.x}px;top:${v.y1}px;height:${Math.max(1, v.y2 - v.y1)}px;"></div>`);
      if (v.label) html.push(`<div class="ccf-bp-gbadge${cy}" style="left:${v.x + 6}px;top:${Math.max(4, v.y1 + 6)}px;">${esc(v.label)}</div>`);
    });
    (guides.hlines || []).forEach(h => {
      const cy = h.cyan ? ' cyan' : '';
      html.push(`<div class="ccf-bp-gline h${cy}" style="top:${h.y}px;left:${h.x1}px;width:${Math.max(1, h.x2 - h.x1)}px;"></div>`);
      if (h.label) html.push(`<div class="ccf-bp-gbadge${cy}" style="left:${Math.max(4, h.x1 + 6)}px;top:${h.y + 6}px;">${esc(h.label)}</div>`);
    });
    (guides.sizeMatches || []).forEach(m => {
      html.push(`<div class="ccf-bp-gsize" style="left:${m.x}px;top:${m.y}px;width:${m.w}px;height:${m.h}px;"></div>`);
      html.push(`<div class="ccf-bp-gbadge cyan" style="left:${m.x}px;top:${Math.max(0, m.y - 22)}px;">${esc(m.label)}</div>`);
    });
    guidesEl.innerHTML = html.join('');
  }

  function positionFloatingMenu(menuEl, left, top) {
    document.body.appendChild(menuEl);
    const pad = 8;
    const rect = menuEl.getBoundingClientRect();
    let x = Math.round(left);
    let y = Math.round(top);
    if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad);
    if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - rect.height - pad);
    menuEl.style.left = Math.max(pad, x) + 'px';
    menuEl.style.top = Math.max(pad, y) + 'px';

    const onDown = ev => {
      if (ev.target && menuEl.contains(ev.target)) return;
      closeActiveMenu();
    };
    const onKey = ev => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeActiveMenu();
      }
    };
    const onResize = () => closeActiveMenu();
    setTimeout(() => {
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', onResize);
    }, 0);
    UI._activeMenuEl = menuEl;
    UI._activeMenuCleanup = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }

  function openMarkerAddMenu(anchorEl, targetId) {
    closeActiveMenu();
    const sc = getBoardTargetScene(targetId);
    if (!sc) {
      return say('📌 マーカーパネルは各シーンに属します。上の「シーン切り替え一覧」からシーンを選択して追加してください');
    }
    const menu = document.createElement('div');
    menu.className = 'ccf-bp-dropdown';
    menu.innerHTML = `<div class="ccf-bp-menu-sub">📌 マーカーパネルを追加</div>
      <button type="button" class="ccf-bp-menu-item" data-mk-add="image">🖼️ 画像を選んで追加</button>
      <button type="button" class="ccf-bp-menu-item" data-mk-add="blank">🟦 色・テキスト枠パネルを追加</button>`;
    menu.addEventListener('click', e => {
      const btn = e.target.closest('[data-mk-add]');
      if (!btn) return;
      const mode = btn.dataset.mkAdd;
      closeActiveMenu();
      if (mode === 'image') addPanelViaPicker('marker', targetId);
      else addBlankMarker(targetId);
    });
    const r = anchorEl.getBoundingClientRect();
    positionFloatingMenu(menu, r.left, r.bottom + 4);
  }

  function openNpcSinglePickerMenu(anchorEl) {
    closeActiveMenu();
    ensureProjShape();
    const npcs = S.proj.npcs || [];
    const stocks = S.proj.stocks || [];
    const dummies = stocks.length ? M.buildDummyPieces(stocks, S.proj.settings) : [];
    const clues = stocks.length ? M.buildCluePieces(stocks) : [];
    if (!npcs.length && !dummies.length && !clues.length) {
      return say('先に「👤 NPC管理」でNPC、または「📝 テキスト・情報駒」でテキストを登録してください');
    }
    const placedIds = new Set((S.proj.board.pieces || []).map(p => p.npcId).filter(Boolean));
    const placedNames = new Set((S.proj.board.pieces || []).filter(p => !p.npcId).map(p => p.name));
    const menu = document.createElement('div');
    menu.className = 'ccf-bp-dropdown';
    const npcHtml = npcs.length ? `<div class="ccf-bp-menu-sub">👤 登録NPC（${npcs.length}）</div>` + npcs.map((npc, idx) => {
      const head = (npc.images && npc.images[0]) || {};
      const src = head.dataUrl || npc.iconDataUrl || fileUrl(head.filePath || head.path || npc.imagePath);
      const isPlaced = placedIds.has(npc.id);
      return `<button type="button" class="ccf-bp-menu-item" data-npc-pick-idx="${idx}">
        ${src ? `<img class="ccf-bp-menu-thumb" src="${esc(src)}" alt="">` : '<span>♟️</span>'}
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(npc.name || 'NPC ' + (idx + 1))}</span>
        ${isPlaced ? '<span class="ccf-bp-menu-badge">配置済</span>' : '<span class="ccf-bp-menu-badge">＋配置</span>'}
      </button>`;
    }).join('') : '';
    const dummyHtml = dummies.length ? `<div class="ccf-bp-menu-sub">🧩 ダミー駒（チャットパレット用）</div>` + dummies.map((dm, idx) => {
      const isPlaced = placedNames.has(dm.name);
      return `<button type="button" class="ccf-bp-menu-item" data-dummy-pick-idx="${idx}">
        <span>🧩</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(dm.name || 'ダミー駒')}</span>
        ${isPlaced ? '<span class="ccf-bp-menu-badge">配置済</span>' : '<span class="ccf-bp-menu-badge">＋配置</span>'}
      </button>`;
    }).join('') : '';
    const clueHtml = clues.length ? `<div class="ccf-bp-menu-sub">🔎 情報・手がかり駒（${clues.length}）</div>` + clues.map((cl, idx) => {
      const isPlaced = placedNames.has(cl.name);
      return `<button type="button" class="ccf-bp-menu-item" data-clue-pick-idx="${idx}">
        <span>🔎</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(cl.name || '情報駒')}</span>
        ${isPlaced ? '<span class="ccf-bp-menu-badge">配置済</span>' : '<span class="ccf-bp-menu-badge">＋配置</span>'}
      </button>`;
    }).join('') : '';

    menu.innerHTML = npcHtml + (npcHtml && (dummyHtml || clueHtml) ? '<div class="ccf-bp-menu-sep"></div>' : '') + dummyHtml + clueHtml;

    menu.addEventListener('click', e => {
      const btn = e.target.closest('[data-npc-pick-idx]');
      if (btn) {
        const npc = npcs[+btn.dataset.npcPickIdx];
        closeActiveMenu();
        if (npc) placeSingleNpcOnBoard(npc);
        return;
      }
      const dmBtn = e.target.closest('[data-dummy-pick-idx]');
      if (dmBtn) {
        const dm = dummies[+dmBtn.dataset.dummyPickIdx];
        closeActiveMenu();
        if (dm) placeSingleDummyPieceOnBoard(dm);
        return;
      }
      const clBtn = e.target.closest('[data-clue-pick-idx]');
      if (clBtn) {
        const cl = clues[+clBtn.dataset.cluePickIdx];
        closeActiveMenu();
        if (cl) placeSingleDummyPieceOnBoard(cl);
      }
    });

    const r = anchorEl.getBoundingClientRect();
    positionFloatingMenu(menu, r.left, r.bottom + 4);
  }

  function openSceneRowContextMenu(clientX, clientY, sceneId) {
    closeActiveMenu();
    const idx = S.proj.scenes.findIndex(s => s.id === sceneId);
    if (idx < 0) return;
    const sc = S.proj.scenes[idx];
    const menu = document.createElement('div');
    menu.className = 'ccf-bp-ctx';
    menu.innerHTML = `
      <div class="ccf-bp-menu-sub">🎬 ${esc(sc.title || '無題のシーン')}</div>
      <button type="button" class="ccf-bp-menu-item" data-srow-ctx="dup">📋 シーンを複製</button>
      <button type="button" class="ccf-bp-menu-item" data-srow-ctx="up"${idx === 0 ? ' disabled' : ''}>▲ 上へ移動</button>
      <button type="button" class="ccf-bp-menu-item" data-srow-ctx="dn"${idx === S.proj.scenes.length - 1 ? ' disabled' : ''}>▼ 下へ移動</button>
      <div class="ccf-bp-menu-sep"></div>
      <button type="button" class="ccf-bp-menu-item danger" data-srow-ctx="del">🗑️ このシーンを削除</button>
    `;
    menu.addEventListener('click', async e => {
      const b = e.target.closest('[data-srow-ctx]');
      if (!b) return;
      const act = b.dataset.srowCtx;
      closeActiveMenu();
      if (act === 'dup') return duplicateSceneById(sceneId);
      if (act === 'up') return moveSceneByOffset(sceneId, -1);
      if (act === 'dn') return moveSceneByOffset(sceneId, 1);
      if (act === 'del') {
        const curIdx = S.proj.scenes.findIndex(s => s.id === sceneId);
        if (curIdx < 0) return;
        const ok = typeof appConfirm === 'function'
          ? await appConfirm(`シーン「${sc.title || '無題のシーン'}」を削除しますか？`, { okText: '削除', danger: true })
          : confirm(`シーン「${sc.title || '無題のシーン'}」を削除しますか？`);
        if (!ok) return;
        cp('シーン削除');
        S.proj.scenes.splice(curIdx, 1);
        if (UI.boardTarget === sceneId) {
          setBoardTarget((S.proj.scenes[curIdx] && S.proj.scenes[curIdx].id) || (S.proj.scenes[curIdx - 1] && S.proj.scenes[curIdx - 1].id) || 'global');
        }
        candidateCache.clear();
        CCF.saveProject();
        refreshBoardContainers();
        say(`🗑️「${sc.title || '無題のシーン'}」を削除しました`);
      }
    });
    positionFloatingMenu(menu, clientX, clientY);
  }

  function openBoardContextMenu(clientX, clientY, targetId, itemId) {
    closeActiveMenu();
    const targetScene = getBoardTargetScene(targetId);
    const layers = collectBoardLayers(targetId);
    const selLayers = layers.filter(l => UI.selectedIds.has(l.item.id));
    const menu = document.createElement('div');
    menu.className = 'ccf-bp-ctx';

    if (!selLayers.length) {
      menu.innerHTML = `
        <div class="ccf-bp-menu-sub">➕ 盤面へ追加</div>
        <button type="button" class="ccf-bp-menu-item" data-ctx="add-screen">＋ スクリーンパネル（部屋常駐）</button>
        <button type="button" class="ccf-bp-menu-item" data-ctx="add-marker">📌 マーカーパネルを追加（画像）</button>
        <button type="button" class="ccf-bp-menu-item" data-ctx="add-blank-marker">📌 マーカーパネルを追加（色枠）</button>
        <div class="ccf-bp-menu-sep"></div>
        <button type="button" class="ccf-bp-menu-item" data-ctx="add-bg">🖼️ 背景画像を設定</button>
        <button type="button" class="ccf-bp-menu-item" data-ctx="add-fg">🪟 前景画像（盤面）を設定</button>
        ${targetScene ? `<div class="ccf-bp-menu-sep"></div><button type="button" class="ccf-bp-menu-item" data-ctx="dup-scene">📋 シーンを複製</button>` : ''}
      `;
      menu.addEventListener('click', e => {
        const b = e.target.closest('[data-ctx]');
        if (!b) return;
        const c = b.dataset.ctx;
        closeActiveMenu();
        if (c === 'add-screen') addPanelViaPicker('screen', targetId);
        else if (c === 'add-marker') addPanelViaPicker('marker', targetId);
        else if (c === 'add-blank-marker') addBlankMarker(targetId);
        else if (c === 'add-bg') addPanelViaPicker('bg', targetId);
        else if (c === 'add-fg') addPanelViaPicker('fg', targetId);
        else if (c === 'dup-scene' && targetScene) duplicateSceneById(targetScene.id);
      });
      return positionFloatingMenu(menu, clientX, clientY);
    }

    const hit = itemId ? selLayers.find(l => l.item.id === itemId) : null;
    const it = (hit && hit.item) || selLayers[0].item;
    const isSingle = selLayers.length === 1;
    const selPanels = selLayers.filter(l => l.item.kind === 'screen' || l.item.kind === 'marker');
    const allVisible = selLayers.every(l => l.item.visible !== false);
    const allLocked = selLayers.every(l => !!l.item.locked);

    const rows = [];
    rows.push(`<div class="ccf-bp-menu-sub">${isSingle ? esc(it.name || '要素') : `${selLayers.length}件を選択中`}</div>`);

    if (selPanels.length >= 2) {
      rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="combine">🧩 選択したパネルを結合して1枚のパネルにする (${selPanels.length}枚)</button>`);
      rows.push('<div class="ccf-bp-menu-sep"></div>');
    }

    if (isSingle) {
      rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="change-img">🖼️ 画像を変更...</button>`);
      rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="rename">🏷️ 管理名を編集...</button>`);
      if (it.kind !== 'piece') {
        rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="edit-text">💬 パネル内テキストを編集...</button>`);
      }
      rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="toggle-pin">${it.locked ? '📌 固定を解除' : '📌 固定（位置・サイズロック）'}</button>`);
      rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="toggle-lock">${it.lockAspect ? '🔓 比率固定を解除' : '🔒 縦横比を固定'}</button>`);
      rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="toggle-vis">${it.visible !== false ? '🚫 非表示にする' : '👁️ 表示する'}</button>`);
      if (it.kind !== 'piece') {
        const isFront = (it.zIndex || 0) >= 101;
        rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="toggle-z101">${isFront ? '🔻 優先度を 0（駒より下）にする' : '🔺 優先度を 101（駒より上）にする'}</button>`);
      }
      if (it.kind === 'marker') {
        rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="sync-scenes">📌 チェック済みシーンへ座標同期</button>`);
      }
    } else {
      rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="toggle-pin">${allLocked ? '📌 選択要素の固定を解除' : '📌 選択要素を固定'}</button>`);
      rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="toggle-vis">${allVisible ? '🚫 選択要素を非表示' : '👁️ 選択要素を表示'}</button>`);
    }

    rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="dup">📋 複製</button>`);
    rows.push('<div class="ccf-bp-menu-sep"></div>');
    rows.push('<div class="ccf-bp-menu-sub">📐 整列</div>');
    rows.push(`<div class="ccf-bp-align-grid">
      <button type="button" data-ctx-align="left">左揃え</button>
      <button type="button" data-ctx-align="hcenter">左右中央</button>
      <button type="button" data-ctx-align="right">右揃え</button>
      <button type="button" data-ctx-align="top">上揃え</button>
      <button type="button" data-ctx-align="vcenter">上下中央</button>
      <button type="button" data-ctx-align="bottom">下揃え</button>
    </div>`);
    rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx-align="board-center">🎯 盤面中央へ移動</button>`);
    if (targetScene) {
      rows.push('<div class="ccf-bp-menu-sep"></div>');
      rows.push(`<button type="button" class="ccf-bp-menu-item" data-ctx="dup-scene">📋 シーンを複製</button>`);
    }
    rows.push('<div class="ccf-bp-menu-sep"></div>');
    rows.push(`<button type="button" class="ccf-bp-menu-item danger" data-ctx="delete">🗑️ 削除 (Delete)</button>`);

    menu.innerHTML = rows.join('');
    menu.addEventListener('click', async e => {
      const ab = e.target.closest('[data-ctx-align]');
      if (ab) {
        const mode = ab.dataset.ctxAlign;
        const ids = new Set(UI.selectedIds);
        closeActiveMenu();
        alignBoardItems(targetId, ids, mode);
        return;
      }
      const b = e.target.closest('[data-ctx]');
      if (!b) return;
      const c = b.dataset.ctx;
      const ids = new Set(UI.selectedIds);
      closeActiveMenu();
      if (c === 'combine') return combineSelectedPanels(targetId);
      if (c === 'change-img') return changeItemImageViaPicker(it);
      if (c === 'rename') {
        const nextName = await promptTextModal('🏷️ 管理名（ツール用）を入力してください', it.name || '');
        if (nextName === null) return;
        cp('管理名を編集');
        it.name = String(nextName).trim() || it.name;
        CCF.saveProject();
        return refreshBoardContainers();
      }
      if (c === 'edit-text') {
        const nextText = await promptTextModal('💬 パネル内テキスト（空欄で盤面上に非表示）', it.text || '');
        if (nextText === null) return;
        cp('パネル内テキストを編集');
        it.text = String(nextText);
        CCF.saveProject();
        return refreshBoardContainers();
      }
      if (c === 'toggle-pin') {
        cp('位置・サイズ固定切替');
        if (isSingle) it.locked = !it.locked;
        else { const nextLock = !allLocked; selLayers.forEach(l => { l.item.locked = nextLock; }); }
        CCF.saveProject();
        return refreshBoardContainers();
      }
      if (c === 'toggle-lock') { cp('縦横比固定切替'); it.lockAspect = !it.lockAspect; CCF.saveProject(); return refreshBoardContainers(); }
      if (c === 'toggle-vis') {
        cp('表示切替');
        const nextVis = !allVisible;
        selLayers.forEach(l => { l.item.visible = nextVis; });
        CCF.saveProject();
        return refreshBoardContainers();
      }
      if (c === 'toggle-z101') {
        if (it.kind === 'piece') return;
        cp('駒との前後優先度を切替');
        it.zIndex = (it.zIndex || 0) >= 101 ? 0 : 101;
        CCF.saveProject();
        return refreshBoardContainers();
      }
      if (c === 'sync-scenes') return syncItemToCheckedScenes(it);
      if (c === 'dup') return duplicateBoardItems(targetId, ids);
      if (c === 'dup-scene' && targetScene) return duplicateSceneById(targetScene.id);
      if (c === 'delete') {
        const n = removeLayersByIds(targetId, [...ids]);
        if (n) { refreshBoardContainers(); say(`🗑️ ${n}件削除しました`); }
      }
    });

    positionFloatingMenu(menu, clientX, clientY);
  }

  function wireBoardInteractions(container, targetId, inModal) {
    if (!container) return;
    if (container._bpCleanup) { container._bpCleanup(); container._bpCleanup = null; }
    const wrap = container.querySelector('.ccf-bp-stage-wrap');
    const cv = container.querySelector('[data-bp-canvas]');
    if (!wrap || !cv) return;
    const stageChanged = !UI.cameraFitted || (wrap.clientWidth >= 40 && wrap.clientHeight >= 40 && (wrap.clientWidth !== UI._fittedStageW || wrap.clientHeight !== UI._fittedStageH));
    applyBoardCanvasScale(container, stageChanged);
    const guidesEl = cv.querySelector('[data-bp-guides]');

    let rafFit = 0;
    if (!UI.cameraFitted || stageChanged) {
      rafFit = requestAnimationFrame(() => applyBoardCanvasScale(container, true));
    }

    let ro = null, rafResize = 0;
    let lastStageW = wrap.clientWidth, lastStageH = wrap.clientHeight;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => {
        const w = wrap.clientWidth, h = wrap.clientHeight;
        if (w < 40 || h < 40) return;
        if (w === lastStageW && h === lastStageH) return;
        lastStageW = w;
        lastStageH = h;
        if (rafResize) cancelAnimationFrame(rafResize);
        rafResize = requestAnimationFrame(() => {
          rafResize = 0;
          applyBoardCanvasScale(container, true);
        });
      });
      ro.observe(wrap);
    }

    let drag = null;
    let panDrag = null;
    let marqueeDrag = null;
    let spaceHeld = false;
    let candDebounce = null;
    const activeTarget = () => UI.boardTarget || targetId;
    const isEditable = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

    const syncSelectionDom = () => {
      cv.querySelectorAll('[data-bpid]').forEach(el => {
        el.classList.toggle('sel', UI.selectedIds.has(el.dataset.bpid));
      });
      container.querySelectorAll('[data-bpl]').forEach(el => {
        el.classList.toggle('sel', UI.selectedIds.has(el.dataset.bpl));
      });
      container.querySelectorAll('[data-bp-midsel]').forEach(el => {
        el.classList.toggle('sel', UI.selectedIds.has(el.dataset.bpMidsel));
      });
    };

    const collectOtherBoxes = excludeIds => {
      const out = [];
      collectBoardLayers(activeTarget()).forEach(l => {
        if (excludeIds.has(l.item.id) || l.item.visible === false) return;
        out.push({ x: l.item.x, y: l.item.y, w: l.item.width, h: l.item.height });
      });
      return out;
    };

    const onWrapMouseDown = e => {
      const isMid = e.button === 1;
      const isLeft = e.button === 0;
      const handle = e.target.closest('[data-bph]');
      const itemEl = e.target.closest('[data-bpid]');
      const wantPan = isMid || (isLeft && spaceHeld);
      const startPan = opts => {
        panDrag = Object.assign({
          startX: e.clientX,
          startY: e.clientY,
          origPanX: UI.panX,
          origPanY: UI.panY,
          moved: false
        }, opts || {});
        wrap.classList.add('panning');
      };
      if (wantPan) {
        e.preventDefault();
        e.stopPropagation();
        closeActiveMenu();
        startPan();
        return;
      }
      if (!isLeft) return;
      closeActiveMenu();
      e.preventDefault();
      e.stopPropagation();

      const tId = activeTarget();
      const id = itemEl ? itemEl.dataset.bpid : '';
      const toggleKey = !!(e.ctrlKey || e.metaKey || e.shiftKey);
      const allLayers = collectBoardLayers(tId);
      const hit = id ? allLayers.find(l => l.item.id === id) : null;

      if (UI.marqueeMode && !handle) {
        marqueeDrag = {
          startClientX: e.clientX,
          startClientY: e.clientY,
          additive: toggleKey,
          baseIds: new Set(UI.selectedIds),
          moved: false,
          boxEl: null,
          clickItemId: id,
          toggleKey
        };
        return;
      }

      if (!itemEl && !handle) {
        if (e.shiftKey) {
          marqueeDrag = {
            startClientX: e.clientX,
            startClientY: e.clientY,
            additive: true,
            baseIds: new Set(UI.selectedIds),
            moved: false,
            boxEl: null,
            clickItemId: '',
            toggleKey: true
          };
          return;
        }
        startPan({ clearOnClick: !(e.ctrlKey || e.metaKey) });
        return;
      }

      if (!id || !hit) return;
      const it = hit.item;
      if (it.locked) {
        if (e.shiftKey && !handle) {
          marqueeDrag = {
            startClientX: e.clientX,
            startClientY: e.clientY,
            additive: true,
            baseIds: new Set(UI.selectedIds),
            moved: false,
            boxEl: null,
            clickItemId: id,
            toggleKey: true
          };
          return;
        }
        startPan({ clickItemId: id, toggleKey: !!(e.ctrlKey || e.metaKey) });
        return;
      }

      if (handle) {
        if (!UI.selectedIds.has(id) || UI.selectedIds.size !== 1) {
          setSingleSelection(id);
          syncSelectionDom();
        }
      } else if (toggleKey) {
        if (UI.selectedIds.has(id)) {
          UI.selectedIds.delete(id);
          if (UI.selectedItemId === id) UI.selectedItemId = [...UI.selectedIds][UI.selectedIds.size - 1] || '';
          syncSelectionDom();
          drag = { needRefreshOnly: true, moved: false };
          return;
        }
        UI.selectedIds.add(id);
        UI.selectedItemId = id;
        syncSelectionDom();
      } else if (!UI.selectedIds.has(id)) {
        setSingleSelection(id);
        syncSelectionDom();
      } else {
        UI.selectedItemId = id;
      }

      const sc = Number(cv.dataset.scale || UI.zoomScale || 1) || 1;
      const imgEl = itemEl.querySelector('img');
      const natRatio = (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0)
        ? (imgEl.naturalWidth / imgEl.naturalHeight)
        : (it.width / Math.max(1, it.height));
      const ratio = (it.width / Math.max(1, it.height)) || natRatio || 1;

      const escSel = v => (CSS && CSS.escape ? CSS.escape(v) : v);
      const selectedHits = handle ? [hit] : allLayers.filter(l => UI.selectedIds.has(l.item.id) && !l.item.locked);
      if (!selectedHits.length) return;
      const items = selectedHits.map(l => ({
        item: l.item,
        el: cv.querySelector(`[data-bpid="${escSel(l.item.id)}"]`),
        origX: l.item.x,
        origY: l.item.y,
        origW: l.item.width,
        origH: l.item.height
      }));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      items.forEach(d => {
        minX = Math.min(minX, d.origX);
        minY = Math.min(minY, d.origY);
        maxX = Math.max(maxX, d.origX + d.origW);
        maxY = Math.max(maxY, d.origY + d.origH);
      });
      const excludeSet = new Set(items.map(d => d.item.id));

      drag = {
        id,
        mode: handle ? 'resize' : 'move',
        dir: handle ? handle.dataset.bph : '',
        startX: e.clientX,
        startY: e.clientY,
        origX: it.x,
        origY: it.y,
        origW: it.width,
        origH: it.height,
        origUnion: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        ratio,
        scale: sc,
        moved: false,
        item: it,
        el: itemEl,
        items,
        others: collectOtherBoxes(excludeSet)
      };
    };
    wrap.addEventListener('mousedown', onWrapMouseDown);
    const onAuxClick = e => { if (e.button === 1) e.preventDefault(); };
    wrap.addEventListener('auxclick', onAuxClick);

    const onContextMenu = e => {
      if (e.target.closest('[data-bp-guides]')) return;
      e.preventDefault();
      e.stopPropagation();
      const tId = activeTarget();
      const itemEl = e.target.closest('[data-bpid]');
      if (itemEl) {
        const id = itemEl.dataset.bpid;
        if (!UI.selectedIds.has(id)) {
          setSingleSelection(id);
          refreshBoardContainers();
        }
        openBoardContextMenu(e.clientX, e.clientY, tId, id);
      } else {
        openBoardContextMenu(e.clientX, e.clientY, tId, '');
      }
    };
    wrap.addEventListener('contextmenu', onContextMenu);

    const onWheel = e => {
      e.preventDefault();
      closeActiveMenu();
      const delta = Math.max(-240, Math.min(240, e.deltaY));
      const factor = Math.exp(-delta * 0.0018);
      zoomBoardTo(container, UI.zoomScale * factor, e.clientX, e.clientY);
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });

    const onKeyDown = e => {
      if (UI.modalOpen && !inModal) return;
      if (e.key === 'Enter' && e.target && e.target.closest && e.target.closest('[data-bp-board-dim]') && container.contains(e.target)) {
        e.preventDefault();
        e.target.blur();
        return;
      }
      if (document.querySelector('.app-dialog-overlay,.ccf-am-ov,.ccf-wiz-ov,.ccf-cutin-stage')) return;
      if (e.code === 'Space' && !isEditable(document.activeElement)) {
        if (wrap.matches(':hover') || container.contains(document.activeElement)) {
          e.preventDefault();
        }
        spaceHeld = true;
        wrap.classList.add('space-pan');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditable(document.activeElement)) {
        if (!document.body.contains(wrap) || !UI.selectedIds || !UI.selectedIds.size) return;
        if (!inModal && UI.subView !== 'board') return;
        e.preventDefault();
        closeActiveMenu();
        const n = removeLayersByIds(activeTarget(), [...UI.selectedIds]);
        if (n) {
          refreshBoardContainers();
          say(`🗑️ ${n}件の盤面要素を削除しました（Ctrl+Zで元に戻せます）`);
        }
        return;
      }
      if (e.key === 'Escape' && !isEditable(document.activeElement)) {
        if (UI._activeMenuEl) {
          e.preventDefault();
          e.stopPropagation();
          closeActiveMenu();
        } else if (!inModal && UI.selectedIds && UI.selectedIds.size) {
          setSelectionIds([], '');
          refreshBoardContainers();
        }
      }
    };
    const onKeyUp = e => {
      if (e.code === 'Space') {
        spaceHeld = false;
        wrap.classList.remove('space-pan');
      }
    };
    const onWinBlur = () => {
      spaceHeld = false;
      wrap.classList.remove('space-pan');
    };

    const onMove = e => {
      if (panDrag) {
        const dx = e.clientX - panDrag.startX;
        const dy = e.clientY - panDrag.startY;
        if (!panDrag.moved && Math.hypot(dx, dy) > 2) panDrag.moved = true;
        UI.panX = Math.round(panDrag.origPanX + dx);
        UI.panY = Math.round(panDrag.origPanY + dy);
        UI.cameraFitted = true;
        applyBoardCanvasScale(container, false);
        return;
      }
      if (marqueeDrag) {
        const dScreen = Math.hypot(e.clientX - marqueeDrag.startClientX, e.clientY - marqueeDrag.startClientY);
        if (!marqueeDrag.moved && dScreen > 4) {
          marqueeDrag.moved = true;
          const bx = document.createElement('div');
          bx.className = 'ccf-bp-marquee';
          wrap.appendChild(bx);
          marqueeDrag.boxEl = bx;
        }
        if (!marqueeDrag.moved) return;
        const wr = wrap.getBoundingClientRect();
        const x1 = Math.min(marqueeDrag.startClientX, e.clientX) - wr.left;
        const y1 = Math.min(marqueeDrag.startClientY, e.clientY) - wr.top;
        const x2 = Math.max(marqueeDrag.startClientX, e.clientX) - wr.left;
        const y2 = Math.max(marqueeDrag.startClientY, e.clientY) - wr.top;
        marqueeDrag.boxEl.style.left = x1 + 'px';
        marqueeDrag.boxEl.style.top = y1 + 'px';
        marqueeDrag.boxEl.style.width = (x2 - x1) + 'px';
        marqueeDrag.boxEl.style.height = (y2 - y1) + 'px';

        const cr = cv.getBoundingClientRect();
        const sc = Number(cv.dataset.scale || UI.zoomScale || 1) || 1;
        const cx1 = (Math.min(marqueeDrag.startClientX, e.clientX) - cr.left) / sc;
        const cy1 = (Math.min(marqueeDrag.startClientY, e.clientY) - cr.top) / sc;
        const cx2 = (Math.max(marqueeDrag.startClientX, e.clientX) - cr.left) / sc;
        const cy2 = (Math.max(marqueeDrag.startClientY, e.clientY) - cr.top) / sc;

        const nextSel = marqueeDrag.additive ? new Set(marqueeDrag.baseIds) : new Set();
        collectBoardLayers(activeTarget()).forEach(l => {
          const it = l.item;
          if (it.visible === false && !UI.showHiddenGhost) return;
          if (it.x < cx2 && (it.x + it.width) > cx1 && it.y < cy2 && (it.y + it.height) > cy1) {
            nextSel.add(it.id);
          }
        });
        UI.selectedIds = nextSel;
        UI.selectedItemId = [...nextSel][nextSel.size - 1] || '';
        syncSelectionDom();
        return;
      }
      if (!drag || drag.needRefreshOnly) return;
      const dx = (e.clientX - drag.startX) / drag.scale;
      const dy = (e.clientY - drag.startY) / drag.scale;
      if (!drag.moved && Math.hypot(dx, dy) > 2) {
        drag.moved = true;
        cp(drag.mode === 'resize' ? '盤面要素のリサイズ' : (drag.items.length > 1 ? '選択要素を一括移動' : '盤面要素の移動'));
      }
      if (!drag.moved) return;

      const bw = Number((S.proj && S.proj.board && S.proj.board.width) || 960);
      const bh = Number((S.proj && S.proj.board && S.proj.board.height) || 720);
      const snapStep = UI.snapGrid ? Math.max(4, Math.min(48, Math.round((S.proj.board.grid || 24) / 2))) : 1;
      const tol = Math.max(4, 7 / drag.scale);

      if (drag.mode === 'move') {
        const rawBox = {
          x: drag.origUnion.x + dx,
          y: drag.origUnion.y + dy,
          w: drag.origUnion.w,
          h: drag.origUnion.h
        };
        const res = computeMoveSmartGuides(rawBox, drag.others, bw, bh, tol, snapStep);
        const mdx = Math.round(res.x - drag.origUnion.x);
        const mdy = Math.round(res.y - drag.origUnion.y);
        drag.items.forEach(d => {
          d.item.x = d.origX + mdx;
          d.item.y = d.origY + mdy;
          if (d.el) {
            d.el.style.left = d.item.x + 'px';
            d.el.style.top = d.item.y + 'px';
          }
        });
        renderSmartGuides(guidesEl, res);
      } else {
        const it = drag.item;
        const origBox = { x: drag.origX, y: drag.origY, w: drag.origW, h: drag.origH };
        const res = computeResizeSmartGuides(origBox, drag.dir, dx, dy, !!it.lockAspect, drag.ratio, drag.others, bw, bh, tol, snapStep);
        it.x = res.x; it.y = res.y; it.width = res.w; it.height = res.h;
        drag.el.style.left = it.x + 'px';
        drag.el.style.top = it.y + 'px';
        drag.el.style.width = it.width + 'px';
        drag.el.style.height = it.height + 'px';
        renderSmartGuides(guidesEl, res);
      }
    };

    const onUp = () => {
      if (panDrag) {
        const pd = panDrag;
        panDrag = null;
        wrap.classList.remove('panning');
        if (!pd.moved) {
          if (pd.clickItemId) {
            if (pd.toggleKey) {
              if (UI.selectedIds.has(pd.clickItemId)) {
                UI.selectedIds.delete(pd.clickItemId);
                if (UI.selectedItemId === pd.clickItemId) UI.selectedItemId = [...UI.selectedIds][UI.selectedIds.size - 1] || '';
              } else {
                UI.selectedIds.add(pd.clickItemId);
                UI.selectedItemId = pd.clickItemId;
              }
            } else {
              setSingleSelection(pd.clickItemId);
            }
            refreshBoardContainers();
          } else if (pd.clearOnClick && UI.selectedIds.size) {
            setSelectionIds([], '');
            refreshBoardContainers();
          }
        }
        return;
      }
      if (marqueeDrag) {
        if (marqueeDrag.boxEl) marqueeDrag.boxEl.remove();
        if (!marqueeDrag.moved) {
          if (marqueeDrag.clickItemId) {
            const cid = marqueeDrag.clickItemId;
            if (marqueeDrag.toggleKey) {
              if (UI.selectedIds.has(cid)) {
                UI.selectedIds.delete(cid);
                if (UI.selectedItemId === cid) UI.selectedItemId = [...UI.selectedIds][UI.selectedIds.size - 1] || '';
              } else {
                UI.selectedIds.add(cid);
                UI.selectedItemId = cid;
              }
            } else {
              setSingleSelection(cid);
            }
          } else if (!marqueeDrag.additive) {
            setSelectionIds([], '');
          }
        }
        marqueeDrag = null;
        refreshBoardContainers();
        return;
      }
      if (!drag) return;
      renderSmartGuides(guidesEl, null);
      const wasMoved = !!drag.moved;
      drag = null;
      if (wasMoved) CCF.saveProject();
      refreshBoardContainers();
    };

    const onClick = async e => {
      // チェックボックス Shift+クリック範囲選択
      const schk = e.target.closest('[data-bp-schk]');
      if (schk) {
        e.stopPropagation();
        const idx = +schk.dataset.bpSchk;
        const scenes = S.proj.scenes;
        if (e.shiftKey && UI.lastCheckedIdx >= 0 && UI.lastCheckedIdx < scenes.length) {
          const lo = Math.min(UI.lastCheckedIdx, idx), hi = Math.max(UI.lastCheckedIdx, idx);
          const state = schk.checked;
          for (let k = lo; k <= hi; k++) scenes[k].checked = state;
        } else if (scenes[idx]) {
          scenes[idx].checked = schk.checked;
        }
        UI.lastCheckedIdx = idx;
        CCF.saveProject();
        refreshBoardContainers();
        return;
      }

      if (handleSlotActionClick(e, refreshBoardContainers)) {
        e.stopPropagation();
        return;
      }

      const msgCopyBtn = e.target.closest('[data-scn-msg-copy],[data-scn-msg-title],[data-scn-msg-clear]');
      if (msgCopyBtn) {
        e.stopPropagation();
        const sid = msgCopyBtn.dataset.scnMsgCopy || msgCopyBtn.dataset.scnMsgTitle || msgCopyBtn.dataset.scnMsgClear;
        const sc = getBoardTargetScene(sid);
        if (sc) {
          const actName = msgCopyBtn.dataset.scnMsgCopy ? 'copy' : msgCopyBtn.dataset.scnMsgTitle ? 'title' : 'clear';
          const escSid = CSS.escape ? CSS.escape(sid) : sid;
          const textEl = container.querySelector(`[data-bp-scn-text="${escSid}"]`);
          const msgEl = container.querySelector(`[data-bp-scn-msg="${escSid}"]`);
          applySceneMessageAction(sc, actName, textEl, msgEl);
        }
        return;
      }

      const b = e.target.closest('[data-bp]');
      if (b) {
        e.stopPropagation();
        const act = b.dataset.bp, tId = activeTarget(), id = b.dataset.id || UI.selectedItemId;
        if (act === 'open-modal') return openBoardModal(tId);
        if (act === 'close-modal') return closeBoardModal();
        if (act === 'zoom-in') { zoomBoardTo(container, UI.zoomScale * 1.15, null, null); return; }
        if (act === 'zoom-out') { zoomBoardTo(container, UI.zoomScale / 1.15, null, null); return; }
        if (act === 'zoom-fit') { applyBoardCanvasScale(container, true); return; }
        if (act === 'marquee-mode') {
          UI.marqueeMode = !UI.marqueeMode;
          wrap.classList.toggle('marquee-mode', UI.marqueeMode);
          b.classList.toggle('active', UI.marqueeMode);
          b.setAttribute('aria-pressed', String(UI.marqueeMode));
          return;
        }
        if (act === 'pin-selected') {
          const selHits = collectBoardLayers(tId).filter(l => UI.selectedIds.has(l.item.id));
          if (!selHits.length) return;
          cp('選択要素の固定切替');
          const nextLock = !selHits.every(l => !!l.item.locked);
          selHits.forEach(l => { l.item.locked = nextLock; });
          CCF.saveProject();
          return refreshBoardContainers();
        }
        if (act === 'undo') { if (window.AppHistory) window.AppHistory.undo(); return; }
        if (act === 'redo') { if (window.AppHistory) window.AppHistory.redo(); return; }
        if (act === 'add-bg') return addPanelViaPicker('bg', tId);
        if (act === 'add-fg') return addPanelViaPicker('fg', tId);
        if (act === 'fit-board-to-fg') return fitBoardToForeground(tId);
        if (act === 'reset-board-40x30') {
          ensureProjShape();
          cp('盤面サイズを40×30(標準)に戻す');
          S.proj.board.width = 960;
          S.proj.board.height = 720;
          S.proj.board.customSize = false;
          UI.cameraFitted = false;
          CCF.saveProject();
          refreshBoardContainers();
          say('↺ 盤面サイズを標準の 40 × 30 マス（960×720px）に戻しました');
          return;
        }
        if (act === 'add-screen') return addPanelViaPicker('screen', tId);
        if (act === 'add-marker') return addPanelViaPicker('marker', tId);
        if (act === 'add-marker-menu') return openMarkerAddMenu(b, tId);
        if (act === 'add-blank-marker') return addBlankMarker(tId);
        if (act === 'sync-npcs') return syncNpcsToBoard();
        if (act === 'pick-npc-menu') return openNpcSinglePickerMenu(b);
        if (act === 'combine-panels') return combineSelectedPanels(tId);
        if (act === 'align-sel') return alignBoardItems(tId, UI.selectedIds, b.dataset.align || 'left');
        if (act === 'del-selected') {
          const n = removeLayersByIds(tId, [...UI.selectedIds]);
          if (n) { refreshBoardContainers(); say(`🗑️ ${n}件削除しました`); }
          return;
        }
        if (act === 'clr-g-bg') { cp('共通背景を解除'); S.proj.globalDecor.bg = null; CCF.saveProject(); return refreshBoardContainers(); }
        if (act === 'clr-g-fg') { cp('共通前景を解除'); S.proj.globalDecor.fg = null; CCF.saveProject(); return refreshBoardContainers(); }
        if (act === 'clr-scn-fg') { const sc = getBoardTargetScene(tId); if (sc) { cp('シーン前景を解除'); sc.fg = null; CCF.saveProject(); refreshBoardContainers(); } return; }
        if (act === 'add-empty-scn') {
          cp('空シーン追加');
          const sc = M.sanitizeScene({ title: 'シーン ' + (S.proj.scenes.length + 1), text: '' });
          insertScenesAfterSelection(sc);
          CCF.saveProject();
          return refreshBoardContainers();
        }
        if (act === 'add-sel-scn') { createSceneFromSelection(); return; }
        if (act === 'dup-cur-scn') return duplicateSceneById(tId);
        if (act === 'del-cur-scn') return deleteSceneById(tId);
        if (act === 'dup-scn') return duplicateSceneById(b.dataset.scnId);
        if (act === 'del-one-scn') return deleteSceneById(b.dataset.scnId);
        if (act === 'scn-up') return moveSceneByOffset(b.dataset.scnId, -1);
        if (act === 'scn-dn') return moveSceneByOffset(b.dataset.scnId, 1);
        if (act === 'chk-all-scn') {
          cp('シーン選択切替');
          const on = !S.proj.scenes.every(s => s.checked);
          S.proj.scenes.forEach(s => { s.checked = on; });
          CCF.saveProject();
          return refreshBoardContainers();
        }
        if (act === 'del-chk-scn') {
          const targets = S.proj.scenes.filter(s => s.checked);
          if (!targets.length) return;
          const ok = typeof appConfirm === 'function'
            ? await appConfirm(`チェックした ${targets.length}件のシーンを削除しますか？`, { okText: '削除', danger: true })
            : confirm(`チェックした ${targets.length}件のシーンを削除しますか？`);
          if (!ok) return;
          cp('選択シーン削除');
          S.proj.scenes = S.proj.scenes.filter(s => !s.checked);
          if (UI.boardTarget !== 'global' && !S.proj.scenes.some(s => s.id === UI.boardTarget)) {
            setBoardTarget(S.proj.scenes[0] ? S.proj.scenes[0].id : 'global');
          }
          candidateCache.clear();
          CCF.saveProject();
          return refreshBoardContainers();
        }
        if (act === 'open-split-editor') return openSceneSplitEditorModal(tId);
        if (act === 'split-cursor') {
          const ta = container.querySelector(`[data-bp-scn-text="${CSS.escape ? CSS.escape(tId) : tId}"]`) || container.querySelector('.ccf-bp-scn-text');
          return splitSceneAtCursorById(tId, ta);
        }
        if (act === 'insert-delim') {
          const ta = container.querySelector('.ccf-bp-scn-text');
          return insertDelimiterInTextarea(tId, ta);
        }
        if (act === 'split-delim') return splitSceneAtDelimitersById(tId);
        if (act === 'append-sel') return applySelectionToScene(tId, 'append');
        if (act === 'replace-sel') return applySelectionToScene(tId, 'replace');
        if (act === 'calc-cands') {
          const sc = getBoardTargetScene(tId);
          if (sc) { computeCandidatesForScene(sc, getMatchSources()); refreshBoardContainers(); say('✨ 素材候補を更新しました'); }
          return;
        }
        if (act === 'auto-assign') return autoAssignTopCandidates();
        if (act === 'batch-apply') return batchApplyAssetsToChecked(tId);
        if (act === 'unify-bgm-vol') {
          const sc = getBoardTargetScene(tId);
          return unifyBgmVolumeFromScene(sc);
        }

        const hit = id ? findLayerById(tId, id) : null;
        if (!hit) return;
        const it = hit.item;
        if (act === 'scale-50' || act === 'scale-100' || act === 'fit-board' || act === 'center-item') {
          return applyInspectorScaleAction(container, act, it);
        }
        if (act === 'eye') { cp('表示切替'); it.visible = !it.visible; CCF.saveProject(); return refreshBoardContainers(); }
        if (act === 'pin') { cp('位置・サイズ固定切替'); it.locked = !it.locked; CCF.saveProject(); return refreshBoardContainers(); }
        if (act === 'lock') { cp('縦横比固定切替'); it.lockAspect = !it.lockAspect; CCF.saveProject(); return refreshBoardContainers(); }
        if (act === 'del') { if (removeLayerById(tId, id)) refreshBoardContainers(); return; }
        if (act === 'toggle-z101') {
          if (it.kind === 'piece') return;
          cp('駒との前後優先度を切替');
          it.zIndex = (it.zIndex || 0) >= 101 ? 0 : 101;
          CCF.saveProject();
          return refreshBoardContainers();
        }
        if (act === 'zup' || act === 'zdn' || act === 'ztop' || act === 'zbot') {
          cp('重ね順変更');
          const all = collectBoardLayers(tId).map(x => x.item);
          const zs = all.filter(x => x.kind !== 'piece').map(x => x.zIndex || 0);
          if (act === 'zup') it.zIndex = (it.zIndex || 0) + 1;
          else if (act === 'zdn') it.zIndex = Math.max(0, (it.zIndex || 0) - 1);
          else if (act === 'ztop') it.zIndex = (zs.length ? Math.max(...zs) : 0) + 1;
          else if (act === 'zbot') it.zIndex = Math.max(0, (zs.length ? Math.min(...zs) : 0) - 1);
          CCF.saveProject();
          return refreshBoardContainers();
        }
        if (act === 'sync-scenes') return syncItemToCheckedScenes(it);
        return;
      }

      const pickRow = e.target.closest('[data-bp-pick]');
      if (pickRow) {
        e.stopPropagation();
        setBoardTarget(pickRow.dataset.bpPick);
        setSelectionIds([], '');
        return refreshBoardContainers();
      }

      const midRow = e.target.closest('[data-bp-midsel]');
      if (midRow) {
        e.stopPropagation();
        const mid = midRow.dataset.bpMidsel;
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          if (UI.selectedIds.has(mid)) {
            UI.selectedIds.delete(mid);
            if (UI.selectedItemId === mid) UI.selectedItemId = [...UI.selectedIds][UI.selectedIds.size - 1] || '';
          } else {
            UI.selectedIds.add(mid);
            UI.selectedItemId = mid;
          }
        } else {
          setSingleSelection(mid);
        }
        return refreshBoardContainers();
      }

      const lrow = e.target.closest('[data-bpl]');
      if (lrow) {
        e.stopPropagation();
        const lid = lrow.dataset.bpl;
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          if (UI.selectedIds.has(lid)) {
            UI.selectedIds.delete(lid);
            if (UI.selectedItemId === lid) UI.selectedItemId = [...UI.selectedIds][UI.selectedIds.size - 1] || '';
          } else {
            UI.selectedIds.add(lid);
            UI.selectedItemId = lid;
          }
        } else {
          setSingleSelection(lid);
        }
        refreshBoardContainers();
      }
    };

    const onChange = e => {
      const dimInp = e.target.closest('[data-bp-board-dim]');
      if (dimInp) {
        const b = S.proj.board;
        const grid = Number(b.grid) || 24;
        const cells = Math.max(4, Math.min(166, Math.round(Number(dimInp.value) || 20)));
        cp('盤面サイズ変更');
        if (dimInp.dataset.bpBoardDim === 'cols') b.width = Math.max(96, Math.min(4000, cells * grid));
        else b.height = Math.max(96, Math.min(4000, cells * grid));
        b.customSize = true;
        UI.cameraFitted = false;
        CCF.saveProject();
        return refreshBoardContainers();
      }
      const fgFitSel = e.target.closest('[data-bp-fg-fit]');
      if (fgFitSel) {
        const sc = getBoardTargetScene(activeTarget());
        const fgObj = (sc && sc.fg) || (S.proj.globalDecor && S.proj.globalDecor.fg);
        if (fgObj) {
          cp('前景表示方式変更');
          fgObj.fitMode = fgFitSel.value === 'fill' ? 'fill' : 'cover';
          CCF.saveProject();
          refreshBoardContainers();
        }
        return;
      }
      const bgmVolNum = e.target.closest('[data-bgm-vol-num],[data-bgm-vol-range]');
      if (bgmVolNum) {
        const sc = S.proj.scenes.find(s => s.id === bgmVolNum.dataset.bgmScnid);
        if (sc && sc.bgm) {
          cp('BGM音量変更');
          applyBgmVolumeLive(sc, bgmVolNum.value, bgmVolNum);
        }
        return;
      }
      const bgmLoopChk = e.target.closest('[data-bgm-loop]');
      if (bgmLoopChk) {
        const sc = S.proj.scenes.find(s => s.id === bgmLoopChk.dataset.bgmScnid);
        if (sc && sc.bgm) {
          cp('BGMループ設定変更');
          sc.bgm.loop = !!bgmLoopChk.checked;
          if (UI.audio && (UI.audioSceneId === sc.id || (sc.bgm.path && UI.audioKey === sc.bgm.path))) {
            UI.audio.loop = sc.bgm.loop;
          }
          CCF.saveProject();
        }
        return;
      }
      const opt = e.target.closest('[data-bp-opt]');
      if (opt) {
        const k = opt.dataset.bpOpt;
        if (k === 'grid') { cp('グリッド表示切替'); S.proj.board.showGrid = opt.checked; CCF.saveProject(); }
        else if (k === 'snap') UI.snapGrid = opt.checked;
        else if (k === 'ghost') UI.showHiddenGhost = opt.checked;
        return refreshBoardContainers();
      }
      const batchChk = e.target.closest('[data-bp-batch]');
      if (batchChk) {
        UI.batchSlots = UI.batchSlots || { fg: true, bgm: true, bg: false, marker: false };
        UI.batchSlots[batchChk.dataset.bpBatch] = batchChk.checked;
        return;
      }
      const f = e.target.closest('[data-bp-f]');
      if (f && UI.selectedItemId) {
        const hit = findLayerById(activeTarget(), UI.selectedItemId);
        if (!hit) return;
        cp('盤面プロパティ編集');
        const k = f.dataset.bpF;
        const it = hit.item;
        if (k === 'name') it.name = f.value;
        else if (k === 'text') it.text = f.value;
        else {
          const val = Math.round(Number(f.value) || 0);
          if ((k === 'width' || k === 'height') && it.lockAspect && it.width > 0 && it.height > 0) {
            const ratio = it.width / it.height;
            const clamped = Math.max(16, Math.min(4000, val));
            if (k === 'width') { it.width = clamped; it.height = Math.max(16, Math.round(clamped / ratio)); }
            else { it.height = clamped; it.width = Math.max(16, Math.round(clamped * ratio)); }
          } else {
            it[k] = (k === 'width' || k === 'height') ? Math.max(16, Math.min(4000, val)) : val;
          }
        }
        CCF.saveProject();
        refreshBoardContainers();
      }
    };

    const onInput = e => {
      const zSlider = e.target.closest('[data-bp-zoom-slider]');
      if (zSlider) {
        zoomBoardTo(container, Number(zSlider.value) / 100, null, null);
        return;
      }
      const bgmVolEl = e.target.closest('[data-bgm-vol-range],[data-bgm-vol-num]');
      if (bgmVolEl) {
        const sc = S.proj.scenes.find(s => s.id === bgmVolEl.dataset.bgmScnid);
        if (sc && sc.bgm) applyBgmVolumeLive(sc, bgmVolEl.value, bgmVolEl);
        return;
      }
      const tInp = e.target.closest('[data-bp-scn-title]');
      if (tInp) {
        const sc = getBoardTargetScene(tInp.dataset.bpScnTitle);
        if (!sc) return;
        sc.title = tInp.value;
        invalidateCandidate(sc);
        const rowName = container.querySelector(`[data-bp-pick="${sc.id}"] .ccf-bp-scn-name`);
        if (rowName) rowName.textContent = sc.title || '無題のシーン';
        CCF.saveProject();
        clearTimeout(candDebounce);
        candDebounce = setTimeout(() => updateBoardCandidatesHost(container, sc), 450);
        return;
      }
      const msgInp = e.target.closest('[data-bp-scn-msg]');
      if (msgInp) {
        const sc = getBoardTargetScene(msgInp.dataset.bpScnMsg);
        if (!sc) return;
        sc.sceneMessage = msgInp.value;
        CCF.saveProject();
        return;
      }
      const txtInp = e.target.closest('[data-bp-scn-text]');
      if (txtInp) {
        txtInp._lastCursor = txtInp.selectionStart;
        txtInp._lastCursorEnd = txtInp.selectionEnd;
        const sc = getBoardTargetScene(txtInp.dataset.bpScnText);
        if (!sc) return;
        sc.text = txtInp.value;
        invalidateCandidate(sc);
        CCF.saveProject();
        clearTimeout(candDebounce);
        candDebounce = setTimeout(() => updateBoardCandidatesHost(container, sc), 450);
      }
    };

    let dragScnIdx = -1;
    const clearScnDropMarks = () => {
      container.querySelectorAll('.ccf-bp-scn-row.drag-over-top,.ccf-bp-scn-row.drag-over-bot,.ccf-bp-scn-row.is-dragging').forEach(r => {
        r.classList.remove('drag-over-top', 'drag-over-bot', 'is-dragging');
      });
    };
    const onScnDragStart = e => {
      const h = e.target.closest('[data-bp-scn-drag]');
      if (!h) return;
      dragScnIdx = +h.dataset.bpScnDrag;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragScnIdx));
        const row = h.closest('.ccf-bp-scn-row');
        if (row) {
          row.classList.add('is-dragging');
          try { e.dataTransfer.setDragImage(row, 16, 14); } catch (_) { }
        }
      }
    };
    const onScnDragOver = e => {
      if (dragScnIdx < 0) return;
      const row = e.target.closest('.ccf-bp-scn-row:not(.fixed)');
      if (!row || row.dataset.bpScnIdx == null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      container.querySelectorAll('.ccf-bp-scn-row.drag-over-top,.ccf-bp-scn-row.drag-over-bot').forEach(r => {
        if (r !== row) r.classList.remove('drag-over-top', 'drag-over-bot');
      });
      row.classList.toggle('drag-over-top', !after);
      row.classList.toggle('drag-over-bot', after);
    };
    const onScnDrop = e => {
      if (dragScnIdx < 0) return;
      const row = e.target.closest('.ccf-bp-scn-row:not(.fixed)');
      if (!row || row.dataset.bpScnIdx == null) return;
      e.preventDefault();
      const rawIdx = +row.dataset.bpScnIdx;
      const fromIdx = dragScnIdx;
      dragScnIdx = -1;
      clearScnDropMarks();
      if (fromIdx === rawIdx) return;
      const rect = row.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      let toIdx = after ? (fromIdx < rawIdx ? rawIdx : rawIdx + 1) : (fromIdx < rawIdx ? rawIdx - 1 : rawIdx);
      toIdx = Math.max(0, Math.min(S.proj.scenes.length - 1, toIdx));
      reorderSceneIndex(fromIdx, toIdx);
    };
    const onScnDragEnd = () => {
      dragScnIdx = -1;
      clearScnDropMarks();
    };
    const onScnRowContextMenu = e => {
      const row = e.target.closest('.ccf-bp-scn-row:not(.fixed)[data-bp-pick]');
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      openSceneRowContextMenu(e.clientX, e.clientY, row.dataset.bpPick);
    };

    const onTrackCursor = e => {
      if (e.target && e.target.matches && e.target.matches('[data-bp-scn-text]')) {
        e.target._lastCursor = e.target.selectionStart;
        e.target._lastCursorEnd = e.target.selectionEnd;
      }
    };

    const onDblClick = e => {
      const midRow = e.target.closest('[data-bp-midsel]');
      if (!midRow || e.target.closest('[data-bp]')) return;
      const mid = midRow.dataset.bpMidsel;
      setSingleSelection(mid);
      refreshBoardContainers();
      setTimeout(() => {
        const host = UI.modalOpen && UI.modalEl ? UI.modalEl : $('ccfBoardInlineHost');
        const inp = host && host.querySelector('[data-bp-f="name"]');
        if (inp) { inp.focus(); inp.select(); inp.scrollIntoView({ block: 'nearest' }); }
      }, 0);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWinBlur);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: false });
    container.addEventListener('click', onClick);
    container.addEventListener('dblclick', onDblClick);
    container.addEventListener('change', onChange);
    container.addEventListener('input', onInput);
    container.addEventListener('keyup', onTrackCursor);
    container.addEventListener('mouseup', onTrackCursor);
    container.addEventListener('dragstart', onScnDragStart);
    container.addEventListener('dragover', onScnDragOver);
    container.addEventListener('drop', onScnDrop);
    container.addEventListener('dragend', onScnDragEnd);
    container.addEventListener('contextmenu', onScnRowContextMenu);
    container._bpCleanup = () => {
      closeActiveMenu();
      if (rafFit) cancelAnimationFrame(rafFit);
      if (rafResize) cancelAnimationFrame(rafResize);
      if (ro) ro.disconnect();
      clearTimeout(candDebounce);
      wrap.removeEventListener('mousedown', onWrapMouseDown);
      wrap.removeEventListener('auxclick', onAuxClick);
      wrap.removeEventListener('contextmenu', onContextMenu);
      wrap.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWinBlur);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      container.removeEventListener('click', onClick);
      container.removeEventListener('dblclick', onDblClick);
      container.removeEventListener('change', onChange);
      container.removeEventListener('input', onInput);
      container.removeEventListener('keyup', onTrackCursor);
      container.removeEventListener('mouseup', onTrackCursor);
      container.removeEventListener('dragstart', onScnDragStart);
      container.removeEventListener('dragover', onScnDragOver);
      container.removeEventListener('drop', onScnDrop);
      container.removeEventListener('dragend', onScnDragEnd);
      container.removeEventListener('contextmenu', onScnRowContextMenu);
    };
  }

  function updateBoardCandidatesHost(container, sc) {
    if (!container || !sc) return;
    const host = container.querySelector(`[data-bp-cands-host="${sc.id}"]`);
    if (!host) return;
    const idx = S.proj.scenes.findIndex(s => s.id === sc.id);
    if (idx < 0) return;
    const m = computeCandidatesForScene(sc, getMatchSources());
    const b = S.proj.board;
    const g = S.proj.globalDecor;
    const activeFg = sc.fg || g.fg || null;
    const isFallbackFg = !sc.fg && !!g.fg;
    withPreservedScroll(() => {
      host.innerHTML = `${renderSlotRowHtml(sc, idx, 'fg', '🪟 前景（盤面）', sc.fg, m.fg, m.extracted, { compact: true })}
        ${renderFgControlsHtml(b, activeFg, isFallbackFg)}
        ${renderSlotRowHtml(sc, idx, 'bgm', '🎵 BGM', sc.bgm, m.bgm, m.extracted, { compact: true })}
        ${renderSlotRowHtml(sc, idx, 'bg', '🖼️ 背景（任意）', sc.bg, m.bg, m.extracted, { compact: true })}
        ${renderBoardPanelCardsHtml(sc, idx, m)}`;
    }, container);
  }

  function refreshBoardContainers() {
    if (UI.modalOpen && UI.modalEl) {
      const box = UI.modalEl.querySelector('.ccf-bp-modal-body');
      if (box) {
        withPreservedScroll(() => {
          if (box._bpCleanup) { box._bpCleanup(); box._bpCleanup = null; }
          box.innerHTML = boardEditorHtml(UI.boardTarget, true);
          wireBoardInteractions(box, UI.boardTarget, true);
        }, box);
      }
    }
    const inlineHost = $('ccfBoardInlineHost');
    if (inlineHost) {
      withPreservedScroll(() => {
        if (inlineHost._bpCleanup) { inlineHost._bpCleanup(); inlineHost._bpCleanup = null; }
        inlineHost.innerHTML = boardEditorHtml(UI.boardTarget, false);
        wireBoardInteractions(inlineHost, UI.boardTarget, false);
      }, inlineHost);
    }
    if (typeof CCF.updateTabCounts === 'function') CCF.updateTabCounts();
  }

  function openBoardModal(targetId) {
    closeBoardModal();
    if (targetId) setBoardTarget(targetId);
    UI._savedInlineCam = {
      zoomScale: UI.zoomScale,
      panX: UI.panX,
      panY: UI.panY,
      cameraFitted: UI.cameraFitted
    };
    UI.cameraFitted = false;
    const ov = document.createElement('div');
    ov.className = 'ccf-overlay ccf-bp-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="ccf-modal ccf-bp-modal">
      <div class="ccf-modal-head"><b>🖥️ WYSIWYG 盤面プレビュー画面</b><span class="ccf-muted">未固定要素ドラッグで移動・余白/固定パネルドラッグで視点移動・Shift+ドラッグ/範囲選択ONで囲み選択・ホイールで拡大縮小</span><span class="ccf-spacer"></span><button type="button" class="ccf-btn" data-bp-close="1">✕ 閉じる</button></div>
      <div class="ccf-bp-modal-body">${boardEditorHtml(UI.boardTarget, true)}</div>
    </div>`;
    document.body.appendChild(ov);
    UI.modalOpen = true;
    UI.modalEl = ov;
    const body = ov.querySelector('.ccf-bp-modal-body');
    wireBoardInteractions(body, UI.boardTarget, true);
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-bp-close]')) closeBoardModal(); });
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.app-dialog-overlay,.ccf-am-ov')) { e.preventDefault(); closeBoardModal(); } };
    ov._onKey = onKey;
    document.addEventListener('keydown', onKey, true);
  }

  function closeBoardModal() {
    closeActiveMenu();
    if (!UI.modalEl) return;
    const body = UI.modalEl.querySelector('.ccf-bp-modal-body');
    if (body && body._bpCleanup) body._bpCleanup();
    if (UI.modalEl._onKey) document.removeEventListener('keydown', UI.modalEl._onKey, true);
    UI.modalEl.remove();
    UI.modalEl = null;
    UI.modalOpen = false;
    if (UI._savedInlineCam) {
      UI.zoomScale = UI._savedInlineCam.zoomScale;
      UI.panX = UI._savedInlineCam.panX;
      UI.panY = UI._savedInlineCam.panY;
      UI.cameraFitted = UI._savedInlineCam.cameraFitted;
      UI._savedInlineCam = null;
    } else {
      UI.cameraFitted = false;
    }
    const inlineHost = $('ccfBoardInlineHost');
    if (inlineHost) applyBoardCanvasScale(inlineHost, !UI.cameraFitted);
  }

  // ======================================================================
  // 4. カットインステージプレビュー（画像/動画 + SE音量付再生）
  // ======================================================================
  function stopCutinStage() {
    if (UI.cutinStageTimer) { clearTimeout(UI.cutinStageTimer); UI.cutinStageTimer = null; }
    if (UI.cutinStageAudio) { try { UI.cutinStageAudio.pause(); } catch (_) { } UI.cutinStageAudio = null; }
    if (UI.cutinStageEl) { UI.cutinStageEl.remove(); UI.cutinStageEl = null; }
  }

  function playCutinStage(cutin) {
    if (!cutin) return;
    stopCutinStage();
    const vSrc = cutin.visualDataUrl || fileUrl(cutin.visualPath);
    const sSrc = fileUrl(cutin.sePath);
    if (!vSrc && !sSrc) return say('⚠️ 画像/動画またはSE音源を設定してください');

    const ov = document.createElement('div');
    ov.className = 'ccf-overlay ccf-cutin-stage';
    ov.innerHTML = `<div class="ccf-cutin-box pos-${esc(cutin.position || 'center')}">
      ${vSrc ? (cutin.visualType === 'video'
        ? `<video src="${esc(vSrc)}" autoplay playsinline controls class="ccf-cutin-media"></video>`
        : `<img src="${esc(vSrc)}" alt="" class="ccf-cutin-media">`) : `<div class="ccf-cutin-textonly">⚡ ${esc(cutin.name)}</div>`}
      <div class="ccf-cutin-hud">
        <span>⚡ ${esc(cutin.name)}${cutin.seName ? ` / 🔊 ${esc(cutin.seName)} (${cutin.seVolume}%)` : ''}</span>
        <button type="button" class="ccf-btn" data-stop-cutin="1">■ 停止して閉じる</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    UI.cutinStageEl = ov;
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-stop-cutin]')) stopCutinStage(); });

    if (sSrc) {
      const a = new Audio(sSrc);
      a.volume = Math.min(1, Math.max(0, (Number(cutin.seVolume || 80)) / 100));
      UI.cutinStageAudio = a;
      a.play().catch(() => { say('⚠️ SE音源を再生できませんでした'); });
    }
    const dur = Math.max(800, Number(cutin.durationMs || 2500));
    if (cutin.visualType !== 'video') {
      UI.cutinStageTimer = setTimeout(stopCutinStage, dur);
    }
  }

  // ======================================================================
  // 5. 各サブタブ描画
  // ======================================================================
  function renderSceneCardSlotsHtml(sc, idx) {
    const m = getCachedCandidates(sc);
    const extracted = m && m.extracted ? m.extracted : { keywords: [] };
    const kwList = Array.isArray(extracted.keywords) ? extracted.keywords.slice(0, 8) : [];
    return `${kwList.length ? `<div class="ccf-scn-kws"><span class="ccf-muted">🔍 抽出キーワード:</span> ${kwList.map(k => `<span class="ccf-chip dim">${esc(k)}</span>`).join('')}</div>` : ''}
      ${!m ? '<div class="ccf-muted" style="font-size:.73rem;padding:2px 0;">💡 素材候補は未計算です（「✨ 候補更新」または上部の「✨ 候補を再計算」で表示できます）</div>' : ''}
      <div class="ccf-slots">
        ${renderSlotRowHtml(sc, idx, 'fg', '🪟 前景（盤面）', sc.fg, m ? m.fg : [], extracted)}
        ${renderSlotRowHtml(sc, idx, 'bgm', '🎵 BGM', sc.bgm, m ? m.bgm : [], extracted)}
        ${renderSlotRowHtml(sc, idx, 'bg', '🖼️ 背景（任意）', sc.bg, m ? m.bg : [], extracted)}
        ${renderSlotRowHtml(sc, idx, 'marker', '📌 マーカーパネル（任意）', sc.markers && sc.markers[0], m ? m.marker : [], extracted)}
      </div>`;
  }

  function renderSceneCardSlotsBlockHtml(sc, idx) {
    const isExpanded = UI.expandedSlotScenes.has(sc.id);
    if (isExpanded) {
      return `<div class="ccf-scn-slots-bar open">
          <button type="button" class="ccf-mini" data-scn-slots-toggle="${esc(sc.id)}">▾ 素材スロット・候補を折りたたむ</button>
        </div>
        ${renderSceneCardSlotsHtml(sc, idx)}`;
    }
    const cached = getCachedCandidates(sc);
    const mk = sc.markers && sc.markers[0];
    const slotBadge = (ico, lbl, item) => `<span class="ccf-scn-slot-pill${item ? ' set' : ''}" title="${esc(lbl)}: ${esc(item ? item.name : '未設定')}">${ico} ${item ? esc(item.name) : '<span class="ccf-muted">未設定</span>'}</span>`;
    return `<div class="ccf-scn-slots-bar">
      <button type="button" class="ccf-mini" data-scn-slots-toggle="${esc(sc.id)}" title="前景・BGM・背景・マーカーパネルの設定と候補を展開">▸ 素材スロット・候補</button>
      ${slotBadge('🪟', '前景', sc.fg)}
      ${slotBadge('🎵', 'BGM', sc.bgm)}
      ${slotBadge('🖼️', '背景', sc.bg)}
      ${mk ? slotBadge('📌', 'マーカー', mk) : ''}
      ${cached ? '<span class="ccf-badge">✨候補済</span>' : ''}
    </div>`;
  }

  function renderScenesTab() {
    ensureProjShape();
    const docs = collectSourceDocs();
    const cfg = S.proj.sceneParseConfig;
    const selDoc = cfg.sourcePath || (docs[0] && docs[0].path) || '';
    const stats = UI.headingStats;
    const roles = cfg.patternRoles || {};
    const gran = cfg.granularity || 'standard';

    const roleChipOpts = [
      ['scene', '🎬 シーン分割'],
      ['info', '📝 情報テキスト候補'],
      ['ignore', '無視']
    ];
    const granOpts = [
      ['standard', '標準（章・探索場所・場面）'],
      ['coarse', '大まか（しおり・大見出しのみ）'],
      ['detail', '詳細']
    ];

    const outlineNote = UI.parsedOutline && UI.parsedOutline.length
      ? `<span class="ccf-badge">📑 PDFしおり ${UI.parsedOutline.length}件検出</span>`
      : '';

    const ruleHtml = stats ? `<div class="ccf-rule-box">
      <div class="ccf-rule-grid">
        ${stats.map(st => {
          const curRole = roles[st.id] || ((cfg.enabledPatterns || []).includes(st.id) ? 'scene' : 'info');
          const samp = st.samples && st.samples.length ? `例: ${st.samples.join(' / ')}` : '一致なし';
          return `<div class="ccf-rule-chip${st.count ? '' : ' zero'} role-${esc(curRole)}" title="${esc(samp)}">
            <div class="ccf-rule-chip-top">
              <span><b>${esc(st.label)}</b></span>
              <span class="ccf-count">${st.count}件</span>
            </div>
            <div class="ccf-role-seg" role="group" aria-label="${esc(st.label)}の役割">
              ${roleChipOpts.map(([rv, rl]) => `<button type="button" class="ccf-role-btn${curRole === rv ? ' active role-' + rv : ''}" data-scn-role-set="${esc(st.id)}" data-role="${rv}">${rl}</button>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="ccf-rule-custom">
        <label class="ccf-inline-field"><span class="ccf-inline-lbl">カスタム先頭記号（スペース・カンマ区切り）:</span> <input type="text" id="ccfCustomHeadingInp" value="${esc(cfg.customPrefixes)}" placeholder="例: ▶, ※, #, §"></label>
        <button type="button" class="ccf-btn primary" data-scn-act="redetect">🔄 この条件でシーンを再検出</button>
        <button type="button" class="ccf-btn" data-scn-act="extract-info-modal">📋 見出しから情報テキストを一括抽出</button>
      </div>
    </div>` : `<div class="ccf-muted" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span>資料と対象ページ範囲を選んで「🔍 見出し候補を解析」を押すと、見出しパターンの件数と役割設定（🎬 シーン分割 / 📝 情報テキスト候補 / 無視）が出ます。</span>
      <button type="button" class="ccf-mini" data-scn-act="extract-info-modal">📋 見出しから情報テキストを一括抽出</button>
    </div>`;

    const scenes = S.proj.scenes;
    const allChecked = scenes.length > 0 && scenes.every(s => s.checked);
    const limit = Math.max(50, UI.sceneLimit || 50);
    const shownScenes = scenes.slice(0, limit);

    const sceneCards = shownScenes.map((sc, idx) => {
      const isLineSplit = UI.expandedScenes.has(sc.id);
      const lines = isLineSplit ? String(sc.text || '').replace(/\r\n?/g, '\n').split('\n') : [];
      const lineCount = isLineSplit ? lines.length : (sc.text ? String(sc.text).split('\n').length : 0);
      return `<div class="ccf-scn-card" data-scn-idx="${idx}" data-scn-id="${esc(sc.id)}">
        <div class="ccf-scn-head">
          <span class="ccf-scn-drag" draggable="true" data-scn-drag="${idx}" title="ドラッグして順序を並べ替え">⠿</span>
          <input type="checkbox" class="ccf-selchk" data-scn-chk="${idx}"${sc.checked ? ' checked' : ''} title="選択（Shift+クリックで範囲選択）">
          <span class="ccf-no">#${idx + 1}</span>
          <button type="button" class="ccf-mini" data-scn-up="${esc(sc.id)}"${idx === 0 ? ' disabled' : ''} title="1つ上へ移動">▲</button>
          <button type="button" class="ccf-mini" data-scn-dn="${esc(sc.id)}"${idx === scenes.length - 1 ? ' disabled' : ''} title="1つ下へ移動">▼</button>
          <input type="text" class="ccf-scn-title" data-scn-title="${idx}" value="${esc(sc.title)}" placeholder="シーン名">
          ${sc.page ? `<span class="ccf-badge">p.${sc.page}</span>` : ''}
          <button type="button" class="ccf-mini" data-scn-dup="${esc(sc.id)}" title="このシーンを丸ごと複製してすぐ下に挿入">📋 シーンを複製</button>
          <button type="button" class="ccf-mini" data-scn-toggle="${esc(sc.id)}">${isLineSplit ? '▾ 行クリック分割を閉じる' : `✂️ 行クリックで新シーンに分割 (${lineCount}行)`}</button>
          <button type="button" class="ccf-mini" data-scn-split-editor="${esc(sc.id)}" title="広い画面で本文の編集や手動シーン分割を行います">🗗 広い画面で本文分割・編集</button>
          <button type="button" class="ccf-mini" data-scn-calc="${idx}" title="本文から背景・スクリーン・BGMの素材候補を更新">✨ 候補更新</button>
          <button type="button" class="ccf-mini primary" data-scn-openboard="${esc(sc.id)}" title="① 盤面・シーン編集でこのシーンを開く">🖥️ 盤面で編集</button>
          <button type="button" class="ccf-mini" data-scn-preview="${esc(sc.id)}" title="大画面モーダルでプレビュー">🗗 プレビュー</button>
          ${idx > 0 ? `<button type="button" class="ccf-mini danger" data-scn-merge="${idx}" title="直前のシーンと結合してこの区切りを解除します">🗑️ 前のシーンと結合</button>` : ''}
          <button type="button" class="ccf-mini danger" data-scn-del="${idx}" title="このシーンを削除">✕</button>
        </div>
        <div class="ccf-scn-field-lbl">📖 シナリオ本文・メモ（分割・素材候補の抽出用 ※ココフォリアには出力されません）</div>
        <textarea class="ccf-scn-text" data-scn-text="${idx}" rows="4" placeholder="シーン本文・描写・演出メモを入力または貼り付け（例：夜の図書館で探索、病院の屋上で戦闘）">${esc(sc.text)}</textarea>
        <div class="ccf-scn-txt-acts">
          <button type="button" class="ccf-mini" data-scn-split-cursor="${idx}" title="本文入力欄のカーソル位置より後半を新しいシーンに分割します">✂️ カーソル位置から新シーンに分割</button>
          <button type="button" class="ccf-mini" data-scn-insert-delim="${idx}" title="カーソル位置に区切り線（---）を挿入します">＋ カーソル位置に区切り線（---）を挿入</button>
          <button type="button" class="ccf-mini" data-scn-split-delim="${idx}" title="本文中の「---」の位置で複数シーンへ一気に分割します">✂️ --- の位置で一括シーン分割</button>
          <button type="button" class="ccf-mini" data-scn-append-sel="${idx}" title="左ペインで選択中のテキスト／抽出バッファを末尾へ追記">📥 選択テキストを追記</button>
          <button type="button" class="ccf-mini" data-scn-replace-sel="${idx}" title="左ペインで選択中のテキスト／抽出バッファで本文を置換">📥 選択テキストで置換</button>
        </div>
        <div class="ccf-scn-msg-box">
          <div class="ccf-scn-msg-head">
            <span class="ccf-scn-field-lbl">💬 シーン切替メッセージ（ココフォリア表示用・初期空欄）</span>
            <span class="ccf-scn-msg-btns">
              <button type="button" class="ccf-mini" data-scn-msg-copy="${esc(sc.id)}" title="シナリオ本文（選択中は選択部分）をコピー">📋 本文（または選択部分）をコピー</button>
              <button type="button" class="ccf-mini" data-scn-msg-title="${esc(sc.id)}" title="シーン名をセット">📋 シーン名をセット</button>
              <button type="button" class="ccf-mini danger" data-scn-msg-clear="${esc(sc.id)}" title="空欄に戻す">✕ クリア</button>
            </span>
          </div>
          <textarea class="ccf-scn-msg" data-scn-msg="${idx}" data-scn-msg-id="${esc(sc.id)}" rows="2" placeholder="空欄のままにすると、ココフォリアでシーン切り替え時にメッセージが表示されません">${esc(sc.sceneMessage || '')}</textarea>
        </div>
        ${isLineSplit ? `<div class="ccf-scn-lines" title="行の「✂️ ここから分割」で新しいシーンに分割、小見出し行の「＋📝 情報テキストへ登録」でテキスト・情報駒へ抽出できます">
          ${lines.map((ln, li) => {
            const infoHit = SM.matchHeadingRole(ln, 'info', { patternRoles: roles, customPrefixes: cfg.customPrefixes });
            return `<div class="ccf-scn-line${li === 0 ? ' first' : ''}${infoHit ? ' is-info-heading' : ''}" data-scn-line="${li}" data-i="${idx}">
            <span class="ccf-scn-lno">${li + 1}</span>
            <span class="ccf-scn-ltxt">${esc(ln || '（空行）')}</span>
            ${infoHit ? `<button type="button" class="ccf-mini ccf-info-add-btn" data-scn-add-stock="${idx}" data-line="${li}" title="この小見出しから次の見出しまでの段落を「📝 テキスト・情報駒」へ登録します">＋📝 情報テキストへ登録</button>` : ''}
            ${li > 0 ? `<button type="button" class="ccf-mini ccf-split-btn" data-scn-split="${idx}" data-line="${li}">✂️ ここから分割</button>` : '<span class="ccf-muted" style="font-size:.68rem;">シーン先頭</span>'}
          </div>`;
          }).join('')}
        </div>` : ''}
        <div data-scn-card-slots="${esc(sc.id)}">
          ${renderSceneCardSlotsBlockHtml(sc, idx)}
        </div>
      </div>`;
    }).join('') || '<div class="ccf-empty">まだシーンがありません。「🔍 見出し候補を解析」「📥 指定ページ範囲から取り込み」「📥 左の選択テキストから新規シーンを作成」「＋ 空シーン追加」のいずれかで作成できます。</div>';

    const moreHtml = scenes.length > shownScenes.length
      ? `<div style="display:flex;gap:8px;justify-content:center;padding:8px 0;">
          <button type="button" class="ccf-btn" data-scn-act="more-scenes">さらに表示（${shownScenes.length} / ${scenes.length}件）</button>
          <button type="button" class="ccf-btn" data-scn-act="all-scenes">すべて表示（全${scenes.length}件）</button>
        </div>`
      : '';

    return `<div class="ccf-scene-card">
      <div class="ccf-scene-card-head">
        <b>🎬 シーンを自動組み立て / 範囲指定＆手動取り込み</b>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <select id="ccfSceneDocSel" style="max-width:240px;">
            ${docs.length ? docs.map(d => `<option value="${esc(d.path)}"${d.path === selDoc ? ' selected' : ''}>📄 ${esc(d.name)}</option>`).join('') : '<option value="">（PDF / TXT / HTMLを登録してください）</option>'}
          </select>
          <button type="button" class="ccf-btn primary" data-scn-act="analyze">🔍 見出し候補を解析</button>
          <button type="button" class="ccf-btn" data-scn-act="add-empty">＋ 空シーン追加</button>
        </div>
      </div>
      <div class="ccf-range-row ccf-granularity-row">
        <span class="ccf-gran-label">🎯 検出の粒度：</span>
        <span class="ccf-gran-opts" role="radiogroup" aria-label="検出の粒度">
          ${granOpts.map(([gv, gl]) => `<label class="ccf-gran-opt${gran === gv ? ' active' : ''}"><input type="radio" name="ccfGranularity" value="${gv}"${gran === gv ? ' checked' : ''}> ${gl}</label>`).join('')}
        </span>
        ${outlineNote}
        <span class="ccf-spacer"></span>
        <label class="ccf-chk" title="PDFのしおり（目次）や序盤の目次ページがあれば最優先でシーン分割します"><input type="checkbox" id="ccfUseOutlineChk"${cfg.useOutline !== false ? ' checked' : ''}> しおり・目次優先</label>
        <label class="ccf-chk" title="技能名・判定結果・メタ項目などのNGワードや、短文・密集記号での過剰分割を自動抑制します"><input type="checkbox" id="ccfAutoGuardChk"${cfg.autoGuard !== false ? ' checked' : ''}> 過剰分割防止ガード</label>
      </div>
      <div class="ccf-range-row">
        <label class="ccf-inline-field"><span class="ccf-inline-lbl">📄 対象ページ範囲：</span>
          <input type="number" id="ccfRangeStart" min="1" value="${cfg.startPage || ''}" placeholder="開始 p." style="width:76px;">
          〜
          <input type="number" id="ccfRangeEnd" min="1" value="${cfg.endPage || ''}" placeholder="終了 p." style="width:76px;">
          <span class="ccf-muted ccf-inline-lbl">（空欄＝全ページ）</span>
        </label>
        <button type="button" class="ccf-mini" data-scn-act="set-start-cur">📍現在pを開始に</button>
        <button type="button" class="ccf-mini" data-scn-act="set-end-cur">📍現在pを終了に</button>
        <button type="button" class="ccf-mini" data-scn-act="clear-range">全ページに戻す</button>
        <span class="ccf-spacer"></span>
        <label class="ccf-chk"><input type="checkbox" id="ccfCleanLineBreaksChk"${cfg.cleanLineBreaks !== false ? ' checked' : ''}> 文中の不自然な折り返し改行・空白を自動整形する（T.cleanText 適用）</label>
      </div>
      <div class="ccf-range-row">
        <button type="button" class="ccf-btn" data-scn-act="import-range-single">📥 指定ページ範囲を1つのシーンとして追加（あとで手動分割）</button>
        <button type="button" class="ccf-btn" data-scn-act="import-range-pages">📥 指定ページ範囲を1ページ＝1シーンとして追加</button>
        <button type="button" class="ccf-btn" data-scn-act="add-from-sel">📥 左の選択テキストから新規シーンを作成</button>
        <button type="button" class="ccf-btn" data-scn-act="add-from-stock">📋 登録テキストからシーンを追加</button>
        <button type="button" class="ccf-btn" data-scn-act="clean-scenes-breaks"${scenes.length ? '' : ' disabled'}>🧹 選択/全シーンの不自然な改行を一括除去</button>
      </div>
      ${ruleHtml}
    </div>
    <div class="ccf-scene-card">
      <div class="ccf-scene-card-head">
        <div>
          <b>📋 シーン一覧（${scenes.length}件）</b>
          <label class="ccf-chk" style="margin-left:8px;"><input type="checkbox" data-scn-act="checkall"${allChecked ? ' checked' : ''}> 一括選択</label>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <span class="ccf-bp-batch-chks" title="一括仮配置の対象スロット（標準：前景＋BGM）">
            <label class="ccf-chk"><input type="checkbox" data-bp-batch="fg"${(UI.batchSlots ? UI.batchSlots.fg : true) ? ' checked' : ''}> 前景</label>
            <label class="ccf-chk"><input type="checkbox" data-bp-batch="bgm"${(UI.batchSlots ? UI.batchSlots.bgm : true) ? ' checked' : ''}> BGM</label>
            <label class="ccf-chk"><input type="checkbox" data-bp-batch="bg"${(UI.batchSlots && UI.batchSlots.bg) ? ' checked' : ''}> 背景</label>
            <label class="ccf-chk"><input type="checkbox" data-bp-batch="marker"${(UI.batchSlots && UI.batchSlots.marker) ? ' checked' : ''}> マーカーパネル</label>
          </span>
          <button type="button" class="ccf-btn" data-scn-act="recalc-cands"${scenes.length ? '' : ' disabled'}>✨ 候補を再計算</button>
          <button type="button" class="ccf-btn accent" data-scn-act="auto-assign"${scenes.length ? '' : ' disabled'}>🪄 未設定シーンを候補1位で一括仮配置</button>
          <button type="button" class="ccf-btn danger" data-scn-act="clear-scenes"${scenes.length ? '' : ' disabled'}>🗑️ 全シーンを一括クリア</button>
        </div>
      </div>
      <div class="ccf-scn-list">${sceneCards}${moreHtml}</div>
    </div>`;
  }

  function renderBoardTab() {
    ensureProjShape();
    if (UI.boardTarget !== 'global' && !S.proj.scenes.some(s => s.id === UI.boardTarget)) {
      UI.boardTarget = 'global';
    }
    return `<div id="ccfBoardInlineHost" class="ccf-scene-card ccf-bp-inline-card">${boardEditorHtml(UI.boardTarget, false)}</div>`;
  }

  function renderCutinTab() {
    ensureProjShape();
    const pkgs = window.CommonAssets && window.CommonAssets.getCutinPackages ? window.CommonAssets.getCutinPackages() : [];
    const cutinCards = S.proj.cutins.map((c, idx) => {
      const vSrc = c.visualDataUrl || fileUrl(c.visualPath);
      return `<div class="ccf-cutin-card" data-ci-idx="${idx}">
        <div class="ccf-cutin-prevbox">
          ${vSrc ? (c.visualType === 'video'
            ? `<video src="${esc(vSrc)}" muted loop playsinline></video>`
            : `<img src="${esc(vSrc)}" alt="">`) : '<span class="ccf-muted">未設定</span>'}
        </div>
        <div class="ccf-cutin-fields">
          <div class="ccf-cutin-row">
            <input type="text" data-ci-f="name" value="${esc(c.name)}" placeholder="カットイン名">
            <select data-ci-f="position">
              <option value="center"${c.position === 'center' ? ' selected' : ''}>中央</option>
              <option value="top"${c.position === 'top' ? ' selected' : ''}>上部</option>
              <option value="bottom"${c.position === 'bottom' ? ' selected' : ''}>下部</option>
              <option value="fullscreen"${c.position === 'fullscreen' ? ' selected' : ''}>全画面</option>
            </select>
            <label class="ccf-muted">表示ms <input type="number" min="300" max="30000" step="100" data-ci-f="durationMs" value="${c.durationMs}" style="width:76px;"></label>
          </div>
          <div class="ccf-cutin-row">
            <button type="button" class="ccf-btn" data-ci="pick-visual" data-i="${idx}">🖼️/🎬 画像・動画を選ぶ</button>
            <span class="ccf-muted">${esc(c.visualName || c.visualPath || '画像/動画未選択')}</span>
          </div>
          <div class="ccf-cutin-row">
            <button type="button" class="ccf-btn" data-ci="pick-se" data-i="${idx}">🔊 SE音源を選ぶ</button>
            <span class="ccf-muted">${esc(c.seName || c.sePath || 'SE未選択')}</span>
            <label class="ccf-muted">音量 <input type="range" min="0" max="100" data-ci-f="seVolume" value="${c.seVolume}"> <span>${c.seVolume}%</span></label>
          </div>
          <div class="ccf-cutin-row">
            <button type="button" class="ccf-btn primary" data-ci="play" data-i="${idx}">▶ プレビュー再生</button>
            <button type="button" class="ccf-btn accent" data-ci="save-pkg" data-i="${idx}">📦 マイライブラリへパッケージ保存</button>
            <span class="ccf-spacer"></span>
            <button type="button" class="ccf-mini danger" data-ci="del" data-i="${idx}">🗑️ 削除</button>
          </div>
        </div>
      </div>`;
    }).join('') || '<div class="ccf-empty">まだカットインがありません。「＋ 新規カットインを作成」または下のマイライブラリパッケージから呼び出してください。</div>';

    const pkgRows = pkgs.map(p => `<div class="ccf-pkg-card">
      <div class="ccf-pkg-info">
        <b>${p.visualType === 'video' ? '🎬' : '🖼️'} ${esc(p.name)}</b>
        <span class="ccf-muted">${esc(p.visualName || '映像なし')} / 🔊 ${esc(p.seName || 'SEなし')} (${p.seVolume}%)</span>
      </div>
      <div class="ccf-pkg-acts">
        <button type="button" class="ccf-mini" data-pkg="play" data-id="${esc(p.id)}">▶ 試聴</button>
        <button type="button" class="ccf-btn primary" data-pkg="recall" data-id="${esc(p.id)}">＋ この部屋へ呼び出す</button>
        <button type="button" class="ccf-mini danger" data-pkg="del" data-id="${esc(p.id)}">✕</button>
      </div>
    </div>`).join('') || '<div class="ccf-muted">保存済みの汎用カットインパッケージはありません。</div>';

    return `<div class="ccf-scene-card">
      <div class="ccf-scene-card-head">
        <b>⚡ 演出・カットイン（画像/動画 ＋ SE音源セット）</b>
        <button type="button" class="ccf-btn primary" data-ci="add">＋ 新規カットインを作成</button>
      </div>
      <div class="ccf-cutin-list">${cutinCards}</div>
    </div>
    <div class="ccf-scene-card">
      <div class="ccf-scene-card-head">
        <b>📦 マイライブラリ：汎用カットインパッケージ（他シナリオでもワンクリック呼び出し）</b>
      </div>
      <div class="ccf-pkg-list">${pkgRows}</div>
    </div>`;
  }

  function normalizeSubView(v) {
    if (v === 'scenes' || v === 'cutin' || v === 'board') return v;
    return 'board';
  }

  function render() {
    if (S && S.view !== 'scene') return;
    ensureProjShape();
    UI.subView = normalizeSubView(UI.subView);
    withPreservedScroll(() => {
      const oldInline = $('ccfBoardInlineHost');
      if (oldInline && oldInline._bpCleanup) { oldInline._bpCleanup(); oldInline._bpCleanup = null; }
      const body = $('ccfSceneWorkspace');
      const tabsBox = $('ccfSceneSubtabs');
      if (tabsBox) {
        tabsBox.querySelectorAll('[data-zsub]').forEach(b => b.classList.toggle('active', b.dataset.zsub === UI.subView));
      }
      const sceneScroll = $('ccfScenePanel') && $('ccfScenePanel').querySelector('.ccf-scene-scroll');
      if (sceneScroll) sceneScroll.classList.toggle('is-board-view', UI.subView === 'board');
      if (!body) return;
      body.hidden = false;
      if (UI.subView === 'scenes') body.innerHTML = renderScenesTab();
      else if (UI.subView === 'board') {
        body.innerHTML = renderBoardTab();
        wireBoardInteractions($('ccfBoardInlineHost'), UI.boardTarget, false);
      } else if (UI.subView === 'cutin') {
        body.innerHTML = renderCutinTab();
      }
    });
    if (UI.modalOpen) refreshBoardContainers();
    if (typeof CCF.updateTabCounts === 'function') CCF.updateTabCounts();
  }

  // ======================================================================
  // 6. イベント配線
  // ======================================================================
  function wire() {
    const panel = $('ccfScenePanel');
    if (!panel || panel.dataset.sceneWired) return;
    panel.dataset.sceneWired = '1';
    let sceneCardCandTimer = null;

    const scheduleSceneCardCandsUpdate = sc => {
      if (!sc) return;
      clearTimeout(sceneCardCandTimer);
      sceneCardCandTimer = setTimeout(() => {
        const idx = S.proj.scenes.findIndex(x => x.id === sc.id);
        if (idx < 0) return;
        const host = Array.from(panel.querySelectorAll('[data-scn-card-slots]')).find(el => el.dataset.scnCardSlots === sc.id);
        if (host) host.innerHTML = renderSceneCardSlotsBlockHtml(sc, idx);
      }, 260);
    };

    const rememberCursor = e => {
      const ta = e.target && e.target.closest && e.target.closest('[data-scn-text]');
      if (ta && typeof ta.selectionStart === 'number') {
        ta._lastCursor = ta.selectionStart;
        ta._lastCursorEnd = ta.selectionEnd;
      }
    };
    panel.addEventListener('keyup', rememberCursor);
    panel.addEventListener('mouseup', rememberCursor);

    panel.addEventListener('click', async e => {
      const zbtn = e.target.closest('[data-zsub]');
      if (zbtn) {
        const nextSub = normalizeSubView(zbtn.dataset.zsub);
        if (nextSub !== UI.subView) stopPreviewAudio();
        UI.subView = nextSub;
        render();
        return;
      }

      const bpQuick = e.target.closest('[data-bp-quick]');
      if (bpQuick) {
        if (bpQuick.dataset.bpQuick === 'sync-npcs') syncNpcsToBoard();
        else if (bpQuick.dataset.bpQuick === 'add-marker') addBlankMarker(UI.boardTarget);
        return;
      }

      if (e.target.closest('[data-open-board-preview]')) {
        openBoardModal(UI.boardTarget);
        return;
      }

      // 盤面内インラインのクリックをここで二重処理しない
      if (e.target.closest('#ccfBoardInlineHost')) return;

      const scnChk = e.target.closest('[data-scn-chk]');
      if (scnChk) {
        const idx = +scnChk.dataset.scnChk;
        const checked = scnChk.checked;
        if (e.shiftKey && UI.lastCheckedIdx >= 0 && UI.lastCheckedIdx < S.proj.scenes.length) {
          const lo = Math.min(UI.lastCheckedIdx, idx);
          const hi = Math.max(UI.lastCheckedIdx, idx);
          cp('シーン範囲選択');
          for (let i = lo; i <= hi; i++) {
            S.proj.scenes[i].checked = checked;
            const cb = panel.querySelector(`[data-scn-chk="${i}"]`);
            if (cb) cb.checked = checked;
          }
        } else if (S.proj.scenes[idx]) {
          cp('同期対象選択');
          S.proj.scenes[idx].checked = checked;
        }
        UI.lastCheckedIdx = idx;
        CCF.saveProject();
        return;
      }

      // ---- シーン構築アクション ----
      const sAct = e.target.closest('[data-scn-act]');
      if (sAct) {
        const k = sAct.dataset.scnAct;
        const cfg = S.proj.sceneParseConfig;
        if (k === 'analyze') {
          const sel = $('ccfSceneDocSel');
          return void analyzeDocument(sel ? sel.value : '', false);
        }
        if (k === 'redetect') {
          const inp = $('ccfCustomHeadingInp');
          if (inp) cfg.customPrefixes = inp.value;
          return redetectScenesFromParsed(false);
        }
        if (k === 'set-start-cur' || k === 'set-end-cur') {
          const curPage = CCF.viewer && CCF.viewer.state ? Number(CCF.viewer.state.page) : 0;
          if (!curPage || curPage < 1) {
            say('⚠️ 左ペインでPDFページを開いてから押してください');
            return;
          }
          if (k === 'set-start-cur') cfg.startPage = curPage;
          else cfg.endPage = curPage;
          CCF.saveProject();
          render();
          say(`📄 対象ページを p.${curPage} に設定しました`);
          return;
        }
        if (k === 'clear-range') {
          cfg.startPage = null;
          cfg.endPage = null;
          CCF.saveProject();
          render();
          say('📄 対象ページ範囲を全ページに戻しました');
          return;
        }
        if (k === 'import-range-single') return void importPageRangeAsScenes('single');
        if (k === 'import-range-pages') return void importPageRangeAsScenes('per-page');
        if (k === 'add-from-sel') return createSceneFromSelection();
        if (k === 'add-from-stock') return openStockToSceneDialog();
        if (k === 'extract-info-modal') return void openExtractInfoModal();
        if (k === 'clean-scenes-breaks') return cleanLineBreaksInScenes();
        if (k === 'add-empty') {
          cp('空シーン追加');
          const nSc = M.sanitizeScene({ title: 'シーン ' + (S.proj.scenes.length + 1), text: '' });
          insertScenesAfterSelection(nSc);
          CCF.saveProject(); render(); return;
        }
        if (k === 'recalc-cands') return recalcAllCandidates();
        if (k === 'auto-assign') return autoAssignTopCandidates();
        if (k === 'clear-scenes') {
          if (!S.proj.scenes.length) return;
          const ok = typeof appConfirm === 'function'
            ? await appConfirm(`保存されているシーン ${S.proj.scenes.length}件 をすべてクリアしますか？`, { okText: '一括クリア', danger: true })
            : confirm(`保存されているシーン ${S.proj.scenes.length}件 をすべてクリアしますか？`);
          if (!ok) return;
          cp('全シーン一括クリア');
          S.proj.scenes = [];
          UI.expandedScenes.clear();
          UI.expandedSlotScenes.clear();
          UI.sceneLimit = 50;
          UI.lastCheckedIdx = -1;
          UI.boardTarget = 'global';
          candidateCache.clear();
          CCF.saveProject(); render();
          say('🗑️ 全シーンを一括クリアしました');
          return;
        }
        if (k === 'more-scenes') { UI.sceneLimit = (UI.sceneLimit || 50) + 50; render(); return; }
        if (k === 'all-scenes') { UI.sceneLimit = Math.max(S.proj.scenes.length, 50); render(); return; }
        if (k === 'checkall') {
          cp('シーン選択切替');
          const on = !S.proj.scenes.every(s => s.checked);
          S.proj.scenes.forEach(s => { s.checked = on; });
          CCF.saveProject(); render(); return;
        }
        return;
      }

      const calcBtn = e.target.closest('[data-scn-calc]');
      if (calcBtn) {
        const sc = S.proj.scenes[+calcBtn.dataset.scnCalc];
        if (sc) {
          invalidateCandidate(sc);
          computeCandidatesForScene(sc, getMatchSources());
          UI.expandedSlotScenes.add(sc.id);
          render();
          say(`✨「${sc.title}」の素材候補を更新しました`);
        }
        return;
      }

      const slotTog = e.target.closest('[data-scn-slots-toggle]');
      if (slotTog) {
        const id = slotTog.dataset.scnSlotsToggle;
        if (UI.expandedSlotScenes.has(id)) UI.expandedSlotScenes.delete(id);
        else UI.expandedSlotScenes.add(id);
        render(); return;
      }

      const tog = e.target.closest('[data-scn-toggle]');
      if (tog) {
        const id = tog.dataset.scnToggle;
        if (UI.expandedScenes.has(id)) UI.expandedScenes.delete(id); else UI.expandedScenes.add(id);
        render(); return;
      }

      const openBoardBtn = e.target.closest('[data-scn-openboard]');
      if (openBoardBtn) {
        stopPreviewAudio();
        setBoardTarget(openBoardBtn.dataset.scnOpenboard || 'global');
        UI.subView = 'board';
        render();
        return;
      }

      const dupBtn = e.target.closest('[data-scn-dup]');
      if (dupBtn) {
        duplicateSceneById(dupBtn.dataset.scnDup);
        return;
      }
      const upBtn = e.target.closest('[data-scn-up]');
      if (upBtn) {
        moveSceneByOffset(upBtn.dataset.scnUp, -1);
        return;
      }
      const dnBtn = e.target.closest('[data-scn-dn]');
      if (dnBtn) {
        moveSceneByOffset(dnBtn.dataset.scnDn, 1);
        return;
      }
      const msgBtn = e.target.closest('[data-scn-msg-copy],[data-scn-msg-title],[data-scn-msg-clear]');
      if (msgBtn) {
        const sid = msgBtn.dataset.scnMsgCopy || msgBtn.dataset.scnMsgTitle || msgBtn.dataset.scnMsgClear;
        const sc = S.proj.scenes.find(s => s.id === sid);
        const card = msgBtn.closest('.ccf-scn-card');
        if (sc) {
          const actName = msgBtn.dataset.scnMsgCopy ? 'copy' : msgBtn.dataset.scnMsgTitle ? 'title' : 'clear';
          const textEl = card ? card.querySelector('[data-scn-text]') : null;
          const msgEl = card ? card.querySelector('[data-scn-msg]') : null;
          applySceneMessageAction(sc, actName, textEl, msgEl);
        }
        return;
      }

      const splitEdBtn = e.target.closest('[data-scn-split-editor]');
      if (splitEdBtn) {
        openSceneSplitEditorModal(splitEdBtn.dataset.scnSplitEditor);
        return;
      }

      const prevBtn = e.target.closest('[data-scn-preview]');
      if (prevBtn) { openBoardModal(prevBtn.dataset.scnPreview); return; }

      const delBtn = e.target.closest('[data-scn-del]');
      if (delBtn) {
        const sc = S.proj.scenes[+delBtn.dataset.scnDel];
        if (sc) deleteSceneById(sc.id);
        return;
      }

      const splitCurBtn = e.target.closest('[data-scn-split-cursor]');
      if (splitCurBtn) {
        const idx = +splitCurBtn.dataset.scnSplitCursor;
        const sc = S.proj.scenes[idx];
        if (sc) splitSceneAtCursorById(sc.id, panel.querySelector(`[data-scn-text="${idx}"]`));
        return;
      }

      const insDelimBtn = e.target.closest('[data-scn-insert-delim]');
      if (insDelimBtn) {
        const idx = +insDelimBtn.dataset.scnInsertDelim;
        const sc = S.proj.scenes[idx];
        if (sc) insertDelimiterInTextarea(sc.id, panel.querySelector(`[data-scn-text="${idx}"]`));
        return;
      }

      const splitDelimBtn = e.target.closest('[data-scn-split-delim]');
      if (splitDelimBtn) {
        const idx = +splitDelimBtn.dataset.scnSplitDelim;
        const sc = S.proj.scenes[idx];
        if (sc) splitSceneAtDelimitersById(sc.id);
        return;
      }

      const appSelBtn = e.target.closest('[data-scn-append-sel]');
      if (appSelBtn) {
        const sc = S.proj.scenes[+appSelBtn.dataset.scnAppendSel];
        if (sc) applySelectionToScene(sc.id, 'append');
        return;
      }

      const repSelBtn = e.target.closest('[data-scn-replace-sel]');
      if (repSelBtn) {
        const sc = S.proj.scenes[+repSelBtn.dataset.scnReplaceSel];
        if (sc) applySelectionToScene(sc.id, 'replace');
        return;
      }

      const mergeBtn = e.target.closest('[data-scn-merge]');
      if (mergeBtn) {
        const idx = +mergeBtn.dataset.scnMerge;
        if (idx > 0 && idx < S.proj.scenes.length) {
          cp('シーン結合');
          const removedId = S.proj.scenes[idx] && S.proj.scenes[idx].id;
          S.proj.scenes = SM.mergeSceneWithPrev(S.proj.scenes, idx).map(M.sanitizeScene).filter(Boolean);
          if (removedId && UI.boardTarget === removedId) UI.boardTarget = S.proj.scenes[idx - 1] ? S.proj.scenes[idx - 1].id : 'global';
          candidateCache.clear();
          CCF.saveProject(); render();
          say('🗑️ 分割を削除し、前のシーンと結合しました');
        }
        return;
      }

      const roleSetBtn = e.target.closest('[data-scn-role-set]');
      if (roleSetBtn) {
        const id = roleSetBtn.dataset.scnRoleSet;
        const role = roleSetBtn.dataset.role;
        const cfg = S.proj.sceneParseConfig;
        cfg.patternRoles = Object.assign({}, cfg.patternRoles || {}, { [id]: role });
        cfg.enabledPatterns = Object.keys(cfg.patternRoles).filter(k => cfg.patternRoles[k] === 'scene');
        CCF.saveProject();
        render();
        return;
      }

      const addStockBtn = e.target.closest('[data-scn-add-stock]');
      if (addStockBtn) {
        e.stopPropagation();
        addSubheadingToStock(+addStockBtn.dataset.scnAddStock, +addStockBtn.dataset.line);
        return;
      }

      const splitBtn = e.target.closest('[data-scn-split]') || e.target.closest('.ccf-scn-line[data-scn-line]');
      if (splitBtn) {
        const idx = +(splitBtn.dataset.scnSplit != null ? splitBtn.dataset.scnSplit : splitBtn.dataset.i);
        const lineIdx = +(splitBtn.dataset.line != null ? splitBtn.dataset.line : splitBtn.dataset.scnLine);
        if (!(lineIdx >= 1)) return;
        cp('シーン分割');
        S.proj.scenes = SM.splitSceneAtLine(S.proj.scenes, idx, lineIdx).map(M.sanitizeScene).filter(Boolean);
        if (S.proj.scenes[idx + 1]) UI.expandedScenes.add(S.proj.scenes[idx + 1].id);
        candidateCache.clear();
        CCF.saveProject(); render();
        say('✂️ 新しいシーンに分割しました');
        return;
      }

      if (handleSlotActionClick(e, render)) return;

      // ---- カットインアクション ----
      const ciBtn = e.target.closest('[data-ci]');
      if (ciBtn) {
        const act = ciBtn.dataset.ci, idx = +ciBtn.dataset.i;
        if (act === 'add') {
          cp('カットイン追加');
          S.proj.cutins.push(M.sanitizeCutin({ name: 'カットイン ' + (S.proj.cutins.length + 1) }));
          CCF.saveProject(); render(); return;
        }
        const c = S.proj.cutins[idx]; if (!c) return;
        if (act === 'del') { cp('カットイン削除'); S.proj.cutins.splice(idx, 1); CCF.saveProject(); render(); return; }
        if (act === 'play') return playCutinStage(c);
        if (act === 'pick-visual' && CCF.assets && CCF.assets.pickAsset) {
          const asset = await CCF.assets.pickAsset({ key: S.key, types: ['image', 'video'], title: 'カットイン画像・動画を選択' });
          if (!asset) return;
          cp('カットイン映像変更');
          c.visualType = asset.type === 'video' ? 'video' : 'image';
          c.visualPath = asset.path || '';
          c.visualDataUrl = asset.dataUrl || '';
          c.visualName = asset.name || '';
          c.visualUid = asset.uid || '';
          CCF.saveProject(); render(); return;
        }
        if (act === 'pick-se' && CCF.assets && CCF.assets.pickAsset) {
          const asset = await CCF.assets.pickAsset({ key: S.key, types: ['audio'], title: 'SE音源を選択' });
          if (!asset) return;
          cp('カットインSE変更');
          c.sePath = asset.path || '';
          c.seName = asset.name || '';
          c.seUid = asset.uid || '';
          CCF.saveProject(); render(); return;
        }
        if (act === 'save-pkg' && window.CommonAssets && window.CommonAssets.saveCutinPackage) {
          const pkg = window.CommonAssets.saveCutinPackage(c);
          if (pkg) { render(); say(`📦「${pkg.name}」をマイライブラリへパッケージ保存しました`); }
          return;
        }
        return;
      }

      const pkgBtn = e.target.closest('[data-pkg]');
      if (pkgBtn && window.CommonAssets) {
        const act = pkgBtn.dataset.pkg, id = pkgBtn.dataset.id;
        const pkg = window.CommonAssets.getCutinPackages().find(x => x.id === id);
        if (!pkg) return;
        if (act === 'play') return playCutinStage(pkg);
        if (act === 'recall') {
          cp('カットインパッケージ呼び出し');
          S.proj.cutins.push(M.sanitizeCutin(Object.assign({}, pkg, { id: M.newId() })));
          CCF.saveProject(); render();
          say(`⚡「${pkg.name}」をこの部屋へ呼び出しました`);
        } else if (act === 'del') {
          window.CommonAssets.deleteCutinPackage(id);
          render();
          say('🗑️ カットインパッケージを削除しました');
        }
      }
    });

    panel.addEventListener('change', e => {
      if (e.target.closest('#ccfBoardInlineHost')) return;
      const batchChk = e.target.closest('[data-bp-batch]');
      if (batchChk) {
        UI.batchSlots = UI.batchSlots || { fg: true, bgm: true, bg: false, marker: false };
        UI.batchSlots[batchChk.dataset.bpBatch] = !!batchChk.checked;
        return;
      }
      const bgmVolEl = e.target.closest('[data-bgm-vol-range],[data-bgm-vol-num]');
      if (bgmVolEl) {
        const sc = S.proj.scenes.find(s => s.id === bgmVolEl.dataset.bgmScnid);
        if (sc && sc.bgm) {
          cp('BGM音量変更');
          applyBgmVolumeLive(sc, bgmVolEl.value, bgmVolEl);
        }
        return;
      }
      const bgmLoopChk = e.target.closest('[data-bgm-loop]');
      if (bgmLoopChk) {
        const sc = S.proj.scenes.find(s => s.id === bgmLoopChk.dataset.bgmScnid);
        if (sc && sc.bgm) {
          cp('BGMループ設定変更');
          sc.bgm.loop = !!bgmLoopChk.checked;
          if (UI.audio && (UI.audioSceneId === sc.id || (sc.bgm.path && UI.audioKey === sc.bgm.path))) {
            UI.audio.loop = sc.bgm.loop;
          }
          CCF.saveProject();
        }
        return;
      }
      if (e.target.id === 'ccfSceneDocSel') {
        S.proj.sceneParseConfig.sourcePath = e.target.value;
        CCF.saveProject();
        return;
      }
      if (e.target.id === 'ccfRangeStart') {
        const n = Math.floor(Number(e.target.value) || 0);
        S.proj.sceneParseConfig.startPage = n >= 1 ? n : null;
        CCF.saveProject();
        return;
      }
      if (e.target.id === 'ccfRangeEnd') {
        const n = Math.floor(Number(e.target.value) || 0);
        S.proj.sceneParseConfig.endPage = n >= 1 ? n : null;
        CCF.saveProject();
        return;
      }
      if (e.target.id === 'ccfCleanLineBreaksChk') {
        S.proj.sceneParseConfig.cleanLineBreaks = !!e.target.checked;
        CCF.saveProject();
        return;
      }
      if (e.target.id === 'ccfUseOutlineChk') {
        S.proj.sceneParseConfig.useOutline = !!e.target.checked;
        CCF.saveProject();
        return;
      }
      if (e.target.id === 'ccfAutoGuardChk') {
        S.proj.sceneParseConfig.autoGuard = !!e.target.checked;
        CCF.saveProject();
        return;
      }
      if (e.target.name === 'ccfGranularity') {
        const cfg = S.proj.sceneParseConfig;
        cfg.granularity = e.target.value;
        const roles = SM.recommendPatternRoles(UI.headingStats, cfg.granularity);
        cfg.patternRoles = roles;
        cfg.enabledPatterns = Object.keys(roles).filter(k => roles[k] === 'scene');
        CCF.saveProject();
        render();
        return;
      }
      const ruleChk = e.target.closest('[data-scn-rule]');
      if (ruleChk) {
        const id = ruleChk.dataset.scnRule;
        const set = new Set(S.proj.sceneParseConfig.enabledPatterns || []);
        if (ruleChk.checked) set.add(id); else set.delete(id);
        S.proj.sceneParseConfig.enabledPatterns = [...set];
        CCF.saveProject();
        return;
      }
      const titleInp = e.target.closest('[data-scn-title]');
      if (titleInp) {
        const sc = S.proj.scenes[+titleInp.dataset.scnTitle];
        if (sc) {
          sc.title = titleInp.value;
          invalidateCandidate(sc);
          CCF.saveProject();
          scheduleSceneCardCandsUpdate(sc);
        }
        return;
      }
      if (e.target.id === 'ccfCustomHeadingInp') {
        S.proj.sceneParseConfig.customPrefixes = e.target.value;
        if (UI.parsedLines) UI.headingStats = SM.detectHeadingStats(filterLinesByConfigRange(UI.parsedLines), e.target.value);
        CCF.saveProject(); render(); return;
      }
      const ciField = e.target.closest('[data-ci-f]');
      if (ciField) {
        const card = ciField.closest('[data-ci-idx]');
        const c = card && S.proj.cutins[+card.dataset.ciIdx];
        if (!c) return;
        cp('カットイン設定変更');
        const k = ciField.dataset.ciF;
        c[k] = (k === 'seVolume' || k === 'durationMs') ? Number(ciField.value) : ciField.value;
        CCF.saveProject(); render();
      }
    });

    panel.addEventListener('input', e => {
      if (e.target.closest('#ccfBoardInlineHost')) return;
      const bgmVolEl = e.target.closest('[data-bgm-vol-range],[data-bgm-vol-num]');
      if (bgmVolEl) {
        const sc = S.proj.scenes.find(s => s.id === bgmVolEl.dataset.bgmScnid);
        if (sc && sc.bgm) applyBgmVolumeLive(sc, bgmVolEl.value, bgmVolEl);
        return;
      }
      const scnMsg = e.target.closest('[data-scn-msg]');
      if (scnMsg) {
        const sc = S.proj.scenes[+scnMsg.dataset.scnMsg];
        if (sc) {
          sc.sceneMessage = scnMsg.value;
          CCF.saveProject();
        }
        return;
      }
      const scnTxt = e.target.closest('[data-scn-text]');
      if (scnTxt) {
        if (typeof scnTxt.selectionStart === 'number') {
          scnTxt._lastCursor = scnTxt.selectionStart;
          scnTxt._lastCursorEnd = scnTxt.selectionEnd;
        }
        const sc = S.proj.scenes[+scnTxt.dataset.scnText];
        if (sc) {
          sc.text = scnTxt.value;
          invalidateCandidate(sc);
          CCF.saveProject();
          scheduleSceneCardCandsUpdate(sc);
        }
        return;
      }
      const titleInp = e.target.closest('[data-scn-title]');
      if (titleInp) {
        const sc = S.proj.scenes[+titleInp.dataset.scnTitle];
        if (sc) {
          sc.title = titleInp.value;
          invalidateCandidate(sc);
          CCF.saveProject();
          scheduleSceneCardCandsUpdate(sc);
        }
        return;
      }
      const ciField = e.target.closest('[data-ci-f="seVolume"]');
      if (ciField) {
        const card = ciField.closest('[data-ci-idx]');
        const c = card && S.proj.cutins[+card.dataset.ciIdx];
        if (c) {
          c.seVolume = Number(ciField.value);
          const lbl = ciField.parentElement && ciField.parentElement.querySelector('span');
          if (lbl) lbl.textContent = c.seVolume + '%';
          CCF.saveProject();
        }
      }
    });

    let dragCardIdx = -1;
    const clearCardDropMarks = () => {
      panel.querySelectorAll('.ccf-scn-card.drag-over-top,.ccf-scn-card.drag-over-bot,.ccf-scn-card.is-dragging').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bot', 'is-dragging');
      });
    };
    panel.addEventListener('dragstart', e => {
      if (e.target.closest('#ccfBoardInlineHost')) return;
      const h = e.target.closest('[data-scn-drag]');
      if (!h) return;
      dragCardIdx = +h.dataset.scnDrag;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragCardIdx));
        const card = h.closest('.ccf-scn-card');
        if (card) {
          card.classList.add('is-dragging');
          try { e.dataTransfer.setDragImage(card, 20, 16); } catch (_) { }
        }
      }
    });
    panel.addEventListener('dragover', e => {
      if (e.target.closest('#ccfBoardInlineHost') || dragCardIdx < 0) return;
      const card = e.target.closest('.ccf-scn-card[data-scn-idx]');
      if (!card) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      panel.querySelectorAll('.ccf-scn-card.drag-over-top,.ccf-scn-card.drag-over-bot').forEach(c => {
        if (c !== card) c.classList.remove('drag-over-top', 'drag-over-bot');
      });
      card.classList.toggle('drag-over-top', !after);
      card.classList.toggle('drag-over-bot', after);
    });
    panel.addEventListener('drop', e => {
      if (e.target.closest('#ccfBoardInlineHost') || dragCardIdx < 0) return;
      const card = e.target.closest('.ccf-scn-card[data-scn-idx]');
      if (!card) return;
      e.preventDefault();
      const rawIdx = +card.dataset.scnIdx;
      const fromIdx = dragCardIdx;
      dragCardIdx = -1;
      clearCardDropMarks();
      if (fromIdx === rawIdx) return;
      const rect = card.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      let toIdx = after ? (fromIdx < rawIdx ? rawIdx : rawIdx + 1) : (fromIdx < rawIdx ? rawIdx - 1 : rawIdx);
      toIdx = Math.max(0, Math.min(S.proj.scenes.length - 1, toIdx));
      reorderSceneIndex(fromIdx, toIdx);
    });
    panel.addEventListener('dragend', () => {
      if (dragCardIdx >= 0) {
        dragCardIdx = -1;
        clearCardDropMarks();
      }
    });
  }

  CCF.sceneUI = {
    render,
    wire,
    setSubView(v) {
      const next = normalizeSubView(v);
      if (next !== UI.subView) stopPreviewAudio();
      UI.subView = next;
      render();
    },
    onProjectSwitch() {
      closeActiveMenu();
      candidateCache.clear();
      UI.parsedLines = null;
      UI.parsedOutline = [];
      UI.parsedPath = '';
      UI.parsedName = '';
      UI.parsedRange = null;
      UI.headingStats = null;
      UI.lastSplitMethod = '';
      UI.expandedScenes.clear();
      UI.expandedSlotScenes.clear();
      UI.sceneLimit = 50;
      UI.lastCheckedIdx = -1;
      UI.boardTarget = 'global';
      UI.selectedItemId = '';
      UI.selectedIds = new Set();
      UI.cameraFitted = false;
      UI._fittedStageW = 0;
      UI._fittedStageH = 0;
      UI.panMode = false;
      UI._savedInlineCam = null;
      UI.audioSceneId = '';
    },
    getPageLines,
    refitCamera,
    openBoardModal,
    closeBoardModal,
    stopPreviewAudio
  };
})();
