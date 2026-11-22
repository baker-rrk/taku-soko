/* ccf_npc_ui.js — ココフォリア特化ツール Phase 1：NPC一覧・「確認＆修正」ポップアップ・ダミー駒の出力
 *  NPC の自動パース結果は、必ずこのポップアップで KP が目視確認し、手動で微調整（立ち絵の紐付けを含む）してから確定する。 */
(function () {
  'use strict';
  const CCF = window.CCF, M = window.CCFModel, N = window.CCFNpc, Sys = window.CCFSys, { $, esc, say, S } = CCF;

  // ---------- 共通：クリップボード・書き出し ----------
  function copyText(text) {
    try { if (IS_ELECTRON && CCF.electron.clipboard) { CCF.electron.clipboard.writeText(text); return Promise.resolve(true); } } catch (e) { if (typeof logSoft === 'function') logSoft('copyText', e); }
    return (navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true) : Promise.resolve(false)).catch(e => { if (typeof logSoft === 'function') logSoft('clipboardWrite', e); return false; });
  }
  /** JSON を書き出す。Electron は _TRPG_Data/ccfolia/exports/ に保存してフォルダを開く。Web版はダウンロード。 */
  function exportJson(fileName, obj) {
    const json = JSON.stringify(obj, null, 2), safe = String(fileName).replace(/[\\/:*?"<>|]/g, '_');
    if (IS_ELECTRON) {
      const dir = path.join(DATA_ROOT, 'ccfolia', 'exports'); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, safe); fs.writeFileSync(f, json, 'utf8');
      const ipc = CCF.electron && CCF.electron.ipcRenderer;
      if (ipc && ipc.invoke) { ipc.invoke('ccf:show-item', f).catch(() => { try { shell.showItemInFolder(f); } catch (_) { /* noop */ } }); }
      else { try { shell.showItemInFolder(f); } catch (e) { if (typeof logSoft === 'function') logSoft('showItemInFolder', e); } }
      return f;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = safe; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return safe;
  }
  const ts = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };
  CCF.copyText = copyText; CCF.exportJson = exportJson;

  // ======================================================================
  // 立ち絵サムネイル解決（images / portraits / 単一プロパティ両対応）
  // ======================================================================
  function resolveImgSrc(item) {
    if (!item) return '';
    const raw = typeof item === 'string' ? item : (item.dataUrl || item.url || item.src || item.iconUrl || item.path || item.filePath || '');
    const s = String(raw || '').trim();
    if (!s || /^(?:javascript|vbscript|data:(?!image\/))/i.test(s)) return '';
    if (/^(?:data:image\/|file:\/\/|https?:\/\/|zipview:\/\/|blob:)/i.test(s)) return s;
    if (IS_ELECTRON && typeof require === 'function') {
      try { return require('url').pathToFileURL(s).href; } catch (e) { /* noop */ }
    }
    return s;
  }
  function resolveNpcThumb(n) {
    if (!n) return '';
    const imgs = Array.isArray(n.images) && n.images.length ? n.images : (Array.isArray(n.portraits) ? n.portraits : []);
    for (const it of imgs) { const u = resolveImgSrc(it); if (u) return u; }
    for (const k of ['iconDataUrl', 'image', 'imagePath', 'iconUrl', 'portrait']) {
      const u = resolveImgSrc(n[k]); if (u) return u;
    }
    return '';
  }

  // ======================================================================
  // NPC 一覧
  // ======================================================================
  CCF.npcListHtml = function () {
    const ns = S.proj.npcs;
    const sysObj = (Sys.SYSTEMS || []).find(x => x.id === (S.proj.settings && S.proj.settings.system)) || { name: 'CoC6版' };
    const settingsBar = `<div class="ccf-npc-rulebar">
      <button type="button" class="ccf-btn${S.showNpcSettings ? ' primary' : ''}" data-toggle-set="npc" title="部屋のゲームシステムやチャパレ生成ルールを開閉します">⚙️ NPC・チャパレ生成ルール設定 ${S.showNpcSettings ? '▴' : '▾'}</button>
      <span class="ccf-badge">${esc(sysObj.name)}</span>
      <span class="ccf-muted">${S.proj.settings.statusPublic ? 'ステータス公開' : '非公開'}${S.proj.settings.secretDice ? ' / シークレット' : ''}</span>
    </div>` + (S.showNpcSettings && CCF.npcSettingsHtml ? CCF.npcSettingsHtml() : '');
    const bar = `<div class="ccf-list-bar"><button type="button" class="ccf-btn primary" data-n="blank">＋ 空のNPCを作成</button><button type="button" class="ccf-btn" data-n="import" title="いあきゃら出力テキスト／ココフォリア駒JSONを貼り付けて、NPCとして取り込みます">📥 外部データから取り込み</button><button type="button" class="ccf-btn accent" data-n="scan" title="表示中のPDF、または登録された全PDFを横断して、NPCのステータスブロックを自動検出します">🔍 PDFからNPCを一括検出</button><button type="button" class="ccf-btn" data-n="merge-dups" title="正規化名が一致する同名NPC（立ち絵のみの枠とステータスありの枠など）を1体に統合します"${ns.length >= 2 ? '' : ' disabled'}>🔗 同名NPCを統合</button>${CCF.bulkBarHtml('n', ns.length)}<span class="ccf-muted">${ns.length}体。⠿ をドラッグして並べ替え。「📋 コピー」→ ココフォリアの部屋で Ctrl+V で駒を作成できます</span></div>`;
    return settingsBar + bar + (ns.map(n => {
      const st = n.status.map(s => `<span class="ccf-chip">${esc(s.label)} ${s.value}${s.max !== s.value ? '/' + s.max : ''}</span>`).join('');
      const pa = n.params.slice(0, 8).map(p => `<span class="ccf-chip dim">${esc(p.label)} ${esc(p.value)}</span>`).join('');
      const thumb = resolveNpcThumb(n);
      const imgCount = (Array.isArray(n.images) && n.images.length ? n.images : (Array.isArray(n.portraits) ? n.portraits : [])).length;
      const imgLabel = thumb ? (imgCount > 1 ? ` ／ 立ち絵あり（${imgCount}枚）` : ' ／ 立ち絵あり') : ' ／ 立ち絵なし';
      return `<div class="ccf-npc" data-id="${esc(n.id)}">
        <div class="ccf-npc-sel"><input type="checkbox" class="ccf-selchk" data-sel="${esc(n.id)}" aria-label="選択"${S.sel.has(n.id) ? ' checked' : ''}><span class="ccf-grip" draggable="true" title="ドラッグで並べ替え">⠿</span></div>
        <div class="ccf-npc-icon">${thumb ? `<img src="${esc(thumb)}" alt="">` : '<span>👤</span>'}</div>
        <div class="ccf-npc-main"><div class="ccf-npc-name">${esc(n.name)}</div><div class="ccf-chips">${st}${pa}</div>
          <div class="ccf-muted">技能・コマンド ${n.commands ? n.commands.split('\n').length : 0}行${imgLabel}</div></div>
        <div class="ccf-actions">${n.srcs && n.srcs.length ? `<button type="button" class="ccf-btn" data-n="jump" title="抽出元のPDF（${esc(n.srcs[0].name)}）の該当ページへ移動します">📄 P.${n.srcs[0].page}へ移動</button>` : ''}<button type="button" class="ccf-btn" data-n="edit">✎ 確認・修正</button><button type="button" class="ccf-btn" data-n="copy">📋 コピー</button><button type="button" class="ccf-mini danger" data-n="del" title="削除">🗑</button></div></div>`;
    }).join('') || '<div class="ccf-empty">まだNPCがいません。PDFでステータスブロックを選択 →「👤 NPC生成」</div>');
  };
  /** 📥 外部データ取り込み：ココフォリア駒JSON（kind:character）／JSON配列／いあきゃら出力テキスト を自動判別して NPC 下書きへ逆変換 */
  function importFromText(raw) {
    const s = String(raw || "").trim(); if (!s) return { drafts: [], kind: "" };
    if (/^[\[{]/.test(s)) {
      try {
        const j = JSON.parse(s), list = Array.isArray(j) ? j : [j], drafts = list.map(x => M.fromCcfoliaCharacter(x)).filter(Boolean);
        if (drafts.length) return { drafts, kind: "ココフォリア駒JSON" };
      } catch (e) { /* JSONでなければテキストとして扱う */ }
    }
    const st = S.proj.settings, blocks = N.splitNpcBlocks ? N.splitNpcBlocks(s) : [s];
    return { drafts: blocks.map(b => N.parseNpc(b, Object.assign({ edition: st.edition, rollPrefix: st.rollPrefix, abilityRolls: st.abilityRolls }, Sys.parseOpts(st)))), kind: "いあきゃら出力テキスト" };
  }
  function openImport() {
    const ov = document.createElement("div"); ov.className = "ccf-overlay"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="ccf-modal narrow"><div class="ccf-modal-head"><b>📥 外部データから取り込み</b><span class="ccf-muted">いあきゃら出力テキスト／ココフォリア駒JSON を貼り付け（自動判別）</span><span class="ccf-spacer"></span><button type="button" class="ccf-mini" data-i="close">✕</button></div><div class="ccf-modal-body single"><textarea id="ccfImpTx" rows="14" spellcheck="false" placeholder="ここに貼り付け…" style="width:100%"></textarea><div class="ccf-muted" id="ccfImpMsg"></div></div><div class="ccf-modal-foot"><button type="button" class="ccf-btn" data-i="clip">📋 クリップボードから貼り付け</button><span class="ccf-spacer"></span><button type="button" class="ccf-btn" data-i="close">キャンセル</button><button type="button" class="ccf-btn primary" data-i="go">逆変換して確認画面へ</button></div></div>`;
    document.body.appendChild(ov); const close = () => { document.removeEventListener("keydown", onKey, true); ov.remove(); }, onKey = e => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("click", async e => {
      const b = e.target.closest("[data-i]"); if (!b) return; const k = b.dataset.i, tx = ov.querySelector("#ccfImpTx"), msg = ov.querySelector("#ccfImpMsg");
      if (k === "close") return close();
      if (k === "clip") { try { tx.value = (IS_ELECTRON && CCF.electron.clipboard) ? CCF.electron.clipboard.readText() : await navigator.clipboard.readText(); } catch (er) { msg.textContent = "⚠️ クリップボードを読めませんでした。Ctrl+V で貼り付けてください"; } return; }
      if (k === "go") { const r = importFromText(tx.value); if (!r.drafts.length) { msg.textContent = "⚠️ 取り込めるデータが見つかりません"; return; } close(); say("📥 " + r.kind + "として " + r.drafts.length + "体を読み込みました"); CCF.openNpcReview(r.drafts, { mode: "new" }); }
    });
    setTimeout(() => { const t = ov.querySelector("#ccfImpTx"); if (t) t.focus(); }, 0);
  }
  CCF.importNpcFromText = importFromText;
  CCF.onNpcClick = async function (e) {
    const b = e.target.closest('[data-n]'); if (!b) return; const k = b.dataset.n, row = b.closest('.ccf-npc'), ns = S.proj.npcs;
    if (k === 'bulkall' || k === 'bulkdel') return CCF.onBulk(k, 'npcs', 'NPC');
    if (k === 'blank') { const d = N.parseNpc('', Object.assign({ edition: S.proj.settings.edition }, Sys.parseOpts(S.proj.settings))); d.name = '新しいNPC'; d.warnings = []; return CCF.openNpcReview([d], { mode: 'new' }); }
    if (k === 'import') return openImport();
    if (k === 'scan') { if (CCF.scan && CCF.scan.open) CCF.scan.open(); else say('NPC一括検出はデスクトップ版で使えます'); return; }
    if (k === 'merge-dups') {
      const res = M.mergeSameNameNpcs(S.proj.npcs, { buildCommands: x => N.buildCommands(x, { abilityRolls: S.proj.settings.abilityRolls }) });
      if (!res.mergedCount) return say('統合できる同名NPCはありませんでした（別形態は維持されます）');
      if (window.AppHistory) window.AppHistory.checkpoint('同名NPCを統合');
      S.proj.npcs = res.npcs; CCF.saveProject(); CCF.renderCenter();
      return say('🔗 同名NPC ' + res.mergedCount + '件を統合しました');
    }
    const n = row && ns.find(x => x.id === row.dataset.id); if (!n) return;
    if (k === 'jump') return CCF.jumpToSrc(n);
    if (k === 'edit') return CCF.openNpcReview([JSON.parse(JSON.stringify(n))], { mode: 'edit' });
    if (k === 'copy') { const ok = await copyText(M.clipboardPayload(M.toCcfoliaCharacter(n))); return say(ok ? '📋 コピーしました。ココフォリアの部屋で Ctrl+V してください' : '⚠️ コピーできませんでした'); }
    if (k === 'del') { if (await appConfirm('NPC「' + n.name + '」を削除しますか？', { okText: '削除', danger: true })) { if (window.AppHistory) window.AppHistory.checkpoint('NPCを削除'); S.proj.npcs = ns.filter(x => x !== n); CCF.saveProject(); CCF.renderCenter(); } }
  };

  // ======================================================================
  // 確認＆修正ポップアップ
  // ======================================================================
  let R = null;   // { drafts, cur, mode, el }
  const rebuildCommands = d => { d.commands = N.buildCommands(d, { abilityRolls: S.proj.settings.abilityRolls }); d._palDirty = false; };
  function applyAutoCalc(d, forceRecalc) {
    if (!d) return [];
    if (forceRecalc) {
      d.status = (d.status || []).filter(s => !s._auto);
      d.params = (d.params || []).filter(p => !p._auto);
      d.skills = (d.skills || []).filter(s => !s._auto);
    }
    const ed = d.system === 'coc7' ? '7' : d.system === 'coc6' ? '6' : d.edition;
    const f = M.autoFillStats(d, ed);
    if (f.length && !d._palDirty) rebuildCommands(d);
    return f;
  }
  function ensureDraftImages(d) {
    if (!d) return;
    const arr = a => Array.isArray(a) ? a : [];
    let list = arr(d.images).length ? d.images : arr(d.portraits);
    list = list.map(x => {
      if (!x || typeof x !== 'object') return null;
      return { id: x.id || M.newId(), path: x.path || x.filePath || '', filePath: x.filePath || x.path || '', dataUrl: x.dataUrl || x.url || x.src || '', assetId: x.assetId || '', label: x.label || x.name || '', name: x.name || x.label || '' };
    }).filter(x => x && (x.dataUrl || x.path || x.filePath || x.assetId));
    if (!list.length) {
      const single = [d.iconDataUrl, d.image, d.imagePath, d.iconUrl, d.portrait].find(v => v && String(v).trim());
      if (single) {
        const s = String(single).trim(), isUrl = /^(?:data:image\/|file:\/\/|https?:\/\/|zipview:\/\/|blob:)/i.test(s);
        list = [{ id: M.newId(), path: isUrl ? '' : s, filePath: isUrl ? '' : s, dataUrl: isUrl ? s : '', assetId: '', label: d.iconName || '通常', name: d.iconName || '通常' }];
      }
    }
    d.portraits = list;
    d.images = list.map(x => Object.assign({}, x));
    syncIcon(d);
  }
  CCF.openNpcReview = function (drafts, opts) {
    if (R) closeReview();
    drafts.forEach(d => {
      d._palDirty = false;
      ensureDraftImages(d);
      if (!(opts && opts.mode === 'edit')) {
        try { applyAutoCalc(d, false); } catch (e) { if (typeof logSoft === 'function') logSoft('autoFillStats', e); }
      }
    });
    R = { drafts, cur: 0, mode: (opts && opts.mode) || 'new' };
    const ov = document.createElement('div'); ov.className = 'ccf-overlay'; ov.id = 'ccfReview'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); document.body.appendChild(ov); R.el = ov;
    ov.addEventListener('click', onReviewClick); ov.addEventListener('input', onReviewInput); ov.addEventListener('change', onReviewInput);
    ov.addEventListener('dragover', e => { if (e.target.closest('.ccf-icon-drop')) { e.preventDefault(); e.target.closest('.ccf-icon-drop').classList.add('drop'); } const pz = e.target.closest('.ccf-pt-drop'); if (pz) { e.preventDefault(); pz.style.outline = '2px solid #4a90e2'; } });
    ov.addEventListener('dragleave', e => { const d = e.target.closest('.ccf-icon-drop'); if (d) d.classList.remove('drop'); const pz = e.target.closest('.ccf-pt-drop'); if (pz) pz.style.outline = ''; });
    ov.addEventListener('drop', onIconDrop);
    document.addEventListener('keydown', onReviewKey, true);
    renderReview();
  };
  function closeReview() { if (!R) return; document.removeEventListener('keydown', onReviewKey, true); R.el.remove(); R = null; }
  const onReviewKey = e => { if (e.key === 'Escape' && R && !document.querySelector('.app-dialog-overlay')) { e.preventDefault(); e.stopImmediatePropagation(); cancelReview(); } };
  async function cancelReview() { if (!R) return; if (R.mode === 'new' && !(await appConfirm('生成したNPCを破棄して閉じますか？', { okText: '破棄して閉じる', danger: true }))) return; closeReview(); }
  const cur = () => R && R.drafts[R.cur];

  function rowsHtml(kind, arr, cols) {
    return arr.map((r, i) => `<tr${r._auto ? ' data-auto-row="1"' : ''}>${cols.map(c => `<td><input type="${c.type || 'text'}" data-t="${kind}" data-i="${i}" data-k="${c.k}" value="${esc(r[c.k])}" ${c.w ? 'style="width:' + c.w + '"' : ''} aria-label="${c.l}"></td>`).join('')}<td>${badge(kind, r)}<button type="button" class="ccf-mini danger" data-r="del-${kind}" data-i="${i}" data-rid="${esc(r._rid || "")}" title="削除">✕</button></td></tr>`).join('');
  }
  /** 行ごとの固定ID（✕削除でインデックスがずれて別の行が消えるのを防ぐ） */
  const ensureRids = d => [d.status, d.params, d.skills].forEach(a => (a || []).forEach(r => { if (!r._rid) Object.defineProperty(r, '_rid', { value: M.newId(), enumerable: true, writable: true, configurable: true }); }));
  /** 原文に存在しない数字（自動補完以外）に ⚠️要確認 を出す */
  const srcNums = d => {
    const set = new Set(), src = String(d.source || '').normalize('NFKC');
    src.replace(/\d+/g, m => { set.add(String(+m)); return m; });
    src.replace(/\(\s*(\d+(?:\s*[+\-]\s*\d+)+)\s*\)/g, (m, expr) => {
      const toks = expr.match(/[+\-]?\s*\d+/g);
      if (toks) set.add(String(Math.abs(toks.reduce((a, t) => a + Number(t.replace(/\s+/g, '')), 0))));
      return m;
    });
    return set;
  };
  const numFlag = (d, v) => { if (!String(d.source || '').trim() || v === '' || v == null || !/^[+-]?\d+$/.test(String(v).trim())) return ''; return srcNums(d).has(String(Math.abs(+v))) ? '' : '<span title="原文に無い数値です。確認してください">⚠️要確認</span>'; };
  function badge(kind, r) { const d = cur(); if (r._auto) return '<span class="ccf-chip dim" title="原文が空欄のため計算式で自動補完しました">🧮自動</span>'; if (kind === 'status') return numFlag(d, r.value) || numFlag(d, r.max); if (kind === 'params') return numFlag(d, r.value); return ''; }
  function skillColsFor(d) {
    const sys = d.system || '';
    return sys ? (Sys.SKILL_COLS[sys] || null) : [{ k: 'include', l: '含める', type: 'checkbox' }, { k: 'name', l: '技能名', type: 'text' }, { k: 'value', l: '値', type: 'number', w: '64px' }, { k: 'damage', l: 'ダメージ', type: 'text', w: '110px' }];
  }
  function skillsHtml(d, skillCols) {
    if (!skillCols) return '';
    return d.skills.map((s, i) => `<tr class="${s.known ? '' : 'unknown'}">${skillCols.map(c => `<td><input type="${c.type}" data-t="skills" data-i="${i}" data-k="${c.k}"${c.type === 'checkbox' ? (s[c.k] !== false && (c.k === 'include' || s[c.k]) ? ' checked' : '') : ' value="' + esc(s[c.k] == null ? '' : s[c.k]) + '"'}${c.w ? ' style="width:' + c.w + '"' : ''} aria-label="${esc(c.l)}"></td>`).join('')}
      <td class="ccf-flag">${s._auto ? '<span class="ccf-chip dim" title="原文が空欄のため計算式で自動補完しました">🧮自動</span>' : ''}${s.known ? '' : '<span title="技能の辞書にない名前です。誤検出でないか確認してください">⚠️要確認</span>'}${s._auto ? '' : numFlag(d, s.value)}</td>
      <td><button type="button" class="ccf-mini danger" data-r="del-skills" data-i="${i}" data-rid="${esc(s._rid || "")}" title="削除">✕</button></td></tr>`).join('') || `<tr><td colspan="${skillCols.length + 2}" class="ccf-muted">技能を検出できませんでした</td></tr>`;
  }
  function renderReview() {
    const d = cur(), n = R.drafts.length; ensureRids(d); ensureDraftImages(d);
    const tabs = n > 1 ? `<div class="ccf-draft-tabs" role="tablist">${R.drafts.map((x, i) => `<button type="button" role="tab" class="ccf-subtab${i === R.cur ? ' active' : ''}" data-r="tab" data-i="${i}">${i + 1}. ${esc(x.name)}</button>`).join('')}</div>` : '';
    const sys = d.system || '', skillCols = skillColsFor(d);
    const skills = skillsHtml(d, skillCols);
    const mainThumb = resolveNpcThumb(d);
    const sysOpts = d.sysOpts || {}, sysSelect = `<label>システム <select data-b="system">${sys ? '' : '<option value="" selected>（未設定・旧形式）</option>'}${Sys.SYSTEMS.map(x => `<option value="${x.id}"${x.id === sys ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`;
    const optsHtml = sys ? `<div class="ccf-row ccf-sysopts"><label class="ccf-chk"><input type="checkbox" data-o="statusPublic"${sysOpts.statusPublic !== false ? ' checked' : ''}> ステータスを公開する</label>${(Sys.OPTION_DEFS[sys] || []).map(([k, t, l, ch]) => t === 'chk' ? `<label class="ccf-chk"><input type="checkbox" data-o="${k}"${sysOpts[k] ? ' checked' : ''}> ${esc(l)}</label>` : t === 'num' ? `<label>${esc(l)} <input type="number" data-o="${k}" value="${esc(sysOpts[k])}" style="width:60px"></label>` : `<label>${esc(l)} <select data-o="${k}">${ch.map(([v, n]) => `<option value="${v}"${sysOpts[k] === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`).join('')}</div>` : '';
    const cbSel = 'width:auto;min-width:150px;max-width:220px;flex:0 0 auto';
    const cbrbHtml = sys === 'coc6' && sysOpts.cbrb !== false ? `<div class="ccf-row" style="flex-direction:row;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:6px"><span class="ccf-muted">CBRB 組み合わせ：</span><select id="ccfCbA" aria-label="技能A" style="${cbSel}">${d.skills.map(s => `<option>${esc(s.name)}</option>`).join('')}</select> ＋ <select id="ccfCbB" aria-label="技能B" style="${cbSel}">${d.skills.map(s => `<option>${esc(s.name)}</option>`).join('')}</select><button type="button" class="ccf-btn" data-r="add-cbrb">＋ CBRBを追加</button></div>${(sysOpts.cbrbPairs || []).map((p, i) => `<div class="ccf-row" style="flex-direction:row;align-items:center;justify-content:flex-start;gap:6px"><select disabled aria-label="技能1" style="${cbSel}"><option>${esc(p[0])}</option></select> ＋ <select disabled aria-label="技能2" style="${cbSel}"><option>${esc(p[1])}</option></select><button type="button" class="ccf-mini danger" data-r="del-cbrb" data-i="${i}" title="削除">✕</button></div>`).join('')}` : '';
    const extraHtml = sys && Sys.EXTRA_FIELDS[sys] ? `<div class="ccf-sub">🎭 ${sys === 'stratera' ? 'ストリテラ（オモテ／ウラ／キーワード → メモ欄・宣言チャパレ）' : 'マダミス（プロフィール等 → メモ欄、初期情報・タイムライン → チャパレ。ダイス出力なし）'}</div>${Sys.EXTRA_FIELDS[sys].map(([k, l]) => `<label class="ccf-extra">${esc(l)}<textarea data-x="${k}" rows="2" spellcheck="false">${esc((d.extra || {})[k] || '')}</textarea></label>`).join('')}` : '';
    R.el.innerHTML = `<div class="ccf-modal" tabindex="-1">
  <div class="ccf-modal-head"><b>👤 NPC 確認・修正</b><span class="ccf-muted">解析結果を目視で確認し、必要なら修正してから確定してください（${R.mode === 'edit' ? '編集' : '新規 ' + n + '体'}）</span><span class="ccf-spacer"></span><button type="button" class="ccf-mini" data-r="cancel" title="閉じる (Esc)">✕</button></div>
  ${tabs}
  <div class="ccf-modal-body">
    <div class="ccf-r-src"><div class="ccf-sub">📄 元のテキスト（直して「再解析」もできます）</div>
      <textarea id="ccfSrc" data-src="1" spellcheck="false">${esc(d.source)}</textarea>
      <div class="ccf-r-srcbar"><button type="button" class="ccf-btn" data-r="reparse">↻ 再解析（下の入力内容は作り直されます）</button></div>
      ${d.warnings && d.warnings.length ? `<ul class="ccf-warn">${d.warnings.map(w => `<li>⚠️ ${esc(w)}</li>`).join('')}</ul>` : '<div class="ccf-ok">✅ 主要な項目を検出しました</div>'}
    </div>
    <div class="ccf-r-form">
      <div class="ccf-r-top">
        <div class="ccf-icon-drop" id="ccfIconDrop" title="メイン立ち絵（画像ファイルまたはマイライブラリの画像をドロップで先頭に追加）">${mainThumb ? `<img src="${esc(mainThumb)}" alt="立ち絵">` : '<span>立ち絵<br><small>ドロップ</small></span>'}</div>
        <div class="ccf-r-top-fields">
          <label>名前 <input type="text" data-b="name" value="${esc(d.name)}"></label>
          <div class="ccf-row">${sysSelect}<label>イニシアティブ <input type="number" data-b="initiative" value="${esc(d.initiative)}" style="width:80px"></label>
            ${sys ? '' : `<label>版 <select data-b="edition"><option value="6"${d.edition === '6' ? ' selected' : ''}>6版</option><option value="7"${d.edition === '7' ? ' selected' : ''}>7版</option></select></label>
            <label>接頭辞 <select data-b="rollPrefix"><option value="CCB"${d.rollPrefix === 'CCB' ? ' selected' : ''}>CCB</option><option value="CC"${d.rollPrefix === 'CC' ? ' selected' : ''}>CC</option></select></label>`}</div>
          ${optsHtml}
        </div>
      </div>
      <div class="ccf-sub">🖼️ 立ち絵・表情差分 <span class="ccf-muted">（先頭が駒のメイン立ち絵。追加・変更・削除・D&D、ラベル編集・並べ替えに対応）</span></div>
      <div class="ccf-pt-drop" id="ccfPtDrop">
        ${d.portraits.map((p, i) => { const ps = resolveImgSrc(p); return `<div class="ccf-pt">${ps ? `<img class="ccf-pt-thumb" src="${esc(ps)}" alt="">` : '<div class="ccf-pt-thumb ccf-pt-empty">👤</div>'}<input type="text" data-pt="label" data-i="${i}" value="${esc(p.label)}" placeholder="表情ラベル" aria-label="表情ラベル"><div class="ccf-row" style="gap:3px"><button type="button" class="ccf-mini" data-r="pt-up" data-i="${i}" title="前へ"${i ? '' : ' disabled'}>◀</button><button type="button" class="ccf-mini" data-r="pt-down" data-i="${i}" title="後ろへ"${i < d.portraits.length - 1 ? '' : ' disabled'}>▶</button><button type="button" class="ccf-mini danger" data-r="pt-del" data-i="${i}" title="削除">✕</button></div></div>`; }).join('')}
        <div class="ccf-pt-actions"><button type="button" class="ccf-btn" data-r="pt-add">📁 ファイルから追加</button>${CCF.assets ? '<button type="button" class="ccf-btn" data-r="pt-reg" title="📌 登録素材のフォルダから選んで追加します">📌 登録素材から追加</button>' : ''}${typeof pickGalleryImage === 'function' ? '<button type="button" class="ccf-btn" data-r="pt-gallery">🖼️ 共通ギャラリーから追加</button>' : ''}<button type="button" class="ccf-btn danger" data-r="pt-clear"${d.portraits.length ? '' : ' disabled'}>🗑 すべて解除</button></div>
      </div>
      <div class="ccf-row" style="margin-top:8px"><button type="button" class="ccf-btn" data-r="autocalc" title="HP/MP/SAN/DB/アイデア/幸運/知識 が原文に無い（空欄）ときだけ、システム別の計算式で補完します。原文の数値は変更しません">🧮 空欄を自動計算</button><button type="button" class="ccf-btn" data-r="recalc" title="自動補完した項目（🧮自動）を、現在の能力値から計算し直します">↻ 再計算</button></div>
      <div class="ccf-grid2">
        <div><div class="ccf-sub">❤️ ステータス（バー表示）</div><table class="ccf-tbl"><thead><tr><th>項目</th><th>現在値</th><th>最大値</th><th></th></tr></thead><tbody id="ccfStatusTbody">${rowsHtml('status', d.status, [{ k: 'label', l: '項目', w: '70px' }, { k: 'value', l: '現在値', type: 'number', w: '70px' }, { k: 'max', l: '最大値', type: 'number', w: '70px' }])}</tbody></table><button type="button" class="ccf-btn" data-r="add-status">＋ 追加</button></div>
        <div><div class="ccf-sub">🔢 パラメータ（固定値）</div><table class="ccf-tbl"><thead><tr><th>項目</th><th>値</th><th></th></tr></thead><tbody id="ccfParamsTbody">${rowsHtml('params', d.params, [{ k: 'label', l: '項目', w: '80px' }, { k: 'value', l: '値', w: '90px' }])}</tbody></table><button type="button" class="ccf-btn" data-r="add-params">＋ 追加</button></div>
      </div>
      ${skillCols ? `<div class="ccf-sub">🎯 技能・武器 → チャットパレット <span class="ccf-muted">（チェックを外すと含めません）</span></div>
      <table class="ccf-tbl"><thead><tr>${skillCols.map(c => `<th>${esc(c.l)}</th>`).join('')}<th></th><th></th></tr></thead><tbody id="ccfSkillsTbody">${skills}</tbody></table>
      <button type="button" class="ccf-btn" data-r="add-skills">＋ 技能を追加</button>${cbrbHtml}` : ''}
      ${extraHtml}
      <div class="ccf-sub">💬 チャットパレット <span class="ccf-muted" id="ccfPalInfo"></span><button type="button" class="ccf-btn" data-r="regen" title="技能・能力値の表から作り直す">↻ 表から再生成</button></div>
      <textarea id="ccfPal" data-b="commands" rows="7" spellcheck="false">${esc(d.commands)}</textarea>
      <div class="ccf-sub">📝 メモ</div>
      <textarea data-b="memo" rows="3">${esc(d.memo)}</textarea>
    </div>
  </div>
  <div class="ccf-modal-foot"><span class="ccf-muted">ココフォリア形式：status（HP/MP/SAN）・params（能力値）・commands（チャパレ）</span><span class="ccf-spacer"></span>
    <button type="button" class="ccf-btn" data-r="copy-piece" title="この駒をココフォリアの盤面へ Ctrl+V で投入できる形でクリップボードへコピーします">📋 クリップボードへ駒コピー</button>
    <button type="button" class="ccf-btn" data-r="cancel">キャンセル</button>
    <button type="button" class="ccf-btn primary" data-r="confirm">${R.mode === 'edit' ? '✅ 更新する' : '✅ 確定して追加' + (n > 1 ? '（' + n + '体すべて）' : '')}</button></div>
</div>`;
    palInfo();
    if (!R.focused) { R.focused = true; const m = R.el.querySelector('.ccf-modal'); if (m) m.focus({ preventScroll: true }); }
  }
  const palInfo = () => { const el = $('ccfPalInfo'), d = cur(); if (el && d) el.textContent = d.commands ? d.commands.split('\n').filter(Boolean).length + '行' : '0行'; };

  function onReviewInput(e) {
    const d = cur(); if (!d) return; const el = e.target;
    if (el.dataset.src) { d.source = el.value; return; }
    if (el.dataset.pt) { const p = (d.portraits || [])[+el.dataset.i]; if (p) { p.label = el.value; p.name = el.value; syncIcon(d); } return; }
    if (el.dataset.t) {   // 表の編集
      const t = el.dataset.t, arr = d[t], row = arr[+el.dataset.i], k = el.dataset.k; if (!row) return;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') v = v === '' ? 0 : Number(v);
      row[k] = v;
      if (row._auto && (t !== 'params' || /^(?:DB|ダメージボーナス)$/i.test(String(row.label).trim()))) delete row._auto;
      if (k === 'name' && t === 'skills') row.known = true;   // 手で直した名前は、KPが確認済みとして扱う
      if (t === 'params' && ['label', 'value'].includes(k)) {
        try {
          applyAutoCalc(d, true);
          ensureRids(d);
          const stBody = $('ccfStatusTbody');
          if (stBody) stBody.innerHTML = rowsHtml('status', d.status, [{ k: 'label', l: '項目', w: '70px' }, { k: 'value', l: '現在値', type: 'number', w: '70px' }, { k: 'max', l: '最大値', type: 'number', w: '70px' }]);
          const skBody = $('ccfSkillsTbody'), sc = skillColsFor(d);
          if (skBody && sc) skBody.innerHTML = skillsHtml(d, sc);
          const paBody = $('ccfParamsTbody');
          if (paBody) {
            if (e.type === 'change') paBody.innerHTML = rowsHtml('params', d.params, [{ k: 'label', l: '項目', w: '80px' }, { k: 'value', l: '値', w: '90px' }]);
            else {
              paBody.querySelectorAll('tr[data-auto-row="1"]').forEach(tr => tr.remove());
              d.params.forEach((pr, idx) => {
                if (!pr._auto) return;
                const tmp = document.createElement('tbody');
                tmp.innerHTML = rowsHtml('params', [pr], [{ k: 'label', l: '項目', w: '80px' }, { k: 'value', l: '値', w: '90px' }]);
                const tr = tmp.firstElementChild;
                if (tr) { tr.querySelectorAll('[data-i]').forEach(inp => { inp.dataset.i = String(idx); }); paBody.appendChild(tr); }
              });
            }
          }
        } catch (er) { if (typeof logSoft === 'function') logSoft('liveAutoCalc', er); }
      }
      if (!d._palDirty && (t === 'skills' || ['label', 'value', 'max'].includes(k))) {
        rebuildCommands(d); const p = $('ccfPal'); if (p) p.value = d.commands; palInfo();
      }
      return;
    }
    const refresh = () => { if (!d._palDirty) { rebuildCommands(d); const p = $('ccfPal'); if (p) p.value = d.commands; palInfo(); } };
    if (el.dataset.o) {   // システム別オプション（ステータス公開・シークレットダイス・連撃など）
      d.sysOpts = d.sysOpts || {}; const k = el.dataset.o;
      d.sysOpts[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
      refresh(); if (k === 'cbrb') renderReview(); return;
    }
    if (el.dataset.x) {   // ストリテラ／マダミスの追加項目
      d.extra = d.extra || {}; d.extra[el.dataset.x] = el.value; d.memo = Sys.memoFor(d);
      const m = R.el.querySelector('[data-b="memo"]'); if (m) m.value = d.memo; refresh(); return;
    }
    const b = el.dataset.b; if (!b) return;
    if (b === 'system') return changeSystem(d, el.value);
    if (b === 'initiative') d.initiative = el.value === '' ? 0 : Number(el.value);
    else if (b === 'commands') { d.commands = el.value; d._palDirty = true; palInfo(); }
    else {
      d[b] = el.value;
      if (b === 'edition') { try { applyAutoCalc(d, true); renderReview(); } catch (er) { /* noop */ } return; }
      if (b === 'rollPrefix' && !d._palDirty) { rebuildCommands(d); const p = $('ccfPal'); if (p) p.value = d.commands; palInfo(); }
    }
    if (b === 'name' && R.drafts.length > 1) { const t = R.el.querySelector('.ccf-draft-tabs .active'); if (t) t.textContent = (R.cur + 1) + '. ' + (el.value || '（無名）'); }
  }

  /** システム切替：元のテキストがあればそのシステム向けに再解析、なければ（手入力NPC）いまの表をそのままチャパレだけ作り直す */
  async function changeSystem(d, sys) {
    if (!sys || sys === d.system || R.sysBusy) return;
    R.sysBusy = true; try { await changeSystem2(d, sys); } finally { if (R) R.sysBusy = false; }
  }
  function copyImgProps(dst, src) {
    dst.images = (src.images || src.portraits || []).map(x => Object.assign({}, x));
    dst.portraits = dst.images.map(x => Object.assign({}, x));
    dst.iconDataUrl = src.iconDataUrl || null; dst.iconName = src.iconName || '';
    dst.image = src.image || null; dst.imagePath = src.imagePath || ''; dst.iconUrl = src.iconUrl || null; dst.portrait = src.portrait || null;
    dst.srcs = src.srcs || [];
  }
  async function changeSystem2(d, sys) {
    const s = S.proj.settings, name = (Sys.SYSTEMS.find(x => x.id === sys) || {}).name;
    if (!String(d.source || '').trim()) {
      d.system = sys; d.sysOpts = Object.assign(Sys.optsFromSettings(s), d.sysOpts || {}); d.extra = d.extra || {};
      if (sys === 'coc7' || sys === 'coc6') { d.edition = sys === 'coc7' ? '7' : '6'; d.rollPrefix = sys === 'coc7' ? 'CC' : 'CCB'; }
      try { applyAutoCalc(d, true); } catch (e) { /* noop */ }
      rebuildCommands(d); return renderReview();
    }
    if (!(await appConfirm('システムを「' + name + '」に切り替え、元のテキストから再解析します。画面で手直しした内容は失われます。よろしいですか？', { okText: '切り替える' }))) return renderReview();
    const nd = N.parseNpc(d.source, { edition: d.edition, rollPrefix: d.rollPrefix, abilityRolls: s.abilityRolls, system: sys, sysOpts: d.sysOpts });
    copyImgProps(nd, d); nd._palDirty = false; nd.id = d.id; if (d.name && d.name !== '名称未設定NPC') nd.name = d.name;
    try { applyAutoCalc(nd, false); } catch (e) { /* noop */ }
    R.drafts[R.cur] = nd; renderReview();
  }

  /** 立ち絵リスト → images / portraits / 単一画像プロパティ（iconDataUrl, image, imagePath, iconUrl, portrait）へ完全同期 */
  function syncIcon(d) {
    if (!d) return;
    const ps = Array.isArray(d.portraits) ? d.portraits : [];
    d.images = ps.map(x => Object.assign({}, x));
    const p = ps[0] || null;
    if (p) {
      const src = p.dataUrl || p.path || p.filePath || null;
      d.iconDataUrl = p.dataUrl || (resolveImgSrc(p) || null);
      d.iconName = p.label || p.name || '';
      d.image = src; d.imagePath = p.filePath || p.path || p.dataUrl || ''; d.iconUrl = src; d.portrait = src;
    } else {
      d.iconDataUrl = null; d.iconName = '';
      d.image = null; d.imagePath = ''; d.iconUrl = null; d.portrait = null;
    }
  }
  function addPortraitItem(d, item, atFront) {
    d.portraits = d.portraits || [];
    const obj = { id: M.newId(), path: item.path || '', filePath: item.filePath || item.path || '', dataUrl: item.dataUrl || '', assetId: item.assetId || '', label: item.label || item.name || '通常', name: item.name || item.label || '' };
    if (atFront) d.portraits.unshift(obj); else d.portraits.push(obj);
    syncIcon(d);
  }
  function findAssetIdByPath(p) {
    if (!p) return '';
    const normP = (CCF.assets && CCF.assets.norm) ? CCF.assets.norm(p) : String(p).replace(/\//g, '\\').toLowerCase();
    const refHit = (S.proj && Array.isArray(S.proj.refs) ? S.proj.refs : []).find(r => r && r.path && ((CCF.assets && CCF.assets.norm) ? CCF.assets.norm(r.path) : String(r.path).replace(/\//g, '\\').toLowerCase()) === normP);
    if (refHit) return 'ref:' + refHit.id;
    if (CCF.assets && CCF.assets.getUnifiedItems) {
      try {
        const hit = CCF.assets.getUnifiedItems(S.key).find(x => x && x.path && ((CCF.assets && CCF.assets.norm) ? CCF.assets.norm(x.path) : String(x.path).replace(/\//g, '\\').toLowerCase()) === normP);
        if (hit) return hit.uid || '';
      } catch (_) { }
    }
    return '';
  }
  async function setIconFromPath(p, assetId) {
    const d = cur(); if (!d) return;
    try {
      if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(p)) return say('⚠️ 画像ファイル（png / jpg / gif / webp）を選んでください');
      const u = typeof dataUrlFromPath === 'function' ? await dataUrlFromPath(p, path.basename(p)) : 'data:image/' + path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg') + ';base64,' + fs.readFileSync(p).toString('base64');
      addPortraitItem(d, { path: p, filePath: p, dataUrl: u, assetId: assetId || findAssetIdByPath(p), label: path.basename(p, path.extname(p)), name: path.basename(p) }, true);
      renderReview();
    } catch (e) { console.error(e); say('❌ 画像を読み込めませんでした：' + (e.message || e)); }
  }
  CCF.setNpcIconFromPath = setIconFromPath;
  async function setIconFromUrl(u, name) {   // ZIP の中の画像（zipview://）を、解凍せずに立ち絵へ取り込む
    const d = cur(); if (!d) return;
    try {
      const dataUrl = await CCF.zip.toDataUrl(u);
      addPortraitItem(d, { dataUrl, label: name || 'ZIP内の画像', name: name || 'ZIP内の画像' }, true);
      renderReview();
    }
    catch (e) { console.error(e); say('❌ ZIP内の画像を読み込めませんでした：' + (e.message || e)); }
  }
  CCF.setNpcIconFromUrl = setIconFromUrl;
  async function addPortraitFromPath(p, quiet, atFront, assetId) {
    const d = cur(); if (!d || !/\.(png|jpe?g|gif|webp|bmp)$/i.test(p)) return;
    try {
      const u = typeof dataUrlFromPath === 'function' ? await dataUrlFromPath(p, path.basename(p)) : 'data:image/' + path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg') + ';base64,' + fs.readFileSync(p).toString('base64');
      addPortraitItem(d, { path: p, filePath: p, dataUrl: u, assetId: assetId || findAssetIdByPath(p), label: path.basename(p, path.extname(p)), name: path.basename(p) }, atFront);
      if (!quiet) renderReview();
    } catch (e) { say('❌ 画像を読み込めませんでした：' + (e.message || e)); }
  }
  async function onPortraitDrop(e) {
    const z = e.target.closest('.ccf-pt-drop'); if (!z) return; e.preventDefault(); z.style.outline = '';
    const dt = e.dataTransfer, d = cur(); if (!d) return; d.portraits = d.portraits || [];
    const zu = dt.getData('text/ccf-zipview'); if (zu) { try { addPortraitItem(d, { dataUrl: await CCF.zip.toDataUrl(zu), label: dt.getData('text/ccf-zipname') || 'ZIP内の画像', name: dt.getData('text/ccf-zipname') || 'ZIP内の画像' }, false); } catch (er) { say('❌ ZIP内の画像を読み込めませんでした'); } return renderReview(); }
    const lp = dt.getData('text/ccf-path'); if (lp) { await addPortraitFromPath(lp, true, false); return renderReview(); }
    for (const f of [...(dt.files || [])]) {
      const p = IS_ELECTRON ? filePathOf(f) : ''; if (p) { await addPortraitFromPath(p, true, false); continue; }
      if (/^image\//.test(f.type)) {
        const u = typeof imageFileToDataUrl === 'function' ? await imageFileToDataUrl(f) : await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
        addPortraitItem(d, { dataUrl: u, label: f.name.replace(/\.[^.]+$/, ''), name: f.name }, false);
      }
    }
    renderReview();
  }
  async function onIconDrop(e) {
    if (e.target.closest && e.target.closest('.ccf-pt-drop')) return onPortraitDrop(e);
    const z = e.target.closest('.ccf-icon-drop'); if (!z) return; e.preventDefault(); z.classList.remove('drop');
    const dt = e.dataTransfer, zu = dt.getData('text/ccf-zipview'); if (zu) return setIconFromUrl(zu, dt.getData('text/ccf-zipname'));
    const lp = dt.getData('text/ccf-path'); if (lp) return setIconFromPath(lp);
    const f = dt.files && dt.files[0]; if (!f) return;
    const p = IS_ELECTRON ? filePathOf(f) : ''; if (p) return setIconFromPath(p);
    if (!/^image\//.test(f.type)) return say('⚠️ 画像ファイルをドロップしてください');
    const d = cur();
    const u = typeof imageFileToDataUrl === 'function' ? await imageFileToDataUrl(f) : await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    addPortraitItem(d, { dataUrl: u, label: f.name.replace(/\.[^.]+$/, ''), name: f.name }, true);
    renderReview();
  }

  async function onReviewClick(e) {
    const b = e.target.closest('[data-r]'); if (!b) { if (e.target === R.el) { /* 外側クリックでは閉じない（誤操作で作業を失わないため） */ } return; }
    const k = b.dataset.r, d = cur();
    if (k === 'cancel') return cancelReview();
    if (k === 'tab') { R.cur = +b.dataset.i; return renderReview(); }
    if (k === 'confirm') return confirmReview();
    if (k === 'regen') { rebuildCommands(d); $('ccfPal').value = d.commands; return palInfo(); }
    if (k === 'reparse') {
      if (!(await appConfirm('元のテキストから解析し直します。画面で手直しした内容は失われます。よろしいですか？', { okText: '再解析する' }))) return;
      const s = S.proj.settings, nd = N.parseNpc(d.source, { edition: d.edition, rollPrefix: d.rollPrefix, abilityRolls: s.abilityRolls, system: d.system || undefined, sysOpts: d.sysOpts });
      copyImgProps(nd, d); nd._palDirty = false; nd.id = d.id;
      try { applyAutoCalc(nd, false); } catch (er) { if (typeof logSoft === 'function') logSoft('reparseAutoCalc', er); }
      R.drafts[R.cur] = nd; return renderReview();
    }
    if (k === 'autocalc' || k === 'recalc') {
      const f = applyAutoCalc(d, k === 'recalc');
      if (!f.length) say('補完できる空欄がありません（HP/MP/SAN/DB/アイデア/幸運/知識 は原文または入力済みです）'); else say('🧮 自動補完：' + f.join('・'));
      return renderReview();
    }
    if (k === 'copy-piece') { const c = commitDraft(d); const ok = await copyText(M.clipboardPayload(M.toCcfoliaCharacter(c))); return say(ok ? '📋 コピーしました。ココフォリアの盤面で Ctrl+V してください' : '⚠️ コピーできませんでした'); }
    if (k.startsWith('pt-')) {
      const i = +b.dataset.i, ps = d.portraits;
      if (k === 'pt-del') ps.splice(i, 1);
      else if (k === 'pt-clear') { d.portraits = []; }
      else if (k === 'pt-up' && i > 0) [ps[i - 1], ps[i]] = [ps[i], ps[i - 1]];
      else if (k === 'pt-down' && i < ps.length - 1) [ps[i + 1], ps[i]] = [ps[i], ps[i + 1]];
      else if (k === 'pt-reg') {
        const p = await CCF.assets.pickImage();
        if (p) {
          if (typeof p === 'string') await addPortraitFromPath(p, true, false);
          else if (p.path) await addPortraitFromPath(p.path, true, false, p.assetId || p.uid || '');
          else if (p.dataUrl) addPortraitItem(d, { path: p.path || '', dataUrl: p.dataUrl, assetId: p.assetId || p.uid || '', label: (p.name || '登録画像').replace(/\.[^.]+$/, ''), name: p.name || '登録画像' }, false);
        }
        return renderReview();
      }
      else if (k === 'pt-gallery') { const url = await pickGalleryImage(); if (url) addPortraitItem(d, { dataUrl: url, label: 'ギャラリーの画像', name: 'ギャラリーの画像' }, false); return renderReview(); }
      else if (k === 'pt-add') { if (!IS_ELECTRON) return say('立ち絵のドラッグ＆ドロップでも追加できます'); const r = await CCF.electron.ipcRenderer.invoke('ccf:pick', { title: '立ち絵の画像を選ぶ（複数可）', properties: ['openFile', 'multiSelections'], filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] }); for (const f of (r || [])) await addPortraitFromPath(f, true, false); return renderReview(); }
      syncIcon(d); return renderReview();
    }
    const add = /^add-(status|params|skills)$/.exec(k);
    if (add) { const t = add[1]; d[t].push(t === 'status' ? { label: '', value: 0, max: 0 } : t === 'params' ? { label: '', value: '' } : (d.system ? Sys.newSkill(d.system, d.sysOpts) : { name: '', value: 50, known: true, include: true, damage: '' })); if (!d._palDirty) rebuildCommands(d); renderReview(); const inputs = R.el.querySelectorAll('[data-t="' + t + '"][data-i="' + (d[t].length - 1) + '"]'); const fi = t === 'skills' ? 1 : 0; if (inputs[fi]) inputs[fi].focus(); return; }
    if (k === 'add-cbrb') { const a = $('ccfCbA').value, c = $('ccfCbB').value; if (!a || !c || a === c) return say('⚠️ 異なる2つの技能を選んでください'); d.sysOpts.cbrbPairs = d.sysOpts.cbrbPairs || []; if (!d.sysOpts.cbrbPairs.some(p => p[0] === a && p[1] === c)) d.sysOpts.cbrbPairs.push([a, c]); if (!d._palDirty) rebuildCommands(d); return renderReview(); }
    if (k === 'del-cbrb') { d.sysOpts.cbrbPairs.splice(+b.dataset.i, 1); if (!d._palDirty) rebuildCommands(d); return renderReview(); }
    const del = /^del-(status|params|skills)$/.exec(k);
    if (del) { const arr = d[del[1]], rid = b.dataset.rid, ix = rid ? arr.findIndex(r => r._rid === rid) : +b.dataset.i; if (ix >= 0) arr.splice(ix, 1); if (!d._palDirty) rebuildCommands(d); return renderReview(); }
  }

  function commitDraft(d) {
    syncIcon(d);
    const clean = Object.assign({}, d); delete clean._palDirty; delete clean.warnings;
    clean.skills = (d.skills || []).filter(s => String(s.name).trim());
    clean.status = (d.status || []).filter(s => String(s.label).trim()); clean.params = (d.params || []).filter(p => String(p.label).trim());
    clean.name = String(d.name || '').trim() || '名称未設定NPC';
    return M.sanitizeNpc(Object.assign(clean, { id: d.id || M.newId() }));
  }
  function confirmReview() {
    const out = R.drafts.map(commitDraft).filter(Boolean);
    const wasEdit = R.mode === 'edit';
    if (window.AppHistory) window.AppHistory.checkpoint(wasEdit ? 'NPCを更新' : 'NPCを追加');
    let mergedMsg = '';
    if (wasEdit) {
      const i = S.proj.npcs.findIndex(n => n.id === out[0].id);
      if (i >= 0) S.proj.npcs[i] = out[0]; else S.proj.npcs.push(out[0]);
    } else {
      out.forEach(n => S.proj.npcs.push(n));
      const res = M.mergeSameNameNpcs(S.proj.npcs, { buildCommands: x => N.buildCommands(x, { abilityRolls: S.proj.settings.abilityRolls }) });
      S.proj.npcs = res.npcs;
      if (res.mergedCount) mergedMsg = `（同名 ${res.mergedCount}件を自動統合）`;
    }
    CCF.saveProject(); closeReview(); CCF.setView('npcs');
    say('✅ ' + (wasEdit ? 'NPCを更新しました' : out.length + '体のNPCを追加しました' + mergedMsg));
  }
  CCF._review = { get state() { return R; }, confirm: confirmReview, close: closeReview };

  // ======================================================================
  // ダミー駒（シナリオテキスト）の出力
  // ======================================================================
  CCF.openDummyPieces = function (o) {
    o = o || {}; const pieces = o.pieces || M.buildDummyPieces(S.proj.stocks, S.proj.settings);
    if (!pieces.length) return say('テキストがありません');
    const ov = document.createElement('div'); ov.className = 'ccf-overlay'; ov.id = 'ccfDummy'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const totalLines = pieces.reduce((a, p) => a + p.commands.split('\n').length, 0), close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    ov.innerHTML = `<div class="ccf-modal narrow"><div class="ccf-modal-head"><b>${o.title || '🧩 ダミー駒（チャパレ）'}</b><span class="ccf-muted">${pieces.length}体・計${totalLines}行。${o.clue ? '手がかり用オブジェクト駒（盤面に表示・本文は📝メモ欄）です' : '盤面には出ない駒で、チャットパレットのクリックで本文を送信できます'}</span><span class="ccf-spacer"></span><button type="button" class="ccf-mini" data-d="close">✕</button></div>
      <div class="ccf-modal-body single">${pieces.map((p, i) => `<div class="ccf-piece"><div class="ccf-piece-head"><b>${esc(p.name)}</b><span class="ccf-muted">${p.commands ? p.commands.split('\n').length + '行' : 'メモ ' + esc(String(p.memo).length) + '字'}</span><span class="ccf-spacer"></span><button type="button" class="ccf-btn primary" data-d="copy" data-i="${i}">📋 この駒をコピー</button></div>
        <textarea readonly rows="5">${esc(p.commands ? p.commands.replace(/\\n/g, '↵') : p.memo)}</textarea></div>`).join('')}
        <div class="ccf-muted">※ 「↵」はココフォリアで改行になる「\\n」です。コピーしたJSONをココフォリアの部屋に Ctrl+V すると、非表示の駒として追加されます（1回に1体ずつ）。</div></div>
      <div class="ccf-modal-foot"><span class="ccf-spacer"></span><button type="button" class="ccf-btn" data-d="export">💾 すべてJSONで保存</button><button type="button" class="ccf-btn" data-d="close">閉じる</button></div></div>`;
    ov.addEventListener('click', async e => {
      const b = e.target.closest('[data-d]'); if (!b) return; const k = b.dataset.d;
      if (k === 'close') return close();
      if (k === 'copy') { const ok = await copyText(M.clipboardPayload(pieces[+b.dataset.i])); return say(ok ? '📋 コピーしました。ココフォリアで Ctrl+V してください' : '⚠️ コピーできませんでした'); }
      if (k === 'export') { const f = exportJson('ccfolia_dummy_pieces_' + ts() + '.json', pieces.map(p => ({ kind: 'character', data: p }))); say('💾 保存しました：' + f); }
    });
    document.body.appendChild(ov); document.addEventListener('keydown', onKey, true);
  };
})();
