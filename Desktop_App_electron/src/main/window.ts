import { BrowserWindow } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;

  // ── Handle window close (X button) ───────────────────
  // The 'close' event fires before before-quit.
  // We let before-quit in main.ts handle the actual clock-out.
  // This just ensures the window closing triggers app quit properly.
  win.on('close', (event) => {
    // Let the app-level before-quit handler take care of clock-out
    // Don't prevent default here — just let it propagate to before-quit
  });
}

function baseWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
    resizable: true,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
  };
}

export function createLoginWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...baseWindowOptions(),
    width: 480,
    height: 620,
    resizable: false,
    title: 'AV DEVS Collab — Login',
  });

  win.loadFile(path.join(__dirname, '../../src/renderer/login.html'));
  win.once('ready-to-show', () => win.show());

  return win;
}

export function createDashboardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...baseWindowOptions(),
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'AV DEVS Collab',
  });

  win.loadFile(path.join(__dirname, '../../src/renderer/dashboard.html'));
  win.once('ready-to-show', () => win.show());

  return win;
}

export function closeAllWindows(): void {
  BrowserWindow.getAllWindows().forEach(w => w.close());
}