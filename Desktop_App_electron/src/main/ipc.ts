import { ipcMain, BrowserWindow, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { authService } from './services/auth.service';
import { sessionService } from './services/session.service';
import { trackingService } from './services/tracking.service';
import { activityTracker } from './system/activity';
import { getDeviceInfo } from './system/metrics';
import { getNetworkInfo, getGeoInfo, getNetworkSpeed } from './system/network';
import { createLoginWindow, createDashboardWindow, setMainWindow } from './window';
import { isUpdateDownloaded } from './main';
import { apiService } from './services/api.service';

// ── Helper: wrap any API call and handle 401 gracefully ──
async function safeApi<T>(
  call: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await call();
  } catch {
    return fallback;
  }
}

export function registerIpcHandlers(): void {

  // ── Auth ─────────────────────────────────────────────
  ipcMain.handle('auth:login', async (_event, email: string, password: string) => {
    return authService.login(email, password);
  });

  ipcMain.handle('auth:logout', () => {
    activityTracker.stop();
    trackingService.stop();
    authService.logout();
    sessionService.clearState();
    return { success: true };
  });

  ipcMain.handle('auth:changeMyPassword', async (_event, currentPassword: string, newPassword: string) => {
    const token = authService.getToken();
    if (!token) return { ok: false, status: 401, data: { detail: 'Not authenticated' } };
    return safeApi(
      () => apiService.post('/employees/me/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      }, token),
      { ok: false, status: 0, data: { detail: 'Request failed' } }
    );
  });

  ipcMain.handle('auth:getEmployee', () => {
    return authService.getEmployee();
  });

  // ── Window navigation ─────────────────────────────────
  ipcMain.handle('nav:showDashboard', (event) => {
    const loginWin = BrowserWindow.fromWebContents(event.sender);
    const dashWin  = createDashboardWindow();
    setMainWindow(dashWin);
    if (loginWin) {
      (loginWin as any)._allowClose = true;
      loginWin.close();
    }
    return { success: true };
  });

  ipcMain.handle('nav:showLogin', () => {
    activityTracker.stop();
    trackingService.stop();
    authService.logout();
    sessionService.clearState();

    // Close all existing windows (mark as allowed to close, bypassing tray-hide)
    BrowserWindow.getAllWindows().forEach(w => {
      (w as any)._allowClose = true;
      w.close();
    });

    const win = createLoginWindow();
    setMainWindow(win);
    return { success: true };
  });

  ipcMain.handle('nav:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('nav:close', (event) => {
    // Hide to tray — do NOT close/quit
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.hide();
  });

  // ── Manager assign ────────────────────────────────────
  ipcMain.handle('admin:assignManager', async (_event, empId: string, managerId: string) => {
    const token = authService.getToken();
    if (!token) return { ok: false };
    return safeApi(
      () => apiService.patch(`/employees/${empId}`, { manager_id: managerId }, token),
      { ok: false, status: 0, data: {} }
    );
  });

  ipcMain.handle('admin:listByRole', async (_event, role: string, params: Record<string,string> = {}) => {
    const token = authService.getToken();
    if (!token) return { ok: false, data: [] };
    return safeApi(
      () => apiService.get('/employees', token, { ...params, role }),
      { ok: false, status: 0, data: [] }
    );
  });

  // ── Session ───────────────────────────────────────────
  ipcMain.handle('session:clockIn', async () => {
    const [geo, deviceInfo, netInfo, netSpeed] = await Promise.all([
      getGeoInfo(),
      Promise.resolve(getDeviceInfo()),
      Promise.resolve(getNetworkInfo()),
      getNetworkSpeed(),
    ]);

    const clockInResult = await sessionService.clockIn({
      ip_address:          geo.ip || netInfo.ip_address,
      latitude:            geo.latitude,
      longitude:           geo.longitude,
      city:                geo.city,
      country:             geo.country,
      location:            geo.location,
      network_speed_start: netSpeed.download,
      device_id:           deviceInfo.device_id,
    });

    if (!clockInResult.success || !clockInResult.session) return clockInResult;

    const sessionId = clockInResult.session.session_id;
    Promise.all([
      sessionService.saveDeviceInfo(sessionId, {
        device_id: deviceInfo.device_id, device_name: deviceInfo.device_name,
        os: deviceInfo.os, cpu: deviceInfo.cpu, ram: deviceInfo.ram,
        storage_total: deviceInfo.storage_total, storage_free: deviceInfo.storage_free,
      }),
      sessionService.saveNetworkInfo(sessionId, {
        ip_address: netInfo.ip_address, connection_type: netInfo.connection_type,
        ssid: netInfo.ssid, mac_address: netInfo.mac_address,
      }),
    ]).catch(() => {});

    activityTracker.start();
    trackingService.start();

    // Save initial network speed to network_speed_logs immediately
    if (netSpeed.download !== undefined) {
      const token = authService.getToken();
      if (token) {
        apiService.post('/tracking/network-speed', {
          session_id: clockInResult.session!.session_id,
          download_speed: netSpeed.download,
          upload_speed: netSpeed.upload,
          ping: netSpeed.ping,
          timestamp: new Date().toISOString(),
        }, token).catch(() => {});
      }
    }

    return { ...clockInResult, deviceInfo, netInfo, geo, netSpeed };
  });

  ipcMain.handle('session:clockOut', async () => {
    activityTracker.stop();
    trackingService.stop();
    const totals = activityTracker.getTotals();
    return sessionService.clockOut(totals.active, totals.idle);
  });

  // ── KEY FIX: session:getActive ────────────────────────
  // This is called by the renderer on boot. Previously it was clocking out
  // orphan sessions (from a crashed/killed app) unconditionally, which meant
  // reopening the app always showed "not clocked in" even if the user had an
  // active session.
  //
  // NEW BEHAVIOR:
  // - If the main process already has _clockInTime set → session is live, return it
  // - If the main process does NOT have _clockInTime (app was restarted/killed):
  //     → The session IS orphaned from the previous process run
  //     → Clock it out with saved active/idle from DB + gap since last heartbeat
  //     → This correctly handles "app was killed while clocked in"
  // - If no session at all → return null
  ipcMain.handle('session:getActive', async () => {
    // Step 1: Check what the server says
    const session = await sessionService.fetchActiveSession();

    if (!session) {
      // No active session on server at all
      return null;
    }

    // Step 2: Does our main process already have this session live?
    const existingClockInTime = sessionService.getClockInTime();

    if (existingClockInTime) {
      // Session is actively being tracked in this process — all good
      console.log('[IPC] session:getActive → live session, returning normally.');
      return session;
    }

    // Step 3: No clock-in time in process — app was restarted or killed
    // This is an orphan session from a previous process run.
    // Clock it out cleanly.
    console.log('[IPC] Orphan session detected (app restarted) — clocking out:', session.session_id);

    try {
      activityTracker.stop();
      trackingService.stop();

      let activeTime = 0;
      let idleTime   = 0;

      if (session.clock_in) {
        const clockInStr = String(session.clock_in);
        const clockInISO = clockInStr.endsWith('Z') || clockInStr.includes('+')
          ? clockInStr : clockInStr + 'Z';
        const clockInMs = new Date(clockInISO).getTime();
        const nowMs     = Date.now();

        // Use last_heartbeat to find how long the previous app instance was running
        let lastActiveMs = nowMs;
        if ((session as any).last_heartbeat) {
          const hbStr = String((session as any).last_heartbeat);
          const hbISO = hbStr.endsWith('Z') || hbStr.includes('+')
            ? hbStr : hbStr + 'Z';
          lastActiveMs = new Date(hbISO).getTime();
        }

        const timeSinceHeartbeat = Math.max(0, Math.floor((nowMs - lastActiveMs) / 1000));

        // Use already-saved active/idle from DB + add gap as idle
        const savedActive = (session as any).total_active_time || 0;
        const savedIdle   = (session as any).total_idle_time   || 0;

        if (savedActive > 0 || savedIdle > 0) {
          activeTime = savedActive;
          idleTime   = savedIdle + timeSinceHeartbeat;
          console.log(`[IPC] Using saved DB data — active: ${activeTime}s, idle: ${idleTime}s, gap: ${timeSinceHeartbeat}s`);
        } else {
          activeTime = Math.max(0, Math.floor((lastActiveMs - clockInMs) / 1000));
          idleTime   = timeSinceHeartbeat;
          console.log(`[IPC] Using timestamps — active: ${activeTime}s, idle: ${idleTime}s`);
        }
      }

      await sessionService.clockOut(activeTime, idleTime);
      console.log('[IPC] ✅ Orphan session clocked out — active:', activeTime, 'idle:', idleTime);
    } catch (err) {
      console.error('[IPC] Failed to clock out orphan session:', err);
      // Try direct API call as fallback
      try {
        const token = authService.getToken();
        if (token && session) {
          await apiService.post('/sessions/clock-out', {
            session_id:        session.session_id,
            total_active_time: (session as any).total_active_time || 0,
            total_idle_time:   (session as any).total_idle_time   || 0,
          }, token);
        }
      } catch { /* ignore */ }
    }

    return null;
  });

  ipcMain.handle('session:getMySessions', async (_e, limit = 200) => {
    return sessionService.fetchMySessions(limit);
  });

  ipcMain.handle('session:getClockInTime', () => sessionService.getClockInTime());
  ipcMain.handle('session:isClocked',      () => sessionService.isClocked());

  ipcMain.handle('session:heartbeat', async () => {
    const token = authService.getToken();
    if (!token || !sessionService.isClocked()) return;
    try {
      await apiService.post('/sessions/heartbeat', {}, token);
    } catch { /* ignore */ }
  });

  // ── Admin: Employees ──────────────────────────────────
  ipcMain.handle('admin:listEmployees', async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken();
    if (!token) return { ok: false, data: [] };
    const r = await safeApi(() => apiService.get('/employees', token, params), { ok: false, status: 0, data: [] });
    if ((r as any).status === 401) { authService.handleExpiredToken(); return { ok: false, data: [] }; }
    return r;
  });

  ipcMain.handle('admin:createEmployee', async (_event, payload: Record<string, unknown>) => {
    const token = authService.getToken();
    if (!token) return { ok: false };
    return safeApi(() => apiService.post('/employees', payload, token), { ok: false, status: 0, data: {} });
  });

  ipcMain.handle('admin:updateEmployee', async (_event, id: string, payload: Record<string, unknown>) => {
    const token = authService.getToken();
    if (!token) return { ok: false };
    return safeApi(() => apiService.patch(`/employees/${id}`, payload, token), { ok: false, status: 0, data: {} });
  });

  ipcMain.handle('admin:deactivateEmployee', async (_event, id: string) => {
    const token = authService.getToken();
    if (!token) return { ok: false };
    return safeApi(() => apiService.delete(`/employees/${id}`, token), { ok: false, status: 0, data: {} });
  });

  ipcMain.handle('admin:resetPassword', async (_event, id: string, newPassword: string) => {
    const token = authService.getToken();
    if (!token) return { ok: false };
    return safeApi(
      () => apiService.post(`/employees/${id}/reset-password`, { new_password: newPassword }, token),
      { ok: false, status: 0, data: {} }
    );
  });

  ipcMain.handle('admin:reactivateEmployee', async (_event, id: string) => {
    const token = authService.getToken();
    if (!token) return { ok: false };
    return safeApi(() => apiService.patch(`/employees/${id}/reactivate`, {}, token), { ok: false, status: 0, data: {} });
  });

  // ── Admin: Sessions ───────────────────────────────────
  ipcMain.handle('admin:getSessions', async (_event, params: Record<string, string> = {}) => {
    const token    = authService.getToken();
    const employee = authService.getEmployee();
    if (!token) return { ok: false, data: [] };

    const ADMIN_ROLES = ['super_admin', 'hr', 'manager', 'admin'];

    if (employee?.role && ADMIN_ROLES.includes(employee.role)) {
      const result = await safeApi(
        () => apiService.get('/admin/sessions', token, params),
        { ok: false, status: 0, data: [] }
      );
      if ((result as any).status === 401) {
        authService.handleExpiredToken();
        return { ok: false, data: [] };
      }
      return result;
    } else {
      const p: Record<string, string> = {};
      if (params.limit) p.limit = params.limit;
      return safeApi(() => apiService.get('/sessions/my', token, p), { ok: false, status: 0, data: [] });
    }
  });

  // ── Admin: Device Info ────────────────────────────────
  ipcMain.handle('admin:getDeviceInfo', async (_event, params: Record<string, string> = {}) => {
    const token    = authService.getToken();
    const employee = authService.getEmployee();
    if (!token) return { ok: false, data: [] };
    if (employee?.role && ['super_admin', 'hr', 'manager', 'admin'].includes(employee.role)) {
      return safeApi(() => apiService.get('/admin/device-info', token, params), { ok: false, status: 0, data: [] });
    } else {
      const sessionId = params.session_id;
      if (!sessionId) return { ok: true, status: 200, data: [] };
      return safeApi(() => apiService.get(`/sessions/${sessionId}/device-info`, token), { ok: false, status: 0, data: [] });
    }
  });

  // ── Admin: Network Info ───────────────────────────────
  ipcMain.handle('admin:getNetworkInfo', async (_event, params: Record<string, string> = {}) => {
    const token    = authService.getToken();
    const employee = authService.getEmployee();
    if (!token) return { ok: false, data: [] };
    if (employee?.role && ['super_admin', 'hr', 'manager', 'admin'].includes(employee.role)) {
      return safeApi(() => apiService.get('/admin/network-info', token, params), { ok: false, status: 0, data: [] });
    } else {
      const sessionId = params.session_id;
      if (!sessionId) return { ok: true, status: 200, data: [] };
      return safeApi(() => apiService.get(`/sessions/${sessionId}/network-info`, token), { ok: false, status: 0, data: [] });
    }
  });

  // ── Admin: Activity reports ───────────────────────────
  ipcMain.handle('admin:getActivity', async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken(); if (!token) return { ok: false, data: [] };
    const ADMIN_ROLES = ['super_admin', 'hr', 'manager', 'admin'];
    const ep = (authService.getEmployee()?.role && ADMIN_ROLES.includes(authService.getEmployee()!.role)) ? '/admin/activity' : '/tracking/activity';
    return safeApi(() => apiService.get(ep, token, params), { ok: false, status: 0, data: [] });
  });

  ipcMain.handle('admin:getWebsite', async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken(); if (!token) return { ok: false, data: [] };
    const ADMIN_ROLES = ['super_admin', 'hr', 'manager', 'admin'];
    const ep = (authService.getEmployee()?.role && ADMIN_ROLES.includes(authService.getEmployee()!.role)) ? '/admin/website' : '/tracking/website';
    return safeApi(() => apiService.get(ep, token, params), { ok: false, status: 0, data: [] });
  });

  ipcMain.handle('admin:getKeystrokes', async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken(); if (!token) return { ok: false, data: [] };
    const ADMIN_ROLES = ['super_admin', 'hr', 'manager', 'admin'];
    const ep = (authService.getEmployee()?.role && ADMIN_ROLES.includes(authService.getEmployee()!.role)) ? '/admin/keystrokes' : '/tracking/keystrokes';
    return safeApi(() => apiService.get(ep, token, params), { ok: false, status: 0, data: [] });
  });

  ipcMain.handle('admin:getSystemMetrics', async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken(); if (!token) return { ok: false, data: [] };
    const ADMIN_ROLES = ['super_admin', 'hr', 'manager', 'admin'];
    const ep = (authService.getEmployee()?.role && ADMIN_ROLES.includes(authService.getEmployee()!.role)) ? '/admin/system-metrics' : '/tracking/system-metrics';
    return safeApi(() => apiService.get(ep, token, params), { ok: false, status: 0, data: [] });
  });

  ipcMain.handle('admin:getNetworkSpeed', async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken(); if (!token) return { ok: false, data: [] };
    const ADMIN_ROLES = ['super_admin', 'hr', 'manager', 'admin'];
    const ep = (authService.getEmployee()?.role && ADMIN_ROLES.includes(authService.getEmployee()!.role)) ? '/admin/network-speed' : '/tracking/network-speed';
    return safeApi(() => apiService.get(ep, token, params), { ok: false, status: 0, data: [] });
  });

  ipcMain.handle('admin:getSummary', async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken(); if (!token) return { ok: false, data: [] };
    return safeApi(() => apiService.get('/admin/summary', token, params), { ok: false, status: 0, data: [] });
  });

  ipcMain.handle('admin:getEmployeeSummary', async (_event, employeeId: string, params: Record<string, string> = {}) => {
    const token = authService.getToken(); if (!token) return { ok: false };
    return safeApi(() => apiService.get(`/admin/summary/${employeeId}`, token, params), { ok: false, status: 0, data: {} });
  });

  // ── Tracking ──────────────────────────────────────────
  ipcMain.handle('tracking:getStats', () => {
    const totals = activityTracker.getTotals();
    return { active: totals.active, idle: totals.idle, keystrokes: trackingService.getKeystrokeCount(), lastSpeed: trackingService.getLastSpeed() };
  });

  ipcMain.handle('tracking:reportKeystrokes', async (_event, count: number) => {
    await trackingService.incrementKeystrokes(count);
    return { ok: true };
  });

  ipcMain.handle('tracking:signalActivity', () => {
    activityTracker.signalActivity();
    return { ok: true };
  });

  // ── System info ───────────────────────────────────────
  ipcMain.handle('system:getDeviceInfo',  () => getDeviceInfo());
  ipcMain.handle('system:getNetworkInfo', () => getNetworkInfo());

  ipcMain.handle('system:getAppVersion', () => {
    const fs   = require('fs');
    const path = require('path');

    const changelogPath = app.isPackaged
      ? path.join(process.resourcesPath, 'changelog.json')
      : path.join(app.getAppPath(), 'changelog.json');

    let history = [];
    try {
      const raw = fs.readFileSync(changelogPath, 'utf8');
      history = JSON.parse(raw).history || [];
    } catch (e) {
      console.error('[Version] Could not read changelog.json:', e);
    }

    return {
      current:          app.getVersion(),
      history,
      updateDownloaded: isUpdateDownloaded(),
      isPackaged:       app.isPackaged,
    };
  });

  ipcMain.handle('system:downloadUpdate', async () => {
    if (!app.isPackaged) {
      return { ok: false, error: 'Auto-update only works in production builds' };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Download failed' };
    }
  });

  ipcMain.handle('system:installUpdate', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('system:checkForUpdates', async () => {
    if (!app.isPackaged) {
      return { ok: false, error: 'Dev mode' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, hasUpdate: !!result?.updateInfo };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  });
}