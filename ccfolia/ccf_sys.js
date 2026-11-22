/* ccf_sys.js — ココフォリア特化ツール STEP 4：全9システム対応（システム別の抽出・チャパレ生成。DOM／Electron に依存しない純粋関数）
 *
 *   SYSTEMS                      … 選択できるシステム一覧
 *   defaultOpts / parseOpts(s)   … システム別オプションの初期値／部屋設定から作る初期値
 *   extract(draft, raw)          … NPC ドラフト（system 設定済み）に、システム固有のステータス・技能・メモを抽出して上書き
 *   build(draft, opts)           … ドラフトからチャットパレット（改行区切り）を生成（先頭 s でシークレットダイス）
 *   OPTION_DEFS / SKILL_COLS / EXTRA_FIELDS / newSkill … 確認・修正ポップアップ用の UI 定義 */
(function () {
  'use strict';
  const SYSTEMS = [
    { id: 'coc6', name: 'CoC 6版' }, { id: 'coc7', name: 'CoC 7版' }, { id: 'emoklore', name: 'エモクロアTRPG' },
    { id: 'twod6', name: 'インセイン / シノビガミ（2D6汎用）' }, { id: 'dx3', name: 'ダブルクロス 3rd (DX3rd)' },
    { id: 'sw25', name: 'ソード・ワールド 2.5' }, { id: 'futari', name: 'フタリソウサ' }, { id: 'stratera', name: 'ストリテラ' },
    { id: 'madamis', name: 'マーダーミステリー（マダミス）' }
  ];
  const IDS = SYSTEMS.map(s => s.id);
  const norm = s => String(s == null ? '' : s).normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '').replace(/[ \t\u3000]+/g, ' ');
  const BASE_OPTS = { statusPublic: true, secretDice: false, renda: false, cbrb: true, resb: true, hardExt: false, bpDice: false, target: 5, role: 'both', cbrbPairs: [] };
  const defaultOpts = () => JSON.parse(JSON.stringify(BASE_OPTS));
  const optsFromSettings = s => { const o = defaultOpts(); s = s || {}; Object.keys(BASE_OPTS).forEach(k => { if (k in s && typeof s[k] === typeof BASE_OPTS[k]) o[k] = s[k]; }); return o; };
  const parseOpts = s => ({ system: IDS.includes(s && s.system) ? s.system : 'coc6', sysOpts: optsFromSettings(s) });

  const SECRET = ['secretDice', 'chk', 'シークレットダイス（コマンド先頭に s）'];
  const OPTION_DEFS = {
    coc6: [SECRET, ['renda', 'chk', '攻撃技能に連撃（x2）を併記'], ['cbrb', 'chk', 'マーシャルアーツ＋こぶし等の CBRB を自動併記'], ['resb', 'chk', 'STR/CON/POW/DEX の対抗ロール RESB を併記']],
    coc7: [SECRET, ['hardExt', 'chk', 'ハード(/2)・イクストリーム(/5) を併記'], ['bpDice', 'chk', 'ボーナス/ペナルティダイス（B1/P1）を併記']],
    emoklore: [SECRET], twod6: [SECRET, ['target', 'num', '目標値（2D6>=）']], dx3: [SECRET], sw25: [SECRET],
    futari: [SECRET, ['role', 'sel', '判定', [['both', '探偵(DT)＋助手(AS)'], ['DT', '探偵 DT のみ'], ['AS', '助手 AS のみ']]]],
    stratera: [], madamis: []
  };
  const C_INC = { k: 'include', l: '含める', type: 'checkbox' }, C_NAME = { k: 'name', l: '技能名', type: 'text' };
  const SKILL_COLS = {
    coc6: [C_INC, C_NAME, { k: 'value', l: '技能値', type: 'number', w: '64px' }, { k: 'damage', l: 'ダメージ', type: 'text', w: '110px' }, { k: 'multi', l: '連撃', type: 'checkbox' }],
    coc7: [C_INC, C_NAME, { k: 'value', l: '技能値', type: 'number', w: '64px' }, { k: 'damage', l: 'ダメージ', type: 'text', w: '110px' }],
    emoklore: [C_INC, Object.assign({}, C_NAME, { l: '技能名 〈〉' }), { k: 'lv', l: 'Lv(1-3)', type: 'number', w: '56px' }, { k: 'value', l: 'ベース値', type: 'number', w: '64px' }],
    twod6: [C_INC, Object.assign({}, C_NAME, { l: '特技名' }), { k: 'value', l: '目標値', type: 'number', w: '64px' }],
    dx3: [C_INC, Object.assign({}, C_NAME, { l: 'コンボ/技能' }), { k: 'lv', l: 'ダイス', type: 'number', w: '56px' }, { k: 'value', l: 'C値', type: 'number', w: '56px' }, { k: 'mod', l: '修正', type: 'number', w: '56px' }],
    futari: [C_INC, Object.assign({}, C_NAME, { l: '捜査技能' })]
  };
  const EXTRA_FIELDS = {
    stratera: [['omote', '【オモテ】'], ['ura', '【ウラ】'], ['keywords', 'キーワード（改行・読点区切り）']],
    madamis: [['profile', 'プロフィール'], ['age', '年齢'], ['relation', '関係'], ['info', '初期情報（チャパレへ）'], ['timeline', 'タイムライン（チャパレへ）']]
  };
  const NEW_SKILL = {
    coc6: { value: 50 }, coc7: { value: 50 }, emoklore: { lv: 1, value: 5 }, twod6: { value: 5 }, dx3: { lv: 1, value: 10, mod: 0 }, futari: { value: 0 }
  };
  const newSkill = (sys, o) => Object.assign({ name: '', value: 0, known: true, include: true, damage: '' }, NEW_SKILL[sys] || {}, sys === 'twod6' && o ? { value: o.target || 5 } : {});

  // ---------- 抽出の共通部品 ----------
  const mk = (name, extra) => Object.assign({ name, value: 0, known: true, include: true, damage: '' }, extra || {});
  function nums(src, label) {
    const m = new RegExp('(?<![A-Za-z])(?:' + label + ')\\s*[:=]?\\s*(\\d{1,4})(?:\\s*/\\s*(\\d{1,4}))?(?:\\s*\\(\\s*(\\d{1,4})\\s*\\))?', 'i').exec(src);
    return m ? { v: +m[1], max: m[2] != null ? +m[2] : null, fixed: m[3] != null ? +m[3] : null } : null;
  }
  const stat = (label, n, max) => ({ label, value: n.v, max: max != null ? max : (n.max != null ? n.max : n.v) });
  /** 「【オモテ】…【ウラ】…」「年齢：…」のような見出しごとの本文を取り出す */
  function sections(src, heads) {
    const alt = heads.join('|'), re = new RegExp('(?:【\\s*(' + alt + ')\\s*】|(?:^|\\n)\\s*(' + alt + ')\\s*[:：])', 'g'), hits = []; let m;
    while ((m = re.exec(src))) hits.push({ key: m[1] || m[2], e: re.lastIndex, s: m.index });
    const out = {};
    hits.forEach((h, i) => { const t = src.slice(h.e, i + 1 < hits.length ? hits[i + 1].s : src.length).replace(/^[\s:：]+|\s+$/g, ''); if (!(h.key in out)) out[h.key] = t; });
    return out;
  }
  const pushUniq = (arr, sk) => { if (sk.name && !arr.some(x => x.name === sk.name)) arr.push(sk); };
  const lineList = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);

  // ---------- システム別の抽出 ----------
  const COMBAT = /拳銃|ライフル|ショットガン|マシンガン|こぶし|パンチ|キック|頭突き|組みつき|組み付き|マーシャル|武道|ナイフ|剣|斧|弓|投擲|攻撃|格闘|近接|射撃|火炎|爪|牙|噛|殴|蹴/;
  const FUTARI_SKILLS = ['嘘', '変化', '外見', '物理', '現場', '天気', '交通', '情報', '指紋', '科学', '法医学', '生物', '社交', '家事', '噂話', '説得', '旅行', 'ビジネス', '捕縛', '防御', '根性', '体力', '突破', '追跡'];
  const STOP = /^(?:特技|技能|生命力|正気度|HP|MP|SAN|能力値|オモテ|ウラ|キーワード|ステータス|データ|コンボ|名前|NPC)$/;
  const DX_SK = '白兵|射撃|RC|交渉|回避|運転|芸術|知識|情報|調達|知覚|意志|肉体|感覚|精神|社会';

  const EXTRACT = {
    coc6(d) { d.edition = '6'; d.rollPrefix = 'CCB'; },
    coc7(d) { d.edition = '7'; d.rollPrefix = 'CC'; },
    emoklore(d, src) {
      const w = []; d.status = []; d.params = []; d.skills = [];
      [['HP', 'HP|耐久'], ['MP', 'MP'], ['共鳴', '共鳴値?']].forEach(([l, re]) => { const n = nums(src, re); if (n) d.status.push(stat(l, n)); });
      let m; const r1 = /(\d)\s*DM\s*<=?\s*(\d{1,2})\s*[〈<《【]\s*([^〉>》】\n]{1,12}?)\s*[〉>》】]/gi;
      while ((m = r1.exec(src))) pushUniq(d.skills, mk(m[3], { lv: +m[1], value: +m[2] }));
      const r2 = /[〈<《【]?\s*([^\s〈〉<>《》【】\d:：,、/]{1,10}?)\s*[〉>》】]?\s*[:：]?\s*(?:Lv|LV|レベル)\s*\.?\s*([1-3])(?:[\s,、/]*(?:ベース(?:値)?|判定値?|基準値?|値)?\s*[:：]?\s*(\d{1,2}))?/gi;
      while ((m = r2.exec(src))) { if (!STOP.test(m[1])) pushUniq(d.skills, mk(m[1], { lv: +m[2], value: m[3] != null ? +m[3] : 0 })); }
      if (!d.status.length) w.push('HP / MP / 共鳴 を検出できませんでした');
      if (!d.skills.length) w.push('技能（「〈運動〉 Lv2 ベース値5」のような記述）を検出できませんでした');
      if (d.skills.some(s => !s.value)) w.push('ベース値が不明な技能があります。判定値を入力してください');
      d.warnings = w;
    },
    twod6(d, src) {
      d.status = []; d.params = []; d.skills = []; const w = [], t = (d.sysOpts && d.sysOpts.target) || 5;
      [['生命力', '生命力|HP'], ['正気度', '正気度|SAN']].forEach(([l, re]) => { const n = nums(src, re); if (n) d.status.push(stat(l, n)); });
      let m; const rl = /特技\s*[:：]\s*(.+)/g;
      while ((m = rl.exec(src))) m[1].split(/[,、/／・\s]+/).map(x => x.replace(/^[〈《【\[「]+|[〉》】\]」]+$/g, '').trim()).filter(x => x && x.length <= 12 && !STOP.test(x)).forEach(x => pushUniq(d.skills, mk(x, { value: t })));
      const rr = /2D6\s*>=\s*(\d{1,2})\s*[【〈《]([^】〉》\n]{1,12})[】〉》]/gi;
      while ((m = rr.exec(src))) pushUniq(d.skills, mk(m[2], { value: +m[1] }));
      const rb = /[〈《【]([^〉》】\n]{1,10})[〉》】]/g;
      while ((m = rb.exec(src))) { const x = m[1].trim(); if (x && !STOP.test(x) && !/\d/.test(x)) pushUniq(d.skills, mk(x, { value: t })); }
      if (!d.status.length) w.push('生命力 / 正気度 を検出できませんでした');
      if (!d.skills.length) w.push('特技（「特技: 〈目星〉〈聞き耳〉」のような記述）を検出できませんでした');
      d.warnings = w;
    },
    dx3(d, src) {
      d.status = []; d.params = []; d.skills = []; const w = [];
      [['HP', 'HP'], ['侵蝕率', '侵蝕率|侵食率|侵蝕|侵食'], ['ロイス', 'ロイス']].forEach(([l, re]) => { const n = nums(src, re); if (n) d.status.push(stat(l, n, l === '侵蝕率' ? 300 : null)); });
      let m; const sgn = x => (x ? +String(x).replace(/\s+/g, '') : 0);
      const r1 = /\(?\s*(\d{1,2})\s*DX\s*(\d{0,2})\s*([+\-]\s*\d{1,2})?\s*\)?\s*[〈【《]([^〉】》\n]{1,16})[〉】》]/gi;
      while ((m = r1.exec(src))) pushUniq(d.skills, mk(m[4], { lv: +m[1], value: +m[2] || 10, mod: sgn(m[3]) }));
      const r2 = /[〈【《]([^〉】》\n]{1,16})[〉】》]\s*[:：]?\s*\(?\s*(\d{1,2})\s*DX\s*(\d{0,2})\s*([+\-]\s*\d{1,2})?\s*\)?/gi;
      while ((m = r2.exec(src))) pushUniq(d.skills, mk(m[1], { lv: +m[2], value: +m[3] || 10, mod: sgn(m[4]) }));
      const r3 = new RegExp('(' + DX_SK + ')\\s*[:：]?\\s*[LlＬ]?\\s*(\\d{1,2})(?![\\dDd])', 'g');
      while ((m = r3.exec(src))) pushUniq(d.skills, mk(m[1], { lv: 1, value: 10, mod: +m[2] }));
      if (!d.status.length) w.push('HP / 侵蝕率 / ロイス を検出できませんでした');
      if (!d.skills.length) w.push('コンボ・技能（「(3DX10+2) 【コンボ】」のような記述）を検出できませんでした');
      d.warnings = w;
    },
    sw25(d, src) {
      d.status = []; d.params = []; d.skills = []; const w = [];
      const lines = src.split('\n'), partN = nums(src, '部位数'), parts = [];
      lines.forEach(l => { const m = /^\s*([^\s:：\d()]{1,8})[\s:：(]*.*?(?<![A-Za-z])HP\s*[:=]?\s*(\d{1,4})/i.exec(l); if (m && !/^(?:HP|MP|ステータス|データ)/i.test(m[1])) { const mp = /(?<![A-Za-z])MP\s*[:=]?\s*(\d{1,4})/i.exec(l), ar = /防護点?\s*[:=]?\s*(\d{1,3})/.exec(l); parts.push({ n: m[1], hp: +m[2], mp: mp ? +mp[1] : null, ar: ar ? +ar[1] : null }); } });
      const hp = nums(src, 'HP'), mp = nums(src, 'MP'), ar = nums(src, '防護点?');
      if (parts.length >= 2) {
        parts.forEach(p => { d.status.push({ label: 'HP(' + p.n + ')', value: p.hp, max: p.hp }); if (p.mp != null) d.status.push({ label: 'MP(' + p.n + ')', value: p.mp, max: p.mp }); if (p.ar != null) d.params.push({ label: '防護点(' + p.n + ')', value: String(p.ar) }); });
      } else if (partN && partN.v > 1) {
        for (let i = 1; i <= partN.v; i++) { if (hp) d.status.push({ label: 'HP(部位' + i + ')', value: hp.v, max: hp.v }); if (mp) d.status.push({ label: 'MP(部位' + i + ')', value: mp.v, max: mp.v }); if (ar) d.params.push({ label: '防護点(部位' + i + ')', value: String(ar.v) }); }
      } else { if (hp) d.status.push(stat('HP', hp)); if (mp) d.status.push(stat('MP', mp)); if (ar) d.params.push({ label: '防護点', value: String(ar.v) }); }
      if (partN) d.params.push({ label: '部位数', value: String(partN.v) });
      [['命中力', '命中力?'], ['打撃点', '打撃点'], ['回避力', '回避力?'], ['生命抵抗力', '生命抵抗力?|生命抵抗'], ['精神抵抗力', '精神抵抗力?|精神抵抗']].forEach(([l, re]) => { const n = nums(src, re); if (n) d.params.push({ label: l, value: String(n.v) }); });
      if (!d.status.length) w.push('HP / MP を検出できませんでした');
      if (!d.params.some(p => p.label === '命中力')) w.push('命中力・回避力などを検出できませんでした');
      d.warnings = w;
    },
    futari(d, src) {
      d.status = []; d.params = []; d.skills = []; const w = [];
      const h = /異常な?癖\s*[:：]\s*(.+)/.exec(src); if (h) d.params.push({ label: '異常癖', value: h[1].trim().slice(0, 60) });
      const sk = /捜査技能\s*[:：]\s*(.+)/.exec(src);
      if (sk) sk[1].split(/[,、/／・\s]+/).map(x => x.replace(/^[〈《【\[「]+|[〉》】\]」]+$/g, '').trim()).filter(x => x && x.length <= 10).forEach(x => pushUniq(d.skills, mk(x)));
      FUTARI_SKILLS.forEach(n => { if (src.includes('〈' + n + '〉') || src.includes('【' + n + '】')) pushUniq(d.skills, mk(n)); });
      if (!d.params.length) w.push('異常癖を検出できませんでした');
      if (!d.skills.length) w.push('捜査技能を検出できませんでした');
      d.warnings = w;
    },
    stratera(d, src) {
      d.status = [{ label: '花束', value: 0, max: 0 }]; d.params = []; d.skills = [];
      const s = sections(src, ['オモテ', 'ウラ', 'キーワード']);
      d.extra = { omote: s['オモテ'] || '', ura: s['ウラ'] || '', keywords: s['キーワード'] || '' };
      d.memo = memoFor(d); d.warnings = (s['オモテ'] || s['ウラ'] || s['キーワード']) ? [] : ['【オモテ】【ウラ】キーワード の見出しを検出できませんでした'];
    },
    madamis(d, src) {
      d.status = []; d.params = []; d.skills = [];
      const s = sections(src, ['プロフィール', '年齢', '関係性?', '人間関係', '初期情報', 'タイムライン']), any = Object.keys(s).length;
      d.extra = { profile: s['プロフィール'] || (any ? '' : src.trim()), age: s['年齢'] || '', relation: s['関係'] || s['関係性'] || s['人間関係'] || '', info: s['初期情報'] || '', timeline: s['タイムライン'] || '' };
      d.memo = memoFor(d); d.warnings = any ? [] : ['見出し（プロフィール／年齢／関係／初期情報／タイムライン）を検出できず、全文をプロフィールに入れました'];
    }
  };
  /** ストリテラ・マダミスの「📝 メモ欄」の文章（extra から組み立てる） */
  function memoFor(d) {
    const x = d.extra || {}, out = [];
    if (d.system === 'stratera') { if (x.omote) out.push('【オモテ】' + x.omote); if (x.ura) out.push('【ウラ】' + x.ura); if (x.keywords) out.push('【キーワード】' + x.keywords); }
    else { if (x.profile) out.push('【プロフィール】' + x.profile); if (x.age) out.push('【年齢】' + x.age); if (x.relation) out.push('【関係】' + x.relation); }
    return out.join('\n');
  }
  function extract(d, raw) {
    const f = EXTRACT[d.system]; if (!f) return d;
    f(d, norm(raw)); return d;
  }

  // ---------- チャットパレット生成 ----------
  const ABIL = ['STR', 'CON', 'POW', 'DEX', 'APP', 'SIZ', 'INT', 'EDU'];
  const MA = /マーシャルアーツ|武道/, STRIKE = /こぶし|パンチ|キック|頭突き|組みつき|組み付き/;
  const incl = d => (d.skills || []).filter(s => s.include !== false);

  function buildCoc(d, o, ab) {
    const six = d.system !== 'coc7', P = six ? 'CCB' : 'CC', sec = o.secretDice ? 's' : '', out = [];
    const has = k => (d.params || []).some(p => p.label === k) || (d.status || []).some(s => s.label === k);
    if (ab !== false) {
      ABIL.forEach(k => { if (has(k)) out.push(sec + P + '<={' + k + '}' + (six ? '*5' : '') + ' 【' + k + '】'); });
      if (has('SAN')) out.push(sec + P + '<={SAN} 【SANチェック】');
    }
    incl(d).forEach(s => {
      out.push(sec + P + '<=' + s.value + ' 【' + s.name + '】');
      if (six && (s.multi || (o.renda && COMBAT.test(s.name)))) out.push(sec + 'x2 ' + P + '<=' + s.value + ' 【' + s.name + '・連撃】');
      if (!six && o.hardExt) { out.push(sec + 'CC<=' + s.value + '/2 【' + s.name + '(ハード)】'); out.push(sec + 'CC<=' + s.value + '/5 【' + s.name + '(イクストリーム)】'); }
      if (!six && o.bpDice) { out.push(sec + 'CC(1)<=' + s.value + ' 【' + s.name + '】B1'); out.push(sec + 'CC(-1)<=' + s.value + ' 【' + s.name + '】P1'); }
      if (s.damage) out.push(s.damage + ' 【' + s.name + 'ダメージ】');
    });
    if (six && o.cbrb !== false) {
      const sk = incl(d), seen = new Set(), add = (a, b) => { const k = a.name + '|' + b.name; if (a === b || seen.has(k)) return; seen.add(k); out.push(sec + 'CBRB(' + a.value + ',' + b.value + ') 【' + a.name + '＋' + b.name + '】'); };
      sk.filter(s => MA.test(s.name)).forEach(a => sk.filter(s => STRIKE.test(s.name)).forEach(b => add(a, b)));
      (o.cbrbPairs || []).forEach(p => { const a = sk.find(s => s.name === p[0]), b = sk.find(s => s.name === p[1]); if (a && b) add(a, b); });
    }
    if (six && o.resb !== false) ['STR', 'CON', 'POW', 'DEX'].forEach(k => { if (has(k)) out.push(sec + 'RESB({' + k + '}, ) ' + k + '対抗'); });
    return out;
  }
  const BUILD = {
    coc6: buildCoc, coc7: buildCoc,
    emoklore: (d, o) => incl(d).map(s => (o.secretDice ? 's' : '') + (s.lv || 1) + 'DM<=' + s.value + ' 〈' + s.name + '〉'),
    twod6: (d, o) => incl(d).map(s => (o.secretDice ? 's' : '') + '2D6>=' + (s.value || o.target || 5) + ' 【' + s.name + '】'),
    dx3: (d, o) => incl(d).map(s => (o.secretDice ? 's' : '') + '(' + (s.lv || 1) + 'DX' + (s.value || 10) + (s.mod ? (s.mod > 0 ? '+' : '') + s.mod : '') + ') 【' + s.name + '】'),
    sw25(d, o) {
      const sec = o.secretDice ? 's' : '', out = [], has = k => (d.params || []).some(p => p.label === k);
      [['命中力', '命中力'], ['回避力', '回避力'], ['生命抵抗力', '生命抵抗力'], ['精神抵抗力', '精神抵抗力']].forEach(([k, l]) => { if (has(k)) { out.push(sec + '2d6+{' + k + '} ' + l + '判定'); out.push('{' + k + '}+7 ' + l + '(固定値)'); } });
      if (has('打撃点')) out.push('{打撃点} 打撃点');
      return out;
    },
    futari(d, o) {
      const sec = o.secretDice ? 's' : '', out = [], dt = o.role !== 'AS', as = o.role !== 'DT';
      if (dt) out.push(sec + 'DT 【探偵判定】', sec + '3DT 【探偵判定(有利)】', sec + '1DT 【探偵判定(不利)】');
      if (as) out.push(sec + 'AS 【助手判定】', sec + '3AS 【助手判定(有利)】', sec + '1AS 【助手判定(不利)】');
      incl(d).forEach(s => { if (dt) out.push(sec + '3DT 【' + s.name + '(有利)】'); if (as) out.push(sec + '3AS 【' + s.name + '(有利)】'); });
      out.push('SHRD 【異常な癖表】');
      return out;
    },
    stratera(d) {
      const x = d.extra || {}, out = [];
      if (x.omote) out.push('【オモテ宣言】' + x.omote.replace(/\n+/g, ' '));
      if (x.ura) out.push('【ウラ宣言】' + x.ura.replace(/\n+/g, ' '));
      String(x.keywords || '').split(/[\n、,，/／]+/).map(k => k.trim()).filter(Boolean).forEach(k => out.push('【キーワード】' + k));
      return out;
    },
    madamis(d) {
      const x = d.extra || {}, out = [];
      lineList(x.info).forEach(l => out.push('【初期情報】' + l)); lineList(x.timeline).forEach(l => out.push('【タイムライン】' + l));
      return out;
    }
  };
  function build(d, opts) {
    const f = BUILD[d.system]; if (!f) return '';
    const o = Object.assign(defaultOpts(), d.sysOpts || {});
    return f(d, o, opts && opts.abilityRolls).join('\n');
  }

  const api = { SYSTEMS, defaultOpts, optsFromSettings, parseOpts, OPTION_DEFS, SKILL_COLS, EXTRA_FIELDS, newSkill, extract, build, memoFor, sections };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CCFSys = api;
})();
