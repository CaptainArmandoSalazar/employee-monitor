import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createLoginWindow, createDashboardWindow, getMainWindow, setMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { activityTracker } from './system/activity';
import { trackingService } from './services/tracking.service';
import { sessionService } from './services/session.service';
import { authService } from './services/auth.service';
import { apiService } from './services/api.service';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

app.on('second-instance', () => {
  const win = getMainWindow();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

// ── Force clock-out ───────────────────────────────────────
let _clockOutDone = false;

async function forceClockOut(): Promise<void> {
  if (_clockOutDone) return;
  if (!sessionService.isClocked()) return;
  _clockOutDone = true;

  console.log('[App] Force clock-out started...');

  try {
    activityTracker.stop();
    trackingService.stop();

    const totals  = activityTracker.getTotals();
    const session = sessionService.getActiveSession();

    // ── Calculate active/idle from real timestamps if in-memory is 0 ──
    let activeTime = totals.active;
    let idleTime   = totals.idle;

    if (session && session.clock_in && (activeTime === 0 && idleTime === 0)) {
      // Fall back to wall-clock calculation
      const clockInStr = String(session.clock_in);
      const clockInISO = clockInStr.endsWith('Z') || clockInStr.includes('+')
        ? clockInStr : clockInStr + 'Z';
      const clockInMs   = new Date(clockInISO).getTime();
      const totalElapsed = Math.floor((Date.now() - clockInMs) / 1000);
      // Assume all elapsed time is active (conservative — better than 0)
      activeTime = Math.max(0, totalElapsed);
      idleTime   = 0;
      console.log(`[App] Using wall-clock active time: ${activeTime}s`);
    }

    console.log('[App] Totals — active:', activeTime, 'idle:', idleTime);

    const result = await Promise.race([
      sessionService.clockOut(activeTime, idleTime),
      new Promise<{success: boolean}>((resolve) =>
        setTimeout(() => resolve({ success: false }), 5000)
      ),
    ]);

    if (result.success) {
      console.log('[App] ✅ Force clock-out successful.');
    } else {
      // Direct API fallback
      const token = authService.getToken();
      if (token && session) {
        await Promise.race([
          apiService.post('/sessions/clock-out', {
            session_id:        session.session_id,
            total_active_time: activeTime,
            total_idle_time:   idleTime,
          }, token),
          new Promise(resolve => setTimeout(resolve, 3000)),
        ]);
        console.log('[App] ✅ Force clock-out via direct API.');
      }
    }
  } catch (err) {
    console.error('[App] Clock-out error:', err);
  }
}

// ── Exit handler ──────────────────────────────────────────
let _exiting = false;

async function handleExit(code: number = 0): Promise<void> {
  if (_exiting) return;
  _exiting = true;
  await forceClockOut();
  app.exit(code);
}

// ── App lifecycle ─────────────────────────────────────────
app.whenReady().then(() => {
  registerIpcHandlers();
  const win = createLoginWindow();
  setMainWindow(win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createLoginWindow();
      setMainWindow(w);
    }
  });
});

// ── X button / app.quit() ────────────────────────────────
app.on('before-quit', (event) => {
  if (_exiting || _clockOutDone || !sessionService.isClocked()) return;
  event.preventDefault();
  handleExit(0);
});

// ── All windows closed ────────────────────────────────────
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (sessionService.isClocked() && !_clockOutDone) {
      handleExit(0);
    } else {
      app.quit();
    }
  }
});

// ── Ctrl+C in terminal ────────────────────────────────────
process.on('SIGINT', () => {
  console.log('[App] SIGINT received');
  forceClockOut().then(() => process.exit(0));
});

// ── System kill ───────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[App] SIGTERM received');
  forceClockOut().then(() => process.exit(0));
});

// ── Terminal closed ───────────────────────────────────────
process.on('SIGHUP', () => {
  forceClockOut().then(() => process.exit(0));
});

// ── Crashes ───────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[App] Uncaught exception:', err);
  forceClockOut().then(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('[App] Unhandled rejection:', reason);
  // Don't exit on unhandled rejection — just log
});

// ── Security ──────────────────────────────────────────────
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'file:') event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});