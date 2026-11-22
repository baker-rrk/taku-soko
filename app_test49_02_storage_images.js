/* app_test49_02_storage_images.js — 画像の保存(IndexedDB)・直列化・画像の遅延読み込み
 * 読み込み順は 01→07（HTMLの<script>の並び）。全ファイルが同じグローバルスコープを共有します。
 * 各ファイルは、前のファイルで定義された関数・変数を使えます。 */
  const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const imgUrlToHash = new Map(), hashToUrl = new Map(), thumbMap = new Map(), dataHashCache = new Map(), storedHashes = new Set();
  let persistChain = Promise.resolve();
  function hashStr(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + 'x' + str.length.toString(36);
  }
  function imgSrc(u) { u = String(u || ''); return u.startsWith('@img:') ? PLACEHOLDER : u; }
  function thumbSrc(u) {
    u = String(u || '');
    if (u.startsWith('blob:')) { const h = imgUrlToHash.get(u); if (h && thumbMap.has(h)) return thumbMap.get(h); }
    else if (u.startsWith('@img:')) { const h = u.slice(5); if (thumbMap.has(h)) return thumbMap.get(h); }
    else if (u.startsWith('data:image/')) { const h = dataHashCache.get(u); if (h && thumbMap.has(h)) return thumbMap.get(h); }
    return thumbMap.get(u) || imgSrc(u);
  }
  async function makeThumb(blob) {
    try {
      const bmp = await createImageBitmap(blob), sc = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); if (bmp.close) bmp.close();
      return await new Promise(r => c.toBlob(r, 'image/webp', 0.7));
    } catch (e) { logSoft('makeThumb', e); return null; }
  }
  function setThumbUrl(h, thumbBlob) {
    if (!h || !thumbBlob) return;
    const prev = thumbMap.get(h);
    if (prev) { try { URL.revokeObjectURL(prev); } catch (e) { logSoft('revokeThumb', e); } }
    thumbMap.set(h, URL.createObjectURL(thumbBlob));
  }
  function queueImage(h, dataUrl) {
    if (storedHashes.has(h)) return; storedHashes.add(h);
    persistChain = persistChain.then(async () => {
      const blob = dataURLtoBlob(dataUrl); await idbPut('images', h, blob);
      if (!hashToUrl.has(h)) {
        const url = URL.createObjectURL(blob); hashToUrl.set(h, url); imgUrlToHash.set(url, h);
      }
      const t = await makeThumb(blob); if (t) { await idbPut('thumbs', h, t); setThumbUrl(h, t); }
    }).catch(e => { storedHashes.delete(h); console.error(e); });
  }
  function urlToRef(u) {
    if (typeof u !== 'string') return u;
    if (/^blob:/i.test(u.trim())) { const h = imgUrlToHash.get(u); return h ? '@img:' + h : ''; }
    if (u.startsWith('data:image/')) { let h = dataHashCache.get(u); if (!h) { h = hashStr(u); dataHashCache.set(u, h); if (dataHashCache.size > 30) dataHashCache.delete(dataHashCache.keys().next().value); } queueImage(h, u); return '@img:' + h; }
    return u;
  }
  function serializeState(o) { return JSON.stringify(o, (k, v) => (typeof v === 'string' && (k !== 'botAvatarData' || (v.startsWith('data:image/') && v.length >= 5000))) ? urlToRef(v) : v); }
  function walkStrings(o, fn) { for (const k in o) { const v = o[k]; if (typeof v === 'string') { const r = fn(v); if (r !== undefined) o[k] = r; } else if (v && typeof v === 'object' && !(v instanceof Blob)) walkStrings(v, fn); } }
  function updateImageDom(h) {
    const u = hashToUrl.get(h);
    if (!u) return;
    const escH = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(h) : h;
    document.querySelectorAll(`img[data-ref="${escH}"]`).forEach(el => {
      el.src = u;
      el.removeAttribute('data-ref');
    });
  }
  async function ensureLocalUrl(h) {
    if (hashToUrl.has(h)) { updateImageDom(h); return; }
    try {
      const blob = await idbGet('images', h); if (!blob) return;
      storedHashes.add(h);
      const url = URL.createObjectURL(blob); hashToUrl.set(h, url); imgUrlToHash.set(url, h);
      updateImageDom(h);
      const t = await idbGet('thumbs', h);
      if (t) { setThumbUrl(h, t); updateThumbDom(h); }
      else makeThumb(blob).then(async tb => { if (tb) { await idbPut('thumbs', h, tb); setThumbUrl(h, tb); updateThumbDom(h); } });
    } catch (e) { console.error(e); }
  }
  function collectUsedImageHashes() {
    const used = new Set();
    const scan = root => {
      if (!root || typeof root !== 'object') return;
      walkStrings(root, v => {
        if (!v) return;
        if (v.indexOf('@img:') !== -1) {
          for (const m of v.matchAll(/@img:([a-z0-9]+)/g)) used.add(m[1]);
        }
        if (v.startsWith('blob:')) { const h = imgUrlToHash.get(v); if (h) used.add(h); }
        else if (v.startsWith('data:image/')) { const h = dataHashCache.get(v) || hashStr(v); if (h) used.add(h); }
      });
    };
    if (typeof appState !== 'undefined') {
      scan(appState);
      if (typeof serializeState === 'function') {
        try {
          const serialized = serializeState(appState);
          for (const m of serialized.matchAll(/@img:([a-z0-9]+)/g)) used.add(m[1]);
        } catch (e) { logSoft('collectUsedSer', e); }
      }
    }
    if (typeof blockOrder !== 'undefined') scan(blockOrder);
    if (typeof secretHOs !== 'undefined') scan(secretHOs);
    if (typeof window !== 'undefined' && window.CCF && window.CCF.S && Array.isArray(window.CCF.S.rooms)) {
      scan(window.CCF.S.rooms);
    }
    if (typeof window !== 'undefined' && window.AppHistory && typeof window.AppHistory.collectUsedHashes === 'function') {
      window.AppHistory.collectUsedHashes(used);
    }
    return used;
  }
  async function cleanupUnusedImages(opts) {
    await persistChain;
    const used = collectUsedImageHashes();
    let imgKeys = [], thumbKeys = [];
    if (typeof idbKeys === 'function') {
      try { imgKeys = await idbKeys('images'); } catch (e) { logSoft('idbKeysImg', e); }
      try { thumbKeys = await idbKeys('thumbs'); } catch (e) { logSoft('idbKeysThumb', e); }
    }
    const allHashes = new Set([...storedHashes, ...hashToUrl.keys(), ...thumbMap.keys(), ...imgKeys, ...thumbKeys]);
    let removed = 0;
    for (const h of allHashes) {
      if (used.has(h)) continue;
      const u = hashToUrl.get(h);
      if (u) {
        try { URL.revokeObjectURL(u); } catch (e) { logSoft('revokeImg', e); }
        hashToUrl.delete(h);
        imgUrlToHash.delete(u);
      }
      const tu = thumbMap.get(h);
      if (tu) {
        try { URL.revokeObjectURL(tu); } catch (e) { logSoft('revokeThumb', e); }
        thumbMap.delete(h);
      }
      storedHashes.delete(h);
      if (typeof idbDel === 'function') {
        await idbDel('images', h);
        await idbDel('thumbs', h);
      }
      removed++;
    }
    for (const [du, dh] of [...dataHashCache.entries()]) {
      if (!used.has(dh)) dataHashCache.delete(du);
    }
    if (removed > 0) {
      console.log(`[imgStore] 孤立画像 ${removed}件をIndexedDBから削除しました`);
    }
    if ((removed > 0 || (opts && opts.forceAutosave)) && !(opts && opts.skipAutosave)) {
      if (typeof saveDiskAutosaveNow === 'function') {
        try { await saveDiskAutosaveNow(!!(opts && opts.forceAutosave)); } catch (e) { logSoft('cleanupSaveDisk', e); }
      }
    }
    return removed;
  }
  window.urlToRef = urlToRef;
  window.cleanupUnusedImages = cleanupUnusedImages;
  window.cleanupOrphanIdbImages = cleanupUnusedImages;
  window._imgStoreDebug = { imgUrlToHash, hashToUrl, thumbMap, dataHashCache, storedHashes };
  function replaceRefs(o) { let n = 0; walkStrings(o, v => { if (v.startsWith('@img:')) { const u = hashToUrl.get(v.slice(5)); if (u) { n++; return u; } } }); return n; }
  async function hydrateRefs(root) {
    const refs = new Set(); walkStrings(root, v => { if (v.startsWith('@img:')) refs.add(v.slice(5)); });
    await Promise.all([...refs].map(ensureLocalUrl)); replaceRefs(root);
  }
  window.imgFlush = () => persistChain;
  window.idbImageBlob = async (h) => await idbGet('images', h);
  window.idbThumbBlob = async (h) => {
    let t = await idbGet('thumbs', h);
    if (!t) {
      const b = await idbGet('images', h);
      if (b) { t = await makeThumb(b); if (t) await idbPut('thumbs', h, t); }
    }
    return t || null;
  };
  window.putIdbImageBlob = async (h, blob) => {
    if (!h || !blob) return;
    await idbPut('images', h, blob);
    await ensureLocalUrl(h);
  };
  window.putIdbThumbBlob = async (h, blob) => {
    if (!h || !blob) return;
    await idbPut('thumbs', h, blob);
    setThumbUrl(h, blob);
    updateThumbDom(h);
  };
  window.hasLocalThumbHashAsync = async (h) => {
    if (!h) return false;
    if (thumbMap.has(h)) return true;
    try { return !!(await idbGet('thumbs', h)); } catch (_) { return false; }
  };
  window.refreshThumbDomAll = () => {
    document.querySelectorAll('img[data-thumb-ref]').forEach(el => {
      const h = el.dataset.thumbRef;
      const tu = h && (thumbMap.get(h) || hashToUrl.get(h));
      if (tu) {
        el.src = tu;
        el.removeAttribute('data-thumb-ref');
      }
    });
  };
  window.idbImageDataUrl = async (h) => {
    const blob = await idbGet('images', h); if (!blob) return null;
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  };
  // クラウドにしかない画像は、画面に出たとき（または投稿・読込で必要になったとき）だけ端末に取り込む
  const lazyQueue = new Set(), lazyBusy = new Set(), lazyFailed = new Set(); let lazyWorkers = 0, lazyRefresh = null;
  const thumbQueue = new Set(), thumbBusy = new Set(), thumbFailed = new Set(); let thumbWorkers = 0;
  function updateThumbDom(h) {
    const tu = thumbMap.get(h) || hashToUrl.get(h);
    if (!tu) return;
    document.querySelectorAll(`img[data-thumb-ref="${CSS.escape ? CSS.escape(h) : h}"]`).forEach(el => {
      el.src = tu;
      el.removeAttribute('data-thumb-ref');
    });
  }
  function requestThumb(h) {
    if (!h) return;
    if (thumbMap.has(h)) { updateThumbDom(h); return; }
    if (hashToUrl.has(h)) {
      idbThumbBlob(h).then(tb => { if (tb) { setThumbUrl(h, tb); updateThumbDom(h); } }).catch(() => {});
      return;
    }
    if (!thumbBusy.has(h) && !thumbFailed.has(h)) {
      thumbQueue.add(h);
      drainThumbLazy();
    }
  }
  function drainThumbLazy() {
    while (thumbWorkers < 4 && thumbQueue.size) {
      const h = thumbQueue.values().next().value; thumbQueue.delete(h); thumbBusy.add(h); thumbWorkers++;
      (async () => {
        let ok = false;
        try {
          if (thumbMap.has(h)) {
            ok = true;
          } else {
            const tb = await idbGet('thumbs', h);
            if (tb) { setThumbUrl(h, tb); ok = true; }
          }
          if (!ok) {
            const fullB = await idbGet('images', h);
            if (fullB) {
              await ensureLocalUrl(h);
              const made = await makeThumb(fullB);
              if (made) { await idbPut('thumbs', h, made); setThumbUrl(h, made); }
              ok = true;
            }
          }
          if (!ok && window.CloudSync && typeof window.CloudSync.fetchThumbBlob === 'function') {
            const cb = await window.CloudSync.fetchThumbBlob(h);
            if (thumbMap.has(h)) {
              ok = true;
            } else if (cb) {
              await idbPut('thumbs', h, cb);
              setThumbUrl(h, cb);
              ok = true;
            }
          }
          if (ok) {
            updateThumbDom(h);
          } else if (window.cloudImagesReady) {
            // サムネイル専用ファイルが無い場合のみ従来ルートへフォールバック
            requestImage(h);
          } else {
            thumbFailed.add(h);
          }
        } catch (e) {
          thumbFailed.add(h);
          logSoft('drainThumbLazy', e);
        } finally {
          thumbBusy.delete(h); thumbWorkers--;
          drainThumbLazy();
        }
      })();
    }
  }
  function requestImage(h) { if (h && !hashToUrl.has(h) && !lazyBusy.has(h) && !lazyFailed.has(h)) { lazyQueue.add(h); drainLazy(); } }
  function requestRefsIn(o) { walkStrings(o, v => { if (v.startsWith('@img:')) requestImage(v.slice(5)); }); }
  function collectImageHashesIn(root) {
    const out = new Set();
    if (!root || typeof root !== 'object') return out;
    walkStrings(root, v => { if (v && v.startsWith('@img:')) out.add(v.slice(5)); else if (v && v.startsWith('blob:')) { const h = imgUrlToHash.get(v); if (h) out.add(h); } });
    return out;
  }
  window.requestRefsIn = requestRefsIn;
  window.collectImageHashesIn = collectImageHashesIn;
  window.hasLocalImageHash = h => !!(h && (storedHashes.has(h) || hashToUrl.has(h)));
  window.hasLocalImageHashAsync = async h => {
    if (!h) return false;
    if (storedHashes.has(h) || hashToUrl.has(h)) return true;
    try { return !!(await idbGet('images', h)); } catch (_) { return false; }
  };
  window.ensureLocalImageByHash = async (h) => {
    if (!h) return false;
    await ensureLocalUrl(h);
    if (hashToUrl.has(h)) return true;
    try {
      let stored = false;
      if (window.CloudSync && typeof window.CloudSync.fetchFullImageBlob === 'function') {
        const b = await window.CloudSync.fetchFullImageBlob(h);
        if (hashToUrl.has(h)) stored = true;
        else if (b) { await idbPut('images', h, b); await ensureLocalUrl(h); stored = true; }
      }
      if (!stored && typeof window.cloudFetchImage === 'function') {
        const d = await window.cloudFetchImage(h);
        if (d) { await idbPut('images', h, dataURLtoBlob(d)); await ensureLocalUrl(h); stored = true; }
      }
      if (!stored && window.CloudSync && typeof window.CloudSync.fetchMissingImageBlob === 'function') {
        const b2 = await window.CloudSync.fetchMissingImageBlob(h);
        if (b2) { await idbPut('images', h, b2); await ensureLocalUrl(h); stored = true; }
      }
      if (stored) {
        const a = replaceRefs(appState);
        replaceRefs(blockOrder);
        if (a && typeof renderDBView === 'function') renderDBView();
      }
      return stored || hashToUrl.has(h);
    } catch (e) { console.error(e); return false; }
  };
  window.releaseLocalImageHash = async (h) => {
    if (!h) return false;
    await persistChain;
    try {
      const existingThumb = await idbGet('thumbs', h);
      if (!existingThumb) {
        const fullB = await idbGet('images', h);
        if (fullB) {
          const made = await makeThumb(fullB);
          if (made) { await idbPut('thumbs', h, made); setThumbUrl(h, made); }
        }
      } else if (!thumbMap.has(h)) {
        setThumbUrl(h, existingThumb);
      }
    } catch (e) { logSoft('releaseKeepThumb', e); }
    const u = hashToUrl.get(h);
    if (u) {
      const revertRefs = root => {
        if (!root || typeof root !== 'object') return;
        walkStrings(root, v => (v === u ? '@img:' + h : undefined));
      };
      if (typeof appState !== 'undefined') revertRefs(appState);
      if (typeof blockOrder !== 'undefined') revertRefs(blockOrder);
      if (typeof secretHOs !== 'undefined') revertRefs(secretHOs);
      try { URL.revokeObjectURL(u); } catch (e) { logSoft('revokeImg', e); }
      hashToUrl.delete(h);
      imgUrlToHash.delete(u);
    }
    storedHashes.delete(h);
    if (typeof idbDel === 'function') await idbDel('images', h);
    return true;
  };
  window.fetchMissingImages = () => {
    lazyFailed.forEach(h => lazyQueue.add(h)); lazyFailed.clear();
    document.querySelectorAll('img[data-ref]').forEach(el => { if (el.dataset.ref) lazyQueue.add(el.dataset.ref); });
    drainLazy();
    thumbFailed.forEach(h => thumbQueue.add(h)); thumbFailed.clear();
    document.querySelectorAll('img[data-thumb-ref]').forEach(el => { if (el.dataset.thumbRef) thumbQueue.add(el.dataset.thumbRef); });
    drainThumbLazy();
  };
  async function convertSourceToWebpRef(source, opts) {
    const o = opts || {};
    const maxDim = Number(o.maxDim) > 0 ? Number(o.maxDim) : 800;
    const quality = Number(o.quality) > 0 ? Number(o.quality) : 0.82;
    let srcBlob = null;
    if (source instanceof Blob) {
      srcBlob = source;
    } else if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
      srcBlob = new Blob([source], { type: o.mime || 'image/png' });
    } else if (typeof source === 'string') {
      const s = source.trim();
      if (!s) return null;
      if (s.startsWith('@img:')) {
        const h = s.slice(5);
        srcBlob = await idbGet('images', h);
        if (!srcBlob && window.CloudSync && typeof window.CloudSync.fetchFullImageBlob === 'function') {
          srcBlob = await window.CloudSync.fetchFullImageBlob(h);
        }
      } else if (s.startsWith('data:image/')) {
        srcBlob = dataURLtoBlob(s);
      } else if (s.startsWith('blob:')) {
        const h = imgUrlToHash.get(s);
        if (h) srcBlob = await idbGet('images', h);
        if (!srcBlob) {
          try { const res = await fetch(s); if (res.ok) srcBlob = await res.blob(); } catch (_) {}
        }
      } else if (window.WebBridge && WebBridge.isAssetRef && WebBridge.isAssetRef(s)) {
        const rec = await WebBridge.getAssetRecord(s).catch(() => null);
        if (rec && rec.blob) srcBlob = rec.blob;
      } else if (typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON && typeof fs !== 'undefined' && fs && fs.promises) {
        try {
          const buf = await fs.promises.readFile(s);
          const mime = (window.WebBridge && WebBridge.mimeFromName) ? WebBridge.mimeFromName(s) : 'image/png';
          srcBlob = new Blob([buf], { type: mime });
        } catch (_) {}
      }
    }
    if (!srcBlob) return null;

    let bmp = null, imgEl = null, w = 0, h = 0, objUrl = '';
    try {
      if (typeof createImageBitmap === 'function') {
        bmp = await createImageBitmap(srcBlob);
        w = bmp.width; h = bmp.height;
      } else {
        throw new Error('no createImageBitmap');
      }
    } catch (_) {
      objUrl = URL.createObjectURL(srcBlob);
      imgEl = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = objUrl;
      }).catch(() => null);
      if (!imgEl) {
        if (objUrl) try { URL.revokeObjectURL(objUrl); } catch (_) {}
        return null;
      }
      w = imgEl.naturalWidth || imgEl.width;
      h = imgEl.naturalHeight || imgEl.height;
    }

    try {
      if (!w || !h) return null;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d', { alpha: true });
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(bmp || imgEl, 0, 0, cw, ch);
      if (bmp && bmp.close) bmp.close();
      if (objUrl) try { URL.revokeObjectURL(objUrl); } catch (_) {}

      let webpBlob = await new Promise(r => canvas.toBlob(r, 'image/webp', quality));
      if (!webpBlob) webpBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!webpBlob) return null;

      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result || ''));
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(webpBlob);
      });
      if (!dataUrl) return null;

      const hash = hashStr(dataUrl);
      await idbPut('images', hash, webpBlob);
      storedHashes.add(hash);
      let blobUrl = hashToUrl.get(hash);
      if (!blobUrl) {
        blobUrl = URL.createObjectURL(webpBlob);
        hashToUrl.set(hash, blobUrl);
        imgUrlToHash.set(blobUrl, hash);
      }
      updateImageDom(hash);
      const tb = await makeThumb(webpBlob);
      if (tb) {
        await idbPut('thumbs', hash, tb);
        setThumbUrl(hash, tb);
        updateThumbDom(hash);
      }
      return { ref: '@img:' + hash, hash, dataUrl, blobUrl, size: webpBlob.size, width: cw, height: ch };
    } catch (e) {
      if (bmp && bmp.close) try { bmp.close(); } catch (_) {}
      if (objUrl) try { URL.revokeObjectURL(objUrl); } catch (_) {}
      logSoft('convertSourceToWebpRef', e);
      return null;
    }
  }
  window.convertSourceToWebpRef = convertSourceToWebpRef;
  window.updateImageDom = updateImageDom;
  window.getLocalImageBlobUrl = h => (h ? (hashToUrl.get(String(h)) || '') : '');
  window.imgSrc = imgSrc;
  function drainLazy() {
    if (!window.cloudImagesReady && !(window.CloudSync && window.CloudSync.canDownloadFromCloud && window.CloudSync.canDownloadFromCloud())) return;
    while (lazyWorkers < 3 && lazyQueue.size) {
      const h = lazyQueue.values().next().value; lazyQueue.delete(h); lazyBusy.add(h); lazyWorkers++;
      (async () => {
        try {
          await ensureLocalUrl(h);
          let stored = hashToUrl.has(h);
          if (!stored && window.CloudSync && typeof window.CloudSync.fetchFullImageBlob === 'function') {
            const b = await window.CloudSync.fetchFullImageBlob(h);
            if (hashToUrl.has(h)) stored = true;
            else if (b) { await idbPut('images', h, b); await ensureLocalUrl(h); stored = true; }
          }
          if (!stored && typeof window.cloudFetchImage === 'function') {
            const d = await window.cloudFetchImage(h);
            if (d) { await idbPut('images', h, dataURLtoBlob(d)); await ensureLocalUrl(h); stored = true; }
          }
          if (!stored && window.CloudSync && typeof window.CloudSync.fetchMissingImageBlob === 'function') {
            const b = await window.CloudSync.fetchMissingImageBlob(h);
            if (b) { await idbPut('images', h, b); await ensureLocalUrl(h); }
          }
        }
        catch (e) { console.error(e); }
        if (!hashToUrl.has(h)) lazyFailed.add(h);
        lazyBusy.delete(h); lazyWorkers--;
        clearTimeout(lazyRefresh);
        lazyRefresh = setTimeout(() => {
          const a = replaceRefs(appState), b = replaceRefs(blockOrder);
          if (a) {
            renderDBView();
            if (typeof renderGalleryAll === 'function') renderGalleryAll();
            if (typeof loadBotAvatarToUI === 'function') loadBotAvatarToUI();
            if (window.CCF && CCF.S && CCF.S.ready) {
              if (typeof CCF.renderCenter === 'function') CCF.renderCenter();
              if (typeof CCF.renderProps === 'function') CCF.renderProps();
            }
          }
          if (b) { renderBlockUI(); renderPreview(); }
        }, 300);
        drainLazy();
      })();
    }
  }
  function imgAttr(u) {
    u = String(u || '');
    if (u.startsWith('@img:')) {
      const h = u.slice(5);
      if (hashToUrl.has(h)) return `src="${escapeHTML(hashToUrl.get(h))}"`;
      return `src="${PLACEHOLDER}" data-ref="${escapeHTML(h)}"`;
    }
    return `src="${escapeHTML(thumbSrc(u))}"`;
  }
  function imgThumbAttr(u) {
    u = String(u || '');
    if (u.startsWith('@img:')) {
      const h = u.slice(5);
      if (thumbMap.has(h)) return `src="${escapeHTML(thumbMap.get(h))}"`;
      return `src="${PLACEHOLDER}" data-thumb-ref="${escapeHTML(h)}"`;
    }
    return `src="${escapeHTML(thumbSrc(u))}"`;
  }
  if (typeof window !== 'undefined' && !window.imgAttr) window.imgAttr = imgAttr;
  if (typeof window !== 'undefined' && !window.imgThumbAttr) window.imgThumbAttr = imgThumbAttr;
  const lazyIO = ('IntersectionObserver' in window) ? new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    lazyIO.unobserve(e.target);
    if (e.target.dataset.thumbRef) requestThumb(e.target.dataset.thumbRef);
    else if (e.target.dataset.ref) requestImage(e.target.dataset.ref);
  }), { rootMargin: '300px' }) : null;
  const lazyMO = new MutationObserver(() => {
    document.querySelectorAll('img[data-ref]:not([data-obs]), img[data-thumb-ref]:not([data-obs])').forEach(i => {
      i.dataset.obs = '1';
      if (lazyIO) lazyIO.observe(i);
      else if (i.dataset.thumbRef) requestThumb(i.dataset.thumbRef);
      else requestImage(i.dataset.ref);
    });
  });
  const startLazyMO = () => lazyMO.observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startLazyMO); else startLazyMO();

  function toast(msg, kind) {
    msg = String(msg); kind = kind || (/^(❌|⚠️)/.test(msg) ? 'error' : /^✅/.test(msg) ? 'success' : 'info');
    let box = document.getElementById('toast-box');
    if (!box) { box = document.createElement('div'); box.id = 'toast-box'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast toast-' + kind; t.textContent = msg; t.onclick = () => t.remove(); box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3000);
  }
  let dragFrom = null;
  function enhanceSortable(container) {
    [...container.children].forEach((item, idx) => {
      const hd = item.querySelector('.sortable-header'); if (!hd) return;
      const h = document.createElement('span'); h.className = 'drag-handle'; h.textContent = '⠿'; h.title = 'ドラッグで並べ替え'; h.draggable = true;
      h.addEventListener('dragstart', e => { dragFrom = idx; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'block'); try { e.dataTransfer.setDragImage(item, 20, 20); } catch (x) { logSoft('enhanceSortable', x); } item.classList.add('dragging'); });
      h.addEventListener('dragend', () => { dragFrom = null; container.querySelectorAll('.dragging,.drag-over-top,.drag-over-bottom').forEach(x => x.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom')); });
      h.addEventListener('click', e => e.stopPropagation()); hd.prepend(h);
      const before = e => { const r = item.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; };
      item.addEventListener('dragover', e => { if (dragFrom === null) return; e.preventDefault(); e.stopPropagation(); const b = before(e); item.classList.toggle('drag-over-top', b); item.classList.toggle('drag-over-bottom', !b); });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over-top', 'drag-over-bottom'));
      item.addEventListener('drop', e => {
        if (dragFrom === null) return; e.preventDefault(); e.stopPropagation();
        const from = dragFrom; dragFrom = null; let to = idx + (before(e) ? 0 : 1); if (to > from) to--;
        if (to !== from) { if (window.AppHistory) window.AppHistory.checkpoint('ブロック並べ替え'); const t = blockOrder.splice(from, 1)[0]; blockOrder.splice(to, 0, t); renderBlockUI(); renderPreview(); }
      });
    });
  }


  // ---- 画像データの SHA-256 ハッシュ（名前が違っても中身が同一の画像を判定するための共通ユーティリティ） ----
  // window.ImageSha.ofSource(src, owner)  : data: / blob: / @img: / file パス / file: URL の画像ソース → hex（取得不可は ''）
  // window.ImageSha.ofItem(item)          : { dataUrl | path } を持つ素材オブジェクト用（結果は WeakMap にキャッシュ）
  (function () {
    const itemCache = new WeakMap();      // item → { src, sha }
    const pathCache = new Map();          // path|mtime → sha
    const srcCache = new Map();           // 短いsrc → sha（LRU 簡易）
    const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    async function digest(bytes) {
      try {
        if (window.crypto && crypto.subtle) return toHex(await crypto.subtle.digest('SHA-256', bytes));
      } catch (_) { }
      try { if (window.CloudCodec && CloudCodec.sha256Hex) return String(await CloudCodec.sha256Hex(bytes)).toLowerCase(); } catch (_) { }
      try { return require('crypto').createHash('sha256').update(Buffer.from(bytes)).digest('hex'); } catch (_) { }
      return '';
    }
    function dataUrlBytes(u) {
      const i = u.indexOf(',');
      if (i < 0) return null;
      const meta = u.slice(0, i), body = u.slice(i + 1);
      if (/;base64/i.test(meta)) {
        const bin = atob(body), arr = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        return arr;
      }
      return new TextEncoder().encode(decodeURIComponent(body));
    }
    async function bytesOfSource(src) {
      const u = String(src || '');
      if (!u) return null;
      if (u.startsWith('data:')) return dataUrlBytes(u);
      let hashKey = '';
      if (u.startsWith('@img:')) hashKey = u.slice(5);
      else if (/^blob:/i.test(u)) hashKey = imgUrlToHash.get(u) || '';
      if (hashKey) {
        try { const b = await idbGet('images', hashKey); if (b) return new Uint8Array(await b.arrayBuffer()); } catch (_) { }
      }
      if (/^(?:blob:|https?:|file:)/i.test(u)) {
        try { const r = await fetch(u); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch (_) { }
        return null;
      }
      if (u.startsWith('@img:') || /^cloud-asset:/i.test(u)) return null;
      try {
        if (typeof fs !== 'undefined' && fs.promises) {
          const st = await fs.promises.stat(u);
          return new Uint8Array(await fs.promises.readFile(u));
        }
      } catch (_) { }
      return null;
    }
    async function ofSource(src) {
      const u = String(src || '');
      if (!u) return '';
      const ck = u.length <= 400 ? u : '';
      if (ck && srcCache.has(ck)) return srcCache.get(ck);
      let sha = '';
      try {
        const bytes = await bytesOfSource(u);
        if (bytes && bytes.length) sha = await digest(bytes);
      } catch (_) { sha = ''; }
      if (ck && sha) { srcCache.set(ck, sha); if (srcCache.size > 400) srcCache.delete(srcCache.keys().next().value); }
      return sha;
    }
    async function ofItem(item) {
      if (!item) return '';
      const src = String(item.dataUrl || item.path || '');
      if (!src) return '';
      const hit = itemCache.get(item);
      if (hit && hit.src === src) return hit.sha;
      let sha = '';
      if (item.dataUrl) sha = await ofSource(item.dataUrl);
      else {
        let mt = 0;
        try { if (typeof fs !== 'undefined' && fs.statSync) mt = fs.statSync(item.path).mtimeMs || 0; } catch (_) { }
        const k = item.path + '|' + mt;
        if (pathCache.has(k)) sha = pathCache.get(k);
        else { sha = await ofSource(item.path); if (sha) pathCache.set(k, sha); }
      }
      if (sha) itemCache.set(item, { src, sha });
      return sha;
    }
    window.ImageSha = { ofSource, ofItem, ofBytes: async bytes => digest(bytes) };
  })();
