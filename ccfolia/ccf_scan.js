/* ccf_scan.js — STEP 5-A：PDF 解析（メインPDF判別・スペック抽出・タイトル推測）と、複数PDF横断の「NPC候補一括スキャン」
 *  上半分は DOM／Electron に依存しない純粋関数（Node でもテスト可）。下半分（window.CCF がある時だけ）は pdfjs を使うヘルパとスキャン用モーダル。
 *    pickMainPdf(items, folderName)  … ファイル名の優先度から { main, subs } を決める（KP・真相・データ・HO・規約 等はサブ資料）
 *    extractSpec(text)               … プレイ人数・プレイ時間・推奨技能・ロスト率・あらすじ を正規表現で抽出
 *    pickTitleFromItems(pages)       … 1〜2ページ目の最大フォントサイズの文字列（定型句を除く）
 *    detectNpcBlocks(text, sysId, N) … ステータス・技能が密集しているブロックを検出 */
(function () {
  'use strict';
  const NF = s => String(s == null ? '' : s).normalize('NFKC').replace(/\r\n?/g, '\n');

  // ---------- 0. 文字コード自動判別 & 文字化け検査 & テキストクレンジング ----------
  function isMojibakeText(rawStr, opts) {
    const s = String(rawStr == null ? '' : rawStr);
    if (!s.trim()) return false;
    if (/\uFFFD/.test(s)) return true;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(s)) return true;
    if (/[\uFFFD].*B$/m.test(s)) return true;
    const hasJp = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(s);
    if (hasJp && /[\uAC00-\uD7AF]/.test(s)) return true;
    const normSpace = s.replace(/[\u00A0\u00B0\u00B1\u00D7\u00F7]/g, ' ');
    if (hasJp && /[\u0080-\u024F]/.test(normSpace)) return true;
    if (opts && opts.checkHiragana === false) return false;
    if (opts && opts.allowUrlOnly && /^(?:https?:\/\/\S+[\s\r\n]*)+$/i.test(s.trim())) return false;
    const bodyChars = s.replace(/[\s\p{P}\p{S}]+/gu, '');
    if (!bodyChars.length) return false;
    const hiraCount = (bodyChars.match(/[\u3041-\u3096]/g) || []).length;
    return (hiraCount / bodyChars.length) < 0.15;
  }
  function cleanExtractedText(raw) {
    return NF(raw)
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\uFFFD/g, '');
  }
  function decodeTextBytes(rawBytes) {
    if (typeof rawBytes === 'string') return String(rawBytes).replace(/\r\n?/g, '\n');
    const u8 = rawBytes instanceof Uint8Array
      ? rawBytes
      : (rawBytes instanceof ArrayBuffer ? new Uint8Array(rawBytes) : new Uint8Array(rawBytes || []));
    if (!u8.byteLength) return '';
    const normLn = s => String(s || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (u8.byteLength >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      try { return normLn(new TextDecoder('utf-8', { fatal: true }).decode(u8.subarray(3))); } catch (_) { }
      return normLn(new TextDecoder('utf-8').decode(u8.subarray(3)));
    }
    if (u8.byteLength >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
      try { return normLn(new TextDecoder('utf-16le').decode(u8.subarray(2))); } catch (_) { }
    }
    if (u8.byteLength >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
      try { return normLn(new TextDecoder('utf-16be').decode(u8.subarray(2))); } catch (_) { }
    }
    const sampleLen = Math.min(u8.byteLength, 256);
    let oddZeros = 0, evenZeros = 0;
    for (let i = 0; i < sampleLen; i++) {
      if (u8[i] === 0) { if (i % 2 === 1) oddZeros++; else evenZeros++; }
    }
    if (sampleLen >= 8 && oddZeros >= sampleLen / 4) {
      try { return normLn(new TextDecoder('utf-16le').decode(u8)); } catch (_) { }
    }
    if (sampleLen >= 8 && evenZeros >= sampleLen / 4) {
      try { return normLn(new TextDecoder('utf-16be').decode(u8)); } catch (_) { }
    }
    let utf8Text = '';
    try {
      utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
      if (!utf8Text.includes('\uFFFD') && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(utf8Text)) {
        return normLn(utf8Text);
      }
    } catch (_) { }
    const tryDec = (enc, fatal) => {
      try { return new TextDecoder(enc, { fatal: !!fatal }).decode(u8); } catch (_) { return null; }
    };
    const scoreText = s => {
      if (s == null) return -1e9;
      const bad = (s.match(/\uFFFD/g) || []).length;
      const ctrl = (s.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) || []).length;
      const hira = (s.match(/[\u3041-\u3096]/g) || []).length;
      const jp = (s.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || []).length;
      return hira * 3 + jp - (bad + ctrl) * 20;
    };
    const sjFatal = tryDec('shift-jis', true);
    if (sjFatal != null && !sjFatal.includes('\uFFFD') && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(sjFatal)) {
      return normLn(sjFatal);
    }
    const candidates = [
      tryDec('shift-jis', false),
      tryDec('euc-jp', true),
      utf8Text || tryDec('utf-8', false)
    ].filter(x => x != null);
    candidates.sort((a, b) => scoreText(b) - scoreText(a));
    return normLn(candidates[0] || '');
  }
  function japaneseCharRatio(text) {
    const nw = String(text || '').replace(/\s+/g, '');
    if (!nw.length) return 0;
    const jp = (nw.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3005\u30FC]/g) || []).length;
    return jp / nw.length;
  }
  function isValidSynopsisText(text) {
    if (isMojibakeText(text)) return false;
    const s = cleanExtractedText(text).trim();
    if (s.length < 40) return false;
    if (!/[。『』！？]/.test(s)) return false;
    if (japaneseCharRatio(s) < 0.30) return false;
    return true;
  }

  // ---------- 1. メインPDF・あらすじ対象ファイルの判別 ----------
  const RE_SUB = /KP|真相|データ|HO|規約|ハンドアウト|handout|付録|資料|ルール|立ち絵|キャラクター|NPC|ガイド|クレジット|マップ|ライセンス|readme|はじめに/i;
  const RE_MAIN = /本編|本文|本篇|シナリオ本編|main/i;
  const RE_SYN_ALLOW = /(?:トレーラー|trailer|あらすじ|synopsis|概要|summary|PL向け|PL用|公開情報|はじめに|readme|read\s*me)/i;
  const RE_SYN_EXCLUDE = /(?:本編|本文|本篇|KP情報|GM情報|キーパー情報|KP向け|GM向け|KP用|GM用|真相|解説|秘匿)/i;
  function classifySynopsisDocs(items) {
    const list = (items || []).filter(Boolean).map(it => (typeof it === 'string')
      ? { path: it, name: String(it).split(/[\\/]/).pop() || '' }
      : { ...it, name: String(it.name || String(it.path || '').split(/[\\/]/).pop() || '') });
    const safe = list.filter(it => it.name && !RE_SYN_EXCLUDE.test(it.name));
    const preferred = safe.filter(it => RE_SYN_ALLOW.test(it.name));
    return preferred.length ? preferred : safe;
  }
  const norm = s => NF(s).toLowerCase().replace(/\.pdf$/i, '').replace(/[\s\p{P}\p{S}_]+/gu, '');
  /** items: [{ path, name?, size? }] → { main, subs, ranked }（main は items の要素。空なら null） */
  function pickMainPdf(items, folderName) {
    const base = (it) => String(it.name || String(it.path || '').split(/[\\/]/).pop() || '');
    const fn = norm(folderName || ''), ranked = (items || []).map(it => {
      const n = base(it), nn = norm(n); let sc = 0;
      if (RE_MAIN.test(n)) sc += 10;
      if (RE_SUB.test(n)) sc -= 10;
      if (fn.length >= 2 && nn.length >= 2 && (nn.includes(fn) || fn.includes(nn))) sc += 6;
      if (/第?[1-9一二三四五六七八九〇]\s*話|part\s*0?1|前編|その1/i.test(n)) sc += 1;   // 各話分割なら第一話寄り
      return { it, sc, size: it.size || 0, n };
    });
    ranked.sort((a, b) => b.sc - a.sc || b.size - a.size || a.n.localeCompare(b.n, 'ja', { numeric: true }));
    return { main: ranked.length ? ranked[0].it : null, subs: ranked.slice(1).map(r => r.it), ranked: ranked.map(r => r.it) };
  }

  // ---------- 2. タイトル推測（最大フォントサイズ） ----------
  const BOILER = /^(?:TRPG|CoC|COC|クトゥルフ(?:の呼び声|神話)?(?:TRPG)?|新クトゥルフ神話TRPG|シナリオ|SCENARIO|対応|推奨|[67]版|第[67]版|ver\.?\s*[\d.]*|目次|CONTENTS?|INDEX|はじめに|表紙|プレイ人数.*|プレイ時間.*|[\d\s\-–—/.・]+)$|©|Copyright|無断|禁止|配布|ゲームマスター|KP用|PL用|シナリオ集|撮影禁止|転載禁止|無断転載|複製禁止|ネタバレ|閲覧注意|注意|警告|\bWARNING\b|\bCAUTION\b|\bSTOP\b|\bDO\s+NOT\b/i;
  const BOILER_SENTENCE_RE = /(?:です|ます|ください|下さい|ません|こと|について)[。！!.]?$/;
  function isBoilerTitle(raw) {
    const t = String(raw == null ? '' : raw).normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!t) return true;
    return BOILER.test(t) || BOILER_SENTENCE_RE.test(t);
  }
  /** pages: [[{ s, h }]]（1〜2ページ目のアイテム。h は transform の高さ）→ タイトル候補（無ければ ''） */
  function pickTitleFromItems(pages) {
    const its = [].concat(...(pages || [])).filter(i => i && i.s && String(i.s).trim() && i.h > 0);
    if (!its.length) return '';
    const sizes = [...new Set(its.map(i => Math.round(i.h * 2) / 2))].sort((a, b) => b - a).slice(0, 4);
    for (const sz of sizes) {
      const t = its.filter(i => Math.abs(i.h - sz) <= 0.5).map(i => i.s).join('').replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && t.length <= 60 && !isBoilerTitle(t)) return t;
    }
    return '';
  }

  // ---------- 3. シナリオスペック抽出 ----------
  const L_ALL = 'プレイ人数|推奨人数|PL人数|参加人数|人数|プレイ時間|所要時間|想定時間|目安時間|必須技能|必要技能|準推奨技能|あると使える技能|あると便利な技能|準推奨|推奨技能|おすすめ技能|オススメ技能|ロスト率|ロスト|後遺症の可能性|後遺症|あらすじ|概要|使用システム|ルールシステム|対応システム|システム|対応|形式|ジャンル|舞台|時代|注意';
  const RE_LABEL = new RegExp('(?:' + L_ALL + ')');
  const cleanVal = v => String(v || '').split(new RegExp('[ 　]*(?:' + L_ALL + ')\\s*[:：]')).shift().replace(/[\s/／|｜、,，・]+$/g, '').replace(/^[\s:：]+/, '').trim();
  /** 見出し語（labelRe）の値を取る：「見出し：値」→「見出し（行末）＋次行の値」の順に試す */
  function grab(text, labelRe, maxLen) {
    const head = '[■□◆◇●▼▽【\\[]?\\s*(?:' + labelRe + ')\\s*[】\\]]?';
    let m = new RegExp(head + '\\s*[:：]\\s*\\n?[ \\t]*([^\\n]{1,' + maxLen + '})').exec(text);
    if (!m) m = new RegExp('(?:^|\\n)\\s*' + head + '[ \\t]*\\n[ \\t]*([^\\n]{1,' + maxLen + '})').exec(text);
    if (!m) return '';
    const v = cleanVal(m[1]);
    return v && !RE_LABEL.test(v.slice(0, 6)) ? v : '';
  }
  const SYN_HEAD_LINE_RE = /^\s*(?:【|\[|■|□|◆|◇|●|○|▼|▽|❖|✦|★|☆|#+\s*)?(?:あらすじ|トレーラー|ストーリー概要|シナリオ概要|ストーリー|プロローグ|イントロダクション|導入|概要|Story|Introduction|Trailer|Synopsis)(?:】|\]|\s|$)/i;
  const SYN_HEAD_INLINE_RE = /^\s*(?:【|\[|■|□|◆|◇|●|○|▼|▽|❖|✦|★|☆|#+\s*)?(?:あらすじ|トレーラー|ストーリー概要|シナリオ概要|ストーリー|プロローグ|イントロダクション|導入|概要|Story|Introduction|Trailer|Synopsis)\s*(?:[】\]]\s*[:：]?|[:：])\s*(.+)$/i;
  const SYN_STOP_RE = /(?:真相|シナリオの背景|背景|神話生物|黒幕|犯人|ネタバレ|KP情報|GM情報|キーパー情報|KP向け|GM向け|本編|本文|タイムライン|スケジュール|第\s*[0-9０-９一二三四五六七八九十]+\s*章|シーン\s*[0-9０-９一二三四五六七八九十]+|導入\s*[0-9０-９一二三四五六七八九十]+|開始|目次|利用規約|注意事項|推奨技能|プレイ人数|プレイ時間|ロスト率|PL共有情報|探索者作成|(?:^|[^A-Za-z])(?:Scene|Index|Contents)(?:[^A-Za-z]|$))/i;
  const SYN_NEW_SECTION_RE = /^\s*(?:【|\[|■|□|◆|◇|●|○|▼|▽|❖|✦|★|☆|#+\s*)/;
  function grabSynopsis(raw) {
    const cleaned = NF(raw).replace(/[\uE000-\uF8FF]/g, '');
    const lines = cleaned.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const headLine = lines[i].trim();
      if (!headLine || !SYN_HEAD_LINE_RE.test(headLine) || SYN_STOP_RE.test(headLine)) continue;
      const inlineM = SYN_HEAD_INLINE_RE.exec(headLine);
      let acc = inlineM ? inlineM[1].trim() : '';
      if (acc && SYN_STOP_RE.test(acc)) acc = '';
      let blanks = 0;
      for (let j = i + 1; j < lines.length && acc.length < 400; j++) {
        const l = lines[j].trim();
        if (!l) {
          if (acc) {
            blanks++;
            if (blanks >= 2) break;
          }
          continue;
        }
        blanks = 0;
        if (SYN_STOP_RE.test(l) || SYN_NEW_SECTION_RE.test(l)) break;
        if (new RegExp('^\\s*(?:' + L_ALL + ')\\s*[:：]').test(l)) break;
        if (/^(?:p\.?\s*\d+|\-\s*\d+\s*\-|\d{1,3})$/i.test(l)) continue;
        acc += (acc && !/[、。！？「『（]$/.test(acc) ? '\n' : '') + l;
      }
      acc = acc.trim();
      if (acc.length > 400) acc = acc.slice(0, 399).trimEnd() + '…';
      if (isValidSynopsisText(acc)) return cleanExtractedText(acc).trim();
    }
    return '';
  }
  function normalizeExtractedSystem(sys) {
    if (typeof window !== 'undefined' && typeof window.normalizeSystemName === 'function') {
      return window.normalizeSystemName(sys);
    }
    if (sys == null) return '';
    let s = String(sys).replace(/新\s*[CcＣｃ][OoＯｏ][CcＣｃ]\s*[7７]\s*版?/g, 'CoC7版').trim();
    if (!s) return '';
    const half = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\s+/g, ' ').trim();
    if (/クトゥルフ|クトゥルー|cthulhu|coc|^(?:第?\s*[67]\s*版|[67]th)$/i.test(half)) {
      const parenMatch = half.match(/^(.+?)[（(]([^）)]+)[）)]\s*$/);
      if (parenMatch) {
        const basePart = parenMatch[1], subPart = parenMatch[2];
        const baseHas7 = /7|新/.test(basePart);
        const baseHas6 = /6|旧/.test(basePart) || (!baseHas7 && /クトゥルフ|クトゥルー|cthulhu|coc/i.test(basePart));
        if (baseHas6 && !baseHas7 && /7/.test(subPart)) return 'CoC6版 (7版対応可)';
        if (baseHas7 && !baseHas6 && /6|旧/.test(subPart)) return 'CoC7版 (6版対応可)';
      }
      const has6 = /6\s*版|6th|第\s*6|ver\.?\s*6|coc\s*6(?!\d)|旧\s*coc|旧\s*クトゥルフ|[67]\s*[/／・･,&＆]\s*[67]|\b6\b/i.test(half);
      const has7 = /7\s*版|7th|第\s*7|ver\.?\s*7|coc\s*7(?!\d)|新\s*クトゥルフ|[67]\s*[/／・･,&＆]\s*[67]|\b7\b/i.test(half);
      if (has6 && has7) return 'CoC6版/7版';
      if (has7) return 'CoC7版';
      return 'CoC6版';
    }
    return s;
  }
  /** text → { system, playerCount, playTime, reqSkills, recSkills, semiRecSkills, lostRate, aftereffect, synopsis }（あらすじ自動抽出は廃止し常に ''） */
  function extractSpec(raw, opts) {
    const t = cleanExtractedText(raw);
    const guardField = v => (v && !isMojibakeText(v, { checkHiragana: false })) ? v : '';
    let system = guardField(grab(t, '使用システム|ルールシステム|対応システム|システム', 40));
    if (!system) {
      const has6 = /クトゥルフ神話TRPG.*6版|CoC\s*6版|CoC第6版|旧クトゥルフ/i.test(t);
      const has7 = /新クトゥルフ神話TRPG|クトゥルフ神話TRPG.*7版|CoC\s*7版|CoC第7版/i.test(t);
      if (has6 && has7) system = 'CoC6版/7版';
      else if (has7) system = 'CoC7版';
      else if (has6 || /クトゥルフ神話TRPG/i.test(t)) system = 'CoC6版';
      else if (/エモクロアTRPG/i.test(t)) system = 'エモクロア';
    }
    system = normalizeExtractedSystem(system);
    let playerCount = guardField(grab(t, 'プレイ人数|推奨人数|PL人数|参加人数|人数', 30));
    if (!playerCount) { const m = /(?:探索者|PC|PL|プレイヤー)?\s*(\d+(?:\s*[〜~～-]\s*\d+)?\s*人)\s*(?:用|推奨|プレイ|シナリオ|程度)/.exec(t); if (m) playerCount = guardField(m[1].replace(/\s+/g, '')); }
    const playTime = guardField(grab(t, 'プレイ時間|所要時間|想定時間|目安時間', 40));
    const reqSkills = guardField(grab(t, '必須技能|必要技能', 80));
    const recSkills = guardField(grab(t, '推奨技能|おすすめ技能|オススメ技能', 80));
    const semiRecSkills = guardField(grab(t, '準推奨技能|あると使える技能|あると便利な技能|準推奨', 80));
    const lostRate = guardField(grab(t, 'ロスト率', 30) || grab(t, 'ロスト', 30));
    const aftereffect = guardField(grab(t, '後遺症の可能性|後遺症', 60));
    return { system, playerCount, playTime, reqSkills, recSkills, semiRecSkills, lostRate, aftereffect, synopsis: '' };
  }
  /** 複数の抽出結果を先頭優先でマージ（空の項目だけ後の結果で埋める） */
  const mergeSpecs = list => list.reduce((a, s) => { Object.keys(s || {}).forEach(k => { if (k !== 'synopsis' && !a[k] && s[k]) a[k] = s[k]; }); return a; }, { system: '', playerCount: '', playTime: '', reqSkills: '', recSkills: '', semiRecSkills: '', lostRate: '', aftereffect: '', synopsis: '' });

  // ---------- 4. NPC ブロックの検出（システム別の語彙の密集度） ----------
  const CoC = { keys: ['STR', 'CON', 'POW', 'DEX', 'APP', 'SIZ', 'INT', 'EDU', 'HP', 'MP', 'SAN', 'CCB?\\s*<=?|CC\\s*<=', '[\\u3040-\\u9FFF]{2,}\\s*[:：]?\\s*\\d{1,3}\\s*[%％]'], min: 4, anchor: /(?<![A-Za-z])(?:STR|CON|POW|DEX)(?![A-Za-z])|CCB?\s*<=/ };
  const SYS_KEYS = {
    coc6: CoC, coc7: CoC,
    sw25: { keys: ['命中力', '回避力', '防護点', '生命抵抗力', '精神抵抗力', '打撃点', '(?<![A-Za-z])HP', '(?<![A-Za-z])MP', '魔物レベル', '知名度', '弱点', '部位'], min: 3, anchor: /命中力|防護点|生命抵抗力|魔物レベル/ },
    dx3: { keys: ['肉体', '感覚', '精神', '社会', '侵蝕率?', '行動値', '(?<![A-Za-z])HP', 'ロイス', 'シンドローム', 'エフェクト', '達成値', 'ワークス', 'カバー'], min: 4, anchor: /侵蝕|行動値|シンドローム|ロイス|エフェクト|ワークス/ },
    emoklore: { keys: ['感情', '狂気', '〈[^〉]{1,12}〉', 'HP', 'ＨＰ', '器用', '敏捷', '知覚', '筋力', '精神力'], min: 3, anchor: /〈|感情|狂気/ },
    twod6: { keys: ['特技', '恐怖心', '正気度', '目標値', '能力値', '2D6', '生命力', '攻撃力', '防御力'], min: 3, anchor: /特技|目標値|正気度|2D6/ },
    futari: { keys: ['(?<![A-Za-z])DT(?![A-Za-z])', '(?<![A-Za-z])AS(?![A-Za-z])', '探偵', '助手', '捜査技能', '[:：]\\s*\\d'], min: 3, anchor: /捜査技能|探偵|助手/ },
    stratera: { keys: ['オモテ', 'ウラ', 'キーワード', '目的', '秘密'], min: 3, anchor: /オモテ|ウラ/ },
    madamis: { keys: ['プロフィール', '年齢', '関係', '初期情報', 'タイムライン', '目的', '秘密'], min: 3, anchor: /プロフィール|初期情報/ }
  };
  const GENERIC = { keys: ['(?<![A-Za-z])HP', '(?<![A-Za-z])MP', 'SAN', 'STR', 'DEX', 'INT', '技能', '能力値', '防御', '攻撃'], min: 4, anchor: /HP|STR|DEX/ };
  const sysDef = id => SYS_KEYS[id] || GENERIC;
  const compiled = new Map();
  const keyRes = def => { if (!compiled.has(def)) compiled.set(def, def.keys.map(k => new RegExp(k, 'i'))); return compiled.get(def); };
  const nameLike = l => { const s = String(l || '').trim(); return !!s && s.length <= 30 && !/[。！？:：]/.test(s) && !/\d{2,}/.test(s); };

  /** page 1枚分のテキストからNPC候補を検出。戻り値：[{ text, name, score, line }] */
  function detectLegacy(text, sysId, N) {
    const raw = NF(text).split('\n'), def = sysDef(sysId), res = keyRes(def);
    const lines = N && N.foldTables ? N.foldTables(raw.slice()) : raw;
    const hits = lines.map(l => { const o = []; res.forEach((re, k) => { const m = re.exec(l); if (m) o.push([m.index, k]); }); o.sort((a, b) => a[0] - b[0]); return o.map(x => x[1]); });
    const clusters = []; let cur = null;
    const close = () => { if (cur) clusters.push(cur); cur = null; };
    hits.forEach((h, i) => {
      if (!h.length) return;
      if (cur && i - cur.e - 1 > 3) close();
      if (cur && cur.keys.size >= def.min && h.includes(cur.first) && i > cur.e) { const s = i; close(); cur = { s, e: i, keys: new Set(h), first: h[0] }; return; }
      if (!cur) cur = { s: i, e: i, keys: new Set(h), first: h[0] }; else { cur.e = i; h.forEach(k => cur.keys.add(k)); }
    });
    close();
    const out = [];
    clusters.forEach((c, ci) => {
      if (c.keys.size < def.min) return;
      const prevEnd = ci ? clusters[ci - 1].e : -1, nextStart = ci + 1 < clusters.length ? clusters[ci + 1].s : lines.length;
      let s = c.s; for (let k = 0; k < 2 && s - 1 > prevEnd && nameLike(lines[s - 1]); k++) s--;   // 直前の名前らしい行
      let e = c.e; while (e + 1 < Math.min(nextStart - 1, lines.length) && e - c.e < 2 && /\d/.test(lines[e + 1])) e++;   // 直後の数値を含む行
      if (e - s > 60) e = s + 60;
      const body = lines.slice(s, e + 1).join('\n').trim();
      if (!def.anchor.test(NF(body))) return;
      let name = ''; try { if (N && N.parseNpc) name = N.parseNpc(body, { edition: 'auto', rollPrefix: 'CCB', abilityRolls: true }).name || ''; } catch (er) { /* noop */ }
      if (!name || /^名称未設定/.test(name)) name = (lines.slice(s, c.s).find(nameLike) || '').trim() || '';
      out.push({ text: body, name, score: c.keys.size, line: s });
    });
    return out;
  }

  // ---------- 4b. CoC系：【パラメータ名＋直後の数値】ペア基準の検出（誤検出・名前誤認・合体バグ対策） ----------
  const P_LABELS = 'STR|CON|POW|DEX|APP|SIZ|INT|EDU|HP|MP|SAN|LUK|筋力|体力|精神力|敏捷|外見|体格|知性|教育|耐久力|正気度|装甲';
  const RE_PAIR = new RegExp('(?<![A-Za-z])(' + P_LABELS + ')(?![A-Za-z])\\s*[:=]?\\s*(?:\\(\\s*\\d{1,4}(?:\\s*[+\\-]\\s*\\d{1,4})+\\s*\\)|\\d{1,4}(?!\\d)(?!\\s*(?:を|点|ダメージ)))', 'gi');
  const RE_STR = /(?<![A-Za-z])(?:STR|筋力)\s*[:=]?\s*(?:\d|\(\s*\d)/i;
  const RE_CC = /CCB?\s*<=?\s*(?:\d|\{?[A-Za-z]{3}\}?)|1d100\s*<=?\s*\d/i;
  const RE_PCT = /(?:^|[\s,、/:\]】〉》「])[^\s\d%:=/,、。()（）]{1,15}\s*[:=]?\s*\d{1,3}\s*%/;
  const RE_BRACKET_SK = /[《〈【<][^》〉】>\n]{1,24}[》〉】>]\s*[(:=]?\s*(?:\d{1,3}|[A-Za-z]{3}\s*[×*xX]\s*\d{1,2})/;
  const RE_INLINE = new RegExp('^\\s*(.{1,40}?)\\s*[/:]\\s*(?=(?:' + P_LABELS + ')(?![A-Za-z])\\s*[:=]?\\s*(?:\\d|\\(\\s*\\d))', 'i');
  const RE_SEP = /^[\s\-=_/*#~・.―ー─━+|]*$/;
  const RE_HEAD_JUNK = /【\s*(?:能力値|技能値|チャットパレット|ステータス)|チャットパレット|×\s*n\s*】|】\s*-{2,}|■\s*ステータス傾向|ステータス傾向|^\s*[【\[]?\s*技能\s*[】\]]?\s*$/;
  const RE_BAD_NAME_PREFIX = /^(?:ステータス|能力値|技能値|チャットパレット|パラメータ|(?:NPC|PC|探索者|キャラクター)\s*(?:能力値|技能値|ステータス|チャットパレット|パラメータ)|種族?|所属|性別|年齢|武器|技能|所持品|職業|出身|国籍|身長|体重|備考|特徴|設定|解説|概要|描写|プロフィール|データ|詳細|行動|戦術|攻撃|特殊攻撃|魔術|呪文|【人物像】|【使用魔術】|【過去背景】|【経緯】|【能力値|【技能値|【ステータス|【技能|【武器|【所持品|【データ|【備考|【特徴|【解説|【行動|【魔術|【呪文)/i;
  const RE_LABEL_ONLY = /^(?:名前|氏名|NPC名|PC名|キャラクター名|キャラ名|名称)\s*[:：]?$/i;
  const RE_STAT_HEAD = /^(?:NPC|PC|探索者|キャラクター)?\s*(?:能力値|技能値|ステータス|チャットパレット|パラメータ)\s*[:：]?$/i;
  const RE_TIMING_HEAD = /^(?:戦闘|探索|尋問|交渉|逃走|追跡)(?:開始|終了|前|後|中)$|(?:終わったら|したら|の場合|の時|するとき|する際|後|前)$/;
  const SYM_ALL = '\\uE000-\\uF8FF\\u25A0-\\u25FF\\u2600-\\u27BF❏❐❑■□◆◇●○◯〇▼▽▶▷★☆❖✦✧※†‡・';
  const SYM_HEAD = '\\uE000-\\uF8FF\\u25A0-\\u25FF\\u2600-\\u27BF❏❐❑■□◆◇●○◯〇▼▽▶▷★☆❖✦✧';
  const HEAD_SYM = new RegExp('^[' + SYM_HEAD + ']+\\s*(.+)$');
  const HEAD_BRK = /^【([^】]+)】$/;
  const PROFILE_ATTR = /^(?:所属|種族?|性別|年齢|職業|身長|体重|出身)\s*[:：]/;
  const PROSE_WORDS = /(?:で従わせる|事で|引き摺り|引きずり|出す|する|れる|せる|して|から|より|ため|では|には|とは|まで|どの|その|持た|持つ|ある|いる|ない|ず)/;
  const proseLike = c => {
    const t = String(c == null ? '' : c).normalize('NFKC');
    return PROSE_WORDS.test(t) || (t.length >= 15 && !/[(（]/.test(t) && /[はがをにでともへのや]|から|ので|だが|です|ます/.test(t));
  };
  const RE_SECTION_HEAD = /^(?:導入|イントロダクション|あらすじ|背景|概要|真相|結末|エンディング|クライマックス|登場人物|登場NPC|NPC一覧|キャラクター(?:一覧)?|推奨技能|プレイ人数|プレイ時間|ロスト率|注意事項?|目次|はじめに|おわりに|あとがき|クレジット|ハンドアウト|(?:本編での)?立ち回り$|(?:行動|戦闘)(?:指針|方針|パターン)$|運用$|攻略$|役割$|関係性$|登場シーン$|出現場所$|本編での.*$|第\s*[0-9一二三四五六七八九十百]+\s*[章話部幕節]|(?:シーン|場面|Chapter|Section|Phase|Part)\s*[0-9０-９一二三四五六七八九十]+|(?:HO|ＨＯ|PC|ＰＣ|PL|ＰＬ|KP|ＫＰ|GM|ＧＭ)\s*[0-9０-９一二三四五六七八九十A-Za-zＡ-Ｚａ-ｚ]?(?:\s*[:：・/\-]?\s*(?:秘匿|公開|導入|個別|ハンドアウト|情報|向け|用|共通)){0,2}$|(?:秘匿|公開)(?:情報|ハンドアウト|HO|ＨＯ)?$)/i;
  const RE_FORM_HEAD = new RegExp('^\\s*[' + SYM_HEAD + '\\[【]?\\s*(?:ステータス|能力値|形態|フォーム)\\s*[:：]\\s*([^】\\]\\n]{1,20}?)\\s*[】\\]]?\\s*$');
  const RE_SKILL_HEAD = /^\s*[【\[]?\s*(?:技能|戦闘技能|探索技能|行動技能|知識技能|交渉技能|武器|武装|攻撃|攻撃方法|魔法|魔術|呪文|スキル|Skills?)\s*[】\]]?\s*(?:[:：]\s*[^\n]{0,30}|[（(][^）)\n]{1,25}[）)]\s*[:：]?)?$/i;
  const RE_PAGE_NUM_LINE = /^\s*(?:p\.?\s*\d+|-\s*\d+\s*-|—\s*\d+\s*—|\d{1,4})\s*$/i;
  const RE_AGE_SEX = /^(?:[\d\s]{1,4}[歳才]?|男性?|女性?|年齢[:\s]*\d*[歳才]?|性別[:\s]*[男女]?性?|[\s/・,:()（）])+$/;
  const RE_PARTICLE_END = /(?:は|が|を|へ|から|ので|より|まで|です|ます|である)$/;
  const pairsOf = l => { const o = []; String(l).replace(RE_PAIR, (m, k) => { o.push(String(k).toUpperCase()); return m; }); return o; };
  const isSkillLine = l => RE_CC.test(l) || RE_PCT.test(l) || RE_BRACKET_SK.test(l);
  const isTerm = l => /《[^》]*ルール[^》]*》/.test(l) || (l.length >= 45 && /[。！？]/.test(l) && !pairsOf(l).length && !isSkillLine(l));
  const RE_STRIP_ALL = new RegExp('^[' + SYM_ALL + '\\s:/：／\\-]+|[' + SYM_ALL + '\\s:/：／]+$', 'g');
  const RE_STRIP_SYM_LEAD = new RegExp('^[' + SYM_ALL + '\\s]+');
  const trimName = s => String(s == null ? '' : s).replace(RE_STRIP_ALL, '').replace(/[\uE000-\uF8FF]/g, '').trim();
  const trimNm = trimName;
  /** 名前遡り用：この行を名前候補にしてはいけないか */
  function badName(raw) {
    const r = NF(raw).trim(), s = trimNm(r);
    if (!s || s.length > (/[（(]/.test(s) ? 38 : 25)) return true;
    const unbrk = s.replace(/^[【\[]+|[】\]]+$/g, '').trim();
    if (RE_BAD_NAME_PREFIX.test(r) || RE_BAD_NAME_PREFIX.test(s) || RE_BAD_NAME_PREFIX.test(unbrk) || RE_FORM_HEAD.test(r) || RE_SKILL_HEAD.test(r)) return true;
    if (RE_LABEL_ONLY.test(r) || RE_LABEL_ONLY.test(s) || RE_LABEL_ONLY.test(unbrk)) return true;
    if (RE_STAT_HEAD.test(r) || RE_STAT_HEAD.test(s) || RE_STAT_HEAD.test(unbrk)) return true;
    if (RE_SECTION_HEAD.test(r) || RE_SECTION_HEAD.test(s) || RE_SECTION_HEAD.test(unbrk)) return true;
    if (RE_TIMING_HEAD.test(r) || RE_TIMING_HEAD.test(s) || RE_TIMING_HEAD.test(unbrk)) return true;
    if (/[「」『』]/.test(r) || RE_HEAD_JUNK.test(r) || RE_SEP.test(s)) return true;
    if (/[】]|^[\-=]{2,}|-{3,}/.test(r) && !/【/.test(r)) return true;
    if (/\d*[dD]\d+|CCB?\s*<=|<=/.test(s) || pairsOf(s).length || isSkillLine(s)) return true;
    if (/^\d+\s*[,、.)）]/.test(r) || /[。、]/.test(s) || RE_PARTICLE_END.test(s) || RE_AGE_SEX.test(s)) return true;
    if (/(?:HP|MP|SAN|正気度|耐久)\s*(?:を|が)?\s*[+\-]\s*\d/i.test(r)) return true;
    if (/^[\d\s,.%+\-]+$/.test(s) || /^(?:技能|能力値|ステータス|データ|備考|特徴|設定)\s*[:]?$/.test(s) || /^[■□●○◆◇▼▽【\[]?\s*(?:ステータス|データ|プロフィール|概要|解説|描写|NPC)\s*[】\]]?$/.test(s)) return true;
    if (proseLike(r) || proseLike(s)) return true;
    return false;
  }
  const headNameOf = (line, origLine) => {
    const t = NF(line).trim();
    if (!t || pairsOf(t).length || isSkillLine(t) || isTerm(t)) return '';
    if (RE_FORM_HEAD.test(t) || RE_SKILL_HEAD.test(t) || PROFILE_ATTR.test(t)) return '';
    let cand = '';
    const ms = HEAD_SYM.exec(t);
    if (ms) cand = ms[1];
    else {
      const mb = HEAD_BRK.exec(t);
      if (mb) cand = mb[1];
    }
    if (!cand) return '';
    const inner = cand.trim();
    if (
      RE_BAD_NAME_PREFIX.test(t) || RE_BAD_NAME_PREFIX.test(inner) ||
      RE_LABEL_ONLY.test(inner) || RE_STAT_HEAD.test(inner) ||
      RE_SECTION_HEAD.test(inner) || RE_TIMING_HEAD.test(inner)
    ) return '';
    if (badName(cand) || proseLike(cand)) return '';
    let nm = trimNm(cand);
    if (
      !nm || RE_BAD_NAME_PREFIX.test(nm) || RE_LABEL_ONLY.test(nm) ||
      RE_STAT_HEAD.test(nm) || RE_SECTION_HEAD.test(nm) || RE_TIMING_HEAD.test(nm) ||
      badName(nm) || proseLike(nm)
    ) return '';
    if (origLine && /＝/.test(origLine)) nm = nm.replace(/=/g, '＝');
    return nm;
  };
  // 属性行（所属：／種：／年齢 等）から下15行以内の平文はプロフィール解説文としてスキップ
  const belowAttr = (nl, i) => {
    for (let j = i - 1; j >= 0 && j >= i - 15; j--) {
      const t = nl[j].trim();
      if (PROFILE_ATTR.test(t) || PROFILE_ATTR.test(t.replace(RE_STRIP_SYM_LEAD, ''))) return true;
      if (headNameOf(t) || (HEAD_SYM.test(t) && !RE_BAD_NAME_PREFIX.test(t.replace(RE_STRIP_SYM_LEAD, ''))) || (HEAD_BRK.test(t) && !RE_BAD_NAME_PREFIX.test(t) && !RE_BAD_NAME_PREFIX.test(t.replace(/^【|】$/g, '')))) return false;
    }
    return false;
  };
  const formTokensOf = label => {
    const raw = NF(label || '').trim();
    if (!raw) return [];
    const parts = raw.split(/[・/／,、\s（）()【】\[\]]+/).map(x => x.trim()).filter(x => x.length >= 2);
    return [...new Set([raw, ...parts])];
  };
  const matchFormTargets = (line, groupItems) => {
    const t = NF(line || '').trim();
    if (!t) return null;
    if (/(?:^|[\s:：・/／(（【\[])(?:or|OR|ＯＲ|または|もしくは|共通|全形態)(?:$|[\s:：・/／)）】\]])/i.test(t) || /\bor\b/i.test(t)) {
      return groupItems;
    }
    const matched = groupItems.filter(it => formTokensOf(it.formLabel).some(tok => t.includes(tok)));
    if (matched.length > 0) return matched;
    return null;
  };
  const isFormSubheadOfGroup = (line, groupItems) => {
    if (!groupItems || groupItems.length < 2) return false;
    const t = NF(line || '').trim();
    if (!t || t.length > 30 || pairsOf(t).length || isSkillLine(t) || isTerm(t) || /[。！？]/.test(t)) return false;
    const unbrk = trimNm(t).replace(/^[【\[\(（]+|[】\]\)）]+$/g, '').trim();
    if (!unbrk || proseLike(unbrk)) return false;
    const allToks = [...new Set(groupItems.flatMap(it => formTokensOf(it.formLabel)))];
    if (!allToks.length) return false;
    const cleaned = unbrk.replace(/(?:^|\s)(?:or|OR|または|もしくは)(?:\s|$)/gi, ' ').replace(/[・/／,、\s:：用向け]+/g, ' ').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.every(p => allToks.some(tok => p === tok || (p.length >= 2 && tok.includes(p))));
  };
  function findPrevPageTailName(prevPageTail, formLabel) {
    const rawArr = Array.isArray(prevPageTail)
      ? prevPageTail
      : (typeof prevPageTail === 'string' ? String(prevPageTail).replace(/\r\n?/g, '\n').split('\n') : []);
    const tail = rawArr
      .map(l => String(l == null ? '' : l).trim())
      .filter(l => l && !RE_SEP.test(NF(l)) && !RE_PAGE_NUM_LINE.test(NF(l)))
      .slice(-8);
    if (!tail.length) return null;
    let fl = formLabel || '';
    for (let k = tail.length - 1; k >= 0; k--) {
      const nt = NF(tail[k]).trim();
      const fm = RE_FORM_HEAD.exec(nt);
      if (fm && !fl) { fl = fm[1].trim(); continue; }
      break;
    }
    for (let k = tail.length - 1; k >= 0; k--) {
      const origLine = tail[k], nt = NF(origLine).trim();
      if (pairsOf(nt).length || isSkillLine(nt)) break;
      const hn = headNameOf(nt, origLine);
      if (hn) return { baseName: hn, name: fl ? hn + '（' + fl + '）' : hn, fromHead: true, formLabel: fl };
    }
    for (let k = tail.length - 1; k >= 0; k--) {
      const origLine = tail[k], nt = NF(origLine).trim();
      if (pairsOf(nt).length || isSkillLine(nt) || isTerm(nt)) break;
      if (RE_FORM_HEAD.test(nt) || RE_SKILL_HEAD.test(nt) || PROFILE_ATTR.test(nt)) continue;
      if (badName(nt) || proseLike(nt)) continue;
      const lm = /^\s*(?:名前|氏名|NPC名|名称)\s*[:=]\s*(.+?)\s*$/.exec(nt);
      let cand = trimNm(lm ? lm[1] : nt);
      if (!cand || badName(cand) || proseLike(cand)) continue;
      if (/＝/.test(origLine)) cand = cand.replace(/=/g, '＝');
      return { baseName: cand, name: fl ? cand + '（' + fl + '）' : cand, fromHead: false, formLabel: fl };
    }
    return null;
  }
  function extractPageTailInfo(text, N, blocks) {
    const rawLines = NF(text).split('\n');
    const raw0 = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const lines = N && N.foldTables ? N.foldTables(rawLines.slice()) : rawLines;
    const orig = lines.length === raw0.length ? raw0 : null;
    const list = Array.isArray(blocks) ? blocks : [];
    const lastEnd = list.length ? Math.max(...list.map(b => (typeof b.endLine === 'number' ? b.endLine : b.line))) : -1;
    const after = [];
    let hasNewHead = false, hasTermAfter = false;
    for (let i = lastEnd + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || RE_SEP.test(t) || RE_PAGE_NUM_LINE.test(t)) continue;
      if (headNameOf(t, orig ? orig[i] : null) || RE_FORM_HEAD.test(t)) hasNewHead = true;
      if (isTerm(t)) hasTermAfter = true;
      after.push(orig ? orig[i].trim() : t);
    }
    return {
      tailLines: after.slice(-8),
      endsWithStats: list.length > 0 && !hasNewHead && !hasTermAfter && after.length <= 3
    };
  }
  function extractLeadingSkillOverflow(text, N, firstBlockLine) {
    const rawLines = NF(text).split('\n');
    const lines = N && N.foldTables ? N.foldTables(rawLines.slice()) : rawLines;
    const limit = (typeof firstBlockLine === 'number' && firstBlockLine >= 0) ? Math.min(firstBlockLine, lines.length) : lines.length;
    if (limit <= 0) return null;
    let start = 0;
    while (start < limit) {
      const t = lines[start].trim();
      if (!t || RE_SEP.test(t) || RE_PAGE_NUM_LINE.test(t)) { start++; continue; }
      break;
    }
    if (start >= limit) return null;
    const first = lines[start];
    if (pairsOf(first).length || headNameOf(first) || RE_FORM_HEAD.test(first) || isTerm(first)) return null;
    if (!(RE_SKILL_HEAD.test(first) || isSkillLine(first))) return null;
    let bEnd = start, bSkills = isSkillLine(first) ? 1 : 0;
    for (let m = start + 1; m < limit; m++) {
      const lm = lines[m], tm = lm.trim();
      if (pairsOf(lm).length || headNameOf(lm) || RE_FORM_HEAD.test(lm) || isTerm(lm)) break;
      if (isSkillLine(lm)) { bEnd = m; bSkills++; }
      else if (RE_SKILL_HEAD.test(lm)) { bEnd = m; }
      else if (/(?:ダメージ|ビルド|ダメボ|装甲|移動|DB|DMG|1D\d|\d+D\d)/i.test(lm) && tm.length <= 45) { bEnd = m; }
      else if (!tm || RE_SEP.test(lm)) {
        const ahead = lines.slice(m + 1, Math.min(limit, m + 3)).some(x => isSkillLine(x) || RE_SKILL_HEAD.test(x));
        if (!ahead) break;
      } else if (tm.length <= 28 && !/[。！？]/.test(lm) && lines.slice(m + 1, Math.min(limit, m + 3)).some(x => isSkillLine(x) || /\d*[dD]\d+/.test(x))) {
        bEnd = m;
      } else break;
    }
    if (bSkills < 1) return null;
    return { text: lines.slice(start, bEnd + 1).join('\n').trim(), skills: bSkills, endLine: bEnd };
  }
  /** 本文（1ページ分）から NPC ブロックを検出（CoC6/7・汎用向け）。戻り値：[{ text, name, score, line, endLine, inline, fromHead }] */
  function detectCocBlocks(text, N, opts) {
    const rawLines = NF(text).split('\n');
    const raw0 = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const lines = N && N.foldTables ? N.foldTables(rawLines.slice()) : rawLines;
    const orig = lines.length === raw0.length ? raw0 : null;
    const inlineOf = l => {
      const m = RE_INLINE.exec(l); if (!m) return null;
      const rawN = m[1].trim(), n = trimNm(rawN);
      if (!n || pairsOf(n).length || new RegExp('^(?:' + P_LABELS + ')(?![A-Za-z])', 'i').test(n) || /[。！？]/.test(n)) return null;
      if (RE_BAD_NAME_PREFIX.test(rawN) || badName(rawN)) return null;
      return m;
    };
    const info = lines.map((l, idx) => ({
      pairs: pairsOf(l), hasStr: RE_STR.test(l), skill: isSkillLine(l), skillHead: RE_SKILL_HEAD.test(l),
      inline: inlineOf(l), formHead: RE_FORM_HEAD.exec(l),
      bulletName: headNameOf(l, orig ? orig[idx] : null),
      term: isTerm(l), blank: !l.trim(), sep: RE_SEP.test(l)
    }));
    // ページ上部の有効な人名見出し（HEAD_SYM / HEAD_BRK）を記憶し、下方のステータスブロックへ引き継ぐ
    const actAt = new Array(lines.length).fill(null);
    let curAct = null;
    for (let i = 0; i < lines.length; i++) {
      if (info[i].bulletName) curAct = { name: info[i].bulletName, idx: i };
      actAt[i] = curAct;
    }
    // 1) パラメータ行のクラスタ化（インライン見出し・別STR行・NPC見出し・長文ルール解説・長い地の文で必ず分割）
    const clusters = []; let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const f = info[i];
      if (!f.pairs.length) continue;
      let split = !cur || i - cur.e - 1 > 3;
      if (!split && f.inline) split = true;
      if (!split && f.hasStr && cur.labels.has('STR')) split = true;
      if (!split) {
        for (let j = cur.e + 1; j < i; j++) {
          if (info[j].term || info[j].formHead || info[j].bulletName || lines[j].trim().length > 40) { split = true; break; }
        }
      }
      if (split) { cur = { s: i, e: i, labels: new Set(), inline: null, inlineAt: -1 }; clusters.push(cur); }
      cur.e = i; f.pairs.forEach(k => cur.labels.add(k));
      if (f.inline && cur.inlineAt < 0) { cur.inline = f.inline[1]; cur.inlineAt = i; }
    }
    // 2) 上下双方向に技能行を結合して範囲確定 → 右カラムの独立「技能」「武器」ブロックも合流 → 名前確定
    const out = []; let prevEnd = -1;
    const validClusters = [];
    clusters.forEach((c, ci) => {
      const nextStart = ci + 1 < clusters.length ? clusters[ci + 1].s : lines.length;
      let s = c.s, e = c.e, skills = 0;
      for (let j = c.s; j <= c.e; j++) if (info[j].skill) skills++;
      const upFloor = Math.max(prevEnd, c.s - 60);
      let j = c.s - 1, lastSk = -1;                                   // 上方向（チャパレ：名前→技能群→パラメータ）
      for (; j > upFloor; j--) {
        const f = info[j];
        if (f.term || f.formHead || f.bulletName || f.inline) break;
        if (f.skill || f.skillHead) { if (f.skill) skills++; lastSk = j; }
        else if (!(f.blank || f.sep)) break;
      }
      if (lastSk >= 0) s = lastSk;
      j = c.e + 1; let lastDn = -1;                                    // 下方向
      for (; j < nextStart && j <= c.e + 60; j++) {
        const f = info[j];
        if (f.term || f.inline || f.formHead || f.bulletName) break;
        if (f.skill) { lastDn = j; skills++; }
        else if (f.skillHead) { lastDn = j; }
        else if (/(?:ダメージ|ビルド|ダメボ|装甲|移動|DB)/.test(lines[j]) && /\d/.test(lines[j]) && lines[j].length <= 40) lastDn = j;
        else if (!(f.blank || f.sep)) {
          // 「透明な触手」のような短い武器小見出しの直後に技能/ダイス式が続く場合のみ許容
          const nxt = lines.slice(j + 1, Math.min(nextStart, j + 3)).some((nl, k) => info[j + 1 + k].skill || /\d*[dD]\d+/.test(nl));
          if (lines[j].trim().length <= 28 && !/[。！？]/.test(lines[j]) && nxt) lastDn = j;
          else break;
        }
      }
      if (lastDn >= 0) e = lastDn;
      if (!(c.labels.size >= 3 || (c.labels.size >= 2 && skills >= 1))) return;   // 数値付きパラメータが足りない文章・表は NPC ではない
      validClusters.push({ c, s, e, skills, nextStart });
      prevEnd = e;
    });

    prevEnd = -1;
    let lastUsedAct = null;
    const findHeadName = (s, floor, formAt, formLabel) => {
      const start = formAt >= 0 ? formAt - 1 : s - 1;
      const limit = formLabel ? 90 : 35;
      let hitTerm = false;
      for (let k = start, n = 0; k > floor && n < limit; k--) {
        const t = lines[k]; if (!t.trim() || info[k].sep) continue; n++;
        if (info[k].bulletName) {
          const bn = info[k].bulletName;
          return { name: formLabel ? bn + '（' + formLabel + '）' : bn, fromHead: true };
        }
        if (info[k].term) { hitTerm = true; break; }
        if (belowAttr(lines, k)) continue;
        if (badName(t) || proseLike(t)) continue;
        const lm = /^\s*(?:名前|氏名|NPC名|名称)\s*[:=]\s*(.+?)\s*$/.exec(t);
        let cand = trimNm(lm ? lm[1] : t);
        if (!cand || badName(cand) || proseLike(cand)) continue;
        if (orig && /＝/.test(orig[k])) cand = cand.replace(/=/g, '＝');
        return { name: formLabel ? cand + '（' + formLabel + '）' : cand, fromHead: false };
      }
      if (hitTerm) {
        for (let k = start, steps = 0; k > floor && steps < limit; k--) {
          if (!lines[k].trim() || info[k].sep) continue;
          steps++;
          if (info[k].bulletName) {
            const bn = info[k].bulletName;
            return { name: formLabel ? bn + '（' + formLabel + '）' : bn, fromHead: true };
          }
        }
      }
      return { name: '', fromHead: false };
    };

    // Phase 1: 各クラスタの名前・形態見出し・act 記憶を確定（先頭付近は prevPageTail 引き継ぎ）
    const recs = validClusters.map((vc, vi) => {
      const { c, s, e } = vc;
      const bodyLines = lines.slice(s, e + 1);
      let name = '', formLabel = '', usedAct = null, fromHead = false, inlineValid = false;
      if (c.inline) {
        const m = info[c.inlineAt].inline;
        name = trimNm(m[1]);
        if (orig && /＝/.test(orig[c.inlineAt])) name = name.replace(/=/g, '＝');
        if (c.inlineAt >= s && c.inlineAt <= e) inlineValid = !!name;
        else name = '';
        if (name) lastUsedAct = null;
      }
      if (!name) {
        const lab = bodyLines.map(l => /^\s*(?:名前|氏名|NPC名|名称)\s*[:=]\s*(.+?)\s*$/.exec(l)).find(Boolean);
        if (lab) {
          const cn = trimNm(lab[1]);
          if (cn && !badName(cn)) { name = cn; lastUsedAct = null; }
        }
      }
      if (!name) {
        // 直前の形態見出し（ステータス：通常時 / ステータス：本来の姿）を検出
        let formAt = -1;
        for (let k = s - 1, nb = 0; k > prevEnd && nb < 4; k--) {
          if (!lines[k].trim() || info[k].sep) continue;
          nb++;
          if (info[k].formHead) { formAt = k; formLabel = info[k].formHead[1].trim(); break; }
          break;
        }
        // インライン名が無ければ、上方の人物見出し記憶（actAt）を最優先で結合採用（途中の長いプロフィール文を飛び越える）
        const act = actAt[formAt >= 0 ? formAt : s];
        if (act && (act.idx > prevEnd || (formLabel && lastUsedAct === act))) {
          name = formLabel ? act.name + '（' + formLabel + '）' : act.name;
          lastUsedAct = act; usedAct = act; fromHead = true;
        }
        if (!name) {
          const fh = findHeadName(s, prevEnd, formAt, formLabel);
          if (fh.name) {
            name = fh.name;
            fromHead = fh.fromHead;
            lastUsedAct = null;
          }
        }
        // 直前ステータスとの間に別キャラ名や有効な見出しが無く、同一ページの人物見出し（actAt）が継続していれば引き継ぐ（例：■本編での立ち回り下の再掲ステータス）
        if (!name && act && lastUsedAct === act) {
          name = formLabel ? act.name + '（' + formLabel + '）' : act.name;
          lastUsedAct = act; usedAct = act; fromHead = true;
        }
        // ページ先頭付近で同ページ内に見出しが無い場合は、前ページ末尾（prevPageTail）から引き継ぐ
        if (!name && vi === 0 && opts && opts.prevPageTail && (s <= 3 || (s <= 6 && lines.slice(0, s).filter(l => l.trim()).length <= 2))) {
          const tailHit = findPrevPageTailName(opts.prevPageTail, formLabel);
          if (tailHit) {
            name = tailHit.name;
            fromHead = tailHit.fromHead;
            if (!formLabel && tailHit.formLabel) formLabel = tailHit.formLabel;
            lastUsedAct = { name: tailHit.baseName, idx: -1, fromPrevPage: true };
            usedAct = lastUsedAct;
          }
        }
        // 前ページ末尾から引き継いだキャラの2つ目以降の形態見出しも継続
        if (!name && !act && formLabel && lastUsedAct && lastUsedAct.fromPrevPage) {
          name = lastUsedAct.name + '（' + formLabel + '）';
          usedAct = lastUsedAct; fromHead = true;
        }
      }
      prevEnd = e;
      return { vc, vi, c, s, e, endLine: e, skills: vc.skills, bodyLines, name, formLabel, usedAct, fromHead, inline: inlineValid };
    });

    // Phase 2: 同一キャラクターの連続クラスタ（複数形態）をまとめ、右カラムの独立技能・武器ブロックを全形態へ合流
    const isSkillSectionBoundary = line => {
      const t = NF(line || '').trim();
      if (!t) return false;
      if (/《[^》]*ルール[^》]*》/.test(t)) return true;
      const body = trimNm(t).replace(/^[【\[]+|[】\]]+$/g, '').trim();
      return (HEAD_SYM.test(t) || HEAD_BRK.test(t)) && (RE_SECTION_HEAD.test(body) || RE_TIMING_HEAD.test(body));
    };
    const mergeSkillRange = (scanStart, scanLimit, targetGroup) => {
      const hasSkillContinuationAhead = (fromIdx, maxBridgeLines) => {
        let bridge = 0, blanks = 0;
        for (let p = fromIdx; p < scanLimit; p++) {
          const fp = info[p], lp = lines[p];
          const subP = targetGroup.length >= 2 && isFormSubheadOfGroup(lp, targetGroup);
          if (fp.pairs.length || fp.formHead || fp.inline || isSkillSectionBoundary(lp)) return false;
          if (fp.bulletName && !subP) return false;
          if (fp.skill) return true;
          if (fp.skillHead || subP) {
            for (let q = p + 1, qb = 0; q < scanLimit && qb <= 3; q++) {
              const fq = info[q], lq = lines[q];
              const subQ = targetGroup.length >= 2 && isFormSubheadOfGroup(lq, targetGroup);
              if (fq.pairs.length || fq.formHead || fq.inline || isSkillSectionBoundary(lq)) break;
              if (fq.bulletName && !subQ) break;
              if (fq.skill || fq.skillHead || subQ) return true;
              if (!fq.blank && !fq.sep) {
                const tq = lq.trim();
                if (fq.term || /。/.test(tq) || tq.length > 35) break;
                qb++;
              }
            }
            return false;
          }
          if (fp.blank || fp.sep) {
            blanks++;
            if (blanks > 2) return false;
            continue;
          }
          const tp = lp.trim();
          if (fp.term || /。/.test(tp) || tp.length > 35) return false;
          bridge++;
          if (bridge > maxBridgeLines) return false;
        }
        return false;
      };

      let extraEnd = scanStart - 1;
      for (let k = scanStart; k < scanLimit; k++) {
        const f = info[k];
        const isStartSub = targetGroup.length >= 2 && isFormSubheadOfGroup(lines[k], targetGroup) &&
          hasSkillContinuationAhead(k + 1, 5);
        if (!(f.skillHead || f.skill || isStartSub)) continue;

        const segments = [];
        const initTargets = (targetGroup.length >= 2 && (f.skillHead || isStartSub))
          ? (matchFormTargets(lines[k], targetGroup) || targetGroup)
          : targetGroup;
        let curSeg = { start: k, end: k, skills: f.skill ? 1 : 0, targets: initTargets };
        let bEnd = k;

        const flushSeg = () => {
          if (curSeg && curSeg.skills >= 1) segments.push(curSeg);
        };

        for (let m = k + 1; m < scanLimit; m++) {
          const fm = info[m];
          const isSub = targetGroup.length >= 2 && isFormSubheadOfGroup(lines[m], targetGroup);
          if (fm.pairs.length || fm.formHead || fm.inline || isSkillSectionBoundary(lines[m])) break;
          if (fm.bulletName && !isSub) break;

          if (fm.skillHead || isSub) {
            const nextTargets = targetGroup.length >= 2
              ? (matchFormTargets(lines[m], targetGroup) || curSeg.targets)
              : targetGroup;
            if (curSeg.skills >= 1) {
              flushSeg();
              curSeg = { start: m, end: m, skills: 0, targets: nextTargets };
            } else {
              // 直前が「技能」だけの空見出しなら、形態サブ見出しのターゲットへ切り替え
              curSeg.targets = nextTargets;
              curSeg.end = m;
            }
            bEnd = m;
          } else if (fm.skill) {
            curSeg.end = m; curSeg.skills++; bEnd = m;
          } else if (/(?:ダメージ|DMG|1D\d|\d+D\d)/i.test(lines[m]) && lines[m].trim().length <= 45) {
            curSeg.end = m; bEnd = m;
          } else if (fm.blank || fm.sep) {
            if (!hasSkillContinuationAhead(m + 1, 5)) break;
          } else if (hasSkillContinuationAhead(m, 5)) {
            curSeg.end = m; bEnd = m;
          } else if (!fm.term && lines[m].trim().length <= 28 && !/[。！？]/.test(lines[m]) &&
            info.slice(m + 1, Math.min(scanLimit, m + 3)).some((x, off) => x.skill || /\d*[dD]\d+/.test(lines[m + 1 + off]))) {
            curSeg.end = m; bEnd = m;
          } else {
            break;
          }
        }
        flushSeg();
        if (segments.length) {
          segments.forEach(seg => {
            const segLines = lines.slice(seg.start, seg.end + 1);
            seg.targets.forEach(tRec => {
              tRec.bodyLines.push(...segLines);
              tRec.skills += seg.skills;
            });
            if (seg.end > extraEnd) extraEnd = seg.end;
          });
          k = bEnd;
        }
      }
      return extraEnd;
    };

    const charGroups = [];
    recs.forEach(rec => {
      const prevGrp = charGroups.length ? charGroups[charGroups.length - 1] : null;
      const prevRec = prevGrp ? prevGrp[prevGrp.length - 1] : null;
      let sameChar = false;
      if (prevRec) {
        if (prevRec.usedAct && rec.usedAct && prevRec.usedAct === rec.usedAct) {
          sameChar = true;
        } else if ((prevRec.formLabel || rec.formLabel) && prevRec.name && rec.name) {
          const pb = nameKey(baseOf(prevRec.name)), cb = nameKey(baseOf(rec.name));
          if (pb && pb === cb) {
            const hasNewBullet = info.slice(prevRec.e + 1, rec.s).some(x => x.bulletName);
            if (!hasNewBullet) sameChar = true;
          }
        }
      }
      if (sameChar) prevGrp.push(rec);
      else charGroups.push([rec]);
    });

    charGroups.forEach(group => {
      const lastRec = group[group.length - 1];
      const nextRec = lastRec.vi + 1 < recs.length ? recs[lastRec.vi + 1] : null;
      const nextBoundary = nextRec ? nextRec.s : lines.length;

      // 複数形態グループの中間クラスタ直後にある専属技能ブロックがあれば当該形態のみへ合流
      for (let gi = 0; gi < group.length - 1; gi++) {
        const curRec = group[gi], nxtRec = group[gi + 1];
        let midLimit = nxtRec.s;
        for (let k = curRec.e + 1; k < nxtRec.s; k++) {
          if (info[k].bulletName || info[k].formHead || info[k].inline) { midLimit = k; break; }
        }
        const midEnd = mergeSkillRange(curRec.e + 1, midLimit, [curRec]);
        if (midEnd > curRec.endLine) curRec.endLine = midEnd;
      }

      // 複数形態グループの末尾クラスタが直下の「技能：通常時 or 本来の姿」等を lastDn で取り込んでいた場合は、見出し位置から全形態へ再配分する
      let scanStart = lastRec.e + 1;
      if (group.length >= 2 && lastRec.e > lastRec.c.e) {
        let splitAt = -1;
        for (let j = lastRec.c.e + 1; j <= lastRec.e; j++) {
          if (info[j].skillHead || isFormSubheadOfGroup(lines[j], group)) { splitAt = j; break; }
        }
        if (splitAt > lastRec.c.e) {
          let trimEnd = splitAt - 1;
          while (trimEnd > lastRec.c.e && (!lines[trimEnd].trim() || info[trimEnd].sep)) trimEnd--;
          lastRec.bodyLines = lines.slice(lastRec.s, trimEnd + 1);
          let keptSkills = 0;
          for (let j = lastRec.s; j <= trimEnd; j++) if (info[j].skill) keptSkills++;
          lastRec.skills = keptSkills;
          lastRec.e = trimEnd;
          lastRec.endLine = trimEnd;
          scanStart = splitAt;
        }
      }

      let scanLimit = nextBoundary;
      for (let k = scanStart; k < nextBoundary; k++) {
        if (info[k].inline || info[k].formHead) { scanLimit = k; break; }
        if (info[k].bulletName && !(group.length >= 2 && isFormSubheadOfGroup(lines[k], group))) {
          scanLimit = k; break;
        }
      }
      const grpEnd = mergeSkillRange(scanStart, scanLimit, group);
      if (grpEnd > lastRec.endLine) lastRec.endLine = grpEnd;
    });

    recs.forEach(rec => {
      if (rec.inline && rec.c.inlineAt >= rec.s && rec.c.inlineAt <= rec.e) {
        const ln = lines[rec.c.inlineAt], m = info[rec.c.inlineAt].inline;
        rec.bodyLines[rec.c.inlineAt - rec.s] = ln.slice(m[0].length);
        rec.bodyLines.unshift('名前: ' + rec.name);
      } else if (rec.name && !rec.bodyLines.some(l => /^\s*(?:名前|氏名|NPC名|名称)\s*[:=]/.test(l))) {
        rec.bodyLines.unshift('名前: ' + rec.name);
      }
      out.push({
        text: rec.bodyLines.join('\n').trim(),
        name: rec.name,
        score: rec.c.labels.size + rec.skills,
        line: rec.s,
        endLine: rec.endLine,
        inline: !!rec.inline,
        fromHead: !!rec.fromHead
      });
    });
    return out;
  }
  const DIFF_WORD = '(?:立ち絵|立絵|差分|表情|通常(?:顔|時)?|普通|基本|デフォルト|default|normal|base|笑(?:顔|い|う)?|微笑(?:み|む)?|ほほ笑[みむ]?|にっこり|ニッコリ|ニヤリ|にやり|ニタリ|怒鳴[りる]?|怒[りる]?|激怒|叫[びぶ]?|絶叫|悲鳴|呟[きく]?|囁[きく]?|泣[きく]?|号泣|嗚咽|涙目|涙|驚[きく]?|びっくり|ビックリ|困[りる]?|困惑|戸惑[いう]?|悩[みむ]?|考え[る]?|思考|放心|虚ろ|うつろ|沈黙|悲し[みむい]?|哀|喜[びぶ]?|楽し[みむい]|楽|照れる?|赤面|恥ずかし[い]?|デレ顔?|真顔|無表情|苦笑い?|冷笑|呆れる?|怯える?|焦燥|焦[りる]?|緊張|警戒|睨[みむ]?|威嚇|殺気|錯乱|嘆[きく]?|悔し[みむい]?|絶望|不敵|真剣|疑問|目閉じ|閉目|目瞑り|ウインク|ウィンク|眠[りる]?|寝顔|睡眠|気絶|ぐったり|疲弊|冷や汗|汗|傷|負傷|血まみれ|返り血|血|流血|ボロボロ|ダメージ|ダウン|病み|闇堕ち|闇|黒化|狂(?:気|う)?|発狂|覚醒|変身|戦闘|バトル|衣装差分|服装差分|私服|制服|スーツ|衣装|服装|smile|happy|laugh|angry|anger|crying|cry|surprised?|shock|troubled?|sad|blush|shy|serious|wink|shout|scream|yell|sigh|sleeping|sleep|pain|damage|ver\\.?\\d*(?:\\.\\d+)*|v\\d+)';
  const DIFF_ATOM_RE = new RegExp('^(?:' + DIFF_WORD + '|\\d+)', 'i');
  function isDiffOnlyStem(stem) {
    const s = NF(stem).trim();
    if (!s) return true;
    const parts = s.split(/[\s_\-・/()[\]【】]+/).filter(Boolean);
    if (!parts.length) return true;
    return parts.every(part => {
      let rest = part;
      while (rest.length) {
        const m = DIFF_ATOM_RE.exec(rest);
        if (!m || !m[0]) return false;
        rest = rest.slice(m[0].length);
        if (rest && /^[A-Za-z](?:$|\d)/.test(rest) && !/^\d/.test(m[0])) {
          rest = rest.slice(1);
        }
      }
      return true;
    });
  }
  const GENERIC_DIR_WORD = '(?:NPCs?|KPCs?|PCs?|HO\\d*|handout|ハンドアウト|立ち絵|立絵|tachie|キャラクター|キャラ|chara|characters?|人物|登場人物|登場NPC|画像|イメージ|images?|imgs?|pics?|pictures?|arts?|イラスト|illust(?:rations?)?|配布素材|フリー素材|部屋素材|ルーム素材|素材集?|assets?|差分|表情|diff|diffs|faces?|expressions?|room|部屋|装飾|小物|アイテム|items?|アイコン|icons?|コマ|駒|tokens?|背景|bgs?|backgrounds?|前景|fgs?|foreground|スチル|still|イベントcg|cg|カットイン|cutin|マップ|maps?|地図|見取り図|トレーラー|trailer|サムネイル?|thumbnail|表紙|cover|ロゴ|logo|ui|未分類|その他|misc|others?|none|unclassified|default|temp|tmp|backup|旧素材|旧|差替前|シナリオ|scenario|本編|本文|資料|データ|data|docs?|pdfs?|bgm|se|audio|sounds?|音声|音楽|効果音|動画|videos?|movies?|downloads?|ダウンロード|desktop|documents|マイドライブ|google\\s*drive|gdrive|users)';
  const GENERIC_DIR_ATOM_RE = new RegExp('^(?:' + GENERIC_DIR_WORD + '|\\d+)', 'i');
  function isGenericDirName(dir) {
    const s = NF(dir).trim();
    if (!s) return true;
    const parts = s.split(/[\s_\-・/()[\]【】]+/).filter(Boolean);
    if (!parts.length) return true;
    return parts.every(part => {
      let rest = part;
      while (rest.length) {
        const m = GENERIC_DIR_ATOM_RE.exec(rest);
        if (!m || !m[0]) return false;
        rest = rest.slice(m[0].length);
      }
      return true;
    });
  }
  const GENERIC_ROLE_WORDS = [
    '男性?', '女性?', '少年', '少女', '青年', '中年', '老人', '老婆', '子供', '子ども', '幼児', '赤ん坊',
    '父親?', '母親?', '兄', '姉', '弟', '妹', '家族', '夫婦', '双子',
    '研究者', '研究員', '博士', '教授', '助手',
    '医者', '医師', '看護師', '患者',
    '警官', '警察官?', '刑事', '探偵', '弁護士', '検事', '裁判官',
    '記者', '作家', '編集者',
    '教師', '先生', '生徒', '学生', '司書',
    '神父', '牧師', '司祭', '巫女', '僧侶',
    '店員', '店主', 'マスター', 'バーテンダー', 'シェフ', '料理人', '執事', 'メイド', '使用人',
    '運転手', '車掌', '船長', 'パイロット',
    '兵士', '軍人', '衛兵', '警備員', '護衛',
    '村人', '町人', '住民', '市民', '通行人', '群衆', 'モブ',
    '顧客', '客', '依頼人', '被害者', '容疑者', '犯人', '目撃者',
    '信者', '教祖', '幹部', '部下', '上司', '社長', '秘書', '政治家', '貴族',
    '女王', '王子', '王', '姫', '騎士', '冒険者', '探索者',
    '怪物', '化け物', '神話生物', '幽霊', '霊', '影', '黒幕',
    '謎の(?:人物|男性?|女性?|少年|少女|青年|老人|老婆)', '正体不明', 'シルエット',
    'NPC', 'KPC', 'PC', 'HO'
  ];
  const GENERIC_ROLE_RE = new RegExp('^(?:' + GENERIC_ROLE_WORDS.join('|') + ')(?:[_\\-\\s]*(?:\\d+[A-Za-z]?|[A-Za-z]\\d*))?$', 'i');
  function isGenericRoleName(name) {
    const s = NF(name).trim();
    return !!s && GENERIC_ROLE_RE.test(s);
  }
  const normCmpKey = s => NF(s).toLowerCase().replace(/[\s_\-・()[\]【】「」『』]+/g, '');
  function getScenarioNames(opts) {
    const out = [];
    const push = v => { if (typeof v === 'string' && v.trim()) out.push(v.trim()); };
    if (opts && opts.scenarioName) {
      if (Array.isArray(opts.scenarioName)) opts.scenarioName.forEach(push);
      else push(opts.scenarioName);
    }
    if (opts && Array.isArray(opts.excludeNames)) opts.excludeNames.forEach(push);
    try {
      if (typeof window !== 'undefined' && window.CCF) {
        const ccf = window.CCF;
        if (ccf.S) {
          if (ccf.S.proj && ccf.S.proj.title) push(ccf.S.proj.title);
          if (typeof ccf.scenarioList === 'function') {
            const sc = (ccf.scenarioList() || []).find(x => String(x.id) === String(ccf.S.key));
            if (sc) {
              push(sc.title); push(sc.name); push(sc.folder);
              if (sc.rel) push(String(sc.rel).split(/[\\/]/).pop());
            }
          }
        }
      }
    } catch (_) { /* noop */ }
    return out;
  }
  function isValidParentCharName(parent, opts) {
    const p = NF(parent).trim();
    if (p.length < 2) return false;
    if (/^[a-z]:$/i.test(p) || /^[a-f0-9]{16,}$/i.test(p) || /^\d+$/.test(p)) return false;
    if (isDiffOnlyStem(p) || isGenericDirName(p) || isGenericRoleName(p)) return false;
    const pk = normCmpKey(p);
    if (!pk) return false;
    const scNames = getScenarioNames(opts);
    if (scNames.some(sn => normCmpKey(sn) === pk)) return false;
    return true;
  }
  /** 立ち絵ファイル名 → { baseName, diffLabel }（末尾の表情差分サフィックス・(1) 等を除去してベースキャラ名と差分名に分離） */
  function splitImageName(file, opts) {
    const parts = String(file || '').split(/[\\/]/);
    const filePart = parts.pop() || '';
    const parentRaw = parts.length ? parts[parts.length - 1] : '';
    const origStem = NF(filePart.replace(/\.[^.]+$/, '')).trim();
    const fallbackParent = () => (parentRaw && !/^(?:cloud-asset|asset):$/i.test(parentRaw) && isValidParentCharName(parentRaw, opts))
      ? NF(parentRaw).trim()
      : '';

    if (isDiffOnlyStem(origStem)) {
      return { baseName: fallbackParent(), diffLabel: origStem || '通常' };
    }

    let b = origStem.replace(/^(?:立ち絵|立絵)[_\-\s]+/, '');
    const labels = [];
    for (let guard = 0; guard < 6; guard++) {
      let m;
      if ((m = new RegExp('^(.+?)[_\\-\\s]+(' + DIFF_WORD + '(?:\\d+)?|\\d+)$', 'i').exec(b))) {
        labels.unshift(m[2]); b = m[1].trim(); continue;
      }
      if ((m = new RegExp('^(.+?)\\s*\\((' + DIFF_WORD + '\\d*|\\d+)\\)$', 'i').exec(b))) {
        labels.unshift(m[2]); b = m[1].trim(); continue;
      }
      if ((m = /^(.+?)(立ち絵|立絵|差分\d*)$/.exec(b)) && m[1].trim().length >= 2) {
        labels.unshift(m[2]); b = m[1].trim(); continue;
      }
      break;
    }
    b = b.replace(/[_\-\s]+$/, '').trim();
    if (!b || b.length < 2 || isDiffOnlyStem(b)) {
      return { baseName: fallbackParent(), diffLabel: origStem || (labels.length ? labels.join('_') : '通常') };
    }
    return { baseName: b, diffLabel: labels.length ? labels.join('_') : '通常' };
  }
  /** 立ち絵ファイル名 → キャラ名（「織田作之助_笑顔.png」→「織田作之助」、「氷鞠_差分1.png」→「氷鞠」、「キャラ名(1).png」→「キャラ名」） */
  function nameFromImageFile(file, opts) {
    return splitImageName(file, opts).baseName;
  }
  const sortDiffFiles = (files, opts) => files.slice().sort((a, b) => {
    const da = splitImageName(a, opts).diffLabel, db = splitImageName(b, opts).diffLabel;
    const isNorm = l => /^(?:(?:立ち絵|立絵|差分)[_\-\s]*)?(?:通常(?:顔|時)?|基本|普通|normal|default|base)(?:[_\-\s]*\d+)?$/i.test(l);
    return (isNorm(db) ? 1 : 0) - (isNorm(da) ? 1 : 0) || a.localeCompare(b, 'ja', { numeric: true });
  });
  /** 本文中に登場する立ち絵キャラ名を拾う。files: 画像パス配列 → [{ name, files:[], count }]（出現数順）。 */
  function detectPortraitNpcs(text, files, opts) {
    const t = NF(text).replace(/\s+/g, ''), map = new Map();
    const allowGenericRole = !!(opts && opts.allowGenericRole);
    (files || []).forEach(f => {
      const n = nameFromImageFile(f, opts);
      if (!n) return;
      if (!allowGenericRole && isGenericRoleName(n)) return;
      if (!map.has(n)) map.set(n, { name: n, files: [] });
      map.get(n).files.push(f);
    });
    return [...map.values()].map(o => {
      o.files = sortDiffFiles(o.files, opts);
      const k = NF(o.name).replace(/\s+/g, ''); let c = 0, at = -1; while ((at = t.indexOf(k, at + 1)) >= 0) c++; return Object.assign(o, { count: c });
    }).filter(o => o.count > 0).sort((a, b) => b.count - a.count);
  }
  const READING_RE = /([^)）\s])\s*[(（][ぁ-んァ-ヶー・\s]+[)）]/g;
  const HAS_READING_RE = /([^)）\s])\s*[(（][ぁ-んァ-ヶー・\s]+[)）]/;
  const nameKey = n => String(n == null ? '' : n).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  // 「氷鞠(ヒマリ)（通常時）」→「氷鞠通常時」、「一式 若葉(イッシキ ワカバ)」→「一式若葉」で完全一致させる
  const cmpName = n => String(trimName(n)).normalize('NFKC').replace(READING_RE, '$1').replace(/[()（）\[\]【】「」『』\s・＝=]/g, '').toLowerCase();
  const formOf = n => { const m = /[（(]([^）)]*)[）)]\s*$/.exec(String(trimName(n)).normalize('NFKC').replace(READING_RE, '$1')); return m ? nameKey(m[1]) : ''; };
  const baseOf = n => { let t = String(trimName(n)).normalize('NFKC').replace(READING_RE, '$1'); for (let k = 0; k < 3; k++) t = t.replace(/\s*[（(][^）)]*[）)]\s*$/, ''); return t.trim(); };
  const isSimple = c => !(c.skills || []).length || (c.status || []).length + (c.params || []).length <= 4;

  function buildSig(r, parseFn) {
    if (r.noStats) return { sig: new Map(), np: 0, ns: 0, nk: 0, rich: (r.portraits || []).length, simple: true, solid: false };
    let d = null;
    try { d = parseFn ? parseFn(r.text) : null; } catch (e) { /* noop */ }
    const sig = new Map(); let np = 0, ns = 0, nk = 0;
    if (d) {
      (d.params || []).forEach(p => { const v = String(p.value == null ? '' : p.value).trim(); if (/^[+-]?\d+$/.test(v)) { np++; sig.set('p:' + p.label, v); } });
      (d.status || []).forEach(p => { if (p.label && (+p.value || +p.max)) { ns++; sig.set('s:' + p.label, p.value + '/' + p.max); } });
      (d.skills || []).forEach(k => { if (k.name && k.value !== '' && k.value != null) { nk++; sig.set('k:' + k.name, String(k.value)); } });
    }
    const rich = np * 3 + ns * 4 + nk * 2 + (r.portraits ? r.portraits.length : 0);
    return { sig, np, ns, nk, rich, simple: !d || isSimple(d), solid: np + ns >= 2 };
  }

  /** 一括スキャン候補の統合（必ず autoFillStats 前に実行）：
   *  (1) cmpName 一致を richOf 最大側へ合体し、(2) 簡易再掲データ（isSimple）等をフルネーム側へ吸収、
   *  (3) 複数資料横断等で名前が不完全・異なっても能力値・ステータス・技能 sig が3項目以上かつ100%完全一致する候補を正規名側へ統合 */
  function mergeSameResults(results, parseFn) {
    const cloned = (results || []).map((r, idx) => Object.assign({ r: Object.assign({}, r), idx }, buildSig(r, parseFn)));
    const groups = new Map(), order = [];
    cloned.forEach(it => {
      const ck = cmpName(it.r.name);
      if (!ck || ck === '名称未設定npc' || ck === '新しいnpc') { order.push({ it }); return; }
      if (!groups.has(ck)) { const g = { list: [] }; groups.set(ck, g); order.push({ g }); }
      groups.get(ck).list.push(it);
    });
    const conflicts = (a, b) => { let c = 0; a.sig.forEach((v, k) => { if (b.sig.has(k) && b.sig.get(k) !== v) c++; }); return c; };
    let merged = 0;
    const absorb = (base, it) => {
      merged++;
      if (it.r.portraits && it.r.portraits.length) {
        base.r.portraits = sortDiffFiles([...new Set([...(base.r.portraits || []), ...it.r.portraits])]);
      }
      base.r.mergedParts = base.r.mergedParts ? base.r.mergedParts.slice() : [];
      base.r.mergedParts.push({ pdf: it.r.pdf, path: it.r.path, page: it.r.page, text: it.r.text, noStats: !!it.r.noStats });
      if (Array.isArray(it.r.mergedParts)) it.r.mergedParts.forEach(mp => base.r.mergedParts.push(mp));
      if (it.r.text && it.r.text.trim() && it.r.text.trim() !== String(base.r.text || '').trim()) {
        base.r.extra = (base.r.extra || '') + '\n\n--- 別ページ (p.' + it.r.page + ') の記述 ---\n' + it.r.text;
      }
      if (it.r.extra) base.r.extra = (base.r.extra || '') + it.r.extra;
    };
    const step1 = [];
    order.forEach(o => {
      if (o.it) { step1.push(o.it); return; }
      const items = o.g.list;
      if (items.length === 1) { step1.push(items[0]); return; }
      items.sort((a, b) => b.rich - a.rich || (a.r.noStats ? 1 : 0) - (b.r.noStats ? 1 : 0) || a.r.page - b.r.page || a.idx - b.idx);
      const kept = [];
      items.forEach(it => {
        const base = kept.find(k =>
          k.simple || it.simple ||
          (!formOf(k.r.name) && !formOf(it.r.name)) ||
          !(k.solid && it.solid && conflicts(k, it) > 0)
        );
        if (!base) { kept.push(it); return; }
        absorb(base, it);
      });
      if (kept.length > 1) {
        kept.sort((a, b) => a.r.page - b.r.page || a.idx - b.idx);
        const used = new Map();
        kept.forEach(k => { let lab = (k.r.name || '').trim() + ' (p.' + k.r.page + ')'; const n = (used.get(lab) || 0) + 1; used.set(lab, n); if (n > 1) lab += ' #' + n; k.r.name = lab; });
      }
      kept.forEach(k => step1.push(k));
    });
    step1.sort((a, b) => a.idx - b.idx);
    const absorbed = new Set();
    step1.forEach(sm => {
      if (absorbed.has(sm)) return;
      const ck = cmpName(sm.r.name);
      if (!ck || ck === '名称未設定npc' || ck === '新しいnpc') return;
      const sb = baseOf(sm.r.name), sk = nameKey(sb), sf = formOf(sm.r.name);
      if (sk.length < 2) return;
      const cands = step1.filter(o => {
        if (o === sm || absorbed.has(o)) return false;
        const ob = baseOf(o.r.name), ok = nameKey(ob), of = formOf(o.r.name);
        if (ok.length <= sk.length) return false;
        if (sf && of && sf !== of) return false;
        const toks = ob.normalize('NFKC').trim().split(/\s+/).map(nameKey).filter(t => t.length >= 2);
        if (!(toks.includes(sk) || ok.startsWith(sk) || ok.endsWith(sk))) return false;
        const canAbsorb = sm.simple || (HAS_READING_RE.test(o.r.name) && !sf && !of && conflicts(o, sm) === 0 && o.rich > sm.rich);
        if (!canAbsorb) return false;
        return !o.simple || o.rich > sm.rich || (o.rich === sm.rich && o.idx < sm.idx);
      });
      if (!cands.length) return;
      cands.sort((a, b) => (a.simple ? 1 : 0) - (b.simple ? 1 : 0) || a.idx - b.idx || b.rich - a.rich);
      absorb(cands[0], sm);
      absorbed.add(sm);
    });
    // Step 3: 能力値・ステータス・技能シグネチャ（sig）が3項目以上かつ100%完全一致（conflicts === 0 && np + ns >= 3）の候補を正規名側へ自動統合
    const step2 = step1.filter(x => !absorbed.has(x));
    const nameQuality = it => {
      const raw = String(it.r.name || '').trim();
      const ck = cmpName(raw);
      if (!ck || ck === '名称未設定npc' || ck === '新しいnpc' || badName(raw)) return 0;
      const b = baseOf(raw);
      if (!b || badName(b) || isGenericRoleName(b)) return 1;
      let q = 10;
      if (HAS_READING_RE.test(raw)) q += 6;
      if (it.r.fromHead) q += 4;
      if (formOf(raw)) q += 2;
      if (/\s/.test(b) || b.length >= 4) q += 2;
      q += Math.min(b.length, 15) * 0.1;
      return q;
    };
    const exactSigMatch = (a, b) => {
      if (a.r.noStats || b.r.noStats) return false;
      if (a.np + a.ns < 3 || b.np + b.ns < 3) return false;
      if (a.sig.size < 3 || b.sig.size < 3) return false;
      if (conflicts(a, b) > 0) return false;
      const small = a.sig.size <= b.sig.size ? a : b;
      const large = small === a ? b : a;
      let shared = 0, sharedCore = 0;
      small.sig.forEach((v, k) => {
        if (large.sig.has(k) && large.sig.get(k) === v) {
          shared++;
          if (k.startsWith('p:') || k.startsWith('s:')) sharedCore++;
        }
      });
      return shared === small.sig.size && shared >= 3 && sharedCore >= 3;
    };
    const isSameDoc = (a, b) => {
      const pa = a.r.path || a.r.pdf || '', pb = b.r.path || b.r.pdf || '';
      return !!(pa && pb && pa === pb);
    };
    const isNumberedPair = (a, b) => {
      const ka = cmpName(baseOf(a.r.name)), kb = cmpName(baseOf(b.r.name));
      if (!ka || !kb || ka === kb) return false;
      const ma = /^(.+?)([0-9a-z])$/.exec(ka), mb = /^(.+?)([0-9a-z])$/.exec(kb);
      return !!(ma && mb && ma[1].length >= 2 && ma[1] === mb[1] && ma[2] !== mb[2]);
    };
    const ranked = step2.slice().sort((a, b) =>
      nameQuality(b) - nameQuality(a) || b.rich - a.rich || (a.r.noStats ? 1 : 0) - (b.r.noStats ? 1 : 0) || a.idx - b.idx
    );
    const kept3 = [];
    ranked.forEach(it => {
      const base = kept3.find(k => {
        if (!exactSigMatch(k, it)) return false;
        const fk = formOf(k.r.name), fi = formOf(it.r.name);
        if (fk && fi && fk !== fi) return false;
        if (isSameDoc(k, it) && isNumberedPair(k, it)) return false;
        return true;
      });
      if (!base) { kept3.push(it); return; }
      absorb(base, it);
    });
    kept3.sort((a, b) => a.idx - b.idx);
    return { results: kept3.map(x => x.r), merged };
  }

  function detectNpcBlocks(text, sysId, N, opts) {
    const NON_COC = ['sw25', 'dx3', 'emoklore', 'twod6', 'futari', 'stratera', 'madamis'];
    return NON_COC.includes(sysId) ? detectLegacy(text, sysId, N) : detectCocBlocks(text, N, opts);
  }
  function createPageScanner(sysId, N) {
    const NON_COC = ['sw25', 'dx3', 'emoklore', 'twod6', 'futari', 'stratera', 'madamis'];
    const isCoc = !NON_COC.includes(sysId);
    let prevPageTail = [];
    let prevLastResult = null;
    let prevTailHasStats = false;
    return {
      reset() { prevPageTail = []; prevLastResult = null; prevTailHasStats = false; },
      step(text, onBlock) {
        const blocks = detectNpcBlocks(text, sysId, N, isCoc ? { prevPageTail } : null);
        if (isCoc && prevLastResult && prevTailHasStats) {
          const firstLine = blocks.length ? blocks[0].line : -1;
          const ov = extractLeadingSkillOverflow(text, N, firstLine);
          if (ov && ov.text && !String(prevLastResult.text || '').includes(ov.text)) {
            prevLastResult.text = String(prevLastResult.text || '').trimEnd() + '\n' + ov.text;
            prevLastResult.score = (prevLastResult.score || 0) + ov.skills;
          }
        }
        let lastRes = null;
        blocks.forEach(b => {
          const r = onBlock(b);
          if (r) lastRes = r;
        });
        if (isCoc) {
          const tailInfo = extractPageTailInfo(text, N, blocks);
          prevPageTail = tailInfo.tailLines;
          prevLastResult = lastRes;
          prevTailHasStats = !!(lastRes && tailInfo.endsWithStats);
        }
        return blocks;
      }
    };
  }
  function scanPagesForNpcBlocks(pages, sysId, N) {
    const out = [];
    const scanner = createPageScanner(sysId, N);
    (pages || []).forEach((pg, idx) => {
      const pageNum = (pg && typeof pg === 'object' && pg.page != null) ? pg.page : (idx + 1);
      const text = (pg && typeof pg === 'object') ? (pg.text || '') : String(pg || '');
      scanner.step(text, b => {
        const rec = { page: pageNum, name: b.name, text: b.text, score: b.score, line: b.line, endLine: b.endLine, inline: !!b.inline, fromHead: !!b.fromHead };
        out.push(rec);
        return rec;
      });
    });
    return out;
  }

  const api = { pickMainPdf, pickTitleFromItems, isBoilerTitle, extractSpec, mergeSpecs, grabSynopsis, decodeTextBytes, cleanExtractedText, isMojibakeText, isValidSynopsisText, classifySynopsisDocs, detectNpcBlocks, detectCocBlocks, extractPageTailInfo, extractLeadingSkillOverflow, scanPagesForNpcBlocks, detectPortraitNpcs, nameFromImageFile, splitImageName, isGenericRoleName, badName, trimName, proseLike, belowAttr, cmpName, formOf, baseOf, isSimple, mergeSameResults, SYS_KEYS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || !window.CCF || typeof document === 'undefined') return;

  // ======================================================================
  // 以下はアプリ内（Electron）専用：pdfjs ヘルパと NPC 一括スキャン UI
  // ======================================================================
  const CCF = window.CCF, T = window.CCFText, N = window.CCFNpc, M = window.CCFModel, Sys = window.CCFSys, { $, esc, say, S } = CCF;
  const fsx = window.require ? require('fs') : null, pathx = window.require ? require('path') : null;
  const furl = p => require('url').pathToFileURL(p).href;
  const isAssetRef = p => !!(window.WebBridge && WebBridge.isAssetRef(p));
  const scanBaseName = p => isAssetRef(p) ? WebBridge.assetBasename(p) : (pathx ? pathx.basename(p) : String(p || '').split(/[\\/]/).pop());

  /** PDF を開く（pdfjs-dist / ブラウザCDN pdf.js）。失敗時は例外。使い終わったら doc.destroy() */
  async function openDoc(p) {
    let data;
    if (typeof p !== 'string') {
      if (p instanceof Uint8Array) data = p;
      else if (p instanceof ArrayBuffer) data = new Uint8Array(p);
      else if (typeof Blob !== 'undefined' && p instanceof Blob) data = new Uint8Array(await p.arrayBuffer());
      else throw new Error('PDFデータを読めません');
    } else if (isAssetRef(p) && window.WebBridge) {
      data = await WebBridge.readAssetBytes(p);
    } else if (fsx) {
      if (fsx.statSync(p).size > 200 * 1024 * 1024) throw new Error('ファイルが大きすぎます（200MB超）');
      data = new Uint8Array(fsx.readFileSync(p));
    } else {
      throw new Error('PDFを読み込めません');
    }
    if (data.byteLength > 200 * 1024 * 1024) throw new Error('ファイルが大きすぎます（200MB超）');
    const lib = await window.CCFPdfViewer.loadPdfjsAsync(CCF.APP_DIR);
    if (pathx && fsx) {
      const base = pathx.join(CCF.APP_DIR, 'node_modules', 'pdfjs-dist');
      return await lib.getDocument({ data, cMapUrl: furl(pathx.join(base, 'cmaps')) + '/', cMapPacked: true, standardFontDataUrl: furl(pathx.join(base, 'standard_fonts')) + '/', isEvalSupported: false }).promise;
    }
    const cdn = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    return await lib.getDocument({ data, cMapUrl: cdn + 'cmaps/', cMapPacked: true, standardFontDataUrl: cdn + 'standard_fonts/', isEvalSupported: false }).promise;
  }
  /** 1ページ分のテキスト（ルビ除外・2段組整列済み）。items も返す */
  async function pageText(doc, n, opts) {
    const page = await doc.getPage(n), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    const text = T.extractRectText(tc.items, vp.transform, 1, { x: 0, y: 0, w: vp.width, h: vp.height }, Object.assign({ excludeRuby: true, twoColumn: true, pageH: vp.height }, opts || {}));
    try { if (typeof page.cleanup === 'function') page.cleanup(); } catch (_) { }
    return { text, items: tc.items };
  }
  /** PDF 全ページからテキストを抽出する（最大150ページ・文字数上限付き） */
  async function extractFullTextFromPdf(filePathOrBytes, opts) {
    const o = opts || {};
    const maxPages = Math.max(1, Number(o.maxPages) || 150);
    const maxChars = Math.max(1000, Number(o.maxChars) || 250000);
    const onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;
    let doc = null;
    try {
      doc = await openDoc(filePathOrBytes);
      const total = doc.numPages || 0;
      const limit = Math.min(total, maxPages);
      const parts = [];
      let len = 0;
      let extractedPages = 0;
      let truncated = total > maxPages;
      for (let p = 1; p <= limit; p++) {
        const r = await pageText(doc, p);
        const body = NF(r.text || '').replace(/[\uE000-\uF8FF]/g, '').trim();
        const seg = (parts.length ? '\n\n' : '') + `=== P.${p} ===\n` + body;
        if (len + seg.length > maxChars) {
          const remain = maxChars - len;
          if (remain > 20) parts.push(seg.slice(0, remain));
          truncated = true;
          extractedPages = p;
          break;
        }
        parts.push(seg);
        len += seg.length;
        extractedPages = p;
        if (onProgress) {
          try { onProgress({ page: p, total: limit, chars: len }); } catch (_) { }
        }
        if (p % 5 === 0) await new Promise(res => setTimeout(res, 0));
      }
      return { text: parts.join(''), pageCount: total, extractedPages, truncated };
    } finally {
      try { if (doc) await doc.destroy(); } catch (_) { }
    }
  }
  /** PDF またはテキスト系資料（.txt/.md/.html）から全文テキストを抽出する */
  async function extractFullTextFromDoc(filePathOrBytes, opts) {
    const o = opts || {};
    const name = o.name || (typeof filePathOrBytes === 'string' ? scanBaseName(filePathOrBytes) : '');
    const maxChars = Math.max(1000, Number(o.maxChars) || 250000);
    if (T.TEXT_DOC_RE && T.TEXT_DOC_RE.test(name)) {
      const bytes = await readTextDocBytes(filePathOrBytes);
      let txt = '';
      if (T.loadTextDoc) txt = T.loadTextDoc(name, bytes).text || '';
      else txt = decodeTextBytes(bytes);
      txt = NF(txt).replace(/[\uE000-\uF8FF]/g, '').trim();
      const truncated = txt.length > maxChars;
      if (truncated) txt = txt.slice(0, maxChars);
      return { text: txt, pageCount: 1, extractedPages: 1, truncated };
    }
    return await extractFullTextFromPdf(filePathOrBytes, o);
  }
  /** 1ページ目を Canvas に描いて DataURL（JPEG）にする */
  async function renderCover(doc, maxW) {
    const page = await doc.getPage(1), v0 = page.getViewport({ scale: 1 }), sc = Math.min(2, (maxW || 640) / v0.width), vp = page.getViewport({ scale: sc });
    const cv = document.createElement('canvas'); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return cv.toDataURL('image/jpeg', 0.82);
  }
  async function readTextDocBytes(p) {
    if (typeof p !== 'string') {
      if (p instanceof Uint8Array) return p;
      if (p instanceof ArrayBuffer) return new Uint8Array(p);
      if (typeof Blob !== 'undefined' && p instanceof Blob) return new Uint8Array(await p.arrayBuffer());
      return new Uint8Array(0);
    }
    if (isAssetRef(p) && window.WebBridge) return await WebBridge.readAssetBytes(p);
    if (fsx) {
      if (fsx.statSync(p).size > 20 * 1024 * 1024) return new Uint8Array(0);
      return new Uint8Array(fsx.readFileSync(p));
    }
    return new Uint8Array(0);
  }
  /** シナリオ解析用：メインPDFと各サブPDF/TXTの序盤（1〜5ページ）を解析する。
   *  戻り値 { title, spec, coverUrl }（失敗した項目は '' / 空）。制限時間付き。 */
  async function analyzePdfs(main, subs, o) {
    o = o || {}; const out = { title: '', spec: mergeSpecs([]), coverUrl: '' }, specs = [];
    const allPaths = [main, ...(Array.isArray(subs) ? subs : [])].filter(Boolean);
    const synAllowedPaths = new Set(classifySynopsisDocs(allPaths.map(p => ({ path: p, name: scanBaseName(p) }))).map(d => d.path));
    const orderedSubs = [...(Array.isArray(subs) ? subs : [])].sort((a, b) => (synAllowedPaths.has(b) ? 1 : 0) - (synAllowedPaths.has(a) ? 1 : 0));

    const run = async (p, isMain) => {
      const bName = scanBaseName(p);
      const allowSyn = synAllowedPaths.has(p);
      if (/\.(?:txt|md|markdown|html?)$/i.test(bName)) {
        try {
          const bytes = await readTextDocBytes(p);
          let txt = decodeTextBytes(bytes);
          if (/\.html?$/i.test(bName)) txt = txt.replace(/<[^>]+>/g, '\n');
          specs.push(extractSpec(txt.slice(0, 8000), { skipSynopsis: !allowSyn }));
        } catch (e) { console.warn('[ccf] テキスト解析に失敗', p, e); }
        return;
      }
      if (!/\.pdf$/i.test(bName)) return;
      let doc = null;
      try {
        doc = await openDoc(p); const n = Math.min(5, doc.numPages), texts = [], tItems = [];
        for (let i = 1; i <= n; i++) {
          const r = await pageText(doc, i); texts.push(NF(r.text).replace(/[\uE000-\uF8FF]/g, ''));
          if (isMain && i <= 2) tItems.push(r.items.filter(it => it.str && it.str.trim()).map(it => ({ s: it.str, h: Math.abs((it.transform && it.transform[3]) || it.height || 0) })));
        }
        specs.push(extractSpec(texts.join('\n'), { skipSynopsis: !allowSyn }));
        if (isMain) {
          const candTitle = pickTitleFromItems(tItems);
          if (candTitle && !isMojibakeText(candTitle, { checkHiragana: false })) out.title = candTitle;
          if (!out.title) { const meta = await doc.getMetadata().catch(() => null), mt = meta && meta.info && String(meta.info.Title || '').replace(/\s+/g, ' ').trim(); if (mt && mt.length >= 2 && mt.length <= 60 && !/^(untitled|microsoft word|無題)|\.(docx?|pdf|indd|psd)$/i.test(mt) && !isMojibakeText(mt, { checkHiragana: false })) out.title = mt; }
          if (o.cover) { try { out.coverUrl = await renderCover(doc); } catch (e) { console.warn('[ccf] 表紙の画像化に失敗', e); } }
        }
      } catch (e) { console.warn('[ccf] PDF解析に失敗', p, e); } finally { try { if (doc) doc.destroy(); } catch (e) { /* noop */ } }
    };
    const job = (async () => { if (main) await run(main, true); for (const p of orderedSubs.slice(0, 10)) await run(p, false); })();
    await Promise.race([job, new Promise(r => setTimeout(r, o.timeout || 60000))]);
    out.spec = mergeSpecs(specs); return out;
  }

  // ---------- NPC 一括スキャン UI ----------
  let W = null;   // { el, results:[], running, cancel }
  const sysName = () => { const s = (Sys.SYSTEMS || []).find(x => x.id === S.proj.settings.system); return s ? s.name : S.proj.settings.system; };
  function scenarioDocTexts() {
    try {
      const sc = CCF.scenarioList().find(x => String(x.id) === String(S.key));
      return (sc && Array.isArray(sc.docTexts)) ? sc.docTexts.filter(d => d && d.text) : [];
    } catch (_) { return []; }
  }
  const normScanDocName = s => String(s || '').normalize('NFKC').trim().toLowerCase();
  function findDocTextForTarget(p, name) {
    const list = scenarioDocTexts();
    if (!list.length) return null;
    const sp = String(p || '');
    if (/^doc-text:\/\//i.test(sp)) {
      const id = sp.slice('doc-text://'.length);
      const byId = list.find(d => String(d.id || '') === id);
      if (byId) return byId;
    }
    const nm = normScanDocName(name || scanBaseName(sp));
    return nm ? (list.find(d => normScanDocName(d.name) === nm) || null) : null;
  }
  function isLocalTargetAccessible(p) {
    if (!p || /^doc-text:\/\//i.test(p)) return false;
    return isAssetRef(p) ? (!window.WebBridge || WebBridge.hasAssetSync(p)) : !!(fsx && fsx.existsSync(p));
  }
  function pdfTargets(scope) {
    const list = [], seen = new Set(), seenNames = new Set();
    const add = (p, name, dt) => {
      if (!p) return;
      const nm = name || (dt && dt.name) || scanBaseName(p);
      const ok = isLocalTargetAccessible(p);
      const docText = dt || (!ok ? findDocTextForTarget(p, nm) : null);
      if (!ok && !docText) return;
      const k = String(p).toLowerCase();
      const nk = normScanDocName(nm);
      if (seen.has(k) || (!ok && nk && seenNames.has(nk))) return;
      seen.add(k);
      if (nk) seenNames.add(nk);
      list.push({ path: p, name: nm, docText: ok ? null : docText });
    };
    const cur = (CCF.viewer && CCF.viewer.state.path) || (S.proj.pdf && S.proj.pdf.path) || '';
    if (scope === 'current') { add(cur); return list; }
    add(cur);
    (S.proj.refs || []).filter(r => r.type === 'pdf' || r.type === 'doc').forEach(r => add(r.path, r.name));
    if (fsx && pathx && typeof DATA_ROOT !== 'undefined' && DATA_ROOT) {
      try { const sc = CCF.scenarioList().find(x => String(x.id) === S.key); ((sc && sc.docs) || []).filter(d => /\.(pdf|txt|html?|md)$/i.test(d.name || '')).forEach(d => add(pathx.resolve(DATA_ROOT, d.rel), d.name)); } catch (e) { /* noop */ }
    }
    scenarioDocTexts().forEach(dt => add('doc-text://' + dt.id, dt.name, dt));
    return list;
  }
  /** 「📌 登録素材」の画像（NPC立ち絵フォルダ優先）のパス一覧 */
  function portraitFiles() {
    if (!fsx) return [];
    const byPath = new Map();
    const isNpcCat = cat => /^(?:NPC)(?:\/|$)/i.test(String(cat || '').trim()) || /NPC|立ち絵|立絵|キャラ|人物/i.test(String(cat || ''));
    const add = (r) => {
      if (!r || r.type !== 'image' || !r.path || isAssetRef(r.path) || /^cloud-asset:/i.test(r.path)) return;
      let exists = false;
      try { exists = fsx.existsSync(r.path); } catch (_) { exists = false; }
      if (!exists) return;
      const k = String(r.path).replace(/\//g, '\\').toLowerCase();
      const cat = String(r.category || '').normalize('NFKC').trim();
      const prev = byPath.get(k);
      if (!prev) byPath.set(k, { path: r.path, isNpc: isNpcCat(cat) });
      else if (!prev.isNpc && isNpcCat(cat)) prev.isNpc = true;
    };
    if (CCF.assets && typeof CCF.assets.getUnifiedItems === 'function') {
      try { (CCF.assets.getUnifiedItems(S.key) || []).forEach(add); } catch (_) { }
    }
    ((S.proj && S.proj.refs) || []).forEach(add);
    const imgs = [...byPath.values()];
    const npc = imgs.filter(r => r.isNpc);
    return (npc.length ? npc : imgs).map(r => r.path);
  }
  function closeScan() { if (!W) return; W.cancel = true; document.removeEventListener('keydown', onKey, true); W.el.remove(); W = null; }
  const onKey = e => { if (e.key === 'Escape' && W && !document.querySelector('.app-dialog-overlay')) { e.preventDefault(); e.stopImmediatePropagation(); closeScan(); } };
  function openScan() {
    if (W) closeScan();
    const ov = document.createElement('div'); ov.className = 'ccf-overlay'; ov.id = 'ccfScan'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="ccf-modal ccf-scan-modal"><div class="ccf-modal-head"><b>🔍 PDFからNPCを一括検出</b><span class="ccf-muted">システム：${esc(sysName())}（部屋の設定）</span><span class="ccf-spacer"></span><button type="button" class="ccf-mini" data-sc="close">✕</button></div>
      <div class="ccf-scan-bar">
        <label class="ccf-chk"><input type="radio" name="ccfScanScope" value="current" checked> 表示中のPDFのみ</label>
        <label class="ccf-chk"><input type="radio" name="ccfScanScope" value="all"> 登録された全PDFを横断</label>
        <button type="button" class="ccf-btn primary" data-sc="start">▶ スキャン開始</button><button type="button" class="ccf-btn" data-sc="stop" disabled>■ 中止</button>
        <span class="ccf-muted" id="ccfScanMsg">全ページを走査し、ステータス・技能が密集しているブロックを候補にします</span></div>
      <div class="ccf-modal-body single" id="ccfScanList"><div class="ccf-empty">「スキャン開始」を押してください</div></div>
      <div class="ccf-modal-foot"><label class="ccf-chk"><input type="checkbox" id="ccfScanAll"> すべて選択</label><span class="ccf-spacer"></span>
        <button type="button" class="ccf-btn primary" data-sc="add">✅ チェックした候補をNPC一覧へ登録</button><button type="button" class="ccf-btn" data-sc="review">✎ 確認・修正画面で開く</button><button type="button" class="ccf-btn" data-sc="close">閉じる</button></div></div>`;
    document.body.appendChild(ov); W = { el: ov, results: [], running: false, cancel: false };
    ov.addEventListener('click', onClick); ov.addEventListener('change', e => { if (e.target.id === 'ccfScanAll') ov.querySelectorAll('.ccf-scan-chk').forEach(c => { c.checked = e.target.checked; }); });
    document.addEventListener('keydown', onKey, true);
  }
  const msg = t => { const m = $('ccfScanMsg'); if (m) m.textContent = t; };
  function renderResults() {
    const box = $('ccfScanList'); if (!box || !W) return;
    box.innerHTML = W.results.map((r, i) => `<div class="ccf-scan-row" data-i="${i}"><div class="ccf-scan-head"><input type="checkbox" class="ccf-scan-chk" aria-label="候補を選択"${r.checked ? ' checked' : ''}>
      <span class="ccf-chip">📄 ${esc(r.pdf)}　p.${r.page}</span><span class="ccf-chip dim">一致 ${r.score}項目</span>${r.portraits && r.portraits.length ? `<span class="ccf-chip">🖼️ 立ち絵 ${r.portraits.length}枚</span>` : ''}
      <input type="text" class="ccf-scan-name" value="${esc(r.name)}" placeholder="NPC名" aria-label="NPC名"></div>
      <textarea class="ccf-scan-text" rows="5" spellcheck="false" aria-label="ステータス本文">${esc(r.text)}</textarea></div>`).join('') || '<div class="ccf-empty">候補が見つかりませんでした</div>';
  }
  async function runScan() {
    if (!W || W.running) return;
    const scope = (W.el.querySelector('input[name=ccfScanScope]:checked') || {}).value || 'current', targets = pdfTargets(scope), sysId = S.proj.settings.system;
    if (!targets.length) return msg('⚠️ スキャンするPDFがありません（PDFを開くか、シナリオにPDFを登録してください）');
    W.running = true; W.cancel = false; W.results = []; renderResults();
    const start = W.el.querySelector('[data-sc=start]'), stop = W.el.querySelector('[data-sc=stop]'); start.disabled = true; stop.disabled = false;
    let pages = 0; const imgs = portraitFiles(), seenPortrait = new Set();
    const addPortraits = (text, tg, pg) => detectPortraitNpcs(text, imgs).forEach(po => {
      const pk = cmpName(po.name);
      if (!pk || seenPortrait.has(pk) || W.results.some(r => cmpName(r.name) === pk)) return;
      seenPortrait.add(pk);
      W.results.push({ pdf: tg.name, path: tg.path, page: pg, name: po.name, text: '名前: ' + po.name + '\n（ステータスなし・立ち絵のみ）', score: 0, checked: true, portraits: po.files, noStats: true });
    });
    const splitDocTextPages = raw => {
      const text = String(raw || '');
      const re = /^=== P\.(\d+) ===\s*$/gm;
      const matches = [...text.matchAll(re)];
      if (!matches.length) {
        const chunk = text.split('\n'), per = 120, out = [];
        for (let k = 0, n = 1; k < chunk.length; k += per - 10, n++) {
          out.push({ page: n, text: chunk.slice(k, k + per).join('\n') });
        }
        return { paged: false, segs: out };
      }
      const out = [];
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const start = m.index + m[0].length;
        const end = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
        const pg = Number(m[1]) || (i + 1);
        const body = text.slice(start, end).trim();
        if (body) out.push({ page: pg, text: body });
      }
      return { paged: true, segs: out };
    };
    for (let t = 0; t < targets.length && !W.cancel; t++) {
      let doc = null;
      try {
        if (targets[t].docText) {
          const { paged, segs } = splitDocTextPages(targets[t].docText.text);
          const scanner = paged ? createPageScanner(sysId, N) : null;
          for (let i = 0; i < segs.length && !W.cancel; i++) {
            const seg = segs[i];
            msg(`🔎 ${t + 1}/${targets.length}　${targets[t].name}（同期テキスト）　p.${seg.page}（候補 ${W.results.length}件）`);
            pages++;
            const pushBlock = b => {
              if (!W.results.some(r => r.path === targets[t].path && r.page === seg.page && r.text === b.text)) {
                const row = { pdf: targets[t].name, path: targets[t].path, page: seg.page, name: b.name, text: b.text, score: b.score, checked: true, fromHead: !!b.fromHead };
                W.results.push(row);
                return row;
              }
              return null;
            };
            if (scanner) scanner.step(seg.text, pushBlock);
            else detectNpcBlocks(seg.text, sysId, N).forEach(pushBlock);
            addPortraits(seg.text, targets[t], seg.page);
            if (i % 10 === 9) { renderResults(); await new Promise(r2 => setTimeout(r2, 0)); }
          }
          continue;
        }
        if (T.TEXT_DOC_RE.test(scanBaseName(targets[t].path))) {   // .txt/.html/.htm/.md：文字コード自動判別して、空行区切りで擬似ページ化
          const rawBytes = isAssetRef(targets[t].path) && window.WebBridge ? await WebBridge.readAssetBytes(targets[t].path) : fsx.readFileSync(targets[t].path);
          const tx = T.loadTextDoc(scanBaseName(targets[t].path), rawBytes).text, chunk = tx.split('\n'), per = 120;
          for (let k = 0, n = 1; k < chunk.length && !W.cancel; k += per - 10, n++) {
            const seg = chunk.slice(k, k + per).join('\n'); pages++;
            detectNpcBlocks(seg, sysId, N).forEach(b => { if (!W.results.some(r => r.path === targets[t].path && r.text === b.text)) W.results.push({ pdf: targets[t].name, path: targets[t].path, page: n, name: b.name, text: b.text, score: b.score, checked: true, fromHead: !!b.fromHead }); });
            addPortraits(seg, targets[t], n);
          }
          continue;
        }
        doc = await openDoc(targets[t].path);
        const scanner = createPageScanner(sysId, N);
        for (let n = 1; n <= doc.numPages && !W.cancel; n++) {
          msg(`🔎 ${t + 1}/${targets.length}　${targets[t].name}　${n}/${doc.numPages}ページ（候補 ${W.results.length}件）`);
          const r = await pageText(doc, n); pages++;
          scanner.step(r.text, b => {
            const row = { pdf: targets[t].name, path: targets[t].path, page: n, name: b.name, text: b.text, score: b.score, checked: true, fromHead: !!b.fromHead };
            W.results.push(row);
            return row;
          });
          addPortraits(r.text, targets[t], n);
          if (n % 5 === 0) { renderResults(); await new Promise(r2 => setTimeout(r2, 0)); }
        }
      } catch (e) { console.warn('[ccf] スキャン失敗', targets[t].path, e); msg('⚠️ ' + targets[t].name + ' を読めませんでした：' + (e.message || e)); }
      finally { try { if (doc) doc.destroy(); } catch (e) { /* noop */ } }
    }
    if (!W) return;
    // ステータスありNPCにも、同名の立ち絵があれば自動セット（差分もベース名でまとめて紐付け）
    W.results.forEach(r => {
      if (r.noStats) return;
      const nm = detectPortraitNpcs(r.name || '', imgs, { allowGenericRole: true });
      const hit = nm.find(x => x.name && (cmpName(r.name).includes(cmpName(x.name)) || nameKey(baseOf(r.name)).includes(nameKey(baseOf(x.name)))));
      if (hit) r.portraits = sortDiffFiles([...new Set([...(r.portraits || []), ...hit.files])]);
    });
    try { dedupeResults(); } catch (e) { console.warn('[ccf] 同名NPCの整理に失敗', e); }
    renderResults(); W.running = false; start.disabled = false; stop.disabled = true;
    msg((W.cancel ? '■ 中止しました' : '✅ 完了') + `：${pages}ページを走査し、候補 ${W.results.length}件` + (W.merged ? `（同名の重複・不完全な ${W.merged}件を統合）` : ''));
  }
  /** 同名NPCのスマート重複排除（自動計算前の統合）：cmpName 完全一致＋簡易再掲（isSimple）のフルネーム吸収 */
  function dedupeResults() {
    const s = S.proj.settings, parseOpts = Object.assign({ edition: s.edition, rollPrefix: s.rollPrefix, abilityRolls: s.abilityRolls, noAuto: true }, Sys.parseOpts(s));
    const res = mergeSameResults(W.results, text => N.parseNpc(text, parseOpts));
    W.results = res.results; W.merged = res.merged;
  }
  /** 一覧の編集内容（チェック・名前・本文）を W.results へ反映して、選択中の候補をNPCの下書きにする */
  function attachPortraits(d, files) {
    if (!files || !files.length) return;
    const sorted = sortDiffFiles(files);
    const list = sorted.slice(0, 24).map(f => {
      let u = '';
      try {
        const b = fsx.readFileSync(f), ext = pathx.extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
        if (b.length <= 6 * 1024 * 1024) u = 'data:image/' + (ext || 'png') + ';base64,' + b.toString('base64');
      } catch (e) { /* noop */ }
      const info = splitImageName(f), baseName = pathx.basename(f);
      const normF = String(f).replace(/\//g, '\\').toLowerCase();
      const refHit = (S.proj && Array.isArray(S.proj.refs) ? S.proj.refs : []).find(r => r && r.path && String(r.path).replace(/\//g, '\\').toLowerCase() === normF);
      const assetHit = !refHit && CCF.assets && CCF.assets.getUnifiedItems ? CCF.assets.getUnifiedItems(S.key).find(x => x && x.path && String(x.path).replace(/\//g, '\\').toLowerCase() === normF) : null;
      const aid = refHit ? ('ref:' + refHit.id) : (assetHit ? (assetHit.uid || '') : '');
      return (u || f) ? { id: M.newId(), path: f, filePath: f, dataUrl: u, assetId: aid, label: info.diffLabel || pathx.basename(f, pathx.extname(f)), name: baseName } : null;
    }).filter(Boolean);
    d.images = list;
    d.portraits = list.map(x => Object.assign({}, x));
    if (list.length) {
      const head = list[0], src = head.dataUrl || head.path || head.filePath || null;
      d.iconDataUrl = head.dataUrl || null;
      d.iconName = head.label || head.name || '';
      d.image = src; d.imagePath = head.filePath || head.path || ''; d.iconUrl = src; d.portrait = src;
    }
  }
  function selectedDrafts() {
    const s = S.proj.settings, opts = Object.assign({ edition: s.edition, rollPrefix: s.rollPrefix, abilityRolls: s.abilityRolls, noAuto: true }, Sys.parseOpts(s)), drafts = [];
    W.el.querySelectorAll('.ccf-scan-row').forEach(row => {
      if (!row.querySelector('.ccf-scan-chk').checked) return;
      const r = W.results[+row.dataset.i]; if (!r) return;
      const text = row.querySelector('.ccf-scan-text').value, name = row.querySelector('.ccf-scan-name').value.trim();
      let d = N.parseNpc(text, opts);
      if (name) d.name = name;
      d.srcs = r.path ? [{ path: r.path, name: r.pdf, page: r.page || 1, rect: null }] : [];
      if (Array.isArray(r.mergedParts)) {
        r.mergedParts.forEach(part => {
          if (part.path) d.srcs.push({ path: part.path, name: part.pdf, page: part.page || 1, rect: null });
          if (!part.noStats && part.text && part.text.trim()) {
            const pd = N.parseNpc(part.text, opts);
            if (name) pd.name = name;
            d = M.mergeTwoNpcs(d, pd, { buildCommands: x => N.buildCommands(x, { abilityRolls: s.abilityRolls }) });
          }
        });
      }
      // 元のテキスト欄：1行目に出典、2行目以降に抽出元の本文（統合した別ページの記述があれば末尾に追記）
      d.source = '【出典: ' + r.pdf + ' p.' + r.page + '】\n' + text + (r.extra || '');
      attachPortraits(d, r.portraits);
      try {
        const f = M.autoFillStats(d, d.system === 'coc7' ? '7' : d.system === 'coc6' ? '6' : d.edition);
        if (f.length) d.commands = N.buildCommands(d, { abilityRolls: s.abilityRolls });
      } catch (e) { /* noop */ }
      drafts.push(d);
    });
    return drafts;
  }
  function onClick(e) {
    const b = e.target.closest('[data-sc]'); if (!b) return; const k = b.dataset.sc;
    if (k === 'close') return closeScan();
    if (k === 'start') return void runScan();
    if (k === 'stop') { if (W) W.cancel = true; return; }
    if (W.running) return msg('スキャン中です。完了または中止してから操作してください');
    const drafts = selectedDrafts(); if (!drafts.length) return msg('⚠️ 登録する候補にチェックを入れてください');
    if (k === 'review') { closeScan(); return CCF.openNpcReview(drafts, { mode: 'new' }); }
    if (k === 'add') {
      drafts.forEach(d => { const c = Object.assign({}, d); delete c._palDirty; delete c.warnings; c.skills = (d.skills || []).filter(s => String(s.name).trim()); c.name = String(d.name || '').trim() || '名称未設定NPC'; const n = M.sanitizeNpc(Object.assign(c, { id: d.id || M.newId() })); if (n) S.proj.npcs.push(n); });
      const res = M.mergeSameNameNpcs(S.proj.npcs, { buildCommands: x => N.buildCommands(x, { abilityRolls: S.proj.settings.abilityRolls }) });
      S.proj.npcs = res.npcs;
      CCF.saveProject(); closeScan(); CCF.setView('npcs');
      say('✅ ' + drafts.length + '体のNPCを出典付きで登録しました' + (res.mergedCount ? `（同名 ${res.mergedCount}件を統合）` : ''));
    }
  }

  CCF.pdfText = { openDoc, pageText, renderCover, analyzePdfs, extractFullTextFromPdf, extractFullTextFromDoc };
  CCF.scan = Object.assign({ open: openScan, extractFullTextFromPdf, extractFullTextFromDoc }, api);
  window.CCFScan = CCF.scan;
})();
