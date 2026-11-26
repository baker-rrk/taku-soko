/* ccf_text.js — ココフォリア特化ツール Phase 1：テキスト処理（DOM／Electron に依存しない純粋関数）
 *  - cleanText        : PDF から抽出した文字列の不要な改行・空白を除去して整形する
 *  - extractRectText  : pdf.js の getTextContent().items から、矩形（バウンディングボックス）内の文字だけを読み順で取り出す
 *  - stockTitle / buildPaletteLines / chunkText : シナリオテキストのストック → ダミー駒（チャットパレット）用の行へ変換
 * ブラウザでは window.CCFText、Node では module.exports として使える。 */
(function () {
  'use strict';

  // ---------- 文字種 ----------
  const CJK = '\\u3000-\\u303F\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF';
  const JP_CHAR = '\\u3040-\\u309F\\u30A0-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3001\\u3002\\u3005\\u30FC';
  const RE_CJK_CHAR = new RegExp('[' + CJK + ']');
  const RE_SPACE_BETWEEN_CJK = new RegExp('([' + CJK + ']) +(?=[' + CJK + '])', 'g');
  const RE_SPACE_AFTER_OPEN_BRK = /([「『（(【《〈〔]) +/g;
  const RE_SPACE_BEFORE_CLOSE_BRK = / +([」』）)】》〉〕])/g;
  const RE_SPACE_CJK_OPEN_PAREN = new RegExp('([' + CJK + ']) +(?=\\()', 'g');
  const RE_SPACE_CLOSE_PAREN_CJK = new RegExp('(\\)) +(?=[' + CJK + '])', 'g');
  const RE_SPACE_ALNUM_JP_PAREN = new RegExp('([A-Za-z0-9]) +(?=\\([' + CJK + '])', 'g');
  const RE_SPACE_JP_ALNUM = new RegExp('([' + JP_CHAR + ']) +(?=[0-9０-９A-Za-z])', 'g');
  const RE_SPACE_ALNUM_JP = new RegExp('([0-9０-９A-Za-z]) +(?=[' + JP_CHAR + '])', 'g');
  const RE_ASCII_WORD = /[A-Za-z0-9]/;
  // ② 行末が文末記号で終わる場合（確実な文末と閉じ括弧類を分離）
  const STRONG_TERM = /[。．｡！？!?…‥―〜~]$/;
  const CLOSE_BRK = /[」』）)】］〕〉》”"']$/;
  const INLINE_CLOSE_BRK = /[）)】］〕〉》]$/;
  // ③ 次行の行頭が独立オープナー・箇条書き・罫線（長音符「ー」は除外、文中開き括弧は分離）
  const STRONG_OPENERS = /^(?:[・●○◯〇◎■□◆◇▲△▼▽★☆※①-⑳―─━＊*#＃▶►→⇒⇔§†‡]|[-+]\s)/;
  const BRACKET_OPENERS = /^[「『（(【〔〈《]/;
  const HEADING_BASE = /^(?:[■□◆◇●○◯〇▼▽▲△★☆※【〔]|第[0-9０-９一二三四五六七八九十百千]+[章節話幕部回篇]|[0-9０-９]+[\.．）)\]:：])/i;
  const ROLE_HEAD_DELIM = /^(?:HO|ＨＯ|PC|ＰＣ|KP|ＫＰ|GM|ＧＭ|PL|ＰＬ|NPC|ＮＰＣ)(?:[0-9０-９一二三四五六七八九十]+)?\s*[:：・【「『（(/／―─-]/i;
  const ROLE_HEAD_LABEL = /^(?:HO|ＨＯ|PC|ＰＣ|KP|ＫＰ|GM|ＧＭ|PL|ＰＬ|NPC|ＮＰＣ)(?:[0-9０-９一二三四五六七八九十]+)?(?![A-Za-zＡ-Ｚａ-ｚ])/i;
  const ROLE_PROSE_PARTICLE = /[。、．，！？]|(?:から|まで)|[のはがをにへともでや]/;
  function isHeadingLine(line) {
    const s = String(line || '').trim();
    if (!s) return false;
    if (HEADING_BASE.test(s)) return true;
    if (ROLE_HEAD_DELIM.test(s)) return true;
    if (ROLE_HEAD_LABEL.test(s)) return Array.from(s).length <= 12 && !ROLE_PROSE_PARTICLE.test(s);
    return false;
  }
  const NUMBERED = /^[0-9０-９]+[\.．）)\]:：](?:\s|$|\S)/;

  // PDF座標抽出時の行メタデータキャッシュ（直近の抽出テキスト → 行ごとの座標判定情報）
  const _rectMetaCache = new Map();
  function _rememberRectMeta(rawText, lineMetaList) {
    if (!rawText || !Array.isArray(lineMetaList)) return;
    if (_rectMetaCache.size > 24) {
      const firstKey = _rectMetaCache.keys().next().value;
      _rectMetaCache.delete(firstKey);
    }
    _rectMetaCache.set(rawText, lineMetaList);
  }

  /** 行内に「〇〇：」「〇〇:」のようなコロン区切り項目が含まれるか判定（URLの http:// 等は除外） */
  function isColonItemLine(line) {
    const t = String(line || '').trim();
    if (!t) return false;
    const noUrl = t.replace(/https?:\/\/\S+/gi, '');
    return /[：:]/.test(noUrl);
  }
  function hasUnclosedParen(s) {
    let depth = 0;
    for (const ch of String(s || '')) {
      if (ch === '(' || ch === '（') depth++;
      else if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
    }
    return depth > 0;
  }
  const NUM_UNIT_CONT = /^(?:時間|分|秒|人|名|版|回|日|週|ヶ月|か月|カ月|年|歳|才|円|前後|程度|以上|以下|ほど|くらい|ぐらい|〜|～|[-~])/;

  const DEFAULT_CLEAN = { joinLines: 'smart', stripSpaces: true };

  /** PDF 由来の文字列を整形する。
   *  opts.joinLines : 'smart'（既定：文末・見出し・箇条書き・項目行・短行の改行は残し、自動折り返しの改行だけ除去）／'all'（空行以外の改行をすべて除去）／'none'（改行はそのまま）
   *  opts.stripSpaces : true で、日本語どうしの間の不自然な半角空白・連続半角空白・行末空白を除去（英単語間のスペースは保持） */
  function cleanText(raw, opts) {
    const o = Object.assign({}, DEFAULT_CLEAN, opts || {});
    const rawStr = String(raw == null ? '' : raw);
    const cachedMeta = _rectMetaCache.get(rawStr) || null;
    let t = rawStr
      .replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n')
      .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF\f\v]/g, '')   // ソフトハイフン・ゼロ幅文字・改ページ
      .replace(/\u00A0/g, ' ').replace(/\t/g, ' ');
    const rawLines = t.split('\n');
    const validMeta = cachedMeta && cachedMeta.length === rawLines.length ? cachedMeta : null;
    const src = rawLines.map((l, idx) => {
      const m = validMeta && validMeta[idx] ? validMeta[idx] : null;
      const leadMatch = l.match(/^[ \u3000]+/);
      const isIndent = /^(?:[\u3000]|[ ]{4,})/.test(l)
        || (/^[ ]{2,3}/.test(l) && !/^[ ]{2,3}[0-9A-Za-z「『（(【〔〈《]/.test(l));
      return {
        text: l.replace(/\s+$/, ''),
        indent: isIndent,
        leadLen: leadMatch ? leadMatch[0].length : 0,
        shortEndX: !!(m && m.shortEndX),
        yGapBreak: !!(m && m.yGapBreak)
      };
    });

    // --- 段落（空行区切り）ごとに、行を連結する ---
    const paras = []; let cur = [];   // null は「空行」（連続する空行は1つにまとめる）
    src.forEach(l => {
      if (l.text.trim()) { cur.push(l); return; }
      if (cur.length) { paras.push(cur); cur = []; }
      if (paras.length && paras[paras.length - 1] !== null) paras.push(null);
    });
    if (cur.length) paras.push(cur);

    const out = [];
    paras.forEach(p => {
      if (p === null) { if (out.length && out[out.length - 1] !== '') out.push(''); return; }
      // 段落内の50%以上の行が先頭空白を持つ場合は「段落全体の左マージン」とみなす
      const indentedCount = p.filter(l => l.indent).length;
      const hasCommonMargin = p.length >= 2 && (indentedCount / p.length >= 0.5);
      const lines = p.map(l => ({
        s: o.stripSpaces ? l.text.replace(/^[ \u3000]+/, '') : l.text,
        indent: hasCommonMargin ? false : l.indent,
        leadLen: l.leadLen,
        shortEndX: l.shortEndX,
        yGapBreak: l.yGapBreak
      }));
      // 段落単位の最大行文字数（ページ内の別箇所にある長い目次行等による誤判定を防止）
      const paraLengths = lines.map(l => Array.from(l.s.trim()).length).filter(len => len > 0);
      const paraMaxChars = paraLengths.length ? Math.max(...paraLengths) : 0;
      if (o.joinLines === 'none') { lines.forEach(l => out.push(l.s)); return; }
      let acc = lines[0].s;
      for (let i = 1; i < lines.length; i++) {
        const prevObj = lines[i - 1], nextObj = lines[i];
        const nextIndented = nextObj.indent && (prevObj.leadLen !== nextObj.leadLen);
        if (o.joinLines !== 'all' && shouldBreak(prevObj.s, nextObj.s, {
          nextIndented,
          nextYGapBreak: nextObj.yGapBreak,
          prevShortEndX: prevObj.shortEndX,
          accUnclosedParen: hasUnclosedParen(acc),
          maxLineChars: paraMaxChars
        })) {
          out.push(acc);
          acc = nextObj.s;
        } else {
          acc = joinPair(acc, nextObj.s);
        }
      }
      out.push(acc);
    });
    while (out.length && out[out.length - 1] === '') out.pop();
    while (out.length && out[0] === '') out.shift();

    let res = out.join('\n');
    if (o.stripSpaces) {
      res = res.split('\n').map(l => {
        let s = l.replace(/ {2,}/g, ' ').replace(/ +$/, '');
        // PDF/整形由来の不要な半角空白を除去（英単語間のスペースや箇条書きは保持）
        let prev;
        do {
          prev = s;
          s = s
            .replace(RE_SPACE_AFTER_OPEN_BRK, '$1')
            .replace(RE_SPACE_BEFORE_CLOSE_BRK, '$1')
            .replace(RE_SPACE_CJK_OPEN_PAREN, '$1')
            .replace(RE_SPACE_CLOSE_PAREN_CJK, '$1')
            .replace(RE_SPACE_ALNUM_JP_PAREN, '$1')
            .replace(RE_SPACE_JP_ALNUM, '$1')
            .replace(RE_SPACE_ALNUM_JP, '$1')
            .replace(RE_SPACE_BETWEEN_CJK, '$1');
        } while (s !== prev);
        return s;
      }).join('\n');
    }
    return res;
  }

  /** 前の行 prev と次の行 next の間で改行を保持すべきか判定する。
   *  第3引数は boolean（後方互換：nextIndented）またはオプションオブジェクト */
  function shouldBreak(prev, next, ctxOrIndented) {
    const ctx = (typeof ctxOrIndented === 'object' && ctxOrIndented !== null)
      ? ctxOrIndented
      : { nextIndented: !!ctxOrIndented, maxLineChars: 0 };
    const p = String(prev || '').trim();
    const n = String(next || '').trim();
    if (!p || !n) return true;
    // ① 行末が確実な文末記号で終わる場合（改行を保持）
    if (STRONG_TERM.test(p)) return true;

    const unclosedParen = hasUnclosedParen(p) || !!ctx.accUnclosedParen;
    const isNumUnitCont = /[0-9０-９]$/.test(p) && NUM_UNIT_CONT.test(n);
    const isAlnumCont = /[A-Za-z0-9]$/.test(p) && INLINE_ALNUM_CONT.test(n);
    const isMidContinuation = unclosedParen || MID_END.test(p) || MID_END2.test(p) || MID_CLAUSE_END.test(p) || NEXT_CONT.test(n) || isNumUnitCont || isAlnumCont;

    // ② 行末が閉じ括弧類で終わる場合（文中インライン括弧と台詞・見出し末尾を判別）
    if (CLOSE_BRK.test(p)) {
      if (NEXT_CONT.test(n) || NEXT_AFTER_CLOSE.test(n)) return false;
      if (isHeadingLine(p) && Array.from(p).length <= 35) return true;
      if (STRONG_OPENERS.test(n) || NUMBERED.test(n) || isHeadingLine(n) || isColonItemLine(n)) return true;
      if (!/^[「『]/.test(p) && INLINE_CLOSE_BRK.test(p)) return false;
      return true;
    }

    // ③ 独立行頭オープナー・項目行（〇〇：）は改行を保持
    if (STRONG_OPENERS.test(n) || isColonItemLine(n)) return true;
    // 現在行が項目行（システム：CoC6版 等）
    if (isColonItemLine(p)) {
      if (/[：:]$/.test(p) && Array.from(n).length <= 25) return false;
      if (NEXT_CONT.test(n) || unclosedParen || isNumUnitCont) return false;
      return true;
    }
    // ④ 明らかに文の途中折り返し（開き括弧・番号・nextIndented・nextYGapBreak より最優先で強制結合）
    if (isMidContinuation) return false;
    // ⑤ 次行が番号付き行・見出し行
    if (NUMBERED.test(n) || isHeadingLine(n)) return true;
    // ⑥ 現在行が見出し行（■ 導入 等）
    const pLen = Array.from(p).length, mlc = ctx.maxLineChars || 0;
    if (isHeadingLine(p) && pLen <= 35) return true;
    // ⑦ 次行が開き括弧で始まる場合（同一行内で閉じて後続の文が続くインライン引用は連結）
    if (BRACKET_OPENERS.test(n)) {
      if (/^(?:「[^」]+」|『[^』]+』|（[^）]+）|\([^)]+\)|《[^》]+》|〈[^〉]+〉)\S/.test(n)) return false;
      return true;
    }
    // ⑧ 字下げ行・またはPDF座標で通常の行送りより広いYギャップがある行
    if (ctx.nextIndented || ctx.nextYGapBreak) return true;
    // ⑨ 意図的な短行
    if (mlc >= 14 && pLen < Math.min(14, Math.floor(mlc * 0.68))) return true;
    if (ctx.prevShortEndX) return true;
    return false;
  }
  const MID_END = /[、，,っゃゅょァィゥェォッャュョ「『（(【〔〈《]$/;
  const MID_END2 = /[はがをにへでとやもかのよりからまでばかりだけほどくらいなどっててもでもけれどけどしりてでな]$/;
  const MID_CLAUSE_END = /(?:である|であった|であり|という|といった|とする|とした|による|における|について|に対して|に関して|する|ある|いる|なる|れる|せる|ない|った|した)$/;
  const NEXT_CONT = /^(?:[。．、，！？!?」』）)】］〕〉》…‥ー〜~んンっゃゅょァィゥェォッャュョ]|ではない|ではなく|である|であった|であり|ですか|ます[。、！？]?|ました|ません|だった|だ[。、！？]|た[。、！？、]|て[、。いるいたいくおくしま]|に[もはてよ関現不な]|を|が|は[、。]|と(?:になる|なる|して|した|する|いう|いった|[はもい])|の[はでがをに]|へ|で[はもあ]|や|も|から|ので|けれど|しかし|するのが|居る)/;
  const NEXT_AFTER_CLOSE = /^(?:[、。，．！？!?」』）)】］〕〉》…‥ー〜~a-z]|は|が|を|に|へ|で|と|の|も|や|から|まで|である|であった|であり|ではない|ではなく|です|ます|だった|だ[。、！？]|た[。、！？]|て)/;
  const INLINE_ALNUM_CONT = /^(?:[A-Za-z0-9（(「『【〔〈《]|は|が|を|に|へ|で|と|の|も|や|から|まで)/;

  /** 同期テキスト（=== P.1 === 等のページ区切り付き）の各ページ本文に cleanText を適用しつつページ見出し行を保持する */
  function cleanSyncedDocText(raw) {
    const text = String(raw == null ? '' : raw).replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n');
    if (!text.trim()) return '';
    const re = /^=== P\.(\d+) ===\s*$/gm;
    const matches = [...text.matchAll(re)];
    if (!matches.length) {
      return cleanText(text, { joinLines: 'smart', stripSpaces: true });
    }
    const parts = [];
    const pre = text.slice(0, matches[0].index).trim();
    if (pre) parts.push(cleanText(pre, { joinLines: 'smart', stripSpaces: true }));
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const head = `=== P.${m[1]} ===`;
      const start = m.index + m[0].length;
      const end = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
      const pageBody = text.slice(start, end);
      const cleanedBody = cleanText(pageBody, { joinLines: 'smart', stripSpaces: true });
      parts.push(cleanedBody ? (head + '\n' + cleanedBody) : head);
    }
    return parts.join('\n\n');
  }
  function joinPair(a, b) {
    if (!a) return b; if (!b) return a;
    const x = a[a.length - 1], y = b[0];
    if (x === '-' && /[A-Za-z]$/.test(a.slice(0, -1)) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;   // 英単語のハイフネーション
    if ((RE_ASCII_WORD.test(x) || /[,.;:]/.test(x)) && RE_ASCII_WORD.test(y)) return a + ' ' + b;      // 英数どうしは空白1つ
    return a + b;                                                                                        // 日本語は空白なしで連結
  }

  // ---------- 矩形（バウンディングボックス）抽出 ----------
  const mul = (m1, m2) => [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];

  const isSpaceChar = ch => ch === ' ' || ch === '\u00A0' || ch === '\u3000' || ch === '\t';

  /** glyph 列を「2つ以上の連続スペース（またはタブ）」または「h * 1.8 以上の文字間ジャンプ」で分割する */
  function splitGlyphSegments(glyphs, h) {
    if (!glyphs || !glyphs.length) return [];
    const jumpThresh = (h || 1) * 1.8;
    const segs = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      if (cur.some(g => !isSpaceChar(g.ch))) segs.push(cur);
      cur = [];
    };
    let i = 0;
    while (i < glyphs.length) {
      const g = glyphs[i];
      if (isSpaceChar(g.ch)) {
        let j = i;
        while (j < glyphs.length && isSpaceChar(glyphs[j].ch)) j++;
        if (j - i >= 2 || g.ch === '\t') {
          flush();
          i = j;
          continue;
        }
      }
      if (cur.length) {
        const prev = cur[cur.length - 1];
        if (Math.hypot(g.cx - prev.cx, g.cy - prev.cy) >= jumpThresh) {
          flush();
        }
      }
      cur.push(g);
      i++;
    }
    flush();
    return segs;
  }

  /** pdf.js のテキストアイテムを、画面（ビューポート）座標の「1文字ごとの中心点」に展開する。
   *  items    : page.getTextContent().items（str / transform / width を使う）
   *  vpTrans  : viewport.transform（PDF座標→画面座標）
   *  scale    : viewport.scale
   *  戻り値    : [{ str, x0, x1, y, h, glyphs:[{ch,cx,cy}], horizontal }] */
  function layoutItems(items, vpTrans, scale) {
    const res = [];
    (items || []).forEach(it => {
      if (!it || typeof it.str !== 'string' || !it.str.length || !it.transform) return;
      const tx = mul(vpTrans, it.transform), chars = Array.from(it.str), n = chars.length;
      const w = (it.width || 0) * (scale || 1), h = Math.hypot(tx[2], tx[3]) || 1;
      const len = Math.hypot(tx[0], tx[1]) || 1, dx = tx[0] / len, dy = tx[1] / len;   // 文字の進行方向
      const ux = tx[2] / h, uy = tx[3] / h;                                              // 文字の「上」方向
      const horizontal = Math.abs(dy) < 0.2;
      const step = (w > 0 && n > 0) ? (w / n) : (h * 0.5);
      const halfW = Math.min(step, h * 1.2) * 0.5;
      const glyphs = chars.map((ch, i) => {
        const adv = w * (i + 0.5) / n;
        return { ch, cx: tx[4] + dx * adv + ux * h * 0.38, cy: tx[5] + dy * adv + uy * h * 0.38 };
      });
      if (!horizontal) {
        res.push({ str: it.str, x0: tx[4], x1: tx[4] + dx * w, y: glyphs[0].cy, h, step, glyphs, horizontal, hasEOL: !!it.hasEOL });
        return;
      }
      const segs = splitGlyphSegments(glyphs, h);
      segs.forEach((seg, si) => {
        const str = seg.map(g => g.ch).join('');
        const first = seg[0], last = seg[seg.length - 1];
        const x0 = Math.min(first.cx, last.cx) - halfW;
        const x1 = Math.max(first.cx, last.cx) + halfW;
        res.push({
          str, x0, x1, y: first.cy, h, step, glyphs: seg, horizontal,
          hasEOL: !!it.hasEOL && si === segs.length - 1
        });
      });
    });
    return res;
  }

  /** 矩形 rect={x,y,w,h}（画面座標。配列なら複数の矩形のいずれか）の内側に中心がある文字だけを集め、読み順の文字列にする。
   *  opts.excludeRuby : 選択範囲の本文フォントサイズ（文字数で重み付けした中央値）の70%未満の極小文字（ルビ）を除外する
   *  opts.twoColumn   : X座標の分布から多段組（2〜3段組）と判定したら「左段の上→下 ➡ 中段 ➡ 右段の上→下」の順に並べる（全幅の見出しは段組の区切りとして扱う） */
  function extractRectText(items, vpTrans, scale, rect, opts) {
    const o = Object.assign({ excludeRuby: false, twoColumn: true }, opts || {});
    const boxes = (Array.isArray(rect) ? rect : [rect]).map(r => ({ x1: Math.min(r.x, r.x + r.w), x2: Math.max(r.x, r.x + r.w), y1: Math.min(r.y, r.y + r.h), y2: Math.max(r.y, r.y + r.h) }));
    let chunks = [];
    layoutItems(items, vpTrans, scale).forEach(L => {
      const mx = L.h * 0.25;
      const matched = [];
      L.glyphs.forEach(g => {
        if (boxes.some(b => g.cx >= b.x1 - mx && g.cx <= b.x2 + mx && g.cy >= b.y1 && g.cy <= b.y2)) {
          matched.push(g);
        }
      });
      if (!matched.length) return;
      if (!L.horizontal) {
        const first = matched[0], last = matched[matched.length - 1];
        const s = matched.map(g => g.ch).join('');
        if (s) chunks.push({ str: s, x0: first.cx, x1: last.cx + L.h * 0.5, y: first.cy, h: L.h, horizontal: L.horizontal });
        return;
      }
      const halfW = Math.min(L.step || L.h * 0.5, L.h * 1.2) * 0.5;
      splitGlyphSegments(matched, L.h).forEach(seg => {
        const s = seg.map(g => g.ch).join('');
        if (!s.trim()) return;
        const first = seg[0], last = seg[seg.length - 1];
        chunks.push({
          str: s,
          x0: Math.min(first.cx, last.cx) - halfW,
          x1: Math.max(first.cx, last.cx) + halfW,
          y: first.cy,
          h: L.h,
          horizontal: L.horizontal
        });
      });
    });
    if (!chunks.length) return '';
    if (!chunks.every(c => c.horizontal)) return chunks.map(c => c.str).join('\n');   // 回転ページは PDF の順序のまま
    if (o.pageH > 0 && o.noMargin !== false) {   // ページ上下端5%のページ番号・ヘッダーを除外
      const kept = chunks.filter(c => c.y >= o.pageH * 0.05 && c.y <= o.pageH * 0.95);
      if (kept.length) chunks = kept;
    }
    if (o.excludeRuby) {
      const body = bodyHeight(chunks), kept = chunks.filter(c => c.h >= body * 0.7);
      if (kept.length) chunks = kept;
    }
    const metaList = [];
    const text = o.twoColumn ? orderBands(chunks, metaList, o.pageW) : chunksToLines(chunks, metaList, o.pageW);
    if (text && metaList.length && metaList.length === text.split('\n').length) _rememberRectMeta(text, metaList);
    return text;
  }

  /** 本文のフォントサイズ：文字数で重み付けした中央値 */
  function bodyHeight(chunks) {
    const a = chunks.map(c => ({ h: c.h, n: Array.from(c.str).length })).sort((p, q) => p.h - q.h), total = a.reduce((s, c) => s + c.n, 0);
    let acc = 0; for (const c of a) { acc += c.n; if (acc >= total / 2) return c.h; }
    return a[a.length - 1].h;
  }
  /** チャンク群を同じY高さの行にまとめる */
  function groupVisualRows(chunks) {
    const rows = [];
    chunks.slice().sort((a, b) => a.y - b.y).forEach(c => {
      const ln = rows.find(r => Math.abs(r.y - c.y) <= Math.max(c.h, r.h) * 0.5);
      if (ln) { ln.chunks.push(c); ln.y = (ln.y * (ln.chunks.length - 1) + c.y) / ln.chunks.length; ln.h = Math.max(ln.h, c.h); }
      else rows.push({ y: c.y, h: c.h, chunks: [c] });
    });
    rows.sort((a, b) => a.y - b.y);
    rows.forEach(r => r.chunks.sort((a, b) => Math.min(a.x0, a.x1) - Math.min(b.x0, b.x1)));
    return rows;
  }
  const RE_STAT_CELL = /(?<![A-Za-z])(?:STR|CON|POW|DEX|APP|SIZ|INT|EDU|HP|MP|SAN|LUK|DB|CCB?|1[dD]\d+|筋力|体力|精神力|敏捷|外見|体格|知性|教育|耐久力|正気度|装甲)(?![A-Za-z])/i;
  const hasStatCell = s => RE_STAT_CELL.test(String(s || '').normalize('NFKC'));

  /** チャンク群（同じ段）を行にまとめ、上→下・左→右の文字列にする。
   *  同じ高さに水平ギャップ（>= max(l.h * 0.9, 7)）が2行以上ほぼ同じX位置で縦に並ぶ場合は、
   *  左側縦ブロック（上→下）➡ 右側縦ブロック（上→下）に分離して出力する。
   *  同時に ① 行間のY座標ギャップ（通常の行送りの1.35倍以上）および ④ 行終端X座標（カラム最大endXより1.5文字以上手前）を記録する */
  function chunksToLines(chunks, metaOut, pageWOpt, _depth) {
    if (!chunks || !chunks.length) return '';
    const depth = _depth || 0;
    const loX = Math.min(...chunks.map(c => Math.min(c.x0, c.x1)));
    const hiX = Math.max(...chunks.map(c => Math.max(c.x0, c.x1)));
    const pageW = (pageWOpt && pageWOpt > 0) ? pageWOpt : Math.max(0, hiX - loX);
    const rawLines = groupVisualRows(chunks);
    const medH = bodyHeight(chunks) || 10;

    // 2行以上にわたってほぼ同じX位置に水平ギャップがある縦カラム群を左ブロック→右ブロックへ分離
    if (depth < 4 && rawLines.length >= 2) {
      const rowGaps = rawLines.map((l, rIdx) => {
        const gapThresh = Math.max(l.h * 1.65, 14);
        const gs = [];
        for (let i = 1; i < l.chunks.length; i++) {
          const v0 = Math.max(l.chunks[i - 1].x0, l.chunks[i - 1].x1);
          const v1 = Math.min(l.chunks[i].x0, l.chunks[i].x1);
          if (v1 - v0 >= gapThresh) gs.push({ rIdx, v0, v1, mid: (v0 + v1) / 2, gap: v1 - v0 });
        }
        return gs;
      });
      const allGaps = [].concat(...rowGaps);
      if (allGaps.length >= 2) {
        const candSet = new Set();
        allGaps.forEach(g => candSet.add(Math.round(g.mid * 2) / 2));
        for (let a = 0; a < allGaps.length; a++) {
          for (let b = a + 1; b < allGaps.length; b++) {
            if (allGaps[a].rIdx === allGaps[b].rIdx) continue;
            const iv0 = Math.max(allGaps[a].v0, allGaps[b].v0);
            const iv1 = Math.min(allGaps[a].v1, allGaps[b].v1);
            if (iv0 <= iv1) candSet.add(Math.round(((iv0 + iv1) / 2) * 2) / 2);
          }
        }
        let bestSplit = null;
        for (const sx of candSet) {
          const segs = [];
          let curRows = [];
          const flushSeg = () => {
            if (!curRows.length) return;
            let gappedRows = 0, minGap = Infinity, hasL = false, hasR = false, statPairedRows = 0;
            let lMinX = Infinity, lMaxX = -Infinity, rMinX = Infinity, rMaxX = -Infinity;
            curRows.forEach(rIdx => {
              const r = rawLines[rIdx];
              let rl = false, rr = false, lStat = false, rStat = false;
              r.chunks.forEach(c => {
                const cx0 = Math.min(c.x0, c.x1), cx1 = Math.max(c.x0, c.x1);
                if ((cx0 + cx1) / 2 < sx) {
                  rl = true;
                  if (!lStat && hasStatCell(c.str)) lStat = true;
                  if (cx0 < lMinX) lMinX = cx0;
                  if (cx1 > lMaxX) lMaxX = cx1;
                } else {
                  rr = true;
                  if (!rStat && hasStatCell(c.str)) rStat = true;
                  if (cx0 < rMinX) rMinX = cx0;
                  if (cx1 > rMaxX) rMaxX = cx1;
                }
              });
              if (rl) hasL = true;
              if (rr) hasR = true;
              if (lStat && rStat) statPairedRows++;
              const hit = rowGaps[rIdx].find(g => g.v0 <= sx && g.v1 >= sx);
              if (hit) { gappedRows++; if (hit.gap < minGap) minGap = hit.gap; }
            });
            const leftW = isFinite(lMaxX) ? Math.max(0, lMaxX - lMinX) : 0;
            const rightW = isFinite(rMaxX) ? Math.max(0, rMaxX - rMinX) : 0;
            const enoughColWidth = leftW >= medH * 5 && rightW >= medH * 5;
            const enoughGapRows = gappedRows >= 3 || (rawLines.length > 0 && (gappedRows / rawLines.length) >= 0.5);
            const inlineGapOnly = !(enoughColWidth && enoughGapRows);
            const isStatTable = statPairedRows >= 2;
            segs.push({ rows: curRows, split: gappedRows >= 2 && hasL && hasR && !inlineGapOnly && !isStatTable, gappedRows, minGap: isFinite(minGap) ? minGap : 0 });
            curRows = [];
          };
          for (let rIdx = 0; rIdx < rawLines.length; rIdx++) {
            const crosses = rawLines[rIdx].chunks.some(c => Math.min(c.x0, c.x1) < sx && Math.max(c.x0, c.x1) > sx);
            if (crosses) {
              flushSeg();
              segs.push({ rows: [rIdx], split: false, gappedRows: 0, minGap: 0 });
            } else {
              curRows.push(rIdx);
            }
          }
          flushSeg();
          const totalGapped = segs.reduce((acc, sg) => acc + (sg.split ? sg.gappedRows : 0), 0);
          if (totalGapped < 2) continue;
          const minGap = segs.reduce((m, sg) => sg.split ? Math.min(m, sg.minGap) : m, Infinity);
          if (
            !bestSplit ||
            totalGapped > bestSplit.totalGapped ||
            (totalGapped === bestSplit.totalGapped && (minGap > bestSplit.minGap || (minGap === bestSplit.minGap && sx < bestSplit.sx)))
          ) {
            bestSplit = { sx, segs, totalGapped, minGap };
          }
        }
        if (bestSplit) {
          const parts = [];
          const emitPart = s => { if (s) parts.push(s); };
          bestSplit.segs.forEach(sg => {
            const segChunks = [];
            sg.rows.forEach(rIdx => segChunks.push(...rawLines[rIdx].chunks));
            if (!segChunks.length) return;
            if (sg.split) {
              const left = segChunks.filter(c => (c.x0 + c.x1) / 2 < bestSplit.sx);
              const right = segChunks.filter(c => (c.x0 + c.x1) / 2 >= bestSplit.sx);
              emitPart(chunksToLines(left, metaOut, pageW, depth + 1));
              emitPart(chunksToLines(right, metaOut, pageW, depth + 1));
            } else if (segChunks.length < chunks.length) {
              emitPart(chunksToLines(segChunks, metaOut, pageW, depth + 1));
            } else {
              emitPart(chunksToLines(segChunks, metaOut, pageW, 4));
            }
          });
          return parts.join('\n');
        }
      }
    }

    const lines = rawLines.map(l => {
      let s = '';
      l.chunks.forEach((c, i) => {
        if (i) {
          const prevX1 = Math.max(l.chunks[i - 1].x0, l.chunks[i - 1].x1);
          const curX0 = Math.min(c.x0, c.x1);
          if (curX0 - prevX1 > l.h * 0.6) s += ' ';   // 離れている文字の間は空白（表の列など）
        }
        s += c.str;
      });
      return {
        y: l.y,
        h: Math.max(...l.chunks.map(c => c.h)),
        chunks: l.chunks,
        str: s,
        x0: Math.min(...l.chunks.map(c => Math.min(c.x0, c.x1))),
        x1: Math.max(...l.chunks.map(c => Math.max(c.x0, c.x1)))
      };
    });
    const maxEndX = lines.reduce((m, l) => Math.max(m, l.x1), 0);
    const dys = [];
    for (let i = 1; i < lines.length; i++) {
      const dy = lines[i].y - lines[i - 1].y;
      if (dy > 0 && dy < Math.max(lines[i].h, medH) * 3.2) dys.push(dy);
    }
    dys.sort((a, b) => a - b);
    const medDy = dys.length
      ? (dys.length % 2 === 1 ? dys[(dys.length - 1) / 2] : (dys[dys.length / 2 - 1] + dys[dys.length / 2]) / 2)
      : (medH * 1.45);
    const normalDy = Math.max(medH * 1.15, medDy);

    const outLines = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const dy = i > 0 ? (l.y - lines[i - 1].y) : 0;
      const yGapBreak = i > 0 && normalDy > 0 && dy >= normalDy * 1.65;
      if (i > 0 && normalDy > 0 && dy >= normalDy * 2.1) {
        outLines.push('');
        if (Array.isArray(metaOut)) metaOut.push({ shortEndX: false, yGapBreak: true });
      }
      const charW = l.h || medH;
      const shortEndX = lines.length >= 2 && (maxEndX - l.x1) >= charW * 2.8;
      outLines.push(l.str);
      if (Array.isArray(metaOut)) metaOut.push({ shortEndX, yGapBreak });
    }
    return outLines.join('\n');
  }
  /** 多段組（2段・3段組）のガター（段の境目）を X軸ヒストグラム（STEP = 2）からすべて検出して左→右順に返す */
  function findGutters(chunks, bodyH) {
    if (!chunks || chunks.length < 4 || !bodyH || bodyH <= 0) return [];
    const xs = chunks.map(c => [Math.min(c.x0, c.x1), Math.max(c.x0, c.x1)]);
    const lo = Math.min(...xs.map(x => x[0])), hi = Math.max(...xs.map(x => x[1])), W = hi - lo;
    if (W <= bodyH * 4) return [];
    const rows = groupVisualRows(chunks);
    if (rows.length < 2) return [];
    const STEP = 2;
    const nBins = Math.max(1, Math.ceil(W / STEP));
    const bins = new Int32Array(nBins);
    for (let i = 0; i < chunks.length; i++) {
      const b0 = Math.max(0, Math.floor((xs[i][0] - lo) / STEP));
      const b1 = Math.min(nBins - 1, Math.max(b0, Math.floor((xs[i][1] - lo - 1e-6) / STEP)));
      for (let b = b0; b <= b1; b++) bins[b]++;
    }
    const maxCross = chunks.length * 0.15;
    const minVw = Math.max(bodyH * 0.55, 5);
    const center = lo + W * 0.5;
    const cands = [];
    let i = 0;
    while (i < nBins) {
      if (bins[i] > maxCross) { i++; continue; }
      const vStart = i;
      while (i < nBins && bins[i] <= maxCross) i++;
      const vEnd = i - 1;
      const coarseV0 = lo + vStart * STEP, coarseV1 = Math.min(hi, lo + (vEnd + 1) * STEP);
      const coarseMid = (coarseV0 + coarseV1) / 2;
      if (coarseMid < lo + W * 0.12 || coarseMid > lo + W * 0.88) continue;
      let minCnt = bins[vStart];
      for (let b = vStart + 1; b <= vEnd; b++) if (bins[b] < minCnt) minCnt = bins[b];

      // STEP=2 のビン丸めによる実ギャップ幅の目減りを防ぐため、非横断チャンクの実座標から厳密な谷幅を算出
      let leftRows = 0, rightRows = 0, pairedRows = 0, statPairedRows = 0;
      let lMinY = Infinity, lMaxY = -Infinity, rMinY = Infinity, rMaxY = -Infinity;
      let lMinX = Infinity, lMaxX = -Infinity, rMinX = Infinity, rMaxX = -Infinity;
      let lChars = 0, rChars = 0;
      for (const r of rows) {
        let hasL = false, hasR = false, lStat = false, rStat = false;
        for (const c of r.chunks) {
          const cx0 = Math.min(c.x0, c.x1), cx1 = Math.max(c.x0, c.x1), cx = (cx0 + cx1) / 2;
          if (cx0 < coarseV0 && cx1 > coarseV1) continue;   // ガターを跨ぐチャンクは除外
          if (cx < coarseMid && cx1 <= coarseV1 + STEP) {
            hasL = true;
            if (!lStat && hasStatCell(c.str)) lStat = true;
            if (cx0 < lMinX) lMinX = cx0;
            if (cx1 > lMaxX) lMaxX = cx1;
            lChars += Array.from(c.str).length;
          } else if (cx >= coarseMid && cx0 >= coarseV0 - STEP) {
            hasR = true;
            if (!rStat && hasStatCell(c.str)) rStat = true;
            if (cx0 < rMinX) rMinX = cx0;
            if (cx1 > rMaxX) rMaxX = cx1;
            rChars += Array.from(c.str).length;
          }
        }
        if (hasL) { leftRows++; if (r.y < lMinY) lMinY = r.y; if (r.y > lMaxY) lMaxY = r.y; }
        if (hasR) { rightRows++; if (r.y < rMinY) rMinY = r.y; if (r.y > rMaxY) rMaxY = r.y; }
        if (hasL && hasR) pairedRows++;
        if (lStat && rStat) statPairedRows++;
      }
      if (statPairedRows >= 2) continue;
      if (leftRows < 3 || rightRows < 3 || pairedRows < 2) continue;
      if (lMaxY < rMinY - bodyH || rMaxY < lMinY - bodyH) continue;
      if (lChars < 4 || rChars < 4) continue;
      const v0 = isFinite(lMaxX) ? lMaxX : coarseV0;
      const v1 = isFinite(rMinX) ? rMinX : coarseV1;
      const vw = v1 - v0;
      if (vw < minVw) continue;
      const mid = (v0 + v1) / 2;
      if (mid < lo + W * 0.12 || mid > lo + W * 0.88) continue;
      cands.push({ v0, v1, mid, minCnt, vw, dist: Math.abs(mid - center) });
    }
    if (cands.length <= 1) return cands;

    // 隣接する谷のあいだにも2行以上のカラムが存在するか検証（ノイズ谷を除外し2〜3段組を確定）
    const better = (a, b) =>
      a.minCnt < b.minCnt ||
      (a.minCnt === b.minCnt && (a.vw > b.vw || (a.vw === b.vw && a.dist < b.dist)));
    const kept = [cands[0]];
    for (let ci = 1; ci < cands.length; ci++) {
      const prev = kept[kept.length - 1], cand = cands[ci];
      let midRows = 0, midChars = 0;
      for (const r of rows) {
        let hasM = false;
        for (const c of r.chunks) {
          const cx0 = Math.min(c.x0, c.x1), cx1 = Math.max(c.x0, c.x1), cx = (cx0 + cx1) / 2;
          if ((cx0 < prev.v0 && cx1 > prev.v1) || (cx0 < cand.v0 && cx1 > cand.v1)) continue;
          if (cx >= prev.mid && cx < cand.mid) {
            hasM = true;
            midChars += Array.from(c.str).length;
          }
        }
        if (hasM) midRows++;
      }
      if (midRows >= 2 && midChars >= 4) {
        kept.push(cand);
      } else if (better(cand, prev)) {
        kept[kept.length - 1] = cand;
      }
    }
    return kept;
  }
  /** 全幅の見出し（段をまたぐ長い行）で区切った帯ごとに、多段組（2〜3段組）を判定して左→右・上→下に並べる */
  function orderBands(chunks, metaOut, pageWOpt) {
    if (!chunks || !chunks.length) return '';
    const lo = Math.min(...chunks.map(c => Math.min(c.x0, c.x1)));
    const hi = Math.max(...chunks.map(c => Math.max(c.x0, c.x1)));
    const W = hi - lo, lineW = (pageWOpt && pageWOpt > 0) ? pageWOpt : W, bodyH = bodyHeight(chunks);
    const wide = c => {
      const cx0 = Math.min(c.x0, c.x1), cx1 = Math.max(c.x0, c.x1);
      return W > 0 && (cx1 - cx0) >= W * 0.65 && cx0 < lo + W * 0.25 && cx1 > lo + W * 0.75;
    };
    const sorted = chunks.slice().sort((a, b) => a.y - b.y), out = []; let band = [];
    // 動的ガター検出：全幅行の有無にかかわらず、ページ全体・非wide群・各帯から2〜3段組ガターを検出する
    const bands = []; { let b = []; sorted.forEach(c => { if (wide(c)) { if (b.length) bands.push(b); b = []; } else b.push(c); }); if (b.length) bands.push(b); }
    const hasGutter =
      findGutters(chunks, bodyH).length > 0 ||
      findGutters(chunks.filter(c => !wide(c)), bodyH).length > 0 ||
      bands.some(b => findGutters(b, bodyH).length > 0);
    if (!hasGutter) {
      return chunksToLines(chunks, metaOut, lineW);   // 多段組でなければ従来どおり
    }
    const pushPart = s => {
      if (!s) return;
      out.push(s);
    };
    const processBand = (subChunks, depth) => {
      if (!subChunks || !subChunks.length) return;
      const gs = findGutters(subChunks, bodyH);
      if (!gs.length) {
        pushPart(chunksToLines(subChunks, metaOut, lineW));
        return;
      }
      const emitSubBand = sub => {
        if (!sub.length) return;
        const cols = Array.from({ length: gs.length + 1 }, () => []);
        sub.forEach(c => {
          const cx = (c.x0 + c.x1) / 2;
          let colIdx = gs.length;
          for (let gi = 0; gi < gs.length; gi++) {
            if (cx < gs[gi].mid) { colIdx = gi; break; }
          }
          cols[colIdx].push(c);
        });
        cols.forEach(col => {
          if (!col.length) return;
          if (depth < 3 && col.length < subChunks.length) processBand(col, depth + 1);
          else pushPart(chunksToLines(col, metaOut, lineW));
        });
      };
      const rows = groupVisualRows(subChunks);
      let sub = [];
      rows.forEach(r => {
        const crosses = r.chunks.some(c => {
          const cx0 = Math.min(c.x0, c.x1), cx1 = Math.max(c.x0, c.x1);
          return gs.some(g => cx0 < g.v0 && cx1 > g.v1);
        });
        if (crosses) {
          emitSubBand(sub);
          sub = [];
          let lineStr = '';
          r.chunks.forEach((c, idx) => {
            if (idx) {
              const prevX1 = Math.max(r.chunks[idx - 1].x0, r.chunks[idx - 1].x1);
              const curX0 = Math.min(c.x0, c.x1);
              if (curX0 - prevX1 > r.h * 0.6) lineStr += ' ';
            }
            lineStr += c.str;
          });
          if (lineStr) {
            out.push(lineStr);
            if (Array.isArray(metaOut)) metaOut.push({ shortEndX: true, yGapBreak: true });
          }
        } else {
          sub.push(...r.chunks);
        }
      });
      emitSubBand(sub);
    };
    const flush = () => {
      if (!band.length) return;
      processBand(band, 0);
      band = [];
    };
    sorted.forEach(c => {
      if (wide(c)) {
        flush();
        if (c.str) {
          out.push(c.str);
          if (Array.isArray(metaOut)) metaOut.push({ shortEndX: true, yGapBreak: true });
        }
      } else band.push(c);
    });
    flush();
    const res = out.filter(Boolean).join('\n');
    if (Array.isArray(metaOut)) {
      const lineCount = res ? res.split('\n').length : 0;
      if (metaOut.length !== lineCount) metaOut.length = 0;
    }
    return res;
  }

  // ---------- 1行目の自動タイトル化 ----------
  /** 抽出テキストの1行目が短い見出し行（30文字以下、または【】▼■等で始まる）なら { title, body } に分ける。該当しなければ null */
  function splitTitleBody(text, maxLen) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n'); while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length < 2) return null;
    const first = lines[0].trim(), rest = lines.slice(1).join('\n').replace(/^\n+/, '');
    if (!rest.trim()) return null;
    const mark = /^[【■▼▽□◆◇●〔]/.test(first), len = Array.from(first).length;
    if (!(mark ? len <= 60 : (len <= (maxLen || 30) && !/[。！？]$/.test(first)))) return null;
    return { title: first.replace(/^[■□◆◇●▼▽\s]+/, '').replace(/^【(.*)】$/, '$1').trim() || first, body: rest };
  }

  // ---------- シナリオテキストのストック → チャットパレット ----------
  /** ストック一覧に表示する見出し（未入力なら本文の先頭から作る） */
  function stockTitle(item, max) {
    if (item && item.title && item.title.trim()) return item.title.trim();
    const t = String(item && item.text || '').replace(/\s+/g, ' ').trim(); max = max || 14;
    return Array.from(t).slice(0, max).join('') + (Array.from(t).length > max ? '…' : '');
  }
  /** 長い本文を、文末（。！？）で区切って maxChars 以下の断片に分ける */
  function chunkText(text, maxChars) {
    const t = String(text || ''); if (!maxChars || maxChars < 20 || Array.from(t).length <= maxChars) return [t];
    const sentences = t.match(/[^。！？!?\n]*[。！？!?]+[」』）)]*\n?|[^。！？!?\n]+\n?|\n/g) || [t], out = []; let cur = '';
    const len = s => Array.from(s).length;
    sentences.forEach(s => {
      while (len(s) > maxChars) { if (cur) { out.push(cur); cur = ''; } const a = Array.from(s); out.push(a.slice(0, maxChars).join('')); s = a.slice(maxChars).join(''); }
      if (len(cur) + len(s) > maxChars) { if (cur) out.push(cur); cur = s; } else cur += s;
    });
    if (cur) out.push(cur);
    return out.map(s => s.replace(/^\n+|\n+$/g, '')).filter(Boolean);
  }
  /** ストック1件 → チャットパレットの行（複数行になる場合は ココフォリアの「\n」記法で1行にする）。
   *  opts.includeTitle : 見出し【…】を先頭に付ける／opts.maxChars : 1行の最大文字数（超えたら分割） */
  function buildPaletteLines(item, opts) {
    const o = Object.assign({ includeTitle: true, maxChars: 1000 }, opts || {});
    const body = String(item.text || '').replace(/\r\n?/g, '\n').replace(/\s+$/g, ''); if (!body.trim()) return [];
    const parts = chunkText(body, o.maxChars), title = stockTitle(item, 14);
    return parts.map((p, i) => {
      const head = o.includeTitle ? '【' + title + (parts.length > 1 ? ' ' + (i + 1) + '/' + parts.length : '') + '】' + '\\n' : '';
      return head + p.replace(/\n/g, '\\n');
    });
  }

  // ---------- 編集ツール：英数字の半角／全角の統一・指定単語の {} 括り ----------
  const toHalfChar = c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0), toFullChar = c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0);
  /** 全角の英数字（Ａ-Ｚ ａ-ｚ ０-９）を半角にそろえる（記号・かな・漢字はそのまま） */
  const toHalfWidthAlnum = s => String(s == null ? '' : s).replace(/[Ａ-Ｚａ-ｚ０-９]/g, toHalfChar);
  /** 半角の英数字（A-Z a-z 0-9）を全角にそろえる */
  const toFullWidthAlnum = s => String(s == null ? '' : s).replace(/[A-Za-z0-9]/g, toFullChar);

  /** テキスト内の指定単語をすべて {単語} に置き換える（ココフォリアの変数記法）。
   *  - 全角・半角の表記ゆれ（HO1 / ＨＯ１）は同じ単語として拾い、{HO1} のように入力どおりの表記に統一する
   *  - すでに {HO1} になっている箇所は二重に括らない
   *  - opts.wholeWord（既定 true）：前後が英数字に続く場合は拾わない（HO1 は HO10 の中を置換しない）
   *  @returns { text, count } */
  function wrapWord(text, word, opts) {
    const src = String(text == null ? '' : text), w = String(word == null ? '' : word).trim();
    if (!w) return { text: src, count: 0 };
    const o = Object.assign({ wholeWord: true }, opts || {}), chars = Array.from(w.replace(/^\{+|\}+$/g, ''));
    if (!chars.length) return { text: src, count: 0 };
    const ALNUM = /[A-Za-z0-9]/, ALNUM_FULL = /[Ａ-Ｚａ-ｚ０-９]/, esc = c => c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const pat = chars.map(c => ALNUM.test(c) ? '[' + c + toFullChar(c) + ']' : ALNUM_FULL.test(c) ? '[' + toHalfChar(c) + c + ']' : esc(c)).join('');
    const ANY_ALNUM = 'A-Za-z0-9Ａ-Ｚａ-ｚ０-９';
    const isAn = c => ALNUM.test(c) || ALNUM_FULL.test(c);
    const pre = o.wholeWord && isAn(chars[0]) ? '(?<![' + ANY_ALNUM + '])' : '';
    const post = o.wholeWord && isAn(chars[chars.length - 1]) ? '(?![' + ANY_ALNUM + '])' : '';
    const re = new RegExp('(?<!\\{)' + pre + pat + post + '(?!\\})', 'gu'), label = '{' + toHalfWidthAlnum(chars.join('')) + '}';
    let count = 0;
    const out = src.replace(re, () => { count++; return label; });
    return { text: out, count };
  }

  // ---------- テキスト系資料（.txt/.html/.htm/.md/.markdown/.docx）の読み込み ----------
  const TEXT_DOC_RE = /\.(?:txt|html?|md|markdown|docx)$/i;
  const DOCX_NAME_RE = /\.docx(?:\.txt)?$/i;
  const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
  const CTRL_G_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  const BINARY_ERR_MSG = '⚠️ このファイルはバイナリ形式（旧 .doc 等）のためテキスト表示できません。PDFまたは .docx / .txt 形式で登録してください。';

  function toUint8(buf) {
    if (buf instanceof Uint8Array) return buf;
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return new Uint8Array(buf || []);
  }
  function isZipBytes(buf) {
    const u = toUint8(buf);
    return u.byteLength >= 4 && u[0] === 0x50 && u[1] === 0x4B && u[2] === 0x03 && u[3] === 0x04;
  }
  function isLegacyDocBinary(buf) {
    const u = toUint8(buf);
    return u.byteLength >= 4 && u[0] === 0xD0 && u[1] === 0xCF && u[2] === 0x11 && u[3] === 0xE0;
  }
  function detectBomlessUtf16(u) {
    const sampleLen = Math.min(u.byteLength, 512);
    if (sampleLen < 8) return '';
    let evenZeros = 0, oddZeros = 0;
    for (let i = 0; i < sampleLen; i++) {
      if (u[i] === 0) { if (i % 2 === 0) evenZeros++; else oddZeros++; }
    }
    if (oddZeros >= sampleLen * 0.25 && oddZeros > evenZeros * 3) return 'utf-16le';
    if (evenZeros >= sampleLen * 0.25 && evenZeros > oddZeros * 3) return 'utf-16be';
    return '';
  }
  function hasIso2022JpEsc(u) {
    const len = u.byteLength;
    for (let i = 0; i + 2 < len; i++) {
      if (u[i] === 0x1B) {
        const b1 = u[i + 1], b2 = u[i + 2];
        if ((b1 === 0x24 && (b2 === 0x42 || b2 === 0x40)) || (b1 === 0x28 && b2 === 0x42)) return true;
      }
    }
    return false;
  }
  function isLikelyBinaryBytes(buf) {
    const u = toUint8(buf);
    if (!u.byteLength) return false;
    if (isLegacyDocBinary(u)) return true;
    if (u.byteLength >= 2 && ((u[0] === 0xFF && u[1] === 0xFE) || (u[0] === 0xFE && u[1] === 0xFF))) return false;
    if (detectBomlessUtf16(u)) return false;
    const sampleLen = Math.min(u.byteLength, 1024);
    if (sampleLen < 16) return false;
    let nul = 0;
    for (let i = 0; i < sampleLen; i++) if (u[i] === 0) nul++;
    return (nul / sampleLen) >= 0.1;
  }
  function scoreJapaneseText(s) {
    if (s == null) return -1e12;
    const hira = (s.match(/[\u3041-\u3096]/g) || []).length;
    const kata = (s.match(/[\u30A1-\u30FA\u30FC]/g) || []).length;
    const kanji = (s.match(/[\u3400-\u4DBF\u4E00-\u9FFF\u3005]/g) || []).length;
    const jpPunct = (s.match(/[、。・「」『』（）【】《》〈〉！？：；]/g) || []).length;
    const fffd = (s.match(/\uFFFD/g) || []).length;
    const ctrl = (s.match(CTRL_G_RE) || []).length;
    const halfKataRuns = s.match(/[\uFF61-\uFF9F]{2,}/g) || [];
    let halfKata = 0;
    for (let i = 0; i < halfKataRuns.length; i++) halfKata += halfKataRuns[i].length;
    const latinExt = (s.match(/[\u0080-\u024F]/g) || []).length;
    return hira * 4 + kata * 2 + kanji * 2 + jpPunct * 2 - fffd * 50 - ctrl * 50 - halfKata * 8 - latinExt * 12;
  }

  /** バイト列 → 文字列（BOM / UTF-16 / ISO-2022-JP / UTF-8 / Shift_JIS(CP932) / EUC-JP を自動判別）。{ text, enc } */
  function decodeBytes(buf) {
    const u = toUint8(buf);
    if (!u.byteLength) return { text: '', enc: 'UTF-8' };
    const td = (enc, fatal, slice) => {
      try { return new TextDecoder(enc, { fatal: !!fatal }).decode(slice || u); } catch (_) { return null; }
    };
    // ① BOM
    if (u.byteLength >= 3 && u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) {
      const t = td('utf-8', false, u.subarray(3));
      return { text: String(t || '').replace(/^\uFEFF/, ''), enc: 'UTF-8 (BOM)' };
    }
    if (u.byteLength >= 2 && u[0] === 0xFF && u[1] === 0xFE) {
      const t = td('utf-16le', false, u.subarray(2));
      if (t != null) return { text: t.replace(/^\uFEFF/, ''), enc: 'UTF-16LE' };
    }
    if (u.byteLength >= 2 && u[0] === 0xFE && u[1] === 0xFF) {
      const t = td('utf-16be', false, u.subarray(2));
      if (t != null) return { text: t.replace(/^\uFEFF/, ''), enc: 'UTF-16BE' };
    }
    // ② BOMなし UTF-16LE / UTF-16BE
    const u16 = detectBomlessUtf16(u);
    if (u16) {
      const t = td(u16, false);
      if (t != null) return { text: t.replace(/^\uFEFF/, ''), enc: u16 === 'utf-16le' ? 'UTF-16LE' : 'UTF-16BE' };
    }
    // ③ ISO-2022-JP
    if (hasIso2022JpEsc(u)) {
      const t = td('iso-2022-jp', false);
      if (t != null) return { text: t, enc: 'ISO-2022-JP' };
    }
    // ④ 厳密 UTF-8（fatal:true かつ制御文字なし）
    const utf8Strict = td('utf-8', true);
    if (utf8Strict != null && !utf8Strict.includes('\uFFFD') && !CTRL_RE.test(utf8Strict)) {
      return { text: utf8Strict, enc: 'UTF-8' };
    }
    // ⑤ Shift_JIS (CP932)・EUC-JP・UTF-8 のスコアリング比較（fatal:false を必ず再評価）
    const cands = [
      { enc: 'Shift_JIS', text: td('shift_jis', true), strict: true },
      { enc: 'Shift_JIS', text: td('shift_jis', false), strict: false },
      { enc: 'EUC-JP', text: td('euc-jp', true), strict: true },
      { enc: 'EUC-JP', text: td('euc-jp', false), strict: false },
      { enc: 'UTF-8', text: td('utf-8', false), strict: false }
    ].filter(c => c.text != null);
    let best = null, bestScore = -1e15;
    for (const c of cands) {
      const sc = scoreJapaneseText(c.text) + (c.strict ? 1 : 0);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    if (best) return { text: best.text, enc: best.enc };
    return { text: td('utf-8', false) || '', enc: 'UTF-8 (不明)' };
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeXmlEntities(s) {
    return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return isFinite(n) ? String.fromCodePoint(n) : ''; } catch (_) { return ''; }
      }
      const lo = e.toLowerCase();
      return ENT[lo] != null ? ENT[lo] : m;
    });
  }
  /** HTML → 読みやすいプレーンテキスト（script/style 除去、ブロック要素は改行） */
  function htmlToText(html) {
    return String(html || '').replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6]|table|ul|ol|section|article|blockquote)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ').replace(/<[^>]+>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => { if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1); try { return String.fromCodePoint(n); } catch (er) { return ''; } } return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m; })
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- 純JS .docx（Word XML in ZIP）本文抽出 ----------
  function parseZipEntriesRaw(buf) {
    const u = toUint8(buf);
    if (!isZipBytes(u)) return [];
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const len = u.byteLength;
    const decName = bytes => { try { return new TextDecoder('utf-8').decode(bytes).replace(/\\/g, '/'); } catch (_) { return ''; } };
    const entries = [];
    // 中央ディレクトリ終端 (EOCD: 0x06054b50) を後方走査
    let eocd = -1;
    const minOff = Math.max(0, len - 65557);
    for (let i = len - 22; i >= minOff; i--) {
      if (u[i] === 0x50 && u[i + 1] === 0x4B && u[i + 2] === 0x05 && u[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd >= 0) {
      const cdSize = dv.getUint32(eocd + 12, true);
      const cdOff = dv.getUint32(eocd + 16, true);
      let pos = cdOff;
      const cdEnd = Math.min(len, cdOff + cdSize);
      while (pos + 46 <= cdEnd && dv.getUint32(pos, true) === 0x02014b50) {
        const method = dv.getUint16(pos + 10, true);
        const compSize = dv.getUint32(pos + 20, true);
        const nameLen = dv.getUint16(pos + 28, true);
        const extraLen = dv.getUint16(pos + 30, true);
        const commentLen = dv.getUint16(pos + 32, true);
        const localOff = dv.getUint32(pos + 42, true);
        const name = decName(u.subarray(pos + 46, pos + 46 + nameLen));
        if (localOff + 30 <= len && dv.getUint32(localOff, true) === 0x04034b50) {
          const lNameLen = dv.getUint16(localOff + 26, true);
          const lExtraLen = dv.getUint16(localOff + 28, true);
          const dataStart = localOff + 30 + lNameLen + lExtraLen;
          if (dataStart + compSize <= len) {
            entries.push({ name, method, data: u.subarray(dataStart, dataStart + compSize) });
          }
        }
        pos += 46 + nameLen + extraLen + commentLen;
      }
    }
    if (entries.length) return entries;
    // EOCDが無い最小ZIPの場合はローカルファイルヘッダを順次走査
    let pos = 0;
    while (pos + 30 <= len && dv.getUint32(pos, true) === 0x04034b50) {
      const method = dv.getUint16(pos + 8, true);
      const compSize = dv.getUint32(pos + 18, true);
      const nameLen = dv.getUint16(pos + 26, true);
      const extraLen = dv.getUint16(pos + 28, true);
      const name = decName(u.subarray(pos + 30, pos + 30 + nameLen));
      const dataStart = pos + 30 + nameLen + extraLen;
      if (dataStart + compSize > len) break;
      entries.push({ name, method, data: u.subarray(dataStart, dataStart + compSize) });
      pos = dataStart + compSize;
    }
    return entries;
  }
  function extractWordXmlText(xml) {
    const src = String(xml || '');
    if (!src) return '';
    const paras = [];
    let inP = 0, inT = false, inFallback = 0, cur = '';
    const tagRe = /<(\/?)([a-zA-Z0-9_:-]+)([^>]*?)(\/?)>/g;
    let lastIdx = 0, m;
    while ((m = tagRe.exec(src)) !== null) {
      if (inT && !inFallback && m.index > lastIdx) {
        cur += decodeXmlEntities(src.slice(lastIdx, m.index));
      }
      lastIdx = tagRe.lastIndex;
      const isClose = m[1] === '/';
      const name = m[2].toLowerCase();
      const isSelf = m[4] === '/';
      if (name === 'mc:fallback') {
        if (!isSelf) inFallback = Math.max(0, inFallback + (isClose ? -1 : 1));
        continue;
      }
      if (inFallback > 0) continue;
      if (name === 'w:p') {
        if (isSelf) {
          paras.push('');
        } else if (!isClose) {
          if (inP > 0 && cur) { paras.push(cur); cur = ''; }
          inP++;
        } else if (inP > 0) {
          paras.push(cur);
          cur = '';
          inP--;
        }
      } else if (name === 'w:t') {
        if (!isSelf) inT = !isClose;
      } else if (name === 'w:tab' && !isClose) {
        cur += '\t';
      } else if ((name === 'w:br' || name === 'w:cr') && !isClose) {
        cur += '\n';
      }
    }
    if (cur) paras.push(cur);
    return paras.join('\n').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function inflateZipEntrySync(ent) {
    if (!ent) return null;
    if (ent.method === 0) return ent.data;
    if (ent.method === 8 && typeof require === 'function') {
      try {
        const zlib = require('zlib');
        if (zlib && typeof zlib.inflateRawSync === 'function') {
          const out = zlib.inflateRawSync(ent.data);
          return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
        }
      } catch (_) { return null; }
    }
    return null;
  }
  async function inflateZipEntryAsync(ent) {
    if (!ent) return null;
    if (ent.method === 0) return ent.data;
    if (ent.method === 8) {
      const syncOut = inflateZipEntrySync(ent);
      if (syncOut) return syncOut;
      if (typeof DecompressionStream === 'function') {
        try {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          const writeP = writer.write(ent.data).then(() => writer.close());
          const reader = ds.readable.getReader();
          const chunks = [];
          let total = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) { chunks.push(value); total += value.byteLength; }
          }
          await writeP;
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { out.set(c, off); off += c.byteLength; }
          return out;
        } catch (_) { return null; }
      }
    }
    return null;
  }
  function findDocxEntries(buf) {
    const entries = parseZipEntriesRaw(buf);
    let docEnt = null, footEnt = null;
    for (const e of entries) {
      const lo = String(e.name || '').toLowerCase();
      if (lo === 'word/document.xml') docEnt = e;
      else if (lo === 'word/footnotes.xml') footEnt = e;
    }
    return { docEnt, footEnt };
  }
  function extractDocxTextSync(buf) {
    const { docEnt, footEnt } = findDocxEntries(buf);
    if (!docEnt) return null;
    const rawDoc = inflateZipEntrySync(docEnt);
    if (!rawDoc) return null;
    const utf8 = new TextDecoder('utf-8');
    let text = extractWordXmlText(utf8.decode(rawDoc));
    if (footEnt) {
      const rawFoot = inflateZipEntrySync(footEnt);
      if (rawFoot) {
        const ft = extractWordXmlText(utf8.decode(rawFoot));
        if (ft) text = text ? (text + '\n\n' + ft) : ft;
      }
    }
    return text;
  }
  async function extractDocxTextAsync(buf) {
    const { docEnt, footEnt } = findDocxEntries(buf);
    if (!docEnt) return null;
    const rawDoc = await inflateZipEntryAsync(docEnt);
    if (!rawDoc) return null;
    const utf8 = new TextDecoder('utf-8');
    let text = extractWordXmlText(utf8.decode(rawDoc));
    if (footEnt) {
      const rawFoot = await inflateZipEntryAsync(footEnt);
      if (rawFoot) {
        const ft = extractWordXmlText(utf8.decode(rawFoot));
        if (ft) text = text ? (text + '\n\n' + ft) : ft;
      }
    }
    return text;
  }

  function decodeHtmlAndNormalize(name, u) {
    const d = decodeBytes(u);
    if (/\.html?$/i.test(name || '')) {
      const m = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(d.text.slice(0, 2000));
      if (m && /shift|sjis|932/i.test(m[1]) && d.enc.startsWith('UTF-8') && /\uFFFD/.test(d.text)) {
        try { d.text = new TextDecoder('shift_jis').decode(u); d.enc = 'Shift_JIS'; } catch (_) { /* noop */ }
      }
      d.text = htmlToText(d.text);
    }
    d.text = d.text.replace(/\r\n?/g, '\n');
    return d;
  }

  /** パス/バイト列 → { text, enc }（.docx は本文抽出、.html/.htm はタグ除去、旧 .doc 等バイナリは安全ガード） */
  function loadTextDoc(name, buf) {
    const u = toUint8(buf);
    if (isZipBytes(u)) {
      const { docEnt } = findDocxEntries(u);
      if (DOCX_NAME_RE.test(name || '') || docEnt) {
        const extracted = extractDocxTextSync(u);
        if (extracted != null) return { text: extracted.replace(/\r\n?/g, '\n'), enc: 'DOCX (Word)' };
        return { text: BINARY_ERR_MSG, enc: 'バイナリ非対応', isBinaryError: true };
      }
      return { text: BINARY_ERR_MSG, enc: 'バイナリ非対応', isBinaryError: true };
    }
    if (isLegacyDocBinary(u) || isLikelyBinaryBytes(u)) {
      return { text: BINARY_ERR_MSG, enc: 'バイナリ非対応', isBinaryError: true };
    }
    return decodeHtmlAndNormalize(name, u);
  }
  /** 非同期版 loadTextDoc（ブラウザ環境の deflate-raw 圧縮 .docx にも対応） */
  async function loadTextDocAsync(name, buf) {
    const u = toUint8(buf);
    if (isZipBytes(u)) {
      const { docEnt } = findDocxEntries(u);
      if (DOCX_NAME_RE.test(name || '') || docEnt) {
        const extracted = await extractDocxTextAsync(u);
        if (extracted != null) return { text: extracted.replace(/\r\n?/g, '\n'), enc: 'DOCX (Word)' };
        return { text: BINARY_ERR_MSG, enc: 'バイナリ非対応', isBinaryError: true };
      }
      return { text: BINARY_ERR_MSG, enc: 'バイナリ非対応', isBinaryError: true };
    }
    if (isLegacyDocBinary(u) || isLikelyBinaryBytes(u)) {
      return { text: BINARY_ERR_MSG, enc: 'バイナリ非対応', isBinaryError: true };
    }
    return decodeHtmlAndNormalize(name, u);
  }

  const api = { cleanText, cleanSyncedDocText, shouldBreak, joinPair, layoutItems, extractRectText, splitTitleBody, bodyHeight, stockTitle, chunkText, buildPaletteLines, toHalfWidthAlnum, toFullWidthAlnum, wrapWord, decodeBytes, htmlToText, isZipBytes, isLegacyDocBinary, extractDocxTextSync, extractDocxTextAsync, loadTextDoc, loadTextDocAsync, TEXT_DOC_RE, _mul: mul };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CCFText = api;
})();
