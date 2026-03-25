import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  changeMyPassword: (current: string, newPw: string) => ipcRenderer.invoke('auth:changeMyPassword', current, newPw),
  // ── Auth ────────────────────────────────────────────
  login:        (email: string, pw: string) => ipcRenderer.invoke('auth:login', email, pw),
  logout:       ()                          => ipcRenderer.invoke('auth:logout'),
  getEmployee:  ()                          => ipcRenderer.invoke('auth:getEmployee'),

  // ── Session ─────────────────────────────────────────
  clockIn:          ()              => ipcRenderer.invoke('session:clockIn'),
  clockOut:         ()              => ipcRenderer.invoke('session:clockOut'),
  getActiveSession: ()              => ipcRenderer.invoke('session:getActive'),
  getMySessions:    (limit: number) => ipcRenderer.invoke('session:getMySessions', limit),
  getClockInTime:   ()              => ipcRenderer.invoke('session:getClockInTime'),
  isClocked:        ()              => ipcRenderer.invoke('session:isClocked'),

  // ── Tracking ────────────────────────────────────────
  getTrackingStats:  ()              => ipcRenderer.invoke('tracking:getStats'),
  reportKeystrokes:  (n: number)     => ipcRenderer.invoke('tracking:reportKeystrokes', n),
  signalActivity:    ()              => ipcRenderer.invoke('tracking:signalActivity'),

  // ── Admin: Employees ─────────────────────────────────
  listEmployees:      (p: Record<string,string>)              => ipcRenderer.invoke('admin:listEmployees', p),
  createEmployee:     (d: Record<string,unknown>)             => ipcRenderer.invoke('admin:createEmployee', d),
  updateEmployee:     (id: string, d: Record<string,unknown>) => ipcRenderer.invoke('admin:updateEmployee', id, d),
  deactivateEmployee: (id: string)                            => ipcRenderer.invoke('admin:deactivateEmployee', id),
  reactivateEmployee: (id: string)                            => ipcRenderer.invoke('admin:reactivateEmployee', id),
  resetPassword:      (id: string, pw: string)                => ipcRenderer.invoke('admin:resetPassword', id, pw),

  // ── Admin: Sessions ───────────────────────────────────
  getAdminSessions:       (p: Record<string,string>) => ipcRenderer.invoke('admin:getSessions', p),

  // ── Admin: Activity / tracking data ──────────────────
  getAdminActivity:       (p: Record<string,string>) => ipcRenderer.invoke('admin:getActivity', p),
  getAdminWebsite:        (p: Record<string,string>) => ipcRenderer.invoke('admin:getWebsite', p),
  getAdminKeystrokes:     (p: Record<string,string>) => ipcRenderer.invoke('admin:getKeystrokes', p),
  getAdminSystemMetrics:  (p: Record<string,string>) => ipcRenderer.invoke('admin:getSystemMetrics', p),
  getAdminNetworkSpeed:   (p: Record<string,string>) => ipcRenderer.invoke('admin:getNetworkSpeed', p),
  getAdminDeviceInfo:     (p: Record<string,string>) => ipcRenderer.invoke('admin:getDeviceInfo', p),
  getAdminNetworkInfo:    (p: Record<string,string>) => ipcRenderer.invoke('admin:getNetworkInfo', p),
  getAdminSummary:        (p: Record<string,string>) => ipcRenderer.invoke('admin:getSummary', p),
  getEmployeeSummary:     (id: string, p: Record<string,string>) => ipcRenderer.invoke('admin:getEmployeeSummary', id, p),

  // ── Navigation ───────────────────────────────────────
  showDashboard: () => ipcRenderer.invoke('nav:showDashboard'),
  showLogin:     () => ipcRenderer.invoke('nav:showLogin'),
  minimize:      () => ipcRenderer.invoke('nav:minimize'),
  closeWindow:   () => ipcRenderer.invoke('nav:close'),

  // ── System ───────────────────────────────────────────
  getDeviceInfo:  () => ipcRenderer.invoke('system:getDeviceInfo'),
  getNetworkInfo: () => ipcRenderer.invoke('system:getNetworkInfo'),

  // ── Admin: Assign manager ─────────────────────────────────
  assignManager: (empId: string, managerId: string) => ipcRenderer.invoke('admin:assignManager', empId, managerId),

  // ── Admin: list by role (scoped) ─────────────────────────
  listByRole: (role: string, p: Record<string,string>) => ipcRenderer.invoke('admin:listByRole', role, p),
});