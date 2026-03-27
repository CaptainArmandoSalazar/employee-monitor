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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

app.on('second-instance', () => {
  const win = getMainWindow();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

// ── State ─────────────────────────────────────────────────
let _clockOutDone    = false;
let _updateDownloaded = false;
let _tray: Tray | null = null;
let _forceQuit       = false;
let _exiting         = false;

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
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'assets', 'icon.png')
    : path.join(app.getAppPath(), 'assets', 'icon.png');

  let trayIcon = nativeImage.createFromPath(iconPath);
  trayIcon = trayIcon.resize({ width: 16, height: 16 });

  _tray = new Tray(trayIcon);
  _tray.setToolTip('AV DEVS Collab — Running');

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
      label: 'Quit (Admin Only)',
      click: async () => {
        const win = getMainWindow();
        const { response } = await dialog.showMessageBox(win!, {
          type: 'warning',
          title: 'Quit AV DEVS Collab',
          message: 'Are you sure you want to quit?',
          detail: 'Tracking will stop and your session will be clocked out.',
          buttons: ['Cancel', 'Quit'],
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

  _tray.setContextMenu(contextMenu);

  _tray.on('click', () => {
    const win = getMainWindow();
    if (win) { win.show(); win.focus(); }
  });

  _tray.on('double-click', () => {
    const win = getMainWindow();
    if (win) { win.show(); win.focus(); }
  });
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

// ── Exit handler ──────────────────────────────────────────
async function handleExit(code: number = 0): Promise<void> {
  if (_exiting) return;
  _exiting = true;
  await forceClockOut();
  app.exit(code);
}

// ── App lifecycle ─────────────────────────────────────────
app.whenReady().then(() => {
  setupAutoLaunch();
  registerIpcHandlers();
  const win = createLoginWindow();
  setMainWindow(win);
  setupTray();

  if (app.isPackaged) {
    setupAutoUpdater();
  } else {
    console.log('[Updater] Skipping auto-update in dev mode.');
  }

  app.on('activate', () => {
    const win = getMainWindow();
    if (win) { win.show(); win.focus(); }
    else {
      const w = createLoginWindow();
      setMainWindow(w);
    }
  });
});

// ── X button / app.quit() ────────────────────────────────
app.on('before-quit', (event) => {
  if (!_forceQuit) {
    event.preventDefault();
    return;
  }
  if (_exiting || _clockOutDone || !sessionService.isClocked()) return;
  event.preventDefault();
  handleExit(0);
});

// ── All windows closed ────────────────────────────────────
app.on('window-all-closed', () => {
  // Do NOT quit — keep running in tray
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
});

// ── Security ──────────────────────────────────────────────
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'file:') event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});