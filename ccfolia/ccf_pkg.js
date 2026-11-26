/* ccf_pkg.js — ココフォリア v1.1.0 ルーム／駒 ZIP の「中身」を組み立てる・読み解く純粋ロジック（UIなし・ブラウザでも Node でも動く）
 *
 *  __data.json の構造（UTF-8・BOMなし）:
 *    { "meta": { "version": "1.1.0" },
 *      "entities": { "room": {…}, "items": {…}, "decks": {}, "notes": {}, "characters": {…}, "effects": {}, "scenes": {…}, "savedatas": {}, "snapshots": {} },   // 9キーを必ず揃える
 *      "resources": { "<sha256 hex 64桁>": { "type": "image/png" } } }
 *  .token（UTF-8・BOMなし・66バイト）:
 *    "0." + __data.json バイナリの SHA-256（小文字64桁 hex）。ZIP 直下に置く。
 *  素材（画像・BGM・SE）は ZIP 直下に「<sha256 hex>.<ext>」で置き、各エンティティの iconUrl / backgroundUrl / foregroundUrl / imageUrl / bgmUrl / faces[].iconUrl などは
 *  その <sha256 hex>.<ext>（未設定は null）を指す。
 *  ・buildPackage(sel, resolve) … 選んだ要素から { data, files, warnings, counts } を作る。素材の読み出しは resolve(src, kind) に任せる（非同期）
 *  ・buildToken(dataOrBuf)      … __data.json のバイト列から .token 文字列（"0." + sha256 hex）を作る
 *  ・buildZipEntries(pkg)       … buildPackage の結果から ZIP 直下エントリ（__data.json / .token / 素材）を組み立てる
 *  ・parsePackage(json)         … 本家から出力された __data.json を読みやすい形にする（逆輸入用）                                            */
(function () {
  'use strict';
  const nodeCrypto = (() => { try { return typeof require === 'function' ? require('crypto') : null; } catch (e) { return null; } })();
  const HAS_BUF = typeof Buffer !== 'undefined';
  const toU8 = v => {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (typeof v === 'string') return utf8Bytes(v);
    return new Uint8Array(v || []);
  };
  const utf8Bytes = s => HAS_BUF ? Buffer.from(String(s), 'utf8') : new TextEncoder().encode(String(s));
  const b64ToBytes = b64 => {
    if (HAS_BUF) return Buffer.from(b64, 'base64');
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  const VERSION = '1.1.0';
  const str = (v, d) => (v == null ? (d || '') : String(v));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  /** status の value/max 用：必ず整数。文字列・NaN・不正値は 0 */
  function toInt(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? (Math.round(v) || 0) : 0;
    if (typeof v === 'string') { const s = v.normalize('NFKC').replace(/[,\s]/g, ''); if (!s) return 0; const n = Number(s); return Number.isFinite(n) ? (Math.round(n) || 0) : 0; }
    return 0;
  }
  /** initiative・座標などの Number（小数可）。不正値は 0 */
  function toNum(v) {
    if (typeof v === 'boolean' || typeof v === 'object' || v == null) return 0;
    const n = typeof v === 'string' ? Number(v.normalize('NFKC').trim() || NaN) : Number(v);
    return Number.isFinite(n) ? (n || 0) : 0;
  }
  /** params の value 用：必ず文字列 */
  function toStr(v) { if (v == null || typeof v === 'boolean' || typeof v === 'object') return ''; if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''; return String(v); }

  // 純JS SHA-256（ブラウザの同期呼び出し用フォールバック）
  const SHA_K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  function sha256Sync(bytes) {
    const u8 = toU8(bytes), len = u8.length, bitLen = len * 8;
    const padLen = ((len + 9 + 63) >> 6) << 6;
    const msg = new Uint8Array(padLen);
    msg.set(u8); msg[len] = 0x80;
    const dv = new DataView(msg.buffer);
    dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
    dv.setUint32(padLen - 4, bitLen >>> 0, false);
    const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const t1 = (h + S1 + ch + SHA_K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    let hex = '';
    for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0');
    return hex;
  }

  function sha256Hex(buf) {
    if (nodeCrypto) return nodeCrypto.createHash('sha256').update(buf).digest('hex');   // 64桁の16進小文字
    return sha256Sync(buf);
  }
  async function sha256HexAsync(buf) {
    if (nodeCrypto) return nodeCrypto.createHash('sha256').update(buf).digest('hex');
    const u8 = toU8(buf);
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      try {
        const ab = await crypto.subtle.digest('SHA-256', u8);
        return [...new Uint8Array(ab)].map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (_) {}
    }
    return sha256Sync(u8);
  }
  /** __data.json のバイト列（または文字列／オブジェクト）から本家形式の .token（66バイト: "0." + SHA-256 hex）を生成する */
  function buildToken(dataOrBuf) {
    const buf = (dataOrBuf instanceof Uint8Array || (HAS_BUF && Buffer.isBuffer(dataOrBuf)))
      ? dataOrBuf
      : utf8Bytes(typeof dataOrBuf === 'string' ? dataOrBuf : JSON.stringify(dataOrBuf));
    return '0.' + sha256Hex(buf);
  }
  /** buildPackage() の戻り値から ZIP 直下エントリ配列（__data.json / .token / 素材）を組み立てる */
  function buildZipEntries(pkg) {
    if (!pkg || !pkg.data) throw new Error('パッケージデータが不正です');
    const dataBuf = utf8Bytes(JSON.stringify(pkg.data));   // UTF-8・BOMなし
    const tokenBuf = utf8Bytes(buildToken(dataBuf));       // 66バイト: "0." + __data.json の SHA-256
    const entries = [
      { name: '__data.json', data: dataBuf },
      { name: '.token', data: tokenBuf }
    ];
    if (pkg.files && typeof pkg.files.forEach === 'function') {
      const res = pkg.data.resources || {};
      pkg.files.forEach((buf, fileKey) => {
        const t = (res[fileKey] && res[fileKey].type) || '';
        entries.push({ name: fileKey, data: buf, store: /^(?:audio|image|video)\/(?!svg)/.test(t) });
      });
    }
    return entries;
  }
  const isSha256 = s => /^[0-9a-f]{64}$/.test(String(s));
  function genId() {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let b = null;
    try {
      if (nodeCrypto) b = nodeCrypto.randomBytes(20);
      else if (typeof crypto !== 'undefined' && crypto.getRandomValues) b = crypto.getRandomValues(new Uint8Array(20));
    } catch (e) { b = null; }
    let s = ''; for (let i = 0; i < 20; i++) s += A[(b ? b[i] : Math.floor(Math.random() * 256)) % A.length];
    return s;
  }

  // ---------- MIME ----------
  const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', mp4: 'video/mp4', webm: 'video/webm' };
  const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/flac': 'flac', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'video/webm': 'webm' };
  const mimeOfName = n => MIME_BY_EXT[String(n || '').split(/[?#]/)[0].split('.').pop().toLowerCase()] || '';
  const extOfMime = m => EXT_BY_MIME[String(m || '').split(';')[0].trim().toLowerCase()] || '';
  /** 中身の先頭バイトから種類を判定（拡張子や申告より確実） */
  function sniffMime(b) {
    if (!b || b.length < 4) return '';
    const s4 = String.fromCharCode(b[0], b[1], b[2], b[3]);
    if (b[0] === 0x89 && s4.slice(1) === 'PNG') return 'image/png';
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (s4 === 'GIF8') return 'image/gif';
    if (s4 === 'RIFF' && b.length >= 12) { const t = String.fromCharCode(b[8], b[9], b[10], b[11]); if (t === 'WEBP') return 'image/webp'; if (t === 'WAVE') return 'audio/wav'; }
    if (s4 === 'OggS') return 'audio/ogg';
    if (s4 === 'fLaC') return 'audio/flac';
    if (s4.slice(0, 3) === 'ID3') return 'audio/mpeg';
    if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return (b[1] & 0x06) === 0x00 ? 'audio/aac' : 'audio/mpeg';
    if (b.length >= 12 && String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') return 'audio/mp4';
    if (s4.slice(0, 2) === 'BM') return 'image/bmp';
    return '';
  }
  function mimeOf(buf, hint, name) {
    const h = String(hint || '').split(';')[0].trim().toLowerCase();
    return sniffMime(buf) || (h && h !== 'application/octet-stream' ? h : '') || mimeOfName(name) || 'application/octet-stream';
  }
  /** data:URL → { buf, mime }（base64／パーセントエンコード両対応）。不正なら null */
  function parseDataUrl(u) {
    const m = /^data:([^,]*?),([\s\S]*)$/i.exec(String(u || '').trim()); if (!m) return null;
    const meta = m[1].split(';'), b64 = meta.slice(1).some(x => x.trim().toLowerCase() === 'base64'), mime = meta[0].trim().toLowerCase();
    try { const buf = b64 ? b64ToBytes(m[2].replace(/\s+/g, '')) : utf8Bytes(decodeURIComponent(m[2])); return buf.length ? { buf, mime } : null; } catch (e) { return null; }
  }

  // ---------- 素材の入れ物（同じ中身は1つだけ ZIP に入る） ----------
  function createBag() {
    const files = new Map(), resources = {};
    return {
      files, resources,
      add(buf, mime) {
        const h = sha256Hex(buf), ext = extOfMime(mime), key = ext ? h + '.' + ext : h;
        if (!files.has(key)) { files.set(key, buf); resources[key] = { type: mime }; }
        return key;
      }
    };
  }

  const colorOr = (c, d) => {
    const s = str(c).trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s);
    if (m) return '#' + [m[1], m[2], m[3]].map(v => clamp(Number(v) || 0, 0, 255).toString(16).padStart(2, '0')).join('');
    return d;
  };

  /** 選んだ要素 → __data.json ＋ 素材ファイル。
   *  sel = { room: {name, bg, fg, bgm} | null, npcs: [NPC], pieces: [駒データ(ダミー駒など)], scenes: [シーン], items: [盤面オブジェクト] }
   *  resolve(src, kind) → Promise<{ buf, mime?, name? } | null>   kind は 'image' | 'audio'
   *  opts = { now, grid, roomName } */
  async function buildPackage(sel, resolve, opts) {
    sel = sel || {}; const o = opts || {}, now = Number.isFinite(o.now) ? o.now : Date.now(), grid = clamp(Number(o.grid) || 24, 4, 200);
    const bag = createBag(), warnings = [], cache = new Map();
    const srcKey = (s, kind, owner) => kind + '|' + JSON.stringify([s.dataUrl || '', s.path || '', s.filePath || '', s.assetId || '', s.assetUid || '', s.url || '', s.name || '', s.label || '', (owner && owner.npcName) || '', (owner && owner.iconName) || '']);
    async function hashOf(src, kind, label, owner) {
      if (!src || typeof src !== 'object') return null;
      const k = srcKey(src, kind, owner); if (cache.has(k)) return cache.get(k);
      let r = null; try { r = await resolve(src, kind, owner); } catch (e) { r = null; }
      let h = null;
      if (r && r.buf && r.buf.length) { const buf = toU8(r.buf); h = bag.add(buf, mimeOf(buf, r.mime, r.name || src.name || src.path)); }
      else warnings.push((kind === 'audio' ? '🎵 ' : '🖼️ ') + (label || src.name || src.path || '素材') + ' の実体を読み込めませんでした（空欄で出力）');
      cache.set(k, h); return h;
    }

    const rs = sel.room;
    const round3 = v => (Math.round(v * 1000) / 1000) || 0;
    const roomFieldWidth = clamp(Math.round(toNum(rs && rs.fieldWidth) || Math.round((Number(o.boardWidth) || 960) / grid) || 40), 1, 200);
    const roomFieldHeight = clamp(Math.round(toNum(rs && rs.fieldHeight) || Math.round((Number(o.boardHeight) || 720) / grid) || 30), 1, 200);
    const roomBwPx = roomFieldWidth * grid;
    const roomBhPx = roomFieldHeight * grid;

    async function character(src, idx) {
      src = src || {};
      const owner = { npcName: str(src.name), iconName: str(src.iconName) };
      const imgs = Array.isArray(src.images) && src.images.length ? src.images : (Array.isArray(src.portraits) ? src.portraits : []), faces = [];
      for (const im of imgs) { const h = await hashOf(im, 'image', str(src.name) + ' の立ち絵', owner); if (h) faces.push({ iconUrl: h, label: str(im.label || im.name) }); }
      let icon = faces.length ? faces[0].iconUrl : null;
      if (!icon) {
        const u = [src.iconDataUrl, src.iconUrl, src.imagePath, src.image, src.portrait].map(str).find(v => /^(?:data:|blob:|@img:|https?:|file:|zipview:|[A-Za-z]:[\\/]|\/)/i.test(v));
        if (u) {
          const isPath = /^(?:[A-Za-z]:[\\/]|\/)/.test(u);
          icon = await hashOf({ dataUrl: isPath ? '' : u, path: isPath ? u : '', name: str(src.iconName || src.name) }, 'image', str(src.name) + ' のアイコン', owner);
        }
      }
      const secret = src.secret !== undefined ? !!src.secret : !!(src.sysOpts && src.sysOpts.statusPublic === false);
      const onBoard = src.onBoard === true;
      const x = onBoard ? round3((toNum(src.x) - roomBwPx / 2) / grid) : 0;
      const y = onBoard ? round3((toNum(src.y) - roomBhPx / 2) / grid) : 0;
      const width = onBoard && src.width != null ? Math.max(1, Math.round(toNum(src.width) / grid)) : 4;
      const height = onBoard && src.height != null ? Math.max(1, Math.round(toNum(src.height) / grid)) : 4;
      return {
        name: str(src.name).trim() || '名称未設定', playerName: '', memo: str(src.memo), initiative: toNum(src.initiative), externalUrl: '',
        status: (Array.isArray(src.status) ? src.status : []).filter(s => s && str(s.label)).map(s => {
          const val = toInt(s.value);
          const maxRaw = s.max == null || s.max === '' ? s.value : s.max;
          const maxNorm = (typeof maxRaw === 'boolean' || typeof maxRaw === 'object' || maxRaw == null)
            ? NaN
            : (typeof maxRaw === 'number' ? maxRaw : Number(String(maxRaw).normalize('NFKC').replace(/[,\s]/g, '') || NaN));
          const max = Number.isFinite(maxNorm) ? (Math.round(maxNorm) || 0) : val;
          return { label: str(s.label), value: val, max };
        }),
        params: (Array.isArray(src.params) ? src.params : []).filter(p => p && str(p.label)).map(p => ({ label: str(p.label), value: toStr(p.value) })),
        commands: str(src.commands).replace(/\r\n?/g, '\n'),
        iconUrl: icon || null, faces, diceSkin: {},
        x, y, z: 0, angle: 0, width, height,
        active: onBoard, secret, invisible: !!src.invisible, hideStatus: src.hideStatus !== undefined ? !!src.hideStatus : secret, speaking: false,
        color: colorOr(src.color, '#888888'), roomId: null
      };
    }
    const bgmLines = [];
    const normFit = v => (v === 'fill' || v === 'cover' || v === 'contain') ? v : '';
    const pickFit = (...vals) => { for (const v of vals) { const f = normFit(v); if (f) return f; } return 'contain'; };
    async function scene(s, sceneIndex) {
      const bgm = s.bgm && (s.bgm.path || s.bgm.name || s.bgm.assetUid) ? s.bgm : null, bgmHash = bgm ? await hashOf(bgm, 'audio', 'シーン「' + str(s.title) + '」のBGM') : null;
      if (bgm) {
        const label = str(bgm.name || (bgm.path ? bgm.path.split(/[\\/]/).pop() : ''), 'BGM');
        bgmLines.push('シーン「' + str(s.title || s.name, '無題のシーン') + '」: ' + label + (bgmHash ? ' (' + bgmHash + ')' : ''));
      }
      const scFieldWidth = clamp(Math.round(toNum(s.boardWidth ? s.boardWidth / grid : 0) || Math.round((Number(o.boardWidth) || 960) / grid) || 40), 0, 200);
      const scFieldHeight = clamp(Math.round(toNum(s.boardHeight ? s.boardHeight / grid : 0) || Math.round((Number(o.boardHeight) || 720) / grid) || 30), 0, 200);
      const scBwPx = scFieldWidth * grid;
      const scBhPx = scFieldHeight * grid;
      const markers = {};
      for (const mk of (Array.isArray(s.markers) ? s.markers : [])) {
        if (!mk || typeof mk !== 'object' || mk.visible === false) continue;
        const hasImg = !!(mk.dataUrl || mk.path || mk.filePath || mk.assetId || mk.assetUid || mk.url);
        const imgHash = hasImg ? await hashOf(mk, 'image', str(mk.name, 'マーカーパネル')) : '';
        markers[genId()] = {
          x: round3((toNum(mk.x) - scBwPx / 2) / grid),
          y: round3((toNum(mk.y) - scBhPx / 2) / grid),
          z: toInt(mk.zIndex != null ? mk.zIndex : 1),
          width: Math.max(1, Math.round(toNum(mk.width) / grid)),
          height: Math.max(1, Math.round(toNum(mk.height) / grid)),
          locked: !!mk.locked,
          freezed: false,
          text: str(mk.text),
          imageUrl: imgHash || '',
          angle: toInt(mk.angle),
          clickAction: null
        };
      }
      const bgSrc = s.bg || (rs && rs.bg) || null;
      const fgSrc = s.fg || (rs && rs.fg) || null;
      return {
        name: str(s.title || s.name, '無題のシーン'),
        backgroundUrl: bgSrc ? await hashOf(bgSrc, 'image', 'シーン「' + str(s.title) + '」の背景') : null,
        foregroundUrl: fgSrc ? await hashOf(fgSrc, 'image', 'シーン「' + str(s.title) + '」の前景') : null,
        fieldObjectFit: pickFit(s.fgFit, fgSrc && fgSrc.fitMode, fgSrc && fgSrc.fit),
        fieldWidth: scFieldWidth,
        fieldHeight: scFieldHeight,
        displayGrid: false,
        gridSize: 1,
        markers,
        text: str(s.sceneMessage),
        mediaRef: null,
        soundRef: null,
        locked: false,
        order: sceneIndex + 1
      };
    }
    async function item(it, itemIndex) {
      const isVis = it.visible !== false && !it.invisible;
      return {
        x: round3((toNum(it.x) - roomBwPx / 2) / grid),
        y: round3((toNum(it.y) - roomBhPx / 2) / grid),
        z: toInt(it.zIndex),
        angle: toInt(it.angle),
        width: Math.max(1, Math.round(toNum(it.width) / grid)),
        height: Math.max(1, Math.round(toNum(it.height) / grid)),
        deckId: null,
        locked: !!it.locked,
        visible: isVis,
        closed: false,
        withoutOwner: false,
        freezed: false,
        type: 'object',
        active: isVis,
        memo: str(it.text),
        imageUrl: (await hashOf(it, 'image', str(it.name, '盤面オブジェクト'))) || '',
        coverImageUrl: null,
        clickAction: null,
        order: itemIndex + 1
      };
    }

    const entities = { room: null, items: {}, decks: {}, notes: {}, characters: {}, effects: {}, scenes: {}, savedatas: {}, snapshots: {} }, counts = { characters: 0, scenes: 0, items: 0 };
    const rb = rs && rs.bgm && (rs.bgm.path || rs.bgm.name || rs.bgm.assetUid) ? rs.bgm : null;
    const rbHash = rb ? await hashOf(rb, 'audio', 'ルームのBGM') : null;
    if (rb) {
      const label = str(rb.name || (rb.path ? rb.path.split(/[\\/]/).pop() : ''), 'ルームBGM');
      bgmLines.push('ルーム: ' + label + (rbHash ? ' (' + rbHash + ')' : ''));
    }
    const firstScene = Array.isArray(sel.scenes) && sel.scenes.length ? sel.scenes[0] : null;
    const roomBgSrc = (rs && rs.bg) || (firstScene && firstScene.bg) || null;
    const roomFgSrc = (rs && rs.fg) || (firstScene && firstScene.fg) || null;
    entities.room = {
      defaultAnonymousRole: null,
      backgroundUrl: roomBgSrc ? await hashOf(roomBgSrc, 'image', 'ルームの背景') : null,
      foregroundUrl: roomFgSrc ? await hashOf(roomFgSrc, 'image', 'ルームの前景') : null,
      embedUrl: null,
      thumbnailUrl: null,
      mapType: null,
      fieldWidth: roomFieldWidth,
      fieldHeight: roomFieldHeight,
      fieldObjectFit: pickFit(!(rs && rs.fg) && firstScene ? firstScene.fgFit : '', rs && rs.fgFit, roomFgSrc && roomFgSrc.fitMode, roomFgSrc && roomFgSrc.fit),
      alignWithGrid: false,
      messageChannels: [],
      messageGroups: [],
      markers: {},
      mediaRef: null,
      monitored: false,
      soundRef: null,
      sceneId: null,
      archived: false,
      backgroundColor: '',
      variables: [],
      underConstruction: false,
      hidden3dDice: true,
      initialSavedata: null,
      displayGrid: false,
      gridSize: 1,
      enableCrossfade: false,
      crossfadeDuration: 1,
      allowDuplicate: false
    };
    let ci = 0, si = 0, ii = 0;
    for (const n of (sel.npcs || [])) { entities.characters[genId()] = await character(n, ci++); counts.characters++; }
    for (const p of (sel.pieces || [])) { entities.characters[genId()] = await character(p, ci++); counts.characters++; }
    for (const s of (sel.scenes || [])) { entities.scenes[genId()] = await scene(s, si++); counts.scenes++; }
    for (const it of (sel.items || [])) { entities.items[genId()] = await item(it, ii++); counts.items++; }
    if (bgmLines.length) {
      entities.notes[genId()] = { order: 0, iconUrl: '', name: 'BGM一覧', text: bgmLines.join('\n') };
    }
    const data = { meta: { version: VERSION }, entities: { room: entities.room, items: entities.items, decks: entities.decks, notes: entities.notes, characters: entities.characters, effects: entities.effects, scenes: entities.scenes, savedatas: entities.savedatas, snapshots: entities.snapshots }, resources: bag.resources };
    return { data, files: bag.files, warnings, counts };
  }

  /** ココフォリア v1.1.0 の items / markers / characters の x,y が「ピクセル単位 (scale=1)」か「マス単位 (scale=grid)」かを判定する */
  function detectCoordScale(entities, opts) {
    const o = opts || {};
    const grid = Math.max(1, Number(o.grid) || 24);
    const list = Array.isArray(entities) ? entities : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const x = Number(e.x), y = Number(e.y);
      if (Number.isFinite(x) && Math.abs(x) > 500) return 1;
      if (Number.isFinite(y) && Math.abs(y) > 500) return 1;
    }
    return grid;
  }

  /** __data.json（オブジェクト）→ 読みやすい形。ココフォリアのルームZIPでなければ例外 */
  function parsePackage(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('__data.json の形式が不正です');
    const ent = data.entities;
    if (!ent || typeof ent !== 'object') throw new Error('entities が見つかりません（ココフォリアのルームZIPではありません）');
    const list = m => (m && typeof m === 'object' ? Object.keys(m).map(id => (m[id] && typeof m[id] === 'object' ? Object.assign({ _id: id }, m[id]) : null)).filter(Boolean) : []);
    const sortByOrder = arr => arr
      .map((v, i) => ({ v, i, ord: (v && v.order !== '' && v.order != null && Number.isFinite(Number(v.order))) ? Number(v.order) : Infinity }))
      .sort((a, b) => (a.ord !== b.ord ? a.ord - b.ord : a.i - b.i))
      .map(x => x.v);
    const scenes = sortByOrder(list(ent.scenes)).map(sc => Object.assign({}, sc, {
      text: str(sc.text),
      sceneMessage: str(sc.text),
      markers: Array.isArray(sc.markers) ? sc.markers.filter(mk => mk && typeof mk === 'object') : list(sc.markers)
    }));
    const items = sortByOrder(list(ent.items)).map(it => Object.assign({}, it, {
      visible: !(it.active === false || it.visible === false || it.closed === true)
    }));
    return { version: str(data.meta && data.meta.version), room: ent.room && typeof ent.room === 'object' ? ent.room : {}, characters: list(ent.characters), scenes, items, notes: list(ent.notes), effects: list(ent.effects), resources: data.resources && typeof data.resources === 'object' ? data.resources : {} };
  }

  /** 素材の参照（ハッシュ名／URL／ファイル名）に対応する ZIP のエントリ名を探す。無ければ '' */
  function findZipEntry(ref, names) {
    let r = str(ref).trim(); if (!r || !Array.isArray(names)) return '';
    if (/^https?:\/\//i.test(r)) { try { r = decodeURIComponent(new URL(r).pathname.split('/').pop() || ''); } catch (e) { r = ''; } if (!r) return ''; }
    const low = r.toLowerCase(), rStem = low.replace(/\.[^.]+$/, '');
    for (const n of names) if (!n.endsWith('/') && n.toLowerCase() === low) return n;
    for (const n of names) {
      if (n.endsWith('/')) continue;
      const base = n.split('/').pop().toLowerCase(), stem = base.replace(/\.[^.]+$/, '');
      if (base === low || stem === low || (rStem && (base === rStem || stem === rStem))) return n;
    }
    return '';
  }

  // ---------- 名前による再リンク（BGM補完用） ----------
  const stemOf = s => str(s).split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{1,5}$/, '');
  /** 曲名・ファイル名の同一判定用に正規化（拡張子・空白・大文字小文字・全半角を無視） */
  const normName = s => stemOf(s).normalize('NFKC').replace(/[\s\u3000_\-・]+/g, '').toLowerCase();
  /** names（曲名・ファイル名の候補）と同名のファイルを files [{ path, name }] から集める（パスの重複は除く） */
  function matchByName(names, files) {
    const keys = new Set((Array.isArray(names) ? names : [names]).map(normName).filter(Boolean)); if (!keys.size) return [];
    const seen = new Set(), out = [];
    (files || []).forEach(f => { if (!f || !f.path) return; const k = String(f.path).toLowerCase(); if (seen.has(k)) return; if (keys.has(normName(f.name || f.path))) { seen.add(k); out.push(f); } });
    return out;
  }

  const api = { VERSION, toInt, toNum, toStr, sha256Hex, sha256HexAsync, buildToken, buildZipEntries, isSha256, genId, mimeOfName, extOfMime, sniffMime, mimeOf, parseDataUrl, createBag, buildPackage, detectCoordScale, parsePackage, findZipEntry, normName, matchByName };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CCFPkg = api;
})();
