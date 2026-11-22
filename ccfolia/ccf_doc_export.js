/* ccf_doc_export.js — 「📤 シナリオ資料を再出力」：分割済みのシーン／しおりを活かして、GM進行用HTML・しおり付きPDF・整形TXTを書き出す
 *  ・純粋ロジック（ブラウザでも Node でも動く）… cleanScenarioText / assignBookmarks / guideBadges / buildGmHtml / buildPdfHtml / buildTxt
 *  ・UI（Electron のみ）… CCF.docExport.openMenu()。PDF は Chromium の印刷機能（メイン側 ccf:print-pdf）で作り、見出し（h1〜h3）を
 *    PDF 標準のアウトライン（目次ツリー）として埋め込む：タイトル → シーン → しおり。
 *  doc = { title, roomName, scenes:[{id,title,text,page,sourcePath,tags,bg,fg,bgm,screens,markers}], bookmarks:[{path,name,page,label}], generatedAt } */
(function () {
  'use strict';
  const T = (typeof window !== 'undefined' && window.CCFText) || (typeof require === 'function' ? (() => { try { return require('./ccf_text.js'); } catch (e) { return null; } })() : null);
  const str = v => (v == null ? '' : String(v));
  const esc = s => str(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const baseName = p => str(p).split(/[\\/]/).pop();
  const normPath = p => str(p).replace(/\\/g, '/').toLowerCase();

  // ---------- 本文の整形 ----------
  const RE_PAGE_DECOR = /^(?:[-‐‑–—―ー〜~]\s*\d{1,4}\s*[-‐‑–—―ー〜~]|(?:p|page|ページ)\.?\s*\d{1,4}(?:\s*\/\s*\d{1,4})?|\d{1,4}\s*\/\s*\d{1,4}|\d{1,4}\s*ページ)$/i;
  const RE_BARE_NUM = /^\d{1,4}$/;
  /** ページ番号だけの行を除く。「- 12 -」「P.12」「12 / 40」は常に除き、数字だけの行は前後が空行（または先頭・末尾）のときだけ除く */
  function stripPageNumbers(text) {
    const lines = str(text).replace(/\r\n?/g, '\n').split('\n'), out = [];
    const nk = l => l.normalize('NFKC').trim(), blank = i => i < 0 || i >= lines.length || !lines[i].trim();
    lines.forEach((l, i) => {
      const k = nk(l);
      if (k && RE_PAGE_DECOR.test(k)) return;
      if (k && RE_BARE_NUM.test(k) && blank(i - 1) && blank(i + 1)) return;
      out.push(l);
    });
    return out.join('\n');
  }
  /** mode 'light'：改行は保ったまま、ページ番号・不可視文字・行末空白・3行以上の空行だけ整える（HTML／PDF用）
   *  mode 'full' ：さらに折り返しの途中改行と不要な空白も除去（TXT用。T.cleanText の smart 結合） */
  function cleanScenarioText(text, mode) {
    let t = stripPageNumbers(str(text).replace(/[\u00AD\u200B-\u200D\u2060\uFEFF\f\v]/g, '').replace(/\u00A0/g, ' '));
    if (mode === 'full' && T && T.cleanText) t = T.cleanText(t, { joinLines: 'smart', stripSpaces: true });
    else t = t.split('\n').map(l => l.replace(/[ \t\u3000]+$/, '')).join('\n');
    return t.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  }

  // ---------- しおり・ガイド ----------
  /** しおりを、ページ番号をもとに「そのページを含むシーン」へ振り分ける。どのシーンにも属さないものは orphan */
  function assignBookmarks(scenes, bookmarks) {
    const byScene = new Map((scenes || []).map(s => [s.id, []])), orphan = [];
    const paged = (scenes || []).filter(s => s.page != null && Number.isFinite(Number(s.page))).sort((a, b) => a.page - b.page);
    (bookmarks || []).forEach(bm => {
      if (!bm) return; const same = paged.filter(s => !s.sourcePath || normPath(s.sourcePath) === normPath(bm.path)); let owner = null;
      same.forEach(s => { if (s.page <= (bm.page || 1)) owner = s; });
      (owner ? byScene.get(owner.id) : orphan).push(bm);
    });
    const byPage = (a, b) => (a.page || 0) - (b.page || 0); byScene.forEach(l => l.sort(byPage)); orphan.sort(byPage);
    return { byScene, orphan };
  }
  const bmLabel = b => (str(b.label).trim() || str(b.name).trim() || baseName(b.path) || 'しおり') + '（p.' + (b.page || 1) + '）';
  const HO_RE = /(?:HO|ＨＯ|Ｈｏ|ho)\s*[0-9０-９]{1,2}|ハンドアウト\s*[0-9０-９]{1,2}/g, GIVE_RE = /配布|配る|渡す|渡して|公開|送付|共有|handout/i;
  const normHo = s => s.normalize('NFKC').replace(/\s+/g, '').toUpperCase().replace(/^ハンドアウト/, 'HO');
  /** シーンで配布するHO（タグのHO表記、または「配布・公開…」を含む行に出てくるHO） */
  function distributedHo(scene) {
    const set = new Set(); (scene.tags || []).forEach(t => (str(t).match(HO_RE) || []).forEach(m => set.add(normHo(m))));
    str(scene.text).split('\n').forEach(l => { if (GIVE_RE.test(l)) (l.match(HO_RE) || []).forEach(m => set.add(normHo(m))); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  }
  const itemName = it => str(it && (it.name || baseName(it.path))).trim() || '（名称なし）';
  /** シーン見出し直下に出すGM用ガイドバッジ：[{ icon, label, value }]（value はクリックでコピーされる） */
  function guideBadges(scene, bms) {
    const b = [];
    if (scene.page != null) b.push({ icon: '📄', label: 'ページ', value: 'p.' + scene.page });
    if (scene.bg) b.push({ icon: '🖼️', label: '背景', value: itemName(scene.bg) });
    if (scene.fg) b.push({ icon: '🌫️', label: '前景', value: itemName(scene.fg) });
    if (scene.bgm) b.push({ icon: '🎵', label: 'BGM', value: str(scene.bgm.name || baseName(scene.bgm.path)) || '（名称なし）' });
    (scene.screens || []).forEach(s => b.push({ icon: '📺', label: 'スクリーン', value: itemName(s) }));
    (scene.markers || []).forEach(s => b.push({ icon: '📍', label: 'マーカー', value: itemName(s) }));
    const ho = distributedHo(scene); if (ho.length) b.push({ icon: '📨', label: '配布HO', value: ho.join('・') });
    (bms || []).forEach(m => b.push({ icon: '🔖', label: 'しおり', value: bmLabel(m) }));
    return b;
  }
  const sceneTitle = (s, i) => str(s.title).trim() || 'シーン' + (i + 1);

  // ---------- 1. GM進行用・ワンクリックコピーHTML ----------
  function buildGmHtml(doc) {
    const scenes = doc.scenes || [], { byScene, orphan } = assignBookmarks(scenes, doc.bookmarks), title = str(doc.title) || 'シナリオ';
    const CSS = `*{box-sizing:border-box}body{margin:0;font-family:"Yu Gothic UI","Meiryo","Noto Sans CJK JP",sans-serif;background:#f4f5f7;color:#23262d;line-height:1.75}
.app{display:flex;min-height:100vh}#toc{position:sticky;top:0;align-self:flex-start;width:280px;max-height:100vh;overflow:auto;background:#fff;border-right:1px solid #d8dbe2;padding:14px}
#toc h1{font-size:1rem;margin:0 0 4px}#toc .sub{font-size:.72rem;color:#6a7080;margin-bottom:8px}#toc ol{list-style:none;margin:8px 0;padding:0}
#toc a{display:flex;gap:6px;justify-content:space-between;text-decoration:none;color:#23262d;padding:5px 8px;border-radius:6px;font-size:.82rem}#toc a:hover{background:#eef0f5}#toc a.on{background:#5865f2;color:#fff}
#toc .cnt{font-size:.7rem;opacity:.8;white-space:nowrap}#toc a.full .cnt::after{content:" ✅"}#prog{height:6px;background:#e3e5eb;border-radius:3px;overflow:hidden}#prog i{display:block;height:100%;width:0;background:#3ba55d}
#toc button{margin-top:8px;font-size:.75rem;padding:4px 10px;border:1px solid #c7cad3;border-radius:6px;background:#eef0f5;cursor:pointer}
main{flex:1;max-width:900px;padding:18px 26px 80px}.scene{background:#fff;border:1px solid #d8dbe2;border-radius:12px;padding:14px 20px;margin-bottom:18px}
.scene h2{margin:0 0 6px;font-size:1.15rem;border-left:5px solid #5865f2;padding-left:10px}.scene h2 .no{color:#5865f2;margin-right:6px}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}.badge{font-size:.74rem;padding:2px 9px;border-radius:999px;background:#eef0ff;border:1px solid #c9ceff;color:#3a43b8;cursor:pointer}.badge.none{background:#f1f2f5;border-color:#e0e2e8;color:#8a8f9c;cursor:default}
.badge b{font-weight:600;margin-right:4px}.badge.ho{background:#fff1f1;border-color:#ffc9c9;color:#b02a2a}.badge.bm{background:#fff8e1;border-color:#ffe08a;color:#8a6100}
.line{margin:0;padding:5px 10px 5px 30px;border-radius:6px;cursor:pointer;position:relative;white-space:pre-wrap;word-break:break-word}.line:hover,.line:focus{background:#eef0ff;outline:none}
.line::before{content:"";position:absolute;left:8px;top:.55em;width:14px;height:14px;border:1.5px solid #b9bdc9;border-radius:4px;background:#fff}
.line.sent{color:#7a8090;background:#f3faf5}.line.sent::before{content:"✓";color:#fff;background:#3ba55d;border-color:#3ba55d;font-size:11px;line-height:12px;text-align:center}
.line.sp{height:.6em;padding:0;cursor:default}.line.sp::before{display:none}.line.talk{color:#1b4b91}.line.head{font-weight:700;margin-top:6px}
.empty{color:#8a8f9c;font-size:.85rem}#toast{position:fixed;right:18px;bottom:18px;background:#23262d;color:#fff;padding:8px 14px;border-radius:8px;font-size:.82rem;opacity:0;transition:opacity .2s;pointer-events:none}#toast.on{opacity:.95}
@media(max-width:760px){.app{flex-direction:column}#toc{position:static;width:auto;max-height:240px}}`;
    const toc = scenes.map((s, i) => `<li><a href="#s${i}" data-s="${i}"><span>${i + 1}. ${esc(sceneTitle(s, i))}</span><span class="cnt" data-c="${i}"></span></a></li>`).join('');
    const sec = scenes.map((s, i) => {
      const bad = guideBadges(s, byScene.get(s.id)), cleaned = cleanScenarioText(s.text, 'light');
      const badges = bad.length ? bad.map(x => `<span class="badge${x.label === '配布HO' ? ' ho' : x.label === 'しおり' ? ' bm' : ''}" data-copy="${esc(x.value)}" title="クリックで「${esc(x.value)}」をコピー"><b>${x.icon} ${esc(x.label)}</b>${esc(x.value)}</span>`).join('') : '<span class="badge none">（このシーンでの切り替え指示なし）</span>';
      let n = 0; const lines = cleaned ? cleaned.split('\n').map(l => {
        if (!l.trim()) return '<div class="line sp"></div>';
        const cls = /^[「『（(]/.test(l.trim()) ? ' talk' : /^[■□◆◇●○▼▽【〔]/.test(l.trim()) ? ' head' : '';
        return `<p class="line${cls}" tabindex="0" role="button" data-id="s${i}-${n++}" title="クリックでコピー">${esc(l)}</p>`;
      }).join('') : '<div class="empty">（本文なし）</div>';
      return `<section class="scene" id="s${i}" data-n="${n}"><h2><span class="no">${i + 1}</span>${esc(sceneTitle(s, i))}</h2><div class="badges">${badges}</div><div class="body">${lines}</div></section>`;
    }).join('\n');
    const orph = orphan.length ? `<section class="scene"><h2>🔖 シーン外のしおり</h2><div class="badges">${orphan.map(m => `<span class="badge bm" data-copy="${esc(bmLabel(m))}"><b>🔖</b>${esc(bmLabel(m))}</span>`).join('')}</div></section>` : '';
    const JS = `(function(){var KEY='ccf-gm:'+document.title,sent={};try{sent=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(sent))}catch(e){}}
function fb(t){var a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}a.remove();return ok}
function copy(t){if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(t).then(function(){return true},function(){return fb(t)});return Promise.resolve(fb(t))}
var tt=document.getElementById('toast'),tm=0;function toast(m){tt.textContent=m;tt.className='on';clearTimeout(tm);tm=setTimeout(function(){tt.className=''},1400)}
function refresh(){var all=0,done=0;document.querySelectorAll('.scene[data-n]').forEach(function(sc,i){var n=+sc.dataset.n,d=0;sc.querySelectorAll('.line[data-id]').forEach(function(l){var s=!!sent[l.dataset.id];l.classList.toggle('sent',s);if(s)d++});all+=n;done+=d;var c=document.querySelector('[data-c="'+i+'"]'),a=document.querySelector('#toc a[data-s="'+i+'"]');if(c)c.textContent=n?d+'/'+n:'';if(a)a.classList.toggle('full',n>0&&d===n)});document.querySelector('#prog i').style.width=(all?Math.round(done*100/all):0)+'%'}
function line(l){copy(l.textContent).then(function(ok){if(!ok){toast('コピーできませんでした');return}sent[l.dataset.id]=1;save();refresh();toast('📋 コピーしました（送信済み ✓）')})}
document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(b){copy(b.dataset.copy).then(function(ok){toast(ok?'📋 「'+b.dataset.copy+'」をコピーしました':'コピーできませんでした')});return}var l=e.target.closest('.line[data-id]');if(l)line(l)});
document.addEventListener('keydown',function(e){if(e.key!=='Enter'&&e.key!==' ')return;var l=e.target.closest&&e.target.closest('.line[data-id]');if(l){e.preventDefault();line(l)}});
document.getElementById('reset').addEventListener('click',function(){if(confirm('送信済みチェックをすべて解除しますか？')){sent={};save();refresh()}});
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){document.querySelectorAll('#toc a.on').forEach(function(a){a.classList.remove('on')});var a=document.querySelector('#toc a[href="#'+en.target.id+'"]');if(a)a.classList.add('on')}})},{rootMargin:'-20% 0px -70% 0px'});document.querySelectorAll('.scene[id]').forEach(function(s){io.observe(s)})}
refresh()})();`;
    return `<!DOCTYPE html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}（GM進行用）</title><style>${CSS}</style></head>
<body><div class="app"><nav id="toc"><h1>${esc(title)}</h1><div class="sub">${esc(doc.roomName || '')}　シーン ${scenes.length}件</div><div id="prog"><i></i></div><ol>${toc}</ol><button type="button" id="reset">☐ 送信済みをリセット</button></nav>
<main>${sec || '<div class="empty">シーンがありません</div>'}\n${orph}</main></div><div id="toast" role="status"></div><script>${JS.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  }

  // ---------- 2. しおり付きPDFの元になるHTML（h1:タイトル → h2:シーン → h3:しおり がアウトラインになる） ----------
  function buildPdfHtml(doc) {
    const scenes = doc.scenes || [], { byScene, orphan } = assignBookmarks(scenes, doc.bookmarks), title = str(doc.title) || 'シナリオ';
    const para = t => cleanScenarioText(t, 'light').split('\n').map(l => l.trim() ? `<p>${esc(l)}</p>` : '<div class="sp"></div>').join('');
    const bmH = m => `<h3>🔖 ${esc(bmLabel(m))}</h3>`;
    const sec = scenes.map((s, i) => {
      const badges = guideBadges(s, []).filter(b => b.label !== 'ページ').map(b => `<span class="bd">${b.icon} ${esc(b.label)}：${esc(b.value)}</span>`).join('');
      return `<section><h2>${i + 1}. ${esc(sceneTitle(s, i))}</h2>${badges ? `<div class="bds">${badges}</div>` : ''}${(byScene.get(s.id) || []).map(bmH).join('')}${para(s.text)}</section>`;
    }).join('\n');
    const orph = orphan.length ? `<section><h2>しおり（シーン外）</h2>${orphan.map(bmH).join('')}</section>` : '';
    return `<!DOCTYPE html>\n<html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{size:A4;margin:18mm 16mm}body{font-family:"Yu Gothic","Meiryo","Noto Sans CJK JP",sans-serif;font-size:10.5pt;line-height:1.8;color:#111}
h1{font-size:20pt;margin:0 0 4mm;border-bottom:2px solid #5865f2;padding-bottom:2mm}.meta{color:#666;font-size:9pt;margin-bottom:8mm}
h2{font-size:14pt;margin:8mm 0 2mm;border-left:4px solid #5865f2;padding-left:3mm;break-after:avoid}h3{font-size:10.5pt;margin:2mm 0;color:#8a6100;break-after:avoid}
p{margin:0 0 1mm;white-space:pre-wrap;word-break:break-word}.sp{height:3mm}.bds{margin:1mm 0 3mm}.bd{display:inline-block;font-size:8.5pt;border:1px solid #c9ceff;background:#eef0ff;border-radius:10px;padding:0 6px;margin:0 4px 2px 0}
</style></head><body><h1>${esc(title)}</h1><div class="meta">${esc(doc.roomName || '')}　シーン ${scenes.length}件　${esc(doc.generatedAt || '')}</div>${sec}\n${orph}</body></html>`;
  }

  // ---------- 3. 整形済みテキスト ----------
  function buildTxt(doc) {
    const scenes = doc.scenes || [], head = '【' + (str(doc.title).trim() || 'シナリオ') + '】';
    const out = [head, ''];
    scenes.forEach((s, i) => { out.push('■ ' + sceneTitle(s, i).replace(/^[■□◆◇●○▼▽\s]+/, '')); out.push(''); const t = cleanScenarioText(s.text, 'full'); if (t) { out.push(t); out.push(''); } });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
  }

  const api = { stripPageNumbers, cleanScenarioText, assignBookmarks, distributedHo, guideBadges, buildGmHtml, buildPdfHtml, buildTxt };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CCFDocExport = api;

  // ======================================================================
  // UI（Electron / Webブラウザ両対応）
  // ======================================================================
  if (typeof window === 'undefined' || !window.CCF) return;
  const isElec = typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON;
  const CCF = window.CCF, S = CCF.S, say = CCF.say;
  const docOf = () => {
    const sc = CCF.scenarioList().find(x => String(x.id) === String(S.key)) || {}, room = S.rooms.find(r => r.id === S.roomId) || {}, d = new Date();
    return { title: sc.title || room.name || 'シナリオ', roomName: room.name || '', scenes: S.proj.scenes || [], bookmarks: S.proj.bookmarks || [], generatedAt: d.toLocaleString('ja-JP') };
  };
  const stem = d => CCF.ccfExport.safeName(d.title) + '_' + CCF.ccfExport.ts();

  async function writeOut(kind, doc) {
    if (!isElec) {
      if (kind === 'html') {
        const fname = stem(doc) + '_GM進行用.html';
        WebBridge.downloadBlob(buildGmHtml(doc), fname, 'text/html;charset=utf-8');
        return fname;
      }
      if (kind === 'txt') {
        const fname = stem(doc) + '_整形.txt';
        WebBridge.downloadBlob('\uFEFF' + buildTxt(doc).replace(/\n/g, '\r\n'), fname, 'text/plain;charset=utf-8');
        return fname;
      }
      const w = window.open('', '_blank');
      if (!w) throw new Error('ポップアップがブロックされました。ブラウザのポップアップ許可をオンにしてください');
      w.document.open();
      w.document.write(buildPdfHtml(doc));
      w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 250);
      return stem(doc) + '_印刷プレビュー.pdf';
    }
    const dir = CCF.ccfExport.exportDir();
    if (kind === 'html') { const f = path.join(dir, stem(doc) + '_GM進行用.html'); fs.writeFileSync(f, buildGmHtml(doc), 'utf8'); return f; }
    if (kind === 'txt') { const f = path.join(dir, stem(doc) + '_整形.txt'); fs.writeFileSync(f, '\uFEFF' + buildTxt(doc).replace(/\n/g, '\r\n'), 'utf8'); return f; }   // メモ帳でも文字化けしないよう BOM 付き UTF-8
    const f = path.join(dir, stem(doc) + '_しおり付き.pdf');
    const r = await CCF.electron.ipcRenderer.invoke('ccf:print-pdf', { html: buildPdfHtml(doc), outPath: f });
    if (!r || !r.ok) throw new Error((r && r.error) || 'PDFを作成できませんでした');
    return f;
  }

  function openMenu() {
    const doc = docOf(); if (!doc.scenes.length) return say('⚠️ 出力できるシーンがありません（「🎬 シーン」で本文を分割してから実行してください）');
    const old = document.getElementById('ccfDocExport'); if (old) old.remove();
    const ov = document.createElement('div'); ov.className = 'ccf-overlay'; ov.id = 'ccfDocExport'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); }, onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    const nb = doc.bookmarks.length;
    ov.innerHTML = `<div class="ccf-modal narrow"><div class="ccf-modal-head"><b>📤 シナリオ資料を再出力</b><span class="ccf-muted">${esc(doc.title)}／シーン ${doc.scenes.length}件・しおり ${nb}件</span><span class="ccf-spacer"></span><button type="button" class="ccf-mini" data-x="close">✕</button></div>
      <div class="ccf-modal-body single">
        <button type="button" class="ccf-btn primary ccf-doc-btn" data-x="html">🌐 GM進行用・ワンクリックコピーHTML（.html）<span class="ccf-muted">左：シーン目次／右：本文。段落クリックでコピー＋送信済み✓。背景・BGM・配布HOのガイド付き</span></button>
        <button type="button" class="ccf-btn primary ccf-doc-btn" data-x="pdf">📕 ${isElec ? 'しおり（アウトライン）付きPDF（.pdf）' : '印刷用PDF出力（ブラウザ印刷ダイアログ）'}<span class="ccf-muted">${isElec ? 'シーン区切り' + (nb ? '・しおり' : '') + 'をPDFの目次ツリーとして埋め込み' : '印刷画面を開き「PDFに保存」で書き出せます'}</span></button>
        <button type="button" class="ccf-btn primary ccf-doc-btn" data-x="txt">📝 整形済みテキスト（.txt）<span class="ccf-muted">途中改行・余分な空白・ページ番号を除去、シーン区切りは「■」見出し</span></button>
        <div class="ccf-wiz-result" data-xres style="display:none"></div></div>
      <div class="ccf-modal-foot"><span class="ccf-spacer"></span><button type="button" class="ccf-btn" data-x="close">閉じる</button></div></div>`;
    const showItem = p => {
      if (!p || !isElec) return;
      const ipc = CCF.electron && CCF.electron.ipcRenderer;
      if (ipc && ipc.invoke) { ipc.invoke('ccf:show-item', p).catch(() => { try { shell.showItemInFolder(p); } catch (_) { /* noop */ } }); return; }
      try { shell.showItemInFolder(p); } catch (er) { /* noop */ }
    };
    let busy = false;
    ov.addEventListener('click', async e => {
      const b = e.target.closest('[data-x]'); if (!b || busy) return; const k = b.dataset.x;
      if (k === 'close') return close();
      if (k === 'open') { showItem(b.dataset.path); return; }
      busy = true; ov.querySelectorAll('.ccf-doc-btn').forEach(x => { x.disabled = true; }); say('📤 書き出しています…');
      try {
        const f = await writeOut(k, docOf()), res = ov.querySelector('[data-xres]');
        res.style.display = '';
        res.innerHTML = isElec
          ? `<b>✅ 書き出しました</b><div class="ccf-wiz-path">${esc(f)}</div><button type="button" class="ccf-btn" data-x="open" data-path="${esc(f)}">📂 フォルダで表示</button>`
          : `<b>✅ ${k === 'pdf' ? '印刷プレビューを開きました' : 'ダウンロードしました'}</b><div class="ccf-wiz-path">${esc(f)}</div>`;
        say((isElec ? '💾 保存しました：' : '💾 書き出しました：') + f); if (isElec) showItem(f);
      } catch (er) { console.error('[ccf] 資料の再出力に失敗', er); say('❌ 書き出しに失敗しました：' + (er.message || er)); }
      finally { busy = false; ov.querySelectorAll('.ccf-doc-btn').forEach(x => { x.disabled = false; }); }
    });
    document.body.appendChild(ov); document.addEventListener('keydown', onKey, true);
  }
  CCF.docExport = { openMenu, writeOut, docOf };
})();
