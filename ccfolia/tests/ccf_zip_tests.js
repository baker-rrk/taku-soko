// Phase 2-B の純粋ロジック（ココフォリア v1.1.0 ZIP・逆輸入の補助・シナリオ資料の再出力）のテスト。  使い方: node ccfolia/tests/ccf_zip_tests.js
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const P = require('../ccf_pkg.js'), D = require('../ccf_doc_export.js'), M = require('../ccf_model.js'), { writeZip } = require('../main/zip_writer.js'), zipStore = require('../main/zip_store.js');
let ng = 0, ok = 0;
const t = (c, m, extra) => { if (c) ok++; else { ng++; console.log('NG  ' + m + (extra !== undefined ? '\n    → ' + JSON.stringify(extra) : '')); } };
const eq = (a, b, m) => t(JSON.stringify(a) === JSON.stringify(b), m, a);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('fake-png-body-1')]), PNG2 = Buffer.concat([PNG.subarray(0, 8), Buffer.from('fake-png-body-2')]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(300, 7)]);
const sha = b => require('crypto').createHash('sha256').update(b).digest('hex');
const streamToBuf = s => new Promise((res, rej) => { const c = []; s.on('data', d => c.push(d)); s.on('end', () => res(Buffer.concat(c))); s.on('error', rej); });

(async () => {
  // ===== 型の変換 =====
  eq([P.toInt('12'), P.toInt('abc'), P.toInt(NaN), P.toInt(undefined), P.toInt('１２'), P.toInt(3.6), P.toInt('')], [12, 0, 0, 0, 12, 4, 0], 'status 用の整数化（不正値は0）');
  eq([P.toStr(5), P.toStr(null), P.toStr('+1D4'), P.toStr(NaN)], ['5', '', '+1D4', ''], 'params 用の文字列化');
  t(P.sha256Hex(Buffer.from('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 は64桁16進小文字');
  eq(P.extOfMime('image/jpeg'), 'jpeg', 'EXT_BY_MIME: image/jpeg は jpeg');

  // ===== パッケージ組み立て =====
  const npc = M.sanitizeNpc({ name: '深きもの', memo: 'めも', initiative: '11', status: [{ label: 'HP', value: '14', max: 'x' }, { label: 'MP', value: 10.4, max: 10 }], params: [{ label: 'STR', value: 15 }, { label: 'DB', value: '+1D4' }],
    commands: 'CCB<=50 【隠れる】', images: [{ dataUrl: 'data:image/png;base64,' + PNG.toString('base64'), label: '通常' }, { dataUrl: 'data:image/png;base64,' + PNG2.toString('base64'), label: '怒り' }], sysOpts: { statusPublic: false } });
  const resolve = async src => { if (src.dataUrl) return P.parseDataUrl(src.dataUrl); if (src.path === '/bgm/a.mp3') return { buf: MP3, mime: 'audio/mpeg', name: 'a.mp3' }; return null; };
  const scenes = [M.sanitizeScene({ title: 'S1', text: '本文', bg: { dataUrl: 'data:image/png;base64,' + PNG.toString('base64'), name: 'bg' }, bgm: { name: 'a', path: '/bgm/a.mp3', volume: 40 } }), M.sanitizeScene({ title: 'S2', bgm: { name: 'ない曲', path: '/none.mp3' } })];
  const res = await P.buildPackage({ room: { name: 'R', bg: null, fg: null, bgm: scenes[0].bgm }, npcs: [npc], pieces: [{ name: 'ダミー', commands: 'a\r\nb', invisible: true, color: '#d4a017' }], scenes, items: [{ kind: 'screen', name: 'ob', x: 48, y: 24, width: 96, height: 48, zIndex: 30, dataUrl: 'data:image/png;base64,' + PNG2.toString('base64') }] }, resolve, { now: 1700000000000, grid: 24 });
  const d = res.data;
  eq(Object.keys(d), ['meta', 'entities', 'resources'], 'トップレベルは meta / entities / resources');
  eq(d.meta, { version: '1.1.0' }, 'meta.version = 1.1.0');
  eq(Object.keys(d.entities), ['room', 'items', 'decks', 'notes', 'characters', 'effects', 'scenes', 'savedatas', 'snapshots'], 'entities の9キーが揃う');
  eq([d.entities.decks, d.entities.savedatas, d.entities.snapshots], [{}, {}, {}], 'decks / savedatas / snapshots は空オブジェクト');
  const noteVals = Object.values(d.entities.notes);
  t(noteVals.length === 1 && noteVals[0].name === 'BGM一覧' && noteVals[0].order === 0 && noteVals[0].iconUrl === '' && noteVals[0].text.includes('a'), 'BGM設定ありのとき notes に BGM一覧メモ', noteVals);
  const hashes = [...res.files.keys()];
  t(hashes.length === 3 && hashes.every(h => /^[0-9a-f]{64}\.[a-z0-9]+$/.test(h)), '素材は <sha256>.<ext> 名（重複排除で3点）', hashes);
  t(hashes.every(h => sha(res.files.get(h)) === h.replace(/\.[^.]+$/, '')), 'ファイル名先頭 = 中身の SHA-256');
  eq(d.resources[sha(PNG) + '.png'], { type: 'image/png' }, 'resources に実MIME（画像）'); eq(d.resources[sha(MP3) + '.mp3'], { type: 'audio/mpeg' }, 'resources に実MIME（音声）');
  const chs = Object.values(d.entities.characters), c0 = chs[0];
  eq(c0.status, [{ label: 'HP', value: 14, max: 14 }, { label: 'MP', value: 10, max: 10 }], 'status は整数（max不正は value に追随）');
  t(c0.status.every(s => Number.isInteger(s.value) && Number.isInteger(s.max)), 'status は全て整数');
  eq(c0.params, [{ label: 'STR', value: '15' }, { label: 'DB', value: '+1D4' }], 'params.value は文字列');
  eq(c0.faces, [{ iconUrl: sha(PNG) + '.png', label: '通常' }, { iconUrl: sha(PNG2) + '.png', label: '怒り' }], 'images → faces[{iconUrl:<sha256>.<ext>,label}]'); eq(c0.iconUrl, sha(PNG) + '.png', 'iconUrl は先頭の立ち絵のファイル名');
  eq([c0.playerName, c0.externalUrl, c0.x, c0.y, c0.width, c0.height, c0.color, c0.roomId, c0.speaking, c0.active, c0.secret, c0.hideStatus, c0.invisible, JSON.stringify(c0.diceSkin)], ['', '', 0, 0, 4, 4, '#888888', null, false, false, true, true, false, '{}'], 'キャラクターの必須初期値（speaking=false, active=false, diceSkin={}）');
  t(!('owner' in c0) && !('createdAt' in c0) && !('updatedAt' in c0), 'character に独自キー owner/createdAt/updatedAt が無い');
  t(['x', 'y', 'z', 'angle', 'width', 'height', 'initiative'].every(k => typeof c0[k] === 'number'), '数値項目は Number'); eq(c0.initiative, 11, 'initiative');
  t(['active', 'secret', 'invisible', 'hideStatus', 'speaking'].every(k => typeof c0[k] === 'boolean'), '真偽項目は Boolean');
  const c1 = chs[1]; eq([c1.iconUrl, c1.faces, c1.x, c1.y, c1.invisible, c1.color, c1.commands], [null, [], 0, 0, true, '#d4a017', 'a\nb'], 'ダミー駒：画像なしは null／座標 0,0／改行は \\n');
  const sc = Object.values(d.entities.scenes);
  eq([sc[0].name, sc[0].backgroundUrl, sc[0].foregroundUrl, sc[0].fieldObjectFit, sc[0].fieldWidth, sc[0].fieldHeight, sc[0].displayGrid, sc[0].gridSize, sc[0].markers, sc[0].text, sc[0].mediaRef, sc[0].soundRef, sc[0].locked, sc[0].order],
    ['S1', sha(PNG) + '.png', null, 'contain', 40, 30, false, 1, {}, '', null, null, false, 1], 'シーン：本家完全準拠スキーマ（sceneMessage未入力時はtext空欄）');
  eq(sc[1].order, 2, 'シーン order は連番');
  t(['bgmUrl', 'bgmName', 'bgmVolume', 'roomId', 'createdAt', 'updatedAt'].every(k => !(k in sc[0])), 'シーンに独自キーが無い');
  t(res.warnings.length === 1 && /S2/.test(res.warnings[0]), '読めなかった素材は警告', res.warnings);
  const it = Object.values(d.entities.items)[0];
  eq([it.x, it.y, it.z, it.angle, it.width, it.height, it.deckId, it.locked, it.visible, it.closed, it.withoutOwner, it.freezed, it.type, it.active, it.memo, it.imageUrl, it.coverImageUrl, it.clickAction, it.order],
    [-18, -14, 30, 0, 4, 2, null, false, true, false, false, false, 'object', true, '', sha(PNG2) + '.png', null, null, 1], '盤面オブジェクト：本家完全準拠（中央原点変換・type=object・nameのみ時はmemo空）');
  t(['color', 'roomId', 'createdAt', 'updatedAt'].every(k => !(k in it)), 'item に独自キーが無い');
  const rm = d.entities.room;
  eq(Object.keys(rm), ['defaultAnonymousRole', 'backgroundUrl', 'foregroundUrl', 'embedUrl', 'thumbnailUrl', 'mapType', 'fieldWidth', 'fieldHeight', 'fieldObjectFit', 'alignWithGrid', 'messageChannels', 'messageGroups', 'markers', 'mediaRef', 'monitored', 'soundRef', 'sceneId', 'archived', 'backgroundColor', 'variables', 'underConstruction', 'hidden3dDice', 'initialSavedata', 'displayGrid', 'gridSize', 'enableCrossfade', 'crossfadeDuration', 'allowDuplicate'], 'room の全キーが本家と一致');
  eq([rm.fieldWidth, rm.fieldHeight, rm.fieldObjectFit, rm.backgroundUrl, rm.foregroundUrl, rm.hidden3dDice, rm.markers, rm.gridSize], [40, 30, 'contain', sha(PNG) + '.png', null, true, {}, 1], 'room の各値（40×30マス・先頭シーン背景を初期継承）');
  // 差分選択：駒だけ → シーン・オブジェクト・notes は空、9キー維持＋room初期構造保持
  const only = await P.buildPackage({ npcs: [npc] }, resolve, { roomName: 'X' });
  const onlyRm = only.data.entities.room;
  eq([Object.keys(only.data.entities).length, Object.keys(only.data.entities.scenes).length, Object.keys(only.data.entities.items).length, Object.keys(only.data.entities.characters).length, Object.keys(only.data.entities.notes).length, onlyRm.fieldWidth, onlyRm.fieldHeight], [9, 0, 0, 1, 0, 40, 30], '駒ZIP：9キー維持・駒のみ・room 40×30保持');

  // ===== JPEG拡張子・シーン markers 辞書オブジェクト・parsePackage 両対応 =====
  const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('fake-jpeg')]);
  const mkRes = await P.buildPackage({
    room: { fg: { dataUrl: 'data:image/jpeg;base64,' + JPEG.toString('base64'), fit: 'fill' } },
    scenes: [{ title: 'M', fgFit: 'fill', markers: [{ name: 'マーカー1', x: 24, y: 48, width: 48, height: 24, zIndex: 5, locked: true, angle: 90, dataUrl: 'data:image/jpeg;base64,' + JPEG.toString('base64') }, { text: '画像なし', x: 0, y: 0, width: 12, height: 12 }] }],
    items: [{ kind: 'screen', name: '画像なしパネル', x: 0, y: 0, width: 48, height: 48, locked: true }, { kind: 'screen', name: '管理名', text: '表示テキスト', x: 24, y: 0, width: 48, height: 48 }]
  }, resolve, { grid: 24 });
  const jpegKey = sha(JPEG) + '.jpeg';
  t(mkRes.files.has(jpegKey) && mkRes.data.resources[jpegKey].type === 'image/jpeg', 'JPEG は .jpeg 拡張子で格納', [...mkRes.files.keys()]);
  eq([mkRes.data.entities.room.foregroundUrl, mkRes.data.entities.room.fieldObjectFit], [jpegKey, 'fill'], 'room 前景 JPEG と fill');
  const mSc = Object.values(mkRes.data.entities.scenes)[0];
  t(mSc.markers && !Array.isArray(mSc.markers) && typeof mSc.markers === 'object', 'scene.markers は辞書オブジェクト');
  const mVals = Object.values(mSc.markers);
  eq([mVals.length, mVals[0].x, mVals[0].y, mVals[0].z, mVals[0].width, mVals[0].height, mVals[0].locked, mVals[0].freezed, mVals[0].text, mVals[0].imageUrl, mVals[0].angle, mVals[0].clickAction, mVals[1].text, mVals[1].imageUrl],
    [2, -19, -13, 5, 2, 1, true, false, '', jpegKey, 90, null, '画像なし', ''], 'scene.markers 各フィールドが本家準拠（中央原点変換・nameのみ時はtext空・text明示時のみ出力）');
  const mItems = Object.values(mkRes.data.entities.items), mIt = mItems[0], mIt2 = mItems[1];
  eq([mIt.type, mIt.locked, mIt.imageUrl, mIt.memo, mIt2.memo], ['object', true, '', '', '表示テキスト'], '画像なし item の imageUrl は空文字・nameのみ時はmemo空・text明示時のみ出力');
  const pkObj = P.parsePackage(mkRes.data);
  t(Array.isArray(pkObj.scenes[0].markers) && pkObj.scenes[0].markers.length === 2 && pkObj.scenes[0].markers[0].imageUrl === jpegKey, 'parsePackage: オブジェクト形式 markers を読み取れる');
  const legacyData = JSON.parse(JSON.stringify(mkRes.data));
  legacyData.entities.scenes[Object.keys(legacyData.entities.scenes)[0]].markers = [{ text: '旧配列', x: 1, y: 2 }];
  const pkArr = P.parsePackage(legacyData);
  t(Array.isArray(pkArr.scenes[0].markers) && pkArr.scenes[0].markers.length === 1 && pkArr.scenes[0].markers[0].text === '旧配列', 'parsePackage: 配列形式 markers も読み取れる');

  // ===== 共通盤面継承・onBoard駒座標・シーン切替メッセージ分離 =====
  const inheritRes = await P.buildPackage({
    room: { name: 'R2', bg: { dataUrl: 'data:image/png;base64,' + PNG.toString('base64') }, fg: { dataUrl: 'data:image/jpeg;base64,' + JPEG.toString('base64'), fit: 'fill' } },
    npcs: [Object.assign({}, npc, { onBoard: true, x: 72, y: 48, width: 120, height: 96 })],
    scenes: [M.sanitizeScene({ title: '継承シーン', text: '長文のシナリオ本文', sceneMessage: 'シーン開始！' })]
  }, resolve, { grid: 24 });
  const iChar = Object.values(inheritRes.data.entities.characters)[0];
  eq([iChar.active, iChar.x, iChar.y, iChar.width, iChar.height], [true, -17, -13, 5, 4], 'onBoard=true の駒は active=true かつ中央原点変換した盤面座標・サイズを反映');
  const iSc = Object.values(inheritRes.data.entities.scenes)[0];
  eq([iSc.backgroundUrl, iSc.foregroundUrl, iSc.fieldObjectFit, iSc.text], [sha(PNG) + '.png', jpegKey, 'fill', 'シーン開始！'], '未設定シーンは共通盤面の背景・前景を継承し、textにはsceneMessageのみ出力');
  const iParsed = P.parsePackage(inheritRes.data);
  eq([iParsed.scenes[0].text, iParsed.scenes[0].sceneMessage], ['シーン開始！', 'シーン開始！'], 'parsePackage: sc.text を text と sceneMessage の両方に読み込む');
  const firstSceneFallbackRes = await P.buildPackage({
    room: { name: 'R3', bg: null, fg: null },
    scenes: [M.sanitizeScene({ title: '先頭', fg: { dataUrl: 'data:image/png;base64,' + PNG2.toString('base64'), fitMode: 'fill' } })]
  }, resolve, { grid: 24 });
  eq([firstSceneFallbackRes.data.entities.room.foregroundUrl, firstSceneFallbackRes.data.entities.room.fieldObjectFit], [sha(PNG2) + '.png', 'fill'], '共通前景未設定時は先頭シーン前景をroom初期値に設定');

  // ===== ZIP の書き出し → 読み戻し =====
  const tmp = path.join(os.tmpdir(), 'ccf_zip_test_' + process.pid + '.zip');
  const entries = P.buildZipEntries(res);
  const json = entries.find(e => e.name === '__data.json').data;
  const tok = entries.find(e => e.name === '.token').data;
  t(!(json[0] === 0xEF && json[1] === 0xBB), '__data.json は BOM なし');
  t(tok.length === 66 && tok.toString('utf8') === '0.' + sha(json), '.token は 66 バイト（"0." + __data.json の SHA-256 hex）', tok.toString('utf8'));
  const w = writeZip(tmp, entries); t(w.count === 5 && fs.existsSync(tmp) && !fs.existsSync(tmp + '.tmp'), 'ZIP を書き出し（一時ファイルは残さない）');
  const z = await zipStore.open(tmp);
  eq(z.entries.map(e => e.name).sort(), ['.token', '__data.json', ...hashes].sort(), 'ZIP 直下に __data.json・.token・<sha256>.<ext>');
  const back = await streamToBuf(await zipStore.openStream(z.id, '__data.json')); eq(JSON.parse(back.toString('utf8')), d, '__data.json を読み戻せる');
  const backTok = await streamToBuf(await zipStore.openStream(z.id, '.token')); eq(backTok.toString('utf8'), '0.' + sha(back), '.token と __data.json バイナリの SHA-256 が一致');
  const hb = await streamToBuf(await zipStore.openStream(z.id, sha(MP3) + '.mp3')); t(hb.equals(MP3), '音声の中身が一致（deflate/store 往復）');
  const pk = P.parsePackage(JSON.parse(back.toString('utf8')));
  t(pk.characters.length === 2 && pk.scenes.length === 2 && pk.items.length === 1 && pk.version === '1.1.0', '本家形式の読み解き（逆輸入）');
  eq(P.findZipEntry(sha(PNG) + '.png', z.entries.map(e => e.name)), sha(PNG) + '.png', '拡張子付きハッシュ名のエントリを探せる'); eq(P.findZipEntry('zzz', ['a']), '', '無ければ空');
  eq(P.findZipEntry(sha(PNG), [sha(PNG) + '.png']), sha(PNG) + '.png', '拡張子なし参照でも拡張子付きエントリを探せる');
  eq(P.findZipEntry(sha(PNG) + '.png', [sha(PNG)]), sha(PNG), '拡張子付き参照でも拡張子なしエントリを探せる');
  zipStore.closeAll(); try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
  let bad = false; try { writeZip(tmp, [{ name: '../x', data: Buffer.from('a') }]); } catch (e) { bad = true; } t(bad && !fs.existsSync(tmp + '.tmp'), '不正なファイル名は拒否し一時ファイルを残さない');
  let dup = false; try { writeZip(tmp, [{ name: 'a', data: Buffer.from('a') }, { name: 'A', data: Buffer.from('b') }]); } catch (e) { dup = true; } t(dup, '重複名は拒否');
  let notRoom = false; try { P.parsePackage({ foo: 1 }); } catch (e) { notRoom = true; } t(notRoom, 'ココフォリアのZIPでなければ例外');

  // ===== 名前による再リンク =====
  const files = [{ path: 'C:\\a\\Battle_01.mp3', name: 'Battle_01.mp3' }, { path: 'D:\\lib\\battle 01.ogg', name: 'battle 01.ogg' }, { path: 'C:\\a\\other.mp3', name: 'other.mp3' }, { path: 'c:\\a\\battle_01.mp3', name: 'battle_01.mp3' }];
  eq(P.matchByName(['battle 01'], files).map(f => f.path), ['C:\\a\\Battle_01.mp3', 'D:\\lib\\battle 01.ogg'], '同名（拡張子・空白・大文字小文字・パス重複を無視）を集める');
  eq(P.matchByName(['なし'], files), [], '同名なしは空'); eq(P.matchByName([], files), [], '名前なしは空');

  // ===== シナリオ資料の再出力 =====
  eq(D.stripPageNumbers('本文です。\n\n12\n\n続き。\n- 3 -\nP.4\n5 / 40\n数値 7 です'), '本文です。\n\n\n続き。\n数値 7 です', 'ページ番号行だけを除去（本文中の数字は残す）');
  eq(D.stripPageNumbers('3\n本文\n5'), '3\n本文\n5', '前後が本文の数字だけの行は残す（安全側）');
  eq(D.cleanScenarioText('探索者たちは\n村に到着した。\n\n\n\n12\n\n夕暮れ。', 'full'), '探索者たちは村に到着した。\n\n夕暮れ。', 'TXT用：途中改行・ページ番号・余分な空行を除去');
  eq(D.cleanScenarioText('一行目\n二行目  ', 'light'), '一行目\n二行目', 'HTML/PDF用：改行は保持');
  const docScenes = [{ id: 's1', title: '導入', text: '「こんにちは」\n【HO1】に配布：手紙を渡す', page: 2, sourcePath: 'C:\\x.pdf', tags: ['HO2'], bg: { name: '教室' }, bgm: { name: '日常' }, screens: [], markers: [] },
    { id: 's2', title: '調査 </script><b>', text: '本文2', page: 10, sourcePath: 'C:\\x.pdf', tags: [], bg: null, bgm: null, screens: [], markers: [] }];
  const bms = [{ path: 'C:\\x.pdf', name: 'x', page: 5, label: '重要' }, { path: 'C:\\x.pdf', name: 'x', page: 11, label: '終盤' }, { path: 'C:\\other.pdf', name: 'o', page: 1, label: '別PDF' }];
  const as = D.assignBookmarks(docScenes, bms);
  eq([as.byScene.get('s1').map(b => b.label), as.byScene.get('s2').map(b => b.label), as.orphan.map(b => b.label)], [['重要'], ['終盤'], ['別PDF']], 'しおりをページでシーンへ振り分け（別PDFはシーン外）');
  eq(D.distributedHo(docScenes[0]).sort(), ['HO1', 'HO2'], '配布HO（タグ＋配布行のHO）');
  const html = D.buildGmHtml({ title: 'テスト卓', roomName: '部屋', scenes: docScenes, bookmarks: bms });
  t(html.includes('id="toc"') && html.includes('href="#s0"') && html.includes('href="#s1"'), 'GM HTML：左に目次');
  t(html.includes('🖼️ 背景</b>教室') && html.includes('🎵 BGM</b>日常') && html.includes('📨 配布HO</b>HO1・HO2') && html.includes('🔖 しおり</b>重要（p.5）'), 'GM HTML：背景・BGM・配布HO・しおりのガイドバッジ');
  t(/<p class="line talk"[^>]*data-id="s0-0"/.test(html) && html.includes('navigator.clipboard') && html.includes("classList.toggle('sent'"), 'GM HTML：段落クリックでコピー＋送信済み表示');
  t(!/<script>[\s\S]*<\/script>[\s\S]*<\/script>/.test(html.replace(/<script>[\s\S]*?<\/script>/, '')) && !html.includes('</script><b>'), 'GM HTML：本文中の </script> を無害化（HTMLエスケープ）');
  const pdfHtml = D.buildPdfHtml({ title: 'テスト卓', roomName: '部屋', scenes: docScenes, bookmarks: bms });
  t((pdfHtml.match(/<h1>/g) || []).length === 1 && (pdfHtml.match(/<h2>/g) || []).length === 3 && (pdfHtml.match(/<h3>/g) || []).length === 3, 'PDF用HTML：h1=タイトル／h2=シーン＋シーン外しおり／h3=しおり（アウトラインの元）');
  const txt = D.buildTxt({ title: 'テスト卓', scenes: docScenes });
  t(txt.startsWith('【テスト卓】\n\n■ 導入\n') && txt.includes('\n■ 調査 </script><b>\n') && !/\n{3,}/.test(txt), 'TXT：シーン区切りを「■」で統一');

  // ===== entities.items の非表示フラグ往復変換・order ソート =====
  const visPkgJson = {
    meta: { version: '1.1.0' },
    entities: {
      room: { fieldWidth: 60, fieldHeight: 40, fieldObjectFit: 'fill' },
      items: {
        i_late: { type: 'object', x: 2, y: 1, width: 4, height: 2, z: 5, order: 3, active: false, visible: true, closed: false, memo: 'activeFalse' },
        i_first: { type: 'plane', x: 4, y: 2, width: 6, height: 3, z: 1, order: 1, active: true, visible: false, closed: false, memo: 'visibleFalse' },
        i_mid: { type: 'object', x: 6, y: 3, width: 2, height: 2, z: 2, order: 2, active: true, visible: true, closed: true, memo: 'closedTrue' },
        i_vis: { type: 'plane', x: 1, y: 1, width: 4, height: 4, z: 3, active: true, visible: true, closed: false, memo: 'shownNoOrder' }
      },
      scenes: {
        sc_b: { name: '後半', order: 2, text: '後半開始メッセージ', fieldWidth: 50, fieldHeight: 35, fieldObjectFit: 'fill', markers: {} },
        sc_a: { name: '導入', order: 1, text: '導入メッセージ', fieldWidth: 40, fieldHeight: 30, fieldObjectFit: 'cover', markers: {} },
        sc_c: { name: '末尾', text: 'order未設定', markers: {} }
      },
      characters: {}, decks: {}, notes: {}, effects: {}, savedatas: {}, snapshots: {}
    },
    resources: {}
  };
  const visParsed = P.parsePackage(visPkgJson);
  eq(visParsed.items.map(x => x.memo), ['visibleFalse', 'closedTrue', 'activeFalse', 'shownNoOrder'], 'parsePackage: items を order 昇順（未設定は後ろ）にソート');
  eq(visParsed.items.map(x => x.visible), [false, false, false, true], 'parsePackage: active:false / visible:false / closed:true は全て visible:false');
  const rtItems = visParsed.items.map(it => M.sanitizeBoardItem({
    kind: 'screen', text: it.memo, x: it.x * 24, y: it.y * 24, width: it.width * 24, height: it.height * 24, zIndex: it.z, visible: it.visible
  }, 'screen'));
  const rtBuilt = await P.buildPackage({
    room: { name: 'RT', fieldWidth: visParsed.room.fieldWidth, fieldHeight: visParsed.room.fieldHeight },
    scenes: visParsed.scenes.map(sc => M.sanitizeScene({
      title: sc.name, text: '', sceneMessage: sc.sceneMessage,
      boardWidth: sc.fieldWidth ? sc.fieldWidth * 24 : null,
      boardHeight: sc.fieldHeight ? sc.fieldHeight * 24 : null,
      fgFit: sc.fieldObjectFit
    })),
    items: rtItems
  }, resolve, { grid: 24 });
  const rtOutItems = P.parsePackage(rtBuilt.data).items;
  eq(rtOutItems.map(x => [x.memo, x.active, x.visible]), [
    ['visibleFalse', false, false],
    ['closedTrue', false, false],
    ['activeFalse', false, false],
    ['shownNoOrder', true, true]
  ], 'entities.items: 非表示フラグ（active / visible）がエクスポート→再読込で100%往復一致');

  // ===== scenes order ソート・sceneMessage 保持・fieldWidth/fieldHeight =====
  eq(visParsed.scenes.map(s => s.name), ['導入', '後半', '末尾'], 'parsePackage: scenes を order 昇順（未設定は出現順）にソート');
  const rtOutScenes = P.parsePackage(rtBuilt.data).scenes;
  eq(rtOutScenes.map(s => [s.name, s.sceneMessage, s.fieldWidth, s.fieldHeight, s.fieldObjectFit]), [
    ['導入', '導入メッセージ', 40, 30, 'cover'],
    ['後半', '後半開始メッセージ', 50, 35, 'fill'],
    ['末尾', 'order未設定', 40, 30, 'contain']
  ], 'scenes: order順・sceneMessage・fieldWidth/fieldHeight・fieldObjectFit を往復保持');
  eq([rtBuilt.data.entities.room.fieldWidth, rtBuilt.data.entities.room.fieldHeight], [60, 40], 'room.fieldWidth / fieldHeight を保持');
  eq(P.detectCoordScale([{ x: 960, y: 720 }, { x: 24, y: 24 }], { fieldWidth: 40, fieldHeight: 30, grid: 24 }), 1, 'detectCoordScale: ピクセル相当の巨大座標(>500)は scale=1（24倍しない）');
  eq(P.detectCoordScale([{ x: -720, y: 0 }], { fieldWidth: 40, fieldHeight: 30, grid: 24 }), 1, 'detectCoordScale: 負の巨大ピクセル座標(<-500)も scale=1');
  eq(P.detectCoordScale([{ x: 2, y: 1 }, { x: 10, y: 8 }], { fieldWidth: 40, fieldHeight: 30, grid: 24 }), 24, 'detectCoordScale: マス座標は scale=24');
  const offboardRoomJson = {
    meta: { version: '1.1.0' },
    entities: {
      room: { fieldWidth: 40, fieldHeight: 30 },
      items: {
        waitLeft: { type: 'object', x: -30, y: 10, width: 4, height: 4, memo: '左待機パネル' },
        waitRight: { type: 'object', x: 65, y: 12, width: 6, height: 4, memo: '右待機パネル' },
        boardCenter: { type: 'object', x: 10, y: 8, width: 4, height: 4, memo: '盤面内パネル' }
      },
      scenes: {
        sc1: {
          name: '待機付きシーン',
          markers: {
            mkWait: { x: -30, y: 10, width: 4, height: 4, text: '盤面外マーカー' }
          }
        }
      },
      characters: {}, decks: {}, notes: {}, effects: {}, savedatas: {}, snapshots: {}
    },
    resources: {}
  };
  const offboardPkg = P.parsePackage(offboardRoomJson);
  const offboardScale = P.detectCoordScale(
    [...offboardPkg.items, ...offboardPkg.scenes.flatMap(s => s.markers || [])],
    { fieldWidth: offboardPkg.room.fieldWidth, fieldHeight: offboardPkg.room.fieldHeight, grid: 24 }
  );
  eq(offboardScale, 24, 'detectCoordScale: 盤面外待機パネル(-30,10 / 65,12)を含む部屋でも scale=24');
  eq(
    offboardPkg.items.map(it => [it.memo, it.x * offboardScale, it.y * offboardScale]),
    [
      ['左待機パネル', -720, 240],
      ['右待機パネル', 1560, 288],
      ['盤面内パネル', 240, 192]
    ],
    'parsePackage + detectCoordScale: 盤面外待機パネルを含む全アイテムの座標が ×24 で展開される'
  );
  eq(
    offboardPkg.scenes[0].markers.map(mk => [mk.text, mk.x * offboardScale, mk.y * offboardScale]),
    [['盤面外マーカー', -720, 240]],
    'parsePackage + detectCoordScale: 盤面外マーカーの座標も ×24 で展開される'
  );

  // ===== CCFModel.fromCcfoliaCharacter: @img: 立ち絵保持・メインiconUrl先頭保持・max:"" で0に潰れない =====
  const chFromRef = M.fromCcfoliaCharacter({
    kind: 'character',
    data: {
      name: 'テストNPC',
      iconUrl: '@img:mainhash01',
      faces: [
        { iconUrl: '@img:facehash02', label: '笑顔' },
        { iconUrl: '@img:mainhash01', label: '通常' },
        { iconUrl: 'file:///C:/images/angry.png', label: '怒り' },
        { iconUrl: 'C:\\images\\local.png', label: 'ローカル' }
      ],
      status: [
        { label: 'HP', value: 15, max: '' },
        { label: 'MP', value: 12, max: '   ' },
        { label: 'SAN', value: 60, max: 99 },
        { label: 'ZERO', value: 5, max: 0 }
      ],
      params: [{ label: 'STR', value: '12' }],
      commands: 'CCB<=60 【目星】'
    }
  });
  t(chFromRef && chFromRef.iconDataUrl === '@img:mainhash01', 'fromCcfoliaCharacter: @img: 参照を iconDataUrl に保持', chFromRef && chFromRef.iconDataUrl);
  eq(chFromRef.portraits.map(p => [p.dataUrl || p.path, p.label]), [
    ['@img:mainhash01', '通常'],
    ['@img:facehash02', '笑顔'],
    ['file:///C:/images/angry.png', '怒り'],
    ['C:\\images\\local.png', 'ローカル']
  ], 'fromCcfoliaCharacter: メインiconUrlを先頭に重複除去して保持し @img:/file:///ローカルパスを受け入れ');
  eq(chFromRef.status, [
    { label: 'HP', value: 15, max: 15 },
    { label: 'MP', value: 12, max: 12 },
    { label: 'SAN', value: 60, max: 99 },
    { label: 'ZERO', value: 5, max: 0 }
  ], 'fromCcfoliaCharacter: status.max が空文字/空白のとき 0 に潰れず value にフォールバック（明示0は維持）');
  const gdWithBgm = M.sanitizeGlobalDecor({ bgm: { name: '部屋曲', path: '/bgm/room.mp3', volume: 45 } });
  eq(gdWithBgm.bgm && [gdWithBgm.bgm.name, gdWithBgm.bgm.path, gdWithBgm.bgm.volume], ['部屋曲', '/bgm/room.mp3', 45], 'sanitizeGlobalDecor: 部屋BGMを保持');

  // ===== fitMode / fgFit の 'contain' 保持・sanitizeSceneParseConfig・visible:false マーカー除外 =====
  const fgPngUrl = 'data:image/png;base64,' + PNG.toString('base64');
  const fgDefault = M.sanitizeBoardItem({ dataUrl: fgPngUrl }, 'fg');
  const fgContain = M.sanitizeBoardItem({ dataUrl: fgPngUrl, fitMode: 'contain' }, 'fg');
  const fgCover = M.sanitizeBoardItem({ dataUrl: fgPngUrl, fitMode: 'cover' }, 'fg');
  const fgFill = M.sanitizeBoardItem({ dataUrl: fgPngUrl, fitMode: 'fill' }, 'fg');
  eq([fgDefault.fitMode, fgContain.fitMode, fgCover.fitMode, fgFill.fitMode], ['contain', 'contain', 'cover', 'fill'], 'sanitizeBoardItem: fitMode は contain/cover/fill の3値を保持し既定値は contain');
  const scContain = M.sanitizeScene({ title: '全体収め', fgFit: 'contain', fg: { dataUrl: fgPngUrl, fitMode: 'contain' } });
  const scFgDefault = M.sanitizeScene({ title: '未指定前景', fg: { dataUrl: fgPngUrl } });
  const scInheritCover = M.sanitizeScene({ title: 'fgFit引き継ぎ', fgFit: 'cover', fg: { dataUrl: fgPngUrl } });
  eq([scContain.fgFit, scContain.fg.fitMode, scFgDefault.fgFit, scFgDefault.fg.fitMode, scInheritCover.fgFit, scInheritCover.fg.fitMode],
    ['contain', 'contain', 'contain', 'contain', 'cover', 'cover'], 'sanitizeScene: fgFit / fg.fitMode で contain を保持し未指定時は fgFit || contain を引き継ぐ');
  eq([M.sanitizeSceneParseConfig(null).inheritMarkersOnNewScene, M.sanitizeSceneParseConfig({ inheritMarkersOnNewScene: false }).inheritMarkersOnNewScene],
    [true, false], 'sanitizeSceneParseConfig: inheritMarkersOnNewScene は既定 true で false 指定も保持');
  const visMkPkg = await P.buildPackage({
    scenes: [M.sanitizeScene({
      title: 'マーカー表示フィルタ',
      fgFit: 'contain',
      fg: { dataUrl: fgPngUrl, fitMode: 'contain' },
      markers: [
        { text: '表示マーカー1', x: 24, y: 24, width: 48, height: 24, visible: true },
        { text: '非表示マーカー', x: 48, y: 48, width: 48, height: 24, visible: false, dataUrl: 'data:image/png;base64,' + PNG2.toString('base64') },
        { text: '表示マーカー2', x: 72, y: 72, width: 48, height: 24 }
      ]
    })]
  }, resolve, { grid: 24 });
  const visMkScene = Object.values(visMkPkg.data.entities.scenes)[0];
  const visMkTexts = Object.values(visMkScene.markers).map(mk => mk.text);
  eq([visMkScene.fieldObjectFit, visMkTexts], ['contain', ['表示マーカー1', '表示マーカー2']], 'buildPackage: fieldObjectFit=contain を維持し visible:false のマーカーをシーン出力から除外');

  // ===== ココフォリア中央原点 ⇔ 卓工房左上原点（40×30マス = 960×720px）往復変換テスト =====
  {
    const grid = 24, boardW = 960, boardH = 720;
    const centerPkg = await P.buildPackage({
      room: { name: 'OriginTest', fieldWidth: 40, fieldHeight: 30 },
      npcs: [Object.assign({}, npc, { onBoard: true, x: 0, y: 0, width: 96, height: 96 })],
      scenes: [M.sanitizeScene({
        title: '原点シーン',
        boardWidth: boardW,
        boardHeight: boardH,
        markers: [
          { text: '全面マーカー', x: 0, y: 0, width: boardW, height: boardH },
          { text: '半マスマーカー', x: 12, y: 36, width: 48, height: 24 }
        ]
      })],
      items: [
        { kind: 'screen', name: '全面パネル', x: 0, y: 0, width: boardW, height: boardH, zIndex: 0 },
        { kind: 'screen', name: '半マスパネル', x: 12, y: 36, width: 48, height: 24, zIndex: 1 }
      ]
    }, resolve, { grid, boardWidth: boardW, boardHeight: boardH });

    const outItems = Object.values(centerPkg.data.entities.items);
    const outChars = Object.values(centerPkg.data.entities.characters);
    const outMarkers = Object.values(Object.values(centerPkg.data.entities.scenes)[0].markers);
    eq([outItems[0].x, outItems[0].y, outItems[0].width, outItems[0].height], [-20, -15, 40, 30], '中央原点出力: 40×30盤面で卓工房(0,0,960×720)のスクリーンパネルが (-20,-15,40×30) に出力される');
    eq([outItems[1].x, outItems[1].y], [-19.5, -13.5], '中央原点出力: 0.5マス座標(12,36px)が丸め誤差なく (-19.5,-13.5) に出力される');
    eq([outChars[0].x, outChars[0].y], [-20, -15], '中央原点出力: 初期盤面駒(0,0)が (-20,-15) に出力される');
    eq([outMarkers[0].x, outMarkers[0].y, outMarkers[0].width, outMarkers[0].height], [-20, -15, 40, 30], '中央原点出力: マーカーパネル(0,0,960×720)が (-20,-15,40×30) に出力される');
    eq([outMarkers[1].x, outMarkers[1].y], [-19.5, -13.5], '中央原点出力: 0.5マスマーカー(12,36px)が (-19.5,-13.5) に出力される');

    // 本家形式 x:-20, y:-15 を卓工房インポート式で読み戻すと (0, 0) に戻る往復検証
    const parsedCenter = P.parsePackage(centerPkg.data);
    const scaleCenter = P.detectCoordScale(
      [...parsedCenter.items, ...parsedCenter.characters.filter(c => c.active), ...parsedCenter.scenes.flatMap(s => s.markers || [])],
      { fieldWidth: parsedCenter.room.fieldWidth, fieldHeight: parsedCenter.room.fieldHeight, grid }
    );
    eq(scaleCenter, 24, '中央原点往復: detectCoordScale はマス単位(24)');
    const impW = parsedCenter.room.fieldWidth * grid;
    const impH = parsedCenter.room.fieldHeight * grid;
    const impItem0 = { x: Math.round(parsedCenter.items[0].x * scaleCenter + impW / 2), y: Math.round(parsedCenter.items[0].y * scaleCenter + impH / 2) };
    const impItem1 = { x: Math.round(parsedCenter.items[1].x * scaleCenter + impW / 2), y: Math.round(parsedCenter.items[1].y * scaleCenter + impH / 2) };
    const impChar0 = { x: Math.round(parsedCenter.characters[0].x * scaleCenter + impW / 2), y: Math.round(parsedCenter.characters[0].y * scaleCenter + impH / 2) };
    const sc0 = parsedCenter.scenes[0], effW = (sc0.fieldWidth * grid) || impW, effH = (sc0.fieldHeight * grid) || impH;
    const impMk0 = { x: Math.round(sc0.markers[0].x * scaleCenter + effW / 2), y: Math.round(sc0.markers[0].y * scaleCenter + effH / 2) };
    const impMk1 = { x: Math.round(sc0.markers[1].x * scaleCenter + effW / 2), y: Math.round(sc0.markers[1].y * scaleCenter + effH / 2) };
    eq([impItem0.x, impItem0.y, impItem1.x, impItem1.y], [0, 0, 12, 36], '中央原点往復: 本家(-20,-15 / -19.5,-13.5)を取り込むと卓工房(0,0 / 12,36)に完全復元');
    eq([impChar0.x, impChar0.y, impMk0.x, impMk0.y, impMk1.x, impMk1.y], [0, 0, 0, 0, 12, 36], '中央原点往復: 駒・マーカーも卓工房座標へ完全復元');
    eq(M.sanitizeBoard({ coordVersion: 2 }).coordVersion, 2, 'sanitizeBoard: coordVersion: 2 を保持');
    eq(M.sanitizeBoard({}).coordVersion, 0, 'sanitizeBoard: 未指定時は coordVersion: 0');
  }

  console.log(ng ? 'NG ' + ng + ' / OK ' + ok : 'ALL PASS (' + ok + ')'); process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
