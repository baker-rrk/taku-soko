/* app_test49_03_ui_basics.js — ダイアログ・トースト・共通処理・初期化・DB一覧
 * 読み込み順は 01→07（HTMLの<script>の並び）。全ファイルが同じグローバルスコープを共有します。
 * 各ファイルは、前のファイルで定義された関数・変数を使えます。 */
  let _dlgChain = Promise.resolve();
  // confirm() の代わり。true/false を返す（await して使う）。strict:true は Esc・外側クリックで閉じない（重要な選択用）
  // 3つ以上の選択肢があるダイアログ。buttons: [{ label, value, kind: 'primary' | 'danger' | '' }]。Esc・外側クリックは null（キャンセル）
  function appChoice(message, buttons, opts = {}) {
    const run = () => new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      const box = document.createElement('div'); box.className = 'app-dialog';
      if (opts.title) { const t = document.createElement('div'); t.className = 'app-dialog-title'; t.textContent = opts.title; box.appendChild(t); }
      const m = document.createElement('div'); m.className = 'app-dialog-msg'; m.style.whiteSpace = 'pre-wrap'; m.textContent = String(message); box.appendChild(m);
      const row = document.createElement('div'); row.className = 'app-dialog-actions'; row.style.flexWrap = 'wrap';
      const prev = document.activeElement;
      const done = v => { document.removeEventListener('keydown', onKey, true); ov.remove(); if (prev && prev.focus) { try { prev.focus(); } catch (e) { logSoft('appChoice', e); } } resolve(v); };
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); } };
      buttons.forEach(bt => { const el = document.createElement('button'); el.type = 'button'; el.className = 'app-dialog-btn ' + (bt.kind || ''); el.textContent = bt.label; el.onclick = () => done(bt.value); row.appendChild(el); });
      box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov); document.addEventListener('keydown', onKey, true);
      ov.addEventListener('mousedown', e => { if (e.target === ov) done(null); });
      const first = row.querySelector('.primary') || row.firstChild; if (first) first.focus();
    });
    const p = _dlgChain.then(run); _dlgChain = p.catch(e => logSoft('async', e)); return p;
  }
  function appConfirm(message, opts = {}) {
    const run = () => new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      const box = document.createElement('div'); box.className = 'app-dialog';
      if (opts.title) { const t = document.createElement('div'); t.className = 'app-dialog-title'; t.textContent = opts.title; box.appendChild(t); }
      const m = document.createElement('div'); m.className = 'app-dialog-msg'; m.textContent = String(message); box.appendChild(m);
      const row = document.createElement('div'); row.className = 'app-dialog-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'app-dialog-btn'; cancel.textContent = opts.cancelText || 'キャンセル';
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'app-dialog-btn ' + (opts.danger ? 'danger' : 'primary'); ok.textContent = opts.okText || 'OK';
      if (opts.alert) row.append(ok); else row.append(cancel, ok); box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
      const prev = document.activeElement;
      const done = v => { document.removeEventListener('keydown', onKey, true); ov.remove(); if (prev && prev.focus) { try { prev.focus(); } catch (e) { logSoft('appConfirm', e); } } resolve(v); };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!opts.strict) done(false); }
        else if (e.key === 'Tab') { e.preventDefault(); (opts.alert || document.activeElement !== ok ? ok : cancel).focus(); }
      };
      document.addEventListener('keydown', onKey, true);
      cancel.onclick = () => done(false); ok.onclick = () => done(true);
      if (!opts.strict) ov.addEventListener('mousedown', e => { if (e.target === ov) done(false); });
      (opts.danger && !opts.alert ? cancel : ok).focus();
    });
    const p = _dlgChain.then(run); _dlgChain = p.catch(e => logSoft('async', e)); return p;
  }

  function appAlert(message, opts = {}) { return appConfirm(message, { ...opts, alert: true }); }   // OKだけのお知らせダイアログ（await しなくてもよい）
  function appPrompt(message, defaultValue = '', opts = {}) {
    const run = () => new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'app-dialog-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      const box = document.createElement('div'); box.className = 'app-dialog';
      if (opts.title) { const t = document.createElement('div'); t.className = 'app-dialog-title'; t.textContent = opts.title; box.appendChild(t); }
      const m = document.createElement('div'); m.className = 'app-dialog-msg'; m.textContent = String(message); box.appendChild(m);
      const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'ccf-am-input app-prompt-input'; inp.value = String(defaultValue == null ? '' : defaultValue); inp.style.cssText = 'width:100%; margin-top:10px;'; box.appendChild(inp);
      const row = document.createElement('div'); row.className = 'app-dialog-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'app-dialog-btn'; cancel.dataset.act = 'cancel'; cancel.textContent = opts.cancelText || 'キャンセル';
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'app-dialog-btn primary'; ok.dataset.act = 'ok'; ok.textContent = opts.okText || 'OK';
      row.append(cancel, ok); box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
      const prev = document.activeElement;
      const done = v => { document.removeEventListener('keydown', onKey, true); ov.remove(); if (prev && prev.focus) { try { prev.focus(); } catch (e) { logSoft('appPrompt', e); } } resolve(v); };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); done(inp.value); }
      };
      document.addEventListener('keydown', onKey, true);
      cancel.onclick = () => done(null); ok.onclick = () => done(inp.value);
      ov.addEventListener('mousedown', e => { if (e.target === ov) done(null); });
      inp.focus(); inp.select();
    });
    const p = _dlgChain.then(run); _dlgChain = p.catch(e => logSoft('async', e)); return p;
  }
  if (typeof window !== 'undefined') window.appPrompt = appPrompt;

  // 概要項目（summary）のラベル表示幅に相当するインデント文字列を生成し、プレーンテキスト出力時の2行目以降の頭を揃える
  // （プロポーショナルフォント上でカタカナや全角コロン「：」・括弧類が全角漢字より狭いことを考慮し、「プレイ時間：」なら全角スペース5個分に調整）
  function buildSummaryLabelIndent(labelPrefix) {
    let em = 0;
    for (const ch of String(labelPrefix || '')) {
      if (/^[\x20-\x7e\uff61-\uff9f]$/.test(ch)) em += 0.5;
      else if (/^[：；:]$/.test(ch)) em += 0.55;
      else if (/^[【】［］「」『』（）〔〕〈〉《》]$/.test(ch)) em += 0.65;
      else if (/^[\u30a1-\u30fc]$/.test(ch)) em += 0.86;
      else if (/^[\u3041-\u3096]$/.test(ch)) em += 0.92;
      else em += 1.0;
    }
    const halfUnits = Math.max(0, Math.round(em * 2));
    return '\u3000'.repeat(Math.floor(halfUnits / 2)) + (halfUnits % 2 ? ' ' : '');
  }
  function formatSummaryMultilineLines(labelPrefix, val, itemPrefix) {
    const pfx = String(itemPrefix || '');
    const fullLabel = pfx + String(labelPrefix || '');
    const lines = String(val == null ? '' : val).split(/\r?\n/);
    const indent = fullLabel ? buildSummaryLabelIndent(fullLabel) : '';
    const out = [];
    lines.forEach((rawLine, idx) => {
      if (idx === 0) {
        out.push(fullLabel ? `${fullLabel}${rawLine}` : rawLine);
      } else {
        const trimmed = String(rawLine || '').replace(/^[ \u3000\t]+/, '');
        out.push(trimmed ? `${indent}${trimmed}` : '');
      }
    });
    return out;
  }
  window.buildSummaryLabelIndent = buildSummaryLabelIndent;
  window.formatSummaryMultilineLines = formatSummaryMultilineLines;

  // 送信される内容をそのままクリップボードへ（Webhookを使わず手動で投稿するとき用）
  let copyTimer = null;
  function finalText(c) {
    const vertical = document.getElementById('verticalImageMode')?.checked; let t = c.text;
    if (!vertical) c.images.forEach(im => { if (!im.file && im.url && !/^(data:|blob:|@img:)/.test(im.url)) t = (t ? t + '\n' : '') + im.url; });
    return t;
  }
  function getCopyText() {
    return buildPostData().map((c, i) => {
      const t = finalText(c);   // 縦並びOFFのURL画像は本文に入る（実際の送信と同じ）
      return i === 0 ? t : `\n\n----- ✂️ 分割（ここから${i + 1}通目）-----\n\n` + t;
    }).join('');
  }
  async function copyPostContent() {
    const btn = document.getElementById('copyPostBtn'), text = getCopyText();
    const flash = msg => { if (!btn.dataset.orig) btn.dataset.orig = btn.textContent; btn.textContent = msg; clearTimeout(copyTimer); copyTimer = setTimeout(() => { btn.textContent = btn.dataset.orig; }, 2500); };
    if (!text.trim()) return flash('⚠️ 内容が空です');
    let done = false;
    try { await navigator.clipboard.writeText(text); done = true; }
    catch (e) {
      try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0;'; document.body.appendChild(ta); ta.select(); done = document.execCommand('copy'); ta.remove(); } catch (e2) { logSoft('copyPostContent', e2); }
    }
    flash(done ? '✅ コピーしました！' : '❌ コピーに失敗しました');
  }

  function escapeHTML(str) {
    if (typeof str === 'number' || typeof str === 'boolean') str = String(str);   // 数値・真偽値も文字列として扱う
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[match]);
  }

  function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) { u8arr[n] = bstr.charCodeAt(n); }
    return new Blob([u8arr], { type: mime });
  }

  function compressImage(file, maxWidth = 1000, maxHeight = 1000, quality = 0.8) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = event => {
        const img = new Image();
        img.onload = () => {
          let width = img.width; let height = img.height;
          if (width > maxWidth || height > maxHeight) {
            if (width / height > maxWidth / maxHeight) {
              height = Math.round(height * maxWidth / width); width = maxWidth;
            } else {
              width = Math.round(width * maxHeight / height); height = maxHeight;
            }
          }
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => { toast('画像を読み込めませんでした'); resolve(''); }; img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.preview-area.zoomed')) return;
    document.querySelectorAll('.modal-overlay').forEach(async m => {
      if (m.style.display !== 'flex') return;
      if (m.id === 'editScenarioModal' && typeof closeScenarioWindow === 'function') { closeScenarioWindow(); return; }
      if (m.dataset.dirty && !(await appConfirm('入力中の内容を破棄して閉じますか？', { okText: '破棄して閉じる', danger: true }))) return;
      m.style.display = 'none';
    });
  });

  window.appReady = new Promise(res => { window.__appReadyResolve = res; });
  async function appInit() {
    let saved = null;
    await new Promise(r => setTimeout(r, 0));
    if (IS_ELECTRON && fs && DATA_ROOT) {
      const autoFile = path.join(DATA_ROOT, 'autosave_state.json');
      try {
        if (fs.existsSync(autoFile)) {
          if (typeof window.rotateDiskBackups === 'function') window.rotateDiskBackups(true);
          saved = await fs.promises.readFile(autoFile, 'utf8');
        }
      } catch (e) { logSoft('appInit disk read', e); }
    }
    if (!saved) {
      try { saved = await window.idbGetRaw('state'); } catch (e) { console.error(e); }
    }
    if (!saved) saved = localStorage.getItem('discord_forum_tool_data_v1'); // 旧バージョンからの引き継ぎ
    let stateCorrupt = false;
    if (saved) {
      try { appState = repairLoadedState(Object.assign(appState, JSON.parse(saved))); }
      catch (e) {   // 読み込めない（壊れている）場合は、元のデータを退避してから起動する（次の保存で上書きされて失われないように）
        stateCorrupt = true; logSoft('appInit parse', e);
        try { await window.idbSetRaw('state_backup_corrupt', saved); } catch (x) { logSoft('appInit backup', x); }
      }
    }
    if (stateCorrupt) setTimeout(() => toast('⚠️ 保存データを読み込めませんでした。元のデータは退避してあります（設定タブの「🕰 移行前データをJSONで書き出し」から取り出せます）'), 1200);
    try {
      await hydrateRefs(appState);
      if ((saved || '').replace(/"botAvatarData":"[^"]*"/, '').includes('data:image/')) {   // 旧形式（画像が状態に埋まっている）を移行
        const o = JSON.parse(serializeState(appState)); await persistChain; await hydrateRefs(o); appState = o; saveState();
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) { console.error(e); }
    
    appState.formatConfig = { ...defaultFormatConfig, ...(appState.formatConfig || {}) };
    const _prevSchema = appState.schemaVersion || 0;
    { const el = document.getElementById('maxAttachMB'); if (el) el.value = Number(appState.maxAttachMB) > 0 ? appState.maxAttachMB : 9.5; }
    if (_prevSchema < 3 && saved) { try { await window.idbSetRaw('state_backup_pre_v3', saved); } catch (e) { logSoft('appInit', e); } }   // 構造移行の前に、元のデータを退避（万一のとき戻せる）
    appState.schemaVersion = 3;
    if (!Array.isArray(appState.history)) appState.history = [];
    appState.scenarios.forEach(x => {
      if (!x.id) x.id = uid();
      if ('rostrite' in x) { if (x.lostRate === undefined) x.lostRate = x.rostrite; delete x.rostrite; }
      x.imageCategories = sanitizeCats(x.imageCategories, DEFAULT_SCENARIO_CATS);
    });

    ensureChannelIds(); appState.scenarios.forEach(normalizePosted);
    if (_prevSchema < 3) { appState.scenarios.forEach(migrateScenarioBlocks); saveState(); }
    if (typeof normalizeAllScenariosSystemData === 'function' && normalizeAllScenariosSystemData(appState)) {
      saveState(false, { skipDetailEdited: true });
    }
    primeScenarioSigs();   // v3: ブロックを正とする構造へ移行
    await restoreDraft();
    { const ls = blockOrder.find(b => b.id === 'shopUrl'), lt = blockOrder.find(b => b.id === 'trailer');   // 旧形式の下書きに残った項目を上部の入力欄へ移す
      const su = document.getElementById('topShopUrl'), tr = document.getElementById('topTrailer');
      if (ls && ls.val && !su.value) su.value = ls.val; if (lt && lt.val && !tr.value) tr.value = lt.val;
      blockOrder = blockOrder.filter(b => b.id !== 'shopUrl' && b.id !== 'trailer'); }
    blockOrder.forEach(b => { if (!b.decorStyle) b.decorStyle = 'default'; });
    { const sb = blockOrder.find(b => b.id === 'summary_container'); if (sb && (sb.keyName === undefined || sb.keyName === null)) sb.keyName = 'シナリオ概要'; }
    loadFormatConfigToUI(); loadSettingsToUI(); loadBotAvatarToUI(); renderChannelCheckboxes(); updateTagCheckboxes();
    populateScenarioDBSelect(); renderDBView(); renderHistoryTable();
    renderBlockUI(); renderPreview();
    if (typeof wirePostCardAccordions === 'function') wirePostCardAccordions();
    if (typeof updateChannelTagSummary === 'function') updateChannelTagSummary();
    updateEditScenarioBanner();
    if (typeof initPostDocViewer === 'function') initPostDocViewer();
  };

  function hideBootSplash() {
    const el = document.getElementById('appBootSplash');
    if (!el || el.classList.contains('fade-out')) return;
    el.classList.add('fade-out');
    setTimeout(() => { try { el.remove(); } catch (_) { } }, 380);
  }
  window.onload = async () => {
    try { await appInit(); }
    catch (e) { console.error(e); toast('❌ 起動中にエラーが発生しました: ' + (e && e.message || e)); }
    finally {
      hideBootSplash();
      window.__appReadyResolve();
      setTimeout(() => {
        try {
          if (typeof syncAllDerivedTags === 'function' && syncAllDerivedTags() && typeof renderSidebarTags === 'function') {
            renderSidebarTags();
          }
        } catch (e) { logSoft('asyncSyncDerivedTags', e); }
      }, 60);
    }
  };
  try { Object.keys(localStorage).filter(k => k.startsWith('discord_avatar_patched_http')).forEach(k => localStorage.removeItem(k)); } catch (e) { logSoft('appInit', e); }   // 旧版がURLをキーにして残したもの

  // プレビューHTML描画用に、現在の概要項目（summary）のラベルプレフィックス一覧を取得する
  function getActiveSummaryLabelPrefixes() {
    const cfg = (typeof appState !== 'undefined' && appState && appState.formatConfig) ||
      (typeof defaultFormatConfig !== 'undefined' ? defaultFormatConfig : { subPre: '【', subPost: '】', simpleList: '・', fancyList: '❖ ' });
    const itemPrefixes = ['', cfg.simpleList || '', cfg.fancyList || ''];
    if (typeof appState !== 'undefined' && appState && Array.isArray(appState.formats)) {
      appState.formats.forEach(f => { if (f && f.linePre && !/^>\s*$/.test(f.linePre)) itemPrefixes.push(f.linePre); });
    }
    const keys = new Set(['システム', '人数', 'プレイ時間', '必須技能', '推奨技能', '準推奨技能', 'ロスト率', '後遺症']);
    if (typeof blockOrder !== 'undefined' && Array.isArray(blockOrder)) {
      blockOrder.forEach(b => {
        if (b && b.type === 'summary_container' && Array.isArray(b.items)) {
          b.items.forEach(it => { if (it && it.keyName && it.keyName.trim()) keys.add(it.keyName.trim()); });
        }
      });
    }
    const prefixes = [];
    const addP = p => { if (p && !prefixes.includes(p)) prefixes.push(p); };
    keys.forEach(k => {
      const base = `${cfg.subPre != null ? cfg.subPre : '【'}${k}${cfg.subPost != null ? cfg.subPost : '】'}`;
      itemPrefixes.forEach(ip => addP(ip + base));
      ['', '・', '❖ '].forEach(ip => {
        addP(`${ip}${k}：`);
        addP(`${ip}${k}:`);
        addP(`${ip}【${k}】`);
        addP(`${ip}【${k}】：`);
      });
    });
    prefixes.sort((a, b) => b.length - a.length);
    return prefixes;
  }

  function matchSummaryItemLineForPreview(content, knownPrefixes) {
    const s = String(content == null ? '' : content);
    if (!s || /^[ \u3000\t]/.test(s) || /^:link:|^https?:\/\//i.test(s)) return null;
    for (let i = 0; i < knownPrefixes.length; i++) {
      const p = knownPrefixes[i];
      if (s.startsWith(p)) return { label: p, val: s.slice(p.length) };
    }
    const m = s.match(/^((?:[・❖●○■□◆◇]\s*)?(?:【[^】\n]{1,20}】[:：]?|[^\s:：【】「」『』（）()#*>`\n]{1,15}：))(.*)$/);
    if (m) return { label: m[1], val: m[2] };
    return null;
  }

function mdToHtml(text) {   // プレビュー用の簡易Markdown（見出し・引用・太字・コード・スポイラー＋概要項目2列Flex描画）
    const inline = t => escapeHTML(t.replace(/\u200B/g, '')).replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\|\|([^|\n]+)\|\|/g, '<span class="md-spoiler">$1</span>').replace(/:link:/g, '🔗');
    const out = []; let code = null;
    const knownPrefixes = getActiveSummaryLabelPrefixes();
    const lines = String(text == null ? '' : text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^```/.test(line)) { if (code === null) code = []; else { out.push('<pre class="md-pre">' + escapeHTML(code.join('\n')) + '</pre>'); code = null; } continue; }
      if (code !== null) { code.push(line); continue; }
      let m;
      if ((m = line.match(/^(#{1,3}) (.*)$/))) { out.push('<div class="md-h">' + inline(m[2]) + '</div>'); continue; }
      const qm = line.match(/^> ?(.*)$/);
      const isQuote = !!qm;
      const content = isQuote ? qm[1] : line;
      const sumMatch = matchSummaryItemLineForPreview(content, knownPrefixes);
      if (sumMatch) {
        const valLines = [sumMatch.val];
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (/^```/.test(nextLine)) break;
          const nextQm = nextLine.match(/^> ?(.*)$/);
          const nextIsQuote = !!nextQm;
          if (nextIsQuote !== isQuote) break;
          const nextContent = nextIsQuote ? nextQm[1] : nextLine;
          if (/^[ \u3000\t]+\S/.test(nextContent)) {
            valLines.push(nextContent.replace(/^[ \u3000\t]+/, ''));
            i++;
          } else {
            break;
          }
        }
        const rowCls = (isQuote ? 'md-quote ' : '') + 'prv-sum-row';
        const valHtml = valLines.map(v => inline(v)).join('\n') || '&nbsp;';
        out.push(`<div class="${rowCls}"><span class="prv-sum-label">${inline(sumMatch.label)}</span><span class="prv-sum-val">${valHtml}</span></div>`);
        continue;
      }
      if (isQuote) out.push('<div class="md-quote">' + (inline(content) || '&nbsp;') + '</div>');
      else out.push('<div>' + (inline(line) || '&nbsp;') + '</div>');
    }
    if (code !== null) out.push('<pre class="md-pre">' + escapeHTML(code.join('\n')) + '</pre>');
    return out.join('');
  }
  let _dbT = null; function debouncedDB() { clearTimeout(_dbT); _dbT = setTimeout(renderDBView, 200); }
  document.getElementById('databaseTab').addEventListener('click', e => {   // DB一覧のボタン（IDで対象を特定）
    if (e.target.closest('.db-sel-label, .db-sel-chk, [data-bulk-act]')) return;
    const b = e.target.closest('[data-act]'); if (!b) return;
    const idx = appState.scenarios.findIndex(s => s.id === b.dataset.id); if (idx < 0) return;
    const act = b.dataset.act;
    if (act === 'load') { loadScenarioFromDB(b.dataset.id); switchTab('postTab'); }
    else if (act === 'edit') { if (typeof openScenarioDetail === 'function') openScenarioDetail(b.dataset.id); else { loadScenarioFromDB(b.dataset.id); switchTab('postTab'); } }
    else if (act === 'del') deleteScenarioDB(idx);
    else if (act === 'unpost') removePostedChannel(idx, Number(b.dataset.ci));
    else if (act === 'status') openPostStatusDialog(b.dataset.id);
    else if (act === 'fav') { appState.scenarios[idx].favorite = !appState.scenarios[idx].favorite; saveState(); renderDBView(); populateScenarioDBSelect(); }
  });
  document.addEventListener('keydown', e => { const f = e.target.closest && e.target.closest('.fav-star'); if (f && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); f.click(); } });
  document.addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('.chip[tabindex]'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); c.click(); } });
  document.addEventListener('click', e => {
    const c = e.target.closest('.chip[role="checkbox"]'); if (c) c.setAttribute('aria-checked', c.classList.contains('selected'));
    const sp = e.target.closest('.md-spoiler'); if (sp) sp.classList.toggle('open');
  });
  document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('input', () => { m.dataset.dirty = '1'; }));

  function switchTab(tabId, evt) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); });
    document.getElementById(tabId).classList.add('active');
    const tb = [...document.querySelectorAll('.tab-btn')].find(b => b.dataset.tab === tabId); if (tb) { tb.classList.add('active'); tb.setAttribute('aria-selected', 'true'); }
    document.body.dataset.activeTab = tabId;   // 「フォーム初期化」などは .post-only ＝ 📝 Discord投稿・編集 を開いている時だけ表示（CSSで制御）
  }

  // ---- Discord設定ポップアップ（旧「⚙️ 初期設定」タブ。📝 Discord投稿・編集 画面のボタンから開く）----
  function setSettingsTab(tab) {   // 設定ポップアップのタブ切り替え（appearance＝外観・テーマ / discord＝Discord投稿・初期設定）
    const m = document.getElementById('settingsModal'); if (!m) return; tab = tab === 'discord' ? 'discord' : 'appearance';
    m.querySelectorAll('[data-set-pane]').forEach(p => { p.hidden = p.dataset.setPane !== tab; });
    m.querySelectorAll('[data-set-tab]').forEach(b => { const on = b.dataset.setTab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const b = m.querySelector('[data-set-pane]:not([hidden])'); if (b) b.scrollTop = 0;
  }
  function openSettingsModal(tab) {
    const m = document.getElementById('settingsModal'); if (!m) return;
    renderChannelConfigList(); setSettingsTab(tab === 'appearance' ? 'appearance' : 'discord'); m.classList.add('open');
    if (typeof window.refreshAppearanceButtons === 'function') window.refreshAppearanceButtons();
  }
  document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[data-set-tab]'); if (t) setSettingsTab(t.dataset.setTab); });
  function closeSettingsModal() { const m = document.getElementById('settingsModal'); if (m) m.classList.remove('open'); }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return; const m = document.getElementById('settingsModal');
    if (m && m.classList.contains('open') && !document.querySelector('.app-dialog-overlay')) closeSettingsModal();
  });
  document.addEventListener('mousedown', e => { if (e.target && e.target.id === 'settingsModal') closeSettingsModal(); });   // 暗い背景をクリックで閉じる

  function setDBViewMode(mode) {
    dbViewMode = mode;
    document.getElementById('btnViewCard').style.background = mode === 'card' ? 'var(--dc-accent)' : '#4e5058';
    document.getElementById('btnViewTable').style.background = mode === 'table' ? 'var(--dc-accent)' : '#4e5058';
    renderDBView();
  }

  function getSumValFromBlock(key) {
    const sumBlock = blockOrder.find(b => b.type === 'summary_container');
    if (!sumBlock) return "";
    const item = sumBlock.items.find(i => i.keyName === key);
    return item ? item.val : "";
  }

  function updateEditScenarioBanner() {
    const el = document.getElementById('editScenarioName');
    if (!el) return;
    const scenarios = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : [];
    const curId = (typeof currentScenarioId !== 'undefined') ? currentScenarioId : null;
    let sc = curId ? (scenarios.find(s => s && s.id === curId) || null) : null;
    if (!sc) {
      const titleEl = document.getElementById('title');
      const titleVal = titleEl ? String(titleEl.value || '').trim() : '';
      if (titleVal) {
        sc = (typeof findScenario === 'function')
          ? findScenario(titleVal)
          : (scenarios.find(s => s && (typeof titlesSame === 'function' ? titlesSame(s.title, titleVal) : String(s.title || '').trim() === titleVal)) || null);
      }
    }
    if (sc) {
      const history = (typeof appState !== 'undefined' && Array.isArray(appState.history)) ? appState.history : [];
      const histCount = history.filter(h => h && (typeof titlesSame === 'function' ? titlesSame(h.title, sc.title) : String(h.title || '').trim() === String(sc.title || '').trim())).length;
      const postedCount = Array.isArray(sc.postedChannels) ? sc.postedChannels.length : 0;
      const isPosted = histCount > 0 || postedCount > 0;
      const badgeText = histCount > 0 ? `投稿履歴 ${histCount}件` : (postedCount > 0 ? `投稿済 ${postedCount}ch` : '未投稿');
      const sig = `reg:${sc.id || ''}:${sc.title || ''}:${badgeText}`;
      if (el.dataset.bannerSig === sig) return;
      el.dataset.bannerSig = sig;
      el.classList.add('is-registered');
      el.classList.remove('is-draft');
      el.title = `編集中：『${sc.title || '無題'}』（${badgeText}）`;
      el.innerHTML = `<span class="edit-sname-main">📂 編集中：『${escapeHTML(sc.title || '無題')}』</span><span class="edit-hist-badge ${isPosted ? 'is-posted' : 'is-unposted'}">${escapeHTML(badgeText)}</span>`;
    } else {
      const sig = 'draft';
      if (el.dataset.bannerSig === sig) return;
      el.dataset.bannerSig = sig;
      el.classList.add('is-draft');
      el.classList.remove('is-registered');
      el.title = '未登録の下書き（保存／投稿で自動登録）';
      el.innerHTML = '<span class="edit-sname-main">📝 未登録の下書き（保存／投稿で自動登録）</span>';
    }
  }
  window.updateEditScenarioBanner = updateEditScenarioBanner;

function autoSyncToDBOnPost(title, targetChannelIds, opts) {
    if (!title) return;
    let existingIdx = (currentScenarioId && !(opts && opts.forceNew)) ? appState.scenarios.findIndex(s => s.id === currentScenarioId && titlesSame(s.title, title)) : -1;   // タイトルが全く違えば、直前のシナリオは上書きせず別DBとして追加
    if (existingIdx === -1 && !(opts && opts.forceNew)) existingIdx = appState.scenarios.findIndex(s => titlesSame(s.title, title));
    const prev = existingIdx !== -1 ? appState.scenarios[existingIdx] : null;
    const imageBlocks = blockOrder.filter(b => b.type === 'image' && b.previewUrl);
    const imageUrl = imageBlocks.length > 0 ? imageBlocks[0].previewUrl : (prev ? (prev.imageUrl || "") : "");
    const fullBlockData = JSON.parse(JSON.stringify(blockOrder.map(b => ({ ...b, file: null }))));
    const scData = Object.assign({}, prev, {
      id: (prev && prev.id) || uid(), title, system: getSumValFromBlock('システム'),
      shopUrl: document.getElementById('topShopUrl').value, trailer: document.getElementById('topTrailer').value,
      trailerDecor: document.getElementById('topTrailerDecor') ? document.getElementById('topTrailerDecor').value : 'default',
      imageUrl, playerCount: getSumValFromBlock('人数'), playTime: getSumValFromBlock('プレイ時間'),
      reqSkills: getSumValFromBlock('必須技能'), recSkills: getSumValFromBlock('推奨技能'), semiRecSkills: getSumValFromBlock('準推奨技能'),
      lostRate: getSumValFromBlock('ロスト率'), aftereffect: getSumValFromBlock('後遺症'), notes: getBlockVal('notes'),
      postedChannels: prev ? [...(prev.postedChannels || [])] : [], postedInfo: prev ? JSON.parse(JSON.stringify(prev.postedInfo || {})) : {},
      imageCategories: sanitizeCats(prev && prev.imageCategories, DEFAULT_SCENARIO_CATS),
      tags: [...activeTagNames], autoReply: document.getElementById('autoReplyText').value, secretHOs: cloneHOs(), fullBlockData, publicBlocks: JSON.parse(JSON.stringify(fullBlockData))
    });
    deriveFlat(scData);   // フラット項目はブロックから作り直す（二重管理をここで一本化）
    if (typeof syncDerivedTagsFromFields === 'function') { syncDerivedTagsFromFields(scData); activeTagNames = new Set(scData.tags); try { updateTagCheckboxes(); } catch (_) { } }   // 人数・システムの実文から自動タグを付け替え
    targetChannelIds.forEach(id => { const c = chById(id); setPosted(scData, id, true, c ? tagsForChannel(c) : []); });
    if (existingIdx !== -1) appState.scenarios[existingIdx] = scData; else appState.scenarios.push(scData);
    currentScenarioId = scData.id;
    saveState(); populateScenarioDBSelect(); renderDBView();
    updateEditScenarioBanner();
    if (typeof refreshPostDocList === 'function') refreshPostDocList({ autoOpen: false });
  }

  async function removePostedChannel(scenarioIdx, entryIdx) {
    const sc = appState.scenarios[scenarioIdx]; if (!sc || !sc.postedChannels) return;
    const id = typeof entryIdx === 'number' ? sc.postedChannels[entryIdx] : entryIdx; if (id === undefined) return;
    if (await appConfirm(`「${sc.title}」の「${postedLabel(sc, id)}」における投稿状態を未投稿に変更しますか？`, { okText: '未投稿にする' })) {
      setPosted(sc, id, false); saveState(); renderDBView(); populateScenarioDBSelect(); checkDuplicateStatus(); updateEditScenarioBanner();
    }
  }

  // 投稿状態（投稿済みチャンネル・保存タグ）を手動で変更するダイアログ
