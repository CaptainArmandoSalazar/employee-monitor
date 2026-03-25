import { ipcMain, BrowserWindow } from 'electron';
import { authService } from './services/auth.service';
import { sessionService } from './services/session.service';
import { trackingService } from './services/tracking.service';
import { activityTracker } from './system/activity';
import { getDeviceInfo } from './system/metrics';
import { getNetworkInfo, getGeoInfo, getNetworkSpeed } from './system/network';
import { createLoginWindow, createDashboardWindow, closeAllWindows, setMainWindow } from './window';
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

  ipcMain.handle('auth:getEmployee', () => {
    return authService.getEmployee();
  });

  // ── Window navigation ─────────────────────────────────
  ipcMain.handle('nav:showDashboard', (event) => {
    const loginWin = BrowserWindow.fromWebContents(event.sender);
    const dashWin  = createDashboardWindow();
    setMainWindow(dashWin);
    if (loginWin) loginWin.close();
    return { success: true };
  });

  ipcMain.handle('nav:showLogin', () => {
    activityTracker.stop();
    trackingService.stop();
    authService.logout();
    sessionService.clearState();
    closeAllWindows();
    const win = createLoginWindow();
    setMainWindow(win);
    return { success: true };
  });

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

  ipcMain.handle('nav:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('nav:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
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

    // FIX: Also save initial network speed to network_speed_logs table immediately
    // so it shows up in the session's network speed history even for short sessions
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

// REPLACE the session:getActive handler entirely:
ipcMain.handle('session:getActive', async () => {
  const session = await sessionService.fetchActiveSession();

  if (session) {
    const existingClockInTime = sessionService.getClockInTime();

    if (!existingClockInTime) {
      console.log('[IPC] Orphan session found on restart — clocking out:', session.session_id);
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

          // ── Use last_heartbeat to find how long app was running ──
          let lastActiveMs = nowMs;
          if ((session as any).last_heartbeat) {
            const hbStr = String((session as any).last_heartbeat);
            const hbISO = hbStr.endsWith('Z') || hbStr.includes('+')
              ? hbStr : hbStr + 'Z';
            lastActiveMs = new Date(hbISO).getTime();
          }

          // Time since last heartbeat = additional idle (app was dead)
          const timeSinceHeartbeat = Math.max(0, Math.floor((nowMs - lastActiveMs) / 1000));

          // ── KEY FIX: use already-saved active/idle from DB + add the gap ──
          // session.total_active_time and total_idle_time were saved periodically
          // during the session by clock-out calls or activity tracking
          const savedActive = (session as any).total_active_time || 0;
          const savedIdle   = (session as any).total_idle_time   || 0;

          if (savedActive > 0 || savedIdle > 0) {
            // Session had saved data — add gap since last heartbeat as idle
            activeTime = savedActive;
            idleTime   = savedIdle + timeSinceHeartbeat;
            console.log(`[IPC] Using saved data — active: ${activeTime}s, idle: ${idleTime}s, gap: ${timeSinceHeartbeat}s`);
          } else {
            // No saved data — calculate from timestamps
            activeTime = Math.max(0, Math.floor((lastActiveMs - clockInMs) / 1000));
            idleTime   = timeSinceHeartbeat;
            console.log(`[IPC] Using timestamps — active: ${activeTime}s, idle: ${idleTime}s`);
          }
        }

        await sessionService.clockOut(activeTime, idleTime);
        console.log('[IPC] Orphan session clocked out — active:', activeTime, 'idle:', idleTime);
      } catch (err) {
        console.error('[IPC] Failed to clock out orphan session:', err);
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
    }
  }

  return session;
});
  ipcMain.handle('session:getMySessions', async (_e, limit = 200) => {
    return sessionService.fetchMySessions(limit);
  });

  ipcMain.handle('session:getClockInTime', () => sessionService.getClockInTime());
  ipcMain.handle('session:isClocked',      () => sessionService.isClocked());
// ADD this handler:
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
  // FIX: Always use /admin/sessions for admin users.
  // The old logic checked authService.getEmployee()?.role which could be null
  // after a session restore, causing it to fall back to /sessions/my incorrectly.
ipcMain.handle('admin:getSessions', async (_event, params: Record<string, string> = {}) => {
    const token    = authService.getToken();
    const employee = authService.getEmployee();
    if (!token) return { ok: false, data: [] };

    const ADMIN_ROLES = ['super_admin', 'hr', 'manager', 'admin'];

    if (employee?.role && ADMIN_ROLES.includes(employee.role)) {
      // Use /admin/sessions which supports employee_id filtering
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
      // Plain employee: can only see own sessions
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
    const ep = (authService.getEmployee()?.role && ADMIN_ROLES.includes(authService.getEmployee()!.role)) ? '/admin/system-matrics' : '/tracking/system-matrics';
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
    // When app is focused, renderer sends keystroke counts here.
    // globalKeyboard.addRendererCount() decides whether to use them
    // (only as fallback if uiohook global hook is not running).
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
}