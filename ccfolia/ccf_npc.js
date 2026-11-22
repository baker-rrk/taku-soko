/* ccf_npc.js — ココフォリア特化ツール Phase 1：NPC ステータスブロックの自動パース（DOM／Electron に依存しない純粋関数）
 *
 *   parseNpc(rawText, opts)  → NPC ドラフト { name, memo, initiative, status[], params[], skills[], commands, edition, warnings[] … }
 *   splitNpcBlocks(rawText)  → 複数 NPC が含まれる文章を NPC ごとの文章に分割
 *   buildCommands(draft, opts) → 技能・武器・能力値からチャットパレット（改行区切り）を生成
 *
 *  振り分けルール（要件定義どおり）
 *    HP / MP / SAN            ➡ ステータス（バー表示）
 *    STR・DEX 等 / DB / ビルド ➡ パラメータ（固定値）
 *    「技能名 数値」           ➡ チャパレのダイスコマンド（例：CCB<=50 【目星】）
 *  どれにも当てはまらなかった行は「メモ」へ回し、KP が目視で確認・修正できるようにする。 */
(function () {
  'use strict';

  // ---------- 辞書 ----------
  const ABILITY_ORDER = ['STR', 'CON', 'POW', 'DEX', 'APP', 'SIZ', 'INT', 'EDU'];
  const STATUS_ORDER = ['HP', 'MP', 'SAN'];
  const LABEL_ALIAS = {   // 表記ゆれ → 正規ラベル
    STR: 'STR', 筋力: 'STR', CON: 'CON', 体力: 'CON', POW: 'POW', 精神力: 'POW', DEX: 'DEX', 敏捷性: 'DEX', 敏捷力: 'DEX', 敏捷: 'DEX',
    APP: 'APP', 外見: 'APP', 容姿: 'APP', SIZ: 'SIZ', 体格: 'SIZ', INT: 'INT', 知性: 'INT', EDU: 'EDU', 教育: 'EDU',
    HP: 'HP', 耐久力: 'HP', ヒットポイント: 'HP', MP: 'MP', マジックポイント: 'MP', 'マジック・ポイント': 'MP',
    SAN: 'SAN', SAN値: 'SAN', 正気度: 'SAN', 正気度ポイント: 'SAN', LUK: 'LUK', LUCK: 'LUK', 幸運: 'LUK',
    装甲: 'ARMOR', 装甲値: 'ARMOR', アーマー: 'ARMOR', ARMOR: 'ARMOR'
  };
  const getSys = () => (typeof window !== 'undefined' && window.CCFSys) || (typeof require === 'function' ? (() => { try { return require('./ccf_sys.js'); } catch (e) { return null; } })() : null);
  const LABEL_ALT = Object.keys(LABEL_ALIAS).sort((a, b) => b.length - a.length).map(esc).join('|');
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // CoC 6版・7版で公式に使われる技能名（前方一致で「既知」とみなす。未知の名前は UI で「要確認」表示にする）
  const KNOWN_SKILLS = ['言いくるめ', '医学', '運転', '応急手当', 'オカルト', '回避', '化学', '鍵開け', '隠す', '隠れる', '機械修理', '聞き耳', '軍事学', '計算', '経理', '考古学',
    'コンピューター', 'コンピュータ', '忍び歩き', '写真術', '重機械操作', '乗馬', '信用', '心理学', '人類学', '水泳', '製作', '精神分析', '生物学', '説得', '地質学', '跳躍', '追跡',
    '電気修理', '電子工学', '天文学', '投擲', '登攀', '図書館', 'ナビゲート', '変装', '法律', '博物学', '物理学', '目星', '母国語', '薬学', '歴史', '芸術', '魅惑', '威圧', '魔術', '値切り',
    'こぶし', 'パンチ', 'キック', '頭突き', '組みつき', '組み付き', 'マーシャルアーツ', '拳銃', 'マシンガン', 'ライフル', 'ショットガン', 'サブマシンガン', '弓', '火炎放射器', '剣', '斧', 'ナイフ', '近接戦闘', '射撃', '格闘',
    'クトゥルフ神話', '他の言語', 'ほかの言語', '言語', '英語', 'ドイツ語', 'フランス語', '日本語', 'ラテン語', 'ギリシャ語', '中国語', '韓国語', 'アラビア語', 'ヘブライ語', 'ロシア語', 'スペイン語', 'イタリア語', '古代語', '防御',
    '機械', '電子機器', '自然', 'サバイバル', 'アイデア', '幸運', '知識'];
  const KNOWN_RE = new RegExp('^(?:' + KNOWN_SKILLS.map(esc).join('|') + ')');
  const NOT_SKILL = /^(?:ダメージ|ダメ|攻撃回数|攻撃|装甲|ターン|ラウンド|回数|年齢|身長|体重|移動|移動率|ビルド|ダメージボーナス|ボーナス|ページ|ＰＬ|PL|NPC|Lv|LV|レベル|SAN|HP|MP|STR|CON|POW|DEX|APP|SIZ|INT|EDU|LUK|DB|d|D|成功|失敗|回|P|p|能力値|技能値|ステータス|出典)$/;
  const UNIT_AFTER = /[回体人歳年月日分秒階個匹本枚度点倍㎝㎏ヶ名つ]/;
  const SKILL_CONTEXT = /^\s*(?:技能|戦闘技能|探索技能|行動技能|武器|攻撃|スキル|Skills?|格闘技能)\s*[:=]/i;
  const NAME_WORDS = /(?:NPC|ＮＰＣ|ステータス|データ|能力値|プロフィール|パラメータ|STATUS)/gi;
  const RE_JP = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
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
  const RE_BAD_NAME_PREFIX = /^(?:ステータス|能力値|種族?|所属|性別|年齢|武器|技能|所持品|職業|出身|国籍|身長|体重|備考|特徴|設定|解説|概要|描写|プロフィール|データ|詳細|行動|戦術|攻撃|特殊攻撃|魔術|呪文|【人物像】|【使用魔術】|【過去背景】|【経緯】|【能力値|【技能値|【ステータス|【技能|【武器|【所持品|【データ|【備考|【特徴|【解説|【行動|【魔術|【呪文)/;
  const RE_JUNK_LINE = /×\s*n\s*】|】\s*-{2,}|^[-=_/*#~・.―ー─━+|×n】\s]+$|[「」『』]|^\d+\s*[,、.)）]|(?:HP|MP|SAN|正気度|耐久)\s*(?:を|が)?\s*[+\-]\s*\d/i;
  const RE_FORM_HEAD = new RegExp('^\\s*[' + SYM_HEAD + '\\[【]?\\s*(?:ステータス|能力値|形態|フォーム)\\s*[:：]\\s*([^】\\]\\n]{1,20}?)\\s*[】\\]]?\\s*$');
  const RE_BULLET_HEAD = new RegExp('^\\s*[' + SYM_HEAD + ']+\\s*(.+?)\\s*$');
  const RE_STRIP_SYM_LEAD = new RegExp('^[' + SYM_ALL + '\\s]+');
  const belowAttr = (nl, i) => {
    for (let j = i - 1; j >= 0 && j >= i - 15; j--) {
      const t = String(nl[j] || '').trim();
      if (PROFILE_ATTR.test(t) || PROFILE_ATTR.test(t.replace(RE_STRIP_SYM_LEAD, ''))) return true;
      if ((HEAD_SYM.test(t) && !RE_BAD_NAME_PREFIX.test(t.replace(RE_STRIP_SYM_LEAD, ''))) || (HEAD_BRK.test(t) && !RE_BAD_NAME_PREFIX.test(t) && !RE_BAD_NAME_PREFIX.test(t.replace(/^【|】$/g, '')))) return false;
    }
    return false;
  };

  const NAME_START = '[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}A-Za-z]';
  const NAME_BODY = '[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}A-Za-z0-9ー・()〈〉<>\\[\\]「」]';
  const DICE = '(?:\\d*[dD]\\d+(?:\\s*[+\\-]\\s*(?:\\d*[dD]\\d+|\\d+|[dD][bB]))*|[dD][bB])';
  const HARD_EXT = '(?:\\s*\\(\\s*\\d+\\s*/\\s*\\d+\\s*\\))?';   // 7版の「(ハード/イクストリーム)」表記

  // ---------- 前処理 ----------
  const norm = s => String(s == null ? '' : s).normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '').replace(/[ \t\u3000]+/g, ' ');

  /** 表形式の抽出結果（ラベル行の下に数値行、または1語ごとの改行）を「STR 12 CON 13 …」の1行に畳む */
  function foldTables(lines) {
    const lbl = '(?:' + LABEL_ALT + ')', val = '(?:\\d{1,3}(?:\\s*/\\s*\\d{1,3})?|[-ー—―?*]+|なし|無し|不明)';
    const reLabelRow = new RegExp('^\\s*(?:(?<![A-Za-z])' + lbl + '(?![A-Za-z])\\s*)+$', 'i'), reValRow = new RegExp('^\\s*(?:' + val + '\\s*)+$');
    const reLabelOnly = new RegExp('^\\s*(?<![A-Za-z])' + lbl + '(?![A-Za-z])\\s*$', 'i'), reValOnly = new RegExp('^\\s*' + val + '\\s*$');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i], b = lines[i + 1];
      if (b !== undefined && reLabelRow.test(a) && reValRow.test(b)) {
        const L = a.trim().split(/\s+/), V = b.trim().split(/\s+/);
        if (L.length === V.length) { out.push(L.map((x, k) => x + ' ' + V[k]).join(' ')); i++; continue; }
      }
      if (b !== undefined && reLabelOnly.test(a) && reValOnly.test(b)) { out.push(a.trim() + ' ' + b.trim()); i++; continue; }
      out.push(a);
    }
    return out;
  }

  /** 複数 NPC が1つの文章に入っているとき、NPC ごとの文章に分ける（STR・インライン名/ステータス行の出現位置を目印にする） */
  function splitNpcBlocks(raw) {
    const lines = foldTables(norm(raw).split('\n'));
    const reStr = /(?<![A-Za-z])(?:STR|筋力)\s*[:=]?\s*\d/i;
    const reInline = new RegExp('^\\s*(.{1,40}?)\\s*[/]\\s*(?=(?:' + LABEL_ALT + ')(?![A-Za-z])\\s*[:=]?\\s*(?:\\d|\\(\\s*\\d))', 'i');
    const isNameLike = l => {
      const t = l.trim();
      if (!t || t.length > 40 || /\d/.test(t) || /[。！？]/.test(t)) return false;
      if (RE_BAD_NAME_PREFIX.test(t) || RE_JUNK_LINE.test(t)) return false;
      return !new RegExp('(?<![A-Za-z])(?:' + LABEL_ALT + ')(?![A-Za-z])', 'i').test(t);
    };
    const hits = [];
    lines.forEach((l, i) => {
      const im = reInline.exec(l);
      if (im && !RE_BAD_NAME_PREFIX.test(im[1].trim()) && !RE_JUNK_LINE.test(im[1].trim())) { hits.push({ i, inline: true }); return; }
      if (reStr.test(l)) hits.push({ i, inline: false });
    });
    if (hits.length < 2) return [lines.join('\n')];
    const starts = hits.map((h, k) => {
      if (h.inline) return h.i;
      let p = h.i - 1;
      while (p >= 0 && !lines[p].trim()) p--;
      const lo = k ? hits[k - 1].i + 1 : 0;
      if (p >= lo && RE_FORM_HEAD.test(lines[p])) {
        let b = p - 1;
        while (b >= lo && !lines[b].trim()) b--;
        if (b >= lo && (RE_BULLET_HEAD.test(lines[b]) || isNameLike(lines[b]))) return b;
        return p;
      }
      return (p >= lo && (RE_BULLET_HEAD.test(lines[p]) || isNameLike(lines[p]))) ? p : h.i;
    });
    starts[0] = 0;
    return starts.map((s, k) => lines.slice(s, k + 1 < starts.length ? starts[k + 1] : lines.length).join('\n')).filter(b => b.trim());
  }

  // ---------- 本体 ----------
  const BRACKETS = new RegExp('^[' + SYM_ALL + '\\s▶【〈《「『〔◎:：/\\-]+|[' + SYM_ALL + '\\s】〉》」』〕:：/]+$', 'g');
  const cleanName = s => String(s || '').replace(BRACKETS, '').replace(BRACKETS, '').replace(/[\uE000-\uF8FF]/g, '').replace(NAME_WORDS, ' ').replace(/\s+/g, ' ').trim();
  const isBadNameLine = raw => {
    const s = String(raw || '').trim();
    if (!s || s.length > 40) return true;
    if (RE_BAD_NAME_PREFIX.test(s) || RE_JUNK_LINE.test(s)) return true;
    if (/[。、]/.test(s) || /(?:は|が|を|へ|から|ので|より|まで|です|ます|である)$/.test(s)) return true;
    if (proseLike(s)) return true;
    return false;
  };
  const isBlankRest = s => !s.replace(/[\s,、，.。/／:：;；|｜・\-–—\[\]()（）]/g, '').length;

  function substituteDb(expr, db) {   // 「1d6+db」の db をダメージボーナスの値に置き換える
    return String(expr).replace(/\s*([+\-]?)\s*[dD][bB]\b/g, (m, sign) => {
      if (!db || /^[+\-]?0$/.test(db) || /^(なし|無し|-)$/.test(db)) return '';
      const v = db.replace(/\s+/g, ''); const body = v.replace(/^[+\-]/, ''), neg = v[0] === '-';
      return (neg ? '-' : (sign || '+')) + body;
    }).replace(/\s+/g, '').toUpperCase();
  }

  /** @param raw PDF から選択した NPC ステータスの文字列
   *  @param opts { edition:'auto'|'6'|'7', rollPrefix:'CCB'|'CC' } */
  function parseNpc(raw, opts) {
    const o = Object.assign({ edition: 'auto', rollPrefix: 'CCB', abilityRolls: true }, opts || {});
    // 「--- 別ページ (p.XX) の記述 ---」以降は参考追記なので解析しない。出典行（【出典: …】／xxx.pdf p.12）も飛ばす
    const rawBody = String(raw == null ? '' : raw).split(/\n\s*---\s*別ページ/)[0];
    const reSrcLine = /^\s*(?:【\s*出典\s*[:：][^】]*】|\[?\s*出典\s*[:：].*|.*\.(?:pdf|txt|html?|md)\s+p\.\s*\d+\s*)$/i;
    const lines = foldTables(norm(rawBody).split('\n').filter(l => !reSrcLine.test(l))).map(l => l.trim());
    const found = {}, skills = [], info = [], leftovers = [], warnings = [], exprNotes = [];   // found: 正規ラベル → { value, max }
    let nameFromLabel = '', db = '', build = '', move = '', firstStatLine = -1, lastReading = '';
    const valRe = '(?:(\\d{1,4})(?:\\s*/\\s*(\\d{1,4}))?|[-ー—―?*]+|なし|無し|不明)';
    const reAbilSum = new RegExp('(?<![A-Za-z])(' + LABEL_ALT + ')(?![A-Za-z])\\s*[:=]?\\s*\\(\\s*(\\d{1,4}(?:\\s*[+\\-]\\s*\\d{1,4})+)\\s*\\)', 'gi');
    const reAbilMul = new RegExp('(?<![A-Za-z])(' + LABEL_ALT + ')(?![A-Za-z])\\s*[:=]?\\s*(\\d{1,4})\\s*([×*xX]\\s*[A-Za-z0-9ぁ-んァ-ヶ一-龠()（）]+)', 'gi');
    const reAbil = new RegExp('(?<![A-Za-z])(' + LABEL_ALT + ')(?![A-Za-z])\\s*[:=]?\\s*' + valRe, 'gi');
    const reInlineName = new RegExp('^\\s*(.{1,40}?)\\s*/\\s*(?=(?:' + LABEL_ALT + ')(?![A-Za-z])\\s*[:=]?\\s*(?:\\d|\\(\\s*\\d))', 'i');
    const reInfo = /(職業|年齢|性別|出身|国籍|職歴|身長|体重)\s*[:=]?\s*([^\s,、。/／]{1,24})/g;
    const reNameLabel = /^\s*(?:名前|名称|氏名|NPC名|ネーム|Name)\s*[:=]\s*(.+?)\s*$/i;
    const reDb = /(?<![+\-\w])(?:ダメージ・?ボーナス|ダメボ|D\.?B\.?)\s*[:=]?\s*(?:([+\-]?\s*\d*[dD]\d+|[+\-]?\s*\d+)|なし|無し|-)/i;
    const reBuild = /(?:ビルド|BUILD)\s*[:=]?\s*([+\-]?\s*\d+)/i;
    const reMove = /(?:移動率|MOV(?:E)?|移動力?)\s*[:=]?\s*(\d{1,2})(?![\d%])/i;
    const skillPat = '[〈<「\\[]?(' + NAME_START + NAME_BODY + '{0,19}?)\\s*[:=]?\\s*(\\d{1,3})\\s*(%)?' + HARD_EXT + '(?![A-Za-z\\d])';
    const reWeapon = new RegExp(skillPat + '[\\s,、/]*(?:ダメージ|DMG|dmg|Damage)?\\s*[:=]?\\s*(' + DICE + ')(?![A-Za-z\\d])', 'gu');
    const reSkill = new RegExp(skillPat, 'gu');
    // 最初からチャパレ形式の逆順表記：CCB<=70 【こぶし(パンチ)】 ／ 1d100<=60 〈目星〉 ／ CCB<={DEX}*5 【回避】
    const reRev = /(?<![A-Za-z])(?:s?x\d+\s+)?s?(?:CCB|CC|1d100)\s*(?:\(\s*[+\-]?\d+\s*\))?\s*<=?\s*(?:(\d{1,3})|\{([A-Za-z]{3})\}\s*[×*xX]\s*(\d{1,2})|\(\s*\{([A-Za-z]{3})\}\s*[×*xX]\s*(\d{1,2})\s*\))(\s*\/\s*\d+)?\s*[【〈《「\[<]\s*([^】〉》」\]>\n]{1,24}?)\s*[】〉》」\]>]/giu;
    // 《技能名》(61) ／ 〈目星〉(50) ／ 【聞き耳】(50) ／ ＜図書館＞(70) ／ 〈防御〉(DEX×5) ＋ 任意でダメージ式
    const BR_PAT = '(?:《([^》\\n]{1,24}?)》|〈([^〉\\n]{1,24}?)〉|【([^】\\n]{1,24}?)】|<([^>\\n]{1,24}?)>)';
    const reBracket = new RegExp(BR_PAT + '(\\s*[(])?\\s*([:=])?\\s*(?:(\\d{1,3})\\s*(%)?(?:\\s*/\\s*\\d+\\s*/\\s*\\d+|\\s*\\(\\s*\\d+\\s*/\\s*\\d+\\s*\\))?|([A-Za-z]{3})\\s*[×*xX]\\s*(\\d{1,2}))\\s*\\)?(?:[\\s,、/]*(?:ダメージ|DMG|dmg|Damage)?\\s*[:=]?\\s*(' + DICE + ')(?![A-Za-z\\d]))?', 'gu');

    // ダメージボーナスは武器ダメージ置換に使うので、先に全文から拾う
    for (const l of lines) { const m = reDb.exec(l); if (m) { db = m[1] ? m[1].replace(/\s+/g, '') : '0'; if (/^\d+$/.test(db)) db = '+' + db; break; } }

    const aliasKey = lab => LABEL_ALIAS[Object.keys(LABEL_ALIAS).find(k => k.toLowerCase() === lab.toLowerCase())];
    lines.forEach((line, li) => {
      if (!line) return;
      let w = line, ctx = SKILL_CONTEXT.test(line);
      const had = () => { if (firstStatLine < 0) firstStatLine = li; };
      const inl = reInlineName.exec(w);
      if (inl) {
        const candInl = cleanName(inl[1]);
        if (candInl && !isBadNameLine(candInl) && !aliasKey(candInl)) {
          if (!nameFromLabel) nameFromLabel = candInl;
          w = w.slice(inl[0].length);
        }
      }
      w = w.replace(reInfo, (m, k, v) => { info.push(k + ': ' + v); return ' '; });
      const nl = reNameLabel.exec(w); if (nl) { nameFromLabel = nl[1]; w = ' '; }
      w = w.replace(new RegExp(reDb.source, 'gi'), m => { had(); return ' '; })
        .replace(new RegExp(reBuild.source, 'gi'), (m, v) => { build = v.replace(/\s+/g, ''); had(); return ' '; })
        .replace(new RegExp(reMove.source, 'gi'), (m, v) => { move = v; had(); return ' '; });
      w = w.replace(reAbilSum, (m, lab, expr) => {
        const key = aliasKey(lab); if (!key) return m;
        had();
        const tokens = expr.match(/[+\-]?\s*\d+/g) || [];
        const total = tokens.reduce((a, t) => a + Number(t.replace(/\s+/g, '')), 0);
        if (!(key in found)) found[key] = { value: total, max: null };
        exprNotes.push(m.trim());
        return ' ';
      });
      w = w.replace(reAbilMul, (m, lab, base) => {
        const key = aliasKey(lab); if (!key) return m;
        had();
        if (!(key in found)) found[key] = { value: +base, max: null };
        exprNotes.push(m.trim());
        return ' ';
      });
      w = w.replace(reAbil, (m, lab, v, mx) => {
        const key = aliasKey(lab); if (!key) return m;
        had();
        if (v === undefined) return ' ';   // 「SAN 無し」など、値の無い項目は読み飛ばす
        let value = +v, max = mx !== undefined ? +mx : null;
        if (!(key in found)) found[key] = { value, max };
        return ' ';
      });
      w = w.replace(SKILL_CONTEXT, ' ');
      w = w.replace(reRev, (m, val, ab1, mul1, ab2, mul2, div, name) => {
        if (!div) {
          if (val !== undefined) pushSkill(name, +val, true, true);
          else pushSkill(name, 0, true, true, '', { ab: (ab1 || ab2).toUpperCase(), mul: +(mul1 || mul2) });
        }
        return ' ';
      });
      // 《技能名》(数値) / 〈技能名〉(数値) / 【技能名】(数値) / ＜技能名＞(数値) 形式
      w = w.replace(reBracket, (m, n1, n2, n3, n4, openP, sep, val, pct, ab, mulN, dmg, off) => {
        const nm = n1 || n2 || n3 || n4;
        if (!openP && !sep && !pct && val !== undefined && UNIT_AFTER.test(w[off + m.length] || '')) return m;
        const sk = val !== undefined ? pushSkill(nm, +val, true, true, dmg) : pushSkill(nm, 0, true, true, dmg, { ab: ab.toUpperCase(), mul: +mulN });
        return sk ? ' ' : m;
      });
      // 武器（技能値＋ダメージ式）→ 技能として登録しつつダメージ行も作る
      w = w.replace(reWeapon, (m, name, val, pct, dmg) => {
        const sk = pushSkill(name, +val, !!pct, ctx, dmg); return sk ? ' ' : m;
      });
      w = w.replace(reSkill, (m, name, val, pct, off) => {
        const end = off + m.length, nextCh = w[end] || '';
        if (!pct && UNIT_AFTER.test(nextCh)) return m;     // 「3回」「35歳」などは技能ではない
        const sk = pushSkill(name, +val, !!pct, ctx); return sk ? ' ' : m;
      });
      if (!isBlankRest(w)) leftovers.push({ li, text: w.replace(/\s+/g, ' ').trim(), orig: line });
    });
    // 「(DEX×2)」のような能力値の式は、能力値が出そろってから計算する
    for (let i = skills.length - 1; i >= 0; i--) {
      const s = skills[i]; if (!s.expr) continue;
      const f = found[s.expr.ab], v = f ? Math.min(100, f.value * s.expr.mul) : 0;
      if (v >= 1) { s.value = v; delete s.expr; }
      else { warnings.push('「' + s.name + '」の技能値（' + s.expr.ab + '×' + s.expr.mul + '）を計算できませんでした'); skills.splice(i, 1); }
    }
    function stripUnbalanced(s) {   // 「〈目星〉」の外側の括弧だけを外す（「芸術(絵画)」の括弧は残す）
      const pairs = [['(', ')'], ['〈', '〉'], ['<', '>'], ['[', ']'], ['「', '」']], cnt = (x, c) => x.split(c).length - 1;
      pairs.forEach(([o, c]) => { while (s.endsWith(c) && cnt(s, c) > cnt(s, o)) s = s.slice(0, -1); while (s.startsWith(o) && cnt(s, o) > cnt(s, c)) s = s.slice(1); });
      return s;
    }
    function pushSkill(name, value, pct, ctx, dmg, expr) {
      const nm = stripUnbalanced(name.trim()).trim();
      if (!nm || NOT_SKILL.test(nm) || (!expr && (value < 1 || value > 100))) return null;
      if (nm.length < 2 && !(RE_JP.test(nm) && (pct || ctx || dmg))) return null;   // 1文字の名前（爪・牙…）は、% か武器ダメージか「技能:」の行があるときだけ
      const known = KNOWN_RE.test(nm);
      if (!known && !pct && !ctx && !dmg) return null;      // 辞書に無い名前は、% が付くか「技能:」の行・武器ダメージがあるときだけ採用
      if (skills.some(s => s.name === nm)) return { dup: true };
      const sk = { name: nm, value, known, include: true, damage: dmg ? substituteDb(dmg, db) : '' };
      if (expr) sk.expr = expr;
      skills.push(sk); return sk;
    }

    // ---- 名前 ----
    let name = cleanName(nameFromLabel), furigana = '', nameLine = -1;
    if (!name) {
      const lim = firstStatLine >= 0 ? firstStatLine : lines.length;
      const headOf = ln => {
        const t = String(ln || '').trim();
        if (!t || RE_FORM_HEAD.test(t) || PROFILE_ATTR.test(t)) return '';
        const ms = HEAD_SYM.exec(t), mb = !ms && HEAD_BRK.exec(t);
        const rawH = ms ? ms[1] : (mb ? mb[1] : '');
        if (!rawH || RE_BAD_NAME_PREFIX.test(t) || RE_BAD_NAME_PREFIX.test(rawH.trim())) return '';
        const cn = cleanName(rawH);
        return cn && !isBadNameLine(rawH) && !isBadNameLine(cn) ? cn : '';
      };
      const formLineIdx = leftovers.findIndex(l => (firstStatLine < 0 || l.li < firstStatLine) && RE_FORM_HEAD.test(l.orig));
      if (formLineIdx >= 0) {
        const fl = leftovers[formLineIdx], fmForm = RE_FORM_HEAD.exec(fl.orig);
        for (let k = fl.li - 1, steps = 0; k >= 0 && steps < 90; k--) {
          if (!lines[k]) continue; steps++;
          const bnm = headOf(lines[k]);
          if (bnm) { name = bnm + '（' + fmForm[1].trim() + '）'; nameLine = k; break; }
        }
      }
      if (!name) {
        let actIdx = -1, actNm = '';
        for (let i = 0; i < lim; i++) {
          const h = headOf(lines[i]);
          if (h) { actIdx = i; actNm = h; }
        }
        if (actNm) { name = actNm; nameLine = actIdx; }
      }
      if (!name) {
        const cand = leftovers.find(l => {
          if (firstStatLine >= 0 && l.li > firstStatLine + 1) return false;
          if (belowAttr(lines, l.li)) return false;
          const cn = cleanName(l.text);
          return cn && cn.length <= 40 && !isBadNameLine(l.text) && !isBadNameLine(cn);
        });
        if (cand) { name = cleanName(cand.text); nameLine = cand.li; }
      }
    }
    const fm = /^(.+?)\s*[(（]([ぁ-んァ-ヶー\s]+)[)）]$/.exec(name); if (fm) { name = fm[1].trim(); furigana = fm[2].trim(); }
    if (!name) { name = '名称未設定NPC'; warnings.push('名前を判別できませんでした。入力してください'); }

    // ---- メモ（どれにも当てはまらなかった行） ----
    const memoLines = [];
    if (furigana) memoLines.push('読み: ' + furigana);
    if (info.length) memoLines.push(info.join(' / '));
    if (exprNotes.length) memoLines.push('能力値式: ' + exprNotes.join(' / '));
    leftovers.forEach(l => { if (l.li === nameLine) return; const t = l.text.replace(/^[\s,、，;；:：]+|[\s,、，;；]+$/g, ''); if (t && t !== nameFromLabel) memoLines.push(t); });

    // ---- 版の判定 ----
    const abilVals = ABILITY_ORDER.filter(k => found[k]).map(k => found[k].value);
    let edition = o.edition === '6' || o.edition === '7' ? o.edition : (abilVals.some(v => v > 21) ? '7' : '6');

    // ---- ステータス／パラメータ ----
    const status = [];
    STATUS_ORDER.forEach(k => { if (found[k]) status.push({ label: k, value: found[k].value, max: found[k].max != null ? found[k].max : found[k].value }); });
    const params = [];
    ABILITY_ORDER.forEach(k => { if (found[k]) params.push({ label: k, value: String(found[k].value) }); });
    if (found.LUK) params.push({ label: 'LUK', value: String(found.LUK.value) });
    if (db) params.push({ label: 'DB', value: db });
    if (build) params.push({ label: 'ビルド', value: build });
    if (move) params.push({ label: '移動率', value: move });
    if (found.ARMOR) params.push({ label: '装甲', value: String(found.ARMOR.value) });

    if (!found.HP) warnings.push('HP を検出できませんでした');
    if (!abilVals.length) warnings.push('能力値（STR・DEX など）を検出できませんでした');
    if (!skills.length) warnings.push('技能（「目星 60%」のような記述）を検出できませんでした');
    if (skills.some(s => !s.known)) warnings.push('辞書に無い技能名があります（「要確認」の行を見てください）');

    const draft = {
      name, memo: memoLines.join('\n'), initiative: found.DEX ? found.DEX.value : 0,
      status, params, skills, edition, rollPrefix: o.rollPrefix, warnings, source: String(raw == null ? '' : raw),
      iconDataUrl: null, iconName: '', externalUrl: ''
    };
    const Sys = o.system && getSys();
    if (Sys) {   // 全9システム対応：システム固有の抽出とチャパレ生成
      draft.system = o.system; draft.sysOpts = Object.assign(Sys.defaultOpts(), o.sysOpts || {});
      Sys.extract(draft, raw);
    }
    draft.commands = buildCommands(draft, { abilityRolls: o.abilityRolls });
    return draft;
  }

  /** 技能・武器・能力値から、チャットパレット（改行区切り）を生成する */
  function buildCommands(d, opts) {
    const Sys = d.system && getSys(); if (Sys) return Sys.build(d, opts);
    const o = Object.assign({ abilityRolls: true }, opts || {}), P = d.rollPrefix || 'CCB', out = [];
    const has = k => (d.params || []).some(p => p.label === k) || (d.status || []).some(s => s.label === k);
    if (o.abilityRolls) {
      const mult = d.edition === '7' ? '' : '*5';
      ABILITY_ORDER.forEach(k => { if (has(k)) out.push(P + '<={' + k + '}' + mult + ' 【' + k + '】'); });
      if (has('SAN')) out.push(P + '<={SAN} 【SANチェック】');
    }
    (d.skills || []).forEach(s => {
      if (s.include === false) return;
      out.push(P + '<=' + s.value + ' 【' + s.name + '】');
      if (s.damage) out.push(s.damage + ' 【' + s.name + 'ダメージ】');
    });
    return out.join('\n');
  }

  const api = { parseNpc, splitNpcBlocks, buildCommands, foldTables, substituteDb, ABILITY_ORDER, STATUS_ORDER, KNOWN_SKILLS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CCFNpc = api;
})();
