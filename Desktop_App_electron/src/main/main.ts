import { app, BrowserWindow, dialog, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { createLoginWindow, createDashboardWindow, getMainWindow, setMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { activityTracker } from './system/activity';
import { trackingService } from './services/tracking.service';
import { sessionService } from './services/session.service';
import { authService } from './services/auth.service';
import { apiService } from './services/api.service';
import { autoUpdater } from 'electron-updater';

// ── Single instance lock ──────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — focus it and exit
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  // Someone tried to run a second instance — focus our window
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

// ── State ─────────────────────────────────────────────────
let _clockOutDone     = false;
let _updateDownloaded = false;
let _tray: Tray | null = null;
let _forceQuit        = false;
let _exiting          = false;

export function isForceQuit(): boolean        { return _forceQuit; }
export function isUpdateDownloaded(): boolean { return _updateDownloaded; }

// ── Auto Launch ───────────────────────────────────────────
function setupAutoLaunch(): void {
  if (process.platform === 'linux') {
    const fs   = require('fs');
    const os   = require('os');
    const autostartDir = path.join(os.homedir(), '.config', 'autostart');
    const desktopFile  = path.join(autostartDir, 'av-devs-collab.desktop');
    const execPath     = app.getPath('exe');
    const desktopEntry = `[Desktop Entry]\nType=Application\nName=AV DEVS Collab\nExec=${execPath} --hidden\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n`;
    try {
      if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true });
      fs.writeFileSync(desktopFile, desktopEntry, 'utf8');
    } catch (e) {
      console.error('[AutoLaunch] Failed to create autostart entry:', e);
    }
  } else {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      name: 'AV DEVS Collab',
    });
  }
}

// ── System Tray ───────────────────────────────────────────
function setupTray(): void {
  try {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'assets', 'icon.png')
      : path.join(app.getAppPath(), 'assets', 'icon.png');

    let trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      // Fallback: create a simple 16x16 colored icon if file not found
      console.warn('[Tray] Icon not found at:', iconPath, '— using empty icon');
    }
    trayIcon = trayIcon.resize({ width: 16, height: 16 });

    _tray = new Tray(trayIcon);
    _tray.setToolTip('AV DEVS Collab — Running');

    const rebuildMenu = () => {
      const isClocked = sessionService.isClocked();
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Open AV DEVS Collab',
          click: () => {
            const win = getMainWindow();
            if (win) { win.show(); win.focus(); }
          },
        },
        { type: 'separator' },
        {
          label: isClocked ? 'Currently Clocked In (tracking active)' : 'Not clocked in',
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Quit',
          enabled: !isClocked, // DISABLED when clocked in
          click: async () => {
            if (isClocked) return; // Safety guard — should never reach here
            const win = getMainWindow();
            const { response } = await dialog.showMessageBox(win!, {
              type: 'warning',
              title: 'Quit AV DEVS Collab',
              message: 'Are you sure you want to quit?',
              detail: 'You are not clocked in, so no session will be affected.',
              buttons: ['Cancel', 'Quit'],
              defaultId: 0,
              cancelId: 0,
            });
            if (response === 1) {
              _forceQuit = true;
              app.quit();
            }
          },
        },
        {
          // Emergency quit for admins only — always visible but labeled clearly
          label: 'Force Quit (Admin) — Clocks Out Session',
          click: async () => {
            const win = getMainWindow();
            const { response } = await dialog.showMessageBox(win!, {
              type: 'warning',
              title: 'Force Quit',
              message: 'This will clock out your active session and quit.',
              detail: 'Only use this if instructed by your admin. Your session will be marked complete.',
              buttons: ['Cancel', 'Force Quit & Clock Out'],
              defaultId: 0,
              cancelId: 0,
            });
            if (response === 1) {
              _forceQuit = true;
              await forceClockOut();
              app.quit();
            }
          },
        },
      ]);
      _tray!.setContextMenu(contextMenu);
    };

    rebuildMenu();
    // Rebuild menu every 30s to reflect clock-in state changes
    setInterval(rebuildMenu, 30_000);

    _tray.on('click', () => {
      const win = getMainWindow();
      if (win) { win.show(); win.focus(); }
    });

    _tray.on('double-click', () => {
      const win = getMainWindow();
      if (win) { win.show(); win.focus(); }
    });

    console.log('[Tray] ✅ System tray initialized.');
  } catch (err) {
    console.error('[Tray] ❌ Failed to create tray:', err);
    // App still works — just no tray icon
  }
}

// ── Auto Updater ──────────────────────────────────────────
function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'CaptainArmandoSalazar',
    repo: 'employee-monitor-releases',
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    const win = getMainWindow();
    if (!win) return;
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Available',
      message: `A new version (v${info.version}) is available.`,
      detail: 'Would you like to download and install it now?',
      buttons: ['Download Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate();
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] App is up to date.');
  });

  autoUpdater.on('download-progress', (progress) => {
    const win = getMainWindow();
    if (win) {
      win.setProgressBar(progress.percent / 100);
      win.setTitle(`Downloading update… ${Math.round(progress.percent)}%`);
    }
    console.log(`[Updater] Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    _updateDownloaded = true;
    console.log('[Updater] Update downloaded:', info.version);
    const win = getMainWindow();
    if (win) {
      win.setProgressBar(-1);
      win.setTitle('AV DEVS Collab');
    }
    dialog.showMessageBox(win!, {
      type: 'info',
      title: 'Update Ready',
      message: `v${info.version} has been downloaded.`,
      detail: 'The update will be installed when you restart the app. Restart now?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        forceClockOut().then(() => {
          autoUpdater.quitAndInstall(false, true);
        });
      }
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err?.message || err);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[Updater] Check failed:', err?.message);
    });
  }, 10_000);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[Updater] Periodic check failed:', err?.message);
    });
  }, 30 * 60 * 1000);
}

// ── Force clock-out ───────────────────────────────────────
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

    let activeTime = totals.active;
    let idleTime   = totals.idle;

    if (session && session.clock_in && activeTime === 0 && idleTime === 0) {
      const clockInStr = String(session.clock_in);
      const clockInISO = clockInStr.endsWith('Z') || clockInStr.includes('+')
        ? clockInStr : clockInStr + 'Z';
      const clockInMs = new Date(clockInISO).getTime();
      const nowMs     = Date.now();

      let lastActiveMs = nowMs;
      if ((session as any).last_heartbeat) {
        const hbStr = String((session as any).last_heartbeat);
        const hbISO = hbStr.endsWith('Z') || hbStr.includes('+')
          ? hbStr : hbStr + 'Z';
        lastActiveMs = new Date(hbISO).getTime();
      }

      activeTime = Math.max(0, Math.floor((lastActiveMs - clockInMs) / 1000));
      idleTime   = Math.max(0, Math.floor((nowMs - lastActiveMs) / 1000));

      console.log(`[App] Wall-clock — active: ${activeTime}s, idle: ${idleTime}s`);
    }

    console.log('[App] Final totals — active:', activeTime, 'idle:', idleTime);

    const result = await Promise.race([
      sessionService.clockOut(activeTime, idleTime),
      new Promise<{success: boolean}>((resolve) =>
        setTimeout(() => resolve({ success: false }), 5000)
      ),
    ]);

    if (result.success) {
      console.log('[App] ✅ Force clock-out successful.');
    } else {
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

// ── Smart startup: check for existing session and route accordingly ──
async function smartStartup(): Promise<void> {
  console.log('[App] Checking for existing session on startup...');

  // If we have a saved auth token, check for an active session
  if (authService.isLoggedIn()) {
    try {
      const session = await sessionService.fetchActiveSession();
      if (session) {
        console.log('[App] Active session found on startup — opening dashboard directly.');
        // Resume the session: restore clock-in time so timer is correct
        sessionService.resumeSession(session);
        // Go straight to dashboard, start tracking
        activityTracker.start();
        trackingService.start();
        const win = createDashboardWindow();
        setMainWindow(win);
        return;
      } else {
        console.log('[App] No active session — opening dashboard (logged in, no session).');
        // Still logged in but not clocked in — show dashboard
        const win = createDashboardWindow();
        setMainWindow(win);
        return;
      }
    } catch (err) {
      console.error('[App] Failed to check session on startup:', err);
      // Fall through to login
    }
  }

  // Not logged in or token expired — show login
  console.log('[App] Not authenticated — showing login.');
  const win = createLoginWindow();
  setMainWindow(win);
}

// ── App lifecycle ─────────────────────────────────────────
app.whenReady().then(async () => {
  setupAutoLaunch();
  registerIpcHandlers();

  // Smart startup: go to dashboard if session exists, login otherwise
  await smartStartup();

  setupTray();

  if (app.isPackaged) {
    setupAutoUpdater();
  } else {
    console.log('[Updater] Skipping auto-update in dev mode.');
  }

  app.on('activate', () => {
    // macOS: dock click — show existing window
    const win = getMainWindow();
    if (win) { win.show(); win.focus(); }
    else {
      smartStartup();
    }
  });
});

// ── X button / window close ───────────────────────────────
// This is handled in window.ts setMainWindow — close hides to tray
// We intercept app-level quit here:
app.on('before-quit', (event) => {
  if (!_forceQuit) {
    // Prevent quit unless forced — user should use tray menu
    event.preventDefault();
    return;
  }
  // Forced quit: if still clocked in and haven't done clock-out yet
  if (!_exiting && !_clockOutDone && sessionService.isClocked()) {
    event.preventDefault();
    handleExit(0);
  }
});

// ── All windows closed ────────────────────────────────────
app.on('window-all-closed', () => {
  // Do NOT quit — keep running in system tray
  // This is the key behavior: app stays alive even with no windows
  console.log('[App] All windows closed — staying in tray.');
});

// ── Exit handler ──────────────────────────────────────────
async function handleExit(code: number = 0): Promise<void> {
  if (_exiting) return;
  _exiting = true;
  await forceClockOut();
  app.exit(code);
}

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
});

// ── Security ──────────────────────────────────────────────
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'file:') event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});