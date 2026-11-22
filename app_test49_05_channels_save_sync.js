/* app_test49_05_channels_save_sync.js — チャンネル設定・Webhookテスト・保存・クラウド連携の受け口・シナリオ操作
 * 読み込み順は 01→07（HTMLの<script>の並び）。全ファイルが同じグローバルスコープを共有します。
 * 各ファイルは、前のファイルで定義された関数・変数を使えます。 */
  function addChannelConfig() { const nc = { id: uid(), name: "新しいチャンネル", webhookUrl: "", tags: [] }; appState.channels.push(nc); chAccOpen.add(nc.id); renderChannelConfigList(); saveState(); }   // 追加したチャンネルは開いた状態で表示
  async function deleteChannelConfig(idx) { if (await appConfirm('このチャンネル設定を削除しますか？', { okText: '削除', danger: true })) { { const _d = appState.channels[idx]; if (_d) (appState.deletedChannels = appState.deletedChannels || {})[_d.id] = nowTs(); }
    appState.channels.splice(idx, 1);  saveState(); renderChannelConfigList(); renderChannelCheckboxes(); updateTagCheckboxes(); } }
  function addTagConfig(cI) { if (!appState.channels[cI].tags) appState.channels[cI].tags = []; appState.channels[cI].tags.push({ name: "", id: "" }); renderChannelConfigList(); saveState(); }
  function deleteTagConfig(cI, tI) { appState.channels[cI].tags.splice(tI, 1); renderChannelConfigList(); saveState(); }

  const WH_RE = /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+\/?(?:\?.*)?$/i;
  function channelIssues(ch, only) {
    const out = [], url = String(ch.webhookUrl || '').trim();
    if (!url) out.push('Webhook URLが未設定です'); else if (!WH_RE.test(url)) out.push('Webhook URLの形式が正しくありません');
    (ch.tags || []).filter(t => !only || [...only].some(n => sameTag(n, t.name))).forEach(t => { if (t.id && !/^\d{15,25}$/.test(String(t.id).trim())) out.push(`タグ「${t.name}」のIDは数字のみで入力してください`); });
    return out;
  }
  async function testWebhook(i) {
    const ch = appState.channels[i], iss = channelIssues(ch, new Set());
    if (iss.length) return toast('⚠️ ' + iss.join('\n'));
    try {
      const r = await fetchRetry(ch.webhookUrl.trim(), { method: 'GET' }, 1, 10000);
      if (!r.ok) return toast(`❌ 接続に失敗しました（HTTP ${r.status}）。URLが削除・変更されていないか確認してください`);
      const j = await r.json().catch(e => { logSoft('testWebhook', e); return {}; }); if (j.guild_id && ch.guildId !== j.guild_id) { ch.guildId = j.guild_id; saveState(); }   // 履歴からスレッドを開くために保存
      toast(`✅ 接続OK（Webhook名: ${j.name || '不明'}）`);
    } catch (e) { toast('❌ 接続できませんでした。通信状況を確認してください'); }
  }
  function saveSettings() {
    appState.botName = document.getElementById('botName').value; appState.channels.forEach(ch => { ch.webhookUrl = String(ch.webhookUrl || '').trim(); });
    appState.scenarios.forEach(normalizePosted); saveState(); renderChannelCheckboxes(); renderPreview(); renderDBView();
    const names = appState.channels.map(c => c.name), dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))], msgs = [];
    if (dup.length) msgs.push(`同名のチャンネルがあります（${dup.join('、')}）。見分けにくいため名前を分けることをおすすめします`);
    appState.channels.forEach(ch => channelIssues(ch).forEach(m => msgs.push(`【${ch.name}】${m}`)));
    if (msgs.length) toast('⚠️ 設定は保存しましたが、確認が必要です\n' + msgs.join('\n')); else toast("✅ 設定を保存しました。");
  }
  // ---- 端末内の保存先：IndexedDB（localStorageの約5MB制限を超えて画像を保存できる） ----
  let _idbP = null;
  function idbOpen() {
    return _idbP || (_idbP = new Promise((resolve, reject) => {
      const req = indexedDB.open('discord_forum_tool', 3);
      req.onupgradeneeded = () => { const d = req.result; ['kv', 'images', 'thumbs', 'assets'].forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { _idbP = null; reject(req.error); };
    }));
  }
  function idbGet(store, key) { return idbOpen().then(db => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); }
  function idbPut(store, key, val) { return idbOpen().then(db => new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(val, key); tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); })); }
  function idbDel(store, key) { return idbOpen().then(db => new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); })); }
  function idbKeys(store) { return idbOpen().then(db => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAllKeys(); r.onsuccess = () => res(Array.isArray(r.result) ? r.result.map(String) : []); r.onerror = () => rej(r.error); })); }
  window.idbGetRaw = async function (key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  window.idbSetRaw = async function (key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  let localSaveWarned = false;
  let saveStateTimer = null;
  let scJsonCache = null;   // シナリオ部分のシリアライズ結果。設定だけの変更(saveState(true))では再計算しない（通常のsaveState()は必ず破棄）
  let pendingSkipCloud = false;
  let pendingSkipDetailEdited = false;
  let suppressDetailEditedCount = 0;
  window.beginSuppressDetailEdited = function () { suppressDetailEditedCount++; };
  window.endSuppressDetailEdited = function () { suppressDetailEditedCount = Math.max(0, suppressDetailEditedCount - 1); };
  function saveState(settingsOnly, opts) {
    if (!settingsOnly) scJsonCache = null;
    if (!(opts && opts.skipCloud)) pendingSkipCloud = false;
    else if (!saveStateTimer) pendingSkipCloud = true;
    const skipDetail = !!(opts && opts.skipDetailEdited) || suppressDetailEditedCount > 0;
    if (!settingsOnly && !skipDetail) pendingSkipDetailEdited = false;
    else if (skipDetail) pendingSkipDetailEdited = true;
    clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(() => { saveStateTimer = null; const sc = pendingSkipCloud; const sd = pendingSkipDetailEdited; pendingSkipCloud = false; pendingSkipDetailEdited = false; saveStateNow({ skipCloud: sc, skipDetailEdited: sd }); }, 300);
    scheduleDiskAutosave(1500);
    if (!settingsOnly && !(opts && opts.skipCloud) && typeof window.scheduleAutoDocTextExtraction === 'function') {
      window.scheduleAutoDocTextExtraction();
    }
  }
  window.addEventListener('pagehide', () => {
    if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; const sc = pendingSkipCloud; const sd = pendingSkipDetailEdited; pendingSkipCloud = false; pendingSkipDetailEdited = false; saveStateNow({ skipCloud: sc, skipDetailEdited: sd }); }
    saveDiskAutosaveNow();
  });
  window.addEventListener('beforeunload', () => { saveDiskAutosaveNow(); });

  // ===== ローカル自動保存（3世代ローテーションバックアップ） =====
  function sanitizeStateObjectForDisk(o) {
    if (!o || typeof o !== 'object') return o;
    const validIds = new Set(
      (Array.isArray(o.scenarios) ? o.scenarios : [])
        .map(sc => (sc && sc.id != null) ? String(sc.id) : '')
        .filter(Boolean)
    );
    if (o.unlinkedCcfRooms && typeof o.unlinkedCcfRooms === 'object') {
      if (Array.isArray(o.unlinkedCcfRooms)) {
        const isEdited = typeof window.isProjectActuallyEdited === 'function' ? window.isProjectActuallyEdited : null;
        o.unlinkedCcfRooms = o.unlinkedCcfRooms.filter(r => {
          if (!r || typeof r !== 'object') return false;
          const rSid = r.scenarioId != null ? String(r.scenarioId) : (r.scId != null ? String(r.scId) : '');
          if (rSid && !validIds.has(rSid)) return false;
          return isEdited ? isEdited(r) : true;
        });
      } else {
        for (const k of Object.keys(o.unlinkedCcfRooms)) {
          if (!validIds.has(String(k))) delete o.unlinkedCcfRooms[k];
        }
      }
    }
    const toRef = typeof urlToRef === 'function' ? urlToRef : (typeof window !== 'undefined' && typeof window.urlToRef === 'function' ? window.urlToRef : null);
    const scrubLongBase64 = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          const v = node[i];
          if (typeof v === 'string') {
            if (v.startsWith('data:image/') && v.length >= 5000) {
              const ref = toRef ? toRef(v) : '';
              node[i] = (typeof ref === 'string' && ref.startsWith('@img:')) ? ref : '';
            }
          } else if (v && typeof v === 'object') {
            scrubLongBase64(v);
          }
        }
        return;
      }
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === 'string') {
          if (v.startsWith('data:image/') && v.length >= 5000) {
            const ref = toRef ? toRef(v) : '';
            node[k] = (typeof ref === 'string' && ref.startsWith('@img:')) ? ref : '';
          }
        } else if (v && typeof v === 'object') {
          scrubLongBase64(v);
        }
      }
    };
    scrubLongBase64(o);
    return o;
  }
  async function buildFullAppStateJson() {
    if (typeof cleanStaleBlobUrls === 'function') cleanStaleBlobUrls(appState);
    const o = JSON.parse(serializeState(appState));
    sanitizeStateObjectForDisk(o);
    await persistChain;
    return JSON.stringify(o);
  }
  let lastRotationTime = 0;
  function rotateDiskBackups(force) {
    if (!IS_ELECTRON || !fs || !DATA_ROOT) return;
    try {
      fs.mkdirSync(DATA_ROOT, { recursive: true });
      const autoFile = path.join(DATA_ROOT, 'autosave_state.json');
      if (!fs.existsSync(autoFile)) return;
      const now = Date.now();
      if (!force && (now - lastRotationTime < 30000)) return;
      lastRotationTime = now;
      const b1 = path.join(DATA_ROOT, 'backup_1.json'), b2 = path.join(DATA_ROOT, 'backup_2.json'), b3 = path.join(DATA_ROOT, 'backup_3.json');
      if (fs.existsSync(b2)) { try { fs.copyFileSync(b2, b3); } catch (e) { logSoft('rot b3', e); } }
      if (fs.existsSync(b1)) { try { fs.copyFileSync(b1, b2); } catch (e) { logSoft('rot b2', e); } }
      try { fs.copyFileSync(autoFile, b1); } catch (e) { logSoft('rot b1', e); }
    } catch (e) { logSoft('rotateDiskBackups', e); }
  }
  let diskAutosaveTimer = null;
  function scheduleDiskAutosave(delayMs = 1500) {
    clearTimeout(diskAutosaveTimer);
    diskAutosaveTimer = setTimeout(() => { diskAutosaveTimer = null; saveDiskAutosaveNow(); }, delayMs);
  }
  async function saveDiskAutosaveNow(forceOverwriteAll) {
    if (diskAutosaveTimer) { clearTimeout(diskAutosaveTimer); diskAutosaveTimer = null; }
    if (!IS_ELECTRON || !fs || !DATA_ROOT) return;
    try {
      if (!forceOverwriteAll) rotateDiskBackups(false);
      const json = await buildFullAppStateJson();
      const autoFile = path.join(DATA_ROOT, 'autosave_state.json'), tmpFile = autoFile + '.tmp';
      fs.mkdirSync(DATA_ROOT, { recursive: true });
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) { }
      fs.writeFileSync(tmpFile, json, 'utf8');
      try {
        fs.renameSync(tmpFile, autoFile);
      } catch (_renErr) {
        fs.writeFileSync(autoFile, json, 'utf8');
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) { }
      }
      if (forceOverwriteAll === true) {
        lastRotationTime = Date.now();
        for (let i = 1; i <= 3; i++) {
          const bf = path.join(DATA_ROOT, `backup_${i}.json`);
          try { fs.copyFileSync(autoFile, bf); }
          catch (e) {
            try { fs.writeFileSync(bf, json, 'utf8'); } catch (e2) { logSoft(`forceRot b${i}`, e2 || e); }
          }
        }
      }
    } catch (e) { console.error('[diskAutosave] 保存失敗', e); }
  }
  window.buildFullAppStateJson = buildFullAppStateJson;
  window.rotateDiskBackups = rotateDiskBackups;
  window.scheduleDiskAutosave = scheduleDiskAutosave;
  window.saveDiskAutosaveNow = saveDiskAutosaveNow;

  function _normCatName(c) {
    if (window.CCFModel && typeof CCFModel.normalizeStandardCat === 'function') return CCFModel.normalizeStandardCat(c);
    const s = String(c == null ? '' : c).trim();
    return (!s || s === '未分類' || s === '(未分類)') ? '' : s;
  }
  function _catItemKey(name, origName, type) {
    const nm = String(origName || name || '').normalize('NFKC').trim().toLowerCase();
    return nm ? (nm + '|' + String(type || 'image')) : '';
  }
  function syncScenarioAssetCatalog(sc, opts) {
    if (!sc || typeof sc !== 'object' || !sc.id) return [];
    const o = opts || {};
    const prevList = Array.isArray(sc.assetCatalog) ? sc.assetCatalog : [];
    const prevById = new Map();
    const prevByKey = new Map();
    prevList.forEach(it => {
      if (!it || typeof it !== 'object') return;
      if (it.id) prevById.set(String(it.id), it);
      const k = _catItemKey(it.name, it.origName, it.type);
      if (k && !prevByKey.has(k)) prevByKey.set(k, it);
    });

    const imgRefByKey = new Map();
    const toRefStr = v => {
      if (typeof v !== 'string' || !v) return '';
      if (v.startsWith('@img:')) return v;
      if (v.startsWith('blob:') && typeof imgUrlToHash !== 'undefined') {
        const h = imgUrlToHash.get(v);
        return h ? '@img:' + h : '';
      }
      if (v.startsWith('data:image/') && typeof urlToRef === 'function') {
        const r = urlToRef(v);
        return (typeof r === 'string' && r.startsWith('@img:')) ? r : '';
      }
      return '';
    };
    (Array.isArray(sc.images) ? sc.images : []).forEach(im => {
      if (!im || typeof im !== 'object') return;
      const r = toRefStr(im.thumbRef || im.dataUrl || '');
      const k = _catItemKey(im.name, im.origName, 'image');
      if (r && k) imgRefByKey.set(k, r);
    });

    let proj = null;
    try {
      if (window.CCF && typeof CCF.readProject === 'function') proj = CCF.readProject(String(sc.id));
      else if (Array.isArray(sc.ccfRooms) && sc.ccfRooms[0]) proj = sc.ccfRooms[0].project;
    } catch (_) {}
    const refs = (proj && Array.isArray(proj.refs)) ? proj.refs : [];
    const scImgs = Array.isArray(sc.images) ? sc.images : [];
    const scDocs = Array.isArray(sc.docs) ? sc.docs : [];

    if (!o.authoritative && !refs.length && !scImgs.length && !scDocs.length && prevList.length) {
      return prevList;
    }

    const out = [];
    const byKey = new Map();
    const upsert = entry => {
      if (!entry || !entry.name) return;
      const k = _catItemKey(entry.name, entry.origName, entry.type);
      const prev = (entry.id && prevById.get(String(entry.id))) || (k && prevByKey.get(k)) || null;
      const thumb = entry.thumbRef || (prev && prev.thumbRef) || (entry.type === 'image' && k ? imgRefByKey.get(k) : '') || '';
      const cloudSha = entry.cloudSha || (prev && prev.cloudSha) || '';
      const ex = k ? byKey.get(k) : null;
      if (ex) {
        if (!ex.category && entry.category) ex.category = entry.category;
        if (!ex.thumbRef && thumb) ex.thumbRef = thumb;
        if (!ex.cloudSha && cloudSha) ex.cloudSha = cloudSha;
        if (Array.isArray(entry.tags) && entry.tags.length) {
          ex.tags = [...new Set([...(ex.tags || []), ...entry.tags])];
        }
        return;
      }
      const rec = {
        id: String(entry.id || (prev && prev.id) || ''),
        name: String(entry.name || ''),
        origName: String(entry.origName || entry.name || ''),
        type: String(entry.type || 'image'),
        category: _normCatName(entry.category || (prev && prev.category) || ''),
        thumbRef: thumb,
        cloudSha,
        tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : []
      };
      if (k) byKey.set(k, rec);
      out.push(rec);
    };

    scImgs.forEach(im => {
      if (!im || typeof im !== 'object') return;
      const nm = im.name || 'image';
      const onm = im.origName || nm;
      const thumb = toRefStr(im.thumbRef || im.dataUrl || '');
      upsert({ id: im.id ? 'img:' + im.id : '', name: nm, origName: onm, type: 'image', category: im.category, thumbRef: thumb, cloudSha: im.cloudSha, tags: im.tags });
    });
    refs.forEach(r => {
      if (!r || typeof r !== 'object') return;
      const nm = r.name || (r.path ? String(r.path).split(/[\\/]/).pop() : '');
      const onm = r.origName || nm;
      const tp = r.type || (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(nm) ? 'audio' : /\.pdf$/i.test(nm) ? 'pdf' : /\.zip$/i.test(nm) ? 'zip' : /\.(txt|html?|md|docx?)$/i.test(nm) ? 'doc' : 'image');
      upsert({ id: r.id ? 'ref:' + r.id : '', name: nm, origName: onm, type: tp, category: r.category, thumbRef: toRefStr(r.thumbRef || ''), cloudSha: r.cloudSha, tags: r.tags });
    });
    scDocs.forEach(d => {
      if (!d || typeof d !== 'object') return;
      const nm = d.name || 'doc';
      const tp = (d.ext === 'pdf' || /\.pdf$/i.test(nm)) ? 'pdf' : 'doc';
      upsert({ id: d.id ? 'doc:' + d.id : '', name: nm, origName: d.origName || nm, type: tp, category: d.category || '資料', thumbRef: '', cloudSha: d.cloudSha, tags: d.tags });
    });

    if (!o.authoritative) {
      prevList.forEach(it => {
        if (!it || !it.name) return;
        const k = _catItemKey(it.name, it.origName, it.type);
        if (k && !byKey.has(k)) upsert(it);
      });
    }

    sc.assetCatalog = out;
    return out;
  }
  window.syncScenarioAssetCatalog = syncScenarioAssetCatalog;

  function saveStateNow(opts) {
    if (typeof cleanStaleBlobUrls === 'function') cleanStaleBlobUrls(appState);
    if (Array.isArray(appState.scenarios)) appState.scenarios.forEach(sc => syncScenarioAssetCatalog(sc));
    if (appState.history && appState.history.length > 500) appState.history = appState.history.slice(-500);
    (() => { const rest = serializeState({ ...appState, scenarios: [] }); if (scJsonCache === null) { stampScenarios(opts); scJsonCache = serializeState(appState.scenarios); } const json = rest.replace('"scenarios":[]', () => '"scenarios":' + scJsonCache); return persistChain.then(() => window.idbSetRaw('state', json)); })()
      .then(() => { try { localStorage.removeItem('discord_forum_tool_data_v1'); } catch (e) { logSoft('saveStateNow', e); } }) // 旧保存先を整理
      .catch((e) => {
        console.error(e);
        if (!localSaveWarned) { localSaveWarned = true; toast("⚠️ この端末への保存に失敗しました。ブラウザの空き容量を確認し、「エクスポート」でバックアップを取ってください。"); }
      });
    if (!(opts && opts.skipCloud)) {
      try { localStorage.setItem('discord_forum_tool_dirty', '1'); } catch (e) { logSoft('saveStateNow', e); } // クラウド未反映の目印
      if (window.cloudScheduleSave) window.cloudScheduleSave();
      if (window.CloudSync && typeof window.CloudSync.scheduleSync === 'function') window.CloudSync.scheduleSync('state_save');
    }
  }
  const isCloudAbsPath = p => /^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/)|file:\/\/|zipview:\/\/)/i.test(String(p || '').trim());
  function toPortableCloudPath(v, nameHint, obj) {
    const s = String(v || '').trim();
    if (!s) return '';
    if (/^(?:cloud-asset|idb-asset):\/\//i.test(s)) return s;
    if (isCloudAbsPath(s) && window.CloudSync && typeof window.CloudSync.lookupShaForRef === 'function') {
      const hit = window.CloudSync.lookupShaForRef(s);
      if (hit && hit.sha256) {
        if (obj && typeof obj === 'object') obj.cloudSha = hit.sha256;
        const nm = encodeURIComponent(String(nameHint || hit.name || s.split(/[\\/]/).pop() || 'asset'));
        return `cloud-asset://${hit.sha256}/${nm}`;
      }
    }
    return null;
  }
  function cleanCcfRoomForCloud(room) {
    if (!room || typeof room !== 'object') return room;
    const stripNode = obj => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.forEach(stripNode); return; }
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (k === 'file' || k === 'buf') { delete obj[k]; continue; }
        if (typeof v === 'string') {
          if ((k === 'path' || k === 'filePath' || k === 'sePath' || k === 'imgPath' || k === 'sourcePath') && (isCloudAbsPath(v) || /^(?:idb-asset|cloud-asset):\/\//i.test(v))) {
            const portable = toPortableCloudPath(v, obj.name || obj.seName || obj.label || '', obj);
            if (portable) obj[k] = portable;
            else delete obj[k];
          } else if (/^data:(?!image\/)/i.test(v) || /^blob:/i.test(v) || /^zipview:/i.test(v)) {
            obj[k] = '';
          } else if (v.length > 32768 && !v.startsWith('@img:')) {
            obj[k] = '';
          }
        } else if (v && typeof v === 'object') {
          stripNode(v);
        }
      }
    };
    stripNode(room);
    if (room.project && room.project.pdfPos && typeof room.project.pdfPos === 'object') {
      const nextPos = {};
      for (const [pk, pv] of Object.entries(room.project.pdfPos)) {
        if (/^(?:idb-asset|cloud-asset):\/\//i.test(pk)) {
          nextPos[pk] = pv;
        } else if (!isCloudAbsPath(pk)) {
          nextPos[pk] = pv;
        } else {
          const portable = toPortableCloudPath(pk, '', null);
          if (portable) nextPos[portable] = pv;
        }
      }
      room.project.pdfPos = nextPos;
    }
    return room;
  }
  function trimScenarioDocTextsToBudget(sc, maxTotalChars) {
    if (!sc || !Array.isArray(sc.docTexts) || !sc.docTexts.length) return sc;
    const cap = Math.max(1000, Number(maxTotalChars) || 250000);
    let total = 0;
    const cleaned = [];
    for (const dt of sc.docTexts) {
      if (!dt || typeof dt !== 'object' || typeof dt.text !== 'string' || !dt.text) continue;
      if (total >= cap) break;
      const remain = cap - total;
      const txt = dt.text.length > remain ? dt.text.slice(0, remain) : dt.text;
      cleaned.push({
        id: String(dt.id || (typeof uid === 'function' ? uid() : Date.now().toString(36))),
        name: String(dt.name || 'document'),
        text: txt,
        pageCount: Number(dt.pageCount) || 1,
        extractedAt: Number(dt.extractedAt) || Date.now()
      });
      total += txt.length;
    }
    sc.docTexts = cleaned;
    return sc;
  }
  window.trimScenarioDocTextsToBudget = trimScenarioDocTextsToBudget;

  function sanitizeForCloudSync(srcState) {
    if (typeof cleanStaleBlobUrls === 'function') cleanStaleBlobUrls(srcState);
    if (srcState && Array.isArray(srcState.scenarios)) {
      srcState.scenarios.forEach(sc => syncScenarioAssetCatalog(sc));
    }
    stampScenarios();
    const o = JSON.parse(serializeState(srcState));
    if (typeof o.botAvatarData === 'string' && o.botAvatarData) {
      o.botAvatarData = urlToRef(o.botAvatarData);
      if (o.botAvatarData.length > 32768 && !o.botAvatarData.startsWith('@img:')) o.botAvatarData = '';
    }
    if (Array.isArray(o.scenarios)) {
      o.scenarios = o.scenarios.map(sc => {
        if (!sc || typeof sc !== 'object') return sc;
        delete sc.sourcePath;
        if (Array.isArray(sc.docs) && IS_ELECTRON && typeof DATA_ROOT !== 'undefined' && DATA_ROOT && typeof path !== 'undefined' && window.CloudSync && typeof window.CloudSync.lookupShaForRef === 'function') {
          sc.docs.forEach(d => {
            if (d && d.rel && !d.cloudSha) {
              try {
                const hit = window.CloudSync.lookupShaForRef(path.resolve(DATA_ROOT, d.rel));
                if (hit && hit.sha256) d.cloudSha = hit.sha256;
              } catch (_) {}
            }
          });
        }
        if (Array.isArray(sc.fullBlockData)) {
          sc.fullBlockData.forEach(b => { if (b && typeof b === 'object') delete b.file; });
        }
        if (Array.isArray(sc.ccfRooms)) sc.ccfRooms.forEach(cleanCcfRoomForCloud);
        trimScenarioDocTextsToBudget(sc, 250000);
        return sc;
      });
    }
    if (Array.isArray(o.unlinkedCcfRooms)) o.unlinkedCcfRooms.forEach(cleanCcfRoomForCloud);
    delete o.watchFolders;
    if (o.cloudSettings && typeof o.cloudSettings === 'object') {
      const nextCs = {
        syncFirestoreText: o.cloudSettings.syncFirestoreText !== false,
        syncGDriveAssets: o.cloudSettings.syncGDriveAssets !== false,
        compressImagesWebp: o.cloudSettings.compressImagesWebp !== false,
        uploadScope: o.cloudSettings.uploadScope === 'all' ? 'all' : 'edited_only',
        webAssetSyncMode: (o.cloudSettings.webAssetSyncMode === 'edited_only' || o.cloudSettings.webAssetSyncMode === 'manual') ? o.cloudSettings.webAssetSyncMode : 'auto_all'
      };
      if (o.cloudSettings.gdriveBridgeToken) {
        nextCs.gdriveBridgeToken = String(o.cloudSettings.gdriveBridgeToken);
        nextCs.gdriveBridgeExpiresAt = Number(o.cloudSettings.gdriveBridgeExpiresAt) || 0;
        nextCs.gdriveBridgeEmail = String(o.cloudSettings.gdriveBridgeEmail || '');
      }
      o.cloudSettings = nextCs;
    }
    if (Array.isArray(o.history) && o.history.length > 300) o.history = o.history.slice(-300);
    return o;
  }
  window.getAppStateForSync = opts => (opts && opts.forCloud) ? sanitizeForCloudSync(appState) : JSON.parse(serializeState(appState));

  function fmtConflictDate(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p2 = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  function isRoomSubstantive(r) {
    const p = r && r.project;
    if (!p || typeof p !== 'object') return false;
    return !!(
      (Array.isArray(p.stocks) && p.stocks.length > 0) ||
      (Array.isArray(p.npcs) && p.npcs.length > 0) ||
      (Array.isArray(p.scenes) && p.scenes.length > 0) ||
      (Array.isArray(p.cutins) && p.cutins.length > 0) ||
      (Array.isArray(p.refs) && p.refs.length > 0) ||
      (Array.isArray(p.bookmarks) && p.bookmarks.length > 0) ||
      (p.pdf && p.pdf.path)
    );
  }
  function roomProjectSig(r) {
    if (!r || !r.project) return '';
    try {
      return JSON.stringify(r.project, (k, v) => {
        if (k === 'pdfPos' || k === 'updatedAt' || k === 'createdAt') return undefined;
        if (typeof v === 'string' && isCloudAbsPath(v)) return v.split(/[\\/]/).pop();
        return v;
      });
    } catch (_) { return ''; }
  }
  function getLastCloudSyncAt() {
    try {
      const uidStr = typeof window.cloudGetUid === 'function' ? window.cloudGetUid() : '';
      const raw = (uidStr && localStorage.getItem('taku_last_cloud_sync_at_' + uidStr)) || localStorage.getItem('taku_last_cloud_sync_at') || '0';
      return Number(raw) || 0;
    } catch (_) { return 0; }
  }
  function reconcileRoomArrays(locRooms, remRooms, baseRooms, lastSyncAt) {
    const locArr = Array.isArray(locRooms) ? locRooms : [];
    const remArr = Array.isArray(remRooms) ? remRooms : [];
    const out = Array.isArray(baseRooms) ? JSON.parse(JSON.stringify(baseRooms)) : [];
    const byId = new Map(out.map(r => [r.id, r]));
    const locMap = new Map(locArr.filter(r => r && r.id).map(r => [r.id, r]));
    const remMap = new Map(remArr.filter(r => r && r.id).map(r => [r.id, r]));

    for (const r of locArr) {
      if (r && r.id && !byId.has(r.id) && isRoomSubstantive(r)) {
        const c = JSON.parse(JSON.stringify(r));
        out.push(c);
        byId.set(c.id, c);
      }
    }
    for (const r of remArr) {
      if (r && r.id && !byId.has(r.id) && isRoomSubstantive(r)) {
        const c = JSON.parse(JSON.stringify(r));
        out.push(c);
        byId.set(c.id, c);
      }
    }

    const existingSigs = new Set(out.map(roomProjectSig).filter(Boolean));
    for (const [rid, rL] of locMap) {
      const rR = remMap.get(rid);
      if (!rR) continue;
      if (!isRoomSubstantive(rL) || !isRoomSubstantive(rR)) {
        // 片方が空部屋なら中身のある方を優先
        if (!isRoomSubstantive(rL) && isRoomSubstantive(rR)) {
          const idx = out.findIndex(x => x.id === rid);
          if (idx >= 0) out[idx] = JSON.parse(JSON.stringify(rR));
        } else if (isRoomSubstantive(rL) && !isRoomSubstantive(rR)) {
          const idx = out.findIndex(x => x.id === rid);
          if (idx >= 0) out[idx] = JSON.parse(JSON.stringify(rL));
        }
        continue;
      }
      const sigL = roomProjectSig(rL), sigR = roomProjectSig(rR);
      if (!sigL || !sigR || sigL === sigR) continue;
      const tL = Number(rL.updatedAt) || 0, tR = Number(rR.updatedAt) || 0;
      const bothEdited = lastSyncAt > 0
        ? (tL > lastSyncAt && tR > lastSyncAt)
        : (Math.abs(tL - tR) > 1000 || sigL !== sigR);
      if (!bothEdited) {
        // 片方だけ更新された場合でも新しい方を確実に採用
        const picked = tL >= tR ? rL : rR;
        const idx = out.findIndex(x => x.id === rid);
        if (idx >= 0) out[idx] = JSON.parse(JSON.stringify(picked));
        continue;
      }
      const newer = tL >= tR ? rL : rR;
      const older = newer === rL ? rR : rL;
      const idx = out.findIndex(x => x.id === rid);
      if (idx >= 0) out[idx] = JSON.parse(JSON.stringify(newer));
      const olderSig = roomProjectSig(older);
      if (!existingSigs.has(olderSig)) {
        existingSigs.add(olderSig);
        const bkRoom = JSON.parse(JSON.stringify(older));
        bkRoom.id = typeof uid === 'function' ? uid() : ('rm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
        const baseName = String(older.name || '部屋').replace(/（別端末バックアップ\s+\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}）$/, '').trim();
        bkRoom.name = `${baseName}（別端末バックアップ ${fmtConflictDate(older.updatedAt || Date.now())}）`;
        out.push(bkRoom);
        window._lastCloudConflictCount = (window._lastCloudConflictCount || 0) + 1;
      }
    }
    return out;
  }

  window.mergeCloudStates = (localState, remoteState) => {
    const loc = localState || {}, rem = remoteState || {};
    const { merged } = mergeBackupInto(loc, rem);
    const lastSyncAt = getLastCloudSyncAt();
    const locScMap = new Map((Array.isArray(loc.scenarios) ? loc.scenarios : []).filter(s => s && s.id).map(s => [s.id, s]));
    const remScMap = new Map((Array.isArray(rem.scenarios) ? rem.scenarios : []).filter(s => s && s.id).map(s => [s.id, s]));
    const locDedupMap = new Map(), remDedupMap = new Map();
    const dkOf = typeof window.getScenarioDedupKey === 'function' ? window.getScenarioDedupKey : () => '';
    (Array.isArray(loc.scenarios) ? loc.scenarios : []).forEach(s => { const k = dkOf(s); if (k && !locDedupMap.has(k)) locDedupMap.set(k, s); });
    (Array.isArray(rem.scenarios) ? rem.scenarios : []).forEach(s => { const k = dkOf(s); if (k && !remDedupMap.has(k)) remDedupMap.set(k, s); });

    if (Array.isArray(merged.scenarios)) {
      merged.scenarios.forEach(sc => {
        if (!sc || !sc.id) return;
        const dk = dkOf(sc);
        const scL = locScMap.get(sc.id) || (dk ? locDedupMap.get(dk) : null);
        const scR = remScMap.get(sc.id) || (dk ? remDedupMap.get(dk) : null);
        if (scL && scR) {
          if (Array.isArray(scL.ccfRooms) || Array.isArray(scR.ccfRooms)) {
            sc.ccfRooms = reconcileRoomArrays(scL.ccfRooms, scR.ccfRooms, sc.ccfRooms, lastSyncAt);
          }
          const tL = Number(scL.updatedAt) || 0, tR = Number(scR.updatedAt) || 0;
          const scBothEdited = lastSyncAt > 0 ? (tL > lastSyncAt && tR > lastSyncAt) : (tL > 0 && tR > 0);
          if (scBothEdited) {
            const newerSc = tL >= tR ? scL : scR;
            const olderSc = newerSc === scL ? scR : scL;
            const nL = String(scL.notes || '').trim(), nR = String(scR.notes || '').trim();
            if (nL && nR && nL !== nR) {
              const keepNotes = String(newerSc.notes || '').trim();
              const oldNotes = String(olderSc.notes || '').trim();
              if (oldNotes && !keepNotes.includes(oldNotes)) {
                sc.notes = keepNotes + `\n\n--- 別端末メモバックアップ (${fmtConflictDate(olderSc.updatedAt || Date.now())}) ---\n` + oldNotes;
                window._lastCloudConflictCount = (window._lastCloudConflictCount || 0) + 1;
              }
            }
            const trL = String(scL.trailer || '').trim(), trR = String(scR.trailer || '').trim();
            if (trL && trR && trL !== trR) {
              const oldTrailer = String(olderSc.trailer || '').trim();
              if (oldTrailer && !String(sc.notes || '').includes(oldTrailer)) {
                sc.notes = (String(sc.notes || '').trim() ? String(sc.notes).trim() + '\n\n' : '') +
                  `--- 別端末あらすじバックアップ (${fmtConflictDate(olderSc.updatedAt || Date.now())}) ---\n` + oldTrailer;
                window._lastCloudConflictCount = (window._lastCloudConflictCount || 0) + 1;
              }
            }
          }
          if (Array.isArray(scL.assetCatalog) || Array.isArray(scR.assetCatalog)) {
            const tL0 = Number(scL.updatedAt) || 0, tR0 = Number(scR.updatedAt) || 0;
            const priCat = (tL0 >= tR0 ? scL.assetCatalog : scR.assetCatalog) || [];
            const secCat = (tL0 >= tR0 ? scR.assetCatalog : scL.assetCatalog) || [];
            const secById = new Map(), secByKey = new Map();
            secCat.forEach(it => {
              if (!it || typeof it !== 'object') return;
              if (it.id) secById.set(String(it.id), it);
              const k = _catItemKey(it.name, it.origName, it.type);
              if (k) secByKey.set(k, it);
            });
            const mergedCat = priCat.length
              ? priCat.map(it => {
                  if (!it || typeof it !== 'object') return it;
                  const k = _catItemKey(it.name, it.origName, it.type);
                  const alt = (it.id && secById.get(String(it.id))) || (k && secByKey.get(k)) || null;
                  if (!alt) return { ...it };
                  return {
                    ...it,
                    thumbRef: it.thumbRef || alt.thumbRef || '',
                    cloudSha: it.cloudSha || alt.cloudSha || ''
                  };
                })
              : secCat.map(it => ({ ...it }));
            sc.assetCatalog = mergedCat;
          }
        }
      });
    }
    if (Array.isArray(loc.unlinkedCcfRooms) || Array.isArray(rem.unlinkedCcfRooms)) {
      merged.unlinkedCcfRooms = reconcileRoomArrays(loc.unlinkedCcfRooms, rem.unlinkedCcfRooms, merged.unlinkedCcfRooms, lastSyncAt);
    }

    const dsc = { ...(loc.deletedScenarios || {}), ...(merged.deletedScenarios || {}) };
    for (const [id, ts] of Object.entries(rem.deletedScenarios || {})) dsc[id] = Math.max(Number(dsc[id]) || 0, Number(ts) || 0);
    const dch = { ...(loc.deletedChannels || {}) };
    for (const [id, ts] of Object.entries(rem.deletedChannels || {})) dch[id] = Math.max(Number(dch[id]) || 0, Number(ts) || 0);
    merged.scenarios = (merged.scenarios || []).filter(s => {
      const dt = Number(dsc[s.id]) || 0;
      return !dt || (Number(s.updatedAt) || 0) > dt;
    });
    merged.channels = (merged.channels || []).filter(c => !dch[c.id]);
    merged.deletedScenarios = dsc;
    merged.deletedChannels = dch;
    merged.customTags = [...new Set([...(Array.isArray(loc.customTags) ? loc.customTags : []), ...(Array.isArray(rem.customTags) ? rem.customTags : [])])];
    if (Array.isArray(loc.tagPresets) || Array.isArray(rem.tagPresets)) {
      merged.tagPresets = mergeTagNames(Array.isArray(loc.tagPresets) ? loc.tagPresets : DEFAULT_TAG_PRESETS, rem.tagPresets);
    }
    if (Array.isArray(loc.ccfCutinPackages) || Array.isArray(rem.ccfCutinPackages)) {
      const pm = new Map();
      (loc.ccfCutinPackages || []).forEach(p => { if (p && p.id) pm.set(p.id, p); });
      (rem.ccfCutinPackages || []).forEach(p => { if (p && p.id) pm.set(p.id, p); });
      merged.ccfCutinPackages = [...pm.values()];
    }
    if (rem.botName !== undefined && !loc.botName) merged.botName = rem.botName;
    if (rem.maxAttachMB !== undefined) merged.maxAttachMB = rem.maxAttachMB;
    if (rem.botAvatarData && !loc.botAvatarData) merged.botAvatarData = rem.botAvatarData;
    if (loc.watchFolders || rem.watchFolders) merged.watchFolders = loc.watchFolders || rem.watchFolders;
    if (loc.cloudSettings || rem.cloudSettings) {
      const lCs = (loc.cloudSettings && typeof loc.cloudSettings === 'object') ? loc.cloudSettings : {};
      const rCs = (rem.cloudSettings && typeof rem.cloudSettings === 'object') ? rem.cloudSettings : {};
      const baseCs = (typeof sanitizeCloudSettings === 'function') ? sanitizeCloudSettings(loc.cloudSettings || rem.cloudSettings) : (loc.cloudSettings || rem.cloudSettings);
      if (loc.cloudSettings) {
        baseCs.folderSyncEnabled = !!loc.cloudSettings.folderSyncEnabled;
        baseCs.localSyncPath = String(loc.cloudSettings.localSyncPath || '');
        baseCs.webDirName = String(loc.cloudSettings.webDirName || '');
      }
      const lExp = Number(lCs.gdriveBridgeExpiresAt) || 0;
      const rExp = Number(rCs.gdriveBridgeExpiresAt) || 0;
      if (rCs.gdriveBridgeToken && rExp >= lExp) {
        baseCs.gdriveBridgeToken = String(rCs.gdriveBridgeToken);
        baseCs.gdriveBridgeExpiresAt = rExp;
        baseCs.gdriveBridgeEmail = String(rCs.gdriveBridgeEmail || lCs.gdriveBridgeEmail || '');
      } else if (lCs.gdriveBridgeToken) {
        baseCs.gdriveBridgeToken = String(lCs.gdriveBridgeToken);
        baseCs.gdriveBridgeExpiresAt = lExp;
        baseCs.gdriveBridgeEmail = String(lCs.gdriveBridgeEmail || rCs.gdriveBridgeEmail || '');
      }
      merged.cloudSettings = baseCs;
    }
    return merged;
  };
  // シナリオの内容が変わったときだけ updatedAt を更新する（別端末との統合で「新しい方」を決めるため）
  let clockOffset = Number(localStorage.getItem('cloud_clock_offset') || 0) || 0;   // サーバー時刻との差(ms)。端末の時計がずれていても「新しい方」を取り違えない
  const nowTs = () => Date.now() + clockOffset;
  window.setClockOffset = ms => { clockOffset = ms; try { localStorage.setItem('cloud_clock_offset', String(ms)); } catch (e) { logSoft('saveStateNow', e); } };
  const scSigs = new Map();
  const sigOf = sc => JSON.stringify(sc, (k, v) => (k === 'updatedAt' || k === 'cloudKeepAssets' || k === 'detailEdited') ? undefined : (typeof v === 'string' ? (v.startsWith('blob:') ? '@img:' + (imgUrlToHash.get(v) || v) : v.startsWith('data:image/') ? 'data:' + v.length + v.slice(-24) : v) : v));
  function primeScenarioSigs(onlyIds) {
    if (!onlyIds) {
      scSigs.clear();
      (appState.scenarios || []).forEach(sc => { if (sc && sc.id) scSigs.set(sc.id, sigOf(sc)); });
      return;
    }
    const idSet = new Set([...onlyIds].map(String));
    (appState.scenarios || []).forEach(sc => {
      if (sc && sc.id && idSet.has(String(sc.id))) {
        if (!sc.updatedAt) sc.updatedAt = nowTs();
        scSigs.set(sc.id, sigOf(sc));
      }
    });
  }
  window.primeScenarioSigs = primeScenarioSigs;
  function stampScenarios(opts) {
    const allowDetailEdited = !(opts && opts.skipDetailEdited) && suppressDetailEditedCount === 0;
    appState.scenarios.forEach(sc => {
      if (!sc || !sc.id) return;
      const g = sigOf(sc);
      const hadPrev = scSigs.has(sc.id);
      if (scSigs.get(sc.id) !== g) {
        scSigs.set(sc.id, g);
        sc.updatedAt = nowTs();
        if (hadPrev && allowDetailEdited) sc.detailEdited = true;
      }
    });
  }
  window.deduplicateScenariosInPlace = function (opts) {
    const o = opts || {};
    if (typeof appState === 'undefined' || !Array.isArray(appState.scenarios) || appState.scenarios.length < 2) return 0;
    const dkOf = typeof window.getScenarioDedupKey === 'function' ? window.getScenarioDedupKey : () => '';
    const pkOf = typeof window.getScenarioSourcePathKey === 'function' ? window.getScenarioSourcePathKey : () => '';
    const mergeRec = typeof window.mergeScenarioRecords === 'function' ? window.mergeScenarioRecords : (a, b) => ({ ...b, ...a });
    const scoreSc = (sc, idx) => {
      if (!sc) return -1;
      const posted = (sc.postedChannels && sc.postedChannels.length > 0) ? 10000 : 0;
      const rooms = (sc.ccfRooms && sc.ccfRooms.length > 0) ? 5000 : 0;
      const src = sc.sourcePath ? 1000 : 0;
      const assets = ((sc.docs && sc.docs.length) || 0) * 50 + ((sc.images && sc.images.length) || 0) * 50;
      const textLen = String(sc.synopsis || '').length + String(sc.notes || '').length + String(sc.trailer || '').length + String(sc.system || '').length + String(sc.playerCount || '').length;
      return posted + rooms + src + assets + Math.min(textLen, 500) - idx * 0.001;
    };
    const groups = new Map();
    const orderKeys = [];
    appState.scenarios.forEach((sc, idx) => {
      if (!sc || typeof sc !== 'object') return;
      const dk = dkOf(sc);
      const pk = !dk ? pkOf(sc) : '';
      const gKey = dk ? ('d:' + dk) : (pk ? ('p:' + pk) : ('u:' + idx));
      if (!groups.has(gKey)) {
        groups.set(gKey, []);
        orderKeys.push(gKey);
      }
      groups.get(gKey).push({ sc, idx });
    });
    const ts = typeof nowTs === 'function' ? nowTs() : Date.now();
    const nextList = [];
    let removedCount = 0;
    orderKeys.forEach(gKey => {
      const arr = groups.get(gKey);
      if (arr.length === 1) {
        nextList.push(arr[0].sc);
        return;
      }
      arr.sort((a, b) => scoreSc(b.sc, b.idx) - scoreSc(a.sc, a.idx));
      let primary = arr[0].sc;
      for (let i = 1; i < arr.length; i++) {
        const sec = arr[i].sc;
        primary = mergeRec(primary, sec, { preferBase: true });
        if (sec.id && sec.id !== primary.id) {
          (appState.deletedScenarios = appState.deletedScenarios || {})[sec.id] = ts;
          if (typeof currentScenarioId !== 'undefined' && currentScenarioId === sec.id) {
            currentScenarioId = primary.id;
          }
        }
        removedCount++;
      }
      primary.updatedAt = ts;
      nextList.push(primary);
    });
    if (removedCount > 0) {
      appState.scenarios = nextList;
      if (typeof normalizePosted === 'function') appState.scenarios.forEach(normalizePosted);
      if (typeof primeScenarioSigs === 'function') primeScenarioSigs();
      if (!o.skipSave && typeof saveState === 'function') saveState(false, { skipDetailEdited: true });
      if (!o.skipRender) {
        if (typeof window.resetDBViewCache === 'function') window.resetDBViewCache();
        if (typeof populateScenarioDBSelect === 'function') populateScenarioDBSelect();
        if (typeof renderDBView === 'function') renderDBView(true);
        if (typeof renderSidebarTags === 'function') renderSidebarTags();
        if (typeof renderHistoryTable === 'function') renderHistoryTable();
      }
    }
    return removedCount;
  };
  if (typeof window !== 'undefined') {
    const _runStartupDedup = () => {
      try {
        const n = window.deduplicateScenariosInPlace();
        if (n > 0 && typeof toast === 'function') toast(`🧹 重複シナリオ ${n}件を自動統合しました`);
      } catch (e) { logSoft('startupDedup', e); }
    };
    let _startupPurgeDone = false;
    const _scheduleStartupPurgeAndSlim = () => {
      if (_startupPurgeDone) return;
      _startupPurgeDone = true;
      if (typeof IS_ELECTRON === 'undefined' || !IS_ELECTRON) return;
      setTimeout(async () => {
        try {
          if (typeof window.purgeOrphanAndEmptyProjects === 'function') {
            await window.purgeOrphanAndEmptyProjects();
          }
          if (typeof window.saveDiskAutosaveNow === 'function') {
            await window.saveDiskAutosaveNow(true);
          }
        } catch (e) { logSoft('startupPurgeAndSlim', e); }
      }, 2000);
    };
    if (window.appReady && typeof window.appReady.then === 'function') {
      window.appReady.then(() => {
        _runStartupDedup();
        _scheduleStartupPurgeAndSlim();
      });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('click', e => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-lib-act="cleanup-scenarios"]') : null;
        if (!btn) return;
        const n = window.deduplicateScenariosInPlace();
        if (n > 0 && typeof toast === 'function') toast(`🧹 重複シナリオ ${n}件を自動統合しました`);
      }, true);
    }
  }
  window.applyMergedState = async (m, opts) => {   // クラウドとの統合結果を、画面を再読み込みせずに反映する
    const prevWatch = appState.watchFolders;
    const prevCloudSettings = appState.cloudSettings ? { ...appState.cloudSettings } : null;
    // クラウドから来たデータは、画面のHTMLに入る前に、必ず形を整える（細工された値による属性注入などを防ぐ）
    m = sanitizeImported({ ...m, scenarios: Array.isArray(m.scenarios) ? m.scenarios : [], channels: Array.isArray(m.channels) ? m.channels : [], history: Array.isArray(m.history) ? m.history : [], formats: m.formats !== undefined ? m.formats : appState.formats, imageCategories: m.imageCategories !== undefined ? m.imageCategories : appState.imageCategories, imageAssets: m.imageAssets !== undefined ? m.imageAssets : appState.imageAssets, unlinkedCcfRooms: m.unlinkedCcfRooms !== undefined ? m.unlinkedCcfRooms : appState.unlinkedCcfRooms, unlinkedCcfActiveRoomId: m.unlinkedCcfActiveRoomId !== undefined ? m.unlinkedCcfActiveRoomId : appState.unlinkedCcfActiveRoomId }) || m;
    appState.scenarios = m.scenarios; appState.channels = m.channels; appState.history = m.history; appState.deletedScenarios = m.deletedScenarios || {}; appState.deletedChannels = m.deletedChannels || appState.deletedChannels || {}; appState.historyClearedAt = m.historyClearedAt || appState.historyClearedAt; appState.formats = m.formats || appState.formats; appState.imageCategories = m.imageCategories || appState.imageCategories; appState.imageAssets = m.imageAssets || appState.imageAssets;
    if (m.watchFolders && typeof m.watchFolders === 'object' && (m.watchFolders.commonRoot || m.watchFolders.scenarioRoot)) {
      appState.watchFolders = { commonRoot: String(m.watchFolders.commonRoot || ''), scenarioRoot: String(m.watchFolders.scenarioRoot || '') };
    } else if (prevWatch) {
      appState.watchFolders = prevWatch;
    }
    if (Array.isArray(m.customTags)) appState.customTags = m.customTags;
    if (Array.isArray(m.tagPresets)) appState.tagPresets = mergeTagNames(m.tagPresets);
    if (Array.isArray(m.ccfCutinPackages)) appState.ccfCutinPackages = m.ccfCutinPackages;
    if (m.botName !== undefined) appState.botName = m.botName;
    if (m.maxAttachMB !== undefined) appState.maxAttachMB = m.maxAttachMB;
    if (m.botAvatarData !== undefined) appState.botAvatarData = m.botAvatarData;
    if (m.cloudSettings && typeof m.cloudSettings === 'object' && typeof sanitizeCloudSettings === 'function') {
      const nextCs = sanitizeCloudSettings(m.cloudSettings);
      if (prevCloudSettings) {
        nextCs.folderSyncEnabled = !!prevCloudSettings.folderSyncEnabled;
        nextCs.localSyncPath = prevCloudSettings.localSyncPath || '';
        nextCs.webDirName = prevCloudSettings.webDirName || '';
        if (!nextCs.gdriveBridgeToken && prevCloudSettings.gdriveBridgeToken) {
          nextCs.gdriveBridgeToken = prevCloudSettings.gdriveBridgeToken;
          nextCs.gdriveBridgeExpiresAt = Number(prevCloudSettings.gdriveBridgeExpiresAt) || 0;
          nextCs.gdriveBridgeEmail = prevCloudSettings.gdriveBridgeEmail || '';
        }
      }
      appState.cloudSettings = nextCs;
      try { localStorage.setItem('taku_kobo_cloud_settings_v1', JSON.stringify(nextCs)); } catch (_) {}
      if (nextCs.gdriveBridgeToken && Number(nextCs.gdriveBridgeExpiresAt) > (Date.now() + 60 * 1000)) {
        if (window.CloudSync && typeof window.CloudSync.setGDriveAccessToken === 'function') {
          const isFileOpen = !IS_ELECTRON && typeof location !== 'undefined' && location.protocol === 'file:';
          if (isFileOpen || !(window.CloudSync.isTokenUsable && window.CloudSync.isTokenUsable())) {
            window.CloudSync.setGDriveAccessToken(nextCs.gdriveBridgeToken, Date.now(), {
              expiresAt: Number(nextCs.gdriveBridgeExpiresAt),
              email: nextCs.gdriveBridgeEmail || '',
              skipRelaySave: true,
              skipAutoSync: true
            });
          }
        }
      }
    } else if (prevCloudSettings) {
      appState.cloudSettings = prevCloudSettings;
    }
    if (Array.isArray(m.unlinkedCcfRooms)) { appState.unlinkedCcfRooms = m.unlinkedCcfRooms; appState.unlinkedCcfActiveRoomId = m.unlinkedCcfActiveRoomId || (m.unlinkedCcfRooms[0] ? m.unlinkedCcfRooms[0].id : null); }
    if (typeof renderFormatList === 'function') renderFormatList();
    ensureChannelIds(); appState.scenarios.forEach(x => { if (!x.id) x.id = uid(); }); appState.scenarios.forEach(normalizePosted);
    if (typeof cleanStaleBlobUrls === 'function') cleanStaleBlobUrls(appState, { forceClear: true });
    if (typeof window.deduplicateScenariosInPlace === 'function') window.deduplicateScenariosInPlace({ skipSave: true, skipRender: true });
    await hydrateRefs(appState); primeScenarioSigs();
    if (typeof requestRefsIn === 'function') requestRefsIn(appState);
    saveState(false, { skipCloud: !!(opts && opts.fromCloud) });
    populateScenarioDBSelect(); renderDBView(); renderHistoryTable(); renderChannelConfigList(); renderChannelCheckboxes(); updateTagCheckboxes();
    if (typeof loadSettingsToUI === 'function') loadSettingsToUI();
    if (typeof loadBotAvatarToUI === 'function') loadBotAvatarToUI();
    if (typeof renderSidebarTags === 'function') renderSidebarTags();
    if (typeof renderGalleryAll === 'function') renderGalleryAll();
    if (window.CCF && CCF.library && typeof CCF.library.restore === 'function') CCF.library.restore();
    if (window.CCF && typeof CCF.onCloudSyncApplied === 'function') CCF.onCloudSyncApplied();
    if (window.CloudSync && typeof window.CloudSync.renderSettingsUI === 'function') window.CloudSync.renderSettingsUI();
  };
  async function exportData() {
    const o = JSON.parse(serializeState(appState)); await persistChain;
    let json = JSON.stringify(o); const map = new Map();
    for (const m of json.matchAll(/@img:([a-z0-9]+)/g)) if (!map.has(m[1])) map.set(m[1], await window.idbImageDataUrl(m[1]));
    json = json.replace(/@img:([a-z0-9]+)/g, (m, h) => map.get(h) || m);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = "discord_forum_tool_backup.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function exportPreV3Backup() {   // v3移行の直前に退避した元データを、通常のバックアップ(JSON)として書き出す
    let raw = await window.idbGetRaw('state_backup_pre_v3') || await window.idbGetRaw('state_backup_corrupt');
    if (!raw) return toast('移行前のバックアップはありません（この端末では移行が行われていません）');
    let json = typeof raw === 'string' ? raw : JSON.stringify(raw); const map = new Map();
    for (const m of json.matchAll(/@img:([a-z0-9]+)/g)) if (!map.has(m[1])) map.set(m[1], await window.idbImageDataUrl(m[1]));
    json = json.replace(/@img:([a-z0-9]+)/g, (m, h) => map.get(h) || m);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'discord_forum_tool_backup_pre_v3.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function importData(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => { (async () => {
      let parsed; try { parsed = sanitizeImported(JSON.parse(evt.target.result)); } catch (err) { e.target.value = ''; return toast('❌ エラー: 読み込めませんでした'); }
      e.target.value = ''; if (!parsed) return toast('❌ ファイルの形式が異なります。');
      const base = window.getAppStateForSync(), { merged, summary: S } = mergeBackupInto(base, parsed);
      const choice = await appChoice('「' + file.name + '」の読み込み方を選んでください。\n\n【統合（追加・更新）】今のデータはそのままに、ファイルの内容を追加・更新します。\n' + mergeSummaryText(S).replace(/^/gm, '　') + '\n※設定（Bot名・アイコン・記号など）は今のままです。\n\n【置き換える】今のデータをファイルの内容で置き換えます。\n（どちらも、今のデータはバックアップとして残ります）',
        [{ label: '統合（追加・更新）', value: 'merge', kind: 'primary' }, { label: '置き換える', value: 'replace', kind: 'danger' }, { label: 'キャンセル', value: null }], { title: 'JSONの読み込み' });
      if (!choice) return;
      const old = await window.idbGetRaw('state'); if (old) await window.idbSetRaw('state_backup', old);
      if (choice === 'merge') {
        await window.applyMergedState({
          scenarios: merged.scenarios,
          channels: merged.channels,
          history: merged.history,
          deletedScenarios: merged.deletedScenarios,
          deletedChannels: merged.deletedChannels,
          historyClearedAt: merged.historyClearedAt || base.historyClearedAt,
          formats: merged.formats,
          imageCategories: merged.imageCategories,
          imageAssets: merged.imageAssets,
          unlinkedCcfRooms: merged.unlinkedCcfRooms,
          unlinkedCcfActiveRoomId: merged.unlinkedCcfActiveRoomId,
          tagPresets: mergeTagNames(appState.tagPresets, parsed.tagPresets)
        });
        return toast('✅ 統合しました（シナリオ 追加' + S.scenAdded + '・更新' + S.scenUpdated + '／チャンネル 追加' + S.chAdded + '・更新' + S.chUpdated + '）');
      }
      await window.idbSetRaw('state', JSON.stringify(parsed)); try { localStorage.setItem('discord_forum_tool_dirty', '1'); } catch (x) { logSoft('importData', x); }
      toast('✅ 設定データを復元しました。'); setTimeout(() => location.reload(), 1200);
    })(); };
    reader.readAsText(file);
  }

  function renderDBView() {
    const filter = document.getElementById('dbFilterStatus').value; const sortOrder = document.getElementById('dbSortOrder').value;
    renderDBChannelFilter();
    const terms = parseQuery(document.getElementById('dbSearchInput').value), chf = (document.getElementById('dbFilterChannel') || {}).value || '';
    const selTagKeys = (typeof dbTagSel !== 'undefined' && dbTagSel.size && typeof tagKey === 'function') ? new Set([...dbTagSel].map(tagKey)) : null;
    let filtered = appState.scenarios.map((sc, index) => ({ ...sc, index })).filter(sc => {
      const isP = sc.postedChannels && sc.postedChannels.length > 0;
      if (filter === 'unposted' && isP) return false; if (filter === 'posted' && !isP) return false; if (filter === 'fav' && !sc.favorite) return false;
      if (chf && !(sc.postedChannels || []).includes(chf.slice(2))) return false;
      if (selTagKeys && !(sc.tags || []).some(t => selTagKeys.has(tagKey(t)))) return false;   // サイドバーの絞り込みタグ
      return matchQuery(sc, terms);
    });
    { const rc = document.getElementById('dbResultCount'); if (rc) rc.textContent = (terms.length || chf || filter !== 'all' || (typeof dbTagSel !== 'undefined' && dbTagSel.size)) ? `${filtered.length} / ${appState.scenarios.length} 件` : ''; }

    if (sortOrder === 'unposted_first') filtered.sort((a, b) => { const aP = a.postedChannels && a.postedChannels.length > 0, bP = b.postedChannels && b.postedChannels.length > 0; if (aP === bP) return b.index - a.index; return aP ? 1 : -1; });
    else if (sortOrder === 'title') filtered.sort((a, b) => (a.title || "").localeCompare(b.title || "", 'ja')); else filtered.sort((a, b) => b.index - a.index);

    if ((document.getElementById('dbFavFirst') || { checked: true }).checked) filtered.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));   // お気に入りを先頭へ（各グループ内は選んだ並び順のまま）
    const _sig = [filter, sortOrder, chf, terms.join(' ')].join('|'); if (_sig !== dbSig) { dbSig = _sig; dbLimit = 60; }
    const shown = filtered.slice(0, dbLimit);
    { const mw = document.getElementById('dbMoreWrap'); if (mw) { mw.innerHTML = ''; if (filtered.length > shown.length) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary'; b.textContent = `さらに表示（${shown.length} / ${filtered.length}件）`; b.onclick = () => { dbLimit += 60; renderDBView(); }; mw.appendChild(b); } } }
    const total = appState.scenarios.length; const posted = appState.scenarios.filter(s => s.postedChannels && s.postedChannels.length > 0).length;
    document.getElementById('totalScenarioCount').innerText = total; document.getElementById('postedScenarioCount').innerText = posted; document.getElementById('unpostedScenarioCount').innerText = total - posted;

    if (dbViewMode === 'card') {
      document.getElementById('dbTableContainer').style.display = 'none'; const container = document.getElementById('dbCardContainer'); container.style.display = 'grid'; container.innerHTML = "";
      shown.forEach(sc => {
        const isP = sc.postedChannels && sc.postedChannels.length > 0;
        const card = document.createElement('div'); card.className = "scenario-db-card";
        card.innerHTML = `<div class="scenario-card-thumb-wrap">${sc.imageUrl ? `<img ${imgAttr(sc.imageUrl)} class="scenario-card-thumb" loading="lazy">` : `<div class="scenario-card-thumb-placeholder">📁</div>`}</div>
          <div class="scenario-card-body"><div>
            <div class="scenario-card-tags">${sc.system ? `<span class="scenario-badge system">${escapeHTML(sc.system)}</span>` : ''}${sc.playerCount ? `<span class="scenario-badge">${escapeHTML(sc.playerCount)}</span>` : ''}${sc.playTime ? `<span class="scenario-badge time">🕒 ${escapeHTML(sc.playTime)}</span>` : ''}</div>
            <div class="scenario-card-title"><span class="fav-star${sc.favorite ? ' on' : ''}" data-act="fav" data-id="${escapeHTML(sc.id)}" role="button" tabindex="0" aria-pressed="${!!sc.favorite}" title="${sc.favorite ? 'お気に入りを解除' : 'お気に入りに追加'}">${sc.favorite ? '★' : '☆'}</span>${escapeHTML(sc.title)}</div>${safeUrl(sc.shopUrl) ? `<a href="${escapeHTML(safeUrl(sc.shopUrl))}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem; color:var(--dc-accent);">🔗 ショップを開く</a>` : ''}
          </div>
          <div class="scenario-card-footer">${isP ? `<span class="badge badge-posted badge-click" data-act="status" data-id="${escapeHTML(sc.id)}" title="クリックで投稿状態を変更">✓ 投稿済 (${sc.postedChannels.length}) ✎</span>` : `<span class="badge badge-unposted badge-click" data-act="status" data-id="${escapeHTML(sc.id)}" title="クリックで投稿状態を変更">未投稿 ✎</span>`}
            <div style="display:flex; gap:4px;"><button type="button" class="btn-sort db-cloud-pin-btn${sc.cloudKeepAssets ? ' on' : ''}" data-cloud-keep="${escapeHTML(sc.id)}" title="${sc.cloudKeepAssets ? '☁️ クラウド保管ON（クリックで解除）' : '☁️ このシナリオの素材をクラウド保管対象にする'}">☁️</button><button class="btn-sort" data-act="load" data-id="${escapeHTML(sc.id)}" style="padding:4px 8px; font-weight:bold;">📤 呼出</button><button class="btn-sort" data-act="edit" data-id="${escapeHTML(sc.id)}" style="padding:4px 8px;">✏️ 編集</button><button class="btn-sort btn-danger" data-act="del" data-id="${escapeHTML(sc.id)}" style="padding:4px 8px;">🗑️</button></div>
          </div></div>`;
        card.dataset.sid = sc.id; container.appendChild(card);
      });
    } else {
      document.getElementById('dbCardContainer').style.display = 'none'; const tbody = document.getElementById('dbTableBody'); document.getElementById('dbTableContainer').style.display = 'block'; tbody.innerHTML = ""; const rows = [];
      shown.forEach(sc => {
        const isP = sc.postedChannels && sc.postedChannels.length > 0;
        const pTags = isP ? sc.postedChannels.map((id, ci) => {
          const inf = (sc.postedInfo || {})[id] || {}, tg = inf.tags || [], nm = postedLabel(sc, id);
          return `<span class="badge" title="${escapeHTML(nm + (tg.length ? ' / タグ: ' + tg.join(', ') : ''))}" style="background:#4e5058; display:inline-flex; align-items:center;">${escapeHTML(nm)}${tg.length ? `<span class="status-tags">#${escapeHTML(tg.join(' #'))}</span>` : ''}<span style="margin-left:6px; cursor:pointer; color:var(--dc-red);" data-act="unpost" data-id="${escapeHTML(sc.id)}" data-ci="${ci}" title="未投稿にする">✕</span></span>`;
        }).join('') : '';
        const sid = escapeHTML(sc.id);
        rows.push(`<tr data-sid="${sid}"><td>${sc.imageUrl ? `<img ${imgAttr(sc.imageUrl)} class="db-thumb" loading="lazy">` : `<div class="db-thumb-placeholder">📁</div>`}</td>
          <td class="db-title"><span class="fav-star${sc.favorite ? ' on' : ''}" data-act="fav" data-id="${escapeHTML(sc.id)}" role="button" tabindex="0" aria-pressed="${!!sc.favorite}" title="${sc.favorite ? 'お気に入りを解除' : 'お気に入りに追加'}">${sc.favorite ? '★' : '☆'}</span>${escapeHTML(sc.title)}${safeUrl(sc.shopUrl) ? `<br><a href="${escapeHTML(safeUrl(sc.shopUrl))}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem; color:var(--dc-accent); font-weight:normal;">🔗 ショップ</a>` : ''}</td>
          <td>${escapeHTML(sc.system || '-')}</td><td>${escapeHTML(sc.playerCount || '-')} / ${escapeHTML(sc.playTime || '-')}</td>
          <td>${isP ? `<span class="badge badge-posted badge-click" data-act="status" data-id="${sid}" title="クリックで投稿状態を変更">✓ 投稿済 ✎</span>` : `<span class="badge badge-unposted badge-click" data-act="status" data-id="${sid}" title="クリックで投稿状態を変更">未投稿 ✎</span>`}</td>
          <td><div class="db-ch-list">${pTags || '-'}</div></td>
          <td><div class="db-actions"><button type="button" class="btn-sort db-cloud-pin-btn${sc.cloudKeepAssets ? ' on' : ''}" data-cloud-keep="${sid}" title="${sc.cloudKeepAssets ? '☁️ クラウド保管ON' : '☁️ クラウド保管ONにする'}">☁️</button><button class="btn-sort" data-act="load" data-id="${sid}">📤 呼出</button><button class="btn-sort" data-act="edit" data-id="${sid}">✏️ 編集</button><button class="btn-sort" data-act="status" data-id="${sid}">📌 状態</button><button class="btn-sort btn-danger" data-act="del" data-id="${sid}">🗑️ 削除</button></div></td></tr>`);
      });
      tbody.innerHTML = rows.join('');
    }
  }

  async function deleteScenarioDB(idx) {
    const _id = (appState.scenarios[idx] || {}).id;
    if (await appConfirm('このシナリオをデータベースから完全に削除しますか？', { okText: '削除', danger: true })) {
      const i2 = appState.scenarios.findIndex(s => s.id === _id); if (i2 < 0) return;
      const removed = appState.scenarios.splice(i2, 1)[0];
      (appState.deletedScenarios = appState.deletedScenarios || {})[_id] = nowTs();
      saveState(); populateScenarioDBSelect(); renderDBView();
      if (typeof cleanupUnusedImages === 'function') cleanupUnusedImages();
      if (window.CCF && CCF.onScenarioDeleted) { try { CCF.onScenarioDeleted(String(_id), removed); } catch (e) { logSoft('deleteScenarioDB', e); } }
    }
  }

  function renderHistoryTable() {
    const el = document.getElementById('historySearchInput'), terms = parseQuery(el ? el.value : '');
    const all = [...appState.history].reverse();
    const list = terms.length ? all.filter(h => { const hay = normSearch([fmtDate(h.date), h.title, h.channels, h.tags, Object.keys(h.threadLinks || {}).join(' ')].join('\n')); return terms.every(t => hay.includes(t)); }) : all;
    document.getElementById('historyTableBody').innerHTML = list.map(h => `<tr><td>${escapeHTML(fmtDate(h.date))}</td><td>${escapeHTML(h.title)}</td><td>${escapeHTML(h.channels)}</td><td>${escapeHTML(h.tags || '-')}</td><td>${threadLinksHtml(h)}</td></tr>`).join('')
      || `<tr><td colspan="5" style="text-align:center; color:var(--dc-text-muted);">${all.length ? '該当する履歴がありません' : '履歴はまだありません'}</td></tr>`;
    const rc = document.getElementById('historyResultCount'); if (rc) rc.textContent = terms.length ? `${list.length} / ${all.length} 件` : `${all.length} 件`;
  }
  async function clearHistory() { if (await appConfirm('投稿履歴をすべて消去しますか？', { okText: '消去', danger: true })) { appState.history = []; appState.historyClearedAt = nowTs(); saveState(); renderHistoryTable(); } }

  let _posting = false;   // 確認ダイアログ中の連打などによる二重投稿を防ぐ
  async function handlePost(e) {
    if (_posting) { if (e && e.preventDefault) e.preventDefault(); return; }
    _posting = true;
    try { await handlePostGuarded(e); } finally { _posting = false; }
  }
  async function handlePostGuarded(e) {
    try { await handlePostInner(e); }
    catch (err) {
      console.error(err);
      const b = document.getElementById('submitBtn'); if (b) { b.disabled = false; b.innerText = "🚀 Discordフォーラムに投稿する"; }
      toast('❌ 投稿中にエラーが発生しました: ' + (err && err.message || err));
    }
  }

  // =====================================================================
  // ☁️ クラウド連携 STEP 1 & 2：Google Drive API (方式A) & カスタムフォルダ (方式B)
  //    2段階オンデマンド取得・オフラインピン留め・キャッシュ解放・未使用整理・3世代復元・直接出力
  // =====================================================================
  (function () {
    'use strict';
    const LOCAL_CS_KEY = 'taku_kobo_cloud_settings_v1';
    const GDRIVE_TOKEN_KEY = 'taku_gdrive_token_v1';
    const GDRIVE_FOLDERS_KEY = 'taku_gdrive_folders_v1';
    const EXPECTED_FIREBASE_PROJECT_ID = 'taku-kobo';
    (function clearStaleFirebaseDriveCache() {
      try {
        const rawCfg = localStorage.getItem('taku_kobo_firebase_config');
        if (rawCfg) {
          const parsed = JSON.parse(rawCfg);
          if (parsed && parsed.projectId && parsed.projectId !== EXPECTED_FIREBASE_PROJECT_ID) {
            localStorage.removeItem('taku_kobo_firebase_config');
            localStorage.removeItem(GDRIVE_TOKEN_KEY);
            localStorage.removeItem(GDRIVE_FOLDERS_KEY);
          }
        }
      } catch (_) {}
    })();
    const OFFLINE_PINS_KEY = 'taku_offline_pinned_v1';
    const QUEUE_KV_KEY = 'cloud_upload_queue_v1';
    const SHA_CACHE_KV_KEY = 'cloud_sha256_cache_v1';
    const MANIFEST_KV_KEY = 'cloud_manifest_cache_v1';
    const IDB_ASSET_META_KV_KEY = 'cloud_idb_asset_index_v1';
    const BACKUP_ROTATE_THROTTLE_MS = 5 * 60 * 1000;
    const DRIVE_ROOT_NAME = '卓倉庫_クラウド同期';
    const DRIVE_SUBS = ['meta', 'assets', 'backups', 'exports'];
    const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
    const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

    let gdriveToken = '';
    let gdriveTokenAt = 0;
    let gdriveTokenExpiresAt = 0;
    let gdriveEmail = '';
    let gdriveNeedsReauth = false;
    let currentAuthUser = null;
    let folderIds = null; // { root, meta, assets, backups, exports }
    let lastFolderVerifyAt = 0;
    let driveFoldersJustRecreated = false;
    let ensureFoldersPromise = null;
    const FOLDER_VERIFY_TTL_MS = 10 * 1000;
    let cloudUploadQueue = [];
    let queueLoaded = false;
    let queueResetGen = 0;
    let draining = false;
    let drainPromise = null;
    let manualSyncRunning = false;
    let pullMetaRunning = 0;
    let prepareSyncRunning = 0;
    const syncIdleListeners = new Set();
    let tokenRefreshPromise = null;
    let syncScheduleTimer = null;
    let shaCache = null; // Map<string, { sha256, mime, compressed, size, mtime }>
    let pathToShaMap = new Map(); // refKey/path -> { sha256, name, mime, size }
    let remoteManifest = {}; // sha256 -> { name, mime, size, isThumb, scenarioId }
    let refToSha = {}; // refKey -> { fullSha, thumbSha, name, mime, size, scenarioId }
    let scenarioAssets = {}; // scenarioId -> [{ sha256, name, mime, size, kind, refKey, rel, isThumb }]
    let packManifest = {}; // packKey -> { packName, packHash, packType, scenarioId, updatedAt, itemCount, totalSize }
    let remoteThumbsPackHash = '';
    let unpackedThumbsPackSig = (() => { try { return localStorage.getItem('taku_unpacked_thumbs_sig_v1') || ''; } catch (_) { return ''; } })();
    let localCloudAssetSet = new Set(); // Set<sha256> cached in cloud_cache or IDB assets
    let idbAssetMeta = {}; // idbRef -> { sha256, name, mime, size, isCloudCache }
    let offlinePinnedIds = new Set();
    let scenarioFetchInFlight = new Map();
    let packFetchInFlight = new Map();
    let thumbsPackInFlight = null;
    let extractedPackCache = new Map(); // packKey -> packHash
    let thumbsPackMemMap = new Map(); // key(imgHash/sha256/refKey) -> { bytes, mime }
    let gdriveAssetSet = null; // Map<fileName, fileInfo>
    let gdriveMetaSet = null; // Map<fileName, fileInfo>
    let folderAssetSet = null; // Set<fileName>
    let folderMetaSet = null; // Set<fileName>
    let lastCloudBackupAt = Number((() => { try { return localStorage.getItem('taku_last_cloud_backup_at') || 0; } catch (_) { return 0; } })() || 0);
    let exitFlowActive = false;
    let exitSkipped = false;
    let exitInitialTotal = 0;

    function isSyncActive() {
      const fbSyncing = !!(typeof window.getFirebaseSyncStatus === 'function' && window.getFirebaseSyncStatus().syncing);
      return !!(
        draining ||
        manualSyncRunning ||
        pullMetaRunning > 0 ||
        prepareSyncRunning > 0 ||
        thumbsPackInFlight ||
        packFetchInFlight.size > 0 ||
        scenarioFetchInFlight.size > 0 ||
        fbSyncing
      );
    }
    function onSyncIdle(fn) {
      if (typeof fn !== 'function') return;
      if (!isSyncActive()) { setTimeout(fn, 0); return; }
      syncIdleListeners.add(fn);
    }
    function notifySyncIdleIfReady() {
      if (isSyncActive()) return;
      if (syncIdleListeners.size) {
        const fns = [...syncIdleListeners];
        syncIdleListeners.clear();
        fns.forEach(fn => { try { setTimeout(fn, 300); } catch (_) {} });
      }
      try { window.dispatchEvent(new CustomEvent('cloud-sync-idle')); } catch (_) {}
    }

    function loadOfflinePins() {
      try {
        const raw = localStorage.getItem(OFFLINE_PINS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        offlinePinnedIds = new Set(Array.isArray(arr) ? arr.map(String) : []);
      } catch (_) { offlinePinnedIds = new Set(); }
    }
    function saveOfflinePins() {
      try { localStorage.setItem(OFFLINE_PINS_KEY, JSON.stringify([...offlinePinnedIds])); } catch (_) {}
    }
    loadOfflinePins();

    function isScenarioPinned(scId) {
      return !!(scId && offlinePinnedIds.has(String(scId)));
    }

    function isFileDirectOpen() {
      return !IS_ELECTRON && typeof location !== 'undefined' && location.protocol === 'file:';
    }

    function loadLocalCloudSettings() {
      let saved = null;
      try {
        const raw = localStorage.getItem(LOCAL_CS_KEY);
        if (raw) saved = JSON.parse(raw);
      } catch (_) {}
      const base = (typeof sanitizeCloudSettings === 'function')
        ? sanitizeCloudSettings(appState && appState.cloudSettings)
        : Object.assign({}, window.DEFAULT_CLOUD_SETTINGS || {});
      if (saved && typeof saved === 'object') {
        if (typeof saved.syncFirestoreText === 'boolean') base.syncFirestoreText = saved.syncFirestoreText;
        if (typeof saved.syncGDriveAssets === 'boolean') base.syncGDriveAssets = saved.syncGDriveAssets;
        if (typeof saved.folderSyncEnabled === 'boolean') base.folderSyncEnabled = saved.folderSyncEnabled;
        if (typeof saved.localSyncPath === 'string') base.localSyncPath = saved.localSyncPath;
        if (typeof saved.webDirName === 'string') base.webDirName = saved.webDirName;
        if (typeof saved.compressImagesWebp === 'boolean') base.compressImagesWebp = saved.compressImagesWebp;
        if (saved.uploadScope === 'all' || saved.uploadScope === 'edited_only') base.uploadScope = saved.uploadScope;
        if (typeof saved.gdriveBridgeToken === 'string' && saved.gdriveBridgeToken) {
          base.gdriveBridgeToken = saved.gdriveBridgeToken;
          base.gdriveBridgeExpiresAt = Number(saved.gdriveBridgeExpiresAt) || 0;
          base.gdriveBridgeEmail = String(saved.gdriveBridgeEmail || '');
        }
      }
      if (typeof appState !== 'undefined' && appState) appState.cloudSettings = base;
      return base;
    }
    function saveLocalCloudSettings(cs) {
      try { localStorage.setItem(LOCAL_CS_KEY, JSON.stringify(cs)); } catch (_) {}
    }
    function getSettings() {
      if (typeof appState === 'undefined' || !appState) return Object.assign({}, window.DEFAULT_CLOUD_SETTINGS || {});
      if (!appState.cloudSettings) return loadLocalCloudSettings();
      return appState.cloudSettings;
    }
    function updateSettings(patch, opts) {
      const next = (typeof sanitizeCloudSettings === 'function')
        ? sanitizeCloudSettings(Object.assign({}, getSettings(), patch || {}))
        : Object.assign({}, getSettings(), patch || {});
      if (typeof appState !== 'undefined' && appState) appState.cloudSettings = next;
      saveLocalCloudSettings(next);
      if (typeof saveState === 'function') saveState(true, opts && opts.localOnly ? { skipCloud: true } : undefined);
      renderSettingsUI();
      updateHeaderBadges();
      return next;
    }

    // ---- Google Drive OAuth Token 管理（localStorage + _TRPG_Data 永続化・サイレント更新） ----
    function readPersistedGDriveAuth() {
      const candidates = [];
      try {
        const raw = localStorage.getItem(GDRIVE_TOKEN_KEY);
        if (raw) candidates.push(JSON.parse(raw));
      } catch (_) {}
      try {
        if (window.ElectronAuthStorage && typeof window.ElectronAuthStorage.loadGDriveAuth === 'function') {
          const disk = window.ElectronAuthStorage.loadGDriveAuth();
          if (disk) candidates.push(disk);
        }
      } catch (_) {}
      try {
        const rawS = sessionStorage.getItem(GDRIVE_TOKEN_KEY);
        if (rawS) candidates.push(JSON.parse(rawS));
      } catch (_) {}
      for (const obj of candidates) {
        if (obj && typeof obj === 'object' && (obj.token || obj.email)) return obj;
      }
      return null;
    }

    function writePersistedGDriveAuth(data) {
      try { localStorage.setItem(GDRIVE_TOKEN_KEY, JSON.stringify(data)); } catch (_) {}
      try { sessionStorage.setItem(GDRIVE_TOKEN_KEY, JSON.stringify(data)); } catch (_) {}
      try {
        if (window.ElectronAuthStorage && typeof window.ElectronAuthStorage.saveGDriveAuth === 'function') {
          window.ElectronAuthStorage.saveGDriveAuth(data);
        }
      } catch (_) {}
    }

    function isAuthDataUsable(obj) {
      if (!obj || !obj.token) return false;
      const obtainedAt = Number(obj.obtainedAt) || 0;
      const expiresAt = Number(obj.expiresAt) || (obtainedAt ? obtainedAt + 3500 * 1000 : 0);
      if (!expiresAt) return false;
      return Date.now() < (expiresAt - 60 * 1000);
    }

    function restoreToken() {
      const obj = readPersistedGDriveAuth();
      if (!obj) return null;
      if (obj.email) gdriveEmail = String(obj.email);
      if (isAuthDataUsable(obj)) {
        const obtainedAt = Number(obj.obtainedAt) || Date.now();
        const expiresAt = Number(obj.expiresAt) || (obtainedAt + 3500 * 1000);
        gdriveToken = String(obj.token);
        gdriveTokenAt = obtainedAt;
        gdriveTokenExpiresAt = expiresAt;
        gdriveNeedsReauth = false;
        return { token: gdriveToken, obtainedAt, expiresAt, email: gdriveEmail, valid: true };
      }
      gdriveToken = '';
      gdriveTokenAt = 0;
      gdriveTokenExpiresAt = 0;
      gdriveNeedsReauth = !!gdriveEmail;
      return { token: '', obtainedAt: 0, expiresAt: 0, email: gdriveEmail, valid: false };
    }

    function setGDriveAccessToken(token, obtainedAt, meta) {
      const m = meta || {};
      if (m.email) gdriveEmail = String(m.email);
      else if (!gdriveEmail && currentAuthUser && currentAuthUser.email) gdriveEmail = String(currentAuthUser.email);

      gdriveToken = String(token || '');
      if (gdriveToken) {
        gdriveTokenAt = Number(obtainedAt) || Date.now();
        const expIn = Number(m.expiresIn) > 0 ? Number(m.expiresIn) : 3500;
        gdriveTokenExpiresAt = Number(m.expiresAt) > 0 ? Number(m.expiresAt) : (gdriveTokenAt + Math.min(expIn, 3500) * 1000);
        gdriveNeedsReauth = false;
        writePersistedGDriveAuth({
          token: gdriveToken,
          obtainedAt: gdriveTokenAt,
          expiresAt: gdriveTokenExpiresAt,
          email: gdriveEmail
        });
        if (!isFileDirectOpen() && !m.skipRelaySave) {
          const curCs = getSettings();
          if (curCs.gdriveBridgeToken !== gdriveToken || Number(curCs.gdriveBridgeExpiresAt) !== gdriveTokenExpiresAt || curCs.gdriveBridgeEmail !== gdriveEmail) {
            const nextCs = (typeof sanitizeCloudSettings === 'function')
              ? sanitizeCloudSettings(Object.assign({}, curCs, {
                  gdriveBridgeToken: gdriveToken,
                  gdriveBridgeExpiresAt: gdriveTokenExpiresAt,
                  gdriveBridgeEmail: gdriveEmail
                }))
              : Object.assign({}, curCs, {
                  gdriveBridgeToken: gdriveToken,
                  gdriveBridgeExpiresAt: gdriveTokenExpiresAt,
                  gdriveBridgeEmail: gdriveEmail
                });
            if (typeof appState !== 'undefined' && appState) appState.cloudSettings = nextCs;
            saveLocalCloudSettings(nextCs);
            if (typeof saveState === 'function') saveState(true);
          }
        }
      } else {
        gdriveTokenAt = 0;
        gdriveTokenExpiresAt = 0;
        gdriveNeedsReauth = true;
      }
      updateHeaderBadges();
      renderSettingsUI();
      if (gdriveToken && !m.skipAutoSync) {
        void pullManifestAndMeta({ silent: true });
        if (cloudUploadQueue.length) void drainQueue();
      }
    }

    function clearGDriveAuth() {
      gdriveToken = '';
      gdriveTokenAt = 0;
      gdriveTokenExpiresAt = 0;
      gdriveEmail = '';
      gdriveNeedsReauth = false;
      folderIds = null;
      lastFolderVerifyAt = 0;
      driveFoldersJustRecreated = false;
      gdriveAssetSet = null;
      gdriveMetaSet = null;
      try { localStorage.removeItem(GDRIVE_TOKEN_KEY); } catch (_) {}
      try { localStorage.removeItem(GDRIVE_FOLDERS_KEY); } catch (_) {}
      try { sessionStorage.removeItem(GDRIVE_TOKEN_KEY); } catch (_) {}
      try {
        if (typeof appState !== 'undefined' && appState && appState.cloudSettings) {
          appState.cloudSettings.gdriveBridgeToken = '';
          appState.cloudSettings.gdriveBridgeExpiresAt = 0;
          appState.cloudSettings.gdriveBridgeEmail = '';
          saveLocalCloudSettings(appState.cloudSettings);
        }
      } catch (_) {}
      try {
        if (window.ElectronAuthStorage && typeof window.ElectronAuthStorage.clearGDriveAuth === 'function') {
          window.ElectronAuthStorage.clearGDriveAuth();
        }
      } catch (_) {}
      updateHeaderBadges();
      renderSettingsUI();
    }

    function isTokenUsable() {
      if (!gdriveToken) return false;
      if (gdriveTokenExpiresAt) return Date.now() < (gdriveTokenExpiresAt - 60 * 1000);
      if (gdriveTokenAt && Date.now() - gdriveTokenAt > 3500 * 1000) return false;
      return true;
    }

    async function ensureValidGDriveToken(opts) {
      const o = opts || {};
      const cs = getSettings();
      if (cs.syncGDriveAssets === false) return { ok: false, disabled: true };
      if (!o.force && isTokenUsable() && !gdriveNeedsReauth) {
        return { ok: true, token: gdriveToken };
      }
      if (isFileDirectOpen()) {
        return { ok: false, fileDirect: true };
      }
      const loginHint = gdriveEmail || (currentAuthUser && currentAuthUser.email) || '';
      if (!o.interactive && !currentAuthUser && !loginHint) {
        return { ok: false, noAccount: true };
      }
      if (tokenRefreshPromise) {
        const prev = await tokenRefreshPromise;
        if (prev && prev.ok && isTokenUsable()) return prev;
        if (!o.interactive) return prev || { ok: false };
      }
      const p = (async () => {
        if (typeof window.cloudReauthGDrive !== 'function') {
          return { ok: false, unavailable: true };
        }
        if (!o.skipSilent) {
          const silentOk = await window.cloudReauthGDrive({ silent: true, loginHint, quiet: true });
          if (silentOk && isTokenUsable()) {
            return { ok: true, token: gdriveToken };
          }
        }
        if (o.interactive) {
          const interOk = await window.cloudReauthGDrive({ silent: false, loginHint, quiet: true });
          if (interOk && isTokenUsable()) {
            return { ok: true, token: gdriveToken };
          }
        }
        return { ok: false, needsInteractive: true };
      })();
      tokenRefreshPromise = p;
      try { return await p; } finally { if (tokenRefreshPromise === p) tokenRefreshPromise = null; }
    }
    const restoredGDriveAuth = restoreToken();

    class DriveAuthError extends Error {
      constructor(msg) { super(msg || 'Googleドライブの認証が必要です'); this.name = 'DriveAuthError'; }
    }

    async function driveFetch(url, init, isRetry, fetchOpts) {
      if (!gdriveToken) throw new DriveAuthError('Googleドライブのアクセストークンがありません');
      const headers = new Headers((init && init.headers) || {});
      headers.set('Authorization', 'Bearer ' + gdriveToken);
      const fo = fetchOpts || {};
      const reqInit = Object.assign({}, init, { headers }, fo.signal ? { signal: fo.signal } : {});
      const res = await fetchRetry(url, reqInit, fo.signal ? 0 : 2, fo.timeoutMs || 60000);
      if (res.status === 401 || res.status === 403) {
        gdriveToken = '';
        gdriveNeedsReauth = true;
        updateHeaderBadges();
        renderSettingsUI();
        throw new DriveAuthError(`Googleドライブの認証エラー (${res.status})。再認証が必要です。`);
      }
      if (!res.ok) {
        if (res.status === 404 && !isRetry) {
          folderIds = null;
          lastFolderVerifyAt = 0;
        }
        const txt = await res.text().catch(() => '');
        const err = new Error(`Google Drive API エラー (${res.status}): ${txt.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      gdriveNeedsReauth = false;
      return res;
    }

    function resetDriveSyncCaches(opts) {
      const o = opts || {};
      if (!o.keepFolders) {
        folderIds = null;
        lastFolderVerifyAt = 0;
        try { localStorage.removeItem(GDRIVE_FOLDERS_KEY); } catch (_) {}
      }
      gdriveAssetSet = null;
      gdriveMetaSet = null;
      remoteManifest = {};
      refToSha = {};
      scenarioAssets = {};
      packManifest = {};
      remoteThumbsPackHash = '';
      unpackedThumbsPackSig = '';
      lastCloudBackupAt = 0;
      try { localStorage.removeItem('taku_last_cloud_backup_at'); } catch (_) {}
      try { localStorage.removeItem('taku_unpacked_thumbs_sig_v1'); } catch (_) {}
    }

    async function verifyDriveFolderExists(fid) {
      if (!fid) return false;
      try {
        const res = await driveFetch(`${DRIVE_API}/${encodeURIComponent(fid)}?fields=id,name,trashed`, { method: 'GET' });
        const data = await res.json();
        return !!(data && data.id && data.trashed !== true);
      } catch (e) {
        if (e && e.name === 'DriveAuthError') throw e;
        if (e && e.status === 404) return false;
        throw e;
      }
    }

    async function findOrCreateFolder(name, parentId, returnMeta) {
      const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
      const url = `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=10`;
      const res = await driveFetch(url, { method: 'GET' });
      const data = await res.json();
      if (data && Array.isArray(data.files) && data.files.length) {
        return returnMeta ? { id: data.files[0].id, created: false } : data.files[0].id;
      }
      const createRes = await driveFetch(`${DRIVE_API}?fields=id,name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId]
        })
      });
      const created = await createRes.json();
      return returnMeta ? { id: created.id, created: true } : created.id;
    }

    async function ensureDriveFolders(forceVerify) {
      if (ensureFoldersPromise) {
        const prev = await ensureFoldersPromise;
        if (!forceVerify) return prev;
      }
      const run = (async () => {
        if (!folderIds) {
          try {
            const raw = localStorage.getItem(GDRIVE_FOLDERS_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && parsed.root && DRIVE_SUBS.every(s => parsed[s])) {
                folderIds = parsed;
                lastFolderVerifyAt = 0;
              }
            }
          } catch (_) {}
        }

        if (folderIds && folderIds.root && DRIVE_SUBS.every(s => folderIds[s])) {
          const needVerify = !!forceVerify || !lastFolderVerifyAt || (Date.now() - lastFolderVerifyAt > FOLDER_VERIFY_TTL_MS);
          if (!needVerify) return folderIds;
          const idsToCheck = [folderIds.root, ...DRIVE_SUBS.map(s => folderIds[s])];
          const checks = await Promise.all(idsToCheck.map(id => verifyDriveFolderExists(id)));
          if (checks.every(Boolean)) {
            lastFolderVerifyAt = Date.now();
            return folderIds;
          }
          console.warn('[CloudSync] キャッシュ済みGoogleドライブフォルダが削除またはゴミ箱移動されたため再作成します');
          resetDriveSyncCaches();
          driveFoldersJustRecreated = true;
        }

        const rootRes = await findOrCreateFolder(DRIVE_ROOT_NAME, 'root', true);
        const subs = {};
        let anyCreated = !!rootRes.created;
        for (const s of DRIVE_SUBS) {
          const subRes = await findOrCreateFolder(s, rootRes.id, true);
          subs[s] = subRes.id;
          if (subRes.created) anyCreated = true;
        }
        folderIds = Object.assign({ root: rootRes.id }, subs);
        lastFolderVerifyAt = Date.now();
        try { localStorage.setItem(GDRIVE_FOLDERS_KEY, JSON.stringify(folderIds)); } catch (_) {}
        if (anyCreated) {
          driveFoldersJustRecreated = true;
          resetDriveSyncCaches({ keepFolders: true });
        }
        return folderIds;
      })();
      ensureFoldersPromise = run;
      try { return await run; } finally { if (ensureFoldersPromise === run) ensureFoldersPromise = null; }
    }

    async function listDriveFolderFiles(fid) {
      const map = new Map();
      let pageToken = '';
      do {
        const q = `'${fid}' in parents and trashed=false`;
        const url = `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,size,modifiedTime,appProperties)&pageSize=1000` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
        const res = await driveFetch(url, { method: 'GET' });
        const data = await res.json();
        (data.files || []).forEach(f => { if (f && f.name) map.set(f.name, f); });
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      return map;
    }

    async function uploadDriveResumable(fid, name, bytes, mime, existingId, appProps, opts) {
      const o = opts || {};
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
      const meta = existingId
        ? { name, ...(appProps ? { appProperties: appProps } : {}) }
        : { name, parents: [fid], ...(appProps ? { appProperties: appProps } : {}) };
      const initUrl = existingId
        ? `${DRIVE_UPLOAD}/${encodeURIComponent(existingId)}?uploadType=resumable&fields=id,name,size,modifiedTime,appProperties`
        : `${DRIVE_UPLOAD}?uploadType=resumable&fields=id,name,size,modifiedTime,appProperties`;
      const initMethod = existingId ? 'PATCH' : 'POST';
      const initRes = await driveFetch(initUrl, {
        method: initMethod,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mime || 'application/octet-stream',
          'X-Upload-Content-Length': String(u8.byteLength)
        },
        body: JSON.stringify(meta)
      }, false, { signal: o.signal, timeoutMs: o.timeoutMs || 60000 });
      const uploadUrl = initRes.headers.get('Location');
      if (!uploadUrl) throw new Error('Google Drive アップロードURLの取得に失敗しました');
      const putRes = await fetchRetry(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mime || 'application/octet-stream' },
        body: u8,
        ...(o.signal ? { signal: o.signal } : {})
      }, o.signal ? 0 : 2, o.timeoutMs || 120000);
      if (putRes.status === 401 || putRes.status === 403) {
        gdriveToken = '';
        gdriveNeedsReauth = true;
        updateHeaderBadges();
        renderSettingsUI();
        throw new DriveAuthError(`Google Drive アップロード認証エラー (${putRes.status})`);
      }
      if (!putRes.ok) throw new Error(`Google Drive アップロード失敗 (${putRes.status})`);
      return await putRes.json();
    }

    async function downloadDriveFile(fileId) {
      const res = await driveFetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media`, { method: 'GET' });
      return new Uint8Array(await res.arrayBuffer());
    }

    async function trashDriveFile(fileId) {
      await driveFetch(`${DRIVE_API}/${encodeURIComponent(fileId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true })
      });
    }

    // ---- 方式B：ローカル / Web File System Access API 同期フォルダ ----
    async function ensureFolderTargetReady(askWebPerm) {
      const cs = getSettings();
      if (!cs.folderSyncEnabled) return null;
      if (IS_ELECTRON) {
        const dir = cs.localSyncPath;
        if (!dir || !fs || !path) return null;
        for (const s of DRIVE_SUBS) await fs.promises.mkdir(path.join(dir, s), { recursive: true });
        return { kind: 'electron', dir };
      }
      if (!window.WebBridge) return null;
      const handle = await WebBridge.loadSyncDirHandle();
      if (!handle) return null;
      const ok = await WebBridge.ensureDirPermission(handle, !!askWebPerm);
      if (!ok) return { kind: 'web-needs-perm', handle };
      return { kind: 'web', handle };
    }

    async function listFolderSyncFiles(target, subDir) {
      const list = [];
      if (!target) return list;
      if (target.kind === 'electron') {
        try {
          const dir = path.join(target.dir, subDir);
          const names = await fs.promises.readdir(dir);
          for (const n of names) {
            try {
              const st = await fs.promises.stat(path.join(dir, n));
              if (st.isFile()) list.push({ name: n, size: st.size, mtime: st.mtimeMs });
            } catch (_) {}
          }
        } catch (_) {}
      } else if (target.kind === 'web') {
        const files = await WebBridge.listHandleFiles(target.handle, [subDir]);
        files.forEach(f => list.push(f));
      }
      return list;
    }

    async function listFolderSyncAssets(target) {
      const files = await listFolderSyncFiles(target, 'assets');
      return new Set(files.map(f => f.name));
    }

    async function listFolderSyncMeta(target) {
      const files = await listFolderSyncFiles(target, 'meta');
      return new Set(files.map(f => f.name));
    }

    function safeScenarioPackId(scId) {
      return String(scId || '').replace(/[^A-Za-z0-9_.-]/g, '_');
    }
    function getPackFileName(packType, scenarioId) {
      if (packType === 'thumbs') return 'thumbs_pack.zip';
      if (packType === 'common' || scenarioId === '_common' || scenarioId === '_settings') return 'common_library.zip';
      return `scenario_${safeScenarioPackId(scenarioId)}.zip`;
    }
    function getPackKey(packType, scenarioId) {
      if (packType === 'thumbs') return 'thumbs_pack';
      if (packType === 'common' || scenarioId === '_common' || scenarioId === '_settings') return 'common_library';
      return `scenario:${String(scenarioId || '')}`;
    }
    function extFromMimeOrName(mime, name) {
      const m = String(mime || '').toLowerCase().split(';')[0].trim();
      const byMime = {
        'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
        'image/gif': '.gif', 'image/bmp': '.bmp', 'image/svg+xml': '.svg',
        'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
        'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/webm': '.weba',
        'application/pdf': '.pdf', 'application/zip': '.zip', 'application/json': '.json',
        'text/plain': '.txt', 'video/mp4': '.mp4', 'video/webm': '.webm'
      };
      if (byMime[m]) return byMime[m];
      const base = String(name || '').split(/[?#]/)[0];
      const dot = base.lastIndexOf('.');
      if (dot >= 0 && base.length - dot <= 8) {
        const ext = base.slice(dot).toLowerCase();
        if (/^\.[a-z0-9]+$/.test(ext)) return ext;
      }
      return '';
    }
    function isAlreadyCompressedEntry(entryName, mime) {
      const n = String(entryName || '').toLowerCase();
      const m = String(mime || '').toLowerCase();
      return /\.(webp|png|jpe?g|gif|mp3|ogg|m4a|aac|flac|mp4|webm|zip|7z|rar)$/i.test(n) ||
        /^(?:image\/(?:webp|png|jpeg|gif)|audio\/(?:mpeg|mp3|ogg|mp4|aac|flac)|video\/|application\/zip)/i.test(m);
    }
    async function zipBytesFromEntries(entries) {
      if (!window.WebBridge || typeof window.WebBridge.buildZipBlob !== 'function') {
        throw new Error('ZIPビルダー (WebBridge.buildZipBlob) が利用できません');
      }
      const blob = await window.WebBridge.buildZipBlob(entries);
      return new Uint8Array(await blob.arrayBuffer());
    }
    async function readZipEntries(u8) {
      if (!window.WebBridge || typeof window.WebBridge.readZip !== 'function') {
        throw new Error('ZIPリーダー (WebBridge.readZip) が利用できません');
      }
      return await window.WebBridge.readZip(u8);
    }

    async function writeFolderSyncFile(target, relParts, bytes) {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
      if (target.kind === 'electron') {
        const full = path.join(target.dir, ...relParts);
        await fs.promises.mkdir(path.dirname(full), { recursive: true });
        const tmp = full + '.tmp_' + Date.now();
        await fs.promises.writeFile(tmp, u8);
        await fs.promises.rename(tmp, full);
      } else if (target.kind === 'web') {
        await WebBridge.writeHandleFile(target.handle, relParts, u8);
      }
    }

    async function readFolderSyncFile(target, relParts) {
      if (!target) return null;
      if (target.kind === 'electron') {
        const full = path.join(target.dir, ...relParts);
        try { await fs.promises.access(full); } catch (_) { return null; }
        return await window.readCloudFileAsync(full);
      }
      if (target.kind === 'web') {
        return await WebBridge.readHandleFile(target.handle, relParts);
      }
      return null;
    }

    async function deleteFolderSyncFile(target, relParts) {
      if (!target) return false;
      if (target.kind === 'electron') {
        try {
          await fs.promises.unlink(path.join(target.dir, ...relParts));
          return true;
        } catch (_) { return false; }
      }
      if (target.kind === 'web' && target.handle) {
        try {
          let dir = target.handle;
          for (let i = 0; i < relParts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(relParts[i], { create: false });
          }
          await dir.removeEntry(relParts[relParts.length - 1]);
          return true;
        } catch (_) { return false; }
      }
      return false;
    }

    // ---- cloud-asset:// 仮想参照 & ローカルキャッシュ管理 ----
    const CLOUD_ASSET_RE = /^cloud-asset:\/\/([0-9a-f]{64})(?:\/(.*))?$/i;
    function isCloudAssetRef(p) { return CLOUD_ASSET_RE.test(String(p || '').trim()); }
    function parseCloudAssetRef(p) {
      const m = String(p || '').trim().match(CLOUD_ASSET_RE);
      if (!m) return null;
      let name = m[2] || m[1];
      try { name = decodeURIComponent(name); } catch (_) {}
      return { sha256: m[1].toLowerCase(), name };
    }
    function cloudCacheDir() {
      if (!IS_ELECTRON || !DATA_ROOT || !path) return '';
      const d = path.join(DATA_ROOT, 'cloud_cache');
      try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
      return d;
    }
    function idbStoreKeyForAssetRef(ref) {
      const s = String(ref || '').trim();
      if (/^idb-asset:\/\//i.test(s)) return s.slice('idb-asset://'.length).split('/')[0];
      return s;
    }

    async function loadLocalCacheInventory() {
      const nextSet = new Set();
      try {
        if (typeof window.idbGetRaw === 'function') {
          const savedMeta = await window.idbGetRaw(IDB_ASSET_META_KV_KEY);
          if (savedMeta && typeof savedMeta === 'object') idbAssetMeta = savedMeta;
        }
      } catch (_) {}
      try {
        if (typeof idbOpen === 'function') {
          const db = await idbOpen();
          const keys = await new Promise((res, rej) => {
            const req = db.transaction('assets').objectStore('assets').getAllKeys();
            req.onsuccess = () => res(req.result || []);
            req.onerror = () => rej(req.error);
          });
          keys.forEach(k => {
            const ks = String(k || '');
            if (ks.startsWith('cloud_')) nextSet.add(ks.slice(6).toLowerCase());
            else if (/^[0-9a-f]{64}$/i.test(ks)) nextSet.add(ks.toLowerCase());
            else {
              nextSet.add('idb:' + ks);
              const meta = idbAssetMeta['idb-asset://' + ks] || idbAssetMeta[ks];
              if (meta && meta.sha256) nextSet.add(String(meta.sha256).toLowerCase());
            }
          });
        }
      } catch (_) {}
      if (IS_ELECTRON && fs && DATA_ROOT && path) {
        try {
          const dir = path.join(DATA_ROOT, 'cloud_cache');
          if (fs.existsSync(dir)) {
            const names = await fs.promises.readdir(dir);
            names.forEach(n => {
              if (/^[0-9a-f]{64}$/i.test(n)) nextSet.add(n.toLowerCase());
            });
          }
        } catch (_) {}
      }
      localCloudAssetSet = nextSet;
    }

    async function persistIdbAssetMeta() {
      if (typeof window.idbSetRaw === 'function') {
        try { await window.idbSetRaw(IDB_ASSET_META_KV_KEY, idbAssetMeta); } catch (_) {}
      }
    }

    async function writeLocalCloudCacheBytes(sha256, bytes, opts) {
      const sha = String(sha256 || '').toLowerCase();
      if (!sha || !bytes) return;
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (IS_ELECTRON && fs && DATA_ROOT && path) {
        const dir = cloudCacheDir();
        if (dir) {
          const full = path.join(dir, sha);
          const tmp = full + '.tmp_' + Date.now();
          await fs.promises.writeFile(tmp, u8);
          await fs.promises.rename(tmp, full);
        }
      } else if (typeof idbPut === 'function') {
        const o = opts || {};
        const mime = o.mime || (window.WebBridge ? WebBridge.mimeFromName(o.name || '') : 'application/octet-stream');
        const blob = new Blob([u8], { type: mime });
        await idbPut('assets', 'cloud_' + sha, { id: 'cloud_' + sha, name: o.name || sha, mime, size: u8.byteLength, mtime: Date.now(), blob, isCloudCache: true });
      }
      localCloudAssetSet.add(sha);
    }

    async function readLocalCloudCacheBytes(sha256) {
      const sha = String(sha256 || '').toLowerCase();
      if (!sha) return null;
      if (IS_ELECTRON && fs && DATA_ROOT && path) {
        const full = path.join(DATA_ROOT, 'cloud_cache', sha);
        try {
          await fs.promises.access(full);
          const buf = await fs.promises.readFile(full);
          localCloudAssetSet.add(sha);
          return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
        } catch (_) {}
      }
      if (typeof idbGet === 'function') {
        try {
          const rec = await idbGet('assets', 'cloud_' + sha);
          const blob = rec && (rec.blob || (rec instanceof Blob ? rec : null));
          if (blob && typeof blob.arrayBuffer === 'function') {
            localCloudAssetSet.add(sha);
            return new Uint8Array(await blob.arrayBuffer());
          }
        } catch (_) {}
      }
      return null;
    }

    async function deleteLocalCloudCacheBytes(sha256) {
      const sha = String(sha256 || '').toLowerCase();
      if (!sha) return false;
      let removed = false;
      if (IS_ELECTRON && fs && DATA_ROOT && path) {
        const full = path.join(DATA_ROOT, 'cloud_cache', sha);
        try {
          if (fs.existsSync(full)) { await fs.promises.unlink(full); removed = true; }
        } catch (_) {}
      }
      if (typeof idbDel === 'function') {
        try {
          const rec = await idbGet('assets', 'cloud_' + sha);
          if (rec) { await idbDel('assets', 'cloud_' + sha); removed = true; }
        } catch (_) {}
      }
      localCloudAssetSet.delete(sha);
      return removed;
    }

    // ---- SHA-256 キャッシュ & バイナリ解決（WebP軽量圧縮 / ZIP未解凍保管含む） ----
    async function ensureShaCache() {
      if (shaCache) return shaCache;
      shaCache = new Map();
      try {
        if (typeof window.idbGetRaw === 'function') {
          const saved = await window.idbGetRaw(SHA_CACHE_KV_KEY);
          if (saved && typeof saved === 'object') {
            Object.entries(saved).forEach(([k, v]) => {
              if (v && v.sha256) {
                shaCache.set(k, v);
                const refPart = k.split('|')[0];
                if (refPart) pathToShaMap.set(refPart, v);
              }
            });
          }
        }
      } catch (_) {}
      return shaCache;
    }
    async function persistShaCache() {
      if (!shaCache || typeof window.idbSetRaw !== 'function') return;
      try {
        if (shaCache.size > 4000) {
          const entries = [...shaCache.entries()].slice(-3000);
          shaCache = new Map(entries);
        }
        await window.idbSetRaw(SHA_CACHE_KV_KEY, Object.fromEntries(shaCache));
      } catch (_) {}
    }
    function lookupShaForRef(ref) {
      const s = String(ref || '').trim();
      if (!s) return null;
      if (isCloudAssetRef(s)) {
        const p = parseCloudAssetRef(s);
        return p ? { sha256: p.sha256, name: p.name } : null;
      }
      const rHit = refToSha[s];
      if (rHit && rHit.fullSha) return { sha256: rHit.fullSha, name: rHit.name, mime: rHit.mime, size: rHit.size };
      if (pathToShaMap.has(s)) return pathToShaMap.get(s);
      const idbKey = s.startsWith('idb-asset://') ? ('idbAsset|' + s) : '';
      if (idbKey && pathToShaMap.has(idbKey)) return pathToShaMap.get(idbKey);
      return null;
    }

    async function resolveSourceBytes(item, compressWebp) {
      let rawBytes = null;
      let mime = item.mime || (window.WebBridge ? WebBridge.mimeFromName(item.name) : 'application/octet-stream');
      const origMime = mime;
      const shouldCompressWebp = !!(compressWebp && window.CloudCodec && /^image\//i.test(mime) && !/webp|svg|gif/i.test(mime));
      if (item.sourceType === 'idbImg') {
        const blob = window.idbImageBlob ? await window.idbImageBlob(item.sourceRef) : null;
        if (blob) {
          mime = blob.type || mime || 'image/png';
          if (compressWebp && window.CloudCodec && !/webp|svg|gif/i.test(mime)) {
            const c = await window.CloudCodec.compressImageToWebp(blob, mime, { quality: 0.9 });
            rawBytes = c.bytes; mime = c.mime;
          } else {
            rawBytes = new Uint8Array(await blob.arrayBuffer());
          }
        } else if (item.sha256) {
          rawBytes = await readLocalCloudCacheBytes(item.sha256);
        }
      } else if (item.sourceType === 'thumbWebp') {
        let tb = window.idbThumbBlob ? await window.idbThumbBlob(item.sourceRef) : null;
        if (!tb && item.fallbackUrl && item.fallbackUrl.startsWith('data:image/')) {
          tb = dataURLtoBlob(item.fallbackUrl);
        }
        if (!tb) return null;
        if (window.CloudCodec) {
          const c = await window.CloudCodec.makeCardThumbWebp(tb, tb.type || 'image/png');
          rawBytes = c.bytes; mime = 'image/webp';
        } else {
          rawBytes = new Uint8Array(await tb.arrayBuffer());
        }
      } else if (item.sourceType === 'thumbAsset') {
        if (!window.WebBridge) return null;
        const rec = await WebBridge.getAssetRecord(item.sourceRef);
        if (!rec || !rec.blob) return null;
        if (window.CloudCodec) {
          const c = await window.CloudCodec.makeCardThumbWebp(rec.blob, rec.mime || 'image/png');
          rawBytes = c.bytes; mime = 'image/webp';
        } else {
          rawBytes = new Uint8Array(await rec.blob.arrayBuffer());
          mime = rec.mime || mime;
        }
      } else if (item.sourceType === 'thumbFsPath') {
        if (!IS_ELECTRON || !fs) return null;
        const srcU8 = await window.readCloudFileAsync(item.sourceRef);
        if (!srcU8) return null;
        if (window.CloudCodec) {
          const c = await window.CloudCodec.makeCardThumbWebp(srcU8, mime || 'image/png');
          rawBytes = c.bytes; mime = 'image/webp';
        } else {
          rawBytes = srcU8;
        }
      } else if (item.sourceType === 'thumbCloudSha') {
        const srcU8 = await readLocalCloudCacheBytes(item.sourceRef);
        if (!srcU8) return null;
        if (window.CloudCodec) {
          const c = await window.CloudCodec.makeCardThumbWebp(srcU8, mime || 'image/png');
          rawBytes = c.bytes; mime = 'image/webp';
        } else {
          rawBytes = srcU8;
        }
      } else if (item.sourceType === 'idbAsset') {
        if (!window.WebBridge) return null;
        const rec = await WebBridge.getAssetRecord(item.sourceRef);
        if (rec && rec.blob) {
          mime = rec.mime || mime;
          if (compressWebp && /^image\//i.test(mime) && !/webp|svg|gif/i.test(mime) && window.CloudCodec) {
            const c = await window.CloudCodec.compressImageToWebp(rec.blob, mime, { quality: 0.9 });
            rawBytes = c.bytes; mime = c.mime;
          } else {
            rawBytes = new Uint8Array(await rec.blob.arrayBuffer());
          }
        } else if (item.sha256) {
          rawBytes = await readLocalCloudCacheBytes(item.sha256);
        }
      } else if (item.sourceType === 'fsPath') {
        if (!IS_ELECTRON || !fs) return null;
        rawBytes = await window.readCloudFileAsync(item.sourceRef);
        if (shouldCompressWebp) {
          const c = await window.CloudCodec.compressImageToWebp(rawBytes, mime, { quality: 0.9 });
          rawBytes = c.bytes; mime = c.mime;
        }
      } else if (item.sourceType === 'dataUrl') {
        const blob = dataURLtoBlob(item.sourceRef);
        mime = blob.type || mime;
        if (compressWebp && /^image\//i.test(mime) && !/webp|svg|gif/i.test(mime) && window.CloudCodec) {
          const c = await window.CloudCodec.compressImageToWebp(blob, mime, { quality: 0.9 });
          rawBytes = c.bytes; mime = c.mime;
        } else {
          rawBytes = new Uint8Array(await blob.arrayBuffer());
        }
      }
      if (!rawBytes && item.sha256) {
        rawBytes = await readLocalCloudCacheBytes(item.sha256);
      }
      if (!rawBytes) return null;
      const sha256 = await window.CloudCodec.sha256Hex(rawBytes);
      return { bytes: rawBytes, mime, origMime, sha256 };
    }

    async function isItemLocallyAvailable(item, shaHint) {
      if (!item) return false;
      if (item.sourceType === 'idbImg') {
        if (typeof window.hasLocalImageHashAsync === 'function' && await window.hasLocalImageHashAsync(item.sourceRef)) return true;
        return !!(shaHint && localCloudAssetSet.has(String(shaHint).toLowerCase()));
      }
      if (item.sourceType === 'thumbWebp') {
        if (typeof window.hasLocalThumbHashAsync === 'function' && await window.hasLocalThumbHashAsync(item.sourceRef)) return true;
        if (typeof window.hasLocalImageHashAsync === 'function' && await window.hasLocalImageHashAsync(item.sourceRef)) return true;
        return !!(shaHint && (thumbsPackMemMap.has(item.sourceRef) || thumbsPackMemMap.has(String(shaHint).toLowerCase()) || localCloudAssetSet.has(String(shaHint).toLowerCase())));
      }
      if (item.sourceType === 'idbAsset' || item.sourceType === 'thumbAsset') {
        if (window.WebBridge && await WebBridge.hasAsset(item.sourceRef)) return true;
        return !!(shaHint && localCloudAssetSet.has(String(shaHint).toLowerCase()));
      }
      if (item.sourceType === 'fsPath' || item.sourceType === 'thumbFsPath') {
        if (IS_ELECTRON && fs && fs.existsSync(item.sourceRef)) return true;
        return !!(shaHint && localCloudAssetSet.has(String(shaHint).toLowerCase()));
      }
      if (item.sourceType === 'thumbCloudSha') {
        return localCloudAssetSet.has(String(item.sourceRef || '').toLowerCase());
      }
      if (item.sourceType === 'dataUrl') return true;
      return !!(shaHint && localCloudAssetSet.has(String(shaHint).toLowerCase()));
    }

    async function computeAssetFingerprint(item, compressWebp) {
      await ensureShaCache();
      let statSig = '';
      if ((item.sourceType === 'fsPath' || item.sourceType === 'thumbFsPath') && IS_ELECTRON && fs) {
        try {
          const st = await fs.promises.stat(item.sourceRef);
          statSig = `${item.sourceType === 'thumbFsPath' ? 'tfs|' : ''}${item.sourceRef}|${st.size}|${Math.floor(st.mtimeMs)}|w:${compressWebp ? 1 : 0}`;
        } catch (_) { return null; }
      } else if (item.sourceType === 'idbImg') {
        statSig = `idbImg|${item.sourceRef}|w:${compressWebp ? 1 : 0}`;
      } else if (item.sourceType === 'thumbWebp') {
        statSig = `thumb|${item.sourceRef}`;
      } else if (item.sourceType === 'thumbCloudSha') {
        statSig = `thumbCloud|${item.sourceRef}`;
      } else if ((item.sourceType === 'idbAsset' || item.sourceType === 'thumbAsset') && window.WebBridge) {
        const rec = await WebBridge.getAssetRecord(item.sourceRef).catch(() => null);
        if (!rec) return null;
        statSig = `${item.sourceType === 'thumbAsset' ? 'ta|' : 'idbAsset|'}|${rec.id}|${rec.size}|${rec.mtime}|w:${compressWebp ? 1 : 0}`;
      }
      if (statSig && shaCache.has(statSig)) {
        const cached = shaCache.get(statSig);
        if (item.sourceRef) pathToShaMap.set(item.sourceRef, { ...cached, name: item.name });
        return { ...cached, cacheKey: statSig };
      }
      let res = null;
      try {
        res = await resolveSourceBytes(item, compressWebp);
      } catch (e) {
        console.warn('[CloudSync] computeAssetFingerprint skip:', item.name, e);
        return null;
      }
      if (!res) return null;
      const entry = { sha256: res.sha256, mime: res.mime, origMime: res.origMime || res.mime, size: res.bytes.byteLength };
      if (statSig) shaCache.set(statSig, entry);
      if (item.sourceRef) pathToShaMap.set(item.sourceRef, { ...entry, name: item.name });
      return { ...entry, bytes: res.bytes, cacheKey: statSig };
    }

    // ---- スマート同期・アップロード範囲判定 ----
    function hasPreparedCcfoliaRoom(sc) {
      if (!sc || !Array.isArray(sc.ccfRooms) || !sc.ccfRooms.length) return false;
      if (sc.ccfRooms.length > 1) return true;
      return sc.ccfRooms.some(r => {
        const p = r && r.project;
        if (!p || typeof p !== 'object') return false;
        const hasBoardPieces = !!(p.board && Array.isArray(p.board.pieces) && p.board.pieces.length > 0);
        const gd = p.globalDecor;
        const hasDecor = !!(gd && (gd.bg || gd.fg || (Array.isArray(gd.screens) && gd.screens.length > 0) || (Array.isArray(gd.markers) && gd.markers.length > 0)));
        return !!(
          (Array.isArray(p.stocks) && p.stocks.length > 0) ||
          (Array.isArray(p.npcs) && p.npcs.length > 0) ||
          (Array.isArray(p.scenes) && p.scenes.length > 0) ||
          (Array.isArray(p.cutins) && p.cutins.length > 0) ||
          (Array.isArray(p.bookmarks) && p.bookmarks.length > 0) ||
          hasBoardPieces ||
          hasDecor
        );
      });
    }
    function isScenarioAssetsEligible(sc, cs) {
      if (!sc || typeof sc !== 'object') return false;
      if (cs.uploadScope === 'all') return true;
      return !!(
        sc.cloudKeepAssets ||
        sc.pinnedOffline ||
        isScenarioPinned(sc.id) ||
        sc.detailEdited ||
        hasPreparedCcfoliaRoom(sc) ||
        (Array.isArray(sc.secretHOs) && sc.secretHOs.length > 0)
      );
    }

    function computeCommonAssetUsage() {
      const commonList = Array.isArray(appState.imageAssets) ? appState.imageAssets : [];
      const byRef = new Map();
      commonList.forEach(a => {
        if (!a || typeof a !== 'object') return;
        const keys = [a.id, a.dataUrl, a.path, a.rel, a.ref, a.name].filter(Boolean).map(String);
        keys.forEach(k => {
          if (!byRef.has(k)) byRef.set(k, new Set());
          byRef.get(k).add(a.id || k);
        });
      });
      const usageMap = new Map(); // commonId -> Set<scenarioId>
      const addHit = (val, scId) => {
        if (!val || typeof val !== 'string') return;
        const hits = byRef.get(val);
        if (!hits) return;
        hits.forEach(cid => {
          if (!usageMap.has(cid)) usageMap.set(cid, new Set());
          usageMap.get(cid).add(scId);
        });
      };
      const scanRoomTree = (node, scId) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(x => scanRoomTree(x, scId)); return; }
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (typeof v === 'string') addHit(v, scId);
          else if (v && typeof v === 'object') scanRoomTree(v, scId);
        }
      };
      (appState.scenarios || []).forEach(sc => {
        if (!sc || !sc.id) return;
        if (Array.isArray(sc.ccfRooms)) scanRoomTree(sc.ccfRooms, sc.id);
        if (Array.isArray(sc.images)) scanRoomTree(sc.images, sc.id);
      });
      if (Array.isArray(appState.unlinkedCcfRooms)) scanRoomTree(appState.unlinkedCcfRooms, '_default');
      return usageMap;
    }

    function pushCandidate(candidates, seenKeys, item) {
      if (!item || !item.sourceRef) return;
      const k = `${item.sourceType}:${item.sourceRef}:${item.isThumb ? 'T' : 'F'}`;
      if (seenKeys.has(k)) return;
      seenKeys.add(k);
      candidates.push(item);
    }

    function refToCandidate(val, nameHint, scenarioId, isThumb, extra) {
      if (!val || typeof val !== 'string') return null;
      const ex = extra || {};
      if (val.startsWith('@img:')) {
        const h = val.slice(5);
        return { sourceType: isThumb ? 'thumbWebp' : 'idbImg', sourceRef: h, refKey: val, name: nameHint || (h + '.webp'), scenarioId, isThumb: !!isThumb, kind: ex.kind || 'image', rel: ex.rel || '' };
      }
      if (val.startsWith('blob:')) {
        const h = typeof imgUrlToHash !== 'undefined' ? imgUrlToHash.get(val) : '';
        if (h) return { sourceType: isThumb ? 'thumbWebp' : 'idbImg', sourceRef: h, refKey: '@img:' + h, name: nameHint || (h + '.webp'), scenarioId, isThumb: !!isThumb, kind: ex.kind || 'image', rel: ex.rel || '' };
      }
      if (val.startsWith('data:image/')) {
        if (typeof hashStr === 'function') {
          const h = typeof urlToRef === 'function' ? urlToRef(val) : '';
          if (h && h.startsWith('@img:')) {
            return { sourceType: isThumb ? 'thumbWebp' : 'idbImg', sourceRef: h.slice(5), refKey: h, name: nameHint || 'image.webp', scenarioId, isThumb: !!isThumb, kind: ex.kind || 'image', rel: ex.rel || '' };
          }
        }
        return { sourceType: 'dataUrl', sourceRef: val, refKey: '', name: nameHint || 'image.png', scenarioId, isThumb: !!isThumb, kind: ex.kind || 'image', rel: ex.rel || '' };
      }
      if (window.WebBridge && WebBridge.isAssetRef(val)) {
        return { sourceType: isThumb ? 'thumbAsset' : 'idbAsset', sourceRef: val, refKey: val, name: nameHint || WebBridge.assetBasename(val), scenarioId, isThumb: !!isThumb, kind: ex.kind || 'asset', rel: ex.rel || '' };
      }
      if (isThumb && isCloudAssetRef(val)) {
        const p = parseCloudAssetRef(val);
        if (p) return { sourceType: 'thumbCloudSha', sourceRef: p.sha256, refKey: val, name: nameHint || p.name, scenarioId, isThumb: true, kind: 'thumb', rel: ex.rel || '' };
      }
      if (IS_ELECTRON && path && /^([A-Za-z]:[\\/]|\\\\|\/)/.test(val) && !/^zipview:/i.test(val)) {
        return { sourceType: isThumb ? 'thumbFsPath' : 'fsPath', sourceRef: val, refKey: val, name: nameHint || path.basename(val), scenarioId, isThumb: !!isThumb, kind: ex.kind || 'file', rel: ex.rel || '' };
      }
      return null;
    }

    function collectSyncCandidates(cs) {
      const candidates = [];
      const seenKeys = new Set();
      const usageMap = computeCommonAssetUsage();

      if (appState.botAvatarData) {
        pushCandidate(candidates, seenKeys, refToCandidate(appState.botAvatarData, 'bot_avatar.webp', '_common', false, { kind: 'image' }));
      }

      // 1) 全シナリオの表紙・ホバーサムネイルは常に軽量WebP同期 (meta/thumbs_pack.zip)
      (appState.scenarios || []).forEach(sc => {
        if (!sc) return;
        const thumbList = [sc.imageUrl, ...(Array.isArray(sc.hoverImages) ? sc.hoverImages : [])].filter(Boolean);
        thumbList.forEach((srcUrl, idx) => {
          const suffix = idx === 0 ? 'thumb.webp' : `hover_${idx}_thumb.webp`;
          const c = refToCandidate(srcUrl, `${sc.title || sc.id}_${suffix}`, sc.id, true, { kind: 'thumb' });
          if (c) pushCandidate(candidates, seenKeys, c);
        });
        if (!isScenarioAssetsEligible(sc, cs)) return;

        // 2) 対象シナリオの実体ファイル（画像・資料・ZIP未解凍・部屋素材）
        if (sc.imageUrl) pushCandidate(candidates, seenKeys, refToCandidate(sc.imageUrl, 'cover.png', sc.id, false, { kind: 'image' }));
        (sc.hoverImages || []).forEach((u, idx) => pushCandidate(candidates, seenKeys, refToCandidate(u, `hover_${idx}.png`, sc.id, false, { kind: 'image' })));
        (sc.images || []).forEach(im => {
          if (!im) return;
          pushCandidate(candidates, seenKeys, refToCandidate(im.dataUrl || im.path || im.rel, im.name || 'asset', sc.id, false, { kind: 'image' }));
          if (IS_ELECTRON && im.rel && DATA_ROOT && path) {
            pushCandidate(candidates, seenKeys, refToCandidate(path.resolve(DATA_ROOT, im.rel), im.name, sc.id, false, { kind: 'image', rel: im.rel }));
          }
        });
        (sc.docs || []).forEach(d => {
          if (!d) return;
          if (d.ref) pushCandidate(candidates, seenKeys, refToCandidate(d.ref, d.name, sc.id, false, { kind: 'doc', rel: d.rel || '' }));
          if (d.path) pushCandidate(candidates, seenKeys, refToCandidate(d.path, d.name, sc.id, false, { kind: 'doc', rel: d.rel || '' }));
          if (IS_ELECTRON && d.rel && DATA_ROOT && path) {
            pushCandidate(candidates, seenKeys, refToCandidate(path.resolve(DATA_ROOT, d.rel), d.name, sc.id, false, { kind: 'doc', rel: d.rel }));
          }
        });
        if (sc.sourcePath && /\.zip$/i.test(sc.sourcePath)) {
          pushCandidate(candidates, seenKeys, refToCandidate(sc.sourcePath, path ? path.basename(sc.sourcePath) : 'archive.zip', sc.id, false, { kind: 'zip' }));
        }
        const scanAnyRefs = obj => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) { obj.forEach(scanAnyRefs); return; }
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (typeof v === 'string') {
              const kindHint = (k === 'sePath' || k === 'seDataUrl' || obj.type === 'audio') ? 'audio'
                : (obj.type === 'pdf' ? 'pdf' : (obj.type === 'zip' ? 'zip' : 'asset'));
              if (v.startsWith('@img:') || v.startsWith('blob:') || v.startsWith('data:image/') || v.startsWith('idb-asset://')) {
                pushCandidate(candidates, seenKeys, refToCandidate(v, obj.name || obj.seName || k, sc.id, false, { kind: kindHint }));
              } else if (IS_ELECTRON && (k === 'path' || k === 'filePath' || k === 'sePath' || k === 'imgPath') && /^([A-Za-z]:[\\/]|\\\\|\/)/.test(v)) {
                pushCandidate(candidates, seenKeys, refToCandidate(v, obj.name || obj.seName || '', sc.id, false, { kind: kindHint }));
              }
            } else if (v && typeof v === 'object') {
              scanAnyRefs(v);
            }
          }
        };
        if (Array.isArray(sc.fullBlockData)) scanAnyRefs(sc.fullBlockData);
        if (Array.isArray(sc.secretHOs)) scanAnyRefs(sc.secretHOs);
        if (Array.isArray(sc.ccfRooms)) scanAnyRefs(sc.ccfRooms);
      });

      // 3) マイライブラリ（共通素材）：部屋割当済み または 「☁️常時持ち歩く」のみ実体アップロード
      (appState.imageAssets || []).forEach(a => {
        if (!a || typeof a !== 'object') return;
        const usedSc = usageMap.get(a.id);
        a._usedInScenarios = usedSc ? [...usedSc] : [];
        const isAssigned = !!(usedSc && usedSc.size > 0);
        if (!isAssigned && !a.cloudAlwaysCarry) return;
        const src = a.dataUrl || a.ref || a.path || (IS_ELECTRON && a.rel && DATA_ROOT && path ? path.resolve(DATA_ROOT, a.rel) : '');
        pushCandidate(candidates, seenKeys, refToCandidate(src, a.name || 'common_asset', '_common', false, { kind: a.type || 'common' }));
      });

      return { candidates, usageMap };
    }

    // ---- 差分キュー永続化 & ワーカー（ZIPパック単位） ----
    async function loadPersistedQueue() {
      if (queueLoaded) return cloudUploadQueue;
      queueLoaded = true;
      try {
        if (typeof window.idbGetRaw === 'function') {
          const arr = await window.idbGetRaw(QUEUE_KV_KEY);
          if (Array.isArray(arr)) {
            cloudUploadQueue = arr.filter(q => q && q.packType && q.packKey);
          }
        }
      } catch (_) {}
      updateHeaderBadges();
      return cloudUploadQueue;
    }
    async function savePersistedQueue() {
      try { localStorage.setItem('taku_cloud_queue_len', String(cloudUploadQueue.length)); } catch (_) {}
      if (typeof window.idbSetRaw === 'function') {
        try { await window.idbSetRaw(QUEUE_KV_KEY, cloudUploadQueue); } catch (_) {}
      }
      updateHeaderBadges();
      updateExitModalProgress();
    }
    async function purgeUploadQueue(opts) {
      await loadPersistedQueue();
      if (!cloudUploadQueue.length) return 0;
      if (typeof appState === 'undefined' || !Array.isArray(appState.scenarios)) return 0;
      const cs = getSettings();
      const liveScIds = new Set((appState.scenarios || []).filter(Boolean).map(s => String(s.id)));
      const eligibleScIds = new Set((appState.scenarios || []).filter(s => isScenarioAssetsEligible(s, cs)).map(s => String(s.id)));
      const before = cloudUploadQueue.length;
      const seenPack = new Set();

      cloudUploadQueue = cloudUploadQueue.filter(q => {
        if (!q || !q.packType || !q.packKey) return false;
        if (q.packType === 'scenario') {
          const sid = String(q.scenarioId || '');
          if (!sid || !liveScIds.has(sid)) return false;
          if (cs.uploadScope !== 'all' && !eligibleScIds.has(sid)) return false;
        }
        if (seenPack.has(q.packKey)) return false;
        seenPack.add(q.packKey);
        return true;
      });
      const removed = before - cloudUploadQueue.length;
      if (removed > 0) {
        if (opts && opts.skipSave) {
          try { localStorage.setItem('taku_cloud_queue_len', String(cloudUploadQueue.length)); } catch (_) {}
          updateHeaderBadges();
          updateExitModalProgress();
        } else {
          await savePersistedQueue();
        }
      }
      return removed;
    }

    async function resetUploadQueue() {
      queueResetGen++;
      cloudUploadQueue = [];
      queueLoaded = true;
      try { localStorage.setItem('taku_cloud_queue_len', '0'); } catch (_) {}
      if (typeof window.idbSetRaw === 'function') {
        try { await window.idbSetRaw(QUEUE_KV_KEY, []); } catch (_) {}
      }
      updateHeaderBadges();
      updateExitModalProgress();
      renderSettingsUI();
      if (typeof toast === 'function') toast('🧹 未送信の同期キューをリセットしました（0件）');
      return 0;
    }

    function buildCloudMetadataPayload(usageMap) {
      const stateCopy = window.getAppStateForSync ? window.getAppStateForSync({ forCloud: true }) : JSON.parse(serializeState(appState));
      const libUsage = {};
      if (usageMap) usageMap.forEach((set, id) => { libUsage[id] = [...set]; });
      const payload = {
        schemaVersion: 2,
        exportedAt: Date.now(),
        appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'test49',
        state: stateCopy,
        libraryMeta: {
          categories: appState.imageCategories || [],
          assets: (appState.imageAssets || []).map(a => ({
            id: a.id,
            name: a.name,
            category: a.category,
            tags: a.tags || [],
            cloudAlwaysCarry: !!a.cloudAlwaysCarry,
            usedInScenarios: libUsage[a.id] || []
          })),
          cutinPackages: appState.ccfCutinPackages || []
        }
      };
      return payload;
    }

    async function loadManifestCache() {
      try {
        if (typeof window.idbGetRaw === 'function') {
          const cached = await window.idbGetRaw(MANIFEST_KV_KEY);
          if (cached && typeof cached === 'object') {
            if (cached.files) Object.assign(remoteManifest, cached.files);
            if (cached.refToSha) Object.assign(refToSha, cached.refToSha);
            if (cached.scenarioAssets) Object.assign(scenarioAssets, cached.scenarioAssets);
            if (cached.packs) Object.assign(packManifest, cached.packs);
            if (cached.thumbsPackHash) remoteThumbsPackHash = String(cached.thumbsPackHash);
          }
        }
      } catch (_) {}
    }
    async function saveManifestCache() {
      if (typeof window.idbSetRaw === 'function') {
        try {
          await window.idbSetRaw(MANIFEST_KV_KEY, {
            updatedAt: Date.now(),
            files: remoteManifest,
            refToSha,
            scenarioAssets,
            packs: packManifest,
            thumbsPackHash: remoteThumbsPackHash
          });
        } catch (_) {}
      }
    }

    // ---- クラウド側 3世代ローテーションバックアップ ----
    function countTotalRooms(st) {
      let n = Array.isArray(st && st.unlinkedCcfRooms) ? st.unlinkedCcfRooms.length : 0;
      ((st && st.scenarios) || []).forEach(sc => { if (sc && Array.isArray(sc.ccfRooms)) n += sc.ccfRooms.length; });
      return n;
    }
    function sameDayYmd(tsA, tsB) {
      if (!tsA || !tsB) return false;
      const a = new Date(tsA), b = new Date(tsB);
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    async function saveCloudBackupRotation(targets, payload, force) {
      const now = Date.now();
      if (!force && lastCloudBackupAt && (now - lastCloudBackupAt < BACKUP_ROTATE_THROTTLE_MS)) return;
      const scCount = Array.isArray(payload && payload.state && payload.state.scenarios) ? payload.state.scenarios.length : 0;
      const roomCount = countTotalRooms(payload && payload.state);
      const snapObj = {
        schemaVersion: 2,
        savedAt: now,
        scenarioCount: scCount,
        roomCount,
        state: payload.state,
        libraryMeta: payload.libraryMeta
      };
      const gz = await window.CloudCodec.gzipCompress(JSON.stringify(snapObj));

      const updateTargetBackups = async (readFn, writeFn, readIndexFn, writeIndexFn) => {
        let idx = (await readIndexFn()) || { gens: {} };
        const g1 = idx.gens && idx.gens['1'];
        const g2 = idx.gens && idx.gens['2'];
        const g3 = idx.gens && idx.gens['3'];

        // 2 -> 3（前日分または過去世代を残す。3が無い場合や2が別日/12h超の場合は3へ繰り下げ）
        if (g2) {
          const shouldRotate3 = !g3 || !sameDayYmd(g2.savedAt, now) || (now - (g3.savedAt || 0) >= 12 * 3600 * 1000);
          if (shouldRotate3) {
            const b2 = await readFn('backup_2.json.gz');
            if (b2) {
              await writeFn('backup_3.json.gz', b2, { savedAt: String(g2.savedAt || 0), scenarioCount: String(g2.scenarioCount || 0) });
              idx.gens['3'] = { ...g2, gen: 3 };
            }
          }
        }
        // 1 -> 2
        if (g1) {
          const b1 = await readFn('backup_1.json.gz');
          if (b1) {
            await writeFn('backup_2.json.gz', b1, { savedAt: String(g1.savedAt || 0), scenarioCount: String(g1.scenarioCount || 0) });
            idx.gens['2'] = { ...g1, gen: 2 };
          }
        }
        // new -> 1
        await writeFn('backup_1.json.gz', gz, { savedAt: String(now), scenarioCount: String(scCount), roomCount: String(roomCount) });
        idx.gens['1'] = { gen: 1, savedAt: now, scenarioCount: scCount, roomCount, size: gz.byteLength };
        await writeIndexFn(idx);
      };

      try {
        if (targets.gdrive && gdriveToken && !gdriveNeedsReauth) {
          const fIds = await ensureDriveFolders();
          const bFiles = await listDriveFolderFiles(fIds.backups);
          await updateTargetBackups(
            async name => { const f = bFiles.get(name); return f ? await downloadDriveFile(f.id) : null; },
            async (name, bytes, props) => {
              const cur = bFiles.get(name);
              const up = await uploadDriveResumable(fIds.backups, name, bytes, 'application/gzip', cur ? cur.id : null, props);
              bFiles.set(name, up);
            },
            async () => {
              const f = bFiles.get('backups_index.json');
              if (!f) return null;
              try { return JSON.parse(new TextDecoder().decode(await downloadDriveFile(f.id))); } catch (_) { return null; }
            },
            async idx => {
              const cur = bFiles.get('backups_index.json');
              const bytes = new TextEncoder().encode(JSON.stringify(idx));
              const up = await uploadDriveResumable(fIds.backups, 'backups_index.json', bytes, 'application/json', cur ? cur.id : null);
              bFiles.set('backups_index.json', up);
            }
          );
        }
        if (targets.folder) {
          await updateTargetBackups(
            async name => await readFolderSyncFile(targets.folder, ['backups', name]),
            async (name, bytes) => { await writeFolderSyncFile(targets.folder, ['backups', name], bytes); },
            async () => {
              const u8 = await readFolderSyncFile(targets.folder, ['backups', 'backups_index.json']);
              if (!u8) return null;
              try { return JSON.parse(new TextDecoder().decode(u8)); } catch (_) { return null; }
            },
            async idx => {
              await writeFolderSyncFile(targets.folder, ['backups', 'backups_index.json'], new TextEncoder().encode(JSON.stringify(idx)));
            }
          );
        }
        lastCloudBackupAt = now;
        try { localStorage.setItem('taku_last_cloud_backup_at', String(now)); } catch (_) {}
      } catch (e) {
        console.warn('[CloudSync] backup rotation skipped:', e);
      }
    }

    async function syncMetadataToTargets(targets, usageMap, opts) {
      const o = opts || {};
      const payload = buildCloudMetadataPayload(usageMap);
      const stateGz = await window.CloudCodec.gzipCompress(JSON.stringify(payload));
      const manifestObj = {
        schemaVersion: 3,
        updatedAt: Date.now(),
        files: remoteManifest,
        refToSha,
        scenarioAssets,
        packs: packManifest,
        thumbsPackHash: remoteThumbsPackHash || ''
      };
      const manifestGz = await window.CloudCodec.gzipCompress(JSON.stringify(manifestObj));

      if (targets.gdrive && gdriveToken && !gdriveNeedsReauth) {
        const fIds = await ensureDriveFolders();
        const metaFiles = await listDriveFolderFiles(fIds.meta);
        gdriveMetaSet = metaFiles;
        const curState = metaFiles.get('state_meta.json.gz');
        await uploadDriveResumable(fIds.meta, 'state_meta.json.gz', stateGz, 'application/gzip', curState ? curState.id : null);
        const curManifest = metaFiles.get('manifest.json.gz');
        await uploadDriveResumable(fIds.meta, 'manifest.json.gz', manifestGz, 'application/gzip', curManifest ? curManifest.id : null);
      }
      if (targets.folder) {
        await writeFolderSyncFile(targets.folder, ['meta', 'state_meta.json.gz'], stateGz);
        await writeFolderSyncFile(targets.folder, ['meta', 'manifest.json.gz'], manifestGz);
      }
      await saveManifestCache();
      await saveCloudBackupRotation(targets, payload, !!o.forceBackup);

      if (o.forceSnapshot && targets.gdrive && gdriveToken && !gdriveNeedsReauth) {
        const now = Date.now();
        const scCount = Array.isArray(payload && payload.state && payload.state.scenarios) ? payload.state.scenarios.length : 0;
        const roomCount = countTotalRooms(payload && payload.state);
        const snapObj = {
          schemaVersion: 2,
          savedAt: now,
          scenarioCount: scCount,
          roomCount,
          state: payload.state,
          libraryMeta: payload.libraryMeta
        };
        const snapGz = await window.CloudCodec.gzipCompress(JSON.stringify(snapObj));
        const fIds = await ensureDriveFolders();
        const bFiles = await listDriveFolderFiles(fIds.backups);
        const curSnap = bFiles.get('snapshot_1.json.gz');
        await uploadDriveResumable(
          fIds.backups,
          'snapshot_1.json.gz',
          snapGz,
          'application/gzip',
          curSnap ? curSnap.id : null,
          { savedAt: String(now), scenarioCount: String(scCount), roomCount: String(roomCount) }
        );
      }
    }

    async function getActiveTargets(askWebPerm) {
      const cs = getSettings();
      const hasDriveAccount = !!(currentAuthUser || gdriveEmail || gdriveToken);
      const useGDrive = !!(cs.syncGDriveAssets && hasDriveAccount && isTokenUsable() && !gdriveNeedsReauth);
      const folderTarget = cs.folderSyncEnabled ? await ensureFolderTargetReady(askWebPerm) : null;
      const useFolder = !!(folderTarget && (folderTarget.kind === 'electron' || folderTarget.kind === 'web'));
      return { cs, gdrive: useGDrive, folder: useFolder ? folderTarget : null, folderPendingPerm: folderTarget && folderTarget.kind === 'web-needs-perm' };
    }

    function canDownloadFromCloud() {
      const cs = getSettings();
      const hasDriveAccount = !!(currentAuthUser || gdriveEmail || gdriveToken);
      return !!(cs.folderSyncEnabled || (cs.syncGDriveAssets && hasDriveAccount && isTokenUsable() && !gdriveNeedsReauth));
    }

    // ---- 第1段階：サムネイル一括パック (meta/thumbs_pack.zip) 展開 ----
    async function unpackThumbsPackBytes(zipBytes, sig) {
      if (!zipBytes || !zipBytes.byteLength) return 0;
      const zr = await readZipEntries(zipBytes);
      const entryMap = new Map();
      zr.entries.forEach(e => { if (e && !e.dir) entryMap.set(e.name, e); });

      let idxObj = null;
      const idxEnt = entryMap.get('index.json');
      if (idxEnt) {
        try {
          const idxU8 = await zr.readEntry(idxEnt);
          idxObj = JSON.parse(new TextDecoder().decode(idxU8));
        } catch (_) {}
      }

      const list = (idxObj && Array.isArray(idxObj.thumbs)) ? idxObj.thumbs : [];
      const handledEntries = new Set(['index.json']);
      let unpacked = 0;

      for (const info of list) {
        if (!info || !info.entry) continue;
        const ent = entryMap.get(info.entry);
        if (!ent) continue;
        handledEntries.add(info.entry);
        try {
          const u8 = await zr.readEntry(ent);
          const mime = info.mime || 'image/webp';
          const blob = new Blob([u8], { type: mime });
          const imgHash = info.imgHash || (info.refKey && info.refKey.startsWith('@img:') ? info.refKey.slice(5) : '');
          if (imgHash) {
            thumbsPackMemMap.set(imgHash, { bytes: u8, mime });
            if (typeof window.putIdbThumbBlob === 'function') await window.putIdbThumbBlob(imgHash, blob);
            else if (typeof idbPut === 'function') await idbPut('thumbs', imgHash, blob);
          }
          if (info.sha256) {
            const sha = String(info.sha256).toLowerCase();
            thumbsPackMemMap.set(sha, { bytes: u8, mime });
            remoteManifest[sha] = Object.assign({}, remoteManifest[sha] || {}, {
              name: info.name || ent.name,
              mime,
              size: u8.byteLength,
              isThumb: true,
              scenarioId: info.scenarioId || '',
              refKey: info.refKey || ''
            });
          }
          if (info.refKey) {
            thumbsPackMemMap.set(info.refKey, { bytes: u8, mime });
            const prev = refToSha[info.refKey] || {};
            if (info.sha256) prev.thumbSha = String(info.sha256).toLowerCase();
            if (info.scenarioId && !prev.scenarioId) prev.scenarioId = info.scenarioId;
            refToSha[info.refKey] = prev;
          }
          unpacked++;
        } catch (e) {
          console.warn('[CloudSync] unpack thumb entry failed:', info.entry, e);
        }
      }

      // index.json に記載のないサムネイルエントリのフォールバック展開
      for (const ent of zr.entries) {
        if (!ent || ent.dir || handledEntries.has(ent.name)) continue;
        try {
          const u8 = await zr.readEntry(ent);
          const base = ent.name.split('/').pop().replace(/\.webp$/i, '');
          if (base) {
            const blob = new Blob([u8], { type: 'image/webp' });
            thumbsPackMemMap.set(base, { bytes: u8, mime: 'image/webp' });
            if (typeof window.putIdbThumbBlob === 'function') await window.putIdbThumbBlob(base, blob);
            else if (typeof idbPut === 'function') await idbPut('thumbs', base, blob);
            unpacked++;
          }
        } catch (_) {}
      }

      if (sig) {
        unpackedThumbsPackSig = String(sig);
        try { localStorage.setItem('taku_unpacked_thumbs_sig_v1', unpackedThumbsPackSig); } catch (_) {}
      }
      if (typeof window.refreshThumbDomAll === 'function') window.refreshThumbDomAll();
      return unpacked;
    }

    async function ensureThumbsPackUnpacked(opts) {
      const o = opts || {};
      if (thumbsPackInFlight) return await thumbsPackInFlight;
      const run = (async () => {
        const targets = o.targets || await getActiveTargets(false);
        if (!targets.gdrive && !targets.folder) return 0;

        let metaFiles = o.metaFiles || null;
        let tf = metaFiles ? metaFiles.get('thumbs_pack.zip') : null;
        if (!tf && targets.gdrive && !metaFiles) {
          try {
            const fIds = await ensureDriveFolders();
            metaFiles = await listDriveFolderFiles(fIds.meta);
            gdriveMetaSet = metaFiles;
            tf = metaFiles.get('thumbs_pack.zip') || null;
          } catch (_) {}
        }

        const sig = remoteThumbsPackHash
          || (tf && tf.appProperties && tf.appProperties.packHash)
          || (tf ? `${tf.modifiedTime || ''}:${tf.size || ''}` : '');

        // 既に最新パックを展開済みならスキップ（ただしカード表紙のいずれかがローカル欠損している場合は取得する）
        let needUnpack = !!o.force || !unpackedThumbsPackSig || (sig && sig !== unpackedThumbsPackSig);
        if (!needUnpack && typeof window.hasLocalThumbHashAsync === 'function' && typeof appState !== 'undefined') {
          for (const sc of (appState.scenarios || [])) {
            const u = sc && sc.imageUrl;
            if (typeof u === 'string' && u.startsWith('@img:')) {
              if (!(await window.hasLocalThumbHashAsync(u.slice(5)))) {
                needUnpack = true;
                break;
              }
            }
          }
        }
        if (!needUnpack) return 0;

        let zipBytes = null;
        if (targets.folder) {
          zipBytes = await readFolderSyncFile(targets.folder, ['meta', 'thumbs_pack.zip']);
        }
        if (!zipBytes && targets.gdrive && tf && tf.id) {
          zipBytes = await downloadDriveFile(tf.id);
        }
        if (!zipBytes || !zipBytes.byteLength) return 0;
        const count = await unpackThumbsPackBytes(zipBytes, sig || ('len:' + zipBytes.byteLength));
        if (count > 0 && typeof renderDBView === 'function') renderDBView();
        return count;
      })();
      thumbsPackInFlight = run;
      try { return await run; } finally { if (thumbsPackInFlight === run) thumbsPackInFlight = null; notifySyncIdleIfReady(); }
    }

    // ---- 第1段階：クラウドメタデータ & 軽量マニフェスト取得 ----
    async function pullManifestAndMeta(opts) {
      const o = opts || {};
      pullMetaRunning++;
      try {
        const targets = await getActiveTargets(false);
        if (!targets.gdrive && !targets.folder) return false;

        let manifestBytes = null;
        let stateMetaBytes = null;
        let metaFiles = null;
        if (targets.folder) {
          manifestBytes = await readFolderSyncFile(targets.folder, ['meta', 'manifest.json.gz']);
          if (o.includeState || targets.cs.syncFirestoreText === false || !currentAuthUser) {
            stateMetaBytes = await readFolderSyncFile(targets.folder, ['meta', 'state_meta.json.gz']);
          }
        }
        if (targets.gdrive) {
          const fIds = await ensureDriveFolders(!!o.forceVerify);
          metaFiles = await listDriveFolderFiles(fIds.meta);
          gdriveMetaSet = metaFiles;
          if (!manifestBytes) {
            const mf = metaFiles.get('manifest.json.gz');
            if (mf && mf.id) manifestBytes = await downloadDriveFile(mf.id);
          }
          if (!stateMetaBytes && (o.includeState || targets.cs.syncFirestoreText === false || !currentAuthUser)) {
            const sf = metaFiles.get('state_meta.json.gz');
            if (sf && sf.id) stateMetaBytes = await downloadDriveFile(sf.id);
          }
        }

        if (manifestBytes && window.CloudCodec) {
          const jsonStr = await window.CloudCodec.gzipDecompress(manifestBytes);
          const parsed = JSON.parse(jsonStr);
          if (parsed && typeof parsed === 'object') {
            if (parsed.files) Object.assign(remoteManifest, parsed.files);
            if (parsed.refToSha) Object.assign(refToSha, parsed.refToSha);
            if (parsed.scenarioAssets) Object.assign(scenarioAssets, parsed.scenarioAssets);
            if (parsed.packs) Object.assign(packManifest, parsed.packs);
            if (parsed.thumbsPackHash) remoteThumbsPackHash = String(parsed.thumbsPackHash);
            await saveManifestCache();
          }
        }

        // サムネイル一括パック (meta/thumbs_pack.zip) を1回の通信で展開
        try {
          await ensureThumbsPackUnpacked({ targets, metaFiles, force: !!o.forceThumbs });
        } catch (te) {
          if (!o.silent) console.warn('[CloudSync] pull thumbs_pack.zip skipped:', te);
        }

        if (stateMetaBytes && window.CloudCodec && typeof window.mergeCloudStates === 'function' && typeof window.applyMergedState === 'function') {
          const metaJson = await window.CloudCodec.gzipDecompress(stateMetaBytes);
          const remotePayload = JSON.parse(metaJson);
          if (remotePayload && remotePayload.state) {
            const lastSyncAt = getLastCloudSyncAt();
            if (!lastSyncAt || Number(remotePayload.exportedAt || 0) > lastSyncAt) {
              const local = window.getAppStateForSync({ forCloud: true });
              window._lastCloudConflictCount = 0;
              const merged = window.mergeCloudStates(local, remotePayload.state);
              await window.applyMergedState(merged, { fromCloud: true });
              if (window._lastCloudConflictCount > 0 && typeof toast === 'function') {
                toast(`🛡️ 別端末との競合を検出し、${window._lastCloudConflictCount}件の古いデータを別名バックアップとして退避しました`);
              }
              try {
                const uidStr = currentAuthUser ? currentAuthUser.uid : '';
                const v = String(Date.now());
                if (uidStr) localStorage.setItem('taku_last_cloud_sync_at_' + uidStr, v);
                localStorage.setItem('taku_last_cloud_sync_at', v);
              } catch (_) {}
            }
          }
        }
        if (typeof window.fetchMissingImages === 'function') window.fetchMissingImages();
        if (typeof renderDBView === 'function') renderDBView();
        // ピン留め済みシナリオの未キャッシュ素材があればバックグラウンドで優先取得
        for (const scId of offlinePinnedIds) {
          void ensureScenarioAssetsCached(scId, { silent: true, priority: true });
        }
        return true;
      } catch (e) {
        if (!o.silent) console.warn('[CloudSync] pullManifestAndMeta error:', e);
        return false;
      } finally {
        pullMetaRunning = Math.max(0, pullMetaRunning - 1);
        notifySyncIdleIfReady();
      }
    }

    async function computePackHash(items) {
      const sigList = items.map(it => ({
        sha256: it.sha256 || '',
        refKey: it.refKey || '',
        name: it.name || '',
        rel: it.rel || '',
        kind: it.kind || '',
        isThumb: !!it.isThumb
      }));
      sigList.sort((a, b) => (a.sha256 + '|' + a.refKey + '|' + a.name).localeCompare(b.sha256 + '|' + b.refKey + '|' + b.name));
      return await window.CloudCodec.sha256Hex(new TextEncoder().encode(JSON.stringify(sigList)));
    }

    function toQueueItemMetadata(it) {
      return {
        sha256: it.sha256 || '',
        name: it.name || '',
        mime: it.mime || '',
        origMime: it.origMime || it.mime || '',
        size: it.size || 0,
        isThumb: !!it.isThumb,
        scenarioId: it.scenarioId || '',
        refKey: it.refKey || '',
        kind: it.kind || '',
        rel: it.rel || '',
        sourceType: it.sourceType,
        sourceRef: (it.sourceType === 'dataUrl' && String(it.sourceRef || '').length > 4096) ? '' : it.sourceRef,
        fallbackUrl: ''
      };
    }

    async function prepareAndEnqueueSync(opts) {
      prepareSyncRunning++;
      try {
        return await _prepareAndEnqueueSyncBody(opts);
      } finally {
        prepareSyncRunning = Math.max(0, prepareSyncRunning - 1);
        notifySyncIdleIfReady();
      }
    }
    async function _prepareAndEnqueueSyncBody(opts) {
      const o = opts || {};
      const csNow = getSettings();
      if (csNow.syncGDriveAssets !== false && (currentAuthUser || gdriveEmail) && (!isTokenUsable() || gdriveNeedsReauth)) {
        await ensureValidGDriveToken({ interactive: !!o.interactive });
      }
      const targets = await getActiveTargets(!!o.interactive);
      if (!targets.gdrive && !targets.folder) {
        if (o.manual && targets.cs.syncGDriveAssets && !isTokenUsable() && (currentAuthUser || gdriveEmail)) {
          gdriveNeedsReauth = true;
          updateHeaderBadges();
        } else if (o.manual && targets.folderPendingPerm) {
          if (typeof toast === 'function') toast('📂 保存先フォルダへのアクセス許可が必要です。設定から再度許可してください。');
        }
        return { enqueued: 0, targets };
      }

      if (typeof window.imgFlush === 'function') await window.imgFlush();

      if (targets.gdrive) {
        const loadDriveSets = async () => {
          const fIds = await ensureDriveFolders(!!o.forceVerify || !!o.manual);
          const freshAssets = await listDriveFolderFiles(fIds.assets);
          const freshMeta = await listDriveFolderFiles(fIds.meta);
          if (driveFoldersJustRecreated || !freshMeta.has('manifest.json.gz')) {
            driveFoldersJustRecreated = false;
            resetDriveSyncCaches({ keepFolders: true });
            await saveManifestCache();
          }
          gdriveAssetSet = freshAssets;
          gdriveMetaSet = freshMeta;
        };
        try {
          await loadDriveSets();
        } catch (err) {
          if (err && err.name === 'DriveAuthError') {
            const refRes = await ensureValidGDriveToken({ interactive: !!o.interactive, force: true });
            if (refRes && refRes.ok) {
              await loadDriveSets();
            } else {
              return { enqueued: 0, targets: await getActiveTargets(false) };
            }
          } else {
            throw err;
          }
        }
      }
      if (targets.folder) {
        folderAssetSet = await listFolderSyncAssets(targets.folder);
        folderMetaSet = await listFolderSyncMeta(targets.folder);
      }

      await purgeUploadQueue({ skipSave: true });
      const { candidates, usageMap } = collectSyncCandidates(targets.cs);
      const compressWebp = targets.cs.compressImagesWebp !== false;

      const nextScenarioAssets = {};
      const packBuckets = new Map(); // packKey -> { packType, packKey, packName, folderSub, scenarioId, items: [], missingLocal: 0 }
      const getBucket = (packType, scenarioId) => {
        const packKey = getPackKey(packType, scenarioId);
        let b = packBuckets.get(packKey);
        if (!b) {
          b = {
            packType,
            packKey,
            packName: getPackFileName(packType, scenarioId),
            folderSub: packType === 'thumbs' ? 'meta' : 'assets',
            scenarioId: packType === 'thumbs' ? '_thumbs' : (packType === 'common' ? '_common' : String(scenarioId || '')),
            items: [],
            missingLocal: 0
          };
          packBuckets.set(packKey, b);
        }
        return b;
      };

      let candIdx = 0;
      for (const item of candidates) {
        candIdx++;
        if (candIdx % 40 === 0) await new Promise(r => setTimeout(r, 0));

        const pType = item.isThumb ? 'thumbs' : ((item.scenarioId && item.scenarioId !== '_common' && item.scenarioId !== '_settings') ? 'scenario' : 'common');
        const bucket = getBucket(pType, item.scenarioId);

        const fp = await computeAssetFingerprint(item, item.isThumb ? false : compressWebp);
        if (!fp || !fp.sha256) {
          bucket.missingLocal++;
          continue;
        }
        const localAvail = await isItemLocallyAvailable(item, fp.sha256);
        if (!localAvail) {
          bucket.missingLocal++;
        }

        remoteManifest[fp.sha256] = {
          name: item.name || fp.sha256,
          mime: fp.mime,
          size: fp.size,
          isThumb: !!item.isThumb,
          scenarioId: item.scenarioId || '',
          refKey: item.refKey || '',
          kind: item.kind || ''
        };
        if (item.refKey) {
          const prev = refToSha[item.refKey] || {};
          if (item.isThumb) prev.thumbSha = fp.sha256;
          else prev.fullSha = fp.sha256;
          prev.name = item.name || prev.name || fp.sha256;
          prev.mime = fp.mime || prev.mime;
          prev.size = fp.size || prev.size;
          if (item.scenarioId && !prev.scenarioId) prev.scenarioId = String(item.scenarioId);
          refToSha[item.refKey] = prev;
        }
        if (item.scenarioId && item.scenarioId !== '_common' && item.scenarioId !== '_settings') {
          const sid = String(item.scenarioId);
          if (!nextScenarioAssets[sid]) nextScenarioAssets[sid] = [];
          if (!nextScenarioAssets[sid].some(x => x.sha256 === fp.sha256 && x.refKey === (item.refKey || ''))) {
            nextScenarioAssets[sid].push({
              sha256: fp.sha256,
              name: item.name || fp.sha256,
              mime: fp.mime,
              size: fp.size,
              kind: item.kind || '',
              refKey: item.refKey || '',
              rel: item.rel || '',
              isThumb: !!item.isThumb
            });
          }
        }
        if (localAvail) {
          bucket.items.push(Object.assign({}, item, {
            sha256: fp.sha256,
            mime: fp.mime,
            origMime: fp.origMime || fp.mime,
            size: fp.size
          }));
        }
      }

      // 既存のクラウド側シナリオ素材一覧をマージ（この端末がクラウドのみ表示で実体を持たないシナリオの情報を失わないため）
      for (const [sid, list] of Object.entries(nextScenarioAssets)) {
        const mergedList = Array.isArray(scenarioAssets[sid]) ? [...scenarioAssets[sid]] : [];
        list.forEach(ent => {
          const idx = mergedList.findIndex(x => x.sha256 === ent.sha256 || (ent.refKey && x.refKey === ent.refKey));
          if (idx >= 0) mergedList[idx] = Object.assign({}, mergedList[idx], ent);
          else mergedList.push(ent);
        });
        scenarioAssets[sid] = mergedList;
      }

      // パック単位（1シナリオ = 1件、サムネ一括 = 1件、共通ライブラリ = 1件）でキューへ積む
      let added = 0;
      for (const bucket of packBuckets.values()) {
        if (!bucket.items.length) continue;

        const gSet = bucket.folderSub === 'meta' ? gdriveMetaSet : gdriveAssetSet;
        const fSet = bucket.folderSub === 'meta' ? folderMetaSet : folderAssetSet;
        const gFile = gSet ? gSet.get(bucket.packName) : null;
        const fHas = !!(fSet && fSet.has(bucket.packName));
        const existsRemote = !!(gFile || fHas || packManifest[bucket.packKey]);

        // この端末に一部または全実体が未ダウンロードのクラウド専用シナリオは、既存の完全ZIPを上書きしない
        if (bucket.packType === 'scenario' && bucket.missingLocal > 0 && existsRemote) {
          continue;
        }

        const packHash = await computePackHash(bucket.items);
        const remoteMeta = packManifest[bucket.packKey];
        const remoteHash = (remoteMeta && remoteMeta.packHash) || (bucket.packType === 'thumbs' ? remoteThumbsPackHash : '') || '';
        const gPropHash = (gFile && gFile.appProperties && gFile.appProperties.packHash) || '';

        const needTargets = [];
        if (targets.gdrive) {
          if (!gFile || (gPropHash ? gPropHash !== packHash : remoteHash !== packHash)) {
            needTargets.push('gdrive');
          }
        }
        if (targets.folder) {
          if (!fHas || remoteHash !== packHash) {
            needTargets.push('folder');
          }
        }
        if (!needTargets.length) continue;

        const existingIdx = cloudUploadQueue.findIndex(q => q.packKey === bucket.packKey);
        if (existingIdx >= 0) {
          const ex = cloudUploadQueue[existingIdx];
          if (ex.packHash === packHash && needTargets.every(t => Array.isArray(ex.targets) && ex.targets.includes(t))) {
            continue;
          }
          cloudUploadQueue.splice(existingIdx, 1);
        }

        cloudUploadQueue.push({
          id: uid(),
          packType: bucket.packType,
          packKey: bucket.packKey,
          packName: bucket.packName,
          folderSub: bucket.folderSub,
          scenarioId: bucket.scenarioId,
          packHash,
          compressWebp: bucket.packType !== 'thumbs' && compressWebp,
          items: bucket.items.map(toQueueItemMetadata),
          targets: needTargets,
          createdAt: Date.now()
        });
        added++;
      }

      await persistShaCache();
      await savePersistedQueue();
      if (!cloudUploadQueue.length) {
        await syncMetadataToTargets(targets, usageMap);
      } else if (!o.skipAutoDrain) {
        void drainQueue(usageMap, { interactive: !!o.interactive });
      }
      return { enqueued: added, targets };
    }

    async function buildPackZipBytes(packItem, targets) {
      const zipEntries = [];
      const usedEntryPaths = new Set();
      const shaEntryMap = new Map(); // sha256 -> entryPath

      if (packItem.packType === 'thumbs') {
        const thumbsIndex = [];
        const coveredImgHashes = new Set();
        const coveredRefKeys = new Set();

        for (const sub of (packItem.items || [])) {
          let res = null;
          try {
            res = await resolveSourceBytes(sub, false);
          } catch (_) {}
          if (!res || !res.bytes) continue;

          const imgHash = (sub.refKey && sub.refKey.startsWith('@img:')) ? sub.refKey.slice(5) : (sub.sourceType === 'thumbWebp' ? sub.sourceRef : '');
          const baseKey = imgHash ? safeScenarioPackId(imgHash) : res.sha256;
          let entryPath = `thumbs/${baseKey}.webp`;
          let suffix = 2;
          while (usedEntryPaths.has(entryPath.toLowerCase()) && !shaEntryMap.has(res.sha256)) {
            entryPath = `thumbs/${baseKey}_${suffix++}.webp`;
          }
          if (!shaEntryMap.has(res.sha256)) {
            usedEntryPaths.add(entryPath.toLowerCase());
            shaEntryMap.set(res.sha256, entryPath);
            zipEntries.push({ name: entryPath, data: res.bytes, store: true });
          } else {
            entryPath = shaEntryMap.get(res.sha256);
          }
          if (imgHash) coveredImgHashes.add(imgHash);
          if (sub.refKey) coveredRefKeys.add(sub.refKey);
          thumbsIndex.push({
            entry: entryPath,
            sha256: res.sha256,
            imgHash,
            refKey: sub.refKey || '',
            scenarioId: sub.scenarioId || '',
            name: sub.name || '',
            mime: 'image/webp',
            size: res.bytes.byteLength
          });
        }

        // 既存 thumbs_pack.zip があれば、この端末にローカル実体が無い他端末サムネイルを保全マージ
        try {
          let prevZip = null;
          if (targets.folder) prevZip = await readFolderSyncFile(targets.folder, ['meta', 'thumbs_pack.zip']);
          if (!prevZip && targets.gdrive && gdriveMetaSet) {
            const tf = gdriveMetaSet.get('thumbs_pack.zip');
            if (tf && tf.id) prevZip = await downloadDriveFile(tf.id);
          }
          if (prevZip && prevZip.byteLength) {
            const zr = await readZipEntries(prevZip);
            const eMap = new Map();
            zr.entries.forEach(e => { if (e && !e.dir) eMap.set(e.name, e); });
            const idxEnt = eMap.get('index.json');
            if (idxEnt) {
              const prevIdx = JSON.parse(new TextDecoder().decode(await zr.readEntry(idxEnt)));
              const liveScIds = new Set((appState.scenarios || []).filter(Boolean).map(s => String(s.id)));
              for (const pi of (prevIdx && Array.isArray(prevIdx.thumbs) ? prevIdx.thumbs : [])) {
                if (!pi || !pi.entry) continue;
                if (pi.scenarioId && !liveScIds.has(String(pi.scenarioId))) continue;
                if ((pi.imgHash && coveredImgHashes.has(pi.imgHash)) || (pi.refKey && coveredRefKeys.has(pi.refKey))) continue;
                const ent = eMap.get(pi.entry);
                if (!ent) continue;
                const u8 = await zr.readEntry(ent);
                let ep = pi.entry;
                if (!shaEntryMap.has(pi.sha256) && !usedEntryPaths.has(ep.toLowerCase())) {
                  usedEntryPaths.add(ep.toLowerCase());
                  if (pi.sha256) shaEntryMap.set(pi.sha256, ep);
                  zipEntries.push({ name: ep, data: u8, store: true });
                } else if (pi.sha256 && shaEntryMap.has(pi.sha256)) {
                  ep = shaEntryMap.get(pi.sha256);
                } else {
                  continue;
                }
                if (pi.imgHash) coveredImgHashes.add(pi.imgHash);
                if (pi.refKey) coveredRefKeys.add(pi.refKey);
                thumbsIndex.push(Object.assign({}, pi, { entry: ep }));
              }
            }
          }
        } catch (_) {}

        const indexJson = JSON.stringify({
          schemaVersion: 1,
          packType: 'thumbs',
          packHash: packItem.packHash || '',
          updatedAt: Date.now(),
          thumbs: thumbsIndex
        });
        zipEntries.push({ name: 'index.json', data: indexJson, store: false });
        const bytes = await zipBytesFromEntries(zipEntries);
        return { bytes, itemCount: thumbsIndex.length };
      }

      // シナリオ単位パック (assets/scenario_<id>.zip) または 共通マイライブラリ (assets/common_library.zip)
      const assetsIndex = [];
      const compressWebp = !!packItem.compressWebp;
      for (const sub of (packItem.items || [])) {
        let res = null;
        try {
          res = await resolveSourceBytes(sub, compressWebp);
        } catch (readErr) {
          console.warn('[CloudSync] ZIPパッキング読み取り/変換エラー（スキップ）:', sub.name, readErr);
          continue;
        }
        if (!res || !res.bytes) continue;

        const sha = res.sha256;
        const mime = res.mime || sub.mime || 'application/octet-stream';
        let entryPath = shaEntryMap.get(sha);
        if (!entryPath) {
          const ext = extFromMimeOrName(mime, sub.name);
          entryPath = `files/${sha}${ext}`;
          let n = 2;
          while (usedEntryPaths.has(entryPath.toLowerCase())) {
            entryPath = `files/${sha}_${n++}${ext}`;
          }
          usedEntryPaths.add(entryPath.toLowerCase());
          shaEntryMap.set(sha, entryPath);
          zipEntries.push({ name: entryPath, data: res.bytes, store: isAlreadyCompressedEntry(entryPath, mime) });
        }

        // remoteManifest / refToSha も最新MIME/SHAに同期
        remoteManifest[sha] = {
          name: sub.name || sha,
          mime,
          size: res.bytes.byteLength,
          isThumb: false,
          scenarioId: sub.scenarioId || packItem.scenarioId || '',
          refKey: sub.refKey || '',
          kind: sub.kind || ''
        };
        if (sub.refKey) {
          const prev = refToSha[sub.refKey] || {};
          prev.fullSha = sha;
          prev.name = sub.name || prev.name || sha;
          prev.mime = mime;
          prev.size = res.bytes.byteLength;
          prev.scenarioId = String(sub.scenarioId || packItem.scenarioId || prev.scenarioId || '');
          refToSha[sub.refKey] = prev;
        }

        assetsIndex.push({
          entry: entryPath,
          sha256: sha,
          name: sub.name || sha,
          origName: sub.name || sha,
          category: sub.kind || 'asset',
          kind: sub.kind || 'asset',
          mime,
          origMime: res.origMime || sub.origMime || mime,
          size: res.bytes.byteLength,
          refKey: sub.refKey || '',
          rel: sub.rel || '',
          scenarioId: sub.scenarioId || packItem.scenarioId || ''
        });
      }

      const indexJson = JSON.stringify({
        schemaVersion: 2,
        packType: packItem.packType,
        packName: packItem.packName,
        scenarioId: packItem.scenarioId || '',
        packHash: packItem.packHash || '',
        updatedAt: Date.now(),
        assets: assetsIndex
      });
      zipEntries.push({ name: 'index.json', data: indexJson, store: false });
      const bytes = await zipBytesFromEntries(zipEntries);
      return { bytes, itemCount: assetsIndex.length };
    }

    async function drainQueue(usageMap, opts) {
      if (draining && drainPromise) return drainPromise;
      const o = opts || {};
      const myGen = queueResetGen;
      if (!exitFlowActive) exitSkipped = false;
      const run = (async () => {
        await loadPersistedQueue();
        if (!cloudUploadQueue.length || myGen !== queueResetGen) return;
        draining = true;
        updateHeaderBadges();
        updateExitModalProgress();
        let authRefreshedInDrain = false;
        let processedSinceSave = 0;
        const BATCH_SIZE = 2;
        const IDB_SAVE_INTERVAL = 5;

        try {
          const cs = getSettings();
          if (cs.syncGDriveAssets !== false && (!isTokenUsable() || gdriveNeedsReauth) && (currentAuthUser || gdriveEmail)) {
            await ensureValidGDriveToken({ interactive: !!o.interactive });
          }
          let targets = await getActiveTargets(false);
          if (!targets.gdrive && !targets.folder) return;

          let fIds = null;
          if (targets.gdrive) {
            try {
              fIds = await ensureDriveFolders();
              if (!gdriveAssetSet) gdriveAssetSet = await listDriveFolderFiles(fIds.assets);
              if (!gdriveMetaSet) gdriveMetaSet = await listDriveFolderFiles(fIds.meta);
            } catch (err) {
              if (err && err.name === 'DriveAuthError' && !authRefreshedInDrain) {
                authRefreshedInDrain = true;
                const refRes = await ensureValidGDriveToken({ interactive: !!o.interactive, force: true });
                if (refRes && refRes.ok) {
                  targets = await getActiveTargets(false);
                  fIds = await ensureDriveFolders();
                  if (!gdriveAssetSet) gdriveAssetSet = await listDriveFolderFiles(fIds.assets);
                  if (!gdriveMetaSet) gdriveMetaSet = await listDriveFolderFiles(fIds.meta);
                } else {
                  return;
                }
              } else {
                throw err;
              }
            }
          }
          if (targets.folder) {
            if (!folderAssetSet) folderAssetSet = await listFolderSyncAssets(targets.folder);
            if (!folderMetaSet) folderMetaSet = await listFolderSyncMeta(targets.folder);
          }

          const uploadOnePack = async (item) => {
            const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            let timeoutId = null;
            try {
              const itemTargets = Array.isArray(item.targets) ? item.targets : ['gdrive', 'folder'];
              const needG = targets.gdrive && itemTargets.includes('gdrive');
              const needF = targets.folder && itemTargets.includes('folder');
              if (!needG && !needF) return { item, status: 'done' };

              const built = await buildPackZipBytes(item, targets);
              if (!built || !built.bytes || !built.bytes.byteLength) {
                console.warn('[CloudSync] ZIPパック生成対象が空のためスキップ:', item.packName);
                return { item, status: 'skip' };
              }
              const zipBytes = built.bytes;
              const uploadTimeoutMs = Math.max(60000, Math.min(600000, Math.round(zipBytes.byteLength / (50 * 1024)) * 1000 + 30000));

              const doUpload = async () => {
                if (needG) {
                  const activeFIds = fIds || await ensureDriveFolders();
                  fIds = activeFIds;
                  const isMeta = item.folderSub === 'meta';
                  const targetFid = isMeta ? activeFIds.meta : activeFIds.assets;
                  const targetMap = isMeta ? gdriveMetaSet : gdriveAssetSet;
                  const existing = targetMap ? targetMap.get(item.packName) : null;
                  const uploaded = await uploadDriveResumable(targetFid, item.packName, zipBytes, 'application/zip', existing ? existing.id : null, {
                    packType: String(item.packType || ''),
                    packHash: String(item.packHash || ''),
                    scenarioId: String(item.scenarioId || '').slice(0, 80)
                  }, { signal: ctl ? ctl.signal : undefined, timeoutMs: uploadTimeoutMs });
                  if (targetMap) targetMap.set(item.packName, uploaded);
                }
                if (needF) {
                  await writeFolderSyncFile(targets.folder, [item.folderSub || 'assets', item.packName], zipBytes);
                  if (item.folderSub === 'meta' && folderMetaSet) folderMetaSet.add(item.packName);
                  else if (folderAssetSet) folderAssetSet.add(item.packName);
                }

                packManifest[item.packKey] = {
                  packName: item.packName,
                  packHash: item.packHash || '',
                  packType: item.packType,
                  scenarioId: item.scenarioId || '',
                  updatedAt: Date.now(),
                  itemCount: built.itemCount,
                  totalSize: zipBytes.byteLength
                };
                if (item.packType === 'thumbs') {
                  remoteThumbsPackHash = item.packHash || '';
                  unpackedThumbsPackSig = remoteThumbsPackHash;
                  try { localStorage.setItem('taku_unpacked_thumbs_sig_v1', unpackedThumbsPackSig); } catch (_) {}
                } else {
                  extractedPackCache.set(item.packKey, item.packHash || '');
                }
                return { item, status: 'done' };
              };

              const timeoutPromise = new Promise((_, rej) => {
                timeoutId = setTimeout(() => {
                  if (ctl) ctl.abort();
                  rej(new Error(`ZIPアップロードタイムアウト (${Math.round(uploadTimeoutMs / 1000)}秒): ${item.packName}`));
                }, uploadTimeoutMs);
              });
              return await Promise.race([doUpload(), timeoutPromise]);
            } catch (err) {
              if (err && err.name === 'DriveAuthError') {
                return { item, status: 'auth_error', err };
              }
              console.warn('[CloudSync] パックアップロード失敗（スキップして継続）:', item.packName, err);
              return { item, status: 'skip', err };
            } finally {
              if (timeoutId) clearTimeout(timeoutId);
            }
          };

          while (cloudUploadQueue.length && !exitSkipped && myGen === queueResetGen) {
            const batch = cloudUploadQueue.slice(0, BATCH_SIZE);
            const results = await Promise.all(batch.map(uploadOnePack));
            if (myGen !== queueResetGen) break;

            const removeSet = new Set();
            let hasAuthError = false;
            for (const r of results) {
              if (r.status === 'auth_error') hasAuthError = true;
              else removeSet.add(r.item);
            }

            if (removeSet.size > 0) {
              cloudUploadQueue = cloudUploadQueue.filter(q => !removeSet.has(q));
              processedSinceSave += removeSet.size;
            }
            try { localStorage.setItem('taku_cloud_queue_len', String(cloudUploadQueue.length)); } catch (_) {}
            updateHeaderBadges();
            updateExitModalProgress();

            if (hasAuthError) {
              if (!authRefreshedInDrain) {
                authRefreshedInDrain = true;
                const refRes = await ensureValidGDriveToken({ interactive: !!o.interactive, force: true });
                if (refRes && refRes.ok) {
                  try {
                    fIds = await ensureDriveFolders();
                  } catch (_) {}
                  continue;
                }
              }
              break;
            }

            if (processedSinceSave >= IDB_SAVE_INTERVAL || cloudUploadQueue.length === 0) {
              processedSinceSave = 0;
              await savePersistedQueue();
            }
            await new Promise(r => setTimeout(r, 0));
          }

          await savePersistedQueue();
          if (!cloudUploadQueue.length && myGen === queueResetGen) {
            await syncMetadataToTargets(targets, usageMap || computeCommonAssetUsage());
          }
        } catch (e) {
          console.error('[CloudSync] drainQueue error', e);
          await savePersistedQueue();
        } finally {
          draining = false;
          updateHeaderBadges();
          updateExitModalProgress();
          notifySyncIdleIfReady();
        }
      })();
      drainPromise = run;
      try { return await run; } finally { if (drainPromise === run) drainPromise = null; }
    }

    // ---- ヘッダー統合状態バッジ・終了ダイアログ更新 ----
    function updateHeaderBadges() {
      const badge = document.getElementById('cloudStatusBadge');
      if (!badge) return;
      const fileDirect = isFileDirectOpen();
      const cs = getSettings();
      const fbSt = (typeof window.getFirebaseSyncStatus === 'function')
        ? window.getFirebaseSyncStatus()
        : { loggedIn: !!currentAuthUser, email: (currentAuthUser && (currentAuthUser.email || currentAuthUser.displayName)) || '', syncing: false, syncBlocked: false, syncError: false, dirty: false };
      const folderOn = !!(cs.folderSyncEnabled && (cs.localSyncPath || cs.webDirName));
      const hasUsableDrive = isTokenUsable() && !gdriveNeedsReauth;
      const n = (fileDirect && !hasUsableDrive && !folderOn) ? 0 : cloudUploadQueue.length;
      const isSyncing = !!(fbSt.syncing || draining || manualSyncRunning);
      const mail = fbSt.email || gdriveEmail || '';

      if (!fbSt.loggedIn && !folderOn && !isSyncing && n === 0 && !mail) {
        badge.textContent = '未ログイン';
        badge.className = 'cloud-status-pill';
      } else if (isSyncing) {
        badge.textContent = n > 0 ? `🔄 同期中 (残り${n}件)` : '🔄 同期中…';
        badge.className = 'cloud-status-pill syncing';
      } else if (fbSt.syncBlocked) {
        badge.textContent = n > 0 ? `⚠️ 未同期（他端末で更新あり・残り${n}件）` : '⚠️ 未同期（他端末で更新あり）';
        badge.className = 'cloud-status-pill err';
      } else if (n > 0 || fbSt.dirty) {
        badge.textContent = n > 0 ? `● 未同期 (残り${n}件)` : '● 未同期';
        badge.className = 'cloud-status-pill dirty';
      } else if (fbSt.syncError) {
        badge.textContent = '⚠️ 同期エラー';
        badge.className = 'cloud-status-pill err';
      } else if (fileDirect && !hasUsableDrive) {
        badge.textContent = '● 同期完了（Firebase同期）';
        badge.className = 'cloud-status-pill ok';
      } else {
        badge.textContent = mail ? `● 同期完了 (${mail})` : '● 同期完了';
        badge.className = 'cloud-status-pill ok';
      }
      if (!isSyncActive() && syncIdleListeners.size) notifySyncIdleIfReady();
    }
    window.updateUnifiedSyncBadge = updateHeaderBadges;

    function updateExitModalProgress() {
      const modal = document.getElementById('cloudExitModal');
      if (!modal || modal.style.display !== 'flex') return;
      const msg = document.getElementById('cloudExitMsg');
      const bar = document.getElementById('cloudExitBar');
      const n = cloudUploadQueue.length;
      if (msg) msg.textContent = `☁️ クラウドへ同期して終了しています...（残り ${n} 件）`;
      if (bar) {
        const tot = Math.max(1, exitInitialTotal || n || 1);
        const pct = n === 0 ? 100 : Math.min(95, Math.round(((tot - n) / tot) * 100));
        bar.style.width = pct + '%';
      }
    }

    function scheduleSync(reason, opts) {
      const o = opts || {};
      clearTimeout(syncScheduleTimer);
      syncScheduleTimer = null;
      if (o.force) {
        return prepareAndEnqueueSync({
          interactive: o.interactive !== undefined ? !!o.interactive : false,
          manual: !!o.manual,
          forceVerify: true,
          reason,
          skipAutoDrain: !!o.skipAutoDrain
        });
      }
      syncScheduleTimer = setTimeout(async () => {
        syncScheduleTimer = null;
        if (isSyncActive()) {
          onSyncIdle(() => { if (!syncScheduleTimer) scheduleSync(reason); });
          return;
        }
        try { await prepareAndEnqueueSync({ interactive: false, reason }); }
        catch (e) { console.warn('[CloudSync] scheduleSync', e); }
      }, 1500);
    }

    async function syncNowForce() {
      if (manualSyncRunning) return;
      manualSyncRunning = true;
      updateHeaderBadges();
      let fbRes = null;
      let driveTargets = { gdrive: false, folder: false };
      try {
        const fileDirect = isFileDirectOpen();
        const cs = getSettings();
        const wantGDrive = cs.syncGDriveAssets !== false;

        // ① 非file://環境では、クリック直後にGoogle認証を開いてトークンを確保する
        if (!fileDirect && wantGDrive && (!isTokenUsable() || gdriveNeedsReauth)) {
          const tokRes = await ensureValidGDriveToken({ interactive: true, skipSilent: true, force: true });
          if (!tokRes || !tokRes.ok || !isTokenUsable()) {
            const reason = (typeof window !== 'undefined' && window._lastGDriveAuthError)
              || (tokRes && tokRes.unavailable ? 'Google認証機能が利用できません' : 'Googleドライブの認証を完了できませんでした');
            if (typeof toast === 'function') toast('❌ Googleドライブ認証に失敗しました: ' + reason);
            return;
          }
        }

        if (typeof window.deduplicateScenariosInPlace === 'function') window.deduplicateScenariosInPlace();
        await purgeUploadQueue();

        if (typeof window.cloudSyncNow === 'function' && cs.syncFirestoreText !== false && currentAuthUser) {
          fbRes = await window.cloudSyncNow({ silentToast: true });
        }

        // file:// 直開き環境：有効な中継トークンがあればドライブ同期も行い、期限切れならエラーを出さずFirebase同期のみで完了する
        if (fileDirect) {
          let bridgedDriveOk = false;
          if (wantGDrive && isTokenUsable() && !gdriveNeedsReauth) {
            try {
              await pullManifestAndMeta({ includeState: true, silent: true, forceVerify: true });
              bridgedDriveOk = true;
            } catch (err) {
              if (err && err.name === 'DriveAuthError') {
                gdriveToken = '';
                gdriveNeedsReauth = true;
              } else {
                logSoft('fileDirectDrivePull', err);
              }
            }
          }
          if (cs.folderSyncEnabled) {
            await pullManifestAndMeta({ includeState: true, silent: true, forceVerify: true });
          }
          if (typeof window.fetchMissingImages === 'function') window.fetchMissingImages();
          if (typeof toast === 'function') {
            if (fbRes && fbRes.ok === false) {
              toast('❌ クラウド同期に失敗しました: ' + (fbRes.error && fbRes.error.message ? fbRes.error.message : '同期エラー'));
            } else if (!currentAuthUser && !bridgedDriveOk && !cs.folderSyncEnabled) {
              toast('ℹ️ クラウド連携が有効になっていません。ログインしてください。');
            } else if (bridgedDriveOk) {
              toast('✅ クラウド同期が完了しました（Firebase＋Googleドライブ中継）');
            } else {
              toast('✅ 同期完了（Firebase同期）');
            }
          }
          return;
        }

        if (wantGDrive) {
          // ② フォルダ実在確認＆強制作成（キャッシュクリア後に ensureDriveFolders(true)）
          const resetAndEnsureFolders = async () => {
            folderIds = null;
            lastFolderVerifyAt = 0;
            try { localStorage.removeItem(GDRIVE_FOLDERS_KEY); } catch (_) {}
            return await ensureDriveFolders(true);
          };
          let fIds = null;
          try {
            fIds = await resetAndEnsureFolders();
          } catch (err) {
            if (err && err.name === 'DriveAuthError') {
              const refRes = await ensureValidGDriveToken({ interactive: true, skipSilent: true, force: true });
              if (!refRes || !refRes.ok || !isTokenUsable()) {
                const reason = (typeof window !== 'undefined' && window._lastGDriveAuthError) || err.message || '再認証が必要です';
                if (typeof toast === 'function') toast('❌ Googleドライブ認証に失敗しました: ' + reason);
                return;
              }
              fIds = await resetAndEnsureFolders();
            } else {
              throw err;
            }
          }

          // ③ ドライブ上に meta/manifest.json.gz が無い場合はキャッシュをリセットして全サムネイル・対象素材を再キューイング
          const metaFiles = await listDriveFolderFiles(fIds.meta);
          gdriveMetaSet = metaFiles;
          if (!metaFiles.has('manifest.json.gz')) {
            resetDriveSyncCaches({ keepFolders: true });
            extractedPackCache.clear();
            gdriveMetaSet = metaFiles;
            lastCloudBackupAt = 0;
            try { localStorage.removeItem('taku_last_cloud_backup_at'); } catch (_) {}
            await saveManifestCache();
          } else {
            await pullManifestAndMeta({ includeState: true, silent: true, forceVerify: true });
          }
        } else if (cs.folderSyncEnabled) {
          await pullManifestAndMeta({ includeState: true, silent: true, forceVerify: true });
        }

        const res = await scheduleSync('manual_sync_force', { force: true, interactive: true, manual: true, skipAutoDrain: true });
        driveTargets = (res && res.targets) || driveTargets;

        // ④ キュー排出とマニフェスト・スナップショットの強制アップロード（キュー0件でも実行）
        if (cloudUploadQueue.length > 0) {
          await drainQueue(null, { interactive: true });
        } else if (draining && drainPromise) {
          await drainPromise;
        }

        const finalTargets = await getActiveTargets(true);
        if (finalTargets.gdrive || finalTargets.folder) {
          await syncMetadataToTargets(finalTargets, computeCommonAssetUsage(), { forceBackup: true, forceSnapshot: true });
        }

        if (typeof window.deduplicateScenariosInPlace === 'function') window.deduplicateScenariosInPlace();

        if (typeof toast === 'function') {
          const hasAnySync = !!(finalTargets.gdrive || finalTargets.folder || (currentAuthUser && cs.syncFirestoreText !== false));
          if (!hasAnySync) {
            toast('ℹ️ クラウド連携が有効になっていません。ログインまたは保存先フォルダを指定してください。');
          } else if (fbRes && fbRes.ok === false) {
            toast('❌ クラウド同期に失敗しました: ' + (fbRes.error && fbRes.error.message ? fbRes.error.message : '同期エラー'));
          } else if (cloudUploadQueue.length > 0) {
            toast(`⚠️ 同期が一部完了しませんでした（未送信 残り${cloudUploadQueue.length}件）`);
          } else if (finalTargets.gdrive) {
            toast('✅ Googleドライブ（卓倉庫_クラウド同期）への同期・バックアップが完了しました');
          } else {
            toast('✅ クラウド同期が完了しました');
          }
        }
      } catch (e) {
        console.error('[CloudSync] syncNowForce error', e);
        if (typeof toast === 'function') toast('❌ 同期中にエラーが発生しました: ' + (e.message || e));
      } finally {
        manualSyncRunning = false;
        updateHeaderBadges();
        renderSettingsUI();
        notifySyncIdleIfReady();
      }
    }
    const syncNow = syncNowForce;

    const autoWebSyncTimers = new Map();
    const WEB_ASSET_DAILY_QUOTA_KEY = 'taku_web_img_daily_quota_v1';
    const WEB_ASSET_DAILY_QUOTA_LIMIT = 2500;
    let bgWebAssetSyncRunning = false;
    let bgWebAssetSyncResumeTimer = null;

    function _todayLocalDateStr() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function getDailyWebImgQuota() {
      const today = _todayLocalDateStr();
      try {
        const raw = localStorage.getItem(WEB_ASSET_DAILY_QUOTA_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.date === today) {
            return { date: today, count: Math.max(0, Number(parsed.count) || 0), limit: WEB_ASSET_DAILY_QUOTA_LIMIT };
          }
        }
      } catch (_) {}
      return { date: today, count: 0, limit: WEB_ASSET_DAILY_QUOTA_LIMIT };
    }
    function addDailyWebImgQuota(delta) {
      const q = getDailyWebImgQuota();
      q.count = Math.max(0, q.count + (Number(delta) || 0));
      try { localStorage.setItem(WEB_ASSET_DAILY_QUOTA_KEY, JSON.stringify({ date: q.date, count: q.count })); } catch (_) {}
      return q;
    }
    function isDailyWebImgQuotaReached() {
      return getDailyWebImgQuota().count >= WEB_ASSET_DAILY_QUOTA_LIMIT;
    }
    function isHomePcEnv() {
      if (isFileDirectOpen()) return false;
      if (IS_ELECTRON) return true;
      try {
        const h = String(location.hostname || '').toLowerCase();
        if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
      } catch (_) {}
      return !!(window.WebBridge && typeof WebBridge.isAssetRef === 'function');
    }

    const DOC_TEXT_MAX_CHARS = 250000;
    const DOC_TEXT_EXT_RE = /\.(pdf|txt|md|markdown|html?)$/i;
    const extractingDocTextIds = new Set();
    let knownDocTextScIds = null;
    let autoDocTextTimer = null;
    const pendingDocTextIds = new Set();

    function collectLocalDocSources(sc) {
      const out = [], seen = new Set();
      if (!sc || typeof sc !== 'object') return out;
      const key = String(sc.id || '');
      const norm = s => String(s || '').normalize('NFKC').trim().toLowerCase();
      const add = (p, nm) => {
        if (!p || /^cloud-asset:|^doc-text:/i.test(String(p))) return;
        const name = String(nm || String(p).split(/[\\/]/).pop() || '');
        if (!DOC_TEXT_EXT_RE.test(name) && !DOC_TEXT_EXT_RE.test(String(p))) return;
        const nk = norm(name);
        if (!nk || seen.has(nk)) return;
        seen.add(nk);
        out.push({ path: String(p), name });
      };
      (Array.isArray(sc.docs) ? sc.docs : []).forEach(d => {
        if (!d || typeof d !== 'object') return;
        const nm = d.origName || d.name || '';
        if (IS_ELECTRON && typeof path !== 'undefined' && typeof DATA_ROOT !== 'undefined' && DATA_ROOT && d.rel) {
          try {
            const abs = path.resolve(DATA_ROOT, d.rel);
            if (fs && fs.existsSync && fs.existsSync(abs)) { add(abs, nm); return; }
          } catch (_) {}
        }
        if (d.path) add(d.path, nm);
        if (d.ref) add(d.ref, nm);
      });
      let proj = null;
      try {
        if (window.CCF && typeof CCF.readProject === 'function') proj = CCF.readProject(key);
        else if (Array.isArray(sc.ccfRooms) && sc.ccfRooms[0]) proj = sc.ccfRooms[0].project;
      } catch (_) {}
      const addRefs = list => {
        (Array.isArray(list) ? list : []).forEach(r => {
          if (!r || !r.path) return;
          if (r.type === 'pdf' || r.type === 'doc' || DOC_TEXT_EXT_RE.test(r.name || r.path)) add(r.path, r.origName || r.name);
        });
      };
      if (proj) addRefs(proj.refs);
      (Array.isArray(sc.ccfRooms) ? sc.ccfRooms : []).forEach(rm => { if (rm && rm.project) addRefs(rm.project.refs); });
      if (IS_ELECTRON && fs && path && (!Array.isArray(sc.docs) || !sc.docs.length) && sc.sourcePath) {
        try {
          if (fs.existsSync(sc.sourcePath)) {
            const st = fs.statSync(sc.sourcePath);
            if (st.isFile()) add(sc.sourcePath, path.basename(sc.sourcePath));
            else if (st.isDirectory()) {
              fs.readdirSync(sc.sourcePath, { withFileTypes: true }).forEach(ent => {
                if (ent.isFile() && DOC_TEXT_EXT_RE.test(ent.name)) add(path.join(sc.sourcePath, ent.name), ent.name);
              });
            }
          }
        } catch (_) {}
      }
      return out;
    }

    function hasUnextractedLocalDocs(sc) {
      if (!sc || (!IS_ELECTRON && !window.WebBridge)) return false;
      const existing = new Set((Array.isArray(sc.docTexts) ? sc.docTexts : []).filter(d => d && d.text).map(d => String(d.name || '').normalize('NFKC').trim().toLowerCase()));
      const totalChars = (Array.isArray(sc.docTexts) ? sc.docTexts : []).reduce((s, d) => s + (d && d.text ? d.text.length : 0), 0);
      if (totalChars >= DOC_TEXT_MAX_CHARS) return false;
      const sources = collectLocalDocSources(sc);
      return sources.some(src => {
        if (existing.has(src.name.normalize('NFKC').trim().toLowerCase())) return false;
        if (window.WebBridge && WebBridge.isAssetRef && WebBridge.isAssetRef(src.path)) return WebBridge.hasAssetSync ? WebBridge.hasAssetSync(src.path) : true;
        return !!(IS_ELECTRON && fs && fs.existsSync && fs.existsSync(src.path));
      });
    }

    async function extractScenarioDocTexts(scId, opts) {
      const o = opts || {};
      const key = String(scId || '');
      if (!key || key === '_default' || typeof appState === 'undefined' || !Array.isArray(appState.scenarios)) return { extracted: 0, total: 0 };
      if (!IS_ELECTRON && !window.WebBridge) return { extracted: 0, total: 0 };
      if (extractingDocTextIds.has(key)) return { extracted: 0, total: 0, busy: true };
      const sc = appState.scenarios.find(s => s && String(s.id) === key);
      if (!sc) return { extracted: 0, total: 0 };
      const extractor = (window.CCFScan && window.CCFScan.extractFullTextFromDoc) || (window.CCF && CCF.pdfText && CCF.pdfText.extractFullTextFromDoc);
      if (typeof extractor !== 'function') return { extracted: 0, total: 0 };

      extractingDocTextIds.add(key);
      let extracted = 0, total = 0;
      try {
        if (!Array.isArray(sc.docTexts)) sc.docTexts = [];
        const byName = new Map();
        let curChars = 0;
        sc.docTexts.forEach(dt => {
          if (!dt || !dt.text) return;
          byName.set(String(dt.name || '').normalize('NFKC').trim().toLowerCase(), dt);
          curChars += dt.text.length;
        });
        const sources = collectLocalDocSources(sc);
        for (const src of sources) {
          total++;
          if (curChars >= DOC_TEXT_MAX_CHARS) break;
          const nk = src.name.normalize('NFKC').trim().toLowerCase();
          if (!o.force && byName.has(nk)) continue;
          const isWebAsset = !!(window.WebBridge && WebBridge.isAssetRef && WebBridge.isAssetRef(src.path));
          const accessible = isWebAsset ? (await WebBridge.hasAsset(src.path)) : !!(IS_ELECTRON && fs && fs.existsSync && fs.existsSync(src.path));
          if (!accessible) continue;
          try {
            const remain = DOC_TEXT_MAX_CHARS - curChars;
            if (remain < 500) break;
            const res = await extractor(src.path, { name: src.name, maxPages: 150, maxChars: remain });
            if (res && res.text && res.text.trim()) {
              const entry = {
                id: (window.CCFModel && typeof CCFModel.newId === 'function') ? CCFModel.newId() : uid(),
                name: src.name,
                text: res.text,
                pageCount: Number(res.pageCount) || 1,
                extractedAt: Date.now()
              };
              const prevIdx = sc.docTexts.findIndex(d => d && String(d.name || '').normalize('NFKC').trim().toLowerCase() === nk);
              if (prevIdx >= 0) sc.docTexts[prevIdx] = entry;
              else sc.docTexts.push(entry);
              byName.set(nk, entry);
              curChars += entry.text.length;
              extracted++;
            }
          } catch (e) {
            console.warn('[docTexts] テキスト抽出失敗:', src.name, e);
          }
          await new Promise(r => setTimeout(r, 0));
        }
        trimScenarioDocTextsToBudget(sc, DOC_TEXT_MAX_CHARS);
        if (extracted > 0) {
          sc.detailEdited = true;
          if (!o.skipSave && typeof saveState === 'function') saveState(false, { skipDetailEdited: false });
          try { window.dispatchEvent(new CustomEvent('ccf-refs-changed')); } catch (_) {}
        }
      } finally {
        extractingDocTextIds.delete(key);
      }
      return { extracted, total };
    }
    window.extractScenarioDocTexts = extractScenarioDocTexts;

    function scheduleAutoDocTextExtraction(scId) {
      if (!IS_ELECTRON && !window.WebBridge) return;
      if (typeof appState === 'undefined' || !Array.isArray(appState.scenarios)) return;
      if (!knownDocTextScIds) {
        knownDocTextScIds = new Set(appState.scenarios.filter(s => s && s.id).map(s => String(s.id)));
      }
      if (scId) {
        pendingDocTextIds.add(String(scId));
      } else {
        appState.scenarios.forEach(sc => {
          if (!sc || !sc.id || String(sc.id) === '_default') return;
          const sid = String(sc.id);
          if (!knownDocTextScIds.has(sid)) {
            knownDocTextScIds.add(sid);
            pendingDocTextIds.add(sid);
          }
        });
      }
      if (!pendingDocTextIds.size) return;
      if (autoDocTextTimer) clearTimeout(autoDocTextTimer);
      autoDocTextTimer = setTimeout(async () => {
        autoDocTextTimer = null;
        const ids = [...pendingDocTextIds];
        pendingDocTextIds.clear();
        for (const id of ids) {
          await extractScenarioDocTexts(id, { silent: true });
        }
      }, 2000);
    }
    window.scheduleAutoDocTextExtraction = scheduleAutoDocTextExtraction;
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('ccf-refs-changed', () => {
        const sid = (window.CCF && CCF.S && CCF.S.key) || (typeof currentScenarioId !== 'undefined' ? currentScenarioId : '');
        if (sid && sid !== '_default') scheduleAutoDocTextExtraction(sid);
      });
    }

    async function syncScenarioAssetsToWeb(scId, opts) {
      const o = opts || {};
      const key = String(scId || '');
      if (!key || typeof appState === 'undefined' || !Array.isArray(appState.scenarios)) return { converted: 0, total: 0 };
      const sc = appState.scenarios.find(s => s && String(s.id) === key);
      if (!sc) return { converted: 0, total: 0 };
      if (typeof window.convertSourceToWebpRef !== 'function') {
        if (!o.silent && typeof toast === 'function') toast('⚠️ 画像変換機能が利用できません');
        return { converted: 0, total: 0 };
      }

      if (!o.silent && typeof toast === 'function') toast(`☁️ 「${sc.title || 'シナリオ'}」の登録素材画像をWebP化・同期しています…`);

      let proj = null;
      try {
        if (window.CCF && typeof CCF.readProject === 'function') proj = CCF.readProject(key);
        else if (Array.isArray(sc.ccfRooms) && sc.ccfRooms[0]) proj = sc.ccfRooms[0].project;
      } catch (_) {}
      const refs = (proj && Array.isArray(proj.refs)) ? proj.refs : [];
      if (!Array.isArray(sc.images)) sc.images = [];
      const isImgFile = n => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(n || ''));
      const normKey = (name, origName) => String(origName || name || '').normalize('NFKC').trim().toLowerCase();

      const catBefore = syncScenarioAssetCatalog(sc);
      const byName = new Map();
      sc.images.forEach(im => {
        if (!im || typeof im !== 'object') return;
        const k = normKey(im.name, im.origName);
        if (k) byName.set(k, im);
      });

      let converted = 0, skipped = 0, total = 0;
      const tasks = [];
      const seenKeys = new Set();

      refs.forEach(r => {
        if (!r || typeof r !== 'object') return;
        const nm = r.name || (r.path ? String(r.path).split(/[\\/]/).pop() : '');
        if (r.type !== 'image' && !isImgFile(nm || r.path)) return;
        const k = normKey(nm, r.origName);
        if (k && seenKeys.has(k)) return;
        if (k) seenKeys.add(k);
        const exImg = k ? byName.get(k) : null;
        const exCat = catBefore.find(c => c.type === 'image' && normKey(c.name, c.origName) === k);
        tasks.push({
          name: nm || 'image.webp',
          origName: r.origName || nm || 'image.webp',
          category: r.category || (exImg && exImg.category) || (exCat && exCat.category) || '',
          tags: Array.isArray(r.tags) ? r.tags : ((exImg && exImg.tags) || []),
          path: r.path || '',
          cloudSha: r.cloudSha || (exCat && exCat.cloudSha) || '',
          existingImg: exImg,
          existingThumbRef: (exCat && exCat.thumbRef) || (exImg && (exImg.thumbRef || exImg.dataUrl)) || ''
        });
      });

      sc.images.forEach(im => {
        if (!im || typeof im !== 'object') return;
        const nm = im.name || 'image.webp';
        const k = normKey(nm, im.origName);
        if (k && seenKeys.has(k)) return;
        if (k) seenKeys.add(k);
        tasks.push({
          name: nm,
          origName: im.origName || nm,
          category: im.category || '',
          tags: Array.isArray(im.tags) ? im.tags : [],
          path: im.path || '',
          cloudSha: im.cloudSha || '',
          existingImg: im,
          existingThumbRef: im.thumbRef || im.dataUrl || ''
        });
      });

      let quotaReached = false;
      for (const t of tasks) {
        total++;
        if (o.respectQuota && isDailyWebImgQuotaReached()) {
          quotaReached = true;
          break;
        }
        const curRef = String(t.existingThumbRef || '');
        if (o.onlyMissing && curRef.startsWith('@img:') && typeof window.hasLocalImageHashAsync === 'function') {
          if (await window.hasLocalImageHashAsync(curRef.slice(5))) {
            skipped++;
            continue;
          }
        }
        let source = null;
        if (t.existingImg && t.existingImg.dataUrl) {
          source = t.existingImg.dataUrl;
        } else if (t.path) {
          if (IS_ELECTRON && fs && fs.existsSync && fs.existsSync(t.path)) {
            source = t.path;
          } else if (window.WebBridge && WebBridge.isAssetRef && WebBridge.isAssetRef(t.path)) {
            source = t.path;
          }
        }
        if (!source && t.cloudSha) {
          const u8 = await readCloudAssetBytes(t.cloudSha, { download: !o.silent, name: t.name, scenarioId: key });
          if (u8) source = u8;
        }
        if (!source && curRef.startsWith('@img:')) {
          source = curRef;
        }
        if (!source) { skipped++; continue; }

        const res = await window.convertSourceToWebpRef(source, { maxDim: 800, quality: 0.80 });
        if (!res || !res.ref) { skipped++; continue; }

        if (t.existingImg) {
          t.existingImg.dataUrl = res.ref;
          t.existingImg.thumbRef = res.ref;
          if (!t.existingImg.category && t.category) t.existingImg.category = t.category;
        } else {
          const nid = (window.CCFModel && typeof CCFModel.newId === 'function') ? CCFModel.newId() : uid();
          const newEntry = {
            id: nid,
            name: t.name,
            origName: t.origName,
            dataUrl: res.ref,
            thumbRef: res.ref,
            category: _normCatName(t.category),
            tags: t.tags || [],
            addedAt: Date.now()
          };
          sc.images.push(newEntry);
          const k = normKey(newEntry.name, newEntry.origName);
          if (k) byName.set(k, newEntry);
        }
        converted++;
        addDailyWebImgQuota(1);
        if (converted % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }

      syncScenarioAssetCatalog(sc);
      const textRes = await extractScenarioDocTexts(key, { silent: true, skipSave: true });
      const textExtracted = (textRes && textRes.extracted) || 0;
      if (!quotaReached) {
        sc.webAssetsSyncedAt = Date.now();
        sc.webAssetsSyncedCount = total;
      }
      if (converted > 0 || textExtracted > 0) {
        sc.detailEdited = true;
        if (window.CCF && CCF.assets && typeof CCF.assets.invalidateUnified === 'function') {
          CCF.assets.invalidateUnified(key, false);
        }
        if (typeof saveState === 'function') saveState(false, { skipDetailEdited: false });
        if (!o.silent && typeof window.cloudSyncNow === 'function' && currentAuthUser) {
          await window.cloudSyncNow({ manual: true, silentToast: true });
        }
        try { window.dispatchEvent(new CustomEvent('ccf-refs-changed')); } catch (_) {}
      } else if (!quotaReached && !sc._webSyncMarkSaved) {
        sc._webSyncMarkSaved = true;
      }
      if (!o.silent && typeof toast === 'function') {
        if (converted > 0 || textExtracted > 0) {
          const parts = [];
          if (converted > 0) parts.push(`登録素材画像 ${converted}件を軽量WebP化`);
          if (textExtracted > 0) parts.push(`資料テキスト ${textExtracted}件を抽出`);
          toast(`✅ 「${sc.title || 'シナリオ'}」の${parts.join('・')}しクラウド同期しました`);
        } else {
          toast(total > 0 || (textRes && textRes.total > 0) ? 'ℹ️ 変換・同期できる新しいローカル画像や未抽出資料はありませんでした（既に同期済みです）' : 'ℹ️ このシナリオに登録されている画像・資料がありません');
        }
      }
      return { converted, skipped, total, textExtracted, quotaReached };
    }
    window.syncScenarioAssetsToWeb = syncScenarioAssetsToWeb;

    function scheduleAutoWebSync(scId) {
      const key = String(scId || '');
      if (!key || key === '_default' || isFileDirectOpen()) return;
      scheduleAutoDocTextExtraction(key);
      const cs = getSettings();
      if (cs.webAssetSyncMode === 'manual') return;
      if (autoWebSyncTimers.has(key)) clearTimeout(autoWebSyncTimers.get(key));
      autoWebSyncTimers.set(key, setTimeout(() => {
        autoWebSyncTimers.delete(key);
        if (isSyncActive()) {
          onSyncIdle(() => scheduleAutoWebSync(key));
          return;
        }
        void syncScenarioAssetsToWeb(key, { silent: true, onlyMissing: true, respectQuota: true });
      }, 2500));
    }

    function _scheduleNextDayWebAssetSync() {
      if (bgWebAssetSyncResumeTimer) clearTimeout(bgWebAssetSyncResumeTimer);
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 1, 0, 0);
      const delay = Math.max(60000, nextMidnight.getTime() - now.getTime());
      bgWebAssetSyncResumeTimer = setTimeout(() => {
        bgWebAssetSyncResumeTimer = null;
        void startBackgroundWebAssetSync({ manual: false });
      }, Math.min(delay, 2147483647));
    }

    async function startBackgroundWebAssetSync(opts) {
      const o = opts || {};
      if (bgWebAssetSyncRunning) {
        if (o.manual && typeof toast === 'function') toast('ℹ️ バックグラウンドWeb同期はすでに実行中です');
        return { started: false, reason: 'already_running' };
      }
      if (!isHomePcEnv()) {
        if (o.manual && typeof toast === 'function') toast('⚠️ この機能は自宅PC（Electron または localhost）から実行してください');
        return { started: false, reason: 'not_home_pc' };
      }
      if (!currentAuthUser) {
        if (o.manual && typeof toast === 'function') toast('⚠️ Web同期を行うにはログインしてください');
        return { started: false, reason: 'not_logged_in' };
      }
      const cs = getSettings();
      if (!o.manual && cs.webAssetSyncMode !== 'auto_all') {
        return { started: false, reason: 'mode_not_auto_all' };
      }
      if (cs.syncFirestoreText === false) {
        if (o.manual && typeof toast === 'function') toast('⚠️ クラウド同期がOFFになっています');
        return { started: false, reason: 'sync_disabled' };
      }
      if (isDailyWebImgQuotaReached()) {
        if (o.manual && typeof toast === 'function') {
          toast(`⚠️ 本日のWeb送信上限（${WEB_ASSET_DAILY_QUOTA_LIMIT.toLocaleString()}枚）に達しているため、明日自動で再開します`);
        }
        _scheduleNextDayWebAssetSync();
        return { started: false, reason: 'quota_reached' };
      }
      if (typeof appState === 'undefined' || !Array.isArray(appState.scenarios)) {
        return { started: false, reason: 'no_scenarios' };
      }

      bgWebAssetSyncRunning = true;
      let processedScenarios = 0;
      let totalConverted = 0;
      let stoppedByQuota = false;

      if (o.manual && typeof toast === 'function') {
        toast('☁️ 未同期シナリオの登録素材画像をバックグラウンドでWeb同期しています…');
      }

      try {
        const list = appState.scenarios.filter(sc => sc && sc.id && String(sc.id) !== '_default');
        for (const sc of list) {
          if (!o.manual && getSettings().webAssetSyncMode !== 'auto_all') break;
          if (!currentAuthUser) break;
          if (!o.manual && isSyncActive()) {
            await new Promise(resolve => onSyncIdle(resolve));
            if (getSettings().webAssetSyncMode !== 'auto_all' || !currentAuthUser) break;
          }
          if (isDailyWebImgQuotaReached()) {
            stoppedByQuota = true;
            break;
          }

          // すでに同期済みで、かつ画像数が増えていない場合はスキップ
          let curImgCount = Array.isArray(sc.images) ? sc.images.length : 0;
          try {
            if (window.CCF && typeof CCF.readProject === 'function') {
              const proj = CCF.readProject(String(sc.id));
              if (proj && Array.isArray(proj.refs)) {
                curImgCount = Math.max(curImgCount, proj.refs.filter(r => r && r.type === 'image').length);
              }
            }
          } catch (_) {}
          if (sc.webAssetsSyncedAt && curImgCount <= (Number(sc.webAssetsSyncedCount) || 0) && !hasUnextractedLocalDocs(sc)) {
            continue;
          }

          const res = await syncScenarioAssetsToWeb(sc.id, { silent: true, onlyMissing: true, respectQuota: true });
          processedScenarios++;
          totalConverted += ((res && res.converted) || 0) + ((res && res.textExtracted) || 0);
          if (res && res.quotaReached) {
            stoppedByQuota = true;
            break;
          }
          // UIに負荷をかけないようアイドル間隔を空ける
          await new Promise(r => setTimeout(r, 1500));
        }

        if (totalConverted > 0 && typeof window.cloudSyncNow === 'function' && currentAuthUser) {
          await window.cloudSyncNow({ manual: false, silentToast: true });
        }
        if (stoppedByQuota) {
          _scheduleNextDayWebAssetSync();
          if (o.manual && typeof toast === 'function') {
            toast(`⏸️ 本日の送信上限（${WEB_ASSET_DAILY_QUOTA_LIMIT.toLocaleString()}枚）に達したため一時停止しました（${totalConverted}枚同期済み・明日自動再開）`);
          }
        } else if (o.manual && typeof toast === 'function') {
          toast(totalConverted > 0
            ? `✅ 未同期シナリオのWeb同期が完了しました（${totalConverted}枚の画像を軽量WebP化・同期）`
            : 'ℹ️ 同期が必要な未処理のローカル画像はありませんでした');
        }
      } finally {
        bgWebAssetSyncRunning = false;
        try {
          if (document.getElementById('settingsCloudHost')) renderSettingsUI();
        } catch (_) {}
      }
      return { started: true, processedScenarios, totalConverted, stoppedByQuota };
    }
    window.startBackgroundWebAssetSync = startBackgroundWebAssetSync;
    setTimeout(() => {
      if (isSyncActive()) {
        onSyncIdle(() => setTimeout(() => { void startBackgroundWebAssetSync({ manual: false }); }, 2000));
        return;
      }
      void startBackgroundWebAssetSync({ manual: false });
    }, 8000);

    // ---- 2段階オンデマンドダウンロード（第1段階: サムネ一括パック / 第2段階: シナリオZIP一括取得＋旧個別取得フォールバック） ----
    async function downloadRawAssetBytesFromCloud(sha256) {
      const sha = String(sha256 || '').trim();
      if (!sha) return null;
      const targets = await getActiveTargets(false);
      if (targets.folder) {
        const u8 = await readFolderSyncFile(targets.folder, ['assets', sha]);
        if (u8) return u8;
      }
      if (targets.gdrive) {
        const fIds = await ensureDriveFolders();
        if (!gdriveAssetSet) gdriveAssetSet = await listDriveFolderFiles(fIds.assets);
        const f = gdriveAssetSet.get(sha);
        if (f && f.id) return await downloadDriveFile(f.id);
      }
      return null;
    }

    function findOwnerPackForRefOrSha(refKey, sha256, hintScenarioId) {
      if (hintScenarioId) {
        const h = String(hintScenarioId);
        return (h === '_common' || h === '_settings') ? 'common_library' : `scenario:${h}`;
      }
      const rKey = String(refKey || '').trim();
      const sha = String(sha256 || '').trim().toLowerCase();

      if (rKey && refToSha[rKey] && refToSha[rKey].scenarioId) {
        const sid = String(refToSha[rKey].scenarioId);
        return (sid === '_common' || sid === '_settings') ? 'common_library' : `scenario:${sid}`;
      }
      if (sha && remoteManifest[sha] && remoteManifest[sha].scenarioId) {
        const sid = String(remoteManifest[sha].scenarioId);
        return (sid === '_common' || sid === '_settings') ? 'common_library' : `scenario:${sid}`;
      }
      for (const [sid, list] of Object.entries(scenarioAssets)) {
        if (!Array.isArray(list)) continue;
        if (list.some(ent => ent && ((sha && String(ent.sha256 || '').toLowerCase() === sha) || (rKey && ent.refKey === rKey)))) {
          return `scenario:${sid}`;
        }
      }
      if (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) {
        for (const sc of appState.scenarios) {
          if (!sc || !sc.id) continue;
          const inv = collectScenarioAssetInventory(sc);
          if (rKey && rKey.startsWith('@img:') && inv.imgHashes.has(rKey.slice(5))) return `scenario:${sc.id}`;
          if (rKey && inv.idbRefs.has(rKey)) return `scenario:${sc.id}`;
          if (sha && inv.cloudAssets.some(ca => ca.sha256 === sha)) return `scenario:${sc.id}`;
          if (rKey && inv.diskPaths.has(rKey)) return `scenario:${sc.id}`;
        }
      }
      if (rKey && typeof appState !== 'undefined') {
        const inCommon = JSON.stringify(appState.imageAssets || []).indexOf(rKey) >= 0
          || (appState.botAvatarData && appState.botAvatarData === rKey);
        if (inCommon) return 'common_library';
      }
      return '';
    }

    async function downloadAndExtractPack(packKey, opts) {
      const o = opts || {};
      const key = String(packKey || '');
      if (!key) return { found: false, extracted: 0 };
      const remoteHash = (packManifest[key] && packManifest[key].packHash) || '';
      if (!o.force && extractedPackCache.has(key) && (!remoteHash || extractedPackCache.get(key) === remoteHash)) {
        return { found: true, extracted: 0, cached: true };
      }
      if (packFetchInFlight.has(key)) return await packFetchInFlight.get(key);

      const run = (async () => {
        const targets = await getActiveTargets(false);
        if (!targets.gdrive && !targets.folder) return { found: false, extracted: 0 };

        const packName = key === 'common_library'
          ? 'common_library.zip'
          : (key.startsWith('scenario:') ? getPackFileName('scenario', key.slice('scenario:'.length)) : key);

        let zipBytes = null;
        if (targets.folder) {
          zipBytes = await readFolderSyncFile(targets.folder, ['assets', packName]);
        }
        if (!zipBytes && targets.gdrive) {
          const fIds = await ensureDriveFolders();
          if (!gdriveAssetSet) gdriveAssetSet = await listDriveFolderFiles(fIds.assets);
          const f = gdriveAssetSet.get(packName);
          if (f && f.id) zipBytes = await downloadDriveFile(f.id);
        }
        if (!zipBytes || !zipBytes.byteLength) return { found: false, extracted: 0 };

        const zr = await readZipEntries(zipBytes);
        const entryMap = new Map();
        zr.entries.forEach(e => { if (e && !e.dir) entryMap.set(e.name, e); });

        let idxObj = null;
        const idxEnt = entryMap.get('index.json');
        if (idxEnt) {
          try {
            idxObj = JSON.parse(new TextDecoder().decode(await zr.readEntry(idxEnt)));
          } catch (_) {}
        }

        const assetsList = (idxObj && Array.isArray(idxObj.assets)) ? idxObj.assets : [];
        const byEntry = new Map();
        assetsList.forEach(a => {
          if (!a || !a.entry) return;
          if (!byEntry.has(a.entry)) byEntry.set(a.entry, []);
          byEntry.get(a.entry).push(a);
        });

        let extracted = 0;
        let idbMetaChanged = false;
        const scIdFromKey = key.startsWith('scenario:') ? key.slice('scenario:'.length) : '';

        for (const ent of zr.entries) {
          if (!ent || ent.dir || ent.name === 'index.json') continue;
          const metas = byEntry.get(ent.name) || [];
          let u8 = null;
          try {
            u8 = await zr.readEntry(ent);
          } catch (e) {
            console.warn('[CloudSync] ZIPエントリ展開失敗:', ent.name, e);
            continue;
          }
          if (!u8) continue;

          const primaryMeta = metas[0] || {};
          const fileSha = (primaryMeta.sha256 || (await window.CloudCodec.sha256Hex(u8))).toLowerCase();
          const mime = primaryMeta.mime || (window.WebBridge ? WebBridge.mimeFromName(primaryMeta.name || ent.name) : 'application/octet-stream');
          const origName = primaryMeta.name || primaryMeta.origName || ent.name.split('/').pop() || fileSha;

          await writeLocalCloudCacheBytes(fileSha, u8, { name: origName, mime });
          remoteManifest[fileSha] = Object.assign({}, remoteManifest[fileSha] || {}, {
            name: origName,
            mime,
            size: u8.byteLength,
            isThumb: false,
            scenarioId: primaryMeta.scenarioId || scIdFromKey || '',
            refKey: primaryMeta.refKey || '',
            kind: primaryMeta.kind || primaryMeta.category || ''
          });

          const metasToApply = metas.length ? metas : [{ sha256: fileSha, name: origName, mime, refKey: '', scenarioId: scIdFromKey }];
          for (const m of metasToApply) {
            const mSha = String(m.sha256 || fileSha).toLowerCase();
            if (mSha !== fileSha) {
              await writeLocalCloudCacheBytes(mSha, u8, { name: m.name || origName, mime: m.mime || mime });
            }
            const rKey = String(m.refKey || '');
            if (rKey) {
              const prev = refToSha[rKey] || {};
              prev.fullSha = mSha;
              prev.name = m.name || prev.name || origName;
              prev.mime = m.mime || mime;
              prev.size = u8.byteLength;
              if (m.scenarioId || scIdFromKey) prev.scenarioId = String(m.scenarioId || scIdFromKey);
              refToSha[rKey] = prev;

              if (rKey.startsWith('@img:')) {
                const imgH = rKey.slice(5);
                if (imgH && typeof window.putIdbImageBlob === 'function') {
                  const has = typeof window.hasLocalImageHashAsync === 'function' ? await window.hasLocalImageHashAsync(imgH) : false;
                  if (!has) {
                    await window.putIdbImageBlob(imgH, new Blob([u8], { type: m.mime || mime }));
                  }
                }
              } else if (/^idb-asset:\/\//i.test(rKey) && typeof idbPut === 'function') {
                const idbKey = idbStoreKeyForAssetRef(rKey);
                const mMime = m.mime || mime || 'application/octet-stream';
                const blob = new Blob([u8], { type: mMime });
                await idbPut('assets', idbKey, { id: idbKey, name: m.name || idbKey, mime: mMime, size: u8.byteLength, mtime: Date.now(), blob, isCloudCache: true });
                idbAssetMeta[rKey] = { sha256: mSha, name: m.name || idbKey, mime: mMime, size: u8.byteLength, isCloudCache: true };
                localCloudAssetSet.add('idb:' + idbKey);
                localCloudAssetSet.add(mSha);
                idbMetaChanged = true;
              }
            }
          }
          extracted++;
        }

        if (idbMetaChanged) await persistIdbAssetMeta();
        const packHashNow = (idxObj && idxObj.packHash) || remoteHash || ('len:' + zipBytes.byteLength);
        extractedPackCache.set(key, packHashNow);
        if (idxObj && idxObj.packHash) {
          packManifest[key] = Object.assign({}, packManifest[key] || {}, {
            packName,
            packHash: idxObj.packHash,
            packType: idxObj.packType || (key === 'common_library' ? 'common' : 'scenario'),
            scenarioId: idxObj.scenarioId || scIdFromKey || '',
            updatedAt: idxObj.updatedAt || Date.now(),
            itemCount: assetsList.length
          });
        }
        await saveManifestCache();
        return { found: true, extracted };
      })();

      packFetchInFlight.set(key, run);
      try { return await run; } finally { packFetchInFlight.delete(key); notifySyncIdleIfReady(); }
    }

    async function fetchThumbBlob(imgHash) {
      if (!imgHash) return null;
      const mem = thumbsPackMemMap.get(imgHash);
      if (mem && mem.bytes) return new Blob([mem.bytes], { type: mem.mime || 'image/webp' });
      try {
        await ensureThumbsPackUnpacked();
        const memAfter = thumbsPackMemMap.get(imgHash);
        if (memAfter && memAfter.bytes) return new Blob([memAfter.bytes], { type: memAfter.mime || 'image/webp' });
        if (typeof idbGet === 'function') {
          const tb = await idbGet('thumbs', imgHash);
          if (tb) return tb;
        }
      } catch (_) {}

      // 後方互換フォールバック：旧バラバラサムネファイルを取得
      const entry = refToSha['@img:' + imgHash];
      const sha = entry && (entry.thumbSha || entry.fullSha);
      if (!sha) return null;
      try {
        const u8 = await downloadRawAssetBytesFromCloud(sha);
        return u8 ? new Blob([u8], { type: entry.mime || 'image/webp' }) : null;
      } catch (_) { return null; }
    }

    async function fetchFullImageBlob(imgHash) {
      if (!imgHash) return null;
      const refKey = '@img:' + imgHash;
      const entry = refToSha[refKey];
      const sha = entry && entry.fullSha;
      if (sha) {
        const cached = await readLocalCloudCacheBytes(sha);
        if (cached && cached.byteLength) return new Blob([cached], { type: entry.mime || 'image/webp' });
      }

      // シナリオZIPパックから一括取得＆展開
      const ownerPack = findOwnerPackForRefOrSha(refKey, sha, '');
      if (ownerPack) {
        try {
          const res = await downloadAndExtractPack(ownerPack);
          if (res && res.found) {
            if (typeof idbGet === 'function') {
              const b = await idbGet('images', imgHash);
              if (b) return b;
            }
            const updatedEntry = refToSha[refKey];
            const updatedSha = (updatedEntry && updatedEntry.fullSha) || sha;
            if (updatedSha) {
              const u8 = await readLocalCloudCacheBytes(updatedSha);
              if (u8 && u8.byteLength) return new Blob([u8], { type: (updatedEntry && updatedEntry.mime) || 'image/webp' });
            }
          }
        } catch (_) {}
      }

      // 後方互換フォールバック：旧方式の個別取得
      if (sha) {
        try {
          const u8 = await downloadRawAssetBytesFromCloud(sha);
          if (u8) return new Blob([u8], { type: (entry && entry.mime) || 'image/webp' });
        } catch (_) {}
      }
      return await fetchMissingImageBlob(imgHash);
    }

    async function fetchMissingImageBlob(shaOrHash) {
      if (!shaOrHash) return null;
      try {
        const u8 = await downloadRawAssetBytesFromCloud(shaOrHash);
        if (u8) return new Blob([u8]);
      } catch (_) {}
      return null;
    }

    async function readCloudAssetBytes(refOrSha, opts) {
      const o = opts || {};
      const parsed = isCloudAssetRef(refOrSha) ? parseCloudAssetRef(refOrSha) : { sha256: String(refOrSha || '').trim(), name: o.name || '' };
      if (!parsed || !parsed.sha256) return null;
      const sha = parsed.sha256.toLowerCase();
      const cached = await readLocalCloudCacheBytes(sha);
      if (cached && cached.byteLength) return cached;
      if (o.download === false) return null;

      // シナリオZIPパックから1回のリクエストで一括取得
      const ownerPack = findOwnerPackForRefOrSha(isCloudAssetRef(refOrSha) ? refOrSha : '', sha, o.scenarioId);
      if (ownerPack) {
        try {
          const res = await downloadAndExtractPack(ownerPack);
          if (res && res.found) {
            const after = await readLocalCloudCacheBytes(sha);
            if (after && after.byteLength) return after;
          }
        } catch (_) {}
      }

      // 後方互換フォールバック：旧バラバラファイル取得
      const u8 = await downloadRawAssetBytesFromCloud(sha);
      if (u8 && u8.byteLength) {
        const meta = remoteManifest[sha] || {};
        await writeLocalCloudCacheBytes(sha, u8, { name: parsed.name || meta.name || sha, mime: o.mime || meta.mime || '' });
        return u8;
      }
      return null;
    }

    async function ensureAssetByIdbRef(idbRef, opts) {
      if (!idbRef || !/^idb-asset:\/\//i.test(idbRef)) return null;
      if (window.WebBridge && await WebBridge.hasAsset(idbRef)) {
        return await WebBridge.readAssetBytes(idbRef);
      }
      const o = opts || {};
      const entry = refToSha[idbRef];
      const sha = entry && entry.fullSha;
      const ownerPack = findOwnerPackForRefOrSha(idbRef, sha, o.scenarioId || (entry && entry.scenarioId));
      if (ownerPack) {
        try {
          await downloadAndExtractPack(ownerPack);
          if (window.WebBridge && await WebBridge.hasAsset(idbRef)) {
            return await WebBridge.readAssetBytes(idbRef);
          }
        } catch (_) {}
      }
      if (!sha) return null;
      const u8 = await readCloudAssetBytes(sha, { download: true, name: entry.name, mime: entry.mime, scenarioId: o.scenarioId });
      if (u8 && typeof idbPut === 'function') {
        const idbKey = idbStoreKeyForAssetRef(idbRef);
        const mime = entry.mime || (window.WebBridge ? WebBridge.mimeFromName(entry.name || idbRef) : 'application/octet-stream');
        const blob = new Blob([u8], { type: mime });
        await idbPut('assets', idbKey, { id: idbKey, name: entry.name || idbKey, mime, size: u8.byteLength, mtime: Date.now(), blob, isCloudCache: true });
        idbAssetMeta[idbRef] = { sha256: sha, name: entry.name || idbKey, mime, size: u8.byteLength, isCloudCache: true };
        localCloudAssetSet.add('idb:' + idbKey);
        localCloudAssetSet.add(sha.toLowerCase());
        await persistIdbAssetMeta();
      }
      return u8;
    }

    async function readByPathOrName(localPath, opts) {
      if (!localPath) return null;
      const o = opts || {};
      const hit = lookupShaForRef(localPath);
      if (hit && hit.sha256) return await readCloudAssetBytes(hit.sha256, { download: true, name: hit.name, mime: hit.mime, scenarioId: o.scenarioId });
      const base = String(localPath).split(/[\\/]/).pop().toLowerCase();
      for (const [sha, meta] of Object.entries(remoteManifest)) {
        if (meta && !meta.isThumb && meta.name && meta.name.toLowerCase() === base) {
          return await readCloudAssetBytes(sha, { download: true, name: meta.name, mime: meta.mime, scenarioId: o.scenarioId || meta.scenarioId });
        }
      }
      return null;
    }

    function collectScenarioAssetInventory(sc) {
      const imgHashes = new Set();
      const cloudAssets = []; // { sha256, name, mime, kind, refKey }
      const idbRefs = new Set();
      const diskPaths = new Set();
      if (!sc || typeof sc !== 'object') return { imgHashes, cloudAssets, idbRefs, diskPaths };

      const seenSha = new Set();
      const addCloudSha = (sha, info) => {
        const s = String(sha || '').toLowerCase();
        if (!s || seenSha.has(s)) return;
        seenSha.add(s);
        cloudAssets.push({ sha256: s, ...(info || {}) });
      };
      const scanVal = (v, obj) => {
        if (typeof v !== 'string' || !v) return;
        if (v.startsWith('@img:')) {
          imgHashes.add(v.slice(5));
        } else if (v.startsWith('blob:') && typeof imgUrlToHash !== 'undefined') {
          const h = imgUrlToHash.get(v);
          if (h) imgHashes.add(h);
        } else if (isCloudAssetRef(v)) {
          const p = parseCloudAssetRef(v);
          if (p) addCloudSha(p.sha256, { name: (obj && obj.name) || p.name, kind: (obj && obj.type) || 'asset', refKey: v });
        } else if (/^idb-asset:\/\//i.test(v)) {
          idbRefs.add(v);
          const hit = refToSha[v];
          if (hit && hit.fullSha) addCloudSha(hit.fullSha, { name: hit.name, mime: hit.mime, refKey: v });
        } else if (IS_ELECTRON && /^([A-Za-z]:[\\/]|\\\\|\/)/.test(v)) {
          diskPaths.add(v);
        }
      };
      const walk = node => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (typeof v === 'string') scanVal(v, node);
          else if (v && typeof v === 'object') walk(v);
        }
      };
      walk(sc);
      if (sc.id && Array.isArray(scenarioAssets[String(sc.id)])) {
        scenarioAssets[String(sc.id)].forEach(ent => {
          if (ent && !ent.isThumb && ent.sha256) addCloudSha(ent.sha256, ent);
        });
      }
      return { imgHashes, cloudAssets, idbRefs, diskPaths };
    }

    function isAssetRefLocallyCachedSync(refKey, shaHint) {
      if (shaHint && localCloudAssetSet.has(String(shaHint).toLowerCase())) return true;
      if (isCloudAssetRef(refKey)) {
        const p = parseCloudAssetRef(refKey);
        return !!(p && localCloudAssetSet.has(p.sha256));
      }
      if (/^idb-asset:\/\//i.test(refKey)) {
        if (window.WebBridge && WebBridge.hasAssetSync && WebBridge.hasAssetSync(refKey)) return true;
        const k = idbStoreKeyForAssetRef(refKey);
        return localCloudAssetSet.has('idb:' + k);
      }
      return false;
    }

    function isPathInsideMethodBFolder(p) {
      const cs = getSettings();
      if (!cs.folderSyncEnabled || !cs.localSyncPath || !p) return false;
      const norm = x => String(x || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
      const np = norm(p), nb = norm(cs.localSyncPath);
      return !!(np && nb && (np === nb || np.startsWith(nb + '/')));
    }

    function getScenarioCacheStatus(sc, opts) {
      if (!sc || !sc.id) return { status: 'cached', label: '💻 この端末に保持済み', icon: '💻', total: 0, cached: 0, missing: 0, releasable: 0, isMethodBDirectOnly: false };
      const detailed = !!(opts && opts.detailed);
      const pinned = !!(sc.pinnedOffline || isScenarioPinned(sc.id));
      if (!detailed) {
        if (pinned) return { status: 'pinned', label: '📌 常時保持中', icon: '📌', total: 0, cached: 0, missing: 0, releasable: 0, isMethodBDirectOnly: false };
        if (sc.localCached === true) return { status: 'cached', label: '💻 この端末に保持済み', icon: '💻', total: 0, cached: 0, missing: 0, releasable: 0, isMethodBDirectOnly: false };
        const scEnts = scenarioAssets[String(sc.id)];
        if (Array.isArray(scEnts) && scEnts.some(ent => {
          if (!ent || ent.isThumb || !ent.sha256) return false;
          if (localCloudAssetSet.has(ent.sha256)) return false;
          if (ent.refKey && ent.refKey.startsWith('@img:') && typeof window.hasLocalImageHash === 'function' && window.hasLocalImageHash(ent.refKey.slice(5))) return false;
          if (ent.refKey && isAssetRefLocallyCachedSync(ent.refKey, ent.sha256)) return false;
          return true;
        })) {
          return { status: 'cloud_only', label: '☁️ クラウドのみ', icon: '☁️', total: 0, cached: 0, missing: 0, releasable: 0, isMethodBDirectOnly: false };
        }
        if (typeof sc.imageUrl === 'string' && isCloudAssetRef(sc.imageUrl)) {
          const p = parseCloudAssetRef(sc.imageUrl);
          if (p && !localCloudAssetSet.has(p.sha256)) {
            return { status: 'cloud_only', label: '☁️ クラウドのみ', icon: '☁️', total: 0, cached: 0, missing: 0, releasable: 0, isMethodBDirectOnly: false };
          }
        }
        const checkArr = arr => Array.isArray(arr) && arr.some(it => it && it.cloudSha && !localCloudAssetSet.has(String(it.cloudSha).toLowerCase()) && !it.rel && !it.path);
        if (checkArr(sc.pdfs) || checkArr(sc.images) || checkArr(sc.docs)) {
          return { status: 'cloud_only', label: '☁️ クラウドのみ', icon: '☁️', total: 0, cached: 0, missing: 0, releasable: 0, isMethodBDirectOnly: false };
        }
        return { status: 'cached', label: '💻 この端末に保持済み', icon: '💻', total: 0, cached: 0, missing: 0, releasable: 0, isMethodBDirectOnly: false };
      }

      const inv = collectScenarioAssetInventory(sc);
      let total = 0, cached = 0, missing = 0, releasable = 0;

      inv.imgHashes.forEach(h => {
        total++;
        const hasLocal = typeof window.hasLocalImageHash === 'function' ? window.hasLocalImageHash(h) : false;
        const inCloud = !!(refToSha['@img:' + h] && refToSha['@img:' + h].fullSha);
        if (hasLocal) {
          cached++;
          if (inCloud) releasable++;
        } else if (inCloud) {
          missing++;
        }
      });

      const countedKeys = new Set();
      inv.idbRefs.forEach(ref => {
        total++;
        countedKeys.add(ref);
        const hasLocal = isAssetRefLocallyCachedSync(ref, refToSha[ref] && refToSha[ref].fullSha);
        const inCloud = !!(refToSha[ref] && refToSha[ref].fullSha);
        if (hasLocal) {
          cached++;
          if (inCloud) releasable++;
        } else if (inCloud) {
          missing++;
        }
      });

      inv.cloudAssets.forEach(ca => {
        if (ca.refKey && countedKeys.has(ca.refKey)) return;
        total++;
        const hasLocal = localCloudAssetSet.has(ca.sha256);
        if (hasLocal) {
          cached++;
          releasable++;
        } else {
          missing++;
        }
      });

      const cs = getSettings();
      let hasDirectDisk = false;
      inv.diskPaths.forEach(dp => {
        if (IS_ELECTRON && dp) {
          hasDirectDisk = true;
          if (!isPathInsideMethodBFolder(dp)) total++;
          cached++;
        }
      });
      const isMethodBDirectOnly = !!(cs.folderSyncEnabled && releasable === 0 && (hasDirectDisk || (!IS_ELECTRON && cs.webDirName && missing === 0)));

      if (pinned) {
        return { status: 'pinned', label: '📌 常時保持中', icon: '📌', total, cached, missing, releasable, isMethodBDirectOnly };
      }
      if (missing > 0) {
        return { status: 'cloud_only', label: '☁️ クラウドのみ', icon: '☁️', total, cached, missing, releasable, isMethodBDirectOnly };
      }
      return { status: 'cached', label: '💻 この端末に保持済み', icon: '💻', total, cached, missing, releasable, isMethodBDirectOnly };
    }

    async function ensureScenarioAssetsCached(scId, opts) {
      const o = opts || {};
      const key = String(scId || '');
      if (!key || key === '_default') return { downloaded: 0, failed: 0 };
      if (scenarioFetchInFlight.has(key)) return await scenarioFetchInFlight.get(key);

      const p = (async () => {
        const sc = (appState.scenarios || []).find(s => String(s.id) === key);
        if (!sc) return { downloaded: 0, failed: 0 };
        const inv = collectScenarioAssetInventory(sc);
        if (!canDownloadFromCloud() && !(typeof window.cloudFetchImage === 'function')) {
          return { downloaded: 0, failed: 0, offline: true };
        }
        let downloaded = 0, failed = 0;

        // ローカルに不足している素材があるか事前に判定
        const missingImgsPre = [];
        for (const h of inv.imgHashes) {
          const has = typeof window.hasLocalImageHashAsync === 'function' ? await window.hasLocalImageHashAsync(h) : false;
          if (!has) missingImgsPre.push(h);
        }
        let hasMissingIdb = false;
        for (const ref of inv.idbRefs) {
          if (window.WebBridge && await WebBridge.hasAsset(ref)) continue;
          hasMissingIdb = true;
          break;
        }
        let hasMissingCloud = false;
        for (const ca of inv.cloudAssets) {
          const existing = await readLocalCloudCacheBytes(ca.sha256);
          if (!existing) { hasMissingCloud = true; break; }
        }

        const anyMissing = missingImgsPre.length > 0 || hasMissingIdb || hasMissingCloud;
        if (anyMissing && o.showProgress && typeof toast === 'function') {
          toast(`☁️ 「${sc.title || 'シナリオ'}」の素材パックを取得中…`);
        }

        // 新方式：assets/scenario_<scenarioId>.zip を1回のリクエストでダウンロードし一括展開
        if (anyMissing && canDownloadFromCloud()) {
          try {
            const packRes = await downloadAndExtractPack(`scenario:${key}`);
            if (packRes && packRes.extracted > 0) {
              downloaded += packRes.extracted;
            }
          } catch (pe) {
            console.warn('[CloudSync] scenario ZIP pack download skipped:', key, pe);
          }
        }

        // 後方互換フォールバック：ZIPに含まれない旧個別ファイル等が残っていれば個別取得
        const missingImgs = [];
        for (const h of inv.imgHashes) {
          const has = typeof window.hasLocalImageHashAsync === 'function' ? await window.hasLocalImageHashAsync(h) : false;
          if (!has) missingImgs.push(h);
        }
        for (const h of missingImgs) {
          try {
            const ok = typeof window.ensureLocalImageByHash === 'function' ? await window.ensureLocalImageByHash(h) : false;
            if (ok) downloaded++;
          } catch (_) { failed++; }
        }

        for (const ref of inv.idbRefs) {
          try {
            if (window.WebBridge && await WebBridge.hasAsset(ref)) continue;
            const u8 = await ensureAssetByIdbRef(ref, { scenarioId: key });
            if (u8) downloaded++;
          } catch (_) { failed++; }
        }

        for (const ca of inv.cloudAssets) {
          try {
            const existing = await readLocalCloudCacheBytes(ca.sha256);
            if (existing) continue;
            const u8 = await readCloudAssetBytes(ca.sha256, { download: true, name: ca.name, mime: ca.mime, scenarioId: key });
            if (u8) downloaded++;
          } catch (_) { failed++; }
        }

        if (downloaded > 0) {
          if (typeof hydrateRefs === 'function') await hydrateRefs(sc);
          if (typeof renderDBView === 'function') renderDBView();
          window.dispatchEvent(new CustomEvent('cloud-cache-changed', { detail: { scenarioId: key, downloaded } }));
          if (o.showProgress && typeof toast === 'function') toast(`✅ 「${sc.title || 'シナリオ'}」の素材を ${downloaded}件 取得しました`);
        } else if (o.manual && typeof toast === 'function') {
          toast('✅ このシナリオの素材はすべてこの端末に保持済みです');
        }
        return { downloaded, failed };
      })();

      scenarioFetchInFlight.set(key, p);
      try { return await p; } finally { scenarioFetchInFlight.delete(key); notifySyncIdleIfReady(); }
    }

    async function setScenarioPinned(scId, on) {
      const key = String(scId || '');
      if (!key) return false;
      const next = !!on;
      if (next) offlinePinnedIds.add(key);
      else offlinePinnedIds.delete(key);
      saveOfflinePins();

      const sc = (appState.scenarios || []).find(s => String(s.id) === key);
      if (sc && next && !sc.cloudKeepAssets) {
        sc.cloudKeepAssets = true;
        if (typeof saveState === 'function') saveState();
        scheduleSync('offline_pin');
      }
      if (typeof renderDBView === 'function') renderDBView();
      renderSettingsUI();
      window.dispatchEvent(new CustomEvent('cloud-cache-changed', { detail: { scenarioId: key } }));

      if (next) {
        if (typeof toast === 'function') toast(`📌 「${sc ? sc.title : ''}」を常にダウンロードしておく設定にしました（オフライン対応）`);
        await ensureScenarioAssetsCached(key, { showProgress: true, priority: true });
      } else {
        if (typeof toast === 'function') toast(`📌 「${sc ? sc.title : ''}」の常時保持を解除しました`);
      }
      return next;
    }

    async function releaseScenarioLocalCache(scId, opts) {
      const o = opts || {};
      const key = String(scId || '');
      const sc = (appState.scenarios || []).find(s => String(s.id) === key);
      if (!sc) return { released: 0, skippedNoCloud: 0 };

      const st = getScenarioCacheStatus(sc);
      if (st.isMethodBDirectOnly) {
        if (!o.silent && typeof toast === 'function') toast('ℹ️ PC内の同期フォルダから直接読み込んでいるため、安全のため削除は無効になっています');
        return { released: 0, skippedMethodB: true };
      }
      if (!o.forcePinned && isScenarioPinned(key)) {
        if (!o.silent && typeof toast === 'function') toast('📌 このシナリオは「常時保持中」のため整理対象外です（先に「常時保持」を解除してください）');
        return { released: 0, skippedPinned: true };
      }

      const inv = collectScenarioAssetInventory(sc);
      const usedElsewhere = new Set();
      (appState.scenarios || []).forEach(other => {
        if (!other || String(other.id) === key) return;
        const oInv = collectScenarioAssetInventory(other);
        oInv.imgHashes.forEach(h => usedElsewhere.add('img:' + h));
        oInv.cloudAssets.forEach(ca => usedElsewhere.add('sha:' + ca.sha256));
        oInv.idbRefs.forEach(r => usedElsewhere.add('idb:' + r));
      });

      let released = 0, skippedNoCloud = 0;
      for (const h of inv.imgHashes) {
        if (usedElsewhere.has('img:' + h)) continue;
        const inCloud = !!(refToSha['@img:' + h] && refToSha['@img:' + h].fullSha) || !!(window.cloudFetchImage && localStorage.getItem('discord_forum_tool_owner'));
        if (!inCloud) { skippedNoCloud++; continue; }
        if (typeof window.releaseLocalImageHash === 'function' && await window.releaseLocalImageHash(h)) released++;
      }

      for (const ref of inv.idbRefs) {
        if (usedElsewhere.has('idb:' + ref)) continue;
        const hit = refToSha[ref];
        if (!hit || !hit.fullSha) { skippedNoCloud++; continue; }
        const idbKey = idbStoreKeyForAssetRef(ref);
        if (typeof idbDel === 'function') {
          try { await idbDel('assets', idbKey); released++; } catch (_) {}
          localCloudAssetSet.delete('idb:' + idbKey);
        }
      }

      for (const ca of inv.cloudAssets) {
        if (usedElsewhere.has('sha:' + ca.sha256)) continue;
        if (await deleteLocalCloudCacheBytes(ca.sha256)) released++;
      }

      if (released > 0) {
        if (typeof saveState === 'function') saveState(false, { skipCloud: true });
        if (typeof renderDBView === 'function') renderDBView();
        window.dispatchEvent(new CustomEvent('cloud-cache-changed', { detail: { scenarioId: key } }));
      }
      if (!o.silent && typeof toast === 'function') {
        if (released > 0) toast(`💨 「${sc.title || 'シナリオ'}」のこの端末の一時データを ${released}件 削除しました（クラウドには残ります）`);
        else if (skippedNoCloud > 0) toast('⚠️ クラウドにまだ保存されていない素材があるため、安全のため削除をスキップしました');
        else toast('ℹ️ この端末に削除できる一時データはありませんでした');
      }
      return { released, skippedNoCloud };
    }

    async function releaseAllUnpinnedLocalCache() {
      const cs = getSettings();
      if (cs.folderSyncEnabled && IS_ELECTRON && !localCloudAssetSet.size) {
        if (typeof toast === 'function') toast('ℹ️ PC内の同期フォルダから直接読み込んでいるため、一括削除の対象はありません');
        return { released: 0 };
      }
      const unpinned = (appState.scenarios || []).filter(sc => sc && sc.id && !isScenarioPinned(sc.id));
      const ok = typeof appConfirm === 'function'
        ? await appConfirm(
            `📌 「常時保持」にしたシナリオ以外のデータ（${unpinned.length}件）について、この端末に一時保存されているPDF・画像・音声を整理して空き容量を増やします。\n\n※ クラウド上や指定した同期フォルダ内の元データは一切削除されません。\n※ 一覧表示用の表紙画像はそのまま残ります。`,
            { title: '💨 この端末の一時データを整理', okText: '整理して空き容量を確保', cancelText: 'キャンセル' }
          )
        : true;
      if (!ok) return { canceled: true };

      let totalReleased = 0;
      for (const sc of unpinned) {
        const res = await releaseScenarioLocalCache(sc.id, { silent: true });
        totalReleased += res.released || 0;
      }
      if (typeof renderDBView === 'function') renderDBView();
      renderSettingsUI();
      if (typeof toast === 'function') {
        toast(totalReleased > 0
          ? `💨 「常時保持」にしたシナリオ以外の一時データを合計 ${totalReleased}件 整理しました（クラウドの元データは保護されています）`
          : 'ℹ️ 整理できる一時データはありませんでした');
      }
      return { released: totalReleased };
    }

    // ---- 🧹 クラウドの未使用ファイル整理 ----
    async function collectAllReferencedCloudShas() {
      const used = new Set();
      const cs = getSettings();
      const allCs = { ...cs, uploadScope: 'all' };
      const { candidates } = collectSyncCandidates(allCs);
      for (const item of candidates) {
        const fp = await computeAssetFingerprint(item, item.isThumb ? false : (cs.compressImagesWebp !== false));
        if (fp && fp.sha256) used.add(fp.sha256.toLowerCase());
      }
      (appState.scenarios || []).forEach(sc => {
        if (!sc || !sc.id) return;
        const inv = collectScenarioAssetInventory(sc);
        inv.imgHashes.forEach(h => {
          const r = refToSha['@img:' + h];
          if (r && r.fullSha) used.add(r.fullSha.toLowerCase());
          if (r && r.thumbSha) used.add(r.thumbSha.toLowerCase());
        });
        inv.idbRefs.forEach(ref => {
          const r = refToSha[ref];
          if (r && r.fullSha) used.add(r.fullSha.toLowerCase());
        });
        inv.cloudAssets.forEach(ca => { if (ca.sha256) used.add(ca.sha256.toLowerCase()); });
        const list = scenarioAssets[String(sc.id)];
        if (Array.isArray(list)) list.forEach(x => { if (x && x.sha256) used.add(String(x.sha256).toLowerCase()); });
      });
      const walkCommon = node => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walkCommon); return; }
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (typeof v === 'string') {
            if (isCloudAssetRef(v)) {
              const p = parseCloudAssetRef(v);
              if (p) used.add(p.sha256.toLowerCase());
            } else if (refToSha[v] && refToSha[v].fullSha) {
              used.add(refToSha[v].fullSha.toLowerCase());
            }
          } else if (v && typeof v === 'object') walkCommon(v);
        }
      };
      walkCommon(appState.unlinkedCcfRooms);
      walkCommon(appState.imageAssets);
      walkCommon(appState.ccfCutinPackages);
      if (appState.botAvatarData && refToSha[appState.botAvatarData] && refToSha[appState.botAvatarData].fullSha) {
        used.add(refToSha[appState.botAvatarData].fullSha.toLowerCase());
      }
      cloudUploadQueue.forEach(q => { if (q && q.sha256) used.add(String(q.sha256).toLowerCase()); });
      return used;
    }

    async function cleanupUnusedCloudAssets() {
      const targets = await getActiveTargets(true);
      if (!targets.gdrive && !targets.folder) {
        if (typeof toast === 'function') toast('⚠️ Googleドライブまたは同期フォルダに接続してから実行してください');
        return;
      }
      if (typeof toast === 'function') toast('🔍 クラウド上の未使用ファイル・旧バラバラ画像をスキャンしています…');
      await pullManifestAndMeta({ silent: true });
      const referenced = await collectAllReferencedCloudShas();

      const thumbShas = new Set();
      const shaOwnerPack = new Map(); // sha256 -> packName ('thumbs_pack.zip' | 'common_library.zip' | 'scenario_<id>.zip')
      Object.entries(remoteManifest).forEach(([sha, m]) => {
        if (!m) return;
        const s = sha.toLowerCase();
        if (m.isThumb) {
          thumbShas.add(s);
          shaOwnerPack.set(s, 'thumbs_pack.zip');
        } else if (m.scenarioId) {
          shaOwnerPack.set(s, getPackFileName(m.scenarioId === '_common' || m.scenarioId === '_settings' ? 'common' : 'scenario', m.scenarioId));
        }
      });
      Object.values(refToSha).forEach(r => {
        if (!r) return;
        if (r.thumbSha) {
          const ts = String(r.thumbSha).toLowerCase();
          thumbShas.add(ts);
          shaOwnerPack.set(ts, 'thumbs_pack.zip');
        }
        if (r.fullSha && r.scenarioId) {
          const fsKey = String(r.fullSha).toLowerCase();
          if (!shaOwnerPack.has(fsKey)) {
            shaOwnerPack.set(fsKey, getPackFileName(r.scenarioId === '_common' || r.scenarioId === '_settings' ? 'common' : 'scenario', r.scenarioId));
          }
        }
      });
      Object.entries(scenarioAssets).forEach(([sid, list]) => {
        if (!Array.isArray(list)) return;
        const pName = getPackFileName('scenario', sid);
        list.forEach(x => {
          if (!x || !x.sha256) return;
          const s = String(x.sha256).toLowerCase();
          if (x.isThumb) {
            thumbShas.add(s);
            shaOwnerPack.set(s, 'thumbs_pack.zip');
          } else if (!shaOwnerPack.has(s)) {
            shaOwnerPack.set(s, pName);
          }
        });
      });

      const liveScenarioPackNames = new Set(
        (appState.scenarios || []).filter(s => s && s.id).map(s => getPackFileName('scenario', s.id))
      );

      const gdriveDeleteList = [];
      const folderDeleteList = [];

      const classifyLooseSha = (sha, hasThumbsPack, assetNamesSet) => {
        if (!referenced.has(sha)) return 'unused';
        if (thumbShas.has(sha) && hasThumbsPack) return 'legacy_migrated';
        const ownerPack = shaOwnerPack.get(sha);
        if (ownerPack === 'thumbs_pack.zip' && hasThumbsPack) return 'legacy_migrated';
        if (ownerPack && assetNamesSet.has(ownerPack)) return 'legacy_migrated';
        return '';
      };

      if (targets.gdrive) {
        const fIds = await ensureDriveFolders();
        gdriveAssetSet = await listDriveFolderFiles(fIds.assets);
        gdriveMetaSet = await listDriveFolderFiles(fIds.meta);
        const hasThumbsPackG = gdriveMetaSet.has('thumbs_pack.zip');
        const gAssetNames = new Set(gdriveAssetSet.keys());
        for (const [name, f] of gdriveAssetSet) {
          const lower = name.toLowerCase();
          if (/^[0-9a-f]{64}$/.test(lower)) {
            const reason = classifyLooseSha(lower, hasThumbsPackG, gAssetNames);
            if (reason) {
              gdriveDeleteList.push({ key: name, sha: lower, name, id: f.id, size: Number(f.size) || 0, meta: remoteManifest[lower] || null, reason });
            }
          } else if (/^scenario_.+\.zip$/i.test(name) && !liveScenarioPackNames.has(name)) {
            gdriveDeleteList.push({ key: name, sha: '', name, id: f.id, size: Number(f.size) || 0, meta: { name }, reason: 'unused_pack' });
          }
        }
      }
      if (targets.folder) {
        const files = await listFolderSyncFiles(targets.folder, 'assets');
        folderMetaSet = await listFolderSyncMeta(targets.folder);
        const hasThumbsPackF = folderMetaSet.has('thumbs_pack.zip');
        const fAssetNames = new Set(files.map(f => f.name));
        for (const f of files) {
          const fname = String(f.name || '');
          const lower = fname.toLowerCase();
          if (/^[0-9a-f]{64}$/.test(lower)) {
            const reason = classifyLooseSha(lower, hasThumbsPackF, fAssetNames);
            if (reason) {
              folderDeleteList.push({ key: fname, sha: lower, name: fname, size: Number(f.size) || 0, meta: remoteManifest[lower] || null, reason });
            }
          } else if (/^scenario_.+\.zip$/i.test(fname) && !liveScenarioPackNames.has(fname)) {
            folderDeleteList.push({ key: fname, sha: '', name: fname, size: Number(f.size) || 0, meta: { name: fname }, reason: 'unused_pack' });
          }
        }
      }

      const uniqueItems = new Map();
      [...gdriveDeleteList, ...folderDeleteList].forEach(x => {
        const uk = x.sha || x.name;
        if (!uniqueItems.has(uk)) uniqueItems.set(uk, x);
      });
      if (!uniqueItems.size) {
        if (typeof toast === 'function') toast('✨ クラウド上に未使用ファイルや整理対象の旧バラバラ画像はありませんでした');
        return;
      }

      let totalBytes = 0;
      let unusedCount = 0;
      let legacyCount = 0;
      let unusedPackCount = 0;
      uniqueItems.forEach(x => {
        totalBytes += x.size;
        if (x.reason === 'legacy_migrated') legacyCount++;
        else if (x.reason === 'unused_pack') unusedPackCount++;
        else unusedCount++;
      });

      const mbStr = (totalBytes / (1024 * 1024)).toFixed(2);
      const samples = [...uniqueItems.values()].slice(0, 8).map(x => {
        const label = x.reason === 'legacy_migrated' ? '[旧バラバラ画像] ' : (x.reason === 'unused_pack' ? '[旧シナリオZIP] ' : '[未使用] ');
        return '・' + label + ((x.meta && x.meta.name) || x.name.slice(0, 24));
      }).join('\n');

      const summaryLines = [];
      if (legacyCount > 0) summaryLines.push(`・ZIPパック移行済みの旧バラバラ画像：${legacyCount} 件`);
      if (unusedCount > 0) summaryLines.push(`・どこからも使われていない旧ファイル：${unusedCount} 件`);
      if (unusedPackCount > 0) summaryLines.push(`・削除済みシナリオのZIPパック：${unusedPackCount} 件`);

      const ok = typeof appConfirm === 'function'
        ? await appConfirm(
            `クラウド上の整理対象データが見つかりました。\n\n` +
            `${summaryLines.join('\n')}\n・合計件数：${uniqueItems.size} 件（約 ${mbStr} MB）\n\n` +
            `【対象例】\n${samples}${uniqueItems.size > 8 ? `\n…ほか ${uniqueItems.size - 8} 件` : ''}\n\n` +
            `これらを一括削除して整理しますか？（Googleドライブはゴミ箱へ移動します）`,
            { title: '🧹 クラウド上の未使用データを整理', okText: `${uniqueItems.size}件を整理する`, cancelText: 'キャンセル', danger: true }
          )
        : true;
      if (!ok) return;

      let deletedCount = 0;
      const DRIVE_TRASH_CONCURRENCY = 8;
      for (let i = 0; i < gdriveDeleteList.length; i += DRIVE_TRASH_CONCURRENCY) {
        const chunk = gdriveDeleteList.slice(i, i + DRIVE_TRASH_CONCURRENCY);
        await Promise.all(chunk.map(async item => {
          try {
            await trashDriveFile(item.id);
            if (gdriveAssetSet) gdriveAssetSet.delete(item.key);
            deletedCount++;
          } catch (e) { console.warn('[CloudSync] trash drive item failed:', item.name, e); }
        }));
      }
      for (const item of folderDeleteList) {
        try {
          if (await deleteFolderSyncFile(targets.folder, ['assets', item.name])) {
            if (folderAssetSet) folderAssetSet.delete(item.key);
            deletedCount++;
          }
        } catch (e) { console.warn('[CloudSync] delete folder item failed:', item.name, e); }
      }

      uniqueItems.forEach(item => {
        if (item.reason === 'unused' && item.sha) {
          delete remoteManifest[item.sha];
        } else if (item.reason === 'unused_pack') {
          for (const [pk, pm] of Object.entries(packManifest)) {
            if (pm && pm.packName === item.name) delete packManifest[pk];
          }
        }
      });
      await syncMetadataToTargets(targets, computeCommonAssetUsage());
      if (typeof toast === 'function') toast(`🧹 クラウド上の不要データ ${uniqueItems.size}件（約 ${mbStr} MB）を整理しました`);
    }

    // ---- ⏪ クラウド3世代バックアップ一覧・復元モーダル ----
    async function listCloudBackups() {
      const targets = await getActiveTargets(true);
      if (!targets.gdrive && !targets.folder) return { targets, items: [] };
      const items = [];
      const genLabels = { '1': '最新のバックアップ', '2': '1つ前のバックアップ', '3': '2つ前のバックアップ' };

      const collectFrom = async (sourceLabel, sourceKind, readIndexFn, listFilesFn, readFileFn) => {
        const filesMap = await listFilesFn();
        const idx = await readIndexFn();
        for (const g of ['1', '2', '3']) {
          const fname = `backup_${g}.json.gz`;
          const fInfo = filesMap.get(fname);
          if (!fInfo) continue;
          const meta = (idx && idx.gens && idx.gens[g]) || {};
          let savedAt = Number(meta.savedAt) || (fInfo.appProperties && Number(fInfo.appProperties.savedAt)) || (fInfo.modifiedTime ? Date.parse(fInfo.modifiedTime) : 0) || Number(fInfo.mtime) || 0;
          let scenarioCount = meta.scenarioCount != null ? Number(meta.scenarioCount) : (fInfo.appProperties && fInfo.appProperties.scenarioCount != null ? Number(fInfo.appProperties.scenarioCount) : null);
          let roomCount = meta.roomCount != null ? Number(meta.roomCount) : (fInfo.appProperties && fInfo.appProperties.roomCount != null ? Number(fInfo.appProperties.roomCount) : null);
          items.push({
            gen: Number(g),
            genLabel: genLabels[g],
            fname,
            sourceKind,
            sourceLabel,
            fileId: fInfo.id || '',
            size: Number(fInfo.size) || Number(meta.size) || 0,
            savedAt,
            scenarioCount,
            roomCount,
            readBytes: () => readFileFn(fname, fInfo.id)
          });
        }
      };

      if (targets.gdrive) {
        const fIds = await ensureDriveFolders();
        const bFiles = await listDriveFolderFiles(fIds.backups);
        await collectFrom(
          'Googleドライブ',
          'gdrive',
          async () => {
            const f = bFiles.get('backups_index.json');
            if (!f) return null;
            try { return JSON.parse(new TextDecoder().decode(await downloadDriveFile(f.id))); } catch (_) { return null; }
          },
          async () => bFiles,
          async (_name, fid) => await downloadDriveFile(fid)
        );
      }
      if (targets.folder) {
        const files = await listFolderSyncFiles(targets.folder, 'backups');
        const map = new Map(files.map(f => [f.name, f]));
        await collectFrom(
          '指定した同期フォルダ',
          'folder',
          async () => {
            const u8 = await readFolderSyncFile(targets.folder, ['backups', 'backups_index.json']);
            if (!u8) return null;
            try { return JSON.parse(new TextDecoder().decode(u8)); } catch (_) { return null; }
          },
          async () => map,
          async name => await readFolderSyncFile(targets.folder, ['backups', name])
        );
      }
      return { targets, items };
    }

    async function openCloudBackupRestoreModal() {
      try {
        if (typeof toast === 'function') toast('⏪ クラウドのバックアップ一覧を取得中…');
        const { targets, items } = await listCloudBackups();
        if (!targets.gdrive && !targets.folder) {
          if (typeof toast === 'function') toast('⚠️ Googleドライブまたは同期フォルダに接続してから実行してください');
          return;
        }
        const ov = document.createElement('div');
        ov.className = 'app-dialog-overlay';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        const fmtDt = ts => ts ? fmtConflictDate(ts) : '日時不明';
        const rowsHtml = items.length
          ? items.map((it, idx) => `
              <div class="cloud-backup-row">
                <div class="cloud-backup-info">
                  <b>${escapeHTML(it.genLabel)} <span class="cloud-backup-src">${escapeHTML(it.sourceLabel)}</span></b>
                  <div class="cloud-sub-note">保存日時: ${escapeHTML(fmtDt(it.savedAt))} ／ シナリオ: ${it.scenarioCount != null ? it.scenarioCount + '件' : '詳細読込時確認'}${it.roomCount != null ? ` ／ 部屋: ${it.roomCount}件` : ''} (${Math.max(1, Math.round(it.size / 1024))} KB)</div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" data-bk-idx="${idx}">⏪ このバックアップを復元</button>
              </div>
            `).join('')
          : '<div class="cloud-sub-note" style="padding:12px 0;">まだクラウドバックアップが作成されていません（「🔄 今すぐ同期」を実行すると作成されます）。</div>';
        ov.innerHTML = `
          <div class="app-dialog" style="width:min(560px, 94vw); max-height:86vh; overflow-y:auto;">
            <div class="app-dialog-title">⏪ バックアップから以前の状態に復元</div>
            <div class="cloud-sub-note" style="margin-bottom:10px;">復元を実行すると、現在のデータがその時点の内容で置き換わります（現在のデータは念のため端末内にバックアップとして残ります）。</div>
            <div class="cloud-backup-list">${rowsHtml}</div>
            <div class="app-dialog-actions">
              <button type="button" class="app-dialog-btn" data-bk-close="1">閉じる</button>
            </div>
          </div>
        `;
        const close = () => ov.remove();
        ov.addEventListener('click', async e => {
          if (e.target === ov || e.target.closest('[data-bk-close]')) return close();
          const btn = e.target.closest('[data-bk-idx]');
          if (!btn) return;
          const item = items[Number(btn.dataset.bkIdx)];
          if (!item) return;
          btn.disabled = true;
          btn.textContent = '読込中…';
          try {
            const bytes = await item.readBytes();
            if (!bytes) throw new Error('バックアップファイルを読み込めませんでした');
            const jsonStr = await window.CloudCodec.gzipDecompress(bytes);
            const snap = JSON.parse(jsonStr);
            if (!snap || !snap.state) throw new Error('バックアップの形式が正しくありません');
            const scN = Array.isArray(snap.state.scenarios) ? snap.state.scenarios.length : 0;
            const ok = typeof appConfirm === 'function'
              ? await appConfirm(
                  `${item.genLabel}（${item.sourceLabel}）\n保存日時: ${fmtDt(snap.savedAt || item.savedAt)}\nシナリオ数: ${scN} 件\n\nこのバックアップのデータで現在の状態を復元しますか？`,
                  { title: 'バックアップ復元の最終確認', okText: '復元を実行する', cancelText: 'キャンセル', danger: true }
                )
              : true;
            if (!ok) { btn.disabled = false; btn.textContent = '⏪ このバックアップを復元'; return; }
            if (typeof window.idbGetRaw === 'function' && typeof window.idbSetRaw === 'function') {
              const old = await window.idbGetRaw('state');
              if (old) await window.idbSetRaw('state_backup', old);
            }
            close();
            if (typeof window.applyMergedState === 'function') {
              await window.applyMergedState(snap.state, { fromCloud: false });
            }
            if (typeof window.cloudSyncNow === 'function' && currentAuthUser) {
              void window.cloudSyncNow();
            }
            if (typeof toast === 'function') toast(`✅ ${item.genLabel}（シナリオ ${scN}件）から復元しました`);
          } catch (err) {
            console.error('[CloudSync] restore backup error:', err);
            if (typeof toast === 'function') toast('❌ 復元に失敗しました: ' + (err.message || err));
            btn.disabled = false;
            btn.textContent = '⏪ このバックアップを復元';
          }
        });
        document.body.appendChild(ov);
      } catch (e) {
        console.error('[CloudSync] listCloudBackups error:', e);
        if (typeof toast === 'function') toast('❌ バックアップ一覧の取得に失敗しました: ' + (e.message || e));
      }
    }

    // ---- 📤 ルームZIP / GM進行用資料のクラウド exports/ 直接保存 ----
    async function uploadExportFile(fileName, bytesOrBlob, mime) {
      const targets = await getActiveTargets(true);
      if (!targets.gdrive && !targets.folder) {
        if (typeof toast === 'function') toast('⚠️ クラウド保存先（Googleアカウントでログイン または 同期フォルダの指定）が設定されていません');
        return { ok: false, destinations: [] };
      }
      let u8;
      if (bytesOrBlob instanceof Uint8Array) u8 = bytesOrBlob;
      else if (bytesOrBlob instanceof ArrayBuffer) u8 = new Uint8Array(bytesOrBlob);
      else if (typeof Blob !== 'undefined' && bytesOrBlob instanceof Blob) u8 = new Uint8Array(await bytesOrBlob.arrayBuffer());
      else if (typeof bytesOrBlob === 'string') u8 = new TextEncoder().encode(bytesOrBlob);
      else u8 = new Uint8Array(bytesOrBlob || []);

      const safeFile = String(fileName || 'export.bin').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
      const contentType = mime || (window.WebBridge ? WebBridge.mimeFromName(safeFile) : 'application/octet-stream');
      const destinations = [];

      if (targets.gdrive) {
        const fIds = await ensureDriveFolders();
        const exFiles = await listDriveFolderFiles(fIds.exports);
        const cur = exFiles.get(safeFile);
        await uploadDriveResumable(fIds.exports, safeFile, u8, contentType, cur ? cur.id : null);
        destinations.push('Googleドライブ (卓倉庫_クラウド同期/exports/)');
      }
      if (targets.folder) {
        await writeFolderSyncFile(targets.folder, ['exports', safeFile], u8);
        destinations.push(`同期フォルダ (${targets.folder.kind === 'electron' ? path.join(targets.folder.dir, 'exports') : 'exports/'})`);
      }
      return { ok: destinations.length > 0, fileName: safeFile, destinations };
    }

    // ---- 設定UI（「☁️ データ保存・同期設定」）描画 & バインド ----
    function buildCloudSettingsHtml() {
      const cs = getSettings();
      const folderLabel = IS_ELECTRON
        ? (cs.localSyncPath ? cs.localSyncPath : '未指定（フォルダを選ぶと自動で同期・バックアップされます）')
        : (cs.webDirName ? `📂 ${cs.webDirName}` : '未指定（対応ブラウザでPC内のフォルダを選択できます）');
      const hasAccount = !!(currentAuthUser || gdriveEmail);
      const accountLabel = currentAuthUser
        ? (currentAuthUser.email || currentAuthUser.displayName || 'ログイン中')
        : (gdriveEmail || '未ログイン');
      const gStatus = !hasAccount
        ? '未ログイン（上のボタンからGoogleログインすると自動で連携されます）'
        : (isTokenUsable() && !gdriveNeedsReauth
            ? '✅ Googleドライブ接続済み（専用フォルダ：卓倉庫_クラウド同期）'
            : '🔄 次回同期時に自動でGoogleドライブへ接続します（「🔄 今すぐ同期」で今すぐ実行）');
      const scenarios = (typeof appState !== 'undefined' && Array.isArray(appState.scenarios)) ? appState.scenarios : [];
      const commonAssets = (typeof appState !== 'undefined' && Array.isArray(appState.imageAssets)) ? appState.imageAssets : [];
      const usageMap = computeCommonAssetUsage();
      const scopeGroup = 'cloudUploadScope_' + Math.random().toString(36).slice(2, 6);

      return `
        <div class="cloud-settings-panel">
          <div class="cloud-mode-box cloud-account-card">
            <div class="cloud-mode-head">
              <span>👤 同期アカウントの状態</span>
              <span class="cloud-base-badge${hasAccount ? '' : ' is-off'}">${hasAccount ? '✅ ログイン中' : '未ログイン'}</span>
            </div>
            <div class="cloud-sub-note">${hasAccount
              ? `現在のアカウント：<b>${escapeHTML(accountLabel)}</b>（別PCやスマホとデータを自動で引き継げます）`
              : 'ログインしなくてもご利用いただけます。別の端末とデータを引き継ぎたい場合はログインしてください。'}</div>
            <div class="cloud-folder-bar">
              ${hasAccount
                ? `<button type="button" class="btn btn-secondary btn-sm" data-cloud-act="sync-now">🔄 今すぐ同期</button>
                   <button type="button" class="btn btn-secondary btn-sm" data-cloud-act="open-auth">🔄 アカウント切替・ログイン画面</button>
                   <button type="button" class="btn btn-secondary btn-sm btn-danger" data-cloud-act="logout">ログアウト</button>`
                : `<button type="button" class="btn btn-sm" data-cloud-act="open-auth">🔑 ログイン / 新規登録を開く</button>`}
            </div>
          </div>

          <div class="cloud-mode-box">
            <div class="cloud-mode-head">
              <span>💻 この端末への自動保存</span>
              <span class="cloud-base-badge">常時有効</span>
            </div>
            <div class="cloud-sub-note">${IS_ELECTRON
              ? '作成したデータや登録素材は、このPC内に自動で保存されます。クラウド連携を使わない場合でもそのまま快適にご利用いただけます。'
              : '作成したデータや登録素材は、お使いのブラウザ内に自動で保存されます。別の端末とデータを引き継ぎたい場合は、下のクラウド同期をご利用ください。'}</div>
          </div>

          <div class="cloud-mode-box">
            <div class="cloud-mode-head"><span>☁️ アカウント同期・Googleドライブ連携（別PC・スマホとの引き継ぎ）</span></div>
            <div class="cloud-sub-note">ログインするだけで、自宅PC・外出先PC・スマホ間でデータを自動で引き継げます。</div>
            <label class="cloud-chk-row">
              <input type="checkbox" data-cloud-cfg="syncFirestoreText"${cs.syncFirestoreText !== false ? ' checked' : ''}>
              <span><b>シナリオ情報・メモ・ココフォリアの部屋構成を同期する</b><br><small class="cloud-sub-note">タイトル、あらすじ、タグ、進行テキスト、NPC、シーン配置などの軽量データを同期します。</small></span>
            </label>
            <label class="cloud-chk-row">
              <input type="checkbox" data-cloud-cfg="syncGDriveAssets"${cs.syncGDriveAssets !== false ? ' checked' : ''}>
              <span><b>シナリオのPDF・立ち絵・背景・使用BGMのファイル本体もGoogleドライブで同期する</b><br><small class="cloud-sub-note">Googleアカウントでログインすると、ご自身のGoogleドライブ内に専用フォルダ（卓倉庫_クラウド同期）を作成し、PDFや画像ファイルも別端末へ自動で引き継ぎます。</small></span>
            </label>
            <div class="cloud-folder-bar">
              <span class="cloud-sub-note">${escapeHTML(gStatus)}</span>
            </div>
          </div>

          <div class="cloud-mode-box">
            <div class="cloud-mode-head"><span>📁 PC内のクラウドフォルダで共有（OneDrive / Dropbox / iCloud 等）</span></div>
            <div class="cloud-sub-note">PCにインストールされているOneDriveやDropbox、PC版Googleドライブ等のフォルダを指定して、データをバックアップ・共有できます。</div>
            <div class="cloud-folder-bar">
              <button type="button" class="btn btn-secondary btn-sm" data-cloud-act="pick-folder">📂 同期するフォルダを選択する</button>
              ${(cs.folderSyncEnabled && (cs.localSyncPath || cs.webDirName)) ? '<button type="button" class="btn btn-secondary btn-xs btn-danger" data-cloud-act="clear-folder">✕ 解除</button>' : ''}
            </div>
            <div class="cloud-folder-path" title="${escapeHTML(folderLabel)}">${escapeHTML(folderLabel)}</div>
            <div class="cloud-sub-note">※ シナリオデータと登録素材のみを安全に同期します。</div>
          </div>

          <div class="cloud-mode-box">
            <div class="cloud-mode-head"><span>📦 クラウドの容量節約・アップロード範囲</span></div>
            <div class="cloud-sub-note">同じ素材の重複保存を自動で防ぎ、データを軽量化してクラウドの空き容量を節約します。</div>
            <label class="cloud-chk-row">
              <input type="checkbox" data-cloud-cfg="compressImagesWebp"${cs.compressImagesWebp !== false ? ' checked' : ''}>
              <span>画像（立ち絵・背景など）を画質を保ったまま軽量化してクラウドへ保存する</span>
            </label>
            <label class="cloud-radio-row">
              <input type="radio" name="${scopeGroup}" value="edited_only" data-cloud-cfg="uploadScope"${cs.uploadScope !== 'all' ? ' checked' : ''}>
              <span><b>編集・部屋作成したシナリオの素材のみクラウドへ保存する（容量節約・おすすめ）</b><br><small class="cloud-sub-note">すべてのシナリオ一覧と表紙画像は同期しつつ、容量の大きいPDFや立ち絵・BGMは「詳細編集やココフォリア準備を行ったシナリオ」と「個別にクラウド保管をONにしたシナリオ」だけをアップロードします。</small></span>
            </label>
            <label class="cloud-radio-row">
              <input type="radio" name="${scopeGroup}" value="all" data-cloud-cfg="uploadScope"${cs.uploadScope === 'all' ? ' checked' : ''}>
              <span><b>登録したすべてのシナリオのPDF・素材をクラウドへ保存する（丸ごとバックアップ）</b></span>
            </label>

            <div class="cloud-web-asset-sync-box" style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(128,128,128,0.2);">
              <div style="font-weight:bold;margin-bottom:4px;">🌐 登録素材画像のWeb同期範囲（Firebase軽量WebP）</div>
              <div class="cloud-sub-note" style="margin-bottom:6px;">自宅PCからNPC・背景・マップ等の登録素材画像を軽量WebP（長辺800px）化してFirebaseへ保存し、外出先やスマホから閲覧できるようにします。</div>
              <select class="form-select" data-cloud-cfg="webAssetSyncMode" style="width:100%;max-width:420px;margin-bottom:8px;">
                <option value="auto_all"${(!cs.webAssetSyncMode || cs.webAssetSyncMode === 'auto_all') ? ' selected' : ''}>全シナリオをバックグラウンドで自動Web同期（おすすめ）</option>
                <option value="edited_only"${cs.webAssetSyncMode === 'edited_only' ? ' selected' : ''}>編集・詳細を開いたシナリオのみ自動同期</option>
                <option value="manual"${cs.webAssetSyncMode === 'manual' ? ' selected' : ''}>手動ボタンのみ</option>
              </select>
              ${(() => {
                const validSc = scenarios.filter(s => s && s.id && String(s.id) !== '_default');
                const syncedCnt = validSc.filter(s => !!s.webAssetsSyncedAt).length;
                const q = getDailyWebImgQuota();
                return `<div class="cloud-sub-note" style="margin-bottom:8px;">Web同期済みシナリオ：<b>${syncedCnt} / ${validSc.length} 件</b>（本日送信：<b>${q.count.toLocaleString()} / ${q.limit.toLocaleString()} 枚</b>）${bgWebAssetSyncRunning ? ' <span style="color:#38bdf8;">🔄 バックグラウンド同期中…</span>' : ''}</div>`;
              })()}
              <button type="button" class="btn btn-secondary btn-sm" data-cloud-act="batch-web-sync-assets"${bgWebAssetSyncRunning ? ' disabled' : ''}>☁️ 未同期シナリオの登録素材をまとめてWeb同期</button>
            </div>

            <details class="cloud-pin-details">
              <summary>📌 個別対象設定（この端末に常にダウンロード ／ マイライブラリ常時持ち歩き）</summary>
              <div class="cloud-pin-grid">
                <div class="cloud-pin-col">
                  <div class="cloud-pin-col-title">📖 シナリオ（📌この端末に常にダウンロード）</div>
                  ${scenarios.length ? scenarios.slice(0, 80).map(sc => `<label class="cloud-chk-row"><input type="checkbox" data-cloud-pin-sc="${escapeHTML(sc.id)}"${isScenarioPinned(sc.id) ? ' checked' : ''}><span>${escapeHTML(sc.title || '無題')}</span></label>`).join('') : '<span class="cloud-sub-note">シナリオがありません</span>'}
                </div>
                <div class="cloud-pin-col">
                  <div class="cloud-pin-col-title">🖼️ マイライブラリ（☁️常時持ち歩く）</div>
                  ${commonAssets.length ? commonAssets.slice(0, 80).map(a => {
                    const usedN = (usageMap.get(a.id) || new Set()).size;
                    return `<label class="cloud-chk-row"><input type="checkbox" data-cloud-pin-asset="${escapeHTML(a.id)}"${a.cloudAlwaysCarry ? ' checked' : ''}><span>${escapeHTML(a.name || '素材')}${usedN ? ` <small>(${usedN}作品で使用中)</small>` : ''}</span></label>`;
                  }).join('') : '<span class="cloud-sub-note">共通素材がありません</span>'}
                </div>
              </div>
            </details>
          </div>

          <div class="cloud-mode-box">
            <div class="cloud-mode-head"><span>🛠️ データの整理・バックアップからの復元</span></div>
            <div class="cloud-action-list">
              <div class="cloud-action-item">
                <button type="button" class="btn btn-secondary btn-sm" data-cloud-act="release-all-cache" title="クラウド上の元データは残したまま、この端末に一時保存されているPDFや画像を整理して動作を軽くします">💨 この端末の一時データを整理（空き容量を確保）</button>
                <div class="cloud-sub-note">クラウド上の元データは残したまま、この端末に一時保存されているPDFや画像を整理して動作を軽くします（「常時保持」にしたシナリオは消えません）。</div>
              </div>
              <div class="cloud-action-item">
                <button type="button" class="btn btn-secondary btn-sm" data-cloud-act="cleanup-unused" title="削除済みシナリオの不要データや、ZIPパック移行後に不要となった旧バラバラ画像ファイルを検出して整理します">🧹 クラウド上の未使用データを整理</button>
                <div class="cloud-sub-note">削除済みシナリオの不要データや、ZIPパック移行後に不要となった assets/ 直下の旧バラバラ画像ファイルを検出して整理します。</div>
              </div>
              <div class="cloud-action-item">
                <button type="button" class="btn btn-secondary btn-sm" data-cloud-act="reset-upload-queue" title="送信待ちになっている未送信の同期キューをすべてキャンセルして空にします">🧹 未送信の同期キューをリセット${cloudUploadQueue.length ? `（現在 ${cloudUploadQueue.length}件）` : ''}</button>
                <div class="cloud-sub-note">大量の送信待ち（同期中カウント）をキャンセルしたい場合、未送信のアップロードキューをワンクリックで空にします（端末内やクラウドの既存データは消えません）。</div>
              </div>
              <div class="cloud-action-item">
                <button type="button" class="btn btn-secondary btn-sm" data-cloud-act="restore-backup" title="クラウドに自動保存されている直近のバックアップから、誤って変更・削除する前の状態へ戻せます">⏪ バックアップから以前の状態に復元する</button>
                <div class="cloud-sub-note">クラウドに自動保存されている直近のバックアップから、誤って変更・削除する前の状態へ戻せます。</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function wireCloudPanel(host) {
      if (!host || host.dataset.cloudWired) return;
      host.dataset.cloudWired = '1';
      host.addEventListener('change', e => {
        const el = e.target;
        if (!el || !el.dataset) return;
        if (el.dataset.cloudCfg) {
          const k = el.dataset.cloudCfg;
          if (k === 'webAssetSyncMode') {
            updateSettings({ webAssetSyncMode: el.value });
            scheduleSync('settings_changed');
            if (el.value === 'auto_all') void startBackgroundWebAssetSync({ manual: false });
          } else if (k === 'uploadScope') {
            updateSettings({ uploadScope: el.value === 'all' ? 'all' : 'edited_only' });
            void purgeUploadQueue().then(() => scheduleSync('settings_changed'));
          } else {
            updateSettings({ [k]: !!el.checked });
            scheduleSync('settings_changed');
          }
          return;
        }
        if (el.dataset.cloudPinSc) {
          void setScenarioPinned(el.dataset.cloudPinSc, !!el.checked);
          return;
        }
        if (el.dataset.cloudPinAsset) {
          const a = (appState.imageAssets || []).find(x => String(x.id) === el.dataset.cloudPinAsset);
          if (a) {
            a.cloudAlwaysCarry = !!el.checked;
            if (typeof saveState === 'function') saveState();
            scheduleSync('pin_asset');
          }
        }
      });
      host.addEventListener('click', async e => {
        const btn = e.target.closest('[data-cloud-act]');
        if (!btn) return;
        const act = btn.dataset.cloudAct;
        if (act === 'open-auth') {
          if (typeof window.openCloudAuthModal === 'function') window.openCloudAuthModal();
          else document.getElementById('authOpenBtn')?.click();
        } else if (act === 'sync-now') {
          await syncNow();
        } else if (act === 'logout') {
          if (typeof window.cloudLogout === 'function') await window.cloudLogout();
          else {
            clearGDriveAuth();
            document.getElementById('authLogoutBtn')?.click();
          }
          renderSettingsUI();
        } else if (act === 'pick-folder') {
          await pickSyncFolder();
        } else if (act === 'clear-folder') {
          await clearSyncFolder();
        } else if (act === 'release-all-cache') {
          await releaseAllUnpinnedLocalCache();
        } else if (act === 'cleanup-unused') {
          await cleanupUnusedCloudAssets();
        } else if (act === 'reset-upload-queue') {
          await resetUploadQueue();
        } else if (act === 'restore-backup') {
          await openCloudBackupRestoreModal();
        } else if (act === 'batch-web-sync-assets') {
          btn.disabled = true;
          btn.textContent = '☁️ 同期中…';
          try { await startBackgroundWebAssetSync({ manual: true }); }
          finally { renderSettingsUI(); }
        }
      });
    }

    function renderSettingsUI() {
      const host = document.getElementById('settingsCloudHost');
      if (!host) return;
      wireCloudPanel(host);
      host.innerHTML = buildCloudSettingsHtml();
    }

    async function pickSyncFolder() {
      try {
        if (IS_ELECTRON) {
          const ipc = require('electron').ipcRenderer;
          const res = await ipc.invoke('cloud:pick-sync-folder');
          if (!res || res.canceled) return false;
          if (!res.ok) {
            if (typeof toast === 'function') toast('⚠️ ' + (res.message || 'フォルダを指定できませんでした'));
            return false;
          }
          updateSettings({ folderSyncEnabled: true, localSyncPath: res.path }, { localOnly: true });
          if (typeof toast === 'function') toast('✅ クラウド同期フォルダを設定しました: ' + res.path);
          await pullManifestAndMeta({ includeState: true, silent: true });
          scheduleSync('pick_folder');
          return true;
        }
        if (!window.WebBridge || !WebBridge.pickSyncDirectory) {
          if (typeof toast === 'function') toast('⚠️ お使いのブラウザはPC内のフォルダ同期に対応していません（Chrome / Edge 等をご利用ください）');
          return false;
        }
        const picked = await WebBridge.pickSyncDirectory();
        if (!picked) return false;
        if (picked.unsupported) {
          if (typeof toast === 'function') toast('⚠️ このブラウザはフォルダ直接指定に対応していません（Chrome / Edge 等の対応ブラウザをご利用ください）');
          return false;
        }
        if (picked.denied) {
          if (typeof toast === 'function') toast('⚠️ フォルダへの書き込み権限が許可されませんでした');
          return false;
        }
        updateSettings({ folderSyncEnabled: true, webDirName: picked.rootName }, { localOnly: true });
        if (typeof toast === 'function') toast('✅ クラウド同期フォルダを設定しました: ' + picked.rootName);
        await pullManifestAndMeta({ includeState: true, silent: true });
        scheduleSync('pick_folder');
        return true;
      } catch (e) {
        console.error('[CloudSync] pickSyncFolder error', e);
        if (typeof toast === 'function') toast('❌ フォルダ設定エラー: ' + (e.message || e));
        return false;
      }
    }

    async function clearSyncFolder() {
      if (!IS_ELECTRON && window.WebBridge) await WebBridge.clearSyncDirHandle();
      updateSettings({ folderSyncEnabled: false, localSyncPath: '', webDirName: '' }, { localOnly: true });
      if (typeof toast === 'function') toast('クラウド同期フォルダの指定を解除しました');
    }

    // ---- 終了時・起動時の自動処理 ----
    function setupLifecycleHooks() {
      // DB一覧の「📌 / ☁️」個別常時保持ボタン
      ['dbCardContainer', 'dbTableBody'].forEach(cid => {
        const el = document.getElementById(cid);
        if (!el || el.dataset.cloudPinWired) return;
        el.dataset.cloudPinWired = '1';
        el.addEventListener('click', e => {
          const pinBtn = e.target.closest('[data-offline-pin]');
          if (pinBtn) {
            e.stopPropagation();
            e.preventDefault();
            const sid = pinBtn.dataset.offlinePin;
            void setScenarioPinned(sid, !isScenarioPinned(sid));
            return;
          }
          const btn = e.target.closest('[data-cloud-keep]');
          if (!btn) return;
          e.stopPropagation();
          e.preventDefault();
          const sid = btn.dataset.cloudKeep;
          void setScenarioPinned(sid, !isScenarioPinned(sid));
        }, true);
      });

      document.getElementById('cloudManualSyncBtn')?.addEventListener('click', () => { void syncNow(); });
      document.getElementById('cloudExitSkipBtn')?.addEventListener('click', () => {
        exitSkipped = true;
        void savePersistedQueue().then(() => {
          if (IS_ELECTRON) {
            try { require('electron').ipcRenderer.send('app:confirm-close'); } catch (_) {}
          }
        });
      });

      const sm = document.getElementById('settingsModal');
      if (sm && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => {
          if (sm.classList.contains('open') || (sm.style.display && sm.style.display !== 'none')) renderSettingsUI();
        }).observe(sm, { attributes: true, attributeFilter: ['style', 'class'] });
      }

      if (IS_ELECTRON && typeof require === 'function') {
        try {
          const ipc = require('electron').ipcRenderer;
          ipc.on('app:request-close-sync', async () => {
            if (exitFlowActive) return;
            exitFlowActive = true;
            exitSkipped = false;
            try { ipc.send('app:close-ack'); } catch (_) {}
            try {
              if (window.CCF && typeof CCF.flushSave === 'function') CCF.flushSave();
              saveStateNow({ skipCloud: true });
              await saveDiskAutosaveNow();
              await prepareAndEnqueueSync({ interactive: false, reason: 'app_exit' });
            } catch (e) { console.warn('[CloudSync] exit prep error', e); }

            if ((cloudUploadQueue.length > 0 || draining) && !exitSkipped) {
              exitInitialTotal = Math.max(1, cloudUploadQueue.length);
              const modal = document.getElementById('cloudExitModal');
              if (modal) modal.style.display = 'flex';
              updateExitModalProgress();
              await drainQueue();
            }
            if (!exitSkipped) {
              try { ipc.send('app:confirm-close'); } catch (_) {}
            }
          });
        } catch (_) {}
      } else {
        window.addEventListener('beforeunload', e => {
          if (cloudUploadQueue.length > 0 || draining) {
            try { localStorage.setItem('taku_cloud_queue_len', String(cloudUploadQueue.length)); } catch (_) {}
            e.preventDefault();
            e.returnValue = '';
          }
        });
      }
    }

    function runAfterSplashIdle(task) {
      const scheduleIdle = () => {
        setTimeout(() => {
          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => { void task(); }, { timeout: 2000 });
          } else {
            void task();
          }
        }, 2500);
      };
      const splash = document.getElementById('appBootSplash');
      if (!splash || splash.classList.contains('fade-out') || getComputedStyle(splash).display === 'none') {
        scheduleIdle();
        return;
      }
      let done = false;
      let obs = null;
      let fallbackTimer = null;
      const trigger = () => {
        if (done) return;
        done = true;
        if (obs) obs.disconnect();
        clearTimeout(fallbackTimer);
        scheduleIdle();
      };
      obs = new MutationObserver(() => {
        if (splash.classList.contains('fade-out') || getComputedStyle(splash).display === 'none') trigger();
      });
      obs.observe(splash, { attributes: true, attributeFilter: ['class', 'style'] });
      fallbackTimer = setTimeout(trigger, 5000);
    }

    function bootCloudSync() {
      const csBoot = loadLocalCloudSettings();
      const savedAuth = restoredGDriveAuth || restoreToken();
      if (savedAuth && savedAuth.valid && savedAuth.token) {
        setGDriveAccessToken(savedAuth.token, savedAuth.obtainedAt, {
          expiresAt: savedAuth.expiresAt,
          email: savedAuth.email,
          skipAutoSync: true,
          skipRelaySave: true
        });
      } else if (csBoot && csBoot.gdriveBridgeToken && Number(csBoot.gdriveBridgeExpiresAt) > (Date.now() + 60 * 1000)) {
        setGDriveAccessToken(csBoot.gdriveBridgeToken, Date.now(), {
          expiresAt: Number(csBoot.gdriveBridgeExpiresAt),
          email: csBoot.gdriveBridgeEmail || '',
          skipAutoSync: true,
          skipRelaySave: true
        });
      }
      setupLifecycleHooks();
      renderSettingsUI();
      updateHeaderBadges();
      runAfterSplashIdle(async () => {
        await loadManifestCache();
        await loadLocalCacheInventory();
        await loadPersistedQueue();
        await purgeUploadQueue();
        updateHeaderBadges();
        const cs = getSettings();
        if (cs.syncGDriveAssets !== false && (currentAuthUser || gdriveEmail) && !isTokenUsable()) {
          await ensureValidGDriveToken({ interactive: false });
        }
        if (cs.folderSyncEnabled || isTokenUsable()) {
          void pullManifestAndMeta({ silent: true });
        }
        if (cloudUploadQueue.length > 0 && (cs.folderSyncEnabled || isTokenUsable())) {
          void drainQueue();
        }
      });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootCloudSync);
    else bootCloudSync();

    window.CloudSync = {
      getSettings,
      updateSettings,
      setGDriveAccessToken,
      clearGDriveAuth,
      isTokenUsable,
      ensureValidGDriveToken,
      canDownloadFromCloud,
      isCloudAssetRef,
      parseCloudAssetRef,
      lookupShaForRef,
      isScenarioPinned,
      setScenarioPinned,
      getScenarioCacheStatus,
      ensureScenarioAssetsCached,
      releaseScenarioLocalCache,
      releaseAllUnpinnedLocalCache,
      cleanupUnusedCloudAssets,
      listCloudBackups,
      openCloudBackupRestoreModal,
      uploadExportFile,
      pullManifestAndMeta,
      fetchThumbBlob,
      fetchFullImageBlob,
      readCloudAssetBytes,
      ensureAssetByIdbRef,
      readByPathOrName,
      syncScenarioAssetsToWeb,
      scheduleAutoWebSync,
      onAuthChanged: user => {
        currentAuthUser = user || null;
        if (currentAuthUser && currentAuthUser.email && !gdriveEmail) {
          gdriveEmail = String(currentAuthUser.email);
        }
        updateHeaderBadges();
        renderSettingsUI();
        if (currentAuthUser) {
          const cs = getSettings();
          if (isTokenUsable()) {
            void pullManifestAndMeta({ silent: true });
            if (cloudUploadQueue.length) void drainQueue();
          } else if (cs.syncGDriveAssets !== false && (gdriveEmail || currentAuthUser.email)) {
            void ensureValidGDriveToken({ interactive: false }).then(res => {
              if (res && res.ok) {
                void pullManifestAndMeta({ silent: true });
                if (cloudUploadQueue.length) void drainQueue();
              }
            });
          }
        }
      },
      onRoomSaved: (scenarioKey) => {
        if (scenarioKey && scenarioKey !== '_default' && typeof appState !== 'undefined') {
          const sc = (appState.scenarios || []).find(s => String(s.id) === String(scenarioKey));
          if (sc) {
            sc.detailEdited = true;
            syncScenarioAssetCatalog(sc);
            scheduleAutoWebSync(sc.id);
          }
        }
        scheduleSync('room_saved');
      },
      scheduleSync,
      syncNow: syncNowForce,
      syncNowForce,
      renderSettingsUI,
      fetchMissingImageBlob,
      purgeUploadQueue,
      resetUploadQueue,
      isSyncing: isSyncActive,
      onSyncIdle,
      isAssetRefLocallyCachedSync,
      getQueueLength: () => cloudUploadQueue.length
    };
  })();

  let _blobSaveQueued = false;
  if (typeof serializeState === 'function' && !serializeState.__blobCleanedWrapped) {
    const _origSerializeState = serializeState;
    const _wrappedSerializeState = function (obj) {
      if (typeof cleanStaleBlobUrls === 'function' && obj && typeof obj === 'object') {
        const cleaned = cleanStaleBlobUrls(obj);
        if (cleaned && typeof appState !== 'undefined' && obj === appState && !_blobSaveQueued && typeof saveState === 'function') {
          _blobSaveQueued = true;
          setTimeout(() => {
            _blobSaveQueued = false;
            try { saveState(false, { skipDetailEdited: true }); } catch (_) {}
          }, 0);
        }
      }
      return _origSerializeState.apply(this, arguments);
    };
    _wrappedSerializeState.__blobCleanedWrapped = true;
    try { serializeState = _wrappedSerializeState; } catch (_) {}
    if (typeof window !== 'undefined') window.serializeState = _wrappedSerializeState;
  }
