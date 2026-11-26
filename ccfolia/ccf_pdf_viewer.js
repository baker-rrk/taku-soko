/* ccf_pdf_viewer.js — 再利用できる PDF ビューア部品（pdfjs-dist 3.x legacy ビルド）
 *  メイン画面の左ペインと、切り離した別ウィンドウ（pdf_window.html）の両方で同じ部品を使う。
 *    const v = CCFPdfViewer.create(containerEl, { appDir, onExtract(raw, {shift, page, via, src}), onState(state), onOpenRequest(path, {page}), onClose(), popout:{ label, onClick }, spread:true,
 *                                                  getBookmarks(), onBookmarks(list), onSaveImage({dataUrl, name, page, path, rect}) })
 *  選択方法は2つ：「なぞり選択」（文字をドラッグ）と「範囲選択」（四角く囲む。2段組向け）。選んだ文字列は onExtract で呼び出し側へ渡す（src＝抽出元のPDFパス・ページ・座標つき）。
 *  範囲選択のあとに出る「🖼️ 選択範囲を画像として保存」で、囲んだ領域を Canvas から PNG に切り抜いて onSaveImage へ渡す。
 *  表示は「縦スクロールで全ページが連続して並ぶ」形式（表示中のページだけ描画する遅延描画）。
 *  spread:true（別ウィンドウ用）のときは、「単ページ表示」⇔「見開き（2ページ横並び）表示」のトグルが付く（どちらも連続縦スクロール）。
 *  「✕ 選択解除」で開いているPDFを閉じて初期表示へ戻す。「◀ 戻る／進む ▶」でページ移動履歴をたどれる。
 *  「📑 目次・しおり」：PDFのアウトライン（無ければ大見出しを自動抽出）＋カスタムしおり。検索窓は現在のPDF／全PDF横断で、一致した文字部分だけを精密にハイライトする。
 *  開いたPDFは LRU キャッシュ（最大5冊）に保持。使用中のキー（inUseKeys）は破棄（destroy）されない。 */
 (function () {
  'use strict';
  const T = window.CCFText;
  const nodeFs = typeof require === 'function' ? require('fs') : null, nodePath = typeof require === 'function' ? require('path') : null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let pdfjs = null, pdfBase = '', pdfjsLoadPromise = null;
  const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const fileUrl = p => require('url').pathToFileURL(p).href;
  const isAssetRef = p => !!(window.WebBridge && WebBridge.isAssetRef(p));
  const isCloudRef = p => !!(window.CloudSync && CloudSync.isCloudAssetRef && CloudSync.isCloudAssetRef(p));
  const isDocTextRef = p => /^doc-text:\/\//i.test(String(p || ''));
  const isMissingDocRef = p => /^missing-doc:\/\//i.test(String(p || ''));
  const baseName = p => {
    if (isMissingDocRef(p)) { try { return decodeURIComponent(String(p).slice('missing-doc://'.length)) || 'doc'; } catch (_) { return String(p).slice('missing-doc://'.length) || 'doc'; } }
    if (isCloudRef(p)) { const parsed = CloudSync.parseCloudAssetRef(p); return (parsed && parsed.name) || 'asset'; }
    return isAssetRef(p) ? WebBridge.assetBasename(p) : (nodePath ? nodePath.basename(p) : String(p || '').split(/[\\/]/).pop());
  };
  const LAYOUT_KEY = 'ccf_pdf_layout', EXT_KEY = 'ccf_ext_opts', MARK_KEY = 'ccf_marks_on';
  const pkey = p => (isAssetRef(p) || isCloudRef(p) || isDocTextRef(p) || isMissingDocRef(p)) ? String(p) : String(p || '').replace(/\//g, '\\').toLowerCase();
  /** 抽出オプション（ルビ除外・2段組整列・1行目の自動タイトル化）。メイン画面と別ウィンドウで共有（localStorage） */
  function extOpts() {
    const d = { ruby: true, twoCol: true, autoTitle: true };
    try { const j = JSON.parse(localStorage.getItem(EXT_KEY) || 'null'); if (j && typeof j === 'object') Object.keys(d).forEach(k => { if (typeof j[k] === 'boolean') d[k] = j[k]; }); } catch (e) { /* noop */ }
    return d;
  }
  function setExtOpts(p) { const v = Object.assign(extOpts(), p || {}); try { localStorage.setItem(EXT_KEY, JSON.stringify(v)); } catch (e) { /* noop */ } return v; }

  function loadPdfjs(appDir) {
    if (pdfjs) return pdfjs;
    if (!nodePath) throw new Error('Webブラウザでは loadPdfjsAsync() を使用してください');
    pdfBase = nodePath.join(appDir, 'node_modules', 'pdfjs-dist');
    pdfjs = require(nodePath.join(pdfBase, 'legacy', 'build', 'pdf.js'));
    pdfjs.GlobalWorkerOptions.workerSrc = fileUrl(nodePath.join(pdfBase, 'legacy', 'build', 'pdf.worker.js'));
    if (!document.getElementById('ccfPdfViewerCss')) { const l = document.createElement('link'); l.id = 'ccfPdfViewerCss'; l.rel = 'stylesheet'; l.href = fileUrl(nodePath.join(pdfBase, 'web', 'pdf_viewer.css')); document.head.appendChild(l); }
    return pdfjs;
  }
  async function loadPdfjsAsync(appDir) {
    if (pdfjs) return pdfjs;
    if (nodePath) return loadPdfjs(appDir);
    if (window.pdfjsLib) {
      pdfjs = window.pdfjsLib;
      if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_CDN + 'pdf.worker.min.js';
      return pdfjs;
    }
    if (!pdfjsLoadPromise) {
      pdfjsLoadPromise = new Promise((resolve, reject) => {
        if (!document.getElementById('ccfPdfViewerCss')) {
          const l = document.createElement('link');
          l.id = 'ccfPdfViewerCss'; l.rel = 'stylesheet'; l.href = PDFJS_CDN + 'pdf_viewer.min.css';
          document.head.appendChild(l);
        }
        const s = document.createElement('script');
        s.src = PDFJS_CDN + 'pdf.min.js';
        s.async = true;
        s.onload = () => {
          const lib = window.pdfjsLib;
          if (!lib) return reject(new Error('pdf.js の読み込みに失敗しました'));
          lib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + 'pdf.worker.min.js';
          pdfjs = lib;
          resolve(lib);
        };
        s.onerror = () => { pdfjsLoadPromise = null; reject(new Error('pdf.js (CDN) を読み込めませんでした。通信状態を確認してください')); };
        document.head.appendChild(s);
      });
    }
    return pdfjsLoadPromise;
  }
  async function toPdfBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return new Uint8Array(data || []);
  }
  /** 日本語CIDフォントが文字化けしないよう、cMapUrl / cMapPacked / standardFontDataUrl を必ず付けて開く（メイン画面・別ウィンドウ共通） */
  async function getDoc(appDir, data) {
    const lib = await loadPdfjsAsync(appDir);
    const u8 = await toPdfBytes(data);
    if (nodePath) {
      return lib.getDocument({ data: u8, cMapUrl: fileUrl(nodePath.join(pdfBase, 'cmaps')) + '/', cMapPacked: true, standardFontDataUrl: fileUrl(nodePath.join(pdfBase, 'standard_fonts')) + '/', isEvalSupported: false }).promise;
    }
    return lib.getDocument({ data: u8, cMapUrl: PDFJS_CDN + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_CDN + 'standard_fonts/', isEvalSupported: false }).promise;
  }
  function repairScenarioDocPath(scenarioId, origPathOrName, resolvedPath) {
    try {
      if (!scenarioId || !resolvedPath) return;
      const list = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios))
        ? appState.scenarios
        : (typeof window !== 'undefined' && window.CCF && typeof CCF.scenarioList === 'function' ? CCF.scenarioList() : []);
      const sc = list.find(s => s && String(s.id) === String(scenarioId));
      if (!sc || !Array.isArray(sc.docs)) return;
      const targetBn = String(baseName(origPathOrName || resolvedPath) || '').normalize('NFKC').trim().toLowerCase();
      const resolvedBn = String(baseName(resolvedPath) || '').normalize('NFKC').trim().toLowerCase();
      const stripExt = s => String(s || '').replace(/\.[a-z0-9]{1,8}$/i, '');
      const targetStem = stripExt(targetBn);
      const resolvedStem = stripExt(resolvedBn);
      let changed = false;
      for (const d of sc.docs) {
        if (!d || typeof d !== 'object') continue;
        const cands = [d.origName, d.name, baseName(d.path || ''), baseName(d.ref || ''), baseName(d.rel || '')]
          .map(v => String(v || '').normalize('NFKC').trim().toLowerCase())
          .filter(Boolean);
        const hit = cands.some(c =>
          c === targetBn || c === resolvedBn ||
          (targetStem && stripExt(c) === targetStem) ||
          (resolvedStem && stripExt(c) === resolvedStem)
        );
        if (hit && d.path !== resolvedPath) {
          d.path = resolvedPath;
          if (!d.ref || !nodeFs || !nodeFs.existsSync(d.ref)) d.ref = resolvedPath;
          try { if (nodeFs) d.mtime = nodeFs.statSync(resolvedPath).mtimeMs || d.mtime || 0; } catch (_) {}
          changed = true;
        }
      }
      if (changed && typeof saveState === 'function') {
        try { saveState(); } catch (_) {}
      }
    } catch (_) {}
  }
  async function tryReadResolvedLocal(scenarioId, origPath) {
    if (!nodeFs) return null;
    try {
      const assets = typeof window !== 'undefined' && window.CCF && window.CCF.assets;
      if (!assets || typeof assets.resolveScenarioLocalDocPath !== 'function') return null;
      const bn = baseName(origPath);
      const resolved = assets.resolveScenarioLocalDocPath(scenarioId, origPath) || (bn && bn !== origPath ? assets.resolveScenarioLocalDocPath(scenarioId, bn) : '');
      if (resolved && nodeFs.existsSync(resolved)) {
        repairScenarioDocPath(scenarioId, origPath, resolved);
        const buf = nodeFs.promises ? await nodeFs.promises.readFile(resolved) : nodeFs.readFileSync(resolved);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
      }
    } catch (_) {}
    return null;
  }
  async function readFileBytes(p, opts) {
    const o = opts || {};
    const scenarioId = o.scenarioId || ((typeof window !== 'undefined' && window.CCF && CCF.S && CCF.S.key && CCF.S.key !== '_default') ? CCF.S.key : (typeof currentScenarioId !== 'undefined' && currentScenarioId ? currentScenarioId : ''));
    if (isCloudRef(p) && window.CloudSync && CloudSync.readCloudAssetBytes) {
      const u8 = await CloudSync.readCloudAssetBytes(p, { download: true, scenarioId });
      if (u8) return u8;
      if (nodeFs) {
        const u8l = await tryReadResolvedLocal(scenarioId, p);
        if (u8l && u8l.length) return u8l;
      }
      throw new Error('クラウドから資料を取得できませんでした（ログインまたは同期フォルダ設定を確認してください）');
    }
    if (isMissingDocRef(p)) {
      if (nodeFs) {
        const u8l = await tryReadResolvedLocal(scenarioId, p);
        if (u8l && u8l.length) return u8l;
      }
      let name = '';
      try { name = decodeURIComponent(String(p).slice('missing-doc://'.length)); } catch (_) { name = String(p).slice('missing-doc://'.length); }
      if (name && window.CloudSync && CloudSync.readByPathOrName) {
        const u8c = await CloudSync.readByPathOrName(name, { scenarioId });
        if (u8c && u8c.length) return u8c;
      }
      throw new Error('資料をローカル・クラウドのどちらからも取得できませんでした');
    }
    if (isAssetRef(p) && window.WebBridge) {
      try {
        const u8 = await WebBridge.readAssetBytes(p);
        if (u8 && u8.length) return u8;
      } catch (_) {}
      if (window.CloudSync && CloudSync.ensureAssetByIdbRef) {
        const u8c = await CloudSync.ensureAssetByIdbRef(p, { scenarioId });
        if (u8c && u8c.length) return u8c;
      }
      throw new Error('資料をローカル・クラウドのどちらからも取得できませんでした');
    }
    if (nodeFs) {
      if (nodeFs.existsSync(p)) {
        const buf = nodeFs.promises ? await nodeFs.promises.readFile(p) : nodeFs.readFileSync(p);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
      }
      const u8l = await tryReadResolvedLocal(scenarioId, p);
      if (u8l && u8l.length) return u8l;
      if (window.CloudSync && CloudSync.readByPathOrName) {
        const u8c = await CloudSync.readByPathOrName(p, { scenarioId });
        if (u8c && u8c.length) return u8c;
      }
      throw new Error('資料をローカル・クラウドのどちらからも取得できませんでした');
    } else if (window.CloudSync && CloudSync.readByPathOrName) {
      const u8c = await CloudSync.readByPathOrName(p, { scenarioId });
      if (u8c && u8c.length) return u8c;
    }
    throw new Error('ブラウザ版ではPDFを選択またはドロップして開いてください');
  }

  // ---- 開いたPDFの LRU キャッシュ（最大5冊）。使用中のキー（inUseKeys）は destroy しない ----
  const CACHE_MAX = 5;
  const docCache = new Map();   // key → { doc, sizes, mtime, scan }（Map の挿入順＝使った順。古いものから捨てる）
  const inUse = new Map();      // viewerId → key（メイン画面・別ウィンドウのビューアが今使っているPDF）
  let viewerSeq = 0;
  const inUseKeys = () => new Set(inUse.values());
  function touch(key) { const e = docCache.get(key); if (e) { docCache.delete(key); docCache.set(key, e); } }
  function evict() {
    const keep = inUseKeys();
    for (const [k, e] of [...docCache]) {
      if (docCache.size <= CACHE_MAX) break;
      if (keep.has(k)) continue;   // 表示中のPDFは絶対に捨てない
      docCache.delete(k); scanCache.delete(k); try { e.doc.destroy(); } catch (er) { if (typeof logSoft === 'function') logSoft('pdfEvict', er); }
    }
  }
  function evictKey(key) {
    if (!key) return;
    const keep = inUseKeys();
    if (keep.has(key)) return;
    const ent = docCache.get(key);
    if (ent) {
      docCache.delete(key);
      try { if (ent.doc && typeof ent.doc.destroy === 'function') ent.doc.destroy(); } catch (er) { if (typeof logSoft === 'function') logSoft('pdfEvictKey', er); }
    }
    scanCache.delete(key);
  }
  function evictPaths(paths) {
    (paths || []).forEach(p => { if (p) evictKey(pkey(p)); });
  }
  const mtimeOf = p => { try { return (nodeFs && !isAssetRef(p) && !isCloudRef(p) && !isDocTextRef(p) && !isMissingDocRef(p)) ? nodeFs.statSync(p).mtimeMs : 0; } catch (e) { return 0; } };
  // 本文の索引（検索・見出し抽出）。PDFごとに1回だけ作る：{ pages:[{text,starts}], heads:[{page,text,level}] }
  const scanCache = new Map();   // key → { mtime, promise }

  const HEAD_RE = /^(?:【?\s*HO\s*[0-9０-９]+\s*】?|導入|プロローグ|オープニング|エピローグ|エンディング|クライマックス|第\s*[0-9０-９一二三四五六七八九十]+\s*[幕章話節]|ハンドアウト|シナリオ(?:概要|背景)|あらすじ|付録)/i;
  /** PDF全ページの文字を読み、検索用の索引と「大見出し」候補（フォントサイズが大きい短い行）を作る */
  async function scanDoc(doc) {
    const n = Math.min(doc.numPages, 600), pages = [], lines = [], sizeChars = new Map();
    for (let i = 1; i <= n; i++) {
      const pg = await doc.getPage(i), tc = await pg.getTextContent(), starts = []; let text = '', cur = null;
      tc.items.forEach(it => {
        const s = typeof it.str === 'string' ? it.str : ''; starts.push(text.length); text += s;
        if (!it.transform || !s.trim()) return;
        const sz = Math.round(Math.hypot(it.transform[2], it.transform[3]) * 2) / 2, y = Math.round(it.transform[5] / 3);
        sizeChars.set(sz, (sizeChars.get(sz) || 0) + s.length);
        if (cur && cur.y === y) { cur.text += s; cur.size = Math.max(cur.size, sz); } else { cur = { page: i, y, text: s, size: sz }; lines.push(cur); }
      });
      pages.push({ text, starts });
      try { if (typeof pg.cleanup === 'function') pg.cleanup(); } catch (_) { }
      if (i % 15 === 0) await new Promise(r => setTimeout(r, 0));
    }
    let mode = 10, best = -1; sizeChars.forEach((c, sz) => { if (c > best) { best = c; mode = sz; } });
    const cnt = new Map(); lines.forEach(l => { l.text = l.text.replace(/\s+/g, ' ').trim(); cnt.set(l.text, (cnt.get(l.text) || 0) + 1); });
    const heads = [], sizes = new Set();
    lines.forEach(l => {
      const len = l.text.length; if (len < 1 || len > 40 || cnt.get(l.text) > 3) return;   // 同じ行が何度も出るのは柱（ページ上部の見出し）なので除外
      if ((l.size >= mode * 1.35 && l.size >= mode + 2 && len >= 2) || (HEAD_RE.test(l.text) && l.size >= mode * 1.1 && len <= 24)) { heads.push(l); sizes.add(l.size); }
    });
    const rank = [...sizes].sort((a, b) => b - a);
    return { pages, heads: heads.slice(0, 300).map(h => ({ page: h.page, text: h.text, level: Math.min(2, rank.indexOf(h.size)) })) };
  }
  async function destPage(doc, dest) {
    try {
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!Array.isArray(dest) || !dest.length) return 0; const r = dest[0];
      if (r && typeof r === 'object') return (await doc.getPageIndex(r)) + 1;
      if (Number.isInteger(r)) return r + 1;
    } catch (e) { /* noop */ }
    return 0;
  }
  async function flattenOutline(doc, items, level, out) {
    for (const it of items || []) {
      if (out.length > 600) return;
      const page = await destPage(doc, it.dest); if (page) out.push({ page, text: String(it.title || '').trim() || '(無題)', level: Math.min(level, 3) });
      if (it.items && it.items.length) await flattenOutline(doc, it.items, level + 1, out);
    }
  }
  const MAX_EFFECTIVE_DPR = 1.35;
  const MAX_CANVAS_EDGE = 1800;
  const MAX_CANVAS_PIXELS = MAX_CANVAS_EDGE * MAX_CANVAS_EDGE; // 辺長・DPR・面積をクランプして描画負荷とGPUコンテキストロストを防ぐ
  function clampCanvasScale(w, h, dpr) {
    const w0 = Math.max(1, w), h0 = Math.max(1, h);
    let s = Math.min(MAX_EFFECTIVE_DPR, Math.max(1, dpr || 1));
    if (w0 * s > MAX_CANVAS_EDGE) s = MAX_CANVAS_EDGE / w0;
    if (h0 * s > MAX_CANVAS_EDGE) s = Math.min(s, MAX_CANVAS_EDGE / h0);
    if (w0 * s * h0 * s > MAX_CANVAS_PIXELS) s = Math.min(s, Math.sqrt(MAX_CANVAS_PIXELS / (w0 * h0)));
    return Math.max(0.05, s);
  }
  const mul = (m1, m2) => [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];

  function create(container, opts) {
    const o = Object.assign({ appDir: '', onExtract() {}, onState() {}, onOpenRequest: null, onClose: null, popout: null, docSelect: true, spread: false, getBookmarks: null, onBookmarks: null, onSaveImage: null }, opts || {});
    const vid = ++viewerSeq;
    container.classList.add('ccf-viewer');
    container.innerHTML = `
      <div class="ccf-pane-head">
        <div class="ccf-head-row1">
          <select class="ccf-docsel" title="📄 表示資料切り替え：登録されたPDF（本編・KP情報・各話など）をワンクリックで切り替えます" aria-label="表示資料切り替え"></select>
          <button type="button" class="ccf-btn" data-v="open" title="PDFファイルを開く">📂 開く</button>
          <button type="button" class="ccf-btn" data-v="close" title="表示中のPDFを閉じて選択を解除します">✕ 解除</button>
          <button type="button" class="ccf-btn" data-v="toc" aria-pressed="false" title="目次（PDFのアウトライン／大見出しの自動抽出）としおりのパネルを開閉します">📑 目次・しおり</button>
          ${o.popout ? `<button type="button" class="ccf-btn" data-v="popout" title="${esc(o.popout.title || '')}">${esc(o.popout.label)}</button>` : ''}
          ${o.spread ? `<button type="button" class="ccf-btn ccf-layoutbtn" data-v="layout" aria-pressed="false" title="単ページ表示と見開き（2ページ横並び）表示を切り替えます">📖 見開き表示</button>` : ''}
        </div>
        <div class="ccf-head-row2">
          <div class="ccf-tool-grp" style="display:inline-flex;align-items:center;gap:3px;flex-shrink:0;white-space:nowrap;">
            <button type="button" class="ccf-btn" data-v="prev" title="前のページ">◀</button><input type="number" class="ccf-pageno" min="1" value="1" aria-label="ページ番号"><span class="ccf-pagetotal ccf-muted">/ -</span><button type="button" class="ccf-btn" data-v="next" title="次のページ">▶</button>
          </div>
          <div class="ccf-tool-grp" style="display:inline-flex;align-items:center;gap:3px;flex-shrink:0;white-space:nowrap;">
            <button type="button" class="ccf-btn" data-v="hback" title="前の表示位置へ戻る" disabled>↩</button><button type="button" class="ccf-btn" data-v="hfwd" title="進む" disabled>↪</button>
          </div>
          <div class="ccf-tool-grp" style="display:inline-flex;align-items:center;gap:3px;flex-shrink:0;white-space:nowrap;">
            <button type="button" class="ccf-btn" data-v="zoom-out" title="縮小">－</button><span class="ccf-zoomlabel ccf-muted">120%</span><button type="button" class="ccf-btn" data-v="zoom-in" title="拡大">＋</button><button type="button" class="ccf-btn" data-v="fit" title="幅に合わせる">↔</button>
          </div>
        </div>
      </div>
      <div class="ccf-modebar" role="radiogroup" aria-label="選択方法">
        <button type="button" class="ccf-mode active" data-mode="text" role="radio" aria-checked="true" title="文字をなぞって選択（ドラッグ）">✋ なぞり選択</button>
        <button type="button" class="ccf-mode" data-mode="rect" role="radio" aria-checked="false" title="四角く囲んで選択（2段組向け）。Shift を押しながらで追記。囲んだ後に「🖼️ 画像として保存」も選べます">▭ 範囲選択</button>
        <button type="button" class="ccf-btn" data-v="marks" aria-pressed="true" title="抽出済みの範囲に付く半透明マーカー（バッジ）の表示/非表示">🖍 抽出済み表示</button>
        <span class="ccf-muted ccf-modehelp"></span>
      </div>
      <div class="ccf-searchbar">
        <input type="search" class="ccf-q" placeholder="🔍 PDF内検索..." aria-label="PDF内検索">
        <button type="button" class="ccf-btn" data-v="s-prev" title="前の一致へ（Shift+Enter）">▲ 前へ</button><button type="button" class="ccf-btn" data-v="s-next" title="次の一致へ（Enter）">▼ 次へ</button>
        <span class="ccf-hitinfo ccf-muted" role="status"></span>
        <label class="ccf-qall-l"><input type="checkbox" class="ccf-qall"> 全PDFを横断検索</label>
      </div>
      <div class="ccf-toc" hidden>
        <div class="ccf-toc-sec"><b>📑 目次</b> <span class="ccf-muted ccf-toc-kind"></span><div class="ccf-toc-list" data-k="toc"></div></div>
        <div class="ccf-toc-sec"><b>🔖 しおり</b> <button type="button" class="ccf-btn" data-v="bm-add" title="いま表示中のページをしおりに追加します">＋ しおり追加</button><div class="ccf-toc-list" data-k="bm"></div></div>
      </div>
      <div class="ccf-pdf-wrap">
        <div class="ccf-pdf-body">
          <div class="ccf-pdf-empty">PDF をここへドラッグ＆ドロップ<br>または「📂 開く」で選んでください</div>
          <div class="ccf-pages single" hidden></div>
        </div>
        <div class="ccf-pdf-overlay" hidden></div>
      </div>`;
    const q = s => container.querySelector(s);
    const els = { body: q('.ccf-pdf-body'), empty: q('.ccf-pdf-empty'), pages: q('.ccf-pages'), pageNo: q('.ccf-pageno'), total: q('.ccf-pagetotal'), zoom: q('.ccf-zoomlabel'), help: q('.ccf-modehelp'), docsel: q('.ccf-docsel'), overlay: q('.ccf-pdf-overlay'), layoutBtn: q('.ccf-layoutbtn'),
      q: q('.ccf-q'), qall: q('.ccf-qall'), hitinfo: q('.ccf-hitinfo'), toc: q('.ccf-toc'), tocList: q('[data-k="toc"]'), bmList: q('[data-k="bm"]'), tocKind: q('.ccf-toc-kind'), back: q('[data-v="hback"]'), fwd: q('[data-v="hfwd"]'), marksBtn: q('[data-v="marks"]'), tocBtn: q('[data-v="toc"]') };
    const st = { doc: null, ent: null, key: '', page: 1, zoom: 1.2, mode: 'text', layout: 'single', gen: 0, sizes: [], pages: [], path: '', name: '', ready: 0, lockUntil: 0, hist: [], hi: -1, marksOn: true, flash: null, toc: null, openTok: 0, textMode: false, isSyncedText: false, textPages: [], textTotalPages: 1 };
    if (o.spread) { try { if (localStorage.getItem(LAYOUT_KEY) === 'spread') st.layout = 'spread'; } catch (e) { /* noop */ } }
    try { if (localStorage.getItem(MARK_KEY) === '0') st.marksOn = false; } catch (e) { /* noop */ }
    let io = null, ro = null, marks = [], bms = [], searchTimer = 0, visTimer = 0, visFollowTimer = 0, scrollTimer = 0, resizeTimer = 0, flashTimer = 0;
    let renderQueue = [], activeRenders = 0;
    const activeTasks = new Set();
    const S = { gen: 0, hits: [], cur: -1 };   // 検索の状態

    let docList = [];
    /** 表示中のPDFをドロップダウンの選択状態に反映する */
    const syncDocSel = () => { const k = pkey(st.path), hit = docList.find(d => pkey(d.value) === k); els.docsel.value = hit ? hit.value : ''; };
    const emitState = () => { syncDocSel(); o.onState({ path: st.path, name: st.name, page: st.page, zoom: st.zoom, pages: st.doc ? st.doc.numPages : (st.textMode ? (st.textTotalPages || 1) : 0), layout: st.layout }); };
    const pageOf = n => st.pages[n - 1] || null;
    function cancelPageTasks(p) {
      if (!p) return;
      if (p.task) { try { p.task.cancel(); } catch (e) { /* noop */ } activeTasks.delete(p.task); p.task = null; }
      if (p.textTask && typeof p.textTask.cancel === 'function') { try { p.textTask.cancel(); } catch (e) { /* noop */ } p.textTask = null; }
    }
    function cancelAllTasks() {
      renderQueue.length = 0;
      st.pages.forEach(cancelPageTasks);
      for (const t of [...activeTasks]) { try { t.cancel(); } catch (e) { /* noop */ } activeTasks.delete(t); }
    }

    // ---- PDFを開く（LRUキャッシュ経由） ----
    /** entry（{doc,sizes,...}）を表示対象にする。key があればキャッシュ管理（使用中として保護）、無ければこのビューア専用 */
    async function attach(ent, key, name, p, ov, tokArg) {
      const tok = tokArg != null ? tokArg : ++st.openTok;
      if (tok !== st.openTok) return;
      teardown();
      st.doc = ent.doc; st.ent = ent; st.key = key || ''; st.name = name || ''; st.path = p || '';
      if (key) { inUse.set(vid, key); touch(key); evict(); }
      st.page = Math.min(Math.max(1, (ov && ov.page) || 1), ent.doc.numPages); if (ov && ov.zoom) st.zoom = Math.min(4, Math.max(0.4, ov.zoom));
      // 全ページの大きさ（倍率1）を先に取得して、描画前でも正しい高さで縦に並べる（スクロール位置がずれない）
      if (!ent.sizes) {
        const sizes = [];
        for (let i = 1; i <= ent.doc.numPages; i++) { const pg = await ent.doc.getPage(i), v = pg.getViewport({ scale: 1 }); sizes.push({ w: v.width, h: v.height }); if (tok !== st.openTok) return; if (i % 25 === 0) await new Promise(r => setTimeout(r, 0)); }
        ent.sizes = sizes;
      }
      if (tok !== st.openTok) return;
      st.sizes = ent.sizes;
      els.empty.hidden = true; els.pages.hidden = false; els.total.textContent = '/ ' + ent.doc.numPages; els.pageNo.max = ent.doc.numPages;
      layout(st.page);
      if (ent.toc) { st.toc = ent.toc; renderToc(); }
      else if (!els.toc.hidden) loadToc();
      else { st.toc = null; renderToc(); }
      if (!els.qall.checked && els.q.value.trim()) scheduleSearch(0);   // 横断検索中はヒット一覧を保ったまま（別PDFへの移動で作り直さない）
    }
    const hasPdfHeader = u8 => { if (!u8 || !u8.length) return false; const n = Math.min(1024, u8.length); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[i]); return s.indexOf('%PDF-') >= 0; };
    const escHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    async function openData(u8, name, p, ov) {
      if (T.TEXT_DOC_RE.test(String(name || baseName(p) || '')) || !hasPdfHeader(u8)) {
        try { return await renderTextDoc(String(name || baseName(p) || 'text.txt'), p || '', u8, ov); } catch (e) { if (T.TEXT_DOC_RE.test(String(name || ''))) throw e; }
      }
      const tok = ++st.openTok;
      const doc = await getDoc(o.appDir, u8);
      if (tok !== st.openTok) { try { doc.destroy(); } catch (e) { /* noop */ } return; }
      return attach({ doc, sizes: null }, '', name, p, ov, tok);
    }
    /** .txt/.html/.htm/.md および同期テキストを、選択して抽出できる白紙カード表示で開く */
    let textFont = 13.5, textRaw = '', textMarks = [], textCur = -1;
    function parseTextPages(raw) {
      const src = String(raw == null ? '' : raw).replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n');
      const re = /^===\s*P\.(\d+)\s*===\s*$/gm;
      const matches = [...src.matchAll(re)];
      if (!matches.length) return null;
      const pages = [];
      const pre = src.slice(0, matches[0].index).replace(/^\n+|\n+$/g, '');
      if (pre) pages.push({ page: 1, body: pre, marker: '' });
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const start = m.index + m[0].length;
        const end = (i + 1 < matches.length) ? matches[i + 1].index : src.length;
        const pgNum = Number(m[1]) || (pages.length + 1);
        const body = src.slice(start, end).replace(/^\n+|\n+$/g, '');
        pages.push({ page: pgNum, body, marker: m[0].trim() });
      }
      return pages.length ? pages : null;
    }
    function highlightPlainText(src, ql) {
      const s = String(src == null ? '' : src);
      if (!ql) return escHtml(s);
      const lo = s.toLowerCase();
      let html = '', from = 0, at, n = 0;
      while (n < 2000 && (at = lo.indexOf(ql, from)) >= 0) {
        html += escHtml(s.slice(from, at)) + '<mark class="ccf-texthit">' + escHtml(s.slice(at, at + ql.length)) + '</mark>';
        from = at + Math.max(1, ql.length);
        n++;
      }
      return html + escHtml(s.slice(from));
    }
    function scrollToTextPage(n) {
      const b = textBodyEl(); if (!b) return;
      const pages = [...b.querySelectorAll('.ccf-textpage')];
      if (!pages.length) return;
      let target = pages.find(el => Number(el.dataset.page) === n);
      if (!target) target = pages.find(el => Number(el.dataset.page) >= n) || pages[pages.length - 1];
      if (!target) return;
      st.lockUntil = Date.now() + 300;
      els.body.scrollTop = target.getBoundingClientRect().top - els.body.getBoundingClientRect().top + els.body.scrollTop - 12;
    }
    function currentTextPage() {
      const b = textBodyEl(); if (!b) return st.page || 1;
      const pages = [...b.querySelectorAll('.ccf-textpage')];
      if (!pages.length) return 1;
      const top = els.body.getBoundingClientRect().top + 28;
      for (const el of pages) {
        if (el.getBoundingClientRect().bottom > top) return Number(el.dataset.page) || 1;
      }
      return Number(pages[pages.length - 1].dataset.page) || pages.length || 1;
    }
    function openTextContent(nm, p, text, encLabel, ov) {
      const bodyText = String(text == null ? '' : text);
      const label = (encLabel != null && String(encLabel).trim()) ? String(encLabel).trim() : '同期テキスト';
      const opts = ov || {};
      const synced = opts.isSyncedText !== undefined ? !!opts.isSyncedText : (label === '同期テキスト' || isDocTextRef(p));
      teardown();
      st.openTok++;
      st.name = String(nm || baseName(p) || '同期テキスト');
      st.path = p || '';
      st.sizes = [];
      st.textMode = true;
      st.isSyncedText = synced;
      textRaw = bodyText;
      textMarks = [];
      textCur = -1;
      const parsedPages = parseTextPages(bodyText);
      st.textPages = parsedPages || [];
      const totalPages = parsedPages ? Math.max(parsedPages.length, ...parsedPages.map(pg => pg.page || 0)) : 1;
      st.textTotalPages = totalPages;
      const initPage = Math.min(totalPages, Math.max(1, Math.round(Number(opts.page) || 1)));
      st.page = initPage;
      els.overlay.hidden = true;
      els.overlay.innerHTML = '';
      els.empty.hidden = true;
      els.pages.hidden = false;
      els.total.textContent = '/ ' + totalPages;
      els.pageNo.max = totalPages;
      els.pageNo.value = initPage;
      els.pages.className = 'ccf-pages single ccf-pages-text';
      els.pages.innerHTML = '<div class="ccf-textdoc" data-n="1"><div class="ccf-texthead">📄 ' + escHtml(st.name) + ' （文字コード: ' + escHtml(label) + ' / ' + bodyText.length.toLocaleString() + '文字）</div><div class="ccf-textbody"></div></div>';
      applyTextSearch(false);
      if (parsedPages && initPage > 1) {
        const expectedTok = st.openTok;
        setTimeout(() => { if (st.textMode && st.openTok === expectedTok) scrollToTextPage(initPage); }, 0);
      } else {
        els.body.scrollTop = 0;
      }
      emitState();
      return true;
    }
    async function renderTextDoc(nm, p, rawBuf, ov) {
      const d = (T && typeof T.loadTextDocAsync === 'function')
        ? await T.loadTextDocAsync(nm, rawBuf)
        : T.loadTextDoc(nm, rawBuf);
      return openTextContent(nm, p, d.text, d.enc, Object.assign({ isSyncedText: false }, ov || {}));
    }
    function textBodyEl() { return els.pages.querySelector('.ccf-textbody'); }
    function applyTextFont() {
      const b = textBodyEl();
      if (b) b.style.fontSize = textFont + 'px';
      if (st.textMode && els.zoom) els.zoom.textContent = Math.round((textFont / 13.5) * 100) + '%';
    }
    /** テキスト資料内の検索：一致箇所を <mark> でハイライトし、前/次へジャンプ */
    function applyTextSearch(jump) {
      const b = textBodyEl(); if (!b) return;
      const qs = els.q.value.trim(), ql = qs.toLowerCase();
      textMarks = []; textCur = -1;
      if (st.textPages && st.textPages.length) {
        b.innerHTML = st.textPages.map(pg =>
          '<div class="ccf-textpage" data-page="' + pg.page + '">' +
            (pg.marker ? '<div class="ccf-textpage-sep">' + escHtml(pg.marker) + '</div>' : '') +
            '<div class="ccf-textpage-body">' + highlightPlainText(pg.body, ql) + '</div>' +
          '</div>'
        ).join('');
        applyTextFont();
        if (!qs) { els.hitinfo.textContent = ''; return; }
        textMarks = [...b.querySelectorAll('mark.ccf-texthit')];
        if (textMarks.length) { textCur = 0; markTextCur(jump !== false); } else els.hitinfo.textContent = '0件';
        return;
      }
      if (!qs) { b.textContent = textRaw; applyTextFont(); els.hitinfo.textContent = ''; return; }
      b.innerHTML = highlightPlainText(textRaw, ql); applyTextFont();
      textMarks = [...b.querySelectorAll('mark.ccf-texthit')];
      if (textMarks.length) { textCur = 0; markTextCur(jump !== false); } else els.hitinfo.textContent = '0件';
    }
    function markTextCur(scroll) {
      textMarks.forEach((m, i) => m.classList.toggle('cur', i === textCur));
      els.hitinfo.textContent = textMarks.length ? (textCur + 1) + ' / ' + textMarks.length + '件' : '0件';
      const m = textMarks[textCur]; if (scroll && m && m.scrollIntoView) m.scrollIntoView({ block: 'center' });
    }
    function stepTextHit(d) { if (!textMarks.length) { applyTextSearch(true); return; } textCur = (textCur + d + textMarks.length) % textMarks.length; markTextCur(true); }
    async function openTextDoc(p, tok, ov) {
      const rawBuf = await readFileBytes(p);
      if (tok != null && tok !== st.openTok) return false;
      const nm = baseName(p);
      const d = (T && typeof T.loadTextDocAsync === 'function')
        ? await T.loadTextDocAsync(nm, rawBuf)
        : T.loadTextDoc(nm, rawBuf);
      if (tok != null && tok !== st.openTok) return false;
      return openTextContent(nm, p, d.text, d.enc, Object.assign({ isSyncedText: false }, ov || {}));
    }
    async function openPath(p, ov) {
      const tok = ++st.openTok;
      if (T.TEXT_DOC_RE.test(String(baseName(p) || p))) { try { return await openTextDoc(p, tok, ov); } catch (e) { console.error('[ccf] テキスト資料を開けません', e); if (!(ov && ov.silentError) && o.onError) o.onError(e); return false; } }
      try {
        const key = pkey(p), mt = mtimeOf(p); let ent = docCache.get(key);
        if (ent && ent.mtime !== mt) {   // ファイルが更新されていたら読み直す（他で使用中なら触らない）
          const others = [...inUse].some(([id, k]) => id !== vid && k === key);
          if (!others) { docCache.delete(key); scanCache.delete(key); if (st.key !== key) { try { ent.doc.destroy(); } catch (e) { /* noop */ } } else { ent.stale = true; } ent = null; }
        }
        if (!ent) {
          const u8 = await readFileBytes(p);
          if (tok !== st.openTok) return false;
          if (!hasPdfHeader(u8) && !(window.CloudSync && isCloudRef(p) && false)) { try { return await renderTextDoc(baseName(p) || 'text.txt', p, u8, ov); } catch (e) { /* PDFとして扱う */ } }
          const doc = await getDoc(o.appDir, u8);
          if (tok !== st.openTok) { try { doc.destroy(); } catch (e) { /* noop */ } return false; }
          ent = { doc, sizes: null, mtime: mt }; docCache.set(key, ent);
        }
        await attach(ent, key, baseName(p), p, ov, tok); return tok === st.openTok;
      } catch (e) { console.error('[ccf] PDF を開けません', e); if (!(ov && ov.silentError) && o.onError) o.onError(e); return false; }
    }
    /** 描画中の処理をすべて止めて、ページ部品を破棄する（キャッシュ中のPDFは destroy しない＝再利用できる） */
    function teardown() {
      st.gen++; if (io) { io.disconnect(); io = null; }
      clearTimeout(visTimer); clearTimeout(visFollowTimer); clearTimeout(scrollTimer); clearTimeout(resizeTimer);
      cancelAllTasks();
      st.pages = []; els.pages.innerHTML = ''; st.textMode = false; st.isSyncedText = false; st.textPages = []; st.textTotalPages = 1; textMarks = []; textCur = -1; els.pages.classList.remove('ccf-pages-text');
      inUse.delete(vid);
      if (st.doc && (!st.key || st.ent.stale)) { try { st.doc.destroy(); } catch (e) { /* noop */ } }
      st.doc = null; st.ent = null; st.key = ''; st.toc = null; renderToc();   // ここでは evict しない（同じPDFを開き直す途中で、解放直後のPDFが捨てられないように。attach 側で使用中にしてから evict する）
    }
    function clear() {
      const prevKey = st.key || (st.path ? pkey(st.path) : '');
      clearTimeout(flashTimer); st.flash = null;
      teardown(); evictKey(prevKey); evict(); st.openTok++; Object.assign(st, { sizes: [], path: '', name: '', page: 1, hist: [], hi: -1 });
      els.empty.hidden = false; els.pages.hidden = true; els.total.textContent = '/ -'; els.pageNo.value = 1; els.pageNo.removeAttribute('max');
      S.hits = []; S.cur = -1; els.hitinfo.textContent = ''; updateNav();
    }
    /** 「✕ 選択解除」：開いているPDFを閉じて初期表示へ戻す（呼び出し側にも知らせる） */
    function close() {
      const had = !!(st.doc || st.textMode || st.path); clear(); if (o.onClose) o.onClose(had); return had;
    }

    /** 全ページの枠を作って並べる（倍率・単ページ/見開きが変わるたびに作り直す）。中身は見える範囲だけ描画する。 */
    function layout(target) {
      if (!st.doc) return;
      st.gen++; if (io) { io.disconnect(); io = null; }
      clearTimeout(visTimer); clearTimeout(visFollowTimer);
      cancelAllTasks();
      els.pages.innerHTML = ''; st.pages = []; els.pages.className = 'ccf-pages ' + st.layout;
      const n = st.doc.numPages; let row = null;
      for (let i = 1; i <= n; i++) {
        if (!row || st.layout === 'single' || row.childElementCount >= 2) { row = document.createElement('div'); row.className = 'ccf-row'; els.pages.appendChild(row); }
        const sz = st.sizes[i - 1], pe = document.createElement('div');
        pe.className = 'ccf-page' + (st.mode === 'rect' ? ' rect-mode' : ''); pe.dataset.n = i;
        pe.style.width = (sz.w * st.zoom) + 'px'; pe.style.height = (sz.h * st.zoom) + 'px'; pe.style.setProperty('--scale-factor', String(st.zoom));
        pe.innerHTML = '<canvas></canvas><div class="textLayer"></div><div class="ccf-rect-layer"></div><div class="ccf-hl-layer"></div>';
        row.appendChild(pe);
        st.pages.push({ n: i, el: pe, cv: pe.children[0], tl: pe.children[1], rl: pe.children[2], hl: pe.children[3], vp: null, items: [], state: 0, task: null, textTask: null, errCount: 0 });
      }
      els.pageNo.value = st.page;
      els.zoom.textContent = Math.round(st.zoom * 100) + '%';
      if (els.layoutBtn) { const sp = st.layout === 'spread'; els.layoutBtn.textContent = sp ? '📄 単ページ表示' : '📖 見開き表示'; els.layoutBtn.setAttribute('aria-pressed', String(sp)); }
      scrollToPage(target || st.page, true);
      const gen = st.gen;
      io = new IntersectionObserver(entries => {
        if (gen !== st.gen) return;
        const br = els.body.getBoundingClientRect();
        const evictMargin = Math.max(1400, Math.round(br.height * 2.2));
        entries.forEach(e => {
          const p = pageOf(Number(e.target.dataset.n)); if (!p) return;
          if (e.isIntersecting) enqueueRender(p, gen);
          else {
            if (p.state === 0) renderQueue = renderQueue.filter(x => x.p !== p);
            const r = p.el.getBoundingClientRect();
            if (br.height > 0 && (r.bottom < br.top - evictMargin || r.top > br.bottom + evictMargin)) unrenderPage(p);
          }
        });
      }, { root: els.body, rootMargin: '450px 0px' });
      st.pages.forEach(p => io.observe(p.el));
      // 別窓最大化・メイン背面化で rAF / IntersectionObserver が間引かれても白紙で止まらないよう setTimeout で可視ページを評価・投入
      scheduleVisibleCheck(0);
      visFollowTimer = setTimeout(() => { if (gen === st.gen) evaluateVisiblePages(0); }, 140);
      emitState(); updateNav();
    }
    const MAX_CONCURRENT_RENDERS = 2;
    function getPageVisibility(p, br) {
      if (!p || !p.el || !br || br.height < 2) {
        return { visible: true, near: true, dist: Math.abs((p ? p.n : 1) - st.page) };
      }
      const r = p.el.getBoundingClientRect();
      const visible = r.bottom >= br.top && r.top <= br.bottom;
      const margin = Math.max(450, Math.round(br.height * 0.75));
      const near = r.bottom >= br.top - margin && r.top <= br.bottom + margin;
      const viewMid = (br.top + br.bottom) * 0.5;
      const pageMid = (r.top + r.bottom) * 0.5;
      return { visible, near, dist: Math.abs(pageMid - viewMid) };
    }
    function enqueueRender(p, gen) {
      if (!p || !st.doc || gen !== st.gen || p.state !== 0) return;
      if (!renderQueue.some(x => x.p === p && x.gen === gen)) renderQueue.push({ p, gen });
      pumpQueue();
    }
    function pumpQueue() {
      const limit = Math.min(MAX_CONCURRENT_RENDERS, st.zoom >= 2.2 ? 1 : MAX_CONCURRENT_RENDERS);
      if (!renderQueue.length) return;
      const br = els.body.getBoundingClientRect();
      const hasViewport = br.height >= 2 && br.width >= 2;
      // 画面外に出た未開始タスクや世代違い・描画済みタスクを即座に間引く
      renderQueue = renderQueue.filter(it => {
        if (!it || it.gen !== st.gen || !st.doc || it.p.state !== 0) return false;
        if (hasViewport && !getPageVisibility(it.p, br).near) return false;
        return true;
      });
      while (activeRenders < limit && renderQueue.length) {
        let bestIdx = 0, bestVisible = false, bestDist = Infinity, bestPageDiff = Infinity;
        for (let i = 0; i < renderQueue.length; i++) {
          const it = renderQueue[i];
          const vis = getPageVisibility(it.p, br);
          const pageDiff = Math.abs(it.p.n - st.page);
          if ((vis.visible && !bestVisible) ||
              (vis.visible === bestVisible && (vis.dist < bestDist || (vis.dist === bestDist && pageDiff < bestPageDiff)))) {
            bestVisible = vis.visible;
            bestDist = vis.dist;
            bestPageDiff = pageDiff;
            bestIdx = i;
          }
        }
        const item = renderQueue.splice(bestIdx, 1)[0];
        if (!item || item.gen !== st.gen || !st.doc || item.p.state !== 0) continue;
        item.p.state = 1;
        activeRenders++;
        runRenderPage(item.p, item.gen).finally(() => {
          activeRenders = Math.max(0, activeRenders - 1);
          if (renderQueue.length) setTimeout(pumpQueue, 0);
        });
      }
    }
    async function runRenderPage(p, gen) {
      if (gen !== st.gen || !st.doc || p.state !== 1) return;
      try {
        const page = await st.doc.getPage(p.n); if (gen !== st.gen || p.state !== 1) return;
        const br = els.body.getBoundingClientRect();
        if (br.height >= 2 && br.width >= 2 && !getPageVisibility(p, br).near) {
          p.state = 0;
          return;
        }
        const vp = page.getViewport({ scale: st.zoom }), dpr = window.devicePixelRatio || 1, cv = p.cv;
        const cScale = clampCanvasScale(vp.width, vp.height, dpr);
        cv.width = Math.max(1, Math.floor(vp.width * cScale));
        cv.height = Math.max(1, Math.floor(vp.height * cScale));
        cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
        p.vp = vp;
        const ctx = cv.getContext('2d');
        if (!ctx) throw new Error('2D canvas context unavailable');
        const task = page.render({ canvasContext: ctx, viewport: vp, transform: cScale !== 1 ? [cScale, 0, 0, cScale, 0, 0] : null });
        p.task = task; activeTasks.add(task);
        try { await task.promise; } finally { activeTasks.delete(task); if (p.task === task) p.task = null; }
        if (gen !== st.gen || p.state !== 1) return;
        const tc = await page.getTextContent(); if (gen !== st.gen || p.state !== 1) return;
        p.items = tc.items; p.tl.innerHTML = '';
        try {
          const tTask = pdfjs.renderTextLayer({ textContentSource: tc, container: p.tl, viewport: vp, textDivs: [] });
          p.textTask = tTask;
          await tTask.promise;
        } catch (e) {
          if (!(e && (e.name === 'AbortException' || /cancel/i.test(String(e.message || e.name))))) console.warn('[ccf] textLayer', e);
        } finally { p.textTask = null; }
        if (gen !== st.gen || p.state !== 1) return;
        p.state = 2; p.errCount = 0; st.ready = gen; drawMarks(p); container.dispatchEvent(new CustomEvent('ccf-page-ready', { detail: { page: p.n } }));
      } catch (e) {
        const cancelled = e && (e.name === 'RenderingCancelledException' || e.name === 'AbortException' || /cancel/i.test(String(e.message || '')));
        if (gen === st.gen && !cancelled) { p.errCount = (p.errCount || 0) + 1; console.warn('[ccf] page', p.n, e); }
        if (gen === st.gen && p.state === 1) {
          if (cancelled || (p.errCount || 0) < 2) { p.state = 0; if (!cancelled) scheduleVisibleCheck(120); }
          else p.state = -1;
        }
      } finally {
        if (gen === st.gen && p.state === 1) p.state = 0;
      }
    }
    /** 画面から遠く離れたページは、メモリ節約のため描画を捨てる（枠の大きさはそのまま） */
    function unrenderPage(p) {
      renderQueue = renderQueue.filter(x => x.p !== p);
      if (!p.state) return;
      cancelPageTasks(p);
      p.state = 0; p.cv.width = 0; p.cv.height = 0; p.tl.innerHTML = ''; p.rl.innerHTML = ''; p.hl.innerHTML = ''; p.items = []; p.vp = null;
    }
    function evaluateVisiblePages(retryCount) {
      if (!st.doc || !st.pages.length) return;
      const gen = st.gen, bodyRect = els.body.getBoundingClientRect();
      if (bodyRect.width < 2 || bodyRect.height < 2) {
        if ((retryCount || 0) < 6) scheduleVisibleCheck(80, (retryCount || 0) + 1);
        return;
      }
      const margin = Math.max(450, Math.round(bodyRect.height * 0.75));
      const evictMargin = Math.max(1400, Math.round(bodyRect.height * 2.2));
      const topLim = bodyRect.top - margin, botLim = bodyRect.bottom + margin;
      const evictTop = bodyRect.top - evictMargin, evictBot = bodyRect.bottom + evictMargin;
      for (const p of st.pages) {
        const r = p.el.getBoundingClientRect();
        if (r.bottom >= topLim && r.top <= botLim) {
          if (p.state === 2 && !p.cv.width) p.state = 0;
          if (p.state === 0) enqueueRender(p, gen);
        } else {
          if (p.state === 0 && renderQueue.length) renderQueue = renderQueue.filter(x => x.p !== p);
          if (r.bottom < evictTop || r.top > evictBot) unrenderPage(p);
        }
      }
      pumpQueue();
    }
    function scheduleVisibleCheck(ms, retryCount) {
      clearTimeout(visTimer);
      visTimer = setTimeout(() => evaluateVisiblePages(retryCount || 0), ms == null ? 0 : ms);
    }
    function scrollToPage(n, skipCheck) {
      const p = pageOf(n); if (!p) return;
      st.lockUntil = Date.now() + 300;
      els.body.scrollTop = p.el.getBoundingClientRect().top - els.body.getBoundingClientRect().top + els.body.scrollTop - 8;
      if (!skipCheck) scheduleVisibleCheck(0);
    }
    function currentPage() {
      const top = els.body.getBoundingClientRect().top + 24;
      for (const p of st.pages) { if (p.el.getBoundingClientRect().bottom > top) return p.n; }
      return st.pages.length || 1;
    }
    els.body.addEventListener('scroll', () => {
      if (st.textMode && st.textPages && st.textPages.length > 1) {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          if (!st.textMode || !st.textPages || !st.textPages.length) return;
          if (Date.now() >= st.lockUntil) {
            const n = currentTextPage();
            if (n !== st.page) { st.page = n; els.pageNo.value = n; emitState(); }
          }
        }, 60);
        return;
      }
      if (!st.doc) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        if (!st.doc) return;
        if (Date.now() >= st.lockUntil) {
          const n = currentPage();
          if (n !== st.page) { st.page = n; els.pageNo.value = n; emitState(); }
        }
        evaluateVisiblePages(0);
      }, 50);
    });
    els.body.addEventListener('wheel', e => {
      if (!e.ctrlKey || (!st.doc && !st.textMode)) return;
      e.preventDefault();
      setZoom((st.textMode ? textFont / 13.5 : st.zoom) + (e.deltaY < 0 ? 0.15 : -0.15));
    }, { passive: false });
    const onViewportResize = () => {
      if (!st.doc || !container.isConnected) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!st.doc) return;
        evaluateVisiblePages(0);
        clearTimeout(visFollowTimer);
        visFollowTimer = setTimeout(() => evaluateVisiblePages(0), 160);
      }, 40);
    };
    window.addEventListener('resize', onViewportResize);
    window.addEventListener('focus', () => { if (st.doc && container.isConnected) scheduleVisibleCheck(30); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && st.doc && container.isConnected) scheduleVisibleCheck(30); });
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(onViewportResize); ro.observe(els.body); }

    const goto = n => {
      if (st.textMode) {
        if (!st.textPages || !st.textPages.length) return;
        const maxP = st.textTotalPages || st.textPages.length || 1;
        n = Math.min(maxP, Math.max(1, Math.round(Number(n) || 1)));
        st.page = n; els.pageNo.value = n; scrollToTextPage(n); emitState();
        return;
      }
      if (!st.doc) return; n = Math.min(st.doc.numPages, Math.max(1, Math.round(Number(n) || 1)));
      st.page = n; els.pageNo.value = n; scrollToPage(n); emitState();
    };
    const render = () => layout(st.page);
    const setZoom = z => {
      if (st.textMode) { textFont = Math.min(32, Math.max(9, Math.round(13.5 * z * 10) / 10)); applyTextFont(); return; }
      if (!st.doc) return;
      if (st.pages.length && Date.now() >= st.lockUntil) { st.page = currentPage(); els.pageNo.value = st.page; }
      const next = Math.min(4, Math.max(0.4, Math.round(z * 100) / 100));
      if (next === st.zoom && st.pages.length) return;
      st.zoom = next;
      layout(st.page);
    };
    function fit() {
      if (st.textMode) { textFont = 13.5; applyTextFont(); return; }
      if (!st.doc || !st.sizes.length || els.body.clientWidth < 40) return;
      const i = Math.max(0, st.page - 1);
      let w = (st.sizes[i] || st.sizes[0]).w;
      if (st.layout === 'spread') {
        const r0 = i - (i % 2), s0 = st.sizes[r0], s1 = st.sizes[r0 + 1];
        w = (s0 ? s0.w : w) + (s1 ? s1.w : (s0 ? s0.w : w));
        setZoom((els.body.clientWidth - 28) / w);
      } else {
        setZoom((els.body.clientWidth - 24) / w);
      }
    }
    function setLayout(m) {
      m = m === 'spread' ? 'spread' : 'single'; if (m === st.layout) return;
      if (st.pages.length && Date.now() >= st.lockUntil) { st.page = currentPage(); els.pageNo.value = st.page; }
      st.layout = m;
      if (o.spread) { try { localStorage.setItem(LAYOUT_KEY, m); } catch (e) { /* noop */ } }
      if (st.doc) layout(st.page); else if (els.layoutBtn) { els.layoutBtn.textContent = m === 'spread' ? '📄 単ページ表示' : '📖 見開き表示'; els.layoutBtn.setAttribute('aria-pressed', String(m === 'spread')); }
    }

    // ---- ページ移動履歴（◀ 戻る / 進む ▶）と、PDF・ページを指定したジャンプ ----
    const here = () => (st.path || st.doc) ? { path: st.path, page: st.page } : null;
    const sameLoc = (a, b) => a && b && pkey(a.path) === pkey(b.path) && a.page === b.page;
    function updateNav() { els.back.disabled = st.hi <= 0; els.fwd.disabled = st.hi < 0 || st.hi >= st.hist.length - 1; }
    function pushHist(dest) {
      const cur = here();
      if (st.hi < 0) { st.hist = cur ? [cur] : []; st.hi = st.hist.length - 1; } else if (cur) st.hist[st.hi] = cur;
      st.hist.length = st.hi + 1;
      if (!sameLoc(st.hist[st.hi], dest)) { st.hist.push(dest); if (st.hist.length > 60) st.hist.shift(); st.hi = st.hist.length - 1; }
      updateNav();
    }
    async function go(dest, opt) {
      clearTimeout(flashTimer);
      if (opt && opt.rect) { st.flash = { path: dest.path, page: dest.page, rect: opt.rect, scrolled: false }; flashTimer = setTimeout(() => { st.flash = null; st.pages.forEach(p => { if (p.state === 2) drawMarks(p); }); }, 4500); }
      if (dest.path && pkey(dest.path) !== pkey(st.path)) { await (o.onOpenRequest ? o.onOpenRequest(dest.path, { page: dest.page }) : openPath(dest.path, { page: dest.page })); }
      else goto(dest.page);
      if (st.flash) st.pages.forEach(p => { if (p.state === 2) drawMarks(p); });
    }
    /** 履歴に残してジャンプする（目次・しおり・逆ジャンプ・ページ番号入力）。dest = { path, page }、opt.rect＝倍率1の座標でその場所を点滅表示 */
    function navigate(path, page, opt) {
      const dest = { path: path || st.path, page: Math.max(1, Math.round(Number(page) || 1)) };
      pushHist(dest); return go(dest, opt);
    }
    function histMove(d) {
      const ni = st.hi + d; if (ni < 0 || ni >= st.hist.length) return;
      const cur = here(); if (cur) st.hist[st.hi] = cur;
      st.hi = ni; updateNav(); go(st.hist[ni]);
    }

    // ---- 目次（アウトライン／大見出し）としおり ----
    async function loadToc() {
      const ent = st.ent; if (!ent || !st.doc) return; const doc = st.doc;
      if (ent.toc) { st.toc = ent.toc; return renderToc(); }
      st.toc = { items: [], kind: '解析中…' }; renderToc();
      try {
        const out = []; await flattenOutline(doc, await doc.getOutline(), 0, out);
        if (out.length) ent.toc = { items: out, kind: 'PDF内蔵のアウトライン' };
        else { const sc = await getScan(st.path, ent); ent.toc = { items: sc ? sc.heads : [], kind: sc && sc.heads.length ? 'ページ内の大見出しを自動抽出' : '見出しが見つかりませんでした' }; }
      } catch (e) { ent.toc = { items: [], kind: '目次を取得できませんでした' }; }
      if (st.ent === ent) { st.toc = ent.toc; renderToc(); }
    }
    function renderToc() {
      const t = st.toc;
      els.tocKind.textContent = t ? '（' + t.kind + '）' : '';
      els.tocList.innerHTML = t && t.items.length ? t.items.map((it, i) => `<button type="button" class="ccf-toc-item" data-toc="${i}" style="padding-left:${6 + it.level * 14}px" title="p.${it.page} へ移動">${esc(it.text)} <span class="ccf-muted">p.${it.page}</span></button>`).join('') : `<div class="ccf-muted">${st.doc ? '（なし）' : 'PDFを開くと表示されます'}</div>`;
      renderBms();
    }
    function renderBms() {
      const k = pkey(st.path), list = bms.map((b, i) => ({ b, i })).sort((a, c) => (pkey(c.b.path) === k) - (pkey(a.b.path) === k));
      els.bmList.innerHTML = list.map(({ b, i }) => `<div class="ccf-bm" data-bm="${i}"><button type="button" class="ccf-toc-item" data-bmgo="${i}" title="${esc(b.name)} p.${b.page} へ移動">🔖 <span class="ccf-muted">${pkey(b.path) === k ? '' : esc(b.name) + ' '}p.${b.page}</span></button><input type="text" class="ccf-bm-label" data-bmname="${i}" value="${esc(b.label)}" aria-label="しおりの名前" placeholder="名前"><button type="button" class="ccf-mini danger" data-bmdel="${i}" title="しおりを削除">🗑</button></div>`).join('') || '<div class="ccf-muted">（なし）「＋ しおり追加」で今のページを登録</div>';
    }
    const saveBms = () => { if (o.onBookmarks) o.onBookmarks(bms.map(b => Object.assign({}, b))); };
    function addBookmark() {
      if (!st.doc) return; if (!st.path) return o.onNotice && o.onNotice('ファイルの場所が分からないPDFには、しおりを付けられません');
      bms.push({ id: 'bm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), path: st.path, name: st.name, page: st.page, label: 'p.' + st.page }); saveBms(); renderBms();
    }

    // ---- 検索（現在のPDF／全PDF横断）と精密ハイライト ----
    /** PDFの本文索引。開いているPDFはそのまま、別のPDFは一時的に開いて読み、すぐ閉じる（キャッシュ枠は使わない） */
    function getScan(path, ent) {
      const key = pkey(path);
      if (!path) { if (!ent) return Promise.resolve(null); if (!ent.scan) ent.scan = scanDoc(ent.doc).catch(() => null); return ent.scan; }
      const mt = mtimeOf(path), c = scanCache.get(key); if (c && c.mtime === mt) return c.promise;
      const promise = (async () => {
        const open = st.ent && pkey(st.path) === key ? st.ent : null; let doc = open ? open.doc : null, tmp = false;
        try { if (!doc) { const u8 = await readFileBytes(path); doc = await getDoc(o.appDir, u8); tmp = true; } return await scanDoc(doc); }
        catch (e) { scanCache.delete(key); return null; }
        finally { if (tmp && doc) { try { doc.destroy(); } catch (e) { /* noop */ } } }
      })();
      scanCache.set(key, { mtime: mt, promise }); if (scanCache.size > 40) scanCache.delete(scanCache.keys().next().value);
      return promise;
    }
    function scheduleSearch(ms) { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, ms == null ? 250 : ms); }
    async function runSearch() {
      if (st.textMode) { S.hits = []; S.cur = -1; return applyTextSearch(true); }
      const gen = ++S.gen, qs = els.q.value.trim().toLowerCase(); S.hits = []; S.cur = -1;
      if (!qs || !st.doc) { els.hitinfo.textContent = ''; return redrawAll(); }
      els.hitinfo.textContent = '検索中…';
      const targets = els.qall.checked ? [...new Map([st.path, ...docList.map(d => d.value)].filter(p => p && !T.TEXT_DOC_RE.test(String(p))).map(p => [pkey(p), p])).values()] : [T.TEXT_DOC_RE.test(String(st.path)) ? '' : st.path];
      for (const path of targets) {
        if (gen !== S.gen) return;
        const sc = await getScan(path, path ? null : st.ent); if (gen !== S.gen) return; if (!sc) continue;
        sc.pages.forEach((pg, pi) => {
          const lo = pg.text.toLowerCase(); let from = 0, at;
          while (S.hits.length < 800 && (at = lo.indexOf(qs, from)) >= 0) {
            from = at + Math.max(1, qs.length); const parts = [], end = at + qs.length;
            for (let k = 0; k < pg.starts.length; k++) {   // 一致範囲が重なる item を拾い、item ごとの開始位置と文字数を求める
              const s0 = pg.starts[k], s1 = k + 1 < pg.starts.length ? pg.starts[k + 1] : pg.text.length; if (s1 <= at) continue; if (s0 >= end) break;
              const a = Math.max(at, s0), b = Math.min(end, s1); if (b > a) parts.push({ item: k, matchIndex: a - s0, matchLength: b - a, strLength: s1 - s0 });
            }
            if (parts.length) S.hits.push({ path, page: pi + 1, parts });
          }
        });
      }
      if (gen !== S.gen) return;
      const k = pkey(st.path); let i = S.hits.findIndex(h => pkey(h.path) === k && h.page >= st.page); if (i < 0) i = S.hits.length ? 0 : -1;
      S.cur = i; updateHitInfo(); redrawAll(); if (i >= 0) focusHit(false);
    }
    function updateHitInfo() { els.hitinfo.textContent = S.hits.length ? (S.cur + 1) + ' / ' + S.hits.length + '件' + (S.hits.length >= 800 ? '（上限）' : '') : (els.q.value.trim() ? '0件' : ''); }
    function stepHit(d) {
      if (st.textMode) return stepTextHit(d);
      if (!S.hits.length) { if (els.q.value.trim()) runSearch(); return; }
      S.cur = (S.cur + d + S.hits.length) % S.hits.length; updateHitInfo(); focusHit(true);
    }
    /** 現在の一致へ移動（別PDFの一致なら、そのPDFを開く）。移動先に着いたらハイライトの位置までスクロールする */
    async function focusHit(commit) {
      const h = S.hits[S.cur]; if (!h) return; st.focusHit = h;
      if (pkey(h.path) !== pkey(st.path)) { if (commit) pushHist({ path: h.path, page: h.page }); await go({ path: h.path, page: h.page }); }
      else { if (commit && h.page !== st.page) pushHist({ path: h.path, page: h.page }); goto(h.page); }
      redrawAll();
    }
    const redrawAll = () => st.pages.forEach(p => { if (p.state === 2) drawMarks(p); });

    /** 抽出済みマーカー・検索ヒット・逆ジャンプの点滅を、そのページの重ね描きレイヤーに描く */
    function drawMarks(p) {
      p.hl.innerHTML = ''; if (!p.vp || !st.doc) return;
      const sc = p.vp.scale, k = pkey(st.path), add = (cls, x, y, w, h, label, title) => {
        const d = document.createElement('div'); d.className = cls; Object.assign(d.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        if (label) { const b = document.createElement('span'); b.className = 'ccf-mark-badge'; b.textContent = label; d.appendChild(b); } if (title) d.title = title; p.hl.appendChild(d); return d;
      };
      if (st.marksOn) marks.forEach(m => { if (m.page === p.n && m.rect && pkey(m.path) === k) add('ccf-mark ' + (m.kind || 'text'), m.rect.x * sc, m.rect.y * sc, m.rect.w * sc, m.rect.h * sc, m.label, '抽出済み：' + (m.label || '')); });
      const cur = S.hits[S.cur]; let focusEl = null;
      S.hits.forEach(h => {
        if (h.page !== p.n || pkey(h.path) !== k) return;
        h.parts.forEach(pt => {   // item.str 全体ではなく、一致した文字部分（matchIndex/strLength・matchLength/strLength）だけを塗る
          const it = p.items[pt.item]; if (!it || !it.transform || !it.width || !pt.strLength) return;
          const tx = mul(p.vp.transform, it.transform), fh = Math.hypot(tx[2], tx[3]), w = it.width * sc;
          const hw = Math.max(2, w * (pt.matchLength / pt.strLength));
          const el = add('ccf-hit' + (h === cur ? ' cur' : ''), tx[4] + w * (pt.matchIndex / pt.strLength), tx[5] - fh * 0.88, hw, fh);
          if (h === cur && !focusEl) focusEl = el;
        });
      });
      if (focusEl && st.focusHit === cur) { st.focusHit = null; scrollInto(focusEl); }
      const f = st.flash; if (f && f.page === p.n && (!f.path || pkey(f.path) === k)) { const el = add('ccf-flash', f.rect.x * sc, f.rect.y * sc, f.rect.w * sc, f.rect.h * sc); if (!f.scrolled) { f.scrolled = true; scrollInto(el); } }
    }
    function scrollInto(el) {
      st.lockUntil = Date.now() + 300;
      const b = els.body.getBoundingClientRect(), r = el.getBoundingClientRect(); els.body.scrollTop += r.top - b.top - Math.min(120, b.height / 3);
    }

    function setMode(m) {
      st.mode = m; clearRects();
      container.querySelectorAll('.ccf-mode').forEach(b => { const on = b.dataset.mode === m; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
      st.pages.forEach(p => p.el.classList.toggle('rect-mode', m === 'rect'));
      els.help.textContent = m === 'rect' ? '四角くドラッグして囲む（Shift+ドラッグで追記）。2段組は段ごとに囲んでください。囲んだ後「🖼️ 画像として保存」も選べます' : '文字をドラッグすると「抽出バッファ」に入ります';
    }
    /** 範囲選択の枠をすべて消す（前に囲んだ範囲が残らないように、操作のたびに呼ぶ） */
    function clearRects() { els.pages.querySelectorAll('.ccf-rect').forEach(b => b.remove()); }
    /** なぞり・範囲選択の表示（枠・文字のハイライト・選択中の座標）をすべて消す */
    function clearSelection() { drag = null; clearRects(); const sel = window.getSelection(); if (sel) sel.removeAllRanges(); }
    const extractOpts = (p) => { const e = extOpts(); return { excludeRuby: e.ruby, twoColumn: e.twoCol, pageH: p && p.vp ? p.vp.height : 0 }; };
    const srcOf = (p, rect) => ({ path: st.path, name: st.name, page: p.n, rect: rect ? { x: rect.x / p.vp.scale, y: rect.y / p.vp.scale, w: rect.w / p.vp.scale, h: rect.h / p.vp.scale } : null });
    let selSrc = null;   // なぞり選択した範囲の抽出元（最初のページ分）
    /** なぞり選択の範囲（Range の矩形群）をページごとの座標に直して、文字を取り出す */
    function textFromSelection(sel) {
      const rects = [...sel.getRangeAt(0).getClientRects()].filter(r => r.width > 1 && r.height > 1), byPage = new Map(); selSrc = null;
      rects.forEach(r => {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, p = st.pages.find(q => { const b = q.el.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
        if (!p || !p.vp || !p.items.length) return;
        const b = p.el.getBoundingClientRect(); if (!byPage.has(p)) byPage.set(p, []);
        byPage.get(p).push({ x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height });
      });
      const ordered = [...byPage].sort((a, b) => a[0].n - b[0].n);
      if (ordered.length) { const [p, rs] = ordered[0], x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y)), x1 = Math.max(...rs.map(r => r.x + r.w)), y1 = Math.max(...rs.map(r => r.y + r.h)); selSrc = srcOf(p, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }); }
      return ordered.map(([p, rs]) => T.extractRectText(p.items, p.vp.transform, p.vp.scale, rs, extractOpts(p))).filter(Boolean).join('\n');
    }
    /** そのページの画面座標の範囲 {x,y,w,h} 内の文字を取り出して onExtract へ渡す（戻り値：取り出した文字列）。page 省略時は現在のページ */
    function extractRect(rect, shift, pageNo) {
      const p = pageOf(pageNo || st.page);
      if (!p || !p.vp || !p.items.length) { if (o.onNotice) o.onNotice('このページにはテキスト情報がありません（スキャン画像のPDFは、文字を直接選択できません）'); return ''; }
      const raw = T.extractRectText(p.items, p.vp.transform, p.vp.scale, rect, Object.assign(extractOpts(p), { noMargin: false }));
      if (!raw) { if (o.onNotice) o.onNotice('四角の中に文字がありませんでした'); return ''; }
      o.onExtract(raw, { shift: !!shift, page: p.n, via: 'rect', src: srcOf(p, rect) }); return raw;
    }
    /** 囲んだ範囲を Canvas から PNG に切り抜く（文字が無い絵・地図・挿絵向け） */
    function cropImage(rect, pageNo) {
      const p = pageOf(pageNo); if (!p || !p.vp || p.state !== 2 || !p.cv.width) { if (o.onNotice) o.onNotice('ページの描画が終わってから実行してください'); return null; }
      const kx = p.cv.width / p.vp.width, ky = p.cv.height / p.vp.height;
      const sx = Math.max(0, Math.floor(rect.x * kx)), sy = Math.max(0, Math.floor(rect.y * ky)), sw = Math.min(p.cv.width - sx, Math.floor(rect.w * kx)), sh = Math.min(p.cv.height - sy, Math.floor(rect.h * ky));
      if (sw < 2 || sh < 2) return null;
      const c = document.createElement('canvas'); c.width = sw; c.height = sh; c.getContext('2d').drawImage(p.cv, sx, sy, sw, sh, 0, 0, sw, sh);
      const img = { dataUrl: c.toDataURL('image/png'), name: st.name, page: p.n, path: st.path, rect: srcOf(p, rect).rect };
      if (o.onSaveImage) o.onSaveImage(img); return img;
    }

    // ---- 操作の配線 ----
    container.addEventListener('click', e => {
      const v = e.target.closest('[data-v]'); if (v) { const k = v.dataset.v;
        if (k === 'open') pick(); else if (k === 'close') close();
        else if (k === 'prev' || k === 'next') {
          if (st.textMode && st.textPages && st.textPages.length) {
            const idx = st.textPages.findIndex(pg => pg.page === st.page);
            if (idx >= 0) {
              const ni = Math.min(st.textPages.length - 1, Math.max(0, idx + (k === 'next' ? 1 : -1)));
              goto(st.textPages[ni].page);
            } else {
              goto(st.page + (k === 'next' ? 1 : -1));
            }
          } else {
            goto(st.page + (k === 'next' ? 1 : -1));
          }
        }
        else if (k === 'zoom-in') setZoom(st.textMode ? textFont / 13.5 + 0.2 : st.zoom + 0.2); else if (k === 'zoom-out') setZoom(st.textMode ? textFont / 13.5 - 0.2 : st.zoom - 0.2); else if (k === 'fit') fit();
        else if (k === 'layout') setLayout(st.layout === 'spread' ? 'single' : 'spread');
        else if (k === 'hback') histMove(-1); else if (k === 'hfwd') histMove(1);
        else if (k === 'toc') { els.toc.hidden = !els.toc.hidden; els.tocBtn.setAttribute('aria-pressed', String(!els.toc.hidden)); if (!els.toc.hidden && st.doc && !st.toc) loadToc(); }
        else if (k === 'bm-add') addBookmark();
        else if (k === 's-prev') stepHit(-1); else if (k === 's-next') stepHit(1);
        else if (k === 'marks') setMarksOn(!st.marksOn);
        else if (k === 'popout' && o.popout) o.popout.onClick(); return; }
      const ti = e.target.closest('[data-toc]'); if (ti && st.toc) { const it = st.toc.items[Number(ti.dataset.toc)]; if (it) navigate(st.path, it.page); return; }
      const bg = e.target.closest('[data-bmgo]'); if (bg) { const b = bms[Number(bg.dataset.bmgo)]; if (b) navigate(b.path, b.page); return; }
      const bd = e.target.closest('[data-bmdel]'); if (bd) { bms.splice(Number(bd.dataset.bmdel), 1); saveBms(); renderBms(); return; }
      const cb = e.target.closest('[data-crop]'); if (cb) { e.preventDefault(); const box = cb.closest('.ccf-rect'); if (box) { const r = { x: parseFloat(box.style.left) || 0, y: parseFloat(box.style.top) || 0, w: parseFloat(box.style.width) || 0, h: parseFloat(box.style.height) || 0 }; if (cropImage(r, Number(box.dataset.page))) { cb.textContent = '✅ 保存しました'; cb.disabled = true; } } return; }
      const m = e.target.closest('.ccf-mode'); if (m) setMode(m.dataset.mode);
    });
    function setMarksOn(on) {
      st.marksOn = !!on; els.marksBtn.setAttribute('aria-pressed', String(st.marksOn)); els.marksBtn.classList.toggle('active', st.marksOn);
      try { localStorage.setItem(MARK_KEY, st.marksOn ? '1' : '0'); } catch (e) { /* noop */ } redrawAll();
    }
    els.pageNo.addEventListener('change', () => {
      if (st.textMode && st.textPages && st.textPages.length) {
        navigate(st.path, Math.min(st.textTotalPages || st.textPages.length, Math.max(1, Math.round(Number(els.pageNo.value) || 1))));
      } else if (st.doc) {
        navigate(st.path, Math.min(st.doc.numPages, Math.max(1, Math.round(Number(els.pageNo.value) || 1))));
      }
    });
    els.q.addEventListener('input', () => scheduleSearch());
    els.q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); } });
    els.qall.addEventListener('change', () => scheduleSearch(0));
    els.bmList.addEventListener('change', e => { const t = e.target.closest('[data-bmname]'); if (t && bms[Number(t.dataset.bmname)]) { bms[Number(t.dataset.bmname)].label = t.value; saveBms(); } });
    els.docsel.addEventListener('change', () => { const val = els.docsel.value; if (val && o.docSelect && o.onPickDoc) o.onPickDoc(val); else syncDocSel(); });
    async function pick() {
      if (window.require) {
        const r = await require('electron').ipcRenderer.invoke('ccf:pick', { title: 'PDF / 資料を開く', properties: ['openFile'], filters: [{ name: 'PDF / 資料', extensions: ['pdf', 'txt', 'html', 'htm', 'md', 'markdown', 'docx'] }] });
        if (r && r[0]) (o.onOpenRequest || openPath)(r[0]);
        return;
      }
      if (!window.WebBridge) return;
      const files = await WebBridge.pickFiles({ accept: '.pdf,.txt,.html,.htm,.md,.markdown,.docx', multiple: false });
      const f = files && files[0]; if (!f) return;
      const ref = await WebBridge.saveAssetFile(f);
      if (ref) await (o.onOpenRequest || openPath)(ref);
    }
    let drag = null;   // { p: ページ, start: {x,y}, box: 枠の要素 }
    els.pages.addEventListener('mousedown', e => {
      const rl = e.target.closest('.ccf-rect-layer'); if (!rl || st.mode !== 'rect' || e.button !== 0 || e.target.closest('.ccf-rect-bar')) return; e.preventDefault();
      const pe = rl.parentElement, p = pageOf(Number(pe.dataset.n)); if (!p) return;
      if (!e.shiftKey) clearRects();   // 追記（Shift）でなければ、前に囲んだ枠は消してから新しく囲む
      const r = pe.getBoundingClientRect(), box = document.createElement('div'); box.className = 'ccf-rect'; box.dataset.page = p.n; rl.appendChild(box);
      drag = { p, start: { x: e.clientX - r.left, y: e.clientY - r.top }, box };
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return; const r = drag.p.el.getBoundingClientRect(), x = Math.min(Math.max(0, e.clientX - r.left), r.width), y = Math.min(Math.max(0, e.clientY - r.top), r.height), s0 = drag.start;
      Object.assign(drag.box.style, { left: Math.min(s0.x, x) + 'px', top: Math.min(s0.y, y) + 'px', width: Math.abs(x - s0.x) + 'px', height: Math.abs(y - s0.y) + 'px' });
    });
    window.addEventListener('mouseup', e => {
      if (drag) {
        const d = drag, box = d.box; drag = null;
        const rect = { x: parseFloat(box.style.left) || 0, y: parseFloat(box.style.top) || 0, w: parseFloat(box.style.width) || 0, h: parseFloat(box.style.height) || 0 };
        if (rect.w < 4 || rect.h < 4) box.remove();
        else {
          box.classList.add('done');
          const bar = document.createElement('div'); bar.className = 'ccf-rect-bar'; bar.innerHTML = '<button type="button" class="ccf-btn accent" data-crop="1" title="囲んだ範囲（マップ・挿絵など）をPNG画像として「📌 登録素材」へ追加します">🖼️ 選択範囲を画像として保存</button>'; box.appendChild(bar);
          extractRect(rect, e.shiftKey, d.p.n);
        }
        return;
      }
      if (st.mode !== 'text') return;
      const sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const tlOf = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); const t = el && el.closest && el.closest('.textLayer, .ccf-textdoc'); return t && els.pages.contains(t) ? t : null; };
      const tl = tlOf(sel.anchorNode) || tlOf(sel.focusNode); if (!tl) return;
      if (tl.classList.contains('ccf-textdoc')) {
        const raw = sel.toString();
        if (raw.trim()) {
          const pgNodeOf = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return el && el.closest ? el.closest('.ccf-textpage') : null; };
          const pgEl = pgNodeOf(sel.anchorNode) || pgNodeOf(sel.focusNode);
          const pgNo = (pgEl && pgEl.dataset && Number(pgEl.dataset.page)) || st.page || 1;
          o.onExtract(raw, { shift: e.shiftKey, page: pgNo, via: 'text', src: { path: st.path, name: st.name, page: pgNo, rect: null } });
        }
        return;
      }
      // 座標ベースの高精度抽出：選択範囲の矩形（行ごと）をページ座標へ直し、ルビ除外・2段組整列つきで取り出す。取れなければ従来の選択文字列
      let raw = ''; selSrc = null; try { raw = textFromSelection(sel); } catch (er) { console.warn('[ccf] 座標抽出に失敗', er); }
      if (!raw || !raw.trim()) raw = sel.toString();
      if (raw && raw.trim()) { const pn = Number(tl.parentElement.dataset.n) || st.page; o.onExtract(raw, { shift: e.shiftKey, page: pn, via: 'text', src: selSrc || { path: st.path, name: st.name, page: pn, rect: null } }); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.mode === 'rect' && container.isConnected) clearRects(); });
    // PDF のドラッグ＆ドロップ（ライブラリのツリーからのドラッグも受ける）
    container.addEventListener('dragover', e => { const t = [...(e.dataTransfer && e.dataTransfer.types || [])]; if (t.includes('Files') || t.includes('text/ccf-path')) { e.preventDefault(); container.classList.add('drop'); } });
    container.addEventListener('dragleave', e => { if (!container.contains(e.relatedTarget)) container.classList.remove('drop'); });
    container.addEventListener('drop', async e => {
      container.classList.remove('drop'); const dt = e.dataTransfer; if (!dt) return;
      const open = o.onOpenRequest || openPath, lp = dt.getData('text/ccf-path');
      if (lp && /\.(?:pdf|txt|html?|md|markdown|docx)$/i.test(lp)) { e.preventDefault(); e.stopPropagation(); return void open(lp); }
      const f = [...(dt.files || [])].find(x => /\.(?:pdf|txt|html?|md|markdown|docx)$/i.test(x.name)); if (!f) return; e.preventDefault(); e.stopPropagation();
      let p = '';
      if (typeof require === 'function') { try { p = require('electron').webUtils.getPathForFile(f) || ''; } catch (er) { p = f.path || ''; } }
      if (p) open(p);
      else if (window.WebBridge && WebBridge.saveAssetFile) {
        const ref = await WebBridge.saveAssetFile(f);
        if (ref) await open(ref);
      } else if (/\.(?:pdf|txt|html?|md|markdown|docx)$/i.test(f.name)) {
        openData(new Uint8Array(await f.arrayBuffer()), f.name, '');
      }
    });
    setMode('text'); els.marksBtn.classList.toggle('active', st.marksOn); els.marksBtn.setAttribute('aria-pressed', String(st.marksOn));
    if (els.layoutBtn) { const sp = st.layout === 'spread'; els.layoutBtn.textContent = sp ? '📄 単ページ表示' : '📖 見開き表示'; els.layoutBtn.setAttribute('aria-pressed', String(sp)); }
    if (o.getBookmarks) bms = (o.getBookmarks() || []).map(b => Object.assign({}, b));
    renderToc();

    return {
      el: container, els, state: st, openPath, openData, openTextContent, clear, close, evictPaths, evictKey, render, goto, setZoom, fit, setMode, setLayout, clearRects, clearSelection, extractRect, cropImage, navigate,
      setDocs(list) { docList = list || []; els.docsel.innerHTML = (docList.length ? `<option value="">📄 表示資料を切り替え (${docList.length}件)…</option>` : '<option value="">📄 登録資料なし（開く/D&amp;D）</option>') + docList.map(d => `<option value="${esc(d.value)}">${esc(d.label)}</option>`).join(''); els.docsel.style.display = ''; syncDocSel(); },
      /** しおり一覧を差し替える（呼び出し側のデータが正） */
      setBookmarks(list) { bms = (list || []).map(b => Object.assign({}, b)); renderBms(); },
      /** 抽出済みマーカー [{ kind:'text'|'npc', label, path, page, rect:{x,y,w,h}（倍率1） }] を差し替える */
      setMarks(list) { marks = list || []; redrawAll(); },
      setMarksOn,
      setOverlay(html) { if (html == null) { els.overlay.hidden = true; els.overlay.innerHTML = ''; els.empty.hidden = !!(st.doc || st.textMode); } else { els.overlay.innerHTML = html; els.overlay.hidden = false; els.empty.hidden = true; } }
    };
  }
  window.CCFPdfViewer = { create, loadPdfjs, loadPdfjsAsync, getDoc, readFileBytes, baseName, extOpts, setExtOpts, cache: { docCache, scanCache, inUse, inUseKeys, evictKey, evictPaths, max: CACHE_MAX } };
})();
