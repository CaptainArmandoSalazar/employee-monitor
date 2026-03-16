import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Store (persistent data)
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, val: any) => ipcRenderer.invoke('store-set', key, val),
  storeDelete: (key: string) => ipcRenderer.invoke('store-delete', key),

  // ─── System info
  getDeviceId: () => ipcRenderer.invoke('get-device-id'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // ─── Tray
  updateTrayStatus: (on: boolean) => ipcRenderer.invoke('update-tray-status', on),
runSpeedTest: () => ipcRenderer.invoke('run-speed-test'),

  // ─── Monitoring
  startWindowPolling: () => ipcRenderer.invoke('start-window-polling'),
  stopWindowPolling: () => ipcRenderer.invoke('stop-window-polling'),
  getKeystrokeData: () => ipcRenderer.invoke('get-keystroke-data'),

  // ─── Window control
  minimize: () => ipcRenderer.invoke('window-minimize'),
  hideToTray: () => ipcRenderer.invoke('window-hide'),

  // ─── Event listeners
  onKeystrokeLive: (callback: (count: number) => void) => {
    ipcRenderer.on('keystroke-live', (_, count) => callback(count));
  },
  onActiveWindow: (callback: (info: any) => void) => {
    ipcRenderer.on('active-window-update', (_, info) => callback(info));
  },
  onNetworkSpeed: (callback: (speed: number | null) => void) => {
    ipcRenderer.on('network-speed-update', (_, speed) => callback(speed));
  },
  onTrayClockOut: (callback: () => void) => {
    ipcRenderer.on('tray-clock-out', () => callback());
  },
  onSystemSuspend: (callback: () => void) => {
    ipcRenderer.on('system-suspend', () => callback());
  },
  onSystemResume: (callback: () => void) => {
    ipcRenderer.on('system-resume', () => callback());
  },
    onAppBeforeQuit: (callback: () => void) => {
    ipcRenderer.on('app-before-quit', () => callback());
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('keystroke-live');
    ipcRenderer.removeAllListeners('active-window-update');
    ipcRenderer.removeAllListeners('network-speed-update');
    ipcRenderer.removeAllListeners('tray-clock-out');
    ipcRenderer.removeAllListeners('system-suspend');
    ipcRenderer.removeAllListeners('system-resume');
  },
});