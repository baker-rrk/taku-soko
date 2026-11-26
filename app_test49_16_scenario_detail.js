/* app_test49_16_scenario_detail.js — 📋 シナリオ詳細モーダル（ホームのカード・一覧クリックで開く）
 * 概要・スペック／同梱素材（画像・PDF・ZIP・BGM）／アクション4ボタン。モーダルへのD&D（フォルダ・ZIP・PDF・BGM・画像）で素材を追加できる。 */
(function () {
  let sdId = null, sdEl = null, sdDraft = null, sdTagPickerOpen = false, sdPeek = false, sdThumbOpen = false, sdSelSlot = 0, sdEditNotes = false, sdEditTrailer = false, sdEditSynopsis = false, sdEditFreeText = false, sdEditBlockId = '', sdEditHoIdx = -1, sdRangeTimer = null;
  let sdOpenHOs = new Set();
let sdOpenSecs = new Set();   // 開いているアコーディオン（基本は全て閉）
  let sdHoverTimer = null, sdHoverIdx = 0, sdDragSlot = -1;
  let sdSpecSortMode = false, sdSpecAddOpen = false, sdDragSpecKey = '', sdFocusSpecKey = '', sdFocusSpecPart = '';
  const isCreateMode = () => !!sdDraft;
  const curSc = () => sdDraft || scOf(sdId);
  const E = s => escapeHTML(String(s == null ? '' : s));
  const specFirstLine = (sc, key, cs) => (typeof getScenarioSpecFirstLine === 'function')
    ? getScenarioSpecFirstLine(sc, key, cs)
    : String((cs ? cs.value : (sc && sc[key])) || '').split(/\r?\n/)[0].trim();
  const specFullVal = (sc, key, cs) => (typeof getScenarioSpecFullVal === 'function')
    ? getScenarioSpecFullVal(sc, key, cs)
    : String((cs ? cs.value : (sc && sc[key])) || '');
  const mergeFirstLine = (prevFull, newLine) => (typeof mergeSpecFirstLine === 'function')
    ? mergeSpecFirstLine(prevFull, newLine)
    : String(newLine == null ? '' : newLine).split(/\r?\n/)[0].trim();
  const CORE_SPEC_KEYS = ['system', 'playerCount', 'playTime', 'recSkills', 'lostRate'];
  const DEFAULT_SPEC_ORDER = ['system', 'playerCount', 'playTime', 'reqSkills', 'recSkills', 'semiRecSkills', 'lostRate', 'aftereffect'];
  const STD_SPEC_LABELS = {
    system: 'システム', playerCount: '人数', playTime: 'プレイ時間',
    reqSkills: '必須技能', recSkills: '推奨技能', semiRecSkills: '準推奨技能',
    lostRate: 'ロスト率', aftereffect: '後遺症'
  };
  const SPEC_PRESETS = [
    { kind: 'std', key: 'reqSkills', label: '必須技能' },
    { kind: 'std', key: 'semiRecSkills', label: '準推奨技能' },
    { kind: 'std', key: 'aftereffect', label: '後遺症' },
    { kind: 'custom', label: 'HO構成' },
    { kind: 'custom', label: '舞台・時代' },
    { kind: 'custom', label: '傾向・ジャンル' },
    { kind: 'custom', label: '必要サプリ' },
    { kind: 'custom', label: 'GM難易度' },
    { kind: 'custom', label: '自由入力項目', isFree: true }
  ];
  const SYSTEM_SUGGESTIONS = ['CoC6版', 'CoC7版', 'エモクロア', 'インセイン', 'シノビガミ', 'マダミス', 'ストリテラ', 'SW2.5', 'DX3rd', 'フタリソウサ', 'ネクロニカ', 'ケダモノオペラ', 'パラノイア', 'アリアンロッド', 'ゴブリンスレイヤー'];
  function getSystemOptions(curVal) {
    const out = [];
    const seen = new Set();
    const add = v => {
      const s = String(v == null ? '' : v).trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };
    const presets = (typeof appState !== 'undefined' && Array.isArray(appState.tagPresets)) ? appState.tagPresets : [];
    const sysKeys = typeof rawSystemKeys === 'function' ? rawSystemKeys() : null;
    const grpOf = typeof tagGroupOf === 'function' ? tagGroupOf : null;
    presets.forEach(t => {
      const s = String(t || '').trim();
      if (s && (!grpOf || grpOf(s, sysKeys) === 'sys')) add(s);
    });
    SYSTEM_SUGGESTIONS.forEach(add);
    if (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) {
      appState.scenarios.forEach(s => { if (s && s.system) add(specFirstLine(s, 'system')); });
    }
    if (curVal) add(String(curVal).split(/\r?\n/)[0].trim());
    return out;
  }
  function buildSystemSelectHtml(curVal) {
    const cur = String(curVal || '').trim();
    const opts = getSystemOptions(cur);
    const optsHtml = `<option value=""${!cur ? ' selected' : ''}>未設定</option>`
      + opts.map(s => `<option value="${E(s)}"${s === cur ? ' selected' : ''}>${E(s)}</option>`).join('')
      + `<option value="__other__">＋ その他（直接入力）...</option>`;
    return `<select data-sd-field="system" class="sd-inline-select" title="システムを選択">${optsHtml}</select>`;
  }
  const SPEC_PLACEHOLDERS = {
    system: '選択または入力（例: CoC6版）',
    playerCount: '例: 2〜4人 / タイマン',
    playTime: '例: 3〜4時間',
    recSkills: '例: 目星、図書館、心理学',
    lostRate: '例: 低 / 中 / 高 / なし',
    reqSkills: '必須技能',
    semiRecSkills: '準推奨技能',
    aftereffect: '後遺症'
  };
  const hasCcf = () => !!(window.CCF && CCF.readProject && window.CCFModel);
  const scOf = id => appState.scenarios.find(s => s.id === id);
  const fileUrl = p => {
    if (!p) return '';
    if (window.WebBridge && WebBridge.isAssetRef(p)) return WebBridge.peekAssetUrl(p) || '';
    if (/^(?:data:|blob:|https?:|file:)/i.test(p)) return p;
    if (!IS_ELECTRON) return '';
    try { return require('url').pathToFileURL(p).href; } catch (e) { logSoft('sdFileUrl', e); return ''; }
  };
  const normCat = c => (window.CCFModel && CCFModel.normalizeStandardCat) ? CCFModel.normalizeStandardCat(c) : ((!c || (window.CCFModel && CCFModel.isUnclassifiedCat(c))) ? '' : String(c).trim());
  const refsOf = sc => { if (!window.CCF || !CCF.readProject) return []; try { return (CCF.readProject(String(sc.id)).refs || []).filter(r => r && r.path); } catch (e) { logSoft('sdRefs', e); return []; } };
  const roomsOf = sc => { if (!hasCcf() || !CCF.getRoomContainer) return []; try { const c = CCF.getRoomContainer(String(sc.id)); return c && Array.isArray(c.rooms) ? c.rooms : []; } catch (e) { logSoft('sdRooms', e); return []; } };

  function thumbStyleStr(sc) {
    const ts = (sc && sc.thumbSettings) || {};
    const x = clampThumbNum(sc && sc.thumbPosX !== undefined ? sc.thumbPosX : ts.posX, 0, 100, 50);
    const y = clampThumbNum(sc && sc.thumbPosY !== undefined ? sc.thumbPosY : ts.posY, 0, 100, 50);
    const z = clampThumbNum(sc && sc.thumbZoom !== undefined ? sc.thumbZoom : ts.zoom, 25, 250, 100);
    const fit = ((sc && sc.thumbFit === 'contain') || ts.fit === 'contain') ? 'contain' : 'cover';
    const useContain = fit === 'contain' || z < 100;
    return `object-fit:${useContain ? 'contain' : 'cover'}; object-position:${x}% ${y}%; transform:scale(${(z / 100).toFixed(2)}); transform-origin:${x}% ${y}%;`;
  }
  function ensureCustomSpecs(sc) {
    if (!sc) return [];
    if (!Array.isArray(sc.customSpecs)) sc.customSpecs = [];
    return sc.customSpecs;
  }
  const SYNOPSIS_KEY_RE = /^(?:[■◆●▸▹・]\s*)?(?:あらすじ|ストーリー|導入|イントロダクション|イントロ|背景|概略|背景ストーリー|synopsis|story|introduction|intro)$/i;
  const NOTES_KEY_RE = /^(?:[■◆●▸▹・]\s*)?(?:注意事項・備考|注意事項|備考|注意|メモ|特記事項|notes?)$/i;
  function blockHeadingOf(b) {
    if (!b || typeof b !== 'object') return '';
    return String(b.keyName !== undefined && b.keyName !== null ? b.keyName : (b.label || '')).trim();
  }
  function blockHasContent(b) {
    if (!b || typeof b !== 'object') return false;
    if (String(b.val || '').trim()) return true;
    if (Array.isArray(b.subItems) && b.subItems.some(s => s && (String(s.title || '').trim() || String(s.val || '').trim()))) return true;
    return false;
  }
  function isSynopsisCandidate(b) {
    if (!b || typeof b !== 'object') return false;
    if (b.type === 'summary_container' || b.type === 'image' || b.type === 'split') return false;
    if (b.id === 'notes') return false;
    const kn = blockHeadingOf(b);
    if (SYNOPSIS_KEY_RE.test(kn)) return true;
    if ((b.id === 'intro' || b.id === 'synopsis' || b.id === 'story') && !NOTES_KEY_RE.test(kn) && (!kn || SYNOPSIS_KEY_RE.test(kn))) return true;
    return false;
  }
  function isNotesCandidate(b) {
    if (!b || typeof b !== 'object') return false;
    if (b.type === 'summary_container' || b.type === 'image' || b.type === 'split') return false;
    const kn = blockHeadingOf(b);
    if (NOTES_KEY_RE.test(kn)) return true;
    if (b.id === 'notes' && (!kn || NOTES_KEY_RE.test(kn))) return true;
    return false;
  }
  function ensureDetailBlocksSynced(sc) {
    if (!sc || typeof sc !== 'object') return [];
    const blocks = (typeof ensureScenarioBlocks === 'function') ? ensureScenarioBlocks(sc) : (Array.isArray(sc.fullBlockData) ? sc.fullBlockData : (Array.isArray(sc.publicBlocks) ? sc.publicBlocks : []));
    const sum = blocks.find(b => b && b.type === 'summary_container' && Array.isArray(b.items));
    if (sum) {
      const customs = ensureCustomSpecs(sc);
      sum.items.forEach((it, idx) => {
        if (!it) return;
        const f = it.field || (typeof FLAT_MAP !== 'undefined' && FLAT_MAP[it.keyName]);
        if (f && STD_SPEC_LABELS[f]) {
          const full = specFullVal(sc, f);
          if (full) { sc[f] = full; it.val = full; }
          it.field = f;
        } else {
          const lbl = String(it.keyName || '').trim();
          const val = String(it.val || '');
          if (!lbl && !val.trim() && !it.customId) return;
          let cs = customs.find(c => c && ((it.customId && c.id === it.customId) || (!it.customId && c.label === lbl)));
          if (!cs) {
            const cid = it.customId || ('cs_' + (idx + 1) + '_' + Math.random().toString(36).slice(2, 6));
            it.customId = cid;
            cs = { id: cid, label: lbl || '項目', value: val };
            customs.push(cs);
          } else {
            it.customId = cs.id;
            const full = specFullVal(sc, '', cs);
            if (full) { cs.value = full; it.val = full; }
          }
        }
      });
    }
    blocks.forEach((b, idx) => {
      if (b && !b.id) b.id = 'blk_' + idx + '_' + Math.random().toString(36).slice(2, 6);
    });
    return blocks;
  }
  function classifyScenarioPublicBlocks(sc) {
    const blocks = ensureDetailBlocksSynced(sc);
    const summaryBlock = blocks.find(b => b && b.type === 'summary_container') || null;
    const synCands = blocks.filter(isSynopsisCandidate);
    const synopsisBlock = synCands.find(blockHasContent) || synCands[0] || null;
    const noteCands = blocks.filter(b => b !== synopsisBlock && isNotesCandidate(b));
    const notesBlock = noteCands.find(blockHasContent) || noteCands[0] || null;
    if (notesBlock && !String(sc.notes || '').trim() && String(notesBlock.val || '').trim()) {
      sc.notes = notesBlock.val;
    }
    if (synopsisBlock && !String(synopsisBlock.val || '').trim() && typeof sc.synopsis === 'string' && sc.synopsis.trim()) {
      synopsisBlock.val = sc.synopsis;
    }
    const otherBlocks = blocks.filter(b => {
      if (!b || b.type === 'summary_container' || b.type === 'image' || b.type === 'split') return false;
      if (b === synopsisBlock || b === notesBlock) return false;
      if ((isSynopsisCandidate(b) || isNotesCandidate(b)) && !blockHasContent(b)) return false;
      return true;
    });
    return { blocks, summaryBlock, synopsisBlock, notesBlock, otherBlocks };
  }
  function renderBlockBodyHtml(b, fallbackVal) {
    const subs = (b && Array.isArray(b.subItems)) ? b.subItems.filter(s => s && (String(s.title || '').trim() || String(s.val || '').trim())) : [];
    const rawVal = b && b.val != null ? String(b.val) : '';
    const mainVal = rawVal.trim() ? rawVal : (subs.length === 0 ? String(fallbackVal || '') : '');
    const parts = [];
    if (mainVal.trim()) {
      parts.push(`<div class="sd-story">${linkifyTextHtml(mainVal)}</div>`);
    }
    subs.forEach(s => {
      const st = String(s.title || '').trim();
      const sv = String(s.val || '').trim();
      parts.push(`<div class="sd-subitem">${st ? `<div class="sd-subitem-title">${E(st)}</div>` : ''}${sv ? `<div class="sd-story">${linkifyTextHtml(sv)}</div>` : ''}</div>`);
    });
    return parts.join('');
  }
  function isStdSpecVisible(sc, key, explicitSet) {
    if (CORE_SPEC_KEYS.includes(key)) return true;
    if (specFirstLine(sc, key) !== '') return true;
    return !!(explicitSet && explicitSet.has(key));
  }
  function insertIntoOrderSmart(order, key) {
    if (order.includes(key)) return;
    if (key === 'reqSkills') {
      const idx = order.indexOf('recSkills');
      if (idx >= 0) order.splice(idx, 0, key);
      else order.splice(Math.min(3, order.length), 0, key);
    } else if (key === 'semiRecSkills') {
      const idx = order.indexOf('recSkills');
      if (idx >= 0) order.splice(idx + 1, 0, key);
      else {
        const lrIdx = order.indexOf('lostRate');
        if (lrIdx >= 0) order.splice(lrIdx, 0, key);
        else order.push(key);
      }
    } else if (key === 'aftereffect') {
      const idx = order.indexOf('lostRate');
      if (idx >= 0) order.splice(idx + 1, 0, key);
      else order.push(key);
    } else {
      order.push(key);
    }
  }
  function getResolvedSpecOrder(sc) {
    const customs = ensureCustomSpecs(sc);
    const customMap = new Map(customs.filter(c => c && c.id).map(c => ['custom:' + c.id, c]));
    const raw = Array.isArray(sc && sc.specOrder) ? sc.specOrder : [];
    const explicitSet = new Set(raw);
    const order = [];
    const seen = new Set();
    raw.forEach(k => {
      if (!k || seen.has(k)) return;
      if (STD_SPEC_LABELS[k]) {
        if (isStdSpecVisible(sc, k, explicitSet)) { seen.add(k); order.push(k); }
      } else if (customMap.has(k)) {
        seen.add(k); order.push(k);
      }
    });
    DEFAULT_SPEC_ORDER.forEach(k => {
      if (!seen.has(k) && isStdSpecVisible(sc, k, explicitSet)) {
        seen.add(k);
        insertIntoOrderSmart(order, k);
      }
    });
    customs.forEach(c => {
      if (!c || !c.id) return;
      const k = 'custom:' + c.id;
      if (!seen.has(k)) { seen.add(k); order.push(k); }
    });
    return order;
  }
  function ensureSpecOrder(sc) {
    const order = getResolvedSpecOrder(sc);
    sc.specOrder = order;
    return order;
  }
  function getThumbSlots(sc) {
    if (typeof window.getScenarioThumbSlots === 'function') return window.getScenarioThumbSlots(sc);
    if (!sc) return [];
    const out = [];
    const push = u => { const s = String(u || '').trim(); if (s && !out.includes(s) && out.length < 4) out.push(s); };
    push(sc.imageUrl);
    if (Array.isArray(sc.hoverImages)) sc.hoverImages.forEach(push);
    return out;
  }
  function applyThumbSlots(sc, slots) {
    if (typeof window.applyScenarioThumbSlots === 'function') return window.applyScenarioThumbSlots(sc, slots);
    if (!sc) return [];
    const clean = [];
    (Array.isArray(slots) ? slots : []).forEach(u => { const s = String(u || '').trim(); if (s && !clean.includes(s) && clean.length < 4) clean.push(s); });
    sc.imageUrl = clean[0] || '';
    sc.hoverImages = clean.slice(1, 4);
    return clean;
  }
  function stopTrailerHover() {
    clearInterval(sdHoverTimer); sdHoverTimer = null; sdHoverIdx = 0;
    if (!sdEl) return;
    const wrap = sdEl.querySelector('.sd-trailer-wrap');
    if (!wrap) return;
    const img = wrap.querySelector('img.sd-trailer');
    const ind = wrap.querySelector('.sd-hover-ind');
    const sc = curSc();
    if (img && img.dataset.origSrc !== undefined) {
      img.src = img.dataset.origSrc;
      delete img.dataset.origSrc;
    }
    if (img && sc) img.setAttribute('style', thumbStyleStr(sc));
    if (ind && ind.dataset.total) ind.textContent = `🖼️ 1/${ind.dataset.total}`;
  }

  function bodyHtml(sc) {
    const isCreate = isCreateMode();
    const { summaryBlock, synopsisBlock, notesBlock, otherBlocks } = classifyScenarioPublicBlocks(sc);
    const imgs = isCreate ? [] : (Array.isArray(sc.images) ? sc.images : []);
    const rawRefs = isCreate ? [] : (() => {
      if (!window.CCF || !CCF.readProject) return [];
      try { return (CCF.readProject(String(sc.id)).refs || []).filter(Boolean); } catch (e) { logSoft('sdRefs', e); return []; }
    })();
    const pdfDocs = isCreate ? [] : (sc.docs || []);
    const unified = isCreate ? [] : ((window.CCF && CCF.assets && typeof CCF.assets.getUnifiedItems === 'function')
      ? CCF.assets.getUnifiedItems(sc.id)
      : (() => {
          const out = [], seen = new Set();
          imgs.forEach(a => {
            if (!a) return;
            const c = normCat(a.category), fk = String(a.origName || a.name || '').normalize('NFKC').trim().toLowerCase();
            if (fk) seen.add(fk + '|' + c);
            out.push({ type: 'image', name: a.name || 'image', dataUrl: a.dataUrl || a.thumbRef || '', path: '', category: c, missing: false });
          });
          rawRefs.forEach(r => {
            const c = normCat(r.category), tp = r.type || 'image';
            if (tp === 'image') {
              const fk = String(r.origName || r.name || '').normalize('NFKC').trim().toLowerCase();
              if (fk && seen.has(fk + '|' + c)) return;
            }
            out.push({ type: tp, name: r.name || 'file', origName: r.origName || r.name || 'file', dataUrl: r.dataUrl || r.thumbRef || '', path: r.path || '', category: c, missing: false });
          });
          pdfDocs.forEach(d => out.push({ type: /\.pdf$/i.test(d.name || '') ? 'pdf' : 'doc', name: d.name, origName: d.origName || d.name, category: normCat(d.category), srcType: 'doc' }));
          (Array.isArray(sc.assetCatalog) ? sc.assetCatalog : []).forEach(catIt => {
            if (!catIt || !catIt.name) return;
            const c = normCat(catIt.category), tp = catIt.type || 'image';
            const fk = String(catIt.origName || catIt.name || '').normalize('NFKC').trim().toLowerCase();
            if (fk && seen.has(fk + '|' + c)) return;
            if (fk) seen.add(fk + '|' + c);
            out.push({ type: tp, name: catIt.name, origName: catIt.origName || catIt.name, dataUrl: catIt.thumbRef || '', path: catIt.cloudSha ? ('cloud-asset://' + catIt.cloudSha + '/' + encodeURIComponent(catIt.name)) : '', cloudSha: catIt.cloudSha || '', category: c, missing: false });
          });
          return out;
        })());
    const unifiedImgs = unified.filter(it => it.type === 'image');
    const imgGroups = new Map();
    unifiedImgs.forEach(it => {
      const c = normCat(it.category) || '（未分類）';
      if (!imgGroups.has(c)) imgGroups.set(c, []);
      imgGroups.get(c).push(it);
    });
    const pdfRefs = unified.filter(r => r && r.srcType !== 'doc' && (r.type === 'pdf' || r.type === 'doc' || r.type === 'text' || /\.(?:pdf|txt|html?|md|markdown|docx?)$/i.test(r.origName || r.name || r.path || '')));
    const zips = unified.filter(r => r.type === 'zip');
    const bgms = unified.filter(r => r.type === 'audio');
    const unifiedTotal = unified.length;
    const rooms = isCreate ? [] : roomsOf(sc);
    const roomListHtml = rooms.map(r => {
      const nStocks = (r.project && r.project.stocks) ? r.project.stocks.length : 0;
      const nNpcs = (r.project && r.project.npcs) ? r.project.npcs.length : 0;
      return `<div class="sd-row"><span>🏠</span><span class="sd-nm"><b>${E(r.name)}</b> <small style="color:var(--text-sub); margin-left:6px;">(${nStocks}テキスト / ${nNpcs}NPC)</small></span>
        <div style="display:flex; gap:4px;">
          <button type="button" class="btn-sort" data-sd="room-open" data-sid="${E(sc.id)}" data-rid="${E(r.id)}">♟️ 開く</button>
          <button type="button" class="btn-sort" data-sd="room-dup" data-sid="${E(sc.id)}" data-rid="${E(r.id)}">📋 複製</button>
          <button type="button" class="btn-sort" data-sd="room-rename" data-sid="${E(sc.id)}" data-rid="${E(r.id)}">✏️</button>
          <button type="button" class="btn-sort btn-danger" data-sd="room-del" data-sid="${E(sc.id)}" data-rid="${E(r.id)}"${rooms.length <= 1 ? ' disabled title="部屋は最低1つ必要です"' : ''}>🗑️</button>
        </div></div>`;
    }).join('');
    const psVal = normalizePlayStatus(sc.playStatus);
    const psOpts = PLAY_STATUS_LIST.map(p => `<option value="${E(p.value)}"${p.value === psVal ? ' selected' : ''}>${E(p.badge || p.label)}</option>`).join('');
    const specOrder = getResolvedSpecOrder(sc);
    const customMap = new Map(ensureCustomSpecs(sc).filter(c => c && c.id).map(c => [c.id, c]));
    const specItemsHtml = specOrder.map((key, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === specOrder.length - 1;
      const isCore = CORE_SPEC_KEYS.includes(key);
      const mvBtns = `<div class="sd-spec-item-acts">
        <span class="sd-spec-handle" title="ドラッグして並べ替え">⠿</span>
        <button type="button" class="sd-spec-mv" data-sd="spec-move-prev" data-spec-key="${E(key)}"${isFirst ? ' disabled' : ''} title="前へ">◀</button>
        <button type="button" class="sd-spec-mv" data-sd="spec-move-next" data-spec-key="${E(key)}"${isLast ? ' disabled' : ''} title="次へ">▶</button>
        ${!isCore ? `<button type="button" class="sd-spec-del" data-sd="spec-del" data-spec-key="${E(key)}" title="この項目を削除">✕</button>` : ''}
      </div>`;
      if (key.startsWith('custom:')) {
        const cid = key.slice(7);
        const cs = customMap.get(cid);
        if (!cs) return '';
        const val1 = specFirstLine(sc, '', cs);
        const fullVal = specFullVal(sc, '', cs);
        const hasMulti = /\r?\n/.test(fullVal);
        return `<div class="sd-spec-cell sd-spec-item is-custom" data-spec-key="${E(key)}"${sdSpecSortMode ? ' draggable="true"' : ''}>
          <div class="sd-spec-head"><dt><input type="text" class="sd-spec-label-input" data-sd-custom-label="${E(cid)}" data-orig-val="${E(cs.label || '')}" value="${E(cs.label || '')}" placeholder="項目名"></dt>${mvBtns}</div>
          <dd><input type="text" class="sd-inline-input" data-sd-custom-val="${E(cid)}" data-orig-val="${E(val1)}" value="${E(val1)}" placeholder="内容を入力..." title="${E(hasMulti ? fullVal : 'クリックして直接編集')}"></dd>
        </div>`;
      }
      const lbl = STD_SPEC_LABELS[key] || key;
      if (key === 'system') {
        return `<div class="sd-spec-cell sd-spec-item" data-spec-key="system"${sdSpecSortMode ? ' draggable="true"' : ''}>
          <div class="sd-spec-head"><dt>${E(lbl)}</dt>${mvBtns}</div>
          <dd>${buildSystemSelectHtml(specFirstLine(sc, 'system'))}</dd>
        </div>`;
      }
      const val1 = specFirstLine(sc, key);
      const fullVal = specFullVal(sc, key);
      const hasMulti = /\r?\n/.test(fullVal);
      const ph = SPEC_PLACEHOLDERS[key] || '未入力';
      return `<div class="sd-spec-cell sd-spec-item" data-spec-key="${E(key)}"${sdSpecSortMode ? ' draggable="true"' : ''}>
        <div class="sd-spec-head"><dt>${E(lbl)}</dt>${mvBtns}</div>
        <dd><input type="text" class="sd-inline-input" data-sd-inline="${E(key)}" data-orig-val="${E(val1)}" value="${E(val1)}" placeholder="${E(ph)}" title="${E(hasMulti ? fullVal : 'クリックして直接編集（Enterまたはフォーカスを外すと保存）')}"></dd>
      </div>`;
    }).join('');
    const specBarHtml = `<div class="sd-spec-bar">
      <span class="sd-spec-bar-title">📋 概要・スペック</span>
      <div class="sd-spec-bar-btns">
        <button type="button" class="btn-sort${sdSpecAddOpen ? ' on' : ''}" data-sd="spec-add-toggle">＋ 概要項目を追加</button>
        <button type="button" class="btn-sort${sdSpecSortMode ? ' on' : ''}" data-sd="spec-sort-toggle">↕ 並べ替え</button>
      </div>
    </div>`;
    const specAddPanelHtml = sdSpecAddOpen ? `<div class="sd-spec-add-panel">
      ${SPEC_PRESETS.map((p, pi) => {
        const added = p.kind === 'std' && specOrder.includes(p.key);
        return `<button type="button" class="sd-spec-preset-chip${added ? ' is-added' : ''}" data-sd="spec-add-preset" data-preset-idx="${pi}"${added ? ' disabled title="追加済み"' : ''}>＋ ${E(p.label)}${added ? ' ✓' : ''}</button>`;
      }).join('')}
    </div>` : '';
    const postDet = (typeof formatScenarioPostedDetail === 'function')
      ? formatScenarioPostedDetail(sc)
      : { text: (sc.postedChannels || []).length ? '✅ ' + sc.postedChannels.length + 'チャンネルに投稿済み' : '未投稿', title: '' };
    const spec = specItemsHtml
      + `<div class="sd-spec-cell sd-spec-item is-fixed"><dt>プレイ状況</dt><dd><select data-sd-field="playStatus" class="sd-inline-select">${psOpts}</select></dd></div>`
      + (isCreate
        ? `<div class="sd-spec-cell sd-spec-item is-fixed sd-spec-shopurl"><dt>ショップURL</dt><dd><input type="url" class="sd-inline-input" data-sd-inline="shopUrl" data-orig-val="${E(sc.shopUrl || '')}" value="${E(sc.shopUrl || '')}" placeholder="https://booth.pm/..."></dd></div>`
        : ((safeUrl(sc.shopUrl) ? `<div class="sd-spec-cell sd-spec-item is-fixed"><dt>ショップ</dt><dd><a href="${E(safeUrl(sc.shopUrl))}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-text);">🔗 ショップを開く</a></dd></div>` : '')
          + `<div class="sd-spec-cell sd-spec-item is-fixed"><dt>投稿状況</dt><dd${postDet.title ? ` title="${E(postDet.title)}"` : ''}>${E(postDet.text)}</dd></div>`));
    const sumFreeText = String((summaryBlock && summaryBlock.freeText) || '');
    const sumFreeTextHtml = (sumFreeText.trim() || sdEditFreeText)
      ? `<div class="sd-sum-freetext">
          <div class="sd-sec-head" style="margin-bottom:4px;">
            <span style="font-size:0.75rem; font-weight:700; color:var(--dc-text-muted);">📝 概要枠・自由記述</span>
            <button type="button" class="btn-sort" data-sd="freetext-edit-toggle">${sdEditFreeText ? '閉じる' : '✏️ 編集'}</button>
          </div>
          ${sdEditFreeText
            ? `<div class="sd-notes-edit">
                <textarea id="sdEditFreeTextArea" rows="3" placeholder="概要枠内の補足や自由記述を入力...">${E(sumFreeText)}</textarea>
                <div style="display:flex; gap:6px; justify-content:flex-end;">
                  <button type="button" class="btn-sort" data-sd="freetext-cancel">キャンセル</button>
                  <button type="button" class="btn-sort" style="background:var(--accent); color:#fff; border-color:var(--accent);" data-sd="freetext-save">💾 保存</button>
                </div>
              </div>`
            : `<div class="sd-story">${linkifyTextHtml(sumFreeText)}</div>`}
        </div>`
      : '';
    const links = collectScenarioLinks(sc);
    const linksHtml = links.length ? `<div class="sd-link-bar">${links.map(lk => `<a href="${E(lk.url)}" target="_blank" rel="noopener noreferrer" class="sc-link-btn">${E(lk.icon)} ${E(lk.label)}</a>`).join('')}</div>` : '';
    const imgTag = it => {
      const refSrc = it.dataUrl || it.thumbRef || '';
      if (refSrc) return `<img ${imgAttr(refSrc)} data-sd-zoom="${E(it.name)}" alt="${E(it.name)}" title="${E(it.name)}（クリックで拡大）" style="cursor:pointer;" loading="lazy">`;
      if (it.path && window.CloudSync && CloudSync.isCloudAssetRef && CloudSync.isCloudAssetRef(it.path)) {
        return `<img src="${typeof PLACEHOLDER !== 'undefined' ? PLACEHOLDER : ''}" data-cloud-asset="${E(it.path)}" data-sd-zoom="${E(it.name)}" alt="${E(it.name)}" title="${E(it.name)}（クリックで拡大）" style="cursor:pointer;" loading="lazy">`;
      }
      const u = !it.missing && it.path ? fileUrl(it.path) : '';
      return u ? `<img src="${E(u)}" data-sd-zoom="${E(it.name)}" alt="${E(it.name)}" title="${E(it.name)}（クリックで拡大）" style="cursor:pointer;" loading="lazy">` : `<div class="sd-more" title="${E(it.name)}">🖼️ ${E(it.name)}</div>`;
    };
    const folderHtml = [...imgGroups].map(([c, l]) => `<div class="sd-folder"><div class="sd-folder-name">📁 ${E(c)}<span>${l.length}枚</span></div><div class="sd-thumbs">${l.slice(0, 11).map(imgTag).join('')}${l.length > 11 ? `<div class="sd-more">ほか ${l.length - 11} 枚</div>` : ''}</div></div>`).join('');
    const zipHtml = zips.map(r => {
      if (r.path && !/^cloud-asset:/i.test(r.path) && (!IS_ELECTRON || !fs || fs.existsSync(r.path))) {
        return `<div class="sd-folder"><div class="sd-folder-name" title="${E(r.path)}">📦 ${E(r.name)}<span>ZIP（解凍せず閲覧）</span></div><div class="sd-thumbs" data-sd-zip="${E(r.path)}"><div class="sd-more">読み込み中…</div></div></div>`;
      }
      return `<div class="sd-folder"><div class="sd-folder-name">📦 ${E(r.name)}<span>ZIP（${r.cloudSha ? 'クラウド同期済み' : 'メタ情報のみ同期'}）</span></div></div>`;
    }).join('');
    const isMissingPath = p => !!(IS_ELECTRON && fs && p && !/^(?:cloud-asset:|idb-asset:|data:|blob:|https?:)/i.test(p) && !fs.existsSync(p));
    const row = (icon, r, extra) => {
      const catLbl = normCat(r.category);
      const dispName = r.origName || r.name || 'file';
      return `<div class="sd-row${isMissingPath(r.path) ? ' missing' : ''}" title="${E(r.path || dispName)}"><span>${icon}</span><span class="sd-nm">${E(dispName)}</span>${catLbl ? `<span class="sd-cat">${E(catLbl)}</span>` : ''}${extra || ''}</div>`;
    };
    const pdfPos = (() => { if (!hasCcf()) return {}; try { return CCF.readProject(String(sc.id)).pdfPos || {}; } catch (e) { logSoft('sdPdfPos', e); return {}; } })();   // 開いていた部屋のPDFごとの前回ページ
    const pdfBtn = p => { if (!p) return ''; const pg = pdfPos[p] && pdfPos[p].page > 1 ? ` <small style="color:var(--text-sub);">前回 p.${pdfPos[p].page}</small>` : ''; return `${pg}<button type="button" class="btn-sort" data-sd="pdf" data-path="${E(p)}">開く</button>`; };
    const docAbs = d => {
      if (!d) return '';
      const localP = (typeof path !== 'undefined' && path && typeof DATA_ROOT !== 'undefined' && DATA_ROOT && d.rel) ? path.resolve(DATA_ROOT, d.rel) : '';
      if (localP && typeof fs !== 'undefined' && fs && fs.existsSync && fs.existsSync(localP)) return localP;
      if (d.path) return d.path;
      if (d.ref) return d.ref;
      if (d.cloudSha) return `cloud-asset://${d.cloudSha}/${encodeURIComponent(d.origName || d.name || 'doc.pdf')}`;
      return localP || '';
    };
    const seenDocPaths = new Set();
    const seenDocNames = new Set();
    const normDocPath = p => String(p || '').replace(/\\/g, '/').toLowerCase();
    const normDocName = n => String(n || '').replace(/\.[^.]+$/, '').toLowerCase().trim() + '.' + (String(n || '').split('.').pop() || '').toLowerCase();
    const pdfDocsHtml = pdfDocs.map(d => {
      const dp = docAbs(d);
      const dispNm = (d && (d.origName || d.name)) || '';
      if (dp) seenDocPaths.add(normDocPath(dp));
      if (dispNm) seenDocNames.add(normDocName(dispNm));
      return row(/\.pdf$/i.test(dispNm) ? '📄' : '📃', { name: dispNm, origName: dispNm, category: (d && d.category) || '資料ファイル', path: dp }, hasCcf() && dp && /\.(?:pdf|txt|html?|md|markdown)$/i.test(dispNm || dp) ? pdfBtn(dp) : '');
    }).join('');
    const extraPdfRefs = pdfRefs.filter(r => {
      if (!r) return false;
      const dispNm = r.origName || r.name || '';
      const np = normDocPath(r.path);
      const nn = normDocName(dispNm);
      if ((np && seenDocPaths.has(np)) || (nn && seenDocNames.has(nn))) return false;
      if (np) seenDocPaths.add(np);
      if (nn) seenDocNames.add(nn);
      return true;
    });
    const pdfHtml = pdfDocsHtml + extraPdfRefs.map(r => {
      const dispNm = r.origName || r.name || '';
      const isPdf = r.type === 'pdf' || /\.pdf$/i.test(dispNm || r.path || '');
      return row(isPdf ? '📄' : '📃', r, hasCcf() && r.path && /\.(?:pdf|txt|html?|md|markdown)$/i.test(dispNm || r.path || '') ? pdfBtn(r.path) : '');
    }).join('');
    const totalPdfCount = pdfDocs.length + extraPdfRefs.length;
    const bgmHtml = bgms.map(r => row('🎵', r)).join('');
    const none = '<div class="sd-empty">まだありません</div>';

    const ts = sc.thumbSettings || {};
    const posX = clampThumbNum(sc.thumbPosX !== undefined ? sc.thumbPosX : ts.posX, 0, 100, 50);
    const posY = clampThumbNum(sc.thumbPosY !== undefined ? sc.thumbPosY : ts.posY, 0, 100, 50);
    const zoom = clampThumbNum(sc.thumbZoom !== undefined ? sc.thumbZoom : ts.zoom, 25, 250, 100);
    const thumbFit = (sc.thumbFit === 'contain' || ts.fit === 'contain') ? 'contain' : 'cover';
    const useBlurBg = (thumbFit === 'contain' || zoom < 100);
    const slots = getThumbSlots(sc);
    if (!sc.imageUrl && slots.length) applyThumbSlots(sc, slots);
    if (sdSelSlot >= slots.length) sdSelSlot = Math.max(0, slots.length - 1);
    const selIdx = slots.length ? Math.max(0, Math.min(sdSelSlot, slots.length - 1)) : 0;
    const mainThumb = slots[selIdx] || slots[0] || '';
    const subThumbs = slots.slice(1);
    const slotHtml = Array.from({ length: 4 }, (_, i) => {
      if (!slots[i]) {
        return `<button type="button" class="sd-hover-slot empty add-tile" data-sd="hover-pick-gal" title="クリックして画像を追加">＋<span>画像を追加</span><small>${i === 0 ? '表紙' : `${i + 1}枚目`}</small></button>`;
      }
      return `<div class="sd-hover-slot${i === 0 ? ' is-main' : ''}${i === selIdx ? ' is-selected' : ''}" draggable="true" data-sd-slot="${i}" title="クリックで選択・プレビュー / ドラッグで順番入替">
        <span class="sd-slot-badge${i === 0 ? ' main' : ''}">${i === 0 ? '★1 表紙' : `${i + 1}`}</span>
        <img ${imgAttr(slots[i])} alt="サムネイル${i + 1}">
      </div>`;
    }).join('');
    const toolbarHtml = `<div class="sd-slot-toolbar">
      <span class="sd-slot-status">${slots.length ? `選択中: ${selIdx + 1}枚目${selIdx === 0 ? ' (表紙)' : ''}` : '画像未設定'}</span>
      <div class="sd-slot-toolbar-btns">
        <button type="button" class="btn-sort sd-tool-btn primary" data-sd="slot-main" data-idx="${selIdx}"${!slots.length || selIdx === 0 ? ' disabled' : ''}>★ 表紙(1枚目)にする</button>
        <button type="button" class="btn-sort sd-tool-btn" data-sd="slot-left" data-idx="${selIdx}"${!slots.length || selIdx <= 0 ? ' disabled' : ''}>◀ 前へ</button>
        <button type="button" class="btn-sort sd-tool-btn" data-sd="slot-right" data-idx="${selIdx}"${!slots.length || selIdx >= slots.length - 1 ? ' disabled' : ''}>▶ 次へ</button>
        <button type="button" class="btn-sort sd-tool-btn danger" data-sd="hover-del" data-idx="${selIdx}"${!slots.length ? ' disabled' : ''}>🗑️ 削除</button>
      </div>
    </div>`;
    const thumbCfgHtml = `<details class="sd-thumb-cfg"${sdThumbOpen ? ' open' : ''}>
      <summary>🖼️ サムネイル・表示設定 (${slots.length}/4)</summary>
      <div class="sd-thumb-cfg-body">
        <div class="sd-fit-row">
          <button type="button" class="btn-sort sd-fit-btn${thumbFit !== 'contain' ? ' on' : ''}" data-sd="thumb-fit" data-fit="cover">🖼️ 枠を埋める</button>
          <button type="button" class="btn-sort sd-fit-btn${thumbFit === 'contain' ? ' on' : ''}" data-sd="thumb-fit" data-fit="contain">📐 全体を表示（見切れなし）</button>
        </div>
        <div class="sd-slider-row"><span>表示位置 X</span><input type="range" min="0" max="100" value="${posX}" data-sd-range="thumbPosX"><span data-sd-val="thumbPosX">${posX}%</span></div>
        <div class="sd-slider-row"><span>表示位置 Y</span><input type="range" min="0" max="100" value="${posY}" data-sd-range="thumbPosY"><span data-sd-val="thumbPosY">${posY}%</span></div>
        <div class="sd-slider-row"><span>ズーム倍率</span><input type="range" min="25" max="250" step="5" value="${zoom}" data-sd-range="thumbZoom"><span data-sd-val="thumbZoom">${zoom}%</span></div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap;">
          <label style="font-size:0.76rem; color:var(--text);"><input type="checkbox" data-sd-chk="spoilerBlur"${sc.spoilerBlur ? ' checked' : ''}> 🙈 ネタバレ防止ぼかし</label>
          <button type="button" class="btn-sort" data-sd="thumb-reset">位置リセット</button>
        </div>
        <div style="border-top:1px dashed var(--border); padding-top:8px;">
          <div style="font-size:0.75rem; font-weight:700; color:var(--text-sub); margin-bottom:6px;">サムネイル／ホバー画像（1枚目＝表紙・2〜4枚目＝ホバー切替：${slots.length}/4）</div>
          <div class="sd-hover-grid">${slotHtml}</div>
          ${toolbarHtml}
          ${slots.length < 4 ? `<div class="sd-add-actions">
            <button type="button" class="sd-add-btn primary" data-sd="hover-pick-gal">🖼️ 登録素材・ギャラリーから選ぶ</button>
            <button type="button" class="sd-add-btn" data-sd="hover-pick-file">📁 PCのファイルから追加</button>
            <input type="file" id="sdHoverFileInput" accept="image/*" multiple style="display:none;">
            <details class="sd-url-toggle">
              <summary>🔗 画像URLから追加</summary>
              <div class="sd-url-row">
                <input type="url" id="sdHoverUrlInput" placeholder="https://... 画像URLを入力">
                <button type="button" class="btn-sort" data-sd="hover-add-url">追加</button>
              </div>
            </details>
          </div>` : '<div class="sd-empty" style="font-size:0.74rem; margin-top:6px;">最大4枚まで登録済みです（上のツールバーまたはドラッグで順番入替・削除可能）</div>'}
        </div>
      </div>
    </details>`;

    // 基本折りたたみアコーディオン（初期は閉。ヘッダー右にボタン、横に1行抜粋＋文字数バッジ。編集中は自動展開）
    const accExcerpt = (t) => {
      const s = String(t || '').replace(/\s+/g, ' ').trim();
      if (!s) return '<span class="sd-acc-prev sd-acc-prev-empty">（未設定）</span>';
      return `<span class="sd-acc-prev">${E(s.length > 44 ? s.slice(0, 44) + '…' : s)}</span><span class="sd-acc-badge">${s.length}字</span>`;
    };
    const accWrap = (key, extraCls, titleHtml, prevHtml, actsHtml, bodyHtml, forceOpen) => `<details class="sd-sec sd-acc ${extraCls}" data-acc="${key}"${(forceOpen || sdOpenSecs.has(key)) ? ' open' : ''}>
      <summary class="sd-acc-sum"><span class="sd-acc-caret">▶</span><h3 class="sd-acc-title">${titleHtml}</h3>${prevHtml}<span class="sd-acc-acts">${actsHtml}</span></summary>
      <div class="sd-acc-body">${bodyHtml}</div>
    </details>`;

    const trailerText = String(sc.trailer || '');
    const trailerSectionHtml = isCreate
      ? accWrap('trailer', 'sd-trailer-sec', '💬 トレーラー・キャッチコピー', accExcerpt(trailerText), '',
          `<textarea class="sd-draft-textarea" data-sd-draft="trailer" rows="4" placeholder="例：その扉を開けた時、日常は静かに幕を閉じた。">${E(trailerText)}</textarea>`, false)
      : accWrap('trailer', 'sd-trailer-sec', '💬 トレーラー・キャッチコピー', accExcerpt(trailerText),
          `<button type="button" class="btn-sort" data-sd="trailer-edit-toggle">${sdEditTrailer ? '閉じる' : '✏️ 編集'}</button>
              <button type="button" class="btn-sort btn-danger" data-sd="trailer-clear"${!trailerText.trim() ? ' disabled' : ''}>🧹 クリア</button>`,
          `${sdEditTrailer
            ? `<div class="sd-notes-edit">
                <textarea id="sdEditTrailerArea" rows="4" placeholder="例：その扉を開けた時、日常は静かに幕を閉じた。">${E(trailerText)}</textarea>
                <div style="display:flex; gap:6px; justify-content:flex-end;">
                  <button type="button" class="btn-sort" data-sd="trailer-cancel">キャンセル</button>
                  <button type="button" class="btn-sort" style="background:var(--accent); color:#fff; border-color:var(--accent);" data-sd="trailer-save">💾 保存</button>
                </div>
              </div>`
            : (trailerText.trim() ? `<div class="sd-story sd-catchcopy">${linkifyTextHtml(trailerText)}</div>` : '<div class="sd-empty">まだ設定されていません（「✏️ 編集」から入力できます）</div>')}`, sdEditTrailer);

    const synText = synopsisBlock ? String(synopsisBlock.val || '') : String(sc.synopsis || '');
    const synHeading = (synopsisBlock && blockHeadingOf(synopsisBlock)) || 'あらすじ';
    const hasSynContent = !!(synText.trim() || (synopsisBlock && blockHasContent(synopsisBlock)));
    const synopsisSectionHtml = isCreate
      ? accWrap('synopsis', '', `📖 あらすじ${synHeading && synHeading !== 'あらすじ' ? ` <small>（${E(synHeading)}）</small>` : ''}`, accExcerpt(synText), '',
          `<div class="sd-notes-edit">
            <label style="font-size:0.74rem;">見出し名（例：あらすじ / ストーリー / 導入）</label>
            <input type="text" data-sd-draft="synopsisHeading" value="${E(synHeading)}" placeholder="あらすじ">
            <label style="font-size:0.74rem;">本文</label>
            <textarea class="sd-draft-textarea" data-sd-draft="synopsis" rows="5" placeholder="シナリオのあらすじ・導入ストーリーを入力...">${E(synText)}</textarea>
          </div>`, false)
      : accWrap('synopsis', '', `📖 あらすじ${synHeading && synHeading !== 'あらすじ' ? ` <small>（${E(synHeading)}）</small>` : ''}`, accExcerpt(synText),
          `<button type="button" class="btn-sort" data-sd="synopsis-edit-toggle">${sdEditSynopsis ? '閉じる' : '✏️ 編集'}</button>
              <button type="button" class="btn-sort btn-danger" data-sd="synopsis-clear"${!hasSynContent ? ' disabled' : ''}>🧹 クリア</button>`,
          `${sdEditSynopsis
            ? `<div class="sd-notes-edit">
                <label style="font-size:0.74rem;">見出し名（例：あらすじ / ストーリー / 導入）</label>
                <input type="text" id="sdEditSynopsisHeading" value="${E(synHeading)}" placeholder="あらすじ">
                <label style="font-size:0.74rem;">本文</label>
                <textarea id="sdEditSynopsisArea" rows="6" placeholder="シナリオのあらすじ・導入ストーリーを入力...">${E(synText)}</textarea>
                <div style="display:flex; gap:6px; justify-content:flex-end;">
                  <button type="button" class="btn-sort" data-sd="synopsis-cancel">キャンセル</button>
                  <button type="button" class="btn-sort" style="background:var(--accent); color:#fff; border-color:var(--accent);" data-sd="synopsis-save">💾 保存</button>
                </div>
              </div>`
            : (hasSynContent ? renderBlockBodyHtml(synopsisBlock, synText) : '<div class="sd-empty">まだ設定されていません（「✏️ 編集」から入力できます）</div>')}`, sdEditSynopsis);

    const notesText = String(sc.notes || (notesBlock && notesBlock.val) || '');
    const notesSubExcerpt = (notesBlock && Array.isArray(notesBlock.subItems))
      ? notesBlock.subItems.filter(s => s && (String(s.title || '').trim() || String(s.val || '').trim())).map(s => (s.title ? '【' + s.title + '】' : '') + (s.val || '')).join(' ')
      : '';
    const notesExcerptSrc = notesText.trim() ? notesText : notesSubExcerpt;
    const hasNotesContent = !!(notesText.trim() || (notesBlock && blockHasContent(notesBlock)));
    const notesSectionHtml = isCreate
      ? accWrap('notes', '', '⚠️ 注意事項・備考', accExcerpt(notesExcerptSrc), '',
          `<textarea class="sd-draft-textarea" data-sd-draft="notes" rows="4" placeholder="注意事項・備考・参考URL（BOOTH / TALTO等）">${E(notesText)}</textarea>`, false)
      : (sdEditNotes
        ? accWrap('notes', '', '⚠️ 注意事項・備考／リンク編集', accExcerpt(notesExcerptSrc), '', `
            <div class="sd-notes-edit">
              <label style="font-size:0.74rem;">ショップURL</label>
              <input type="url" id="sdEditShopUrl" value="${E(sc.shopUrl || '')}" placeholder="https://booth.pm/...">
              <label style="font-size:0.74rem;">注意事項・備考（URLを書くと自動でリンクボタン化されます）</label>
              <textarea id="sdEditNotesArea" rows="5" placeholder="メモ・参考URL（BOOTH / TALTO / Pixiv等）">${E(notesText)}</textarea>
              <div style="display:flex; gap:6px; justify-content:flex-end;">
                <button type="button" class="btn-sort" data-sd="notes-cancel">キャンセル</button>
                <button type="button" class="btn-sort" style="background:var(--accent); color:#fff; border-color:var(--accent);" data-sd="notes-save">💾 保存</button>
              </div>
            </div>`, true)
        : accWrap('notes', '', '⚠️ 注意事項・備考', accExcerpt(notesExcerptSrc),
            '<button type="button" class="btn-sort" data-sd="notes-edit-toggle">✏️ 編集</button>',
            hasNotesContent ? renderBlockBodyHtml(notesBlock, notesText) : none));

    const otherBlocksListHtml = otherBlocks.map(b => {
      const bid = String(b.id || '');
      const hTitle = blockHeadingOf(b) || '自由項目';
      if (isCreate) {
        return `<div class="sd-pubblock-card" data-pubblock-id="${E(bid)}">
          <div class="sd-pubblock-head">
            <div class="sd-pubblock-title">📑 ${E(hTitle)}</div>
            <button type="button" class="btn-sort btn-danger" data-sd="pubblock-del" data-bid="${E(bid)}" title="この項目ブロックを削除">🗑️</button>
          </div>
          <div class="sd-notes-edit" style="margin-top:6px;">
            <label style="font-size:0.74rem;">見出し名</label>
            <input type="text" data-sd-draft-block-key="${E(bid)}" value="${E(hTitle)}" placeholder="項目名を入力...">
            <label style="font-size:0.74rem;">内容</label>
            <textarea class="sd-draft-textarea" data-sd-draft-block-val="${E(bid)}" rows="4" placeholder="内容を入力...">${E(b.val || '')}</textarea>
          </div>
        </div>`;
      }
      const isEditing = sdEditBlockId === bid;
      const hasBody = blockHasContent(b);
      return `<div class="sd-pubblock-card" data-pubblock-id="${E(bid)}">
        <div class="sd-pubblock-head">
          <div class="sd-pubblock-title">📑 ${E(hTitle)}</div>
          <div style="display:flex; gap:4px;">
            <button type="button" class="btn-sort" data-sd="pubblock-edit" data-bid="${E(bid)}">${isEditing ? '閉じる' : '✏️ 編集'}</button>
            <button type="button" class="btn-sort btn-danger" data-sd="pubblock-del" data-bid="${E(bid)}" title="この項目ブロックを削除">🗑️</button>
          </div>
        </div>
        ${isEditing
          ? `<div class="sd-notes-edit" style="margin-top:8px;">
              <label style="font-size:0.74rem;">見出し名</label>
              <input type="text" id="sdEditPubBlockKey" value="${E(hTitle)}" placeholder="項目名を入力...">
              <label style="font-size:0.74rem;">内容</label>
              <textarea id="sdEditPubBlockVal" rows="5" placeholder="内容を入力...">${E(b.val || '')}</textarea>
              <div style="display:flex; gap:6px; justify-content:flex-end;">
                <button type="button" class="btn-sort" data-sd="pubblock-cancel">キャンセル</button>
                <button type="button" class="btn-sort" style="background:var(--accent); color:#fff; border-color:var(--accent);" data-sd="pubblock-save" data-bid="${E(bid)}">💾 保存</button>
              </div>
            </div>`
          : (hasBody ? renderBlockBodyHtml(b, b.val) : '<div class="sd-empty">（未入力）</div>')}
      </div>`;
    }).join('');
    const otherBlocksSectionHtml = accWrap('other', '', `📑 その他の公開ブロック <small>${otherBlocks.length}件</small>`,
      otherBlocks.length ? `<span class="sd-acc-prev">${E(otherBlocks.map(b => blockHeadingOf(b) || '自由項目').join(' / ').slice(0, 44))}</span>` : '<span class="sd-acc-prev sd-acc-prev-empty">（なし）</span>',
      '<button type="button" class="btn-sort" data-sd="pubblock-add">＋ 自由項目を追加</button>',
      otherBlocksListHtml ? `<div class="sd-pubblock-list">${otherBlocksListHtml}</div>` : '<div class="sd-empty">追加の公開ブロックはありません（「＋ 自由項目を追加」から追加できます）</div>',
      !!sdEditBlockId);

    const hoList = Array.isArray(sc.secretHOs) ? sc.secretHOs.filter(Boolean) : [];
    const hoItemsHtml = hoList.map((h, i) => {
      const hoName = String((h && h.name) || `HO${i + 1}`);
      const isOpen = sdOpenHOs.has(i) || sdEditHoIdx === i;
      const isEditingHo = sdEditHoIdx === i;
      const blocksArr = Array.isArray(h.blocks) ? h.blocks.filter(b => b && b.type !== 'split') : [];
      const renderHoReadBody = () => {
        if (blocksArr.length) {
          const bHtml = blocksArr.map(hb => {
            if (hb.type === 'image') {
              const u = hb.previewUrl || hb.dataUrl || hb.url || '';
              return u ? `<div class="sd-thumbs" style="margin-top:6px;"><img ${imgAttr(u)} data-sd-zoom="${E(hoName)}" alt="${E(hoName)}" style="cursor:pointer;" loading="lazy"></div>` : '';
            }
            const bt = blockHeadingOf(hb);
            const bv = String(hb.val != null ? hb.val : (hb.text != null ? hb.text : (hb.body || '')));
            const body = renderBlockBodyHtml({ val: bv, subItems: hb.subItems }, bv);
            if (!bt && !body) return '';
            return `<div class="sd-ho-blk">${bt ? `<div class="sd-ho-blk-title">${E(bt)}</div>` : ''}${body || '<div class="sd-empty">（本文なし）</div>'}</div>`;
          }).filter(Boolean).join('');
          return bHtml || '<div class="sd-empty">（本文なし）</div>';
        }
        const rawTxt = String(h.text != null ? h.text : (h.body != null ? h.body : (h.val || '')));
        return rawTxt.trim() ? `<div class="sd-story">${linkifyTextHtml(rawTxt)}</div>` : '<div class="sd-empty">（本文なし）</div>';
      };
      const editTextVal = (() => {
        if (blocksArr.length) {
          const firstTxtBlk = blocksArr.find(hb => hb.type !== 'image');
          if (firstTxtBlk) return String(firstTxtBlk.val != null ? firstTxtBlk.val : (firstTxtBlk.text != null ? firstTxtBlk.text : (firstTxtBlk.body || '')));
        }
        return String(h.text != null ? h.text : (h.body != null ? h.body : (h.val || '')));
      })();
      return `<details class="sd-ho-details" data-ho-idx="${i}"${isOpen ? ' open' : ''}>
        <summary class="sd-ho-summary">
          <span class="sd-ho-name">🔒 ${E(hoName)}</span>
          <span class="sd-ho-sum-acts">
            <button type="button" class="btn-sort" data-sd="ho-edit" data-ho-idx="${i}">${isEditingHo ? '閉じる' : '✏️ 編集'}</button>
          </span>
        </summary>
        <div class="sd-ho-body">
          ${isEditingHo
            ? `<div class="sd-notes-edit">
                <label style="font-size:0.74rem;">HO名称</label>
                <input type="text" id="sdEditHoName_${i}" value="${E(hoName)}" placeholder="HO1">
                <label style="font-size:0.74rem;">秘匿内容</label>
                <textarea id="sdEditHoBody_${i}" rows="6" placeholder="秘匿HOの内容を入力...">${E(editTextVal)}</textarea>
                <div style="display:flex; gap:6px; justify-content:flex-end;">
                  <button type="button" class="btn-sort" data-sd="ho-cancel" data-ho-idx="${i}">キャンセル</button>
                  <button type="button" class="btn-sort" style="background:var(--accent); color:#fff; border-color:var(--accent);" data-sd="ho-save" data-ho-idx="${i}">💾 保存</button>
                </div>
              </div>`
            : renderHoReadBody()}
        </div>
      </details>`;
    }).join('');
    const hoSectionHtml = `<div class="sd-sec">
      <div class="sd-sec-head">
        <h3 style="margin:0;">🔒 秘匿HO <small>${hoList.length}件</small></h3>
        ${hoList.length ? `<div style="display:flex; gap:6px;">
          <button type="button" class="btn-sort" data-sd="ho-open-all">📂 すべて開く</button>
          <button type="button" class="btn-sort" data-sd="ho-close-all">📁 すべて閉じる</button>
        </div>` : ''}
      </div>
      ${hoItemsHtml ? `<div class="sd-ho-list">${hoItemsHtml}</div>` : none}
    </div>`;

    const sdPreloadHtml = subThumbs.length ? `<div class="thumb-preload">${subThumbs.map((u, i) => `<img ${imgAttr(u)} data-hframe="${i + 1}" decoding="async" alt="">`).join('')}</div>` : '';
    const sdHoverIndHtml = slots.length > 1 ? `<span class="thumb-hover-ind sd-hover-ind" data-total="${slots.length}">🖼️ 1/${slots.length}</span>` : '';
    const csInfo = (window.CloudSync && CloudSync.getScenarioCacheStatus)
      ? CloudSync.getScenarioCacheStatus(sc, { detailed: true })
      : { status: 'cached', label: '💻 この端末に保持済み', total: 0, cached: 0, missing: 0, releasable: 0, isMethodBDirectOnly: false };
    const isPinned = csInfo.status === 'pinned';
    const releaseDisabled = csInfo.isMethodBDirectOnly || isPinned || csInfo.releasable === 0;
    const releaseTitle = csInfo.isMethodBDirectOnly
      ? 'PC内の同期フォルダから直接読み込んでいるため、安全のため削除は無効になっています'
      : (isPinned ? '「常時保持」に設定されているため削除できません（先に「常時保持」を解除してください）'
        : (csInfo.releasable === 0 ? 'この端末に削除できる一時データはありません'
          : 'クラウド上の元データは残したまま、この端末に一時保存されているPDF・画像・音声のみを削除します'));
    const cloudBarHtml = `<div class="sd-cloud-bar">
      <span class="cloud-cache-pill status-${E(csInfo.status)}">${E(csInfo.label)}</span>
      <span class="sd-cloud-meta">${csInfo.total ? `端末内に保存 ${csInfo.cached}/${csInfo.total}件` : 'この端末で管理'}${csInfo.missing ? `（未取得 ${csInfo.missing}件）` : ''}</span>
      <div class="sd-cloud-btns">
        <button type="button" class="btn-sort sd-pin-btn${isPinned ? ' on' : ''}" data-sd="toggle-pin" title="ONにすると関連PDF・立ち絵・BGMを優先的にダウンロードしてこの端末に常に保存し、一括整理の対象から保護します">${isPinned ? '📌 常時保持ON（解除）' : '📌 この端末に常にダウンロードしておく（オフライン対応）'}</button>
        <button type="button" class="btn-sort" data-sd="fetch-assets" title="まだ端末にないPDF・立ち絵・背景・使用BGMをクラウドからまとめてダウンロードします">☁️ このシナリオの素材を一括取得</button>
        <button type="button" class="btn-sort" data-sd="release-cache"${releaseDisabled ? ' disabled' : ''} title="${E(releaseTitle)}">💨 この端末の一時データを削除（クラウドには残ります）</button>
      </div>
    </div>`;
    const tagsSectionHtml = isCreate
      ? `<div class="sd-create-tag-area">
          <div class="sd-tags sd-tags-clickable" data-sd="draft-tag-toggle" title="クリックしてタグを選択・編集">
            ${(sc.tags || []).map(t => `<span class="sd-tag">#${E(t)}</span>`).join('') || '<span class="sd-empty">タグなし</span>'}
            <button type="button" class="btn-sort sd-tag-edit-btn" data-sd="draft-tag-toggle">${sdTagPickerOpen ? '▲ タグ選択を閉じる' : '🏷️ タグを選択'}</button>
          </div>
          ${sdTagPickerOpen ? `<div class="sd-create-tag-picker">
            <div id="sdDraftTagPickerHost" class="tag-picker-wrap"></div>
            <div class="sd-ht-addtag">
              <input type="text" id="sdDraftNewTagInput" placeholder="新しいタグ名を追加...">
              <button type="button" class="btn-sort" data-sd="draft-tag-add">＋ 追加</button>
            </div>
          </div>` : ''}
        </div>`
      : `<div class="sd-tags">${(sc.tags || []).map(t => `<span class="sd-tag">#${E(t)}</span>`).join('') || '<span class="sd-empty">タグなし</span>'}</div>`;
    const topSectionHtml = `<div class="sd-top"><div>
        <div class="sd-trailer-wrap">${mainThumb ? `<img class="thumb-blur-bg" ${imgAttr(mainThumb)} alt="" aria-hidden="true" style="display:${selIdx === 0 && useBlurBg ? 'block' : 'none'};"><img class="sd-trailer${sc.spoilerBlur && !sdPeek ? ' is-spoiler-blurred' : ''}" ${imgAttr(mainThumb)} alt="トレーラー画像" style="${selIdx === 0 ? thumbStyleStr(sc) : ''}">` : '<div class="sd-trailer">🖼️</div>'}${sdHoverIndHtml}${sdPreloadHtml}${sc.spoilerBlur && mainThumb ? `<button type="button" class="sd-spoiler-peek" data-sd="toggle-peek">${sdPeek ? '🙈 隠す' : '👁️ 一時表示'}</button>` : ''}</div>
        ${thumbCfgHtml}
      </div>
      <div class="sd-main">
        <div class="sd-title-row">
          <button type="button" class="sd-fav-btn${sc.favorite ? ' on' : ''}" data-sd="toggle-fav" title="${sc.favorite ? 'お気に入りを解除' : 'お気に入りに追加'}">${sc.favorite ? '★' : '☆'}</button>
          <input type="text" class="sd-title-input" data-sd-inline="title" data-orig-val="${E(sc.title || '')}" value="${E(sc.title || '')}" placeholder="${isCreate ? 'シナリオタイトルを入力（必須）...' : 'シナリオタイトルを入力...'}" title="${isCreate ? 'シナリオタイトル（必須）' : 'クリックしてタイトルを直接編集（Enterまたはフォーカスを外すと保存）'}">
        </div>
        ${(() => {
          const authorList = [...new Set((typeof appState !== 'undefined' && Array.isArray(appState.scenarios) ? appState.scenarios : []).map(s => String((s && s.author) || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
          return `<div class="sd-author-row"><span class="sd-author-lbl">✍️ 作者</span><input type="text" class="sd-author-input" data-sd-inline="author" list="sdAuthorSuggestList" data-orig-val="${E(sc.author || '')}" value="${E(sc.author || '')}" placeholder="作者名を入力（DB管理用・Discord投稿には反映されません）"><datalist id="sdAuthorSuggestList">${authorList.map(a => `<option value="${E(a)}">`).join('')}</datalist></div>`;
        })()}
        ${tagsSectionHtml}${isCreate ? '' : linksHtml + cloudBarHtml}${trailerSectionHtml}${specBarHtml}${specAddPanelHtml}<dl class="sd-spec sd-spec-grid${sdSpecSortMode ? ' is-sort-mode' : ''}">${spec}</dl>${isCreate ? '' : sumFreeTextHtml}</div></div>
      ${synopsisSectionHtml}
      ${notesSectionHtml}
      ${otherBlocksSectionHtml}`;
    if (isCreate) return topSectionHtml;
    return `${topSectionHtml}
      ${hoSectionHtml}
      <div class="sd-sec"><h3>📄 登録資料ファイル（PDF・TXT等） <small>${totalPdfCount}件</small></h3><div class="sd-list">${pdfHtml || none}</div></div>
      <div class="sd-sec">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 style="margin:0;">🎲 ココフォリア部屋データ <small>${rooms.length}件</small></h3>
          <button type="button" class="btn-sort" data-sd="room-add" data-sid="${E(sc.id)}">＋ 新規部屋</button>
        </div>
        <div class="sd-list">${roomListHtml || none}</div>
      </div>
      <div class="sd-sec">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
          <h3 style="margin:0;">🖼️ 登録素材（全 ${unifiedTotal}件 / 画像 ${unifiedImgs.length}枚${zips.length ? `・ZIP ${zips.length}` : ''}）</h3>
          <button type="button" class="btn-sort" data-sd="web-sync-assets" title="このシナリオの登録素材画像とPDF本文テキストを軽量化してFirebaseへ同期（別PC・file://閲覧用）">☁️ このシナリオの画像・本文テキストをWeb同期</button>
        </div>
        ${folderHtml + zipHtml || none}
      </div>
      <div class="sd-sec"><h3>🎵 音声・BGM <small>${bgms.length}件</small></h3><div class="sd-list">${bgmHtml || none}</div></div>
      ${(() => {
        const commonUsed = (window.CCF && CCF.assets && typeof CCF.assets.commonAssetsUsedByScenario === 'function')
          ? CCF.assets.commonAssetsUsedByScenario(sc.id)
          : [];
        const commonCardsHtml = commonUsed.map(rec => {
          const it = rec.item || {};
          const usages = Array.isArray(rec.usages) ? rec.usages : [];
          const uniqDetails = [...new Set(usages.map(u => u.detail || u.room || u.place || '使用中').filter(Boolean))];
          const refSrc = it.dataUrl || it.thumbRef || '';
          let thumbHtml = '';
          if (it.type === 'image') {
            if (refSrc) thumbHtml = `<img class="sd-common-thumb" ${imgAttr(refSrc)} alt="${E(it.name || '')}" loading="lazy">`;
            else if (it.path && window.CloudSync && CloudSync.isCloudAssetRef && CloudSync.isCloudAssetRef(it.path)) {
              thumbHtml = `<img class="sd-common-thumb" src="${typeof PLACEHOLDER !== 'undefined' ? PLACEHOLDER : ''}" data-cloud-asset="${E(it.path)}" alt="${E(it.name || '')}" loading="lazy">`;
            } else if (!it.missing && it.path) {
              const u = fileUrl(it.path);
              thumbHtml = u ? `<img class="sd-common-thumb" src="${E(u)}" alt="${E(it.name || '')}" loading="lazy">` : '<div class="sd-common-ico">🖼️</div>';
            } else {
              thumbHtml = '<div class="sd-common-ico">🖼️</div>';
            }
          } else {
            const ico = it.type === 'audio' ? '🎵' : it.type === 'video' ? '🎬' : '📄';
            thumbHtml = `<div class="sd-common-ico">${ico}</div>`;
          }
          const catLbl = normCat(it.category);
          const badgesHtml = uniqDetails.slice(0, 6).map(d => `<span class="sd-common-badge">${E(d)}</span>`).join('')
            + (uniqDetails.length > 6 ? `<span class="sd-common-badge more">+${uniqDetails.length - 6}</span>` : '');
          return `<div class="sd-common-card" data-sd="open-common-asset" data-uid="${E(it.uid || '')}" title="${E((it.name || '') + (uniqDetails.length ? '\n' + uniqDetails.join('\n') : ''))}">
            ${thumbHtml}
            <div class="sd-common-meta">
              <div class="sd-common-name">${E(it.name || '共通素材')}${catLbl ? ` <span class="sd-cat">${E(catLbl)}</span>` : ''}</div>
              <div class="sd-common-badges">${badgesHtml}</div>
            </div>
          </div>`;
        }).join('');
        return `<div class="sd-sec">
          <h3>🌐 使用中の共通素材（マイライブラリ連携） <small>${commonUsed.length}件</small></h3>
          ${commonUsed.length ? `<div class="sd-common-grid">${commonCardsHtml}</div>` : '<div class="sd-empty">このシナリオで使用・参照されている共通素材（マイライブラリ）はまだありません</div>'}
        </div>`;
      })()}
      <div class="sd-empty" style="text-align:center;">📥 フォルダ・ZIP・PDF・BGM・画像を、このウィンドウへドラッグ＆ドロップすると素材を追加できます</div>`;
  }
  async function fillZipThumbs() {
    if (!sdEl) return;
    for (const box of sdEl.querySelectorAll('[data-sd-zip]')) {
      const p = box.dataset.sdZip;
      try {
        const z = await CCF.zip.open(p), im = z.entries.filter(e => !e.dir && CCF.zip.isImageName(e.name));
        box.innerHTML = im.length ? im.slice(0, 11).map(e => `<img src="${E(CCF.zip.url(z.id, e.name))}" alt="" title="${E(e.name)}" loading="lazy">`).join('') + (im.length > 11 ? `<div class="sd-more">ほか ${im.length - 11} 枚</div>` : '') : '<div class="sd-more">画像なし</div>';
      } catch (e) { logSoft('sdZipThumbs', e); box.innerHTML = '<div class="sd-more">開けませんでした</div>'; }
    }
  }
  async function fillCloudAssets() {
    if (!sdEl || !window.CloudSync || !CloudSync.readCloudAssetBytes) return;
    for (const img of sdEl.querySelectorAll('img[data-cloud-asset]')) {
      const ref = img.dataset.cloudAsset;
      if (!ref) continue;
      try {
        const u8 = await CloudSync.readCloudAssetBytes(ref, { download: true });
        if (u8 && sdEl && document.body.contains(img)) {
          const parsed = CloudSync.parseCloudAssetRef(ref);
          const mime = (window.WebBridge && parsed && WebBridge.mimeFromName(parsed.name)) || 'image/webp';
          img.src = URL.createObjectURL(new Blob([u8], { type: mime }));
          img.removeAttribute('data-cloud-asset');
        }
      } catch (_) {}
    }
  }
  function refreshDraftTagsUi() {
    if (!sdEl || !sdDraft) return;
    const sc = sdDraft;
    const tagsBox = sdEl.querySelector('.sd-tags-clickable');
    if (tagsBox) {
      tagsBox.innerHTML = `${(sc.tags || []).map(t => `<span class="sd-tag">#${E(t)}</span>`).join('') || '<span class="sd-empty">タグなし</span>'}<button type="button" class="btn-sort sd-tag-edit-btn" data-sd="draft-tag-toggle">${sdTagPickerOpen ? '▲ タグ選択を閉じる' : '🏷️ タグを選択'}</button>`;
    }
    const pickerHost = sdEl.querySelector('#sdDraftTagPickerHost');
    if (pickerHost && sdTagPickerOpen && typeof buildTagPicker === 'function') {
      const tagSet = new Set(Array.isArray(sc.tags) ? sc.tags : []);
      buildTagPicker(pickerHost, tagSet, () => {
        sc.tags = [...tagSet];
        const tb = sdEl && sdEl.querySelector('.sd-tags-clickable');
        if (tb) {
          tb.innerHTML = `${(sc.tags || []).map(t => `<span class="sd-tag">#${E(t)}</span>`).join('') || '<span class="sd-empty">タグなし</span>'}<button type="button" class="btn-sort sd-tag-edit-btn" data-sd="draft-tag-toggle">${sdTagPickerOpen ? '▲ タグ選択を閉じる' : '🏷️ タグを選択'}</button>`;
        }
      });
    }
  }
  function updateDraftAccSummary(accKey, text) {
    if (!sdEl) return;
    const det = sdEl.querySelector(`details.sd-acc[data-acc="${accKey}"]`);
    if (!det) return;
    const sum = det.querySelector('summary.sd-acc-sum');
    if (!sum) return;
    sum.querySelectorAll('.sd-acc-prev,.sd-acc-badge').forEach(el => el.remove());
    const acts = sum.querySelector('.sd-acc-acts');
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    const frag = document.createRange().createContextualFragment(
      s ? `<span class="sd-acc-prev">${E(s.length > 44 ? s.slice(0, 44) + '…' : s)}</span><span class="sd-acc-badge">${s.length}字</span>`
        : '<span class="sd-acc-prev sd-acc-prev-empty">（未設定）</span>'
    );
    if (acts) sum.insertBefore(frag, acts);
    else sum.appendChild(frag);
  }
  function render(keepScroll) {
    stopTrailerHover();
    const sc = curSc(); if (!sc || !sdEl) return;
    const isCreate = isCreateMode();
    const b = sdEl.querySelector('.sd-body'), top = b ? b.scrollTop : 0;
    sdEl.querySelector('.sd-head h2').textContent = isCreate ? '📝 新規シナリオ手動追加' : '📋 シナリオ詳細';
    sdEl.querySelector('.sd-body').innerHTML = bodyHtml(sc);
    if (keepScroll) sdEl.querySelector('.sd-body').scrollTop = top;
    if (isCreate && sdTagPickerOpen) refreshDraftTagsUi();
    if (sdFocusSpecKey) {
      const k = sdFocusSpecKey, part = sdFocusSpecPart;
      sdFocusSpecKey = ''; sdFocusSpecPart = '';
      let target = null;
      if (k.startsWith('custom:')) {
        const cid = k.slice(7);
        target = sdEl.querySelector(part === 'label' ? `[data-sd-custom-label="${CSS.escape(cid)}"]` : `[data-sd-custom-val="${CSS.escape(cid)}"]`);
      } else {
        target = sdEl.querySelector(`[data-sd-inline="${CSS.escape(k)}"]`);
      }
      if (target) {
        try { target.focus(); if (part === 'label' && target.select) target.select(); } catch (_) {}
      }
    }
    if (!isCreate) {
      if (hasCcf()) fillZipThumbs();
      void fillCloudAssets();
    }
  }
  function buildOrderedSummaryItems(sc) {
    const order = getResolvedSpecOrder(sc);
    const customMap = new Map(ensureCustomSpecs(sc).filter(c => c && c.id).map(c => [c.id, c]));
    const items = [];
    order.forEach(key => {
      if (key.startsWith('custom:')) {
        const cs = customMap.get(key.slice(7));
        if (cs) items.push({ keyName: String(cs.label || '項目'), val: specFullVal(sc, '', cs), customId: cs.id });
      } else if (STD_SPEC_LABELS[key]) {
        items.push({ keyName: STD_SPEC_LABELS[key], val: specFullVal(sc, key), field: key });
      }
    });
    return items;
  }
  function syncScenarioBlocksAndPublic(sc) {
    if (!sc) return;
    const blocks = ensureDetailBlocksSynced(sc);
    const orderedItems = buildOrderedSummaryItems(sc);
    const sum = blocks.find(b => b && b.type === 'summary_container');
    if (sum) sum.items = orderedItems.map(it => ({ ...it }));
    const notesCands = blocks.filter(isNotesCandidate);
    const notesBlk = notesCands.find(blockHasContent) || notesCands[0] || null;
    if (notesBlk) notesBlk.val = String(sc.notes || '');
    const imgBlk = blocks.find(b => b && b.type === 'image');
    if (imgBlk && sc.imageUrl) { imgBlk.previewUrl = String(sc.imageUrl); imgBlk.file = null; }
    if (typeof deriveFlat === 'function') deriveFlat(sc);
    sc.publicBlocks = (typeof sanitizeBlocks === 'function')
      ? sanitizeBlocks(JSON.parse(JSON.stringify(sc.fullBlockData || [])))
      : JSON.parse(JSON.stringify(sc.fullBlockData || []));
    if (typeof currentScenarioId !== 'undefined' && String(currentScenarioId) === String(sc.id) && !window.__editingScenario && typeof loadScenarioFromDB === 'function') {
      try { loadScenarioFromDB(sc.id); } catch (_) {}
    }
  }
  function commitCustomSpecInput(inp) {
    if (!inp || !sdEl) return false;
    const cidLabel = inp.dataset.sdCustomLabel;
    const cidVal = inp.dataset.sdCustomVal;
    if (!cidLabel && !cidVal) return false;
    const sc = curSc();
    if (!sc) return true;
    const isCreate = isCreateMode();
    const cid = cidLabel || cidVal;
    const cs = ensureCustomSpecs(sc).find(c => c && c.id === cid);
    if (!cs) return true;
    const orig = String(inp.dataset.origVal == null ? '' : inp.dataset.origVal);
    let next = String(inp.value == null ? '' : inp.value).trim();
    if (cidLabel && !next) {
      next = orig || '項目';
      inp.value = next;
    }
    if (next === orig) return true;
    if (!isCreate && window.AppHistory) window.AppHistory.checkpoint('概要項目を編集');
    if (cidLabel) {
      cs.label = next;
    } else {
      const prevFull = specFullVal(sc, '', cs);
      const nextFull = next ? mergeFirstLine(prevFull, next) : '';
      cs.value = nextFull;
      [sc.fullBlockData, sc.publicBlocks].forEach(arr => {
        if (!Array.isArray(arr)) return;
        const sum = arr.find(b => b && b.type === 'summary_container' && Array.isArray(b.items));
        if (!sum) return;
        const it = sum.items.find(i => i && (i.customId === cid || i.keyName === cs.label));
        if (it) it.val = nextFull;
      });
    }
    inp.dataset.origVal = next;
    syncScenarioBlocksAndPublic(sc);
    if (!isCreate) {
      sc.detailEdited = true;
      if (window.CloudSync && typeof CloudSync.scheduleAutoWebSync === 'function') CloudSync.scheduleAutoWebSync(sc.id);
      if (typeof saveState === 'function') saveState();
      if (typeof window.patchScenarioDBCard === 'function') window.patchScenarioDBCard(sc.id);
      else if (typeof renderDBView === 'function') renderDBView();
      toast('✅ 保存しました');
    }
    return true;
  }
  function commitInlineField(inp) {
    if (!inp || !sdEl) return;
    const field = inp.dataset.sdInline;
    if (!field) return;
    const sc = curSc();
    if (!sc) return;
    const isCreate = isCreateMode();
    const orig = String(inp.dataset.origVal == null ? '' : inp.dataset.origVal);
    let next = String(inp.value == null ? '' : inp.value).trim();
    if (field === 'title' && !next && !isCreate) {
      next = orig || '無題';
      inp.value = next;
    }
    const restoreSystemSelect = () => {
      if (field === 'system' && inp.classList && inp.classList.contains('sd-system-custom-input')) {
        const dd = inp.closest('dd');
        if (dd) dd.innerHTML = buildSystemSelectHtml(specFirstLine(sc, 'system'));
      }
    };
    if (next === orig) {
      restoreSystemSelect();
      return;
    }
    if (!isCreate && window.AppHistory) window.AppHistory.checkpoint('基本情報を編集');
    if (STD_SPEC_LABELS[field]) {
      const prevFull = specFullVal(sc, field);
      const nextFull = next ? mergeFirstLine(prevFull, next) : '';
      sc[field] = nextFull;
      [sc.fullBlockData, sc.publicBlocks].forEach(arr => {
        if (!Array.isArray(arr)) return;
        const sum = arr.find(b => b && b.type === 'summary_container' && Array.isArray(b.items));
        if (!sum) return;
        const it = sum.items.find(i => i && (i.field === field || (typeof FLAT_MAP !== 'undefined' && FLAT_MAP[i.keyName] === field) || i.keyName === STD_SPEC_LABELS[field]));
        if (it) it.val = nextFull;
      });
    } else {
      sc[field] = next;
      if (field === 'author' && next) {
        const dl = sdEl.querySelector('#sdAuthorSuggestList');
        if (dl && ![...dl.options].some(o => o.value === next)) {
          const opt = document.createElement('option');
          opt.value = next;
          dl.appendChild(opt);
        }
      }
    }
    inp.dataset.origVal = next;
    syncScenarioBlocksAndPublic(sc);
    let tagsChanged = false;
    if ((field === 'system' || field === 'playerCount') && typeof syncDerivedTagsFromFields === 'function') {
      tagsChanged = syncDerivedTagsFromFields(sc);
    }
    if (tagsChanged) {
      if (isCreate) {
        refreshDraftTagsUi();
      } else {
        const tagsBox = sdEl.querySelector('.sd-tags');
        if (tagsBox) {
          tagsBox.innerHTML = (sc.tags || []).map(t => `<span class="sd-tag">#${E(t)}</span>`).join('') || '<span class="sd-empty">タグなし</span>';
        }
      }
    }
    restoreSystemSelect();
    if (!isCreate) {
      sc.detailEdited = true;
      if (window.CloudSync && typeof CloudSync.scheduleAutoWebSync === 'function') CloudSync.scheduleAutoWebSync(sc.id);
      if (typeof saveState === 'function') saveState();
      if (typeof window.patchScenarioDBCard === 'function') window.patchScenarioDBCard(sc.id, { field });
      else if (typeof renderDBView === 'function') renderDBView();
      if (tagsChanged && typeof renderSidebarTags === 'function') renderSidebarTags();
      if (typeof populateScenarioDBSelect === 'function') populateScenarioDBSelect();
      toast('✅ 保存しました');
    }
  }
  function closeDetail() { stopTrailerHover(); if (!sdEl) return; document.removeEventListener('keydown', onKey, true); sdEl.remove(); sdEl = null; sdId = null; sdDraft = null; sdTagPickerOpen = false; }
  function onKey(e) {
    if (e.key === 'Escape' && sdEl) {
      const act = document.activeElement;
      if (act && sdEl.contains(act)) {
        if (act.dataset && act.dataset.sdInline) {
          e.preventDefault(); e.stopImmediatePropagation();
          act.value = act.dataset.origVal || '';
          act.blur();
          return;
        }
        if (act.id === 'sdEditTrailerArea') {
          e.preventDefault(); e.stopImmediatePropagation();
          sdEditTrailer = false; render(true);
          return;
        }
        if (act.id === 'sdEditSynopsisArea' || act.id === 'sdEditSynopsisHeading') {
          e.preventDefault(); e.stopImmediatePropagation();
          sdEditSynopsis = false; render(true);
          return;
        }
        if (act.id === 'sdEditFreeTextArea') {
          e.preventDefault(); e.stopImmediatePropagation();
          sdEditFreeText = false; render(true);
          return;
        }
        if (act.id === 'sdEditPubBlockKey' || act.id === 'sdEditPubBlockVal') {
          e.preventDefault(); e.stopImmediatePropagation();
          sdEditBlockId = ''; render(true);
          return;
        }
        if (act.id && /^sdEditHo(?:Name|Body)_/.test(act.id)) {
          e.preventDefault(); e.stopImmediatePropagation();
          sdEditHoIdx = -1; render(true);
          return;
        }
        if (act.id === 'sdEditNotesArea' || act.id === 'sdEditShopUrl') {
          e.preventDefault(); e.stopImmediatePropagation();
          sdEditNotes = false; render(true);
          return;
        }
      }
      e.preventDefault(); e.stopImmediatePropagation(); closeDetail();
    }
  }
  window.addEventListener('ccf-refs-changed', () => { if (sdEl && !sdDraft) render(true); });   // 登録素材モーダルでの変更を反映
  window.addEventListener('cloud-cache-changed', e => { if (sdEl && !sdDraft && (!e.detail || !e.detail.scenarioId || String(e.detail.scenarioId) === String(sdId))) render(true); });

  function openScenarioHistoryTagModal(scId) {
    const sc = scOf(scId); if (!sc) return;
    if (typeof normalizePosted === 'function') normalizePosted(sc);
    const posted = new Set(Array.isArray(sc.postedChannels) ? sc.postedChannels : []);
    const tags = new Set(Array.isArray(sc.tags) ? sc.tags : []);
    let derivedAutoTags = Array.isArray(sc.autoTags) ? sc.autoTags.slice() : null;
    const chItems = (appState.channels || []).map(c => [c.id, c.name]);
    posted.forEach(id => {
      if (typeof chById === 'function' && !chById(id)) {
        chItems.push([id, `${typeof postedLabel === 'function' ? postedLabel(sc, id) : id}（削除済み）`]);
      }
    });
    const collectAllTagNames = () => {
      const names = [];
      (appState.channels || []).forEach(c => (c.tags || []).forEach(t => { if (t && t.name && !names.includes(t.name)) names.push(t.name); }));
      (appState.customTags || []).forEach(n => { if (n && !names.includes(n)) names.push(n); });
      tags.forEach(n => { if (n && !names.includes(n)) names.push(n); });
      return names;
    };

    const ov = document.createElement('div');
    ov.className = 'app-dialog-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    const box = document.createElement('div');
    box.className = 'app-dialog sd-hist-dialog';
    ov.appendChild(box);

    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const mkBtn = (cls, text, fn) => { const b = mk('button', 'app-dialog-btn ' + cls, text); b.type = 'button'; b.onclick = fn; return b; };
    const close = () => { document.removeEventListener('keydown', onModalKey, true); ov.remove(); };
    const onModalKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };

    const matchingHistory = (appState.history || []).filter(h => {
      if (!h) return false;
      if (h.scenarioId && String(h.scenarioId) === String(sc.id)) return true;
      return !!(h.title && sc.title && h.title === sc.title);
    }).slice().reverse();

    const draw = () => {
      box.textContent = '';
      box.appendChild(mk('div', 'app-dialog-title', `📜 投稿履歴・タグ管理：${sc.title || '無題'}`));

      // 1. 付与タグ管理 + 自動タグ再判定
      const tagSec = mk('div', 'sd-ht-sec');
      const tagHead = mk('div', 'sd-ht-head');
      tagHead.appendChild(mk('b', '', '🏷️ 付与タグのON/OFF・追加'));
      const reDeriveBtn = mk('button', 'btn-sort', '🔄 自動タグを再判定');
      reDeriveBtn.type = 'button';
      reDeriveBtn.onclick = () => {
        if (typeof syncDerivedTagsFromFields !== 'function') return toast('自動タグ判定機能が利用できません');
        const tmp = {
          system: sc.system || '',
          playerCount: sc.playerCount || '',
          tags: [...tags],
          autoTags: derivedAutoTags ? derivedAutoTags.slice() : []
        };
        syncDerivedTagsFromFields(tmp, true);
        const bodyText = [sc.trailer || '', sc.notes || ''].join('\n');
        if ((Array.isArray(sc.secretHOs) && sc.secretHOs.length > 0) || /秘匿\s*HO|秘匿ハンドアウト/i.test(bodyText)) {
          if (!tmp.tags.includes('秘匿HO')) tmp.tags.push('秘匿HO');
        }
        tags.clear();
        tmp.tags.forEach(t => tags.add(t));
        derivedAutoTags = Array.isArray(tmp.autoTags) ? tmp.autoTags.slice() : [];
        draw();
        toast(derivedAutoTags.length ? '🔄 自動タグを再判定しました：' + derivedAutoTags.join(' / ') : '🔄 人数・システムから追加された自動タグはありませんでした');
      };
      tagHead.appendChild(reDeriveBtn);
      tagSec.appendChild(tagHead);

      const tpWrap = mk('div', 'tag-picker-dialog');
      tagSec.appendChild(tpWrap);
      const allTagNames = collectAllTagNames();
      if (typeof buildTagPicker === 'function') {
        buildTagPicker(tpWrap, tags, null, allTagNames);
      } else {
        const wrap = mk('div', 'tag-chips');
        allTagNames.forEach(n => {
          const c = mk('div', 'chip' + (tags.has(n) ? ' selected' : ''), n);
          c.onclick = () => { if (tags.has(n)) tags.delete(n); else tags.add(n); c.classList.toggle('selected', tags.has(n)); };
          wrap.appendChild(c);
        });
        tpWrap.appendChild(wrap);
      }

      const customRow = mk('div', 'sd-ht-addtag');
      const customInp = mk('input', '');
      customInp.type = 'text';
      customInp.placeholder = '新しいタグ名を追加...';
      const customAdd = mk('button', 'btn-sort', '＋ タグ追加');
      customAdd.type = 'button';
      const doAddTag = () => {
        const nm = String(customInp.value || '').trim().replace(/^#+/, '').trim();
        if (!nm) return;
        if (!Array.isArray(appState.customTags)) appState.customTags = [];
        if (!appState.customTags.includes(nm)) appState.customTags.push(nm);
        tags.add(nm);
        customInp.value = '';
        draw();
      };
      customAdd.onclick = doAddTag;
      customInp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doAddTag(); } };
      customRow.append(customInp, customAdd);
      tagSec.appendChild(customRow);
      box.appendChild(tagSec);

      // 2. 各チャンネルの投稿済み状態
      const chSec = mk('div', 'sd-ht-sec');
      const chHead = mk('div', 'sd-ht-head');
      chHead.appendChild(mk('b', '', '📢 各チャンネルの投稿済み状態（クリックで切替）'));
      const bulkWrap = mk('div', 'sd-ht-bulk');
      const bNone = mk('button', 'btn-sort', 'すべて未投稿'); bNone.type = 'button'; bNone.onclick = () => { posted.clear(); draw(); };
      const bAll = mk('button', 'btn-sort', 'すべて投稿済み'); bAll.type = 'button'; bAll.onclick = () => { chItems.forEach(([k]) => posted.add(k)); draw(); };
      bulkWrap.append(bNone, bAll);
      chHead.appendChild(bulkWrap);
      chSec.appendChild(chHead);

      const chWrap = mk('div', 'tag-chips');
      if (!chItems.length) {
        chWrap.appendChild(mk('span', 'sd-empty', '（投稿先チャンネルが未登録です）'));
      } else {
        chItems.forEach(([key, text]) => {
          const c = mk('div', 'chip' + (posted.has(key) ? ' selected' : ''), text);
          c.tabIndex = 0; c.setAttribute('role', 'checkbox'); c.setAttribute('aria-checked', String(posted.has(key)));
          c.onclick = () => { if (posted.has(key)) posted.delete(key); else posted.add(key); c.classList.toggle('selected', posted.has(key)); c.setAttribute('aria-checked', String(posted.has(key))); };
          chWrap.appendChild(c);
        });
      }
      chSec.appendChild(chWrap);
      box.appendChild(chSec);

      // 3. 投稿履歴（このシナリオ）
      const histSec = mk('div', 'sd-ht-sec');
      const histHead = mk('div', 'sd-ht-head');
      histHead.appendChild(mk('b', '', `📜 投稿履歴（${matchingHistory.length}件）`));
      histSec.appendChild(histHead);
      const histList = mk('div', 'sd-ht-histlist');
      if (matchingHistory.length) {
        matchingHistory.forEach(h => {
          const rowEl = mk('div', 'sd-ht-histrow');
          const dtStr = typeof fmtDate === 'function' ? fmtDate(h.date) : String(h.date || '');
          const topLine = mk('div', 'sd-ht-histtop');
          topLine.appendChild(mk('span', 'sd-ht-date', dtStr));
          topLine.appendChild(mk('span', 'sd-ht-ch', h.channels || ''));
          rowEl.appendChild(topLine);
          if (h.tags) rowEl.appendChild(mk('div', 'sd-ht-tags', 'タグ: ' + h.tags));
          if (h.threadLinks && typeof h.threadLinks === 'object') {
            const linksDiv = mk('div', 'sd-ht-links');
            Object.entries(h.threadLinks).forEach(([chName, url]) => {
              const safe = typeof safeUrl === 'function' ? safeUrl(url) : url;
              if (!safe) return;
              const a = mk('a', 'sc-link-btn', `🔗 ${chName}`);
              a.href = safe; a.target = '_blank'; a.rel = 'noopener noreferrer';
              linksDiv.appendChild(a);
            });
            if (linksDiv.childNodes.length) rowEl.appendChild(linksDiv);
          }
          histList.appendChild(rowEl);
        });
      } else {
        histList.appendChild(mk('div', 'sd-empty', 'このシナリオの投稿履歴はまだありません'));
      }
      histSec.appendChild(histList);
      box.appendChild(histSec);

      // Actions
      const act = mk('div', 'app-dialog-actions');
      act.append(
        mkBtn('', 'キャンセル', close),
        mkBtn('primary', '💾 変更を保存', () => {
          const tagList = [...tags];
          chItems.forEach(([cid]) => {
            const was = (sc.postedChannels || []).includes(cid), now = posted.has(cid);
            if (now && !was && typeof setPosted === 'function') {
              const c = typeof chById === 'function' ? chById(cid) : null;
              setPosted(sc, cid, true, tagList.filter(n => c && (c.tags || []).some(t => t.name === n)));
            } else if (!now && was && typeof setPosted === 'function') {
              setPosted(sc, cid, false);
            }
          });
          sc.tags = tagList;
          if (derivedAutoTags !== null) sc.autoTags = derivedAutoTags;
          close();
          if (typeof saveState === 'function') saveState();
          if (typeof renderDBView === 'function') renderDBView();
          if (typeof populateScenarioDBSelect === 'function') populateScenarioDBSelect();
          if (typeof checkDuplicateStatus === 'function') checkDuplicateStatus();
          if (sdEl && String(sdId) === String(sc.id)) render(true);
          toast('✅ 投稿状態・タグを更新しました');
        })
      );
      box.appendChild(act);
    };

    draw();
    document.body.appendChild(ov);
    document.addEventListener('keydown', onModalKey, true);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  }

  function wireDetailModalEvents(el, opts) {
    const o = opts || {};
    const m = el.querySelector('.sd-modal');
    if (m) m.focus();
    el.addEventListener('mousedown', e => { if (e.target === el) closeDetail(); });
    if (!o.createMode && m) {
      const hasFiles = e => [...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files');
      m.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); m.classList.add('sd-dropping'); });
      m.addEventListener('dragleave', e => { if (!m.contains(e.relatedTarget)) m.classList.remove('sd-dropping'); });
      m.addEventListener('drop', e => {
        m.classList.remove('sd-dropping'); if (!hasFiles(e)) return; e.preventDefault();
        const paths = [...e.dataTransfer.files].map(f => filePathOf(f)).filter(Boolean);
        if (!paths.length) return toast('ファイルの場所を取得できませんでした（デスクトップアプリ版で使えます）');
        addMaterials(sdId, paths).catch(er => { logSoft('sdDrop', er); toast('❌ 素材を追加できませんでした：' + (er.message || er)); });
      });
    }
    const scheduleThumbSave = () => {
      if (isCreateMode()) return;
      clearTimeout(sdRangeTimer);
      sdRangeTimer = setTimeout(() => {
        saveState(true);
        const scNow = curSc();
        if (scNow && typeof window.patchScenarioDBCard === 'function') window.patchScenarioDBCard(scNow.id, { field: 'thumb' });
        else if (typeof renderDBView === 'function') renderDBView();
      }, 180);
    };
    el.addEventListener('input', e => {
      const sc = curSc(); if (!sc) return;
      const r = e.target.closest && e.target.closest('[data-sd-range]');
      if (r) {
        stopTrailerHover();
        const key = r.dataset.sdRange;
        sc[key] = Number(r.value);
        sc.thumbSettings = {
          posX: clampThumbNum(sc.thumbPosX, 0, 100, 50),
          posY: clampThumbNum(sc.thumbPosY, 0, 100, 50),
          zoom: clampThumbNum(sc.thumbZoom, 25, 250, 100),
          fit: sc.thumbFit === 'contain' ? 'contain' : 'cover',
          spoilerBlur: !!sc.spoilerBlur
        };
        const valEl = el.querySelector(`[data-sd-val="${key}"]`);
        if (valEl) valEl.textContent = r.value + '%';
        const img = el.querySelector('.sd-trailer-wrap img.sd-trailer');
        if (img) img.setAttribute('style', thumbStyleStr(sc));
        const blurBg = el.querySelector('.sd-trailer-wrap img.thumb-blur-bg');
        if (blurBg) {
          const useBlur = sdSelSlot === 0 && (sc.thumbFit === 'contain' || sc.thumbSettings.zoom < 100);
          blurBg.style.display = useBlur ? 'block' : 'none';
        }
        scheduleThumbSave();
        return;
      }
      if (!isCreateMode()) return;
      const df = e.target.closest && e.target.closest('[data-sd-draft]');
      if (df) {
        const dk = df.dataset.sdDraft;
        if (dk === 'trailer') {
          sc.trailer = df.value;
          updateDraftAccSummary('trailer', sc.trailer);
        } else if (dk === 'synopsis' || dk === 'synopsisHeading') {
          const { blocks, synopsisBlock } = classifyScenarioPublicBlocks(sc);
          const hInp = el.querySelector('[data-sd-draft="synopsisHeading"]');
          const vInp = el.querySelector('[data-sd-draft="synopsis"]');
          const nextH = (hInp && hInp.value.trim()) ? hInp.value.trim() : 'あらすじ';
          const nextV = vInp ? vInp.value : '';
          if (synopsisBlock) {
            synopsisBlock.keyName = nextH;
            synopsisBlock.label = nextH;
            synopsisBlock.val = nextV;
          } else {
            const sumIdx = blocks.findIndex(x => x && x.type === 'summary_container');
            const newBlk = { id: 'intro', type: 'textarea', label: nextH, keyName: nextH, val: nextV, sectionType: 'standalone', collapsed: true, isCustom: true, decorStyle: 'default' };
            if (sumIdx >= 0) blocks.splice(sumIdx + 1, 0, newBlk);
            else blocks.unshift(newBlk);
          }
          sc.synopsis = nextV;
          updateDraftAccSummary('synopsis', nextV);
        } else if (dk === 'notes') {
          sc.notes = df.value;
          updateDraftAccSummary('notes', sc.notes);
        }
        return;
      }
      const bkKey = e.target.closest && e.target.closest('[data-sd-draft-block-key]');
      if (bkKey) {
        const bid = String(bkKey.dataset.sdDraftBlockKey || '');
        const blk = ensureDetailBlocksSynced(sc).find(x => x && String(x.id) === bid);
        if (blk) {
          const nextK = bkKey.value.trim() || '自由項目';
          blk.keyName = nextK;
          blk.label = nextK;
          const card = bkKey.closest('.sd-pubblock-card');
          const titleEl = card && card.querySelector('.sd-pubblock-title');
          if (titleEl) titleEl.textContent = '📑 ' + nextK;
        }
        return;
      }
      const bkVal = e.target.closest && e.target.closest('[data-sd-draft-block-val]');
      if (bkVal) {
        const bid = String(bkVal.dataset.sdDraftBlockVal || '');
        const blk = ensureDetailBlocksSynced(sc).find(x => x && String(x.id) === bid);
        if (blk) blk.val = bkVal.value;
        return;
      }
      const inl = e.target.closest && e.target.closest('[data-sd-inline]');
      if (inl) {
        const f = inl.dataset.sdInline;
        if (f) {
          sc[f] = inl.value;
          if ((f === 'system' || f === 'playerCount') && typeof syncDerivedTagsFromFields === 'function') {
            if (syncDerivedTagsFromFields(sc)) refreshDraftTagsUi();
          }
        }
        return;
      }
      const custL = e.target.closest && e.target.closest('[data-sd-custom-label]');
      if (custL) {
        const cs = ensureCustomSpecs(sc).find(c => c && c.id === custL.dataset.sdCustomLabel);
        if (cs) cs.label = custL.value;
        return;
      }
      const custV = e.target.closest && e.target.closest('[data-sd-custom-val]');
      if (custV) {
        const cs = ensureCustomSpecs(sc).find(c => c && c.id === custV.dataset.sdCustomVal);
        if (cs) cs.value = custV.value;
      }
    });
    el.addEventListener('mouseover', e => {
      const wrap = e.target.closest && e.target.closest('.sd-trailer-wrap');
      if (!wrap || sdHoverTimer) return;
      const preloadImgs = [...wrap.querySelectorAll('.thumb-preload img')];
      const img = wrap.querySelector('img.sd-trailer');
      if (!img || !preloadImgs.length) return;
      const origSrc = img.src;
      const sc = curSc();
      const origStyle = sc ? thumbStyleStr(sc) : (img.getAttribute('style') || '');
      img.dataset.origSrc = origSrc;
      const total = 1 + preloadImgs.length;
      const ind = wrap.querySelector('.sd-hover-ind');
      if (ind) ind.dataset.total = String(total);
      const getFrameSrc = idx => {
        if (idx === 0) return origSrc;
        const im = preloadImgs[idx - 1];
        if (!im) return '';
        if (im.dataset && im.dataset.ref && typeof thumbSrc === 'function') {
          const resolved = thumbSrc('@img:' + im.dataset.ref);
          if (resolved && !resolved.startsWith('data:image/gif;base64,R0lGOD')) return resolved;
        }
        return im.src || im.getAttribute('src') || '';
      };
      sdHoverIdx = 0;
      const step = () => {
        if (!sdEl || !document.body.contains(wrap)) { stopTrailerHover(); return; }
        sdHoverIdx = (sdHoverIdx + 1) % total;
        const nextSrc = getFrameSrc(sdHoverIdx);
        if (nextSrc) img.src = nextSrc;
        img.setAttribute('style', sdHoverIdx === 0 ? origStyle : 'object-position:50% 50%; transform:scale(1);');
        if (ind) ind.textContent = `🖼️ ${sdHoverIdx + 1}/${total}`;
      };
      sdHoverTimer = setInterval(step, 900);
    });
    el.addEventListener('mouseout', e => {
      const wrap = e.target.closest && e.target.closest('.sd-trailer-wrap');
      if (!wrap) return;
      const rel = e.relatedTarget;
      if (!rel || !wrap.contains(rel)) stopTrailerHover();
    });
    el.addEventListener('dragstart', e => {
      const specItem = e.target.closest && e.target.closest('.sd-spec-item[data-spec-key]');
      if (specItem && sdSpecSortMode) {
        if (e.target.closest('input,select,button')) { e.preventDefault(); return; }
        sdDragSpecKey = String(specItem.dataset.specKey || '');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sdDragSpecKey); }
        specItem.classList.add('is-dragging');
        return;
      }
      const slot = e.target.closest && e.target.closest('.sd-hover-slot[data-sd-slot]');
      if (!slot) return;
      sdDragSlot = Number(slot.dataset.sdSlot);
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(sdDragSlot)); }
      slot.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => {
      sdDragSlot = -1;
      sdDragSpecKey = '';
      if (sdEl) sdEl.querySelectorAll('.sd-hover-slot.is-dragging,.sd-hover-slot.dragover,.sd-spec-item.is-dragging,.sd-spec-item.dragover').forEach(x => x.classList.remove('is-dragging', 'dragover'));
    });
    el.addEventListener('dragover', e => {
      if (sdDragSpecKey) {
        const specItem = e.target.closest && e.target.closest('.sd-spec-item[data-spec-key]');
        if (!specItem || specItem.classList.contains('is-fixed')) return;
        e.preventDefault(); e.stopPropagation();
        el.querySelectorAll('.sd-spec-item.dragover').forEach(x => { if (x !== specItem) x.classList.remove('dragover'); });
        specItem.classList.add('dragover');
        return;
      }
      if (sdDragSlot < 0) return;
      const slot = e.target.closest && e.target.closest('.sd-hover-slot[data-sd-slot]');
      if (!slot) return;
      e.preventDefault(); e.stopPropagation();
      el.querySelectorAll('.sd-hover-slot.dragover').forEach(x => { if (x !== slot) x.classList.remove('dragover'); });
      slot.classList.add('dragover');
    });
    el.addEventListener('drop', e => {
      if (sdDragSpecKey) {
        const specItem = e.target.closest && e.target.closest('.sd-spec-item[data-spec-key]');
        const fromKey = sdDragSpecKey;
        sdDragSpecKey = '';
        if (!specItem || specItem.classList.contains('is-fixed')) return;
        e.preventDefault(); e.stopPropagation();
        const toKey = String(specItem.dataset.specKey || '');
        const sc = curSc();
        if (sc && fromKey && toKey && fromKey !== toKey) {
          const order = ensureSpecOrder(sc);
          const fi = order.indexOf(fromKey), ti = order.indexOf(toKey);
          if (fi >= 0 && ti >= 0) {
            if (!isCreateMode() && window.AppHistory) window.AppHistory.checkpoint('概要項目の並び順を変更');
            const [mv] = order.splice(fi, 1);
            order.splice(ti, 0, mv);
            syncScenarioBlocksAndPublic(sc);
            if (!isCreateMode()) {
              sc.detailEdited = true;
              if (typeof saveState === 'function') saveState();
            }
            render(true);
          }
        }
        return;
      }
      if (sdDragSlot < 0) return;
      const slot = e.target.closest && e.target.closest('.sd-hover-slot[data-sd-slot]');
      if (!slot) return;
      e.preventDefault(); e.stopPropagation();
      const from = sdDragSlot, to = Number(slot.dataset.sdSlot);
      sdDragSlot = -1;
      const sc = curSc();
      if (sc && from >= 0 && to >= 0 && from !== to) {
        const slots = getThumbSlots(sc);
        if (from < slots.length && to < slots.length) {
          const [moved] = slots.splice(from, 1);
          slots.splice(to, 0, moved);
          sdSelSlot = to;
          applyThumbSlots(sc, slots);
          if (!isCreateMode()) { saveState(); renderDBView(); }
          render(true);
        }
      }
    });
    el.addEventListener('click', e => {   // ヘッダー内ボタン押下で details が開閉しないようにし、編集系は自動展開
      const ab = e.target.closest && e.target.closest('.sd-acc-acts [data-sd]');
      if (!ab) return;
      e.preventDefault();
      const det = ab.closest('details.sd-acc');
      if (det && /edit|add/.test(ab.dataset.sd || '')) { sdOpenSecs.add(det.dataset.acc); det.open = true; }
    }, true);
    el.addEventListener('toggle', e => {
      if (e.target && e.target.classList && e.target.classList.contains('sd-acc')) {
        if (e.target.open) sdOpenSecs.add(e.target.dataset.acc); else sdOpenSecs.delete(e.target.dataset.acc);
      }
      if (e.target && e.target.classList && e.target.classList.contains('sd-thumb-cfg')) sdThumbOpen = e.target.open;
      if (e.target && e.target.classList && e.target.classList.contains('sd-ho-details')) {
        const hi = Number(e.target.dataset.hoIdx);
        if (!Number.isNaN(hi)) {
          if (e.target.open) sdOpenHOs.add(hi); else sdOpenHOs.delete(hi);
        }
      }
    }, true);
    el.addEventListener('change', async e => {
      const sc = curSc(); if (!sc) return;
      const isCreate = isCreateMode();
      if (e.target.id === 'sdHoverFileInput' && e.target.files && e.target.files.length) {
        const slots = getThumbSlots(sc);
        for (const f of Array.from(e.target.files)) {
          if (slots.length >= 4) break;
          if (!f.type.startsWith('image/')) continue;
          const dataUrl = await compressImage(f, 1000, 1000, 0.85);
          if (dataUrl && !slots.includes(dataUrl)) slots.push(dataUrl);
        }
        e.target.value = '';
        if (slots.length) sdSelSlot = slots.length - 1;
        applyThumbSlots(sc, slots);
        if (!isCreate) { saveState(); renderDBView(); }
        render(true);
        return;
      }
      const chk = e.target.closest && e.target.closest('[data-sd-chk="spoilerBlur"]');
      if (chk) {
        sc.spoilerBlur = !!chk.checked;
        applyThumbSlots(sc, getThumbSlots(sc));
        if (!sc.spoilerBlur) sdPeek = false;
        if (!isCreate) { saveState(); renderDBView(); }
        render(true);
        return;
      }
      const sysSel = e.target.closest && e.target.closest('[data-sd-field="system"]');
      if (sysSel) {
        if (sysSel.value === '__other__') {
          const dd = sysSel.closest('dd');
          if (dd) {
            dd.innerHTML = `<input type="text" class="sd-inline-input sd-system-custom-input" data-sd-inline="system" data-orig-val="${E(specFirstLine(sc, 'system'))}" value="" placeholder="システム名を入力...">`;
            const inp = dd.querySelector('input');
            if (inp) inp.focus();
          }
          return;
        }
        const next = String(sysSel.value || '').trim();
        if (next !== specFirstLine(sc, 'system')) {
          if (!isCreate && window.AppHistory) window.AppHistory.checkpoint('基本情報を編集');
          const prevFull = specFullVal(sc, 'system');
          const nextFull = next ? mergeFirstLine(prevFull, next) : '';
          sc.system = nextFull;
          [sc.fullBlockData, sc.publicBlocks].forEach(arr => {
            if (!Array.isArray(arr)) return;
            const sum = arr.find(b => b && b.type === 'summary_container' && Array.isArray(b.items));
            if (!sum) return;
            const it = sum.items.find(i => i && (i.field === 'system' || i.keyName === 'システム'));
            if (it) it.val = nextFull;
          });
          syncScenarioBlocksAndPublic(sc);
          let tagsChanged = false;
          if (typeof syncDerivedTagsFromFields === 'function') {
            tagsChanged = syncDerivedTagsFromFields(sc);
          }
          if (tagsChanged) {
            if (isCreate) {
              refreshDraftTagsUi();
            } else {
              const tagsBox = el.querySelector('.sd-tags');
              if (tagsBox) {
                tagsBox.innerHTML = (sc.tags || []).map(t => `<span class="sd-tag">#${E(t)}</span>`).join('') || '<span class="sd-empty">タグなし</span>';
              }
            }
          }
          if (!isCreate) {
            if (typeof saveState === 'function') saveState();
            if (typeof renderDBView === 'function') renderDBView();
            if (typeof renderSidebarTags === 'function') renderSidebarTags();
            if (typeof populateScenarioDBSelect === 'function') populateScenarioDBSelect();
            toast(next ? `システムを「${next}」に変更しました` : 'システムを「未設定」に変更しました');
          }
        }
        return;
      }
      const pf = e.target.closest && e.target.closest('[data-sd-field="playStatus"]');
      if (pf) {
        sc.playStatus = normalizePlayStatus(pf.value);
        if (!isCreate) {
          saveState(); renderDBView();
          const info = PLAY_STATUS_MAP[sc.playStatus];
          toast(`プレイ状況を「${info ? info.label : '未設定'}」に変更しました`);
        }
        return;
      }
      const inl = e.target.closest && e.target.closest('[data-sd-inline]');
      if (inl) commitInlineField(inl);
      const custInp = e.target.closest && e.target.closest('[data-sd-custom-label],[data-sd-custom-val]');
      if (custInp) commitCustomSpecInput(custInp);
    });
    el.addEventListener('focusout', e => {
      const inl = e.target.closest && e.target.closest('[data-sd-inline]');
      if (inl) commitInlineField(inl);
      const custInp = e.target.closest && e.target.closest('[data-sd-custom-label],[data-sd-custom-val]');
      if (custInp) commitCustomSpecInput(custInp);
    });
    el.addEventListener('keydown', e => {
      if (e.target && e.target.id === 'sdDraftNewTagInput' && e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        el.querySelector('[data-sd="draft-tag-add"]')?.click();
        return;
      }
      const inl = e.target.closest && e.target.closest('[data-sd-inline],[data-sd-custom-label],[data-sd-custom-val]');
      if (inl && e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        inl.blur();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (isCreateMode()) {
          e.preventDefault();
          el.querySelector('[data-sd="draft-register"]')?.click();
          return;
        }
        if (e.target && e.target.id === 'sdEditTrailerArea') {
          e.preventDefault();
          el.querySelector('[data-sd="trailer-save"]')?.click();
        } else if (e.target && (e.target.id === 'sdEditSynopsisArea' || e.target.id === 'sdEditSynopsisHeading')) {
          e.preventDefault();
          el.querySelector('[data-sd="synopsis-save"]')?.click();
        } else if (e.target && e.target.id === 'sdEditFreeTextArea') {
          e.preventDefault();
          el.querySelector('[data-sd="freetext-save"]')?.click();
        } else if (e.target && (e.target.id === 'sdEditPubBlockKey' || e.target.id === 'sdEditPubBlockVal')) {
          e.preventDefault();
          el.querySelector('[data-sd="pubblock-save"]')?.click();
        } else if (e.target && e.target.id && /^sdEditHo(?:Name|Body)_/.test(e.target.id)) {
          e.preventDefault();
          el.querySelector('[data-sd="ho-save"]')?.click();
        } else if (e.target && (e.target.id === 'sdEditNotesArea' || e.target.id === 'sdEditShopUrl')) {
          e.preventDefault();
          el.querySelector('[data-sd="notes-save"]')?.click();
        }
      }
    });
    el.addEventListener('click', async e => {
      const slotEl = e.target.closest('.sd-hover-slot[data-sd-slot]');
      if (slotEl && !e.target.closest('[data-sd]')) {
        const idx = Number(slotEl.dataset.sdSlot);
        if (!Number.isNaN(idx)) {
          sdSelSlot = idx;
          render(true);
        }
        return;
      }
      const zoomImg = e.target.closest && e.target.closest('.sd-thumbs img[data-sd-zoom]');
      if (zoomImg) {
        const ref = zoomImg.dataset.ref;
        let src = zoomImg.currentSrc || zoomImg.src || '';
        if (ref && typeof window.ensureLocalImageByHash === 'function') {
          await window.ensureLocalImageByHash(ref);
          if (typeof window.getLocalImageBlobUrl === 'function') {
            src = window.getLocalImageBlobUrl(ref) || src;
          }
        }
        if (src) {
          const ov = document.createElement('div');
          ov.className = 'app-dialog-overlay';
          ov.setAttribute('role', 'dialog');
          ov.setAttribute('aria-modal', 'true');
          ov.style.zIndex = '10080';
          const title = zoomImg.dataset.sdZoom || zoomImg.alt || 'プレビュー';
          ov.innerHTML = `<div class="app-dialog" style="width:min(860px,94vw); max-height:90vh; display:flex; flex-direction:column; gap:10px; align-items:center;">
            <div style="width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <b style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🖼️ ${E(title)}</b>
              <button type="button" class="btn-sort" data-sd-zoom-close="1">✕ 閉じる</button>
            </div>
            <img src="${E(src)}" alt="${E(title)}" style="max-width:100%; max-height:74vh; object-fit:contain; border-radius:6px; background:rgba(0,0,0,0.2);">
          </div>`;
          const closeZoom = () => { document.removeEventListener('keydown', onZk, true); ov.remove(); };
          const onZk = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); closeZoom(); } };
          ov.addEventListener('click', ev => { if (ev.target === ov || ev.target.closest('[data-sd-zoom-close]')) closeZoom(); });
          document.addEventListener('keydown', onZk, true);
          document.body.appendChild(ov);
        }
        return;
      }
      const b = e.target.closest('[data-sd]'); if (!b) return; const k = b.dataset.sd;
      const sc = curSc();
      const isCreate = isCreateMode();
      if (k === 'close' || k === 'draft-cancel') return closeDetail();
      if (k === 'draft-tag-toggle' && isCreate) {
        sdTagPickerOpen = !sdTagPickerOpen;
        render(true);
        return;
      }
      if (k === 'draft-tag-add' && isCreate && sc) {
        const inp = el.querySelector('#sdDraftNewTagInput');
        const nm = String((inp && inp.value) || '').trim().replace(/^#+/, '').trim();
        if (!nm) { if (inp) inp.focus(); return; }
        if (!Array.isArray(sc.tags)) sc.tags = [];
        if (!sc.tags.includes(nm)) sc.tags.push(nm);
        if (!Array.isArray(appState.customTags)) appState.customTags = [];
        if (!appState.customTags.includes(nm)) appState.customTags.push(nm);
        if (inp) inp.value = '';
        refreshDraftTagsUi();
        return;
      }
      if (k === 'draft-register' && isCreate && sc) {
        const titleInp = el.querySelector('.sd-title-input');
        if (titleInp) sc.title = String(titleInp.value || '').trim();
        else sc.title = String(sc.title || '').trim();
        if (!sc.title) {
          if (titleInp) titleInp.focus();
          if (typeof toast === 'function') toast('⚠️ シナリオタイトルを入力してください');
          return;
        }
        const active = document.activeElement;
        if (active && el.contains(active)) {
          if (active.dataset && active.dataset.sdInline) commitInlineField(active);
          else if (active.dataset && (active.dataset.sdCustomLabel || active.dataset.sdCustomVal)) commitCustomSpecInput(active);
        }
        const finalSc = sc;
        finalSc.id = (typeof uid === 'function') ? uid() : ('sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        finalSc.author = String(finalSc.author || '').trim();
        finalSc.shopUrl = String(finalSc.shopUrl || '').trim();
        finalSc.createdAt = Date.now();
        finalSc.updatedAt = Date.now();
        syncScenarioBlocksAndPublic(finalSc);
        if (typeof syncDerivedTagsFromFields === 'function') syncDerivedTagsFromFields(finalSc);
        appState.scenarios.push(finalSc);
        if (typeof saveState === 'function') saveState();
        if (typeof populateScenarioDBSelect === 'function') populateScenarioDBSelect();
        if (typeof renderDBView === 'function') renderDBView();
        if (typeof renderSidebarTags === 'function') renderSidebarTags();
        closeDetail();
        if (typeof toast === 'function') toast(`✅ 「${finalSc.title}」をデータベースに登録しました`);
        return;
      }
      if (k === 'open-common-asset') {
        const uid = b.dataset.uid || '';
        if (uid && typeof window.openGalleryDetailModal === 'function') {
          window.openGalleryDetailModal({ scope: 'common', uid });
        }
        return;
      }
      if (k === 'toggle-peek') { sdPeek = !sdPeek; render(true); return; }
      if (k === 'web-sync-assets' && sc && !isCreate) {
        if (typeof window.syncScenarioAssetsToWeb !== 'function') {
          if (typeof toast === 'function') toast('⚠️ Web同期機能が利用できません');
          return;
        }
        b.disabled = true;
        b.textContent = '☁️ 画像・本文テキストを同期中…';
        try { await window.syncScenarioAssetsToWeb(sc.id); }
        finally { render(true); }
        return;
      }
      if (k === 'toggle-pin' && sc && !isCreate) {
        if (window.CloudSync && CloudSync.setScenarioPinned) {
          await CloudSync.setScenarioPinned(sc.id, !CloudSync.isScenarioPinned(sc.id));
          render(true);
        }
        return;
      }
      if (k === 'fetch-assets' && sc && !isCreate) {
        if (window.CloudSync && CloudSync.ensureScenarioAssetsCached) {
          b.disabled = true; b.textContent = '☁️ 取得中…';
          try { await CloudSync.ensureScenarioAssetsCached(sc.id, { showProgress: true, manual: true }); }
          finally { render(true); }
        }
        return;
      }
      if (k === 'release-cache' && sc && !isCreate) {
        if (window.CloudSync && CloudSync.releaseScenarioLocalCache) {
          const ok = typeof appConfirm === 'function'
            ? await appConfirm(
                `「${sc.title || 'シナリオ'}」について、この端末に一時保存されているPDF・画像・音声を削除して空き容量を増やしますか？\n\n※ クラウド上の元データは一切削除されません。\n※ 一覧用の表紙画像はそのまま残ります。`,
                { title: '💨 この端末の一時データを削除', okText: '削除する', cancelText: 'キャンセル' }
              )
            : true;
          if (ok) {
            await CloudSync.releaseScenarioLocalCache(sc.id);
            render(true);
          }
        }
        return;
      }
      if (k === 'thumb-fit' && sc) {
        sc.thumbFit = b.dataset.fit === 'contain' ? 'contain' : 'cover';
        applyThumbSlots(sc, getThumbSlots(sc));
        if (!isCreate) {
          saveState();
          if (typeof window.patchScenarioDBCard === 'function') window.patchScenarioDBCard(sc.id, { field: 'thumb' });
          else if (typeof renderDBView === 'function') renderDBView();
        }
        render(true); return;
      }
      if (k === 'thumb-reset' && sc) {
        sc.thumbPosX = 50; sc.thumbPosY = 50; sc.thumbZoom = 100; sc.thumbFit = 'cover';
        applyThumbSlots(sc, getThumbSlots(sc));
        if (!isCreate) {
          saveState();
          if (typeof window.patchScenarioDBCard === 'function') window.patchScenarioDBCard(sc.id, { field: 'thumb' });
          else if (typeof renderDBView === 'function') renderDBView();
        }
        render(true); return;
      }
      if (k === 'spec-add-toggle') {
        sdSpecAddOpen = !sdSpecAddOpen;
        render(true); return;
      }
      if (k === 'spec-sort-toggle') {
        sdSpecSortMode = !sdSpecSortMode;
        render(true); return;
      }
      if (k === 'spec-add-preset' && sc) {
        const idx = Number(b.dataset.presetIdx);
        const preset = SPEC_PRESETS[idx];
        if (!preset) return;
        if (!isCreate && window.AppHistory) window.AppHistory.checkpoint('概要項目を追加');
        const order = ensureSpecOrder(sc);
        if (preset.kind === 'std') {
          insertIntoOrderSmart(order, preset.key);
          sdFocusSpecKey = preset.key;
          sdFocusSpecPart = 'val';
        } else {
          const cid = 'cs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          ensureCustomSpecs(sc).push({ id: cid, label: preset.isFree ? '新規項目' : preset.label, value: '' });
          const cKey = 'custom:' + cid;
          order.push(cKey);
          sdFocusSpecKey = cKey;
          sdFocusSpecPart = preset.isFree ? 'label' : 'val';
        }
        sdSpecAddOpen = false;
        syncScenarioBlocksAndPublic(sc);
        if (!isCreate) {
          sc.detailEdited = true;
          if (window.CloudSync && typeof CloudSync.scheduleAutoWebSync === 'function') CloudSync.scheduleAutoWebSync(sc.id);
          if (typeof saveState === 'function') saveState();
        }
        render(true);
        return;
      }
      if ((k === 'spec-move-prev' || k === 'spec-move-next') && sc) {
        const key = b.dataset.specKey;
        if (!key) return;
        const order = ensureSpecOrder(sc);
        const idx = order.indexOf(key);
        const targetIdx = k === 'spec-move-prev' ? idx - 1 : idx + 1;
        if (idx >= 0 && targetIdx >= 0 && targetIdx < order.length) {
          if (!isCreate && window.AppHistory) window.AppHistory.checkpoint('概要項目の並び順を変更');
          [order[idx], order[targetIdx]] = [order[targetIdx], order[idx]];
          syncScenarioBlocksAndPublic(sc);
          if (!isCreate) {
            sc.detailEdited = true;
            if (window.CloudSync && typeof CloudSync.scheduleAutoWebSync === 'function') CloudSync.scheduleAutoWebSync(sc.id);
            if (typeof saveState === 'function') saveState();
          }
          render(true);
        }
        return;
      }
      if (k === 'spec-del' && sc) {
        const key = b.dataset.specKey;
        if (!key || CORE_SPEC_KEYS.includes(key)) return;
        if (!isCreate && window.AppHistory) window.AppHistory.checkpoint('概要項目を削除');
        const order = ensureSpecOrder(sc);
        sc.specOrder = order.filter(x => x !== key);
        if (key.startsWith('custom:')) {
          const cid = key.slice(7);
          sc.customSpecs = ensureCustomSpecs(sc).filter(c => c && c.id !== cid);
        } else if (STD_SPEC_LABELS[key]) {
          sc[key] = '';
        }
        syncScenarioBlocksAndPublic(sc);
        if (!isCreate) {
          sc.detailEdited = true;
          if (window.CloudSync && typeof CloudSync.scheduleAutoWebSync === 'function') CloudSync.scheduleAutoWebSync(sc.id);
          if (typeof saveState === 'function') saveState();
          if (typeof renderDBView === 'function') renderDBView();
        }
        render(true);
        return;
      }
      if (k === 'hover-del' && sc) {
        const idx = Number(b.dataset.idx);
        const slots = getThumbSlots(sc);
        if (idx >= 0 && idx < slots.length) slots.splice(idx, 1);
        sdSelSlot = slots.length ? Math.max(0, Math.min(idx, slots.length - 1)) : 0;
        applyThumbSlots(sc, slots);
        if (!isCreate) { saveState(); renderDBView(); }
        render(true); return;
      }
      if ((k === 'slot-left' || k === 'slot-right' || k === 'slot-main') && sc) {
        const idx = Number(b.dataset.idx);
        const slots = getThumbSlots(sc);
        if (idx < 0 || idx >= slots.length) return;
        if (k === 'slot-left' && idx > 0) {
          [slots[idx - 1], slots[idx]] = [slots[idx], slots[idx - 1]];
          sdSelSlot = idx - 1;
        } else if (k === 'slot-right' && idx < slots.length - 1) {
          [slots[idx + 1], slots[idx]] = [slots[idx], slots[idx + 1]];
          sdSelSlot = idx + 1;
        } else if (k === 'slot-main' && idx > 0) {
          const [picked] = slots.splice(idx, 1);
          slots.unshift(picked);
          sdSelSlot = 0;
        }
        applyThumbSlots(sc, slots);
        if (!isCreate) { saveState(); renderDBView(); }
        render(true); return;
      }
      if (k === 'hover-pick-file') {
        const fi = el.querySelector('#sdHoverFileInput'); if (fi) fi.click(); return;
      }
      if (k === 'hover-pick-gal' && sc) {
        if (typeof pickGalleryImage !== 'function') return toast('ギャラリーピッカーが利用できません');
        const url = await pickGalleryImage({ scenarioId: isCreate ? '' : sc.id });
        if (url) {
          const slots = getThumbSlots(sc);
          if (slots.length < 4 && !slots.includes(url)) {
            slots.push(url);
            sdSelSlot = slots.length - 1;
            applyThumbSlots(sc, slots);
            if (!isCreate) { saveState(); renderDBView(); }
            render(true);
          }
        }
        return;
      }
      if (k === 'hover-add-url' && sc) {
        const inp = el.querySelector('#sdHoverUrlInput');
        const url = inp ? String(inp.value || '').trim() : '';
        if (!safeUrl(url)) return toast('有効な http(s):// 画像URLを入力してください');
        const slots = getThumbSlots(sc);
        if (slots.length < 4 && !slots.includes(url)) {
          slots.push(url);
          sdSelSlot = slots.length - 1;
          applyThumbSlots(sc, slots);
          if (!isCreate) { saveState(); renderDBView(); }
          render(true);
        }
        return;
      }
      if (k === 'toggle-fav' && sc) {
        sc.favorite = !sc.favorite;
        if (!isCreate) { saveState(); renderDBView(); }
        render(true);
        return;
      }
      if (k === 'trailer-edit-toggle') {
        sdEditTrailer = !sdEditTrailer; render(true);
        if (sdEditTrailer) { const ta = el.querySelector('#sdEditTrailerArea'); if (ta) ta.focus(); }
        return;
      }
      if (k === 'trailer-cancel') { sdEditTrailer = false; render(true); return; }
      if (k === 'trailer-save' && sc) {
        const ta = el.querySelector('#sdEditTrailerArea');
        if (ta) {
          if (window.AppHistory) window.AppHistory.checkpoint('トレーラー・キャッチコピーを編集');
          sc.trailer = ta.value;
        }
        sc.detailEdited = true;
        if (typeof currentScenarioId !== 'undefined' && String(currentScenarioId) === String(sc.id) && !window.__editingScenario) {
          const topTr = document.getElementById('topTrailer');
          if (topTr) { topTr.value = sc.trailer; if (typeof renderPreview === 'function') renderPreview(); }
        }
        sdEditTrailer = false; saveState(); render(true); renderDBView();
        toast('✅ トレーラー・キャッチコピーを保存しました');
        return;
      }
      if (k === 'trailer-clear' && sc) {
        if (window.AppHistory) window.AppHistory.checkpoint('トレーラー・キャッチコピーをクリア');
        sc.trailer = '';
        sc.detailEdited = true;
        if (typeof currentScenarioId !== 'undefined' && String(currentScenarioId) === String(sc.id) && !window.__editingScenario) {
          const topTr = document.getElementById('topTrailer');
          if (topTr) { topTr.value = ''; if (typeof renderPreview === 'function') renderPreview(); }
        }
        sdEditTrailer = false; saveState(); render(true); renderDBView();
        toast('🧹 トレーラー・キャッチコピーをクリアしました');
        return;
      }
      if (k === 'synopsis-edit-toggle') {
        sdEditSynopsis = !sdEditSynopsis; render(true);
        if (sdEditSynopsis) { const ta = el.querySelector('#sdEditSynopsisArea'); if (ta) ta.focus(); }
        return;
      }
      if (k === 'synopsis-cancel') { sdEditSynopsis = false; render(true); return; }
      if (k === 'synopsis-save' && sc) {
        const hInp = el.querySelector('#sdEditSynopsisHeading');
        const ta = el.querySelector('#sdEditSynopsisArea');
        const nextHeading = (hInp && hInp.value.trim()) ? hInp.value.trim() : 'あらすじ';
        const nextVal = ta ? ta.value : '';
        if (window.AppHistory) window.AppHistory.checkpoint('あらすじを編集');
        const { blocks, synopsisBlock } = classifyScenarioPublicBlocks(sc);
        if (synopsisBlock) {
          synopsisBlock.keyName = nextHeading;
          synopsisBlock.label = nextHeading;
          synopsisBlock.val = nextVal;
        } else {
          const sumIdx = blocks.findIndex(x => x && x.type === 'summary_container');
          const newBlk = { id: 'intro', type: 'textarea', label: nextHeading, keyName: nextHeading, val: nextVal, sectionType: 'standalone', collapsed: true, isCustom: true, decorStyle: 'default' };
          if (sumIdx >= 0) blocks.splice(sumIdx + 1, 0, newBlk);
          else blocks.unshift(newBlk);
        }
        if ('synopsis' in sc) sc.synopsis = nextVal;
        sc.detailEdited = true;
        syncScenarioBlocksAndPublic(sc);
        sdEditSynopsis = false; saveState(); render(true); renderDBView();
        toast('✅ あらすじを保存しました');
        return;
      }
      if (k === 'synopsis-clear' && sc) {
        if (window.AppHistory) window.AppHistory.checkpoint('あらすじをクリア');
        const { synopsisBlock } = classifyScenarioPublicBlocks(sc);
        if (synopsisBlock) {
          synopsisBlock.val = '';
          if (Array.isArray(synopsisBlock.subItems)) synopsisBlock.subItems = [];
        }
        if ('synopsis' in sc) sc.synopsis = '';
        sc.detailEdited = true;
        syncScenarioBlocksAndPublic(sc);
        sdEditSynopsis = false; saveState(); render(true); renderDBView();
        toast('🧹 あらすじをクリアしました');
        return;
      }
      if (k === 'freetext-edit-toggle') {
        sdEditFreeText = !sdEditFreeText; render(true);
        if (sdEditFreeText) { const ta = el.querySelector('#sdEditFreeTextArea'); if (ta) ta.focus(); }
        return;
      }
      if (k === 'freetext-cancel') { sdEditFreeText = false; render(true); return; }
      if (k === 'freetext-save' && sc) {
        const ta = el.querySelector('#sdEditFreeTextArea');
        if (window.AppHistory) window.AppHistory.checkpoint('概要自由記述を編集');
        const { summaryBlock } = classifyScenarioPublicBlocks(sc);
        if (summaryBlock && ta) summaryBlock.freeText = ta.value;
        sc.detailEdited = true;
        syncScenarioBlocksAndPublic(sc);
        sdEditFreeText = false; saveState(); render(true); renderDBView();
        toast('✅ 概要枠・自由記述を保存しました');
        return;
      }
      if (k === 'pubblock-add' && sc) {
        if (!isCreate && window.AppHistory) window.AppHistory.checkpoint('公開ブロックを追加');
        const blocks = ensureDetailBlocksSynced(sc);
        const bid = 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5);
        blocks.push({ id: bid, type: 'textarea', label: '自由項目', keyName: '自由項目', val: '', sectionType: 'standalone', collapsed: true, isCustom: true, decorStyle: 'default' });
        sdOpenSecs.add('other');
        syncScenarioBlocksAndPublic(sc);
        if (isCreate) {
          render(true);
          const inp = el.querySelector(`[data-sd-draft-block-key="${CSS.escape(bid)}"]`);
          if (inp) { inp.focus(); if (inp.select) inp.select(); }
        } else {
          sdEditBlockId = bid;
          sc.detailEdited = true;
          saveState(); render(true);
          const inp = el.querySelector('#sdEditPubBlockKey');
          if (inp) { inp.focus(); if (inp.select) inp.select(); }
        }
        return;
      }
      if (k === 'pubblock-edit') {
        const bid = String(b.dataset.bid || '');
        sdEditBlockId = (sdEditBlockId === bid) ? '' : bid;
        render(true);
        if (sdEditBlockId) { const ta = el.querySelector('#sdEditPubBlockVal'); if (ta) ta.focus(); }
        return;
      }
      if (k === 'pubblock-cancel') { sdEditBlockId = ''; render(true); return; }
      if (k === 'pubblock-save' && sc) {
        const bid = String(b.dataset.bid || '');
        const kInp = el.querySelector('#sdEditPubBlockKey');
        const vInp = el.querySelector('#sdEditPubBlockVal');
        const blocks = ensureDetailBlocksSynced(sc);
        const blk = blocks.find(x => x && String(x.id) === bid);
        if (blk) {
          if (window.AppHistory) window.AppHistory.checkpoint('公開ブロックを編集');
          const nextK = (kInp && kInp.value.trim()) ? kInp.value.trim() : '自由項目';
          blk.keyName = nextK;
          blk.label = nextK;
          if (vInp) blk.val = vInp.value;
          sc.detailEdited = true;
          syncScenarioBlocksAndPublic(sc);
          saveState(); renderDBView();
          toast('✅ 公開ブロックを保存しました');
        }
        sdEditBlockId = ''; render(true);
        return;
      }
      if (k === 'pubblock-del' && sc) {
        const bid = String(b.dataset.bid || '');
        const blocks = ensureDetailBlocksSynced(sc);
        const blk = blocks.find(x => x && String(x.id) === bid);
        if (!blk) return;
        const hTitle = blockHeadingOf(blk) || '自由項目';
        if (!isCreate && !(await appConfirm(`公開ブロック「${hTitle}」を削除しますか？`, { okText: '削除', danger: true }))) return;
        if (!isCreate && window.AppHistory) window.AppHistory.checkpoint('公開ブロックを削除');
        sc.fullBlockData = blocks.filter(x => x && String(x.id) !== bid);
        if (sdEditBlockId === bid) sdEditBlockId = '';
        syncScenarioBlocksAndPublic(sc);
        if (!isCreate) {
          sc.detailEdited = true;
          saveState(); renderDBView();
          toast('🗑️ 公開ブロックを削除しました');
        }
        render(true);
        return;
      }
      if (k === 'ho-open-all' && sc) {
        (sc.secretHOs || []).forEach((_, idx) => sdOpenHOs.add(idx));
        render(true); return;
      }
      if (k === 'ho-close-all') {
        sdOpenHOs.clear(); sdEditHoIdx = -1;
        render(true); return;
      }
      if (k === 'ho-edit') {
        e.preventDefault(); e.stopPropagation();
        const hi = Number(b.dataset.hoIdx);
        if (Number.isNaN(hi)) return;
        if (sdEditHoIdx === hi) {
          sdEditHoIdx = -1;
        } else {
          sdEditHoIdx = hi;
          sdOpenHOs.add(hi);
        }
        render(true);
        if (sdEditHoIdx >= 0) { const ta = el.querySelector(`#sdEditHoBody_${sdEditHoIdx}`); if (ta) ta.focus(); }
        return;
      }
      if (k === 'ho-cancel') { sdEditHoIdx = -1; render(true); return; }
      if (k === 'ho-save' && sc) {
        const hi = Number(b.dataset.hoIdx);
        const ho = sc.secretHOs && sc.secretHOs[hi];
        if (ho) {
          if (window.AppHistory) window.AppHistory.checkpoint('秘匿HOを編集');
          const nmInp = el.querySelector(`#sdEditHoName_${hi}`);
          const bdInp = el.querySelector(`#sdEditHoBody_${hi}`);
          if (nmInp && nmInp.value.trim()) ho.name = nmInp.value.trim();
          if (bdInp) {
            if (Array.isArray(ho.blocks) && ho.blocks.length) {
              const firstTxtBlk = ho.blocks.find(hb => hb && hb.type !== 'image');
              if (firstTxtBlk) {
                if ('val' in firstTxtBlk || !('text' in firstTxtBlk)) firstTxtBlk.val = bdInp.value;
                if ('text' in firstTxtBlk) firstTxtBlk.text = bdInp.value;
              } else {
                ho.blocks.unshift({ id: 'ho_blk_' + Date.now(), type: 'textarea', keyName: ho.name || `HO${hi + 1}`, val: bdInp.value, text: bdInp.value, decorStyle: 'default' });
              }
            } else {
              ho.text = bdInp.value;
              ho.blocks = [{ id: 'ho_blk_' + Date.now(), type: 'textarea', keyName: ho.name || `HO${hi + 1}`, val: bdInp.value, text: bdInp.value, decorStyle: 'default' }];
            }
          }
          sc.detailEdited = true;
          syncScenarioBlocksAndPublic(sc);
          saveState(); renderDBView();
          toast('✅ 秘匿HOを保存しました');
        }
        sdEditHoIdx = -1; render(true);
        return;
      }
      if (k === 'notes-edit-toggle') { sdEditNotes = !sdEditNotes; render(true); return; }
      if (k === 'notes-cancel') { sdEditNotes = false; render(true); return; }
      if (k === 'notes-save' && sc) {
        const su = el.querySelector('#sdEditShopUrl'), na = el.querySelector('#sdEditNotesArea');
        if (su) sc.shopUrl = su.value.trim();
        if (na) sc.notes = na.value;
        syncScenarioBlocksAndPublic(sc);
        sdEditNotes = false; saveState(); render(true); renderDBView();
        toast('✅ メモ・URLを保存しました');
        return;
      }
      if (isCreate) return;
      if (k === 'pdf') { if (hasCcf()) { const sid = String(sdId), p = b.dataset.path; closeDetail(); await CCF.activateProject(sid); await CCF.openPdfPath(p); } return; }
      if (k === 'room-open') {
        const sid = b.dataset.sid, rid = b.dataset.rid;
        closeDetail();
        if (hasCcf() && CCF.activateProject) CCF.activateProject(sid, rid);
        return;
      }
      if (k === 'room-add') {
        const sid = b.dataset.sid;
        const name = await appPrompt('新しい部屋データの名前を入力してください', '新しい部屋', { title: '🏠 新規部屋の作成', okText: '作成' });
        if (name && name.trim()) {
          const container = CCF.getRoomContainer(sid);
          container.rooms.push({
            id: window.CCFModel.newId(),
            name: name.trim(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            project: window.CCFModel.sanitizeProject(null)
          });
          CCF.saveRoomContainer(sid, container);
          render(true);
        }
        return;
      }
      if (k === 'room-rename') {
        const sid = b.dataset.sid, rid = b.dataset.rid;
        const container = CCF.getRoomContainer(sid);
        const rm = container.rooms.find(x => x.id === rid);
        if (rm) {
          const name = await appPrompt('部屋データの新しい名前を入力してください', rm.name, { title: '✏️ 部屋名の変更', okText: '変更' });
          if (name && name.trim()) {
            rm.name = name.trim();
            rm.updatedAt = Date.now();
            CCF.saveRoomContainer(sid, container);
            render(true);
          }
        }
        return;
      }
      if (k === 'room-dup') {
        const sid = b.dataset.sid, rid = b.dataset.rid;
        if (CCF.openDuplicateRoomDialog) {
          CCF.openDuplicateRoomDialog(sid, rid);
          setTimeout(() => render(true), 500);
        }
        return;
      }
      if (k === 'room-del') {
        const sid = b.dataset.sid, rid = b.dataset.rid;
        const container = CCF.getRoomContainer(sid);
        if (container.rooms.length <= 1) return toast('⚠️ 部屋データは最低1つ必要です');
        const rm = container.rooms.find(x => x.id === rid);
        if (rm && await appConfirm(`部屋データ「${rm.name}」を削除しますか？`, { okText: '削除', danger: true })) {
          container.rooms = container.rooms.filter(x => x.id !== rid);
          if (container.activeRoomId === rid) container.activeRoomId = container.rooms[0].id;
          CCF.saveRoomContainer(sid, container);
          render(true);
        }
        return;
      }
      const id2 = sdId;
      if (k === 'edit') { closeDetail(); goEditScenario(id2); }
      else if (k === 'ccf') {
        if (!window.CCF || !CCF.activateProject) return toast('ココフォリア準備画面を開けませんでした');
        closeDetail();
        CCF.activateProject(String(id2));
      }
      else if (k === 'assets' || k === 'gallery') {
        if (window.CCF && CCF.assets && typeof CCF.assets.openModal === 'function') {
          return CCF.assets.openModal(String(id2), 'scenario');
        }
        return toast('登録素材モーダルを開けませんでした');
      }
      else if (k === 'history') {
        openScenarioHistoryTagModal(id2);
      }
    });
  }

  window.openScenarioDetail = async function (id) {
    const targetSc = scOf(id);
    if (!targetSc) return; closeDetail(); sdDraft = null; sdTagPickerOpen = false; sdId = id; sdPeek = false; sdSelSlot = 0; sdEditNotes = false; sdEditTrailer = false; sdEditSynopsis = false; sdEditFreeText = false; sdEditBlockId = ''; sdEditHoIdx = -1; sdOpenHOs = new Set(); sdOpenSecs = new Set(); sdSpecSortMode = false; sdSpecAddOpen = false; sdDragSpecKey = '';
    sdEl = document.createElement('div'); sdEl.className = 'sd-overlay'; sdEl.setAttribute('role', 'dialog'); sdEl.setAttribute('aria-modal', 'true');
    sdEl.innerHTML = `<div class="sd-modal" tabindex="-1"><div class="sd-head"><h2></h2><button type="button" class="btn btn-secondary" data-sd="close" aria-label="閉じる">✕ 閉じる</button></div><div class="sd-body"></div>
      <div class="sd-actions"><button type="button" class="sd-btn" data-sd="edit">📝 Discord投稿・編集画面で開く</button><button type="button" class="sd-btn" data-sd="ccf">🎲 セッション準備で開く</button><button type="button" class="sd-btn" data-sd="assets">🗗 登録素材・ギャラリー整理</button><button type="button" class="sd-btn" data-sd="history">📜 投稿履歴・タグ管理</button></div></div>`;
    document.body.appendChild(sdEl); render(false); document.addEventListener('keydown', onKey, true);
    if (window.CloudSync && typeof CloudSync.ensureScenarioAssetsCached === 'function') {
      void CloudSync.ensureScenarioAssetsCached(String(id), { showProgress: false });
    }
    wireDetailModalEvents(sdEl, { createMode: false });
    if (typeof window.ensureScenarioCloudBlobs === 'function' && (
      (targetSc.docTexts && !Array.isArray(targetSc.docTexts) && targetSc.docTexts.__cloudBlob) ||
      (targetSc.ccfRooms && !Array.isArray(targetSc.ccfRooms) && targetSc.ccfRooms.__cloudBlob)
    )) {
      try {
        const hydrated = await window.ensureScenarioCloudBlobs(targetSc);
        if (hydrated && sdEl && String(sdId) === String(id)) render(true);
      } catch (_) {}
    }
  };

  window.openNewScenarioDetailModal = function () {
    closeDetail();
    sdId = null;
    sdDraft = {
      id: '__draft__',
      title: '',
      author: '',
      system: '',
      shopUrl: '',
      playerCount: '',
      playTime: '',
      reqSkills: '',
      recSkills: '',
      semiRecSkills: '',
      lostRate: '',
      aftereffect: '',
      imageUrl: '',
      hoverImages: [],
      thumbPosX: 50,
      thumbPosY: 50,
      thumbZoom: 100,
      thumbFit: 'cover',
      spoilerBlur: false,
      playStatus: '',
      favorite: false,
      trailer: '',
      synopsis: '',
      notes: '',
      tags: [],
      autoTags: [],
      customSpecs: [],
      specOrder: [],
      postedChannels: [],
      postedInfo: {},
      imageCategories: (typeof DEFAULT_SCENARIO_CATS !== 'undefined' ? [...DEFAULT_SCENARIO_CATS] : []),
      images: [],
      docs: []
    };
    ensureDetailBlocksSynced(sdDraft);
    sdTagPickerOpen = false;
    sdPeek = false;
    sdThumbOpen = false;
    sdSelSlot = 0;
    sdEditNotes = false;
    sdEditTrailer = false;
    sdEditSynopsis = false;
    sdEditFreeText = false;
    sdEditBlockId = '';
    sdEditHoIdx = -1;
    sdOpenHOs = new Set();
    sdOpenSecs = new Set();
    sdSpecSortMode = false;
    sdSpecAddOpen = false;
    sdDragSpecKey = '';
    sdEl = document.createElement('div');
    sdEl.className = 'sd-overlay';
    sdEl.setAttribute('role', 'dialog');
    sdEl.setAttribute('aria-modal', 'true');
    sdEl.innerHTML = `<div class="sd-modal sd-modal-create" tabindex="-1"><div class="sd-head"><h2></h2><button type="button" class="btn btn-secondary" data-sd="draft-cancel" aria-label="閉じる">✕ 閉じる</button></div><div class="sd-body"></div>
      <div class="sd-actions sd-actions-create"><button type="button" class="sd-btn" data-sd="draft-cancel">キャンセル</button><button type="button" class="sd-btn sd-btn-register" data-sd="draft-register">💾 データベースに登録</button></div></div>`;
    document.body.appendChild(sdEl);
    render(false);
    document.addEventListener('keydown', onKey, true);
    wireDetailModalEvents(sdEl, { createMode: true });
    const titleInp = sdEl.querySelector('.sd-title-input');
    if (titleInp) titleInp.focus();
  };
  /** ドロップされたパスを、このシナリオの素材として登録（画像→シナリオ登録素材／PDF・BGM・ZIP→絶対パス参照。フォルダは中身を振り分け） */
  async function addMaterials(id, paths) {
    const sc = scOf(id); if (!sc) return;
    const D = window.CCF && CCF.dnd, refs = [], docs = [], imgsToAdd = []; let skipped = 0, capped = false;
    const isDocName = n => /\.(pdf|txt|html?|md|docx?)$/i.test(String(n || ''));
    sc.imageCategories = sanitizeCats(sc.imageCategories, DEFAULT_SCENARIO_CATS); if (!Array.isArray(sc.images)) sc.images = [];
    for (const p of paths) {
      let st; try { st = fs.statSync(p); } catch (e) { skipped++; continue; }
      const nm = path.basename(p);
      if (st.isDirectory()) {
        if (!D) { skipped++; continue; }
        D.scanFolder(p).items.forEach(it => {
          if (it.type === 'image') imgsToAdd.push(it);
          else if (isDocName(it.name)) docs.push({ name: it.name, path: it.path, category: it.category || '資料', mtime: it.mtime || 0 });
          else refs.push({ type: it.type, name: it.name, path: it.path, category: it.category, mtime: it.mtime || 0 });
        });
      } else {
        const t = D ? D.typeOf(nm) : (/\.(png|jpe?g|gif|webp|bmp)$/i.test(nm) ? 'image' : '');
        const M = window.CCFModel;
        let mtime = 0; try { mtime = fs.statSync(p).mtimeMs || 0; } catch (_) { }
        const infCat = M ? M.inferSmartCategory(nm, path.basename(path.dirname(p))) : '';
        if (t === 'image') imgsToAdd.push({ name: nm, path: p, category: infCat, mtime });
        else if (isDocName(nm)) docs.push({ name: nm, path: p, category: infCat || '資料', mtime });
        else if (t === 'zip') refs.push({ type: 'zip', name: nm, path: p, category: path.basename(nm, path.extname(nm)), mtime });
        else if (t === 'audio') refs.push({ type: t, name: nm, path: p, category: infCat, mtime });
        else skipped++;
      }
    }
    if (imgsToAdd.length > 300) { imgsToAdd.length = 300; capped = true; }
    let nImg = 0, nDoc = 0;
    const isUncls = c => !c || c === '未分類' || c === '(未分類)';
    if (window.AppHistory && (imgsToAdd.length || refs.length || docs.length)) window.AppHistory.checkpoint('素材を追加');
    for (const it of imgsToAdd) {
      try {
        const nc = normCat(it.category);
        const cat = nc ? (addCategory(sc.imageCategories, nc) || nc) : '';
        const dataUrl = await dataUrlFromPath(it.path, it.name);
        const dupIdx = (sc.images || []).findIndex(x => x && ((x.origName || x.name || '').toLowerCase() === it.name.toLowerCase()));
        if (dupIdx >= 0) {
          const old = sc.images[dupIdx];
          const betterCat = (isUncls(old.category) && !isUncls(cat)) ? cat : (old.category || cat || '');
          if (!old.mtime || (it.mtime && it.mtime >= old.mtime)) {
            sc.images[dupIdx] = Object.assign({}, old, { dataUrl, mtime: it.mtime || Date.now(), category: betterCat });
          } else if (betterCat !== old.category) {
            sc.images[dupIdx] = Object.assign({}, old, { category: betterCat });
          }
        } else {
          sc.images.push({ id: galId(), name: it.name, origName: it.name, dataUrl, category: cat, mtime: it.mtime || 0, addedAt: Date.now() });
        }
        nImg++;
      } catch (e) { logSoft('sdImg', e); skipped++; }
    }
    if (docs.length) {
      if (D && typeof D.upsertScenarioDocs === 'function') nDoc = D.upsertScenarioDocs(sc, docs);
      else if (window.CCF && CCF.assets && typeof CCF.assets.addDocsToScenario === 'function') nDoc = CCF.assets.addDocsToScenario(sc, docs);
      if (window.CCF && CCF.assets && typeof CCF.assets.cleanupScenarioAssets === 'function') CCF.assets.cleanupScenarioAssets(String(sc.id));
    }
    if (refs.length) { if (hasCcf()) CCF.withProject(String(sc.id), proj => CCFModel.addRefs(proj, refs)); else skipped += refs.length; }
    const totalOther = refs.length + nDoc;
    if (nImg || totalOther) {
      sc.detailEdited = true;
      if (typeof window.syncScenarioAssetCatalog === 'function') window.syncScenarioAssetCatalog(sc, { authoritative: true });
      if (window.CloudSync && typeof CloudSync.scheduleAutoWebSync === 'function') CloudSync.scheduleAutoWebSync(sc.id);
      saveState(); try { renderGalleryAll(); } catch (e) { logSoft('sdGal', e); } try { if (CCF.library && CCF.S.ready) CCF.library.render(); } catch (e) { logSoft('sdLib', e); } try { if (CCF.assets && CCF.assets.refreshModal) CCF.assets.refreshModal(); } catch (e) { logSoft('sdAm', e); } try { renderDBView(); } catch (e) { logSoft('sdDb', e); }
    }
    toast(nImg || totalOther ? `✅ 素材を追加しました（画像 ${nImg}／資料・BGM・ZIP ${totalOther}）${capped ? '（画像は300枚まで）' : ''}${skipped ? '／対象外 ' + skipped : ''}` : '追加できるファイルがありませんでした（フォルダ・ZIP・PDF・BGM・画像に対応）');
    if (sdEl && sdId === id) render(true);
  }
})();
