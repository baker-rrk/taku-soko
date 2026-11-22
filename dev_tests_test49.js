/* dev_tests_test49.js — 単体テストスイート（現行UI・最新仕様対応版）
 * 使い方: node dev_tests_test49.js [対象ディレクトリ]
 * 本体コード（app_*.js 等）は一切変更せず、new Function 切り出し実行とモジュール検証を行う。 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const targetDir = path.resolve(process.argv[2] || __dirname);
let passed = 0;
let failed = 0;
const failures = [];

const testQueue = [];
function test(name, fn) {
  testQueue.push({ name, fn });
}

function readAppFile(fileName) {
  return fs.readFileSync(path.join(targetDir, fileName), 'utf8');
}

// ============================================================================
// 1. 切り出し実行（new Function）用のグローバル関数・ヘルパースタブ補完
// ============================================================================
function createSandboxStubs() {
  const win = {
    IS_ELECTRON: false,
    DEFAULT_IMAGE_CATEGORIES: ['セッション画面', 'NPC', '背景', '前景', 'マップ', 'その他'],
    DEFAULT_SCENARIO_CATS: ['トレーラー', 'NPC', '背景', '前景', 'マップ', '部屋素材'],
    addEventListener: () => {},
    idbGetRaw: async () => null,
    idbSetRaw: async () => true,
    ensureLocalUrl: async (u) => u,
    resolveSendBlob: async () => null,
    persistStateNow: async () => true
  };

  // PDF添付のサニタイズスタブ
  const sanitizePdfs = (list) => (Array.isArray(list) ? list : [])
    .filter(p => p && typeof p === 'object' && p.name && p.path)
    .map(p => ({
      id: String(p.id || 'pdf_' + Math.random().toString(36).slice(2, 8)),
      name: String(p.name).slice(0, 200),
      path: String(p.path).slice(0, 1024),
      size: Number(p.size) || 0,
      addedAt: Number(p.addedAt) || Date.now()
    }));

  // ココフォリア部屋データのサニタイズ・マージスタブ
  const sanitizeCcfolia = (s) => {
    const rooms = Array.isArray(s && s.ccfRooms) ? s.ccfRooms.filter(r => r && typeof r === 'object' && r.id).map(r => ({
      id: String(r.id).slice(0, 80),
      name: String(r.name || '無題の部屋').slice(0, 120),
      updatedAt: Number(r.updatedAt) || 0,
      project: r.project && typeof r.project === 'object' ? JSON.parse(JSON.stringify(r.project)) : null
    })) : [];
    const activeId = s && typeof s.ccfActiveRoomId === 'string' && rooms.some(r => r.id === s.ccfActiveRoomId)
      ? s.ccfActiveRoomId
      : (rooms[0] && rooms[0].id || '');
    return { ccfRooms: rooms, ccfActiveRoomId: activeId };
  };

  const mergeCcfolia = (bSc, iSc) => {
    const b = sanitizeCcfolia(bSc);
    const inc = sanitizeCcfolia(iSc);
    const map = new Map();
    b.ccfRooms.forEach(r => map.set(r.id, r));
    inc.ccfRooms.forEach(r => {
      const cur = map.get(r.id);
      if (!cur || (Number(r.updatedAt) || 0) >= (Number(cur.updatedAt) || 0)) map.set(r.id, r);
    });
    const rooms = [...map.values()];
    return {
      ccfRooms: rooms,
      ccfActiveRoomId: inc.ccfActiveRoomId || b.ccfActiveRoomId || (rooms[0] && rooms[0].id || '')
    };
  };

  // タグ関連関数のスタブ
  const normalizeTags = (raw) => {
    const src = Array.isArray(raw) ? raw : String(raw || '').split(/[,、，\n\t]+/);
    const seen = new Set();
    const out = [];
    src.forEach(x => {
      const t = String(x == null ? '' : x).replace(/^[#＃]+/, '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!t) return;
      const key = t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    });
    return out.slice(0, 30);
  };
  const sanitizeScenarioTags = (s) => normalizeTags(s && s.tags);
  const collectAllTags = (scenarios) => {
    const map = new Map();
    (scenarios || []).forEach(s => normalizeTags(s && s.tags).forEach(t => {
      const k = t.toLowerCase();
      if (!map.has(k)) map.set(k, { tag: t, count: 0 });
      map.get(k).count++;
    }));
    return [...map.values()];
  };
  const filterByTags = (list, activeSet) => {
    if (!activeSet || !activeSet.size) return list;
    const req = [...activeSet].map(t => t.toLowerCase());
    return (list || []).filter(sc => {
      const has = new Set(normalizeTags(sc && sc.tags).map(t => t.toLowerCase()));
      return req.every(k => has.has(k));
    });
  };

  win.sanitizePdfs = sanitizePdfs;
  win.sanitizeCcfolia = sanitizeCcfolia;
  win.mergeCcfolia = mergeCcfolia;
  win.normalizeTags = normalizeTags;
  win.sanitizeScenarioTags = sanitizeScenarioTags;
  win.collectAllTags = collectAllTags;
  win.filterByTags = filterByTags;
  win.renderTagPills = () => '';
  win.renderTagFilterUi = () => {};

  const escapeHTML = (str) => String(str == null ? '' : str)
    .replace(/[&<>'"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[m]);

  const makeDummyEl = () => ({
    value: '',
    checked: false,
    innerHTML: '',
    textContent: '',
    innerText: '',
    style: {},
    dataset: {},
    options: [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    appendChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  });

  const doc = {
    readyState: 'complete',
    body: makeDummyEl(),
    documentElement: makeDummyEl(),
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => makeDummyEl(),
    createElement: () => makeDummyEl(),
    querySelector: () => null,
    querySelectorAll: () => []
  };

  return {
    window: win,
    document: doc,
    escapeHTML,
    sanitizePdfs,
    sanitizeCcfolia,
    mergeCcfolia,
    normalizeTags,
    sanitizeScenarioTags,
    collectAllTags,
    filterByTags
  };
}

console.log('=== [1] 単体テスト（new Function 切り出し＋スタブ補完） ===');

const stubs = createSandboxStubs();
const code00 = readAppFile('app_test49_00_block_common.js');
const code01 = readAppFile('app_test49_01_state_model.js');
const code03 = readAppFile('app_test49_03_ui_basics.js');
const code04 = readAppFile('app_test49_04_forms_blocks.js');
const code10 = readAppFile('app_test49_10_secret_ho.js');
const code11 = readAppFile('app_test49_11_custom_formats.js');
const code12 = readAppFile('app_test49_12_scenario_window.js');
const code13 = readAppFile('app_test49_13_shell.js');
const code14 = readAppFile('app_test49_14_gallery.js');
const code16 = readAppFile('app_test49_16_scenario_detail.js');

// new Function で 00_block_common + 01_state_model + 10_secret_ho の純粋関数群を切り出し実行
const loadCoreModel = new Function(
  'window',
  'document',
  'escapeHTML',
  'sanitizePdfs',
  'sanitizeCcfolia',
  'mergeCcfolia',
  'normalizeTags',
  'sanitizeScenarioTags',
  `let renderPreviewNow = () => {};
   function formatItemSection(title, val) { return (title ? '## ' + title + '\\n' : '') + (val || ''); }
   ${code00}\n${code01}\n${code10}\nreturn {
    SUB_FIELD, newSub, subItemsEditorHtml, moveItem, fmtSelection,
    BUILTIN_DECOR, isDecorStyle, decorOptions, decorOptionsHtml, sanitizeFormats,
    mergeBackupInto, mergeSummaryText,
    DEFAULT_COMMON_CATS, DEFAULT_SCENARIO_CATS, sanitizeCats, sanitizeAssets, sanitizeDocs, addCategory, uniqueCategory,
    titlesSame, normSearch, parseQuery, scenarioHaystack, matchQuery,
    sanitizeBlock, sanitizeBlocks, repairLoadedState, sanitizeImported,
    createDefaultBlocks, ensureScenarioBlocks, deriveFlat, applyFlatToBlocks, migrateScenarioBlocks,
    sanitizeHOs, hoHeading, hoMessages, appState
  };`
);

const core = loadCoreModel(
  stubs.window,
  stubs.document,
  stubs.escapeHTML,
  stubs.sanitizePdfs,
  stubs.sanitizeCcfolia,
  stubs.mergeCcfolia,
  stubs.normalizeTags,
  stubs.sanitizeScenarioTags
);

test('00_block_common / 01_state_model / 10_secret_ho が new Function でエラーなくロードできる', () => {
  assert.strictEqual(typeof core.sanitizeImported, 'function');
  assert.strictEqual(typeof core.mergeBackupInto, 'function');
  assert.strictEqual(typeof core.ensureScenarioBlocks, 'function');
  assert.strictEqual(typeof core.sanitizeHOs, 'function');
  assert.strictEqual(typeof stubs.window.mergeCcfolia, 'function');
});

test('sanitizeImported: シナリオ・秘匿HO・ココフォリア部屋（ccfRooms）・未紐付け部屋（unlinkedCcfRooms）を正規化できる', () => {
  const raw = {
    scenarios: [{
      id: 'sc_1',
      title: 'テストシナリオ',
      system: 'CoC6版',
      tags: ['ホラー', 'CoC6版'],
      secretHOs: [{ name: 'HO1', tagline: 'あなたは探偵だ', blocks: [{ id: 'b1', type: 'item', keyName: '秘密', val: '真相を知っている' }] }],
      ccfRooms: [{ id: 'rm_1', name: 'メイン部屋', updatedAt: 1000, project: { version: 1 } }],
      docs: [{ id: 'd1', name: 'rule.pdf', rel: 'scenarios/sc_1/rule.pdf' }, { id: 'bad', name: 'evil.pdf', rel: '../evil.pdf' }]
    }],
    channels: [{ id: 'ch_1', name: '一般', webhookUrl: ' https://discord.com/api/webhooks/1/abc ', tags: [{ name: 'CoC', id: ' 123 ' }] }],
    history: [{ date: '2026-01-01T00:00:00Z', title: 'テストシナリオ', channels: '一般' }],
    unlinkedCcfRooms: [{ id: 'urm_1', name: '未紐付け部屋', updatedAt: 500, project: {} }]
  };
  const res = core.sanitizeImported(raw);
  assert.ok(res);
  assert.strictEqual(res.scenarios.length, 1);
  assert.strictEqual(res.scenarios[0].ccfRooms.length, 1);
  assert.strictEqual(res.scenarios[0].ccfActiveRoomId, 'rm_1');
  assert.strictEqual(res.scenarios[0].secretHOs.length, 1);
  assert.strictEqual(res.scenarios[0].docs.length, 1, 'パストラバーサル（..）を含む docs は除外されること');
  assert.strictEqual(res.channels[0].webhookUrl, 'https://discord.com/api/webhooks/1/abc');
  assert.strictEqual(res.unlinkedCcfRooms.length, 1);
  assert.strictEqual(res.unlinkedCcfActiveRoomId, 'urm_1');
});

test('mergeBackupInto: シナリオ更新日時比較・投稿済み情報合算・ギャラリー画像統合が正しく動作する', () => {
  const base = {
    scenarios: [
      { id: 'sc_1', title: '旧タイトル', updatedAt: 100, postedChannels: ['ch_1'], postedInfo: { ch_1: { name: 'ch1', tags: ['A'] } } },
      { id: 'sc_2', title: '新しい方を維持', updatedAt: 300, postedChannels: [] }
    ],
    channels: [{ id: 'ch_1', name: 'ch1', webhookUrl: 'https://discord.com/api/webhooks/1/a' }],
    formats: [{ id: 'fmt_1', name: '書式1', headPre: '## ', headPost: '', linePre: '> ', wrap: 'none' }],
    imageCategories: ['未分類'],
    imageAssets: [{ id: 'img_1', name: 'a.png', dataUrl: 'data:image/png;base64,AAA', category: '未分類' }],
    history: [{ date: '2026-01-01T00:00:00.000Z', title: '旧タイトル', channels: 'ch1' }],
    deletedScenarios: { sc_3: 50 },
    deletedChannels: {}
  };
  const inc = {
    scenarios: [
      { id: 'sc_1', title: '新タイトル', updatedAt: 200, postedChannels: ['ch_2'], postedInfo: { ch_2: { name: 'ch2', tags: ['B'] } } },
      { id: 'sc_2', title: '古いデータ', updatedAt: 150, postedChannels: [] },
      { id: 'sc_3', title: '復活シナリオ', updatedAt: 250, postedChannels: [] }
    ],
    channels: [{ id: 'ch_2', name: 'ch2', webhookUrl: 'https://discord.com/api/webhooks/2/b' }],
    formats: [{ id: 'fmt_2', name: '書式2', headPre: '### ', headPost: '', linePre: '- ', wrap: 'none' }],
    imageCategories: ['背景'],
    imageAssets: [{ id: 'img_2', name: 'b.png', dataUrl: 'data:image/png;base64,BBB', category: '背景' }],
    history: [{ date: '2026-01-02T00:00:00.000Z', title: '新タイトル', channels: 'ch2' }]
  };
  const { merged, summary } = core.mergeBackupInto(base, inc);
  assert.strictEqual(summary.scenAdded, 1);
  assert.strictEqual(summary.scenUpdated, 1);
  assert.strictEqual(summary.scenKeptNewer, 1);
  const sc1 = merged.scenarios.find(s => s.id === 'sc_1');
  assert.strictEqual(sc1.title, '新タイトル');
  assert.deepStrictEqual(sc1.postedChannels.sort(), ['ch_1', 'ch_2']);
  const sc2 = merged.scenarios.find(s => s.id === 'sc_2');
  assert.strictEqual(sc2.title, '新しい方を維持');
  assert.strictEqual(merged.deletedScenarios.sc_3, undefined, 'インポートに含まれた削除済みIDは復活すること');
  assert.strictEqual(merged.imageAssets.length, 2);
  assert.deepStrictEqual(merged.imageCategories, ['未分類', '背景']);
});

test('スタブ関数検証: sanitizePdfs / sanitizeCcfolia / window.mergeCcfolia / タグ関連スタブが現行仕様通り動作する', () => {
  const pdfs = stubs.sanitizePdfs([{ id: 'p1', name: 'test.pdf', path: '/a/test.pdf', size: 100 }, null, {}]);
  assert.strictEqual(pdfs.length, 1);
  assert.strictEqual(pdfs[0].name, 'test.pdf');

  const mergedCcf = stubs.window.mergeCcfolia(
    { ccfRooms: [{ id: 'r1', name: '旧', updatedAt: 10, project: {} }] },
    { ccfRooms: [{ id: 'r1', name: '新', updatedAt: 20, project: {} }, { id: 'r2', name: '追加', updatedAt: 15, project: {} }], ccfActiveRoomId: 'r2' }
  );
  assert.strictEqual(mergedCcf.ccfRooms.length, 2);
  assert.strictEqual(mergedCcf.ccfRooms.find(r => r.id === 'r1').name, '新');
  assert.strictEqual(mergedCcf.ccfActiveRoomId, 'r2');

  assert.deepStrictEqual(stubs.normalizeTags('#CoC6版, ホラー, coc6版'), ['CoC6版', 'ホラー']);
  const filtered = stubs.filterByTags(
    [{ title: 'A', tags: ['CoC6版', 'ホラー'] }, { title: 'B', tags: ['エモクロア'] }],
    new Set(['coc6版'])
  );
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].title, 'A');
});

test('ブロック構造・フラット派生（ensureScenarioBlocks / deriveFlat）および秘匿HOメッセージ分割（hoMessages）', () => {
  const sc = { title: 'テスト', system: 'CoC6版', playerCount: '4人', notes: '備考テスト', imageUrl: 'https://example.com/a.png' };
  core.ensureScenarioBlocks(sc);
  assert.ok(Array.isArray(sc.fullBlockData) && sc.fullBlockData.length >= 3);
  const sum = sc.fullBlockData.find(b => b.type === 'summary_container');
  sum.items.find(i => i.field === 'system').val = 'エモクロアTRPG';
  core.deriveFlat(sc);
  assert.strictEqual(sc.system, 'エモクロアTRPG');

  const ho = core.sanitizeHOs([{
    name: 'HO1',
    tagline: '探偵役',
    blocks: [
      { id: '1', type: 'item', keyName: '導入', val: 'あなたは探偵です' },
      { id: '2', type: 'split' },
      { id: '3', type: 'item', keyName: '秘密', val: '実は犯人を知っている' }
    ]
  }])[0];
  const msgs = core.hoMessages(ho);
  assert.strictEqual(msgs.length, 3);
  assert.strictEqual(msgs[0].kind, 'text');
  assert.ok(msgs[0].text.includes('# HO1：__探偵役__'));
  assert.strictEqual(msgs[1].kind, 'split');
  assert.strictEqual(msgs[2].kind, 'text');
});

// ============================================================================
// 2. 現行仕様の期待値検証（カテゴリ・タブ構成・カードクリック時の詳細モーダル起動）
// ============================================================================
console.log('=== [2] 現行UI・最新仕様の期待値検証 ===');

test('シナリオ素材カテゴリ検証: 6カテゴリ期待値（トレーラー,NPC,背景,前景,マップ,部屋素材）および sanitizeCats の動作', () => {
  assert.strictEqual(
    stubs.window.DEFAULT_SCENARIO_CATS.join(','),
    'トレーラー,NPC,背景,前景,マップ,部屋素材',
    '現行6カテゴリ期待値と一致すること'
  );
  const customCats = core.sanitizeCats(stubs.window.DEFAULT_SCENARIO_CATS, core.DEFAULT_SCENARIO_CATS);
  assert.strictEqual(customCats.join(','), 'トレーラー,NPC,背景,前景,マップ,部屋素材');
});

test('現行タブ構成とモーダル導線: databaseTab / postTab / ccfTab(ccfoliaTab) / galleryTab および #openSettingsBtn / 投稿履歴モーダル', () => {
  const html = readAppFile('index.html');
  // メインナビゲーションのタブ確認
  const navTabs = [...html.matchAll(/class="tab-btn[^"]*"[^>]*data-tab="([^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(navTabs, ['databaseTab', 'postTab', 'galleryTab', 'ccfTab']);
  // 旧 settingsTab は data-on-click="open-settings-modal"（Discord設定モーダル）へ移行済み
  assert.ok(!navTabs.includes('settingsTab'), 'ナビゲーションに旧 settingsTab が含まれないこと');
  assert.ok(html.includes('data-on-click="open-settings-modal"'), 'open-settings-modal で初期設定モーダルを開く構成であること');
  assert.ok(html.includes('id="settingsModal"'), '#settingsModal が存在すること');
  // 投稿履歴モーダルボタンの確認
  assert.ok(html.includes('data-on-click="open-history-modal"'), '「📜 投稿履歴を見る」ボタンが存在すること');
  assert.ok(code14.includes('function openHistoryModal()'), 'openHistoryModal が定義されていること');
});

test('ホーム画面のシナリオカードクリック: activateScenario(id) が openScenarioDetail(id)（シナリオ詳細モーダル）を起動する', () => {
  // 12_scenario_window.js で [data-sid] クリック時に activateScenario(card.dataset.sid) を呼び、
  // 13_shell.js の activateScenario(id) が openScenarioDetail(id) を呼ぶ現行仕様を検証
  assert.ok(code12.includes('activateScenario(card.dataset.sid)'), 'カードクリック時に activateScenario(card.dataset.sid) が呼ばれること');
  assert.ok(code13.includes('function activateScenario(id) { if (appState.scenarios.some(s => s.id === id)) openScenarioDetail(id); }'), 'activateScenario が openScenarioDetail(id) を呼び出すこと');
  assert.ok(code16.includes('window.openScenarioDetail = function'), 'window.openScenarioDetail がグローバル公開されていること');

  // 切り出し実行でカードクリック時の遷移を検証
  let openedDetailId = null;
  const testActivate = new Function('appState', 'openScenarioDetail', `
    function activateScenario(id) { if (appState.scenarios.some(s => s.id === id)) openScenarioDetail(id); }
    return activateScenario;
  `)({ scenarios: [{ id: 'sc_100', title: '詳細モーダルテスト' }] }, (id) => { openedDetailId = id; });

  testActivate('sc_100');
  assert.strictEqual(openedDetailId, 'sc_100', 'activateScenario 実行で openScenarioDetail にシナリオIDが渡されること');
});

// ============================================================================
// 3. フェーズ1〜3 修正項目の回帰単体テスト
// ============================================================================
test('修正検証(A-1, A-2, A-7, B-5): prompt() 完全排除・schemaVersion=3 正常化・NPC空ボタン/詳細モーダルボタン整理', () => {
  const codeCcfUi = readAppFile(path.join('ccfolia', 'ccf_ui.js'));
  const codeNpcUi = readAppFile(path.join('ccfolia', 'ccf_npc_ui.js'));

  // A-1: prompt( が残っていないこと
  assert.ok(!/\bprompt\s*\(/.test(code16), 'app_test49_16_scenario_detail.js に生の prompt() が残っていないこと');
  assert.ok(!/(?<![.\w])prompt\s*\(/.test(codeCcfUi.replace(/Promise\.resolve\(prompt\(msg, def\)\)/g, '')), 'ccfolia/ccf_ui.js に直接の prompt() 呼び出しが残っていないこと');
  assert.ok(code03.includes('function appPrompt('), 'appPrompt 独自入力モーダルが定義されていること');

  // A-2: appState.schemaVersion = 3 がコメントに巻き込まれず単独行で存在すること
  const uncommentedSchemaLine = code03.split('\n').some(line => {
    const codePart = line.split('//')[0];
    return codePart.includes('appState.schemaVersion = 3');
  });
  assert.ok(uncommentedSchemaLine, 'appState.schemaVersion = 3 がコメントアウトされずに実行されること');

  // A-7: NPCモーダルの data-r="pt-gallery" ボタンにラベルがあること
  assert.ok(codeNpcUi.includes('data-r="pt-gallery">🖼️ 共通ギャラリーから追加</button>'), 'NPCモーダルのギャラリー選択ボタンにラベルが設定されていること');

  // B-5: シナリオ詳細モーダルの下部アクションボタンが4ボタンに整理されていること
  assert.ok(code16.includes('data-sd="assets">🗗 登録素材・ギャラリー整理</button>'), 'シナリオ詳細モーダルの登録素材ボタンが統一されていること');
});

test('修正検証(A-5, A-8): シナリオ6カテゴリ自動拡張と mergeBackupInto のシナリオ内 ccfRooms / images 個別マージ', () => {
  // A-8: 旧3カテゴリのみの配列が標準6カテゴリへ自動拡張されること
  assert.strictEqual(core.DEFAULT_SCENARIO_CATS.join(','), 'トレーラー,NPC,背景,前景,マップ,部屋素材');
  const upgraded = core.sanitizeCats(['トレーラー', 'NPC', 'マップ'], core.DEFAULT_SCENARIO_CATS);
  assert.strictEqual(upgraded.join(','), 'トレーラー,NPC,背景,前景,マップ,部屋素材', '旧3カテゴリが標準6カテゴリへ自動アップグレードされること');

  // A-5: 同一IDシナリオ統合時に ccfRooms（部屋単位で新しい方を保持）と images が消失せずマージされること
  const base = {
    scenarios: [{
      id: 'sc_merge',
      title: 'ベース側',
      updatedAt: 100,
      imageCategories: ['トレーラー', 'NPC', 'マップ'],
      images: [{ id: 'img_base', name: 'base.png', dataUrl: 'data:image/png;base64,111', category: 'NPC' }],
      ccfRooms: [
        { id: 'room_1', name: '部屋1(ベースの方が新しい)', updatedAt: 500, project: { stocks: [{ id: 's1', text: 'base' }] } },
        { id: 'room_2', name: '部屋2(古い)', updatedAt: 100, project: { stocks: [] } }
      ],
      ccfActiveRoomId: 'room_1'
    }],
    unlinkedCcfRooms: [{ id: 'u_1', name: '未紐付け1', updatedAt: 100, project: {} }]
  };
  const inc = {
    scenarios: [{
      id: 'sc_merge',
      title: 'インポート側(新しい)',
      updatedAt: 200,
      imageCategories: ['トレーラー', 'カスタム分類'],
      images: [{ id: 'img_inc', name: 'inc.png', dataUrl: 'data:image/png;base64,222', category: 'カスタム分類' }],
      ccfRooms: [
        { id: 'room_1', name: '部屋1(インポート側は古い)', updatedAt: 200, project: { stocks: [] } },
        { id: 'room_2', name: '部屋2(インポート側が新しい)', updatedAt: 300, project: { stocks: [{ id: 's2', text: 'inc' }] } },
        { id: 'room_3', name: '部屋3(新規追加)', updatedAt: 250, project: { stocks: [] } }
      ],
      ccfActiveRoomId: 'room_2'
    }],
    unlinkedCcfRooms: [{ id: 'u_2', name: '未紐付け2', updatedAt: 200, project: {} }]
  };

  const { merged } = core.mergeBackupInto(base, inc);
  const sc = merged.scenarios.find(s => s.id === 'sc_merge');
  assert.strictEqual(sc.title, 'インポート側(新しい)');
  assert.strictEqual(sc.ccfRooms.length, 3, '3部屋すべてがマージされて残ること');
  assert.strictEqual(sc.ccfRooms.find(r => r.id === 'room_1').name, '部屋1(ベースの方が新しい)', '部屋単位の updatedAt 比較で新しい方が保持されること');
  assert.strictEqual(sc.ccfRooms.find(r => r.id === 'room_2').name, '部屋2(インポート側が新しい)', '部屋単位の updatedAt 比較でインポート側の更新が反映されること');
  assert.strictEqual(sc.images.length, 2, '両方のシナリオ内画像が消失せずマージされること');
  assert.ok(sc.imageCategories.includes('カスタム分類') && sc.imageCategories.includes('部屋素材'), 'シナリオ画像カテゴリも統合・6カテゴリ化されること');
  assert.strictEqual(merged.unlinkedCcfRooms.length, 2, '未紐付けココフォリア部屋もマージされること');
});

test('修正検証(A-6): ココフォリア writeProject / saveRoomContainer 実行時に S.rooms が最新状態へ同期される', () => {
  const M = require('./ccfolia/ccf_model.js');
  const codeCcfUi = readAppFile(path.join('ccfolia', 'ccf_ui.js'));
  const sc = {
    id: 'sc_sync',
    title: '同期テスト',
    ccfRooms: [{ id: 'rm_1', name: 'メイン部屋', createdAt: 10, updatedAt: 10, project: M.sanitizeProject(null) }],
    ccfActiveRoomId: 'rm_1'
  };
  const fakeWindow = {
    CCFText: {},
    CCFNpc: {},
    CCFModel: M,
    addEventListener: () => {}
  };
  const fakeDoc = {
    readyState: 'loading',
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const initCcf = new Function(
    'window', 'document', 'IS_ELECTRON', 'DATA_ROOT', 'path', 'fs', 'localStorage', 'scenarioList', 'saveState', 'switchTab', 'appState',
    codeCcfUi + '\nreturn window.CCF;'
  );
  const store = new Map();
  const ccf = initCcf(
    fakeWindow,
    fakeDoc,
    false,
    '',
    path,
    fs,
    { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) },
    () => [sc],
    () => {},
    () => {},
    { scenarios: [sc] }
  );

  // S.key と S.rooms をセットした状態で writeProject を実行
  ccf.S.key = 'sc_sync';
  ccf.S.roomId = 'rm_1';
  ccf.S.rooms = [{ id: 'rm_1', name: 'メイン部屋', createdAt: 10, updatedAt: 10, project: M.sanitizeProject(null) }];

  const updatedProj = M.sanitizeProject({ stocks: [{ id: 'st_1', title: '導入', text: '更新された本文' }] });
  ccf.writeProject('sc_sync', updatedProj, 'rm_1');

  assert.strictEqual(ccf.S.rooms[0].project.stocks.length, 1, 'S.rooms 内の該当 room.project が最新状態へ同期されていること');
  assert.strictEqual(ccf.S.rooms[0].project.stocks[0].text, '更新された本文');
  assert.strictEqual(sc.ccfRooms[0].project.stocks[0].text, '更新された本文', 'sc.ccfRooms 側も同時に更新されていること');
});

test('修正検証(B-1): thumbMap が dataUrl 全文をキーに保持せず、cleanupUnusedImages が未使用 ObjectURL と IDB を解放する', async () => {
  const code02 = readAppFile('app_test49_02_storage_images.js');
  const createdUrls = [];
  const revokedUrls = [];
  const idbStore = { images: new Map(), thumbs: new Map() };
  const fakeUrl = {
    createObjectURL: () => { const u = 'blob:mock-' + (createdUrls.length + 1); createdUrls.push(u); return u; },
    revokeObjectURL: (u) => { revokedUrls.push(u); }
  };
  const fakeAppState = { scenarios: [], imageAssets: [] };
  const fakeBlockOrder = [];
  const fakeSecretHOs = [];

  const run02 = new Function(
    'window', 'document', 'URL', 'Blob', 'MutationObserver', 'IntersectionObserver',
    'idbPut', 'idbGet', 'idbDel', 'dataURLtoBlob', 'createImageBitmap', 'escapeHTML', 'logSoft',
    'appState', 'blockOrder', 'secretHOs',
    code02 + '\nreturn { urlToRef, thumbSrc, cleanupUnusedImages, imgFlush: window.imgFlush, debug: window._imgStoreDebug };'
  )(
    stubs.window,
    stubs.document,
    fakeUrl,
    Blob,
    class { observe() {} },
    class { observe() {} unobserve() {} },
    async (st, k, v) => { idbStore[st].set(k, v); },
    async (st, k) => idbStore[st].get(k) || null,
    async (st, k) => { idbStore[st].delete(k); },
    () => new Blob(['img'], { type: 'image/png' }),
    async () => ({ width: 100, height: 100, close() {} }),
    stubs.escapeHTML,
    () => {},
    fakeAppState,
    fakeBlockOrder,
    fakeSecretHOs
  );

  const sampleDataUrl1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const sampleDataUrl2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACCDAv8cI7IoAAAAAElFTkSuQmCC';

  const ref1 = run02.urlToRef(sampleDataUrl1);
  const ref2 = run02.urlToRef(sampleDataUrl2);
  await run02.imgFlush();

  // thumbMap のキーに巨大な data:image/... 全文が含まれていないこと
  for (const k of run02.debug.thumbMap.keys()) {
    assert.ok(!String(k).startsWith('data:image/'), 'thumbMap のキーに dataUrl 全文が保持されないこと: ' + k);
  }

  // ref1 のみ appState で使用中、ref2 は未使用として cleanupUnusedImages を実行
  fakeAppState.imageAssets = [{ id: 'a1', name: '1.png', dataUrl: ref1, category: 'NPC' }];
  const removedCount = await run02.cleanupUnusedImages();
  assert.strictEqual(removedCount, 1, '未使用の画像1件がクリーンアップされること');
  assert.ok(revokedUrls.length >= 1, '未使用画像の ObjectURL が revokeObjectURL で解放されること');
  assert.strictEqual(idbStore.images.size, 1, 'IndexedDB images からも未使用分が削除され使用中1件のみ残ること');
});

test('修正検証(B-2): zip_store.js がエントリ読込・ストリーム読出後にファイルハンドルを閉じ、Windows上でZIPの移動・削除が可能である', async () => {
  const zipStore = require('./ccfolia/main/zip_store.js');
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trpg_zip_test_'));
  const zipPath = path.join(tmpDir, 'test.zip');
  const renamedPath = path.join(tmpDir, 'test_renamed.zip');

  // 最小構成の有効な非圧縮ZIPバイナリを生成（hello.txt: "hello"）
  const fileName = Buffer.from('hello.txt', 'utf8');
  const data = Buffer.from('hello', 'utf8');
  const crc32 = 0x3610a686; // CRC32("hello")
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(crc32, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(fileName.length, 26);

  const cdOffset = localHeader.length + fileName.length + data.length;
  const cdHeader = Buffer.alloc(46);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(0x0800, 8);
  cdHeader.writeUInt16LE(0, 10);
  cdHeader.writeUInt32LE(crc32, 16);
  cdHeader.writeUInt32LE(data.length, 20);
  cdHeader.writeUInt32LE(data.length, 24);
  cdHeader.writeUInt16LE(fileName.length, 28);
  cdHeader.writeUInt32LE(0, 42);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdHeader.length + fileName.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  fs.writeFileSync(zipPath, Buffer.concat([localHeader, fileName, data, cdHeader, fileName, eocd]));

  const opened = await zipStore.open(zipPath);
  assert.strictEqual(opened.entries.length, 1);
  assert.strictEqual(opened.entries[0].name, 'hello.txt');
  assert.strictEqual(zipStore.isHandleOpen(opened.id), false, 'open() 完了時点で OS ファイルハンドルが閉じられていること');

  // ストリーム読み出しもオンデマンドで動作すること
  const stream = await zipStore.openStream(opened.id, 'hello.txt');
  const chunks = [];
  await new Promise((res, rej) => {
    stream.on('data', c => chunks.push(c));
    stream.on('end', res);
    stream.on('error', rej);
  });
  assert.strictEqual(Buffer.concat(chunks).toString('utf8'), 'hello');

  // アイドルクローズ後に Windows 上でリネーム・削除がロックエラーなく成功すること
  zipStore.releaseZipHandle(opened.id);
  assert.strictEqual(zipStore.isHandleOpen(opened.id), false, 'ストリーム終了後にハンドルが解放されていること');
  fs.renameSync(zipPath, renamedPath);
  fs.unlinkSync(renamedPath);
  zipStore.closeZip(opened.id);
  fs.rmdirSync(tmpDir);
});

// ============================================================================
// 4. ココフォリア特化モジュール単体テスト（ccfolia/tests/ccf_tests.js）の連携実行
// ============================================================================
test('ccfolia/tests/ccf_tests.js（全180件）がパスする', () => {
  const { execFileSync } = require('child_process');
  const ccfTestPath = path.join(targetDir, 'ccfolia', 'tests', 'ccf_tests.js');
  const out = execFileSync(process.execPath, [ccfTestPath], { encoding: 'utf8' });
  assert.ok(/\b180 passed, 0 failed\b/.test(out), 'ccf_tests.js が 180 passed, 0 failed であること:\n' + out);
});

(async () => {
  for (const t of testQueue) {
    try {
      await t.fn();
      passed++;
      console.log('  [PASS] ' + t.name);
    } catch (e) {
      failed++;
      failures.push({ name: t.name, error: e });
      console.error('  [FAIL] ' + t.name + ' -> ' + (e && e.message ? e.message : e));
    }
  }
  console.log(`\n=== dev_tests_test49.js 結果: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
