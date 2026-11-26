/* ccf_main.js — ココフォリア特化ツールの「メインプロセス側」
 *   1. _TRPG_Data（データ保存用ルート）の自動作成
 *   2. 独自プロトコル zipview://<zipId>/<エントリのパス> … ZIP の中の画像・音声を解凍せずにそのまま表示する
 *   3. ネイティブの「開く」ダイアログ（ccf:pick）
 *   4. PDF ビューアの別ウィンドウ（ポップアウト）とメイン画面の IPC 中継
 *        メイン画面 ──ccf:popout──▶ [main] ──ccf:pdf-open──▶ ポップアウト
 *        ポップアウト ──ccf:extract / ccf:pdf-state──▶ [main] ──(同名)──▶ メイン画面（抽出テキストがメイン側のバッファへ入る）
 *        ポップアウトを閉じる ─▶ メイン画面へ ccf:popout-closed（PDF をメイン側のビューアへ戻す）          */
'use strict';
const { BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const { Readable } = require('stream');
const fs = require('fs'), path = require('path'), os = require('os');
const zipStore = require('./zip_store.js');

const DATA_SUBDIRS = [path.join('ccfolia', 'projects'), path.join('ccfolia', 'exports')];

/** app が ready になる「前」に呼ぶこと（独自プロトコルの権限登録） */
function registerSchemes() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'zipview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }]);
}

/** _TRPG_Data とその下の標準フォルダを（無ければ）作る。作れなければ例外を投げず false を返す */
function ensureDataDirs(root) {
  try { fs.mkdirSync(root, { recursive: true }); DATA_SUBDIRS.forEach(d => fs.mkdirSync(path.join(root, d), { recursive: true })); return true; }
  catch (e) { console.error('[ccf] _TRPG_Data を作成できません:', root, e); return false; }
}

function setup({ appDir, dataRoot, getMainWindow, webPreferences }) {
  ensureDataDirs(dataRoot);
  let popout = null, pending = null, lastState = null;
  const sendMain = (ch, payload) => { const w = getMainWindow(); if (w && !w.isDestroyed()) w.webContents.send(ch, payload); };

  // ---- 1. 基本情報・ダイアログ ----
  ipcMain.handle('ccf:data-root', () => dataRoot);
  ipcMain.handle('ccf:proj:del', (_e, key) => {
    const safe = String(key || '').replace(/[^\w-]/g, '_');
    if (!safe) return { ok: false, deleted: false };
    const target = path.join(dataRoot, 'ccfolia', 'projects', safe + '.json');
    try {
      if (fs.existsSync(target)) { fs.unlinkSync(target); return { ok: true, deleted: true }; }
      return { ok: true, deleted: false };
    } catch (err) {
      return { ok: false, deleted: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('ccf:pick', async (e, opts) => {
    const o = opts || {};
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: String(o.title || ''), properties: Array.isArray(o.properties) ? o.properties : ['openFile'], filters: Array.isArray(o.filters) ? o.filters : undefined
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('ccf:show-item', async (e, targetPath) => {
    const p = String(targetPath || '').trim();
    if (!p) return { ok: false, error: 'パスが空です' };
    const full = path.resolve(p);
    try {
      const win = BrowserWindow.fromWebContents(e.sender) || getMainWindow();
      if (win && !win.isDestroyed() && process.platform === 'win32') {
        try { win.blur(); } catch (_) { /* noop */ }
      }
      if (fs.existsSync(full)) {
        shell.showItemInFolder(full);
      } else {
        const dir = path.dirname(full);
        if (fs.existsSync(dir)) await shell.openPath(dir);
        else return { ok: false, error: 'パスが見つかりません' };
      }
      return { ok: true, path: full };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---- 2. ZIP（非解凍）----
  ipcMain.handle('ccf:zip-open', async (e, p) => {
    try { const r = await zipStore.open(String(p || '')); return { ok: true, id: r.id, path: r.path, entries: r.entries, truncated: !!r.truncated }; }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  ipcMain.handle('ccf:zip-read', async (_e, id, name) => {
    try { const r = await zipStore.readBuffer(String(id || ''), String(name || '')); return { ok: true, buf: r.buf, mime: r.mime }; }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  ipcMain.handle('ccf:zip-close', (e, id) => { zipStore.closeZip(String(id || '')); return true; });

  // ---- 2b. HTML → しおり（アウトライン）付き PDF。見えないウィンドウで描画し、見出し（h1〜h3）を PDF の目次ツリーにする。保存先は _TRPG_Data 配下に限定 ----
  ipcMain.handle('ccf:print-pdf', async (e, o) => {
    const html = String(o && o.html || ''), out = path.resolve(String(o && o.outPath || ''));
    const root = path.resolve(dataRoot) + path.sep;
    if (!html) return { ok: false, error: 'HTML が空です' };
    if (!out.toLowerCase().startsWith(root.toLowerCase()) || !/\.pdf$/i.test(out)) return { ok: false, error: '保存先が不正です（_TRPG_Data 内の .pdf のみ）' };
    let win = null, tmp = '';
    try {
      tmp = path.join(os.tmpdir(), 'ccf_print_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.html');
      fs.writeFileSync(tmp, html, 'utf8');
      win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: false } });
      await win.loadFile(tmp);
      const buf = await win.webContents.printToPDF({
        pageSize: 'A4', printBackground: true, preferCSSPageSize: true, generateDocumentOutline: true, generateTaggedPDF: true, displayHeaderFooter: true,
        headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font-size:8px;color:#666;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
      });
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
      return { ok: true, path: out, bytes: buf.length };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    finally {
      if (win && !win.isDestroyed()) win.destroy();
      if (tmp) { try { fs.unlinkSync(tmp); } catch (er) { /* noop */ } }
    }
  });
  protocol.handle('zipview', async req => {
    try {
      const u = new URL(req.url), id = u.hostname.toLowerCase();
      const name = u.pathname.replace(/^\/+/, '').split('/').map(s => decodeURIComponent(s)).join('/');
      const stream = await zipStore.openStream(id, name);
      return new Response(Readable.toWeb(stream), { status: 200, headers: { 'content-type': zipStore.mimeOf(name), 'cache-control': 'private, max-age=3600' } });
    } catch (err) { return new Response(String(err && err.message || err), { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
  });

  // ---- 3. PDF ビューアのポップアウト ----
  function openPopout(payload) {
    pending = payload || null;
    if (popout && !popout.isDestroyed()) { if (popout.isMinimized()) popout.restore(); popout.focus(); if (pending) { popout.webContents.send('ccf:pdf-open', pending); pending = null; } return true; }
    const main = getMainWindow(), b = main && !main.isDestroyed() ? main.getBounds() : { x: 80, y: 60, width: 1200, height: 820 };
    popout = new BrowserWindow({
      x: b.x + 40, y: b.y + 40, width: 880, height: Math.max(600, b.height - 40), minWidth: 480, minHeight: 400,
      backgroundColor: '#6b6f7a', title: 'PDFビューア（切り離し）', webPreferences
    });
    popout.setMenuBarVisibility(false);
    const mine = popout;
    popout.on('closed', () => { if (popout === mine) popout = null; const st = lastState; lastState = null; sendMain('ccf:popout-closed', st); });
    popout.loadFile(path.join(appDir, 'ccfolia', 'pdf_window.html'));
    return true;
  }
  ipcMain.handle('ccf:popout', (e, payload) => openPopout(payload));
  ipcMain.handle('ccf:popout-state', () => !!(popout && !popout.isDestroyed()));
  ipcMain.on('ccf:popout-ready', e => { if (popout && e.sender === popout.webContents && pending) { popout.webContents.send('ccf:pdf-open', pending); pending = null; } });
  ipcMain.on('ccf:popout-close', () => { if (popout && !popout.isDestroyed()) popout.close(); });
  ipcMain.on('ccf:popout-docs', (e, p) => { if (popout && !popout.isDestroyed()) popout.webContents.send('ccf:pdf-open', p || {}); });   // 表示PDF一覧の更新（前面化しない）
  ipcMain.on('ccf:clear-selection', () => { if (popout && !popout.isDestroyed()) popout.webContents.send('ccf:clear-selection'); });   // メイン → ポップアウト
  ipcMain.on('ccf:extract', (e, p) => sendMain('ccf:extract', p));                                   // ポップアウト → メイン
  ipcMain.on('ccf:pdf-state', (e, p) => { lastState = p; sendMain('ccf:pdf-state', p); });
  ipcMain.on('ccf:bookmarks', (e, p) => sendMain('ccf:bookmarks', p));      // 別ウィンドウで編集したしおり → メイン画面（部屋データへ保存）
  ipcMain.on('ccf:save-image', (e, p) => sendMain('ccf:save-image', p));    // 別ウィンドウで切り抜いたPNG → メイン画面（登録素材へ追加）          // ポップアウト → メイン

  return { closePopout() { if (popout && !popout.isDestroyed()) popout.destroy(); }, getPopout: () => popout, zipStore };
}

module.exports = { registerSchemes, ensureDataDirs, setup };
