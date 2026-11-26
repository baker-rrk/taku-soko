/* ccf_zip_import.js — ココフォリア本家のルームZIPを「逆輸入」して部屋データにする ＋ 欠落BGM／画像のローカル自動再リンク
 *  ・ZIP を D&D（ccf_dnd.js が __data.json を持つ ZIP を見分けて渡す）か「📥 ココフォリアZIPを取り込む」で読み込む。
 *  ・__data.json の room / characters / scenes / items を、新しい「部屋」（NPC・シーン・盤面オブジェクト・共通の背景前景）として登録する。
 *  ・ZIP に実体が無い（欠落している）BGM・画像は、JSON 内の曲名・ファイル名で「📌 登録素材」と「マイライブラリ」をディープサーチして再リンクする。
 *    同名ファイルが複数見つかったときは、試聴／プレビュー付きの選択ダイアログで選ばせる。 */
(function () {
  'use strict';
  const isElec = typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON;
  const CCF = window.CCF, M = window.CCFModel, P = window.CCFPkg, { esc, say, S } = CCF;
  const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i, IMG_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
  const isAssetRef = p => !!(window.WebBridge && WebBridge.isAssetRef(p));
  const baseName = p => isAssetRef(p) ? WebBridge.assetBasename(p) : ((isElec && path) ? path.basename(p) : String(p || '').split(/[\\/]/).pop());
  const fileUrl = p => {
    if (!p) return '';
    if (isAssetRef(p)) return WebBridge.peekAssetUrl(p) || '';
    if (!isElec) return /^(?:data:|blob:|https?:)/i.test(p) ? p : '';
    try { return require('url').pathToFileURL(p).href; } catch (e) { return ''; }
  };
  const bytesToUtf8 = b => (typeof Buffer !== 'undefined' && Buffer.isBuffer(b)) ? b.toString('utf8') : new TextDecoder('utf-8').decode(b);
  const bytesToBase64 = b => {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(b)) return b.toString('base64');
    const u8 = b instanceof Uint8Array ? b : new Uint8Array(b || []);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  async function isRoomZip(p) { try { return !!CCF.zip.roomDataEntry(await CCF.zip.open(p)); } catch (e) { return false; } }

  // ---------- ローカル素材のディープサーチ ----------
  /** 📌 登録素材（現在シナリオ）＋ シナリオフォルダ（深さ3・上限500）＋ 共通素材キャッシュから、種類(kind)に合うファイル一覧を即座に構築する */
  function buildIndex(kind) {
    const re = kind === 'audio' ? AUDIO_RE : IMG_RE, out = [], seen = new Set();
    const push = (c) => { const k = (c.path || '').toLowerCase(); if (!k || seen.has(k)) return; seen.add(k); out.push(c); };
    const curKey = S.key != null ? String(S.key) : '';
    const scList = typeof CCF.scenarioList === 'function' ? (CCF.scenarioList() || []) : [];
    const sc = scList.find(x => x && String(x.id) === curKey) || null;
    const scTitle = (sc && sc.title) || '';
    // 1. 現在選択中シナリオの登録素材＋シナリオ sourcePath フォルダ
    if (CCF.assets && CCF.assets.getUnifiedItems && curKey) {
      let items = []; try { items = CCF.assets.getUnifiedItems(curKey) || []; } catch (e) { items = []; }
      items.forEach(it => {
        if (!it || (kind === 'audio' ? it.type !== 'audio' : it.type !== 'image')) return;
        if (it.path && re.test(baseName(it.path))) {
          const exists = isAssetRef(it.path) ? (!window.WebBridge || WebBridge.hasAssetSync(it.path)) : (isElec && fs && fs.existsSync(it.path));
          if (exists) push({ assetUid: it.uid || '', path: it.path, name: it.name || baseName(it.path), source: '📌 登録素材' + (scTitle ? '（' + scTitle + '）' : '') });
        }
        else if (it.dataUrl && kind === 'image') push({ assetUid: it.uid || '', path: 'asset:' + curKey + ':' + it.uid, name: it.name || it.origName || 'image', dataUrl: it.dataUrl, source: '📌 登録素材' + (scTitle ? '（' + scTitle + '）' : '') });
      });
    }
    if (isElec && fs && path && sc && sc.sourcePath) {
      let st = null; try { st = fs.statSync(sc.sourcePath); } catch (e) { st = null; }
      if (st && st.isDirectory()) {
        let n = 0;
        (function walk(dir, d) {
          if (d > 3 || n >= 500) return; let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
          for (const e of es) {
            if (n >= 500) break;
            if (e.name.startsWith('.') || e.name === 'node_modules') continue; const full = path.join(dir, e.name);
            if (e.isDirectory()) { if (!M.isOldFolderName(e.name)) walk(full, d + 1); }
            else if (re.test(e.name)) { n++; push({ path: full, name: e.name, source: '📁 シナリオ（' + path.basename(path.dirname(full)) + '）' }); }
          }
        })(sc.sourcePath, 0);
      }
    }
    // 2. 共通素材（スキャン・キャッシュ済みのマイライブラリ一覧をそのまま利用）
    if (typeof window !== 'undefined' && window.CommonAssets && typeof window.CommonAssets.getAll === 'function') {
      let common = []; try { common = window.CommonAssets.getAll() || []; } catch (e) { common = []; }
      common.forEach(it => {
        if (!it || (kind === 'audio' ? it.type !== 'audio' : it.type !== 'image')) return;
        const nm = it.origName || it.name || '';
        if (it.path && (re.test(baseName(it.path)) || re.test(nm))) {
          push({ path: it.path, name: it.origName || it.name || baseName(it.path), source: '📚 マイライブラリ' + (it.category ? '（' + it.category + '）' : '') });
        } else if (it.dataUrl && kind === 'image') {
          push({ path: 'common:' + (it.uid || it.rawId || out.length), name: it.name || it.origName || 'image', dataUrl: it.dataUrl, source: '📚 共通素材' + (it.category ? '（' + it.category + '）' : '') });
        }
      });
    }
    return out;
  }

  // ---------- 複数候補の選択ダイアログ（試聴／プレビュー付き） ----------
  function askChoice({ kind, name, cands }) {
    return new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'ccf-overlay'; ov.id = 'ccfZipPick'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.style.zIndex = 9500;
      let audio = null, done = false;
      const stop = () => { if (audio) { try { audio.pause(); } catch (e) { /* noop */ } audio = null; } ov.querySelectorAll('[data-pk="play"]').forEach(b => { b.textContent = '▶ 試聴'; }); };
      const srcOf = c => c.dataUrl || fileUrl(c.path);
      const finish = v => { if (done) return; done = true; stop(); document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(null); } };
      ov.innerHTML = `<div class="ccf-modal narrow"><div class="ccf-modal-head"><b>⚠️ 複数の同名ファイルが見つかりました。どちらを使用しますか？</b></div>
        <div class="ccf-modal-body single"><div>${kind === 'audio' ? '🎵 曲名' : '🖼️ 画像名'}：<b>${esc(name)}</b>（${cands.length}件）</div>
        ${cands.map((c, i) => `<label class="ccf-pick-row"><input type="radio" name="ccfPick" value="${i}"${i === 0 ? ' checked' : ''}>
          ${kind === 'image' ? `<img class="ccf-pick-img" src="${esc(srcOf(c))}" alt="">` : `<button type="button" class="ccf-btn" data-pk="play" data-i="${i}">▶ 試聴</button>`}
          <span class="ccf-pick-info"><b>${esc(c.name)}</b><span class="ccf-muted">${esc(c.source || '')}</span><span class="ccf-pick-path">${esc(c.dataUrl ? '（アプリ内に保存された画像）' : c.path)}</span></span></label>`).join('')}</div>
        <div class="ccf-modal-foot"><span class="ccf-spacer"></span><button type="button" class="ccf-btn primary" data-pk="ok">この素材を使う</button><button type="button" class="ccf-btn" data-pk="skip">リンクしない</button></div></div>`;
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-pk]'); if (!b) return; const k = b.dataset.pk;
        if (k === 'ok') { const r = ov.querySelector('input[name="ccfPick"]:checked'); return finish(r ? cands[+r.value] : null); }
        if (k === 'skip') return finish(null);
        if (k === 'play') {
          e.preventDefault(); const was = b.textContent.includes('■'); stop(); if (was) return;
          try { audio = new Audio(srcOf(cands[+b.dataset.i])); audio.volume = 0.6; audio.play().catch(() => stop()); audio.onended = stop; b.textContent = '■ 停止'; } catch (er) { stop(); }
        }
      });
      document.body.appendChild(ov); document.addEventListener('keydown', onKey, true);
    });
  }

  // ---------- 取り込み本体 ----------
  const ASSET_TIMEOUT_MS = 8000;
  const withTimeout = (promise, ms = ASSET_TIMEOUT_MS, label = '') => {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout' + (label ? ': ' + label : ''))), ms);
      })
    ]).finally(() => { if (timer) clearTimeout(timer); });
  };
  const MAX_DIRECT_IMG_BYTES = 1.5 * 1024 * 1024;
  const ALPHA_MIME_RE = /^image\/(?:png|webp|gif|svg\+xml)$/i;
  const STATIC_SHRINK_ALPHA_RE = /^image\/(?:png|webp)$/i;
  const blobToDataUrl = blob => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ''));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
  const typedDataUrl = async (buf, mime, name) => {
    const m = P.mimeOf(buf, mime, name), b64 = () => 'data:' + m + ';base64,' + bytesToBase64(buf);
    const len = buf ? (buf.byteLength || buf.length || 0) : 0;
    // 透過を持ち得る形式（PNG/WebP/GIF/SVG）は白背景JPEGへ絶対に再変換しない
    if (ALPHA_MIME_RE.test(m)) {
      if (!STATIC_SHRINK_ALPHA_RE.test(m) || len <= MAX_DIRECT_IMG_BYTES || typeof document === 'undefined' || typeof Blob === 'undefined') {
        return b64();
      }
      // 1.5MB超の巨大静止透過画像のみ、透過を維持した WebP / PNG で縮小
      try {
        const srcBlob = new Blob([buf], { type: m });
        const objUrl = URL.createObjectURL(srcBlob);
        try {
          const img = await withTimeout(new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = objUrl;
          }), ASSET_TIMEOUT_MS, name || 'image');
          const w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
          if (w > 0 && h > 0) {
            const scale = Math.min(1, 1920 / Math.max(w, h));
            const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
            const ctx = cv.getContext('2d', { alpha: true });
            ctx.clearRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            let outBlob = await new Promise(r => cv.toBlob(r, 'image/webp', 0.88));
            if (!outBlob) outBlob = await new Promise(r => cv.toBlob(r, 'image/png'));
            if (outBlob && outBlob.size > 0 && outBlob.size < len) {
              return await blobToDataUrl(outBlob);
            }
          }
        } finally {
          URL.revokeObjectURL(objUrl);
        }
      } catch (_) { /* 縮小失敗時は元バイナリをそのまま使用 */ }
      return b64();
    }
    if (len > MAX_DIRECT_IMG_BYTES && typeof document !== 'undefined' && typeof Blob !== 'undefined' && /^image\/(?:jpeg|bmp)$/i.test(m)) {
      try {
        const srcBlob = new Blob([buf], { type: m });
        const objUrl = URL.createObjectURL(srcBlob);
        try {
          const img = await withTimeout(new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = objUrl;
          }), ASSET_TIMEOUT_MS, name || 'image');
          const w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
          if (w > 0 && h > 0) {
            const scale = Math.min(1, 1920 / Math.max(w, h));
            const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
            const ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0, cw, ch);
            const outBlob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.86));
            if (outBlob && outBlob.size > 0 && outBlob.size < len) {
              return await blobToDataUrl(outBlob);
            }
          }
        } finally {
          URL.revokeObjectURL(objUrl);
        }
      } catch (_) { /* noop */ }
    }
    return b64();
  };

  // ---------- 画像の知覚特徴量（再エンコード時のフォールバック類似一致用） ----------
  async function loadImageElementFromSource(srcOrBlob, timeoutMs) {
    if (typeof document === 'undefined') return null;
    let url = '', revoke = false;
    if (typeof Blob !== 'undefined' && srcOrBlob instanceof Blob) {
      url = URL.createObjectURL(srcOrBlob);
      revoke = true;
    } else if (typeof srcOrBlob === 'string') {
      const s = srcOrBlob.trim();
      if (!s) return null;
      if (s.startsWith('@img:') && typeof window.getLocalImageBlobUrl === 'function') {
        const h = s.slice(5);
        url = window.getLocalImageBlobUrl(h);
        if (!url && typeof window.ensureLocalImageByHash === 'function') {
          try { await window.ensureLocalImageByHash(h); url = window.getLocalImageBlobUrl(h); } catch (_) { }
        }
      } else if (/^(?:data:image\/|blob:|file:|https?:|zipview:)/i.test(s)) {
        url = s;
      } else {
        url = fileUrl(s);
      }
    }
    if (!url) return null;
    try {
      return await withTimeout(new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = url;
      }), Number(timeoutMs) || 3000, 'perceptual');
    } catch (_) {
      return null;
    } finally {
      if (revoke) try { URL.revokeObjectURL(url); } catch (_) { }
    }
  }
  async function computeImgFeature(srcOrBlob, timeoutMs) {
    if (typeof document === 'undefined') return null;
    const img = await loadImageElementFromSource(srcOrBlob, timeoutMs);
    if (!img) return null;
    const w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
    if (!w || !h) return null;
    try {
      const cv = document.createElement('canvas'); cv.width = 9; cv.height = 8;
      const ctx = cv.getContext('2d', { alpha: true, willReadFrequently: true });
      ctx.clearRect(0, 0, 9, 8);
      ctx.drawImage(img, 0, 0, 9, 8);
      const data = ctx.getImageData(0, 0, 9, 8).data;
      const lum9x8 = new Uint8Array(72);
      const gray8x8 = new Uint8Array(64);
      const alpha8x8 = new Uint8Array(64);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 9; x++) {
          const i = (y * 9 + x) * 4;
          const a = data[i + 3] / 255;
          const g = Math.round((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 128 * (1 - a));
          lum9x8[y * 9 + x] = g;
          if (x < 8) {
            gray8x8[y * 8 + x] = g;
            alpha8x8[y * 8 + x] = data[i + 3];
          }
        }
      }
      const dhash = new Uint8Array(64);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          dhash[y * 8 + x] = lum9x8[y * 9 + x] < lum9x8[y * 9 + x + 1] ? 1 : 0;
        }
      }
      return { w, h, aspect: w / h, gray: gray8x8, alpha: alpha8x8, dhash };
    } catch (_) {
      return null;
    }
  }
  function compareImgFeature(a, b) {
    if (!a || !b) return null;
    const maxAsp = Math.max(a.aspect, b.aspect);
    if (!maxAsp || Math.abs(a.aspect - b.aspect) / maxAsp > 0.03) return null;
    let sumG = 0, sumA = 0, ham = 0;
    for (let i = 0; i < 64; i++) {
      sumG += Math.abs(a.gray[i] - b.gray[i]);
      sumA += Math.abs(a.alpha[i] - b.alpha[i]);
      if (a.dhash[i] !== b.dhash[i]) ham++;
    }
    const mad = sumG / 64;
    const madA = sumA / 64;
    if (mad <= 8.5 && madA <= 20 && ham <= 8) return { mad, ham, score: mad + ham * 0.5 };
    return null;
  }

  async function importRoomZip(zipPath, opts) {
    opts = opts || {};
    if (!S.ready) { say('⚠️ 先に「🎲 ココフォリア」タブを開いてから、ZIPを取り込んでください'); return null; }
    const rawName = typeof zipPath === 'string' ? baseName(zipPath) : ((zipPath && zipPath.name) || 'room.zip');
    const base = rawName.replace(/\.zip$/i, '') || 'room';
    say('📥 ココフォリアのルームZIPを読み込んでいます…');
    const z = await CCF.zip.open(zipPath), dataName = CCF.zip.roomDataEntry(z);
    if (!dataName) throw new Error('__data.json が見つかりません（ココフォリアのルームZIPではありません）');
    const { buf: jbuf } = await CCF.zip.readBuffer(CCF.zip.url(z.id, dataName));
    let json; try { json = JSON.parse(bytesToUtf8(jbuf).replace(/^\uFEFF/, '')); } catch (e) { throw new Error('__data.json を読み取れません：' + e.message); }
    const pkg = P.parsePackage(json), names = z.entries.filter(e => !e.dir).map(e => e.name);
    const rep = { linked: [], autoLinked: [], unresolved: [], extracted: 0, images: 0 };
    const impDir = (isElec && path && DATA_ROOT) ? path.join(DATA_ROOT, 'ccfolia', 'imports', CCF.ccfExport.safeName(base) + '_' + z.id.slice(0, 8)) : '';
    const idx = { audio: null, image: null }, pickCache = new Map(), imgCache = new Map(), refResolvedCache = new Map(), shaResolvedCache = new Map(), audCache = new Map();
    const room = pkg.room || {}, roomName = String(room.name || base).trim() || base;
    const entryOf = ref => { const e = P.findZipEntry(ref, names); return e ? { entry: e, url: CCF.zip.url(z.id, e) } : null; };
    const bufShaCache = new WeakMap();
    async function computeBufSha(bytes) {
      if (!bytes || !bytes.length) return '';
      if (typeof bytes === 'object' && bufShaCache.has(bytes)) return bufShaCache.get(bytes);
      let s = '';
      try {
        if (typeof window !== 'undefined' && window.ImageSha && typeof window.ImageSha.ofBytes === 'function') {
          s = String(await window.ImageSha.ofBytes(bytes) || '').toLowerCase();
        }
      } catch (_) { s = ''; }
      if (!s) {
        try { s = String(await P.sha256HexAsync(bytes) || '').toLowerCase(); } catch (_) { s = ''; }
      }
      if (s && typeof bytes === 'object') bufShaCache.set(bytes, s);
      return s;
    }

    // --- 既存の登録素材・共通素材の SHA-256 マップ構築（自動リンク用） ---
    const shaMap = new Map();       // sha256(lower) -> { item, sourceLabel }
    const regImgItems = [];         // 現在シナリオの登録画像（再エンコード時の類似一致用）
    const curKey = S.key != null ? String(S.key) : '';
    const regPool = [];
    if (CCF.assets && typeof CCF.assets.getUnifiedItems === 'function' && curKey) {
      try {
        (CCF.assets.getUnifiedItems(curKey) || []).forEach(it => {
          if (it && it.type === 'image') {
            regPool.push({ item: it, sourceLabel: '📌 登録素材' });
            regImgItems.push(it);
          }
        });
      } catch (_) { }
    }
    const regTargets = regPool.slice(0, 150);
    if (typeof window !== 'undefined' && window.ImageSha && typeof window.ImageSha.ofItem === 'function' && regTargets.length) {
      const BATCH = 8;
      for (let i = 0; i < regTargets.length; i += BATCH) {
        const chunk = regTargets.slice(i, i + BATCH);
        await Promise.all(chunk.map(async entry => {
          try {
            const h = String(await window.ImageSha.ofItem(entry.item) || '').toLowerCase();
            if (h && !shaMap.has(h)) shaMap.set(h, entry);
          } catch (_) { }
        }));
      }
    }
    const commonMemByName = new Map(); // 共通ギャラリーのメモリ内インデックス（ディスクI/Oゼロ照合用）
    if (typeof window !== 'undefined' && window.CommonAssets && typeof window.CommonAssets.getAll === 'function') {
      try {
        (window.CommonAssets.getAll() || []).forEach(it => {
          if (!it || it.type !== 'image') return;
          const entry = { item: it, sourceLabel: '📚 共通素材' };
          const du = String(it.dataUrl || (it.raw && it.raw.dataUrl) || '').trim();
          const cands = [it.cloudSha, it.raw && it.raw.cloudSha, /^@img:/i.test(du) ? du.slice(5) : ''];
          for (const rawH of cands) {
            const h = String(rawH || '').trim().toLowerCase();
            if (h && !shaMap.has(h)) shaMap.set(h, entry);
          }
          const memSize = Number(it.size || (it.raw && it.raw.size) || 0) || 0;
          const nameKey = P.normName(it.origName || it.name || baseName(it.path));
          if (nameKey) {
            let list = commonMemByName.get(nameKey);
            if (!list) { list = []; commonMemByName.set(nameKey, list); }
            list.push({ item: it, size: memSize, sourceLabel: '📚 共通素材' });
          }
        });
      } catch (_) { }
    }
    const PERCEPTUAL_MAX_REG = 40;
    const PERCEPTUAL_TIMEOUT_MS = 1200;
    let regFeaturesReady = false;
    const regFeatures = [];
    async function ensureRegFeatures() {
      if (regFeaturesReady) return regFeatures;
      regFeaturesReady = true;
      if (!regImgItems.length || regImgItems.length > PERCEPTUAL_MAX_REG) return regFeatures;
      const FEAT_BATCH = 8;
      for (let i = 0; i < regImgItems.length; i += FEAT_BATCH) {
        const chunk = regImgItems.slice(i, i + FEAT_BATCH);
        const res = await Promise.all(chunk.map(async it => {
          const src = it.dataUrl || it.path || '';
          if (!src) return null;
          const feat = await computeImgFeature(src, PERCEPTUAL_TIMEOUT_MS);
          return feat ? { item: it, feat } : null;
        }));
        res.forEach(r => { if (r) regFeatures.push(r); });
      }
      return regFeatures;
    }
    async function matchExistingAsset(ref, buf, mime, fallbackDataUrl) {
      const refStem = String(ref || '').trim().split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
      let hit = P.isSha256(refStem) ? shaMap.get(refStem) : null;
      let bufSha = '';
      if (!hit && buf && buf.length) {
        bufSha = await computeBufSha(buf);
        if (bufSha) hit = shaMap.get(bufSha) || null;
      }
      if (!hit && refStem && !P.isSha256(refStem)) {
        const memCands = commonMemByName.get(P.normName(refStem));
        if (memCands && memCands.length) {
          const targetSize = (buf && buf.length) ? buf.length : 0;
          const bySize = targetSize ? memCands.filter(e => e.size > 0 && e.size === targetSize) : [];
          if (bySize.length === 1) hit = bySize[0];
          else if (memCands.length === 1 && (!targetSize || !memCands[0].size || memCands[0].size === targetSize)) hit = memCands[0];
        }
      }
      if (hit && hit.item) {
        const it = hit.item;
        const du = it.dataUrl || fallbackDataUrl || (buf ? await typedDataUrl(buf, mime, it.name || ref) : '');
        return { assetUid: it.uid || '', name: it.name || it.origName || '', path: it.path || '', dataUrl: du, linked: true, sourceLabel: hit.sourceLabel, method: 'sha256' };
      }
      // 再エンコードでSHA-256が変化した場合のフォールバック（現在シナリオの登録画像が40枚以下のときのみ実行）
      if (regImgItems.length > 0 && regImgItems.length <= PERCEPTUAL_MAX_REG && typeof document !== 'undefined' && (buf || fallbackDataUrl)) {
        const feats = await ensureRegFeatures();
        if (feats.length) {
          const probe = (buf && typeof Blob !== 'undefined') ? new Blob([buf], { type: mime || 'image/png' }) : fallbackDataUrl;
          const qFeat = await computeImgFeature(probe, PERCEPTUAL_TIMEOUT_MS);
          if (qFeat) {
            let best = null, bestScore = Infinity;
            for (const cand of feats) {
              const cmp = compareImgFeature(qFeat, cand.feat);
              if (cmp && cmp.score < bestScore) { bestScore = cmp.score; best = cand.item; }
            }
            if (best) {
              const du = best.dataUrl || fallbackDataUrl || (buf ? await typedDataUrl(buf, mime, best.name || ref) : '');
              return { assetUid: best.uid || '', name: best.name || best.origName || '', path: best.path || '', dataUrl: du, linked: true, sourceLabel: '📌 登録素材（類似一致）', method: 'perceptual' };
            }
          }
        }
      }
      return null;
    }

    /** 名前で再リンク：同名0件→null／1件→自動／複数→選択ダイアログ。選んだ結果は同じ名前の間キャッシュ */
    async function relinkByName(kind, hints) {
      const nm = [...new Set(hints.map(h => String(h || '').trim()).filter(Boolean))]; if (!nm.length) return null;
      const key = kind + '|' + nm.map(P.normName).join('|'); if (pickCache.has(key)) return pickCache.get(key);
      if (!idx[kind]) idx[kind] = buildIndex(kind);
      const cands = P.matchByName(nm, idx[kind]); let pick = null;
      if (cands.length === 1) pick = cands[0];
      else if (cands.length > 1) pick = await askChoice({ kind, name: nm[0], cands });
      pickCache.set(key, pick); return pick;
    }
    const deriveRepName = (hArr, lbl, r) => {
      const h0 = (Array.isArray(hArr) ? hArr : []).map(x => String(x || '').trim()).find(Boolean);
      if (h0) return h0;
      const sLbl = String(lbl || '').trim();
      if (sLbl) {
        if (sLbl === '部屋の背景') return roomName + ' 背景';
        if (sLbl === '部屋の前景') return roomName + ' 前景';
        const m = sLbl.match(/^(.*?) の(背景|前景|マーカー|立ち絵|アイコン)$/);
        if (m) return (m[1] ? m[1] + ' ' : '') + m[2];
        return sLbl;
      }
      return baseName(r) || '画像';
    };
    /** 画像の参照 → { dataUrl, assetUid, name, path, linked }（ZIP内 → http(s) → 名前で再リンク） */
    async function imageFor(ref, hints, label) {
      ref = ref == null ? '' : String(ref).trim();
      if (ref && refResolvedCache.has(ref)) return refResolvedCache.get(ref);
      const key = ref + '|' + (hints || []).join('|'); if (imgCache.has(key)) return imgCache.get(key);
      let out = null;
      try {
        const hit = ref && entryOf(ref);
        if (hit) {
          out = await withTimeout((async () => {
            const r = await CCF.zip.readBuffer(hit.url);
            const mime = P.mimeOf(r.buf, (json.resources && json.resources[ref] || {}).type || r.mime, hit.entry);
            const bufSha = await computeBufSha(r.buf);
            if (bufSha && shaResolvedCache.has(bufSha)) return shaResolvedCache.get(bufSha);
            const matched = await matchExistingAsset(ref, r.buf, mime, '');
            if (matched) {
              if (!matched.name) matched.name = deriveRepName(hints, label, ref);
              rep.autoLinked.push({ kind: '🖼️', label: label || matched.name || ref.slice(0, 16), to: matched.name, source: matched.sourceLabel });
              if (bufSha) shaResolvedCache.set(bufSha, matched);
              return matched;
            }
            const du = await typedDataUrl(r.buf, mime, hit.entry);
            if (!du) return null;
            const res = { assetUid: '', name: deriveRepName(hints, label, ref), path: '', dataUrl: du, linked: false };
            if (bufSha) shaResolvedCache.set(bufSha, res);
            return res;
          })(), ASSET_TIMEOUT_MS, label || ref);
        }
        else if (/^https?:\/\//i.test(ref)) {
          out = await withTimeout((async () => {
            const r = await CCF.ccfExport.readRef(ref);
            if (!r) return null;
            const mime = P.mimeOf(r.buf, r.mime, r.name);
            const bufSha = await computeBufSha(r.buf);
            if (bufSha && shaResolvedCache.has(bufSha)) return shaResolvedCache.get(bufSha);
            const matched = await matchExistingAsset(ref, r.buf, mime, '');
            if (matched) {
              if (!matched.name) matched.name = deriveRepName(hints, label, ref);
              rep.autoLinked.push({ kind: '🖼️', label: label || matched.name || ref.slice(0, 16), to: matched.name, source: matched.sourceLabel });
              if (bufSha) shaResolvedCache.set(bufSha, matched);
              return matched;
            }
            const du = await typedDataUrl(r.buf, mime, r.name);
            if (!du) return null;
            const res = { assetUid: '', name: deriveRepName(hints, label, ref), path: '', dataUrl: du, linked: false };
            if (bufSha) shaResolvedCache.set(bufSha, res);
            return res;
          })(), ASSET_TIMEOUT_MS, label || ref);
        }
        else if (/^data:image\//i.test(ref)) {
          const parsed = P.parseDataUrl(ref);
          const bufSha = parsed && parsed.buf ? await computeBufSha(parsed.buf) : '';
          if (bufSha && shaResolvedCache.has(bufSha)) {
            out = shaResolvedCache.get(bufSha);
          } else {
            const matched = await matchExistingAsset('', parsed && parsed.buf, parsed && parsed.mime, ref);
            if (matched) {
              if (!matched.name) matched.name = deriveRepName(hints, label, ref);
              rep.autoLinked.push({ kind: '🖼️', label: label || matched.name, to: matched.name, source: matched.sourceLabel });
              out = matched;
            } else {
              out = { assetUid: '', name: deriveRepName(hints, label, ref), path: '', dataUrl: ref, linked: false };
            }
            if (bufSha && out) shaResolvedCache.set(bufSha, out);
          }
        }
      } catch (e) { out = null; }
      if (!out && (hints || []).some(Boolean)) {
        const c = await relinkByName('image', hints);
        if (c) {
          let du = '';
          try {
            if (c.dataUrl) du = c.dataUrl;
            else {
              du = await withTimeout((async () => {
                const r = await CCF.ccfExport.readRef(c.path);
                return r ? await typedDataUrl(r.buf, r.mime, r.name) : null;
              })(), ASSET_TIMEOUT_MS, c.name || c.path);
            }
          } catch (e) { du = ''; }
          if (du) {
            out = { assetUid: c.assetUid || '', name: c.name || deriveRepName(hints, label, ref), path: c.dataUrl ? '' : (c.path || ''), dataUrl: du, linked: true };
            rep.linked.push({ kind: '🖼️', name: (hints || [])[0] || c.name, to: c.dataUrl ? c.name : c.path });
          }
        }
      }
      if (out && out.dataUrl) {
        if (!out.name) out.name = deriveRepName(hints, label, ref);
        rep.images++;
        if (ref) refResolvedCache.set(ref, out);
      } else if (ref || (hints || []).some(Boolean)) {
        rep.unresolved.push('🖼️ ' + (label || (hints || [])[0] || ref.slice(0, 20)));
      }
      imgCache.set(key, out); return out;
    }
    /** BGM／SE の参照 → { path, name }（ZIP内にあれば _TRPG_Data へ取り出し → 無ければ曲名・ファイル名でディープサーチ） */
    async function audioFor(ref, hints, label) {
      ref = ref == null ? '' : String(ref).trim(); const key = ref + '|' + (hints || []).join('|'); if (audCache.has(key)) return audCache.get(key);
      let out = null;
      try {
        const hit = ref && entryOf(ref);
        if (hit) {
          out = await withTimeout((async () => {
            const r = await CCF.zip.readBuffer(hit.url), mime = P.mimeOf(r.buf, (json.resources && json.resources[ref] || {}).type || r.mime, hit.entry);
            const ext = P.extOfMime(mime) || (hit.entry.match(/\.([A-Za-z0-9]{2,4})$/) || [])[1] || 'mp3', nameHint = (hints || []).find(Boolean);
            const fname = CCF.ccfExport.safeName(nameHint || ref.slice(0, 16)) + '_' + ref.slice(0, 8) + '.' + ext;
            if (isElec && fs && path && impDir) {
              fs.mkdirSync(impDir, { recursive: true });
              const fp = path.join(impDir, fname);
              fs.writeFileSync(fp, r.buf); rep.extracted++; return { path: fp, name: nameHint || path.basename(fp), added: true };
            } else if (window.WebBridge && WebBridge.saveAssetBytes) {
              const fp = await WebBridge.saveAssetBytes(r.buf, fname, mime);
              rep.extracted++; return { path: fp, name: nameHint || baseName(fp), added: true };
            }
            return null;
          })(), ASSET_TIMEOUT_MS, label || ref);
        }
      } catch (e) { out = null; }
      if (!out) {
        const urlName = /^https?:\/\//i.test(ref) ? (() => { try { return decodeURIComponent(new URL(ref).pathname.split('/').pop()); } catch (e) { return ''; } })() : ref;
        const c = await relinkByName('audio', [...(hints || []), urlName && !P.isSha256(urlName) ? urlName : '']);
        if (c) { out = { path: c.path, name: (hints || []).find(Boolean) || c.name }; rep.linked.push({ kind: '🎵', name: out.name, to: c.path }); }
      }
      if (!out && (ref || (hints || []).some(Boolean))) rep.unresolved.push('🎵 ' + (label || (hints || []).find(Boolean) || ref.slice(0, 20)) + '（実体が見つかりません）');
      audCache.set(key, out); return out;
    }

    // --- 盤面サイズ・座標単位の判定 ---
    const grid = 24;
    const normFit = v => (v === 'fill' || v === 'cover' || v === 'contain') ? v : '';
    const roomFw = Number(room.fieldWidth), roomFh = Number(room.fieldHeight);
    const hasRoomSize = Number.isFinite(roomFw) && roomFw > 0 && Number.isFinite(roomFh) && roomFh > 0;
    const boardWidth = hasRoomSize ? Math.max(96, Math.min(4000, Math.round(roomFw * grid))) : 960;
    const boardHeight = hasRoomSize ? Math.max(96, Math.min(4000, Math.round(roomFh * grid))) : 720;
    const roomFgFit = normFit(room.fieldObjectFit) || 'cover';
    const allCoordEntities = [
      ...pkg.items,
      ...pkg.characters.filter(ch => ch && ch.active === true && ch.invisible !== true),
      ...pkg.scenes.flatMap(s => (Array.isArray(s.markers) ? s.markers : []))
    ];
    const coordScale = P.detectCoordScale(allCoordEntities, {
      fieldWidth: hasRoomSize ? roomFw : 40,
      fieldHeight: hasRoomSize ? roomFh : 30,
      grid
    });

    // --- キャラクター → NPC ＆ 盤面上の有効駒（active===true && invisible!==true） ---
    const npcs = [], pieces = [], total = pkg.characters.length + pkg.scenes.length + pkg.items.length; let done = 0;
    const tick = () => { if (++done % 5 === 0) say('📥 取り込み中… ' + done + ' / ' + total); };
    for (const ch of pkg.characters) {
      const faces = [];
      for (const f of (Array.isArray(ch.faces) ? ch.faces : [])) {
        if (!f || !f.iconUrl) continue;
        const img = await imageFor(f.iconUrl, [f.label], (ch.name || '') + ' の立ち絵');
        if (img && img.dataUrl) {
          faces.push({ iconUrl: img.dataUrl, label: String(f.label || img.name || ''), name: String(img.name || f.label || ''), path: img.path || '', assetId: img.assetUid || '' });
        }
      }
      const iconImg = ch.iconUrl ? await imageFor(ch.iconUrl, [ch.name], (ch.name || '') + ' のアイコン') : null;
      const d = M.fromCcfoliaCharacter({
        kind: 'character',
        data: Object.assign({}, ch, {
          iconUrl: (iconImg && iconImg.dataUrl) || null,
          iconName: (iconImg && iconImg.name) || '',
          iconPath: (iconImg && iconImg.path) || '',
          iconAssetId: (iconImg && iconImg.assetUid) || '',
          faces
        })
      });
      if (d) {
        npcs.push(d);
        if (ch.active === true && ch.invisible !== true) {
          const cz = Number(ch.z);
          pieces.push(M.sanitizeBoardItem({
            kind: 'piece',
            npcId: d.id,
            assetUid: (iconImg && iconImg.assetUid) || '',
            name: d.name,
            path: (iconImg && iconImg.path) || '',
            dataUrl: d.iconDataUrl || '',
            x: Math.round((Number(ch.x) || 0) * coordScale + boardWidth / 2),
            y: Math.round((Number(ch.y) || 0) * coordScale + boardHeight / 2),
            width: Math.round((Number(ch.width) || 4) * grid),
            height: Math.round((Number(ch.height) || 4) * grid),
            angle: Number(ch.angle) || 0,
            zIndex: Number.isFinite(cz) ? cz : 30,
            visible: true,
            locked: !!ch.locked
          }, 'piece'));
        }
      }
      tick();
    }
    // --- シーン ---
    const refs = [], addRef = a => { if (a && a.added && !refs.some(r => r.path === a.path)) refs.push({ type: 'audio', name: a.name, origName: baseName(a.path), path: a.path, category: 'ココフォリア取込' }); };
    const scenes = [];
    for (const s of pkg.scenes) {
      const nm = String(s.name || '無題のシーン'), bgRef = s.backgroundUrl || s.imageUrl, fgRef = s.foregroundUrl;
      const bg = bgRef ? await imageFor(bgRef, [], nm + ' の背景') : null, fg = fgRef ? await imageFor(fgRef, [], nm + ' の前景') : null;
      const bgmName = String(s.bgmName || s.bgmFile || '').trim(), au = (s.bgmUrl || bgmName) ? await audioFor(s.bgmUrl, [bgmName], 'シーン「' + nm + '」のBGM「' + bgmName + '」') : null;
      addRef(au);
      const sFw = Number(s.fieldWidth), sFh = Number(s.fieldHeight);
      const sBoardW = Number.isFinite(sFw) && sFw > 0 ? Math.max(96, Math.min(4000, Math.round(sFw * grid))) : null;
      const sBoardH = Number.isFinite(sFh) && sFh > 0 ? Math.max(96, Math.min(4000, Math.round(sFh * grid))) : null;
      const effW = sBoardW || boardWidth;
      const effH = sBoardH || boardHeight;
      const sFgFit = normFit(s.fieldObjectFit) || 'cover';
      const markers = [];
      for (const mk of (Array.isArray(s.markers) ? s.markers : [])) {
        if (!mk || typeof mk !== 'object') continue;
        const mkImg = mk.dataUrl
          ? { assetUid: '', name: '', path: '', dataUrl: mk.dataUrl }
          : (mk.imageUrl ? await imageFor(mk.imageUrl, [mk.name], nm + ' のマーカー') : null);
        const mz = Number(mk.z != null ? mk.z : mk.zIndex);
        const mkVis = !(mk.active === false || mk.visible === false || mk.closed === true);
        const bm = M.sanitizeBoardItem({
          kind: 'marker',
          assetUid: (mkImg && mkImg.assetUid) || '',
          name: String(mk.name || (mkImg && mkImg.name) || mk.text || 'マーカー').split('\n')[0].slice(0, 40),
          text: String(mk.text || ''),
          path: (mkImg && mkImg.path) || '',
          dataUrl: (mkImg && mkImg.dataUrl) || '',
          color: String(mk.color || ''),
          x: Math.round((Number(mk.x) || 0) * coordScale + effW / 2),
          y: Math.round((Number(mk.y) || 0) * coordScale + effH / 2),
          width: Math.round((Number(mk.width) || 4) * grid),
          height: Math.round((Number(mk.height) || 4) * grid),
          angle: Number(mk.angle) || 0,
          zIndex: Number.isFinite(mz) ? mz : 20,
          visible: mkVis,
          locked: !!mk.locked
        }, 'marker');
        if (bm) markers.push(bm);
      }
      const vol = Number(s.bgmVolume);
      const scMsg = String(s.sceneMessage != null ? s.sceneMessage : (s.text || ''));
      scenes.push(M.sanitizeScene({
        title: nm,
        text: '',
        sceneMessage: scMsg,
        boardWidth: sBoardW,
        boardHeight: sBoardH,
        fgFit: sFgFit,
        bg: bg ? { kind: 'bg', assetUid: bg.assetUid || '', name: bg.name || (nm + ' 背景'), path: bg.path || '', dataUrl: bg.dataUrl } : null,
        fg: fg ? { kind: 'fg', assetUid: fg.assetUid || '', name: fg.name || (nm + ' 前景'), path: fg.path || '', dataUrl: fg.dataUrl, x: 0, y: 0, width: effW, height: effH, fitMode: sFgFit } : null,
        markers,
        bgm: au || bgmName ? { name: (au && au.name) || bgmName, path: au ? au.path : '', volume: Number.isFinite(vol) ? Math.round(vol * 100) : 35, loop: true } : null,
        manualSlots: { bg: !!bg, fg: !!fg, screen: false, marker: markers.length > 0, bgm: !!au }
      })); tick();
    }
    // --- 部屋の背景・前景・BGM ---
    const rbg = room.backgroundUrl ? await imageFor(room.backgroundUrl, [], '部屋の背景') : null;
    const rfg = room.foregroundUrl ? await imageFor(room.foregroundUrl, [], '部屋の前景') : null;
    let roomBgm = null;
    if (room.bgmUrl || room.bgmName) {
      const au = await audioFor(room.bgmUrl, [room.bgmName], '部屋のBGM「' + (room.bgmName || '') + '」');
      addRef(au);
      const rVol = Number(room.bgmVolume);
      if (au || room.bgmName) {
        roomBgm = { name: (au && au.name) || String(room.bgmName || '').trim(), path: au ? au.path : '', volume: Number.isFinite(rVol) ? Math.round(rVol * 100) : 35, loop: true };
      }
    }
    // --- スクリーンパネル（entities.items はすべて部屋常駐のスクリーンパネル） ---
    const screens = [];
    for (const it of pkg.items) {
      const img = it.imageUrl ? await imageFor(it.imageUrl, [it.name], 'スクリーンパネル画像') : null;
      const memo = String(it.memo || '');
      const isVis = !(it.active === false || it.visible === false || it.closed === true);
      const iz = Number(it.z);
      screens.push({
        kind: 'screen',
        assetUid: (img && img.assetUid) || '',
        name: String(it.name || (img && img.name) || memo.split('\n')[0] || 'スクリーンパネル').slice(0, 40),
        text: memo,
        path: (img && img.path) || '',
        dataUrl: (img && img.dataUrl) || '',
        x: Math.round((Number(it.x) || 0) * coordScale + boardWidth / 2),
        y: Math.round((Number(it.y) || 0) * coordScale + boardHeight / 2),
        width: Math.round((Number(it.width) || 4) * grid),
        height: Math.round((Number(it.height) || 4) * grid),
        angle: Number(it.angle) || 0,
        zIndex: Number.isFinite(iz) ? iz : 0,
        visible: isVis,
        locked: !!it.locked
      }); tick();
    }

    const proj = M.sanitizeProject({
      npcs,
      scenes,
      refs,
      board: { width: boardWidth, height: boardHeight, customSize: hasRoomSize, grid, coordVersion: 2, pieces },
      globalDecor: {
        bg: rbg ? { kind: 'bg', assetUid: rbg.assetUid || '', name: rbg.name || (roomName + ' 背景'), path: rbg.path || '', dataUrl: rbg.dataUrl } : null,
        fg: rfg ? { kind: 'fg', assetUid: rfg.assetUid || '', name: rfg.name || (roomName + ' 前景'), path: rfg.path || '', dataUrl: rfg.dataUrl, x: 0, y: 0, width: boardWidth, height: boardHeight, fitMode: roomFgFit } : null,
        screens,
        bgm: roomBgm
      }
    });
    if (typeof window !== 'undefined' && typeof window.urlToRef === 'function') {
      const seenObjs = new WeakSet();
      const convertDataUrls = (node) => {
        if (!node || typeof node !== 'object' || seenObjs.has(node)) return;
        seenObjs.add(node);
        if (Array.isArray(node)) {
          for (let i = 0; i < node.length; i++) {
            const v = node[i];
            if (typeof v === 'string') {
              if (/^data:image\//i.test(v)) {
                try { node[i] = window.urlToRef(v); } catch (_) { }
              }
            } else if (v && typeof v === 'object') {
              convertDataUrls(v);
            }
          }
          return;
        }
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (typeof v === 'string') {
            if (/^data:image\//i.test(v)) {
              try { node[k] = window.urlToRef(v); } catch (_) { }
            }
          } else if (v && typeof v === 'object') {
            convertDataUrls(v);
          }
        }
      };
      convertDataUrls(proj);
      if (typeof window.imgFlush === 'function') {
        try { await window.imgFlush(); } catch (_) { }
      }
    }
    let finalRoomName = roomName;
    try {
      const existingRooms = (typeof CCF.getRoomContainer === 'function' ? (CCF.getRoomContainer(S.key) || {}).rooms : S.rooms) || [];
      const existingNames = new Set(existingRooms.map(r => String((r && r.name) || '').trim()));
      if (existingNames.has(finalRoomName)) {
        let cand = `${roomName} (再取込)`;
        let seq = 2;
        while (existingNames.has(cand)) {
          cand = `${roomName} (再取込 ${seq++})`;
        }
        finalRoomName = cand;
      }
    } catch (_) { }
    const added = await CCF.addRoom(finalRoomName, proj);
    if (added && added.id && typeof CCF.switchRoom === 'function' && S.roomId !== added.id) {
      try { await CCF.switchRoom(added.id); } catch (_) { }
    }
    if (typeof CCF.getRoomContainer === 'function') {
      const container = CCF.getRoomContainer(S.key);
      if (container) {
        S.rooms = container.rooms;
        S.roomId = (added && added.id) || container.activeRoomId;
        const cur = Array.isArray(S.rooms) ? S.rooms.find(r => r.id === S.roomId) : null;
        if (cur && cur.project) S.proj = cur.project;
      }
    } else if (added) {
      if (added.id) S.roomId = added.id;
      if (added.project) S.proj = added.project;
    }
    if (typeof window.imgFlush === 'function') {
      try { await window.imgFlush(); } catch (_) { }
    }
    if (typeof window.hydrateRefs === 'function' && S.proj) {
      try { await window.hydrateRefs(S.proj); } catch (_) { }
    }
    if (typeof CCF.updateTabCounts === 'function') CCF.updateTabCounts();
    if (typeof CCF.renderRoomSelect === 'function') CCF.renderRoomSelect();
    if (typeof CCF.renderProps === 'function') CCF.renderProps();
    if (typeof CCF.renderCenter === 'function') CCF.renderCenter();
    if (scenes.length > 0 && typeof CCF.setView === 'function') CCF.setView('scene');
    if (CCF.sceneUI) {
      if (CCF.sceneUI.onProjectSwitch) CCF.sceneUI.onProjectSwitch();
      if (CCF.sceneUI.render) CCF.sceneUI.render();
      if (typeof CCF.sceneUI.refitCamera === 'function') {
        requestAnimationFrame(() => CCF.sceneUI.refitCamera(true));
      }
    }
    rep.counts = { npcs: npcs.length, scenes: scenes.length, items: screens.length, pieces: pieces.length, effects: pkg.effects.length };
    rep.roomName = finalRoomName; rep.version = pkg.version;
    say('✅ 部屋「' + finalRoomName + '」を取り込みました（NPC ' + npcs.length + '・シーン ' + scenes.length + '・スクリーン ' + screens.length + '）' + (rep.autoLinked.length ? ' 🔗 自動リンク ' + rep.autoLinked.length + '件' : '') + (rep.unresolved.length ? ' ⚠️ 未解決の素材 ' + rep.unresolved.length + '件' : ''));
    if (rep.autoLinked.length || rep.linked.length || rep.unresolved.length || rep.extracted) showReport(rep);
    return { room: added, report: rep };
  }

  function showReport(rep) {
    const old = document.getElementById('ccfZipImpReport'); if (old) old.remove();
    const ov = document.createElement('div'); ov.className = 'ccf-overlay'; ov.id = 'ccfZipImpReport'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); }, onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    const autoLinked = Array.isArray(rep.autoLinked) ? rep.autoLinked : [];
    ov.innerHTML = `<div class="ccf-modal narrow"><div class="ccf-modal-head"><b>📥 取り込み結果：${esc(rep.roomName)}</b><span class="ccf-muted">NPC ${rep.counts.npcs}・シーン ${rep.counts.scenes}・スクリーン ${rep.counts.items}</span><span class="ccf-spacer"></span><button type="button" class="ccf-mini" data-r="close">✕</button></div>
      <div class="ccf-modal-body single">
        ${rep.extracted ? `<div>📦 ZIPから音声 ${rep.extracted}点を取り出しました（${isElec ? '_TRPG_Data/ccfolia/imports' : 'ブラウザ内ライブラリ'}）</div>` : ''}
        ${autoLinked.length ? `<div class="ccf-wiz-result"><b>🔗 登録素材／共通素材と自動リンク：${autoLinked.length}件</b>${autoLinked.slice(0, 50).map(l => `<div>${l.kind} ${esc(l.label)} <span class="ccf-muted">→ ${esc(l.to)}${l.source ? '（' + esc(l.source) + '）' : ''}</span></div>`).join('')}</div>` : ''}
        ${rep.linked.length ? `<div class="ccf-wiz-result"><b>🔗 ローカル素材を自動で再リンクしました（${rep.linked.length}件）</b>${rep.linked.slice(0, 50).map(l => `<div>${l.kind} ${esc(l.name)} <span class="ccf-muted">→ ${esc(l.to)}</span></div>`).join('')}</div>` : ''}
        ${rep.unresolved.length ? `<div class="ccf-wiz-warn"><b>⚠️ 実体が見つからなかった素材（${rep.unresolved.length}件）</b>${[...new Set(rep.unresolved)].slice(0, 50).map(u => `<div>${esc(u)}</div>`).join('')}<div class="ccf-muted">マイライブラリや登録素材へ同名ファイルを追加してから、もう一度取り込んでください。</div></div>` : ''}
      </div><div class="ccf-modal-foot"><span class="ccf-spacer"></span><button type="button" class="ccf-btn primary" data-r="close">閉じる</button></div></div>`;
    ov.addEventListener('click', e => { if (e.target.closest('[data-r="close"]')) close(); });
    document.body.appendChild(ov); document.addEventListener('keydown', onKey, true);
  }

  async function pickAndImport() {
    let target = null;
    if (isElec && CCF.electron && CCF.electron.ipcRenderer) {
      const r = await CCF.electron.ipcRenderer.invoke('ccf:pick', { title: 'ココフォリアのルームZIPを選択', properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] });
      target = r && r[0];
    } else if (window.WebBridge) {
      const files = await WebBridge.pickFiles({ accept: '.zip', multiple: false });
      target = files && files[0];
    }
    if (!target) return;
    try { if (!(await isRoomZip(target))) return say('⚠️ ココフォリアのルームZIP（__data.json入り）ではありません'); await importRoomZip(target); }
    catch (e) { console.error('[ccf] ZIP逆輸入に失敗', e); say('❌ 取り込みに失敗しました：' + (e.message || e)); }
  }

  CCF.ccfImport = { isRoomZip, importRoomZip, pickAndImport, buildIndex, askChoice };
})();
