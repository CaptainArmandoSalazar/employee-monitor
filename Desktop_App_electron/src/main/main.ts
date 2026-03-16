import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, powerMonitor } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execSync, exec } from 'child_process';
import Store from 'electron-store';

const store = new Store();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ─── Global state ─────────────────────────────────────────────────────────────
let windowPollInterval: NodeJS.Timeout | null = null;
let evdevStreams: fs.ReadStream[] = [];
let globalKeystrokeCount = 0;
let keystrokeBuffer: string[] = [];
let lastNetBytes = 0;
let lastNetTime = 0;
let lastKnownWindow: { title: string; app: string; url: string } | null = null;

// ─── Find ALL keyboard event devices ─────────────────────────────────────────
function findKeyboardDevices(): string[] {
  const devices: string[] = [];
  try {
    const devicesFile = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    const blocks = devicesFile.split('\n\n');
    for (const block of blocks) {
      if (!block.trim()) continue;
      const nameMatch = block.match(/N: Name="([^"]+)"/);
      const handlerMatch = block.match(/H: Handlers=([^\n]+)/);
      const handlers = handlerMatch ? handlerMatch[1] : '';
      if (!handlers.includes('kbd')) continue;

      const name = nameMatch?.[1]?.toLowerCase() || '';
      if (
        name.includes('sleep') ||
        name.includes('power') ||
        name.includes('video bus') ||
        name.includes('consumer') ||
        name.includes('system control')
      ) continue;

      const eventMatch = handlers.match(/event(\d+)/);
      if (eventMatch) {
        const devPath = `/dev/input/event${eventMatch[1]}`;
        devices.push(devPath);
        console.log(`[KeyMonitor] Found keyboard: "${nameMatch?.[1]}" → ${devPath}`);
      }
    }
  } catch (e: any) {
    console.log('[KeyMonitor] Error scanning /proc/bus/input/devices:', e.message);
  }
  return devices;
}

// ─── Start evdev monitoring on a single device ────────────────────────────────
function startEvdevDevice(device: string) {
  try {
    fs.accessSync(device, fs.constants.R_OK);
  } catch {
    console.log(`[KeyMonitor] Cannot read ${device} — not in 'input' group yet?`);
    console.log('[KeyMonitor] Fix: sudo usermod -a -G input $USER  then log out and back in');
    return;
  }

  try {
    const stream = fs.createReadStream(device, { highWaterMark: 240 });
    let buf = Buffer.alloc(0);

    stream.on('data', (chunk: string | Buffer) => {
      const data: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      buf = Buffer.concat([buf, data]);

      while (buf.length >= 24) {
        const event = buf.slice(0, 24);
        buf = buf.slice(24);
        const type = event.readUInt16LE(16);
        const value = event.readInt32LE(20);
        if (type === 1 && value === 1) {
          globalKeystrokeCount++;
          keystrokeBuffer.push('*');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('keystroke-live', globalKeystrokeCount);
          }
        }
      }
    });

    stream.on('error', (e) => {
      console.log(`[KeyMonitor] Stream error on ${device}:`, e.message);
    });

    stream.on('close', () => {
      console.log(`[KeyMonitor] Stream closed: ${device}`);
    });

    evdevStreams.push(stream);
    console.log(`[KeyMonitor] Now monitoring: ${device}`);
  } catch (e: any) {
    console.log(`[KeyMonitor] Failed to open ${device}:`, e.message);
  }
}

// ─── Start monitoring ALL keyboard devices ────────────────────────────────────
function startKeyMonitoring() {
  if (evdevStreams.length > 0) return;
  if (process.platform !== 'linux') return;

  const devices = findKeyboardDevices();
  if (devices.length === 0) {
    console.log('[KeyMonitor] No keyboard devices found');
    return;
  }
  for (const device of devices) {
    startEvdevDevice(device);
  }
  if (evdevStreams.length === 0) {
    console.log('[KeyMonitor] Failed to open any device. Run: sudo usermod -a -G input $USER then log out/in');
  } else {
    console.log(`[KeyMonitor] Active on ${evdevStreams.length} device(s) — Wayland-compatible ✓`);
  }
}

// ─── Stop all evdev streams ───────────────────────────────────────────────────
function stopKeyMonitoring() {
  for (const stream of evdevStreams) {
    try { stream.destroy(); } catch {}
  }
  evdevStreams = [];
  console.log('[KeyMonitor] Stopped all evdev streams');
}

function getAndResetKeystrokes(): { count: number; buffer: string } {
  const count = globalKeystrokeCount;
  const buffer = keystrokeBuffer.join('');
  globalKeystrokeCount = 0;
  keystrokeBuffer = [];
  return { count, buffer };
}

// ─── Network speed via /proc/net/dev ─────────────────────────────────────────
function getNetworkSpeed(): number | null {
  try {
    const netDev = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = netDev.split('\n');
    let totalBytes = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('lo:') || trimmed.startsWith('docker') || !trimmed.includes(':')) continue;
      const parts = trimmed.split(':')[1].trim().split(/\s+/);
      totalBytes += parseInt(parts[0]) || 0;
    }
    const now = Date.now();
    let speedMbps: number | null = null;
    if (lastNetBytes > 0 && lastNetTime > 0) {
      const bytesDiff = totalBytes - lastNetBytes;
      const timeDiff = (now - lastNetTime) / 1000;
      speedMbps = parseFloat(((bytesDiff * 8) / timeDiff / 1_000_000).toFixed(2));
      if (speedMbps < 0) speedMbps = 0;
    }
    lastNetBytes = totalBytes;
    lastNetTime = now;
    return speedMbps;
  } catch {
    return null;
  }
}

// ─── Get active window (AT-SPI + fallback) ────────────────────────────────────
function getActiveWindowFromProc(): { title: string; app: string; url: string } | null {
  try {
    const result = execSync(
      `python3 -c "
import sys
try:
    import pyatspi
    desktop = pyatspi.Registry.getDesktop(0)

    # First: find truly focused non-electron window
    for app in desktop:
        if app is None:
            continue
        app_name = app.name or ''
        if 'electron' in app_name.lower():
            continue
        try:
            for window in app:
                if window is None or not window.name:
                    continue
                state = window.getState()
                if state.contains(pyatspi.STATE_ACTIVE) or state.contains(pyatspi.STATE_FOCUSED):
                    print(app_name + '||' + window.name)
                    sys.exit(0)
        except Exception:
            pass

    # Second: pick best visible window from priority apps
    priority_apps = ['Google Chrome', 'chromium', 'Firefox', 'Brave', 'code', 'Code', 'slack']
    for p in priority_apps:
        for app in desktop:
            if app is None:
                continue
            app_name = app.name or ''
            if p.lower() not in app_name.lower():
                continue
            try:
                for window in app:
                    if window is None:
                        continue
                    name = window.name or ''
                    if not name:
                        continue
                    # Skip empty or profile-only titles
                    if len(name.strip()) < 3:
                        continue
                    print(app_name + '||' + name)
                    sys.exit(0)
            except Exception:
                pass
except Exception as e:
    print('ERROR:' + str(e), file=sys.stderr)
"`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();

    if (!result || result.startsWith('ERROR')) return null;

    const parts = result.split('||');
    const appName = parts[0]?.trim() || '';
    const windowTitle = parts[1]?.trim() || '';

    if (!appName || !windowTitle) return null;

    let url = '';
    const browserNames = ['chrome', 'chromium', 'firefox', 'brave', 'opera', 'vivaldi', 'edge'];
    const isBrowser = browserNames.some(b => appName.toLowerCase().includes(b));

    if (isBrowser) {
      // Remove " – ProfileName" suffix and " - Google Chrome" suffix
      const cleanTitle = windowTitle
        .replace(/\s*–\s*\S+\s*$/, '')          // remove " – Soham" profile suffix
        .replace(/\s*[-—–]\s*(Mozilla Firefox|Google Chrome|Chromium|Brave|Opera|Microsoft Edge|Vivaldi).*$/i, '')
        .trim();

      const domainMatch = cleanTitle.match(
        /\b([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+([a-zA-Z]{2,})\b/
      );
      url = domainMatch
        ? `https://${domainMatch[0]}`
        : `app://${appName}/${encodeURIComponent(cleanTitle)}`;
    }

    console.log(`[ActiveWindow] ${appName} — ${windowTitle}`);
    return { title: windowTitle, app: appName, url };

  } catch (e: any) {
    try {
      const checks = [
        { pattern: '/opt/google/chrome/chrome', name: 'Google Chrome', key: 'chrome' },
        { pattern: 'chromium', name: 'Chromium', key: 'chromium' },
        { pattern: 'firefox', name: 'Firefox', key: 'firefox' },
        { pattern: 'brave', name: 'Brave', key: 'brave' },
        { pattern: 'code', name: 'Visual Studio Code', key: 'code' },
      ];
      for (const check of checks) {
        const pid = execSync(`pgrep -f "${check.pattern}" 2>/dev/null | head -1`,
          { encoding: 'utf8', timeout: 500 }).trim();
        if (pid) return { title: check.name, app: check.name, url: `app://${check.key}/active` };
      }
    } catch {}
    return null;
  }
}

// ─── Window polling ───────────────────────────────────────────────────────────
function startWindowPolling() {
    console.log('[WindowPoll] Disabled temporarily');
}
// ─── Speed test (async, non-blocking) ────────────────────────────────────────
function stopWindowPolling() {
  if (windowPollInterval) {
    clearInterval(windowPollInterval);
    windowPollInterval = null;
  }
}

// ─── Window creation ──────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 400,
    minHeight: 650,
    resizable: false,
    frame: false,
    backgroundColor: '#06060f',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../../resources/icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/pages/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
      if (process.platform === 'darwin') app.dock?.hide();
    }
  });

  mainWindow.on('minimize', (e: Event) => {
    const clockedIn = store.get('isClockedIn') as boolean;
    if (!clockedIn) {
      e.preventDefault();
      mainWindow?.restore();
    }
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../../resources/tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
    icon.setTemplateImage(true);
  }
  tray = new Tray(icon);
  tray.setToolTip('Employee Monitor - Activity Tracking Active');
  updateTrayMenu(false);
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function updateTrayMenu(clockedIn: boolean) {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: clockedIn ? '🟢 Clocked In' : '⚪ Not Clocked In', enabled: false },
    { label: 'Clock Out', enabled: clockedIn, click: () => { mainWindow?.show(); mainWindow?.webContents.send('tray-clock-out'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('store-get', (_e, key) => store.get(key));
ipcMain.handle('store-set', (_e, key, val) => { store.set(key, val); return true; });
ipcMain.handle('store-delete', (_e, key) => { store.delete(key); return true; });

ipcMain.handle('get-device-id', () => {
  let id = store.get('deviceId') as string;
  if (!id) {
    id = `${os.hostname()}-${os.platform()}-${os.arch()}`;
    store.set('deviceId', id);
  }
  return id;
});

ipcMain.handle('run-speed-test', async () => {
  console.log('[SpeedTest] Running in background...');
  return new Promise((resolve) => {
    exec(
      `python3 -c "import speedtest, json; s=speedtest.Speedtest(); s.get_best_server(); s.download(); s.upload(); r=s.results.dict(); print(json.dumps({'download':r['download'],'upload':r['upload'],'ping':r['ping']}))"`,
      { timeout: 90000 },
      (error: any, stdout: string) => {
        if (error) {
          console.log('[SpeedTest] Failed:', error.message);
          resolve({ download_mbps: null, upload_mbps: null, ping_ms: null, is_connected: false });
          return;
        }
        try {
          const d = JSON.parse(stdout.trim());
          const result = {
            download_mbps: parseFloat((d.download / 1_000_000).toFixed(2)),
            upload_mbps:   parseFloat((d.upload   / 1_000_000).toFixed(2)),
            ping_ms:       parseFloat(d.ping.toFixed(1)),
            is_connected:  true,
          };
          console.log(`[SpeedTest] Done: ${result.download_mbps} Mbps down`);
          resolve(result);
        } catch {
          resolve({ download_mbps: null, upload_mbps: null, ping_ms: null, is_connected: false });
        }
      }
    );
  });
});

ipcMain.handle('get-system-info', () => ({
  platform: process.platform,
  hostname: os.hostname(),
  username: os.userInfo().username,
  arch: os.arch(),
  totalMemory: os.totalmem(),
  freeMemory: os.freemem(),
  cpus: os.cpus().length,
}));

ipcMain.handle('update-tray-status', (_e, on) => { updateTrayMenu(on); return true; });

ipcMain.handle('start-window-polling', () => {
  startWindowPolling();
  startKeyMonitoring();
  console.log('[IPC] System-wide monitoring started');
  return true;
});

ipcMain.handle('stop-window-polling', () => {
  stopWindowPolling();
  stopKeyMonitoring();
  console.log('[IPC] System-wide monitoring stopped');
  return true;
});

ipcMain.handle('get-keystroke-data', () => {
  const data = getAndResetKeystrokes();
  console.log(`[IPC] Keystroke data retrieved: ${data.count} keystrokes`);
  return data;
});

ipcMain.handle('window-minimize', () => { mainWindow?.minimize(); return true; });

ipcMain.handle('window-hide', () => {
  mainWindow?.hide();
  if (process.platform === 'darwin') app.dock?.hide();
  return true;
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  console.log('[App] Electron ready');
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
  createWindow();
  createTray();
  powerMonitor.on('suspend', () => {
    console.log('[PowerMonitor] Suspending');
    mainWindow?.webContents.send('system-suspend');
  });
  powerMonitor.on('resume', () => {
    console.log('[PowerMonitor] Resuming');
    mainWindow?.webContents.send('system-resume');
  });
  console.log('[App] Setup complete');
});

app.on('window-all-closed', () => console.log('[App] All windows closed, app remains in tray'));
app.on('activate', () => { if (mainWindow === null) createWindow(); else mainWindow.show(); });
app.on('before-quit', () => {
  console.log('[App] Before quit');
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-before-quit');
  }
  stopWindowPolling();
  stopKeyMonitoring();
});
process.on('uncaughtException', (error) => console.error('[Error] Uncaught exception:', error));