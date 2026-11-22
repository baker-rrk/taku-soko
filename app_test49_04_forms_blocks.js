/* app_test49_04_forms_blocks.js — モーダル・入力フォーム・ブロック編集・プレビュー
 * 読み込み順は 01→07（HTMLの<script>の並び）。全ファイルが同じグローバルスコープを共有します。
 * 各ファイルは、前のファイルで定義された関数・変数を使えます。 */
  function openPostStatusDialog(scId) {
    const sc = appState.scenarios.find(s => s.id === scId); if (!sc) return;
    normalizePosted(sc);
    const posted = new Set(sc.postedChannels), tags = new Set(sc.tags || []);
    const chItems = appState.channels.map(c => [c.id, c.name]);
    sc.postedChannels.forEach(id => { if (!chById(id)) chItems.push([id, `${postedLabel(sc, id)}（削除済み）`]); });
    const tagNames = []; appState.channels.forEach(c => (c.tags || []).forEach(t => { if (t.name && !tagNames.includes(t.name)) tagNames.push(t.name); }));
    (sc.tags || []).forEach(n => { if (!tagNames.includes(n)) tagNames.push(n); });
    const ov = document.createElement('div'); ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const box = document.createElement('div'); box.className = 'app-dialog'; box.style.maxHeight = '85vh'; box.style.overflowY = 'auto'; ov.appendChild(box);
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const btn = (cls, text, fn) => { const b = mk('button', 'app-dialog-btn ' + cls, text); b.type = 'button'; b.onclick = fn; return b; };
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    const chips = (label, items, set) => {
      const l = mk('div', 'app-dialog-msg', label); l.style.marginTop = '12px'; box.appendChild(l);
      const wrap = mk('div', 'tag-chips'); box.appendChild(wrap);
      if (!items.length) wrap.appendChild(mk('span', '', '（なし）'));
      items.forEach(([key, text]) => {
        const c = mk('div', 'chip' + (set.has(key) ? ' selected' : ''), text); c.tabIndex = 0; c.setAttribute('role', 'checkbox'); c.setAttribute('aria-checked', set.has(key));
        c.onclick = () => { if (set.has(key)) set.delete(key); else set.add(key); c.classList.toggle('selected', set.has(key)); }; wrap.appendChild(c);
      });
    };
    const render = () => {
      box.textContent = ''; box.appendChild(mk('div', 'app-dialog-title', `投稿状態を変更：${sc.title}`));
      chips('投稿済みにするチャンネル（選択中＝投稿済み）', chItems, posted);
      const bulk = mk('div', 'app-dialog-actions'); bulk.style.justifyContent = 'flex-start'; bulk.style.marginTop = '8px';
      bulk.append(btn('', 'すべて未投稿', () => { posted.clear(); render(); }), btn('', 'すべて投稿済み', () => { chItems.forEach(([k]) => posted.add(k)); render(); })); box.appendChild(bulk);
      const tl = mk('div', 'app-dialog-msg', 'このシナリオに保存するタグ名'); tl.style.marginTop = '12px'; box.appendChild(tl);
      const tpWrap = mk('div', 'tag-picker-dialog'); box.appendChild(tpWrap);
      buildTagPicker(tpWrap, tags, null, tagNames);
      const act = mk('div', 'app-dialog-actions');
      act.append(btn('', 'キャンセル', close), btn('primary', '保存', () => {
        const tagList = [...tags];
        chItems.forEach(([id]) => {
          const was = sc.postedChannels.includes(id), now = posted.has(id);
          if (now && !was) { const c = chById(id); setPosted(sc, id, true, tagList.filter(n => c && (c.tags || []).some(t => t.name === n))); }
          else if (!now && was) setPosted(sc, id, false);
        });
        sc.tags = tagList; close(); saveState(); renderDBView(); populateScenarioDBSelect(); checkDuplicateStatus(); if (typeof updateEditScenarioBanner === 'function') updateEditScenarioBanner(); toast('✅ 投稿状態を更新しました');
      })); box.appendChild(act);
    };
    render(); document.body.appendChild(ov); document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    const first = box.querySelector('.chip'); if (first) first.focus();
  }

  // シナリオ追加/編集フォームの項目（フォームのID接頭辞 e / m ＋ キー名 ⇔ シナリオのプロパティ）
  const SCENARIO_FIELDS = { Title: 'title', System: 'system', ShopUrl: 'shopUrl', PlayerCount: 'playerCount', PlayTime: 'playTime', ReqSkills: 'reqSkills', RecSkills: 'recSkills', SemiRecSkills: 'semiRecSkills', LostRate: 'lostRate', Aftereffect: 'aftereffect', ImageUrl: 'imageUrl', Trailer: 'trailer', Notes: 'notes' };
  const DROP_DEFAULT = '📷 画像ファイルをここにドロップ または クリックして選択';
  function fillScenarioForm(p, sc) { Object.entries(SCENARIO_FIELDS).forEach(([k, f]) => { const el = document.getElementById(p + k); if (el) el.value = (sc && sc[f]) || ''; }); }
  function readScenarioForm(p) { const o = {}; Object.entries(SCENARIO_FIELDS).forEach(([k, f]) => { const el = document.getElementById(p + k), v = el ? el.value : ''; o[f] = (f === 'shopUrl' || f === 'imageUrl') ? v.trim() : v; }); return o; }
  async function setScenarioImage(p, f) { if (!f || !f.type.startsWith('image/')) return; const iu = document.getElementById(p + 'ImageUrl'), dt = document.getElementById(p + 'DropText'); if (iu) iu.value = await compressImage(f); if (dt) dt.innerText = `📁 ${f.name}`; }
  function showModal(id) { const m = document.getElementById(id); if (!m) return; delete m.dataset.dirty; m.style.display = 'flex'; }

  function openEditScenarioModal(idx) {
    const sc = appState.scenarios[idx];
    if (!sc) return;
    if (typeof openScenarioDetail === 'function') { openScenarioDetail(sc.id); return; }
    if (typeof openScenarioWindow === 'function') { openScenarioWindow(sc.id, 'edit'); return; }
  }
  function closeEditScenarioModal() {
    if (typeof closeScenarioWindow === 'function' && typeof swIdx !== 'undefined' && swIdx >= 0) { closeScenarioWindow(); return; }
    const m = document.getElementById('editScenarioModal'); if (m) m.style.display = 'none';
  }
  function clearEditScenarioImage() { const iu = document.getElementById('eImageUrl'), dt = document.getElementById('eDropText'); if (iu) iu.value = ""; if (dt) dt.innerText = DROP_DEFAULT; }
  function handleEditScenarioSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (typeof saveScenarioWindow === 'function' && typeof swIdx !== 'undefined' && swIdx >= 0) { saveScenarioWindow(); return; }
    const ei = document.getElementById('editIndex'); if (!ei || ei.value === "") return; const idx = ei.value;
    if (!appState.scenarios[idx]) return;
    appState.scenarios[idx] = { ...appState.scenarios[idx], ...readScenarioForm('e') };
    applyFlatToBlocks(appState.scenarios[idx]);
    if (typeof syncDerivedTagsFromFields === 'function') syncDerivedTagsFromFields(appState.scenarios[idx]);
    saveState(); renderDBView(); populateScenarioDBSelect(); closeEditScenarioModal(); toast("✅ シナリオ情報を更新しました！");
  }
  function openAddScenarioModal() { fillScenarioForm('m', null); const dt = document.getElementById('mDropText'); if (dt) dt.innerText = DROP_DEFAULT; showModal('addScenarioModal'); }
  function closeAddScenarioModal() { const m = document.getElementById('addScenarioModal'); if (m) m.style.display = 'none'; }
  function handleManualAddScenario(e) {
    e.preventDefault();
    { const ns = { id: uid(), ...readScenarioForm('m'), postedChannels: [], postedInfo: {}, tags: [], imageCategories: [...DEFAULT_SCENARIO_CATS] }; applyFlatToBlocks(ns); if (typeof syncDerivedTagsFromFields === 'function') syncDerivedTagsFromFields(ns); appState.scenarios.push(ns); }
    saveState(); populateScenarioDBSelect(); renderDBView(); closeAddScenarioModal(); toast("新規シナリオをデータベースに追加しました！");
  }
  async function handleEditImageDrop(e) { if (e && e.preventDefault) e.preventDefault(); if (e && e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('dragover'); if (e && e.dataTransfer && e.dataTransfer.files) await setScenarioImage('e', e.dataTransfer.files[0]); }
  async function handleEditImageSelect(e) { if (e && e.target && e.target.files) await setScenarioImage('e', e.target.files[0]); }
  async function handleManualImageDrop(e) { e.preventDefault(); e.currentTarget.classList.remove('dragover'); await setScenarioImage('m', e.dataTransfer.files[0]); }
  async function handleManualImageSelect(e) { await setScenarioImage('m', e.target.files[0]); }

  async function handleBotAvatarDrop(e) { e.preventDefault(); e.currentTarget.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) { await setBotAvatar(f); } }
  async function handleBotAvatarSelect(e) { const f = e.target.files[0]; if (f) { await setBotAvatar(f); } }
  async function setBotAvatar(file) {
    const dataUrl = await compressImage(file, 256, 256, 0.9);
    appState.botAvatarData = dataUrl;
    document.getElementById('botAvatarDropText').style.display = 'none';
    const pv = document.getElementById('botAvatarPreview');
    pv.src = dataUrl; pv.style.display = 'inline-block';
    document.getElementById('botAvatarClearBtn').style.display = 'inline-block';
    saveState(); renderPreview();
  }
  function clearBotAvatar() {
    appState.botAvatarData = "";
    document.getElementById('botAvatarDropText').style.display = 'inline-block';
    const pv = document.getElementById('botAvatarPreview');
    pv.src = ""; pv.style.display = 'none';
    document.getElementById('botAvatarClearBtn').style.display = 'none';
    saveState(); renderPreview();
  }
  function loadBotAvatarToUI() {
    if (appState.botAvatarData) {
      document.getElementById('botAvatarDropText').style.display = 'none';
      const pv = document.getElementById('botAvatarPreview');
      pv.src = appState.botAvatarData; pv.style.display = 'inline-block';
      document.getElementById('botAvatarClearBtn').style.display = 'inline-block';
    }
  }

  function addSplitBlock() { blockOrder.push({ id: '__SPLIT_' + Date.now(), type: 'split', label: '✂️ --- 投稿分割ポイント (ここから2通目のメッセージ) ---', sectionType: 'split', collapsed: false, isCustom: true }); renderBlockUI(); renderPreview(); }
  function addImageBlock() { blockOrder.push({ id: 'img_' + Date.now(), type: 'image', label: '画像添付 (ドロップ または URL入力)', file: null, previewUrl: '', sectionType: 'image', collapsed: false, isCustom: true }); renderBlockUI(); renderPreview(); }
  function addCustomBlock() { blockOrder.push({ id: 'custom_' + Date.now(), type: 'textarea', label: '自由セクション', keyName: '自由項目', val: '', sectionType: 'standalone', collapsed: false, isCustom: true, decorStyle: 'default' }); renderBlockUI(); renderPreview(); }
  function autoSplitBlocks() {   // 各通が1900文字以内になるよう、項目ブロックの境目に分割ポイントを自動挿入（手動の分割は尊重）
    const LIMIT = 1900, orig = blockOrder, out = []; let has = false, n = 0;
    try {
      for (const b of orig) {
        if (b.type === 'split') { out.push(b); has = false; continue; }
        blockOrder = [...out, b];
        const chunks = buildPostData(), last = chunks[chunks.length - 1];
        if (has && finalText(last).length > LIMIT) { out.push({ id: '__SPLIT_' + Date.now() + '_' + n, type: 'split', label: '✂️ --- 投稿分割ポイント (ここから次のメッセージ) ---', sectionType: 'split', collapsed: false, isCustom: true }); n++; has = false; }
        out.push(b); if (b.type !== 'image') has = true;
      }
    } finally { blockOrder = orig; }
    if (!n) return toast('自動分割は不要です（すべて' + LIMIT + '文字以内です）');
    blockOrder = out; renderBlockUI(); renderPreview(); toast(`✅ 分割ポイントを${n}か所追加しました。内容を確認してください`);
  }
  function toggleAllBlocks(col) { blockOrder.forEach(b => b.collapsed = col); renderBlockUI(); }

  function updateChannelTagSummary() {
    const el = document.getElementById('channelTagAccSummary');
    if (!el) return;
    const chCount = (typeof selectedChannelCols !== 'undefined' && selectedChannelCols)
      ? [...selectedChannelCols].filter(id => typeof chById !== 'function' || !!chById(id)).length
      : 0;
    const tagCount = (typeof activeTagNames !== 'undefined' && activeTagNames) ? activeTagNames.size : 0;
    const parts = [];
    if (chCount > 0) parts.push(`${chCount}チャンネル選択中`);
    if (tagCount > 0) parts.push(`タグ ${tagCount}個`);
    el.textContent = parts.length ? `（${parts.join(' ／ ')}）` : '（未選択）';
    el.classList.toggle('is-empty', parts.length === 0);
  }
  window.updateChannelTagSummary = updateChannelTagSummary;

  const POST_ACC_CARD_META = {
    channelTagCard: { headerId: 'channelTagAccHeader', caretId: 'channelTagAccCaret' },
    basicInfoCard: { headerId: 'basicInfoAccHeader', caretId: 'basicInfoAccCaret' }
  };

  function togglePostAccCard(cardId, forceOpen) {
    const card = document.getElementById(cardId);
    const meta = POST_ACC_CARD_META[cardId];
    if (!card || !meta) return;
    const header = document.getElementById(meta.headerId);
    const caret = document.getElementById(meta.caretId);
    const curCollapsed = card.classList.contains('is-collapsed');
    const nextCollapsed = forceOpen !== undefined ? !forceOpen : !curCollapsed;
    card.classList.toggle('is-collapsed', nextCollapsed);
    if (caret) caret.textContent = nextCollapsed ? '▶' : '▼';
    if (header) header.setAttribute('aria-expanded', String(!nextCollapsed));
  }
  window.togglePostAccCard = togglePostAccCard;

  function wirePostCardAccordions() {
    Object.entries(POST_ACC_CARD_META).forEach(([cardId, meta]) => {
      const header = document.getElementById(meta.headerId);
      if (!header || header.dataset.postAccWired) return;
      header.dataset.postAccWired = '1';
      header.addEventListener('click', e => {
        if (e.target.closest && e.target.closest('.post-acc-action, button, a, input, select, textarea, label')) return;
        togglePostAccCard(cardId);
      });
      header.addEventListener('keydown', e => {
        if (e.target !== header) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          togglePostAccCard(cardId);
        }
      });
    });
    const titleEl = document.getElementById('title');
    if (titleEl && !titleEl.dataset.postAccInvalidWired) {
      titleEl.dataset.postAccInvalidWired = '1';
      titleEl.addEventListener('invalid', () => togglePostAccCard('basicInfoCard', true));
    }
  }
  window.wirePostCardAccordions = wirePostCardAccordions;

  function renderChannelCheckboxes() {
    const container = document.getElementById('channelCheckboxContainer'); container.innerHTML = "";
    const valid = new Set(); selectedChannelCols.forEach(id => { if (chById(id)) valid.add(id); }); selectedChannelCols = valid;
    appState.channels.forEach((ch, idx) => {
      const chip = document.createElement('div'); chip.className = "chip"; chip.innerText = ch.name; chip.tabIndex = 0; chip.setAttribute('role', 'checkbox'); chip.setAttribute('aria-checked', selectedChannelCols.has(ch.id));
      if (selectedChannelCols.has(ch.id)) chip.classList.add('selected');
      chip.onclick = () => { if (selectedChannelCols.has(ch.id)) { selectedChannelCols.delete(ch.id); chip.classList.remove('selected'); } else { selectedChannelCols.add(ch.id); chip.classList.add('selected'); } updateTagCheckboxes(); checkDuplicateStatus(); renderPreview(); };
      container.appendChild(chip);
    });
    updateChannelTagSummary();
  }

  function reDeriveTagsForForm() {   // 「🔄 スペック・本文からタグを再自動判定」：人数・システム欄・本文から自動タグを付け直す
    const trailerEl = document.getElementById('topTrailer');
    const bodyText = [trailerEl ? trailerEl.value : '', ...blockOrder.map(b => b.type === 'summary_container' ? (b.freeText || '') : (b.val || ''))].join('\n');
    let sysText = getSumValFromBlock('システム'), pplText = getSumValFromBlock('人数');
    if (!sysText.trim() && bodyText) {
      const mSys = bodyText.match(/(?:システム|使用ルール|ルールブック)\s*[：:]\s*([^\n]+)/);
      if (mSys) sysText = mSys[1];
      else if (/クトゥルフ|CoC/i.test(bodyText)) sysText = bodyText;
    }
    if (!pplText.trim() && bodyText) {
      const mPpl = bodyText.match(/(?:人数|プレイ人数|PL人数)\s*[：:]\s*([^\n]+)/);
      if (mPpl) pplText = mPpl[1];
    }
    const tmp = { system: sysText, playerCount: pplText, tags: [...activeTagNames], autoTags: [] };
    const cur = currentScenarioId ? appState.scenarios.find(s => s.id === currentScenarioId) : null;
    if (cur && Array.isArray(cur.autoTags)) tmp.autoTags = cur.autoTags.slice();
    syncDerivedTagsFromFields(tmp, true);
    if ((typeof secretHOs !== 'undefined' && secretHOs.length > 0) || /秘匿\s*HO|秘匿ハンドアウト/i.test(bodyText)) {
      if (!tmp.tags.includes('秘匿HO')) tmp.tags.push('秘匿HO');
    }
    activeTagNames = new Set(tmp.tags); updateTagCheckboxes(); renderPreview();
    toast(tmp.autoTags.length ? '🔄 自動タグを更新しました：' + tmp.autoTags.join(' / ') : '🔄 人数・システムから判定できるタグはありませんでした');
  }

  function addCustomTagFromInput() {
    const inp = document.getElementById('newCustomTagInput');
    if (!inp) return;
    const rawName = String(inp.value || '').trim().replace(/^#+/, '').trim();
    if (!rawName) { inp.focus(); return toast('追加するタグ名を入力してください'); }
    const name = (typeof addTagPreset === 'function') ? addTagPreset(rawName) : rawName;
    if (!name) return;
    if (!Array.isArray(appState.customTags)) appState.customTags = [];
    if (!appState.customTags.includes(name)) appState.customTags.push(name);
    activeTagNames.add(name);
    inp.value = '';
    updateTagCheckboxes();
    if (typeof renderBaseTagManager === 'function') renderBaseTagManager();
    if (typeof renderSidebarTags === 'function') renderSidebarTags();
    renderPreview();
    if (typeof saveState === 'function') saveState(true);
    toast(`✅ タグ「${name}」を追加して選択しました`);
  }
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('#addCustomTagBtn')) addCustomTagFromInput();
  });
  document.addEventListener('keydown', e => {
    if (e.target && e.target.id === 'newCustomTagInput' && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      addCustomTagFromInput();
    }
  });

  function buildTagPicker(container, selectedSet, onChange, extraNames) {
    if (!container) return;
    container.innerHTML = "";
    const presets = Array.isArray(appState.tagPresets) ? appState.tagPresets : (Array.isArray(DEFAULT_TAG_PRESETS) ? DEFAULT_TAG_PRESETS : []);
    const groupDefs = (typeof TAG_GROUP_DEFS !== 'undefined') ? TAG_GROUP_DEFS : [['sys', '🎲 システム'], ['ppl', '👥 人数'], ['etc', '🏷️ 傾向・その他']];
    const grpOf = (typeof tagGroupOf === 'function') ? tagGroupOf : (() => 'etc');
    const keyOf = (typeof tagKey === 'function') ? tagKey : (s => String(s || '').trim().toLowerCase());
    const sysSet = (typeof rawSystemKeys === 'function') ? rawSystemKeys() : new Set();
    if (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) {
      appState.scenarios.forEach(sc => (sc.autoSystemTags || []).forEach(t => { if (t) { sysSet.add(t); sysSet.add(keyOf(t)); } }));
    }
    const allTags = [];
    const seen = new Set();
    const pushTag = t => {
      const s = String(t || '').trim();
      const k = keyOf(s);
      if (s && k && !seen.has(k)) { seen.add(k); allTags.push(s); }
    };
    presets.forEach(pushTag);
    (appState.channels || []).forEach(ch => (ch.tags || []).forEach(t => pushTag(t && t.name)));
    (Array.isArray(appState.customTags) ? appState.customTags : []).forEach(pushTag);
    if (Array.isArray(extraNames)) extraNames.forEach(pushTag);
    if (selectedSet) selectedSet.forEach(pushTag);

    const grouped = { sys: [], ppl: [], etc: [] };
    allTags.forEach(t => grouped[grpOf(t, sysSet)].push(t));
    if (typeof tagSortNum === 'function') grouped.ppl.sort(tagSortNum);
    else {
      const pplRank = t => t === 'ソロ' ? 0 : t === 'タイマン' ? 1 : 1 + (parseInt(t, 10) || 99);
      grouped.ppl.sort((a, b) => pplRank(a) - pplRank(b));
    }

    groupDefs.forEach(([gKey, gLabel]) => {
      const list = grouped[gKey];
      if (!list || !list.length) return;
      const grpEl = document.createElement('div');
      grpEl.className = 'tag-picker-group';
      const lbl = document.createElement('div');
      lbl.className = 'tag-picker-label';
      lbl.textContent = gLabel;
      const chipsWrap = document.createElement('div');
      chipsWrap.className = 'tag-chips';
      list.forEach(name => {
        const chip = document.createElement('div');
        const k = keyOf(name);
        const matchedSel = selectedSet ? ([...selectedSet].find(x => keyOf(x) === k)) : null;
        const isSel = !!matchedSel;
        chip.className = 'chip' + (isSel ? ' selected' : '');
        chip.textContent = name;
        chip.tabIndex = 0;
        chip.setAttribute('role', 'checkbox');
        chip.setAttribute('aria-checked', String(isSel));
        const toggle = () => {
          if (!selectedSet) return;
          const curMatch = [...selectedSet].find(x => keyOf(x) === k);
          if (curMatch !== undefined) { selectedSet.delete(curMatch); chip.classList.remove('selected'); chip.setAttribute('aria-checked', 'false'); }
          else { selectedSet.add(name); chip.classList.add('selected'); chip.setAttribute('aria-checked', 'true'); }
          if (typeof onChange === 'function') onChange();
        };
        chip.onclick = toggle;
        chip.onkeydown = ev => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggle(); } };
        chipsWrap.appendChild(chip);
      });
      grpEl.appendChild(lbl);
      grpEl.appendChild(chipsWrap);
      container.appendChild(grpEl);
    });
  }

  function updateTagCheckboxes() {
    const container = document.getElementById('tagContainer');
    if (!container) return;
    buildTagPicker(container, activeTagNames, () => {
      updateChannelTagSummary();
      renderPreview();
    });
    updateChannelTagSummary();
  }

  function populateScenarioDBSelect() {
    const sel = document.getElementById('dbScenarioSelect'), cur = sel.value;   // 選択中の項目は、並べ直しても保つ
    sel.innerHTML = '<option value="">-- 保存済みシナリオを選択して自動入力 --</option>';
    const firstLn = (sc, f) => (typeof getScenarioSpecFirstLine === 'function') ? getScenarioSpecFirstLine(sc, f) : String((sc && sc[f]) || '').split(/\r?\n/)[0].trim();
    const label = s => `${(s.favorite ? '★ ' : '')}${s.title} (${firstLn(s, 'system') || '未指定'} / ${firstLn(s, 'playerCount') || '未指定'})`;
    const favs = appState.scenarios.filter(s => s.favorite), rest = appState.scenarios.filter(s => !s.favorite);
    const group = (title, list) => { if (!list.length) return; const g = document.createElement('optgroup'); g.label = title; list.forEach(s => g.appendChild(new Option(label(s), s.id))); sel.appendChild(g); };
    if (favs.length) { group(`★ お気に入り（${favs.length}）`, favs); group('その他のシナリオ', rest); }   // お気に入りを先頭にまとめる
    else rest.forEach(s => sel.appendChild(new Option(label(s), s.id)));
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  }

  function loadScenarioFromDB(idx) {
    if (idx === "") return; const _k = String(idx); let _i = appState.scenarios.findIndex(s => s.id === _k); if (_i < 0 && /^\d+$/.test(_k)) _i = Number(_k); const sc = appState.scenarios[_i]; if (!sc) return; ensureScenarioBlocks(sc); currentScenarioId = sc.id || null; setHOs(sc.secretHOs || []); setTimeout(() => requestRefsIn(blockOrder), 0); 
    document.getElementById('title').value = sc.title || "";
    document.getElementById('topShopUrl').value = sc.shopUrl || "";
    document.getElementById('topTrailer').value = sc.trailer || "";
    if (document.getElementById('topTrailerDecor')) {
      document.getElementById('topTrailerDecor').value = sc.trailerDecor || 'default';
    }
    
    blockOrder = sanitizeBlocks(JSON.parse(JSON.stringify(ensureScenarioBlocks(sc))));   // 旧データ用の分岐は不要（ensureScenarioBlocks が先にブロックを用意する）
    blockOrder = blockOrder.filter(b => b.id !== 'shopUrl' && b.id !== 'trailer');
    if (!blockOrder.length) blockOrder = createDefaultBlocks();
    blockOrder.forEach(b => { if (!b.decorStyle) b.decorStyle = 'default'; });
    activeTagNames = new Set(Array.isArray(sc.tags) ? sc.tags : []);
    { const ar = document.getElementById('autoReplyText'); if (ar) ar.value = sc.autoReply || ''; const ni = document.getElementById('noImageMode'); if (ni) ni.checked = false; }   // シナリオに保存したタグを復元
    updateTagCheckboxes(); renderBlockUI(); checkDuplicateStatus(); renderPreview();
    if (typeof updateEditScenarioBanner === 'function') updateEditScenarioBanner();
    if (typeof refreshPostDocList === 'function') refreshPostDocList({ autoOpen: true });
  }

  function getBlockVal(id) { const item = blockOrder.find(b => b.id === id); return item ? item.val : ""; }

  async function resolveSaveOpts(title) {   // 戻り値: {} = 今の判断どおり／{forceNew:true} = 必ず新規
    const cur = currentScenarioId ? appState.scenarios.find(s => s.id === currentScenarioId) : null;
    const byId = !!cur && titlesSame(cur.title, title);   // 直前のシナリオと完全に同じタイトルなら、そのシナリオを更新
    if (!byId && appState.scenarios.some(s => titlesSame(s.title, title))) {   // 別のシナリオに同名がある（完全一致）ときだけ確認
      const ow = await appConfirm(`「${title}」という同名のシナリオが既にDBにあります。\n既存のシナリオを上書きしますか？\n「別に保存」を選ぶと新しいシナリオとして追加します。`, { okText: '上書きする', cancelText: '別に保存', strict: true });
      if (!ow) return { forceNew: true };
    }
    return {};
  }
  async function saveCurrentToDB() {
    const t = document.getElementById('title').value; if (!t) return toast("シナリオタイトルを入力してください");
    autoSyncToDBOnPost(t, [], await resolveSaveOpts(t)); toast(`「${t}」をデータベースに保存/更新しました！`);
  }

  async function resetInputs() {   // 入力中の「投稿内容」だけをクリア（ブロックの並び・構成、チャンネル選択、各種モードは変えない）
    if (!(await appConfirm('入力中の投稿内容（本文・画像・タグ・選択中のシナリオ）をクリアしますか？\nブロックの並び順やチャンネルの選択はそのままです。', { okText: 'クリア', danger: true }))) return;
    currentScenarioId = null;
    ['title', 'autoReplyText', 'topShopUrl', 'topTrailer'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const sel = document.getElementById('dbScenarioSelect'); if (sel) sel.value = '';
    blockOrder.forEach(b => {
      if (b.type === 'summary_container') { (b.items || []).forEach(it => { it.val = ''; }); b.freeText = ''; }
      else if (b.type === 'image') { b.file = null; b.previewUrl = ''; }
      else if (b.type !== 'split') b.val = '';
    });
    setHOs([]); activeTagNames.clear(); updateTagCheckboxes(); renderBlockUI(); checkDuplicateStatus(); renderPreview();
    if (typeof updateEditScenarioBanner === 'function') updateEditScenarioBanner();
    if (typeof refreshPostDocList === 'function') refreshPostDocList({ clear: true });
  }
  async function resetForm() {
    if (!(await appConfirm('入力中のフォームをクリアしますか？', { okText: 'クリア', danger: true }))) return; currentScenarioId = null; setHOs([]);
    document.getElementById('title').value = ""; document.getElementById('autoReplyText').value = ""; document.getElementById('dbScenarioSelect').value = "";
    document.getElementById('topShopUrl').value = ""; document.getElementById('topTrailer').value = "";
    if (document.getElementById('topTrailerDecor')) document.getElementById('topTrailerDecor').value = "default";
    document.getElementById('verticalImageMode').checked = true; document.getElementById('noImageMode').checked = false;
    blockOrder = createDefaultBlocks();
    selectedChannelCols.clear(); activeTagNames.clear(); renderChannelCheckboxes(); updateTagCheckboxes(); renderBlockUI(); checkDuplicateStatus(); renderPreview();
    if (typeof updateEditScenarioBanner === 'function') updateEditScenarioBanner();
    if (typeof refreshPostDocList === 'function') refreshPostDocList({ clear: true });
  }

  function checkDuplicateStatus() {
    if (typeof updateEditScenarioBanner === 'function') updateEditScenarioBanner();
    const t = document.getElementById('title').value, w = document.getElementById('duplicateWarning');
    if (!t || selectedChannelCols.size === 0) return w.style.display = "none";
    const sc = findScenario(t), ids = selectedChannelIds();
    w.style.display = (sc && sc.postedChannels && ids.some(id => sc.postedChannels.includes(id))) ? "block" : "none";
  }

  function getDecorSelectHtml(idx, decorStyle) {
    return `<select style="background:var(--dc-bg-primary); border:1px solid var(--dc-border); color:var(--dc-text-normal); padding:4px; font-size:0.8rem; border-radius:3px; outline:none;" data-bc="decor" data-bid="${idx}">${decorOptionsHtml(decorStyle)}</select>`;
  }

  function subItemsHtml(b) {   // 公開情報側：共通のサブ項目UI（subItemsEditorHtml）に、公開情報用の操作属性を渡す
    return subItemsEditorHtml(b.subItems, (k, i) => k === 'add' ? `data-ba="sub-add" data-bid="${b.id}"` : k === 'del' ? `data-ba="sub-del" data-bid="${b.id}" data-i="${i}"` : `data-bi="sub-${k}" data-bid="${b.id}" data-i="${i}"`);
  }
  function renderBlockUI() {
    blockOrder = blockOrder.filter(b => b && typeof b === 'object'); blockOrder.forEach(b => sanitizeBlock(b)); tagSummaryFields(blockOrder);
    blockOrder.forEach(b => { b.id = String(b.id || '').replace(/[^\w-]/g, '_') || ('b_' + uid()); });
    { const seen = new Set(); blockOrder.forEach(b => { while (seen.has(b.id)) b.id += '_' + Math.random().toString(36).slice(2, 5); seen.add(b.id); }); }   // IDは必ず一意に   // 取り込んだデータのIDがHTML属性を壊さないように
    const container = document.getElementById('sortableBlockContainer'); container.innerHTML = "";
    blockOrder.forEach((b, idx) => {
      const item = document.createElement('div');
      item.className = `sortable-item ${b.type==='split'?'split-item':''} ${b.type==='image'?'image-item':''}${b.type==='summary_container'?'summary-block':''}`;
      if (b.type === 'split') {
        item.innerHTML = `<div class="sortable-header" style="background:transparent;"><strong style="color:var(--dc-yellow);">${escapeHTML(b.label)}</strong><div class="sort-controls"><button type="button" class="btn-sort" data-ba="up" data-bid="${b.id}" aria-label="上へ移動" title="上へ移動">▲</button><button type="button" class="btn-sort" data-ba="down" data-bid="${b.id}" aria-label="下へ移動" title="下へ移動">▼</button><button type="button" class="btn-sort btn-danger" data-ba="del" data-bid="${b.id}">✕ 削除</button></div></div>`;
      } 
      else if (b.type === 'summary_container') {
        const isCollapsed = b.collapsed !== false; const hasVal = b.items.some(i => i.val && i.val.trim()) || (b.freeText && b.freeText.trim());
        item.innerHTML = `
          <div class="sortable-header" data-ba="toggle" data-bid="${b.id}">
            <div class="sortable-title">
              <span>${isCollapsed ? '▶' : '▼'}</span><span class="type-badge summary">📦 概要まとめ</span>${hasVal ? `<span class="type-badge has-val">🟢 入力あり</span>` : ''}
              <span style="display:inline-flex; align-items:center; gap:4px; background:rgba(255,255,255,0.05); padding:4px; border-radius:4px; border:1px solid rgba(255,255,255,0.1); margin-left:12px;">
                <input type="text" value="${escapeHTML(b.keyName)}" placeholder="項目名(空欄可)" title="空欄にすると見出しをつけません" style="padding:4px 6px; font-weight:bold; width:130px; background:var(--dc-bg-primary); border:1px solid var(--dc-border); color:var(--dc-text-normal); font-size:0.8rem;" data-bi="key" data-bid="${b.id}">
                ${getDecorSelectHtml(b.id, b.decorStyle)}
              </span>
            </div>
            <div class="sort-controls"><button type="button" class="btn-sort" data-ba="up" data-bid="${b.id}" aria-label="上へ移動" title="上へ移動">▲</button><button type="button" class="btn-sort" data-ba="down" data-bid="${b.id}" aria-label="下へ移動" title="下へ移動">▼</button></div>
          </div>
          <div class="block-body ${isCollapsed ? 'collapsed' : ''}">
            <div id="summaryItemsContainer">${b.items.map((it, itemIdx) => `
              <div style="display:flex; gap:8px; margin-bottom:8px; align-items:flex-start;">
                <input type="text" value="${escapeHTML(it.keyName)}" placeholder="項目名(空欄可)" title="空欄にすると見出しをつけません" style="width:120px; font-weight:bold; margin-top:2px;" data-bi="item-key" data-bid="${b.id}" data-i="${itemIdx}">
                <textarea placeholder="内容" class="short-input" style="flex:1; padding:8px; line-height:1.4;" data-bi="item-val" data-bid="${b.id}" data-i="${itemIdx}">${escapeHTML(it.val)}</textarea>
                <button type="button" class="btn-sort btn-danger" style="margin-top:2px;" data-ba="item-del" data-bid="${b.id}" data-i="${itemIdx}">✕</button>
              </div>`).join('')}
            </div>
            <button type="button" class="btn btn-secondary" style="margin-bottom:12px;" data-ba="item-add" data-bid="${b.id}">＋ 概要項目を追加</button>
            <div style="border-top:1px dashed var(--dc-border); padding-top:10px;">
              <label style="font-size:0.75rem;">📝 自由記述 (項目名なしでそのまま概要枠内に挿入 ※他の項目と1行間が開きます)</label>
              <textarea placeholder="補足やキャッチコピーなどを自由に入力..." data-bi="free" data-bid="${b.id}">${escapeHTML(b.freeText || '')}</textarea>
            </div>
          </div>`;
      }
      else if (b.type === 'image') {
        const isCollapsed = b.collapsed !== false; const hasVal = b.file || (b.previewUrl && b.previewUrl.trim());
        item.innerHTML = `
          <div class="sortable-header" data-ba="toggle" data-bid="${b.id}">
            <div class="sortable-title">
              <span>${isCollapsed ? '▶' : '▼'}</span><span class="type-badge image">🖼️ 画像添付</span>${hasVal ? `<span class="type-badge has-val">🟢 画像あり</span>` : ''}<strong>${escapeHTML(b.label)}</strong>
            </div>
            <div class="sort-controls"><button type="button" class="btn-sort" data-ba="up" data-bid="${b.id}" aria-label="上へ移動" title="上へ移動">▲</button><button type="button" class="btn-sort" data-ba="down" data-bid="${b.id}" aria-label="下へ移動" title="下へ移動">▼</button>${b.isCustom ? `<button type="button" class="btn-sort btn-danger" data-ba="del" data-bid="${b.id}">✕ 削除</button>` : ''}</div>
          </div>
          <div class="block-body ${isCollapsed ? 'collapsed' : ''}">
            <div style="margin-bottom:6px;"><button type="button" class="btn-sort" data-ba="gallery" data-bid="${b.id}">選ぶ</button></div>
            <div class="drop-zone" data-ba="pick" data-bid="${b.id}">
              <span>${b.file ? `📁 ${escapeHTML(b.file.name)}` : '📷 画像ファイルをここにドラッグ＆ドロップ (複数可)<br>またはクリックして選択'}</span>
              <input type="file" id="fileInput_${b.id}" accept="image/*" multiple style="display:none;" data-bc="file" data-bid="${b.id}">
              ${b.previewUrl ? `<br><img ${imgAttr(b.previewUrl)} class="image-preview-thumb">` : ''}
            </div>
            <div style="margin-top:10px;"><label style="font-size:0.75rem;">🔗 または 画像URLを直接入力</label><input type="url" value="${b.previewUrl && !b.file && /^https?:\/\//i.test(b.previewUrl) ? escapeHTML(b.previewUrl) : ''}" placeholder="https://..." style="padding:6px; font-size:0.85rem;" data-bi="img-url" data-bid="${b.id}"></div>
            ${b.file || b.previewUrl ? `<button type="button" class="btn btn-secondary btn-danger" style="margin-top:8px;" data-ba="img-clear" data-bid="${b.id}">🗑️ 画像を解除</button>` : ''}
          </div>`;
      }
      else {
        const isCollapsed = b.collapsed !== false; const hasVal = b.val && b.val.trim() !== '';
        let badge = b.sectionType === 'standalone' ? `<span class="type-badge standalone">📑 独立</span>` : `<span class="type-badge header">🔗 基本情報</span>`;
        let valBadge = hasVal ? `<span class="type-badge has-val">🟢 入力あり</span>` : '';
        let inp = b.type === 'textarea' ? `<div class="fmt-toolbar"><button type="button" class="fmt-btn" data-ba="fmt" data-fb="**" data-fa="**" data-bid="${b.id}"><b>B</b> 太字</button><button type="button" class="fmt-btn" data-ba="fmt" data-fb="||" data-fa="||" data-bid="${b.id}">👁️ スポイラー</button><button type="button" class="fmt-btn" data-ba="fmt" data-fb="&gt; " data-fa="" data-bid="${b.id}">💬 引用</button></div><textarea id="${b.id}" data-bi="val" data-bid="${b.id}">${escapeHTML(b.val)}</textarea>` : `<input type="${b.type}" id="${b.id}" value="${escapeHTML(b.val)}" data-bi="val" data-bid="${b.id}" placeholder="${escapeHTML(b.label)}">`;
        if (b.type === 'textarea') inp += subItemsHtml(b);
        item.innerHTML = `
          <div class="sortable-header" data-ba="toggle" data-bid="${b.id}">
            <div class="sortable-title">
              <span>${isCollapsed ? '▶' : '▼'}</span>${badge}${valBadge}
              <span style="display:inline-flex; align-items:center; gap:4px; background:rgba(255,255,255,0.05); padding:4px; border-radius:4px; border:1px solid rgba(255,255,255,0.1); margin-left:12px;">
                <input type="text" value="${escapeHTML(b.keyName)}" placeholder="項目名(空欄可)" title="空欄にすると見出しをつけません" style="padding:4px 6px; font-weight:bold; width:130px; background:var(--dc-bg-primary); border:1px solid var(--dc-border); color:var(--dc-text-normal); font-size:0.8rem;" data-bi="key" data-bid="${b.id}">
                ${getDecorSelectHtml(b.id, b.decorStyle)}
              </span>
            </div>
            <div class="sort-controls"><button type="button" class="btn-sort" data-ba="up" data-bid="${b.id}" aria-label="上へ移動" title="上へ移動">▲</button><button type="button" class="btn-sort" data-ba="down" data-bid="${b.id}" aria-label="下へ移動" title="下へ移動">▼</button>${b.isCustom ? `<button type="button" class="btn-sort btn-danger" data-ba="del" data-bid="${b.id}">✕ 削除</button>` : ''}</div>
          </div>
          <div class="block-body ${isCollapsed ? 'collapsed' : ''}">${inp}</div>`;
      }
      container.appendChild(item);
    });
    enhanceSortable(container);
  }

  // ブロックはIDで特定する：クリック時点の並び順(インデックス)をその都度引くので、並び替え・削除・非同期処理の後でもずれない
  const blockIdx = id => blockOrder.findIndex(b => b.id === id);
  function addSummaryItem(i) { blockOrder[i].items.push({ keyName: '新規項目', val: '' }); renderBlockUI(); renderPreview(); }
  function deleteSummaryItem(bi, ii) { blockOrder[bi].items.splice(ii, 1); renderBlockUI(); renderPreview(); }
  const dz = e => (e.target.closest && e.target.closest('[data-ba="pick"]')) || e.currentTarget;   // 委譲されたイベントでも、対象のドロップゾーンを取る
  function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); dz(e).classList.add('dragover'); }
  function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); dz(e).classList.remove('dragover'); }
  function handleContainerDragOver(e) { if (dragFrom !== null) return; e.preventDefault(); e.currentTarget.classList.add('sortable-container-drop-active'); }
  function handleContainerDragLeave(e) { e.currentTarget.classList.remove('sortable-container-drop-active'); }
  function handleContainerDrop(e) { if (dragFrom !== null) return; if (e.target.closest && e.target.closest('[data-ba="pick"]')) return;   // 画像ブロック上のドロップは、その画像ブロック側で処理済み
    e.preventDefault(); e.currentTarget.classList.remove('sortable-container-drop-active'); if (e.dataTransfer.files) processMultipleImageFiles(e.dataTransfer.files, -1); }

  async function processMultipleImageFiles(files, tIdx = -1) {
    const tId = (tIdx >= 0 && blockOrder[tIdx]) ? blockOrder[tIdx].id : null;   // 対象ブロックはIDで保持
    if (!files || files.length === 0) return; const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/')); if (imageFiles.length === 0) return;
    for (let i = 0; i < imageFiles.length; i++) {
      const url = await compressImage(imageFiles[i], 1280, 1280, 0.8);
      const tb = tId ? blockOrder.find(x => x.id === tId) : null;
      if (i === 0 && tb && tb.type === 'image') { tb.file = imageFiles[i]; tb.previewUrl = url; }
      else blockOrder.push({ id: 'img_' + Date.now() + i, type: 'image', label: '画像添付', file: imageFiles[i], previewUrl: url, sectionType: 'image', collapsed: false, isCustom: true });
    }
    renderBlockUI(); renderPreview();
  }
  function handleFileDrop(e, idx) { e.preventDefault(); e.stopPropagation(); dz(e).classList.remove('dragover'); if (e.dataTransfer.files) processMultipleImageFiles(e.dataTransfer.files, idx); }
  function handleFileSelect(e, idx) { if (e.target.files) processMultipleImageFiles(e.target.files, idx); }
  function handleImageUrlInput(idx, url) { blockOrder[idx].file = null; blockOrder[idx].previewUrl = url.trim(); renderPreview(); }
  function clearImageFile(idx) { revokeFileUrl(blockOrder[idx].file); blockOrder[idx].file = null; blockOrder[idx].previewUrl = ''; renderBlockUI(); renderPreview(); }
  function toggleBlockCollapse(idx) { blockOrder[idx].collapsed = !blockOrder[idx].collapsed; renderBlockUI(); }
  function updateBlockValue(idx, val) { blockOrder[idx].val = val; renderPreview(); }
  function moveBlock(idx, dir) { if (!moveItem(blockOrder, idx, dir)) return; renderBlockUI(); renderPreview(); }
  function deleteCustomBlock(idx) { revokeFileUrl(blockOrder[idx] && blockOrder[idx].file); blockOrder.splice(idx, 1); renderBlockUI(); renderPreview(); }
  function insertFmt(id, b, a = '') { const el = document.getElementById(id); if (!el) return; fmtSelection(el, b, a); const idx = blockOrder.findIndex(x => x.id === id); if (idx !== -1) blockOrder[idx].val = el.value; renderPreview(); }

  // 項目ブロック1つ分の出力：見出し → 本文（装飾スタイルに沿う）→ サブ項目（サブタイトル行は引用の外／通常文字か太字、本文は引用）
  // ----- 装飾（見出し・本文の各行）。組み込みの5種類と、設定で作った自分のフォーマットを、ここで一括して扱う -----
  const customFormat = style => ((typeof appState !== 'undefined' && appState.formats) || []).find(f => f.id === style) || null;
  function decorHead(t, style, cfg) {
    if (!t) return '';
    const cf = customFormat(style); if (cf) return cf.headPre + t + cf.headPost;
    return style === 'simple' ? cfg.simpleH1 + t : style === 'fancy' ? cfg.fancyH1 + t + cfg.fancyH1 : cfg.h1 + t;
  }
  function decorBody(lines, style, cfg) {
    const padOf = p => (typeof buildSummaryLabelIndent === 'function' ? buildSummaryLabelIndent(p) : '\u3000');
    const isCont = l => /^[\u3000]{2,}/.test(l);
    const cf = customFormat(style);
    if (cf) {
      const pfx = cf.linePre || '';
      const isQ = /^>\s*$/.test(pfx);
      const s = lines.map(l => l ? ((!isQ && isCont(l) ? padOf(pfx) : pfx) + l) : (pfx.trim() ? pfx + '\u200B' : '')).join('\n');
      return cf.wrap === 'code' ? '```\n' + s + '\n```' : s;
    }
    if (style === 'codeblock') return '```\n' + lines.join('\n') + '\n```';
    if (style === 'simple') return lines.map(l => l ? ((isCont(l) ? padOf(cfg.simpleList) : cfg.simpleList) + l) : cfg.simpleList).join('\n');
    if (style === 'fancy') return lines.map(l => l ? ((isCont(l) ? padOf(cfg.fancyList) : cfg.fancyList) + l) : cfg.fancyList).join('\n');
    if (style === 'none') return lines.join('\n');
    return lines.map(l => l ? cfg.quote + l : cfg.quote + '\u200B').join('\n');   // 空行は見えない文字を入れて引用を途切れさせない
  }
  function formatItemSection(title, val, subs, style, cfg) {
    const t = (title || '').trim(); style = style || 'default';
    const mainLines = (val && val.trim()) ? val.split('\n') : [];
    const subList = (subs || []).filter(s => (s.title && s.title.trim()) || (s.val && s.val.trim()));
    if (!mainLines.length && !subList.length) return '';
    const body = lines => decorBody(lines, style, cfg), head = decorHead(t, style, cfg);
    const parts = [];
    if (mainLines.length) parts.push(body(mainLines));
    subList.forEach(s => { const st = (s.title || '').trim(), line = st ? (s.style === 'bold' ? `**${st}**` : st) : '', sb = (s.val && s.val.trim()) ? body(s.val.split('\n')) : ''; parts.push([line, sb].filter(Boolean).join('\n')); });
    return (head ? head + '\n' : '') + parts.join('\n\n');
  }
  function buildPostData() {
    const noImage = document.getElementById('noImageMode')?.checked;
    const cfg = appState.formatConfig || defaultFormatConfig;

    let chunks = [{ textParts: [], images: [] }];
    let chunkIdx = 0;

    let topTextParts = [];
    const topShopUrl = document.getElementById('topShopUrl').value;
    if (topShopUrl.trim()) {
      topTextParts.push(`:link: ${topShopUrl}`);
    }

    const topTrailer = document.getElementById('topTrailer').value;
    if (topTrailer.trim()) {
      let trailerLines = topTrailer.split('\n');
      let style = document.getElementById('topTrailerDecor') ? document.getElementById('topTrailerDecor').value : 'default';
      let sec = "";
      if (style === 'codeblock') {
        sec = `\`\`\`\n${trailerLines.join('\n')}\n\`\`\``;
      } else if (style === 'simple') {
        sec = trailerLines.map(l => l ? `${cfg.simpleList}${l}` : `${cfg.simpleList}`).join('\n');
      } else if (style === 'fancy') {
        sec = trailerLines.map(l => l ? `${cfg.fancyList}${l}` : `${cfg.fancyList}`).join('\n');
      } else if (style === 'none') {
        sec = trailerLines.join('\n');
      } else {
        sec = trailerLines.map(l => l ? `${cfg.quote}${l}` : `${cfg.quote}\u200B`).join('\n'); // 空行は見えない文字(ゼロ幅スペース)を入れて引用を途切れさせない
      }
      topTextParts.push(sec);
    }
    
    if (topTextParts.length > 0) {
      chunks[0].textParts.push(topTextParts.join('\n\n\n'));
    }

    blockOrder.forEach(b => {
      if (b.type === 'split') {
        chunkIdx++; chunks[chunkIdx] = { textParts: [], images: [] }; return;
      }
      
      let blockTitle = ((b.keyName !== undefined && b.keyName !== null) ? b.keyName : (b.label || '')).trim();
      const hasTitle = blockTitle !== '';   // 空欄なら見出し記号をつけない
      let contentLines = [];

      if (b.type === 'summary_container') {
        b.items.forEach(it => {
          if (it.val && it.val.trim()) {
            const key = (it.keyName || '').trim();
            const labelPrefix = key ? `${cfg.subPre}${key}${cfg.subPost}` : '';
            const itemLines = (typeof formatSummaryMultilineLines === 'function')
              ? formatSummaryMultilineLines(labelPrefix, it.val)
              : (() => {
                  const lines = String(it.val).split(/\r?\n/);
                  let hw = 0;
                  for (const ch of labelPrefix) hw += /^[\x20-\x7e\uff61-\uff9f]$/.test(ch) ? 1 : 2;
                  const indent = '\u3000'.repeat(Math.floor(hw / 2)) + (hw % 2 ? ' ' : '');
                  return lines.map((l, i) => i === 0 ? (labelPrefix + l) : (l.replace(/^[ \u3000\t]+/, '') ? indent + l.replace(/^[ \u3000\t]+/, '') : ''));
                })();
            itemLines.forEach(l => contentLines.push(l));
          }
        });
        if (b.freeText && b.freeText.trim()) {
          if (contentLines.length > 0) contentLines.push("");
          b.freeText.split(/\r?\n/).forEach(l => contentLines.push(l));
        }
      } else if (b.type === 'image') {
        if (!noImage && (b.file || (b.previewUrl && b.previewUrl.trim()))) {
          chunks[chunkIdx].images.push({ file: b.file, url: b.previewUrl });
        }
        return; 
      } else {
        const sec2 = formatItemSection(blockTitle, b.val, b.subItems, b.decorStyle, cfg); if (sec2) chunks[chunkIdx].textParts.push(sec2); return;
      }

      if (contentLines.length > 0) {
        const style = b.decorStyle || 'default';
        const sec = (hasTitle ? decorHead(blockTitle, style, cfg) + '\n' : '') + decorBody(contentLines, style, cfg);
        chunks[chunkIdx].textParts.push(sec);
      }
    });

    return chunks.map(c => ({ text: c.textParts.join('\n\n\n').trim(), images: c.images }));
  }

  let _rp = null;
  function renderPreview() { scheduleDraftSave(); if (_rp) return; _rp = requestAnimationFrame(() => { _rp = null; renderPreviewNow(); }); }
  function renderPreviewNow() {
    const title = document.getElementById('title').value || "スレッドタイトル";
    const botName = document.getElementById('botName').value || "概要投稿Bot";
    const botAvatarSrc = appState.botAvatarData || "https://cdn.discordapp.com/embed/avatars/0.png";

    document.getElementById('pvThreadTitle').innerText = title; 
    document.getElementById('pvUsername').innerText = botName;
    document.getElementById('pvAvatar').src = botAvatarSrc; 
    document.getElementById('pvUsernameReply').innerText = botName;
    document.getElementById('pvAvatarReply').src = botAvatarSrc;

    const pvTags = document.getElementById('pvTags'); pvTags.innerHTML = "";
    activeTagNames.forEach(tn => { const s = document.createElement('span'); s.className = "discord-tag"; s.innerText = tn; pvTags.appendChild(s); });

    const container = document.getElementById('pvContent'); container.innerHTML = "";
    const postChunks = buildPostData();
    let counterTexts = [];
    let isWarning = false;

    postChunks.forEach((chunk, index) => {
      let len = finalText(chunk).length;
      counterTexts.push(`${index + 1}通目: 約 ${len} 文字`);
      if (len > 1900) isWarning = true;

      if (index > 0) { const d = document.createElement('div'); d.className = "split-divider"; d.innerHTML = `<span>✂️ ここから ${index + 1} 通目のメッセージ</span>`; container.appendChild(d); }
      const p = document.createElement('div'); 
      
      // ▼ FIX: プレビュー上のみ :link: を絵文字として表示する
      p.innerHTML = mdToHtml(chunk.text);
      
      chunk.images.forEach(img => {
        const iEl = document.createElement('img'); iEl.className = "pv-img";
        if (img.url) iEl.src = imgSrc(img.url); else if (img.file) iEl.src = fileUrl(img.file);
        p.appendChild(iEl);
      });
      container.appendChild(p);
    });

    const replyText = document.getElementById('autoReplyText').value; const replySec = document.getElementById('pvReplySection');
    if (replyText.trim()) { replySec.style.display = "block"; document.getElementById('pvReplyContent').innerText = replyText; } else replySec.style.display = "none";
    
    const counter = document.getElementById('charCounter'); 
    counter.innerText = `文字数推定: ${counterTexts.join(' / ')} (※Discord制限目安: 1投稿2000字)`; 
    counter.className = isWarning ? "char-counter warning" : "char-counter";
  }

  function saveFormatConfig() {
    ['h1','subPre','subPost','simpleH1','simpleList','fancyH1','fancyList'].forEach(k => {
      appState.formatConfig[k] = document.getElementById('cfg' + k.charAt(0).toUpperCase() + k.slice(1)).value;
    });
    appState.formatConfig.quote = defaultFormatConfig.quote; // 固定（設定画面からは編集不可）
    saveState();
  }
  function loadFormatConfigToUI() {
    const c = appState.formatConfig || {};
    ['h1','subPre','subPost','simpleH1','simpleList','fancyH1','fancyList'].forEach(k => {
      document.getElementById('cfg' + k.charAt(0).toUpperCase() + k.slice(1)).value = c[k] !== undefined ? c[k] : defaultFormatConfig[k];
    });
    appState.formatConfig.quote = defaultFormatConfig.quote; // 固定
    if (typeof renderFormatList === 'function') renderFormatList();   // 自分のフォーマットの一覧
  }
  function loadSettingsToUI() { document.getElementById('botName').value = appState.botName || "概要投稿Bot"; renderChannelConfigList(); }

  const chAccOpen = new Set();   // 開いているチャンネル設定（一覧を描き直しても開閉の状態を保つ）
  function renderChannelConfigList() {
    const list = document.getElementById('channelConfigList'); list.innerHTML = "";
    if (!list.dataset.acc) { list.dataset.acc = '1'; list.addEventListener('toggle', e => { const d = e.target; if (!d.classList || !d.classList.contains('ch-acc')) return; if (d.open) chAccOpen.add(d.dataset.chid); else chAccOpen.delete(d.dataset.chid); }, true); }
    appState.channels.forEach((ch, cI) => {
      const div = document.createElement('details'); div.className = "sortable-item ch-acc"; div.dataset.chid = ch.id; if (chAccOpen.has(ch.id)) div.open = true;   // アコーディオン（縦に長くならないよう折りたたみ可能）
      const nTags = (ch.tags || []).length;
      div.innerHTML = `
        <summary class="ch-acc-head"><span class="ch-acc-name">${escapeHTML(ch.name || '（名称未設定）')}</span><span class="ch-acc-meta">タグ ${nTags}件 ・ ${ch.webhookUrl ? 'Webhook設定済み' : 'Webhook未設定'}</span></summary>
        <div class="block-body" style="border:none;">
          <div class="grid-2" style="margin-bottom:8px;"><input type="text" value="${escapeHTML(ch.name)}" placeholder="チャンネル表示名" data-on-input="ch-rename" data-ci="${cI}"><input type="text" class="wh-mask" autocomplete="off" spellcheck="false" value="${escapeHTML(ch.webhookUrl)}" placeholder="Webhook URL（入力中のみ表示）" data-on-input="ch-webhook" data-ci="${cI}"></div>
          <div style="font-size:0.8rem; font-weight:bold; margin-bottom:4px; color:var(--dc-text-muted);">フォーラムタグ設定 (タグ名 / タグID)</div>
          <div>${(ch.tags || []).map((t, tI) => `<div style="display:flex; gap:8px; margin-bottom:4px;"><input type="text" value="${escapeHTML(t.name)}" placeholder="タグ名" style="width:40%; padding:6px;" data-on-input="tag-name" data-ci="${cI}" data-ti="${tI}"><input type="text" value="${escapeHTML(t.id)}" placeholder="例：123456789012345678" style="flex:1; padding:6px;" data-on-input="tag-id" data-ci="${cI}" data-ti="${tI}"><button type="button" class="btn-sort btn-danger" data-on-click="tag-del" data-ci="${cI}" data-ti="${tI}">✕</button></div>`).join('')}</div>
          <div style="display:flex; justify-content:space-between; margin-top:10px;"><span style="display:flex; gap:8px; flex-wrap:wrap;"><button type="button" class="btn btn-secondary" data-on-click="tag-add" data-ci="${cI}">＋ タグ追加</button><button type="button" class="btn btn-secondary" data-on-click="ch-test" data-ci="${cI}">🔌 接続テスト</button></span><button type="button" class="btn btn-secondary btn-danger" data-on-click="ch-del" data-ci="${cI}">🗑️ このチャンネルを削除</button></div>
        </div>`;
      list.appendChild(div);
    });
    renderBaseTagManager();
  }
  // ===== ベースタグ管理（Discord未設定でも使える検索用タグ。追加・削除は自由。投稿時はチャンネルの同名タグ(ID)へ自動で結びつく） =====
  function renderBaseTagManager() {
    let card = document.getElementById('baseTagCard');
    if (!card) {
      const list = document.getElementById('channelConfigList'); if (!list) return;
      const host = list.closest('.card'); if (!host || !host.parentNode) return;
      card = document.createElement('div');
      card.id = 'baseTagCard';
      card.className = 'card';
      host.parentNode.insertBefore(card, host);
    }
    if (!Array.isArray(appState.tagPresets)) appState.tagPresets = [...DEFAULT_TAG_PRESETS];
    const raw = (typeof rawSystemKeys === 'function') ? rawSystemKeys() : new Set();
    const groups = { sys: [], ppl: [], etc: [] };
    appState.tagPresets.forEach(n => { if (n) groups[tagGroupOf(n, raw)].push(n); });
    if (typeof tagSortNum === 'function') groups.ppl.sort(tagSortNum);
    const e = escapeHTML;
    card.innerHTML = `<div class="card-title">🏷️ ベースタグ管理（Discord未設定でも使える検索用タグ）</div>
      <div class="set-hint">ここにあるタグは、シナリオの検索・絞り込み用に自由に使えます。あとから下の「フォーラムタグ設定」に同じ名前（<b>R18-G</b> と <b>R18G</b> のような表記ゆれも可）のタグを登録すると、投稿時に自動でそのチャンネルのタグIDと結びつきます。タグを削除しても、すでにシナリオに付けたタグは消えません。</div>
      ${TAG_GROUP_DEFS.map(([g, label]) => `<div class="tag-group"><div class="tag-group-label">${label}</div><div class="tag-chips">${groups[g].map(n => `<span class="chip tag-mgr-chip">${e(n)}<button type="button" class="tag-mgr-del" data-btag-del="${e(n)}" aria-label="${e(n)}を削除" title="削除">✕</button></span>`).join('') || '<span class="sb-empty">なし</span>'}</div></div>`).join('')}
      <div class="tag-add-row"><input type="text" id="baseTagInput" maxlength="40" placeholder="＋ 新しいタグ名（システム・人数・傾向は名前から自動で分類）" aria-label="新しいベースタグ名"><button type="button" class="btn btn-secondary btn-sm" data-btag-add="1">追加</button><button type="button" class="btn btn-secondary btn-sm" data-btag-reset="1" title="削除した標準タグを元に戻します（自分で追加したタグは残ります）">標準タグを補う</button></div>`;
  }
  (function () {
    const addBase = () => {
      const i = document.getElementById('baseTagInput'); if (!i) return;
      const v = i.value.trim().replace(/^#+/, '').trim(); if (!v) { i.focus(); return; }
      const nm = addTagPreset(v);
      if (nm && !tagFind(appState.tagPresets, nm)) appState.tagPresets.push(nm);
      saveState(true);
      renderBaseTagManager();
      if (typeof renderSidebarTags === 'function') renderSidebarTags();
      updateTagCheckboxes();
      const n = document.getElementById('baseTagInput'); if (n) n.focus();
    };
    document.addEventListener('click', ev => {
      const t = ev.target.closest && ev.target.closest('#baseTagCard [data-btag-del], #baseTagCard [data-btag-add], #baseTagCard [data-btag-reset]');
      if (!t) return;
      if (t.hasAttribute('data-btag-add')) return addBase();
      if (t.hasAttribute('data-btag-reset')) {
        appState.tagPresets = mergeTagNames(DEFAULT_TAG_PRESETS, appState.tagPresets);
        saveState(true);
        renderBaseTagManager();
        if (typeof renderSidebarTags === 'function') renderSidebarTags();
        updateTagCheckboxes();
        return toast('標準のベースタグを補いました');
      }
      const nm = t.getAttribute('data-btag-del');
      appState.tagPresets = (appState.tagPresets || []).filter(x => tagKey(x) !== tagKey(nm));
      if (Array.isArray(appState.customTags)) appState.customTags = appState.customTags.filter(x => tagKey(x) !== tagKey(nm));
      saveState(true);
      renderBaseTagManager();
      updateTagCheckboxes();
      if (typeof renderSidebarTags === 'function') renderSidebarTags();
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.isComposing && ev.target && ev.target.id === 'baseTagInput') {
        ev.preventDefault();
        addBase();
      }
    });
  })();

  // =========================================================================
  // 右ペイン 2段アコーディオン（プレビュー ＋ シナリオ資料ビューワ）＆ ワンクリック転記
  // =========================================================================
  (function () {
    const SUPPORTED_DOC_RE = /\.(?:pdf|txt|md|markdown|html?)$/i;
    const TEXT_DOC_EXT_RE = /\.(?:txt|md|markdown|html?)$/i;
    const SYNOPSIS_BLOCK_RE = /^(?:[■◆●▸▹・]\s*)?(?:あらすじ|ストーリー|導入|イントロダクション|イントロ|背景|概略|背景ストーリー|synopsis|story|introduction|intro)$/i;
    const NOTES_BLOCK_RE = /^(?:[■◆●▸▹・]\s*)?(?:注意事項・備考|注意事項|備考|注意|メモ|特記事項|notes?)$/i;

    const $ = id => document.getElementById(id);
    const matMul = (m1, m2) => [
      m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];

    const viewerState = {
      wired: false,
      scenarioId: null,
      docList: [],
      manualDocs: new Map(), // key -> { value, label, name, bytes, ext }
      activeKey: '',
      activeName: '',
      mode: 'empty', // 'empty' | 'pdf' | 'text'
      openToken: 0,
      renderGen: 0,
      // PDF state
      pdfLib: null,
      pdfDoc: null,
      pdfSizes: [],
      pdfPages: [],
      pdfPage: 1,
      pdfZoom: 1.0,
      pdfFitMode: true,
      pdfIo: null,
      pdfScanPromise: null,
      pdfScanData: null, // [{ text, starts, items }]
      scrollLockUntil: 0,
      // Text state
      textContent: '',
      textEnc: 'UTF-8',
      textZoom: 1.0,
      // Search state
      searchQuery: '',
      searchHits: [],
      searchIdx: -1,
      searchTimer: null,
      // Selection & Rectangle selection cache
      lastSelectedText: '',
      lastRectText: '',
      rectMode: false,
      rectDrag: null
    };

    let renderQueue = [];
    let activeRenders = 0;
    const activeRenderTasks = new Set();

    function baseNameOf(p) {
      const s = String(p || '');
      if (!s) return '';
      if (window.CloudSync && CloudSync.isCloudAssetRef && CloudSync.isCloudAssetRef(s)) {
        const parsed = CloudSync.parseCloudAssetRef(s);
        return (parsed && parsed.name) || 'document';
      }
      if (window.WebBridge && WebBridge.isAssetRef && WebBridge.isAssetRef(s)) {
        return WebBridge.assetBasename(s);
      }
      if (/^zip(?:view|mem):\/\//i.test(s)) {
        const tail = s.split('/').pop() || '';
        try { return decodeURIComponent(tail); } catch (_) { return tail; }
      }
      if (IS_ELECTRON && path) return path.basename(s);
      return s.split(/[\\/]/).pop() || s;
    }

    function extOf(nameOrPath) {
      const b = baseNameOf(nameOrPath).split(/[?#]/)[0];
      const m = /\.([a-z0-9]+)$/i.exec(b);
      return m ? m[1].toLowerCase() : '';
    }

    function normDocKey(v) {
      const s = String(v || '').trim();
      if (!s) return '';
      if (/^(?:idb-asset|cloud-asset|zipview|zipmem|mem-doc):\/\//i.test(s)) return s;
      return s.replace(/\//g, '\\').toLowerCase();
    }

    // ---- 1. 右ペイン 2段アコーディオン開閉 ----
    function toggleRightAccPanel(panelId, forceOpen) {
      const panel = $(panelId);
      if (!panel) return;
      const isPreview = panelId === 'previewAccPanel';
      const header = $(isPreview ? 'previewAccHeader' : 'docViewerAccHeader');
      const caret = $(isPreview ? 'previewAccCaret' : 'docViewerAccCaret');
      const curCollapsed = panel.classList.contains('is-collapsed');
      const nextCollapsed = forceOpen !== undefined ? !forceOpen : !curCollapsed;
      panel.classList.toggle('is-collapsed', nextCollapsed);
      if (caret) caret.textContent = nextCollapsed ? '▶' : '▼';
      if (header) header.setAttribute('aria-expanded', String(!nextCollapsed));

      const rightPane = $('postRightPane') || document.querySelector('.preview-area');
      if (rightPane) {
        const pvCol = $('previewAccPanel')?.classList.contains('is-collapsed');
        const dvCol = $('docViewerAccPanel')?.classList.contains('is-collapsed');
        rightPane.classList.toggle('pv-collapsed', !!pvCol);
        rightPane.classList.toggle('dv-collapsed', !!dvCol);
      }

      if (!nextCollapsed && !isPreview && viewerState.mode === 'pdf') {
        setTimeout(() => {
          if (viewerState.pdfFitMode) fitPdfWidth();
          else evaluateVisiblePdfPages();
        }, 60);
      }
    }

    function wireRightAccordion() {
      ['previewAccHeader', 'docViewerAccHeader'].forEach(hId => {
        const header = $(hId);
        if (!header || header.dataset.accWired) return;
        header.dataset.accWired = '1';
        const panelId = hId === 'previewAccHeader' ? 'previewAccPanel' : 'docViewerAccPanel';
        header.addEventListener('click', e => {
          if (e.target.closest && e.target.closest('.right-acc-actions, button, input, select, a, label')) return;
          toggleRightAccPanel(panelId);
        });
        header.addEventListener('keydown', e => {
          if (e.target !== header) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleRightAccPanel(panelId);
          }
        });
      });
      const zoomBtn = $('previewZoomBtn');
      if (zoomBtn && !zoomBtn.dataset.accZoomWired) {
        zoomBtn.dataset.accZoomWired = '1';
        zoomBtn.addEventListener('click', () => {
          const pvPanel = $('previewAccPanel');
          if (pvPanel && pvPanel.classList.contains('is-collapsed')) {
            toggleRightAccPanel('previewAccPanel', true);
          }
        }, true);
      }
    }

    function unignoreScenarioDocName(name) {
      const sc = currentScenarioId ? (appState.scenarios || []).find(s => s && s.id === currentScenarioId) : null;
      if (!sc || !Array.isArray(sc.ignoredDocNames) || !sc.ignoredDocNames.length || !name) return;
      const k = String(name).normalize('NFKC').trim().toLowerCase();
      const next = sc.ignoredDocNames.filter(x => String(x || '').normalize('NFKC').trim().toLowerCase() !== k);
      if (next.length !== sc.ignoredDocNames.length) {
        sc.ignoredDocNames = next;
        if (typeof saveState === 'function') saveState(true);
      }
    }

    // ---- 2. シナリオ資料ファイルの自動収集・プルダウン連動 ----
    async function collectScenarioDocEntries(sc) {
      let entries = [];
      const seenKeys = new Set();
      const seenNames = new Set();
      const manualNames = new Set();
      const ignoredSet = new Set(
        (sc && Array.isArray(sc.ignoredDocNames) ? sc.ignoredDocNames : [])
          .map(x => String(x || '').normalize('NFKC').trim().toLowerCase())
          .filter(Boolean)
      );
      const zipPaths = [];
      const seenZips = new Set();

      const addEntry = (val, rawName, badgePrefix, isManual) => {
        if (!val) return;
        const k = normDocKey(val);
        if (!k || seenKeys.has(k)) return;
        const fileName = String(rawName || baseNameOf(val) || '').trim();
        if (!SUPPORTED_DOC_RE.test(fileName) && !SUPPORTED_DOC_RE.test(baseNameOf(val))) return;
        const ext = (extOf(fileName) || extOf(val) || 'doc').toUpperCase();
        const nameKey = fileName.normalize('NFKC').trim().toLowerCase();
        if (!isManual && nameKey && ignoredSet.has(nameKey) && !manualNames.has(nameKey)) return;
        if (nameKey && seenNames.has(nameKey) && !/^mem-doc:\/\//i.test(val)) return;
        seenKeys.add(k);
        if (nameKey) {
          seenNames.add(nameKey);
          if (isManual) manualNames.add(nameKey);
        }
        const icon = ext === 'PDF' ? '📕' : (ext === 'HTML' || ext === 'HTM') ? '🌐' : '📃';
        const prefix = badgePrefix ? `${badgePrefix} ` : `${icon} `;
        entries.push({
          value: val,
          name: fileName || baseNameOf(val),
          ext: ext.toLowerCase(),
          isManual: !!isManual,
          label: `${prefix}${fileName || baseNameOf(val)} [${ext}]`
        });
      };

      const addZipCandidate = zp => {
        if (!zp) return;
        const zk = normDocKey(zp);
        if (!zk || seenZips.has(zk)) return;
        seenZips.add(zk);
        zipPaths.push(zp);
      };

      // 手動で開いたファイル（D&D・ファイルを開く）
      for (const [, mDoc] of viewerState.manualDocs) {
        addEntry(mDoc.value, mDoc.name, '📂', true);
      }

      if (sc) {
        // 1) sc.docs (_TRPG_Data 内の複製保存ファイルや登録資料)
        (Array.isArray(sc.docs) ? sc.docs : []).forEach(d => {
          if (!d) return;
          const nm = d.origName || d.name || baseNameOf(d.path || d.ref || d.rel || '');
          let fp = '';
          if (IS_ELECTRON && path && DATA_ROOT && d.rel) {
            try {
              const abs = path.resolve(DATA_ROOT, d.rel);
              if (!fs || !fs.existsSync || fs.existsSync(abs)) fp = abs;
            } catch (_) { }
          }
          if (!fp && d.path) {
            if (!IS_ELECTRON || !fs || /^https?:|^idb-asset:|^cloud-asset:|^zip(?:view|mem):/i.test(d.path) || fs.existsSync(d.path)) {
              fp = d.path;
            }
          }
          if (!fp && d.ref) fp = d.ref;
          if (!fp && d.cloudSha) fp = `cloud-asset://${d.cloudSha}/${encodeURIComponent(nm || 'doc.pdf')}`;
          if (fp) {
            if (/\.zip$/i.test(nm || fp)) addZipCandidate(fp);
            else addEntry(fp, nm && SUPPORTED_DOC_RE.test(nm) ? nm : baseNameOf(fp));
          }
        });

        // 2) _TRPG_Data/scenarios/<id> フォルダ内の実ファイル走査
        if (IS_ELECTRON && fs && path && DATA_ROOT && sc.id) {
          const scDir = path.join(DATA_ROOT, 'scenarios', String(sc.id).replace(/[^\w-]/g, '_'));
          try {
            if (fs.existsSync(scDir)) {
              const dirFiles = fs.readdirSync(scDir, { withFileTypes: true });
              dirFiles.forEach(ent => {
                if (!ent.isFile()) return;
                const full = path.join(scDir, ent.name);
                if (SUPPORTED_DOC_RE.test(ent.name)) addEntry(full, ent.name);
                else if (/\.zip$/i.test(ent.name)) addZipCandidate(full);
              });
            }
          } catch (_) { }
        }

        // 3) CCF.assets.getUnifiedItems (登録素材・クラウドカタログ・ZIP含む)
        if (window.CCF && CCF.assets && typeof CCF.assets.getUnifiedItems === 'function') {
          try {
            const unified = CCF.assets.getUnifiedItems(sc.id) || [];
            unified.forEach(it => {
              if (!it || it.missing) return;
              const nm = it.origName || it.name || baseNameOf(it.path || '');
              const fp = it.path || (it.cloudSha ? `cloud-asset://${it.cloudSha}/${encodeURIComponent(nm || 'doc')}` : '');
              if (!fp) return;
              if (it.type === 'zip' || /\.zip$/i.test(nm || fp)) {
                addZipCandidate(fp);
              } else if (it.type === 'pdf' || it.type === 'doc' || SUPPORTED_DOC_RE.test(nm) || SUPPORTED_DOC_RE.test(fp)) {
                addEntry(fp, SUPPORTED_DOC_RE.test(nm) ? nm : baseNameOf(fp));
              }
            });
          } catch (_) { }
        }

        // 4) ココフォリア部屋プロジェクトの pdf / refs
        const scanProj = proj => {
          if (!proj || typeof proj !== 'object') return;
          if (proj.pdf && proj.pdf.path) addEntry(proj.pdf.path, baseNameOf(proj.pdf.path));
          (Array.isArray(proj.refs) ? proj.refs : []).forEach(r => {
            if (!r) return;
            const nm = r.origName || r.name || baseNameOf(r.path || '');
            const fp = r.path || (r.cloudSha ? `cloud-asset://${r.cloudSha}/${encodeURIComponent(nm || 'doc')}` : '');
            if (!fp) return;
            if (r.type === 'zip' || /\.zip$/i.test(nm || fp)) addZipCandidate(fp);
            else if (r.type === 'pdf' || r.type === 'doc' || SUPPORTED_DOC_RE.test(nm) || SUPPORTED_DOC_RE.test(fp)) {
              addEntry(fp, SUPPORTED_DOC_RE.test(nm) ? nm : baseNameOf(fp));
            }
          });
        };
        if (Array.isArray(sc.ccfRooms)) {
          sc.ccfRooms.forEach(rm => scanProj(rm && rm.project));
        } else if (window.CCF && typeof CCF.readProject === 'function') {
          try { scanProj(CCF.readProject(String(sc.id))); } catch (_) { }
        }

        // 5) sc.sourcePath (元フォルダまたは元ZIP)
        if (IS_ELECTRON && fs && path && sc.sourcePath) {
          try {
            if (fs.existsSync(sc.sourcePath)) {
              const st = fs.statSync(sc.sourcePath);
              if (st.isFile()) {
                if (SUPPORTED_DOC_RE.test(sc.sourcePath)) addEntry(sc.sourcePath, path.basename(sc.sourcePath));
                else if (/\.zip$/i.test(sc.sourcePath)) addZipCandidate(sc.sourcePath);
              } else if (st.isDirectory()) {
                const walkSourceDir = (dir, depth) => {
                  if (depth > 2) return;
                  let list = [];
                  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
                  for (const ent of list) {
                    const n = ent.name || '';
                    if (!n || n.startsWith('.') || n === 'node_modules' || n === '__MACOSX' || n === '_TRPG_Data') continue;
                    const fp = path.join(dir, n);
                    if (ent.isDirectory()) {
                      if (window.CCFModel && CCFModel.isOldFolderName && CCFModel.isOldFolderName(n)) continue;
                      walkSourceDir(fp, depth + 1);
                    } else if (ent.isFile()) {
                      if (SUPPORTED_DOC_RE.test(n)) addEntry(fp, n);
                      else if (/\.zip$/i.test(n)) addZipCandidate(fp);
                    }
                  }
                };
                walkSourceDir(sc.sourcePath, 0);
              }
            }
          } catch (_) { }
        }

        // 6) 登録ZIP内の PDF / TXT / MD / HTML エントリ (zipview:// / zipmem://)
        if (zipPaths.length && window.CCF && CCF.zip && typeof CCF.zip.open === 'function') {
          for (const zp of zipPaths) {
            try {
              if (IS_ELECTRON && fs && !/^(?:idb-asset|cloud-asset|zipview|zipmem):/i.test(zp) && !fs.existsSync(zp)) continue;
              const z = await CCF.zip.open(zp);
              if (!z || !Array.isArray(z.entries)) continue;
              if (CCF.zip.isRoomZip && CCF.zip.isRoomZip(z)) continue;
              for (const ent of z.entries) {
                if (!ent || ent.dir || /__MACOSX/i.test(ent.name)) continue;
                const base = ent.name.split('/').pop() || ent.name;
                if (! base || base.startsWith('.')) continue;
                if (SUPPORTED_DOC_RE.test(base)) {
                  const zUrl = CCF.zip.url(z.id, ent.name);
                  addEntry(zUrl, base, '📦');
                }
              }
            } catch (_) { }
          }
        }
        // 7) sc.docTexts（同期テキスト）
        if (Array.isArray(sc.docTexts) && sc.docTexts.length) {
          const seenDocTextNames = new Set(entries.map(e => String(e.name || '').normalize('NFKC').trim().toLowerCase()));
          sc.docTexts.forEach(dt => {
            if (!dt || !dt.text || !dt.name) return;
            const nk = String(dt.name).normalize('NFKC').trim().toLowerCase();
            if ((ignoredSet.has(nk) && !manualNames.has(nk)) || seenDocTextNames.has(nk)) return;
            seenDocTextNames.add(nk);
            entries.push({
              value: 'doc-text://' + String(dt.id || dt.name),
              name: dt.name,
              label: `📄 ${dt.name}（同期テキスト）`,
              ext: 'txt',
              isDocText: true
            });
          });
        }
      }

      if (ignoredSet.size) {
        entries = entries.filter(e => {
          if (e.isManual) return true;
          const nk = String(e.name || '').normalize('NFKC').trim().toLowerCase();
          return !nk || !ignoredSet.has(nk);
        });
      }
      if (window.CCF && CCF.dnd && typeof CCF.dnd.filterLatestVersionEntries === 'function' && entries.length) {
        try {
          const filtered = CCF.dnd.filterLatestVersionEntries(
            entries.map(e => Object.assign({ isDir: false, mtime: 0 }, e))
          );
          if (Array.isArray(filtered)) {
            const keptVals = new Set(filtered.map(f => normDocKey(f && f.value)));
            entries = entries.filter(e => e.isManual || keptVals.has(normDocKey(e.value)));
          }
        } catch (_) { }
      }

      // メイン資料（本編PDFやシナリオ名一致）を先頭にしやすく並び替え
      if (entries.length > 1) {
        const scTitleNorm = (sc && sc.title) ? String(sc.title).normalize('NFKC').toLowerCase() : '';
        const scoreEntry = it => {
          let s = 0;
          const nm = String(it.name || '').normalize('NFKC').toLowerCase();
          if (/^mem-doc:\/\//i.test(it.value)) s += 500;
          if (it.ext === 'pdf') s += 50;
          else if (it.ext === 'txt' || it.ext === 'md') s += 40;
          if (/本編|本文|シナリオブック|scenario|main|kp用|gm用/i.test(nm)) s += 30;
          if (scTitleNorm && nm.includes(scTitleNorm)) s += 25;
          if (/readme|利用規約|規約|クレジット|credit|おまけ|差分/i.test(nm)) s -= 40;
          return s;
        };
        entries.sort((a, b) => scoreEntry(b) - scoreEntry(a));
      }

      return entries;
    }

    async function refreshPostDocList(opts) {
      const o = opts || {};
      const sel = $('postDocSelect');
      if (!sel) return;

      if (o.clear) {
        viewerState.manualDocs.clear();
        viewerState.scenarioId = null;
        viewerState.docList = [];
        sel.innerHTML = '<option value="">-- シナリオ資料を選択 --</option>';
        clearPostDocViewer();
        return;
      }

      const sc = currentScenarioId ? (appState.scenarios || []).find(s => s && s.id === currentScenarioId) : null;
      const scChanged = (sc ? sc.id : null) !== viewerState.scenarioId;
      if (scChanged && !o.keepManual) {
        viewerState.manualDocs.clear();
      }
      viewerState.scenarioId = sc ? sc.id : null;

      const list = await collectScenarioDocEntries(sc);
      viewerState.docList = list;

      const prevKey = normDocKey(viewerState.activeKey);
      if (!list.length) {
        sel.innerHTML = '<option value="">-- 紐づく資料なし（📂開く / D&amp;Dで閲覧可） --</option>';
        if (scChanged || !viewerState.activeKey) clearPostDocViewer();
        return;
      }

      sel.innerHTML = `<option value="">-- シナリオ資料を選択 (${list.length}件) --</option>`
        + list.map(it => `<option value="${escapeHTML(it.value)}">${escapeHTML(it.label)}</option>`).join('');

      const stillExists = prevKey ? list.find(it => normDocKey(it.value) === prevKey) : null;
      if (stillExists && !scChanged) {
        sel.value = stillExists.value;
      } else if (o.autoOpen || scChanged) {
        const first = list[0];
        if (first) {
          sel.value = first.value;
          await openPostDoc(first.value);
        }
      } else if (stillExists) {
        sel.value = stillExists.value;
      }
    }
    window.refreshPostDocList = refreshPostDocList;

    // ---- 3. ファイルのバイト列読み込み ----
    async function readDocBytes(src) {
      if (!src) throw new Error('資料パスが指定されていません');
      if (viewerState.manualDocs.has(src)) {
        const m = viewerState.manualDocs.get(src);
        if (m && m.bytes) return m.bytes;
      }
      if (/^zip(?:view|mem):\/\//i.test(src)) {
        if (window.CCF && CCF.zip && typeof CCF.zip.readBuffer === 'function') {
          const r = await CCF.zip.readBuffer(src);
          return r.buf instanceof Uint8Array ? r.buf : new Uint8Array(r.buf);
        }
        const res = await fetch(src);
        if (!res.ok) throw new Error('ZIP内資料を読み込めませんでした');
        return new Uint8Array(await res.arrayBuffer());
      }
      if (window.CCFPdfViewer && typeof CCFPdfViewer.readFileBytes === 'function') {
        return await CCFPdfViewer.readFileBytes(src);
      }
      if (IS_ELECTRON && fs && fs.existsSync(src)) {
        const buf = await fs.promises.readFile(src);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
      }
      throw new Error('資料ファイルを読み込めませんでした');
    }

    async function loadPdfjsLib() {
      if (viewerState.pdfLib) return viewerState.pdfLib;
      const appDir = (window.CCF && CCF.APP_DIR) ? CCF.APP_DIR : (IS_ELECTRON && path && DATA_ROOT ? path.dirname(DATA_ROOT) : '');
      if (window.CCFPdfViewer && typeof CCFPdfViewer.loadPdfjsAsync === 'function') {
        viewerState.pdfLib = await CCFPdfViewer.loadPdfjsAsync(appDir);
        return viewerState.pdfLib;
      }
      if (window.pdfjsLib) {
        viewerState.pdfLib = window.pdfjsLib;
        return viewerState.pdfLib;
      }
      throw new Error('PDF表示ライブラリ (pdfjs-dist) を読み込めませんでした');
    }

    async function openPdfDocumentFromBytes(u8) {
      const appDir = (window.CCF && CCF.APP_DIR) ? CCF.APP_DIR : (IS_ELECTRON && path && DATA_ROOT ? path.dirname(DATA_ROOT) : '');
      if (window.CCFPdfViewer && typeof CCFPdfViewer.getDoc === 'function') {
        await loadPdfjsLib();
        return await CCFPdfViewer.getDoc(appDir, u8);
      }
      const lib = await loadPdfjsLib();
      return await lib.getDocument({ data: u8, isEvalSupported: false }).promise;
    }

    // ---- 4. ビューワの破棄・初期化 ----
    function cancelAllPdfRenderTasks() {
      renderQueue.length = 0;
      viewerState.pdfPages.forEach(p => {
        if (p.task) { try { p.task.cancel(); } catch (_) { } activeRenderTasks.delete(p.task); p.task = null; }
        if (p.textTask && typeof p.textTask.cancel === 'function') { try { p.textTask.cancel(); } catch (_) { } p.textTask = null; }
      });
      for (const t of [...activeRenderTasks]) {
        try { t.cancel(); } catch (_) { }
        activeRenderTasks.delete(t);
      }
    }

    function teardownViewerDoc() {
      viewerState.renderGen++;
      if (viewerState.pdfIo) {
        try { viewerState.pdfIo.disconnect(); } catch (_) { }
        viewerState.pdfIo = null;
      }
      cancelAllPdfRenderTasks();
      viewerState.pdfPages = [];
      viewerState.pdfSizes = [];
      viewerState.pdfScanPromise = null;
      viewerState.pdfScanData = null;
      if (viewerState.pdfDoc) {
        try { viewerState.pdfDoc.destroy(); } catch (_) { }
        viewerState.pdfDoc = null;
      }
      viewerState.textContent = '';
      viewerState.searchHits = [];
      viewerState.searchIdx = -1;
      const pagesEl = $('postDocPages');
      const textWrap = $('postDocTextWrap');
      const textBody = $('postDocTextBody');
      if (pagesEl) { pagesEl.innerHTML = ''; pagesEl.hidden = true; }
      if (textBody) textBody.innerHTML = '';
      if (textWrap) textWrap.hidden = true;
    }

    function clearPostDocViewer() {
      viewerState.openToken++;
      teardownViewerDoc();
      viewerState.mode = 'empty';
      viewerState.activeKey = '';
      viewerState.activeName = '';
      const emptyEl = $('postDocEmpty');
      if (emptyEl) emptyEl.hidden = false;
      const badge = $('postDocMetaBadge');
      if (badge) badge.textContent = '';
      updateViewerControlsUI();
    }

    function updateViewerControlsUI() {
      const isPdf = viewerState.mode === 'pdf' && !!viewerState.pdfDoc;
      const isText = viewerState.mode === 'text';
      const hasDoc = isPdf || isText;
      const prevBtn = $('postDocPrevPage');
      const nextBtn = $('postDocNextPage');
      const pageInp = $('postDocPageInput');
      const pageTot = $('postDocPageTotal');
      const zoomLbl = $('postDocZoomLabel');
      const searchCnt = $('postDocSearchCount');

      if (prevBtn) prevBtn.disabled = !isPdf || viewerState.pdfPage <= 1;
      if (nextBtn) nextBtn.disabled = !isPdf || viewerState.pdfPage >= (viewerState.pdfDoc ? viewerState.pdfDoc.numPages : 1);
      if (pageInp) {
        pageInp.disabled = !isPdf;
        pageInp.value = isPdf ? viewerState.pdfPage : 1;
        if (isPdf && viewerState.pdfDoc) pageInp.max = viewerState.pdfDoc.numPages;
      }
      if (pageTot) {
        pageTot.textContent = isPdf && viewerState.pdfDoc ? `/ ${viewerState.pdfDoc.numPages}` : (isText ? '/ 1' : '/ -');
      }
      if (zoomLbl) {
        const z = isPdf ? viewerState.pdfZoom : (isText ? viewerState.textZoom : 1);
        zoomLbl.textContent = `${Math.round(z * 100)}%`;
      }
      if (searchCnt) {
        if (!hasDoc || !viewerState.searchQuery.trim()) {
          searchCnt.textContent = '';
        } else if (!viewerState.searchHits.length) {
          searchCnt.textContent = '0件';
        } else {
          searchCnt.textContent = `${viewerState.searchIdx + 1}/${viewerState.searchHits.length}`;
        }
      }
    }

    function findSyncedPostDocText(src, dispName) {
      const sc = currentScenarioId ? (appState.scenarios || []).find(s => s && s.id === currentScenarioId) : null;
      const list = (sc && Array.isArray(sc.docTexts)) ? sc.docTexts : [];
      if (!list.length) return null;
      const sp = String(src || '');
      if (/^doc-text:\/\//i.test(sp)) {
        const id = sp.slice('doc-text://'.length);
        const byId = list.find(d => d && d.text && String(d.id || '') === id);
        if (byId) return byId;
      }
      const nm = String(dispName || baseNameOf(sp) || '').normalize('NFKC').trim().toLowerCase();
      return nm ? (list.find(d => d && d.text && String(d.name || '').normalize('NFKC').trim().toLowerCase() === nm) || null) : null;
    }

    // ---- 5. PDF / TXT / MD / HTML を開く ----
    async function openPostDoc(src) {
      if (!src) {
        clearPostDocViewer();
        return false;
      }
      const tok = ++viewerState.openToken;
      const docEntry = viewerState.docList.find(d => normDocKey(d.value) === normDocKey(src))
        || viewerState.manualDocs.get(src);
      const dispName = (docEntry && docEntry.name) || baseNameOf(src) || '資料';
      const badge = $('postDocMetaBadge');
      if (badge) badge.textContent = '読込中...';

      // 資料ビューワパネルが閉じていたら自動で開く
      const dvPanel = $('docViewerAccPanel');
      if (dvPanel && dvPanel.classList.contains('is-collapsed')) {
        toggleRightAccPanel('docViewerAccPanel', true);
      }

      try {
        let u8 = null;
        let syncedDt = null;
        if (/^doc-text:\/\//i.test(String(src))) {
          syncedDt = findSyncedPostDocText(src, dispName);
          if (!syncedDt) throw new Error('同期テキストが見つかりません');
        } else {
          try {
            u8 = await readDocBytes(src);
          } catch (readErr) {
            syncedDt = findSyncedPostDocText(src, dispName);
            if (!syncedDt) throw readErr;
          }
        }
        if (tok !== viewerState.openToken) return false;

        const isText = !!syncedDt || TEXT_DOC_EXT_RE.test(dispName) || TEXT_DOC_EXT_RE.test(baseNameOf(src));
        teardownViewerDoc();
        viewerState.activeKey = src;
        viewerState.activeName = dispName;

        const sel = $('postDocSelect');
        if (sel) {
          const opt = [...sel.options].find(o => normDocKey(o.value) === normDocKey(src));
          if (opt) sel.value = opt.value;
        }

        const emptyEl = $('postDocEmpty');
        if (emptyEl) emptyEl.hidden = true;

        if (isText) {
          let decoded = { text: '', enc: 'UTF-8' };
          if (syncedDt) {
            decoded = { text: syncedDt.text || '', enc: '同期テキスト' };
          } else if (window.CCFText && typeof CCFText.loadTextDoc === 'function') {
            decoded = CCFText.loadTextDoc(dispName, u8);
          } else if (typeof window.decodeTextBytes === 'function') {
            decoded = { text: window.decodeTextBytes(u8), enc: '自動判別' };
          } else {
            decoded = { text: new TextDecoder('utf-8').decode(u8), enc: 'UTF-8' };
          }
          viewerState.mode = 'text';
          viewerState.textContent = decoded.text || '';
          viewerState.textEnc = decoded.enc || 'UTF-8';
          viewerState.textZoom = 1.0;

          const textWrap = $('postDocTextWrap');
          const textHead = $('postDocTextHead');
          if (textWrap) textWrap.hidden = false;
          if (textHead) {
            textHead.textContent = `📃 ${dispName} （文字コード: ${viewerState.textEnc} / ${viewerState.textContent.length.toLocaleString()}文字）`;
          }
          if (badge) badge.textContent = `${dispName} [${viewerState.textEnc}]`;
          renderTextDocBody();
          const vp = $('postDocViewport');
          if (vp) vp.scrollTop = 0;
          if (viewerState.searchQuery.trim()) runViewerSearch();
          else updateViewerControlsUI();
          return true;
        } else {
          // PDF モード
          const doc = await openPdfDocumentFromBytes(u8);
          if (tok !== viewerState.openToken) {
            try { doc.destroy(); } catch (_) { }
            return false;
          }
          const sizes = [];
          for (let i = 1; i <= doc.numPages; i++) {
            const pg = await doc.getPage(i);
            const vp = pg.getViewport({ scale: 1 });
            sizes.push({ w: vp.width, h: vp.height });
            if (tok !== viewerState.openToken) {
              try { doc.destroy(); } catch (_) { }
              return false;
            }
          }
          viewerState.mode = 'pdf';
          viewerState.pdfDoc = doc;
          viewerState.pdfSizes = sizes;
          viewerState.pdfPage = 1;
          viewerState.pdfFitMode = true;

          const viewportEl = $('postDocViewport');
          const availW = (viewportEl && viewportEl.clientWidth > 80) ? (viewportEl.clientWidth - 24) : 380;
          const baseW = (sizes[0] && sizes[0].w) || 595;
          viewerState.pdfZoom = Math.min(2.5, Math.max(0.45, Math.round((availW / baseW) * 100) / 100));

          const pagesEl = $('postDocPages');
          if (pagesEl) pagesEl.hidden = false;
          if (badge) badge.textContent = `${dispName} (${doc.numPages}P)`;

          layoutPdfPages(1);
          if (viewerState.searchQuery.trim()) runViewerSearch();
          else updateViewerControlsUI();
          return true;
        }
      } catch (err) {
        console.error('[postDocViewer] open error', err);
        if (badge) badge.textContent = '読込失敗';
        toast('⚠️ 資料を開けませんでした: ' + (err && err.message ? err.message : err));
        return false;
      }
    }

    async function openPostDocFromFile(file) {
      if (!file) return;
      const nm = file.name || 'document';
      const diskPath = typeof filePathOf === 'function' ? filePathOf(file) : (file.path || '');

      // ZIPファイルがドロップまたは選択された場合は内部のPDF/TXT/MD/HTMLを展開
      if (/\.zip$/i.test(nm)) {
        if (window.CCF && CCF.zip && typeof CCF.zip.open === 'function') {
          try {
            const z = await CCF.zip.open(diskPath || file);
            const docEnts = (z && z.entries || []).filter(e => !e.dir && !/__MACOSX/i.test(e.name) && SUPPORTED_DOC_RE.test(e.name));
            if (!docEnts.length) return toast('⚠️ ZIP内にPDF / TXT / MD / HTMLファイルが見つかりませんでした');
            let firstUrl = '';
            docEnts.forEach(e => {
              const base = e.name.split('/').pop() || e.name;
              const zUrl = CCF.zip.url(z.id, e.name);
              if (!firstUrl) firstUrl = zUrl;
              unignoreScenarioDocName(base);
              viewerState.manualDocs.set(zUrl, { value: zUrl, name: base, ext: extOf(base) });
            });
            await refreshPostDocList({ keepManual: true, autoOpen: false });
            if (firstUrl) await openPostDoc(firstUrl);
            return;
          } catch (err) {
            return toast('⚠️ ZIPファイルを読み込めませんでした: ' + (err && err.message || err));
          }
        }
      }

      if (!SUPPORTED_DOC_RE.test(nm) && file.type !== 'application/pdf' && !(file.type && file.type.startsWith('text/'))) {
        return toast('⚠️ PDF / TXT / MD / HTML ファイルを選択またはドロップしてください');
      }

      unignoreScenarioDocName(nm);
      if (IS_ELECTRON && diskPath && fs && fs.existsSync(diskPath)) {
        viewerState.manualDocs.set(diskPath, { value: diskPath, name: nm, ext: extOf(nm) });
        await refreshPostDocList({ keepManual: true, autoOpen: false });
        await openPostDoc(diskPath);
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const memKey = `mem-doc://${Date.now()}_${encodeURIComponent(nm)}`;
      viewerState.manualDocs.set(memKey, { value: memKey, name: nm, bytes, ext: extOf(nm) });
      await refreshPostDocList({ keepManual: true, autoOpen: false });
      await openPostDoc(memKey);
    }

    // ---- 6. PDF 連続縦スクロール描画 & ズーム & ページ送り ----
    const MAX_CV_EDGE = 3600;
    const MAX_CV_PIXELS = 9 * 1024 * 1024;
    function clampPdfCanvasScale(w, h, dpr) {
      const w0 = Math.max(1, w), h0 = Math.max(1, h);
      let s = Math.max(1, dpr || 1);
      if (w0 * s > MAX_CV_EDGE) s = MAX_CV_EDGE / w0;
      if (h0 * s > MAX_CV_EDGE) s = Math.min(s, MAX_CV_EDGE / h0);
      if (w0 * s * h0 * s > MAX_CV_PIXELS) s = Math.min(s, Math.sqrt(MAX_CV_PIXELS / (w0 * h0)));
      return Math.max(0.1, s);
    }

    function layoutPdfPages(targetPage) {
      const doc = viewerState.pdfDoc;
      const pagesEl = $('postDocPages');
      const viewportEl = $('postDocViewport');
      if (!doc || !pagesEl || !viewportEl) return;

      viewerState.renderGen++;
      const gen = viewerState.renderGen;
      if (viewerState.pdfIo) {
        try { viewerState.pdfIo.disconnect(); } catch (_) { }
        viewerState.pdfIo = null;
      }
      cancelAllPdfRenderTasks();
      pagesEl.innerHTML = '';
      viewerState.pdfPages = [];

      const zoom = viewerState.pdfZoom;
      for (let i = 1; i <= doc.numPages; i++) {
        const sz = viewerState.pdfSizes[i - 1] || { w: 595, h: 842 };
        const pw = Math.round(sz.w * zoom);
        const ph = Math.round(sz.h * zoom);
        const pageEl = document.createElement('div');
        pageEl.className = 'post-doc-page' + (viewerState.rectMode ? ' rect-mode' : '');
        pageEl.dataset.page = String(i);
        pageEl.style.width = pw + 'px';
        pageEl.style.height = ph + 'px';
        pageEl.style.setProperty('--scale-factor', String(zoom));
        pageEl.innerHTML = `<canvas class="post-doc-canvas"></canvas><div class="textLayer post-doc-textlayer"></div><div class="post-doc-hl-layer"></div><div class="post-doc-rect-layer"></div><div class="post-doc-page-badge">P.${i} / ${doc.numPages}</div>`;
        pagesEl.appendChild(pageEl);
        viewerState.pdfPages.push({
          n: i,
          el: pageEl,
          cv: pageEl.children[0],
          tl: pageEl.children[1],
          hl: pageEl.children[2],
          rl: pageEl.children[3],
          vp: null,
          items: [],
          state: 0,
          task: null,
          textTask: null
        });
      }

      if (targetPage) scrollToPdfPage(targetPage, true);

      if (typeof IntersectionObserver === 'function') {
        viewerState.pdfIo = new IntersectionObserver(entries => {
          if (gen !== viewerState.renderGen) return;
          entries.forEach(en => {
            const pNo = Number(en.target.dataset.page);
            const pObj = viewerState.pdfPages[pNo - 1];
            if (!pObj) return;
            if (en.isIntersecting) {
              enqueuePdfPageRender(pObj, gen);
            }
          });
        }, { root: viewportEl, rootMargin: '420px 0px' });
        viewerState.pdfPages.forEach(p => viewerState.pdfIo.observe(p.el));
      }

      evaluateVisiblePdfPages();
      updateViewerControlsUI();
    }

    function evaluateVisiblePdfPages() {
      if (viewerState.mode !== 'pdf' || !viewerState.pdfDoc) return;
      const vpEl = $('postDocViewport');
      if (!vpEl) return;
      const vr = vpEl.getBoundingClientRect();
      if (vr.height <= 0) return;
      const gen = viewerState.renderGen;
      const margin = Math.max(450, vr.height);
      viewerState.pdfPages.forEach(p => {
        const pr = p.el.getBoundingClientRect();
        if (pr.bottom >= vr.top - margin && pr.top <= vr.bottom + margin) {
          if (p.state === 0) enqueuePdfPageRender(p, gen);
        } else if (p.state === 2 && (pr.bottom < vr.top - margin * 2.5 || pr.top > vr.bottom + margin * 2.5)) {
          // 遠く離れたページはCanvasメモリを解放
          p.cv.width = 1;
          p.cv.height = 1;
          p.tl.innerHTML = '';
          p.hl.innerHTML = '';
          p.state = 0;
        }
      });
    }

    function enqueuePdfPageRender(p, gen) {
      if (!p || !viewerState.pdfDoc || gen !== viewerState.renderGen || p.state !== 0) return;
      if (!renderQueue.some(x => x.p === p && x.gen === gen)) {
        renderQueue.push({ p, gen });
      }
      pumpPdfRenderQueue();
    }

    function pumpPdfRenderQueue() {
      while (activeRenders < 2 && renderQueue.length) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < renderQueue.length; i++) {
          const it = renderQueue[i];
          if (it.gen !== viewerState.renderGen || it.p.state !== 0) { bestIdx = i; break; }
          const d = Math.abs(it.p.n - viewerState.pdfPage);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        const item = renderQueue.splice(bestIdx, 1)[0];
        if (!item || item.gen !== viewerState.renderGen || !viewerState.pdfDoc || item.p.state !== 0) continue;
        item.p.state = 1;
        activeRenders++;
        renderSinglePdfPage(item.p, item.gen).finally(() => {
          activeRenders = Math.max(0, activeRenders - 1);
          if (renderQueue.length) setTimeout(pumpPdfRenderQueue, 0);
        });
      }
    }

    async function renderSinglePdfPage(p, gen) {
      if (gen !== viewerState.renderGen || !viewerState.pdfDoc || p.state !== 1) return;
      try {
        const page = await viewerState.pdfDoc.getPage(p.n);
        if (gen !== viewerState.renderGen || p.state !== 1) return;
        const vp = page.getViewport({ scale: viewerState.pdfZoom });
        const dpr = window.devicePixelRatio || 1;
        const cScale = clampPdfCanvasScale(vp.width, vp.height, dpr);
        p.cv.width = Math.max(1, Math.floor(vp.width * cScale));
        p.cv.height = Math.max(1, Math.floor(vp.height * cScale));
        p.cv.style.width = vp.width + 'px';
        p.cv.style.height = vp.height + 'px';
        p.vp = vp;

        const ctx = p.cv.getContext('2d');
        const task = page.render({
          canvasContext: ctx,
          viewport: vp,
          transform: cScale !== 1 ? [cScale, 0, 0, cScale, 0, 0] : null
        });
        p.task = task;
        activeRenderTasks.add(task);
        try { await task.promise; } finally { activeRenderTasks.delete(task); if (p.task === task) p.task = null; }
        if (gen !== viewerState.renderGen || p.state !== 1) return;

        const tc = await page.getTextContent();
        if (gen !== viewerState.renderGen || p.state !== 1) return;
        p.items = tc.items || [];
        p.tl.innerHTML = '';

        const lib = await loadPdfjsLib().catch(() => null);
        if (lib && typeof lib.renderTextLayer === 'function') {
          try {
            const tTask = lib.renderTextLayer({
              textContentSource: tc,
              container: p.tl,
              viewport: vp,
              textDivs: []
            });
            p.textTask = tTask;
            if (tTask && tTask.promise) await tTask.promise;
          } catch (_) {
            buildFallbackTextLayer(p);
          } finally {
            p.textTask = null;
          }
        } else {
          buildFallbackTextLayer(p);
        }

        if (gen !== viewerState.renderGen || p.state !== 1) return;
        p.state = 2;
        drawPdfSearchHighlights(p);
      } catch (err) {
        if (gen === viewerState.renderGen && p.state === 1) p.state = 0;
      }
    }

    function buildFallbackTextLayer(p) {
      if (!p || !p.tl || !p.vp) return;
      p.tl.innerHTML = '';
      (p.items || []).forEach(it => {
        if (!it || !it.str || !it.transform) return;
        const tx = matMul(p.vp.transform, it.transform);
        const fh = Math.hypot(tx[2], tx[3]);
        const sp = document.createElement('span');
        sp.textContent = it.str;
        sp.style.cssText = `position:absolute;left:${tx[4]}px;top:${tx[5] - fh * 0.88}px;font-size:${fh}px;line-height:1;white-space:pre;color:transparent;cursor:text;user-select:text;`;
        p.tl.appendChild(sp);
      });
    }

    function detectCurrentPdfPage() {
      const vpEl = $('postDocViewport');
      if (!vpEl || !viewerState.pdfPages.length) return 1;
      const top = vpEl.getBoundingClientRect().top + 36;
      for (const p of viewerState.pdfPages) {
        if (p.el.getBoundingClientRect().bottom > top) return p.n;
      }
      return viewerState.pdfPages.length;
    }

    function scrollToPdfPage(pageNo, skipCheck) {
      if (viewerState.mode !== 'pdf' || !viewerState.pdfDoc) return;
      const n = Math.min(viewerState.pdfDoc.numPages, Math.max(1, Math.round(Number(pageNo) || 1)));
      viewerState.pdfPage = n;
      const p = viewerState.pdfPages[n - 1];
      const vpEl = $('postDocViewport');
      if (p && vpEl) {
        viewerState.scrollLockUntil = Date.now() + 260;
        vpEl.scrollTop = p.el.offsetTop - 8;
      }
      updateViewerControlsUI();
      if (!skipCheck) evaluateVisiblePdfPages();
    }

    function setViewerZoom(nextZoom, isFit) {
      if (viewerState.mode === 'pdf' && viewerState.pdfDoc) {
        viewerState.pdfPage = detectCurrentPdfPage();
        viewerState.pdfFitMode = !!isFit;
        const z = Math.min(3.5, Math.max(0.4, Math.round(nextZoom * 100) / 100));
        if (z === viewerState.pdfZoom && viewerState.pdfPages.length) {
          updateViewerControlsUI();
          return;
        }
        viewerState.pdfZoom = z;
        layoutPdfPages(viewerState.pdfPage);
      } else if (viewerState.mode === 'text') {
        const z = isFit ? 1.0 : Math.min(2.2, Math.max(0.65, Math.round(nextZoom * 100) / 100));
        viewerState.textZoom = z;
        const body = $('postDocTextBody');
        if (body) body.style.fontSize = `${Math.round(13.5 * z)}px`;
        updateViewerControlsUI();
      }
    }

    function fitPdfWidth() {
      if (viewerState.mode === 'text') {
        setViewerZoom(1.0, true);
        return;
      }
      if (viewerState.mode !== 'pdf' || !viewerState.pdfDoc || !viewerState.pdfSizes.length) return;
      const vpEl = $('postDocViewport');
      if (!vpEl || vpEl.clientWidth < 60) return;
      const curIdx = Math.max(0, (viewerState.pdfPage || 1) - 1);
      const baseW = (viewerState.pdfSizes[curIdx] || viewerState.pdfSizes[0]).w || 595;
      setViewerZoom((vpEl.clientWidth - 24) / baseW, true);
    }

    // ---- 7. TXT / MD / HTML 表示とキーワード検索ハイライト ----
    function renderTextDocBody() {
      const body = $('postDocTextBody');
      if (!body) return;
      body.style.fontSize = `${Math.round(13.5 * viewerState.textZoom)}px`;
      const src = viewerState.textContent || '';
      const q = viewerState.searchQuery.trim();
      if (!q) {
        body.textContent = src;
        return;
      }
      const qLow = q.toLowerCase();
      const srcLow = src.toLowerCase();
      let html = '';
      let from = 0;
      let hitIdx = 0;
      let at;
      while ((at = srcLow.indexOf(qLow, from)) >= 0 && hitIdx < 1000) {
        if (at > from) html += escapeHTML(src.slice(from, at));
        const matched = src.slice(at, at + q.length);
        const isCur = hitIdx === viewerState.searchIdx;
        html += `<mark class="post-doc-mark${isCur ? ' is-current' : ''}" data-doc-hit="${hitIdx}">${escapeHTML(matched)}</mark>`;
        from = at + Math.max(1, q.length);
        hitIdx++;
      }
      if (from < src.length) html += escapeHTML(src.slice(from));
      body.innerHTML = html;
    }

    // ---- 8. キーワード検索（PDF & TXT共通） ----
    async function ensurePdfTextScanned() {
      if (viewerState.pdfScanData) return viewerState.pdfScanData;
      if (viewerState.pdfScanPromise) return viewerState.pdfScanPromise;
      const doc = viewerState.pdfDoc;
      if (!doc) return null;
      viewerState.pdfScanPromise = (async () => {
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
          if (viewerState.pdfDoc !== doc) return null;
          const pg = await doc.getPage(i);
          const tc = await pg.getTextContent();
          const starts = [];
          let text = '';
          (tc.items || []).forEach(it => {
            const s = typeof it.str === 'string' ? it.str : '';
            starts.push(text.length);
            text += s;
          });
          pages.push({ text, starts, items: tc.items || [] });
          if (i % 20 === 0) await new Promise(r => setTimeout(r, 0));
        }
        if (viewerState.pdfDoc === doc) viewerState.pdfScanData = pages;
        return pages;
      })();
      return viewerState.pdfScanPromise;
    }

    function scheduleViewerSearch(delayMs = 180) {
      clearTimeout(viewerState.searchTimer);
      viewerState.searchTimer = setTimeout(() => runViewerSearch(), delayMs);
    }

    async function runViewerSearch() {
      const inp = $('postDocSearchInput');
      const q = (inp ? inp.value : '').trim();
      viewerState.searchQuery = q;
      viewerState.searchHits = [];
      viewerState.searchIdx = -1;

      if (!q || viewerState.mode === 'empty') {
        if (viewerState.mode === 'text') renderTextDocBody();
        else if (viewerState.mode === 'pdf') viewerState.pdfPages.forEach(p => { if (p.hl) p.hl.innerHTML = ''; });
        updateViewerControlsUI();
        return;
      }

      const qLow = q.toLowerCase();
      if (viewerState.mode === 'text') {
        const srcLow = (viewerState.textContent || '').toLowerCase();
        let from = 0, at;
        while ((at = srcLow.indexOf(qLow, from)) >= 0 && viewerState.searchHits.length < 1000) {
          viewerState.searchHits.push({ index: at, length: q.length });
          from = at + Math.max(1, q.length);
        }
        viewerState.searchIdx = viewerState.searchHits.length ? 0 : -1;
        renderTextDocBody();
        updateViewerControlsUI();
        if (viewerState.searchIdx >= 0) focusCurrentSearchHit();
        return;
      }

      if (viewerState.mode === 'pdf' && viewerState.pdfDoc) {
        const cntEl = $('postDocSearchCount');
        if (cntEl) cntEl.textContent = '検索中...';
        const scanPages = await ensurePdfTextScanned();
        if (!scanPages || viewerState.searchQuery !== q) return;

        scanPages.forEach((pg, pi) => {
          const lo = pg.text.toLowerCase();
          let from = 0, at;
          while ((at = lo.indexOf(qLow, from)) >= 0 && viewerState.searchHits.length < 800) {
            from = at + Math.max(1, qLow.length);
            const end = at + qLow.length;
            const parts = [];
            for (let k = 0; k < pg.starts.length; k++) {
              const s0 = pg.starts[k];
              const s1 = k + 1 < pg.starts.length ? pg.starts[k + 1] : pg.text.length;
              if (s1 <= at) continue;
              if (s0 >= end) break;
              const a = Math.max(at, s0), b = Math.min(end, s1);
              if (b > a) parts.push({ item: k, matchIndex: a - s0, matchLength: b - a, strLength: s1 - s0 });
            }
            if (parts.length) viewerState.searchHits.push({ page: pi + 1, parts });
          }
        });

        let firstIdx = viewerState.searchHits.findIndex(h => h.page >= viewerState.pdfPage);
        if (firstIdx < 0) firstIdx = viewerState.searchHits.length ? 0 : -1;
        viewerState.searchIdx = firstIdx;
        updateViewerControlsUI();
        viewerState.pdfPages.forEach(p => { if (p.state === 2) drawPdfSearchHighlights(p); });
        if (firstIdx >= 0) focusCurrentSearchHit();
      }
    }

    function stepViewerSearchHit(delta) {
      if (!viewerState.searchHits.length) {
        if (viewerState.searchQuery.trim()) runViewerSearch();
        return;
      }
      viewerState.searchIdx = (viewerState.searchIdx + delta + viewerState.searchHits.length) % viewerState.searchHits.length;
      updateViewerControlsUI();
      focusCurrentSearchHit();
    }

    function focusCurrentSearchHit() {
      if (viewerState.searchIdx < 0 || !viewerState.searchHits.length) return;
      if (viewerState.mode === 'text') {
        const body = $('postDocTextBody');
        if (!body) return;
        body.querySelectorAll('.post-doc-mark.is-current').forEach(el => el.classList.remove('is-current'));
        const curMark = body.querySelector(`.post-doc-mark[data-doc-hit="${viewerState.searchIdx}"]`);
        if (curMark) {
          curMark.classList.add('is-current');
          curMark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return;
      }
      if (viewerState.mode === 'pdf') {
        const hit = viewerState.searchHits[viewerState.searchIdx];
        if (!hit) return;
        if (hit.page !== viewerState.pdfPage) {
          scrollToPdfPage(hit.page, false);
        }
        viewerState.pdfPages.forEach(p => { if (p.state === 2) drawPdfSearchHighlights(p); });
        const targetPageObj = viewerState.pdfPages[hit.page - 1];
        if (targetPageObj) {
          if (targetPageObj.state === 0) enqueuePdfPageRender(targetPageObj, viewerState.renderGen);
          const curBox = targetPageObj.hl && targetPageObj.hl.querySelector('.post-doc-hl-box.is-current');
          if (curBox) scrollViewerToElement(curBox);
        }
      }
    }

    function drawPdfSearchHighlights(p) {
      if (!p || !p.hl) return;
      p.hl.innerHTML = '';
      if (!p.vp || !viewerState.searchHits.length) return;
      const sc = p.vp.scale;
      const curHit = viewerState.searchHits[viewerState.searchIdx];
      let curEl = null;
      viewerState.searchHits.forEach(h => {
        if (h.page !== p.n) return;
        const isCur = h === curHit;
        h.parts.forEach(pt => {
          const it = p.items[pt.item];
          if (!it || !it.transform || !pt.strLength) return;
          const tx = matMul(p.vp.transform, it.transform);
          const fh = Math.hypot(tx[2], tx[3]) || 12;
          const w = (it.width || (fh * pt.strLength * 0.6)) * sc;
          const hw = Math.max(4, w * (pt.matchLength / pt.strLength));
          const left = tx[4] + w * (pt.matchIndex / pt.strLength);
          const top = tx[5] - fh * 0.88;
          const box = document.createElement('div');
          box.className = 'post-doc-hl-box' + (isCur ? ' is-current' : '');
          box.style.cssText = `left:${left}px;top:${top}px;width:${hw}px;height:${fh * 1.12}px;`;
          p.hl.appendChild(box);
          if (isCur && !curEl) curEl = box;
        });
      });
    }

    function scrollViewerToElement(el) {
      const vpEl = $('postDocViewport');
      if (!vpEl || !el) return;
      viewerState.scrollLockUntil = Date.now() + 260;
      const vr = vpEl.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      vpEl.scrollTop += (er.top - vr.top) - Math.min(120, vr.height / 3);
    }

    // ---- 9. 選択テキストの取得・範囲選択（ラバーバンド）・スマート改行整形・ワンクリック転記/整形コピー ----
    function clearDocRectBoxes() {
      const pagesEl = $('postDocPages');
      if (pagesEl) pagesEl.querySelectorAll('.post-doc-rubberband').forEach(b => b.remove());
    }

    function setRectSelectMode(on) {
      viewerState.rectMode = !!on;
      viewerState.rectDrag = null;
      clearDocRectBoxes();
      const btn = $('postDocRectModeBtn');
      if (btn) {
        btn.classList.toggle('active', viewerState.rectMode);
        btn.setAttribute('aria-pressed', String(viewerState.rectMode));
      }
      viewerState.pdfPages.forEach(p => {
        if (p && p.el) p.el.classList.toggle('rect-mode', viewerState.rectMode);
      });
      if (viewerState.rectMode) {
        const sel = window.getSelection ? window.getSelection() : null;
        if (sel) sel.removeAllRanges();
        toast('▭ 範囲選択モードON：PDF上をドラッグして矩形範囲のテキストを抽出できます（2段組みの片側段の抽出に最適／Shift+ドラッグで追記）');
      }
    }

    async function extractRectTextFromPdfPage(p, rect) {
      if (!p || !viewerState.pdfDoc) return '';
      if ((!p.items || !p.items.length || !p.vp)) {
        try {
          const page = await viewerState.pdfDoc.getPage(p.n);
          if (!p.vp) p.vp = page.getViewport({ scale: viewerState.pdfZoom });
          if (!p.items || !p.items.length) {
            const tc = await page.getTextContent();
            p.items = tc.items || [];
          }
        } catch (_) { }
      }
      if (!p.vp || !p.items || !p.items.length) return '';
      if (window.CCFText && typeof CCFText.extractRectText === 'function') {
        const pageW = p.vp.width || 0;
        const pageH = p.vp.height || 0;
        const rectW = Math.abs((rect && rect.w) || 0);
        const isTwoCol = !(pageW > 0 && rectW < pageW * 0.55);
        return CCFText.extractRectText(p.items, p.vp.transform, p.vp.scale, rect, {
          excludeRuby: true,
          twoColumn: isTwoCol,
          noMargin: false,
          pageW,
          pageH
        }) || '';
      }
      // CCFText未読込時の座標順フォールバック抽出
      const x1 = Math.min(rect.x, rect.x + rect.w), x2 = Math.max(rect.x, rect.x + rect.w);
      const y1 = Math.min(rect.y, rect.y + rect.h), y2 = Math.max(rect.y, rect.y + rect.h);
      const hits = [];
      (p.items || []).forEach(it => {
        if (!it || !it.str || !it.transform) return;
        const tx = matMul(p.vp.transform, it.transform);
        const h = Math.hypot(tx[2], tx[3]) || 10;
        const w = (it.width || 0) * (p.vp.scale || 1);
        const cx = tx[4] + w * 0.5;
        const cy = tx[5] - h * 0.35;
        if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) {
          hits.push({ str: it.str, x0: tx[4], x1: tx[4] + w, y: cy, h });
        }
      });
      if (!hits.length) return '';
      hits.sort((a, b) => (Math.abs(a.y - b.y) <= Math.max(a.h, b.h) * 0.5 ? a.x0 - b.x0 : a.y - b.y));
      const lines = [];
      hits.forEach(c => {
        const ln = lines.find(l => Math.abs(l.y - c.y) <= Math.max(l.h, c.h) * 0.5);
        if (ln) { ln.chunks.push(c); ln.y = (ln.y * (ln.chunks.length - 1) + c.y) / ln.chunks.length; ln.h = Math.max(ln.h, c.h); }
        else lines.push({ y: c.y, h: c.h, chunks: [c] });
      });
      lines.sort((a, b) => a.y - b.y);
      return lines.map(l => {
        l.chunks.sort((a, b) => a.x0 - b.x0);
        return l.chunks.map(c => c.str).join('');
      }).join('\n');
    }

    function extractSelectedTextFromViewer() {
      const vpEl = $('postDocViewport');
      if (!vpEl) return '';
      if (viewerState.rectMode && viewerState.lastRectText && viewerState.lastRectText.trim()) {
        return viewerState.lastRectText;
      }
      const sel = window.getSelection ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
        const focus = sel.focusNode && (sel.focusNode.nodeType === 1 ? sel.focusNode : sel.focusNode.parentElement);
        if ((anchor && vpEl.contains(anchor)) || (focus && vpEl.contains(focus))) {
          if (viewerState.mode === 'pdf' && window.CCFText && typeof CCFText.extractRectText === 'function') {
            try {
              const rects = [...sel.getRangeAt(0).getClientRects()].filter(r => r.width > 1 && r.height > 1);
              const byPage = new Map();
              rects.forEach(r => {
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                const p = viewerState.pdfPages.find(q => {
                  const b = q.el.getBoundingClientRect();
                  return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
                });
                if (!p || !p.vp || !p.items.length) return;
                const b = p.el.getBoundingClientRect();
                if (!byPage.has(p)) byPage.set(p, []);
                byPage.get(p).push({ x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height });
              });
              if (byPage.size > 0) {
                const ordered = [...byPage].sort((a, b) => a[0].n - b[0].n);
                const coordText = ordered.map(([p, rs]) => CCFText.extractRectText(p.items, p.vp.transform, p.vp.scale, rs, { excludeRuby: true, twoColumn: true, noMargin: false })).filter(Boolean).join('\n');
                if (coordText && coordText.trim()) return coordText;
              }
            } catch (_) { }
          }
          const raw = sel.toString();
          if (raw && raw.trim()) return raw;
        }
      }
      return viewerState.lastSelectedText || '';
    }

    function formatTransferredText(raw) {
      let s = String(raw == null ? '' : raw);
      if (!s.trim()) return '';
      if (window.CCFText && typeof CCFText.cleanText === 'function') {
        s = CCFText.cleanText(s, { joinLines: 'smart', stripSpaces: true });
      } else {
        s = s.replace(/\r\n?/g, '\n')
          .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF\f\v]/g, '')
          .replace(/\u00A0/g, ' ')
          .replace(/\t/g, ' ');
        const rawLines = s.split('\n').map(l => l.replace(/\s+$/, ''));
        const maxLineChars = Math.max(0, ...rawLines.map(l => Array.from(l.trim()).length));
        const termRe = /[。．｡！？!?」』）)】］〕〉》…‥―ー〜~”"']$/;
        const headBaseRe = /^(?:[・●○◎■□◆◇▲△▼▽★☆※【『「（(〔〈《①-⑳―ー─━＊*#＃▶►→⇒⇔§†‡]|[0-9０-９]+[\.．、）)\]:：]|第[0-9０-９一二三四五六七八九十百千]+[章節話幕部回篇])/i;
        const roleDelimRe = /^(?:HO|ＨＯ|PC|ＰＣ|KP|ＫＰ|GM|ＧＭ|PL|ＰＬ|NPC|ＮＰＣ)(?:[0-9０-９一二三四五六七八九十]+)?\s*[:：・【「『（(/／―─-]/i;
        const roleLabelRe = /^(?:HO|ＨＯ|PC|ＰＣ|KP|ＫＰ|GM|ＧＭ|PL|ＰＬ|NPC|ＮＰＣ)(?:[0-9０-９一二三四五六七八九十]+)?(?![A-Za-zＡ-Ｚａ-ｚ])/i;
        const roleBadRe = /[。、．，！？]|(?:から|まで)|[のはがをにへともでや]/;
        const isHeadLine = ln => {
          const t = String(ln || '').trim();
          if (!t) return false;
          if (headBaseRe.test(t) || roleDelimRe.test(t)) return true;
          return roleLabelRe.test(t) && Array.from(t).length <= 12 && !roleBadRe.test(t);
        };
        const isColonLine = ln => /[：:]/.test(String(ln || '').replace(/https?:\/\/\S+/gi, ''));
        const shouldKeepBreak = (prev, next, nextIndented) => {
          const p = String(prev || '').trim(), n = String(next || '').trim();
          if (!p || !n || nextIndented) return true;
          if (termRe.test(p)) return true;
          if (isHeadLine(n) || isColonLine(n)) return true;
          if (isColonLine(p)) return true;
          const pLen = Array.from(p).length;
          if (pLen <= 24 || (maxLineChars > 0 && pLen < maxLineChars * 0.78)) return true;
          return false;
        };
        const out = [];
        let acc = '';
        let prevRawLine = '';
        rawLines.forEach(rawLn => {
          const line = rawLn.trim();
          const indented = /^(?:[\u3000]|[ ]{2,})/.test(rawLn);
          if (!line) {
            if (acc) { out.push(acc); acc = ''; prevRawLine = ''; }
            if (out.length && out[out.length - 1] !== '') out.push('');
            return;
          }
          if (!acc) { acc = line; prevRawLine = line; return; }
          if (shouldKeepBreak(prevRawLine, line, indented)) {
            out.push(acc);
            acc = line;
          } else {
            const joiner = (/[A-Za-z0-9,.;:]$/.test(acc) && /^[A-Za-z0-9]/.test(line)) ? ' ' : '';
            acc += joiner + line;
          }
          prevRawLine = line;
        });
        if (acc) out.push(acc);
        s = out.join('\n');
      }
      // PDF特有の日本語文字間の不自然な半角スペース（「シ ナ リ オ」等）のみを除去し、英単語間のスペースは保持
      const cjkSpaceRe = /([\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF00-\uFFEF]) +(?=[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF00-\uFFEF])/g;
      s = s.split('\n').map(line => {
        let ln = line.replace(/ {2,}/g, ' ').replace(/[ \t]+$/, '');
        let prev;
        do { prev = ln; ln = ln.replace(cjkSpaceRe, '$1'); } while (ln !== prev);
        return ln;
      }).join('\n');
      return s.trim();
    }

    function appendOrSetText(currentVal, addText) {
      const prev = String(currentVal == null ? '' : currentVal).replace(/\s+$/, '');
      return prev ? `${prev}\n${addText}` : addText;
    }

    function flashTargetInput(el) {
      if (!el) return;
      try {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const origOutline = el.style.outline;
        const origTransition = el.style.transition;
        el.style.transition = 'outline 0.2s, box-shadow 0.2s';
        el.style.outline = '2px solid var(--dc-green, #23a55a)';
        setTimeout(() => {
          el.style.outline = origOutline;
          el.style.transition = origTransition;
        }, 1100);
      } catch (_) { }
    }

    function findOrCreateTargetBlock(kind) {
      const isSynopsis = kind === 'synopsis';
      const matchRe = isSynopsis ? SYNOPSIS_BLOCK_RE : NOTES_BLOCK_RE;
      let block = blockOrder.find(b => {
        if (!b || b.type === 'summary_container' || b.type === 'image' || b.type === 'split') return false;
        const kn = String(b.keyName !== undefined && b.keyName !== null ? b.keyName : (b.label || '')).trim();
        if (isSynopsis) {
          if (b.id === 'notes') return false;
          return matchRe.test(kn) || ((b.id === 'intro' || b.id === 'synopsis' || b.id === 'story') && !NOTES_BLOCK_RE.test(kn));
        }
        return matchRe.test(kn) || b.id === 'notes';
      });
      if (!block) {
        if (isSynopsis) {
          block = {
            id: 'intro',
            type: 'textarea',
            label: 'イントロダクション',
            keyName: 'あらすじ',
            val: '',
            sectionType: 'standalone',
            collapsed: false,
            isCustom: true,
            decorStyle: 'default'
          };
          const sumIdx = blockOrder.findIndex(b => b && b.type === 'summary_container');
          if (sumIdx >= 0) blockOrder.splice(sumIdx + 1, 0, block);
          else blockOrder.unshift(block);
        } else {
          block = {
            id: 'notes',
            type: 'textarea',
            label: '注意事項・備考',
            keyName: '注意事項・備考',
            val: '',
            sectionType: 'standalone',
            collapsed: false,
            isCustom: false,
            decorStyle: 'default'
          };
          blockOrder.push(block);
        }
      }
      return block;
    }

    async function copyCleanedTextToClipboard(cleaned) {
      let ok = false;
      try {
        await navigator.clipboard.writeText(cleaned);
        ok = true;
      } catch (_) {
        try {
          const ta = document.createElement('textarea');
          ta.value = cleaned;
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          ta.remove();
        } catch (_2) { }
      }
      toast(ok ? '📋 整形済みテキストをクリップボードにコピーしました' : '❌ クリップボードへのコピーに失敗しました');
    }

    function transferSelectedTextToField(targetKind) {
      const raw = extractSelectedTextFromViewer();
      const cleaned = formatTransferredText(raw);
      if (!cleaned) {
        return toast('⚠️ ビューワ内でテキストをドラッグ選択（または「▭ 範囲選択」で矩形選択）してください');
      }

      if (targetKind === 'copy') {
        void copyCleanedTextToClipboard(cleaned);
        return;
      }

      // 秘匿HOタブを開いている場合は公開情報タブへ戻す
      if (typeof activeHO !== 'undefined' && activeHO >= 0 && typeof renderHoAll === 'function') {
        activeHO = -1;
        renderHoAll();
      }

      if (targetKind === 'catchcopy') {
        if (typeof togglePostAccCard === 'function') togglePostAccCard('basicInfoCard', true);
        const trailerEl = $('topTrailer');
        if (!trailerEl) return;
        trailerEl.value = appendOrSetText(trailerEl.value, cleaned);
        renderPreview();
        flashTargetInput(trailerEl);
        toast('✅ 選択テキストを「トレーラー・キャッチコピー」へ反映しました');
        return;
      }

      if (targetKind === 'synopsis' || targetKind === 'notes') {
        const blk = findOrCreateTargetBlock(targetKind);
        blk.collapsed = false;
        blk.val = appendOrSetText(blk.val, cleaned);
        renderBlockUI();
        renderPreview();
        const ta = $(blk.id);
        if (ta) flashTargetInput(ta);
        const label = (blk.keyName && blk.keyName.trim()) || blk.label || (targetKind === 'synopsis' ? 'あらすじ' : '注意事項・備考');
        toast(`✅ 選択テキストを「${label}」へ反映しました`);
      }
    }

    // ---- 10. イベント配線・初期化 ----
    function initPostDocViewer() {
      wireRightAccordion();
      wirePostCardAccordions();
      if (viewerState.wired) {
        refreshPostDocList({ autoOpen: true });
        return;
      }
      const vpEl = $('postDocViewport');
      if (!vpEl) return;
      viewerState.wired = true;

      // プルダウン選択で即座に閲覧
      $('postDocSelect')?.addEventListener('change', e => {
        const val = e.target.value;
        if (val) openPostDoc(val);
        else clearPostDocViewer();
      });

      // 📂 ファイルを開くボタン
      $('postDocOpenBtn')?.addEventListener('click', () => {
        const fi = $('postDocFileInput');
        if (fi) { fi.value = ''; fi.click(); }
      });
      $('postDocFileInput')?.addEventListener('change', e => {
        const f = e.target.files && e.target.files[0];
        if (f) openPostDocFromFile(f);
      });

      // ▭ 範囲選択トグルボタン
      $('postDocRectModeBtn')?.addEventListener('click', () => {
        setRectSelectMode(!viewerState.rectMode);
      });

      // ワンクリック転記・整形コピーボタン（mousedownで選択解除を防ぐ）
      document.querySelectorAll('[data-doc-transfer]').forEach(btn => {
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', () => transferSelectedTextToField(btn.dataset.docTransfer));
      });

      // PDFページ上の矩形範囲選択（ラバーバンド）ドラッグ処理
      const pagesEl = $('postDocPages');
      if (pagesEl) {
        pagesEl.addEventListener('mousedown', e => {
          if (!viewerState.rectMode || viewerState.mode !== 'pdf' || e.button !== 0) return;
          const pageEl = e.target.closest('.post-doc-page');
          if (!pageEl) return;
          const pNo = Number(pageEl.dataset.page);
          const p = viewerState.pdfPages[pNo - 1];
          if (!p || !p.rl) return;
          e.preventDefault();
          if (!e.shiftKey) {
            clearDocRectBoxes();
            viewerState.lastRectText = '';
          }
          const r = pageEl.getBoundingClientRect();
          const startX = Math.min(Math.max(0, e.clientX - r.left), r.width);
          const startY = Math.min(Math.max(0, e.clientY - r.top), r.height);
          const box = document.createElement('div');
          box.className = 'post-doc-rubberband';
          box.style.left = startX + 'px';
          box.style.top = startY + 'px';
          box.style.width = '0px';
          box.style.height = '0px';
          p.rl.appendChild(box);
          viewerState.rectDrag = { p, startX, startY, box, shift: !!e.shiftKey };
        });
      }

      window.addEventListener('mousemove', e => {
        const d = viewerState.rectDrag;
        if (!d || !d.p || !d.p.el) return;
        const r = d.p.el.getBoundingClientRect();
        const x = Math.min(Math.max(0, e.clientX - r.left), r.width);
        const y = Math.min(Math.max(0, e.clientY - r.top), r.height);
        d.box.style.left = Math.min(d.startX, x) + 'px';
        d.box.style.top = Math.min(d.startY, y) + 'px';
        d.box.style.width = Math.abs(x - d.startX) + 'px';
        d.box.style.height = Math.abs(y - d.startY) + 'px';
      });

      window.addEventListener('mouseup', async e => {
        const d = viewerState.rectDrag;
        if (!d) return;
        viewerState.rectDrag = null;
        const rect = {
          x: parseFloat(d.box.style.left) || 0,
          y: parseFloat(d.box.style.top) || 0,
          w: parseFloat(d.box.style.width) || 0,
          h: parseFloat(d.box.style.height) || 0
        };
        if (rect.w < 5 || rect.h < 5) {
          d.box.remove();
          return;
        }
        d.box.classList.add('is-done');
        const extracted = await extractRectTextFromPdfPage(d.p, rect);
        if (!extracted || !extracted.trim()) {
          toast('⚠️ 選択した矩形範囲内にテキストが見つかりませんでした');
          return;
        }
        if ((d.shift || e.shiftKey) && viewerState.lastRectText) {
          viewerState.lastRectText = viewerState.lastRectText + '\n' + extracted;
        } else {
          viewerState.lastRectText = extracted;
        }
        viewerState.lastSelectedText = viewerState.lastRectText;
        toast('▭ 範囲内のテキストを選択しました（上の転記ボタンまたは「[📋 整形コピー]」で反映できます）');
      });

      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && viewerState.rectMode) {
          clearDocRectBoxes();
          viewerState.lastRectText = '';
        }
      });

      // ページ送り・ページ番号指定
      $('postDocPrevPage')?.addEventListener('click', () => scrollToPdfPage(viewerState.pdfPage - 1));
      $('postDocNextPage')?.addEventListener('click', () => scrollToPdfPage(viewerState.pdfPage + 1));
      $('postDocPageInput')?.addEventListener('change', e => scrollToPdfPage(e.target.value));
      $('postDocPageInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          scrollToPdfPage(e.target.value);
        }
      });

      // ズーム（縮小 / 拡大 / 幅合わせ）
      $('postDocZoomOut')?.addEventListener('click', () => {
        const cur = viewerState.mode === 'pdf' ? viewerState.pdfZoom : viewerState.textZoom;
        setViewerZoom(cur - 0.15, false);
      });
      $('postDocZoomIn')?.addEventListener('click', () => {
        const cur = viewerState.mode === 'pdf' ? viewerState.pdfZoom : viewerState.textZoom;
        setViewerZoom(cur + 0.15, false);
      });
      $('postDocZoomFit')?.addEventListener('click', () => fitPdfWidth());

      // キーワード検索
      $('postDocSearchInput')?.addEventListener('input', () => scheduleViewerSearch(160));
      $('postDocSearchInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          stepViewerSearchHit(e.shiftKey ? -1 : 1);
        }
      });
      $('postDocSearchPrev')?.addEventListener('click', () => stepViewerSearchHit(-1));
      $('postDocSearchNext')?.addEventListener('click', () => stepViewerSearchHit(1));

      // スクロール時のページ追従 & 遅延描画チェック
      let scrollTimer = null;
      vpEl.addEventListener('scroll', () => {
        if (viewerState.mode !== 'pdf' || !viewerState.pdfDoc) return;
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          if (Date.now() >= viewerState.scrollLockUntil) {
            const pNo = detectCurrentPdfPage();
            if (pNo !== viewerState.pdfPage) {
              viewerState.pdfPage = pNo;
              updateViewerControlsUI();
            }
          }
          evaluateVisiblePdfPages();
        }, 45);
      });

      // Ctrl + ホイールでズーム
      vpEl.addEventListener('wheel', e => {
        if (!e.ctrlKey || viewerState.mode === 'empty') return;
        e.preventDefault();
        const cur = viewerState.mode === 'pdf' ? viewerState.pdfZoom : viewerState.textZoom;
        setViewerZoom(cur + (e.deltaY < 0 ? 0.12 : -0.12), false);
      }, { passive: false });

      // ビューワ内のテキスト選択を保持（ボタン押下時に選択が外れても転記できるように）
      const captureSelection = () => {
        if (viewerState.rectMode) return;
        const sel = window.getSelection ? window.getSelection() : null;
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
        const focus = sel.focusNode && (sel.focusNode.nodeType === 1 ? sel.focusNode : sel.focusNode.parentElement);
        if ((anchor && vpEl.contains(anchor)) || (focus && vpEl.contains(focus))) {
          viewerState.lastRectText = '';
          const txt = extractSelectedTextFromViewer();
          if (txt && txt.trim()) viewerState.lastSelectedText = txt;
        }
      };
      vpEl.addEventListener('mouseup', () => setTimeout(captureSelection, 10));
      vpEl.addEventListener('keyup', captureSelection);
      document.addEventListener('selectionchange', captureSelection);

      // ドラッグ＆ドロップ直接読み込み
      const dropHost = $('docViewerAccPanel') || vpEl;
      dropHost.addEventListener('dragover', e => {
        const types = [...((e.dataTransfer && e.dataTransfer.types) || [])];
        if (types.includes('Files') || types.includes('text/ccf-path')) {
          e.preventDefault();
          e.stopPropagation();
          vpEl.classList.add('is-dragover');
        }
      });
      dropHost.addEventListener('dragleave', e => {
        if (!dropHost.contains(e.relatedTarget)) vpEl.classList.remove('is-dragover');
      });
      dropHost.addEventListener('drop', async e => {
        vpEl.classList.remove('is-dragover');
        const dt = e.dataTransfer;
        if (!dt) return;
        const ccfPath = dt.getData('text/ccf-path');
        if (ccfPath && (SUPPORTED_DOC_RE.test(ccfPath) || /\.zip$/i.test(ccfPath))) {
          e.preventDefault();
          e.stopPropagation();
          unignoreScenarioDocName(baseNameOf(ccfPath));
          viewerState.manualDocs.set(ccfPath, { value: ccfPath, name: baseNameOf(ccfPath), ext: extOf(ccfPath) });
          await refreshPostDocList({ keepManual: true, autoOpen: false });
          await openPostDoc(ccfPath);
          return;
        }
        const files = [...(dt.files || [])];
        const docFile = files.find(f => SUPPORTED_DOC_RE.test(f.name || '') || /\.zip$/i.test(f.name || '') || f.type === 'application/pdf' || (f.type && f.type.startsWith('text/')));
        if (docFile) {
          e.preventDefault();
          e.stopPropagation();
          await openPostDocFromFile(docFile);
        }
      });

      // 素材更新イベント（下部資料カードやココフォリア側で資料追加時）に自動追従
      window.addEventListener('ccf-refs-changed', () => {
        refreshPostDocList({ keepManual: true, autoOpen: false });
      });

      refreshPostDocList({ autoOpen: true });
    }
    window.initPostDocViewer = initPostDocViewer;
  })();


