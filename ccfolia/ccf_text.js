/* ccf_text.js — ココフォリア特化ツール Phase 1：テキスト処理（DOM／Electron に依存しない純粋関数）
 *  - cleanText        : PDF から抽出した文字列の不要な改行・空白を除去して整形する
 *  - extractRectText  : pdf.js の getTextContent().items から、矩形（バウンディングボックス）内の文字だけを読み順で取り出す
 *  - stockTitle / buildPaletteLines / chunkText : シナリオテキストのストック → ダミー駒（チャットパレット）用の行へ変換
 * ブラウザでは window.CCFText、Node では module.exports として使える。 */
(function () {
  'use strict';

  // ---------- 文字種 ----------
  const CJK = '\\u3000-\\u303F\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF';
  const RE_CJK_CHAR = new RegExp('[' + CJK + ']');
  const RE_SPACE_BETWEEN_CJK = new RegExp('([' + CJK + ']) +(?=[' + CJK + '])', 'g');
  const RE_ASCII_WORD = /[A-Za-z0-9]/;
  // ② 行末が文末記号で終わる場合（改行を保持）
  const TERMINATORS = /[。．｡！？!?」』）)】］〕〉》…‥―ー〜~”"']$/;
  // ③ 次行の行頭が記号・見出し・箇条書き・台詞・項目で始まる場合（改行を保持）
  const OPENERS = /^(?:[・●○◎■□◆◇▲△▼▽★☆※【『「（(〔〈《①-⑳―ー─━＊*#＃▶►→⇒⇔§†‡]|[-+]\s)/;
  const HEADING_BASE = /^(?:[■□◆◇●○▼▽▲△★☆※【〔]|第[0-9０-９一二三四五六七八九十百千]+[章節話幕部回篇]|[0-9０-９]+[\.．、）)\]:：])/i;
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
  const NUMBERED = /^[0-9０-９]+[\.．、）)\]:：]/;

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

  const DEFAULT_CLEAN = { joinLines: 'smart', stripSpaces: true };

  /** PDF 由来の文字列を整形する。
   *  opts.joinLines : 'smart'（既定：文末・見出し・箇条書き・項目行・短行の改行は残し、自動折り返しの改行だけ除去）／'all'（空行以外の改行をすべて除去）／'none'（改行はそのまま）
   *  opts.stripSpaces : true で、日本語どうしの間の不自然な半角空白・連続半角空白・行末空白を除去（英単語間のスペースは保持） */
  function cleanText(raw, opts) {
    const o = Object.assign({}, DEFAULT_CLEAN, opts || {});
    const rawStr = String(raw == null ? '' : raw);
    const cachedMeta = _rectMetaCache.get(rawStr) || null;
    let t = rawStr
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF\f\v]/g, '')   // ソフトハイフン・ゼロ幅文字・改ページ
      .replace(/\u00A0/g, ' ').replace(/\t/g, ' ');
    const rawLines = t.split('\n');
    const src = rawLines.map((l, idx) => {
      const m = cachedMeta && cachedMeta[idx] ? cachedMeta[idx] : null;
      return {
        text: l.replace(/\s+$/, ''),
        indent: /^(?:[\u3000]|[ ]{2,})/.test(l),
        shortEndX: !!(m && m.shortEndX),
        yGapBreak: !!(m && m.yGapBreak)
      };
    });

    // 選択ブロック内の最大行文字数（④ 78%未満または24文字以下の短行判定用）
    const lineLengths = src
      .map(l => Array.from(l.text.replace(/^[ \u3000]+/, '')).length)
      .filter(len => len > 0);
    const maxLineChars = lineLengths.length ? Math.max(...lineLengths) : 0;

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
      const lines = p.map(l => ({
        s: o.stripSpaces ? l.text.replace(/^[ \u3000]+/, '') : l.text,
        indent: l.indent,
        shortEndX: l.shortEndX,
        yGapBreak: l.yGapBreak
      }));
      if (o.joinLines === 'none') { lines.forEach(l => out.push(l.s)); return; }
      let acc = lines[0].s;
      for (let i = 1; i < lines.length; i++) {
        const prevObj = lines[i - 1], nextObj = lines[i];
        if (o.joinLines !== 'all' && shouldBreak(prevObj.s, nextObj.s, {
          nextIndented: nextObj.indent,
          nextYGapBreak: nextObj.yGapBreak,
          prevShortEndX: prevObj.shortEndX,
          maxLineChars
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
        // 日本語文字同士の間の不自然な半角スペースのみを除去（「あ い う」のように連続する場合も対応、英単語間のスペースは保持）
        let prev;
        do { prev = s; s = s.replace(RE_SPACE_BETWEEN_CJK, '$1'); } while (s !== prev);
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
    // ① 字下げ行・またはPDF座標で通常の行送りの1.35倍以上のYギャップがある行
    if (ctx.nextIndented || ctx.nextYGapBreak) return true;
    // ② 行末が文末記号で終わる場合
    if (TERMINATORS.test(p)) return true;
    // ③ 次行の行頭が見出し・箇条書き・台詞・番号、または項目行（〇〇：）
    if (OPENERS.test(n) || NUMBERED.test(n) || isHeadingLine(n) || isColonItemLine(n)) return true;
    // ④ 現在行が項目行（システム：CoC6版 等）
    if (isColonItemLine(p)) return true;
    // 文の途中折り返し（強制結合）
    if (MID_END.test(p) || MID_END2.test(p) || NEXT_CONT.test(n)) return false;
    // ⑤ 意図的な短行
    const pLen = Array.from(p).length, mlc = ctx.maxLineChars || 0;
    if (mlc >= 14 && pLen < Math.min(14, Math.floor(mlc * 0.68))) return true;
    if (isHeadingLine(p) && pLen <= 35) return true;
    if (ctx.prevShortEndX) return true;
    return false;
  }
  const MID_END = /[、，,っゃゅょァィゥェォッャュョ「『（(【〔〈《]$/;
  const MID_END2 = /[はがをにへでとやもかのよりからまでばかりだけほどくらいなどっててもでもけれどけどしりてでな]$/;
  const NEXT_CONT = /^(?:[。．、，！？!?」』）)】］〕〉》…‥ー〜~っゃゅょァィゥェォッャュョ]|ではない|ではなく|である|であった|であり|ですか|ます[。、！？]?|ました|ません|だった|だ[。、！？]|た[。、！？、]|て[、。いるいたいくおくしま]|に[もはてよ関現不]|を|が|は[、。]|と[はもい]|の[はでがをに]|へ|で[はもあ]|や|も|から|ので|けれど|しかし|するのが|居る)/;
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
      const glyphs = chars.map((ch, i) => {
        const adv = w * (i + 0.5) / n;
        return { ch, cx: tx[4] + dx * adv + ux * h * 0.38, cy: tx[5] + dy * adv + uy * h * 0.38 };
      });
      res.push({ str: it.str, x0: tx[4], x1: tx[4] + dx * w, y: glyphs[0].cy, h, glyphs, horizontal, hasEOL: !!it.hasEOL });
    });
    return res;
  }

  /** 矩形 rect={x,y,w,h}（画面座標。配列なら複数の矩形のいずれか）の内側に中心がある文字だけを集め、読み順の文字列にする。
   *  opts.excludeRuby : 選択範囲の本文フォントサイズ（文字数で重み付けした中央値）の70%未満の極小文字（ルビ）を除外する
   *  opts.twoColumn   : X座標の分布から左右2段組と判定したら「左段の上→下 ➡ 右段の上→下」の順に並べる（全幅の見出しは段組の区切りとして扱う） */
  function extractRectText(items, vpTrans, scale, rect, opts) {
    const o = Object.assign({ excludeRuby: false, twoColumn: true }, opts || {});
    const boxes = (Array.isArray(rect) ? rect : [rect]).map(r => ({ x1: Math.min(r.x, r.x + r.w), x2: Math.max(r.x, r.x + r.w), y1: Math.min(r.y, r.y + r.h), y2: Math.max(r.y, r.y + r.h) }));
    let chunks = [];
    layoutItems(items, vpTrans, scale).forEach(L => {
      let s = '', first = null, last = null;
      const mx = L.h * 0.25;
      L.glyphs.forEach(g => {
        if (boxes.some(b => g.cx >= b.x1 - mx && g.cx <= b.x2 + mx && g.cy >= b.y1 && g.cy <= b.y2)) { if (!first) first = g; last = g; s += g.ch; }
      });
      if (s) chunks.push({ str: s, x0: first.cx, x1: last.cx + L.h * 0.5, y: first.cy, h: L.h, horizontal: L.horizontal });
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
    if (text && metaList.length) _rememberRectMeta(text, metaList);
    return text;
  }

  /** 本文のフォントサイズ：文字数で重み付けした中央値 */
  function bodyHeight(chunks) {
    const a = chunks.map(c => ({ h: c.h, n: Array.from(c.str).length })).sort((p, q) => p.h - q.h), total = a.reduce((s, c) => s + c.n, 0);
    let acc = 0; for (const c of a) { acc += c.n; if (acc >= total / 2) return c.h; }
    return a[a.length - 1].h;
  }
  /** チャンク群（同じ段）を行にまとめ、上→下・左→右の文字列にする。
   *  同時に ① 行間のY座標ギャップ（通常の行送りの1.35倍以上）および ④ 行終端X座標（カラム最大endXより1.5文字以上手前）を記録する */
  function chunksToLines(chunks, metaOut, pageWOpt) {
    if (!chunks || !chunks.length) return '';
    const loX = Math.min(...chunks.map(c => Math.min(c.x0, c.x1)));
    const hiX = Math.max(...chunks.map(c => Math.max(c.x0, c.x1)));
    const pageW = (pageWOpt && pageWOpt > 0) ? pageWOpt : Math.max(0, hiX - loX);
    const sorted = chunks.slice().sort((a, b) => a.y - b.y), rawLines = [];
    sorted.forEach(c => {
      const ln = rawLines.find(l => Math.abs(l.y - c.y) <= Math.max(c.h, l.h) * 0.5);
      if (ln) { ln.chunks.push(c); ln.y = (ln.y * (ln.chunks.length - 1) + c.y) / ln.chunks.length; ln.h = Math.max(ln.h, c.h); }
      else rawLines.push({ y: c.y, h: c.h, chunks: [c] });
    });
    rawLines.sort((a, b) => a.y - b.y);
    const medH = bodyHeight(chunks) || 10;
    const lines = [];
    rawLines.forEach(l => {
      l.chunks.sort((a, b) => a.x0 - b.x0);
      const splitGap = Math.max(l.h * 5.0, pageW * 0.12);
      const groups = [];
      let cur = [];
      l.chunks.forEach((c, i) => {
        if (i > 0 && rawLines.length >= 2) {
          const gap = c.x0 - l.chunks[i - 1].x1;
          if (gap > splitGap) {
            if (cur.length) groups.push(cur);
            cur = [c];
            return;
          }
        }
        cur.push(c);
      });
      if (cur.length) groups.push(cur);
      groups.forEach(g => {
        let s = '';
        g.forEach((c, i) => {
          if (i) { const gap = c.x0 - g[i - 1].x1; if (gap > l.h * 0.6) s += ' '; }   // 離れている文字の間は空白（表の列など）
          s += c.str;
        });
        lines.push({
          y: l.y,
          h: Math.max(...g.map(c => c.h)),
          chunks: g,
          str: s,
          x0: Math.min(...g.map(c => Math.min(c.x0, c.x1))),
          x1: Math.max(...g.map(c => Math.max(c.x0, c.x1)))
        });
      });
    });
    const maxEndX = lines.reduce((m, l) => Math.max(m, l.x1), 0);
    const dys = [];
    for (let i = 1; i < lines.length; i++) {
      const dy = lines[i].y - lines[i - 1].y;
      if (dy > 0 && dy < Math.max(lines[i].h, medH) * 3.2) dys.push(dy);
    }
    dys.sort((a, b) => a - b);
    const normalDy = dys.length ? dys[Math.floor((dys.length - 1) * 0.4)] : (medH * 1.45);

    const outLines = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const dy = i > 0 ? (l.y - lines[i - 1].y) : 0;
      const yGapBreak = i > 0 && normalDy > 0 && dy >= normalDy * 1.45;
      if (i > 0 && normalDy > 0 && dy >= normalDy * 1.8) {
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
  /** 左右2段組か判定し、段の境目のX座標を返す（2段組でなければ null） */
  function findGutter(chunks, bodyH) {
    if (!chunks || chunks.length < 4 || !bodyH || bodyH <= 0) return null;
    const xs = chunks.map(c => [Math.min(c.x0, c.x1), Math.max(c.x0, c.x1)]);
    const lo = Math.min(...xs.map(x => x[0])), hi = Math.max(...xs.map(x => x[1])), W = hi - lo;
    if (W <= 0) return null;
    const rows = [];
    chunks.slice().sort((a, b) => a.y - b.y).forEach(c => {
      const ln = rows.find(r => Math.abs(r.y - c.y) <= Math.max(c.h, r.h) * 0.5);
      if (ln) { ln.chunks.push(c); ln.y = (ln.y * (ln.chunks.length - 1) + c.y) / ln.chunks.length; ln.h = Math.max(ln.h, c.h); }
      else rows.push({ y: c.y, h: c.h, chunks: [c] });
    });
    const STEP = 4;
    const nBins = Math.max(1, Math.ceil(W / STEP));
    const bins = new Int32Array(nBins);
    for (let i = 0; i < chunks.length; i++) {
      const b0 = Math.max(0, Math.floor((xs[i][0] - lo) / STEP));
      const b1 = Math.min(nBins - 1, Math.max(b0, Math.floor((xs[i][1] - lo - 1e-6) / STEP)));
      for (let b = b0; b <= b1; b++) bins[b]++;
    }
    const maxCross = chunks.length * 0.15;
    const minVw = Math.max(bodyH * 1.4, W * 0.025);
    const center = lo + W * 0.5;
    let best = null;
    let i = 0;
    while (i < nBins) {
      if (bins[i] > maxCross) { i++; continue; }
      const vStart = i;
      while (i < nBins && bins[i] <= maxCross) i++;
      const vEnd = i - 1;
      const v0 = lo + vStart * STEP, v1 = Math.min(hi, lo + (vEnd + 1) * STEP);
      const vw = v1 - v0;
      if (vw < minVw) continue;
      let minCnt = bins[vStart];
      for (let b = vStart + 1; b <= vEnd; b++) if (bins[b] < minCnt) minCnt = bins[b];
      const mid = (v0 + v1) / 2;
      if (mid < lo + W * 0.25 || mid > lo + W * 0.75) continue;
      let pairedRows = 0;
      for (const r of rows) {
        let hasL = false, hasR = false;
        for (const c of r.chunks) {
          const cx0 = Math.min(c.x0, c.x1), cx1 = Math.max(c.x0, c.x1), cx = (cx0 + cx1) / 2;
          if (cx < mid && cx1 <= v1) hasL = true;
          else if (cx >= mid && cx0 >= v0) hasR = true;
        }
        if (hasL && hasR) pairedRows++;
      }
      if (pairedRows < 3) continue;
      const cnt = [0, 0], chars = [0, 0];
      for (const c of chunks) {
        const s = (c.x0 + c.x1) / 2 < mid ? 0 : 1;
        cnt[s]++;
        chars[s] += Array.from(c.str).length;
      }
      const tot = chars[0] + chars[1];
      if (!(tot > 0 && cnt[0] >= 2 && cnt[1] >= 2 && chars[0] >= tot * 0.2 && chars[1] >= tot * 0.2)) continue;
      const cand = { mid, minCnt, vw, dist: Math.abs(mid - center) };
      if (
        !best ||
        cand.minCnt < best.minCnt ||
        (cand.minCnt === best.minCnt && (cand.vw > best.vw || (cand.vw === best.vw && cand.dist < best.dist)))
      ) {
        best = cand;
      }
    }
    return best ? best.mid : null;
  }
  /** 全幅の見出し（段をまたぐ長い行）で区切った帯ごとに、2段組を判定して並べる */
  function orderBands(chunks, metaOut, pageWOpt) {
    if (!chunks || !chunks.length) return '';
    const lo = Math.min(...chunks.map(c => Math.min(c.x0, c.x1)));
    const hi = Math.max(...chunks.map(c => Math.max(c.x0, c.x1)));
    const W = hi - lo, lineW = (pageWOpt && pageWOpt > 0) ? pageWOpt : W, bodyH = bodyHeight(chunks);
    const wide = c => {
      const cx0 = Math.min(c.x0, c.x1), cx1 = Math.max(c.x0, c.x1);
      return W > 0 && (cx1 - cx0) >= W * 0.58 && cx0 < lo + W * 0.35 && cx1 > lo + W * 0.65;
    };
    const sorted = chunks.slice().sort((a, b) => a.y - b.y), out = []; let band = [];
    // 動的ガター検出：ページ全体で縦の空白帯が無くても、全幅見出しで区切った帯ごとに判定する。
    // さらに帯の中に「ガターを大きく跨ぐ行」があれば、独立見出しとして出力し前後の左右段を分離する
    const bands = []; { let b = []; sorted.forEach(c => { if (wide(c)) { if (b.length) bands.push(b); b = []; } else b.push(c); }); if (b.length) bands.push(b); }
    if (findGutter(chunks.filter(c => !wide(c)), bodyH) == null && !bands.some(b => findGutter(b, bodyH) != null)) {
      return chunksToLines(chunks, metaOut, lineW);   // 2段組でなければ従来どおり
    }
    const pushPart = s => {
      if (!s) return;
      out.push(s);
    };
    const emitSubBand = (sub, g) => {
      if (!sub.length) return;
      pushPart(chunksToLines(sub.filter(c => (c.x0 + c.x1) / 2 < g), metaOut, lineW));
      pushPart(chunksToLines(sub.filter(c => (c.x0 + c.x1) / 2 >= g), metaOut, lineW));
    };
    const flush = () => {
      if (!band.length) return;
      const g = findGutter(band, bodyH);
      if (g == null) {
        pushPart(chunksToLines(band, metaOut, lineW));
      } else {
        const rows = [];
        band.forEach(c => {
          const ln = rows.find(r => Math.abs(r.y - c.y) <= Math.max(c.h, r.h) * 0.5);
          if (ln) { ln.chunks.push(c); ln.y = (ln.y * (ln.chunks.length - 1) + c.y) / ln.chunks.length; ln.h = Math.max(ln.h, c.h); }
          else rows.push({ y: c.y, h: c.h, chunks: [c] });
        });
        rows.sort((a, b) => a.y - b.y);
        let sub = [];
        rows.forEach(r => {
          const crosses = r.chunks.some(c => Math.min(c.x0, c.x1) < g - bodyH * 1.5 && Math.max(c.x0, c.x1) > g + bodyH * 1.5);
          if (crosses) {
            emitSubBand(sub, g);
            sub = [];
            r.chunks.sort((a, b) => a.x0 - b.x0);
            let lineStr = '';
            r.chunks.forEach((c, idx) => {
              if (idx && c.x0 - r.chunks[idx - 1].x1 > r.h * 0.6) lineStr += ' ';
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
        emitSubBand(sub, g);
      }
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
    return out.filter(Boolean).join('\n');
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

  // ---------- テキスト系資料（.txt/.html/.htm/.md）の読み込み ----------
  const TEXT_DOC_RE = /\.(?:txt|html?|md)$/i;
  /** バイト列 → 文字列（BOM / UTF-8 / UTF-16 / Shift_JIS(CP932) / EUC-JP を自動判別）。{ text, enc } */
  function decodeBytes(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const td = (enc, fatal) => { try { return new TextDecoder(enc, { fatal: !!fatal }).decode(u); } catch (e) { return null; } };
    if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) return { text: td('utf-8').replace(/^\uFEFF/, ''), enc: 'UTF-8 (BOM)' };
    if (u[0] === 0xFF && u[1] === 0xFE) return { text: td('utf-16le'), enc: 'UTF-16LE' };
    if (u[0] === 0xFE && u[1] === 0xFF) return { text: td('utf-16be'), enc: 'UTF-16BE' };
    let t = td('utf-8', true); if (t != null) return { text: t, enc: 'UTF-8' };
    const sj = td('shift_jis', true), eu = td('euc-jp', true), bad = s => (s.match(/\uFFFD/g) || []).length;
    const score = s => s == null ? -1 : (s.match(/[\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length - bad(s) * 5;
    if (score(sj) >= score(eu) && sj != null) return { text: sj, enc: 'Shift_JIS' };
    if (eu != null) return { text: eu, enc: 'EUC-JP' };
    return { text: td('utf-8') || '', enc: 'UTF-8 (不明)' };
  }
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  /** HTML → 読みやすいプレーンテキスト（script/style 除去、ブロック要素は改行） */
  function htmlToText(html) {
    return String(html || '').replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6]|table|ul|ol|section|article|blockquote)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ').replace(/<[^>]+>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => { if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1); try { return String.fromCodePoint(n); } catch (er) { return ''; } } return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m; })
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  /** パス/バイト列 → { text, enc }（.html/.htm はタグを除去） */
  function loadTextDoc(name, buf) {
    const d = decodeBytes(buf);
    if (/\.html?$/i.test(name || '')) { const m = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(d.text.slice(0, 2000)); if (m && /shift|sjis|932/i.test(m[1]) && d.enc.startsWith('UTF-8') && /\uFFFD/.test(d.text)) { try { d.text = new TextDecoder('shift_jis').decode(buf); d.enc = 'Shift_JIS'; } catch (e) { /* noop */ } } d.text = htmlToText(d.text); }
    d.text = d.text.replace(/\r\n?/g, '\n'); return d;
  }

  const api = { cleanText, shouldBreak, joinPair, layoutItems, extractRectText, splitTitleBody, bodyHeight, stockTitle, chunkText, buildPaletteLines, toHalfWidthAlnum, toFullWidthAlnum, wrapWord, decodeBytes, htmlToText, loadTextDoc, TEXT_DOC_RE, _mul: mul };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CCFText = api;
})();
