// Electron のメインプロセス。ローカルファイルを扱うため、レンダラーで Node.js（fs / path / shell）を使えるようにしてある。
const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const http = require('http');
const path = require('path');
const ccf = require('./ccfolia/main/ccf_main.js');   // ココフォリア特化ツールのメインプロセス側（_TRPG_Data・zipview://・PDFポップアウトIPC・開くダイアログ）

// レンダラーで Node.js を直接使うための設定（旧仕様のまま維持：preload を介さず require('fs') などを使う）
const WEB_PREFERENCES = {
  nodeIntegration: true,      // レンダラーから require('fs') などを使う
  contextIsolation: false     // 同上（preload を介さず、直接 Node.js のAPIを使う）
};

// データ保存用ルートフォルダ。起動時に（無ければ）自動作成する。レンダラー側（app_test49_00_electron.js）も同じ場所を参照する。
const DATA_ROOT = path.join(__dirname, '_TRPG_Data');
ccf.ensureDataDirs(DATA_ROOT);

// 独自プロトコル zipview:// の権限登録は、app の ready より前に行う必要がある
ccf.registerSchemes();

let mainWindow = null, ccfMain = null;
let allowWindowClose = false;
let closeAckReceived = false;
let closeFallbackTimer = null;

function createWindow() {
  allowWindowClose = false;
  closeAckReceived = false;
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f4f5f7',
    title: '卓工房 - TAKU-KOBO | TRPG GM総合支援ツール',
    webPreferences: WEB_PREFERENCES
  });
  mainWindow = win;
  win.setMenuBarVisibility(false);
  const showWindowNow = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', showWindowNow);
  win.webContents.once('dom-ready', showWindowNow);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', (e) => {
    if (allowWindowClose) return;
    if (!win.webContents || win.webContents.isDestroyed()) return;
    e.preventDefault();
    closeAckReceived = false;
    clearTimeout(closeFallbackTimer);
    try {
      win.webContents.send('app:request-close-sync');
    } catch (_) {
      allowWindowClose = true;
      win.close();
      return;
    }
    // レンダラーが応答しない（クラッシュ等）場合のみ安全に閉じる
    closeFallbackTimer = setTimeout(() => {
      if (!closeAckReceived && !win.isDestroyed()) {
        allowWindowClose = true;
        win.close();
      }
    }, 2000);
  });
  win.on('closed', () => {
    clearTimeout(closeFallbackTimer);
    if (mainWindow === win) mainWindow = null;
    if (ccfMain) ccfMain.closePopout();
  });   // メインを閉じたら、切り離したPDFウィンドウも閉じる
}

ipcMain.on('app:close-ack', () => {
  closeAckReceived = true;
  clearTimeout(closeFallbackTimer);
});

ipcMain.on('app:confirm-close', () => {
  clearTimeout(closeFallbackTimer);
  allowWindowClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

app.whenReady().then(() => {
  ccfMain = ccf.setup({ appDir: __dirname, dataRoot: DATA_ROOT, getMainWindow: () => mainWindow, webPreferences: WEB_PREFERENCES });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

function buildGoogleAuthHtml(firebaseConfig, authOptions) {
  const safeCfg = JSON.stringify(firebaseConfig).replace(/</g, '\\u003c');
  const o = authOptions || {};
  const safeOpts = JSON.stringify({
    silent: !!o.silent,
    loginHint: o.loginHint ? String(o.loginHint) : '',
    prompt: o.prompt ? String(o.prompt) : ''
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Googleアカウントでログイン</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f4f5f7; color: #222; }
    .card { background: #fff; border-radius: 12px; padding: 28px 24px; box-shadow: 0 4px 20px rgba(0,0,0,.08); text-align: center; max-width: 340px; width: 90%; }
    h1 { font-size: 16px; margin: 0 0 10px; }
    p { font-size: 13px; color: #555; margin: 0 0 16px; line-height: 1.5; }
    button { display: none; padding: 10px 18px; font-size: 14px; font-weight: 600; border: 0; border-radius: 8px; background: #1a73e8; color: #fff; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Googleアカウントでログイン</h1>
    <p id="msg">Googleの認証画面を開いています…</p>
    <button id="retryBtn" type="button">Googleログイン画面を開く</button>
  </div>
  <script type="module">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
    import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

    const cfg = ${safeCfg};
    const authOpts = ${safeOpts};
    const msgEl = document.getElementById('msg');
    const retryBtn = document.getElementById('retryBtn');
    const app = initializeApp(cfg);
    const auth = getAuth(app);

    async function sendResult(payload) {
      try {
        await fetch('/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (_) {}
    }

    async function runAuth() {
      retryBtn.style.display = 'none';
      msgEl.textContent = 'Googleの認証画面を開いています…';
      try {
        const provider = new GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/drive.file');
        const customParams = {
          prompt: authOpts.prompt || (authOpts.silent ? 'none' : 'select_account')
        };
        if (authOpts.loginHint) {
          customParams.login_hint = authOpts.loginHint;
        }
        provider.setCustomParameters(customParams);
        const result = await signInWithPopup(auth, provider);
        const cred = GoogleAuthProvider.credentialFromResult(result);
        const idToken = cred && cred.idToken ? cred.idToken : null;
        const accessToken = cred && cred.accessToken ? cred.accessToken : null;
        const email = (result && result.user && result.user.email) ? String(result.user.email) : '';
        const expiresIn = (result && result._tokenResponse && Number(result._tokenResponse.expiresIn)) || 3600;
        if (!idToken && !accessToken) {
          throw new Error('Google認証トークンを取得できませんでした。');
        }
        msgEl.textContent = '認証が完了しました。ウィンドウを閉じています…';
        await sendResult({ ok: true, idToken, accessToken, email, expiresIn, obtainedAt: Date.now() });
      } catch (err) {
        const code = err && err.code ? String(err.code) : '';
        if (code === 'auth/popup-blocked' && !authOpts.silent) {
          msgEl.textContent = 'ポップアップがブロックされました。下のボタンからログインを続行してください。';
          retryBtn.style.display = 'inline-block';
          try { await fetch('/show-host', { method: 'POST' }); } catch (_) {}
          return;
        }
        await sendResult({ ok: false, code, message: (err && err.message) ? err.message : String(err) });
      }
    }

    retryBtn.addEventListener('click', runAuth);
    void runAuth();
  </script>
</body>
</html>`;
}

ipcMain.handle('auth:google-login', async (event, arg) => {
  const reqObj = (arg && arg.firebaseConfig) ? arg : { firebaseConfig: arg };
  const firebaseConfig = reqObj.firebaseConfig;
  const silent = !!reqObj.silent;
  const loginHint = reqObj.loginHint ? String(reqObj.loginHint) : '';
  const prompt = reqObj.prompt ? String(reqObj.prompt) : '';

  if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.projectId) {
    return { ok: false, code: 'auth/invalid-config', message: 'Firebase設定が不正です。' };
  }

  return new Promise((resolve) => {
    let settled = false;
    let authWin = null;
    let childWin = null;
    let silentTimer = null;
    const html = buildGoogleAuthHtml(firebaseConfig, { silent, loginHint, prompt });

    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/show-host') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        if (!silent && authWin && !authWin.isDestroyed()) {
          try { authWin.show(); authWin.focus(); } catch (_) {}
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/callback') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1024 * 1024) req.destroy();
        });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}', () => {
            try {
              const parsed = JSON.parse(body || '{}');
              finish(parsed);
            } catch (e) {
              finish({ ok: false, code: 'auth/internal-error', message: '認証結果の解析に失敗しました。' });
            }
          });
        });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    });

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(silentTimer);
      if (childWin && !childWin.isDestroyed()) {
        try { childWin.close(); } catch (_) {}
      }
      childWin = null;
      if (authWin && !authWin.isDestroyed()) {
        try { authWin.close(); } catch (_) {}
      }
      authWin = null;
      try { server.closeAllConnections?.(); } catch (_) {}
      try { server.close(); } catch (_) {}
      resolve(result);
    }

    server.on('error', (err) => {
      finish({ ok: false, code: 'auth/internal-error', message: err && err.message ? err.message : String(err) });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      if (!port) {
        finish({ ok: false, code: 'auth/internal-error', message: 'ローカル認証サーバーの起動に失敗しました。' });
        return;
      }

      const parentWin = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
      authWin = new BrowserWindow({
        width: 500,
        height: 660,
        parent: parentWin,
        modal: false,
        show: false,
        autoHideMenuBar: true,
        title: 'Googleアカウントでログイン',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: session.defaultSession
        }
      });

      authWin.setMenuBarVisibility(false);
      authWin.webContents.setWindowOpenHandler(() => ({
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 660,
          parent: silent ? authWin : parentWin,
          modal: false,
          show: !silent,
          autoHideMenuBar: true,
          title: 'Googleアカウントでログイン',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            session: session.defaultSession
          }
        }
      }));
      authWin.webContents.on('did-create-window', (win) => {
        childWin = win;
        win.setMenuBarVisibility(false);
        if (!silent) {
          win.once('ready-to-show', () => {
            if (!win.isDestroyed()) { win.show(); win.focus(); }
          });
        }
        win.on('closed', () => {
          if (childWin === win) childWin = null;
        });
      });

      authWin.on('closed', () => {
        authWin = null;
        finish({ ok: false, code: 'auth/popup-closed-by-user', message: 'ログイン画面が閉じられました。' });
      });

      if (silent) {
        silentTimer = setTimeout(() => {
          finish({ ok: false, code: 'auth/silent-timeout', message: 'サイレント認証がタイムアウトしました。' });
        }, 12000);
      }

      authWin.loadURL(`http://localhost:${port}/`).catch((err) => {
        finish({ ok: false, code: 'auth/internal-error', message: err && err.message ? err.message : String(err) });
      });
    });
  });
});

ipcMain.handle('cloud:pick-sync-folder', async (event) => {
  const parentWin = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
  const res = await dialog.showOpenDialog(parentWin, {
    title: '保存先・クラウド同期フォルダを選択（OneDrive / Dropbox / Google Drive等）',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths || !res.filePaths.length) {
    return { ok: false, canceled: true };
  }
  const chosen = path.resolve(res.filePaths[0]);
  const appDir = path.resolve(__dirname);
  const dataDir = path.resolve(DATA_ROOT);
  const norm = p => process.platform === 'win32' ? p.toLowerCase() : p;
  const cNorm = norm(chosen), aNorm = norm(appDir), dNorm = norm(dataDir);
  if (
    cNorm === aNorm ||
    cNorm === dNorm ||
    cNorm.startsWith(dNorm + path.sep) ||
    cNorm.includes(path.sep + 'node_modules')
  ) {
    return {
      ok: false,
      message: 'アプリ本体フォルダ・_TRPG_Data・node_modules は同期先として指定できません。別のクラウド同期フォルダを選択してください。'
    };
  }
  return { ok: true, path: chosen };
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
module.exports = { get mainWindow() { return mainWindow; }, get ccfMain() { return ccfMain; }, DATA_ROOT };   // 開発用テスト（ccfolia/tests/e2e_main.js）が参照する
