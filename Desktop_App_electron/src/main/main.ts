import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';
import * as path from 'path';
import { createLoginWindow, createDashboardWindow, getMainWindow, setMainWindow } from './window';
import { registerIpcHandlers } from './ipc';

// ── Single instance lock ──────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Security: block navigation to external URLs ──────────
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'file:') {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
