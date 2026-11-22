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
  /** 📌 登録素材（全シナリオ）＋ マイライブラリ（監視フォルダ配下を再帰）から、種類(kind)に合うファイルの一覧を作る。1回の取り込みの間だけ使い回す */
  function buildIndex(kind) {
    const re = kind === 'audio' ? AUDIO_RE : IMG_RE, out = [], seen = new Set();
    const push = (c) => { const k = (c.path || '').toLowerCase(); if (!k || seen.has(k)) return; seen.add(k); out.push(c); };
    // 1. 登録素材（現在のシナリオ＋全シナリオ。パスを持つもの、画像は埋め込みデータも）
    if (CCF.assets && CCF.assets.getUnifiedItems) {
      const keys = new Set([String(S.key)]); CCF.scenarioList().forEach(sc => keys.add(String(sc.id)));
      keys.forEach(key => {
        let items = []; try { items = CCF.assets.getUnifiedItems(key) || []; } catch (e) { items = []; }
        const scTitle = (CCF.scenarioList().find(x => String(x.id) === key) || {}).title || '';
        items.forEach(it => {
          if (!it || (kind === 'audio' ? it.type !== 'audio' : it.type !== 'image')) return;
          if (it.path && re.test(baseName(it.path))) {
            const exists = isAssetRef(it.path) ? (!window.WebBridge || WebBridge.hasAssetSync(it.path)) : (isElec && fs && fs.existsSync(it.path));
            if (exists) push({ path: it.path, name: it.name || baseName(it.path), source: '📌 登録素材' + (scTitle ? '（' + scTitle + '）' : '') });
          }
          else if (it.dataUrl && kind === 'image') push({ path: 'asset:' + key + ':' + it.uid, name: it.name || it.origName || 'image', dataUrl: it.dataUrl, source: '📌 登録素材' + (scTitle ? '（' + scTitle + '）' : '') });
        });
      });
    }
    // 2. マイライブラリ（監視ルート配下を再帰。旧版フォルダは除外）
    if (isElec && fs && path) {
      const roots = new Set(); const L = CCF.library && CCF.library.state; if (L) { if (L.root) roots.add(L.root); if (L.scnWatch) roots.add(L.scnWatch); }
      let n = 0;
      roots.forEach(root => {
        (function walk(dir, d) {
          if (d > 8 || n > 30000) return; let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
          for (const e of es) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue; const full = path.join(dir, e.name);
            if (e.isDirectory()) { if (!M.isOldFolderName(e.name)) walk(full, d + 1); }
            else if (re.test(e.name)) { n++; push({ path: full, name: e.name, source: '📚 マイライブラリ（' + path.basename(path.dirname(full)) + '）' }); }
          }
        })(root, 0);
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
  const typedDataUrl = async (buf, mime, name) => {
    const m = P.mimeOf(buf, mime, name), b64 = () => 'data:' + m + ';base64,' + bytesToBase64(buf);
    if (typeof imageFileToDataUrl === 'function') { try { return await imageFileToDataUrl(new File([buf], name || 'image', { type: m })); } catch (e) { /* 縮小に失敗したら原寸で */ } }
    return b64();
  };

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
    const rep = { linked: [], unresolved: [], extracted: 0, images: 0 };
    const impDir = (isElec && path && DATA_ROOT) ? path.join(DATA_ROOT, 'ccfolia', 'imports', CCF.ccfExport.safeName(base) + '_' + z.id.slice(0, 8)) : '';
    const idx = { audio: null, image: null }, pickCache = new Map(), imgCache = new Map(), audCache = new Map();
    const entryOf = ref => { const e = P.findZipEntry(ref, names); return e ? { entry: e, url: CCF.zip.url(z.id, e) } : null; };

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
    /** 画像の参照 → data URL（ZIP内 → http(s) → 名前で再リンク） */
    async function imageFor(ref, hints, label) {
      ref = ref == null ? '' : String(ref).trim(); const key = ref + '|' + (hints || []).join('|'); if (imgCache.has(key)) return imgCache.get(key);
      let out = null;
      try {
        const hit = ref && entryOf(ref);
        if (hit) { const r = await CCF.zip.readBuffer(hit.url); out = await typedDataUrl(r.buf, (json.resources && json.resources[ref] || {}).type || r.mime, hit.entry); }
        else if (/^https?:\/\//i.test(ref)) { const r = await CCF.ccfExport.readRef(ref); if (r) out = await typedDataUrl(r.buf, r.mime, r.name); }
        else if (/^data:image\//i.test(ref)) out = ref;
      } catch (e) { out = null; }
      if (!out && (hints || []).some(Boolean)) {
        const c = await relinkByName('image', hints);
        if (c) { try { if (c.dataUrl) out = c.dataUrl; else { const r = await CCF.ccfExport.readRef(c.path); if (r) out = await typedDataUrl(r.buf, r.mime, r.name); } } catch (e) { out = null; } if (out) rep.linked.push({ kind: '🖼️', name: (hints || [])[0] || c.name, to: c.dataUrl ? c.name : c.path }); }
      }
      if (out) rep.images++; else if (ref || (hints || []).some(Boolean)) rep.unresolved.push('🖼️ ' + (label || (hints || [])[0] || ref.slice(0, 20)));
      imgCache.set(key, out); return out;
    }
    /** BGM／SE の参照 → { path, name }（ZIP内にあれば _TRPG_Data へ取り出し → 無ければ曲名・ファイル名でディープサーチ） */
    async function audioFor(ref, hints, label) {
      ref = ref == null ? '' : String(ref).trim(); const key = ref + '|' + (hints || []).join('|'); if (audCache.has(key)) return audCache.get(key);
      let out = null;
      try {
        const hit = ref && entryOf(ref);
        if (hit) {
          const r = await CCF.zip.readBuffer(hit.url), mime = P.mimeOf(r.buf, (json.resources && json.resources[ref] || {}).type || r.mime, hit.entry);
          const ext = P.extOfMime(mime) || (hit.entry.match(/\.([A-Za-z0-9]{2,4})$/) || [])[1] || 'mp3', nameHint = (hints || []).find(Boolean);
          const fname = CCF.ccfExport.safeName(nameHint || ref.slice(0, 16)) + '_' + ref.slice(0, 8) + '.' + ext;
          if (isElec && fs && path && impDir) {
            fs.mkdirSync(impDir, { recursive: true });
            const fp = path.join(impDir, fname);
            fs.writeFileSync(fp, r.buf); rep.extracted++; out = { path: fp, name: nameHint || path.basename(fp), added: true };
          } else if (window.WebBridge && WebBridge.saveAssetBytes) {
            const fp = await WebBridge.saveAssetBytes(r.buf, fname, mime);
            rep.extracted++; out = { path: fp, name: nameHint || baseName(fp), added: true };
          }
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

    // --- キャラクター → NPC ---
    const npcs = [], total = pkg.characters.length + pkg.scenes.length + pkg.items.length; let done = 0;
    const tick = () => { if (++done % 5 === 0) say('📥 取り込み中… ' + done + ' / ' + total); };
    for (const ch of pkg.characters) {
      const faces = []; for (const f of (Array.isArray(ch.faces) ? ch.faces : [])) { if (!f || !f.iconUrl) continue; const du = await imageFor(f.iconUrl, [f.label], (ch.name || '') + ' の立ち絵'); if (du) faces.push({ iconUrl: du, label: String(f.label || '') }); }
      const icon = ch.iconUrl ? await imageFor(ch.iconUrl, [ch.name], (ch.name || '') + ' のアイコン') : null;
      const d = M.fromCcfoliaCharacter({ kind: 'character', data: Object.assign({}, ch, { iconUrl: icon, faces: faces.length || !icon ? faces : [{ iconUrl: icon, label: '' }] }) });
      if (d) npcs.push(d); tick();
    }
    // --- シーン ---
    const refs = [], addRef = a => { if (a && a.added && !refs.some(r => r.path === a.path)) refs.push({ type: 'audio', name: a.name, origName: baseName(a.path), path: a.path, category: 'ココフォリア取込' }); };
    const scenes = [];
    for (const s of pkg.scenes) {
      const nm = String(s.name || '無題のシーン'), bgRef = s.backgroundUrl || s.imageUrl, fgRef = s.foregroundUrl;
      const bg = bgRef ? await imageFor(bgRef, [], nm + ' の背景') : null, fg = fgRef ? await imageFor(fgRef, [], nm + ' の前景') : null;
      const bgmName = String(s.bgmName || s.bgmFile || '').trim(), au = (s.bgmUrl || bgmName) ? await audioFor(s.bgmUrl, [bgmName], 'シーン「' + nm + '」のBGM「' + bgmName + '」') : null;
      addRef(au);
      const vol = Number(s.bgmVolume); scenes.push(M.sanitizeScene({
        title: nm, text: s.text, bg: bg ? { kind: 'bg', name: nm + ' 背景', dataUrl: bg } : null, fg: fg ? { kind: 'fg', name: nm + ' 前景', dataUrl: fg } : null,
        bgm: au || bgmName ? { name: (au && au.name) || bgmName, path: au ? au.path : '', volume: Number.isFinite(vol) ? Math.round(vol * 100) : 35, loop: true } : null,
        manualSlots: { bg: !!bg, screen: false, bgm: !!au }
      })); tick();
    }
    // --- 部屋の背景・前景・BGM ---
    const room = pkg.room || {}, roomName = String(room.name || base).trim() || base;
    const rbg = room.backgroundUrl ? await imageFor(room.backgroundUrl, [], '部屋の背景') : null, rfg = room.foregroundUrl ? await imageFor(room.foregroundUrl, [], '部屋の前景') : null;
    if (room.bgmUrl || room.bgmName) { const au = await audioFor(room.bgmUrl, [room.bgmName], '部屋のBGM「' + (room.bgmName || '') + '」'); addRef(au); }
    // --- 盤面オブジェクト ---
    const grid = 24, pieces = [];
    for (const it of pkg.items) {
      const du = it.imageUrl ? await imageFor(it.imageUrl, [it.name], 'オブジェクト画像') : null, memo = String(it.memo || '');
      pieces.push({ kind: it.type === 'plane' ? 'screen' : 'piece', name: String(it.name || memo.split('\n')[0] || 'オブジェクト').slice(0, 40), text: memo, dataUrl: du || '',
        x: Math.round((Number(it.x) || 0) * grid), y: Math.round((Number(it.y) || 0) * grid), width: Math.round((Number(it.width) || 4) * grid), height: Math.round((Number(it.height) || 4) * grid),
        angle: Number(it.angle) || 0, zIndex: Number(it.z) || 0, visible: it.visible !== false, locked: !!it.locked }); tick();
    }

    const proj = M.sanitizeProject({ npcs, scenes, refs, board: { pieces }, globalDecor: { bg: rbg ? { kind: 'bg', name: roomName + ' 背景', dataUrl: rbg } : null, fg: rfg ? { kind: 'fg', name: roomName + ' 前景', dataUrl: rfg } : null } });
    const added = CCF.addRoom(roomName, proj);
    rep.counts = { npcs: npcs.length, scenes: scenes.length, items: pieces.length, effects: pkg.effects.length };
    rep.roomName = roomName; rep.version = pkg.version;
    say('✅ 部屋「' + roomName + '」を取り込みました（NPC ' + npcs.length + '・シーン ' + scenes.length + '・オブジェクト ' + pieces.length + '）' + (rep.unresolved.length ? ' ⚠️ 未解決の素材 ' + rep.unresolved.length + '件' : ''));
    if (rep.linked.length || rep.unresolved.length || rep.extracted) showReport(rep);
    return { room: added, report: rep };
  }

  function showReport(rep) {
    const old = document.getElementById('ccfZipImpReport'); if (old) old.remove();
    const ov = document.createElement('div'); ov.className = 'ccf-overlay'; ov.id = 'ccfZipImpReport'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); }, onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    ov.innerHTML = `<div class="ccf-modal narrow"><div class="ccf-modal-head"><b>📥 取り込み結果：${esc(rep.roomName)}</b><span class="ccf-muted">NPC ${rep.counts.npcs}・シーン ${rep.counts.scenes}・オブジェクト ${rep.counts.items}</span><span class="ccf-spacer"></span><button type="button" class="ccf-mini" data-r="close">✕</button></div>
      <div class="ccf-modal-body single">
        ${rep.extracted ? `<div>📦 ZIPから音声 ${rep.extracted}点を取り出しました（${isElec ? '_TRPG_Data/ccfolia/imports' : 'ブラウザ内ライブラリ'}）</div>` : ''}
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
