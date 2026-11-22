/* ccf_scene_match.js — Phase 2-A：見出し解析・シーン分割結合・技能ノイズ除外・類義語＆3段階素材マッチング（純粋関数・Node/Browser両用） */
(function () {
  'use strict';

  const T = (typeof window !== 'undefined' && window.CCFText) || (typeof require === 'function' ? require('./ccf_text.js') : null);
  const NF = s => String(s == null ? '' : s).normalize('NFKC').replace(/\r\n?/g, '\n');
  const cleanInfoBody = s => (T && typeof T.cleanText === 'function')
    ? T.cleanText(String(s || ''), { joinLines: 'smart', stripSpaces: true })
    : String(s || '').trim();

  // ======================================================================
  // 1. HTML / TXT / PDF からの行抽出 & 見出しパターン自動検出
  // ======================================================================
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeHtmlEntities(s) {
    return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1);
        try { return String.fromCodePoint(n); } catch (_) { return ''; }
      }
      return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
    });
  }

  /** HTML 文字列から h1〜h3 タグ情報を保持した行配列を作る */
  function extractHtmlLines(html) {
    let s = String(html || '')
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    const tokens = [];
    s = s.replace(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, inner) => {
      const txt = decodeHtmlEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      const idx = tokens.length;
      tokens.push({ tag: tag.toLowerCase(), text: txt });
      return '\n@@CCF_H_' + idx + '@@\n';
    });
    s = s.replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[4-6]|table|ul|ol|section|article|blockquote)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, '');
    s = decodeHtmlEntities(s).replace(/\r\n?/g, '\n');
    const out = [];
    s.split('\n').forEach(raw => {
      const line = raw.replace(/[ \t]+/g, ' ').trim();
      if (!line) return;
      const m = /^@@CCF_H_(\d+)@@$/.exec(line);
      if (m) {
        const tok = tokens[+m[1]];
        if (tok && tok.text) out.push({ text: tok.text, page: 1, pageLineIdx: out.length, fontSize: 0, htmlTag: tok.tag, isLargeFont: true });
      } else {
        out.push({ text: line, page: 1, pageLineIdx: out.length, fontSize: 0, htmlTag: '', isLargeFont: false });
      }
    });
    return out;
  }

  /** TXT / MD 文字列から行配列を作る */
  function extractTxtLines(text) {
    return NF(text).split('\n').map(l => l.replace(/[ \t]+$/g, '')).filter(l => l.trim()).map((l, idx) => ({
      text: l.trim(), page: 1, pageLineIdx: idx, fontSize: 0, htmlTag: '', isLargeFont: false
    }));
  }

  /** PDF ページごとの textContent items（または簡易 {text,size} 行）からフォントサイズ付きの行配列を作る */
  function buildPdfLines(pagesData) {
    const rawLines = [];
    const sizeChars = new Map();
    (pagesData || []).forEach(pg => {
      const pageNo = pg.page || 1;
      if (Array.isArray(pg.lines)) {
        pg.lines.forEach(l => {
          const text = String(l.text || '').replace(/\s+/g, ' ').trim();
          if (!text) return;
          const sz = Math.round((Number(l.fontSize || l.size || 0)) * 2) / 2;
          if (sz > 0) sizeChars.set(sz, (sizeChars.get(sz) || 0) + text.length);
          rawLines.push({ text, page: pageNo, fontSize: sz, htmlTag: '', isLargeFont: !!l.isLargeFont });
        });
        return;
      }
      const items = pg.items || [];
      const pageLines = [];
      let cur = null;
      items.forEach(it => {
        const s = typeof it.str === 'string' ? it.str : '';
        if (!s || !s.trim()) return;
        const tr = it.transform || [10, 0, 0, 10, 0, 0];
        const sz = Math.round(Math.hypot(tr[2], tr[3]) * 2) / 2 || Math.round((Number(it.height || 10)) * 2) / 2;
        const y = Math.round(tr[5] / 3);
        const x = tr[4] || 0;
        if (sz > 0) sizeChars.set(sz, (sizeChars.get(sz) || 0) + s.trim().length);
        if (cur && Math.abs(cur.y - y) <= 1) {
          cur.parts.push({ x, s, sz });
          cur.fontSize = Math.max(cur.fontSize, sz);
        } else {
          cur = { page: pageNo, y, fontSize: sz, parts: [{ x, s, sz }] };
          pageLines.push(cur);
        }
      });
      pageLines.sort((a, b) => b.y - a.y);
      pageLines.forEach(l => {
        l.parts.sort((a, b) => a.x - b.x);
        const text = l.parts.map(p => p.s).join('').replace(/\s+/g, ' ').trim();
        if (text) rawLines.push({ text, page: l.page, fontSize: l.fontSize, htmlTag: '', isLargeFont: false });
      });
    });

    let modeSize = 10, bestCount = -1;
    sizeChars.forEach((cnt, sz) => { if (cnt > bestCount) { bestCount = cnt; modeSize = sz; } });
    const freq = new Map();
    const perPageCounter = new Map();
    rawLines.forEach(l => { freq.set(l.text, (freq.get(l.text) || 0) + 1); });
    return rawLines.map(l => {
      const len = Array.from(l.text).length;
      const repeatedHeader = (freq.get(l.text) || 0) > 3 && len <= 40;
      const large = l.isLargeFont || (!repeatedHeader && modeSize > 0 && l.fontSize >= modeSize * 1.25 && l.fontSize >= modeSize + 1.5 && len >= 2 && len <= 60);
      const pg = l.page || 1;
      const pageLineIdx = perPageCounter.get(pg) || 0;
      perPageCounter.set(pg, pageLineIdx + 1);
      return Object.assign({}, l, { pageLineIdx, isLargeFont: large, modeSize });
    });
  }

  const HEADING_PATTERNS = [
    { id: 'square', label: '■で始まる行', test: l => /^\s*[■□❑❏❐❒]\s*\S+/.test(NF(l.text)) },
    { id: 'diamond', label: '◆で始まる行', test: l => /^\s*[◆◇]\s*\S+/.test(NF(l.text)) },
    { id: 'brackets', label: '【】のみの行', test: l => /^\s*【[^】\n]{1,40}】\s*$/.test(NF(l.text)) },
    { id: 'chapter', label: '第○章 / シーン○', test: l => /^\s*(?:[■□◆◇●○▼▽★☆【\[]\s*)?(?:第\s*[0-9一二三四五六七八九十百]+\s*[章節幕話部回]|(?:シーン|Scene|SCENE|場面|フェイズ|Phase|PHASE|チャプター|Chapter|CHAPTER|Act|ACT)\s*[0-9一二三四五六七八九十A-Za-z#\-：:]*|プロローグ|オープニング|導入|クライマックス|エピローグ|エンディング)(?:\s*[】\]]|\s+|$|[:：])/.test(NF(l.text)) },
    { id: 'numdot', label: '数字＋ピリオド', test: l => /^\s*[0-9]{1,3}(?:\.[0-9]{1,2})?\.\s*\S+/.test(NF(l.text)) && Array.from(NF(l.text).trim()).length <= 60 },
    { id: 'richhead', label: 'PDFの大フォント行 / HTMLのh1〜h3', test: l => !!(l.isLargeFont || /^h[1-3]$/i.test(l.htmlTag || '')) },
    { id: 'other_sym', label: '●▼★等の記号行', test: l => /^\s*[●○▼▽▶▷★☆❖✦※]\s*\S+/.test(NF(l.text)) && Array.from(NF(l.text).trim()).length <= 60 }
  ];

  function parseCustomPrefixes(str) {
    const raw = Array.isArray(str) ? str.join(' ') : String(str || '');
    return raw.split(/[\s,、，;]+/).map(s => s.trim()).filter(Boolean);
  }

  function makeCustomMatcher(prefixesStr) {
    const list = parseCustomPrefixes(prefixesStr);
    if (!list.length) return () => false;
    const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^\\s*(?:' + list.map(escRe).join('|') + ')\\s*\\S+');
    return l => re.test(NF(l.text));
  }

  function detectHeadingStats(lines, customPrefixes) {
    const arr = Array.isArray(lines) ? lines : [];
    const stats = HEADING_PATTERNS.map(p => {
      const hits = [];
      arr.forEach((l, idx) => { if (p.test(l)) hits.push({ idx, text: l.text, page: l.page || 1 }); });
      return { id: p.id, label: p.label, count: hits.length, samples: hits.slice(0, 3).map(h => h.text) };
    });
    const customFn = makeCustomMatcher(customPrefixes);
    const customHits = [];
    arr.forEach((l, idx) => { if (customFn(l)) customHits.push({ idx, text: l.text }); });
    stats.push({ id: 'custom', label: 'カスタム先頭記号', count: customHits.length, samples: customHits.slice(0, 3).map(h => h.text) });
    return stats;
  }

  const DEFAULT_PATTERN_ROLES = {
    richhead: 'scene',
    chapter: 'scene',
    numdot: 'scene',
    square: 'scene',
    diamond: 'scene',
    brackets: 'scene',
    other_sym: 'info',
    custom: 'info'
  };

  function recommendPatternRoles(stats, granularity) {
    const g = granularity || 'standard';
    if (g === 'coarse') {
      return { richhead: 'scene', chapter: 'scene', numdot: 'info', square: 'info', diamond: 'info', brackets: 'info', other_sym: 'info', custom: 'info' };
    }
    if (g === 'detail') {
      return { richhead: 'scene', chapter: 'scene', numdot: 'scene', square: 'scene', diamond: 'scene', brackets: 'scene', other_sym: 'scene', custom: 'scene' };
    }
    return Object.assign({}, DEFAULT_PATTERN_ROLES);
  }

  function recommendEnabledPatterns(stats, granularity) {
    const roles = recommendPatternRoles(stats, granularity || 'standard');
    const picked = Object.keys(roles).filter(id => roles[id] === 'scene');
    return picked.length ? picked : ['chapter', 'numdot', 'richhead'];
  }

  function cleanHeadingTitle(raw) {
    let s = NF(raw).trim();
    s = s.replace(/^[■□❑❏❐❒◆◇●○▼▽▶▷★☆❖✦※\s]+/, '').trim();
    const m = /^【([^】]+)】$/.exec(s);
    if (m) s = m[1].trim();
    return s || NF(raw).trim();
  }

  // 非シーン見出し（技能・判定／結果・分岐／メタ項目）判定
  const NON_SCENE_SKILL_WORDS = '目星|聞き耳|アイデア|知識|幸運|心理学|オカルト|クトゥルフ神話|応急手当|精神分析|隠れる|忍び歩き|隠密|回避|こぶし|パンチ|キック|頭突き|組み付き|組付き|マーシャルアーツ|武道|投擲|跳躍|登攀|水泳|追跡|説得|信用|言いくるめ|値切り|博物学|天文学|考古学|人類学|生物学|化学|物理学|地質学|薬学|電気修理|機械修理|重機械操作|コンピューター?|電子工学|運転|操縦|鍵開け|写真術|変装|芸術|製作|ナビゲート|拳銃|ライフル|ショットガン|日本刀|杖|ナイフ|威圧|魅惑|手さばき|サバイバル|鑑定|近接戦闘|射撃|正気度(?:ロール|チェック)?|判定|ロール';
  // 「図書館」「歴史」「医学」「自然」は探索場所名にも頻出するため、括弧付き・単独・判定表現のみNG扱いとし「■図書館」「■歴史資料館」等は許容する
  const NON_SCENE_AMBIG_SKILLS = '図書館|歴史|医学|自然';
  const NON_SCENE_RESULT_WORDS = '成功|失敗|クリティカル|ファンブル|スペシャル|差分|分岐';
  const NON_SCENE_META_WORDS = 'KP情報|GM情報|KP向け|GM向け|秘匿|ハンドアウト|ステータス|クリア報酬|後遺症|NPC紹介|NPC一覧|あらすじ|概要|基本情報|シナリオ概要|推奨技能|注意事項|クレジット|奥付|目次|もくじ';
  const RE_NON_SCENE_JP = new RegExp('(?:' + NON_SCENE_SKILL_WORDS + '|' + NON_SCENE_RESULT_WORDS + '|' + NON_SCENE_META_WORDS + ')');
  const RE_NON_SCENE_AMBIG_SKILL = new RegExp('^(?:【\\s*(?:' + NON_SCENE_AMBIG_SKILLS + ')(?:\\s*[×*+\\-／/]\\s*\\d+|\\s*ロール|\\s*判定)?\\s*】|[〈《\\[\\(（]\\s*(?:' + NON_SCENE_AMBIG_SKILLS + ')(?:\\s*[×*+\\-／/]\\s*\\d+|\\s*ロール|\\s*判定)?\\s*[〉》\\]\\)）]|(?:' + NON_SCENE_AMBIG_SKILLS + ')(?:\\s*(?:ロール|判定|チェック|成功|失敗|[:：×*+\\-／/]|\\(?\\d+%|（[^）]*）))?)$');
  const RE_NON_SCENE_AMBIG_MOD = new RegExp('(?:' + NON_SCENE_AMBIG_SKILLS + ')\\s*(?:ロール|判定|チェック|成功|失敗|[×*+\\-／/]\\s*\\d+)');
  const RE_NON_SCENE_ASCII = /(?:^|[^A-Za-z])(?:SANC?|HO\d*|KP|GM)(?:$|[^A-Za-z])/i;

  function isNonSceneHeading(text) {
    const s = NF(text).trim();
    if (!s) return false;
    return RE_NON_SCENE_JP.test(s) || RE_NON_SCENE_AMBIG_SKILL.test(s) || RE_NON_SCENE_AMBIG_MOD.test(s) || RE_NON_SCENE_ASCII.test(s);
  }

  function getHeadingLevel(patternId) {
    if (patternId === 'outline' || patternId === 'toc' || patternId === 'richhead' || patternId === 'chapter') return 1;
    if (patternId === 'numdot' || patternId === 'square' || patternId === 'diamond') return 2;
    return 3;
  }

  function headingSymbolGroupKey(patternId, text) {
    const t = NF(text).trim();
    if (patternId === 'other_sym' || patternId === 'custom' || patternId === 'square' || patternId === 'diamond') {
      return patternId + ':' + (t.charAt(0) || '');
    }
    return patternId;
  }

  /** 序盤ページから目次エントリ（タイトル＋ページ番号）を抽出 */
  function extractTocEntries(lines) {
    const arr = Array.isArray(lines) ? lines : [];
    if (!arr.length) return [];
    let maxPage = 1;
    arr.forEach(l => { const p = Number(l.page || 1); if (p > maxPage) maxPage = p; });
    if (maxPage < 2) return [];
    const scanLimitPage = Math.min(10, Math.max(5, Math.ceil(maxPage * 0.25)));
    const reTocHeader = /^(?:[■□◆◇●○▼▽★☆【\[]\s*)?(?:目次|もくじ|CONTENTS|INDEX|シナリオ目次)(?:\s*[】\]])?$/i;
    const reTocEntry = /^(.{2,55}?)\s*(?:\.{2,}|…+|・{2,}|─{2,}|-{2,}|\s{2,})[pPｐＰ\.．]?\s*([0-9]{1,4})\s*$/;

    const tocPages = new Set();
    const byPage = new Map();
    arr.forEach(l => {
      const pg = Number(l.page || 1);
      if (pg > scanLimitPage) return;
      if (!byPage.has(pg)) byPage.set(pg, []);
      byPage.get(pg).push(l);
      if (reTocHeader.test(NF(l.text).trim())) tocPages.add(pg);
    });

    const candidates = [];
    byPage.forEach((pgLines, pg) => {
      const hits = [];
      pgLines.forEach(l => {
        const m = reTocEntry.exec(NF(l.text).trim());
        if (!m) return;
        const title = cleanHeadingTitle(m[1].replace(/[\.…・─\-\s]+$/g, '').trim());
        const targetPg = Number(m[2]);
        if (!title || /^[0-9.\-]+$/.test(title)) return;
        if (targetPg >= 1 && targetPg <= maxPage) {
          hits.push({ title, printedPage: targetPg, tocPage: pg, level: 0, source: 'toc' });
        }
      });
      if (tocPages.has(pg) || tocPages.has(pg - 1) || hits.length >= 3) {
        hits.forEach(h => candidates.push(h));
      }
    });
    if (candidates.length < 2) return [];

    // 印刷ページ番号と実PDFページのズレ（表紙・目次分）を自動推定
    const normMatch = s => cleanHeadingTitle(s).replace(/[\s　・:：\-]/g, '').toLowerCase();
    const offsets = [];
    candidates.slice(0, 8).forEach(c => {
      const key = normMatch(c.title);
      if (key.length < 2) return;
      for (let d = 0; d <= 6; d++) {
        const checkPg = c.printedPage + d;
        if (checkPg > maxPage || checkPg <= c.tocPage) continue;
        const hit = arr.some(l => Number(l.page || 1) === checkPg && normMatch(l.text).includes(key));
        if (hit) { offsets.push(d); break; }
      }
    });
    let offset = 0;
    if (offsets.length >= 2) {
      const counts = new Map();
      offsets.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
      let bestCnt = 0;
      counts.forEach((cnt, d) => { if (cnt > bestCnt) { bestCnt = cnt; offset = d; } });
    }

    return candidates
      .map(c => ({ title: c.title, page: Math.min(maxPage, Math.max(1, c.printedPage + offset)), level: 0, source: 'toc' }))
      .filter(c => c.page > 0 && c.page <= maxPage);
  }

  function resolvePatternSets(opts) {
    const o = opts || {};
    const roles = {};
    if (o.patternRoles && typeof o.patternRoles === 'object') {
      Object.assign(roles, o.patternRoles);
    } else if (Array.isArray(o.enabledPatterns)) {
      const en = new Set(o.enabledPatterns);
      HEADING_PATTERNS.forEach(p => { roles[p.id] = en.has(p.id) ? 'scene' : 'ignore'; });
      roles.custom = en.has('custom') ? 'scene' : 'ignore';
    } else {
      Object.assign(roles, recommendPatternRoles(null, o.granularity || 'standard'));
    }
    const toTests = roleName => {
      const list = HEADING_PATTERNS.filter(p => roles[p.id] === roleName).map(p => ({ id: p.id, fn: p.test }));
      if (roles.custom === roleName && parseCustomPrefixes(o.customPrefixes).length) {
        list.push({ id: 'custom', fn: makeCustomMatcher(o.customPrefixes) });
      }
      return list;
    };
    return {
      roles,
      sceneTests: toTests('scene'),
      infoTests: toTests('info')
    };
  }

  function resolveOutlineEntries(lines, opts) {
    const o = opts || {};
    if (o.useOutline === false) return { entries: [], method: 'heading' };
    const sp = o.startPage ? Number(o.startPage) : 1;
    const ep = o.endPage ? Number(o.endPage) : Infinity;
    const autoGuard = o.autoGuard !== undefined ? !!o.autoGuard : (o.granularity != null || o.patternRoles != null);

    let raw = Array.isArray(o.outline) ? o.outline.filter(e => e && e.title && Number(e.page) >= sp && Number(e.page) <= ep) : [];
    let method = 'outline';
    if (raw.length < 2) {
      raw = extractTocEntries(lines).filter(e => e.page >= sp && e.page <= ep);
      method = 'toc';
    }
    if (raw.length < 2) return { entries: [], method: 'heading' };

    if (o.granularity === 'coarse') {
      const top = raw.filter(e => (e.level || 0) === 0);
      if (top.length >= 2) raw = top;
    }
    if (autoGuard) {
      raw = raw.filter(e => !isNonSceneHeading(e.title));
    }
    if (raw.length < 2) return { entries: [], method: 'heading' };

    const sorted = raw.map((e, i) => Object.assign({}, e, { _idx: i }))
      .sort((a, b) => (a.page - b.page) || (a._idx - b._idx));
    return { entries: sorted, method };
  }

  function buildScenesFromOutline(filteredLines, entries, method, o) {
    if (!filteredLines.length || !entries.length) return [];
    const normCmp = s => cleanHeadingTitle(s).replace(/[\s　・:：\-]/g, '').toLowerCase();
    const usedLineIdx = new Set();
    const splitPoints = [];

    entries.forEach(ent => {
      const key = normCmp(ent.title);
      let found = -1;
      for (let i = 0; i < filteredLines.length; i++) {
        if (usedLineIdx.has(i) || Number(filteredLines[i].page || 1) !== ent.page) continue;
        const lnNorm = normCmp(filteredLines[i].text);
        if (key && (lnNorm === key || lnNorm.includes(key) || (lnNorm.length >= 2 && key.includes(lnNorm)))) {
          found = i;
          break;
        }
      }
      if (found < 0) {
        for (let i = 0; i < filteredLines.length; i++) {
          if (!usedLineIdx.has(i) && Number(filteredLines[i].page || 1) >= ent.page) {
            found = i;
            break;
          }
        }
      }
      if (found >= 0) {
        usedLineIdx.add(found);
        splitPoints.push({ idx: found, entry: ent });
      }
    });

    splitPoints.sort((a, b) => a.idx - b.idx);
    if (!splitPoints.length) return [];

    const scenes = [];
    const firstSplit = splitPoints[0].idx;
    if (firstSplit > 0) {
      const introLines = filteredLines.slice(0, firstSplit).map(l => String(l.text || '').trim()).filter(Boolean);
      if (introLines.length) {
        const l0 = filteredLines[0];
        scenes.push({
          id: 'sc_1_' + Math.random().toString(36).slice(2, 7),
          title: o.defaultTitle || '導入・冒頭',
          text: introLines.join('\n').trim(),
          page: l0.page || 1,
          lineIdx: l0.pageLineIdx != null ? l0.pageLineIdx : 0,
          docIdx: o.docIdx != null ? o.docIdx : null,
          sourceName: o.sourceName || '',
          sourcePath: o.sourcePath || '',
          headingPattern: 'intro',
          checked: false,
          tags: []
        });
      }
    }

    for (let s = 0; s < splitPoints.length; s++) {
      const start = splitPoints[s].idx;
      const end = (s + 1 < splitPoints.length) ? splitPoints[s + 1].idx : filteredLines.length;
      const ent = splitPoints[s].entry;
      const lStart = filteredLines[start];
      const chunk = filteredLines.slice(start, end).map(l => String(l.text || '').trim()).filter(Boolean);
      const title = cleanHeadingTitle(ent.title);
      scenes.push({
        id: 'sc_' + (scenes.length + 1) + '_' + Math.random().toString(36).slice(2, 7),
        title: title || cleanHeadingTitle(chunk[0] || ('シーン ' + (scenes.length + 1))),
        text: chunk.join('\n').trim(),
        page: ent.page || lStart.page || 1,
        lineIdx: lStart.pageLineIdx != null ? lStart.pageLineIdx : 0,
        docIdx: o.docIdx != null ? o.docIdx : null,
        sourceName: o.sourceName || '',
        sourcePath: o.sourcePath || '',
        headingPattern: method,
        checked: false,
        tags: []
      });
    }
    try { Object.defineProperty(scenes, '_splitMethod', { value: method, enumerable: false }); } catch (_) { }
    return scenes;
  }

  function buildScenesFromLines(lines, opts) {
    const arr = Array.isArray(lines) ? lines : [];
    if (!arr.length) return [];
    const o = Object.assign({ customPrefixes: '', sourceName: '', sourcePath: '', docIdx: null }, opts || {});
    const autoGuard = o.autoGuard !== undefined ? !!o.autoGuard : (o.granularity != null || o.patternRoles != null);

    const filtered = arr.filter(l => {
      const pg = Number(l.page || 1);
      if (o.startPage && pg < Number(o.startPage)) return false;
      if (o.endPage && pg > Number(o.endPage)) return false;
      return !!String(l.text || '').trim();
    });
    if (!filtered.length) return [];

    // 1. PDFしおり / 序盤の目次ページがあれば最優先でシーン化
    const outlineRes = resolveOutlineEntries(filtered, o);
    if (outlineRes.entries.length >= 2) {
      const outlineScenes = buildScenesFromOutline(filtered, outlineRes.entries, outlineRes.method, o);
      if (outlineScenes.length) return outlineScenes;
    }

    // 2. 本文見出しスキャン
    const gran = o.granularity || (o.patternRoles ? 'custom' : 'standard');
    const { sceneTests } = resolvePatternSets(o);
    const activeTests = (o.granularity === 'coarse' && !o.patternRoles && !o.enabledPatterns)
      ? sceneTests.filter(t => t.id === 'richhead' || t.id === 'chapter')
      : sceneTests;

    // 各行の見出し候補ヒットを事前判定し、NGワードを除外
    const pageGroupCounts = new Map();
    const rawHits = filtered.map(l => {
      const txt = String(l.text || '').trim();
      const hit = activeTests.find(t => t.fn(l));
      if (!hit) return null;
      if (autoGuard && isNonSceneHeading(txt)) return null;
      const gKey = (l.page || 1) + '|' + headingSymbolGroupKey(hit.id, txt);
      pageGroupCounts.set(gKey, (pageGroupCounts.get(gKey) || 0) + 1);
      return { id: hit.id, gKey };
    });

    // 直後に続く描写本文（次の見出し候補までの行数・文字数）を先読み計算
    const bodyStatsAfter = rawHits.map((h, i) => {
      if (!h) return null;
      let linesCount = 0;
      let charsCount = 0;
      for (let j = i + 1; j < filtered.length; j++) {
        if (rawHits[j]) break;
        const bodyTxt = String(filtered[j].text || '').trim();
        if (!bodyTxt) continue;
        linesCount++;
        charsCount += bodyTxt.replace(/\s+/g, '').length;
      }
      return { linesCount, charsCount, hasDescBody: linesCount >= 2 || charsCount >= 35 };
    });

    const scenes = [];
    let cur = null;
    const flush = () => {
      if (!cur) return;
      cur.text = cur.lines.join('\n').trim();
      delete cur.lines;
      delete cur.hasHeading;
      if (cur.text || cur.title) scenes.push(cur);
      cur = null;
    };

    filtered.forEach((l, i) => {
      const txt = String(l.text || '').trim();
      let hit = rawHits[i];
      const afterStat = bodyStatsAfter[i];
      const hasDescBody = !!(afterStat && afterStat.hasDescBody);

      if (hit && autoGuard) {
        if (gran === 'coarse') {
          if ((pageGroupCounts.get(hit.gKey) || 0) >= 4) hit = null;
          if (hit && cur && cur.hasHeading) {
            const bodyLines = cur.lines.slice(1).filter(x => String(x).trim());
            const bodyChars = bodyLines.join('').replace(/\s+/g, '').length;
            if ((bodyLines.length <= 3 || bodyChars < 120) && getHeadingLevel(cur.headingPattern) === getHeadingLevel(hit.id)) {
              hit = null;
            }
          }
        } else if (gran === 'detail') {
          if (afterStat && afterStat.linesCount === 0) {
            hit = null;
          } else if ((pageGroupCounts.get(hit.gKey) || 0) >= 4 && afterStat && afterStat.linesCount <= 1 && afterStat.charsCount < 20) {
            hit = null;
          }
        } else {
          // 標準モード：NGワードを含まず直後に描写本文（2行以上または35文字以上）が続く見出しは削らず独立シーン化
          if (!hasDescBody) {
            const isTopHeading = hit.id === 'richhead' || hit.id === 'chapter';
            if (!isTopHeading) {
              hit = null;
            } else if ((pageGroupCounts.get(hit.gKey) || 0) >= 4 || (afterStat && afterStat.linesCount === 0)) {
              hit = null;
            } else if (cur && cur.hasHeading) {
              const bodyLines = cur.lines.slice(1).filter(x => String(x).trim());
              const bodyChars = bodyLines.join('').replace(/\s+/g, '').length;
              if ((bodyLines.length <= 3 || bodyChars < 120) && getHeadingLevel(cur.headingPattern) === getHeadingLevel(hit.id)) {
                hit = null;
              }
            }
          }
        }
      }

      if (hit) {
        flush();
        cur = {
          id: 'sc_' + (scenes.length + 1) + '_' + Math.random().toString(36).slice(2, 7),
          title: cleanHeadingTitle(txt),
          lines: [txt],
          hasHeading: true,
          page: l.page || 1,
          lineIdx: l.pageLineIdx != null ? l.pageLineIdx : 0,
          docIdx: o.docIdx != null ? o.docIdx : null,
          sourceName: o.sourceName || '',
          sourcePath: o.sourcePath || '',
          headingPattern: hit.id,
          checked: false,
          tags: []
        };
      } else {
        if (!cur) {
          cur = {
            id: 'sc_' + (scenes.length + 1) + '_' + Math.random().toString(36).slice(2, 7),
            title: o.defaultTitle || '導入・冒頭',
            lines: [],
            hasHeading: false,
            page: l.page || 1,
            lineIdx: l.pageLineIdx != null ? l.pageLineIdx : 0,
            docIdx: o.docIdx != null ? o.docIdx : null,
            sourceName: o.sourceName || '',
            sourcePath: o.sourcePath || '',
            headingPattern: 'intro',
            checked: false,
            tags: []
          };
        }
        cur.lines.push(txt);
      }
    });
    flush();
    try { Object.defineProperty(scenes, '_splitMethod', { value: 'heading', enumerable: false }); } catch (_) { }
    return scenes;
  }

  /** 行（または行オブジェクト）が指定役割（'info' | 'scene'）の見出しに一致するか判定 */
  function matchHeadingRole(lineOrText, role, opts) {
    const l = (lineOrText && typeof lineOrText === 'object') ? lineOrText : { text: String(lineOrText || ''), page: 1, fontSize: 0, htmlTag: '', isLargeFont: false };
    if (!String(l.text || '').trim()) return null;
    const { roles, sceneTests, infoTests } = resolvePatternSets(opts);
    const tests = role === 'scene' ? sceneTests : (role === 'info' ? infoTests : [...sceneTests, ...infoTests]);
    const hit = tests.find(t => t.fn(l));
    return hit ? { id: hit.id, role: roles[hit.id] || role, text: String(l.text || '').trim() } : null;
  }

  /** 指定ページ範囲の行配列から「📝 情報テキスト候補」見出しブロックを一括抽出 */
  function extractInfoBlocksFromLines(lines, opts) {
    const arr = Array.isArray(lines) ? lines : [];
    if (!arr.length) return [];
    const o = Object.assign({ customPrefixes: '', sourceName: '', sourcePath: '', docIdx: null }, opts || {});
    const filtered = arr.filter(l => {
      const pg = Number(l.page || 1);
      if (o.startPage && pg < Number(o.startPage)) return false;
      if (o.endPage && pg > Number(o.endPage)) return false;
      return !!String(l.text || '').trim();
    });
    const { sceneTests, infoTests } = resolvePatternSets(o);
    if (!infoTests.length) return [];

    const blocks = [];
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const bodyRaw = cur.bodyLines.join('\n').trim();
      const bodyClean = bodyRaw ? cleanInfoBody(bodyRaw) : '';
      blocks.push({
        id: 'ib_' + (blocks.length + 1),
        title: cur.title,
        headingText: cur.headingText,
        patternId: cur.patternId,
        bodyRaw,
        text: bodyClean || cur.title,
        hasBody: !!bodyClean,
        page: cur.page,
        lineIdx: cur.lineIdx,
        docIdx: o.docIdx != null ? o.docIdx : null,
        sourceName: o.sourceName || '',
        sourcePath: o.sourcePath || ''
      });
      cur = null;
    };

    filtered.forEach(l => {
      const txt = String(l.text || '').trim();
      const infoHit = infoTests.find(t => t.fn(l));
      const sceneHit = sceneTests.find(t => t.fn(l));
      if (infoHit) {
        flush();
        cur = {
          title: cleanHeadingTitle(txt),
          headingText: txt,
          patternId: infoHit.id,
          bodyLines: [],
          page: l.page || 1,
          lineIdx: l.pageLineIdx != null ? l.pageLineIdx : 0
        };
      } else if (sceneHit) {
        flush();
      } else if (cur) {
        cur.bodyLines.push(txt);
      }
    });
    flush();
    return blocks;
  }

  function splitSceneAtLine(scenes, sceneIdx, lineIdx) {
    const list = Array.isArray(scenes) ? scenes.map(s => Object.assign({}, s)) : [];
    const target = list[sceneIdx];
    if (!target) return list;
    const lines = String(target.text || '').replace(/\r\n?/g, '\n').split('\n');
    if (lineIdx < 1 || lineIdx >= lines.length) return list;
    const headLines = lines.slice(0, lineIdx);
    const tailLines = lines.slice(lineIdx);
    const firstTail = tailLines.find(l => l.trim()) || ('シーン ' + (sceneIdx + 2));
    target.text = headLines.join('\n').trim();
    const nextScene = {
      id: 'sc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      title: cleanHeadingTitle(firstTail).slice(0, 48),
      text: tailLines.join('\n').trim(),
      page: target.page || 1,
      sourceName: target.sourceName || '',
      sourcePath: target.sourcePath || '',
      headingPattern: 'manual',
      checked: !!target.checked,
      tags: [],
      manualSlots: { bg: false, screen: false, bgm: false },
      bg: null,
      fg: null,
      screens: [],
      markers: [],
      bgm: null
    };
    list.splice(sceneIdx + 1, 0, nextScene);
    return list;
  }

  function mergeSceneWithPrev(scenes, sceneIdx) {
    const list = Array.isArray(scenes) ? scenes.map(s => Object.assign({}, s)) : [];
    if (sceneIdx <= 0 || sceneIdx >= list.length) return list;
    const prev = list[sceneIdx - 1], cur = list[sceneIdx];
    const parts = [];
    if (prev.text && prev.text.trim()) parts.push(prev.text.trim());
    const curText = String(cur.text || '').trim();
    if (curText) parts.push(curText);
    else if (cur.title && cur.title.trim()) parts.push(cur.title.trim());
    prev.text = parts.join('\n');
    list.splice(sceneIdx, 1);
    return list;
  }

  function splitSceneByDelimiter(scenes, sceneIdx, delimiterRe) {
    const list = Array.isArray(scenes) ? scenes.map(s => Object.assign({}, s)) : [];
    const target = list[sceneIdx];
    if (!target) return list;
    const re = delimiterRe || /^\s*-{3,}\s*$/;
    const lines = String(target.text || '').replace(/\r\n?/g, '\n').split('\n');
    const chunks = [];
    let cur = [];
    lines.forEach(ln => {
      if (re.test(ln)) {
        const txt = cur.join('\n').trim();
        if (txt) chunks.push(txt);
        cur = [];
      } else {
        cur.push(ln);
      }
    });
    const lastTxt = cur.join('\n').trim();
    if (lastTxt) chunks.push(lastTxt);
    if (chunks.length < 2) return list;

    target.text = chunks[0];
    const inserted = chunks.slice(1).map((txt, idx) => {
      const firstLine = (txt.split('\n').find(l => l.trim()) || '').trim();
      const title = (firstLine && Array.from(firstLine).length <= 40)
        ? cleanHeadingTitle(firstLine)
        : (String(target.title || 'シーン') + ' (' + (idx + 2) + ')');
      return {
        id: 'sc_' + Date.now().toString(36) + '_' + idx + '_' + Math.random().toString(36).slice(2, 6),
        title,
        text: txt,
        page: target.page || 1,
        sourceName: target.sourceName || '',
        sourcePath: target.sourcePath || '',
        headingPattern: 'manual',
        checked: !!target.checked,
        tags: [],
        manualSlots: { bg: false, screen: false, bgm: false },
        bg: null,
        fg: null,
        screens: [],
        markers: [],
        bgm: null
      };
    });
    list.splice(sceneIdx + 1, 0, ...inserted);
    return list;
  }

  // ======================================================================
  // 2. 技能ノイズ除外＆人名・別単語誤爆防止＆類義語・3段階素材マッチング
  // ======================================================================
  const SKILL_WORDS = '目星|聞き耳|図書館|アイデア|幸運|知識|SAN|SANC|SANチェック|正気度(?:ロール|チェック)?|心理学|オカルト|クトゥルフ神話|歴史|医学|応急手当|精神分析|隠れる|忍び歩き|隠密|回避|こぶし|パンチ|キック|頭突き|組み付き|組付き|マーシャルアーツ|武道|投擲|跳躍|登攀|水泳|追跡|説得|信用|言いくるめ|値切り|博物学|自然|天文学|考古学|人類学|生物学|化学|物理学|地質学|薬学|電気修理|機械修理|重機械操作|コンピューター?|電子工学|運転|操縦|鍵開け|写真術|変装|芸術|製作|ナビゲート|拳銃|ライフル|ショットガン|サブマシンガン|マシンガン|日本刀|杖|ナイフ|弓|威圧|魅惑|手さばき|サバイバル|鑑定|近接戦闘|射撃|判定|成功|失敗|クリティカル|ファンブル|スペシャル|ダイス|CCB?|1d100|STR|CON|POW|DEX|APP|SIZ|INT|EDU|HP|MP';
  const RE_SKILL_IN_SQUARE = new RegExp('【\\s*(?:' + SKILL_WORDS + ')(?:\\s*[×*+\\-／/]\\s*\\d+|\\s*ロール|\\s*判定)?\\s*】', 'gi');

  /** 文中の技能判定表記（《図書館》や【目星】、〈聞き耳〉等の行内括弧閉じ）を除外する */
  function stripSkillNoise(text) {
    let s = NF(text);
    // 《...》 〈...〉 ≪...≫ は技能・ルビ・判定表現として丸ごと除去
    s = s.replace(/《[^》\n]{1,32}》/g, ' ');
    s = s.replace(/〈[^〉\n]{1,32}〉/g, ' ');
    s = s.replace(/≪[^≫\n]{1,32}≫/g, ' ');
    // 明示的な技能名・判定名の【...】は行頭でも除去
    s = s.replace(RE_SKILL_IN_SQUARE, ' ');
    // 行内（前後に文字がある）括弧閉じの【...】は文中の技能判定/システム表記として除去
    s = s.split('\n').map(line => {
      // 行内に前後いずれかに非空白文字がある【...】を除去（行単独の【図書館】などは見出しとして残る）
      return line
        .replace(/(\S[^\n]*?)【[^】\n]{1,24}】/g, '$1 ')
        .replace(/【[^】\n]{1,24}】([^\n]*?\S)/g, ' $1');
    }).join('\n');
    // 〈〉と同様の半角/全角技能ヒント表記（技能成功時など）
    s = s.replace(/[（(]\s*(?:技能\s*[:：]?\s*)?(?:目星|聞き耳|図書館|アイデア|幸運|知識|心理学|オカルト|SANチェック|SANC)\s*[）)]/gi, ' ');
    return s;
  }

  // 人名・別単語の一部誤爆（「森田」の「森」、「街灯」の「街」等）を防ぐためのマスク対象語
  const FALSE_COMPOUNDS = [
    '森田', '森本', '森下', '森山', '森川', '森永', '森岡', '森谷', '森村', '森井', '森崎', '森口', '森野', '大森', '小森', '森羅万象',
    '街灯', '外灯', '蛍光灯', '懐中電灯', '街頭',
    '海外', '海賊', '海鮮', '海苔', '海綿', '北海道', '海馬',
    '山田', '山口', '山本', '山崎', '山下', '山中', '山村', '山岡', '山内', '山岸', '山ほど', '山盛り', '山積み', '山分け',
    '川村', '川口', '川崎', '川上', '川島', '川本', '川端',
    '林田', '大林', '小林', '中林', '若林', '松林', '竹林',
    '星野', '星川', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜',
    '月日', '年月', '毎月', '今月', '先月', '来月', '毎日', '今日', '明日', '昨日', '一昨日',
    '朝食', '昼食', '夕食', '夜勤', '夜更かし', '雨具', '雨戸',
    '血管', '血液', '出血', '血圧', '献血', '輸血', '火災報知', '火曜日', '観光', '光景'
  ];
  const RE_FALSE_COMPOUNDS = new RegExp(FALSE_COMPOUNDS.join('|'), 'g');
  const RE_PERSON_NAME = /[\u4E00-\u9FFF]{1,3}(?:さん|くん|ちゃん|氏|様|先生|教授|刑事|警部|巡査|医師|医者|看護師|社長|部長|課長)/g;
  const RE_SINGLE_SURNAME = /[森街海山川林星月雪雨夜朝春秋冬花風空光闇](?:田|本|下|村|岡|谷|口|崎|井|原|野|永|沢|澤|木|塚|藤|太|郎|子|美|雄|男|夫|介|助|史|彦|也|哉)/g;

  function maskFalsePositiveCompounds(text) {
    return NF(text)
      .replace(RE_FALSE_COMPOUNDS, ' ')
      .replace(RE_PERSON_NAME, ' ')
      .replace(RE_SINGLE_SURNAME, ' ');
  }

  // 主要な場所・時間・雰囲気・状況の類義語辞書
  const SYNONYM_GROUPS = [
    { id: 'school', label: '学校・学園', kinds: ['bg', 'bgm', 'screen'], terms: ['学校', '校舎', '教室', '学園', '学院', '高校', '中学', '小学校', '大学', 'キャンパス', '校庭', '保健室', '職員室', '部室', '体育館', '屋上', 'school', 'classroom'] },
    { id: 'library', label: '図書館・書庫', kinds: ['bg', 'bgm', 'screen'], terms: ['図書館', '書庫', '図書室', '資料室', '書斎', '本棚', 'アーカイブ', '書店', 'library', 'archive'] },
    { id: 'forest', label: '森・林・樹海', kinds: ['bg', 'bgm'], terms: ['森', '森林', '林', '樹海', '山林', '雑木林', '森の中', 'forest', 'woods'] },
    { id: 'hospital', label: '病院・診療所', kinds: ['bg', 'bgm', 'screen'], terms: ['病院', '病室', '診療所', '医院', 'クリニック', '診察室', 'ナースステーション', '集中治療室', '霊安室', '医務室', 'hospital', 'clinic'] },
    { id: 'battle', label: '戦闘・襲撃', kinds: ['bgm', 'screen'], terms: ['戦闘', '襲撃', 'バトル', '交戦', '決戦', 'ボス戦', '戦闘開始', 'battle', 'combat', 'boss'] },
    { id: 'town', label: '街・都市', kinds: ['bg', 'bgm'], terms: ['街', '市街', '市街地', '都市', '繁華街', '商店街', '住宅街', '街並み', '街角', '街中', '大通り', '路地', '路地裏', 'city', 'town', 'street', 'downtown'] },
    { id: 'night', label: '夜・深夜', kinds: ['bg', 'bgm'], terms: ['夜', '夜間', '深夜', '夜中', '真夜中', '夜更け', '夜道', '夜景', '夜空', '月夜', '星空', 'night', 'midnight'] },
    { id: 'evening', label: '夕方・黄昏', kinds: ['bg', 'bgm'], terms: ['夕方', '夕暮れ', '夕焼け', '黄昏', '逢魔時', '日暮れ', 'sunset', 'evening', 'twilight'] },
    { id: 'morning', label: '朝・昼', kinds: ['bg', 'bgm'], terms: ['朝', '早朝', '朝焼け', '昼', '日中', '昼間', 'morning', 'noon', 'daytime'] },
    { id: 'rain', label: '雨・嵐', kinds: ['bg', 'bgm'], terms: ['雨', '大雨', '豪雨', '小雨', '雨音', '雨天', '嵐', '台風', '雷', '雷雨', 'rain', 'storm', 'thunder'] },
    { id: 'snow', label: '雪・冬', kinds: ['bg', 'bgm'], terms: ['雪', '吹雪', '大雪', '雪原', '雪山', '冬', '氷', 'snow', 'winter', 'blizzard'] },
    { id: 'sea', label: '海・港', kinds: ['bg', 'bgm'], terms: ['海', '海岸', '海辺', '海面', '砂浜', 'ビーチ', '港', '埠頭', '船', 'sea', 'ocean', 'beach', 'port'] },
    { id: 'mountain', label: '山・峠', kinds: ['bg', 'bgm'], terms: ['山', '山道', '山奥', '山小屋', '峠', '登山', 'mountain'] },
    { id: 'shrine', label: '神社・寺', kinds: ['bg', 'bgm'], terms: ['神社', '鳥居', '境内', '社殿', 'お寺', '寺', '寺院', '本堂', '参道', 'shrine', 'temple'] },
    { id: 'mansion', label: '洋館・屋敷', kinds: ['bg', 'bgm'], terms: ['洋館', '屋敷', '館', '邸宅', '豪邸', '城', '古城', '別荘', 'mansion', 'manor', 'castle'] },
    { id: 'room', label: '部屋・自宅', kinds: ['bg', 'bgm'], terms: ['自宅', '民家', 'アパート', 'マンション', '部屋', '自室', 'リビング', '玄関', '寝室', '台所', 'キッチン', '和室', '家', 'room', 'house', 'apartment'] },
    { id: 'station', label: '駅・電車', kinds: ['bg', 'bgm'], terms: ['駅', '駅前', 'ホーム', '改札', '電車', '列車', '鉄道', '地下鉄', 'station', 'train'] },
    { id: 'ruins', label: '地下・廃墟・洞窟', kinds: ['bg', 'bgm'], terms: ['地下', '地下室', '洞窟', '遺跡', '廃墟', '廃ビル', '廃屋', '廃校', '廃病院', 'dungeon', 'cave', 'ruins'] },
    { id: 'park', label: '公園・広場', kinds: ['bg', 'bgm'], terms: ['公園', '広場', 'ベンチ', '噴水', 'park'] },
    { id: 'cafe', label: '喫茶店・店', kinds: ['bg', 'bgm'], terms: ['喫茶店', 'カフェ', 'バー', 'レストラン', '食堂', '居酒屋', '酒場', '店内', '店', 'cafe', 'bar', 'shop'] },
    { id: 'office', label: '事務所・警察', kinds: ['bg', 'bgm'], terms: ['警察', '警察署', '交番', '探偵事務所', '事務所', 'オフィス', '会社', '取調室', 'office', 'police'] },
    { id: 'grave', label: '墓地・霊園', kinds: ['bg', 'bgm'], terms: ['墓地', '墓場', '霊園', '墓', 'お墓', 'graveyard', 'cemetery'] },
    { id: 'abyss', label: '異世界・神殿・深淵', kinds: ['bg', 'bgm'], terms: ['異世界', '異空間', '虚空', '宇宙', '深淵', '神殿', '祭壇', '儀式', 'abyss', 'void', 'ritual'] },
    { id: 'horror', label: '恐怖・不穏・緊迫', kinds: ['bgm', 'bg'], terms: ['恐怖', 'ホラー', '不穏', '怪異', '心霊', '不気味', '静寂', '緊迫', '緊張', 'サスペンス', '焦燥', '追跡', '逃走', '狂気', 'horror', 'suspense', 'tension', 'chase', 'dark', 'creepy'] },
    { id: 'calm', label: '日常・穏やか', kinds: ['bgm'], terms: ['日常', '平穏', '穏やか', 'ほのぼの', '休息', '平和', '談笑', 'daily', 'calm', 'peaceful', 'chill'] },
    { id: 'sad', label: '悲しみ・別れ・エンディング', kinds: ['bgm'], terms: ['悲しみ', '哀愁', '切ない', '涙', '別れ', '感動', 'エンディング', 'エピローグ', '真相', 'sad', 'emotional', 'ending'] },
    { id: 'mystery', label: '調査・探索・推理', kinds: ['bgm', 'screen'], terms: ['調査', '探索', '推理', '捜査', 'ミステリー', '手がかり', '情報', 'mystery', 'investigate'] },
    { id: 'opening', label: '導入・オープニング', kinds: ['bgm', 'bg'], terms: ['導入', 'プロローグ', 'オープニング', '開始', '始まり', 'prologue', 'opening', 'intro'] },
    { id: 'clue_doc', label: '資料・地図・手紙', kinds: ['screen'], terms: ['見取り図', '間取り', '地図', 'マップ', '手紙', '日記', '新聞', '記事', '写真', '黒板', 'モニター', '資料', 'ハンドアウト', 'map', 'letter', 'photo', 'diary'] }
  ];

  const isSingleKanji = s => /^[\u4E00-\u9FFF]$/.test(s);
  const isKanjiChar = ch => !!ch && /[\u4E00-\u9FFF]/.test(ch);

  /** テキスト中にキーワード kw がノイズでなく実際に登場するか判定 */
  function textHasKeyword(maskedText, kw, allowedCompounds) {
    const t = String(maskedText || '');
    const k = NF(kw).trim();
    if (!t || !k) return false;
    if (/^[A-Za-z0-9_]+$/.test(k)) {
      const re = new RegExp('(?<![A-Za-z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'i');
      return re.test(t);
    }
    if (!isSingleKanji(k)) {
      return t.toLowerCase().includes(k.toLowerCase());
    }
    // 1文字漢字（森・街・海・山・夜・朝・雨・雪・家・駅・店 等）：
    // 前後が漢字でない（助詞・空白・句読点・文頭文末）出現のみ有効とする
    let idx = 0;
    while ((idx = t.indexOf(k, idx)) !== -1) {
      const prev = idx > 0 ? t[idx - 1] : '';
      const next = idx + 1 < t.length ? t[idx + 1] : '';
      if (!isKanjiChar(prev) && !isKanjiChar(next)) return true;
      // 前後に漢字がつながる場合でも、同じ類義語グループの複合語（例：森林・商店街・深夜）は長語の方で既に拾えるが、念のため確認
      if (allowedCompounds && allowedCompounds.some(c => c.length > 1 && c.includes(k) && t.slice(Math.max(0, idx - 3), idx + 4).includes(c))) {
        return true;
      }
      idx++;
    }
    return false;
  }

  /** シーンから場所・時間・雰囲気キーワードを抽出する */
  function extractSceneKeywords(scene) {
    const sc = scene || {};
    const rawTitle = cleanHeadingTitle(sc.title || '');
    // タイトル自体が純粋に技能チェック名だけ（例：「目星」）でない限りタイトルを優先ソースにする
    const titleCleaned = maskFalsePositiveCompounds(rawTitle.replace(RE_SKILL_IN_SQUARE, ' '));
    const bodyCleaned = maskFalsePositiveCompounds(stripSkillNoise(sc.text || ''));
    const userTags = Array.isArray(sc.tags) ? sc.tags.map(x => NF(x).trim()).filter(Boolean) : [];

    const matchedGroups = [];
    const primaryKeywords = [];
    const secondaryKeywords = [];
    const seenPrimary = new Set(), seenSecondary = new Set();

    const addPri = w => { const k = w.toLowerCase(); if (!seenPrimary.has(k)) { seenPrimary.add(k); primaryKeywords.push(w); } };
    const addSec = w => { const k = w.toLowerCase(); if (!seenSecondary.has(k) && !seenPrimary.has(k)) { seenSecondary.add(k); secondaryKeywords.push(w); } };

    userTags.forEach(addPri);

    SYNONYM_GROUPS.forEach(g => {
      const multiTerms = g.terms.filter(x => !isSingleKanji(x));
      let titleHits = [], bodyHits = [];
      g.terms.forEach(term => {
        if (textHasKeyword(titleCleaned, term, multiTerms)) titleHits.push(term);
        else if (textHasKeyword(bodyCleaned, term, multiTerms)) bodyHits.push(term);
      });
      if (titleHits.length || bodyHits.length) {
        matchedGroups.push({
          id: g.id,
          label: g.label,
          kinds: g.kinds,
          directTerms: [...new Set([...titleHits, ...bodyHits])],
          synonyms: g.terms,
          inTitle: titleHits.length > 0
        });
        titleHits.forEach(addPri);
        bodyHits.forEach(addSec);
      }
    });

    return {
      titleCleaned,
      bodyCleaned,
      primaryKeywords,
      secondaryKeywords,
      keywords: [...primaryKeywords, ...secondaryKeywords],
      groups: matchedGroups
    };
  }

  // ======================================================================
  // 3. 3段階優先度スコア算出（📌登録素材 → マイライブラリカスタムタグ → マイライブラリフォルダ/ID3/ファイル名）
  // ======================================================================
  function normPathKey(p) {
    return String(p || '').replace(/\//g, '\\').toLowerCase().trim();
  }

  function assetParentFolder(item) {
    if (item && item.parent) return String(item.parent).trim();
    const p = String((item && item.path) || '');
    if (!p) return '';
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : '';
  }

  /** アセットテキスト（タグ・フォルダ名・ファイル名）にキーワードまたは類義語が一致するかを判定 */
  function matchTextAgainstKeywords(fieldText, extracted) {
    const raw = NF(fieldText).trim();
    if (!raw) return { direct: [], synonym: [] };
    const masked = maskFalsePositiveCompounds(raw);
    const direct = [], synonym = [];
    const seenD = new Set(), seenS = new Set();

    // 1) シーンから直接抽出したキーワード一致
    extracted.keywords.forEach(kw => {
      if (textHasKeyword(masked, kw, null)) {
        const k = kw.toLowerCase();
        if (!seenD.has(k)) { seenD.add(k); direct.push(kw); }
      }
    });

    // 2) 類義語グループの展開一致（例：シーンが「図書館」なら、素材側の「書庫」「図書室」も一致）
    extracted.groups.forEach(g => {
      const multi = g.synonyms.filter(x => !isSingleKanji(x));
      g.synonyms.forEach(syn => {
        if (textHasKeyword(masked, syn, multi)) {
          const k = syn.toLowerCase();
          if (seenD.has(k)) return;
          if (!seenS.has(k)) { seenS.add(k); synonym.push(syn); }
        }
      });
    });

    return { direct, synonym };
  }

  function slotBonus(item, slot) {
    const cat = NF(item.category || '').toLowerCase();
    const folder = NF(assetParentFolder(item)).toLowerCase();
    const nm = NF(item.name || item.origName || '').toLowerCase();
    const all = cat + ' ' + folder + ' ' + nm;
    let b = 0;
    if (slot === 'bg') {
      if (/背景|background|\bbg\b|風景|室内|室外|シーン|scene/.test(all)) b += 40;
      if (/npc|立ち絵|立絵|キャラ|顔|icon|アイコン|駒|token|カットイン|cutin|効果音|\bse\b/.test(all)) b -= 350;
    } else if (slot === 'screen') {
      if (/前景|foreground|\bfg\b|スクリーン|パネル|panel|screen|マップ|map|見取り図|間取り|地図|手紙|新聞|写真|資料|切り抜き|部屋素材|handout|\bho\d*\b/.test(all)) b += 40;
      if (/npc|立ち絵|立絵/.test(all)) b -= 220;
    } else if (slot === 'bgm') {
      if (/bgm|音楽|music|曲|loop|ループ/.test(all)) b += 35;
      if (/(?:^|[\s_\-.(\[【])(?:se|sfx)(?:$|[\s_\-.)\]】0-9])|効果音|ジングル|ボイス|voice/.test(all)) b -= 280;
    }
    return b;
  }

  function scoreOneAssetForSlot(item, extracted, slot, isRegistered) {
    if (!item || item.missing) return null;
    if (slot === 'bgm' && item.type !== 'audio') return null;
    if ((slot === 'bg' || slot === 'screen') && item.type !== 'image') return null;

    const customTagsStr = (Array.isArray(item.customTags) ? item.customTags : []).join(' ');
    const folderStr = [item.category || '', assetParentFolder(item)].filter(Boolean).join(' ');
    const nameStr = [item.name || '', item.origName || ''].filter(Boolean).join(' ');
    const allTags = Array.isArray(item.tags) ? item.tags : [];
    const customSet = new Set((Array.isArray(item.customTags) ? item.customTags : []).map(x => x.toLowerCase()));
    const id3Str = allTags.filter(t => !customSet.has(String(t).toLowerCase()) && t !== item.category).join(' ') + (item.id3Blob ? ' ' + item.id3Blob : '');

    const mCustom = matchTextAgainstKeywords(customTagsStr, extracted);
    const mFolder = matchTextAgainstKeywords(folderStr, extracted);
    const mId3 = matchTextAgainstKeywords(id3Str, extracted);
    const mName = matchTextAgainstKeywords(nameStr, extracted);

    const hasCustom = mCustom.direct.length > 0 || mCustom.synonym.length > 0;
    const hasFolder = mFolder.direct.length > 0 || mFolder.synonym.length > 0;
    const hasId3 = mId3.direct.length > 0 || mId3.synonym.length > 0;
    const hasName = mName.direct.length > 0 || mName.synonym.length > 0;

    if (!hasCustom && !hasFolder && !hasId3 && !hasName) return null;

    // 優先度順位：
    // ①「📌 登録素材」のタグ・フォルダ名・ファイル名一致 (tier 1, base 1000)
    // ②「マイライブラリ」のカスタムタグ一致 (tier 2, base 500)
    // ③「マイライブラリ」の親フォルダ名・ID3タグ・ファイル名一致 (tier 3, base 100)
    let tier = 3, tierBase = 100, tierLabel = '📁 マイライブラリ';
    if (isRegistered) {
      tier = 1; tierBase = 1000; tierLabel = '📌 登録素材';
    } else if (hasCustom) {
      tier = 2; tierBase = 500; tierLabel = '🏷️ マイライブラリ(タグ)';
    }

    let sub = 0;
    sub += mCustom.direct.length * 120 + mCustom.synonym.length * 80;
    sub += mFolder.direct.length * 85 + mFolder.synonym.length * 55;
    sub += mId3.direct.length * 75 + mId3.synonym.length * 50;
    sub += mName.direct.length * 70 + mName.synonym.length * 45;

    // タイトル内キーワード一致なら追加ボーナス
    extracted.primaryKeywords.forEach(pk => {
      if (mCustom.direct.includes(pk) || mFolder.direct.includes(pk) || mName.direct.includes(pk)) sub += 35;
    });

    const bonus = slotBonus(item, slot);
    const score = tierBase + sub + bonus;
    if (score <= 0) return null;

    const matchedKeywords = [...new Set([
      ...mCustom.direct, ...mFolder.direct, ...mId3.direct, ...mName.direct,
      ...mCustom.synonym, ...mFolder.synonym, ...mId3.synonym, ...mName.synonym
    ])];

    return { item, score, tier, tierLabel, matchedKeywords, isRegistered };
  }

  /** シーンに合う「背景画像(bg)」「スクリーンパネル(screen)」「BGM(bgm)」候補をスコア順に算出 */
  function scoreAssetsForScene(scene, sources, limit) {
    const maxN = limit || 5;
    const src = sources || {};
    const reg = Array.isArray(src.registeredItems) ? src.registeredItems : [];
    const com = Array.isArray(src.commonItems) ? src.commonItems : [];
    const extracted = extractSceneKeywords(scene);

    // 同一ファイルパスが登録素材とマイライブラリの両方にある場合は登録素材（Tier 1）側を優先
    const seenPath = new Set(), seenUid = new Set();
    const pool = [];
    reg.forEach(it => {
      if (!it) return;
      if (it.path) seenPath.add(normPathKey(it.path));
      if (it.uid) seenUid.add(it.uid);
      pool.push({ item: it, isRegistered: true });
    });
    com.forEach(it => {
      if (!it) return;
      if (it.path && seenPath.has(normPathKey(it.path))) return;
      if (it.uid && seenUid.has(it.uid)) return;
      pool.push({ item: it, isRegistered: false });
    });

    const rankSlot = slot => {
      const hits = [];
      pool.forEach(entry => {
        const res = scoreOneAssetForSlot(entry.item, extracted, slot, entry.isRegistered);
        if (res) hits.push(res);
      });
      hits.sort((a, b) => b.score - a.score || a.tier - b.tier || String(a.item.name || '').localeCompare(String(b.item.name || ''), 'ja', { numeric: true }));
      return hits.slice(0, maxN);
    };

    return {
      extracted,
      bg: rankSlot('bg'),
      screen: rankSlot('screen'),
      bgm: rankSlot('bgm')
    };
  }

  const api = {
    HEADING_PATTERNS,
    DEFAULT_PATTERN_ROLES,
    SYNONYM_GROUPS,
    extractHtmlLines,
    extractTxtLines,
    buildPdfLines,
    parseCustomPrefixes,
    detectHeadingStats,
    recommendPatternRoles,
    recommendEnabledPatterns,
    cleanHeadingTitle,
    isNonSceneHeading,
    extractTocEntries,
    resolveOutlineEntries,
    matchHeadingRole,
    extractInfoBlocksFromLines,
    buildScenesFromLines,
    splitSceneAtLine,
    splitSceneByDelimiter,
    mergeSceneWithPrev,
    stripSkillNoise,
    maskFalsePositiveCompounds,
    extractSceneKeywords,
    scoreAssetsForScene
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CCFSceneMatch = api;
})();
