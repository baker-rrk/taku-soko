/* app_test49_13_shell.js — 左サイドバー＋右メインのレイアウトまわり（ページ名・検索バー・絞り込みタグ・ホームのカード拡張・D&D統合・ライブラリ取込） */
const shEl = id => document.getElementById(id);
let dbTagSel = new Set();   // サイドバーで選んだ絞り込みタグ
const PAGE_NAMES = { databaseTab: '🏠 ホーム', postTab: '📝 Discord投稿・編集', galleryTab: '🖼️ 共通ギャラリー', historyTab: '📜 投稿履歴（全体）' };
(function () {
  const st = switchTab; switchTab = function (tabId, evt) { if (tabId === 'ccfTab' && document.body && document.body.dataset.activeTab === 'ccfTab') return; st(tabId, evt); const pn = shEl('pageName'); if (pn) pn.textContent = PAGE_NAMES[tabId] || ''; if (tabId === 'galleryTab' || tabId === 'postTab') { try { if (typeof window.flushGalleryOnTabSwitch === 'function') window.flushGalleryOnTabSwitch(); else if (tabId === 'galleryTab' && typeof renderGalleryAll === 'function') renderGalleryAll(); } catch (er) { console.error(er); } } const m = shEl('mainArea'); if (m) m.scrollTop = 0; };   // 切り替えたら、ページ名を更新して先頭へ（同期ディスク保存は行わない）

  setSettingsTab = window.setSettingsTab = function (tab) {
    const m = document.getElementById('settingsModal'); if (!m) return;
    const valid = (tab === 'discord' || tab === 'cloud' || tab === 'appearance') ? tab : 'appearance';
    m.querySelectorAll('[data-set-pane]').forEach(p => { p.hidden = p.dataset.setPane !== valid; });
    m.querySelectorAll('[data-set-tab]').forEach(b => { const on = b.dataset.setTab === valid; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const b = m.querySelector('[data-set-pane]:not([hidden])'); if (b) b.scrollTop = 0;
    if (valid === 'cloud' && window.CloudSync && typeof window.CloudSync.renderSettingsUI === 'function') {
      window.CloudSync.renderSettingsUI();
    }
  };
  openSettingsModal = window.openSettingsModal = function (tab) {
    const m = document.getElementById('settingsModal'); if (!m) return;
    if (typeof renderChannelConfigList === 'function') renderChannelConfigList();
    const targetTab = (tab === 'appearance' || tab === 'cloud' || tab === 'discord') ? tab : 'discord';
    setSettingsTab(targetTab);
    m.classList.add('open');
    if (typeof window.refreshAppearanceButtons === 'function') window.refreshAppearanceButtons();
    if (window.CloudSync && typeof window.CloudSync.renderSettingsUI === 'function') window.CloudSync.renderSettingsUI();
  };

  function cardThumbStyle(sc) {
    const ts = (sc && sc.thumbSettings) || {};
    const x = clampThumbNum(sc && sc.thumbPosX !== undefined ? sc.thumbPosX : ts.posX, 0, 100, 50);
    const y = clampThumbNum(sc && sc.thumbPosY !== undefined ? sc.thumbPosY : ts.posY, 0, 100, 50);
    const z = clampThumbNum(sc && sc.thumbZoom !== undefined ? sc.thumbZoom : ts.zoom, 25, 250, 100);
    const fit = ((sc && sc.thumbFit === 'contain') || ts.fit === 'contain') ? 'contain' : 'cover';
    const useContain = fit === 'contain' || z < 100;
    return `object-fit:${useContain ? 'contain' : 'cover'}; object-position:${x}% ${y}%; transform:scale(${(z / 100).toFixed(2)}); transform-origin:${x}% ${y}%;`;
  }
  function getScenarioThumbSlots(sc) {
    if (!sc) return [];
    const out = [];
    const push = u => {
      const s = String(u || '').trim();
      if (s && !out.includes(s) && out.length < 4) out.push(s);
    };
    push(sc.imageUrl);
    if (Array.isArray(sc.hoverImages)) sc.hoverImages.forEach(push);
    return out;
  }
  function applyScenarioThumbSlots(sc, slots) {
    if (!sc) return [];
    const clean = [];
    (Array.isArray(slots) ? slots : []).forEach(u => {
      const s = String(u || '').trim();
      if (s && !clean.includes(s) && clean.length < 4) clean.push(s);
    });
    sc.imageUrl = clean[0] || '';
    sc.hoverImages = clean.slice(1, 4);
    sc.thumbSettings = {
      posX: clampThumbNum(sc.thumbPosX, 0, 100, 50),
      posY: clampThumbNum(sc.thumbPosY, 0, 100, 50),
      zoom: clampThumbNum(sc.thumbZoom, 25, 250, 100),
      fit: sc.thumbFit === 'contain' ? 'contain' : 'cover',
      spoilerBlur: !!sc.spoilerBlur
    };
    return clean;
  }
  window.getScenarioThumbSlots = getScenarioThumbSlots;
  window.applyScenarioThumbSlots = applyScenarioThumbSlots;
  window.cardThumbStyleStr = cardThumbStyle;

  const DB_CHUNK_SIZE = window.DB_CHUNK_SIZE || 60;
  let dbPageState = null, dbMoreObs = null;
  const selectedScenarioIds = new Set();
  let lastSelectedId = null, lastFilteredIds = [], lastSelShift = false;

  function updateBulkActionBar() {
    const valid = new Set((appState.scenarios || []).map(s => String(s.id)));
    [...selectedScenarioIds].forEach(id => { if (!valid.has(id)) selectedScenarioIds.delete(id); });
    const n = selectedScenarioIds.size;
    const bar = shEl('dbBulkBar');
    if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
    const cnt = shEl('dbBulkCount');
    if (cnt) cnt.textContent = String(n);
    const btnMerge = shEl('btnBulkMerge');
    if (btnMerge) {
      btnMerge.disabled = n < 2;
      btnMerge.textContent = `🔗 選択したシナリオを1つに統合（${n}件）`;
    }
    const btnDel = shEl('btnBulkDelete');
    if (btnDel) btnDel.textContent = `🗑️ 選択したシナリオを一括削除（${n}件）`;
    const allShownSel = lastFilteredIds.length > 0 && lastFilteredIds.every(id => selectedScenarioIds.has(id));
    const someShownSel = !allShownSel && lastFilteredIds.some(id => selectedScenarioIds.has(id));
    const btnAll = shEl('btnBulkToggleAll');
    if (btnAll) btnAll.textContent = allShownSel ? '☐ 表示中の選択を解除' : '☑ 表示中を全選択 / 解除';
    const headChk = shEl('dbTableHeadCheck');
    if (headChk) {
      headChk.checked = allShownSel;
      headChk.indeterminate = someShownSel;
    }
  }

  function syncVisibleSelectionDom() {
    document.querySelectorAll('#dbCardContainer .scenario-db-card[data-sid], #dbTableBody tr[data-sid]').forEach(el => {
      const id = String(el.dataset.sid || '');
      const on = selectedScenarioIds.has(id);
      el.classList.toggle('is-selected', on);
      const chk = el.querySelector('.db-sel-chk');
      if (chk) chk.checked = on;
    });
    updateBulkActionBar();
  }

  window.__dbSelectionApi = {
    getSelectedIds: () => [...selectedScenarioIds],
    clearSelection: () => { selectedScenarioIds.clear(); lastSelectedId = null; syncVisibleSelectionDom(); },
    toggleVisibleAll: () => {
      if (!lastFilteredIds.length) return;
      const allSel = lastFilteredIds.every(id => selectedScenarioIds.has(id));
      if (allSel) lastFilteredIds.forEach(id => selectedScenarioIds.delete(id));
      else lastFilteredIds.forEach(id => selectedScenarioIds.add(id));
      syncVisibleSelectionDom();
    }
  };

  function handleSelectionClick(e) {
    const lbl = e.target.closest && e.target.closest('.db-sel-label, .db-sel-label-tbl');
    const chk = e.target.closest && e.target.closest('.db-sel-chk');
    if (!lbl && !chk) return;
    e.stopPropagation();
    if (!chk) return;
    const id = String(chk.dataset.selId || '');
    if (!id) return;
    const checked = !!chk.checked;
    const isShift = !!(e.shiftKey || lastSelShift);
    lastSelShift = false;
    if (isShift && lastSelectedId && lastFilteredIds.includes(lastSelectedId) && lastFilteredIds.includes(id)) {
      const i1 = lastFilteredIds.indexOf(lastSelectedId), i2 = lastFilteredIds.indexOf(id);
      const lo = Math.min(i1, i2), hi = Math.max(i1, i2);
      for (let i = lo; i <= hi; i++) {
        if (checked) selectedScenarioIds.add(lastFilteredIds[i]);
        else selectedScenarioIds.delete(lastFilteredIds[i]);
      }
      lastSelectedId = id;
      syncVisibleSelectionDom();
      return;
    }
    if (checked) selectedScenarioIds.add(id); else selectedScenarioIds.delete(id);
    lastSelectedId = id;
    const row = chk.closest('[data-sid]');
    if (row) row.classList.toggle('is-selected', checked);
    updateBulkActionBar();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const cardBox = shEl('dbCardContainer');
    const tbody = shEl('dbTableBody');
    const headChk = shEl('dbTableHeadCheck');
    const recordShift = e => {
      if (e.target && e.target.closest && e.target.closest('.db-sel-label, .db-sel-label-tbl, .db-sel-chk')) {
        lastSelShift = !!e.shiftKey;
      }
    };
    if (cardBox) {
      cardBox.addEventListener('mousedown', recordShift);
      cardBox.addEventListener('click', handleSelectionClick);
    }
    if (tbody) {
      tbody.addEventListener('mousedown', recordShift);
      tbody.addEventListener('click', handleSelectionClick);
    }
    if (headChk) {
      headChk.addEventListener('click', e => {
        e.stopPropagation();
        window.__dbSelectionApi.toggleVisibleAll();
      });
    }
  });

  function renderCacheIconHtml(csInfo) {
    const st = (csInfo && csInfo.status) || 'cached';
    if (st === 'pinned') return '<span class="cloud-cache-icon status-pinned" title="この端末に常時保持（オフライン対応）">📌</span>';
    if (st === 'cloud_only') return '<span class="cloud-cache-icon status-cloud_only" title="クラウドに保管（開くと自動取得）">☁️</span>';
    return '<span class="cloud-cache-icon status-cached" title="この端末に保持済み">💻</span>';
  }

  function firstSpecLine(sc, f) {
    if (typeof getScenarioSpecFirstLine === 'function') return getScenarioSpecFirstLine(sc, f);
    return String((sc && sc[f]) || '').split(/\r?\n/)[0].trim();
  }

  function renderScenarioCardHtml(sc) {
    const postBadge = (typeof formatScenarioPostedBadge === 'function')
      ? formatScenarioPostedBadge(sc)
      : { isPosted: !!(sc.postedChannels && sc.postedChannels.length > 0), text: (sc.postedChannels && sc.postedChannels.length > 0) ? `✓ 投稿済 (${sc.postedChannels.length}) ▾` : '未投稿 ✎', title: 'クリックで投稿状態を変更' };
    const sysLine = firstSpecLine(sc, 'system');
    const pplLine = firstSpecLine(sc, 'playerCount');
    const timeLine = firstSpecLine(sc, 'playTime');
    const psInfo = PLAY_STATUS_MAP[normalizePlayStatus(sc.playStatus)];
    const psBadge = (psInfo && psInfo.badge) ? `<span class="play-status-badge ${psInfo.cls}">${escapeHTML(psInfo.badge)}</span>` : '';
    const slots = getScenarioThumbSlots(sc);
    const mainThumb = slots[0] || '';
    const subHoverList = slots.slice(1);
    const frameCount = slots.length;
    const preloadHtml = subHoverList.length ? `<div class="thumb-preload">${subHoverList.map((u, i) => `<img ${imgAttr(u)} data-hframe="${i + 1}" decoding="async" alt="">`).join('')}</div>` : '';
    const hoverIndHtml = frameCount > 1 ? `<span class="thumb-hover-ind">🖼️ 1/${frameCount}</span>` : '';
    const spoilerHtml = (mainThumb && sc.spoilerBlur) ? '<span class="thumb-spoiler-badge">🙈 ネタバレ防止</span>' : '';
    const coverImgAttr = u => (typeof imgThumbAttr === 'function' ? imgThumbAttr(u) : imgAttr(u));
    const ts0 = (sc && sc.thumbSettings) || {};
    const z0 = clampThumbNum(sc && sc.thumbZoom !== undefined ? sc.thumbZoom : ts0.zoom, 25, 250, 100);
    const useBlurBg = !!mainThumb && (sc.thumbFit === 'contain' || ts0.fit === 'contain' || z0 < 100);
    const thumbHtml = mainThumb
      ? `${useBlurBg ? `<img ${coverImgAttr(mainThumb)} class="thumb-blur-bg" loading="lazy" decoding="async" alt="" aria-hidden="true">` : ''}<img ${coverImgAttr(mainThumb)} class="scenario-card-thumb${sc.spoilerBlur ? ' is-spoiler-blurred' : ''}" style="${cardThumbStyle(sc)}" loading="lazy" decoding="async" alt="">`
      : '<div class="scenario-card-thumb-placeholder">📁</div>';
    const links = collectScenarioLinks(sc).slice(0, 3);
    const linksHtml = links.length ? `<div class="sc-links-row">${links.map(lk => `<a href="${escapeHTML(lk.url)}" target="_blank" rel="noopener noreferrer" class="sc-link-btn">${escapeHTML(lk.icon)} ${escapeHTML(lk.label)}</a>`).join('')}</div>` : '';
    const sid = escapeHTML(sc.id);
    const isSel = selectedScenarioIds.has(String(sc.id));
    const csInfo = (window.CloudSync && CloudSync.getScenarioCacheStatus)
      ? CloudSync.getScenarioCacheStatus(sc)
      : { status: 'cached', label: '💻 この端末に保持済み', icon: '💻' };
    const cacheIconHtml = renderCacheIconHtml(csInfo);
    const isPinned = csInfo.status === 'pinned';
    const selHtml = `<label class="db-sel-label" title="複数選択（Shift+クリックで範囲選択）"><input type="checkbox" class="db-sel-chk" data-sel-id="${sid}"${isSel ? ' checked' : ''} aria-label="${escapeHTML(sc.title || 'シナリオ')}を選択"></label>`;
    return `<div class="scenario-db-card${isSel ? ' is-selected' : ''}" draggable="true" data-sid="${sid}">
      <div class="scenario-card-thumb-wrap">${selHtml}${cacheIconHtml}${thumbHtml}${spoilerHtml}${hoverIndHtml}${preloadHtml}</div>
      <div class="scenario-card-body"><div>
        <div class="scenario-card-tags">${psBadge}${sysLine ? `<span class="scenario-badge system">${escapeHTML(sysLine)}</span>` : ''}${pplLine ? `<span class="scenario-badge">${escapeHTML(pplLine)}</span>` : ''}${timeLine ? `<span class="scenario-badge time">🕒 ${escapeHTML(timeLine)}</span>` : ''}</div>
        <div class="scenario-card-title"><span class="fav-star${sc.favorite ? ' on' : ''}" data-act="fav" data-id="${sid}" role="button" tabindex="0" aria-pressed="${!!sc.favorite}" title="${sc.favorite ? 'お気に入りを解除' : 'お気に入りに追加'}">${sc.favorite ? '★' : '☆'}</span>${escapeHTML(sc.title)}</div>${linksHtml}
      </div>
      <div class="scenario-card-footer">${postBadge.isPosted ? `<span class="badge badge-posted badge-click" data-act="status" data-id="${sid}" title="${escapeHTML(postBadge.title)}">${escapeHTML(postBadge.text)}</span>` : `<span class="badge badge-unposted badge-click" data-act="status" data-id="${sid}" title="${escapeHTML(postBadge.title)}">${escapeHTML(postBadge.text)}</span>`}
        <div style="display:flex; gap:4px; flex-shrink:0;"><button type="button" class="btn-sort db-cloud-pin-btn${isPinned ? ' on' : ''}" data-offline-pin="${sid}" title="${isPinned ? '📌 常時保持中（クリックで解除）' : '📌 この端末に常にダウンロードしておく（オフライン対応）'}">📌</button><button class="btn-sort" data-act="load" data-id="${sid}" style="padding:4px 8px; font-weight:bold;" title="詳細を開かず、すぐ「Discord投稿・編集」画面で開く">📝 編集</button><button class="btn-sort btn-danger" data-act="del" data-id="${sid}" style="padding:4px 8px;">🗑️</button></div>
      </div></div>
    </div>`;
  }

  function renderScenarioRowHtml(sc) {
    const isP = sc.postedChannels && sc.postedChannels.length > 0;
    const postBadge = (typeof formatScenarioPostedBadge === 'function')
      ? formatScenarioPostedBadge(sc)
      : { isPosted: !!isP, text: isP ? '✓ 投稿済 ▾' : '未投稿 ✎', title: 'クリックで投稿状態を変更' };
    const sysLine = firstSpecLine(sc, 'system');
    const pplLine = firstSpecLine(sc, 'playerCount');
    const timeLine = firstSpecLine(sc, 'playTime');
    const psInfo = PLAY_STATUS_MAP[normalizePlayStatus(sc.playStatus)];
    const psBadge = (psInfo && psInfo.badge) ? `<span class="play-status-badge ${psInfo.cls}" style="margin-right:6px;">${escapeHTML(psInfo.badge)}</span>` : '';
    const csInfo = (window.CloudSync && CloudSync.getScenarioCacheStatus)
      ? CloudSync.getScenarioCacheStatus(sc)
      : { status: 'cached', label: '💻 この端末に保持済み', icon: '💻' };
    const cacheIconHtml = renderCacheIconHtml(csInfo);
    const isPinned = csInfo.status === 'pinned';
    const pTags = isP ? sc.postedChannels.map((id, ci) => {
      const inf = (sc.postedInfo || {})[id] || {}, tg = inf.tags || [], nm = postedLabel(sc, id);
      return `<span class="badge" title="${escapeHTML(nm + (tg.length ? ' / タグ: ' + tg.join(', ') : ''))}" style="background:#4e5058; display:inline-flex; align-items:center;">${escapeHTML(nm)}${tg.length ? `<span class="status-tags">#${escapeHTML(tg.join(' #'))}</span>` : ''}<span style="margin-left:6px; cursor:pointer; color:var(--dc-red);" data-act="unpost" data-id="${escapeHTML(sc.id)}" data-ci="${ci}" title="未投稿にする">✕</span></span>`;
    }).join('') : '';
    const sid = escapeHTML(sc.id);
    const isSel = selectedScenarioIds.has(String(sc.id));
    const coverImgAttr = u => (typeof imgThumbAttr === 'function' ? imgThumbAttr(u) : imgAttr(u));
    return `<tr data-sid="${sid}" class="${isSel ? 'is-selected' : ''}">
      <td class="db-sel-td"><label class="db-sel-label-tbl" title="複数選択（Shift+クリックで範囲選択）"><input type="checkbox" class="db-sel-chk" data-sel-id="${sid}"${isSel ? ' checked' : ''} aria-label="${escapeHTML(sc.title || 'シナリオ')}を選択"></label></td>
      <td>${(() => { const m0 = getScenarioThumbSlots(sc)[0] || ''; return m0 ? `<img ${coverImgAttr(m0)} class="db-thumb" loading="lazy" decoding="async">` : '<div class="db-thumb-placeholder">📁</div>'; })()}</td>
      <td class="db-title"><span class="fav-star${sc.favorite ? ' on' : ''}" data-act="fav" data-id="${sid}" role="button" tabindex="0" aria-pressed="${!!sc.favorite}" title="${sc.favorite ? 'お気に入りを解除' : 'お気に入りに追加'}">${sc.favorite ? '★' : '☆'}</span>${cacheIconHtml}${psBadge}${escapeHTML(sc.title)}${safeUrl(sc.shopUrl) ? `<br><a href="${escapeHTML(safeUrl(sc.shopUrl))}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem; color:var(--dc-accent); font-weight:normal;">🔗 ショップ</a>` : ''}</td>
      <td>${escapeHTML(sysLine || '-')}</td><td>${escapeHTML(pplLine || '-')} / ${escapeHTML(timeLine || '-')}</td>
      <td>${postBadge.isPosted ? `<span class="badge badge-posted badge-click" data-act="status" data-id="${sid}" title="${escapeHTML(postBadge.title)}">${escapeHTML(postBadge.text)}</span>` : `<span class="badge badge-unposted badge-click" data-act="status" data-id="${sid}" title="${escapeHTML(postBadge.title)}">${escapeHTML(postBadge.text)}</span>`}</td>
      <td><div class="db-ch-list">${pTags || '-'}</div></td>
      <td><div class="db-actions"><button type="button" class="btn-sort db-cloud-pin-btn${isPinned ? ' on' : ''}" data-offline-pin="${sid}" title="${isPinned ? '📌 常時保持中' : '📌 この端末に常時保持'}">📌</button><button class="btn-sort" data-act="load" data-id="${sid}" title="詳細を開かず、すぐ「Discord投稿・編集」画面で開く">📝 編集</button><button class="btn-sort" data-act="status" data-id="${sid}">📌 状態</button><button class="btn-sort btn-danger" data-act="del" data-id="${sid}">🗑️ 削除</button></div></td></tr>`;
  }

  function updateDbMoreUi() {
    const mw = shEl('dbMoreWrap');
    if (dbMoreObs) { try { dbMoreObs.disconnect(); } catch (_) { } dbMoreObs = null; }
    if (!mw) return;
    mw.innerHTML = '';
    if (!dbPageState || dbPageState.offset >= dbPageState.list.length) {
      dbPageState = null;
      return;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-secondary';
    b.textContent = `さらに表示（${dbPageState.offset} / ${dbPageState.list.length}件）`;
    b.onclick = appendMoreDB;
    mw.appendChild(b);
    if (typeof IntersectionObserver === 'function') {
      dbMoreObs = new IntersectionObserver(entries => {
        if (entries.some(en => en.isIntersecting)) appendMoreDB();
      }, { root: null, rootMargin: '240px' });
      dbMoreObs.observe(mw);
    }
  }

  function appendMoreDB() {
    if (!dbPageState || dbPageState.offset >= dbPageState.list.length) return;
    const chunk = dbPageState.list.slice(dbPageState.offset, dbPageState.offset + DB_CHUNK_SIZE);
    if (!chunk.length) return;
    if (dbPageState.mode === 'card') {
      const container = shEl('dbCardContainer');
      if (container) container.insertAdjacentHTML('beforeend', chunk.map(x => renderScenarioCardHtml(x.sc)).join(''));
    } else {
      const tbody = shEl('dbTableBody');
      if (tbody) tbody.insertAdjacentHTML('beforeend', chunk.map(x => renderScenarioRowHtml(x.sc)).join(''));
    }
    dbPageState.offset += chunk.length;
    dbLimit = dbPageState.offset;
    updateDbMoreUi();
  }

  function renderEnhancedDBView(force) {
    if (force === true) {
      dbSig = '';
      dbLimit = DB_CHUNK_SIZE;
      dbPageState = null;
      if (dbMoreObs) { try { dbMoreObs.disconnect(); } catch (_) { } dbMoreObs = null; }
    }
    const filterEl = shEl('dbFilterStatus'), playEl = shEl('dbFilterPlayStatus'), sortEl = shEl('dbSortOrder');
    const filter = filterEl ? filterEl.value : 'all';
    const playFilter = playEl ? playEl.value : 'all';
    const sortOrder = sortEl ? sortEl.value : 'newest';
    renderDBChannelFilter();
    const searchEl = shEl('dbSearchInput');
    const terms = parseQuery(searchEl ? searchEl.value : ''), chf = (shEl('dbFilterChannel') || {}).value || '';
    const filtered = [];
    for (let index = 0; index < appState.scenarios.length; index++) {
      const sc = appState.scenarios[index];
      const isP = sc.postedChannels && sc.postedChannels.length > 0;
      if (filter === 'unposted' && isP) continue;
      if (filter === 'posted' && !isP) continue;
      if (filter === 'fav' && !sc.favorite) continue;
      if (playFilter !== 'all') {
        const ps = normalizePlayStatus(sc.playStatus);
        if (playFilter === 'unset' ? !!ps : ps !== playFilter) continue;
      }
      if (chf && !(sc.postedChannels || []).includes(chf.slice(2))) continue;
      if (typeof dbTagSel !== 'undefined' && dbTagSel.size) {
        const scTags = sc.tags || [];
        if (![...dbTagSel].every(sel => scTags.includes(sel))) continue;
      }
      if (!matchQuery(sc, terms)) continue;
      filtered.push({ sc, index });
    }
    const rc = shEl('dbResultCount');
    if (rc) rc.textContent = (terms.length || chf || filter !== 'all' || playFilter !== 'all' || (typeof dbTagSel !== 'undefined' && dbTagSel.size)) ? `${filtered.length} / ${appState.scenarios.length} 件` : '';

    if (sortOrder === 'unposted_first') filtered.sort((a, b) => { const aP = a.sc.postedChannels && a.sc.postedChannels.length > 0, bP = b.sc.postedChannels && b.sc.postedChannels.length > 0; if (aP === bP) return b.index - a.index; return aP ? 1 : -1; });
    else if (sortOrder === 'title') filtered.sort((a, b) => (a.sc.title || '').localeCompare(b.sc.title || '', 'ja'));
    else filtered.sort((a, b) => b.index - a.index);

    if ((shEl('dbFavFirst') || { checked: true }).checked) filtered.sort((a, b) => (b.sc.favorite ? 1 : 0) - (a.sc.favorite ? 1 : 0));
    const _sig = [filter, playFilter, sortOrder, chf, terms.join(' '), [...dbTagSel].join(',')].join('|');
    if (_sig !== dbSig) { dbSig = _sig; dbLimit = DB_CHUNK_SIZE; }
    const initLimit = Math.min(Math.max(DB_CHUNK_SIZE, dbLimit), filtered.length);
    const shown = filtered.slice(0, initLimit);

    const total = appState.scenarios.length;
    let posted = 0;
    for (let i = 0; i < total; i++) {
      const s = appState.scenarios[i];
      if (s && s.postedChannels && s.postedChannels.length > 0) posted++;
    }
    if (shEl('totalScenarioCount')) shEl('totalScenarioCount').innerText = total;
    if (shEl('postedScenarioCount')) shEl('postedScenarioCount').innerText = posted;
    if (shEl('unpostedScenarioCount')) shEl('unpostedScenarioCount').innerText = total - posted;

    lastFilteredIds = filtered.map(x => String(x.sc.id));
    if (dbViewMode === 'card') {
      if (shEl('dbTableContainer')) shEl('dbTableContainer').style.display = 'none';
      const container = shEl('dbCardContainer');
      if (!container) { updateBulkActionBar(); return; }
      container.style.display = 'grid';
      container.innerHTML = shown.map(x => renderScenarioCardHtml(x.sc)).join('');
    } else {
      if (shEl('dbCardContainer')) shEl('dbCardContainer').style.display = 'none';
      const tc = shEl('dbTableContainer'), tbody = shEl('dbTableBody');
      if (!tc || !tbody) { updateBulkActionBar(); return; }
      tc.style.display = 'block';
      tbody.innerHTML = shown.map(x => renderScenarioRowHtml(x.sc)).join('');
    }
    dbPageState = filtered.length > shown.length ? { list: filtered, offset: shown.length, mode: dbViewMode } : null;
    updateDbMoreUi();
    updateBulkActionBar();
    renderSidebarTags();
    if (typeof window.updateScnWatchButtonTitle === 'function') window.updateScnWatchButtonTitle();
  }
  renderDBView = renderEnhancedDBView;
})();

// ---- ホーム画面：ホバー画像スライドショー／カードD&D重ね合わせ統合（マージ）／ライブラリ取込4ボタン ----
(function () {
  let hoverCard = null, hoverTimer = null, hoverIdx = 0;
  function stopHoverShow() {
    clearInterval(hoverTimer); hoverTimer = null;
    if (!hoverCard) return;
    const thumb = hoverCard.querySelector('.scenario-card-thumb');
    const ind = hoverCard.querySelector('.thumb-hover-ind');
    if (thumb && thumb.dataset.origSrc !== undefined) {
      thumb.src = thumb.dataset.origSrc;
      if (thumb.dataset.origStyle !== undefined) thumb.setAttribute('style', thumb.dataset.origStyle);
      delete thumb.dataset.origSrc; delete thumb.dataset.origStyle;
    }
    if (ind && ind.dataset.total) ind.textContent = `🖼️ 1/${ind.dataset.total}`;
    hoverCard = null; hoverIdx = 0;
  }
  document.addEventListener('mouseover', e => {
    const card = e.target.closest && e.target.closest('#dbCardContainer .scenario-db-card');
    if (!card) { if (hoverCard) stopHoverShow(); return; }
    if (card === hoverCard) return;
    stopHoverShow();
    const preloadImgs = [...card.querySelectorAll('.thumb-preload img')];
    const thumb = card.querySelector('.scenario-card-thumb');
    if (!thumb || !preloadImgs.length) return;
    hoverCard = card;
    const origSrc = thumb.src;
    const origStyle = thumb.getAttribute('style') || '';
    thumb.dataset.origSrc = origSrc;
    thumb.dataset.origStyle = origStyle;
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
    const totalFrames = 1 + preloadImgs.length;
    const ind = card.querySelector('.thumb-hover-ind');
    if (ind) ind.dataset.total = String(totalFrames);
    const step = () => {
      if (!hoverCard || !document.body.contains(hoverCard)) { stopHoverShow(); return; }
      hoverIdx = (hoverIdx + 1) % totalFrames;
      const nextSrc = getFrameSrc(hoverIdx);
      if (nextSrc) thumb.src = nextSrc;
      thumb.setAttribute('style', hoverIdx === 0 ? origStyle : 'object-position:50% 50%; transform:scale(1);');
      if (ind) ind.textContent = `🖼️ ${hoverIdx + 1}/${totalFrames}`;
    };
    hoverTimer = setInterval(step, 900);
  });
  document.addEventListener('mouseout', e => {
    if (!hoverCard) return;
    const rel = e.relatedTarget;
    if (!rel || !hoverCard.contains(rel)) stopHoverShow();
  });

  // ---- カード D&D 重ね合わせ統合（マージ） ----
  let dragMergeSid = null;
  function clearMergeMarkers() {
    document.querySelectorAll('#dbCardContainer .scenario-db-card.is-dragging, #dbCardContainer .scenario-db-card.merge-drop-target')
      .forEach(el => el.classList.remove('is-dragging', 'merge-drop-target'));
  }
  function normSourcePath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }
  function isAncestorPath(parentPath, childPath) {
    const a = normSourcePath(parentPath), b = normSourcePath(childPath);
    return !!(a && b && a !== b && b.startsWith(a + '/'));
  }

  function mergeIntoScenario(src, dst) {
    if (!src || !dst || src === dst) return;
    const strFields = ['system', 'playerCount', 'playTime', 'reqSkills', 'recSkills', 'semiRecSkills', 'lostRate', 'aftereffect', 'shopUrl', 'imageUrl', 'trailer', 'autoReply', 'playStatus', 'sourcePath'];
    strFields.forEach(f => { if (!String(dst[f] || '').trim() && String(src[f] || '').trim()) dst[f] = src[f]; });
    if (src.sourcePath && dst.sourcePath && isAncestorPath(src.sourcePath, dst.sourcePath)) {
      dst.sourcePath = src.sourcePath;
    }
    const srcTs = Number(src.updatedAt) || 0, dstTs = Number(dst.updatedAt) || 0;
    if (srcTs > dstTs) dst.updatedAt = srcTs;
    if (String(src.notes || '').trim()) {
      if (!String(dst.notes || '').trim()) dst.notes = src.notes;
      else if (!dst.notes.includes(src.notes)) dst.notes = dst.notes.trim() + '\n\n' + src.notes.trim();
    }
    dst.favorite = !!(dst.favorite || src.favorite);
    dst.tags = [...new Set([...(dst.tags || []), ...(src.tags || [])])];
    dst.hoverImages = [...new Set([...(dst.hoverImages || []), ...(src.hoverImages || [])])].filter(Boolean).slice(0, 4);
    (src.postedChannels || []).forEach(chId => {
      if (!Array.isArray(dst.postedChannels)) dst.postedChannels = [];
      if (!dst.postedChannels.includes(chId)) {
        const inf = (src.postedInfo && src.postedInfo[chId]) || {};
        setPosted(dst, chId, true, inf.tags || []);
        if (inf.date && dst.postedInfo && dst.postedInfo[chId]) dst.postedInfo[chId].date = inf.date;
      }
    });
    normalizePosted(dst);
    dst.imageCategories = sanitizeCats([...(dst.imageCategories || []), ...(src.imageCategories || [])], DEFAULT_SCENARIO_CATS);
    const seenImg = new Set((dst.images || []).map(a => a && (a.dataUrl || a.name)));
    if (!Array.isArray(dst.images)) dst.images = [];
    (src.images || []).forEach(a => { const key = a && (a.dataUrl || a.name); if (a && !seenImg.has(key)) { seenImg.add(key); dst.images.push(a); } });
    const seenDoc = new Set((dst.docs || []).map(d => d && (d.path || d.rel || d.name)));
    if (!Array.isArray(dst.docs)) dst.docs = [];
    (src.docs || []).forEach(d => { const key = d && (d.path || d.rel || d.name); if (d && !seenDoc.has(key)) { seenDoc.add(key); dst.docs.push(d); } });
    if (Array.isArray(src.secretHOs) && src.secretHOs.length) {
      dst.secretHOs = [...(dst.secretHOs || []), ...src.secretHOs];
    }
    if (window.CCF && CCF.getRoomContainer && CCF.saveRoomContainer) {
      try {
        const scRooms = CCF.getRoomContainer(String(src.id)).rooms || [];
        const allRefs = [];
        scRooms.forEach(r => { if (r && r.project && Array.isArray(r.project.refs)) allRefs.push(...r.project.refs); });
        if (allRefs.length && CCF.withProject && window.CCFModel) {
          CCF.withProject(String(dst.id), proj => CCFModel.addRefs(proj, allRefs));
        }
        const richRooms = scRooms.filter(r => r && r.project && ((r.project.stocks && r.project.stocks.length) || (r.project.npcs && r.project.npcs.length) || (r.project.scenes && r.project.scenes.length) || (r.project.cutins && r.project.cutins.length) || (r.project.board && ((r.project.board.screens && r.project.board.screens.length) || (r.project.board.markers && r.project.board.markers.length)))));
        if (richRooms.length) {
          const dstCont = CCF.getRoomContainer(String(dst.id));
          richRooms.forEach(r => dstCont.rooms.push({ ...r, id: (window.CCFModel && CCFModel.newId) ? CCFModel.newId() : uid() }));
          CCF.saveRoomContainer(String(dst.id), dstCont);
        }
      } catch (er) { logSoft('mergeRooms', er); }
    }
    applyFlatToBlocks(dst);
    syncDerivedTagsFromFields(dst);
  }

  function scenarioRichnessScore(sc) {
    if (!sc) return -1;
    let score = 0;
    score += (sc.postedChannels ? sc.postedChannels.length : 0) * 100;
    if (sc.favorite) score += 50;
    if (String(sc.playStatus || '').trim()) score += 20;
    if (String(sc.imageUrl || '').trim()) score += 15;
    score += (Array.isArray(sc.images) ? sc.images.length : 0) * 3;
    score += (Array.isArray(sc.docs) ? sc.docs.length : 0) * 3;
    score += (Array.isArray(sc.secretHOs) ? sc.secretHOs.length : 0) * 4;
    ['system', 'playerCount', 'playTime', 'reqSkills', 'recSkills', 'semiRecSkills', 'lostRate', 'aftereffect', 'trailer', 'notes', 'shopUrl'].forEach(f => {
      if (String(sc[f] || '').trim()) score += 2;
    });
    if (window.CCFModel && CCFModel.cleanseTitle) {
      const cl = CCFModel.cleanseTitle(sc.title);
      if (cl && cl === sc.title) score += 5;
      if (cl && !CCFModel.isGenericRoleTitle(cl)) score += 5;
    }
    if (window.CCF && CCF.getRoomContainer) {
      try {
        const rms = CCF.getRoomContainer(String(sc.id)).rooms || [];
        rms.forEach(r => {
          const p = r && r.project;
          if (!p) return;
          score += (p.refs ? p.refs.length : 0) * 2 + (p.npcs ? p.npcs.length : 0) * 5 + (p.stocks ? p.stocks.length : 0) * 5;
        });
      } catch (_) { }
    }
    if (sc.sourcePath && !/\.zip$/i.test(sc.sourcePath)) score += 3;
    return score;
  }

  function removeScenariosById(idSet) {
    if (!idSet || !idSet.size) return 0;
    let removed = 0;
    appState.scenarios = (appState.scenarios || []).filter(sc => {
      if (sc && idSet.has(String(sc.id))) {
        (appState.deletedScenarios = appState.deletedScenarios || {})[sc.id] = nowTs();
        removed++;
        return false;
      }
      return true;
    });
    if (currentScenarioId && idSet.has(String(currentScenarioId))) currentScenarioId = null;
    return removed;
  }

  function refreshAfterScenarioMutation(opts) {
    dbSig = ''; dbLimit = DB_CHUNK_SIZE; dbPageState = null;
    if (window.CCF && CCF.assets && typeof CCF.assets.invalidateUnified === 'function') CCF.assets.invalidateUnified(null, true);
    if (opts && opts.skipDetailEdited && typeof window.primeScenarioSigs === 'function') window.primeScenarioSigs();
    saveState(false, (opts && opts.skipDetailEdited) ? { skipDetailEdited: true } : undefined);
    populateScenarioDBSelect();
    renderDBView(true);
    if (typeof renderSidebarTags === 'function') renderSidebarTags();
    if (typeof renderGalleryAll === 'function') renderGalleryAll();
    if (typeof cleanupUnusedImages === 'function') cleanupUnusedImages();
    if (window.CCF && CCF.S && CCF.S.ready) { try { CCF.buildProjectSelect(); if (CCF.library) CCF.library.render(); } catch (_) { } }
  }

  async function mergeScenariosWithConfirm(srcId, dstId) {
    const src = appState.scenarios.find(s => s.id === srcId);
    const dst = appState.scenarios.find(s => s.id === dstId);
    if (!src || !dst || src === dst) return;
    const ok = await appConfirm(
      `「${src.title}」を「${dst.title}」に統合（マージ）しますか？\n\n・空いている項目（スペック・あらすじ・サムネイル等）を補完\n・タグ・投稿履歴・登録素材・ホバー画像・部屋データを引き継ぎ\n・「${src.title}」は一覧から削除されます`,
      { title: '🔗 シナリオを統合', okText: '統合する', danger: true }
    );
    if (!ok) return;
    if (window.AppHistory) AppHistory.checkpoint('シナリオ統合');
    mergeIntoScenario(src, dst);
    removeScenariosById(new Set([String(src.id)]));
    refreshAfterScenarioMutation();
    toast(`✅ 「${src.title}」を「${dst.title}」に統合しました`);
  }

  async function bulkMergeSelected() {
    const ids = window.__dbSelectionApi ? window.__dbSelectionApi.getSelectedIds() : [];
    const targets = (appState.scenarios || []).filter(s => ids.includes(String(s.id)));
    if (targets.length < 2) return toast('統合するには2件以上のシナリオを選択してください');
    targets.sort((a, b) => scenarioRichnessScore(b) - scenarioRichnessScore(a));
    const dst = targets[0], srcs = targets.slice(1);
    const ok = await appConfirm(
      `選択した ${targets.length}件 のシナリオを「${dst.title}」に1つへ統合しますか？\n\n・すべての素材・PDF・画像・部屋データ・タグ・投稿履歴を「${dst.title}」へ引き継ぎます\n・統合元の ${srcs.length}件 は削除されます（Ctrl+Z で元に戻せます）`,
      { title: '🔗 選択シナリオを一括統合', okText: `${targets.length}件を1つに統合`, danger: true }
    );
    if (!ok) return;
    if (window.AppHistory) AppHistory.checkpoint('選択シナリオを一括統合');
    srcs.forEach(s => mergeIntoScenario(s, dst));
    removeScenariosById(new Set(srcs.map(s => String(s.id))));
    if (window.__dbSelectionApi) window.__dbSelectionApi.clearSelection();
    refreshAfterScenarioMutation();
    toast(`✅ ${targets.length}件を「${dst.title}」に統合しました`);
  }

  async function bulkDeleteSelected() {
    const ids = window.__dbSelectionApi ? window.__dbSelectionApi.getSelectedIds() : [];
    if (!ids.length) return;
    const ok = await appConfirm(
      `選択した ${ids.length}件 のシナリオを削除しますか？\n（削除後も Ctrl+Z で元に戻せます）`,
      { title: '🗑️ 選択シナリオを一括削除', okText: `${ids.length}件を削除`, danger: true }
    );
    if (!ok) return;
    if (window.AppHistory) AppHistory.checkpoint('選択シナリオを一括削除');
    const removed = removeScenariosById(new Set(ids));
    if (window.__dbSelectionApi) window.__dbSelectionApi.clearSelection();
    refreshAfterScenarioMutation();
    toast(`🗑️ ${removed}件のシナリオを削除しました（Ctrl+Z で元に戻せます）`);
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('[data-bulk-act]');
    if (!btn) return;
    const act = btn.dataset.bulkAct;
    if (act === 'toggle-all' && window.__dbSelectionApi) window.__dbSelectionApi.toggleVisibleAll();
    else if (act === 'clear' && window.__dbSelectionApi) window.__dbSelectionApi.clearSelection();
    else if (act === 'merge') bulkMergeSelected().catch(er => { logSoft('bulkMerge', er); toast('❌ 統合に失敗しました'); });
    else if (act === 'delete') bulkDeleteSelected().catch(er => { logSoft('bulkDelete', er); toast('❌ 削除に失敗しました'); });
  });

  function diagnoseScenariosCleanup() {
    const M = window.CCFModel;
    const dnd = window.CCF && CCF.dnd;
    const list = (appState.scenarios || []).slice();
    const normMatch = t => (typeof window.getScenarioDedupKey === 'function')
      ? (window.getScenarioDedupKey(t) || '')
      : ((M && M.normalizeForMatch)
        ? M.normalizeForMatch(t)
        : String(t || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''));
    const isCatDirName = name => !!(
      (dnd && typeof dnd.isCategoryFolderName === 'function' && dnd.isCategoryFolderName(name)) ||
      (M && M.isCategoryFolderName && M.isCategoryFolderName(name))
    );
    const isPureAssetName = name => !!(dnd && typeof dnd.isPureGenericAssetDir === 'function' && dnd.isPureGenericAssetDir(name));
    const isAssetSubdir = name => !!(dnd && typeof dnd.isAssetSubdirName === 'function' && dnd.isAssetSubdirName(name));
    const RE_BOILER_FALLBACK = /撮影禁止|転載禁止|無断転載|複製禁止|ネタバレ|閲覧注意|注意|警告|\bWARNING\b|\bCAUTION\b|\bSTOP\b|\bDO\s+NOT\b|(?:です|ます|ください|下さい|ません|こと|について)[。！!.]?$/i;
    const isBoilerTitle = rawTitle => {
      const t = String(rawTitle || '').normalize('NFKC').trim();
      if (!t) return false;
      if (window.CCF && CCF.scan && typeof CCF.scan.isBoilerTitle === 'function') {
        if (CCF.scan.isBoilerTitle(t)) return true;
      }
      return RE_BOILER_FALLBACK.test(t);
    };
    const RE_NUMBERED_DATA_PART = /^[0-9０-９]+[._．・\s-]*(?:テキスト|ルーム|room|アイテム|パーク|カード|データ|素材|画像|立ち絵|立絵|マップ|BGM|SE|HO|資料|配布|ハンドアウト|おまけ|特典)/i;
    const RE_PURPOSE_DIFF_PART = /^(?:徒歩用|車用|山中用|yamanaka|toho|syaryou)$/i;
    const RE_PREFIXED_PART = /^(.+?)[_\-\s・]+(?:npc|立ち絵|立絵|トレーラー|trailer|サムネ|表紙|背景|bg(?!m)|前景|fg|マップ|map|部屋素材|素材|データ|テキスト|ルーム|room|カード|アイテム|パーク|bgm|se|資料|配布|ハンドアウト|ho\d*|カットイン|差分|アイコン)$/i;
    const RE_IMG_CONTAINER_DIR = /^(?:[0-9０-９]+[._．・\s-]*)?(?:画像素材|画像|素材|assets?|images?|img)$/i;
    const isSubfolderMisextractTitle = rawTitle => {
      const t = String(rawTitle || '').normalize('NFKC').trim();
      if (!t) return true;
      if (RE_NUMBERED_DATA_PART.test(t) || RE_PURPOSE_DIFF_PART.test(t) || RE_PREFIXED_PART.test(t)) return true;
      if (M && M.isGenericRoleTitle && M.isGenericRoleTitle(t)) return true;
      return isPureAssetName(t) || isAssetSubdir(t);
    };
    const isAbbrevSubsequence = (shortRaw, longRaw) => {
      const s = normMatch(shortRaw), l = normMatch(longRaw);
      if (!s || !l || s.length < 2 || s.length > 4 || l.length < s.length + 2) return false;
      if (s[0] !== l[0]) return false;
      let j = 0;
      for (let i = 0; i < l.length && j < s.length; i++) {
        if (l[i] === s[j]) j++;
      }
      return j === s.length;
    };
    const parentOfPath = p => {
      const s = String(p || '').replace(/[\\/]+$/, '');
      const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
      return i > 0 ? s.slice(0, i).split(/[\\/]/).pop() : '';
    };
    const dirOfPath = p => {
      const s = String(p || '').replace(/[\\/]+$/, '');
      const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
      return i > 0 ? s.slice(0, i) : '';
    };
    const baseOfNormPath = np => {
      const parts = String(np || '').split('/').filter(Boolean);
      return parts[parts.length - 1] || '';
    };
    const isCatMisregistered = sc => {
      const rawT = String(sc && sc.title || '').trim();
      const t = rawT.replace(/^[☆★●◆◎○■□▲△▼▽※♪♫・\s]+/, '').trim();
      if (!rawT || !t) return true;
      const cleanNotes = (typeof window.isMojibakeText === 'function' && window.isMojibakeText(sc.notes, { allowUrlOnly: true })) ? '' : String(sc.notes || '').trim();
      const hasImportant = (sc.postedChannels && sc.postedChannels.length) || cleanNotes;
      if (hasImportant) return false;
      return isCatDirName(rawT) || isCatDirName(t);
    };

    const catDelete = [], catDeleteIds = new Set();
    list.forEach(sc => {
      if (isCatMisregistered(sc)) { catDelete.push(sc); catDeleteIds.add(String(sc.id)); }
    });
    const mojibakeList = [];
    list.forEach(sc => {
      if (!sc || catDeleteIds.has(String(sc.id))) return;
      const isMj = typeof window.isMojibakeText === 'function' ? window.isMojibakeText : null;
      const isGarbageSyn = typeof window.isGarbageSynopsisText === 'function' ? window.isGarbageSynopsisText : isMj;
      if (!isMj) return;
      let hit = (isGarbageSyn && isGarbageSyn(sc.trailer)) || (typeof sc.synopsis === 'string' && isGarbageSyn && isGarbageSyn(sc.synopsis));
      if (!hit && sc.notes && sc.notes.trim().length >= 15 && isMj(sc.notes, { allowUrlOnly: true })) hit = true;
      if (!hit && Array.isArray(sc.fullBlockData)) {
        hit = sc.fullBlockData.some(b => b && ((typeof b.val === 'string' && (isMj(b.val, { allowUrlOnly: true }) || (isGarbageSyn && (b.id === 'intro' || /あらすじ|概要|トレーラー|イントロ|synopsis|trailer|intro/i.test(String(b.label || b.keyName || ''))) && isGarbageSyn(b.val)))) || (typeof b.freeText === 'string' && isMj(b.freeText))));
      }
      if (!hit && Array.isArray(sc.publicBlocks)) {
        hit = sc.publicBlocks.some(b => b && ((typeof b.val === 'string' && (isMj(b.val, { allowUrlOnly: true }) || (isGarbageSyn && (b.id === 'intro' || /あらすじ|概要|トレーラー|イントロ|synopsis|trailer|intro/i.test(String(b.label || b.keyName || ''))) && isGarbageSyn(b.val)))) || (typeof b.freeText === 'string' && isMj(b.freeText))));
      }
      if (hit) mojibakeList.push(sc);
    });
    const recoverChildEntries = [];
    if (IS_ELECTRON && typeof fs !== 'undefined' && fs && dnd && typeof dnd.discoverScenarioEntries === 'function') {
      const seenSrc = new Set();
      catDelete.forEach(sc => {
        const sp = String(sc && sc.sourcePath || '').trim();
        if (!sp) return;
        const sk = sp.toLowerCase();
        if (seenSrc.has(sk)) return;
        seenSrc.add(sk);
        try {
          if (fs.existsSync(sp) && fs.statSync(sp).isDirectory()) {
            const meta = (typeof dnd.inferFolderMeta === 'function') ? dnd.inferFolderMeta(path.basename(sp)) : {};
            const ents = dnd.discoverScenarioEntries(sp, {
              maxDepth: 5,
              isWatchRoot: true,
              inheritedSystem: meta.system || '',
              inheritedPlayerCount: meta.playerCount || '',
              inheritedLostRate: meta.lostRate || '',
              inheritedTags: meta.tags || []
            });
            ents.forEach(e => recoverChildEntries.push(e));
          }
        } catch (_) { }
      });
    }

    const cands = list.filter(sc => !catDeleteIds.has(String(sc.id)));
    const parent = new Map(cands.map(s => [String(s.id), String(s.id)]));
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };

    const watchRootNorm = normSourcePath(typeof getScenarioWatchRoot === 'function' ? getScenarioWatchRoot() : '');
    const metaMap = new Map();
    cands.forEach(sc => {
      const rawSrc = String(sc.sourcePath || '').trim();
      const pName = rawSrc ? parentOfPath(rawSrc) : '';
      const parsed = (M && M.extractTitleAndSystem)
        ? M.extractTitleAndSystem(sc.title, pName)
        : { title: String(sc.title || '').trim(), system: '' };
      let cleanT = parsed.title || '';
      const isSubTitle = isSubfolderMisextractTitle(sc.title);
      const isBoiler = isBoilerTitle(sc.title);
      let effPath = normSourcePath(rawSrc);
      let effRawPath = rawSrc;
      if (!effPath && Array.isArray(sc.docs) && sc.docs[0] && sc.docs[0].path) {
        const dDir = dirOfPath(sc.docs[0].path);
        if (dDir) { effPath = normSourcePath(dDir); effRawPath = dDir; }
      }
      if (!effPath && window.CCF && typeof CCF.readProject === 'function') {
        try {
          const prj = CCF.readProject(String(sc.id));
          const refWithPath = prj && Array.isArray(prj.refs) ? prj.refs.find(r => r && r.path) : null;
          if (refWithPath && refWithPath.path) {
            const rDir = dirOfPath(refWithPath.path);
            if (rDir) { effPath = normSourcePath(rDir); effRawPath = rDir; }
          }
        } catch (_) { }
      }
      let boilerTargetTitle = '';
      if (isBoiler && effRawPath) {
        const isFile = /\.[a-z0-9]{1,6}$/i.test(effRawPath);
        const dirPath = isFile ? dirOfPath(effRawPath) : effRawPath;
        const dirBase = dirPath ? dirPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '';
        const folderCand = (dirBase && !isCatDirName(dirBase) && !isSubfolderMisextractTitle(dirBase))
          ? ((M && M.cleanseTitle ? M.cleanseTitle(dirBase) : '') || dirBase)
          : '';
        if (folderCand && !isBoilerTitle(folderCand) && !isSubfolderMisextractTitle(folderCand)) {
          boilerTargetTitle = folderCand;
          cleanT = folderCand;
        }
      }
      const normK = normMatch(cleanT || sc.title);
      metaMap.set(String(sc.id), { sc, cleanT, system: parsed.system, normK, path: effPath, rawPath: effRawPath, isSubTitle, isBoiler, boilerTargetTitle });
    });

    // ① 同一正規化タイトル（大文字小文字違い・ver番号・更新日・記号違い等）をグループ化
    const byKey = new Map();
    cands.forEach(sc => {
      const m = metaMap.get(String(sc.id));
      if (!m.normK || m.isSubTitle) return;
      if (!byKey.has(m.normK)) byKey.set(m.normK, []);
      byKey.get(m.normK).push(String(sc.id));
    });
    byKey.forEach(ids => {
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    });

    // ② sourcePath の親子包含（親シナリオ A の配下にある子・孫サブフォルダカード B を回収）
    const withPath = cands.filter(s => metaMap.get(String(s.id)).path);
    for (let i = 0; i < withPath.length; i++) {
      const a = withPath[i], ma = metaMap.get(String(a.id));
      if (/\.zip$/i.test(ma.path)) continue;
      for (let j = 0; j < withPath.length; j++) {
        if (i === j) continue;
        const b = withPath[j], mb = metaMap.get(String(b.id));
        if (mb.path.startsWith(ma.path + '/')) union(String(a.id), String(b.id));
      }
    }

    // ②-b パスの祖先フォルダ名に既存シナリオタイトルと一致する親シナリオがある場合も統合
    withPath.forEach(b => {
      const mb = metaMap.get(String(b.id));
      let cur = dirOfPath(mb.path);
      while (cur && cur.includes('/')) {
        if (watchRootNorm && (cur === watchRootNorm || !cur.startsWith(watchRootNorm + '/'))) break;
        const seg = baseOfNormPath(cur);
        if (!seg || isCatDirName(seg) || isSubfolderMisextractTitle(seg) || RE_IMG_CONTAINER_DIR.test(seg)) {
          cur = dirOfPath(cur);
          continue;
        }
        const segK = normMatch(seg);
        const hits = segK ? byKey.get(segK) : null;
        if (hits && hits.length) {
          union(hits[0], String(b.id));
          break;
        }
        cur = dirOfPath(cur);
      }
    });

    // ③ 親シナリオが未存在で、共通の親フォルダ（例：.../幼い君にさようなら）配下からサブフォルダカード群が分裂している場合を統合
    const splitByParent = new Map();
    const resolveTrueParentFolder = (rawP, normP) => {
      if (!normP || /\.zip$/i.test(normP)) return null;
      let curNorm = dirOfPath(normP);
      let curRaw = dirOfPath(rawP);
      while (curNorm && curNorm.includes('/')) {
        if (watchRootNorm && (curNorm === watchRootNorm || !curNorm.startsWith(watchRootNorm + '/'))) break;
        const segRaw = curRaw.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
        if (!segRaw) break;
        if (isCatDirName(segRaw)) break;
        if (isSubfolderMisextractTitle(segRaw) || RE_IMG_CONTAINER_DIR.test(segRaw)) {
          curNorm = dirOfPath(curNorm);
          curRaw = dirOfPath(curRaw);
          continue;
        }
        const title = (M && M.cleanseTitle ? M.cleanseTitle(segRaw) : '') || segRaw;
        if (!title || isCatDirName(title) || isSubfolderMisextractTitle(title)) break;
        return { normPath: curNorm, rawPath: curRaw.replace(/[\\/]+$/, ''), title };
      }
      return null;
    };

    const byNormPath = new Map();
    withPath.forEach(sc => {
      const m = metaMap.get(String(sc.id));
      if (m.path && !byNormPath.has(m.path)) byNormPath.set(m.path, String(sc.id));
    });
    withPath.forEach(sc => {
      const m = metaMap.get(String(sc.id));
      const baseFolder = baseOfNormPath(m.path);
      if (!m.isSubTitle && !isSubfolderMisextractTitle(baseFolder)) return;
      const pInfo = resolveTrueParentFolder(m.rawPath, m.path);
      if (!pInfo) return;
      const existingParentId = byNormPath.get(pInfo.normPath) || (byKey.get(normMatch(pInfo.title)) || [])[0];
      if (existingParentId) {
        union(existingParentId, String(sc.id));
        return;
      }
      if (!splitByParent.has(pInfo.normPath)) splitByParent.set(pInfo.normPath, { info: pInfo, ids: [] });
      splitByParent.get(pInfo.normPath).ids.push(String(sc.id));
    });

    const compTargetMeta = new Map(); // rootId -> { targetTitle, targetSourcePath }
    splitByParent.forEach(({ info, ids }) => {
      if (!ids.length) return;
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
      compTargetMeta.set(find(ids[0]), { targetTitle: info.title, targetSourcePath: info.rawPath });
    });

    // ④ sourcePath が無いWeb取込等でも、サブフォルダ名・略称パターンから既存親シナリオへ統合
    const fullerCands = cands.filter(sc => {
      const m = metaMap.get(String(sc.id));
      return m.normK && m.normK.length >= 3 && !m.isSubTitle;
    });
    cands.forEach(sc => {
      const m = metaMap.get(String(sc.id));
      const prefMatch = RE_PREFIXED_PART.exec(String(sc.title || '').normalize('NFKC').trim());
      if (prefMatch && prefMatch[1]) {
        const stem = prefMatch[1].trim();
        const stemK = normMatch(stem);
        const exact = stemK ? byKey.get(stemK) : null;
        if (exact && exact.length) {
          union(exact[0], String(sc.id));
          return;
        }
        const abbrevHits = fullerCands.filter(a => String(a.id) !== String(sc.id) && isAbbrevSubsequence(stem, a.title));
        if (abbrevHits.length === 1) {
          union(String(abbrevHits[0].id), String(sc.id));
          return;
        }
      }
      const hasImportant = (sc.postedChannels && sc.postedChannels.length) || String(sc.notes || '').trim() || sc.favorite;
      if (!hasImportant && m.normK && m.normK.length >= 2 && m.normK.length <= 3) {
        const abbrevHits = fullerCands.filter(a => String(a.id) !== String(sc.id) && isAbbrevSubsequence(m.normK, a.title));
        if (abbrevHits.length === 1) {
          union(String(abbrevHits[0].id), String(sc.id));
        }
      }
    });

    const resolvedTargetMeta = new Map();
    compTargetMeta.forEach((v, k) => { resolvedTargetMeta.set(find(k), v); });

    const compMap = new Map();
    cands.forEach(sc => {
      const r = find(String(sc.id));
      if (!compMap.has(r)) compMap.set(r, []);
      compMap.get(r).push(sc);
    });

    const mergeGroups = [], orphanGenericDelete = [], mergedAwayIds = new Set();
    const renamedParentTargets = new Map();
    compMap.forEach((group, compRoot) => {
      const pTarget = resolvedTargetMeta.get(compRoot) || null;
      if (group.length >= 2) {
        group.sort((a, b) => {
          const ma = metaMap.get(String(a.id)), mb = metaMap.get(String(b.id));
          const aAnc = mb.path && ma.path && mb.path.startsWith(ma.path + '/') ? 1 : 0;
          const bAnc = ma.path && mb.path && ma.path.startsWith(mb.path + '/') ? 1 : 0;
          if (aAnc !== bAnc) return bAnc - aAnc;
          if (ma.isSubTitle !== mb.isSubTitle) return ma.isSubTitle ? 1 : -1;
          return scenarioRichnessScore(b) - scenarioRichnessScore(a);
        });
        const dst = group[0], srcs = group.slice(1);
        const mg = { dst, srcs };
        const dstM = metaMap.get(String(dst.id));
        if (pTarget && (!dstM.path || dstM.isSubTitle || isSubfolderMisextractTitle(baseOfNormPath(dstM.path)))) {
          mg.targetTitle = pTarget.targetTitle;
          mg.targetSourcePath = pTarget.targetSourcePath;
        }
        mergeGroups.push(mg);
        srcs.forEach(s => mergedAwayIds.add(String(s.id)));
      } else {
        const sc = group[0];
        const m = metaMap.get(String(sc.id));
        const hasImportant = (sc.postedChannels && sc.postedChannels.length) || String(sc.notes || '').trim() || sc.favorite;
        if (pTarget && m.isSubTitle) {
          renamedParentTargets.set(String(sc.id), pTarget);
          return;
        }
        if (!hasImportant && (m.isSubTitle || (M && M.isGenericRoleTitle && M.isGenericRoleTitle(sc.title) && (!m.cleanT || M.isGenericRoleTitle(m.cleanT))))) {
          orphanGenericDelete.push(sc);
        }
      }
    });

    const deleteList = [...catDelete, ...orphanGenericDelete];
    const deleteIds = new Set(deleteList.map(s => String(s.id)));
    const renameList = [];
    cands.forEach(sc => {
      const id = String(sc.id);
      if (mergedAwayIds.has(id) || deleteIds.has(id)) return;
      const pTarget = renamedParentTargets.get(id);
      if (pTarget) {
        renameList.push({
          sc,
          oldTitle: sc.title,
          newTitle: pTarget.targetTitle,
          targetSourcePath: pTarget.targetSourcePath,
          sysToSet: '',
          titleChanged: pTarget.targetTitle !== sc.title
        });
        return;
      }
      const m = metaMap.get(id);
      const nextTitle = m.boilerTargetTitle
        ? m.boilerTargetTitle
        : ((m.cleanT && !(M && M.isGenericRoleTitle && M.isGenericRoleTitle(m.cleanT)) && !isSubfolderMisextractTitle(m.cleanT) && !isBoilerTitle(m.cleanT)) ? m.cleanT : '');
      const titleChanged = !!(nextTitle && nextTitle !== sc.title);
      const sysToSet = (m.system && !String(sc.system || '').trim()) ? m.system : '';
      if (titleChanged || sysToSet) {
        renameList.push({ sc, oldTitle: sc.title, newTitle: nextTitle || sc.title, sysToSet, titleChanged });
      }
    });

    return { renameList, mergeGroups, deleteList, mojibakeList, recoverChildEntries };
  }

  async function runDiskAndStorageCleanup() {
    let deletedProjects = 0;
    let removedImages = 0;
    if (typeof window.purgeOrphanAndEmptyProjects === 'function') {
      const pRes = await window.purgeOrphanAndEmptyProjects();
      deletedProjects = (pRes && pRes.totalDeleted) ? pRes.totalDeleted : 0;
      removedImages = (pRes && pRes.removedImages) ? pRes.removedImages : 0;
    } else {
      const pRes = (typeof window.cleanupOrphanProjectFiles === 'function')
        ? window.cleanupOrphanProjectFiles()
        : ((window.CCF && typeof CCF.cleanupOrphanProjectFiles === 'function') ? CCF.cleanupOrphanProjectFiles() : { totalDeleted: 0, deletedDirs: 0 });
      if (!pRes.deletedDirs && typeof window.cleanupEmptyScenarioDirs === 'function') {
        window.cleanupEmptyScenarioDirs();
      }
      deletedProjects = (pRes && pRes.totalDeleted) ? pRes.totalDeleted : 0;
      removedImages = (typeof window.cleanupOrphanIdbImages === 'function')
        ? await window.cleanupOrphanIdbImages({ skipAutosave: true })
        : ((typeof window.cleanupUnusedImages === 'function') ? await window.cleanupUnusedImages({ skipAutosave: true }) : 0);
    }
    if (typeof window.saveDiskAutosaveNow === 'function') {
      await window.saveDiskAutosaveNow(true);
    }
    return { deletedProjects, removedImages };
  }

  async function runScenarioCleanup() {
    const assetDiag = (window.CCF && CCF.assets && typeof CCF.assets.cleanupAllScenarioAssets === 'function')
      ? CCF.assets.cleanupAllScenarioAssets({ silentProjectCleanup: true })
      : { fixedScenarios: 0, removedDupRefs: 0, removedDupImgs: 0, movedDocs: 0 };
    const diag = diagnoseScenariosCleanup();
    const { renameList, mergeGroups, deleteList, mojibakeList = [], recoverChildEntries = [] } = diag;
    const mergeDropCount = mergeGroups.reduce((sum, g) => sum + g.srcs.length, 0);
    const assetFixedCount = (assetDiag.removedDupRefs || 0) + (assetDiag.removedDupImgs || 0) + (assetDiag.movedDocs || 0) + (assetDiag.removedOldAssets || 0);
    if (!renameList.length && !mergeGroups.length && !deleteList.length && !mojibakeList.length && !recoverChildEntries.length) {
      let thumbFixed = 0;
      if (typeof window.repairScenarioTrailersAsync === 'function') {
        thumbFixed = await window.repairScenarioTrailersAsync(appState.scenarios || [], { skipSave: true });
      }
      if (window.CloudSync && typeof CloudSync.purgeUploadQueue === 'function') {
        await CloudSync.purgeUploadQueue();
      }
      if (assetFixedCount > 0 || thumbFixed > 0) {
        refreshAfterScenarioMutation({ skipDetailEdited: true });
      }
      const { deletedProjects } = await runDiskAndStorageCleanup();
      toast(`✅ 整理完了：不要な部屋JSON ${deletedProjects}件を削除し、バックアップファイルをスリム化しました` + (thumbFixed ? `（サムネイル補完 ${thumbFixed}件）` : ''));
      return;
    }

    const lines = ['現在のシナリオ一覧を診断した結果、以下の整理対象が見つかりました：\n'];
    if (renameList.length) {
      const samples = renameList.filter(r => r.titleChanged).slice(0, 3).map(r => `  ・${r.oldTitle} → ${r.newTitle}`);
      lines.push(`① タイトル表記の自動整理（＋システム名補完）：${renameList.length}件`);
      if (samples.length) lines.push(...samples);
    }
    if (mergeGroups.length) {
      const samples = mergeGroups.slice(0, 3).map(g => {
        const m0 = g.targetTitle || ((window.CCFModel && CCFModel.cleanseTitle) ? (CCFModel.cleanseTitle(g.dst.title) || g.dst.title) : g.dst.title);
        return `  ・${[g.dst.title, ...g.srcs.map(s => s.title)].slice(0, 3).join(' ＋ ')} → 「${m0}」`;
      });
      lines.push(`② 重複・表記ゆれ・分割登録の自動統合：${mergeGroups.length}グループ（重複カード ${mergeDropCount}件を統合）`);
      if (samples.length) lines.push(...samples);
    }
    if (deleteList.length) {
      const samples = deleteList.slice(0, 4).map(s => `  ・${s.title || '(無題)'}`);
      lines.push(`③ 誤登録された分類名・サブフォルダカードの削除：${deleteList.length}件`);
      if (samples.length) lines.push(...samples);
    }
    if (recoverChildEntries.length) {
      lines.push(`   ↳ 分類フォルダ配下の実シナリオを再登録：${recoverChildEntries.length}件`);
    }
    if (mojibakeList.length) {
      const samples = mojibakeList.slice(0, 3).map(s => `  ・${s.title || '(無題)'}`);
      lines.push(`④ 文字化けしたあらすじ・ブロックの自動修復：${mojibakeList.length}件`);
      if (samples.length) lines.push(...samples);
    }
    if (assetFixedCount > 0) {
      lines.push(`⑤ シナリオ内の重複素材・NPC/文書混入の整理：${assetFixedCount}件（実行済み）`);
    }
    lines.push('\n※ 実行後も Ctrl+Z で元の状態に戻せます。');

    const ok = await appConfirm(lines.join('\n'), {
      title: '🧹 重複・誤抽出を整理',
      okText: '✨ 一括で整理・統合を実行する',
      cancelText: 'キャンセル'
    });
    if (!ok) {
      if (assetFixedCount > 0) refreshAfterScenarioMutation({ skipDetailEdited: true });
      return;
    }

    if (window.AppHistory) AppHistory.checkpoint('重複・誤抽出シナリオを整理');
    if (typeof window.beginSuppressDetailEdited === 'function') window.beginSuppressDetailEdited();
    try {
      const toRemoveIds = new Set(deleteList.map(s => String(s.id)));
      mergeGroups.forEach(g => {
        const hadEdit = !!(g.dst.detailEdited || g.srcs.some(s => s && s.detailEdited));
        g.srcs.forEach(src => {
          mergeIntoScenario(src, g.dst);
          toRemoveIds.add(String(src.id));
        });
        if (g.targetTitle) g.dst.title = g.targetTitle;
        if (g.targetSourcePath) g.dst.sourcePath = g.targetSourcePath;
        if (hadEdit) g.dst.detailEdited = true;
        applyFlatToBlocks(g.dst);
        syncDerivedTagsFromFields(g.dst);
      });
      renameList.forEach(r => {
        if (r.titleChanged) r.sc.title = r.newTitle;
        if (r.targetSourcePath) r.sc.sourcePath = r.targetSourcePath;
        if (r.sysToSet && !String(r.sc.system || '').trim()) r.sc.system = r.sysToSet;
        applyFlatToBlocks(r.sc);
        syncDerivedTagsFromFields(r.sc);
      });
      removeScenariosById(toRemoveIds);
      if (recoverChildEntries.length) {
        const lookup = buildScenarioLookup();
        const rStats = { added: 0, updated: 0, touchedIds: [] };
        for (const ent of recoverChildEntries) {
          try {
            if (ent.dir) {
              await upsertScenarioFromDir(ent.p, rStats, {
                inheritedSystem: ent.inheritedSystem || '',
                inheritedPlayerCount: ent.inheritedPlayerCount || '',
                inheritedLostRate: ent.inheritedLostRate || '',
                inheritedTags: ent.inheritedTags || [],
                lookup
              });
            } else {
              await upsertScenarioFromFilePath(ent.p, path.basename(ent.p), null, {
                inheritedSystem: ent.inheritedSystem || '',
                inheritedPlayerCount: ent.inheritedPlayerCount || '',
                inheritedLostRate: ent.inheritedLostRate || '',
                inheritedTags: ent.inheritedTags || [],
                lookup
              });
            }
          } catch (_) { }
        }
      }
      if (typeof window.repairMojibakeScenariosAsync === 'function') {
        await window.repairMojibakeScenariosAsync(appState.scenarios || [], { skipSave: true, skipRefresh: true });
      }
      if (window.CCF && CCF.assets && typeof CCF.assets.cleanupAllScenarioAssets === 'function') {
        CCF.assets.cleanupAllScenarioAssets({ silentProjectCleanup: true });
      }
      if (typeof window.repairScenarioTrailersAsync === 'function') {
        await window.repairScenarioTrailersAsync(appState.scenarios || [], { skipSave: true });
      }
      if (window.__dbSelectionApi) window.__dbSelectionApi.clearSelection();
      refreshAfterScenarioMutation({ skipDetailEdited: true });
    } finally {
      if (typeof window.endSuppressDetailEdited === 'function') window.endSuppressDetailEdited();
    }
    if (window.CloudSync && typeof CloudSync.purgeUploadQueue === 'function') {
      await CloudSync.purgeUploadQueue();
    }
    const { deletedProjects } = await runDiskAndStorageCleanup();
    toast(`✅ 整理完了：不要な部屋JSON ${deletedProjects}件を削除し、バックアップファイルをスリム化しました`);
  }

  function runSilentScenarioAutoCleanup() {
    const diag = diagnoseScenariosCleanup();
    const { renameList, mergeGroups, deleteList } = diag;
    if (!renameList.length && !mergeGroups.length && !deleteList.length) return 0;
    let fixed = 0;
    const toRemoveIds = new Set(deleteList.map(s => String(s.id)));
    mergeGroups.forEach(g => {
      const hadEdit = !!(g.dst.detailEdited || g.srcs.some(s => s && s.detailEdited));
      g.srcs.forEach(src => {
        mergeIntoScenario(src, g.dst);
        toRemoveIds.add(String(src.id));
        fixed++;
      });
      if (g.targetTitle) g.dst.title = g.targetTitle;
      if (g.targetSourcePath) g.dst.sourcePath = g.targetSourcePath;
      if (hadEdit) g.dst.detailEdited = true;
      applyFlatToBlocks(g.dst);
      syncDerivedTagsFromFields(g.dst);
    });
    renameList.forEach(r => {
      if (r.titleChanged) { r.sc.title = r.newTitle; fixed++; }
      if (r.targetSourcePath) r.sc.sourcePath = r.targetSourcePath;
      if (r.sysToSet && !String(r.sc.system || '').trim()) { r.sc.system = r.sysToSet; fixed++; }
      applyFlatToBlocks(r.sc);
      syncDerivedTagsFromFields(r.sc);
    });
    fixed += removeScenariosById(toRemoveIds);
    return fixed;
  }
  window.runSilentScenarioAutoCleanup = runSilentScenarioAutoCleanup;

  document.addEventListener('dragstart', e => {
    const card = e.target.closest && e.target.closest('#dbCardContainer .scenario-db-card[data-sid]');
    if (!card) return;
    if (e.target.closest('a,button,input,select,.fav-star')) { e.preventDefault(); return; }
    dragMergeSid = card.dataset.sid;
    stopHoverShow();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-taku-scenario', dragMergeSid);
    card.classList.add('is-dragging');
  });
  document.addEventListener('dragover', e => {
    if (!dragMergeSid) return;
    const card = e.target.closest && e.target.closest('#dbCardContainer .scenario-db-card[data-sid]');
    document.querySelectorAll('#dbCardContainer .scenario-db-card.merge-drop-target').forEach(el => { if (el !== card) el.classList.remove('merge-drop-target'); });
    if (card && card.dataset.sid !== dragMergeSid) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('merge-drop-target');
    }
  });
  document.addEventListener('dragleave', e => {
    if (!dragMergeSid) return;
    const card = e.target.closest && e.target.closest('#dbCardContainer .scenario-db-card[data-sid]');
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('merge-drop-target');
  });
  document.addEventListener('dragend', () => { dragMergeSid = null; clearMergeMarkers(); });
  document.addEventListener('drop', e => {
    if (!dragMergeSid) return;
    const srcId = dragMergeSid;
    dragMergeSid = null;
    const card = e.target.closest && e.target.closest('#dbCardContainer .scenario-db-card[data-sid]');
    clearMergeMarkers();
    if (!card || card.dataset.sid === srcId) return;
    e.preventDefault();
    mergeScenariosWithConfirm(srcId, card.dataset.sid).catch(er => { logSoft('mergeDrop', er); toast('❌ 統合に失敗しました：' + (er.message || er)); });
  });

  // ---- ライブラリ上部ボタン（シナリオ監視フォルダ設定＆同期・フォルダ一括登録・PDF/ZIP登録） ----
  const WATCH_ROOT_KEY = 'ccf_scenario_watch_root';
  function getScenarioWatchRoot() {
    let p = (window.CCF && CCF.library && CCF.library.state && CCF.library.state.scnWatch) || '';
    if (!p) { try { p = localStorage.getItem(WATCH_ROOT_KEY) || localStorage.getItem('ccf_scn_watch_root') || ''; } catch (_) {} }
    if (!p && typeof appState !== 'undefined' && appState && appState.watchFolders && appState.watchFolders.scenarioRoot) p = String(appState.watchFolders.scenarioRoot);
    return p;
  }
  function updateScnWatchButtonTitle() {
    const p = getScenarioWatchRoot();
    const btn = shEl('btnScnWatchPick');
    if (btn) btn.title = p ? `現在のシナリオ監視フォルダ: ${p}\nクリックして変更` : 'シナリオ用監視フォルダを設定（未設定）';
    const wrap = shEl('scnWatchBadgeWrap');
    const badge = shEl('scnWatchFolderBadge');
    if (wrap && badge) {
      if (p) {
        const base = (typeof path !== 'undefined' && path && path.basename) ? path.basename(p) : (String(p).split(/[\\/]/).filter(Boolean).pop() || p);
        badge.textContent = `📁 ${base}`;
        badge.title = `監視中のシナリオフォルダ: ${p}`;
        wrap.style.display = 'inline-flex';
      } else {
        badge.textContent = '';
        badge.title = '';
        wrap.style.display = 'none';
      }
    }
  }
  window.updateScnWatchButtonTitle = updateScnWatchButtonTitle;
  const isDocFile = n => /\.(pdf|zip|txt|html?|md|docx?)$/i.test(n || '');
  const isImgFile = n => /\.(png|jpe?g|gif|webp|bmp)$/i.test(n || '');
  const isAssetSubdir = n => /^(画像|立ち絵|マップ|背景|素材|資料|配布|ハンドアウト|ho|bgm|se|音声|music|audio|image|images|img|assets?|ccfolia|pdf|txt|doc|docs)$/i.test((n || '').trim());
  const stripExt = n => String(n || '').replace(/\.[^.]+$/, '').trim() || String(n || '');

  function ensureHiddenInput(id, attrs) {
    let el = shEl(id);
    if (el) return el;
    el = document.createElement('input');
    el.type = 'file';
    el.id = id;
    el.style.display = 'none';
    Object.entries(attrs).forEach(([k, v]) => { if (v === true) el[k] = true; else el.setAttribute(k, v); });
    document.body.appendChild(el);
    return el;
  }

  const getDecodeFn = () => (window.CCF && CCF.scan && CCF.scan.decodeTextBytes) || window.decodeTextBytes;
  const getMojibakeFn = () => (window.CCF && CCF.scan && CCF.scan.isMojibakeText) || window.isMojibakeText;

  function textSnippetFromRaw(raw, name) {
    let s = String(raw || '');
    if (/\.html?$/i.test(name || '')) s = s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+\n/g, '\n');
    s = s.replace(/\r\n?/g, '\n').trim().slice(0, 1500);
    const isMj = getMojibakeFn();
    if (isMj && isMj(s)) return '';
    return s;
  }

  function extractCleanSynopsisFromText(_rawText, _fileName) {
    return '';
  }

  async function readElectronImage(fp, nm) {
    if (typeof dataUrlFromPath === 'function') return dataUrlFromPath(fp, nm);
    return '';
  }

  function buildScenarioLookup() {
    const byPath = new Map(), byTitle = new Map();
    const normKey = t => (window.CCF && CCF.dnd && CCF.dnd.normalizeForMatch) ? CCF.dnd.normalizeForMatch(t) : String(t || '').trim().toLowerCase();
    appState.scenarios.forEach(s => {
      if (!s) return;
      if (s.sourcePath) byPath.set(String(s.sourcePath).toLowerCase(), s);
      const k = normKey(s.title);
      if (k && !byTitle.has(k)) byTitle.set(k, s);
    });
    return { byPath, byTitle, normKey };
  }

  function readTextDocBytesDecoded(fp, maxBytes) {
    if (!fp || typeof fs === 'undefined' || !fs) return '';
    let fd;
    try {
      const st = fs.statSync(fp);
      const dec = getDecodeFn();
      if (st.size <= 262144) {
        const buf = fs.readFileSync(fp);
        return dec ? dec(buf) : '';
      }
      const cap = Math.max(8192, maxBytes || 32768);
      fd = fs.openSync(fp, 'r');
      const buf = Buffer.alloc(cap);
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
      let slice = buf.subarray(0, bytes);
      const nl = slice.lastIndexOf(0x0A);
      if (nl > 512) slice = slice.subarray(0, nl);
      return dec ? dec(slice) : '';
    } catch (_) { return ''; }
    finally { try { if (fd !== undefined) fs.closeSync(fd); } catch (_) { } }
  }

  function collectCandidateDocPathsForRepair(sc, extraPaths) {
    const out = [], seen = new Set();
    const addPath = p => {
      if (!p || typeof p !== 'string') return;
      const k = p.replace(/\//g, '\\').trim().toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(p);
    };
    (extraPaths || []).forEach(addPath);
    if (sc && Array.isArray(sc.docs)) {
      sc.docs.forEach(d => {
        if (!d) return;
        if (d.path) addPath(d.path);
        if (d.ref && d.ref !== d.path) addPath(d.ref);
        if (IS_ELECTRON && typeof path !== 'undefined' && typeof DATA_ROOT !== 'undefined' && DATA_ROOT && d.rel) {
          try { addPath(path.resolve(DATA_ROOT, d.rel)); } catch (_) { }
        }
      });
    }
    if (IS_ELECTRON && typeof fs !== 'undefined' && fs && sc && sc.sourcePath) {
      try {
        if (fs.existsSync(sc.sourcePath)) {
          const st = fs.statSync(sc.sourcePath);
          if (st.isFile() && /\.(?:txt|md|markdown|html?|pdf)$/i.test(sc.sourcePath)) {
            addPath(sc.sourcePath);
          } else if (st.isDirectory()) {
            const walk = (dir, depth) => {
              if (depth > 2) return;
              let ents = [];
              try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
              ents.forEach(ent => {
                if (ent.name.startsWith('.') || ent.name === '__MACOSX' || ent.name === 'node_modules' || ent.name === '_TRPG_Data') return;
                const fp = path.join(dir, ent.name);
                if (ent.isDirectory()) return walk(fp, depth + 1);
                if (/\.(?:txt|md|markdown|html?|pdf)$/i.test(ent.name)) addPath(fp);
              });
            };
            walk(sc.sourcePath, 0);
          }
        }
      } catch (_) { }
    }
    return out;
  }

  async function extractSynopsisFromDocsSyncOrAsync(_sc, _extraPaths) {
    return '';
  }
  window.extractSynopsisFromDocsSyncOrAsync = extractSynopsisFromDocsSyncOrAsync;

  async function repairMojibakeScenariosAsync(list, opts) {
    const scenarios = Array.isArray(list) ? list : ((typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : []);
    const pendingSet = (window.__mojibakeRepairPendingIds instanceof Set) ? window.__mojibakeRepairPendingIds : null;
    let changed = false, repairedCount = 0;
    for (const sc of scenarios) {
      if (!sc || !sc.id) continue;
      const res = (typeof window.clearScenarioMojibakeFields === 'function')
        ? window.clearScenarioMojibakeFields(sc)
        : { cleared: false, needSynopsisRepair: false };
      if (res.cleared) {
        changed = true;
        repairedCount++;
        if (typeof applyFlatToBlocks === 'function') applyFlatToBlocks(sc);
      }
      if (pendingSet) pendingSet.delete(String(sc.id));
    }
    if (changed) {
      if (!(opts && opts.skipSave) && typeof saveState === 'function') saveState(false, { skipDetailEdited: true });
      if (!(opts && opts.skipRefresh)) {
        try { if (typeof renderDBView === 'function') renderDBView(true); } catch (_) { }
      }
    }
    return { changed, repairedCount };
  }
  window.repairMojibakeScenariosAsync = repairMojibakeScenariosAsync;

  async function repairScenarioTrailersAsync(list, opts) {
    const scenarios = Array.isArray(list) ? list : ((typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : []);
    const dnd = window.CCF && CCF.dnd;
    if (!dnd || typeof dnd.pickTrailer !== 'function') return 0;
    let fixed = 0;
    for (const sc of scenarios) {
      if (!sc || sc.imageUrl) continue;
      const cands = [];
      (sc.images || []).forEach(im => {
        if (im && (im.dataUrl || im.thumbRef || im.path)) {
          cands.push({ name: im.origName || im.name || '', relPath: im.path || '', category: im.category || '', dataUrl: im.dataUrl || im.thumbRef || '', path: im.path || '' });
        }
      });
      if (window.CCF && CCF.readProject) {
        const proj = CCF.readProject(String(sc.id));
        ((proj && proj.refs) || []).forEach(r => {
          if (r && (r.type === 'image' || isImgFile(r.name || r.path || ''))) {
            cands.push({ name: r.origName || r.name || '', relPath: r.path || '', category: r.category || '', dataUrl: r.dataUrl || r.thumbRef || '', path: r.path || '' });
          }
        });
      }
      const best = dnd.pickTrailer(cands);
      if (!best) continue;
      let du = best.dataUrl || '';
      if (!du && best.path && IS_ELECTRON && typeof fs !== 'undefined' && fs && fs.existsSync(best.path)) {
        try { du = await readElectronImage(best.path, best.name); } catch (_) { du = ''; }
      }
      if (du) {
        if (dnd.setTrailerImage) dnd.setTrailerImage(sc, du, best.name);
        else sc.imageUrl = du;
        fixed++;
      }
    }
    if (fixed && !(opts && opts.skipSave) && typeof saveState === 'function') saveState(false, { skipDetailEdited: true });
    return fixed;
  }
  window.repairScenarioTrailersAsync = repairScenarioTrailersAsync;
  {
    const runBootRepair = () => {
      setTimeout(() => {
        try {
          if (typeof appState !== 'undefined' && appState && Array.isArray(appState.scenarios)) {
            void repairMojibakeScenariosAsync(appState.scenarios);
          }
        } catch (_) { }
      }, 900);
    };
    if (window.appReady && typeof window.appReady.then === 'function') window.appReady.then(runBootRepair);
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runBootRepair);
    else runBootRepair();
  }

  async function upsertScenarioFromDir(dirPath, stats, opts) {
    const dnd = window.CCF && CCF.dnd;
    const M = window.CCFModel;
    const rawBase = path.basename(dirPath);
    if (dnd && typeof dnd.isCategoryFolderName === 'function' && dnd.isCategoryFolderName(rawBase)) return;
    const rawParent = path.basename(path.dirname(dirPath));
    const parentName = (rawParent && rawParent !== path.parse(dirPath).root) ? rawParent : '';
    const parsedTitle = (M && M.extractTitleAndSystem)
      ? M.extractTitleAndSystem(rawBase, parentName)
      : { title: ((dnd && dnd.cleanseTitle) ? dnd.cleanseTitle(rawBase) : '') || rawBase, system: '' };
    const title = parsedTitle.title || rawBase;
    const inheritedSystem = (opts && opts.inheritedSystem) || parsedTitle.system || '';
    const inheritedMeta = {
      system: inheritedSystem,
      playerCount: (opts && opts.inheritedPlayerCount) || '',
      lostRate: (opts && opts.inheritedLostRate) || '',
      tags: Array.isArray(opts && opts.inheritedTags) ? opts.inheritedTags : []
    };
    const lookup = opts && opts.lookup;
    const pathKey = String(dirPath).toLowerCase();
    const titleKey = lookup ? lookup.normKey(title) : '';
    let sc = lookup
      ? (lookup.byPath.get(pathKey) || (titleKey ? lookup.byTitle.get(titleKey) : null))
      : appState.scenarios.find(s => (s.sourcePath && s.sourcePath === dirPath) || titlesSame(s.title, title));
    const isNew = !sc;
    if (!sc) {
      sc = { id: uid(), title, system: inheritedSystem, playerCount: inheritedMeta.playerCount, lostRate: inheritedMeta.lostRate, postedChannels: [], postedInfo: {}, tags: [], imageCategories: [...DEFAULT_SCENARIO_CATS], sourcePath: dirPath };
      appState.scenarios.push(sc);
      if (lookup) {
        lookup.byPath.set(pathKey, sc);
        if (titleKey) lookup.byTitle.set(titleKey, sc);
      }
    } else if (!sc.sourcePath || isAncestorPath(dirPath, sc.sourcePath)) {
      sc.sourcePath = dirPath;
      if (lookup) lookup.byPath.set(pathKey, sc);
    }
    let changed = isNew;
    if (typeof window.clearScenarioMojibakeFields === 'function') {
      const mjRes = window.clearScenarioMojibakeFields(sc);
      if (mjRes.cleared) changed = true;
    }
    if (window.CCF && CCF.assets && typeof CCF.assets.cleanupScenarioAssets === 'function') {
      const preCr = CCF.assets.cleanupScenarioAssets(String(sc.id));
      if (preCr && preCr.changed) changed = true;
    }
    if (dnd && typeof dnd.applyInheritedMeta === 'function') {
      if (dnd.applyInheritedMeta(sc, inheritedMeta)) changed = true;
    } else if (inheritedSystem && !String(sc.system || '').trim()) {
      sc.system = inheritedSystem;
      changed = true;
    }
    sc.imageCategories = sanitizeCats(sc.imageCategories, DEFAULT_SCENARIO_CATS);
    if (!Array.isArray(sc.images)) sc.images = [];
    const isDocFile = (nm, tp) => (dnd && typeof dnd.isDocAssetName === 'function') ? (tp === 'pdf' || tp === 'doc' || dnd.isDocAssetName(nm)) : (tp === 'pdf' || tp === 'doc' || /\.(pdf|txt|html?|md|docx?)$/i.test(String(nm || '')));
    const refs = [], imgs = [], zips = [], pdfs = [], docs = [];
    const scanItems = (dnd && dnd.scanFolder) ? (dnd.scanFolder(dirPath, { skipStat: true }).items || []) : null;
    if (scanItems) {
      const stripAsset = (dnd && typeof dnd.stripAssetExt === 'function') ? dnd.stripAssetExt : (n => String(n || '').replace(/\.(?:png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|m4a|flac|aac|mp4|webm|mov|pdf|txt|md|html?|docx?|zip|json)$/i, '').trim() || String(n || ''));
      scanItems.forEach(it => {
        if (it.type === 'image') imgs.push(it);
        const origNm = it.origName || it.name;
        const cleanNm = stripAsset(origNm);
        if (isDocFile(origNm, it.type)) {
          docs.push({ name: cleanNm, origName: origNm, path: it.path, mtime: it.mtime || 0 });
          pdfs.push({ type: 'pdf', name: origNm, path: it.path, category: '資料', mtime: 0 });
          return;
        }
        const refObj = { type: it.type, name: cleanNm, origName: origNm, path: it.path, category: it.category || '', mtime: 0 };
        refs.push(refObj);
        if (it.type === 'zip') zips.push(refObj);
      });
      if (!String(sc.trailer || '').trim()) {
        const txtPaths = scanItems.filter(it => isDocFile(it.name, it.type) && /\.(txt|html?|md|markdown)$/i.test(it.name) && it.path).map(it => it.path);
        const syn = await extractSynopsisFromDocsSyncOrAsync(sc, txtPaths);
        if (syn) { sc.trailer = syn; changed = true; }
      }
    } else {
      const txtCands = [];
      const walkTxt = (d, depth) => {
        if (depth > 2) return;
        let ents = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        ents.forEach(ent => {
          if (ent.name.startsWith('.') || ent.name === '__MACOSX' || ent.name === 'node_modules') return;
          const fp = path.join(d, ent.name);
          if (ent.isDirectory()) return walkTxt(fp, depth + 1);
          if (isImgFile(ent.name)) {
            imgs.push({ name: ent.name, path: fp, category: '', mtime: 0 });
            refs.push({ type: 'image', name: ent.name, path: fp, category: '', mtime: 0 });
          } else if (/\.zip$/i.test(ent.name)) {
            const refObj = { type: 'zip', name: ent.name, path: fp, category: '', mtime: 0 };
            refs.push(refObj); zips.push(refObj);
          } else if (/\.(pdf|txt|html?|md|docx?)$/i.test(ent.name)) {
            if (/\.(txt|html?|md|markdown)$/i.test(ent.name)) txtCands.push(fp);
            docs.push({ name: ent.name, path: fp, mtime: 0 });
            pdfs.push({ type: 'pdf', name: ent.name, path: fp, category: '資料', mtime: 0 });
          }
        });
      };
      walkTxt(dirPath, 0);
      if (!String(sc.trailer || '').trim()) {
        const syn = await extractSynopsisFromDocsSyncOrAsync(sc, txtCands);
        if (syn) { sc.trailer = syn; changed = true; }
      }
    }

    // 同期高速化のため、画像全件のBase64読込は行わず代表トレーラー1枚のみサムネイル設定（無ければ二重ZIPまで透過探索）
    if (!sc.imageUrl && imgs.length) {
      const cand = dnd && dnd.pickTrailer ? dnd.pickTrailer(imgs) : null;
      if (cand && cand.path) {
        try {
          const dataUrl = await readElectronImage(cand.path, cand.name);
          if (dataUrl) {
            if (dnd && dnd.setTrailerImage) dnd.setTrailerImage(sc, dataUrl, cand.name);
            else sc.imageUrl = dataUrl;
            changed = true;
          }
        } catch (er) { logSoft('importFolderImg', er); }
      }
    }
    if (!sc.imageUrl && zips.length && dnd && dnd.inspectZipsForScenario) {
      const zInfo = await dnd.inspectZipsForScenario(zips, { needTrailer: true, fallbackFirstImage: false });
      if (zInfo.trailerDataUrl) {
        if (dnd.setTrailerImage) dnd.setTrailerImage(sc, zInfo.trailerDataUrl, zInfo.trailerName || 'trailer.png');
        else sc.imageUrl = zInfo.trailerDataUrl;
        changed = true;
      }
    }
    if (docs.length && dnd && typeof dnd.upsertScenarioDocs === 'function') {
      if (dnd.upsertScenarioDocs(sc, docs)) changed = true;
    }
    if (refs.length && window.CCF && CCF.withProject && window.CCFModel) {
      const normP = p => String(p || '').replace(/\//g, '\\').trim().toLowerCase();
      const normN = n => String(n || '').normalize('NFKC').trim().toLowerCase();
      const curProj = CCF.readProject(String(sc.id));
      const existingRefs = new Set(), existingByName = new Map();
      (curProj.refs || []).forEach(r => {
        if (!r) return;
        if (r.path) existingRefs.add(normP(r.path));
        const nk = normN(r.origName || r.name || '');
        if (nk && !existingByName.has(nk)) existingByName.set(nk, r);
      });
      const newRefs = [];
      refs.forEach(r => {
        if (!r || !r.path) return;
        const pk = normP(r.path), nk = normN(r.name);
        if (existingRefs.has(pk)) return;
        const hit = nk ? existingByName.get(nk) : null;
        if (hit) {
          const better = (M.normalizeStandardCat ? M.normalizeStandardCat(r.category) : r.category) || '';
          const curCat = (M.normalizeStandardCat ? M.normalizeStandardCat(hit.category) : hit.category) || '';
          if (!curCat && better) { hit.category = better; changed = true; }
          return;
        }
        existingRefs.add(pk);
        if (nk) existingByName.set(nk, r);
        newRefs.push(r);
      });
      if (newRefs.length) {
        const newZips = newRefs.filter(r => r.type === 'zip' && !r.category);
        if (newZips.length && dnd && dnd.inspectZipsForScenario) {
          await dnd.inspectZipsForScenario(newZips, { needTrailer: false });
        }
        CCF.withProject(String(sc.id), proj => CCFModel.addRefs(proj, newRefs));
        changed = true;
      }
    }
    if (window.CCF && CCF.assets && typeof CCF.assets.cleanupScenarioAssets === 'function') {
      const cr = CCF.assets.cleanupScenarioAssets(String(sc.id));
      if (cr && cr.changed) changed = true;
    }
    applyFlatToBlocks(sc);
    if (syncDerivedTagsFromFields(sc)) changed = true;
    if (isNew) stats.added++; else if (changed) stats.updated++;
    if (stats && Array.isArray(stats.touchedIds)) stats.touchedIds.push(sc.id);
  }

  async function upsertScenarioFromFilePath(fp, name, fileObj, opts) {
    const dnd = window.CCF && CCF.dnd;
    const M = window.CCFModel;
    const rawBase = stripExt(name);
    const rawParent = fp ? path.basename(path.dirname(fp)) : '';
    const parentName = (fp && rawParent && rawParent !== path.parse(fp).root) ? rawParent : '';
    const parsedTitle = (M && M.extractTitleAndSystem)
      ? M.extractTitleAndSystem(rawBase, parentName)
      : { title: ((dnd && dnd.cleanseTitle) ? dnd.cleanseTitle(rawBase) : '') || rawBase, system: '' };
    const title = parsedTitle.title || rawBase;
    const inheritedSystem = (opts && opts.inheritedSystem) || parsedTitle.system || '';
    const inheritedMeta = {
      system: inheritedSystem,
      playerCount: (opts && opts.inheritedPlayerCount) || '',
      lostRate: (opts && opts.inheritedLostRate) || '',
      tags: Array.isArray(opts && opts.inheritedTags) ? opts.inheritedTags : []
    };
    const lookup = opts && opts.lookup;
    const pathKey = fp ? String(fp).toLowerCase() : '';
    const titleKey = lookup ? lookup.normKey(title) : '';
    let sc = lookup
      ? ((pathKey && lookup.byPath.get(pathKey)) || (titleKey ? lookup.byTitle.get(titleKey) : null))
      : appState.scenarios.find(s => (fp && s.sourcePath === fp) || titlesSame(s.title, title));
    const isNew = !sc;
    if (!sc) {
      sc = { id: uid(), title, system: inheritedSystem, playerCount: inheritedMeta.playerCount, lostRate: inheritedMeta.lostRate, postedChannels: [], postedInfo: {}, tags: [], imageCategories: [...DEFAULT_SCENARIO_CATS], sourcePath: fp || '' };
      appState.scenarios.push(sc);
      if (lookup) {
        if (pathKey) lookup.byPath.set(pathKey, sc);
        if (titleKey) lookup.byTitle.set(titleKey, sc);
      }
    } else if (fp && !sc.sourcePath) {
      sc.sourcePath = fp;
      if (lookup && pathKey) lookup.byPath.set(pathKey, sc);
    }
    let changed = isNew;
    if (typeof window.clearScenarioMojibakeFields === 'function') {
      const mjRes = window.clearScenarioMojibakeFields(sc);
      if (mjRes.cleared) changed = true;
    }
    if (dnd && typeof dnd.applyInheritedMeta === 'function') {
      if (dnd.applyInheritedMeta(sc, inheritedMeta)) changed = true;
    } else if (inheritedSystem && !String(sc.system || '').trim()) {
      sc.system = inheritedSystem;
      changed = true;
    }
    if (/\.(txt|html?|md|markdown)$/i.test(name) && !String(sc.trailer || '').trim()) {
      try {
        let raw = '';
        if (IS_ELECTRON && fp && fs) {
          raw = readTextDocBytesDecoded(fp, 32768);
        } else if (fileObj) {
          const dec = getDecodeFn();
          const u8 = new Uint8Array(await fileObj.arrayBuffer());
          raw = dec ? dec(u8) : '';
        }
        const snip = extractCleanSynopsisFromText(raw, name);
        if (snip) { sc.trailer = snip; changed = true; }
      } catch (_) {}
    }
    let zipCategory = '';
    if (/\.zip$/i.test(name) && fp && window.CCF && CCF.zip && CCF.zip.inspectDeep) {
      const existing0 = new Set((CCF.readProject(String(sc.id)).refs || []).map(r => r && String(r.path || '').toLowerCase()));
      if (!sc.imageUrl || !existing0.has(String(fp).toLowerCase())) {
        try {
          const zInfo = await CCF.zip.inspectDeep(fp, { maxDepth: 2, toDataUrl: true, fallbackFirstImage: false });
          if (zInfo.isRoomZip) zipCategory = 'ココフォリア部屋ZIP';
          else if (!sc.imageUrl && zInfo.trailerDataUrl) {
            if (!Array.isArray(sc.images)) sc.images = [];
            if (dnd && dnd.setTrailerImage) dnd.setTrailerImage(sc, zInfo.trailerDataUrl, zInfo.trailerName || 'trailer.png');
            else sc.imageUrl = zInfo.trailerDataUrl;
            changed = true;
          }
        } catch (_) { }
      }
    }
    const isDoc = (dnd && typeof dnd.isDocAssetName === 'function') ? dnd.isDocAssetName(name) : /\.(pdf|txt|html?|md|docx?)$/i.test(String(name || ''));
    if (IS_ELECTRON && fp && isDoc) {
      if (dnd && typeof dnd.upsertScenarioDocs === 'function') {
        if (dnd.upsertScenarioDocs(sc, [{ name, origName: name, path: fp, mtime: 0 }])) changed = true;
      }
    } else if (IS_ELECTRON && fp && window.CCF && CCF.withProject && window.CCFModel) {
      const type = /\.zip$/i.test(name) ? 'zip' : 'pdf';
      const existing = new Set((CCF.readProject(String(sc.id)).refs || []).map(r => r && String(r.path || '').toLowerCase()));
      if (!existing.has(String(fp).toLowerCase())) {
        const cleanNm = (dnd && typeof dnd.stripAssetExt === 'function') ? dnd.stripAssetExt(name) : name;
        CCF.withProject(String(sc.id), proj => CCFModel.addRefs(proj, [{ type, name: cleanNm, origName: name, path: fp, category: zipCategory, mtime: 0 }]));
        changed = true;
      }
    }
    applyFlatToBlocks(sc);
    if (syncDerivedTagsFromFields(sc)) changed = true;
    return { isNew, changed, id: sc.id };
  }

  async function importFolderRootElectron(rootDir, opts) {
    const stats = { added: 0, updated: 0, touchedIds: [] };
    if (!IS_ELECTRON || !fs || !fs.existsSync(rootDir)) return stats;
    const isWatchRoot = !!(opts && opts.isWatchRoot);
    const lib = window.CCF && CCF.library;
    if (lib && lib.setSyncing) lib.setSyncing(true);
    if (typeof window.beginSuppressDetailEdited === 'function') window.beginSuppressDetailEdited();
    try {
      const dnd = window.CCF && CCF.dnd;
      const entries = (dnd && typeof dnd.discoverScenarioEntries === 'function')
        ? dnd.discoverScenarioEntries(rootDir, { maxDepth: 5, isWatchRoot })
        : fs.readdirSync(rootDir, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX' && e.name !== 'node_modules' && e.name !== '_TRPG_Data')
          .map(e => ({ p: path.join(rootDir, e.name), dir: true, type: 'dir', inheritedSystem: '', inheritedPlayerCount: '', inheritedTags: [] }));
      const lookup = buildScenarioLookup();
      for (const ent of entries) {
        if (ent.dir) {
          await upsertScenarioFromDir(ent.p, stats, {
            inheritedSystem: ent.inheritedSystem || '',
            inheritedPlayerCount: ent.inheritedPlayerCount || '',
            inheritedLostRate: ent.inheritedLostRate || '',
            inheritedTags: ent.inheritedTags || [],
            lookup
          });
        } else {
          const res = await upsertScenarioFromFilePath(ent.p, path.basename(ent.p), null, {
            inheritedSystem: ent.inheritedSystem || '',
            inheritedPlayerCount: ent.inheritedPlayerCount || '',
            inheritedLostRate: ent.inheritedLostRate || '',
            inheritedTags: ent.inheritedTags || [],
            lookup
          });
          if (res.id) stats.touchedIds.push(res.id);
          if (res.isNew) stats.added++; else if (res.changed) stats.updated++;
        }
      }
      if (typeof window.repairMojibakeScenariosAsync === 'function') {
        const mjR = await window.repairMojibakeScenariosAsync(appState.scenarios || [], { skipSave: true, skipRefresh: true });
        if (mjR && mjR.repairedCount) stats.updated += mjR.repairedCount;
      }
      if (window.CCF && CCF.assets && typeof CCF.assets.cleanupAllScenarioAssets === 'function') {
        CCF.assets.cleanupAllScenarioAssets();
      }
      if (typeof window.repairScenarioTrailersAsync === 'function') {
        await window.repairScenarioTrailersAsync(appState.scenarios || [], { skipSave: true });
      }
      return stats;
    } finally {
      if (typeof window.endSuppressDetailEdited === 'function') window.endSuppressDetailEdited();
      if (lib && lib.setSyncing) lib.setSyncing(false);
    }
  }

  async function importFolderFilesWebFallback(files, opts) {
    const stats = { added: 0, updated: 0, touchedIds: [] };
    const isWatchRoot = !!(opts && opts.isWatchRoot);
    const list = Array.from(files || []).map(item => (item && item.file) ? item : ({ file: item, name: item.name, rel: item.webkitRelativePath || item.name }));
    const M = window.CCFModel;
    const dnd = window.CCF && CCF.dnd;
    const isCatDir = n => (dnd && typeof dnd.isCategoryFolderName === 'function') ? dnd.isCategoryFolderName(n) : (M && M.isCategoryFolderName ? M.isCategoryFolderName(n) : false);
    const isPureAssetDir = n => (dnd && typeof dnd.isPureGenericAssetDir === 'function') ? dnd.isPureGenericAssetDir(n) : isAssetSubdir(n);
    const classifyC = (dnd && typeof dnd.classifyContainerEnhanced === 'function') ? dnd.classifyContainerEnhanced : (M && M.classifyContainerEntries ? M.classifyContainerEntries : null);
    const mergeMeta = (dnd && typeof dnd.mergeInheritedMeta === 'function') ? dnd.mergeInheritedMeta : ((base, n) => ({ system: (M && M.inferSystemFromFolderName ? M.inferSystemFromFolderName(n) : '') || base.system || '', playerCount: base.playerCount || '', tags: base.tags || [] }));
    const groups = [];
    if (classifyC) {
      const byRoot = new Map();
      list.forEach(({ file, rel }) => {
        if (!file) return;
        const parts = String(rel || file.name).split('/').filter(Boolean);
        const rootName = parts.length > 1 ? parts[0] : (parts[0] || stripExt(file.name));
        if (!byRoot.has(rootName)) byRoot.set(rootName, []);
        byRoot.get(rootName).push({ file, rel, parts });
      });
      byRoot.forEach((items, rootName) => {
        const makeNode = name => ({ name, dirs: new Map(), files: [] });
        const root = makeNode(rootName);
        const isOldName = n => (dnd && typeof dnd.isOldVersionName === 'function') ? dnd.isOldVersionName(n) : (M && M.isOldFolderName && M.isOldFolderName(n));
        const filterLatest = arr => (dnd && typeof dnd.filterLatestVersionEntries === 'function') ? dnd.filterLatestVersionEntries(arr) : arr;
        items.forEach(({ file, rel, parts }) => {
          const relParts = parts.length > 1 ? parts.slice(1) : parts;
          let cur = root;
          for (let i = 0; i < relParts.length - 1; i++) {
            const d = relParts[i];
            if (!d || d.startsWith('.') || d === '__MACOSX' || d === 'node_modules' || isOldName(d)) { cur = null; break; }
            if (!cur.dirs.has(d)) cur.dirs.set(d, makeNode(d));
            cur = cur.dirs.get(d);
          }
          const fn = relParts[relParts.length - 1];
          if (cur && !isOldName(fn)) cur.files.push({ file, rel, name: fn });
        });
        const flatten = n => {
          const sib = [];
          n.dirs.forEach((sub, dn) => sib.push({ name: dn, isDir: true, sub, mtime: 0 }));
          n.files.forEach(x => sib.push({ name: x.name, isDir: false, file: x.file, rel: x.rel, mtime: Number((x.file && x.file.lastModified) || 0) }));
          const kept = filterLatest(sib);
          const acc = [];
          kept.forEach(k => {
            if (k.isDir) acc.push(...flatten(k.sub));
            else acc.push({ file: k.file, rel: k.rel });
          });
          return acc;
        };
        const CHILD_SCN_RE = /\.(?:pdf|txt|docx?|md|markdown|html?|zip)$/i;
        const nodeHasScenarioFiles = (subNode, d = 0) => {
          if (!subNode || d > 2) return false;
          if (subNode.files.some(x => CHILD_SCN_RE.test(x.name))) return true;
          for (const ch of subNode.dirs.values()) {
            if (nodeHasScenarioFiles(ch, d + 1)) return true;
          }
          return false;
        };
        (function walk(node, inheritedMeta, depth) {
          const sib = [];
          node.dirs.forEach((sub, dn) => sib.push({ name: dn, isDir: true, mtime: 0 }));
          node.files.forEach(x => sib.push({ name: x.name, isDir: false, file: x.file, rel: x.rel, mtime: Number((x.file && x.file.lastModified) || 0) }));
          const keptSib = filterLatest(sib);
          const dirNames = keptSib.filter(x => x.isDir).map(x => x.name).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
          const keptFiles = keptSib.filter(x => !x.isDir);
          const fileNames = keptFiles.map(x => x.name);
          const catFlag = isCatDir(node.name);
          const atWatchRoot = isWatchRoot && depth === 0;
          if (depth >= 5) {
            const all = flatten(node);
            if (!catFlag && !atWatchRoot && all.length) groups.push({ title: node.name, gList: all, inheritedSystem: inheritedMeta.system, inheritedPlayerCount: inheritedMeta.playerCount, inheritedLostRate: inheritedMeta.lostRate || '', inheritedTags: inheritedMeta.tags.slice() });
            return;
          }
          const kind = classifyC({ name: node.name, dirNames, fileNames, isWatchRoot: atWatchRoot, childHasScenarioFn: dn => nodeHasScenarioFiles(node.dirs.get(dn), 0) });
          if (kind === 'empty') return;
          if (kind === 'scenario' && !catFlag && !atWatchRoot) {
            const all = flatten(node);
            if (all.length) groups.push({ title: node.name, gList: all, inheritedSystem: inheritedMeta.system, inheritedPlayerCount: inheritedMeta.playerCount, inheritedLostRate: inheritedMeta.lostRate || '', inheritedTags: inheritedMeta.tags.slice() });
            return;
          }
          const nextMeta = atWatchRoot ? inheritedMeta : mergeMeta(inheritedMeta, node.name);
          dirNames.forEach(dn => {
            if (!isPureAssetDir(dn)) walk(node.dirs.get(dn), nextMeta, depth + 1);
          });
          keptFiles.forEach(({ file, rel, name }) => {
            if (/\.(?:zip|pdf|txt|html?|md|docx?)$/i.test(name) && !/^read\s*me\./i.test(name)) {
              groups.push({ title: stripExt(name), gList: [{ file, rel }], inheritedSystem: nextMeta.system, inheritedPlayerCount: nextMeta.playerCount, inheritedLostRate: nextMeta.lostRate || '', inheritedTags: nextMeta.tags.slice() });
            }
          });
        })(root, { system: '', playerCount: '', lostRate: '', tags: [] }, 0);
      });
    } else {
      const map = new Map();
      list.forEach(({ file, rel }) => {
        if (!file) return;
        const parts = String(rel || file.name).split('/').filter(Boolean);
        const sub = (isWatchRoot && parts.length >= 3) ? parts[1] : (parts[0] || stripExt(file.name));
        if (!map.has(sub)) map.set(sub, []);
        map.get(sub).push({ file, rel });
      });
      map.forEach((gList, title) => groups.push({ title, gList, inheritedSystem: '', inheritedPlayerCount: '', inheritedLostRate: '', inheritedTags: [] }));
    }

    if (typeof window.beginSuppressDetailEdited === 'function') window.beginSuppressDetailEdited();
    try {
      for (const grp of groups) {
        if (isCatDir(grp.title)) continue;
        const parsedTitle = (M && M.extractTitleAndSystem)
          ? M.extractTitleAndSystem(grp.title, '')
          : { title: ((dnd && dnd.cleanseTitle) ? dnd.cleanseTitle(grp.title) : '') || grp.title, system: '' };
        const title = parsedTitle.title || grp.title;
        const gList = grp.gList;
        const inheritedSystem = grp.inheritedSystem || parsedTitle.system || '';
        const inheritedMeta = {
          system: inheritedSystem,
          playerCount: grp.inheritedPlayerCount || '',
          lostRate: grp.inheritedLostRate || '',
          tags: Array.isArray(grp.inheritedTags) ? grp.inheritedTags : []
        };
        let sc = appState.scenarios.find(s => titlesSame(s.title, title));
        const isNew = !sc;
        if (!sc) {
          sc = { id: uid(), title, system: inheritedSystem, playerCount: inheritedMeta.playerCount, lostRate: inheritedMeta.lostRate, postedChannels: [], postedInfo: {}, tags: [], imageCategories: [...DEFAULT_SCENARIO_CATS] };
          appState.scenarios.push(sc);
        }
        if (!Array.isArray(sc.images)) sc.images = [];
        let changed = isNew;
        if (typeof window.clearScenarioMojibakeFields === 'function') {
          const mjRes = window.clearScenarioMojibakeFields(sc);
          if (mjRes.cleared) changed = true;
        }
        if (window.CCF && CCF.assets && typeof CCF.assets.cleanupScenarioAssets === 'function') {
          const preCr = CCF.assets.cleanupScenarioAssets(String(sc.id));
          if (preCr && preCr.changed) changed = true;
        }
        if (dnd && typeof dnd.applyInheritedMeta === 'function') {
          if (dnd.applyInheritedMeta(sc, inheritedMeta)) changed = true;
        } else if (inheritedSystem && !String(sc.system || '').trim()) { sc.system = inheritedSystem; changed = true; }
        const refsToAdd = [], zipFiles = [], docsToAdd = [], trailerPool = [];
        let hasLooseImg = false, hasLoosePdf = false;
        const curProj = (window.CCF && CCF.readProject) ? CCF.readProject(String(sc.id)) : null;
        const curRefByName = new Map();
        ((curProj && curProj.refs) || []).forEach(r => {
          if (!r) return;
          const rk = String(r.origName || r.name || '').normalize('NFKC').trim().toLowerCase();
          if (rk && !curRefByName.has(rk)) curRefByName.set(rk, r);
        });
        const curImgByName = new Map();
        sc.images.forEach((im, idx) => {
          if (!im) return;
          const ik = String(im.origName || im.name || '').normalize('NFKC').trim().toLowerCase();
          if (ik && !curImgByName.has(ik)) curImgByName.set(ik, idx);
        });
        for (const { file: f, rel } of gList) {
          const fk = String(f.name || '').normalize('NFKC').trim().toLowerCase();
          const fm = Number(f.lastModified || 0);
          const relParts = String(rel || f.name).split('/').filter(Boolean);
          const dirParts = relParts.slice(0, -1);
          const baseIdx = dirParts.lastIndexOf(grp.title);
          const relDirs = baseIdx >= 0 ? dirParts.slice(baseIdx + 1) : dirParts;
          const relPath = [...relDirs, f.name].join('/');
          const subDir = relParts.length >= 2 ? relParts[relParts.length - 2] : '';
          const smartCat = (M && typeof M.inferSmartCategoryFromFolders === 'function')
            ? M.inferSmartCategoryFromFolders(f.name, relDirs, grp.title)
            : ((M && M.inferSmartCategory) ? M.inferSmartCategory(f.name, subDir === grp.title ? '' : subDir) : '');
          if (isImgFile(f.name)) {
            hasLooseImg = true;
            const exIdx = curImgByName.get(fk);
            if (exIdx !== undefined) {
              const ex = sc.images[exIdx];
              if (!ex.category && smartCat) { ex.category = smartCat; changed = true; }
              if (ex.dataUrl) trailerPool.push({ name: f.name, relPath, category: ex.category || smartCat, dataUrl: ex.dataUrl });
              if (!fm || !ex.mtime || fm <= ex.mtime) continue;
              const dataUrl = await compressImage(f, 1000, 1000, 0.82);
              if (dataUrl) {
                sc.images[exIdx] = Object.assign({}, ex, { dataUrl, mtime: fm, category: ex.category || smartCat || '' });
                trailerPool.push({ name: f.name, relPath, category: ex.category || smartCat, dataUrl });
                changed = true;
              }
              continue;
            }
            const dataUrl = await compressImage(f, 1000, 1000, 0.82);
            if (dataUrl) {
              curImgByName.set(fk, sc.images.length);
              const cleanNm = (dnd && typeof dnd.stripAssetExt === 'function') ? dnd.stripAssetExt(f.name) : f.name;
              sc.images.push({ id: galId(), name: cleanNm, origName: f.name, dataUrl, category: smartCat, mtime: fm, addedAt: Date.now() });
              trailerPool.push({ name: f.name, relPath, category: smartCat, dataUrl });
              changed = true;
            }
          } else {
            if (/\.pdf$/i.test(f.name)) hasLoosePdf = true;
            if (/\.(txt|html?|md|markdown)$/i.test(f.name) && !String(sc.trailer || '').trim()) {
              const dec = getDecodeFn();
              const u8 = new Uint8Array(await f.arrayBuffer());
              const raw = dec ? dec(u8) : '';
              const snip = extractCleanSynopsisFromText(raw, f.name);
              if (snip) { sc.trailer = snip; changed = true; }
            }
            if (window.WebBridge && WebBridge.saveAssetFile) {
              const isDoc = /\.(pdf|txt|html?|md|docx?)$/i.test(f.name);
              const tp = /\.zip$/i.test(f.name) ? 'zip' : /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name) ? 'audio' : isDoc ? 'doc' : '';
              if (isDoc) {
                const ref = await WebBridge.saveAssetFile(f);
                if (ref) docsToAdd.push({ name: f.name, origName: f.name, path: ref, mtime: fm });
              } else if (tp) {
                const exRef = curRefByName.get(fk);
                if (exRef && (!fm || !exRef.mtime || fm <= exRef.mtime)) {
                  if (!exRef.category && smartCat) { exRef.category = smartCat; changed = true; }
                  continue;
                }
                const ref = await WebBridge.saveAssetFile(f);
                if (ref) {
                  const cleanNm = (dnd && typeof dnd.stripAssetExt === 'function') ? dnd.stripAssetExt(f.name) : f.name;
                  const refObj = { type: tp, name: cleanNm, origName: f.name, path: ref, category: smartCat, mtime: fm };
                  refsToAdd.push(refObj);
                  if (tp === 'zip') zipFiles.push({ path: f, ref: refObj });
                }
              }
            }
          }
        }
        if (!sc.imageUrl && trailerPool.length && dnd && typeof dnd.pickTrailer === 'function') {
          const cand = dnd.pickTrailer(trailerPool);
          if (cand && cand.dataUrl) {
            if (dnd.setTrailerImage) dnd.setTrailerImage(sc, cand.dataUrl, cand.name);
            else sc.imageUrl = cand.dataUrl;
            changed = true;
          }
        }
        if (docsToAdd.length && dnd && typeof dnd.upsertScenarioDocs === 'function') {
          if (dnd.upsertScenarioDocs(sc, docsToAdd)) changed = true;
        }
        if (zipFiles.length && dnd && dnd.inspectZipsForScenario) {
          const zInfo = await dnd.inspectZipsForScenario(zipFiles, { needTrailer: !sc.imageUrl, fallbackFirstImage: false });
          if (!sc.imageUrl && zInfo.trailerDataUrl) {
            if (dnd.setTrailerImage) dnd.setTrailerImage(sc, zInfo.trailerDataUrl, zInfo.trailerName || 'trailer.png');
            else sc.imageUrl = zInfo.trailerDataUrl;
            changed = true;
          }
        }
        if (refsToAdd.length && window.CCF && CCF.withProject && window.CCFModel) {
          const existingRefs = new Set((CCF.readProject(String(sc.id)).refs || []).map(r => r && r.path));
          const newRefs = refsToAdd.filter(r => r.path && !existingRefs.has(r.path));
          if (newRefs.length) {
            CCF.withProject(String(sc.id), proj => CCFModel.addRefs(proj, newRefs));
            changed = true;
          }
        }
        if (window.CCF && CCF.assets && typeof CCF.assets.cleanupScenarioAssets === 'function') {
          const cr = CCF.assets.cleanupScenarioAssets(String(sc.id));
          if (cr && cr.changed) changed = true;
        }
        applyFlatToBlocks(sc);
        if (syncDerivedTagsFromFields(sc)) changed = true;
        stats.touchedIds.push(sc.id);
        if (isNew) stats.added++; else if (changed) stats.updated++;
      }
      if (typeof window.repairMojibakeScenariosAsync === 'function') {
        const mjR = await window.repairMojibakeScenariosAsync(appState.scenarios || [], { skipSave: true, skipRefresh: true });
        if (mjR && mjR.repairedCount) stats.updated += mjR.repairedCount;
      }
      await repairScenarioTrailersAsync(appState.scenarios || [], { skipSave: true });
      return stats;
    } finally {
      if (typeof window.endSuppressDetailEdited === 'function') window.endSuppressDetailEdited();
    }
  }

  function resolveRootFromFileList(files) {
    if (!IS_ELECTRON || !path || !files || !files.length) return '';
    const f = files[0], fp = typeof filePathOf === 'function' ? filePathOf(f) : (f.path || '');
    const parts = (f.webkitRelativePath || '').split('/').filter(Boolean);
    if (!fp || parts.length < 2) return fp ? path.dirname(fp) : '';
    let dir = fp;
    for (let i = 1; i < parts.length; i++) dir = path.dirname(dir);
    return dir;
  }

  function finishLibraryImport(stats, label, opts) {
    if (window.CCF && CCF.assets) {
      if (typeof CCF.assets.cleanupAllScenarioAssets === 'function') CCF.assets.cleanupAllScenarioAssets();
      if (typeof CCF.assets.invalidateUnified === 'function') CCF.assets.invalidateUnified(null, true);
    }
    dbSig = '';
    dbLimit = DB_CHUNK_SIZE;
    dbPageState = null;
    if (typeof window.primeScenarioSigs === 'function' && stats && Array.isArray(stats.touchedIds) && stats.touchedIds.length) {
      window.primeScenarioSigs(stats.touchedIds);
    }
    saveState(false, { skipDetailEdited: true });
    populateScenarioDBSelect();
    renderDBView(true);
    if (typeof renderSidebarTags === 'function') renderSidebarTags();
    if (typeof renderGalleryAll === 'function') renderGalleryAll();
    if (window.CCF && CCF.S && CCF.S.ready) {
      try { CCF.buildProjectSelect(); } catch (_) {}
      if (CCF.library) CCF.library.render();
    }
    const added = (stats && stats.added) || 0, updated = (stats && stats.updated) || 0;
    if (opts && opts.isWatchSync) {
      toast(`✅ 監視フォルダを同期しました（新規追加: ${added}件 / 更新: ${updated}件）`);
    } else if (added || updated) {
      toast(`✅ ${label}：新規 ${added}件 / 更新 ${updated}件`);
    } else {
      toast(`✅ ${label}：新しい変更はありませんでした`);
    }
  }

  async function pickScenarioWatchFolder() {
    let picked = '';
    if (window.CCF && CCF.library && typeof CCF.library.pickScenarioWatch === 'function') {
      try { picked = await CCF.library.pickScenarioWatch({ skipSync: true, quiet: true }); } catch (er) { logSoft('ccfScnPick', er); }
    } else if (window.CCF && CCF.electron && CCF.electron.ipcRenderer) {
      try {
        const r = await CCF.electron.ipcRenderer.invoke('ccf:pick', { title: 'シナリオ用監視フォルダを選ぶ', properties: ['openDirectory'] });
        if (r && r[0]) picked = r[0];
      } catch (er) { logSoft('ipcScnPick', er); }
    } else {
      const inp = ensureHiddenInput('libWatchFolderInput', { webkitdirectory: true, multiple: true });
      picked = await new Promise(resolve => {
        inp.value = '';
        inp.onchange = () => resolve(inp.files && inp.files.length ? resolveRootFromFileList(inp.files) : '');
        inp.click();
      });
    }
    if (picked) {
      try { localStorage.setItem(WATCH_ROOT_KEY, picked); localStorage.setItem('ccf_scn_watch_root', picked); } catch (_) {}
      if (window.CCF && CCF.library && typeof CCF.library.setScenarioWatchRoot === 'function') {
        CCF.library.setScenarioWatchRoot(picked, { skipSync: true });
      } else if (typeof appState !== 'undefined' && appState) {
        appState.watchFolders = Object.assign({}, appState.watchFolders, { scenarioRoot: picked });
        if (typeof saveState === 'function') saveState(true);
      }
      updateScnWatchButtonTitle();
    }
    return picked;
  }

  async function unwatchScenarioFolder() {
    const watchRoot = getScenarioWatchRoot();
    if (!watchRoot) return;
    const folderLabel = (typeof path !== 'undefined' && path && path.basename) ? path.basename(watchRoot) : watchRoot;
    const choice = await appChoice(
      `シナリオ監視フォルダ「${folderLabel}」の監視を解除します。\n登録済みシナリオの扱いを選択してください。`,
      [
        { label: '監視のみ解除（登録済みシナリオは残す）', value: 'unwatch', kind: 'primary' },
        { label: '監視を解除し、誤登録されたシステム名フォルダ等を削除', value: 'cleanup', kind: 'danger' },
        { label: 'キャンセル', value: 'cancel' }
      ],
      { title: 'シナリオ監視フォルダの解除' }
    );
    if (choice !== 'unwatch' && choice !== 'cleanup') return;

    if (window.CCF && CCF.library && typeof CCF.library.clearScenarioWatch === 'function') {
      CCF.library.clearScenarioWatch();
    }
    try { localStorage.removeItem(WATCH_ROOT_KEY); localStorage.removeItem('ccf_scn_watch_root'); } catch (_) {}
    if (typeof appState !== 'undefined' && appState) {
      appState.watchFolders = Object.assign({}, appState.watchFolders, { scenarioRoot: '' });
      if (typeof saveState === 'function') saveState(true);
    }
    if (!IS_ELECTRON && typeof window.idbSetRaw === 'function') {
      try { await window.idbSetRaw('web_scenario_watch_dir_handle', null); } catch (_) {}
    }

    if (choice === 'cleanup') {
      const M = window.CCFModel;
      const normP = p => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
      const rootNorm = normP(watchRoot);
      const isFromWatch = sc => {
        if (!rootNorm || !sc || !sc.sourcePath) return false;
        const sp = normP(sc.sourcePath);
        return sp === rootNorm || sp.startsWith(rootNorm + '\\') || sp.startsWith(rootNorm + '/');
      };
      const isUnedited = sc => !(sc.postedChannels && sc.postedChannels.length)
        && !sc.favorite
        && !String(sc.playStatus || '').trim()
        && !String(sc.notes || '').trim()
        && !String(sc.trailer || '').trim()
        && !String(sc.shopUrl || '').trim()
        && !(sc.secretHOs && sc.secretHOs.length);
      const isMisregisteredCategory = sc => {
        const t = String(sc && sc.title || '').trim();
        if (!t) return true;
        const dnd = window.CCF && CCF.dnd;
        const isCat = (dnd && typeof dnd.isCategoryFolderName === 'function' && dnd.isCategoryFolderName(t)) || (M && M.isCategoryFolderName && M.isCategoryFolderName(t));
        if (/^[☆★●◆◎○■□▲△▼▽]/.test(t) && isCat) return true;
        if (isCat && !(sc.postedChannels && sc.postedChannels.length) && !String(sc.notes || '').trim()) return true;
        return false;
      };
      const isEmptyMisregistered = sc => isUnedited(sc)
        && !sc.imageUrl
        && !(sc.images && sc.images.length)
        && !(sc.docs && sc.docs.length)
        && (!window.CCF || !CCF.readProject || !((CCF.readProject(String(sc.id)).refs || []).length));

      const removedIds = [];
      if (window.AppHistory) AppHistory.checkpoint('監視解除と誤登録シナリオの削除');
      appState.scenarios = (appState.scenarios || []).filter(sc => {
        const drop = isMisregisteredCategory(sc) || isEmptyMisregistered(sc) || (isFromWatch(sc) && isUnedited(sc));
        if (drop && sc && sc.id) {
          removedIds.push(sc.id);
          (appState.deletedScenarios = appState.deletedScenarios || {})[sc.id] = nowTs();
          return false;
        }
        return true;
      });
      if (removedIds.length) {
        if (removedIds.includes(currentScenarioId)) currentScenarioId = null;
        dbSig = ''; dbLimit = DB_CHUNK_SIZE;
        saveState();
        populateScenarioDBSelect();
        renderDBView();
        if (typeof cleanupUnusedImages === 'function') cleanupUnusedImages();
        if (window.CCF && CCF.S && CCF.S.ready) { try { CCF.buildProjectSelect(); } catch (_) {} }
      }
      updateScnWatchButtonTitle();
      toast(`🧹 監視を解除し、誤登録・未編集シナリオ ${removedIds.length}件を削除しました`);
      return;
    }

    updateScnWatchButtonTitle();
    toast('🛑 シナリオ監視フォルダの監視を解除しました');
  }

  async function runWatchSync(forcePick) {
    if (!IS_ELECTRON) {
      let handle = null;
      const canPicker = typeof window.showDirectoryPicker === 'function' && /^https?:$/i.test(location.protocol);
      if (canPicker) {
        try {
          if (!forcePick && typeof window.idbGetRaw === 'function') handle = await window.idbGetRaw('web_scenario_watch_dir_handle');
          if (handle) {
            let perm = await handle.queryPermission({ mode: 'read' });
            if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
            if (perm !== 'granted') handle = null;
          }
        } catch (_) { handle = null; }
        if (!handle || forcePick) {
          const picked = await WebBridge.pickDirectory({});
          if (!picked) return;
          if (picked.handle) {
            handle = picked.handle;
            try { if (typeof window.idbSetRaw === 'function') await window.idbSetRaw('web_scenario_watch_dir_handle', handle); } catch (_) {}
          }
          const rName = (handle && handle.name) || picked.rootName || 'ブラウザ監視フォルダ';
          try { localStorage.setItem(WATCH_ROOT_KEY, rName); localStorage.setItem('ccf_scn_watch_root', rName); } catch (_) {}
          if (window.CCF && CCF.library && CCF.library.setScenarioWatchRoot) CCF.library.setScenarioWatchRoot(rName, { skipSync: true });
          else if (typeof appState !== 'undefined' && appState) { appState.watchFolders = Object.assign({}, appState.watchFolders, { scenarioRoot: rName }); saveState(true); }
          updateScnWatchButtonTitle();
          if (!handle && picked.files && picked.files.length) {
            toast('🔄 フォルダを同期しています…');
            if (window.AppHistory) AppHistory.checkpoint('フォルダ同期');
            const stats = await importFolderFilesWebFallback(picked.files, { isWatchRoot: true });
            finishLibraryImport(stats, '監視フォルダ同期完了', { isWatchSync: true });
            return;
          }
        }
        if (handle) {
          updateScnWatchButtonTitle();
          toast('🔄 シナリオ監視フォルダを同期しています…');
          if (window.AppHistory) AppHistory.checkpoint('シナリオ監視フォルダ同期');
          const files = await WebBridge.walkDirHandle(handle, handle.name);
          const stats = await importFolderFilesWebFallback(files, { isWatchRoot: true });
          finishLibraryImport(stats, '監視フォルダ同期完了', { isWatchSync: true });
          return;
        }
      }
      const picked = await WebBridge.pickDirectory({});
      if (!picked || !picked.files || !picked.files.length) return;
      const rName = picked.rootName || 'ブラウザ監視フォルダ';
      try { localStorage.setItem(WATCH_ROOT_KEY, rName); localStorage.setItem('ccf_scn_watch_root', rName); } catch (_) {}
      if (window.CCF && CCF.library && CCF.library.setScenarioWatchRoot) CCF.library.setScenarioWatchRoot(rName, { skipSync: true });
      else if (typeof appState !== 'undefined' && appState) { appState.watchFolders = Object.assign({}, appState.watchFolders, { scenarioRoot: rName }); saveState(true); }
      updateScnWatchButtonTitle();
      toast('🔄 フォルダを同期しています…');
      if (window.AppHistory) AppHistory.checkpoint('フォルダ同期');
      const stats = await importFolderFilesWebFallback(picked.files, { isWatchRoot: true });
      finishLibraryImport(stats, '監視フォルダ同期完了', { isWatchSync: true });
      return;
    }
    let root = getScenarioWatchRoot();
    if (!root || forcePick) {
      const picked = await pickScenarioWatchFolder();
      if (!picked) return;
      root = picked;
    }
    toast('🔄 シナリオ監視フォルダを同期しています…');
    if (window.AppHistory) AppHistory.checkpoint('シナリオ監視フォルダ同期');
    const stats = await importFolderRootElectron(root, { isWatchRoot: true });
    if (window.CCF && CCF.library && typeof CCF.library.markSelfSave === 'function') CCF.library.markSelfSave(2500);
    updateScnWatchButtonTitle();
    finishLibraryImport(stats, '監視フォルダ同期完了', { isWatchSync: true });
    if (window.CCF && CCF.S && CCF.S.ready) {
      try { CCF.buildProjectSelect(); } catch (_) {}
      if (CCF.library && CCF.S.view === 'assets') CCF.library.render();
    }
  }

  document.addEventListener('change', e => {
    if (e.target.id === 'dbFilterPlayStatus') renderDBView();
  });

  document.addEventListener('click', async e => {
    const btn = e.target.closest && e.target.closest('[data-lib-act]');
    if (!btn) return;
    const act = btn.dataset.libAct;
    if (act === 'sync-watch') {
      await runWatchSync(!!e.shiftKey);
    } else if (act === 'cleanup-scenarios') {
      await runScenarioCleanup();
    } else if (act === 'unwatch-scenario') {
      await unwatchScenarioFolder();
    } else if (act === 'pick-watch') {
      if (IS_ELECTRON) {
        const picked = await pickScenarioWatchFolder();
        if (picked) {
          toast('📁 シナリオ監視フォルダを設定しました：' + picked);
          await runWatchSync(false);
        }
      } else {
        await runWatchSync(true);
      }
    } else if (act === 'pick-folder') {
      if (!IS_ELECTRON && window.WebBridge) {
        const picked = await WebBridge.pickDirectory({});
        if (!picked || !picked.files || !picked.files.length) return;
        if (window.AppHistory) AppHistory.checkpoint('フォルダからシナリオ登録');
        const stats = await importFolderFilesWebFallback(picked.files, { isWatchRoot: false });
        finishLibraryImport(stats, 'フォルダ登録完了');
        return;
      }
      const inp = ensureHiddenInput('libPickFolderInput', { webkitdirectory: true, multiple: true });
      inp.value = '';
      inp.onchange = async () => {
        if (!inp.files || !inp.files.length) return;
        if (window.AppHistory) AppHistory.checkpoint('フォルダからシナリオ登録');
        const root = resolveRootFromFileList(inp.files);
        const stats = (IS_ELECTRON && root) ? await importFolderRootElectron(root, { isWatchRoot: false }) : await importFolderFilesWebFallback(inp.files, { isWatchRoot: false });
        finishLibraryImport(stats, 'フォルダ登録完了');
      };
      inp.click();
    } else if (act === 'pick-files') {
      const inp = ensureHiddenInput('libPickFilesInput', { multiple: true, accept: '.pdf,.zip,.txt,.html,.htm,.md,.doc,.docx' });
      inp.value = '';
      inp.onchange = async () => {
        const files = Array.from(inp.files || []).filter(f => isDocFile(f.name));
        if (!files.length) return toast('PDF・ZIP・TXT・HTMLファイルを選択してください');
        if (window.AppHistory) AppHistory.checkpoint('ファイルからシナリオ登録');
        if (!IS_ELECTRON && window.CCF && CCF.dnd && CCF.dnd.handleBrowserFiles) {
          await CCF.dnd.handleBrowserFiles(files, { ctx: 'home' });
          return;
        }
        const stats = { added: 0, updated: 0, touchedIds: [] };
        if (typeof window.beginSuppressDetailEdited === 'function') window.beginSuppressDetailEdited();
        try {
          for (const f of files) {
            const fp = typeof filePathOf === 'function' ? filePathOf(f) : (f.path || '');
            const res = await upsertScenarioFromFilePath(fp, f.name, f);
            if (res.id) stats.touchedIds.push(res.id);
            if (res.isNew) stats.added++; else if (res.changed) stats.updated++;
          }
        } finally {
          if (typeof window.endSuppressDetailEdited === 'function') window.endSuppressDetailEdited();
        }
        finishLibraryImport(stats, 'ファイル登録完了');
      };
      inp.click();
    }
  });
})();
// ---- 左サイドバー「🏷️ 絞り込みタグ」：3段アコーディオン（🎲システム／👥人数／🏷️傾向・その他）----
const SB_GROUPS = TAG_GROUP_DEFS;
const SB_PRESET = DEFAULT_TAG_PRESETS;
const sbAcc = { sys: false, ppl: false, etc: false };   // 初期状態は3つとも閉じる（▶）。以降は開閉状態を保持（タグ選択中も開閉可）
let sbShowZero = false;   // 0件のタグを表示するか
const sbGroupOf = (t, sysSet) => tagGroupOf(t, sysSet);
function sbPplRank(t) { return t === 'ソロ' ? 0 : t === 'タイマン' ? 1 : 1 + (parseInt(t, 10) || 99); }
function renderSidebarTags() {
  const box = shEl('sbTags'); if (!box) return;
  const counts = new Map(), sysSet = (typeof rawSystemKeys === 'function') ? rawSystemKeys() : new Set();
  appState.scenarios.forEach(sc => { (sc.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)); (sc.autoSystemTags || []).forEach(t => sysSet.add(t)); });
  const groups = { sys: new Map(), ppl: new Map(), etc: new Map() };
  counts.forEach((n, t) => groups[tagGroupOf(t, sysSet)].set(t, n));
  const seenKeys = new Set([...counts.keys()].map(t => typeof tagKey === 'function' ? tagKey(t) : t));
  const addZero = (g, t) => {
    const k = typeof tagKey === 'function' ? tagKey(t) : t;
    if (k && !seenKeys.has(k) && !groups[g].has(t)) { seenKeys.add(k); groups[g].set(t, 0); }
  };
  (Array.isArray(appState.tagPresets) ? appState.tagPresets : (Array.isArray(DEFAULT_TAG_PRESETS) ? DEFAULT_TAG_PRESETS : [])).forEach(t => {
    if (t) addZero(tagGroupOf(t, sysSet), t);
  });
  (appState.channels || []).forEach(c => (c.tags || []).forEach(x => { if (x && x.name) addZero(tagGroupOf(x.name, sysSet), x.name); }));
  (Array.isArray(appState.customTags) ? appState.customTags : []).forEach(t => { if (t) addZero(tagGroupOf(t, sysSet), t); });
  dbTagSel.forEach(t => { const g = tagGroupOf(t, sysSet); if (!groups[g].has(t)) groups[g].set(t, 0); });   // 選択中のタグは0件でも必ず出す
  const chip = (t, n) => { const on = dbTagSel.has(t); return `<button type="button" class="sb-tag${on ? ' on' : ''}${n ? '' : ' zero'}" data-sbtag="${escapeHTML(t)}" aria-pressed="${on}">${on ? '✓ ' : ''}${escapeHTML(t)} <span>${n}</span></button>`; };
  let html = '', hiddenZero = 0;
  TAG_GROUP_DEFS.forEach(([g, label]) => {
    let items = [...groups[g].entries()];
    hiddenZero += items.filter(([t, n]) => !n && !dbTagSel.has(t)).length;
    if (!sbShowZero) items = items.filter(([t, n]) => n > 0 || dbTagSel.has(t));
    items.sort(g === 'ppl' ? ((a, b) => sbPplRank(a[0]) - sbPplRank(b[0])) : ((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ja')));
    const sel = items.map(x => x[0]).filter(t => dbTagSel.has(t)), open = !!sbAcc[g];
    html += `<div class="sb-acc${open ? '' : ' closed'}" data-acc-group="${g}"><button type="button" class="sb-acc-head" data-sbacc="${g}" aria-expanded="${open}"><span class="sb-acc-caret">${open ? '▼' : '▶'}</span>${label} <span class="sb-acc-cnt">(${items.length})</span>${sel.length ? `<span class="sb-acc-sel">[選択中: ${escapeHTML(sel.join(', '))}]</span>` : ''}</button>`
      + `<div class="sb-acc-body">${items.map(([t, n]) => chip(t, n)).join('') || '<span class="sb-acc-empty">該当するタグはまだありません</span>'}</div></div>`;
  });
  html += `<button type="button" class="sb-zero" data-sbzero="1">${sbShowZero ? '－ 0件のタグを隠す' : '＋ 0件のタグも表示'}${!sbShowZero && hiddenZero ? ` (${hiddenZero})` : ''}</button>`;
  box.innerHTML = html;
  // スクロール枠の外：選択中フィルタバー（個別解除チップ＋すべて解除）
  const bar = shEl('sbSelBar');
  if (bar) {
    if (dbTagSel.size) {
      bar.style.display = '';
      bar.innerHTML = [...dbTagSel].map(t => `<button type="button" class="sb-tag on" data-sbtag="${escapeHTML(t)}" title="クリックでこのタグだけ解除">✓ ${escapeHTML(t)} ✕</button>`).join('') + '<button type="button" class="sb-clear-all" data-sbtag-clear="1">すべて解除</button>';
    } else { bar.style.display = 'none'; bar.innerHTML = ''; }
  }
  // ホーム画面の件数表示横：選択中タグチップ＋タグ解除
  const st = shEl('dbSelTags');
  if (st) st.innerHTML = dbTagSel.size ? [...dbTagSel].map(t => `<button type="button" class="sb-tag on" data-sbtag="${escapeHTML(t)}" title="クリックで解除">✓ ${escapeHTML(t)}</button>`).join('') + '<button type="button" class="sb-clear-all" data-sbtag-clear="1">タグ解除</button>' : '';
}
function activateScenario(id) { if (appState.scenarios.some(s => s.id === id)) openScenarioDetail(id); }   // ホームのカード・一覧のクリック：まず「📋 シナリオ詳細モーダル」を開く
function loadAndGo(id, after) {   // そのシナリオを読み込んでから after を実行（作業中の未保存内容があれば確認）
  const unsaved = !currentScenarioId && (shEl('title').value.trim() || (blockOrder.some(b => b.type !== 'split' && b.val && String(b.val).trim())));
  const go = () => { loadScenarioFromDB(id); after(); };
  if (unsaved) appConfirm('作業中の内容（シナリオに保存されていません）が、選んだシナリオの内容で置き換わります。\n続けますか？', { okText: '置き換えて開く', danger: true }).then(ok => { if (ok) go(); }); else go();
}
function goEditScenario(id) {   // 📝 編集：そのシナリオを選択して、投稿・編集画面へ（旧 activateScenario）
  const sc = appState.scenarios.find(s => s.id === id); if (!sc) return;
  const unsaved = !currentScenarioId && (shEl('title').value.trim() || (blockOrder.some(b => b.type !== 'split' && b.val && String(b.val).trim())));
  const go = () => { loadScenarioFromDB(id); switchTab('postTab'); };
  if (unsaved) appConfirm('作業中の内容（シナリオに保存されていません）が、選んだシナリオの内容で置き換わります。\n続けますか？', { okText: '置き換えて開く', danger: true }).then(ok => { if (ok) go(); }); else go();
}
(function () {
  let sbComposing = false;
  document.addEventListener('compositionstart', e => { if (e.target && e.target.id === 'sbSearch') sbComposing = true; });
  document.addEventListener('compositionend', e => {
    if (!e.target || e.target.id !== 'sbSearch') return;
    sbComposing = false;
    const s = shEl('dbSearchInput'); if (!s) return; s.value = e.target.value;
    switchTab('databaseTab'); renderDBView();
  });
  document.addEventListener('input', e => {
    if (!e.target || e.target.id !== 'sbSearch') return;
    if (sbComposing || e.isComposing) return;
    const s = shEl('dbSearchInput'); if (!s) return; s.value = e.target.value;
    switchTab('databaseTab'); renderDBView();
  });
  document.addEventListener('click', e => {
    const ah = e.target.closest && e.target.closest('[data-sbacc]');   // アコーディオン見出し：開閉だけ行う（絞り込みは変えない）
    if (ah) { const g = ah.dataset.sbacc; sbAcc[g] = !sbAcc[g]; renderSidebarTags(); return; }
    if (e.target.closest && e.target.closest('[data-sbzero]')) { sbShowZero = !sbShowZero; renderSidebarTags(); return; }
    const t = e.target.closest && e.target.closest('[data-sbtag],[data-sbtag-clear]'); if (!t) return;
    if (t.dataset.sbtagClear) dbTagSel.clear(); else { const k = t.dataset.sbtag; if (dbTagSel.has(k)) dbTagSel.delete(k); else dbTagSel.add(k); }
    switchTab('databaseTab'); renderDBView();
  });
})();

// ======================================================================
// 全体を通した「元に戻す（Ctrl+Z）/ やり直す（Ctrl+Y / Ctrl+Shift+Z）」履歴スタック（最大20ステップ）
// ======================================================================
(function () {
  const MAX_STEPS = 20;
  const undoStack = [];
  const redoStack = [];
  let baseline = null;
  let restoring = false;
  let explicitDepth = 0;

  function capture() {
    const ccf = window.CCF;
    const snap = {
      appStateJson: typeof serializeState === 'function' ? serializeState(appState) : JSON.stringify(appState),
      blockOrderJson: typeof serializeState === 'function' && typeof blockOrder !== 'undefined' ? serializeState(blockOrder) : '[]',
      secretHOsJson: typeof serializeState === 'function' && typeof secretHOs !== 'undefined' ? serializeState(secretHOs) : '[]',
      currentScenarioId: typeof currentScenarioId !== 'undefined' ? currentScenarioId : null,
      activeHO: typeof activeHO !== 'undefined' ? activeHO : -1,
      ccfKey: ccf && ccf.S ? ccf.S.key : '_default',
      ccfRoomId: ccf && ccf.S ? ccf.S.roomId : null,
      ccfView: ccf && ccf.S ? ccf.S.view : 'stocks',
      ccfUnlinkedJson: (ccf && ccf.S && ccf.S.key === '_default' && ccf.ccfReplacer) ? JSON.stringify(ccf.S.rooms || [], ccf.ccfReplacer) : null
    };
    snap.sig = snap.appStateJson + '|' + snap.blockOrderJson + '|' + snap.secretHOsJson + '|' + snap.currentScenarioId + '|' + snap.ccfKey + '|' + snap.ccfRoomId + '|' + (snap.ccfUnlinkedJson || '');
    return snap;
  }

  function pushEntry(snap, label) {
    if (!snap) return;
    const top = undoStack[undoStack.length - 1];
    if (top && top.snap.sig === snap.sig) return;
    undoStack.push({ snap, label: label || '' });
    if (undoStack.length > MAX_STEPS) undoStack.shift();
    redoStack.length = 0;
  }

  function syncBaseline() {
    if (restoring) return;
    try { baseline = capture(); } catch (e) { if (typeof logSoft === 'function') logSoft('AppHistory.syncBaseline', e); }
  }

  function checkpoint(label) {
    if (restoring) return;
    try {
      const snap = capture();
      pushEntry(snap, label || '');
      explicitDepth++;
      setTimeout(() => { explicitDepth = Math.max(0, explicitDepth - 1); syncBaseline(); }, 0);
    } catch (e) { if (typeof logSoft === 'function') logSoft('AppHistory.checkpoint', e); }
  }

  function autoRecord(label) {
    if (restoring || explicitDepth > 0) { if (!restoring) syncBaseline(); return; }
    try {
      const cur = capture();
      if (!baseline) { baseline = cur; return; }
      if (cur.sig !== baseline.sig) {
        pushEntry(baseline, label || '');
        baseline = cur;
      }
    } catch (e) { if (typeof logSoft === 'function') logSoft('AppHistory.autoRecord', e); }
  }

  async function applySnapshot(snap) {
    restoring = true;
    try {
      const nextApp = JSON.parse(snap.appStateJson);
      if (typeof hydrateRefs === 'function') await hydrateRefs(nextApp);
      else if (typeof replaceRefs === 'function') replaceRefs(nextApp);
      appState = nextApp;

      if (typeof blockOrder !== 'undefined') {
        const nextBlocks = JSON.parse(snap.blockOrderJson);
        if (typeof hydrateRefs === 'function') await hydrateRefs(nextBlocks);
        else if (typeof replaceRefs === 'function') replaceRefs(nextBlocks);
        blockOrder = nextBlocks;
      }
      if (typeof secretHOs !== 'undefined') {
        const nextHos = JSON.parse(snap.secretHOsJson);
        if (typeof hydrateRefs === 'function') await hydrateRefs(nextHos);
        else if (typeof replaceRefs === 'function') replaceRefs(nextHos);
        secretHOs = nextHos;
      }
      if (typeof currentScenarioId !== 'undefined') currentScenarioId = snap.currentScenarioId;
      if (typeof activeHO !== 'undefined') activeHO = snap.activeHO;

      const ccf = window.CCF;
      if (ccf && ccf.S) {
        ccf.S.key = snap.ccfKey || '_default';
        ccf.S.roomId = snap.ccfRoomId || null;
        if (snap.ccfView) ccf.S.view = snap.ccfView;
        if (ccf.S.key === '_default' && snap.ccfUnlinkedJson && ccf.saveRoomContainer) {
          const rooms = JSON.parse(snap.ccfUnlinkedJson);
          ccf.saveRoomContainer('_default', { version: 2, activeRoomId: ccf.S.roomId, rooms });
        } else if (ccf.S.key !== '_default' && ccf.getRoomContainer && ccf.saveRoomContainer) {
          ccf.saveRoomContainer(ccf.S.key, ccf.getRoomContainer(ccf.S.key));
        }
        if (ccf.readProject) {
          const container = ccf.getRoomContainer(ccf.S.key);
          ccf.S.rooms = container.rooms;
          if (!ccf.S.rooms.some(r => r.id === ccf.S.roomId)) ccf.S.roomId = container.activeRoomId;
          ccf.S.proj = ccf.readProject(ccf.S.key, ccf.S.roomId);
        }
      }

      if (typeof populateScenarioDBSelect === 'function') populateScenarioDBSelect();
      if (typeof renderDBView === 'function') renderDBView();
      if (typeof renderBlockUI === 'function') renderBlockUI();
      if (typeof renderPreview === 'function') renderPreview();
      if (typeof renderHOTabs === 'function') renderHOTabs();
      if (typeof renderGalleryAll === 'function') renderGalleryAll();
      if (ccf && ccf.S && ccf.S.ready) {
        if (ccf.buildProjectSelect) ccf.buildProjectSelect();
        if (ccf.renderProps) ccf.renderProps();
        if (ccf.renderCenter) ccf.renderCenter();
        if (ccf.buildDocSelect) ccf.buildDocSelect();
        if (ccf.library) ccf.library.render();
        if (ccf.assets && ccf.assets.refreshModal) ccf.assets.refreshModal();
      }
      window.dispatchEvent(new Event('ccf-refs-changed'));
      if (typeof saveState === 'function') saveState();
      baseline = capture();
    } finally {
      restoring = false;
    }
  }

  async function undo() {
    if (restoring || !undoStack.length) {
      if (!undoStack.length && typeof toast === 'function') toast('これ以上元に戻せる操作はありません');
      return false;
    }
    const entry = undoStack.pop();
    try {
      const cur = capture();
      redoStack.push({ snap: cur, label: entry.label });
      if (redoStack.length > MAX_STEPS) redoStack.shift();
      await applySnapshot(entry.snap);
      if (typeof toast === 'function') toast('↩️ 元に戻しました' + (entry.label ? '（' + entry.label + '）' : ''));
      return true;
    } catch (e) {
      console.error('[AppHistory] undo failed', e);
      return false;
    }
  }

  async function redo() {
    if (restoring || !redoStack.length) {
      if (!redoStack.length && typeof toast === 'function') toast('やり直せる操作はありません');
      return false;
    }
    const entry = redoStack.pop();
    try {
      const cur = capture();
      undoStack.push({ snap: cur, label: entry.label });
      if (undoStack.length > MAX_STEPS) undoStack.shift();
      await applySnapshot(entry.snap);
      if (typeof toast === 'function') toast('↪️ やり直しました' + (entry.label ? '（' + entry.label + '）' : ''));
      return true;
    } catch (e) {
      console.error('[AppHistory] redo failed', e);
      return false;
    }
  }

  function collectUsedHashes(usedSet) {
    const scanStr = s => {
      if (!s) return;
      for (const m of String(s).matchAll(/@img:([a-z0-9]+)/g)) usedSet.add(m[1]);
    };
    undoStack.forEach(e => { scanStr(e.snap.appStateJson); scanStr(e.snap.blockOrderJson); scanStr(e.snap.secretHOsJson); });
    redoStack.forEach(e => { scanStr(e.snap.appStateJson); scanStr(e.snap.blockOrderJson); scanStr(e.snap.secretHOsJson); });
  }

  const isTextFocused = () => {
    const el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(t);
    }
    return false;
  };

  document.addEventListener('keydown', e => {
    if (e.altKey || !(e.ctrlKey || e.metaKey)) return;
    if (document.querySelector('.app-dialog-overlay')) return;
    if (isTextFocused()) return;
    const k = String(e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  });

  // 既存関数（saveState / renderBlockUI）の変更を暗黙検知してバックアップ履歴を記録
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(syncBaseline, 900);
    if (typeof saveState === 'function') {
      const origSave = saveState;
      saveState = function (...args) {
        if (window.CCF && CCF.library && typeof CCF.library.markSelfSave === 'function') CCF.library.markSelfSave(2000);
        const res = origSave.apply(this, args);
        if (!restoring && baseline) autoRecord('');
        return res;
      };
    }
    if (typeof renderBlockUI === 'function') {
      const origBlock = renderBlockUI;
      renderBlockUI = function (...args) {
        const res = origBlock.apply(this, args);
        if (!restoring && baseline) autoRecord('ブロック編集');
        return res;
      };
    }
  });

  window.AppHistory = { checkpoint, syncBaseline, undo, redo, collectUsedHashes, canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0 };
})();

// =====================================================================
// 📱 スマホ・タブレット「📖 クラウド読書・メモ閲覧モード」
// =====================================================================
(function () {
  'use strict';
  const OPT_OUT_KEY = 'taku_mobile_reader_optout';
  const M = {
    active: false,
    screen: 'list', // 'list' | 'reader'
    tab: 'read',    // 'read' | 'memo' | 'info'
    scId: null,
    q: '',
    system: '',
    playStatus: 'all',
    tag: '',
    listLimit: 40,
    needsRender: true,
    selectedDoc: '__extracted__',
    pdfMode: 'canvas', // 'canvas' | 'reflow'
    fontSize: 15,
    activePdfDoc: null,
    pdfObserver: null,
    memoDirty: false
  };
  const E = s => escapeHTML(String(s == null ? '' : s));
  const rootEl = () => document.getElementById('mobileReaderView');
  const isWebHosted = () => {
    if (typeof window !== 'undefined' && window.IS_ELECTRON === true) return false;
    if (typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON) return false;
    const proto = (typeof location !== 'undefined' && location.protocol) ? location.protocol : '';
    return proto === 'https:' || proto === 'http:';
  };
  const isSmallWeb = () => isWebHosted() && window.innerWidth <= 768;

  function enforceMobileReaderAvailability() {
    if (isWebHosted()) return true;
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.add('mobile-reader-disabled');
      document.body.classList.remove('mobile-reader-mode');
    }
    const btn = document.getElementById('mobileReaderToggleBtn');
    if (btn) btn.style.setProperty('display', 'none', 'important');
    const rv = rootEl();
    if (rv) {
      rv.hidden = true;
      rv.style.setProperty('display', 'none', 'important');
    }
    return false;
  }
  enforceMobileReaderAvailability();

  function setMode(on, userExplicit) {
    if (!enforceMobileReaderAvailability()) {
      M.active = false;
      return;
    }
    const next = !!on;
    if (M.active === next && (!next || (rootEl() && rootEl().childElementCount > 0 && !M.needsRender))) return;
    M.active = next;
    document.body.classList.toggle('mobile-reader-mode', M.active);
    const rv = rootEl();
    if (rv) rv.hidden = !M.active;
    const btn = document.getElementById('mobileReaderToggleBtn');
    if (btn) {
      btn.classList.toggle('active', M.active);
      btn.textContent = M.active ? '💻 通常表示に戻す' : '📖 モバイル閲覧モード';
    }
    if (userExplicit) {
      try {
        if (!M.active && isSmallWeb()) sessionStorage.setItem(OPT_OUT_KEY, '1');
        else sessionStorage.removeItem(OPT_OUT_KEY);
      } catch (_) {}
    }
    if (M.active) {
      if (!rv || rv.childElementCount === 0 || M.needsRender) {
        render();
        M.needsRender = false;
      }
    } else {
      cleanupPdf();
    }
  }

  function cleanupPdf() {
    if (M.pdfObserver) { try { M.pdfObserver.disconnect(); } catch (_) {} M.pdfObserver = null; }
    if (M.activePdfDoc) { try { M.activePdfDoc.destroy(); } catch (_) {} M.activePdfDoc = null; }
  }

  function collectScenarioDocs(sc) {
    const out = [];
    const seen = new Set();
    const add = (p, name, kind) => {
      if (!p) return;
      const k = String(p).toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ path: p, name: name || (window.CCFPdfViewer ? CCFPdfViewer.baseName(p) : String(p).split(/[\\/]/).pop()), kind });
    };
    if (sc && Array.isArray(sc.docs)) {
      sc.docs.forEach(d => {
        if (!d || !/\.(pdf|txt|html?|md|docx?)$/i.test(d.name || '')) return;
        let resolved = '';
        if (d.path && (typeof IS_ELECTRON === 'undefined' || !IS_ELECTRON || (typeof fs !== 'undefined' && fs && fs.existsSync(d.path)))) resolved = d.path;
        if (!resolved && typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON && typeof path !== 'undefined' && typeof DATA_ROOT !== 'undefined' && DATA_ROOT && d.rel) {
          try {
            const abs = path.resolve(DATA_ROOT, d.rel);
            if (typeof fs !== 'undefined' && fs && fs.existsSync(abs)) resolved = abs;
          } catch (_) {}
        }
        if (!resolved && d.cloudSha) resolved = `cloud-asset://${d.cloudSha}/${encodeURIComponent(d.name || 'doc.pdf')}`;
        else if (!resolved && d.ref) resolved = d.ref;
        if (resolved) add(resolved, d.name, /\.pdf$/i.test(d.name || '') ? 'pdf' : 'text');
      });
    }
    if (sc && Array.isArray(sc.ccfRooms)) {
      sc.ccfRooms.forEach(rm => {
        const p = rm && rm.project;
        if (!p) return;
        (p.refs || []).forEach(r => {
          if (r && (r.type === 'pdf' || r.type === 'doc') && r.path) {
            add(r.path, r.name, /\.pdf$/i.test(r.name || r.path) ? 'pdf' : 'text');
          }
        });
        if (p.pdf && p.pdf.path) add(p.pdf.path, '', /\.pdf$/i.test(p.pdf.path) ? 'pdf' : 'text');
      });
    }
    return out;
  }

  function buildExtractedSummaryHtml(sc) {
    const parts = [];
    if (String(sc.trailer || '').trim()) {
      parts.push(`<section class="mr-doc-sec"><h4>📖 あらすじ・トレーラー</h4><div class="mr-doc-pre">${E(sc.trailer)}</div></section>`);
    }
    if (String(sc.notes || '').trim()) {
      parts.push(`<section class="mr-doc-sec"><h4>📝 GMメモ・備考</h4><div class="mr-doc-pre">${E(sc.notes)}</div></section>`);
    }
    if (Array.isArray(sc.secretHOs) && sc.secretHOs.length) {
      const hoHtml = sc.secretHOs.map((h, i) => {
        if (!h) return '';
        const text = (Array.isArray(h.blocks) ? h.blocks.map(b => [b.label, b.text].filter(Boolean).join('\n')).join('\n\n') : (h.text || h.body || ''));
        return `<div class="mr-ho-card"><b>🔒 ${E(h.name || ('HO' + (i + 1)))}</b><div class="mr-doc-pre">${E(text || '（本文なし）')}</div></div>`;
      }).join('');
      if (hoHtml) parts.push(`<section class="mr-doc-sec"><h4>🔒 秘匿ハンドアウト</h4>${hoHtml}</section>`);
    }
    if (Array.isArray(sc.ccfRooms) && sc.ccfRooms.length) {
      sc.ccfRooms.forEach(rm => {
        const p = rm && rm.project;
        if (!p) return;
        if (Array.isArray(p.scenes) && p.scenes.length) {
          parts.push(`<section class="mr-doc-sec"><h4>🎬 シーン構成（${E(rm.name || '部屋')}）</h4>` +
            p.scenes.map((sn, idx) => `<div class="mr-scene-item"><b>#${idx + 1} ${E(sn.title || '無題')}</b>${sn.text ? `<div class="mr-doc-pre">${E(sn.text)}</div>` : ''}</div>`).join('') + `</section>`);
        }
        if (Array.isArray(p.stocks) && p.stocks.length) {
          parts.push(`<section class="mr-doc-sec"><h4>📝 抽出済みテキスト一覧（${E(rm.name || '部屋')}・${p.stocks.length}件）</h4>` +
            p.stocks.map((st, idx) => `<div class="mr-stock-item"><b>#${idx + 1} ${E(st.title || '')}</b><div class="mr-doc-pre">${E(st.text || '')}</div></div>`).join('') + `</section>`);
        }
      });
    }
    return parts.length ? `<div class="mr-extracted-wrap" style="font-size:${M.fontSize}px;">${parts.join('')}</div>` : '<div class="mr-empty">抽出済みテキスト・あらすじがまだ登録されていません。上のプルダウンからPDF・資料を選択するか、「📝 GMメモ」タブからメモを追加できます。</div>';
  }

  async function renderReaderDocContent(sc) {
    const box = document.getElementById('mrDocStage');
    if (!box) return;
    cleanupPdf();

    if (!M.selectedDoc || M.selectedDoc === '__extracted__') {
      box.innerHTML = buildExtractedSummaryHtml(sc);
      return;
    }

    const docPath = M.selectedDoc;
    const isPdf = /\.pdf$/i.test((window.CCFPdfViewer ? CCFPdfViewer.baseName(docPath) : docPath));
    box.innerHTML = `<div class="mr-loading"><div class="boot-splash-spinner"></div><div>☁️ クラウド／ローカルから資料を読み込んでいます…</div></div>`;
    try {
      if (!window.CCFPdfViewer || typeof CCFPdfViewer.readFileBytes !== 'function') {
        throw new Error('ビューアモジュールが初期化されていません');
      }
      const u8 = await CCFPdfViewer.readFileBytes(docPath);
      if (M.selectedDoc !== docPath || !M.active || M.screen !== 'reader') return;
      if (!isPdf) {
        const nm = CCFPdfViewer.baseName(docPath);
        const d = window.CCFText ? CCFText.loadTextDoc(nm, u8) : { text: new TextDecoder().decode(u8), enc: 'UTF-8' };
        box.innerHTML = `<div class="mr-text-doc" style="font-size:${M.fontSize}px;"><div class="mr-doc-meta">📃 ${E(nm)} (${E(d.enc)})</div><div class="mr-doc-pre">${E(d.text)}</div></div>`;
        return;
      }

      const pdfDoc = await CCFPdfViewer.getDoc('', u8);
      if (M.selectedDoc !== docPath || !M.active || M.screen !== 'reader') {
        try { pdfDoc.destroy(); } catch (_) {}
        return;
      }
      M.activePdfDoc = pdfDoc;
      const totalPages = pdfDoc.numPages;

      if (M.pdfMode === 'reflow') {
        box.innerHTML = `<div class="mr-doc-meta">📄 ${E(CCFPdfViewer.baseName(docPath))}（全 ${totalPages} ページ / テキスト抽出表示）</div><div id="mrReflowPages" class="mr-reflow-pages" style="font-size:${M.fontSize}px;"></div>`;
        const host = document.getElementById('mrReflowPages');
        for (let p = 1; p <= totalPages; p++) {
          if (M.activePdfDoc !== pdfDoc) return;
          const pageEl = document.createElement('div');
          pageEl.className = 'mr-reflow-page';
          pageEl.innerHTML = `<div class="mr-page-num">p.${p} / ${totalPages}</div><div class="mr-doc-pre">読込中…</div>`;
          host.appendChild(pageEl);
          const pg = await pdfDoc.getPage(p);
          const tc = await pg.getTextContent();
          const lines = [];
          let curY = null, curLine = '';
          (tc.items || []).forEach(it => {
            const s = it.str || '';
            const y = it.transform ? Math.round(it.transform[5] / 4) : curY;
            if (curY !== null && y !== curY && curLine.trim()) { lines.push(curLine.trim()); curLine = ''; }
            curY = y;
            curLine += s;
          });
          if (curLine.trim()) lines.push(curLine.trim());
          pageEl.querySelector('.mr-doc-pre').textContent = lines.join('\n') || '（このページには抽出可能なテキストがありません。ページ画像表示をお試しください）';
          try { if (typeof pg.cleanup === 'function') pg.cleanup(); } catch (_) {}
        }
        return;
      }

      // 縦スクロールPDFページ表示（遅延描画）
      box.innerHTML = `<div class="mr-doc-meta">📄 ${E(CCFPdfViewer.baseName(docPath))}（全 ${totalPages} ページ・縦スクロール）</div><div id="mrPdfPages" class="mr-pdf-pages"></div>`;
      const host = document.getElementById('mrPdfPages');
      const slots = [];
      for (let p = 1; p <= totalPages; p++) {
        const slot = document.createElement('div');
        slot.className = 'mr-pdf-slot';
        slot.dataset.page = String(p);
        slot.innerHTML = `<div class="mr-page-num">p.${p} / ${totalPages}</div><div class="mr-pdf-ph">タップまたはスクロールで表示…</div>`;
        host.appendChild(slot);
        slots.push(slot);
      }
      const renderPageSlot = async slot => {
        if (slot.dataset.rendered || M.activePdfDoc !== pdfDoc) return;
        slot.dataset.rendered = '1';
        const p = Number(slot.dataset.page);
        try {
          const pg = await pdfDoc.getPage(p);
          const baseVp = pg.getViewport({ scale: 1 });
          const targetW = Math.max(280, Math.min(host.clientWidth - 16, 900));
          const scale = targetW / baseVp.width;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const vp = pg.getViewport({ scale: scale * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = Math.floor(targetW) + 'px';
          canvas.style.height = Math.floor(baseVp.height * scale) + 'px';
          await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          const ph = slot.querySelector('.mr-pdf-ph');
          if (ph) ph.replaceWith(canvas);
          try { if (typeof pg.cleanup === 'function') pg.cleanup(); } catch (_) {}
        } catch (err) {
          slot.dataset.rendered = '';
          const ph = slot.querySelector('.mr-pdf-ph');
          if (ph) ph.textContent = 'ページ描画エラー';
        }
      };
      if (typeof IntersectionObserver === 'function') {
        M.pdfObserver = new IntersectionObserver(entries => {
          entries.forEach(en => { if (en.isIntersecting) { M.pdfObserver.unobserve(en.target); void renderPageSlot(en.target); } });
        }, { rootMargin: '400px 0px' });
        slots.forEach(s => M.pdfObserver.observe(s));
      } else {
        slots.slice(0, 5).forEach(s => void renderPageSlot(s));
      }
    } catch (err) {
      box.innerHTML = `<div class="mr-empty">⚠️ 資料を開けませんでした：${E(err && err.message || err)}<br><small>クラウド同期ログインまたはフォルダのアクセス許可を確認した上で「☁️ このシナリオの素材を一括取得」をお試しください。</small></div>`;
    }
  }

  function renderListView(rv) {
    const scenarios = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : [];
    const systems = [...new Set(scenarios.map(s => String(s && s.system || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    const tagCounts = new Map();
    scenarios.forEach(s => (s && s.tags || []).forEach(t => { if (t) tagCounts.set(t, (tagCounts.get(t) || 0) + 1); }));
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([t]) => t);

    const terms = (typeof parseQuery === 'function') ? parseQuery(M.q) : M.q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const filtered = scenarios.filter(sc => {
      if (!sc) return false;
      if (M.system && String(sc.system || '').trim() !== M.system) return false;
      if (M.playStatus !== 'all') {
        const ps = typeof normalizePlayStatus === 'function' ? normalizePlayStatus(sc.playStatus) : (sc.playStatus || '');
        if (M.playStatus === 'unset' ? !!ps : ps !== M.playStatus) return false;
      }
      if (M.tag && !(sc.tags || []).includes(M.tag)) return false;
      if (terms.length) {
        if (typeof matchQuery === 'function') return matchQuery(sc, terms);
        const hay = [sc.title, sc.system, sc.trailer, sc.notes, (sc.tags || []).join(' ')].join('\n').toLowerCase();
        return terms.every(t => hay.includes(t));
      }
      return true;
    }).sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

    const shown = filtered.slice(0, M.listLimit || 40);
    const coverAttr = u => (typeof imgThumbAttr === 'function' ? imgThumbAttr(u) : (typeof imgAttr === 'function' ? imgAttr(u) : `src="${E(u)}"`));
    const isLogged = !!(typeof window.cloudGetUid === 'function' && window.cloudGetUid());

    rv.innerHTML = `
      <header class="mr-header">
        <div class="mr-brand">📖 卓工房 <small>クラウド読書＆メモ</small></div>
        <div class="mr-head-btns">
          <button type="button" class="btn btn-secondary btn-xs" data-mr="sync">☁️ 同期</button>
          ${!isLogged ? '<button type="button" class="btn btn-secondary btn-xs" data-mr="login">🔑 ログイン</button>' : ''}
          <button type="button" class="btn btn-secondary btn-xs" data-mr="exit">💻 PC表示</button>
        </div>
      </header>
      <div class="mr-filters">
        <input type="search" id="mrSearchInput" value="${E(M.q)}" placeholder="🔍 シナリオ名・タグ・キーワードで検索…" autocomplete="off">
        <div class="mr-filter-row">
          <select id="mrSystemSelect" aria-label="システム絞り込み">
            <option value="">🎲 すべてのシステム</option>
            ${systems.map(sys => `<option value="${E(sys)}"${M.system === sys ? ' selected' : ''}>${E(sys)}</option>`).join('')}
          </select>
          <select id="mrPlaySelect" aria-label="プレイ状況絞り込み">
            <option value="all">📋 すべての状況</option>
            <option value="unset"${M.playStatus === 'unset' ? ' selected' : ''}>未設定</option>
            <option value="unplayed"${M.playStatus === 'unplayed' ? ' selected' : ''}>未通過</option>
            <option value="planned"${M.playStatus === 'planned' ? ' selected' : ''}>通過予定</option>
            <option value="played"${M.playStatus === 'played' ? ' selected' : ''}>通過済</option>
            <option value="can_gm"${M.playStatus === 'can_gm' ? ' selected' : ''}>回せる</option>
            <option value="stacked"${M.playStatus === 'stacked' ? ' selected' : ''}>積んでいる</option>
          </select>
        </div>
        ${topTags.length ? `<div class="mr-tag-strip">${M.tag ? `<button type="button" class="mr-tag-chip clear" data-mr-tag="">✕ ${E(M.tag)}</button>` : ''}${topTags.map(t => `<button type="button" class="mr-tag-chip${M.tag === t ? ' on' : ''}" data-mr-tag="${E(t)}">#${E(t)}</button>`).join('')}</div>` : ''}
        <div class="mr-count">${filtered.length} / ${scenarios.length} 件</div>
      </div>
      <div class="mr-list">
        ${shown.length ? shown.map(sc => {
          const thumb = sc.imageUrl || (Array.isArray(sc.hoverImages) && sc.hoverImages[0]) || '';
          const psInfo = (typeof PLAY_STATUS_MAP !== 'undefined' && typeof normalizePlayStatus === 'function') ? PLAY_STATUS_MAP[normalizePlayStatus(sc.playStatus)] : null;
          const csInfo = (window.CloudSync && CloudSync.getScenarioCacheStatus) ? CloudSync.getScenarioCacheStatus(sc) : { status: 'cached', label: '💻 保持済み' };
          return `<div class="mr-card" data-mr-open="${E(sc.id)}">
            <div class="mr-card-thumb">${thumb ? `<img ${coverAttr(thumb)} loading="lazy" alt="">` : '<div class="mr-card-ph">📖</div>'}</div>
            <div class="mr-card-body">
              <div class="mr-card-title">${sc.favorite ? '★ ' : ''}${E(sc.title || '無題')}</div>
              <div class="mr-card-badges">
                <span class="cloud-cache-pill status-${E(csInfo.status)}">${E(csInfo.label)}</span>
                ${psInfo && psInfo.badge ? `<span class="play-status-badge ${psInfo.cls}">${E(psInfo.badge)}</span>` : ''}
                ${(typeof getScenarioSpecFirstLine === 'function' ? getScenarioSpecFirstLine(sc, 'system') : String(sc.system || '').split(/\r?\n/)[0].trim()) ? `<span class="scenario-badge system">${E(typeof getScenarioSpecFirstLine === 'function' ? getScenarioSpecFirstLine(sc, 'system') : String(sc.system || '').split(/\r?\n/)[0].trim())}</span>` : ''}
                ${(typeof getScenarioSpecFirstLine === 'function' ? getScenarioSpecFirstLine(sc, 'playerCount') : String(sc.playerCount || '').split(/\r?\n/)[0].trim()) ? `<span class="scenario-badge">${E(typeof getScenarioSpecFirstLine === 'function' ? getScenarioSpecFirstLine(sc, 'playerCount') : String(sc.playerCount || '').split(/\r?\n/)[0].trim())}</span>` : ''}
              </div>
              <div class="mr-card-sub">${E((sc.notes || sc.trailer || '').replace(/\s+/g, ' ').slice(0, 60))}</div>
            </div>
            <button type="button" class="mr-pin-icon${csInfo.status === 'pinned' ? ' on' : ''}" data-mr-pin="${E(sc.id)}" aria-label="常時保持切替">📌</button>
          </div>`;
        }).join('') : '<div class="mr-empty">条件に一致するシナリオが見つかりません</div>'}
        ${filtered.length > shown.length ? `<div style="padding:12px 0; text-align:center;"><button type="button" class="btn btn-secondary" data-mr="show-more">さらに表示（${shown.length} / ${filtered.length}件）</button></div>` : ''}
      </div>
    `;
  }

  function renderReaderView(rv) {
    const sc = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios.find(s => String(s.id) === String(M.scId)) : null;
    if (!sc) { M.screen = 'list'; renderListView(rv); return; }
    const docs = collectScenarioDocs(sc);
    if (M.selectedDoc !== '__extracted__' && !docs.some(d => d.path === M.selectedDoc)) {
      M.selectedDoc = docs.length ? docs[0].path : '__extracted__';
    }
    const csInfo = (window.CloudSync && CloudSync.getScenarioCacheStatus) ? CloudSync.getScenarioCacheStatus(sc, { detailed: true }) : { status: 'cached', label: '💻 保持済み', isMethodBDirectOnly: false, releasable: 0 };
    const isPinned = csInfo.status === 'pinned';
    const isPdfDoc = M.selectedDoc !== '__extracted__' && /\.pdf$/i.test(window.CCFPdfViewer ? CCFPdfViewer.baseName(M.selectedDoc) : M.selectedDoc);
    const psVal = typeof normalizePlayStatus === 'function' ? normalizePlayStatus(sc.playStatus) : (sc.playStatus || '');
    const psOpts = (typeof PLAY_STATUS_LIST !== 'undefined' ? PLAY_STATUS_LIST : []).map(p => `<option value="${E(p.value)}"${p.value === psVal ? ' selected' : ''}>${E(p.badge || p.label)}</option>`).join('');

    let bodyHtml = '';
    if (M.tab === 'read') {
      bodyHtml = `
        <div class="mr-read-bar">
          <select id="mrDocSelect" aria-label="読む資料を選択">
            ${docs.map(d => `<option value="${E(d.path)}"${M.selectedDoc === d.path ? ' selected' : ''}>${d.kind === 'pdf' ? '📄' : '📃'} ${E(d.name)}</option>`).join('')}
            <option value="__extracted__"${M.selectedDoc === '__extracted__' ? ' selected' : ''}>📝 抽出済みテキスト・あらすじ・HOまとめ</option>
          </select>
          <div class="mr-read-tools">
            ${isPdfDoc ? `<button type="button" class="btn btn-secondary btn-xs" data-mr="toggle-pdf-mode">${M.pdfMode === 'reflow' ? '📄 ページ表示' : '📃 テキスト抽出表示'}</button>` : ''}
            <button type="button" class="btn btn-secondary btn-xs" data-mr="font-dec">A-</button>
            <button type="button" class="btn btn-secondary btn-xs" data-mr="font-inc">A+</button>
          </div>
        </div>
        <div id="mrDocStage" class="mr-doc-stage"></div>
      `;
    } else if (M.tab === 'memo') {
      const hoList = Array.isArray(sc.secretHOs) ? sc.secretHOs : [];
      bodyHtml = `
        <div class="mr-memo-wrap">
          <div class="mr-memo-group">
            <label for="mrPlayStatusEdit">プレイ状況</label>
            <select id="mrPlayStatusEdit">${psOpts}</select>
          </div>
          <div class="mr-memo-group">
            <label for="mrNotesEdit">📝 GMメモ・改変案・進行メモ（PC側へ即時同期）</label>
            <textarea id="mrNotesEdit" rows="8" placeholder="読書中に思いついたGMメモ、改変案、卓の予定メモなどを記入…">${E(sc.notes || '')}</textarea>
          </div>
          <details class="mr-memo-details">
            <summary>📖 あらすじ・概要メモを編集</summary>
            <textarea id="mrTrailerEdit" rows="5" placeholder="あらすじ・導入メモ…">${E(sc.trailer || '')}</textarea>
          </details>
          ${hoList.length ? `<div class="mr-memo-group"><label>🔒 秘匿HOメモ</label>${hoList.map((h, i) => {
            const val = Array.isArray(h.blocks) && h.blocks[0] ? (h.blocks[0].text || '') : (h.text || h.body || '');
            return `<div class="mr-ho-edit-item"><div class="mr-ho-edit-name">${E(h.name || ('HO' + (i + 1)))}</div><textarea class="mr-ho-textarea" data-mr-ho="${i}" rows="4">${E(val)}</textarea></div>`;
          }).join('')}</div>` : ''}
          <div class="mr-memo-actions">
            <button type="button" class="btn btn-success" data-mr="save-memo">💾 保存してクラウドへ同期</button>
          </div>
        </div>
      `;
    } else {
      const links = typeof collectScenarioLinks === 'function' ? collectScenarioLinks(sc) : [];
      bodyHtml = `
        <div class="mr-info-wrap">
          <div class="mr-info-card">
            <div class="mr-info-row"><span>保存状態</span><span class="cloud-cache-pill status-${E(csInfo.status)}">${E(csInfo.label)}</span></div>
            <div class="mr-info-btns">
              <button type="button" class="btn btn-secondary btn-sm" data-mr="toggle-pin">${isPinned ? '📌 常時保持ON（解除）' : '📌 この端末に常にダウンロード'}</button>
              <button type="button" class="btn btn-secondary btn-sm" data-mr="fetch-assets">☁️ 素材を一括取得</button>
              <button type="button" class="btn btn-secondary btn-sm" data-mr="release-cache"${(isPinned || csInfo.isMethodBDirectOnly || csInfo.releasable === 0) ? ' disabled' : ''}>💨 この端末の一時データを削除</button>
            </div>
          </div>
          <div class="mr-info-card">
            <div><b>システム:</b> ${E((typeof getScenarioSpecFirstLine === 'function' ? getScenarioSpecFirstLine(sc, 'system') : String(sc.system || '').split(/\r?\n/)[0].trim()) || '-')}</div>
            <div><b>人数 / 時間:</b> ${E((typeof getScenarioSpecFirstLine === 'function' ? getScenarioSpecFirstLine(sc, 'playerCount') : String(sc.playerCount || '').split(/\r?\n/)[0].trim()) || '-')} / ${E((typeof getScenarioSpecFirstLine === 'function' ? getScenarioSpecFirstLine(sc, 'playTime') : String(sc.playTime || '').split(/\r?\n/)[0].trim()) || '-')}</div>
            <div><b>必須/推奨技能:</b> ${E([(typeof getScenarioSpecFirstLine === 'function' ? getScenarioSpecFirstLine(sc, 'reqSkills') : String(sc.reqSkills || '').split(/\r?\n/)[0].trim()), (typeof getScenarioSpecFirstLine === 'function' ? getScenarioSpecFirstLine(sc, 'recSkills') : String(sc.recSkills || '').split(/\r?\n/)[0].trim())].filter(Boolean).join(' / ') || '-')}</div>
            <div class="mr-card-badges" style="margin-top:6px;">${(sc.tags || []).map(t => `<span class="scenario-badge">#${E(t)}</span>`).join('')}</div>
            ${links.length ? `<div class="sc-links-row" style="margin-top:8px;">${links.map(lk => `<a href="${E(lk.url)}" target="_blank" rel="noopener noreferrer" class="sc-link-btn">${E(lk.icon)} ${E(lk.label)}</a>`).join('')}</div>` : ''}
          </div>
        </div>
      `;
    }

    rv.innerHTML = `
      <header class="mr-header">
        <button type="button" class="btn btn-secondary btn-xs" data-mr="back">◀ 一覧</button>
        <div class="mr-reader-title" title="${E(sc.title || '')}">${E(sc.title || '無題')}</div>
        <div class="mr-head-btns">
          <button type="button" class="btn btn-secondary btn-xs" data-mr="toggle-pin" title="常時保持">${isPinned ? '📌ON' : '📌'}</button>
          <button type="button" class="btn btn-secondary btn-xs" data-mr="sync">☁️ 同期</button>
        </div>
      </header>
      <nav class="mr-tabs" role="tablist">
        <button type="button" class="mr-tab${M.tab === 'read' ? ' active' : ''}" data-mr-tab="read">📖 クラウド読書</button>
        <button type="button" class="mr-tab${M.tab === 'memo' ? ' active' : ''}" data-mr-tab="memo">📝 GMメモ・改変案</button>
        <button type="button" class="mr-tab${M.tab === 'info' ? ' active' : ''}" data-mr-tab="info">📋 詳細・素材</button>
      </nav>
      <div class="mr-reader-body">${bodyHtml}</div>
    `;
    if (M.tab === 'read') void renderReaderDocContent(sc);
  }

  function render() {
    if (!M.active) return;
    const rv = rootEl();
    if (!rv) return;
    if (M.screen === 'reader' && M.scId) renderReaderView(rv);
    else renderListView(rv);
  }

  async function saveMobileMemo() {
    const sc = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios.find(s => String(s.id) === String(M.scId)) : null;
    if (!sc) return;
    const psEl = document.getElementById('mrPlayStatusEdit');
    const naEl = document.getElementById('mrNotesEdit');
    const trEl = document.getElementById('mrTrailerEdit');
    if (psEl && typeof normalizePlayStatus === 'function') sc.playStatus = normalizePlayStatus(psEl.value);
    if (naEl) sc.notes = naEl.value;
    if (trEl) sc.trailer = trEl.value;
    document.querySelectorAll('.mr-ho-textarea[data-mr-ho]').forEach(ta => {
      const idx = Number(ta.dataset.mrHo);
      const ho = sc.secretHOs && sc.secretHOs[idx];
      if (!ho) return;
      if (Array.isArray(ho.blocks) && ho.blocks.length) ho.blocks[0].text = ta.value;
      else ho.text = ta.value;
    });
    if (typeof applyFlatToBlocks === 'function') applyFlatToBlocks(sc);
    if (typeof saveState === 'function') saveState();
    if (typeof renderDBView === 'function') renderDBView();
    M.memoDirty = false;
    if (typeof toast === 'function') toast('💾 保存しました。クラウドへ同期しています…');
    try {
      if (typeof window.cloudSyncNow === 'function') await window.cloudSyncNow();
      if (window.CloudSync && typeof CloudSync.syncNow === 'function') await CloudSync.syncNow();
    } catch (_) {}
  }

  function wireMobileReader() {
    if (!enforceMobileReaderAvailability()) return;
    document.getElementById('mobileReaderToggleBtn')?.addEventListener('click', () => {
      setMode(!M.active, true);
    });
    const rv = rootEl();
    if (!rv || rv.dataset.wired) return;
    rv.dataset.wired = '1';

    rv.addEventListener('click', async e => {
      const pinBtn = e.target.closest('[data-mr-pin]');
      if (pinBtn) {
        e.stopPropagation();
        const sid = pinBtn.dataset.mrPin;
        if (window.CloudSync && CloudSync.setScenarioPinned) {
          await CloudSync.setScenarioPinned(sid, !CloudSync.isScenarioPinned(sid));
          render();
        }
        return;
      }
      const openCard = e.target.closest('[data-mr-open]');
      if (openCard) {
        M.scId = openCard.dataset.mrOpen;
        M.screen = 'reader';
        M.tab = 'read';
        const sc = (appState.scenarios || []).find(s => String(s.id) === String(M.scId));
        const docs = collectScenarioDocs(sc);
        M.selectedDoc = docs.length ? docs[0].path : '__extracted__';
        render();
        if (window.CloudSync && CloudSync.ensureScenarioAssetsCached) {
          void CloudSync.ensureScenarioAssetsCached(M.scId, { showProgress: false });
        }
        return;
      }
      const tagBtn = e.target.closest('[data-mr-tag]');
      if (tagBtn) {
        const t = tagBtn.dataset.mrTag || '';
        M.tag = (M.tag === t) ? '' : t;
        M.listLimit = 40;
        render();
        return;
      }
      const tabBtn = e.target.closest('[data-mr-tab]');
      if (tabBtn) {
        M.tab = tabBtn.dataset.mrTab;
        render();
        return;
      }
      const actBtn = e.target.closest('[data-mr]');
      if (!actBtn) return;
      const act = actBtn.dataset.mr;
      if (act === 'show-more') { M.listLimit = (M.listLimit || 40) + 40; render(); return; }
      if (act === 'exit') return setMode(false, true);
      if (act === 'back') { M.screen = 'list'; cleanupPdf(); render(); return; }
      if (act === 'sync') { if (window.CloudSync && CloudSync.syncNow) { await CloudSync.syncNow(); render(); } return; }
      if (act === 'login') { document.getElementById('authOpenBtn')?.click(); return; }
      if (act === 'toggle-pdf-mode') { M.pdfMode = M.pdfMode === 'reflow' ? 'canvas' : 'reflow'; render(); return; }
      if (act === 'font-dec') { M.fontSize = Math.max(12, M.fontSize - 1); render(); return; }
      if (act === 'font-inc') { M.fontSize = Math.min(24, M.fontSize + 1); render(); return; }
      if (act === 'save-memo') { await saveMobileMemo(); return; }
      if (act === 'toggle-pin' && M.scId && window.CloudSync && CloudSync.setScenarioPinned) {
        await CloudSync.setScenarioPinned(M.scId, !CloudSync.isScenarioPinned(M.scId));
        render();
        return;
      }
      if (act === 'fetch-assets' && M.scId && window.CloudSync && CloudSync.ensureScenarioAssetsCached) {
        await CloudSync.ensureScenarioAssetsCached(M.scId, { showProgress: true, manual: true });
        render();
        return;
      }
      if (act === 'release-cache' && M.scId && window.CloudSync && CloudSync.releaseScenarioLocalCache) {
        await CloudSync.releaseScenarioLocalCache(M.scId);
        render();
      }
    });

    let qTimer = null;
    rv.addEventListener('input', e => {
      if (e.target.id === 'mrSearchInput') {
        M.q = e.target.value;
        M.listLimit = 40;
        clearTimeout(qTimer);
        qTimer = setTimeout(() => {
          const pos = e.target.selectionStart;
          render();
          const inp = document.getElementById('mrSearchInput');
          if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (_) {} }
        }, 180);
      }
    });

    rv.addEventListener('change', e => {
      if (e.target.id === 'mrSystemSelect') { M.system = e.target.value; M.listLimit = 40; render(); return; }
      if (e.target.id === 'mrPlaySelect') { M.playStatus = e.target.value; M.listLimit = 40; render(); return; }
      if (e.target.id === 'mrDocSelect') { M.selectedDoc = e.target.value; render(); return; }
    });

    window.addEventListener('cloud-cache-changed', () => {
      if (M.active && M.tab !== 'memo') render();
      else M.needsRender = true;
    });
    window.addEventListener('resize', () => {
      let optedOut = false;
      try { optedOut = sessionStorage.getItem(OPT_OUT_KEY) === '1'; } catch (_) {}
      if (!M.active && !optedOut && isSmallWeb()) setMode(true, false);
    });

    let optedOut = false;
    try { optedOut = sessionStorage.getItem(OPT_OUT_KEY) === '1'; } catch (_) {}
    if (!optedOut && isSmallWeb()) {
      setTimeout(() => setMode(true, false), 150);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireMobileReader);
  else wireMobileReader();

  window.MobileReader = { setMode, render, isActive: () => M.active };
})();
