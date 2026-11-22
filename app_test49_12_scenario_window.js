/* app_test49_12_scenario_window.js — シナリオカード・行クリック時の詳細モーダル起動 & 旧簡易編集モーダル互換フォールバック */
let swIdx = -1;
function openScenarioWindow(id) {
  if (!id) return;
  if (typeof openScenarioDetail === 'function') { openScenarioDetail(id); return; }
  if (typeof goEditScenario === 'function') { goEditScenario(id); return; }
}
async function closeScenarioWindow() { swIdx = -1; window.__editingScenario = false; }
async function saveScenarioWindow() { }
function openEditScenarioModal(idxOrId) {
  const sc = (typeof idxOrId === 'number' && appState && Array.isArray(appState.scenarios))
    ? appState.scenarios[idxOrId]
    : (appState && Array.isArray(appState.scenarios) ? appState.scenarios.find(s => s && s.id === idxOrId) : null);
  if (sc && sc.id) openScenarioWindow(sc.id);
}
(function () {
  document.addEventListener('click', e => {
    const card = e.target.closest && e.target.closest('[data-sid]');   // 一覧の行・カードをクリック → シナリオ詳細モーダル（ボタンやリンクの上は除く）
    if (card && !e.target.closest('[data-act], a, button, input, select, textarea, label')) activateScenario(card.dataset.sid);
  });
})();
