/**
 * Renderer-side tracker UI helper.
 * Polls getTrackingStats() every 10 seconds and updates any
 * stat elements that exist on the current page.
 */
'use strict';

(function () {
  const api = window.electronAPI;
  if (!api) return;

  let _interval = null;

  function updateStatEl(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function secondsToHm(seconds) {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  async function poll() {
    try {
      const stats = await api.getTrackingStats();
      if (!stats) return;
      updateStatEl('stat-active', secondsToHm(stats.active));
      updateStatEl('stat-idle',   secondsToHm(stats.idle));
      updateStatEl('stat-keys',   (stats.keystrokes || 0).toLocaleString());
    } catch {
      // Silently ignore — tracker may not be running
    }
  }

  window.trackerUI = {
    start() {
      poll();
      _interval = setInterval(poll, 10_000);
    },
    stop() {
      if (_interval) { clearInterval(_interval); _interval = null; }
    },
  };
})();
