'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT_DIR = path.resolve(__dirname);
const START_PORT = 5500;
const MAX_TRY_PORT = 5550;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, err => {
    if (err) {
      console.warn('[local_server] ブラウザの自動起動に失敗しました。手動で開いてください:', url);
    }
  });
}

function resolveSafePath(reqUrl) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(String(reqUrl || '/').split('?')[0]);
  } catch (_) {
    return null;
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const rel = pathname.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT_DIR, rel);
  const rootPrefix = ROOT_DIR.endsWith(path.sep) ? ROOT_DIR : ROOT_DIR + path.sep;
  if (resolved !== ROOT_DIR && !resolved.startsWith(rootPrefix)) {
    return null;
  }
  return resolved;
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    let filePath = resolveSafePath(req.url);
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, st) => {
      if (!err && st.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        fs.stat(filePath, (err2, st2) => serveFile(err2, st2, filePath, req, res));
        return;
      }
      serveFile(err, st, filePath, req, res);
    });
  });
}

function serveFile(err, st, filePath, req, res) {
  if (err || !st || !st.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': st.size,
    'Cache-Control': 'no-store'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal Server Error');
  });
  stream.pipe(res);
}

function startListening(port) {
  const server = createServer();
  server.on('error', err => {
    if (err && err.code === 'EADDRINUSE') {
      if (port > 0 && port < MAX_TRY_PORT) {
        startListening(port + 1);
      } else if (port !== 0) {
        startListening(0);
      } else {
        console.error('[local_server] 空きポートが見つかりませんでした:', err);
        process.exit(1);
      }
      return;
    }
    console.error('[local_server] サーバー起動エラー:', err);
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const actualPort = addr && typeof addr === 'object' ? addr.port : port;
    const url = `http://localhost:${actualPort}/index.html`;
    console.log('==================================================');
    console.log('卓工房 Web版 (localhost) サーバーを起動しました');
    console.log(`URL: ${url}`);
    console.log('終了するにはこのウィンドウを閉じるか Ctrl+C を押してください');
    console.log('==================================================');
    openBrowser(url);
  });
}

startListening(START_PORT);
