/* ccf_dnd.js — PC のフォルダ／ZIP／PDF／BGM のドラッグ＆ドロップ登録
 *
 *   ・フォルダ ／ ZIP をドロップ  → その名前のシナリオを自動登録（既にあれば再利用）。
 *                                   フォルダ内の PDF・BGM（音声）・ZIP・画像を見つけ、サブフォルダ名をカテゴリにして登録する。
 *   ・PDF をドロップ              → PDFビューア（pdfjs-dist）へ即時に渡す（切り離し中は別ウィンドウへ）。シナリオにも参照として登録。
 *   ・BGM・画像をドロップ         → 実体はコピーせず、PC上の「絶対パス」だけを保持する。
 *   ・ZIP は解凍しない            → 中身は yauzl で読み、画像は zipview:// で直接表示する（マイライブラリのトレイ）。
 *
 *   ・スマートD&D                 → シナリオ名（フォルダ名／ZIP名／PDF内テキスト）とトレーラー画像（trailer・トレーラー・title・タイトル・サムネ・01 を含む画像）を推測。
 *                                   単一ならそのシナリオの「Discord投稿・編集」画面へ遷移／複数なら一括登録して通知のみ。既存の同名シナリオには確認のうえ素材をマージ。
 *
 *  ドロップを受けるのは「ホーム（シナリオ一覧）」と「ココフォリアタブ」。 */
(function () {
  'use strict';
  const isElec = typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON;
  const CCF = window.CCF, M = window.CCFModel, { say, S } = CCF;
  const EXT = { pdf: /\.(pdf|txt|html?|md|docx?)$/i, zip: /\.zip$/i, audio: /\.(mp3|wav|ogg|m4a|flac|aac)$/i, image: /\.(png|jpe?g|gif|webp|bmp|svg)$/i };
  const DOC_EXT_RE = /\.(pdf|txt|html?|md|docx?)$/i;
  const isDocAssetName = n => DOC_EXT_RE.test(String(n || ''));
  const checkImg = n => (typeof isImageName === 'function') ? isImageName(n) : EXT.image.test(n);
  const checkAudio = n => (typeof isAudioName === 'function') ? isAudioName(n) : EXT.audio.test(n);
  const checkDoc = n => ((typeof isPdfName === 'function' && isPdfName(n)) || (typeof isTextDocName === 'function' && isTextDocName(n)) || EXT.pdf.test(n));
  const typeOf = n => checkDoc(n) ? 'pdf' : EXT.zip.test(n) ? 'zip' : checkAudio(n) ? 'audio' : checkImg(n) ? 'image' : '';
  const LIMIT = 3000, MAX_DEPTH = 8;

  const OLD_VERSION_NAME_RE = /(?:旧版|旧ver|旧バージョン|旧データ|旧ファイル|初期版|過去版|修正前|改訂前|差替前|差し替え前|更新前|エラッタ前|バックアップ|[（(\[【_\-\s](?:旧|old|backup|bak|archive|obsolete)[）)\]】_\-\s.]|^old[_\-\s]|^backup[_\-\s])/i;
  const ASSET_EXT_STRIP_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|m4a|flac|aac|mp4|webm|mov|pdf|txt|md|html?|docx?|zip|json)$/i;
  function stripAssetExt(name) {
    const s = String(name == null ? '' : name).trim();
    if (!s) return '';
    const stripped = s.replace(ASSET_EXT_STRIP_RE, '').trim();
    return stripped || s;
  }
  if (typeof window !== 'undefined' && !window.stripAssetExt) window.stripAssetExt = stripAssetExt;

  function isOldVersionName(rawName) {
    const s = String(rawName == null ? '' : rawName).normalize('NFKC').trim();
    if (!s) return false;
    if (M && typeof M.isOldFolderName === 'function' && M.isOldFolderName(s)) return true;
    return OLD_VERSION_NAME_RE.test(s);
  }

  function parseVersionMeta(rawName, isDir) {
    const s = String(rawName == null ? '' : rawName).normalize('NFKC').trim();
    const extMatch = !isDir ? s.match(/\.([^.]+)$/) : null;
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    let stem = !isDir && extMatch ? s.slice(0, -extMatch[0].length) : s;

    const verNums = [];
    const verRe = /(?:^|[\s_\-(（【\[])(?:ver\.?|v|第)\s*(\d+(?:\.\d+)*)\s*版?(?=$|[\s_\-)）】\].])/ig;
    let vm;
    while ((vm = verRe.exec(stem)) !== null) {
      vm[1].split('.').forEach(n => verNums.push(Number(n) || 0));
    }
    stem = stem.replace(verRe, ' ');

    let dateNum = 0;
    const ymdRe = /(20\d{2})\s*[年/.\-_]\s*(\d{1,2})\s*[月/.\-_]\s*(\d{1,2})\s*日?/g;
    const ymRe = /(20\d{2})\s*[年/.\-_]\s*(\d{1,2})\s*月?/g;
    const yRe = /(20\d{2})\s*年/g;
    const compact8Re = /(?:^|[\s_\-(（【\[])(20\d{2})([01]\d)([0-3]\d)(?=$|[\s_\-)）】\]])/g;
    const compact4YRe = /(?:^|[\s_\-(（【\[])(20\d{2})(?=$|[\s_\-)）】\]])/g;
    const mdUpdRe = /(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*更新/g;
    const md4UpdRe = /(?:^|[\s_\-(（【\[])([01]\d)([0-3]\d)\s*更新/g;
    let m;
    while ((m = ymdRe.exec(stem)) !== null) dateNum = Math.max(dateNum, Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]));
    stem = stem.replace(ymdRe, ' ');
    while ((m = ymRe.exec(stem)) !== null) dateNum = Math.max(dateNum, Number(m[1]) * 10000 + Number(m[2]) * 100);
    stem = stem.replace(ymRe, ' ');
    while ((m = yRe.exec(stem)) !== null) dateNum = Math.max(dateNum, Number(m[1]) * 10000);
    stem = stem.replace(yRe, ' ');
    while ((m = compact8Re.exec(stem)) !== null) dateNum = Math.max(dateNum, Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]));
    stem = stem.replace(compact8Re, ' ');
    while ((m = compact4YRe.exec(stem)) !== null) dateNum = Math.max(dateNum, Number(m[1]) * 10000);
    stem = stem.replace(compact4YRe, ' ');
    while ((m = mdUpdRe.exec(stem)) !== null) dateNum = Math.max(dateNum, Number(m[1]) * 100 + Number(m[2]));
    stem = stem.replace(mdUpdRe, ' ');
    while ((m = md4UpdRe.exec(stem)) !== null) dateNum = Math.max(dateNum, Number(m[1]) * 100 + Number(m[2]));
    stem = stem.replace(md4UpdRe, ' ');

    let revScore = 0;
    if (/最新版/.test(stem)) revScore = Math.max(revScore, 3);
    else if (/改訂版|改訂/.test(stem)) revScore = Math.max(revScore, 2);
    else if (/修正版|修正|更新版|更新/.test(stem)) revScore = Math.max(revScore, 1);
    stem = stem.replace(/(?:最新版|改訂版|改訂|修正版|修正|更新版|更新)/g, ' ');

    const baseKey = stem.replace(/[\s_\-・/／()（）【】\[\]]+/g, '').toLowerCase();
    const hasMarker = verNums.length > 0 || dateNum > 0 || revScore > 0;
    return { ext, baseKey, verNums, dateNum, revScore, hasMarker };
  }

  function compareVersionMeta(a, b) {
    if (!!a.isDir !== !!b.isDir) return a.isDir ? 1 : -1;
    const va = a.meta.verNums, vb = b.meta.verNums;
    const len = Math.max(va.length, vb.length);
    for (let i = 0; i < len; i++) {
      const da = i < va.length ? va[i] : -1;
      const db = i < vb.length ? vb[i] : -1;
      if (da !== db) return da - db;
    }
    if (a.meta.dateNum !== b.meta.dateNum) return a.meta.dateNum - b.meta.dateNum;
    if (a.meta.revScore !== b.meta.revScore) return a.meta.revScore - b.meta.revScore;
    return (Number(a.mtime) || 0) - (Number(b.mtime) || 0);
  }

  function filterLatestVersionEntries(entries) {
    if (!Array.isArray(entries) || !entries.length) return [];
    const parsed = entries
      .filter(e => e && e.name && !isOldVersionName(e.name))
      .map((e, idx) => ({ raw: e, idx, isDir: !!e.isDir, mtime: Number(e.mtime || 0), meta: parseVersionMeta(e.name, !!e.isDir) }));
    const dirBaseKeys = new Set(parsed.filter(x => x.isDir && x.meta.baseKey).map(x => x.meta.baseKey));
    const withoutDupZips = parsed.filter(x => {
      if (!x.isDir && x.meta.ext === 'zip' && x.meta.baseKey && dirBaseKeys.has(x.meta.baseKey)) return false;
      return true;
    });
    const groups = new Map();
    withoutDupZips.forEach(x => {
      const gk = (x.isDir ? 'dir:' : ('file:' + x.meta.ext + ':')) + x.meta.baseKey;
      if (!x.meta.baseKey) { groups.set('__uniq_' + x.idx, [x]); return; }
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(x);
    });
    const kept = [];
    groups.forEach(arr => {
      if (arr.length === 1 || !arr.some(x => x.meta.hasMarker)) {
        arr.forEach(x => kept.push(x));
        return;
      }
      const best = arr.slice().sort((a, b) => compareVersionMeta(b, a))[0];
      kept.push(best);
    });
    kept.sort((a, b) => a.idx - b.idx);
    return kept.map(x => x.raw);
  }

  // ---------- 中間分類フォルダ判定（版・システム・人数・参加条件・複数シナリオ親）＆ 属性継承 ----------
  const CAT_SYS_RE = /^(?:(?:CoC|クトゥルフ(?:神話)?(?:TRPG)?|新クトゥルフ(?:神話)?(?:TRPG)?)\s*(?:第?[67]版|6th|7th|ver\.?\s*[67])?|第?[67]版|旧6版|新7版|CoC\s*[67]版?|エモクロア(?:TRPG)?|インセイン|シノビガミ|マダミス|マーダーミステリー|ストリテラ|ストーリープレイング|ダブルクロス|DX3(?:rd)?|ソード・?ワールド|SW\s*2(?:\.5)?|フタリソウサ|ネクロニカ|ケダモノオペラ|クラヤミクライン|ブラッドパス|パラノイア|アリアンロッド|TRPG)$/i;
  const CAT_PPL_RE = /^(?:[0-9]+(?:[\s~〜\-ー・,、]+[0-9]+)?\s*(?:PL|人|名)(?:用|向け|シナリオ|固定|以上|以下|程度)?|ソロ|タイマン|ペア|デュオ|少人数|複数人|多人数|大人数|人数可変|人数固定|可変人数|KPレス(?:シナリオ)?|GMレス(?:シナリオ)?)(?:シナリオ|用|向け)?$/i;
  const CAT_STYLE_TOKEN_RE = /^(?:新規|継続|限定|推奨|不問|可能|専用|向け|可|不可|OK|NG|置きレス|置き卓|ボイセ|テキセ|半テキ|完テキ|人数可変|人数固定|可変人数|KPレス|KPレスシナリオ|GMレス|GMレスシナリオ|短時間|長時間|短編|長編|キャンペーン|CP|周回|秘匿|秘匿HO|HOあり|HO|うちよそ|R-?18(?:-?G)?|成人向け|全年齢|ホラー|クラシック|クローズド|シティ|茶番|ギャグ|戦闘|戦闘あり|戦闘なし|探索|協力|PvP|ロスト|高ロスト|中ロスト|低ロスト|極高ロスト|確定ロスト|ロストあり|ロストなし|ロスト無|ロスト有|ロスト率高|ロスト率低|ロスト救済|救済|復活|蘇生|KPC|ロストKPC|KPCロスト|PCロスト|KPCあり|KPC専用|SAN回復|SAN値回復|正気度回復|発狂|後遺症|鬱|胸くそ|メリバ|バッドエンド|ハッピーエンド|エモ|シリアス|コメディ|ほのぼの|日常|謎解き|推理|脱出|RP重視|季節|春|夏|秋|冬|ハロウィン|クリスマス|バレンタイン|正月|学園|学校|現代|和風|西洋|中華|SF|ファンタジー|シナリオ|一覧|まとめ|フォルダ|分類|未分類|その他|一般|配布|購入済み?|プレイ済み?|通過済み?|未通過)$/i;
  const CAT_STYLE_COMPOUND_RE = /^(?:新規|継続|限定|推奨|不問|可能|専用|向け|置きレス|置き卓|ボイセ|テキセ|半テキ|完テキ|ソロ|タイマン|ペア|デュオ|人数可変|人数固定|可変人数|KPレス|GMレス|秘匿|HO|短時間|長時間|短編|長編|キャンペーン|CP|周回|クラシック|クローズド|シティ|うちよそ|R-?18(?:-?G)?|ホラー|茶番|ギャグ|戦闘あり|戦闘なし|戦闘|探索|ロスト|高ロスト|中ロスト|低ロスト|極高ロスト|確定ロスト|ロストあり|ロストなし|ロスト無|ロスト有|ロスト率高|ロスト率低|ロスト救済|救済|復活|蘇生|KPC|PC|SAN回復|SAN値回復|正気度回復|発狂|後遺症|鬱|胸くそ|メリバ|バッドエンド|ハッピーエンド|エモ|シリアス|コメディ|ほのぼの|日常|謎解き|推理|脱出|RP重視|季節|春|夏|秋|冬|ハロウィン|クリスマス|バレンタイン|正月|学園|学校|現代|和風|西洋|中華|SF|ファンタジー|シナリオ|一覧|まとめ|フォルダ|分類|未分類)+$/i;
  const ASSET_SUBDIR_EX_RE = /^(?:本文|本編|本篇|文章|文書|テキスト|シナリオ|小説|ログ|リプレイ|台本|スチル|イラスト|おまけ|オマケ|特典|付録|追加|差分|表情|立ち絵|立絵|キャラ|人物|npc|kpc|前景|背景|マップ|地図|見取り図|部屋素材|素材|画像|アイコン|パネル|マーカー|フレーム|カットイン|トレーラー|表紙|サムネ|タイトル|ロゴ|チケット|カード|シール|案内|招待状|新聞|手紙|メモ|資料|案|pl|kp|gm|pc|ho|配布|配布物|配布用|公開|秘匿|事前|導入|真相|解説|情報|データ|ファイル|フォルダ|クレジット|利用規約|規約|ライセンス|注意|はじめに|説明書|初期版|旧版|新版|改訂版|修正版|完全版|軽量版|分割版|統合版|web版|booth版|印刷用|オンライン|オフライン|部屋|ルーム|ココフォリア|bgm|se|音声|音楽|音源|効果音|ボイス|動画|ムービー|script|scenario|story|text|txt|doc|docs|pdf|still|illust|omake|extra|bonus|image|images|img|imgs|pic|graphic|bg|fg|map|maps|chara|tachie|icon|panel|marker|frame|asset|assets|material|trailer|cover|thumb|title|logo|ticket|card|cutin|credit|credits|readme|license|rule|handout|handouts|info|data|file|files|folder|old|ver|room|rooms|ccfolia|ccf|music|sound|sounds|audio|voice|movie|video|mp3|wav|mp4|webm)$/i;
  const ASSET_SUBDIR_PARTIAL_RE = /(?:本文|本編|本篇|文章|文書|テキスト|シナリオ|小説|ログ|リプレイ|台本|スチル|イラスト|おまけ|オマケ|特典|付録|追加|差分|表情|立ち絵|立絵|キャラ|人物|バストアップ|前景|foreground|背景|background|風景|マップ|地図|見取り図|間取り|フロア|部屋素材|素材|画像|アイコン|パネル|マーカー|フレーム|カットイン|トレーラー|表紙|サムネ|タイトル|概要|お品書き|ロゴ|チケット|カード|シール|案内|招待状|新聞|手紙|メモ|資料|配布|配布物|配布用|公開|秘匿|事前|導入|真相|解説|情報|データ|ファイル|フォルダ|クレジット|利用規約|規約|ライセンス|注意|はじめに|説明書|初期版|旧版|新版|改訂版|修正版|完全版|軽量版|分割版|統合版|web版|booth版|印刷用|オンライン|オフライン|部屋|ルーム|ココフォリア|ハンドアウト|音声|音楽|音源|効果音|ボイス|動画|ムービー|場面|シーン|徒歩|車用|山中|toho|syaryou|yamanaka|用$|案$|(?:^|[\s_\-.(\[【])案(?:$|[\s_\-.)\]】])|(?:^|[^a-z])(?:script|scenario|story|text|txt|docs?|pdf|still|illust|omake|extra|bonus|images?|imgs?|pic|graphic|bg(?!m)|fg|maps?|npc|kpc|chara|tachie|icon|panel|marker|frame|assets?|material|trailer|cover|thumb|title|logo|ticket|card|cutin|credits?|readme|license|rule|handouts?|info|data|files?|folder|old|ver\d*|rooms?|ccfolia|ccf|bgm|se|music|sounds?|audio|voice|movie|video|mp3|wav|mp4|webm|pl|kp|gm|pc|ho\d*)(?:$|[^a-z]))/i;

  function stripFolderDecor(raw) {
    let s = String(raw == null ? '' : raw).normalize('NFKC').trim();
    s = s.replace(/^[☆★●◆◎○■□▲△▼▽※♪♫▶▷▸▹・\-_=~～\s]+/, '');
    s = s.replace(/^(?:\(\d+\)|\[\d+\]|\d+[.)．_\-\s]+)+/, '').trim();
    const unwrapped = s.replace(/^[【\[（(「『](.+)[】\]）)」』]$/, '$1').trim();
    return { base: s, unwrapped };
  }

  function isCategoryToken(tok) {
    if (!tok) return false;
    return CAT_SYS_RE.test(tok) || CAT_PPL_RE.test(tok) || CAT_STYLE_TOKEN_RE.test(tok) || CAT_STYLE_COMPOUND_RE.test(tok);
  }

  function isCategoryFolderName(rawName) {
    const raw = String(rawName == null ? '' : rawName).normalize('NFKC').trim();
    if (!raw) return false;
    const { base, unwrapped } = stripFolderDecor(raw);
    for (const cand of [raw, base, unwrapped]) {
      if (!cand) continue;
      if (isCategoryToken(cand)) return true;
      const parts = cand.split(/[\s・／/_\-、,&＆()（）【】\[\]]+/).filter(Boolean);
      if (parts.length > 0 && parts.every(isCategoryToken)) return true;
    }
    return !!(M && M.isCategoryFolderName && M.isCategoryFolderName(rawName));
  }

  function isAssetSubdirName(rawName) {
    const raw = String(rawName == null ? '' : rawName).normalize('NFKC').trim();
    if (!raw) return false;
    if (M && M.isAssetSubdirName && M.isAssetSubdirName(raw)) return true;
    const { base, unwrapped } = stripFolderDecor(raw);
    return ASSET_SUBDIR_PARTIAL_RE.test(raw) || (!!base && ASSET_SUBDIR_PARTIAL_RE.test(base)) || (!!unwrapped && ASSET_SUBDIR_PARTIAL_RE.test(unwrapped));
  }

  function isPureGenericAssetDir(rawName) {
    const raw = String(rawName == null ? '' : rawName).normalize('NFKC').trim();
    if (!raw) return false;
    const { base, unwrapped } = stripFolderDecor(raw);
    return ASSET_SUBDIR_EX_RE.test(raw) || (!!base && ASSET_SUBDIR_EX_RE.test(base)) || (!!unwrapped && ASSET_SUBDIR_EX_RE.test(unwrapped));
  }

  function inferFolderMeta(rawName) {
    const s = String(rawName == null ? '' : rawName).normalize('NFKC').trim();
    if (!s) return { system: '', playerCount: '', lostRate: '', tags: [] };
    let system = '';
    if (/(?:CoC|クトゥルフ(?:神話)?(?:TRPG)?)?\s*(?:第?\s*6\s*版|6th|ver\.?\s*6)|旧\s*6\s*版|CoC\s*6(?!\d)/i.test(s)) system = 'CoC6版';
    else if (/(?:新クトゥルフ|CoC|クトゥルフ(?:神話)?(?:TRPG)?)?\s*(?:第?\s*7\s*版|7th|ver\.?\s*7)|新\s*7\s*版|CoC\s*7(?!\d)|新クトゥルフ/i.test(s)) system = 'CoC7版';
    else if (M && M.inferSystemFromFolderName) system = M.inferSystemFromFolderName(s) || '';

    let playerCount = '';
    const rangeM = s.match(/(\d{1,2})\s*[~〜\-ー]\s*(\d{1,2})\s*(?:PL|人|名)/i);
    if (rangeM) {
      playerCount = `${rangeM[1]}〜${rangeM[2]}PL`;
    } else if (/タイマン/.test(s)) {
      playerCount = 'タイマン';
    } else if (/ソロ|1\s*人\s*用/.test(s)) {
      playerCount = 'ソロ';
    } else if (/(?:ペア|デュオ)/.test(s)) {
      playerCount = '2PL';
    } else {
      const oneM = s.match(/(\d{1,2})\s*(?:PL|人用|人|名)/i);
      if (oneM) playerCount = `${oneM[1]}PL`;
    }

    let lostRate = '';
    if (/極高ロスト/.test(s)) lostRate = '極高';
    else if (/確定ロスト/.test(s)) lostRate = '確定';
    else if (/高ロスト|ロスト率\s*高/.test(s)) lostRate = '高';
    else if (/中ロスト/.test(s)) lostRate = '中';
    else if (/低ロスト|ロスト率\s*低/.test(s)) lostRate = '低';
    else if (/ロストなし|ロスト無/.test(s)) lostRate = 'なし';
    else if (/ロストあり|ロスト有/.test(s)) lostRate = 'あり';

    const tags = [];
    const addTag = t => { if (t && !tags.includes(t)) tags.push(t); };
    if (/極高ロスト/.test(s)) addTag('高ロスト');
    else if (/高ロスト|ロスト率\s*高/.test(s)) addTag('高ロスト');
    if (/中ロスト/.test(s)) addTag('中ロスト');
    if (/低ロスト|ロスト率\s*低/.test(s)) addTag('低ロスト');
    if (/確定ロスト/.test(s)) addTag('確定ロスト');
    if (/ロストなし|ロスト無/.test(s)) addTag('ロストなし');
    if (/ロスト\s*KPC|KPC\s*ロスト/i.test(s)) addTag('ロストKPC');
    else if (/KPCあり|KPC専用/i.test(s)) addTag('KPCあり');
    if (/ロスト救済/.test(s)) addTag('ロスト救済');
    if (/SAN値回復|SAN回復|正気度回復/i.test(s)) addTag('SAN値回復');
    if (/戦闘あり/.test(s)) addTag('戦闘あり');
    if (/戦闘なし/.test(s)) addTag('戦闘なし');
    if (/新規限定/.test(s)) addTag('新規限定');
    if (/新規推奨/.test(s)) addTag('新規推奨');
    if (/新規/.test(s) && !/新規限定|新規推奨/.test(s)) addTag('新規');
    if (/継続限定/.test(s)) addTag('継続限定');
    if (/継続推奨/.test(s)) addTag('継続推奨');
    if (/継続不問|継続限定・?不問/.test(s)) addTag('継続不問');
    if (/継続/.test(s) && !/継続限定|継続推奨|継続不問/.test(s)) addTag('継続');
    if (/置きレス|置き卓/.test(s)) addTag('置きレス');
    if (/ボイセ/.test(s)) addTag('ボイセ');
    if (/半テキ/.test(s)) addTag('半テキ');
    else if (/完テキ/.test(s)) addTag('完テキ');
    else if (/テキセ/.test(s)) addTag('テキセ');
    if (/秘匿\s*HO|秘匿/i.test(s)) addTag('秘匿HO');
    if (/うちよそ/.test(s)) addTag('うちよそ');
    if (/R-?18-?G/i.test(s)) addTag('R18-G');
    else if (/R-?18/i.test(s)) addTag('R18');
    if (/キャンペーン|\bCP\b/i.test(s)) addTag('キャンペーン');
    if (/周回/.test(s)) addTag('周回可');
    if (/クローズド/.test(s)) addTag('クローズド');
    if (/シティ/.test(s)) addTag('シティ');
    if (/クラシック/.test(s)) addTag('クラシック');
    return { system, playerCount, lostRate, tags };
  }

  function mergeInheritedMeta(baseMeta, folderName) {
    const base = baseMeta && typeof baseMeta === 'object' ? baseMeta : { system: '', playerCount: '', lostRate: '', tags: [] };
    const cur = inferFolderMeta(folderName);
    let system = base.system || '';
    if (cur.system) {
      if (!system || (system === 'CoC' && (cur.system === 'CoC6版' || cur.system === 'CoC7版'))) system = cur.system;
      else if (cur.system !== 'CoC') system = cur.system;
    }
    const playerCount = cur.playerCount || base.playerCount || '';
    const lostRate = cur.lostRate || base.lostRate || '';
    const tags = [...new Set([...(base.tags || []), ...(cur.tags || [])])];
    return { system, playerCount, lostRate, tags };
  }

  const STRUCT_DOC_OR_IMG_RE = /\.(?:pdf|txt|docx?|md|markdown|html?|png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg|m4a|flac|aac)$/i;
  function hasCommonPrefixOrWordWithParent(parentName, dirNames) {
    if (!parentName || !Array.isArray(dirNames) || !dirNames.length) return false;
    const { base, unwrapped } = stripFolderDecor(parentName);
    const stem = (unwrapped || base || String(parentName)).normalize('NFKC').toLowerCase().trim();
    const cleaned = (typeof window !== 'undefined' && typeof window.cleanseScenarioTitleExtras === 'function')
      ? window.cleanseScenarioTitleExtras(stem)
      : stem;
    const compactParent = cleaned.replace(/[\s_\-・/／()（）【】\[\]]+/g, '');
    const tokens = cleaned.split(/[\s_\-・/／()（）【】\[\]]+/).map(t => t.trim()).filter(t => t.length >= 2);
    if (compactParent.length >= 2 && !tokens.includes(compactParent)) tokens.push(compactParent);
    if (!tokens.length) return false;
    return dirNames.some(dn => {
      const d = String(dn || '').normalize('NFKC').toLowerCase().trim();
      if (!d) return false;
      const dCompact = d.replace(/[\s_\-・/／()（）【】\[\]]+/g, '');
      return tokens.some(tok => d.startsWith(tok) || d.includes(tok) || (tok.length >= 3 && dCompact.startsWith(tok)));
    });
  }
  function classifyContainerEnhanced({ name, dirNames, fileNames, isWatchRoot, hasMultiScenarioChildren, childHasScenarioFn }) {
    const dirs = Array.isArray(dirNames) ? dirNames : [];
    const files = Array.isArray(fileNames) ? fileNames : [];
    if (!dirs.length && !files.length) return 'empty';
    if (isWatchRoot || isCategoryFolderName(name)) return 'container';
    // ① 直下に本文・画像・音声のいずれかが1つでもあればシナリオ確定
    const hasDirectDocOrImg = files.some(f => STRUCT_DOC_OR_IMG_RE.test(String(f || '').trim()));
    if (hasDirectDocOrImg) return 'scenario';
    // ② 直下のサブフォルダまたはZIPに構成用サブフォルダ判定が1つでも含まれていればシナリオ確定
    if (dirs.some(dn => isAssetSubdirName(dn))) return 'scenario';
    if (files.some(fn => /\.zip$/i.test(String(fn || '').trim()) && isAssetSubdirName(String(fn).replace(/\.zip$/i, '')))) return 'scenario';
    // ③ 直下のサブフォルダ群が親フォルダ名と共通の単語・プレフィックスを持っていればシナリオ確定
    if (hasCommonPrefixOrWordWithParent(name, dirs)) return 'scenario';
    const nonAssetDirs = dirs.filter(dn => !isAssetSubdirName(dn));
    if (nonAssetDirs.length >= 2) {
      if (hasMultiScenarioChildren) return 'container';
      if (typeof childHasScenarioFn === 'function') {
        let hits = 0;
        for (const dn of nonAssetDirs) {
          if (childHasScenarioFn(dn) && ++hits >= 2) return 'container';
        }
      }
    }
    return 'scenario';
  }

  function upsertScenarioDocs(sc, docItems) {
    if (!sc || !Array.isArray(docItems) || !docItems.length) return 0;
    sc.docs = Array.isArray(sc.docs) ? sc.docs : [];
    const byPath = new Map(), byName = new Map();
    const normP = p => String(p || '').replace(/\//g, '\\').trim().toLowerCase();
    const normN = n => String(n || '').normalize('NFKC').trim().toLowerCase();
    sc.docs.forEach(d => {
      if (!d) return;
      const dp = normP(d.path || d.ref || '');
      const dn = normN(d.origName || d.name || '');
      if (dp) byPath.set(dp, d);
      if (dn && !byName.has(dn)) byName.set(dn, d);
    });
    let added = 0;
    docItems.forEach(it => {
      if (!it || !it.name) return;
      const fp = it.path || it.ref || '';
      const pk = normP(fp);
      const nk = normN(it.origName || it.name);
      const ex = (pk && byPath.get(pk)) || (nk && byName.get(nk));
      if (ex) {
        if (fp && !ex.path) ex.path = fp;
        if (fp && !ex.ref) ex.ref = fp;
        if (it.mtime && (!ex.mtime || it.mtime > ex.mtime)) ex.mtime = it.mtime;
        return;
      }
      const extMatch = String(it.origName || it.name).match(/\.([^.]+)$/);
      const docObj = {
        id: (typeof galId === 'function' ? galId() : (M && M.newId ? M.newId() : uid())),
        name: stripAssetExt(it.name),
        origName: it.origName || it.name,
        path: fp,
        ref: fp,
        rel: it.rel || '',
        ext: extMatch ? extMatch[1].toLowerCase() : 'pdf',
        category: '資料',
        mtime: Number(it.mtime || 0),
        addedAt: Date.now()
      };
      sc.docs.push(docObj);
      if (pk) byPath.set(pk, docObj);
      if (nk) byName.set(nk, docObj);
      added++;
    });
    return added;
  }

  /** フォルダを再帰的に調べ、登録対象のファイルを集める（旧版フォルダ除外・重複排除・スマートカテゴリ名寄せ）。 */
  function scanFolder(root, opts) {
    const skipStat = !!(opts && opts.skipStat);
    const rootBase = path.basename(root);
    const out = [], byPath = new Map(), byName = new Map();
    let count = 0, truncated = false;
    const normP = p => String(p || '').replace(/\//g, '\\').toLowerCase();
    const normN = n => String(n || '').normalize('NFKC').trim().toLowerCase();
    const inferCat = (fileName, relDirs) => {
      if (isDocAssetName(fileName)) return '資料';
      if (M && typeof M.inferSmartCategoryFromFolders === 'function') {
        return M.inferSmartCategoryFromFolders(fileName, relDirs, rootBase);
      }
      return M.inferSmartCategory(fileName, relDirs[relDirs.length - 1] || '');
    };
    (function walk(dir, relDirs, depth) {
      let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      list.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
      const rawEntries = [];
      for (const d of list) {
        if (d.name.startsWith('.') || d.name === 'node_modules' || d.name === '__MACOSX' || d.name === '_TRPG_Data') continue;
        if (isOldVersionName(d.name)) continue;
        const isDir = d.isDirectory();
        if (!isDir && !typeOf(d.name)) continue;
        const full = path.join(dir, d.name);
        let mtime = 0;
        if (!skipStat && !isDir) { try { mtime = fs.statSync(full).mtimeMs || 0; } catch (_) { } }
        rawEntries.push({ d, name: d.name, isDir, full, mtime });
      }
      const filtered = filterLatestVersionEntries(rawEntries);
      for (const ent of filtered) {
        if (ent.isDir) {
          if (depth < MAX_DEPTH) walk(ent.full, [...relDirs, ent.name], depth + 1);
          continue;
        }
        const type = typeOf(ent.name); if (!type) continue;
        const pk = normP(ent.full), nk = normN(ent.name);
        const cat = inferCat(ent.name, relDirs);
        const existing = byPath.get(pk);
        if (existing) {
          if (!existing.category && cat) existing.category = cat;
          continue;
        }
        if (++count > LIMIT) { truncated = true; return; }
        const item = { type, name: stripAssetExt(ent.name), origName: ent.name, path: ent.full, relPath: [...relDirs, ent.name].join('/'), category: cat, mtime: ent.mtime };
        byPath.set(pk, item);
        if (nk && !byName.has(nk)) byName.set(nk, item);
        out.push(item);
      }
    })(root, [], 0);
    return { items: out, truncated };
  }

  const CHILD_SCENARIO_FILE_RE = /\.(?:pdf|txt|docx?|md|markdown|html?|zip)$/i;
  function dirHasScenarioFiles(subDirPath, d = 0) {
    if (d > 2) return false;
    let list;
    try { list = fs.readdirSync(subDirPath, { withFileTypes: true }); } catch (_) { return false; }
    for (const ent of list) {
      if (ent.name.startsWith('.') || ent.name === '__MACOSX' || ent.name === 'node_modules' || ent.name === '_TRPG_Data') continue;
      if (isOldVersionName(ent.name)) continue;
      if (ent.isFile() && CHILD_SCENARIO_FILE_RE.test(ent.name)) return true;
      if (ent.isDirectory() && dirHasScenarioFiles(path.join(subDirPath, ent.name), d + 1)) return true;
    }
    return false;
  }

  /** 中間分類フォルダ（監視ルートまたは分類名フォルダ）のみを再帰的に辿り、個別シナリオ候補を列挙する（最大深さ7階層） */
  function discoverScenarioEntries(rootDir, opts) {
    const maxDepth = Math.min(7, Math.max(1, Number((opts && opts.maxDepth) || 7)));
    const isWatchRoot = !!(opts && opts.isWatchRoot);
    const out = [];
    const initMeta = {
      system: (opts && opts.inheritedSystem) || '',
      playerCount: (opts && opts.inheritedPlayerCount) || '',
      lostRate: (opts && opts.inheritedLostRate) || '',
      tags: Array.isArray(opts && opts.inheritedTags) ? opts.inheritedTags.slice() : []
    };
    (function walk(dir, inheritedMeta, depth) {
      let raw;
      try { raw = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      const rawEntries = [];
      for (const d of raw) {
        if (d.name.startsWith('.') || d.name === '__MACOSX' || d.name === 'node_modules' || d.name === '_TRPG_Data' || d.name === 'desktop.ini' || d.name === 'Thumbs.db') continue;
        if (isOldVersionName(d.name)) continue;
        const full = path.join(dir, d.name);
        let isDir = false, isFile = false, mtime = 0;
        if (d.isDirectory()) isDir = true;
        else if (d.isFile()) isFile = true;
        else if (d.isSymbolicLink()) {
          try {
            const st = fs.statSync(full);
            if (st.isDirectory()) isDir = true;
            else if (st.isFile()) isFile = true;
            mtime = st.mtimeMs || 0;
          } catch (_) { }
        }
        if (!isDir && !isFile) continue;
        if (!mtime) { try { mtime = fs.statSync(full).mtimeMs || 0; } catch (_) { } }
        rawEntries.push({ name: d.name, isDir, full, mtime });
      }
      const keptEntries = filterLatestVersionEntries(rawEntries);
      const dirNames = keptEntries.filter(x => x.isDir).map(x => x.name).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
      const fileNames = keptEntries.filter(x => !x.isDir).map(x => x.name).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));

      const baseName = path.basename(dir);
      const isCatDir = isCategoryFolderName(baseName);
      const atWatchRoot = isWatchRoot && depth === 0;
      if (depth >= maxDepth) {
        if (!isCatDir && !atWatchRoot && (dirNames.length || fileNames.length)) {
          out.push({
            p: dir, dir: true, type: 'dir',
            inheritedSystem: inheritedMeta.system,
            inheritedPlayerCount: inheritedMeta.playerCount,
            inheritedLostRate: inheritedMeta.lostRate || '',
            inheritedTags: inheritedMeta.tags.slice()
          });
        }
        return;
      }
      const kind = classifyContainerEnhanced({
        name: baseName,
        dirNames,
        fileNames,
        isWatchRoot: atWatchRoot,
        childHasScenarioFn: dn => dirHasScenarioFiles(path.join(dir, dn), 0)
      });
      if (kind === 'empty') return;
      if (kind === 'scenario' && !isCatDir && !atWatchRoot) {
        out.push({
          p: dir, dir: true, type: 'dir',
          inheritedSystem: inheritedMeta.system,
          inheritedPlayerCount: inheritedMeta.playerCount,
          inheritedLostRate: inheritedMeta.lostRate || '',
          inheritedTags: inheritedMeta.tags.slice()
        });
        return;
      }
      // 中間分類フォルダ（監視ルートまたは分類名フォルダ）：自身のフォルダ名からシステム・人数・ロスト率・タグを継承し、子のフォルダ／ZIP／本文ファイルへ再帰
      const nextMeta = atWatchRoot ? inheritedMeta : mergeInheritedMeta(inheritedMeta, baseName);
      for (const dn of dirNames) {
        if (isPureGenericAssetDir(dn)) continue;
        walk(path.join(dir, dn), nextMeta, depth + 1);
      }
      for (const fn of fileNames) {
        if (/\.zip$/i.test(fn)) {
          out.push({
            p: path.join(dir, fn), dir: false, type: 'zip',
            inheritedSystem: nextMeta.system,
            inheritedPlayerCount: nextMeta.playerCount,
            inheritedLostRate: nextMeta.lostRate || '',
            inheritedTags: nextMeta.tags.slice()
          });
        } else if (/\.(?:pdf|txt|html?|md|docx?)$/i.test(fn) && !/^read\s*me\./i.test(fn)) {
          out.push({
            p: path.join(dir, fn), dir: false, type: 'pdf',
            inheritedSystem: nextMeta.system,
            inheritedPlayerCount: nextMeta.playerCount,
            inheritedLostRate: nextMeta.lostRate || '',
            inheritedTags: nextMeta.tags.slice()
          });
        }
      }
    })(rootDir, initMeta, 0);
    return out;
  }

  function applyInheritedMeta(sc, metaOrSys) {
    if (!sc || !metaOrSys) return false;
    const meta = typeof metaOrSys === 'string'
      ? { system: metaOrSys, playerCount: '', lostRate: '', tags: [] }
      : metaOrSys;
    let changed = false;
    const sys = String(meta.system || '').trim();
    if (sys && (!String(sc.system || '').trim() || (String(sc.system).trim() === 'CoC' && (sys === 'CoC6版' || sys === 'CoC7版')))) {
      sc.system = sys;
      changed = true;
    }
    const ppl = String(meta.playerCount || '').trim();
    if (ppl && !String(sc.playerCount || '').trim()) {
      sc.playerCount = ppl;
      changed = true;
    }
    const lr = String(meta.lostRate || '').trim();
    if (lr && !String(sc.lostRate || '').trim()) {
      sc.lostRate = lr;
      changed = true;
    }
    sc.tags = Array.isArray(sc.tags) ? sc.tags : [];
    (meta.tags || []).forEach(t => {
      const s = String(t || '').trim();
      if (s && !sc.tags.includes(s)) { sc.tags.push(s); changed = true; }
    });
    if (typeof applyFlatToBlocks === 'function') applyFlatToBlocks(sc);
    if (typeof syncDerivedTagsFromFields === 'function') {
      if (syncDerivedTagsFromFields(sc)) changed = true;
    } else if (sys && !sc.tags.includes(sys)) {
      sc.tags.push(sys);
      changed = true;
    }
    return changed;
  }
  function applyInheritedSystem(sc, inheritedSystem) {
    return applyInheritedMeta(sc, inheritedSystem);
  }

  /** 同名のシナリオ（タイトルが同じ）を探し、無ければシナリオDBへ新規追加する */
  function findOrCreateScenario(title, opts) {
    const list = CCF.scenarioList();
    let sc = list.find(s => titlesSame(s.title, title)), created = false;
    if (!sc) {
      sc = { id: uid(), title, system: (opts && opts.inheritedSystem) || '', playerCount: (opts && opts.inheritedPlayerCount) || '', lostRate: (opts && opts.inheritedLostRate) || '', tags: [], postedChannels: [], trailer: '', trailerDecor: 'default', shopUrl: '', autoReply: '' };
      if (opts && opts.sourcePath) sc.sourcePath = opts.sourcePath;
      deriveFlat(sc);
      applyInheritedMeta(sc, {
        system: (opts && opts.inheritedSystem) || '',
        playerCount: (opts && opts.inheritedPlayerCount) || '',
        lostRate: (opts && opts.inheritedLostRate) || '',
        tags: (opts && opts.inheritedTags) || []
      });
      appState.scenarios.push(sc); created = true;
      if (!(opts && opts.deferSave)) {
        saveState(false, { skipDetailEdited: true }); try { populateScenarioDBSelect(); renderDBView(true); } catch (e) { console.warn('[ccf] 一覧の更新に失敗', e); }
      }
    }
    return { sc, created };
  }

  // ---------- スマートD&D：シナリオ名・トレーラー画像の推測 ----------
  const GENERIC_NAME = /^(新しいフォルダー?( \(\d+\))?|new folder( \(\d+\))?|untitled|downloads?|scenario|シナリオ|無題|[\d\s._-]+)$/i;
  const NPC_PORTRAIT_RE = (M && M.NPC_PORTRAIT_RE) || /(?:npc|kpc|立ち絵|立絵|キャラ|chara|人物|バストアップ|アイコン|icon|tachie|差分|表情|通常|笑顔|微笑|怒り?|哀|悲しみ?|泣き?|照れ?|驚き?|困り?|焦り?|呆れ?|真顔|真剣|目閉じ|ウインク|シルエット|全身|衣装|私服|制服|戦闘服|礼装|着物|水着|(?:^|[\s_\-(（【\[])(?:ho|pc)\s*[1-9１-９](?:$|[\s_\-)）】\]]))/i;
  const TRAILER_EXCLUDED_CATS = new Set(['NPC', 'マップ', '前景', '部屋素材']);
  const TRAILER_RANKS = [/trailer|トレーラー/i, /title|タイトル|サムネ|thumb|表紙|cover|概要|お品書き|メイン|main|ロゴ|logo/i];   // 先に並ぶほど優先
  const isNpcPortraitCandidate = itemOrName => {
    if (!itemOrName) return false;
    if (typeof itemOrName === 'string') return NPC_PORTRAIT_RE.test(String(itemOrName).normalize('NFKC'));
    const bn = String(itemOrName.name || itemOrName.origName || '').split(/[\\/]/).pop() || '';
    if (bn && NPC_PORTRAIT_RE.test(bn.normalize('NFKC'))) return true;
    const rel = String(itemOrName.relPath || itemOrName.rel || '');
    if (rel && NPC_PORTRAIT_RE.test(rel.normalize('NFKC'))) return true;
    return false;
  };
  const trailerRank = itemOrName => {
    if (!itemOrName) return 99;
    const isObj = typeof itemOrName === 'object';
    const rawName = isObj ? String(itemOrName.name || itemOrName.origName || '') : String(itemOrName);
    const bn = rawName.split(/[\\/]/).pop() || '';
    const cat = isObj ? String(itemOrName.category || '').trim() : (M && M.inferSmartCategory ? M.inferSmartCategory(bn, '') : '');
    if (TRAILER_EXCLUDED_CATS.has(cat)) return 99;
    if (isNpcPortraitCandidate(itemOrName)) return 99;
    if (cat === 'トレーラー') return 0;
    const i = TRAILER_RANKS.findIndex(re => re.test(bn));
    if (i >= 0) return i;
    if (cat === '背景' || /スチル|still/i.test(bn)) return 2;
    return 99;
  };
  /** 候補（{name,…}）の中から、トレーラー画像らしいものを選ぶ（NPC・マップ・前景・部屋素材・単なる連番画像は除外し、無ければ null） */
  function pickTrailer(list) {
    const c = (list || []).map(x => ({ x, r: trailerRank(x) })).filter(a => a.r < 99);
    c.sort((a, b) => a.r - b.r || String(a.x.name).localeCompare(String(b.x.name), 'ja', { numeric: true }));
    return c.length ? c[0].x : null;
  }
  /** PDF のメタデータ（Title）、無ければ 1ページ目で最も大きい文字から「シナリオ名」を推測する（失敗・タイムアウトは ''） */
  async function guessPdfTitle(p) {
    let task = null;
    try {
      if (fs.statSync(p).size > 200 * 1024 * 1024) return '';
      const isBadTitle = v => !v || (CCF.scan && CCF.scan.isMojibakeText && CCF.scan.isMojibakeText(v, { checkHiragana: false })) || (CCF.scan && CCF.scan.isBoilerTitle && CCF.scan.isBoilerTitle(v));
      const lib = window.CCFPdfViewer.loadPdfjs(CCF.APP_DIR), base = path.join(CCF.APP_DIR, 'node_modules', 'pdfjs-dist'), furl = q => require('url').pathToFileURL(q).href;
      task = lib.getDocument({ data: new Uint8Array(fs.readFileSync(p)), cMapUrl: furl(path.join(base, 'cmaps')) + '/', cMapPacked: true, standardFontDataUrl: furl(path.join(base, 'standard_fonts')) + '/', isEvalSupported: false });
      const run = (async () => {
        const doc = await task.promise;
        try {
          const meta = await doc.getMetadata().catch(() => null), mt = meta && meta.info && String(meta.info.Title || '').replace(/\s+/g, ' ').trim();
          if (mt && mt.length >= 2 && mt.length <= 60 && !/^(untitled|microsoft word|無題)|\.(docx?|pdf|indd|psd)$/i.test(mt) && !isBadTitle(mt)) return mt;
          const tc = await (await doc.getPage(1)).getTextContent(), its = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, h: Math.abs((i.transform && i.transform[3]) || i.height || 0) }));
          if (!its.length) return '';
          const mx = Math.max(...its.map(i => i.h)), t = its.filter(i => i.h >= mx - 0.5).map(i => i.s).join('').replace(/\s+/g, ' ').trim();
          return (t.length >= 2 && t.length <= 60 && !isBadTitle(t)) ? t : '';
        } finally { try { doc.destroy(); } catch (e) { /* noop */ } }
      })();
      return await Promise.race([run, new Promise(r => setTimeout(() => { try { task.destroy(); } catch (e) { /* noop */ } r(''); }, 8000))]) || '';
    } catch (e) { console.warn('[ccf] PDFからシナリオ名を推測できませんでした', e); try { if (task) task.destroy(); } catch (x) { /* noop */ } return ''; }
  }
  /** 抽出したスペックをシナリオの空欄へ反映する（既に入力がある項目は上書きしない。あらすじ自動抽出は廃止）。戻り値：反映した項目名の配列 */
  function applySpec(sc, spec) {
    if (!spec) return [];
    const blocks = ensureScenarioBlocks(sc), sum = blocks.find(b => b.type === 'summary_container'), done = [];
    const isBadField = v => !v || (CCF.scan && CCF.scan.isMojibakeText && CCF.scan.isMojibakeText(v, { checkHiragana: false }));
    const set = (field, label, val) => {
      if (!val || !sum || isBadField(val)) return;
      let item = sum.items.find(i => i && i.field === field);
      if (!item) { item = { keyName: label, val: '', field }; sum.items.push(item); }
      if (String(item.val || '').trim()) return;
      item.val = val; done.push(label);
    };
    set('system', 'システム', spec.system);
    set('playerCount', '人数', spec.playerCount);
    set('playTime', 'プレイ時間', spec.playTime);
    set('reqSkills', '必須技能', spec.reqSkills);
    set('recSkills', '推奨技能', spec.recSkills);
    set('semiRecSkills', '準推奨技能', spec.semiRecSkills);
    set('lostRate', 'ロスト率', spec.lostRate);
    set('aftereffect', '後遺症', spec.aftereffect);
    if (sc.trailer && CCF.scan && CCF.scan.isMojibakeText && CCF.scan.isMojibakeText(sc.trailer)) sc.trailer = '';
    deriveFlat(sc);
    if (typeof syncDerivedTagsFromFields === 'function') syncDerivedTagsFromFields(sc);
    return done;
  }
  const fileSize = p => { try { return fs.statSync(p).size; } catch (e) { return 0; } };
  const RE_ROLE_NAME = /^(?:本編|本文|本篇|KP.*|真相.*|データ.*|HO.*|規約.*|第.{1,3}話|シナリオ|素材|立ち絵|部屋|room)$/i;
  /** フォルダ名（／ファイル名）のクレンジング結果と、PDF の最大フォント文字列を併用してシナリオ名を決める */
  function chooseTitle(base, pdfTitle, generic, parentName, opts) {
    const fc = cleanseTitle(base, parentName);
    const isBoiler = v => !!(v && CCF.scan && CCF.scan.isBoilerTitle && CCF.scan.isBoilerTitle(v));
    const safePdf = (pdfTitle && !isBoiler(pdfTitle)) ? String(pdfTitle).trim() : '';
    const pc = safePdf ? (cleanseTitle(safePdf) || safePdf) : '';
    const validPc = (pc && !isBoiler(pc)) ? pc : '';
    if (!fc || generic) return validPc || fc;
    if (opts && opts.preferFolder) return fc;
    if (!validPc) return fc;
    if (looseSame(fc, validPc)) return validPc.length >= fc.length ? validPc : fc;   // 同じ作品名なら、より完全な方
    return fc;
  }
  /** トレーラー画像（＝シナリオの画像ブロック）へセットする */
  function setTrailerImage(sc, url, imgName) {
    const blocks = ensureScenarioBlocks(sc), img = blocks.find(b => b.type === 'image');
    if (img) { img.previewUrl = url; img.file = null; }
    else blocks.push({ id: 'img_' + Date.now(), type: 'image', label: '画像添付', file: null, previewUrl: url, sectionType: 'image', collapsed: true, isCustom: true });
    if (url && Array.isArray(sc.images)) {
      const origNm = imgName || 'trailer.png';
      const nm = stripAssetExt(origNm);
      const exists = sc.images.some(x => x && (x.dataUrl === url || stripAssetExt(x.origName || x.name || '').toLowerCase() === nm.toLowerCase()));
      if (!exists) {
        if (!Array.isArray(sc.imageCategories)) sc.imageCategories = typeof DEFAULT_SCENARIO_CATS !== 'undefined' ? [...DEFAULT_SCENARIO_CATS] : ['トレーラー'];
        if (!sc.imageCategories.includes('トレーラー')) sc.imageCategories.push('トレーラー');
        sc.images.push({ id: (typeof galId === 'function' ? galId() : M.newId()), name: nm, origName: origNm, dataUrl: url, category: 'トレーラー', mtime: 0, addedAt: Date.now() });
      }
    }
    deriveFlat(sc);
  }
  async function trailerDataUrl(c) {
    if (!c) return '';
    if (c.dataUrl) return c.dataUrl;
    try { return c.zipUrl ? await CCF.zip.toDataUrl(c.zipUrl) : await dataUrlFromPath(c.path, c.name); } catch (e) { console.warn('[ccf] トレーラー画像を読めませんでした', e); return ''; }
  }

  /** フォルダ／シナリオ内の ZIP 群を最大深さ2段階まで透過検査し、部屋ZIPの分類とトレーラー画像補完を行う */
  async function inspectZipsForScenario(zipItems, opts) {
    const o = opts || {};
    const needTrailer = o.needTrailer !== false;
    const fallbackFirstImage = !!o.fallbackFirstImage;
    let trailerDataUrl = '', trailerZipUrl = '', trailerName = '';
    const roomZipPaths = [];
    if (!CCF.zip || typeof CCF.zip.inspectDeep !== 'function') return { trailerDataUrl, trailerZipUrl, trailerName, roomZipPaths };
    for (const item of (zipItems || [])) {
      const src = item && (item.path || item.file || item);
      if (!src) continue;
      try {
        const res = await CCF.zip.inspectDeep(src, { maxDepth: 2, toDataUrl: true, fallbackFirstImage });
        if (res.isRoomZip) {
          if (item && typeof item === 'object' && 'category' in item) item.category = 'ココフォリア部屋ZIP';
          if (typeof src === 'string') roomZipPaths.push(src);
          continue;
        }
        if (needTrailer && !trailerDataUrl && !trailerZipUrl) {
          if (res.trailerDataUrl) { trailerDataUrl = res.trailerDataUrl; trailerName = res.trailerName || ''; }
          else if (res.trailerZipUrl) { trailerZipUrl = res.trailerZipUrl; trailerName = res.trailerName || ''; }
        }
      } catch (_) { }
    }
    return { trailerDataUrl, trailerZipUrl, trailerName, roomZipPaths };
  }

  // ---------- シナリオ名のクレンジング／比較用の正規化（実体は CCFModel と共有＋拡張クレンジング） ----------
  const applyExtraTitleCleanse = s => (typeof window !== 'undefined' && typeof window.cleanseScenarioTitleExtras === 'function')
    ? window.cleanseScenarioTitleExtras(s)
    : String(s == null ? '' : s).normalize('NFKC').trim();
  if (M && !M._patchedCleanseV2) {
    M._patchedCleanseV2 = true;
    const origExtract = typeof M.extractTitleAndSystem === 'function' ? M.extractTitleAndSystem.bind(M) : null;
    const origCleanse = typeof M.cleanseTitle === 'function' ? M.cleanseTitle.bind(M) : null;
    const origNorm = typeof M.normalizeForMatch === 'function' ? M.normalizeForMatch.bind(M) : null;
    const origIsAssetSubdir = typeof M.isAssetSubdirName === 'function' ? M.isAssetSubdirName.bind(M) : null;
    if (origExtract) {
      M.extractTitleAndSystem = (raw, parentName) => {
        const res = origExtract(raw, parentName);
        if (res && res.title) res.title = applyExtraTitleCleanse(res.title) || res.title;
        return res;
      };
    }
    if (origCleanse) {
      M.cleanseTitle = (raw, parentName) => applyExtraTitleCleanse(origCleanse(raw, parentName));
    }
    if (origNorm) {
      M.normalizeForMatch = raw => {
        if (typeof window !== 'undefined' && typeof window.getScenarioDedupKey === 'function') {
          const k = window.getScenarioDedupKey(raw);
          if (k) return k;
        }
        return origNorm(applyExtraTitleCleanse(raw));
      };
    }
    if (origIsAssetSubdir) {
      M.isAssetSubdirName = rawName => origIsAssetSubdir(rawName) || ASSET_SUBDIR_PARTIAL_RE.test(String(rawName == null ? '' : rawName).normalize('NFKC').trim());
    }
  }
  const extractTitleAndSystem = (raw, parentName) => (M && M.extractTitleAndSystem)
    ? M.extractTitleAndSystem(raw, parentName)
    : { title: applyExtraTitleCleanse(String(raw == null ? '' : raw).normalize('NFKC').replace(/\.(pdf|zip)$/i, '').trim()), system: '' };
  const cleanseTitle = (raw, parentName) => extractTitleAndSystem(raw, parentName).title;
  const normalizeForMatch = raw => (typeof window !== 'undefined' && typeof window.getScenarioDedupKey === 'function')
    ? window.getScenarioDedupKey(raw)
    : ((M && M.normalizeForMatch)
      ? M.normalizeForMatch(raw)
      : cleanseTitle(raw).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''));
  const looseSame = (a, b) => { const x = normalizeForMatch(a), y = normalizeForMatch(b); if (!x || !y) return false; if (x === y) return true; const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return s.length >= 2 && l.includes(s); };
  /** 既存シナリオ候補：正規化タイトルの完全一致のみで照合する（部分一致による別作品の誤統合を防ぐ） */
  function findExisting(list, names) {
    for (const n of names) {
      const target = normalizeForMatch(n);
      if (!target) continue;
      const h = list.find(s => normalizeForMatch(s.title) === target);
      if (h) return h;
    }
    return null;
  }
  /** フォルダ／ZIP／（対象シナリオの無い）PDF 1つ分を解析して登録・マージする。戻り値：{ sc, created, merged, counts… } か null */
  async function processScenarioItem(it, opts) {
    const bulk = !!(opts && opts.bulk);
    const deferSave = !!(opts && (opts.deferSave || opts.bulk));
    const name = path.basename(it.p), base = it.type === 'zip' ? path.basename(name, path.extname(name)) : name;
    const rawParent = path.basename(path.dirname(it.p));
    const parentName = (rawParent && rawParent !== path.parse(it.p).root) ? rawParent : '';
    const parsedTitle = extractTitleAndSystem(base, parentName);
    let title = parsedTitle.title || base, refs = [], trailerCand = null, truncated = false, mainPdf = '', analysis = null;
    const detectedMeta = {
      system: it.inheritedSystem || parsedTitle.system || '',
      playerCount: it.inheritedPlayerCount || '',
      lostRate: it.inheritedLostRate || '',
      tags: Array.isArray(it.inheritedTags) ? it.inheritedTags.slice() : []
    };
    const detectedSystem = detectedMeta.system;
    if (it.dir) {
      const scan = scanFolder(it.p, { skipStat: bulk }); if (!scan.items.length) return { skipped: true };
      refs = scan.items; truncated = scan.truncated;
      const imgs = scan.items.filter(i => i.type === 'image');
      const zips = scan.items.filter(i => i.type === 'zip');
      const pdfs = scan.items.filter(i => i.type === 'pdf');
      trailerCand = pickTrailer(imgs);
      if (zips.length) {
        const zInfo = await inspectZipsForScenario(zips, { needTrailer: !trailerCand, fallbackFirstImage: false });
        if (!trailerCand && (zInfo.trailerDataUrl || zInfo.trailerZipUrl)) {
          trailerCand = { name: zInfo.trailerName || 'trailer.png', dataUrl: zInfo.trailerDataUrl, zipUrl: zInfo.trailerZipUrl };
        }
      }
      if (pdfs.length) {
        if (!bulk) {
          const sized = pdfs.map(i => Object.assign({}, i, { size: fileSize(i.path) }));
          const pick = CCF.scan.pickMainPdf(sized, base); mainPdf = pick.main.path; say('📖 PDFを解析しています…（' + path.basename(mainPdf) + '）');
          analysis = await CCF.pdfText.analyzePdfs(mainPdf, pick.subs.map(s => s.path), { cover: !trailerCand });
          const safePdfTitle = (analysis.title && !(CCF.scan && CCF.scan.isMojibakeText && CCF.scan.isMojibakeText(analysis.title, { checkHiragana: false })) && !(CCF.scan && CCF.scan.isBoilerTitle && CCF.scan.isBoilerTitle(analysis.title))) ? analysis.title : '';
          title = chooseTitle(base, safePdfTitle, GENERIC_NAME.test(base) || !cleanseTitle(base) || RE_ROLE_NAME.test(base), parentName, { preferFolder: true }) || title;
        } else {
          mainPdf = pdfs[0].path;
        }
      }
    } else if (it.type === 'zip') {
      let zRes;
      try { zRes = await CCF.zip.inspectDeep(it.p, { maxDepth: 2, toDataUrl: true, fallbackFirstImage: false }); }
      catch (e) { say('⚠️ ZIPを開けませんでした：' + name + '（' + (e.message || e) + '）'); return { skipped: true }; }
      refs = [{ type: 'zip', name: stripAssetExt(name), origName: name, path: it.p, category: zRes.isRoomZip ? 'ココフォリア部屋ZIP' : base }];
      if (!zRes.isRoomZip && (zRes.trailerDataUrl || zRes.trailerZipUrl)) {
        trailerCand = { name: zRes.trailerName || 'trailer.png', dataUrl: zRes.trailerDataUrl, zipUrl: zRes.trailerZipUrl };
      }
    } else {   // PDF / TXT
      mainPdf = it.p;
      if (!bulk && /\.(?:pdf|txt|md|markdown|html?)$/i.test(name)) {
        say('📖 資料を解析しています…（' + name + '）');
        analysis = await CCF.pdfText.analyzePdfs(it.p, [], { cover: /\.pdf$/i.test(name) });
      }
      const stem = path.basename(name, path.extname(name));
      const safePdfTitle = (analysis && analysis.title && !(CCF.scan && CCF.scan.isMojibakeText && CCF.scan.isMojibakeText(analysis.title, { checkHiragana: false }))) ? analysis.title : '';
      title = chooseTitle(stem, safePdfTitle, GENERIC_NAME.test(stem) || !cleanseTitle(stem) || RE_ROLE_NAME.test(stem), parentName) || title;
      refs = [{ type: 'pdf', name: stripAssetExt(name), origName: name, path: it.p, category: '資料' }];
    }
    title = String(title).trim() || base;
    // 既存シナリオと同名なら、重複作成せず確認のうえでマージ
    const list = CCF.scenarioList(), ex = findExisting(list, [title, base]);
    let sc, created = false, merged = false;
    if (ex) {
      const ok = await appConfirm('既存シナリオ『' + (ex.title || '無題') + '』に素材を追加・紐づけしますか？', { okText: '追加・紐づけする', cancelText: 'キャンセル' });
      if (!ok) return { skipped: true, declined: true };
      sc = ex; merged = true;
    } else {
      const r = findOrCreateScenario(title, {
        deferSave,
        inheritedSystem: detectedSystem,
        inheritedPlayerCount: detectedMeta.playerCount,
        inheritedLostRate: detectedMeta.lostRate,
        inheritedTags: detectedMeta.tags,
        sourcePath: it.p
      });
      sc = r.sc; created = r.created;
    }
    const sysChanged = applyInheritedMeta(sc, detectedMeta);
    const docRefs = refs.filter(r => r && (r.type === 'pdf' || r.type === 'doc' || isDocAssetName(r.name)));
    const assetRefs = refs.filter(r => r && !(r.type === 'pdf' || r.type === 'doc' || isDocAssetName(r.name)));
    if (docRefs.length) upsertScenarioDocs(sc, docRefs);
    if (assetRefs.length) CCF.withProject(String(sc.id), proj => M.addRefs(proj, assetRefs));
    let trailerSet = false, coverSet = false, specSet = [];
    if (trailerCand && !sc.imageUrl) { const u = await trailerDataUrl(trailerCand); if (u) { setTrailerImage(sc, u, trailerCand.name); trailerSet = true; } }   // 既にあるトレーラー画像は上書きしない
    if (analysis) {   // スペック（人数・時間・推奨技能・ロスト率・あらすじ）を空欄にだけ反映。同梱画像が無ければ、メインPDFの1ページ目を表紙（トレーラー画像）に
      specSet = applySpec(sc, analysis.spec);
      if (analysis.coverUrl && !trailerSet && !sc.imageUrl) { setTrailerImage(sc, analysis.coverUrl); coverSet = true; }
    }
    if (!deferSave && (trailerSet || coverSet || specSet.length || merged || sysChanged || docRefs.length)) { saveState(false, { skipDetailEdited: true }); try { renderDBView(true); } catch (e) { console.warn('[ccf] 一覧の更新に失敗', e); } }
    const counts = { pdf: 0, audio: 0, zip: 0, image: 0 }; refs.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
    return { sc, created, merged, counts, truncated, trailerSet, coverSet, specSet, pdfPath: mainPdf || (docRefs[0] && docRefs[0].path) || '' };
  }

  /** ドロップされたパス群を処理する（ctx：'home' ホーム画面 ／ 'ccf' ココフォリアタブ、scenarioId：ドロップ先のシナリオカード）
   *  ・フォルダ／ZIP／PDF（対象シナリオ無し）が「1つ」だけ → 解析後すぐ「📝 Discord投稿・編集」画面を開く
   *  ・「複数」 → 画面は移動せず、一括登録して「〇件のシナリオを追加しました」の通知だけ出す
   *  ・既存シナリオと同名 → 確認のうえ既存へ素材をマージ */
  async function handlePaths(paths, o) {
    o = o || {};
    const currentSc = () => (o.scenarioId ? CCF.scenarioList().find(s => String(s.id) === String(o.scenarioId)) : (o.ctx === 'ccf' && S.key !== '_default' ? CCF.scenarioList().find(s => String(s.id) === S.key) : null)) || null;
    const target = currentSc(), scnItems = [], assets = [], roomZips = []; let skipped = 0;
    for (const p of paths) {   // 分類
      let st; try { st = fs.statSync(p); } catch (e) { skipped++; continue; }
      if (st.isDirectory()) {
        const discovered = discoverScenarioEntries(p, { maxDepth: 5 });
        discovered.forEach(ent => scnItems.push(ent));
        continue;
      }
      const type = typeOf(path.basename(p)); if (!type) { skipped++; continue; }
      if (type === 'zip' && CCF.ccfImport && await CCF.ccfImport.isRoomZip(p)) { roomZips.push(p); continue; }   // ココフォリア本家のルームZIP（__data.json入り）は逆輸入して部屋にする
      if (type === 'zip' || (type === 'pdf' && !target)) scnItems.push({ p, type }); else assets.push({ p, type });
    }
    for (const rz of roomZips) {   // ルームZIPの逆輸入（シナリオカードの上へ落としたら、そのシナリオへ取り込む）
      try { if (target && String(target.id) !== String(S.key)) await CCF.activateProject(String(target.id)); await CCF.ccfImport.importRoomZip(rz); }
      catch (e) { console.error('[ccf] ルームZIPの取り込みに失敗', e); say('❌ ルームZIPを取り込めませんでした：' + path.basename(rz) + '（' + (e.message || e) + '）'); }
    }
    if (roomZips.length && !scnItems.length && !assets.length) return { touched: [], pdfOpened: false, roomImported: true };
    const multi = scnItems.length > 1, results = [], touched = new Map(); let pdfToOpen = null;
    if (multi) toast('📥 ' + scnItems.length + '件を登録しています…');
    if (typeof window.beginSuppressDetailEdited === 'function') window.beginSuppressDetailEdited();
    try {
      for (const it of scnItems) {
        let r; try { r = await processScenarioItem(it, { bulk: multi, deferSave: multi }); } catch (e) { console.error('[ccf] 解析に失敗', e); say('❌ 解析に失敗しました：' + path.basename(it.p) + '（' + (e.message || e) + '）'); skipped++; continue; }
        if (!r || r.skipped) { skipped++; continue; }
        results.push(r); touched.set(r.sc.id, r);
        if (it.type === 'pdf' && !pdfToOpen) pdfToOpen = { sc: r.sc, path: it.p };
        else if (it.dir && !pdfToOpen && r.pdfPath) pdfToOpen = { sc: r.sc, path: r.pdfPath };
      }
      for (const a of assets) {   // BGM・画像・（対象シナリオのある）PDF → ドロップ先のシナリオへ登録
        const name = path.basename(a.p);
        if (!target) { say('BGM・画像は、シナリオを選んでから（またはシナリオカードの上へ）ドロップしてください'); skipped++; continue; }
        let t = touched.get(target.id); if (!t) { t = { sc: target, created: false, merged: false, counts: { pdf: 0, audio: 0, zip: 0, image: 0 } }; touched.set(target.id, t); }
        let mtime = 0; try { mtime = fs.statSync(a.p).mtimeMs || 0; } catch (_) { }
        if (window.AppHistory) window.AppHistory.checkpoint('ドロップで素材を追加');
        if (a.type === 'pdf' || a.type === 'doc' || isDocAssetName(name)) {
          upsertScenarioDocs(target, [{ name, path: a.p, mtime }]);
          t.counts.pdf++;
          if (!pdfToOpen) pdfToOpen = { sc: target, path: a.p };
        } else {
          const cat = M.inferSmartCategory(name, path.basename(path.dirname(a.p)));
          CCF.withProject(String(target.id), proj => M.addRefs(proj, [{ type: a.type, name: stripAssetExt(name), origName: name, path: a.p, category: cat, mtime }])); t.counts[a.type]++;
        }
      }

      if (!touched.size) { if (skipped) say('登録できるファイルがありませんでした（PDF・BGM・ZIP・画像・フォルダに対応）'); return { touched: [], pdfOpened: false }; }
      if (typeof window.primeScenarioSigs === 'function' && scnItems.length) {
        window.primeScenarioSigs(results.map(r => r.sc.id));
      }
      if (multi) {
        saveState(false, { skipDetailEdited: true });
        try { populateScenarioDBSelect(); renderDBView(true); } catch (e) { console.warn('[ccf] 一覧の更新に失敗', e); }
      }
    } finally {
      if (typeof window.endSuppressDetailEdited === 'function') window.endSuppressDetailEdited();
    }
    const all = [...touched.values()];
    const refreshUi = () => { if (CCF.S.ready) CCF.buildProjectSelect(); if (CCF.library && S.ready) CCF.library.render(); if (typeof renderDBView === 'function') renderDBView(true); };

    if (multi) {   // 複数：編集画面へは遷移せず、完了通知のみ
      const created = results.filter(r => r.created).length, merged = results.filter(r => r.merged).length;
      toast('✅ ' + created + '件のシナリオを追加しました' + (merged ? '（既存 ' + merged + '件に素材を追加）' : '') + (skipped ? '（スキップ ' + skipped + '件）' : ''));
      refreshUi(); return { touched: all, pdfOpened: false };
    }
    const parts = all.map(t => {
      const c = [t.counts.pdf && 'PDF ' + t.counts.pdf, t.counts.audio && 'BGM ' + t.counts.audio, t.counts.zip && 'ZIP ' + t.counts.zip, t.counts.image && '画像 ' + t.counts.image].filter(Boolean).join('・');
      return (t.created ? '🆕 ' : t.merged ? '🔗 ' : '') + '「' + (t.sc.title || '無題') + '」' + (c ? '：' + c : '') + (t.trailerSet ? '（トレーラー画像を自動設定）' : t.coverSet ? '（PDF表紙をトレーラー画像に設定）' : '') + (t.specSet && t.specSet.length ? '（自動抽出：' + t.specSet.join('・') + '）' : '') + (t.truncated ? '（多すぎるため先頭' + LIMIT + '件まで）' : '');
    });
    say('📥 登録しました　' + parts.join(' ／ '));

    const one = scnItems.length === 1 ? results[0] : null;
    if (one && !(o.ctx === 'ccf' && scnItems[0].type === 'pdf')) {   // 単一：推測データを初期入力した「Discord投稿・編集」画面へ
      refreshUi(); activateScenario(one.sc.id);
      return { touched: all, pdfOpened: false, navigated: true };
    }
    const last = all[all.length - 1].sc;
    if (pdfToOpen) { await CCF.activateProject(String(pdfToOpen.sc.id)); await CCF.openPdfPath(pdfToOpen.path); }   // PDF は即時にビューアへ
    else if (o.ctx === 'ccf') await CCF.activateProject(String(last.id));
    else refreshUi();
    if (CCF.library && S.ready) CCF.library.render();
    return { touched: all, pdfOpened: !!pdfToOpen };
  }

  const pathsOf = dt => [...(dt && dt.files || [])].map(f => filePathOf(f)).filter(Boolean);
  const ASSET_SUBDIR_RE = /^(img|imgs|image|images|立ち絵|背景|素材|bgm|se|sound|sounds|audio|voice|map|maps|部屋|doc|docs|資料|pdf|handout|ho|npc|cutin|カットイン|おまけ|特典)$/i;

  async function browserFileToDataUrl(f) {
    if (typeof compressImage === 'function') { try { const u = await compressImage(f, 1000, 1000, 0.82); if (u) return u; } catch (_) {} }
    if (typeof imageFileToDataUrl === 'function') { try { const u = await imageFileToDataUrl(f); if (u) return u; } catch (_) {} }
    return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.onerror = () => res(''); fr.readAsDataURL(f); });
  }

  async function processBrowserScenarioGroup(baseName, fileEntries, kind, opts) {
    const bulk = !!(opts && opts.bulk);
    const deferSave = !!(opts && (opts.deferSave || opts.bulk));
    const parsedTitle = extractTitleAndSystem(baseName, '');
    const detectedMeta = {
      system: (opts && opts.inheritedSystem) || parsedTitle.system || '',
      playerCount: (opts && opts.inheritedPlayerCount) || '',
      lostRate: (opts && opts.inheritedLostRate) || '',
      tags: Array.isArray(opts && opts.inheritedTags) ? opts.inheritedTags.slice() : []
    };
    const inheritedSystem = detectedMeta.system;
    let title = parsedTitle.title || baseName;
    const refs = [], scImages = [];
    let trailerCand = null, mainPdfRef = '', analysis = null, zipFile = null;

    if (kind === 'zip' && fileEntries[0] && fileEntries[0].file) {
      zipFile = fileEntries[0].file;
      let z;
      try { z = await CCF.zip.open(zipFile); }
      catch (e) { say('⚠️ ZIPを開けませんでした：' + zipFile.name + '（' + (e.message || e) + '）'); return { skipped: true }; }
      const zipRef = await WebBridge.saveAssetFile(zipFile);
      const isRoom = CCF.zip.isRoomZip ? CCF.zip.isRoomZip(z) : false;
      refs.push({ type: 'zip', name: zipFile.name, path: zipRef, category: isRoom ? 'ココフォリア部屋ZIP' : baseName, mtime: zipFile.lastModified || 0 });
      if (!isRoom && CCF.zip.inspectDeep) {
        try {
          const zInfo = await CCF.zip.inspectDeep(zipFile, { maxDepth: 2, toDataUrl: true, fallbackFirstImage: false });
          if (zInfo.trailerDataUrl) trailerCand = { name: zInfo.trailerName || 'trailer.png', dataUrl: zInfo.trailerDataUrl };
        } catch (_) {}
      }
      if (!trailerCand && !isRoom) {
        const c = pickTrailer(z.entries.filter(e => !e.dir && CCF.zip.isImageName(e.name)).map(e => ({ name: e.name, relPath: e.name })));
        if (c) trailerCand = { name: c.name, zipUrl: CCF.zip.url(z.id, c.name) };
      }
      const pdfEnt = (!bulk && !isRoom) ? z.entries.find(e => !e.dir && /\.pdf$/i.test(e.name)) : null;
      if (pdfEnt && CCF.pdfText && CCF.pdfText.analyzePdfs) {
        try {
          const r = await CCF.zip.readBuffer(CCF.zip.url(z.id, pdfEnt.name));
          const pdfName = pdfEnt.name.split('/').pop();
          const pdfRef = await WebBridge.saveAssetBytes(r.buf, pdfName, 'application/pdf');
          refs.push({ type: 'pdf', name: pdfName, path: pdfRef, category: '資料' });
          mainPdfRef = pdfRef;
          say('📖 ZIP内のPDFを解析しています…（' + pdfName + '）');
          analysis = await CCF.pdfText.analyzePdfs(pdfRef, [], { cover: !trailerCand });
          const safePdfTitle = (analysis && analysis.title && !(CCF.scan && CCF.scan.isBoilerTitle && CCF.scan.isBoilerTitle(analysis.title))) ? analysis.title : '';
        title = chooseTitle(baseName, safePdfTitle, GENERIC_NAME.test(baseName) || !cleanseTitle(baseName), '', { preferFolder: true }) || title;
        } catch (_) {}
      }
    } else if (kind === 'pdf' && fileEntries[0] && fileEntries[0].file) {
      const f = fileEntries[0].file;
      const ref = await WebBridge.saveAssetFile(f);
      mainPdfRef = ref;
      refs.push({ type: 'pdf', name: f.name, path: ref, category: '資料', mtime: f.lastModified || 0 });
      if (!bulk && /\.(?:pdf|txt|md|markdown|html?)$/i.test(f.name) && CCF.pdfText && CCF.pdfText.analyzePdfs) {
        say('📖 資料を解析しています…（' + f.name + '）');
        analysis = await CCF.pdfText.analyzePdfs(ref, [], { cover: /\.pdf$/i.test(f.name) });
      }
      const stem = f.name.replace(/\.[^.]+$/, '');
      title = chooseTitle(stem, analysis && analysis.title, GENERIC_NAME.test(stem) || !cleanseTitle(stem) || RE_ROLE_NAME.test(stem)) || title;
    } else {
      const pdfItems = [], zipFiles = [], trailerPool = [];
      for (const ent of fileEntries) {
        const f = ent.file; if (!f) continue;
        const tp = typeOf(f.name); if (!tp) continue;
        const parts = String(ent.rel || f.name).split('/').filter(Boolean);
        const dirParts = parts.slice(0, -1);
        const baseIdx = dirParts.lastIndexOf(baseName);
        const relDirs = baseIdx >= 0 ? dirParts.slice(baseIdx + 1) : dirParts;
        const relPath = [...relDirs, f.name].join('/');
        const subCat = parts.length >= 2 ? parts[parts.length - 2] : '';
        const cat = isDocAssetName(f.name)
          ? '資料'
          : (M && typeof M.inferSmartCategoryFromFolders === 'function'
            ? M.inferSmartCategoryFromFolders(f.name, relDirs, baseName)
            : M.inferSmartCategory(f.name, subCat === baseName ? '' : subCat));
        if (tp === 'image') {
          const du = await browserFileToDataUrl(f);
          if (du) {
            const stored = typeof urlToRef === 'function' ? urlToRef(du) : du;
            scImages.push({ name: stripAssetExt(f.name), origName: f.name, dataUrl: stored, category: cat, mtime: f.lastModified || 0 });
            trailerPool.push({ name: f.name, relPath, category: cat, dataUrl: du });
          }
        } else {
          const ref = await WebBridge.saveAssetFile(f);
          const refObj = { type: tp, name: stripAssetExt(f.name), origName: f.name, path: ref, category: cat, mtime: f.lastModified || 0 };
          refs.push(refObj);
          if (tp === 'pdf') pdfItems.push({ name: f.name, path: ref, size: f.size || 0 });
          if (tp === 'zip') zipFiles.push({ file: f, ref: refObj });
        }
      }
      if (!refs.length && !scImages.length) return { skipped: true };
      trailerCand = pickTrailer(trailerPool);
      if (zipFiles.length) {
        const zInfo = await inspectZipsForScenario(zipFiles.map(z => ({ path: z.file, ref: z.ref })), { needTrailer: !trailerCand, fallbackFirstImage: false });
        if (!trailerCand && zInfo.trailerDataUrl) {
          trailerCand = { name: zInfo.trailerName || 'trailer.png', dataUrl: zInfo.trailerDataUrl };
        }
      }
      if (!bulk && pdfItems.length && CCF.pdfText && CCF.pdfText.analyzePdfs) {
        const pick = CCF.scan.pickMainPdf(pdfItems, baseName);
        mainPdfRef = pick.main.path;
        say('📖 PDFを解析しています…（' + pick.main.name + '）');
        analysis = await CCF.pdfText.analyzePdfs(mainPdfRef, pick.subs.map(s => s.path), { cover: !trailerCand });
        const safePdfTitle = (analysis && analysis.title && !(CCF.scan && CCF.scan.isBoilerTitle && CCF.scan.isBoilerTitle(analysis.title))) ? analysis.title : '';
        title = chooseTitle(baseName, safePdfTitle, GENERIC_NAME.test(baseName) || !cleanseTitle(baseName), '', { preferFolder: true }) || title;
      } else if (pdfItems.length) {
        mainPdfRef = pdfItems[0].path;
      }
    }

    title = String(title).trim() || baseName;
    const list = CCF.scenarioList(), ex = findExisting(list, [title, baseName]);
    let sc, created = false, merged = false;
    if (ex) {
      const ok = await appConfirm('既存シナリオ『' + (ex.title || '無題') + '』に素材を追加・紐づけしますか？', { okText: '追加・紐づけする', cancelText: 'キャンセル' });
      if (!ok) return { skipped: true, declined: true };
      sc = ex; merged = true;
    } else {
      const r = findOrCreateScenario(title, {
        deferSave,
        inheritedSystem,
        inheritedPlayerCount: detectedMeta.playerCount,
        inheritedLostRate: detectedMeta.lostRate,
        inheritedTags: detectedMeta.tags
      });
      sc = r.sc; created = r.created;
    }
    const sysChanged = applyInheritedMeta(sc, detectedMeta);

    const docRefs = refs.filter(r => r && (r.type === 'pdf' || r.type === 'doc' || isDocAssetName(r.name)));
    const assetRefs = refs.filter(r => r && !(r.type === 'pdf' || r.type === 'doc' || isDocAssetName(r.name)));
    if (docRefs.length) upsertScenarioDocs(sc, docRefs);
    if (assetRefs.length) CCF.withProject(String(sc.id), proj => M.addRefs(proj, assetRefs));
    if (scImages.length) {
      sc.images = sc.images || [];
      sc.imageCategories = sc.imageCategories || [...DEFAULT_SCENARIO_CATS];
      const byName = new Map();
      sc.images.forEach(x => {
        if (!x) return;
        const k = String(x.origName || x.name || '').normalize('NFKC').trim().toLowerCase();
        if (k && !byName.has(k)) byName.set(k, x);
      });
      scImages.forEach(im => {
        if (isDocAssetName(im.name)) return;
        const k = String(im.name || '').normalize('NFKC').trim().toLowerCase();
        const prev = k ? byName.get(k) : null;
        if (prev) {
          if (!prev.category && im.category) prev.category = im.category;
          return;
        }
        if (im.category && !sc.imageCategories.includes(im.category)) sc.imageCategories.push(im.category);
        const obj = { id: (typeof galId === 'function' ? galId() : M.newId()), name: stripAssetExt(im.name), origName: im.origName || im.name, dataUrl: im.dataUrl, category: im.category || '', mtime: im.mtime || 0, addedAt: Date.now() };
        if (k) byName.set(k, obj);
        sc.images.push(obj);
      });
    }
    let trailerSet = false, coverSet = false, specSet = [];
    if (trailerCand && !sc.imageUrl) {
      const u = trailerCand.dataUrl || (trailerCand.zipUrl ? await CCF.zip.toDataUrl(trailerCand.zipUrl) : '');
      if (u) { setTrailerImage(sc, u, trailerCand.name); trailerSet = true; }
    }
    if (analysis) {
      specSet = applySpec(sc, analysis.spec);
      if (analysis.coverUrl && !trailerSet && !sc.imageUrl) { setTrailerImage(sc, analysis.coverUrl); coverSet = true; }
    }
    if (!deferSave && (trailerSet || coverSet || specSet.length || merged || scImages.length || sysChanged || docRefs.length)) {
      saveState(false, { skipDetailEdited: true }); try { renderDBView(true); if (typeof renderGalleryAll === 'function') renderGalleryAll(); } catch (_) {}
    }
    const counts = { pdf: 0, audio: 0, zip: 0, image: scImages.length };
    refs.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
    return { sc, created, merged, counts, truncated: false, trailerSet, coverSet, specSet, pdfPath: mainPdfRef || (docRefs[0] && docRefs[0].path) || '' };
  }

  /** ブラウザ側相対パス群から中間分類フォルダ（監視ルートまたは分類名フォルダ）のみを再帰展開してシナリオグループを抽出する（最大深さ5階層） */
  function collectBrowserScenarioGroups(rootFolder, ents, scnGroups, opts) {
    const isWatchRoot = !!(opts && opts.isWatchRoot);
    const makeNode = name => ({ name, dirs: new Map(), files: [] });
    const root = makeNode(rootFolder);
    for (const ent of ents) {
      const parts = String(ent.rel || ent.name || '').split('/').filter(Boolean);
      const relParts = parts[0] === rootFolder ? parts.slice(1) : parts;
      if (!relParts.length) continue;
      let cur = root;
      for (let i = 0; i < relParts.length - 1; i++) {
        const d = relParts[i];
        if (!d || d.startsWith('.') || d === '__MACOSX' || d === 'node_modules' || isOldVersionName(d)) { cur = null; break; }
        if (!cur.dirs.has(d)) cur.dirs.set(d, makeNode(d));
        cur = cur.dirs.get(d);
      }
      const fname = relParts[relParts.length - 1];
      if (cur && ent.file && !isOldVersionName(fname)) cur.files.push({ ent, name: fname });
    }
    const flattenFiles = node => {
      const siblingRaw = [];
      node.dirs.forEach((sub, dn) => { siblingRaw.push({ name: dn, isDir: true, sub, mtime: 0 }); });
      node.files.forEach(x => { siblingRaw.push({ name: x.name, isDir: false, ent: x.ent, mtime: Number((x.ent && x.ent.file && x.ent.file.lastModified) || 0) }); });
      const kept = filterLatestVersionEntries(siblingRaw);
      const acc = [];
      kept.forEach(k => {
        if (k.isDir) acc.push(...flattenFiles(k.sub));
        else acc.push(k.ent);
      });
      return acc;
    };
    const nodeHasScenarioFiles = (subNode, d = 0) => {
      if (!subNode || d > 2) return false;
      if (subNode.files.some(x => CHILD_SCENARIO_FILE_RE.test(x.name))) return true;
      for (const ch of subNode.dirs.values()) {
        if (nodeHasScenarioFiles(ch, d + 1)) return true;
      }
      return false;
    };
    (function walk(node, inheritedMeta, depth) {
      const siblingRaw = [];
      node.dirs.forEach((sub, dn) => { siblingRaw.push({ name: dn, isDir: true, mtime: 0 }); });
      node.files.forEach(x => { siblingRaw.push({ name: x.name, isDir: false, ent: x.ent, mtime: Number((x.ent && x.ent.file && x.ent.file.lastModified) || 0) }); });
      const keptSiblings = filterLatestVersionEntries(siblingRaw);
      const dirNames = keptSiblings.filter(x => x.isDir).map(x => x.name).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
      const keptFiles = keptSiblings.filter(x => !x.isDir);
      const fileNames = keptFiles.map(x => x.name);
      const isCatDir = isCategoryFolderName(node.name);
      const atWatchRoot = isWatchRoot && depth === 0;
      if (depth >= 5) {
        const all = flattenFiles(node);
        if (!isCatDir && !atWatchRoot && all.length) {
          scnGroups.push({
            baseName: node.name, entries: all, kind: 'dir',
            inheritedSystem: inheritedMeta.system,
            inheritedPlayerCount: inheritedMeta.playerCount,
            inheritedLostRate: inheritedMeta.lostRate || '',
            inheritedTags: inheritedMeta.tags.slice()
          });
        }
        return;
      }
      const kind = classifyContainerEnhanced({
        name: node.name,
        dirNames,
        fileNames,
        isWatchRoot: atWatchRoot,
        childHasScenarioFn: dn => nodeHasScenarioFiles(node.dirs.get(dn), 0)
      });
      if (kind === 'empty') return;
      if (kind === 'scenario' && !isCatDir && !atWatchRoot) {
        const all = flattenFiles(node);
        if (all.length) {
          scnGroups.push({
            baseName: node.name, entries: all, kind: 'dir',
            inheritedSystem: inheritedMeta.system,
            inheritedPlayerCount: inheritedMeta.playerCount,
            inheritedLostRate: inheritedMeta.lostRate || '',
            inheritedTags: inheritedMeta.tags.slice()
          });
        }
        return;
      }
      const nextMeta = atWatchRoot ? inheritedMeta : mergeInheritedMeta(inheritedMeta, node.name);
      dirNames.forEach(dn => {
        if (isPureGenericAssetDir(dn)) return;
        walk(node.dirs.get(dn), nextMeta, depth + 1);
      });
      keptFiles.forEach(({ ent, name }) => {
        if (/\.zip$/i.test(name)) {
          scnGroups.push({
            baseName: name.replace(/\.zip$/i, ''), entries: [ent], kind: 'zip',
            inheritedSystem: nextMeta.system,
            inheritedPlayerCount: nextMeta.playerCount,
            inheritedLostRate: nextMeta.lostRate || '',
            inheritedTags: nextMeta.tags.slice()
          });
        } else if (/\.(?:pdf|txt|html?|md|docx?)$/i.test(name) && !/^read\s*me\./i.test(name)) {
          scnGroups.push({
            baseName: name.replace(/\.[^.]+$/, ''), entries: [ent], kind: 'pdf',
            inheritedSystem: nextMeta.system,
            inheritedPlayerCount: nextMeta.playerCount,
            inheritedLostRate: nextMeta.lostRate || '',
            inheritedTags: nextMeta.tags.slice()
          });
        }
      });
    })(root, { system: '', playerCount: '', lostRate: '', tags: [] }, 0);
  }

  async function handleBrowserEntries(rawEntries, o) {
    o = o || {};
    if (!window.WebBridge) return { touched: [], pdfOpened: false };
    const currentSc = () => (o.scenarioId ? CCF.scenarioList().find(s => String(s.id) === String(o.scenarioId)) : (o.ctx === 'ccf' && S.key !== '_default' ? CCF.scenarioList().find(s => String(s.id) === S.key) : null)) || null;
    const target = currentSc(), scnGroups = [], assets = [], roomZips = [];
    let skipped = 0;

    // フォルダグループ化（ドロップされたルートフォルダごとにまとめる）
    const dirMap = new Map(), loose = [];
    for (const ent of (rawEntries || [])) {
      if (!ent || !ent.file) continue;
      if (ent.fromDir && ent.rootFolder) {
        if (!dirMap.has(ent.rootFolder)) dirMap.set(ent.rootFolder, []);
        dirMap.get(ent.rootFolder).push(ent);
      } else {
        loose.push(ent);
      }
    }
    for (const [rootFolder, ents] of dirMap) {
      collectBrowserScenarioGroups(rootFolder, ents, scnGroups, { isWatchRoot: !!(o && o.isWatchRoot) });
    }
    for (const ent of loose) {
      const f = ent.file, tp = typeOf(f.name);
      if (!tp) { skipped++; continue; }
      if (tp === 'zip' && CCF.ccfImport && await CCF.ccfImport.isRoomZip(f)) { roomZips.push(f); continue; }
      if (tp === 'zip') scnGroups.push({ baseName: f.name.replace(/\.zip$/i, ''), entries: [ent], kind: 'zip', inheritedSystem: '' });
      else if (tp === 'pdf' && !target) scnGroups.push({ baseName: f.name.replace(/\.[^.]+$/, ''), entries: [ent], kind: 'pdf', inheritedSystem: '' });
      else assets.push({ file: f, type: tp });
    }

    for (const rz of roomZips) {
      try { if (target && String(target.id) !== String(S.key)) await CCF.activateProject(String(target.id)); await CCF.ccfImport.importRoomZip(rz); }
      catch (e) { console.error('[ccf] ルームZIPの取り込みに失敗', e); say('❌ ルームZIPを取り込めませんでした：' + rz.name + '（' + (e.message || e) + '）'); }
    }
    if (roomZips.length && !scnGroups.length && !assets.length) return { touched: [], pdfOpened: false, roomImported: true };

    const multi = scnGroups.length > 1, results = [], touched = new Map(); let pdfToOpen = null;
    if (multi) toast('📥 ' + scnGroups.length + '件を登録しています…');
    if (typeof window.beginSuppressDetailEdited === 'function') window.beginSuppressDetailEdited();
    try {
      for (const g of scnGroups) {
        let r; try { r = await processBrowserScenarioGroup(g.baseName, g.entries, g.kind, { bulk: multi, deferSave: multi, inheritedSystem: g.inheritedSystem || '', inheritedPlayerCount: g.inheritedPlayerCount || '', inheritedLostRate: g.inheritedLostRate || '', inheritedTags: g.inheritedTags || [] }); }
        catch (e) { console.error('[ccf] 解析に失敗', e); say('❌ 解析に失敗しました：' + g.baseName + '（' + (e.message || e) + '）'); skipped++; continue; }
        if (!r || r.skipped) { skipped++; continue; }
        results.push(r); touched.set(r.sc.id, r);
        if (!pdfToOpen && r.pdfPath) pdfToOpen = { sc: r.sc, path: r.pdfPath };
      }
      for (const a of assets) {
        const f = a.file;
        if (!target) { say('BGM・画像は、シナリオを選んでから（またはシナリオカードの上へ）ドロップしてください'); skipped++; continue; }
        let t = touched.get(target.id); if (!t) { t = { sc: target, created: false, merged: false, counts: { pdf: 0, audio: 0, zip: 0, image: 0 } }; touched.set(target.id, t); }
        const cat = M.inferSmartCategory(f.name, '');
        if (window.AppHistory) window.AppHistory.checkpoint('ドロップで素材を追加');
        if (a.type === 'image') {
          const du = await browserFileToDataUrl(f);
          if (du) {
            target.images = target.images || [];
            target.imageCategories = target.imageCategories || [...DEFAULT_SCENARIO_CATS];
            if (cat && !target.imageCategories.includes(cat)) target.imageCategories.push(cat);
            target.images.push({ id: (typeof galId === 'function' ? galId() : M.newId()), name: stripAssetExt(f.name), origName: f.name, dataUrl: typeof urlToRef === 'function' ? urlToRef(du) : du, category: cat, mtime: f.lastModified || 0, addedAt: Date.now() });
            saveState(false, { skipDetailEdited: true }); t.counts.image++;
          }
        } else if (a.type === 'pdf' || a.type === 'doc' || isDocAssetName(f.name)) {
          const ref = await WebBridge.saveAssetFile(f);
          upsertScenarioDocs(target, [{ name: f.name, path: ref, mtime: f.lastModified || 0 }]);
          saveState(false, { skipDetailEdited: true }); t.counts.pdf++;
          if (!pdfToOpen) pdfToOpen = { sc: target, path: ref };
        } else {
          const ref = await WebBridge.saveAssetFile(f);
          CCF.withProject(String(target.id), proj => M.addRefs(proj, [{ type: a.type, name: stripAssetExt(f.name), origName: f.name, path: ref, category: cat, mtime: f.lastModified || 0 }]));
          t.counts[a.type]++;
        }
      }

      if (!touched.size) { if (skipped) say('登録できるファイルがありませんでした（PDF・BGM・ZIP・画像・フォルダに対応）'); return { touched: [], pdfOpened: false }; }
      if (typeof window.primeScenarioSigs === 'function' && scnGroups.length) {
        window.primeScenarioSigs(results.map(r => r.sc.id));
      }
      if (multi) {
        saveState(false, { skipDetailEdited: true });
        try { populateScenarioDBSelect(); renderDBView(true); if (typeof renderGalleryAll === 'function') renderGalleryAll(); } catch (_) {}
      }
    } finally {
      if (typeof window.endSuppressDetailEdited === 'function') window.endSuppressDetailEdited();
    }
    const all = [...touched.values()];
    const refreshUi = () => { if (CCF.S.ready) CCF.buildProjectSelect(); if (CCF.library && S.ready) CCF.library.render(); if (typeof renderDBView === 'function') renderDBView(true); if (typeof renderGalleryAll === 'function') renderGalleryAll(); };

    if (multi) {
      const created = results.filter(r => r.created).length, merged = results.filter(r => r.merged).length;
      toast('✅ ' + created + '件のシナリオを追加しました' + (merged ? '（既存 ' + merged + '件に素材を追加）' : '') + (skipped ? '（スキップ ' + skipped + '件）' : ''));
      refreshUi(); return { touched: all, pdfOpened: false };
    }
    const parts = all.map(t => {
      const c = [t.counts.pdf && 'PDF ' + t.counts.pdf, t.counts.audio && 'BGM ' + t.counts.audio, t.counts.zip && 'ZIP ' + t.counts.zip, t.counts.image && '画像 ' + t.counts.image].filter(Boolean).join('・');
      return (t.created ? '🆕 ' : t.merged ? '🔗 ' : '') + '「' + (t.sc.title || '無題') + '」' + (c ? '：' + c : '') + (t.trailerSet ? '（トレーラー画像を自動設定）' : t.coverSet ? '（PDF表紙をトレーラー画像に設定）' : '') + (t.specSet && t.specSet.length ? '（自動抽出：' + t.specSet.join('・') + '）' : '');
    });
    say('📥 登録しました　' + parts.join(' ／ '));

    const one = scnGroups.length === 1 ? results[0] : null;
    if (one && !(o.ctx === 'ccf' && scnGroups[0].kind === 'pdf')) {
      refreshUi(); activateScenario(one.sc.id);
      return { touched: all, pdfOpened: false, navigated: true };
    }
    const last = all[all.length - 1].sc;
    if (pdfToOpen) { await CCF.activateProject(String(pdfToOpen.sc.id)); await CCF.openPdfPath(pdfToOpen.path); }
    else if (o.ctx === 'ccf') await CCF.activateProject(String(last.id));
    else refreshUi();
    if (CCF.library && S.ready) CCF.library.render();
    return { touched: all, pdfOpened: !!pdfToOpen };
  }

  async function handleBrowserDrop(dt, o) {
    if (!window.WebBridge) return { touched: [], pdfOpened: false };
    const entries = await WebBridge.readDroppedEntries(dt);
    if (!entries.length) return { touched: [], pdfOpened: false };
    return handleBrowserEntries(entries, o);
  }

  async function handleBrowserFiles(files, o) {
    const entries = [...(files || [])].map(f => {
      const rel = f.webkitRelativePath || f.name;
      const parts = rel.split('/').filter(Boolean);
      return { file: f, name: f.name, rel, fromDir: parts.length > 1, rootFolder: parts.length > 1 ? parts[0] : '' };
    });
    return handleBrowserEntries(entries, o);
  }

  function wireZone(zone, ctx) {
    if (!zone || zone.dataset.ccfDnd) return; zone.dataset.ccfDnd = '1';
    const hasFiles = e => [...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files');
    const skip = e => e.target.closest && e.target.closest('[data-gdrop],[data-docdrop],.ccf-icon-drop');
    zone.addEventListener('dragover', e => { if (!hasFiles(e) || skip(e)) return; e.preventDefault(); zone.classList.add('ccf-dropping'); });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('ccf-dropping'); });
    zone.addEventListener('drop', e => {
      zone.classList.remove('ccf-dropping'); if (!hasFiles(e) || skip(e)) return;
      const card = e.target.closest && e.target.closest('[data-sid]');
      const scenarioId = card ? card.dataset.sid : null;
      if (isElec) {
        const paths = pathsOf(e.dataTransfer); if (!paths.length) return; e.preventDefault();
        handlePaths(paths, { ctx, scenarioId }).catch(err => { console.error('[ccf] D&D 登録に失敗', err); say('❌ 登録に失敗しました：' + (err.message || err)); });
      } else {
        e.preventDefault();
        handleBrowserDrop(e.dataTransfer, { ctx, scenarioId }).catch(err => { console.error('[ccf] Web D&D 登録に失敗', err); say('❌ 登録に失敗しました：' + (err.message || err)); });
      }
    });
  }
  function init() { wireZone(document.getElementById('databaseTab'), 'home'); wireZone(document.getElementById('ccfTab'), 'ccf'); }
  CCF.dnd = { handlePaths, handleBrowserDrop, handleBrowserFiles, handleBrowserEntries, scanFolder, discoverScenarioEntries, findOrCreateScenario, typeOf, guessPdfTitle, pickTrailer, trailerRank, isNpcPortraitCandidate, extractTitleAndSystem, cleanseTitle, normalizeForMatch, findExisting, inspectZipsForScenario, setTrailerImage, isCategoryFolderName, isAssetSubdirName, isPureGenericAssetDir, inferFolderMeta, mergeInheritedMeta, classifyContainerEnhanced, applyInheritedMeta, upsertScenarioDocs, isDocAssetName, stripAssetExt, isOldVersionName, filterLatestVersionEntries, parseVersionMeta };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
