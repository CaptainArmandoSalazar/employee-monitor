import { ipcMain, BrowserWindow, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { authService } from './services/auth.service';
import { sessionService } from './services/session.service';
import { trackingService } from './services/tracking.service';
import { activityTracker } from './system/activity';
import { getDeviceInfo } from './system/metrics';
import { getNetworkInfo, getGeoInfo, getNetworkSpeed } from './system/network';
import { createLoginWindow, createDashboardWindow, closeAllWindows, setMainWindow } from './window';
import { isUpdateDownloaded, getUpdateAvailableVersion, setUpdateAvailableVersion, setUpdateDownloaded } from './main';
import { apiService } from './services/api.service';

function compareVersions(current: string, target: string): number {
  const toParts = (value: string): number[] => {
    const clean = String(value || '0').replace(/^[vV]/, '').replace(/[^0-9.]/g, '');
    const parts = clean.split('.').filter(Boolean).map(p => Number.parseInt(p, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return parts;
  };

  const a = toParts(current);
  const b = toParts(target);

  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }

  return 0;
}

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer!);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer!);
        reject(error);
      }
    );
  });
}

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

// ── Permission cache (filled by perm:getMine, refreshed by the dashboard) ──
let _myPerms = new Set<string>();

async function refreshMyPermissions(): Promise<{ role: string; is_super_admin: boolean; permissions: string[] } | null> {
  const token = authService.getToken();
  if (!token) { _myPerms = new Set<string>(); return null; }
  try {
    const res = await apiService.get<{ role: string; is_super_admin: boolean; permissions: string[] }>('/permissions/me', token);
    if (res.ok && res.data && Array.isArray(res.data.permissions)) {
      _myPerms = new Set<string>(res.data.permissions);
      return res.data;
    }
    if (res.status === 401) authService.handleExpiredToken();
  } catch { /* offline: keep the last known permissions */ }
  return null;
}

const hasPerm = (key: string): boolean => _myPerms.has(key);

/** With the permission -> admin route (other people's data in scope). Without it -> own data only. */
function registerScopedGet(channel: string, permKey: string, adminPath: string, ownPath: string): void {
  ipcMain.handle(channel, async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken();
    if (!token) return { ok: false, data: [] };
    const endpoint = hasPerm(permKey) ? adminPath : ownPath;
    const result = await safeApi(
      () => apiService.get(endpoint, token, params),
      { ok: false, status: 0, data: [] }
    );
    if ((result as any).status === 401) { authService.handleExpiredToken(); return { ok: false, data: [] }; }
    return result;
  });
}

// Clock the user out (if clocked in) before the login is cleared
async function clockOutIfNeeded(): Promise<void> {
  if (!sessionService.isClocked()) return;
  activityTracker.stop();
  trackingService.stop();
  const totals = activityTracker.getTotals();
  const existing = sessionService.getActiveSession() as any;
  await sessionService.clockOut(
    Math.max(existing?.total_active_time || 0, totals.active),
    Math.max(existing?.total_idle_time || 0, totals.idle)
  );
}

// Resume a session that is still open on the server after an app restart.
// The tracker starts from the saved totals, so it is the only source of truth.
function resumeAndStartTracking(session: any): void {
  sessionService.resumeSession(session);
  activityTracker.start({
    active: session.total_active_time || 0,
    idle:   session.total_idle_time   || 0,
  });
  trackingService.start();
}

export function registerIpcHandlers(): void {

  // ── Auth ─────────────────────────────────────────────
  ipcMain.handle('auth:login', async (_event, email: string, password: string) => {
    return authService.login(email, password);
  });

  ipcMain.handle('auth:logout', async () => {
    await clockOutIfNeeded();        // must happen while the login token still exists
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
ipcMain.handle('auth:getEmployee', async () => {
  const employee = authService.getEmployee();
  if (!employee) return null;
  // Validate token is still good with backend
  try {
    const verified = await authService.getProfile();
    return verified || null;
  } catch {
    return employee; // Return cached if network unavailable (offline support)
  }
});

  // ── Window navigation ─────────────────────────────────
  ipcMain.handle('nav:showDashboard', (event) => {
    const loginWin = BrowserWindow.fromWebContents(event.sender);
    const dashWin = createDashboardWindow();
    setMainWindow(dashWin);
    if (loginWin) loginWin.close();
    return { success: true };
  });

  ipcMain.handle('nav:showLogin', async () => {
    await clockOutIfNeeded();
    activityTracker.stop();
    trackingService.stop();
    authService.logout();
    sessionService.clearState();

    // Mark all windows as allowed to close (bypass tray-hide)
    BrowserWindow.getAllWindows().forEach(w => {
      (w as any)._allowClose = true;
      w.close();
    });

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

  ipcMain.handle('admin:listByRole', async (_event, role: string, params: Record<string, string> = {}) => {
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
      ip_address: geo.ip || netInfo.ip_address,
      latitude: geo.latitude,
      longitude: geo.longitude,
      city: geo.city,
      country: geo.country,
      location: geo.location,
      network_speed_start: netSpeed.download,
      device_id: deviceInfo.device_id,
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
    ]).catch(() => { });

    activityTracker.start();
    trackingService.start();

    // FIX: Also save initial network speed to network_speed_logs table immediately
    // so it shows up in the session's network speed history even for short sessions
// Save initial network speed + CPU/memory at clock-in
if (netSpeed.download !== undefined) {
  const token = authService.getToken();
  if (token) {
    const { getCpuUsage, getMemoryUsage } = await import('./system/metrics');
    const [cpu, mem] = await Promise.all([
      getCpuUsage(),
      Promise.resolve(getMemoryUsage()),
    ]);

    const ts = new Date().toISOString();
    const sid = clockInResult.session!.session_id;

    Promise.all([
      apiService.post('/tracking/network-speed', {
        session_id:     sid,
        download_speed: netSpeed.download,
        upload_speed:   netSpeed.upload,
        ping:           netSpeed.ping,
        timestamp:      ts,
      }, token),
      apiService.post('/tracking/system-metrics', {
        session_id:   sid,
        cpu_usage:    cpu,
        memory_usage: mem,
        timestamp:    ts,  // ← same timestamp as network speed
      }, token),
    ]).catch(() => { });
  }
}

    return { ...clockInResult, deviceInfo, netInfo, geo, netSpeed };
  });

  ipcMain.handle('session:clockOut', async () => {
    activityTracker.stop();
    trackingService.stop();
    // The tracker already starts from the saved totals, so never add them a second time
    const totals = activityTracker.getTotals();
    const existingSession = sessionService.getActiveSession() as any;
    return sessionService.clockOut(
      Math.max(existingSession?.total_active_time || 0, totals.active),
      Math.max(existingSession?.total_idle_time   || 0, totals.idle)
    );
  });
  ipcMain.handle('session:getActive', async () => {
    const session = await sessionService.fetchActiveSession();

if (session) {
      const existingClockInTime = sessionService.getClockInTime();

      if (!existingClockInTime) {
        // Only treat as orphan if the session is genuinely stale (no heartbeat for 10+ minutes)
        const lastHb = (session as any).last_heartbeat;
        const refTime = lastHb || session.clock_in;

        if (refTime) {
          const refStr = String(refTime);
          const refISO = refStr.endsWith('Z') || refStr.includes('+') ? refStr : refStr + 'Z';
          const gapMinutes = (Date.now() - new Date(refISO).getTime()) / 1000 / 60;

          if (gapMinutes < 10) {
            console.log(`[IPC] Session gap is only ${gapMinutes.toFixed(1)}min — resuming, not clocking out`);
            resumeAndStartTracking(session);
            return session;
          }
        }

        console.log('[IPC] Orphan session found on restart — clocking out:', session.session_id);
        try {
          activityTracker.stop();
          trackingService.stop();

          let activeTime = 0;
          let idleTime = 0;

          if (session.clock_in) {
            const clockInStr = String(session.clock_in);
            const clockInISO = clockInStr.endsWith('Z') || clockInStr.includes('+')
              ? clockInStr : clockInStr + 'Z';
            const clockInMs = new Date(clockInISO).getTime();
            const nowMs = Date.now();

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
            const savedIdle = (session as any).total_idle_time || 0;

            if (savedActive > 0 || savedIdle > 0) {
              // Session had saved data — add gap since last heartbeat as idle
              activeTime = savedActive;
              idleTime = savedIdle + timeSinceHeartbeat;
              console.log(`[IPC] Using saved data — active: ${activeTime}s, idle: ${idleTime}s, gap: ${timeSinceHeartbeat}s`);
            } else {
              // No saved data — calculate from timestamps
              activeTime = Math.max(0, Math.floor((lastActiveMs - clockInMs) / 1000));
              idleTime = timeSinceHeartbeat;
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
                session_id: session.session_id,
                total_active_time: (session as any).total_active_time || 0,
                total_idle_time: (session as any).total_idle_time || 0,
              }, token);
            }
          } catch { /* ignore */ }
        }
        return null;
      }
    }
    // Same app run and tracking is already going: never restart or reset it
    if (session && !trackingService.isStarted()) {
      resumeAndStartTracking(session);
    }
    return session;
  });
  ipcMain.handle('session:getMySessions', async (_e, limit = 200) => {
    return sessionService.fetchMySessions(limit);
  });

  ipcMain.handle('session:getClockInTime', () => sessionService.getClockInTime());
  ipcMain.handle('session:isClocked', () => sessionService.isClocked());
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
    // ── Admin: data (permission driven) ───────────────────
  registerScopedGet('admin:getSessions',      'session.view',   '/admin/sessions',       '/sessions/my');
  registerScopedGet('admin:getActivity',      'activity.view',  '/admin/activity',       '/tracking/activity');
  registerScopedGet('admin:getWebsite',       'website.view',   '/admin/website',        '/tracking/website');
  registerScopedGet('admin:getKeystrokes',    'keystroke.view', '/admin/keystrokes',     '/tracking/keystrokes');
  registerScopedGet('admin:getKeystrokeTotals', 'keystroke.view', '/admin/keystroke-totals', '/tracking/keystroke-totals');
  registerScopedGet('admin:getSystemMetrics', 'metrics.view',   '/admin/system-metrics', '/tracking/system-metrics');
  registerScopedGet('admin:getNetworkSpeed',  'metrics.view',   '/admin/network-speed',  '/tracking/network-speed');

  ipcMain.handle('admin:getDeviceInfo', async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken();
    if (!token) return { ok: false, data: [] };
    if (hasPerm('device.view')) {
      return safeApi(() => apiService.get('/admin/device-info', token, params), { ok: false, status: 0, data: [] });
    }
    const sessionId = params.session_id;
    if (!sessionId) return { ok: true, status: 200, data: [] };
    return safeApi(() => apiService.get(`/sessions/${sessionId}/device-info`, token), { ok: false, status: 0, data: [] });
  });

  ipcMain.handle('admin:getNetworkInfo', async (_event, params: Record<string, string> = {}) => {
    const token = authService.getToken();
    if (!token) return { ok: false, data: [] };
    if (hasPerm('device.view')) {
      return safeApi(() => apiService.get('/admin/network-info', token, params), { ok: false, status: 0, data: [] });
    }
    const sessionId = params.session_id;
    if (!sessionId) return { ok: true, status: 200, data: [] };
    return safeApi(() => apiService.get(`/sessions/${sessionId}/network-info`, token), { ok: false, status: 0, data: [] });
  });

  // ── Permissions ───────────────────────────────────────
  ipcMain.handle('perm:getMine', async () => refreshMyPermissions());

  ipcMain.handle('perm:getCatalog', async () => {
    const token = authService.getToken();
    if (!token) return { ok: false, data: [] };
    return safeApi(() => apiService.get('/permissions/catalog', token), { ok: false, status: 0, data: [] });
  });

  ipcMain.handle('perm:getRoles', async () => {
    const token = authService.getToken();
    if (!token) return { ok: false, data: {} };
    return safeApi(() => apiService.get('/permissions/roles', token), { ok: false, status: 0, data: {} });
  });

  ipcMain.handle('perm:setRole', async (_event, role: string, permissions: string[]) => {
    const token = authService.getToken();
    if (!token) return { ok: false };
    return safeApi(
      () => apiService.patch(`/permissions/roles/${encodeURIComponent(role)}`, { permissions }, token),
      { ok: false, status: 0, data: {} }
    );
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
  ipcMain.handle('system:getDeviceInfo', () => getDeviceInfo());
  ipcMain.handle('system:getNetworkInfo', () => getNetworkInfo());
  ipcMain.handle('system:getAppVersion', () => {
    const { app } = require('electron');
    const fs   = require('fs');
    const path = require('path');

    const candidatePaths = [
      // extraResources puts it here — works in all packaged formats
      path.join(process.resourcesPath, 'changelog.json'),
      // fallback: inside asar (works in dev + some packaged configs)
      path.join(app.getAppPath(), 'changelog.json'),
      // another fallback
      path.join(__dirname, '..', '..', '..', 'changelog.json'),
      path.join(__dirname, '..', '..', 'changelog.json'),
    ];

    let history: any[] = [];

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf8');
          history = JSON.parse(raw).history || [];
          console.log('[Version] changelog loaded from:', p, '| entries:', history.length);
          break;
        }
      } catch (e: any) {
        console.warn('[Version] failed to read:', p, e?.message);
        continue;
      }
    }

    if (!history.length) {
      console.error('[Version] changelog.json not found in any candidate path');
      candidatePaths.forEach(p => console.log('[Version] tried:', p, '→', fs.existsSync(p)));
    }

    return {
      current:                app.getVersion(),
      history,
      updateDownloaded:       isUpdateDownloaded(),
      updateAvailableVersion: getUpdateAvailableVersion(),
      isPackaged:             app.isPackaged,
    };
  });
  ipcMain.handle('system:downloadUpdate', async () => {
    if (!app.isPackaged) {
      return { ok: false, error: 'Auto-update only works in production builds' };
    }
    try {
      setUpdateDownloaded(false);
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e: any) {
      setUpdateDownloaded(false);
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
      const result = await timeoutPromise(
        autoUpdater.checkForUpdates(),
        15000,
        'Update check timed out'
      );
      const updateInfo = result?.updateInfo || null;
      const currentVersion = String(app.getVersion()).replace(/^v/i, '');
      const remoteVersion = String(updateInfo?.version || '').replace(/^v/i, '');
      const hasUpdate = !!updateInfo && compareVersions(currentVersion, remoteVersion) < 0;

      setUpdateAvailableVersion(hasUpdate ? updateInfo.version : null);

      return {
        ok: true,
        hasUpdate,
        version: updateInfo?.version || null,
        currentVersion,
      };
    } catch (e: any) {
      setUpdateAvailableVersion(null);
      return { ok: false, error: e?.message || 'Update check failed' };
    }
  });
}