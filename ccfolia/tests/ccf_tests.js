// Phase 1 の純粋ロジック（整形・矩形抽出・NPCパース・ダミー駒）のテスト。  使い方: node ccfolia/tests/ccf_tests.js
const T = require('../ccf_text.js'), N = require('../ccf_npc.js'), M = require('../ccf_model.js'), S = require('../ccf_scan.js'), SM = require('../ccf_scene_match.js');
let ng = 0, ok = 0;
const t = (c, m, extra) => { if (c) ok++; else { ng++; console.log('NG  ' + m + (extra !== undefined ? '\n    → ' + JSON.stringify(extra) : '')); } };
const eq = (a, b, m) => t(JSON.stringify(a) === JSON.stringify(b), m, a);

// ===== cleanText =====
eq(T.cleanText('探索者たちは\n村に到着した。\n夕暮れが迫って\nいる。'), '探索者たちは村に到着した。\n夕暮れが迫っている。', '折り返し改行を除去し、文末の改行は残す');
eq(T.cleanText('あ い う え お'), 'あいうえお', '日本語どうしの空白を除去');
eq(T.cleanText('HP 10  MP   5'), 'HP 10 MP 5', '連続空白は1つに（英数の間の空白は残す）');
eq(T.cleanText('Hello wor-\nld and\nmore'), 'Hello world and more', '英語のハイフネーションと折り返し');
eq(T.cleanText('■ 導入\n探索者は呼び出された。\n「こんにちは」\n「やあ」'), '■ 導入\n探索者は呼び出された。\n「こんにちは」\n「やあ」', '見出し・かぎ括弧は改行を維持');
eq(T.cleanText('段落一つ目の\n続き。\n\n\n\n段落二つ目。'), '段落一つ目の続き。\n\n段落二つ目。', '空行は1つに');
eq(T.cleanText('　字下げの段落\nです。\n　次の段落。'), '字下げの段落です。\n次の段落。', '全角空白の字下げは新段落');
eq(T.cleanText('a\nb\nc', { joinLines: 'none' }), 'a\nb\nc', 'none は改行維持');
eq(T.cleanText('文末で\n切れる。\n次の行', { joinLines: 'all' }), '文末で切れる。次の行', 'all は全連結');
eq(T.cleanText('1.\u200B最初\n2. 二番目'), '1.最初\n2. 二番目', 'ゼロ幅文字除去・番号付きは改行維持');
eq(T.cleanText('『文学』は生きる上で絶対に必要という訳\nではない。\n嗜好品。贅沢品。不用品。'), '『文学』は生きる上で絶対に必要という訳ではない。\n嗜好品。贅沢品。不用品。', '2段組の短め折り返し行も結合し、文末の改行は残す');
eq(T.cleanText('彼は有名な作家で、\nHO1 の古くからの文学の師。\n普段は穏やかで、\nHO1 の代わりにメディアへの受け答えもしている。'), '彼は有名な作家で、HO1 の古くからの文学の師。\n普段は穏やかで、HO1 の代わりにメディアへの受け答えもしている。', '本文中の HO1 等を見出し誤認せず結合');
eq(T.cleanText('幼馴染の\nHO2 の友人であり、\nHO1の親友。\nHO1：導入\nHO1【秘匿】\nKP情報\nHO1（秘密）'), '幼馴染のHO2 の友人であり、HO1の親友。\nHO1：導入\nHO1【秘匿】\nKP情報\nHO1（秘密）', '見出し記号・短いラベルのみの HO/KP は改行を維持');
eq(T.cleanText(''), '', '空文字');
eq(T.cleanText(null), '', 'null');

// ===== 矩形抽出（合成データ：ビューポート scale=1, 高さ 800, y反転） =====
const VP = [1, 0, 0, -1, 0, 800];
const item = (s, x, ybase, w, h) => ({ str: s, transform: [h, 0, 0, h, x, 800 - ybase], width: w, height: h });   // PDF座標ではなく「画面の y=ybase」になるよう設定
// 2段組：左段 x=50..250 / 右段 x=300..500。左段 3行・右段 3行。PDF のストリーム順は意図的に左右交互。
const items = [
  item('左一行目', 50, 100, 80, 16), item('右一行目', 300, 100, 80, 16),
  item('左二行目', 50, 120, 80, 16), item('右二行目', 300, 120, 80, 16),
  item('左三行目', 50, 140, 80, 16), item('右三行目', 300, 140, 80, 16),
  item('STR', 50, 200, 30, 12), item('12', 120, 200, 16, 12), item('CON', 200, 200, 30, 12), item('14', 260, 200, 16, 12)];
// viewport y = 800 - transform[5] の形に合わせる：transform[5] = 800 - ybase → 画面 y = 800 - (800 - ybase) = ybase ✓.
eq(T.extractRectText(items, VP, 1, { x: 40, y: 80, w: 220, h: 70 }), '左一行目\n左二行目\n左三行目', '2段組：左段だけを矩形で取る');
eq(T.extractRectText(items, VP, 1, { x: 290, y: 80, w: 220, h: 70 }), '右一行目\n右二行目\n右三行目', '2段組：右段だけを矩形で取る');
eq(T.extractRectText(items, VP, 1, { x: 40, y: 80, w: 480, h: 70 }), '左一行目\n左二行目\n左三行目\n右一行目\n右二行目\n右三行目', '段をまたいで同じ高さでも横結合せず、左段→右段の順に分離');
eq(T.extractRectText(items, VP, 1, { x: 260, y: 150, w: -230, h: 70 }), 'STR 12 CON', '負の幅・高さ（右下→左上へのドラッグ）に対応');
eq(T.extractRectText(items, VP, 1, { x: 600, y: 600, w: 10, h: 10 }), '', '何も無い場所は空文字');
// 文字単位の切り出し：「左一行目」の途中(左2文字)だけを囲む
eq(T.extractRectText([item('ABCDEFGH', 50, 100, 80, 16)], VP, 1, { x: 45, y: 90, w: 25, h: 20 }), 'AB', '1行の途中だけを矩形で切り出せる（文字単位）');
// 端の文字の許容マージン（L.h * 0.25）と単一カラム内フォント境界スペースの連結
eq(T.extractRectText([item('あいうえお', 50, 100, 80, 16)], VP, 1, { x: 60, y: 90, w: 68, h: 20 }), 'あいうえお', '矩形の左右端にわずかに掛かる文字も許容マージンで欠落しない');
{
  const colItems = [
    item('HO1', 50, 100, 30, 14), item('の親友。幼馴染で', 98, 100, 110, 14),
    item('HO2', 50, 120, 30, 14), item('の古い友人でもあ', 98, 120, 110, 14),
    item('り、事件に巻き込まれ', 50, 140, 150, 14),
    item('た。', 50, 160, 28, 14)
  ];
  eq(T.extractRectText(colItems, VP, 1, { x: 45, y: 85, w: 200, h: 90 }, { pageW: 600, pageH: 800, twoColumn: false }), 'HO1 の親友。幼馴染で\nHO2 の古い友人でもあ\nり、事件に巻き込まれ\nた。', '片側カラム指定時は行内スペースで左右に分断されない');
  eq(T.extractRectText(colItems, VP, 1, { x: 45, y: 85, w: 200, h: 90 }), 'HO1 の親友。幼馴染で\nHO2 の古い友人でもあ\nり、事件に巻き込まれ\nた。', '2行以下の行内スペースはガター誤認しない');
}
// ストリーム順が逆でも読み順に並ぶ
eq(T.extractRectText([item('下', 50, 130, 16, 16), item('上', 50, 100, 16, 16)], VP, 1, { x: 0, y: 0, w: 500, h: 500 }), '上\n下', '位置で上→下に並べ替える');

// ===== NPC パース =====
const show = d => ({ name: d.name, status: d.status, params: d.params.map(p => p.label + '=' + p.value).join(','), skills: d.skills.map(s => s.name + ':' + s.value + (s.damage ? '/' + s.damage : '')).join(','), edition: d.edition });

{ // 6版 モンスター（改行つき）
  const raw = '深きものども\nSTR 15 CON 13 POW 10 DEX 11 APP - SIZ 14 INT 9 EDU -\nHP 14 MP 10 SAN 無し\nダメージボーナス +1D4\n武器: かぎ爪 50% 1D6+db、かみつき 30% 1D4\n技能: 隠れる 50%、忍び歩き 40%、水泳 90%\nSANチェック 0/1D6\n';
  const d = N.parseNpc(raw);
  eq(d.name, '深きものども', '6版: 名前');
  eq(d.status, [{ label: 'HP', value: 14, max: 14 }, { label: 'MP', value: 10, max: 10 }], '6版: HP/MP → ステータス（SAN 無し は出さない）');
  eq(d.params.map(p => p.label + '=' + p.value), ['STR=15', 'CON=13', 'POW=10', 'DEX=11', 'SIZ=14', 'INT=9', 'DB=+1D4'], '6版: 能力値 → パラメータ（APP - などは除外）');
  t(d.skills.some(s => s.name === 'かぎ爪' && s.value === 50 && s.damage === '1D6+1D4'), '6版: 武器と db 置換', show(d));
  t(d.skills.some(s => s.name === 'かみつき' && s.value === 30 && s.damage === '1D4'), '6版: 2つ目の武器', show(d));
  t(['隠れる', '忍び歩き', '水泳'].every(n => d.skills.some(s => s.name === n)), '6版: 技能', show(d));
  t(d.commands.includes('CCB<=50 【隠れる】') && d.commands.includes('CCB<=50 【かぎ爪】') && d.commands.includes('1D6+1D4 【かぎ爪ダメージ】'), 'チャパレ: CCB<=50 【技能】形式', d.commands);
  t(d.commands.includes('CCB<={STR}*5 【STR】') && d.commands.includes('CCB<={DEX}*5 【DEX】'), '6版: 能力値ロールは *5', d.commands);
  eq(d.edition, '6', '版の自動判定: 6');
  eq(d.initiative, 11, 'イニシアティブ = DEX');
  t(d.memo.includes('SANチェック'), '未分類の行はメモへ', d.memo);
  t(!d.skills.some(s => s.name === 'SAN'), 'SANチェック が技能にならない', show(d));
}
{ // 7版 コロン区切り・全角
  const d = N.parseNpc('【田中 太郎（たなか たろう）】\n職業:刑事 年齢:35\nＳＴＲ:60 ＣＯＮ:55 ＰＯＷ:50 ＤＥＸ:65 ＡＰＰ:45 ＳＩＺ:70 ＩＮＴ:75 ＥＤＵ:80\nHP:12 MP:10 SAN:50 LUK:45\nDB:+1D4 ビルド:1 移動率:8\n拳銃 70%(35/14) 言いくるめ:40％ 心理学 50 目星 65% 回避 32% 〈芸術(絵画)〉25%');
  eq(d.name, '田中 太郎', '7版: 名前（ふりがなは分離）');
  t(d.memo.includes('読み: たなか たろう') && d.memo.includes('職業: 刑事') && d.memo.includes('年齢: 35'), '7版: 職業・年齢・ふりがなはメモへ', d.memo);
  eq(d.edition, '7', '版の自動判定: 7（能力値 > 21）');
  eq(d.status.map(s => s.label + '=' + s.value + '/' + s.max), ['HP=12/12', 'MP=10/10', 'SAN=50/50'], '7版: ステータス');
  t(d.params.some(p => p.label === 'DB' && p.value === '+1D4') && d.params.some(p => p.label === 'ビルド' && p.value === '1') && d.params.some(p => p.label === '移動率' && p.value === '8') && d.params.some(p => p.label === 'LUK'), '7版: DB/ビルド/移動率/LUK', d.params);
  eq(d.skills.map(s => s.name + ':' + s.value).sort(), ['拳銃:70', '言いくるめ:40', '心理学:50', '目星:65', '回避:32', '芸術(絵画):25'].sort(), '7版: 技能（ハード/イクストリーム併記・全角％・コロン・括弧付き）');
  t(d.commands.includes('CCB<={STR} 【STR】') && !d.commands.includes('*5'), '7版: 能力値ロールは直接参照', d.commands);
  t(d.commands.includes('CCB<={SAN} 【SANチェック】'), 'SANチェック行');
}
{ // 表形式（ラベル行の下に数値行）
  const d = N.parseNpc('ショゴス\nSTR CON POW DEX\n80 90 30 15\nSIZ INT HP\n95 20 93\n触手 80% 2D6');
  eq(d.params.map(p => p.label + '=' + p.value), ['STR=80', 'CON=90', 'POW=30', 'DEX=15', 'SIZ=95', 'INT=20'], '表形式: ラベル行＋数値行');
  t(d.status.some(s => s.label === 'HP' && s.value === 93), '表形式: HP', d.status);
  t(d.skills.some(s => s.name === '触手' && s.damage === '2D6'), '表形式: 武器（辞書にない名前でも % があれば採用）', show(d));
  t(d.skills.find(s => s.name === '触手').known === false, '辞書に無い技能は known=false（要確認）');
}
{ // 縦に1語ずつ（表を矩形選択したときの形）
  const d = N.parseNpc('STR\n12\nCON\n13\nHP\n11');
  eq(d.params.map(p => p.label + '=' + p.value), ['STR=12', 'CON=13'], '縦1語ずつ: 能力値');
  t(d.status.some(s => s.label === 'HP' && s.value === 11), '縦1語ずつ: HP');
}
{ // 誤検出の抑制
  const d = N.parseNpc('村人\nHP 8\n身長 180cm 年齢 35歳 ターン 3回 目星 25');
  eq(d.skills.map(s => s.name), ['目星'], '数値＋単位（3回・35歳）や身長は技能にしない');
  eq(d.name, '村人', '名前');
  const e = N.parseNpc('「あなたは何を見ましたか？」と彼は言った。');
  t(e.warnings.length >= 3, '何も取れない文章には警告', e.warnings);
  const f = N.parseNpc('ステータス\nHP 5');
  eq(f.name, '名称未設定NPC', 'ヘッダだけの行は名前にしない');
}
{ // 名前ラベル・技能コンテキスト
  const d = N.parseNpc('名前: ゾンビA\nHP 12 STR 14\n技能: 噛みつき 25');
  eq(d.name, 'ゾンビA', '名前ラベル');
  t(d.skills.some(s => s.name === '噛みつき' && s.value === 25), '「技能:」行では % が無くても独自技能を採用', show(d));
}
{ // 版・接頭辞の指定
  const d = N.parseNpc('A\nSTR 12 HP 10\n目星 60%', { edition: '7', rollPrefix: 'CC' });
  t(d.commands.includes('CC<={STR} 【STR】') && d.commands.includes('CC<=60 【目星】'), '版・接頭辞のオプション', d.commands);
}
// ===== 複数NPCの分割 =====
{
  const raw = '深きもの\nSTR 15 CON 13 HP 14\n爪 50% 1D6\n\nショゴス\nSTR 80 CON 90 HP 93\n触手 80% 2D6';
  const bl = N.splitNpcBlocks(raw);
  eq(bl.length, 2, '複数NPCを2ブロックに分割');
  eq(N.parseNpc(bl[0]).name, '深きもの', '分割後 1つ目の名前');
  eq(N.parseNpc(bl[1]).name, 'ショゴス', '分割後 2つ目の名前');
  eq(N.splitNpcBlocks('A\nSTR 10 HP 5').length, 1, '1体なら分割しない');
}
// ===== ダミー駒 =====
{
  const stocks = [{ id: '1', title: '導入', text: '霧の深い夜、\n探索者は集められた。' }, { id: '2', title: '', text: '二つ目の本文です。' }];
  const lines = T.buildPaletteLines(stocks[0], { includeTitle: true, maxChars: 1000 });
  eq(lines, ['【導入】\\n霧の深い夜、\\n探索者は集められた。'], 'パレット行: 見出し＋\\n で1行化');
  eq(T.buildPaletteLines(stocks[1], { includeTitle: false }), ['二つ目の本文です。'], '見出しなし');
  eq(T.stockTitle(stocks[1], 4), '二つ目の…', '見出し未入力は本文先頭から');
  const long = '一文目です。二文目です。三文目です。四文目です。';
  const ch = T.chunkText(long, 20); t(ch.length >= 2 && ch.every(c => Array.from(c).length <= 20) && ch.join('') === long, '長文を文末で分割', ch);
  const many = Array.from({ length: 70 }, (_, i) => ({ id: 'x' + i, title: 'T' + i, text: 'テキスト' + i }));
  const pcs = M.buildDummyPieces(many, { maxLines: 30 });
  eq(pcs.map(p => p.name), ['シナリオテキスト (1/3)', 'シナリオテキスト (2/3)', 'シナリオテキスト (3/3)'], '70行 → 30行ずつ3体に分割');
  t(pcs.every(p => p.invisible === true && p.commands.split('\n').length <= 30), 'ダミー駒は盤面非表示・30行以内');
  eq(M.buildDummyPieces([], {}), [], 'ストックが空なら駒なし');
  const one = M.buildDummyPieces(stocks, {}); eq(one.length, 1, '少量なら1体'); eq(one[0].name, 'シナリオテキスト', '1体なら連番なし');
}
// ===== ココフォリア形式 =====
{
  const d = N.parseNpc('深きもの\nSTR 15 HP 14\n爪 50% 1D6');
  const json = JSON.parse(M.clipboardPayload(M.toCcfoliaCharacter(M.sanitizeNpc(d))));
  eq(json.kind, 'character', 'kind=character');
  t(json.data.name === '深きもの' && json.data.status[0].label === 'HP' && json.data.params[0].label === 'STR' && typeof json.data.commands === 'string' && json.data.commands.includes('CCB<=50 【爪】'), 'データ構造', json.data);
  const p = M.sanitizeProject({ npcs: [{ name: 'x', iconDataUrl: 'javascript:alert(1)' }, null], stocks: [{ text: '' }, { text: 'ok' }], settings: { maxLines: 99999, edition: 'z' } });
  t(p.npcs.length === 1 && p.npcs[0].iconDataUrl === null && p.stocks.length === 1 && p.settings.maxLines === 200 && p.settings.edition === 'auto', 'sanitizeProject（不正値の除去）', p);
}
// ===== 《技能名》(数値) 形式 =====
{
  const d = N.parseNpc('冰鞠(ヒョウリ)\nSTR:13 DEX:18 INT:15 CON:15\nAPP:17 POW:12 SIZ:10 EDU:10\nSAN:50 HP:13 MP:55\n技能\n《目星》(50) 《変装》(65) 《追跡》(60)\n《隠れる》(61)《聞き耳》(50)\n《ラテン語》 (61) 《言いくるめ》 (85)\n《クトゥルフ神話》 (50)\n《芸術(絵画)》(40) 《回避》50% 《信用》:30');
  eq(d.skills.map(s => s.name + ':' + s.value), ['目星:50', '変装:65', '追跡:60', '隠れる:61', '聞き耳:50', 'ラテン語:61', '言いくるめ:85', 'クトゥルフ神話:50', '芸術(絵画):40', '回避:50', '信用:30'], '《技能名》(数値) / 《技能名》 (数値) / 括弧なし % / コロン');
  t(d.commands.includes('CCB<=61 【ラテン語】') && d.commands.includes('CCB<=85 【言いくるめ】') && d.commands.includes('CCB<=50 【クトゥルフ神話】'), 'チャパレに反映', d.commands);
  t(!d.memo.includes('《'), '《》の技能がメモに残らない', d.memo);
  t(d.skills.every(s => s.known), '辞書に追加した言語技能は要確認にならない', d.skills.filter(s => !s.known));
}
{
  const d = N.parseNpc('触手のもの\nDEX:15 HP:50\n武器 透明な触手 《斬撃》(60) 《薙ぎ払い》(60)\n《掴む》(60)《防御》(DEX×2)\n《噛みつき》(40) 1D6+db');
  const m = Object.fromEntries(d.skills.map(s => [s.name, s]));
  t(m['斬撃'] && m['斬撃'].value === 60 && m['薙ぎ払い'] && m['掴む'], '武器行の《》技能', d.skills);
  eq(m['防御'] && m['防御'].value, 30, '(DEX×2) は DEX から計算（15×2=30）');
  eq(m['噛みつき'] && m['噛みつき'].damage, '1D6', '《技能》(値) の後ろのダメージ式（DB 無しなら +db を除去）');
  const e = N.parseNpc('A\nHP 10\n《防御》(DEX×2)');
  t(!e.skills.length && e.warnings.some(w => w.includes('防御')), 'DEX が無ければ計算せず警告');
  const f = N.parseNpc('B\nSTR 10 HP 5\n《目星》（70）《聞き耳》（60／30／12）');
  eq(f.skills.map(s => s.name + ':' + s.value), ['目星:70', '聞き耳:60'], '全角括弧・7版の(50/25/10)併記');
}
// ===== 英数字の半角／全角・{} 括り =====
eq(T.toHalfWidthAlnum('ＨＯ１が　ＡＢＣ１２３と、ｘｙｚ！'), 'HO1が　ABC123と、xyz！', '全角→半角（かな・記号・全角空白はそのまま）');
eq(T.toFullWidthAlnum('HO1とabc 99.'), 'ＨＯ１とａｂｃ ９９.', '半角→全角（記号は変えない）');
eq(T.toFullWidthAlnum(T.toHalfWidthAlnum('Ａ１ａ')), 'Ａ１ａ', '往復で変わらない');
{
  const r = T.wrapWord('HO1は探索者。HO10は別。ＨＯ１も同じ。すでに{HO1}は触らない。HO1,HO1', 'HO1');
  eq(r.text, '{HO1}は探索者。HO10は別。{HO1}も同じ。すでに{HO1}は触らない。{HO1},{HO1}', 'HO1 を {HO1} に（HO10 は除外・全角ゆれは統一・二重括りなし）');
  eq(r.count, 4, '置換数');
  eq(T.wrapWord('HO10 HO1', 'HO1', { wholeWord: false }).text, '{HO1}0 {HO1}', 'wholeWord=false なら部分一致も置換');
  eq(T.wrapWord('坂崎和也は社長。坂崎和也。', '坂崎和也').text, '{坂崎和也}は社長。{坂崎和也}。', '日本語の単語');
  eq(T.wrapWord('a.b と a.b', 'a.b').text, '{a.b} と {a.b}', '記号を含む単語（正規表現として解釈しない）');
  eq(T.wrapWord('abc', '').count, 0, '空の単語は何もしない');
  eq(T.wrapWord('HO1', '{HO1}').text, '{HO1}', '{} 付きで入力しても二重にならない');
}
// ===== STEP 5-Fix1: 画像保持・自動計算・同名統合・差分グループ化・特殊フォーマット =====
{
  const npc = M.sanitizeNpc({
    name: '立ち絵テスト',
    images: [{ path: '/tmp/oda_normal.png', dataUrl: 'data:image/png;base64,AAA', label: '通常' }, { path: '/tmp/oda_smile.png', label: '笑顔' }],
    iconDataUrl: null, image: '', imagePath: '', iconUrl: null, portrait: null
  });
  eq(npc.images.length, 2, 'images配列が再正規化後も消失しない');
  eq(npc.iconDataUrl, 'data:image/png;base64,AAA', 'images[0]のdataUrlを単一プロパティへ同期');
  eq(npc.imagePath, '/tmp/oda_normal.png', 'images[0]のpathをimagePathへ同期');
  eq(npc.portraits.length, 2, 'portraits配列も同期');
  const unsafe = M.sanitizeNpc({ name: 'x', images: [{ dataUrl: 'javascript:alert(1)' }, { dataUrl: 'javascript:alert(2)', path: '/ok.png' }] });
  eq(unsafe.images.length, 1, '危険なURLスキームのみの画像は除外し有効パスは安全に保持');
  eq(unsafe.images[0].dataUrl, '', '危険なdataUrlはクリア');
}
{
  const d6 = N.parseNpc('自動計算6版\nSTR:13×n CON:12 POW:14 DEX:11 APP:10 SIZ:14 INT:16 EDU:15 MP:(9+100)\n目星 50%');
  M.autoFillStats(d6);
  const st6 = Object.fromEntries(d6.status.map(s => [s.label, s.value]));
  const pr6 = Object.fromEntries(d6.params.map(p => [p.label, p.value]));
  const sk6 = Object.fromEntries(d6.skills.map(s => [s.name, s.value]));
  eq(pr6.STR, '13', 'STR:13×n から基本数値 13 を抽出');
  eq(st6.MP, 109, 'MP:(9+100) から合計 109 を抽出し原文を優先維持');
  t(d6.memo.includes('STR:13×n') && d6.memo.includes('MP:(9+100)'), '元の式表記をメモに保持', d6.memo);
  eq(st6.HP, 13, '6版 HP = Math.ceil((CON+SIZ)/2) = 13');
  eq(st6.SAN, 70, '6版 SAN = POW*5 = 70');
  eq(pr6.DB, '+1D4', '6版 DB (STR+SIZ=27 → +1D4)');
  eq(sk6['アイデア'], 80, '6版 アイデア = INT*5 = 80');
  eq(sk6['幸運'], 70, '6版 幸運 = POW*5 = 70');
  eq(sk6['知識'], 75, '6版 知識 = EDU*5 = 75');
}
{
  const a = M.sanitizeNpc({ name: '織田作之助', memo: '紹介文', images: [{ path: '/img/oda_n.png', label: '通常' }] });
  const b = M.sanitizeNpc({ name: '織田作之助', status: [{ label: 'HP', value: 12, max: 12 }], params: [{ label: 'STR', value: '14' }], skills: [{ name: '拳銃', value: 75, include: true, known: true }] });
  const f1 = M.sanitizeNpc({ name: '氷鞠（通常時）', status: [{ label: 'HP', value: 13, max: 13 }], params: [{ label: 'STR', value: '13' }] });
  const f2 = M.sanitizeNpc({ name: '氷鞠（本来の姿）', status: [{ label: 'HP', value: 50, max: 50 }], params: [{ label: 'STR', value: '40' }] });
  const merged = M.mergeSameNameNpcs([a, b, f1, f2]).npcs;
  eq(merged.length, 3, '同名NPCは統合し別形態は維持');
  eq(merged[0].status[0].value, 12, '統合先へステータスをマージ');
  eq(merged[0].images.length, 1, '統合先へ立ち絵を保持');
  eq(merged[0].skills[0].name, '拳銃', '統合先へ技能をマージ');
}
{
  const files = [
    'C:/art/織田作之助_通常.png',
    'C:/art/織田作之助_笑顔.png',
    'C:/art/織田作之助_怒.png',
    'C:/art/織田作之助_哀.png',
    'C:/art/氷鞠_差分1.png',
    'C:/art/キャラ名(1).png'
  ];
  const det = S.detectPortraitNpcs('織田作之助 織田作之助 氷鞠 キャラ名', files);
  eq(det.length, 3, '差分サフィックスを除去してベース名ごとに3体へグループ化');
  eq(det[0].files.map(f => S.splitImageName(f).diffLabel), ['通常', '哀', '笑顔', '怒'], '差分ラベルを抽出し通常先頭でソート');
  eq(S.splitImageName('C:/art/氷鞠_差分1.png').baseName, '氷鞠', '_差分1 を除去');
  eq(S.splitImageName('C:/art/キャラ名(1).png').baseName, 'キャラ名', '(1) を除去');
  eq(S.splitImageName('C:/NPC/通常.png'), { baseName: '', diffLabel: '通常' }, '表情キーワードのみ: baseNameを空にし元文字列をdiffLabelへ');
  eq(S.splitImageName('C:/立ち絵/驚く.png'), { baseName: '', diffLabel: '驚く' }, '活用形(驚く)のみ: baseNameを空に');
  eq(S.splitImageName('C:/未分類/通常_笑顔(1).png'), { baseName: '', diffLabel: '通常_笑顔(1)' }, '表情+数字()の組み合わせのみ: baseNameを空に');
  eq(S.splitImageName('C:/art/(1).png'), { baseName: '', diffLabel: '(1)' }, '番号()のみ: baseNameを空に');
  eq(S.splitImageName('C:/art/佐藤健/通常.png'), { baseName: '佐藤健', diffLabel: '通常' }, '親フォルダが具体的キャラ名ならbaseNameへ採用');
  eq(S.splitImageName('C:/art/佐藤健/驚く.png'), { baseName: '佐藤健', diffLabel: '驚く' }, '親フォルダが具体的キャラ名+活用形差分');
  eq(S.splitImageName('C:/art/研究者/通常.png').baseName, '', '親フォルダが汎用ロール語なら採用しない');
  eq(S.splitImageName('C:/art/毒入りスープ/通常.png', { scenarioName: '毒入りスープ' }).baseName, '', '親フォルダがシナリオ名自体なら採用しない');
  const noiseFiles = [
    'C:/NPC/通常.png', 'C:/NPC/驚く.png', 'C:/NPC/研究者.png', 'C:/NPC/男_笑顔.png',
    'C:/NPC/モブA.png', 'C:/NPC/HO1.png', 'C:/NPC/警官2.png',
    'C:/NPC/佐藤健/通常.png', 'C:/NPC/佐藤健/驚く.png', 'C:/NPC/佐藤博士.png'
  ];
  const det2 = S.detectPortraitNpcs('通常 驚く 研究者 男 モブA HO1 警官2 佐藤健 佐藤博士', noiseFiles);
  eq(det2.map(d => d.name), ['佐藤健', '佐藤博士'], '表情のみ・汎用ロール語を立ち絵のみNPC候補から除外し、親フォルダ由来と固有名は検出');
  eq(det2[0].files.map(f => S.splitImageName(f).diffLabel), ['通常', '驚く'], '親フォルダ由来キャラの差分を通常先頭で保持');
  eq(S.detectPortraitNpcs('研究者', ['C:/NPC/研究者.png'], { allowGenericRole: true }).length, 1, 'allowGenericRole時はステータスありNPCへの立ち絵紐付けを許可');
}
{
  const twoNpcs = '太郎 / STR:12 DEX:14 CON:11 HP:12\n目星 60%\n次郎 / STR:15 DEX:10 CON:14 HP:15\n聞き耳 70%\n■ステータス傾向\n全体として頑強。\n8,HP を-5\n「そんなバカな！」';
  const blocks = N.splitNpcBlocks(twoNpcs);
  eq(blocks.length, 2, 'インライン行 名前 / STR... で2体を分離');
  eq(N.parseNpc(blocks[0]).name, '太郎', '末尾 / を除去して太郎を抽出');
  eq(N.parseNpc(blocks[1]).name, '次郎', '末尾 / を除去して次郎を抽出');
  const formText = '❏ 氷鞠(ヒマリ)\n彼女は謎めいた少女である。\nステータス：通常時\nSTR:13 DEX:18 INT:15 CON:15 POW:12 SIZ:10 HP:13 MP:55\n〈目星〉(50) 〈回避〉(65) 〈追跡〉(60)\n《防御》(DEX×5)';
  const dForm = N.parseNpc(formText);
  eq(dForm.name, '氷鞠(ヒマリ)（通常時）', '❏ 氷鞠(ヒマリ) + ステータス：通常時 から 氷鞠(ヒマリ)（通常時） を結合命名');
  const fSkills = Object.fromEntries(dForm.skills.map(s => [s.name, s.value]));
  eq([fSkills['目星'], fSkills['回避'], fSkills['追跡'], fSkills['防御']], [50, 65, 60, 90], '〈〉グローバル抽出と 〈防御〉(DEX×5)=90');
  const twoColText = [
    '❏ 一式 若葉',
    'ステータス：通常時',
    'STR:11 CON:12 POW:14 DEX:13 APP:15 SIZ:10 INT:16 EDU:14 HP:11 MP:14 SAN:70',
    '',
    '技能',
    '〈目星〉(60) 〈聞き耳〉(55) 【図書館】(70) ＜精神分析＞(45)',
    '武器',
    'ナイフ 50% 1D4+db',
    '',
    '❏ 坂崎 和也',
    'STR:16 CON:15 POW:10 DEX:12 APP:10 SIZ:15 INT:13 EDU:12 HP:15 MP:10 SAN:50',
    'CCB<=65 【こぶし】'
  ].join('\n');
  const detected = S.detectCocBlocks(twoColText, N);
  eq(detected.length, 2, '2段組み右カラム技能を前NPCへ合流して2体のみ検出');
  eq(detected[0].name, '一式 若葉（通常時）', '25行遡り＋形態見出し結合');
  eq(detected[1].name, '坂崎 和也', '2体目の❏見出しを名前確定');
  t(detected[0].text.includes('〈目星〉') && detected[0].text.includes('ナイフ'), '右カラム独立の技能・武器ブロックを前NPCへ統合', detected[0].text);
}
// ===== STEP 5-Fix2: PUA見出し記憶（actAt）・平文除外（proseLike/belowAttr）・cmpName/mergeSame =====
{
  const p44 = [
    '\uE001 佐藤味御',
    '所属：新エネルギー開発機構',
    '年齢：42歳',
    ...Array.from({ length: 20 }, (_, i) => '解説行' + i + 'を記述する'),
    '業が落ち込み資金繰りと資源調達に困っ',
    'STR:10 CON:11 POW:12 DEX:11 APP:12 SIZ:12 INT:15 EDU:16',
    'HP:12 MP:12 SAN:60 目星 55%'
  ].join('\n');
  const b44 = S.detectCocBlocks(p44, N);
  eq(b44.length, 1, 'p44: 1体のみ検出');
  eq(b44[0].name, '佐藤味御', 'p44: PUA見出し記憶＋proseLike/belowAttrで折り返し平文を誤認しない');

  const p49 = [
    '\uE002 梅本時雨',
    '年齢：38歳',
    '職業：研究者',
    '資源調達',
    'を新エネルギープロジェクトで使い潰そ',
    'ステータス：通常時',
    'STR:11 CON:12 POW:13 DEX:12 APP:13 SIZ:11 INT:16 EDU:17',
    'HP:12 MP:13 SAN:65 図書館 70%'
  ].join('\n');
  const b49 = S.detectCocBlocks(p49, N);
  eq(b49.length, 1, 'p49: 1体のみ検出');
  eq(b49[0].name, '梅本時雨（通常時）', 'p49: PUA見出し＋形態名を結合し、属性下短文/平文を無視');

  const longForm = [
    '芦屋禄義',
    '所属：研究所',
    ...Array.from({ length: 45 }, () => '彼は長年にわたり研究を続けている。'),
    'ステータス：本気',
    'STR:14 CON:13 POW:15 DEX:13 HP:13 MP:15 SAN:75',
    '心理学 75%'
  ].join('\n');
  const b48 = S.detectCocBlocks(longForm, N);
  eq(b48[0].name, '芦屋禄義（本気）', 'formあり時は90行上方まで探索して名前結合');

  // cmpName + mergeSameResults（autoFill 前の統合）
  eq(S.cmpName('氷鞠(ヒマリ)（通常時）'), '氷鞠通常時', 'cmpName: 読み括弧のみ除去して形態を残す');
  eq(S.cmpName('一式 若葉(イッシキ ワカバ)'), '一式若葉', 'cmpName: 読み括弧と空白を除去');
  const scanRows = [
    { pdf: 'a.pdf', page: 10, name: '氷鞠(ヒマリ)（通常時）', text: '名前: 氷鞠(ヒマリ)（通常時）\nSTR:13 DEX:18 INT:15 CON:15 POW:12 SIZ:10 HP:13 MP:55\n目星 50% 回避 65%' },
    { pdf: 'a.pdf', page: 11, name: '氷鞠(ヒマリ)（本来の姿）', text: '名前: 氷鞠(ヒマリ)（本来の姿）\nSTR:35 DEX:25 INT:15 CON:30 POW:20 SIZ:25 HP:50 MP:40\nこぶし 80%' },
    { pdf: 'a.pdf', page: 15, name: '一式 若葉(イッシキ ワカバ)', text: '名前: 一式 若葉(イッシキ ワカバ)\nSTR:11 CON:12 POW:14 DEX:13 APP:15 SIZ:10 INT:16 EDU:14 HP:11 MP:14 SAN:70\n目星 60% 聞き耳 55%' },
    { pdf: 'a.pdf', page: 96, name: '若葉', text: '名前: 若葉\nHP:11 MP:14 SAN:70' },
    { pdf: 'a.pdf', page: 105, name: '氷鞠通常時', text: '名前: 氷鞠通常時\nHP:13 MP:55 SAN:50' },
    { pdf: 'a.pdf', page: 105, name: '一式若葉', text: '名前: 一式若葉\nHP:11 MP:14 SAN:70' }
  ];
  const deduped = S.mergeSameResults(scanRows, txt => N.parseNpc(txt, { edition: 'auto', rollPrefix: 'CCB', abilityRolls: true, noAuto: true }));
  eq(deduped.results.map(r => r.name), ['氷鞠(ヒマリ)（通常時）', '氷鞠(ヒマリ)（本来の姿）', '一式 若葉(イッシキ ワカバ)'], 'mergeSameResults: 氷鞠通常時・一式若葉・若葉(3項目)を統合し別形態は維持');
  eq(deduped.merged, 3, 'mergeSameResults: 3件を統合');

  // M.mergeSameNameNpcs でも autoFill 後・前を問わず同様に統合
  const npcs = scanRows.map(r => {
    const d = N.parseNpc(r.text, { noAuto: true });
    d.name = r.name;
    M.autoFillStats(d);
    return d;
  });
  const mRes = M.mergeSameNameNpcs(npcs);
  eq(mRes.npcs.map(n => n.name), ['氷鞠(ヒマリ)（通常時）', '氷鞠(ヒマリ)（本来の姿）', '一式 若葉(イッシキ ワカバ)'], 'mergeSameNameNpcs: _auto除外によりautoFill後でも簡易再掲を統合');
  eq(mRes.mergedCount, 3, 'mergeSameNameNpcs: 3件統合');

  // STEP 5-Fix3: 旧フォルダ判定・スマートカテゴリ・ゴミタグ除去・マイナス検索・mtime重複ガード
  eq(M.isOldFolderName('旧素材'), true, 'isOldFolderName: 旧を含むフォルダを除外');
  eq(M.isOldFolderName('old_ver'), true, 'isOldFolderName: old_ver を除外');
  eq(M.isOldFolderName('差替前'), true, 'isOldFolderName: 差替前 を除外');
  eq(M.isOldFolderName('backup'), true, 'isOldFolderName: backup を除外');
  eq(M.isOldFolderName('folder'), false, 'isOldFolderName: folder を誤除外しない');
  eq(M.isOldFolderName('gold'), false, 'isOldFolderName: gold を誤除外しない');

  eq(M.inferSmartCategory('npc01.png', '立ち絵'), 'NPC', 'inferSmartCategory: 立ち絵→NPC');
  eq(M.inferSmartCategory('battle.mp3', 'BGM素材'), 'BGM素材', 'inferSmartCategory: BGMフォルダ名を保持（部屋素材に誤分類しない）');
  eq(M.inferSmartCategory('cutin.png', ''), '部屋素材', 'inferSmartCategory: cutin→部屋素材');
  eq(M.inferSmartCategory('random_01.png', 'misc'), '', 'inferSmartCategory: 不明は未分類');

  eq(M.isJunkTag('iTunNORM'), true, 'isJunkTag: iTunNORM除外');
  eq(M.isJunkTag('00000A1B 00000B2C'), true, 'isJunkTag: 16進ゴミ列除外');
  eq(M.isJunkTag('https://example.com/a'), true, 'isJunkTag: URL除外');
  eq(M.isJunkTag('DarkAmbient'), false, 'isJunkTag: 通常タグ許可');
  eq(M.cleanTagList(['iTunNORM', '00AABBCCDD', 'ホラー', '戦闘', 'ホラー']), ['ホラー', '戦闘'], 'cleanTagList: ゴミ除去と重複排除');

  const pq = M.parseSearchQuery('bgm -戦闘');
  eq(M.matchSearchQuery('探索 bgm 深夜', pq), true, 'matchSearchQuery: 一致かつ除外語なし');
  eq(M.matchSearchQuery('戦闘 bgm ボス', pq), false, 'matchSearchQuery: -除外語を含むため不一致');

  const proj = M.sanitizeProject({ refs: [], folders: [], assetOrder: ['ref:a', 'img:b'] });
  eq(proj.assetOrder, ['ref:a', 'img:b'], 'sanitizeProject: assetOrder保持');
  const added1 = M.addRefs(proj, [{ type: 'image', name: 'map.png', path: 'C:\\a\\map.png', category: 'マップ', mtime: 1000, tags: ['1階'] }]);
  eq(added1, 1, 'addRefs: 初回登録');
  const added2 = M.addRefs(proj, [{ type: 'image', name: 'map.png', path: 'C:\\b\\map.png', category: 'マップ', mtime: 2000, tags: ['更新'] }]);
  eq(added2, 1, 'addRefs: 同名で新しいmtimeは更新');
  eq(proj.refs.length, 1, 'addRefs: 同名ファイルの重複登録なし');
  eq(proj.refs[0].path, 'C:\\b\\map.png', 'addRefs: 新しいmtimeのパスへ更新');
  const added3 = M.addRefs(proj, [{ type: 'image', name: 'map.png', path: 'C:\\c\\map.png', category: 'マップ', mtime: 500 }]);
  eq(added3, 0, 'addRefs: 古いmtimeは無視');
  eq(proj.refs[0].path, 'C:\\b\\map.png', 'addRefs: 古いmtimeで上書きされない');
}

// ---------- Phase 2-A: シーン見出し解析 / 分割結合 / ノイズ除外 / 素材マッチ / モデル ----------
{
  const htmlLines = SM.extractHtmlLines('<h1>第1章 廃校</h1><p>深夜の教室で《目星》を振る。</p><h2>■図書館の調査</h2><p>森田が古い本を開く。</p>');
  t(htmlLines.length >= 4 && htmlLines[0].htmlTag === 'h1' && htmlLines[0].isLargeFont, 'extractHtmlLines: h1を大フォント/タグ付きで抽出');

  const pdfLines = SM.buildPdfLines([
    { page: 1, lines: [{ text: 'プロローグ', fontSize: 22 }, { text: '夜の街を歩く。', fontSize: 11 }, { text: '◆深夜の病院', fontSize: 12 }, { text: '§隠し部屋', fontSize: 11 }] },
  ]);
  t(pdfLines[0].isLargeFont && !pdfLines[1].isLargeFont, 'buildPdfLines: 大フォント行のみisLargeFont=true');

  const stats = SM.detectHeadingStats(pdfLines, ['§']);
  const statMap = Object.fromEntries(stats.map(s => [s.id, s.count]));
  eq(statMap.diamond, 1, 'detectHeadingStats: ◆行の件数');
  eq(statMap.richhead, 1, 'detectHeadingStats: 大フォント行の件数');
  eq(statMap.custom, 1, 'detectHeadingStats: カスタム先頭記号§の件数');

  const scenes = SM.buildScenesFromLines(pdfLines, { enabledPatterns: ['richhead', 'diamond', 'custom'], customPrefixes: '§' });
  eq(scenes.length, 3, 'buildScenesFromLines: 3シーンに分割');
  eq(scenes[1].title, '深夜の病院', 'buildScenesFromLines: ◆記号除去後のシーン名');

  const splitRes = SM.splitSceneAtLine([
    { id: 's1', title: '導入', text: '1行目\n2行目\n3行目', tags: [] },
  ], 0, 1);
  eq(splitRes.length, 2, 'splitSceneAtLine: 行クリックで2シーンに分割');
  eq(splitRes[0].text, '1行目', 'splitSceneAtLine: 前半本文');
  eq(splitRes[1].title, '2行目', 'splitSceneAtLine: 後半タイトル');

  const mergedRes = SM.mergeSceneWithPrev(splitRes, 1);
  eq(mergedRes.length, 1, 'mergeSceneWithPrev: 前のシーンと再結合');
  t(mergedRes[0].text.includes('1行目') && mergedRes[0].text.includes('3行目'), 'mergeSceneWithPrev: 本文が結合される');

  const stripped = SM.stripSkillNoise('《図書館》で調べ、【目星】や〈聞き耳〉に成功。校舎の図書室へ。');
  t(!stripped.includes('図書館') && !stripped.includes('目星') && !stripped.includes('聞き耳') && stripped.includes('図書室'), 'stripSkillNoise: 技能括弧のみ除外し本文の図書室を残す');

  const masked = SM.maskFalsePositiveCompounds('森田さんと街灯の下を通り、森の奥の街へ向かう。');
  t(!masked.includes('森田') && !masked.includes('街灯') && masked.includes('森の奥') && masked.includes('街へ'), 'maskFalsePositiveCompounds: 森田/街灯を除外し森/街を残す');

  const kw = SM.extractSceneKeywords({ title: '放課後の学園', text: '《図書館》で判定後、校舎の図書室へ向かう。森田は不在。' });
  t(kw.groups.some(g => g.id === 'school') && kw.keywords.includes('図書室') && !kw.keywords.includes('図書館') && !kw.keywords.includes('森'), 'extractSceneKeywords: 類義語グループ検出＋技能/人名ノイズ除外');

  const scored = SM.scoreAssetsForScene(
    { title: '深夜の図書室', text: '静かな図書館で調べる。' },
    {
      registeredItems: [
        { uid: 'r_bg', name: 'old_lib.png', type: 'image', category: '背景', tags: ['図書室'], customTags: ['図書室'] },
      ],
      commonItems: [
        { uid: 'c_bg', name: 'archive.jpg', type: 'image', parent: 'bg', tags: ['書庫'], customTags: ['書庫'] },
        { uid: 'c_bg_folder', name: 'hall.jpg', type: 'image', parent: '図書室', tags: [], customTags: [] },
        { uid: 'c_bgm', name: 'silent_night.mp3', type: 'audio', parent: '図書館BGM', tags: ['図書館'], customTags: [], id3Blob: '図書館' },
      ],
    },
    5
  );
  eq(scored.bg[0].item.uid, 'r_bg', 'scoreAssetsForScene: ①登録素材が②マイライブラリより優先');
  eq(scored.bg[1].item.uid, 'c_bg', 'scoreAssetsForScene: ②マイライブラリカスタムタグ(類義語:書庫=図書室)が③フォルダ名より優先');
  eq(scored.bg[2].item.uid, 'c_bg_folder', 'scoreAssetsForScene: ③親フォルダ名一致が候補に入る');
  eq(scored.bgm[0].item.uid, 'c_bgm', 'scoreAssetsForScene: 親フォルダ/ID3タグ一致でBGMがヒット');

  const p = M.sanitizeProject({
    scenes: [{ title: 'テスト', bg: { name: 'bg.png', x: 10, lockAspect: true, visible: false }, markers: [{ name: 'marker.png', width: 200, height: 200, syncId: 'sync_1' }] }],
    sceneParseConfig: { enabledPatterns: ['square', 'custom'], customPrefixes: '★' },
    board: { pieces: [{ name: '駒A', x: 120, y: 140 }] },
    cutins: [{ name: '閃光', visualType: 'video', visualName: 'flash.mp4', seVolume: 70 }],
  });
  eq(p.scenes.length, 1, 'sanitizeProject: scenesを保持');
  eq(p.scenes[0].bg.lockAspect, true, 'sanitizeProject: lockAspectを保持');
  eq(p.scenes[0].markers[0].syncId, 'sync_1', 'sanitizeProject: markersのsyncIdを保持');
  eq(p.sceneParseConfig.customPrefixes, '★', 'sanitizeProject: sceneParseConfigを保持');
  eq(p.board.pieces[0].x, 120, 'sanitizeProject: board.piecesを保持');
  eq(p.cutins[0].visualType, 'video', 'sanitizeProject: cutin visualTypeとseVolumeを保持');
  eq(p.cutins[0].seVolume, 70, 'sanitizeProject: cutin seVolumeを保持');
}
console.log(`\n${ok} passed, ${ng} failed`); process.exit(ng ? 1 : 0);
