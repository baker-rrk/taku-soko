/* pdf_window.js — 切り離した PDF ビューアウィンドウ側の処理
 *  メイン画面とは Electron の IPC（メインプロセス経由）でつながる。
 *   受信  ccf:pdf-open  { path, page, zoom } … 開く PDF を指示される
 *   送信  ccf:extract   { raw, shift, page, via, name } … 選択した文字列（メイン画面の抽出バッファへ入る）
 *   送信  ccf:pdf-state { path, name, page, zoom, pages } … 開いているページなどの状態（メイン側のプロジェクトに記録）
 *   終了時（ウィンドウを閉じる）はメインプロセスが ccf:popout-closed をメイン画面へ送り、メイン側のビューアが PDF を引き継ぐ。 */
(function () {
  'use strict';
  const isElectron = typeof require === 'function' && typeof process !== 'undefined' && !!(process.versions && process.versions.electron);
  const ipcRenderer = isElectron ? require('electron').ipcRenderer : null;
  const nodePath = isElectron ? require('path') : null;
  const url = isElectron ? require('url') : null;
  const appDir = isElectron ? nodePath.resolve(nodePath.dirname(url.fileURLToPath(location.href)), '..') : '';
  const bc = (!isElectron && typeof BroadcastChannel === 'function') ? new BroadcastChannel('ccf_pdf_popout') : null;
  const listeners = new Map();
  function emitLocal(ch, payload) { (listeners.get(ch) || []).forEach(fn => fn(null, payload)); }
  const bus = {
    send(ch, payload) {
      if (ipcRenderer) return ipcRenderer.send(ch, payload);
      if (bc) bc.postMessage({ ch, payload });
      else if (window.opener && !window.opener.closed) window.opener.postMessage({ __ccfPopout: true, ch, payload }, '*');
    },
    on(ch, fn) {
      if (ipcRenderer) return ipcRenderer.on(ch, fn);
      if (!listeners.has(ch)) listeners.set(ch, []);
      listeners.get(ch).push(fn);
    }
  };
  if (!isElectron) {
    if (bc) bc.onmessage = ev => { if (ev.data && ev.data.ch) emitLocal(ev.data.ch, ev.data.payload); };
    window.addEventListener('message', ev => { if (ev.data && ev.data.__ccfPopout && ev.data.ch) emitLocal(ev.data.ch, ev.data.payload); });
    window.addEventListener('beforeunload', () => bus.send('ccf:popout-closed', true));
  }
  const status = document.getElementById('status');
  let statusTimer = null;
  const say = (m, ms) => { status.textContent = m; clearTimeout(statusTimer); if (ms) statusTimer = setTimeout(() => { status.textContent = 'ここで選択したテキストは、メイン画面の「抽出バッファ」へ送られます'; }, ms); };

  let pos = {}, bookmarks = [];   // PDFごとの前回のページ位置（メインから受け取り、この窓でも更新する）／しおり
  const viewer = window.__ccfViewer = CCFPdfViewer.create(document.getElementById('viewer'), {
    appDir,
    spread: true,   // 別ウィンドウだけ「単ページ表示 ⇔ 見開き表示」のトグルを出す
    popout: { label: '✕ 別ウィンドウを閉じる', title: 'この別ウィンドウを閉じます（メイン画面のPDFビューアは独立して使えます）', onClick: () => { if (ipcRenderer) ipcRenderer.send('ccf:popout-close'); else window.close(); } },
    getBookmarks: () => bookmarks,
    onBookmarks: list => { bookmarks = list; bus.send('ccf:bookmarks', list); },   // しおりの保存はメイン画面（部屋データ）側で行う
    onSaveImage: img => { bus.send('ccf:save-image', img); say('🖼️ 切り抜き画像をメイン画面の「登録素材」へ送信しました', 3000); },
    onExtract(raw, info) {
      bus.send('ccf:extract', { raw, shift: !!info.shift, page: info.page, via: info.via, name: viewer.state.name, src: info.src });
      say('✅ メイン画面へ送信しました（' + raw.replace(/\s+/g, ' ').slice(0, 30) + (raw.length > 30 ? '…' : '') + '）', 3000);
    },
    onPickDoc: val => { const p = pos[val] || {}; viewer.openPath(val, { page: p.page, zoom: p.zoom }); },   // 別ウィンドウだけで別のPDFへ切り替え（メイン画面側のPDFは変わらない）
    onState(s) { if (s.path) pos[s.path] = { page: s.page, zoom: s.zoom }; bus.send('ccf:pdf-state', Object.assign({ popout: true }, s)); document.title = (s.name ? s.name + ' — ' : '') + 'PDFビューア（切り離し）'; },
    onClose() {   // 「✕ 選択解除」：メイン側にも解除を知らせる（ウィンドウを閉じたとき、解除したPDFを引き継がないように）
      bus.send('ccf:pdf-state', { path: '', name: '', page: 1, zoom: viewer.state.zoom, pages: 0, cleared: true, popout: true }); document.title = 'PDFビューア（切り離し）'; say('PDFの選択を解除しました', 3000);
    },
    onNotice: m => say('⚠️ ' + m, 4000),
    onError: e => say('❌ PDFを開けませんでした：' + (e.message || e), 6000)
  });
  const onOpenPayload = p => {
    if (p && p.docs) viewer.setDocs(p.docs); if (p && p.pos) pos = Object.assign(pos, p.pos);
    if (p && p.bookmarks) { bookmarks = p.bookmarks; viewer.setBookmarks(bookmarks); }   // メイン画面のしおり
    if (p && p.marks) viewer.setMarks(p.marks);   // 抽出済みマーカー
    if (p && p.path) viewer.openPath(p.path, { page: p.page, zoom: p.zoom });
  };
  bus.on('ccf:pdf-open', (e, p) => onOpenPayload(p));
  bus.on('ccf:popout-docs', (e, p) => onOpenPayload(p));
  bus.on('ccf:clear-selection', () => viewer.clearSelection());   // メインの「クリア」で、こちらの選択表示も消す
  bus.send('ccf:popout-ready', true);   // 受信の準備ができたことをメインプロセスへ知らせる（待たせていた PDF の指示がここで届く）
})();
