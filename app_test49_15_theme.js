/* app_test49_15_theme.js — ダーク／ライト＋雰囲気スタイル4種（モダン/落ち着いた/やわらかめ/ミニマル）。
 * 設定は localStorage に保存。<head> で読み込み、描画前に data-theme / data-style を決めてちらつきを防ぐ。
 * 操作は左サイドバー「⚙️ 設定」→ #settingsModal の「🎨 外観・テーマ設定」から。 */
(function () {
  const KEY = 'discord_forum_tool_theme', SKEY = 'discord_forum_tool_style';
  const STYLES = ['modern', 'calm', 'soft', 'minimal'];
  const loadTheme = () => { try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } };
  const loadStyle = () => { try { const s = localStorage.getItem(SKEY); return STYLES.includes(s) ? s : 'modern'; } catch (e) { return 'modern'; } };
  function refreshButtons() {
    const t = document.documentElement.dataset.theme, s = document.documentElement.dataset.style;
    document.querySelectorAll('[data-theme-set]').forEach(b => { const on = b.dataset.themeSet === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('[data-style-set]').forEach(b => { const on = b.dataset.styleSet === s; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function paint(t, s) {
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.style = s;
    refreshButtons();
  }
  window.refreshAppearanceButtons = refreshButtons;
  window.getAppAppearance = () => ({ theme: loadTheme(), style: loadStyle() });
  window.setAppTheme = function (t) { t = t === 'light' ? 'light' : 'dark'; try { localStorage.setItem(KEY, t); } catch (e) { /* 保存できなくても表示は切り替える */ } paint(t, loadStyle()); };
  window.setAppStyle = function (s) { s = STYLES.includes(s) ? s : 'modern'; try { localStorage.setItem(SKEY, s); } catch (e) { /* 同上 */ } paint(loadTheme(), s); };
  paint(loadTheme(), loadStyle());
  document.addEventListener('DOMContentLoaded', () => paint(loadTheme(), loadStyle()));
  document.addEventListener('click', e => {
    const c = e.target.closest && e.target.closest('[data-theme-set],[data-style-set]'); if (!c) return;
    if (c.dataset.themeSet) window.setAppTheme(c.dataset.themeSet); else window.setAppStyle(c.dataset.styleSet);
  });
})();
