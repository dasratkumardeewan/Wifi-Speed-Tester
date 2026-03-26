/* ================================================================
   theme.js
   ThemeController — manages light/dark theme preference.

   Responsibilities:
     - Read saved preference from localStorage on page load
     - Apply theme by toggling data-theme on <html>
     - Persist new preference whenever the user toggles
     - Update the toggle button label text to match current state

   All visual changes cascade automatically from CSS custom
   properties defined in main.css — no element-level style
   manipulation is needed here.
   ================================================================ */

const ThemeController = (() => {
  const STORAGE_KEY = 'dasrat_theme';
  const HTML        = document.documentElement;
  const LABEL       = document.getElementById('themeLabel');

  /**
   * Apply a theme by setting data-theme on <html>.
   * All CSS variables update automatically via :root / html[data-theme="dark"].
   * @param {'light'|'dark'} theme
   */
  function apply(theme) {
    HTML.setAttribute('data-theme', theme);
    if (LABEL) LABEL.textContent = theme === 'dark' ? 'Dark' : 'Light';
  }

  /**
   * Toggle between light and dark, then persist the choice.
   * Called by the theme toggle button's onclick handler in HTML.
   */
  function toggle() {
    const current = HTML.getAttribute('data-theme') || 'light';
    const next    = current === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {
      /* localStorage may be unavailable in private browsing — fail silently */
    }
  }

  /**
   * Initialise: read the saved preference and apply it before first paint.
   * Called once in the init() function at the bottom of ui.js.
   */
  function init() {
    let saved = 'light';
    try { saved = localStorage.getItem(STORAGE_KEY) || 'light'; } catch (_) {}
    apply(saved);
  }

  return { init, toggle };
})();
