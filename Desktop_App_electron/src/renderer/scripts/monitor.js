'use strict';
// ─── Monitor Service v3 ───────────────────────────────────────────────────────
const Monitor = (() => {

const S = {
    active: false,
    keystrokeCount: 0,
    keystrokeBuffer: [],
    siteCount: 0,
    lastWindow: { title: '', app: '', url: '' },
    lastSiteUrl: '',
    lastSiteStart: null,
    mouseClicks: 0,
    mouseMovements: 0,
    isIdle: false,
    idleStartMs: null,
    lastInputMs: Date.now(),
    workStartMs: null,
    intervals: {},
    feedCount: 0,
    lastLoggedSpeed: null,
  };

  // ─── Feed log
  function log(msg, type = '') {
    S.feedCount++;
    const el = document.getElementById('feedScroll');
    const fc = document.getElementById('feedCount');
    if (!el) return;
    const div = document.createElement('div');
    div.className = `feed-item fi-${type || 'plain'}`;
    const t = new Date().toLocaleTimeString('en-US', { hour12: false });
    div.textContent = `[${t}] ${msg}`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 60) el.removeChild(el.firstChild);
    if (fc) fc.textContent = `${S.feedCount} events`;
  }

  // ─── Metric helpers
  function setMetric(valId, val, liveId, live, fillId, pct) {
    const v = document.getElementById(valId);
    const l = document.getElementById(liveId);
    const f = document.getElementById(fillId);
    const card = v?.closest('.metric-card');
    if (v) v.textContent = val;
    if (l) { live ? l.classList.remove('hidden') : l.classList.add('hidden'); }
    if (card) { live ? card.classList.add('live') : card.classList.remove('live'); }
    if (f) f.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }

  function setAppRow(title, app) {
    const row  = document.querySelector('.app-row');
    const name = document.getElementById('appName');
    const t    = document.getElementById('appTime');
    if (name) name.textContent = title ? `${app ? app + ' — ' : ''}${title}` : 'No active window detected';
    if (row)  { title ? row.classList.add('active') : row.classList.remove('active'); }
    if (t)    t.textContent = title ? new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '';
  }

  // ─── Domain extraction from URL
  function extractDomain(url) {
    try {
      const u = new URL(url);
      return u.hostname || url;
    } catch {
      return url;
    }
  }

  // ─── Extract domain from window title
  function getDomainFromTitle(title) {
    if (!title) return null;

    // Remove profile suffix like " – Soham" or " – soham (avdevs)"
    let clean = title
      .replace(/\s*–\s*[\w\s()]+$/, '')
      .replace(/\s*-\s*(Google Chrome|Chromium|Mozilla Firefox|Brave|Opera|Microsoft Edge|Vivaldi)\s*$/i, '')
      .trim();

    // Try to find a domain in the title
    const domainMatch = clean.match(
      /\b([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+([a-zA-Z]{2,})\b/
    );
    if (domainMatch) return domainMatch[0].replace(/^www\./, '');

    // Known site name patterns in titles
    const knownSites = {
      'gmail': 'gmail.com',
      'inbox': 'gmail.com',
      'youtube': 'youtube.com',
      'linkedin': 'linkedin.com',
      'github': 'github.com',
      'twitter': 'twitter.com',
      'facebook': 'facebook.com',
      'instagram': 'instagram.com',
      'reddit': 'reddit.com',
      'stackoverflow': 'stackoverflow.com',
      'notion': 'notion.so',
      'slack': 'slack.com',
      'figma': 'figma.com',
      'claude': 'claude.ai',
      'chatgpt': 'chatgpt.com',
      'google': 'google.com',
      'whatsapp': 'whatsapp.com',
      'telegram': 'telegram.org',
      'amazon': 'amazon.com',
      'netflix': 'netflix.com',
      'spotify': 'spotify.com',
    };
    const cleanLower = clean.toLowerCase();
    for (const [keyword, domain] of Object.entries(knownSites)) {
      if (cleanLower.includes(keyword)) return domain;
    }

    // Fallback: use cleaned title as identifier if it has content
    return clean.length > 2 ? clean.substring(0, 50) : null;
  }

  // ─── Is browser app
  function isBrowserApp(app) {
    if (!app) return false;
    const lower = app.toLowerCase();
    const browsers = [
      'chrome', 'chromium', 'firefox', 'brave', 'safari',
      'edge', 'opera', 'vivaldi', 'google chrome', 'mozilla firefox',
      'microsoft edge', 'browser'
    ];
    return browsers.some(b => lower.includes(b));
  }

  // ─── Work timer display
  function startWorkTimer() {
    S.workStartMs = Date.now();
    const updateElapsedTime = () => {
      if (!S.active) return;
      const elapsed = Math.floor((Date.now() - S.workStartMs) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const mins  = Math.floor((elapsed % 3600) / 60);
      const secs  = elapsed % 60;
      const elapsedEl = document.getElementById('ssElapsed');
      if (elapsedEl) {
        elapsedEl.textContent = `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
      }
    };
    updateElapsedTime();
    S.intervals.timer = setInterval(updateElapsedTime, 1000);
  }

  // ─── Input tracking
  function setupInputTracking() {
    const resetIdle = () => {
      const wasIdle = S.isIdle;
      const idleStart = S.idleStartMs;
      S.lastInputMs = Date.now();

      if (wasIdle && idleStart) {
        // User just returned from idle — save the completed interval
        S.isIdle = false;
        S.idleStartMs = null;
        const idleEnd = Date.now();
        const duration = Math.floor((idleEnd - idleStart) / 1000);
        log(`Idle ended: ${Math.floor(duration/60)}m ${duration%60}s`, 'info');
        if (S.active && duration >= 10) {
          window.Api.logIdleInterval(idleStart, idleEnd)
            .then(() => log('Idle interval saved ✓', 'ok'))
            .catch(e => log(`Idle save error: ${e.message}`, 'err'));
        }
      }
    };

    window.electronAPI.onKeystrokeLive((count) => {
      if (!S.active) return;
      S.keystrokeCount = count;
      S.keystrokeBuffer.push('*');
      setMetric('mcKeysVal', S.keystrokeCount, 'keysLive', true, 'keysFill',
        Math.min(S.keystrokeCount / 300 * 100, 100));
      resetIdle();
    });

    document.addEventListener('mousemove', () => {
      if (S.active) { S.mouseMovements++; resetIdle(); }
    }, true);

    document.addEventListener('click', () => {
      if (S.active) { S.mouseClicks++; resetIdle(); }
    }, true);
  }

  // ─── Active window listener
  function setupActiveWindowListener() {
    // temporarily disabled
  }
  // ─── START monitoring
  function start(attendanceId) {
    if (S.active) return;
    S.active = true;
    S.keystrokeCount = 0;
    S.keystrokeBuffer = [];
    S.siteCount = 0;
    S.mouseClicks = 0;
    S.mouseMovements = 0;
    S.isIdle = false;
    S.idleStartMs = null;
    S.lastInputMs = Date.now();
    S.lastLoggedSpeed = null;

    log('System-wide monitoring started', 'ok');
    startWorkTimer();
    setMetric('mcStatusVal', 'ACTIVE', 'statusLive', true, 'statusFill', 80);

    // Start native system-wide polling
    window.electronAPI.startWindowPolling().catch(e => {
      log(`System polling unavailable: ${e.message}`, 'warn');
    });

    // Run first speed test immediately on start
    setTimeout(async () => {
      try {
        log('Running initial speed test...', 'info');
        const result = await window.electronAPI.runSpeedTest();
        const spd = result.download_mbps !== null ? result.download_mbps.toFixed(2) : '—';
        setMetric('mcNetVal', spd, 'netLive', result.is_connected, 'netFill',
          Math.min((result.download_mbps || 0) / 100 * 100, 100));
        log(`Speed: ↓${spd} ↑${result.upload_mbps ?? '—'} Mbps ping:${result.ping_ms ?? '—'}ms`, 'ok');
      } catch (e) {
        log(`Initial speed test failed: ${e.message}`, 'err');
      }
    }, 3000);

    // Activity sync every 20s
    S.intervals.activity = setInterval(async () => {
      const idleElapsed = Math.floor((Date.now() - S.lastInputMs) / 1000);
      const IDLE_THRESHOLD = 600; // 10 minutes

      // Detect transition INTO idle
      if (!S.isIdle && idleElapsed >= IDLE_THRESHOLD) {
        S.isIdle = true;
        S.idleStartMs = S.lastInputMs + (IDLE_THRESHOLD * 1000);
        log(`Idle started (no activity for ${IDLE_THRESHOLD}s)`, 'warn');
      }

      setMetric('mcStatusVal', S.isIdle ? 'IDLE' : 'ACTIVE', 'statusLive', true,
        'statusFill', S.isIdle ? 15 : 85);

      try {
        await window.Api.logActivity({
          active_window_title: S.lastWindow.title || 'System',
          active_app_name:     S.lastWindow.app   || 'System',
          mouse_clicks:        S.mouseClicks,
          mouse_movements:     S.mouseMovements,
          keystrokes_count:    S.keystrokeCount,
          is_idle:             S.isIdle,
          idle_seconds:        S.isIdle ? idleElapsed : 0,
          logged_at:           new Date().toISOString(),
        });
        S.mouseClicks    = 0;
        S.mouseMovements = 0;
        log('Activity logged ✓', 'ok');
      } catch (e) {
        log(`Activity sync failed: ${e.message}`, 'err');
      }
    }, 20_000);

    // Keystroke flush every 25s
    S.intervals.keystrokes = setInterval(async () => {
      if (S.keystrokeBuffer.length === 0 && S.keystrokeCount === 0) return;
      const keys = S.keystrokeBuffer.splice(0).join('');
      try {
        await window.Api.logKeystrokes(
          keys || `[count:${S.keystrokeCount}]`,
          S.lastWindow.app || 'System'
        );
        log(`Keystrokes recorded (${S.keystrokeCount} total)`, 'ok');
        S.keystrokeCount = 0;
      } catch (e) {
        log(`Keystroke error: ${e.message}`, 'err');
      }
    }, 25_000);

    // Network speed test every 5 minutes
    S.intervals.network = setInterval(async () => {
      try {
        setMetric('mcNetVal', '...', 'netLive', false, 'netFill', 0);
        log('Running speed test...', 'info');
        const result = await window.electronAPI.runSpeedTest();
        const spd = result.download_mbps !== null ? result.download_mbps.toFixed(2) : '—';
        setMetric('mcNetVal', spd, 'netLive', true, 'netFill',
          Math.min((result.download_mbps || 0) / 100 * 100, 100));
        await window.Api.logNetwork({
          download_mbps: result.download_mbps,
          upload_mbps:   result.upload_mbps,
          ping_ms:       result.ping_ms,
          is_connected:  result.is_connected,
          network_type:  'speedtest',
          ssid:          null,
          logged_at:     new Date().toISOString(),
        });
        log(`Speed: ↓${spd} ↑${result.upload_mbps ?? '—'} Mbps ping:${result.ping_ms ?? '—'}ms`, 'ok');
      } catch (e) {
        setMetric('mcNetVal', 'ERR', 'netLive', false, 'netFill', 0);
        log(`Speed test error: ${e.message}`, 'err');
      }
    }, 300_000);
  }

  // ─── STOP monitoring
  async function stop() {
    if (!S.active) return;
    S.active = false;

    Object.entries(S.intervals).forEach(([k, id]) => { if (k !== 'timer') clearInterval(id); });

    try { await window.electronAPI.stopWindowPolling(); } catch {}

    // Final keystroke flush
    if (S.keystrokeBuffer.length > 0) {
      const keys = S.keystrokeBuffer.splice(0).join('');
      try { await window.Api.logKeystrokes(keys, S.lastWindow.app || 'Employee Monitor'); } catch {}
    } else if (S.keystrokeCount > 0) {
      try { await window.Api.logKeystrokes(`[session-total:${S.keystrokeCount}]`, 'Session End'); } catch {}
    }

    // Final site flush
    if (S.lastSiteUrl && S.lastSiteStart) {
      const spent = Math.floor((Date.now() - S.lastSiteStart) / 1000);
      if (spent > 0) {
        try {
          await window.Api.logWebsite({
            url:                `https://${S.lastSiteUrl}`,
            domain:             S.lastSiteUrl,
            browser:            S.lastWindow.app || 'Browser',
            time_spent_seconds: spent,
            visited_at:         new Date(S.lastSiteStart).toISOString(),
          });
        } catch {}
      }
      S.lastSiteUrl = '';
      S.lastSiteStart = null;
    }

    clearInterval(S.intervals.timer);
    S.intervals = {};
    setAppRow('', '');
    setMetric('mcStatusVal', 'IDLE', 'statusLive', false, 'statusFill', 0);
    log('Monitoring stopped', 'warn');
  }

  function isActive() { return S.active; }

  return { start, stop, setupInputTracking, setupActiveWindowListener, isActive, log };
})();

window.Monitor = Monitor;