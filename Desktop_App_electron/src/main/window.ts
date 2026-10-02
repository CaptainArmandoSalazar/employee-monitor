import { BrowserWindow, Notification } from 'electron';
import * as path from 'path';
import { sessionService } from './services/session.service';

let mainWindow: BrowserWindow | null = null;
let _quitting = false;
let _hideNoticeShown = false;

/** Called when the app is really quitting (tray Quit, update install, before-quit). */
export function setQuitting(value: boolean = true): void { _quitting = value; }
export function isQuitting(): boolean { return _quitting; }

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;

  // While clocked in, closing the window only hides it. Tracking keeps running.
  win.on('close', (event) => {
    if ((win as any)._allowClose || _quitting) return;   // real close (logout, quit, update)
    if (!sessionService.isClocked()) return;             // not clocked in: normal close

    event.preventDefault();
    win.hide();

    if (!_hideNoticeShown && Notification.isSupported()) {
      _hideNoticeShown = true;
      new Notification({
        title: 'AV DEVS Collab',
        body: 'You are still clocked in. Tracking continues in the background. Use the tray icon to reopen or quit.',
      }).show();
    }
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
  BrowserWindow.getAllWindows().forEach(w => {
    (w as any)._allowClose = true;
    w.close();
  });
}