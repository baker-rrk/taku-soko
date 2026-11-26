/* ccf_model.js — ココフォリア特化ツール Phase 1：データモデル（DOM／Electron に依存しない純粋関数）
 *  - プロジェクト（ストック・NPC・設定）の初期値と正規化
 *  - NPC／ダミー駒 → ココフォリアのキャラクターデータ（クリップボード形式 {"kind":"character","data":{…}}）への変換
 *  ※ ZIP（部屋データ）の読み書きは Phase 2 以降。ここでは「ココフォリアの盤面に Ctrl+V で貼り付けられる形式」までを扱う。 */
(function () {
  'use strict';
  const T = (typeof window !== 'undefined' && window.CCFText) || require('./ccf_text.js');

  const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const str = (v, d) => (typeof v === 'string' ? v : (v == null ? (d || '') : String(v)));
  const num = (v, d) => {
    if (v === '' || v == null || (typeof v === 'string' && !v.trim())) return d || 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : (d || 0);
  };

  const DEFAULT_SETTINGS = {
    joinLines: 'smart',        // 改行の除去：smart / all / none
    stripSpaces: true,         // 不要な空白の除去
    autoClean: true,           // 抽出と同時に整形する
    alwaysAppend: false,       // 抽出テキストを常に追記する（false なら Shift を押しながら選択したときだけ追記）
    edition: 'auto',           // CoC の版：auto / 6 / 7
    rollPrefix: 'CCB',         // 技能ロールの接頭辞
    abilityRolls: true,        // 能力値ロール（STR など）もチャパレに入れる
    includeTitle: true,        // ダミー駒の各行の先頭に【見出し】を付ける
    maxChars: 1000,            // ダミー駒の1行の最大文字数（超えたら分割）
    maxLines: 30,              // ダミー駒1体あたりの行数（超えたら駒を分ける）
    pieceName: 'シナリオテキスト',
    system: 'coc6',            // ゲームシステム（coc6 / coc7 / emoklore / twod6 / dx3 / sw25 / futari / stratera / madamis）
    statusPublic: true,        // ステータスを公開する（false ならココフォリアの secret=true）
    secretDice: false,         // シークレットダイス（コマンド先頭に s）
    renda: false, cbrb: true, resb: true,   // CoC6：連撃・CBRB・RESB
    hardExt: false, bpDice: false,          // CoC7：ハード/イクストリーム・ボーナス/ペナルティダイス
    autoInsertStock: true      // 追加時に自動でページ・登場順の位置へ挿入
  };
  const SYSTEM_IDS = ['coc6', 'coc7', 'emoklore', 'twod6', 'dx3', 'sw25', 'futari', 'stratera', 'madamis'];

  function sanitizeSettings(s) {
    const d = Object.assign({}, DEFAULT_SETTINGS, s && typeof s === 'object' ? s : {});
    d.system = SYSTEM_IDS.includes(d.system) ? d.system : 'coc6';
    ['statusPublic', 'secretDice', 'renda', 'cbrb', 'resb', 'hardExt', 'bpDice'].forEach(k => { d[k] = !!d[k]; });
    d.joinLines = ['smart', 'all', 'none'].includes(d.joinLines) ? d.joinLines : 'smart';
    d.edition = ['auto', '6', '7'].includes(String(d.edition)) ? String(d.edition) : 'auto';
    d.rollPrefix = ['CCB', 'CC'].includes(d.rollPrefix) ? d.rollPrefix : 'CCB';
    ['stripSpaces', 'autoClean', 'alwaysAppend', 'abilityRolls', 'includeTitle', 'autoInsertStock'].forEach(k => { d[k] = !!d[k]; });
    d.maxChars = Math.min(5000, Math.max(50, num(d.maxChars, 1000)));
    d.maxLines = Math.min(200, Math.max(1, num(d.maxLines, 30)));
    d.pieceName = str(d.pieceName, DEFAULT_SETTINGS.pieceName).trim() || DEFAULT_SETTINGS.pieceName;
    return d;
  }
  /** 抽出元（PDFパス・ページ・座標）。座標は倍率1のPDF座標系 {x,y,w,h}。循環参照を避けるため素のオブジェクトだけを持つ */
  function sanitizeSrcs(a) {
    return (Array.isArray(a) ? a : []).slice(0, 10).map(x => {
      if (!x || typeof x !== 'object') return null; const r = x.rect && typeof x.rect === 'object' ? { x: num(x.rect.x, 0), y: num(x.rect.y, 0), w: num(x.rect.w, 0), h: num(x.rect.h, 0) } : null;
      return { path: str(x.path), name: str(x.name), page: Math.max(1, num(x.page, 1)), rect: r && r.w > 0 && r.h > 0 ? r : null };
    }).filter(Boolean);
  }
  /** PDFごとのしおり（部屋データごと） */
  function sanitizeBookmarks(a) {
    return (Array.isArray(a) ? a : []).slice(0, 300).map(b => b && typeof b === 'object' && str(b.path) ? { id: str(b.id) || newId(), path: str(b.path), name: str(b.name), page: Math.max(1, num(b.page, 1)), label: str(b.label) } : null).filter(Boolean);
  }
  function sanitizeStock(s) {
    if (!s || typeof s !== 'object' || !str(s.text).trim()) return null;
    const optIdx = v => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) ? Math.max(0, Math.round(Number(v))) : null;
    return {
      id: str(s.id) || newId(),
      title: str(s.title),
      text: str(s.text),
      page: s.page == null ? null : (num(s.page, 0) || null),
      lineIdx: optIdx(s.lineIdx),
      docIdx: optIdx(s.docIdx),
      srcs: sanitizeSrcs(s.srcs),
      createdAt: num(s.createdAt, Date.now())
    };
  }
  const isSafeImgSrc = v => /^(?:@img:[a-z0-9]+|cloud-asset:|data:image\/|file:\/\/|https?:\/\/|zipview:\/\/|blob:)/i.test(str(v).trim());
  const isUnsafeImg = v => /^(?:javascript|vbscript|data:(?!image\/))/i.test(str(v).trim());
  function normalizeImgRef(v) {
    const s = str(v).trim();
    if (!s || isUnsafeImg(s)) return '';
    if (/^blob:/i.test(s) && typeof window !== 'undefined' && typeof window.urlToRef === 'function') {
      try {
        const ref = window.urlToRef(s);
        if (typeof ref === 'string' && ref && !/^blob:/i.test(ref)) return ref;
      } catch (_) { }
      return '';
    }
    return s;
  }
  function normalizeNpcImageItem(x) {
    if (typeof x === 'string') {
      const s = x.trim();
      if (!s || isUnsafeImg(s)) return null;
      if (isSafeImgSrc(s)) {
        const cleaned = normalizeImgRef(s);
        if (!cleaned) return null;
        return { id: newId(), path: '', filePath: '', dataUrl: cleaned, assetId: '', label: '', name: '' };
      }
      return { id: newId(), path: s, filePath: s, dataUrl: '', assetId: '', label: '', name: '' };
    }
    if (!x || typeof x !== 'object') return null;
    let dataUrl = [x.dataUrl, x.url, x.src, x.iconUrl].map(v => str(v).trim()).find(isSafeImgSrc) || '';
    dataUrl = normalizeImgRef(dataUrl);
    let p = str(x.path || x.filePath).trim();
    if (isUnsafeImg(p)) p = '';
    if (!dataUrl && isSafeImgSrc(p)) { dataUrl = normalizeImgRef(p); p = ''; }
    else if (/^blob:/i.test(p)) {
      const pRef = normalizeImgRef(p);
      if (/^@img:/i.test(pRef)) { if (!dataUrl) dataUrl = pRef; p = ''; }
      else p = pRef;
    }
    let fp = str(x.filePath || p).trim();
    if (isUnsafeImg(fp)) fp = '';
    if (/^blob:/i.test(fp)) {
      const fpRef = normalizeImgRef(fp);
      fp = /^@img:/i.test(fpRef) ? '' : fpRef;
    }
    const assetId = str(x.assetId).trim();
    if (!dataUrl && !p && !fp && !assetId) return null;
    return { id: str(x.id) || newId(), path: p, filePath: fp, dataUrl, assetId, label: str(x.label || x.name), name: str(x.name || x.label) };
  }
  function sanitizeNpc(n) {
    if (!n || typeof n !== 'object') return null;
    const arr = a => Array.isArray(a) ? a : [];
    const seenImg = new Set(), images = [];
    const pushImg = item => {
      const it = normalizeNpcImageItem(item); if (!it) return;
      const k = it.dataUrl || it.path || it.filePath || it.assetId;
      if (k && seenImg.has(k)) return;
      if (k) seenImg.add(k);
      if (images.length < 24) images.push(it);
    };
    arr(n.images).forEach(pushImg);
    arr(n.portraits).forEach(pushImg);
    if (!images.length) {
      [n.iconDataUrl, n.image, n.imagePath, n.iconUrl, n.portrait].forEach(cand => {
        if (images.length || !cand) return;
        const it = normalizeNpcImageItem(cand);
        if (it) { if (!it.label) it.label = str(n.iconName); if (!it.name) it.name = str(n.iconName); pushImg(it); }
      });
    }
    const head = images[0] || null;
    const headSrc = head ? (head.dataUrl || head.path || head.filePath || null) : null;
    const headPath = head ? (head.filePath || head.path || head.dataUrl || '') : '';
    const iconDataUrl = head && head.dataUrl ? head.dataUrl : (isSafeImgSrc(headSrc) ? (normalizeImgRef(headSrc) || null) : (isSafeImgSrc(n.iconDataUrl) ? (normalizeImgRef(n.iconDataUrl) || null) : null));
    const iconName = head ? (head.label || head.name || str(n.iconName)) : str(n.iconName);
    return {
      id: str(n.id) || newId(), name: str(n.name, '名称未設定NPC'), memo: str(n.memo), initiative: num(n.initiative, 0), externalUrl: str(n.externalUrl),
      status: arr(n.status).filter(x => x && str(x.label)).map(x => Object.assign({ label: str(x.label), value: num(x.value, 0), max: num(x.max, num(x.value, 0)) }, x._auto ? { _auto: true } : {})),
      params: arr(n.params).filter(x => x && str(x.label)).map(x => Object.assign({ label: str(x.label), value: str(x.value) }, x._auto ? { _auto: true } : {})),
      skills: arr(n.skills).filter(x => x && str(x.name)).map(x => Object.assign({ name: str(x.name), value: num(x.value, 0), known: !!x.known, include: x.include !== false, damage: str(x.damage), lv: num(x.lv, 0), mod: num(x.mod, 0), multi: !!x.multi }, x._auto ? { _auto: true } : {})),
      system: SYSTEM_IDS.includes(n.system) ? n.system : '', sysOpts: n.sysOpts && typeof n.sysOpts === 'object' ? JSON.parse(JSON.stringify(n.sysOpts)) : {},
      extra: Object.keys(n.extra && typeof n.extra === 'object' ? n.extra : {}).reduce((a, k) => { a[k] = str(n.extra[k]); return a; }, {}),
      commands: str(n.commands), edition: n.edition === '7' ? '7' : '6', rollPrefix: n.rollPrefix === 'CC' ? 'CC' : 'CCB',
      iconDataUrl, iconName,
      image: headSrc, imagePath: headPath, iconUrl: headSrc, portrait: headSrc,
      images,
      portraits: images.map(x => Object.assign({}, x)),
      source: str(n.source), srcs: sanitizeSrcs(n.srcs),
      createdAt: num(n.createdAt, Date.now())
    };
  }
  const STANDARD_SCENARIO_CATS = ['トレーラー', 'NPC', '背景', '前景', 'マップ', '部屋素材'];
  const isUnclassifiedCat = c => { const s = str(c).trim(); return !s || s === '(未分類)' || s === '（未分類）' || s === '未分類'; };
  const STANDARD_CAT_RULES = [
    ['トレーラー', /^(?:trailer|trailers|トレーラー)$/i],
    ['NPC', /^(?:npc|npcs)$/i],
    ['背景', /^(?:bg|bgs|background|backgrounds|背景)$/i],
    ['前景', /^(?:fg|fgs|foreground|foregrounds|前景)$/i],
    ['マップ', /^(?:map|maps|マップ)$/i],
    ['部屋素材', /^(?:room|rooms|room_assets|roomassets|部屋素材)$/i]
  ];
  function normalizeStandardCat(cat) {
    const raw = str(cat).normalize('NFKC').trim();
    if (isUnclassifiedCat(raw)) return '';
    const cleaned = stripFolderDecor(raw);
    for (const [std, re] of STANDARD_CAT_RULES) {
      if (re.test(raw) || (cleaned && re.test(cleaned))) return std;
    }
    return raw;
  }
  const RE_OLD_FOLDER = /(?:旧|過去|差替前|差し替え前|修正前|退避|控え|(?:^|[\s_\-.(\[【])(?:old|backup|bak|bkup|archive|prev|deprecated)(?:$|[\s_\-.)\]】0-9v]))/i;
  const isOldFolderName = name => RE_OLD_FOLDER.test(str(name).trim());

  /** フォルダ名先頭の装飾記号・番号・囲み括弧を除去して純粋な分類名を取り出す */
  function stripFolderDecor(name) {
    let s = str(name).normalize('NFKC').trim();
    for (let i = 0; i < 3; i++) {
      const prev = s;
      s = s.replace(/^[☆★●◆◎○■□▲△▼▽◇◈✦✧※♪♫・\s\-_=~〜]+/, '').trim();
      s = s.replace(/^\d{1,3}(?:[\s._\-・)）:：]+)(?=\S)/, '').trim();
      const wrap = s.match(/^(?:【([^】]+)】|\[([^\]]+)\]|（([^）]+)）|\(([^)]+)\)|「([^」]+)」|『([^』]+)』)$/);
      if (wrap) s = (wrap[1] || wrap[2] || wrap[3] || wrap[4] || wrap[5] || wrap[6] || '').trim();
      s = s.replace(/[☆★●◆◎○■□▲△▼▽◇◈✦✧※♪♫・\s\-_=~〜]+$/, '').trim();
      if (s === prev) break;
    }
    return s;
  }

  const FOLDER_SYSTEM_EXACT_RULES = [
    [/^(?:coc\s*7(?:\s*版|th)?|新クトゥルフ(?:神話)?(?:\s*trpg)?|クトゥルフ(?:神話)?\s*(?:7\s*版|7th|第\s*7)|call\s*of\s*cthulhu\s*7(?:th)?)$/i, () => 'CoC7版'],
    [/^(?:coc(?:\s*6(?:\s*版|th)?)?|クトゥルフ(?:神話)?(?:\s*(?:6\s*版|6th|第\s*6))?(?:\s*trpg)?|call\s*of\s*cthulhu(?:\s*6(?:th)?)?)$/i, () => 'CoC6版'],
    [/^(?:エモクロア(?:\s*trpg)?|emoklore)$/i, () => 'エモクロア'],
    [/^(?:インセイン|insane)$/i, () => 'インセイン'],
    [/^(?:マーダーミステリー|マダミス|murder\s*mystery)$/i, () => 'マダミス'],
    [/^(?:ストリテラ)$/i, () => 'ストリテラ'],
    [/^(?:ストーリープレイング)$/i, () => 'ストーリープレイング'],
    [/^(?:シノビガミ|忍神)$/i, () => 'シノビガミ'],
    [/^(?:sw\s*2\.?5|ソード.?ワールド\s*2\.?5)$/i, () => 'SW2.5'],
    [/^(?:sw\s*2\.?0|ソード.?ワールド\s*2\.?0)$/i, () => 'SW2.0'],
    [/^(?:sw|ソード.?ワールド)$/i, () => 'SW'],
    [/^(?:dx\s*3(?:rd)?|ダブルクロス(?:\s*3(?:rd)?)?)$/i, () => 'DX3rd'],
    [/^(?:フタリソウサ)$/i, () => 'フタリソウサ'],
    [/^(?:ネクロニカ)$/i, () => 'ネクロニカ'],
    [/^(?:マギカロギア)$/i, () => 'マギカロギア'],
    [/^(?:サタスペ)$/i, () => 'サタスペ'],
    [/^(?:アリアンロッド)$/i, () => 'アリアンロッド'],
    [/^(?:パラノイア)$/i, () => 'パラノイア'],
    [/^(?:ナイトウィザード)$/i, () => 'ナイトウィザード'],
    [/^(?:ゴブリンスレイヤー)$/i, () => 'ゴブリンスレイヤー'],
    [/^(?:ログ.?ホライズン)$/i, () => 'ログ・ホライズン'],
    [/^(?:トーキョー\s*n[◎o]va)$/i, () => 'トーキョーN◎VA'],
    [/^(?:ブレイド.?オブ.?アルカナ)$/i, () => 'ブレイド・オブ・アルカナ'],
    [/^(?:銀剣のステラナイツ|ステラナイツ)$/i, () => 'ステラナイツ'],
    [/^(?:ウタカゼ)$/i, () => 'ウタカゼ'],
    [/^(?:ブラッドパス)$/i, () => 'ブラッドパス'],
    [/^(?:クラヤミクライン)$/i, () => 'クラヤミクライン'],
    [/^(?:キルデスビジネス)$/i, () => 'キルデスビジネス'],
    [/^(?:デッドラインヒーローズ)$/i, () => 'デッドラインヒーローズ'],
    [/^(?:ケダモノオペラ)$/i, () => 'ケダモノオペラ']
  ];

  const CATEGORY_WORDS_RE = /^(?:trpg|シナリオ|シナリオ一覧|シナリオ集|所持シナリオ|未通過|通過済|通過済み|回せる|通過予定|積んでいる|積み|お気に入り|その他|未分類|アーカイブ|新規|継続|限定|推奨|不問|可能|専用|向け|可|不可|ok|ng|新規限定|新規推奨|継続限定|継続不問|継続推奨|置きレス|置きレスシナリオ|置き卓|ボイセ|テキセ|半テキ|完テキ|短時間|長時間|短編|長編|タイマン|ソロ|ペア|デュオ|少人数|複数人|多人数|大人数|キャンペーン|cp|周回|秘匿|秘匿ho|hoあり|ho|うちよそ|r-?18(?:-?g)?|成人向け|全年齢|ホラー|クラシック|クローズド|シティ|茶番|ギャグ|協力|pvp|ロスト|高ロスト|中ロスト|低ロスト|極高ロスト|確定ロスト|ロストあり|ロストなし|ロスト無|ロスト有|ロスト率高|ロスト率低|ロスト救済|救済|復活|蘇生|kpc|ロストkpc|kpcロスト|pcロスト|kpcあり|kpc専用|san回復|san値回復|正気度回復|発狂|後遺症|鬱|胸くそ|メリバ|バッドエンド|ハッピーエンド|エモ|シリアス|コメディ|ほのぼの|日常|謎解き|推理|脱出|rp重視|戦闘あり|戦闘なし|戦闘|探索|季節|春|夏|秋|冬|ハロウィン|クリスマス|バレンタイン|正月|学園|学校|現代|和風|西洋|中華|sf|ファンタジー|一覧|まとめ|フォルダ|分類|一般|配布|購入済み?|プレイ済み?|[あ-んア-ン]行|[a-z](?:\s*-\s*[a-z])?|0\s*-\s*9|数字|記号)$/i;
  const CATEGORY_COMPOUND_RE = /^(?:新規|継続|限定|推奨|不問|可能|専用|向け|置きレス|置き卓|ボイセ|テキセ|半テキ|完テキ|ソロ|タイマン|ペア|デュオ|秘匿|ho|短時間|長時間|短編|長編|キャンペーン|cp|周回|クラシック|クローズド|シティ|うちよそ|r-?18(?:-?g)?|ホラー|茶番|ギャグ|戦闘あり|戦闘なし|戦闘|探索|ロスト|高ロスト|中ロスト|低ロスト|極高ロスト|確定ロスト|ロストあり|ロストなし|ロスト無|ロスト有|ロスト率高|ロスト率低|ロスト救済|救済|復活|蘇生|kpc|pc|san回復|san値回復|正気度回復|発狂|後遺症|鬱|胸くそ|メリバ|バッドエンド|ハッピーエンド|エモ|シリアス|コメディ|ほのぼの|日常|謎解き|推理|脱出|rp重視|季節|春|夏|秋|冬|ハロウィン|クリスマス|バレンタイン|正月|学園|学校|現代|和風|西洋|中華|sf|ファンタジー|シナリオ|一覧|まとめ|フォルダ|分類|未分類)+$/i;

  /** 分類用親フォルダ名からシステム名を推定する（該当しない場合は ''） */
  function inferSystemFromFolderName(name) {
    const cleaned = stripFolderDecor(name);
    if (!cleaned) return '';
    const spaced = cleaned.replace(/[_-]+/g, ' ').trim();
    const candidates = [
      cleaned,
      spaced,
      cleaned.replace(/[\s_-]*(?:シナリオ一覧|シナリオ集|シナリオ|一覧|フォルダ|関連)$/i, '').trim(),
      spaced.replace(/[\s_-]*(?:シナリオ一覧|シナリオ集|シナリオ|一覧|フォルダ|関連)$/i, '').trim(),
      cleaned.replace(/(?:（([^）]+)）|\(([^)]+)\))$/g, (_, a, b) => ' ' + (a || b || '')).trim()
    ].filter(Boolean);
    for (const c of candidates) {
      for (const [re, fn] of FOLDER_SYSTEM_EXACT_RULES) {
        if (re.test(c)) return fn(c);
      }
    }
    return '';
  }

  /** 条件A：システム名や分類語そのものに一致する中間分類フォルダか */
  function isCategoryFolderName(name) {
    const cleaned = stripFolderDecor(name);
    if (!cleaned) return false;
    if (inferSystemFromFolderName(cleaned)) return true;
    if (CATEGORY_WORDS_RE.test(cleaned) || CATEGORY_COMPOUND_RE.test(cleaned)) return true;
    const parts = cleaned.split(/[\s・／/_\-、,&＆()（）【】\[\]]+/).filter(Boolean);
    return parts.length > 0 && parts.every(p => !!inferSystemFromFolderName(p) || CATEGORY_WORDS_RE.test(p) || CATEGORY_COMPOUND_RE.test(p));
  }

  // ---------- シナリオ名クレンジング・システム名抽出・名寄せ ----------
  const TITLE_SYS_RULES = [
    [/^(?:coc[\s_-]*7(?:\s*版|th)?|新クトゥルフ(?:神話)?(?:\s*trpg)?|クトゥルフ(?:神話)?[\s_-]*(?:7\s*版|7th|第\s*7)|call\s*of\s*cthulhu[\s_-]*7(?:th)?)$/i, 'CoC7版'],
    [/^(?:coc[\s_-]*6(?:\s*版|th)?|クトゥルフ(?:神話)?[\s_-]*(?:6\s*版|6th|第\s*6)|call\s*of\s*cthulhu[\s_-]*6(?:th)?)$/i, 'CoC6版'],
    [/^(?:coc|クトゥルフ(?:神話)?(?:\s*trpg)?|call\s*of\s*cthulhu)$/i, 'CoC'],
    [/^(?:エモクロア(?:\s*trpg)?|emoklore)$/i, 'エモクロア'],
    [/^(?:インセイン|insane)$/i, 'インセイン'],
    [/^(?:マーダーミステリー|マダミス|murder\s*mystery)$/i, 'マダミス'],
    [/^(?:ストリテラ)$/i, 'ストリテラ'],
    [/^(?:ストーリープレイング)$/i, 'ストーリープレイング'],
    [/^(?:シノビガミ|忍神)$/i, 'シノビガミ'],
    [/^(?:sw[\s_-]*2\.?5|ソード.?ワールド[\s_-]*2\.?5)$/i, 'SW2.5'],
    [/^(?:sw[\s_-]*2\.?0|ソード.?ワールド[\s_-]*2\.?0)$/i, 'SW2.0'],
    [/^(?:sw|ソード.?ワールド)$/i, 'SW'],
    [/^(?:dx[\s_-]*3(?:rd)?|ダブルクロス(?:[\s_-]*3(?:rd)?)?)$/i, 'DX3rd'],
    [/^(?:フタリソウサ)$/i, 'フタリソウサ'],
    [/^(?:ネクロニカ)$/i, 'ネクロニカ'],
    [/^(?:マギカロギア)$/i, 'マギカロギア'],
    [/^(?:サタスペ)$/i, 'サタスペ'],
    [/^(?:アリアンロッド)$/i, 'アリアンロッド'],
    [/^(?:パラノイア)$/i, 'パラノイア'],
    [/^(?:ナイトウィザード)$/i, 'ナイトウィザード'],
    [/^(?:ゴブリンスレイヤー)$/i, 'ゴブリンスレイヤー'],
    [/^(?:ログ.?ホライズン)$/i, 'ログ・ホライズン'],
    [/^(?:ケダモノオペラ)$/i, 'ケダモノオペラ']
  ];
  function matchTitleSystemToken(tok) {
    const t = str(tok).normalize('NFKC').trim();
    if (!t) return '';
    for (const [re, label] of TITLE_SYS_RULES) {
      if (re.test(t)) return label;
    }
    return '';
  }

  const SYS_TOKEN_ALT = '新クトゥルフ神話TRPG|クトゥルフ神話TRPG|新クトゥルフ|クトゥルフ|Call\\s*of\\s*Cthulhu(?:\\s*[67](?:th)?)?|CoC[\\s_-]*(?:[67](?:\\s*版|th)?)?|エモクロア(?:\\s*TRPG)?|emoklore|インセイン|insane|マーダーミステリー|マダミス|ストリテラ|ストーリープレイング|シノビガミ|忍神|ソード.?ワールド(?:\\s*2\\.?[05])?|SW(?:\\s*2\\.?[05])?|ダブルクロス(?:\\s*3(?:rd)?)?|DX\\s*3?(?:rd)?|フタリソウサ|ネクロニカ|マギカロギア|サタスペ|アリアンロッド|パラノイア|ナイトウィザード|ゴブリンスレイヤー|ログ.?ホライズン|ケダモノオペラ';
  const RE_LEAD_SYS = new RegExp('^(' + SYS_TOKEN_ALT + ')[\\s_/／・:：\\-]+(.+)$', 'i');
  const RE_TRAIL_SYS = new RegExp('^(.+?)[\\s_/／・:：\\-]+(' + SYS_TOKEN_ALT + ')$', 'i');
  const RE_TITLE_PLAYERS = /[（(【\[][^）)】\]]*(?:\d+\s*(?:PL|pl|人|名|PC)|タイマン|ソロ|ペア)[^）)】\]]*[）)】\]]/g;
  const RE_TITLE_BRACKETS = /【([^】]*)】|\[([^\]]*)\]|（([^）]*)）|\(([^)]*)\)/g;
  const RE_BRACKET_NOISE = /(?:CoC|6版|7版|クトゥルフ|エモクロア|インセイン|マダミス|シノビガミ|SW2\.?5|DX3|SPLL|秘匿|HO|R-?18|シナリオ|素材|一式|セット|同梱|追加|BGM|立ち絵|マップ|ZIP|PDF|ver\.?\s*\d|v\d+|更新|修正|改訂|オンライン|オフライン|Web|BOOTH|DL|配布|完全版|最新版|軽量版|分割版|統合版|\d{4}[./\-年]\d{1,2}|\d{4,8})/i;
  const DIST_WORDS_STRICT = 'オンライン版|オフライン版|オンセ版|オフセ版|Web版|ウェブ版|BOOTH版|DL版|ダウンロード版|配布版|配布用|完全版|改訂版|修正版|最新版|軽量版|分割版|統合版|更新版|体験版|テスト版|β版|ベータ版|同梱版|PDF版|データ版';
  const DIST_WORDS_ALL = DIST_WORDS_STRICT + '|オンライン|オフライン|Web|BOOTH|DL|配布|一式|セット|まとめ';
  const RE_LEAD_DIST_SEP = new RegExp('^(?:' + DIST_WORDS_ALL + ')[\\s_\\-・:：/／]+(.+)$', 'i');
  const RE_LEAD_DIST_STRICT = new RegExp('^(?:' + DIST_WORDS_STRICT + ')[\\s_\\-・:：/／]*(.+)$', 'i');
  const RE_TRAIL_DIST_SEP = new RegExp('^(.+?)[\\s_\\-・:：/／]+(?:' + DIST_WORDS_ALL + ')$', 'i');
  const RE_TRAIL_DIST_STRICT = new RegExp('^(.+?)(?:' + DIST_WORDS_STRICT + ')$', 'i');
  const RE_GENERIC_ROLE_TITLE = /^(?:本文|本編|本篇|シナリオ|データ|テキスト|text|pdf|doc|docs|資料|情報|概要|kp|gm|キーパー|真相|解説|ho\d*|ハンドアウト|秘匿|立ち絵|npc|キャラ|人物|画像|image|images|img|imgs|素材|assets?|部屋|ルーム|room|rooms|マップ|map|maps|背景|前景|トレーラー|trailer|表紙|サムネ|bgm|se|音声|音楽|音源|audio|sound|ココフォリア|ccfolia|ccf|おまけ|特典|付録|追加|差分|修正|改訂|更新|一式|セット|まとめ|新しいフォルダー?(?:\s*\(\d+\))?|new\s*folder(?:\s*\(\d+\))?|untitled|downloads?|無題|[\d\s._-]+)$/i;

  function isGenericRoleTitle(raw) {
    const s = str(raw).normalize('NFKC').replace(/\.(?:pdf|zip|txt|html?|md)$/i, '').trim();
    return !s || RE_GENERIC_ROLE_TITLE.test(s);
  }

  /** タイトルからノイズを除去し、システム名プレフィックスがあれば合わせて抽出する */
  function extractTitleAndSystem(raw, parentName) {
    let s = str(raw).normalize('NFKC').replace(/\.(?:pdf|zip|txt|html?|md)$/i, '').trim();
    let system = '';
    for (let iter = 0; iter < 5; iter++) {
      const prev = s;
      // 先頭記号・五十音インデックス・数字インデックス（英字は1文字でも削らない）
      s = s.replace(/^[☆★●◆◇■□▲△▼▽◎○◈✦✧※♪♫・\s\-_=~〜/／:：]+/, '').trim();
      s = s.replace(/^[ぁ-んァ-ヶ][\s _\-]+/, '').trim();
      s = s.replace(/^\d{1,3}[\s _\-]+(?=\S)/, '').trim();
      // 先頭・末尾のシステム名プレフィックス／サフィックス
      let m = RE_LEAD_SYS.exec(s);
      if (m && m[2].trim()) {
        const sys = matchTitleSystemToken(m[1]);
        if (sys) { if (!system) system = sys; s = m[2].trim(); }
      }
      m = RE_TRAIL_SYS.exec(s);
      if (m && m[1].trim()) {
        const sys = matchTitleSystemToken(m[2]);
        if (sys) { if (!system) system = sys; s = m[1].trim(); }
      }
      // 括弧内の人数・システム・タグ・版・更新日
      s = s.replace(RE_TITLE_PLAYERS, '');
      s = s.replace(RE_TITLE_BRACKETS, (full, a, b, c, d) => {
        const inner = (a || b || c || d || '').trim();
        const sys = matchTitleSystemToken(inner);
        if (sys) { if (!system) system = sys; return ''; }
        return RE_BRACKET_NOISE.test(inner) ? '' : full;
      });
      // 先頭・末尾の配布／版形態ワード
      if ((m = RE_LEAD_DIST_SEP.exec(s)) && m[1].trim()) s = m[1].trim();
      else if ((m = RE_LEAD_DIST_STRICT.exec(s)) && m[1].trim()) s = m[1].trim();
      if ((m = RE_TRAIL_DIST_SEP.exec(s)) && m[1].trim()) s = m[1].trim();
      else if ((m = RE_TRAIL_DIST_STRICT.exec(s)) && m[1].trim()) s = m[1].trim();
      // 管理番号・バージョン・更新日・修正年表記
      s = s.replace(/SPLL[-_]?\d+/gi, '');
      s = s.replace(/(?:^|[\s_\-.])(?:ver\.?|version|v)\s*\d+(?:[.\-_]\d+)*[a-z]?(?=$|[\s_\-.)\]】）])/gi, '');
      s = s.replace(/(?:[\s_\-]*)\d{4}[./\-]\d{1,2}(?:[./\-]\d{1,2})?(?:\s*(?:更新|修正|改訂)版?)?$/i, '');
      s = s.replace(/(?:[\s_\-]*)(?:20\d{2}|\d{4,8})\s*(?:更新|修正|改訂)版?$/i, '');
      s = s.replace(/(?:[\s_\-]*)(?:修正|改訂|更新)\s*(?:20\d{2}|\d{2,8}|版)?$/i, '');
      s = s.replace(/(?:[\s_\-]*)\d{6,8}$/g, '');
      s = s.replace(/[\s_\-]+(?:本文|本編|本篇|素材|立ち絵|NPC|マップ|BGM|ココフォリア|ccfolia|copy|追加|おまけ|特典|付録|部屋|room|data|データ|資料|概要|pdf|doc).*$/i, '');
      s = s.replace(/^[\s_\-・~〜/／:：]+|[\s_\-・~〜/／:：]+$/g, '').trim();
      if (s === prev) break;
    }
    if ((!s || isGenericRoleTitle(s)) && parentName && !isCategoryFolderName(parentName)) {
      const pRes = extractTitleAndSystem(parentName, '');
      if (pRes.title && !isGenericRoleTitle(pRes.title)) {
        s = pRes.title;
        if (!system && pRes.system) system = pRes.system;
      }
    }
    return { title: s, system };
  }

  function cleanseTitle(raw, parentName) {
    return extractTitleAndSystem(raw, parentName).title;
  }

  /** 比較用：クレンジング後、NFKC・小文字化し、空白・記号・括弧類・先頭☆/★等をすべて除去 */
  function normalizeForMatch(raw) {
    return cleanseTitle(raw).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  const ASSET_SUBDIR_PARTIAL_RE = /(?:トレーラー|trailer|サムネ|thumb|表紙|cover|title|タイトル|概要|お品書き|logo|ロゴ|npc|立ち絵|立絵|キャラ|人物|バストアップ|アイコン|icon|tachie|エネミー|enemy|モンスター|monster|探索者|神話生物|イラスト|portrait|face|差分|表情|マップ|map|見取り図|間取り|地図|フロア|floor|会場|探索箇所|盤面|前景|foreground|fg|フレーム|frame|オーバーレイ|overlay|エフェクト|effect|カード|card|アイテム|item|パーク|perk|パネル|panel|マーカー|marker|素材|assets?|部屋|ルーム|room|カットイン|cutin|駒|コマ|piece|token|トークン|ccfolia|ココフォリア|背景|background|bg(?!m)|風景|スチル|still|場面|シーン|scene|室内|室外|屋外|屋内|徒歩|車用|山中|toho|syaryou|yamanaka|用$|bgm|(?:^|[\s_\-.(\[【])se(?:$|[\s_\-.)\]】0-9])|音声|音楽|音源|ボイス|sound|audio|music|voice|本文|本編|本篇|テキスト|text|資料|配布|ハンドアウト|handout|(?:^|[\s_\-.(\[【0-9.])ho\d*(?:$|[\s_\-.)\]】])|doc|pdf|txt|画像|img|image|おまけ|特典|付録|データ|data)/i;
  /** 立ち絵・BGM・素材などのシナリオ内サブフォルダか（部分一致） */
  function isAssetSubdirName(name) {
    const raw = str(name).normalize('NFKC').trim();
    if (!raw) return false;
    if (ASSET_SUBDIR_PARTIAL_RE.test(raw)) return true;
    const cleaned = stripFolderDecor(raw);
    return !!cleaned && ASSET_SUBDIR_PARTIAL_RE.test(cleaned);
  }

  const DIRECT_DOC_RE = /\.(?:pdf|txt|html?|md|docx?)$/i;
  const DIRECT_IMAGE_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i;
  const DIRECT_AUDIO_RE = /\.(?:mp3|wav|ogg|m4a|flac|aac)$/i;
  const DIRECT_ZIP_RE = /\.zip$/i;
  const IGNORE_README_RE = /^read\s*me\./i;
  /** フォルダの中身から「container（中間親フォルダ）」「scenario（1つのシナリオ）」「empty」を判別する
   *  ※ 監視ルート（isWatchRoot）または明示的な分類フォルダ（isCategoryFolderName）の場合のみ container とし、
   *     固有タイトルのフォルダは直下にPDFが無くても必ず 1つの scenario として確定させる。 */
  function classifyContainerEntries(opts) {
    const o = opts || {};
    const name = str(o.name).trim();
    const validDirs = (Array.isArray(o.dirNames) ? o.dirNames : [])
      .map(d => str(d).trim())
      .filter(d => d && !d.startsWith('.') && d !== '__MACOSX' && d !== 'node_modules' && d !== '_TRPG_Data' && !isOldFolderName(d));
    const validFiles = (Array.isArray(o.fileNames) ? o.fileNames : [])
      .map(f => str(f).trim())
      .filter(f => f && !f.startsWith('.') && f !== 'desktop.ini' && f !== 'Thumbs.db');

    if (!validDirs.length && !validFiles.length) return 'empty';
    if (o.isWatchRoot || isCategoryFolderName(name)) {
      const hasContent = validDirs.length > 0 || validFiles.some(f => (DIRECT_DOC_RE.test(f) && !IGNORE_README_RE.test(f)) || DIRECT_IMAGE_RE.test(f) || DIRECT_AUDIO_RE.test(f) || DIRECT_ZIP_RE.test(f));
      return hasContent ? 'container' : 'empty';
    }
    return 'scenario';
  }
  const NPC_PORTRAIT_RE = /(?:npc|kpc|立ち絵|立絵|キャラ|chara|人物|バストアップ|アイコン|icon|tachie|差分|表情|通常|笑顔|微笑|怒り?|哀|悲しみ?|泣き?|照れ?|驚き?|困り?|焦り?|呆れ?|真顔|真剣|目閉じ|ウインク|シルエット|全身|衣装|私服|制服|戦闘服|礼装|着物|水着|(?:^|[\s_\-(（【\[])(?:ho|pc)\s*[1-9１-９](?:$|[\s_\-)）】\]]))/i;
  const NPC_EXTRA_RE = /エネミー|enemy|モンスター|monster|探索者|神話生物|イラスト|portrait|face/i;
  function isNpcPortraitNameOrPath(fileName, folderOrChain) {
    const fn = str(fileName).normalize('NFKC').trim();
    if (fn && NPC_PORTRAIT_RE.test(fn)) return true;
    const list = Array.isArray(folderOrChain) ? folderOrChain : [folderOrChain];
    return list.some(d => {
      const s = str(d).normalize('NFKC').trim();
      return !!s && !isUnclassifiedCat(s) && NPC_PORTRAIT_RE.test(s);
    });
  }
  const CAT_RULES = [
    ['NPC', new RegExp(NPC_PORTRAIT_RE.source + '|' + NPC_EXTRA_RE.source, 'i')],
    ['トレーラー', /トレーラー|trailer|サムネ|thumb|表紙|cover|title|タイトル|概要|お品書き|logo|ロゴ/i],
    ['マップ', /マップ|map|見取り図|間取り|地図|フロア|floor|会場|探索箇所|盤面/i],
    ['前景', /前景|foreground|fg|フレーム|frame|オーバーレイ|overlay|エフェクト|effect/i],
    ['背景', /背景|background|bg(?!m)|風景|スチル|still|場面|シーン|scene|室内|室外|屋外|屋内|徒歩|車用|山中|toho|syaryou|yamanaka/i],
    ['部屋素材', /カード|card|アイテム|item|パーク|perk|パネル|panel|マーカー|marker|素材|部屋|ルーム|room|カットイン|cutin|駒|コマ|piece|token|トークン|ハンドアウト|(?:^|[\s_\-.(\[【])ho\d*(?:$|[\s_\-.)\]】])|資料|doc|pdf/i]
  ];
  const RE_PURPOSE_SUBDIR = /用$/;
  const RE_GENERIC_IMG_DIR = /^(?:画像|img|imgs|image|images|pic|pics|picture|pictures)$/i;
  const RE_GENERIC_IMG_CONTAINER = /^(?:画像|img|imgs|image|images|pic|pics|picture|pictures)(?:素材|フォルダ|集)?$/i;
  const RE_AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
  function matchCatRuleByFolder(dn) {
    if (!dn || isUnclassifiedCat(dn)) return '';
    if (NPC_PORTRAIT_RE.test(String(dn).normalize('NFKC'))) return 'NPC';
    const hit = CAT_RULES.find(([, re]) => re.test(dn));
    if (hit) return hit[0];
    const cleaned = stripFolderDecor(dn);
    if (cleaned && RE_PURPOSE_SUBDIR.test(cleaned)) return '背景';
    if (RE_PURPOSE_SUBDIR.test(dn.trim())) return '背景';
    return '';
  }
  function inferSmartCategory(fileName, folderName) {
    const fn = str(fileName).trim(), dn = str(folderName).trim();
    if (fn && RE_AUDIO_EXT.test(fn)) {
      return (dn && !isUnclassifiedCat(dn)) ? dn : 'BGM';
    }
    if (isNpcPortraitNameOrPath(fn, dn)) return 'NPC';
    const dirCat = matchCatRuleByFolder(dn);
    if (dirCat) return dirCat;
    if (fn) {
      const hit = CAT_RULES.find(([, re]) => re.test(fn));
      if (hit) return hit[0];
    }
    return '';
  }
  function inferSmartCategoryFromFolders(fileName, folderChain, rootName) {
    const fn = str(fileName).trim();
    const dirs = Array.isArray(folderChain) ? folderChain.map(d => str(d).trim()).filter(Boolean) : [];
    const rootKey = rootName ? normalizeForMatch(rootName) : '';
    const subDirs = dirs.filter(d => {
      if (isUnclassifiedCat(d)) return false;
      if (rootKey && normalizeForMatch(d) === rootKey) return false;
      return true;
    });
    if (fn && RE_AUDIO_EXT.test(fn)) {
      const last = subDirs[subDirs.length - 1] || '';
      return last || 'BGM';
    }
    if (isNpcPortraitNameOrPath(fn, subDirs)) return 'NPC';
    for (let i = subDirs.length - 1; i >= 0; i--) {
      const dn = subDirs[i];
      const cleaned = stripFolderDecor(dn) || dn;
      if (RE_GENERIC_IMG_DIR.test(cleaned)) continue;
      if (i < subDirs.length - 1 && RE_GENERIC_IMG_CONTAINER.test(cleaned)) continue;
      const hit = matchCatRuleByFolder(dn);
      if (hit) return hit;
    }
    if (fn) {
      const hit = CAT_RULES.find(([, re]) => re.test(fn));
      if (hit) return hit[0];
    }
    if (fn && DIRECT_IMAGE_RE.test(fn)) {
      const hasSceneSubdir = subDirs.some(dn => {
        const cleaned = stripFolderDecor(dn) || dn;
        return !RE_GENERIC_IMG_DIR.test(cleaned) && !RE_GENERIC_IMG_CONTAINER.test(cleaned);
      });
      if (hasSceneSubdir) return '背景';
    }
    return '';
  }
  const RE_SYS_ID3 = /^(?:iTun[A-Z0-9_]*|iTunes_[A-Z0-9_]+|Songs-DB_[A-Z0-9_]*|MusicMatch_[A-Z0-9_]*|Encoding.*|LAME.*)$/i;
  const RE_HEX_GARBAGE = /^[0-9A-Fa-f\s]{6,}$/;
  const RE_TAG_URL = /^(?:https?:\/\/|www\.|ftp:\/\/)|[a-z0-9.-]+\.[a-z]{2,}\/\S*/i;
  function cleanTagValue(v) {
    const s = str(v).replace(/[\x00-\x1F\x7F\uFFFD]/g, '').trim();
    if (!s || s.length > 40) return '';
    if (RE_SYS_ID3.test(s) || RE_HEX_GARBAGE.test(s) || RE_TAG_URL.test(s)) return '';
    return s;
  }
  function isJunkTag(v) { return !cleanTagValue(v); }
  function cleanTagList(arr) {
    const out = [], seen = new Set();
    (Array.isArray(arr) ? arr : []).forEach(v => {
      const c = cleanTagValue(v);
      if (!c) return;
      const k = c.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(c); }
    });
    return out;
  }
  function parseSearchQuery(q) {
    const include = [], exclude = [];
    str(q).trim().toLowerCase().split(/\s+/).filter(Boolean).forEach(t => {
      if (t.startsWith('-') && t.length > 1) exclude.push(t.slice(1));
      else include.push(t);
    });
    return { include, exclude };
  }
  function matchSearchQuery(blob, parsed) {
    const p = typeof parsed === 'string' ? parseSearchQuery(parsed) : (parsed || { include: [], exclude: [] });
    if (!p.include.length && !p.exclude.length) return true;
    const b = str(blob).toLowerCase();
    return p.include.every(t => b.includes(t)) && p.exclude.every(t => !b.includes(t));
  }

  const REF_TYPES = ['pdf', 'audio', 'zip', 'image', 'video'];
  const baseNameOf = p => str(p).split(/[\\/]/).pop() || '';
  /** D&D で登録した素材の参照。実体はコピーせず、PC上の絶対パスだけを持つ。 */
  function sanitizeRef(r) {
    if (!r || typeof r !== 'object' || !str(r.path).trim() || !REF_TYPES.includes(r.type)) return null;
    const orig = str(r.origName) || baseNameOf(r.path);
    return { id: str(r.id) || newId(), type: r.type, name: str(r.name) || orig, origName: orig, path: str(r.path), category: normalizeStandardCat(r.category), tags: cleanTagList(r.tags), mtime: num(r.mtime, 0), order: num(r.order, 0), addedAt: num(r.addedAt, Date.now()) };
  }
  /** refs へ追加・更新する（同じパス・同名ファイルは mtime が新しい方で更新し重複を防ぐ）。追加/更新件数を返す */
  function addRefs(proj, list) {
    let n = 0;
    const byPath = new Map(), byName = new Map();
    proj.refs.forEach(r => {
      byPath.set(r.path.toLowerCase(), r);
      const bn = (r.origName || baseNameOf(r.path)).toLowerCase();
      if (bn && !byName.has(bn)) byName.set(bn, r);
    });
    (list || []).map(sanitizeRef).filter(Boolean).forEach(r => {
      const kp = r.path.toLowerCase(), kb = (r.origName || baseNameOf(r.path)).toLowerCase();
      const ex = byPath.get(kp) || (kb ? byName.get(kb) : null);
      if (ex) {
        const exMtime = num(ex.mtime, 0), inMtime = num(r.mtime, 0);
        if (kp !== ex.path.toLowerCase() && inMtime > exMtime) {
          byPath.delete(ex.path.toLowerCase());
          ex.path = r.path;
          ex.mtime = inMtime;
          ex.origName = r.origName;
          if (!ex.name || ex.name === baseNameOf(ex.path)) ex.name = r.name;
          if (r.category && !ex.category) ex.category = r.category;
          if (r.tags && r.tags.length) ex.tags = cleanTagList([...(ex.tags || []), ...r.tags]);
          byPath.set(kp, ex);
          n++;
        } else {
          if (inMtime > exMtime) ex.mtime = inMtime;
          if (r.tags && r.tags.length) ex.tags = cleanTagList([...(ex.tags || []), ...r.tags]);
        }
        return;
      }
      byPath.set(kp, r);
      if (kb) byName.set(kb, r);
      proj.refs.push(r);
      n++;
    });
    return n;
  }
  function sanitizeBoardItem(item, kind) {
    if (!item || typeof item !== 'object') return null;
    const k = str(item.kind || kind || 'screen');
    const defW = k === 'bg' || k === 'fg' ? 960 : k === 'piece' ? 96 : k === 'marker' ? 160 : 320;
    const defH = k === 'bg' || k === 'fg' ? 720 : k === 'piece' ? 96 : k === 'marker' ? 160 : 200;
    const w = Math.max(16, Math.min(4000, num(item.width, defW)));
    const h = Math.max(16, Math.min(4000, num(item.height, defH)));
    const defZ = k === 'bg' ? 0 : k === 'screen' ? 10 : k === 'marker' ? 20 : k === 'piece' ? 30 : 40;
    let dataUrl = normalizeImgRef(item.dataUrl);
    let p = str(item.path).trim();
    if (isUnsafeImg(p)) p = '';
    if (/^blob:/i.test(p)) {
      const pRef = normalizeImgRef(p);
      if (/^@img:/i.test(pRef)) { if (!dataUrl) dataUrl = pRef; p = ''; }
      else p = pRef;
    }
    const out = {
      id: str(item.id) || newId(),
      syncId: str(item.syncId),
      kind: k,
      npcId: str(item.npcId),
      assetUid: str(item.assetUid),
      name: str(item.name),
      path: p,
      dataUrl,
      color: str(item.color),
      text: str(item.text),
      x: Math.round(num(item.x, k === 'bg' || k === 'fg' ? 0 : 80)),
      y: Math.round(num(item.y, k === 'bg' || k === 'fg' ? 0 : 80)),
      width: Math.round(w),
      height: Math.round(h),
      angle: Math.round(num(item.angle, 0)),
      zIndex: Math.round(num(item.zIndex, defZ)),
      visible: item.visible !== false,
      locked: !!item.locked,
      lockAspect: item.lockAspect !== false,
      invisible: !!item.invisible
    };
    if (k === 'fg' || item.fitMode) out.fitMode = (item.fitMode === 'fill' || item.fitMode === 'cover' || item.fitMode === 'contain') ? item.fitMode : 'contain';
    return out;
  }

  function sanitizeSceneAudio(a) {
    if (!a || typeof a !== 'object') return null;
    const pathVal = str(a.path).trim();
    const nameVal = str(a.name).trim();
    if (!pathVal && !nameVal) return null;
    return {
      assetUid: str(a.assetUid),
      name: nameVal || baseNameOf(pathVal),
      path: pathVal,
      volume: Math.min(100, Math.max(0, Math.round(num(a.volume, 35)))),
      loop: a.loop !== false
    };
  }

  function sanitizeScene(s) {
    if (!s || typeof s !== 'object') return null;
    const arr = a => Array.isArray(a) ? a : [];
    const ms = s.manualSlots && typeof s.manualSlots === 'object' ? s.manualSlots : {};
    const optIdx = v => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) ? Math.max(0, Math.round(Number(v))) : null;
    const bwRaw = num(s.boardWidth, 0);
    const bhRaw = num(s.boardHeight, 0);
    const fgObj = s.fg ? sanitizeBoardItem(s.fg, 'fg') : null;
    const isValidFit = v => v === 'contain' || v === 'cover' || v === 'fill';
    const fgFit = isValidFit(s.fgFit) ? s.fgFit : (fgObj && isValidFit(fgObj.fitMode) ? fgObj.fitMode : '');
    if (fgObj && !isValidFit(s.fg.fitMode)) fgObj.fitMode = fgFit || 'contain';
    return {
      id: str(s.id) || newId(),
      title: str(s.title, '無題のシーン'),
      text: str(s.text),
      sceneMessage: str(s.sceneMessage),
      page: s.page == null ? null : (num(s.page, 0) || null),
      lineIdx: optIdx(s.lineIdx),
      docIdx: optIdx(s.docIdx),
      sourceName: str(s.sourceName),
      sourcePath: str(s.sourcePath),
      headingPattern: str(s.headingPattern),
      checked: !!s.checked,
      tags: cleanTagList(s.tags),
      boardWidth: bwRaw > 0 ? Math.max(96, Math.min(4000, Math.round(bwRaw))) : null,
      boardHeight: bhRaw > 0 ? Math.max(96, Math.min(4000, Math.round(bhRaw))) : null,
      fgFit,
      manualSlots: { bg: !!ms.bg, fg: !!ms.fg, screen: !!ms.screen, marker: !!ms.marker, bgm: !!ms.bgm },
      bg: s.bg ? sanitizeBoardItem(s.bg, 'bg') : null,
      fg: fgObj,
      screens: arr(s.screens).map(x => sanitizeBoardItem(x, 'screen')).filter(Boolean),
      markers: arr(s.markers).map(x => sanitizeBoardItem(x, 'marker')).filter(Boolean),
      bgm: s.bgm ? sanitizeSceneAudio(s.bgm) : null
    };
  }

  const DEFAULT_PATTERN_ROLES = {
    richhead: 'scene',
    chapter: 'scene',
    numdot: 'scene',
    square: 'info',
    diamond: 'info',
    brackets: 'info',
    other_sym: 'info',
    custom: 'info'
  };
  const VALID_PATTERN_ROLES = ['scene', 'info', 'ignore'];
  const VALID_GRANULARITIES = ['coarse', 'standard', 'detail'];

  function sanitizeSceneParseConfig(c) {
    c = c && typeof c === 'object' ? c : {};
    const sp = num(c.startPage, 0);
    const ep = num(c.endPage, 0);
    const granularity = VALID_GRANULARITIES.includes(c.granularity) ? c.granularity : 'standard';
    const roles = Object.assign({}, DEFAULT_PATTERN_ROLES);
    if (c.patternRoles && typeof c.patternRoles === 'object') {
      Object.keys(c.patternRoles).forEach(k => {
        const r = c.patternRoles[k];
        if (VALID_PATTERN_ROLES.includes(r)) roles[k] = r;
      });
    } else if (Array.isArray(c.enabledPatterns)) {
      const enSet = new Set(c.enabledPatterns.map(x => str(x)).filter(Boolean));
      Object.keys(roles).forEach(k => {
        roles[k] = enSet.has(k) ? 'scene' : (DEFAULT_PATTERN_ROLES[k] === 'scene' ? 'ignore' : DEFAULT_PATTERN_ROLES[k]);
      });
      enSet.forEach(k => { roles[k] = 'scene'; });
    }
    const enabledPatterns = Object.keys(roles).filter(k => roles[k] === 'scene');
    return {
      sourcePath: str(c.sourcePath),
      granularity,
      useOutline: c.useOutline !== false,
      autoGuard: c.autoGuard !== false,
      patternRoles: roles,
      enabledPatterns,
      customPrefixes: str(c.customPrefixes),
      startPage: sp >= 1 ? Math.round(sp) : null,
      endPage: ep >= 1 ? Math.round(ep) : null,
      cleanLineBreaks: c.cleanLineBreaks !== false,
      inheritMarkersOnNewScene: c.inheritMarkersOnNewScene !== false
    };
  }

  function sanitizeGlobalDecor(g) {
    g = g && typeof g === 'object' ? g : {};
    return {
      bg: g.bg ? sanitizeBoardItem(g.bg, 'bg') : null,
      fg: g.fg ? sanitizeBoardItem(g.fg, 'fg') : null,
      screens: (Array.isArray(g.screens) ? g.screens : []).map(x => sanitizeBoardItem(x, 'screen')).filter(Boolean),
      markers: (Array.isArray(g.markers) ? g.markers : []).map(x => sanitizeBoardItem(x, 'marker')).filter(Boolean),
      bgm: g.bgm ? sanitizeSceneAudio(g.bgm) : null
    };
  }

  function sanitizeBoard(b) {
    b = b && typeof b === 'object' ? b : {};
    const customSize = !!b.customSize;
    let width = Math.max(96, Math.min(4000, Math.round(num(b.width, 960))));
    let height = Math.max(96, Math.min(4000, Math.round(num(b.height, 720))));
    // 過去のバージョンで自動保存された未変更の旧デフォルト値（1200×720）を標準サイズへ補正
    if (!customSize && width === 1200 && height === 720) {
      width = 960;
      height = 720;
    }
    return {
      width,
      height,
      customSize,
      grid: Math.max(12, Math.min(96, Math.round(num(b.grid, 24)))),
      showGrid: b.showGrid !== false,
      coordVersion: num(b.coordVersion, 0),
      pieces: (Array.isArray(b.pieces) ? b.pieces : []).map(x => sanitizeBoardItem(x, 'piece')).filter(Boolean)
    };
  }

  function sanitizeCutin(c) {
    if (!c || typeof c !== 'object') return null;
    const vt = c.visualType === 'video' ? 'video' : 'image';
    let visualDataUrl = normalizeImgRef(c.visualDataUrl);
    let visualPath = str(c.visualPath).trim();
    if (isUnsafeImg(visualPath)) visualPath = '';
    if (/^blob:/i.test(visualPath)) {
      const vpRef = normalizeImgRef(visualPath);
      if (/^@img:/i.test(vpRef)) { if (!visualDataUrl) visualDataUrl = vpRef; visualPath = ''; }
      else visualPath = vpRef;
    }
    return {
      id: str(c.id) || newId(),
      name: str(c.name, '新規カットイン').trim() || '新規カットイン',
      visualType: vt,
      visualPath,
      visualDataUrl,
      visualName: str(c.visualName),
      visualUid: str(c.visualUid),
      sePath: str(c.sePath).trim(),
      seName: str(c.seName),
      seUid: str(c.seUid),
      seVolume: Math.min(100, Math.max(0, Math.round(num(c.seVolume, 80)))),
      position: ['center', 'top', 'bottom', 'fullscreen'].includes(c.position) ? c.position : 'center',
      durationMs: Math.min(30000, Math.max(300, Math.round(num(c.durationMs, 2500)))),
      targetSceneId: str(c.targetSceneId),
      tags: cleanTagList(c.tags)
    };
  }

  function sanitizeCutinPackage(pkg) {
    const c = sanitizeCutin(pkg);
    if (!c) return null;
    return Object.assign(c, { savedAt: num(pkg.savedAt, Date.now()) });
  }

  function sanitizeProject(p) {
    p = p && typeof p === 'object' ? p : {};
    const own = {}; Object.keys(p).forEach(k => { if (k.charAt(0) !== '_') own[k] = p[k]; });   // _rooms 等の親参照は引き継がない（循環参照防止）
    return Object.assign({}, own, {
      version: 1,
      settings: sanitizeSettings(p.settings),
      stocks: (Array.isArray(p.stocks) ? p.stocks : []).map(sanitizeStock).filter(Boolean),
      npcs: (Array.isArray(p.npcs) ? p.npcs : []).map(sanitizeNpc).filter(Boolean),
      bookmarks: sanitizeBookmarks(p.bookmarks),
      refs: (Array.isArray(p.refs) ? p.refs : []).map(sanitizeRef).filter(Boolean),
      folders: [...new Set((Array.isArray(p.folders) ? p.folders : []).map(f => str(f).trim()).filter(Boolean))],   // 空フォルダも保持する仮想フォルダ名（実ファイルは動かさない）
      assetOrder: [...new Set((Array.isArray(p.assetOrder) ? p.assetOrder : []).map(x => str(x).trim()).filter(Boolean))],
      pdf: { path: str(p.pdf && p.pdf.path), page: Math.max(1, num(p.pdf && p.pdf.page, 1)), zoom: Math.min(4, Math.max(0.4, num(p.pdf && p.pdf.zoom, 1.2))) },
      pdfPos: Object.keys(p.pdfPos && typeof p.pdfPos === 'object' ? p.pdfPos : {}).slice(0, 200).reduce((a, k) => { const v = p.pdfPos[k]; if (k && v) a[k] = { page: Math.max(1, num(v.page, 1)), zoom: Math.min(4, Math.max(0.4, num(v.zoom, 1.2))) }; return a; }, {}),   // PDFごとの前回のページ位置・倍率（部屋データごと）
      scenes: (Array.isArray(p.scenes) ? p.scenes : []).map(sanitizeScene).filter(Boolean),
      sceneParseConfig: sanitizeSceneParseConfig(p.sceneParseConfig),
      globalDecor: sanitizeGlobalDecor(p.globalDecor),
      board: sanitizeBoard(p.board),
      cutins: (Array.isArray(p.cutins) ? p.cutins : []).map(sanitizeCutin).filter(Boolean)
    });
  }

  function sanitizeRoom(r) {
    if (!r || typeof r !== 'object') return null;
    return {
      id: str(r.id) || newId(),
      name: str(r.name, 'メイン部屋').trim() || 'メイン部屋',
      createdAt: num(r.createdAt, Date.now()),
      updatedAt: num(r.updatedAt, Date.now()),
      project: sanitizeProject(r.project || r)
    };
  }

  function sanitizeRoomContainer(c) {
    c = c && typeof c === 'object' ? c : {};
    let rooms = (Array.isArray(c.rooms) ? c.rooms : []).map(sanitizeRoom).filter(Boolean);
    if (!rooms.length) {
      const proj = sanitizeProject(c.project || c);
      const roomId = newId();
      rooms = [{
        id: roomId,
        name: str(c.name, 'メイン部屋').trim() || 'メイン部屋',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        project: proj
      }];
    }
    let activeRoomId = str(c.activeRoomId);
    if (!rooms.some(r => r.id === activeRoomId)) {
      activeRoomId = rooms[0].id;
    }
    return {
      version: 2,
      activeRoomId,
      rooms
    };
  }

  // ---------- ココフォリア形式 ----------
  /** NPC → ココフォリアのキャラクター data（クリップボードで貼り付けできる形） */
  function toCcfoliaCharacter(npc) {
    return {
      name: str(npc.name), memo: str(npc.memo), initiative: num(npc.initiative, 0), externalUrl: str(npc.externalUrl),
      status: (npc.status || []).map(s => ({ label: s.label, value: num(s.value), max: num(s.max, num(s.value)) })),
      params: (npc.params || []).map(p => ({ label: p.label, value: str(p.value) })),
      commands: str(npc.commands).replace(/\r\n?/g, '\n'),
      iconUrl: null,          // 画像はココフォリア側にアップロード済みの URL が必要。ローカル画像は ZIP 出力（Phase 2 以降）で扱う
      color: '#888888', invisible: false, secret: !!(npc.sysOpts && npc.sysOpts.statusPublic === false)
    };
  }
  /** ココフォリアのキャラクター駒 JSON（{kind:'character',data} または data 単体）→ NPC 下書き（逆変換）。失敗時は null */
  function fromCcfoliaCharacter(obj) {
    const d = obj && obj.kind === 'character' && obj.data ? obj.data : obj; if (!d || typeof d !== 'object' || !('name' in d || 'commands' in d || 'params' in d)) return null;
    const isLocalPath = v => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(str(v).trim());
    const isPortraitVal = v => {
      const s = str(v).trim();
      if (!s || isUnsafeImg(s)) return false;
      return /^(?:@img:[a-z0-9]+|cloud-asset:|data:image\/|blob:|file:\/\/)/i.test(s) || isLocalPath(s);
    };
    const buildPortrait = (rawUrl, label, extra) => {
      const s = str(rawUrl).trim();
      if (!isPortraitVal(s)) return null;
      const ex = extra && typeof extra === 'object' ? extra : {};
      const lp = isLocalPath(s) ? s : str(ex.path || ex.filePath).trim();
      const du = isLocalPath(s) ? '' : s;
      return {
        id: newId(),
        label: str(label || ex.label || ex.name),
        name: str(ex.name || label || ex.label),
        path: lp,
        filePath: lp,
        dataUrl: du,
        assetId: str(ex.assetId || ex.assetUid)
      };
    };
    const faces = Array.isArray(d.faces) ? d.faces : [];
    const portraits = [];
    const seen = new Set();
    const pushPortrait = item => {
      if (!item) return;
      const k = item.dataUrl || item.path || item.filePath;
      if (k && seen.has(k)) return;
      if (k) seen.add(k);
      portraits.push(item);
    };
    const mainRaw = str(d.iconUrl).trim();
    if (isPortraitVal(mainRaw)) {
      const sameFace = faces.find(f => f && str(f.iconUrl).trim() === mainRaw);
      pushPortrait(buildPortrait(mainRaw, (sameFace && sameFace.label) || d.iconName || '', sameFace || { name: d.iconName, path: d.iconPath, assetId: d.iconAssetId }));
    }
    faces.forEach(f => {
      if (!f || typeof f !== 'object') return;
      pushPortrait(buildPortrait(f.iconUrl, f.label, f));
    });
    const head = portraits[0] || null;
    const iconDataUrl = head && head.dataUrl ? head.dataUrl : (isPortraitVal(mainRaw) && !isLocalPath(mainRaw) ? mainRaw : null);
    const n = sanitizeNpc({ name: str(d.name, '名称未設定NPC'), memo: str(d.memo), initiative: d.initiative, externalUrl: str(d.externalUrl), status: d.status, params: d.params, commands: str(d.commands), portraits, iconDataUrl, iconName: str(d.iconName || (head && head.name) || ''), sysOpts: { statusPublic: !d.secret }, source: '', skills: [] });
    const cmd = n.commands.split('\n'), seenCmd = new Set();
    cmd.forEach(l => { const m = /^(?:s?x\d+\s+)?s?(?:CCB?|1d100)\s*<=?\s*(\d{1,3})\s*[【〈《「\[]([^】〉》」\]\n]{1,24})[】〉》」\]]/i.exec(l.trim()); if (m && !seenCmd.has(m[2])) { seenCmd.add(m[2]); n.skills.push({ name: m[2], value: +m[1], known: true, include: true, damage: '', lv: 0, mod: 0, multi: false }); } });
    n.edition = /CCB/i.test(n.commands) ? '6' : /CC</i.test(n.commands) ? '7' : n.edition; n.rollPrefix = /CCB/i.test(n.commands) ? 'CCB' : 'CC';
    return n;
  }
  const PARAM_ALIAS = {
    STR: 'STR', '筋力': 'STR', CON: 'CON', '体力': 'CON', POW: 'POW', '精神力': 'POW',
    DEX: 'DEX', '敏捷': 'DEX', '敏捷性': 'DEX', '敏捷力': 'DEX', APP: 'APP', '外見': 'APP', '容姿': 'APP',
    SIZ: 'SIZ', '体格': 'SIZ', INT: 'INT', '知性': 'INT', EDU: 'EDU', '教育': 'EDU',
    LUK: 'LUK', LUCK: 'LUK', '幸運': 'LUK',
    HP: 'HP', '耐久力': 'HP', 'ヒットポイント': 'HP',
    MP: 'MP', 'マジックポイント': 'MP', 'マジック・ポイント': 'MP',
    SAN: 'SAN', 'SAN値': 'SAN', '正気度': 'SAN', '正気度ポイント': 'SAN',
    DB: 'DB', 'ダメージボーナス': 'DB', 'ダメボ': 'DB'
  };
  const normStatLabel = l => {
    const s = str(l).normalize('NFKC').trim();
    return PARAM_ALIAS[s.toUpperCase()] || PARAM_ALIAS[s] || s.toUpperCase();
  };
  function parseNumericExpr(val) {
    const s = str(val).normalize('NFKC').trim();
    if (!s) return NaN;
    if (/^[+-]?\d+$/.test(s)) return Number(s);
    const arith = /^\(?\s*(\d+(?:\s*[+\-]\s*\d+)+)\s*\)?$/.exec(s);
    if (arith) {
      const tokens = arith[1].match(/[+\-]?\s*\d+/g);
      if (tokens) return tokens.reduce((acc, tok) => acc + Number(tok.replace(/\s+/g, '')), 0);
    }
    const mul = /^(\d+)\s*[×*xX]/.exec(s);
    if (mul) return Number(mul[1]);
    return NaN;
  }
  /** 能力値だけあって HP/MP/SAN/DB/アイデア/幸運/知識 が【空欄のとき】に限り、版別の計算式で補完（原文の数値は絶対に上書きしない）。補完した項目名を返す */
  function autoFillStats(d, edition) {
    if (d.system && !/^coc[67]$/.test(d.system)) return [];
    const num2 = k => {
      const p = (d.params || []).find(x => normStatLabel(x.label) === k);
      return p ? parseNumericExpr(p.value) : NaN;
    };
    const CON = num2('CON'), SIZ = num2('SIZ'), POW = num2('POW'), STR = num2('STR'), INT = num2('INT'), EDU = num2('EDU'), LUK = num2('LUK'), filled = [];
    let ed = edition || d.edition || '6';
    if (ed !== '6' && ed !== '7') {
      const abils = [STR, CON, POW, DEXOr(d), num2('APP'), SIZ, INT, EDU].filter(Number.isFinite);
      ed = abils.some(v => v > 21) ? '7' : '6';
    }
    function DEXOr(x) { const p = (x.params || []).find(y => normStatLabel(y.label) === 'DEX'); return p ? parseNumericExpr(p.value) : NaN; }
    const hasSt = k => (d.status || []).some(s => normStatLabel(s.label) === k && Number.isFinite(+s.value) && String(s.value) !== '' && (+s.value > 0 || +s.max > 0));
    d.status = d.status || []; d.params = d.params || []; d.skills = d.skills || [];
    const put = (k, v) => { const i = d.status.findIndex(s => normStatLabel(s.label) === k); const o = { label: k, value: v, max: v, _auto: true }; if (i >= 0) d.status[i] = o; else d.status.push(o); filled.push(k); };
    if (!hasSt('HP') && Number.isFinite(CON) && Number.isFinite(SIZ)) put('HP', ed === '7' ? Math.floor((CON + SIZ) / 10) : Math.ceil((CON + SIZ) / 2));
    if (!hasSt('MP') && Number.isFinite(POW)) put('MP', ed === '7' ? Math.floor(POW / 5) : POW);
    if (!hasSt('SAN') && Number.isFinite(POW)) put('SAN', ed === '7' ? POW : POW * 5);
    if (!d.params.some(p => normStatLabel(p.label) === 'DB' && str(p.value).trim() !== '') && Number.isFinite(STR) && Number.isFinite(SIZ)) {
      const t = STR + SIZ; let db;
      if (ed === '7') db = t <= 64 ? '-2' : t <= 84 ? '-1' : t <= 124 ? '0' : t <= 164 ? '+1D4' : t <= 204 ? '+1D6' : '+' + (1 + Math.ceil((t - 204) / 80)) + 'D6';
      else db = t <= 12 ? '-1D6' : t <= 16 ? '-1D4' : t <= 24 ? '0' : t <= 32 ? '+1D4' : t <= 40 ? '+1D6' : '+' + (1 + Math.ceil((t - 40) / 16)) + 'D6';
      d.params = d.params.filter(p => normStatLabel(p.label) !== 'DB'); d.params.push({ label: 'DB', value: db, _auto: true }); filled.push('DB');
    }
    const hasRoll = nm => d.skills.some(s => str(s.name).normalize('NFKC').trim() === nm && Number.isFinite(+s.value) && +s.value > 0)
      || d.params.some(p => str(p.label).normalize('NFKC').trim() === nm && str(p.value).trim() !== '');
    const putSk = (nm, v) => {
      if (!Number.isFinite(v) || v <= 0) return;
      const i = d.skills.findIndex(s => str(s.name).normalize('NFKC').trim() === nm);
      const o = { name: nm, value: v, known: true, include: true, damage: '', lv: 0, mod: 0, multi: false, _auto: true };
      if (i >= 0) d.skills[i] = Object.assign({}, d.skills[i], o);
      else d.skills.push(o);
      filled.push(nm);
    };
    if (!hasRoll('アイデア') && Number.isFinite(INT)) putSk('アイデア', ed === '7' ? INT : INT * 5);
    if (!hasRoll('幸運')) {
      if (Number.isFinite(LUK)) putSk('幸運', LUK);
      else if (ed !== '7' && Number.isFinite(POW)) putSk('幸運', POW * 5);
    }
    if (!hasRoll('知識') && Number.isFinite(EDU)) putSk('知識', ed === '7' ? EDU : EDU * 5);
    return filled;
  }
  const SYM_ALL_M = '\\uE000-\\uF8FF\\u25A0-\\u25FF\\u2600-\\u27BF❏❐❑■□◆◇●○◯〇▼▽▶▷★☆❖✦✧※†‡・';
  const RE_STRIP_M = new RegExp('^[' + SYM_ALL_M + '\\s:/：／\\-]+|[' + SYM_ALL_M + '\\s:/：／]+$', 'g');
  const trimNpcNm = n => str(n).replace(RE_STRIP_M, '').replace(/[\uE000-\uF8FF]/g, '').trim();
  const READING_RE_M = /([^)）\s])\s*[(（][ぁ-んァ-ヶー・\s]+[)）]/g;
  const normNpcName = s => str(s).normalize('NFKC').replace(/[\s\u3000]+/g, '').toLowerCase();
  const cmpNpcName = n => trimNpcNm(n).normalize('NFKC').replace(READING_RE_M, '$1').replace(/[()（）\[\]【】「」『』\s・＝=]/g, '').toLowerCase();
  const formOfNpc = n => { const m = /[（(]([^）)]*)[）)]\s*$/.exec(trimNpcNm(n).normalize('NFKC').replace(READING_RE_M, '$1')); return m ? normNpcName(m[1]) : ''; };
  const baseOfNpc = n => { let t = trimNpcNm(n).normalize('NFKC').replace(READING_RE_M, '$1'); for (let k = 0; k < 3; k++) t = t.replace(/\s*[（(][^）)]*[）)]\s*$/, ''); return t.trim(); };
  const isSimpleNpc = c => !(c.skills || []).some(s => !s._auto) || ((c.status || []).filter(s => !s._auto).length + (c.params || []).filter(p => !p._auto).length <= 4);
  function explicitStatMap(npc) {
    const map = new Map();
    (npc.params || []).forEach(p => {
      if (p._auto) return;
      const k = normStatLabel(p.label);
      if (k === 'DB') return;
      const v = parseNumericExpr(p.value);
      if (Number.isFinite(v)) map.set('p:' + k, String(v));
    });
    (npc.status || []).forEach(s => {
      if (s._auto) return;
      const k = normStatLabel(s.label);
      if (Number.isFinite(+s.value) && (+s.value > 0 || +s.max > 0)) map.set('s:' + k, s.value + '/' + (s.max != null ? s.max : s.value));
    });
    return map;
  }
  function npcRichness(npc) {
    const np = (npc.params || []).filter(p => !p._auto && str(p.value).trim() !== '').length;
    const ns = (npc.status || []).filter(s => !s._auto && (+s.value > 0 || +s.max > 0)).length;
    const nk = (npc.skills || []).filter(s => !s._auto).length;
    const ni = (npc.images || npc.portraits || []).length + (npc.iconDataUrl ? 1 : 0);
    return np * 3 + ns * 4 + nk * 2 + ni;
  }
  function canMergeNpcPair(a, b) {
    const sa = explicitStatMap(a), sb = explicitStatMap(b);
    if (sa.size < 2 || sb.size < 2) return true;
    for (const [k, v] of sa) {
      if (sb.has(k) && sb.get(k) !== v) return false;
    }
    return true;
  }
  function mergeTwoNpcs(a, b, opts) {
    const pri = npcRichness(b) > npcRichness(a) ? b : a;
    const sec = pri === a ? b : a;
    const out = sanitizeNpc(pri);
    const s2 = sanitizeNpc(sec);
    // status: 数値がある側（非_auto優先）を欠落なく維持
    s2.status.forEach(st => {
      const k = normStatLabel(st.label);
      const idx = out.status.findIndex(x => normStatLabel(x.label) === k);
      if (idx < 0) out.status.push(Object.assign({}, st));
      else if ((out.status[idx]._auto || (+out.status[idx].value === 0 && +out.status[idx].max === 0)) && !st._auto && (+st.value > 0 || +st.max > 0)) {
        out.status[idx] = Object.assign({}, st);
      }
    });
    // params
    s2.params.forEach(pa => {
      const k = normStatLabel(pa.label);
      const idx = out.params.findIndex(x => normStatLabel(x.label) === k);
      if (idx < 0) out.params.push(Object.assign({}, pa));
      else if ((out.params[idx]._auto || !str(out.params[idx].value).trim()) && !pa._auto && str(pa.value).trim()) {
        out.params[idx] = Object.assign({}, pa);
      }
    });
    // skills
    s2.skills.forEach(sk => {
      const kn = str(sk.name).normalize('NFKC').trim();
      const idx = out.skills.findIndex(x => str(x.name).normalize('NFKC').trim() === kn);
      if (idx < 0) out.skills.push(Object.assign({}, sk));
      else {
        if ((out.skills[idx]._auto || !out.skills[idx].value) && !sk._auto && sk.value) out.skills[idx] = Object.assign({}, sk);
        else if (!out.skills[idx].damage && sk.damage) out.skills[idx].damage = sk.damage;
      }
    });
    // images / portraits
    const seenImg = new Set((out.images || []).map(x => x.dataUrl || x.path || x.filePath || x.assetId).filter(Boolean));
    (s2.images || []).forEach(img => {
      const key = img.dataUrl || img.path || img.filePath || img.assetId;
      if (key && seenImg.has(key)) return;
      if (key) seenImg.add(key);
      if (out.images.length < 24) out.images.push(Object.assign({}, img));
    });
    // srcs
    const seenSrc = new Set((out.srcs || []).map(x => (x.path || x.name || '') + ':' + x.page));
    (s2.srcs || []).forEach(sr => {
      const key = (sr.path || sr.name || '') + ':' + sr.page;
      if (!seenSrc.has(key)) { seenSrc.add(key); out.srcs.push(Object.assign({}, sr)); }
    });
    // memo & source
    const cleanMemoLines = m => str(m).split('\n').map(l => l.trim()).filter(l => l && l !== '（ステータスなし・立ち絵のみ）');
    const memoSet = new Set(cleanMemoLines(out.memo));
    const mergedMemo = cleanMemoLines(out.memo);
    cleanMemoLines(s2.memo).forEach(l => { if (!memoSet.has(l)) { memoSet.add(l); mergedMemo.push(l); } });
    out.memo = mergedMemo.join('\n');
    if (s2.source && !out.source.includes(s2.source.trim())) {
      out.source = out.source ? (out.source + '\n\n' + s2.source) : s2.source;
    }
    if (!out.initiative && s2.initiative) out.initiative = s2.initiative;
    if (!out.system && s2.system) out.system = s2.system;
    if (!out.externalUrl && s2.externalUrl) out.externalUrl = s2.externalUrl;
    const fin = sanitizeNpc(out);
    if (opts && typeof opts.buildCommands === 'function') fin.commands = opts.buildCommands(fin);
    else if (!fin.commands && s2.commands) fin.commands = s2.commands;
    return fin;
  }
  function mergeSameNameNpcs(npcs, opts) {
    const list = (Array.isArray(npcs) ? npcs : []).map(sanitizeNpc).filter(Boolean);
    const out = [];
    let mergedCount = 0;
    // 1) cmpName 完全一致（読み仮名括弧・形態括弧・記号を吸収）を統合
    list.forEach(item => {
      const key = cmpNpcName(item.name);
      if (!key || key === '名称未設定npc' || key === '新しいnpc') { out.push(item); return; }
      const hitIdx = out.findIndex(ex => cmpNpcName(ex.name) === key && (isSimpleNpc(ex) || isSimpleNpc(item) || canMergeNpcPair(ex, item)));
      if (hitIdx < 0) { out.push(item); return; }
      out[hitIdx] = mergeTwoNpcs(out[hitIdx], item, opts);
      mergedCount++;
    });
    // 2) 簡易再掲（isSimple）や部分名一致を、形態衝突しないフルネーム側へ自動吸収
    const absorbed = new Set();
    out.forEach((sm, si) => {
      if (absorbed.has(sm)) return;
      const ck = cmpNpcName(sm.name);
      if (!ck || ck === '名称未設定npc' || ck === '新しいnpc') return;
      const sb = baseOfNpc(sm.name), sk = normNpcName(sb), sf = formOfNpc(sm.name);
      if (sk.length < 2) return;
      const cands = [];
      out.forEach((o, oi) => {
        if (o === sm || absorbed.has(o)) return;
        const ob = baseOfNpc(o.name), ok = normNpcName(ob), of = formOfNpc(o.name);
        if (ok.length <= sk.length) return;
        if (sf && of && sf !== of) return;
        const toks = ob.normalize('NFKC').trim().split(/\s+/).map(normNpcName).filter(t => t.length >= 2);
        if (!(toks.includes(sk) || ok.startsWith(sk) || ok.endsWith(sk))) return;
        const sr = npcRichness(sm), or = npcRichness(o);
        const canAbsorb = isSimpleNpc(sm) || (READING_RE_M.test(o.name) && !sf && !of && canMergeNpcPair(o, sm) && or > sr);
        if (!canAbsorb) return;
        if (!isSimpleNpc(o) || or > sr || (or === sr && oi < si)) cands.push({ oi, or, simple: isSimpleNpc(o) });
      });
      if (!cands.length) return;
      cands.sort((a, b) => (a.simple ? 1 : 0) - (b.simple ? 1 : 0) || a.oi - b.oi || b.or - a.or);
      const ti = cands[0].oi;
      out[ti] = mergeTwoNpcs(out[ti], sm, opts);
      absorbed.add(sm);
      mergedCount++;
    });
    return { npcs: out.filter(x => !absorbed.has(x)), mergedCount };
  }
  const clipboardPayload = data => JSON.stringify({ kind: 'character', data });

  /** シナリオテキストのストック → ダミー駒（盤面に出さない・チャットパレットだけを持つキャラクター）の配列
   *  1体あたり maxLines 行までとし、超えたら駒を増やす。 */
  function buildDummyPieces(stocks, opts, mode) {
    const o = sanitizeSettings(opts);
    if (mode && mode.each) {   // 選択したテキストを統合せず、1テキスト＝1体（行数超過時のみ分割）の独立したダミー駒にする
      const out = [];
      (stocks || []).forEach((s, si) => {
        const ls = T.buildPaletteLines(s, { includeTitle: o.includeTitle, maxChars: o.maxChars }); if (!ls.length) return;
        const base = str(s.title).trim() || o.pieceName + ' ' + (si + 1), n = Math.ceil(ls.length / o.maxLines);
        for (let i = 0; i < n; i++) out.push({
          name: n > 1 ? base + ' (' + (i + 1) + '/' + n + ')' : base, memo: 'シナリオテキストをチャットパレットから送信するためのダミー駒です。（自動生成）',
          initiative: 0, externalUrl: '', status: [], params: [], commands: ls.slice(i * o.maxLines, (i + 1) * o.maxLines).join('\n'),
          iconUrl: null, color: '#888888', invisible: true, secret: false
        });
      });
      return out;
    }
    const lines = [];
    (stocks || []).forEach(s => T.buildPaletteLines(s, { includeTitle: o.includeTitle, maxChars: o.maxChars }).forEach(l => lines.push(l)));
    if (!lines.length) return [];
    const n = Math.ceil(lines.length / o.maxLines), pieces = [];
    for (let i = 0; i < n; i++) {
      pieces.push({
        name: n > 1 ? o.pieceName + ' (' + (i + 1) + '/' + n + ')' : o.pieceName,
        memo: 'シナリオテキストをチャットパレットから送信するためのダミー駒です。（自動生成）',
        initiative: 0, externalUrl: '', status: [], params: [],
        commands: lines.slice(i * o.maxLines, (i + 1) * o.maxLines).join('\n'),
        iconUrl: null, color: '#888888', invisible: true, secret: false
      });
    }
    return pieces;
  }

  /** 調査箇所テキスト → 手がかり用オブジェクト駒（盤面に出る駒。本文は「📝 メモ欄」に入る） */
  function buildCluePieces(stocks) {
    return (stocks || []).filter(s => str(s.text).trim()).map((s, i) => ({
      name: str(s.title).trim() || T.stockTitle({ text: s.text }, 14) || '手がかり' + (i + 1), memo: str(s.text).replace(/\r\n?/g, '\n'),
      initiative: 0, externalUrl: '', status: [], params: [], commands: '', iconUrl: null, color: '#d4a017', invisible: false, secret: false
    }));
  }

  const api = { newId, DEFAULT_SETTINGS, SYSTEM_IDS, STANDARD_SCENARIO_CATS, NPC_PORTRAIT_RE, isNpcPortraitNameOrPath, isUnclassifiedCat, normalizeStandardCat, isOldFolderName, stripFolderDecor, inferSystemFromFolderName, isCategoryFolderName, isAssetSubdirName, isGenericRoleTitle, extractTitleAndSystem, cleanseTitle, normalizeForMatch, classifyContainerEntries, inferSmartCategory, inferSmartCategoryFromFolders, cleanTagValue, isJunkTag, cleanTagList, parseSearchQuery, matchSearchQuery, sanitizeSettings, sanitizeStock, sanitizeNpc, sanitizeRef, sanitizeSrcs, sanitizeBookmarks, addRefs, sanitizeBoardItem, sanitizeSceneAudio, sanitizeScene, sanitizeSceneParseConfig, sanitizeGlobalDecor, sanitizeBoard, sanitizeCutin, sanitizeCutinPackage, sanitizeProject, sanitizeRoom, sanitizeRoomContainer, toCcfoliaCharacter, fromCcfoliaCharacter, autoFillStats, mergeSameNameNpcs, mergeTwoNpcs, normNpcName, clipboardPayload, buildDummyPieces, buildCluePieces };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CCFModel = api;
})();
