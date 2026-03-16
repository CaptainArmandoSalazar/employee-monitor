'use strict';
// ─── API Client ───────────────────────────────────────────────────────────────
window.Api = (() => {
  const BASE_URL = 'http://localhost:8000/api/v1';

  let accessToken = null;
  let refreshToken = null;

  // ─── Init from storage
  (async () => {
    try {
      accessToken = await window.electronAPI.storeGet('accessToken');
      refreshToken = await window.electronAPI.storeGet('refreshToken');
    } catch {}
  })();

  // ─── Token refresh
  async function refreshAccessToken() {
    if (!refreshToken) throw new Error('SESSION_EXPIRED');
    try {
      const r = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!r.ok) throw new Error('Refresh failed');
      const d = await r.json();
      accessToken = d.access_token;
      await window.electronAPI.storeSet('accessToken', accessToken);
      return accessToken;
    } catch (e) {
      await clearTokens();
      throw new Error('SESSION_EXPIRED');
    }
  }

  // ─── Fetch wrapper with auto-refresh
  async function apiFetch(endpoint, options = {}) {
    let headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    let r = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    // Auto-refresh on 401
    if (r.status === 401 && refreshToken) {
      try {
        await refreshAccessToken();
        headers['Authorization'] = `Bearer ${accessToken}`;
        r = await fetch(`${BASE_URL}${endpoint}`, {
          ...options,
          headers,
        });
      } catch {
        throw new Error('SESSION_EXPIRED');
      }
    }

    if (!r.ok) {
      const text = await r.text();
      let errMsg = text;
      try {
        const d = JSON.parse(text);
        errMsg = d.detail || d.message || text;
      } catch {}
      throw new Error(errMsg || `API Error: ${r.status}`);
    }

    return r;
  }

  // ─── AUTH
  async function login(email, password) {
    const r = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    accessToken = d.access_token;
    refreshToken = d.refresh_token;
    await window.electronAPI.storeSet('accessToken', accessToken);
    await window.electronAPI.storeSet('refreshToken', refreshToken);
    const user = await getMe();
    return user;
  }

  async function logout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {}
    await clearTokens();
  }

  async function getMe() {
    const r = await apiFetch('/auth/me');
    return await r.json();
  }

  async function isLoggedIn() {
    if (!accessToken) return false;
    try {
      await getMe();
      return true;
    } catch {
      return false;
    }
  }

  async function clearTokens() {
    accessToken = null;
    refreshToken = null;
    await window.electronAPI.storeDelete('accessToken');
    await window.electronAPI.storeDelete('refreshToken');
    await window.electronAPI.storeDelete('cachedUser');
  }
  

  // ─── ATTENDANCE
async function clockIn(lat, lon, deviceId, speedData) {
  // speedData = { download_mbps, upload_mbps, ping_ms } or null
  const r = await apiFetch('/attendance/clock-in', {
    method: 'POST',
    body: JSON.stringify({
      latitude: lat,
      longitude: lon,
      device_id: deviceId,
      download_mbps: speedData?.download_mbps ?? null,
      upload_mbps: speedData?.upload_mbps ?? null,
      ping_ms: speedData?.ping_ms ?? null,
    }),
  });
  return await r.json();
}

async function crashClockOut(reason = 'crash') {
  try {
    const r = await apiFetch('/attendance/clock-out/crash', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return await r.json();
  } catch (e) {
    console.error('Crash clock-out failed:', e.message);
    return null;
  }
}

// NEW: log a single completed idle interval
async function logIdleInterval(idleStart, idleEnd) {
  const durationSeconds = Math.floor((idleEnd - idleStart) / 1000);
  if (durationSeconds < 10) return; // ignore tiny gaps
  const r = await apiFetch('/activity/idle', {
    method: 'POST',
    body: JSON.stringify({
      idle_start: new Date(idleStart).toISOString(),
      idle_end: new Date(idleEnd).toISOString(),
      idle_duration_seconds: durationSeconds,
    }),
  });
  return await r.json();
}

  async function clockOut(lat, lon) {
    const r = await apiFetch('/attendance/clock-out', {
      method: 'POST',
      body: JSON.stringify({
        latitude: lat,
        longitude: lon,
      }),
    });
    return await r.json();
  }

  async function clockStatus() {
    const r = await apiFetch('/attendance/me/status');
    return await r.json();
  }

  // ─── ACTIVITY LOGGING
  async function logActivity(data) {
    const r = await apiFetch('/activity/log', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return await r.json();
  }
  async function listEmployees() {
    const r = await apiFetch('/employees?limit=100');
    return await r.json();
  }

  async function createEmployee(data) {
    const r = await apiFetch('/employees', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return await r.json();
  }

  async function getEmployeeLive(employeeId) {
    const r = await apiFetch(`/employees/${employeeId}/live`);
    return await r.json();
  }

async function getEmployeeToday(employeeId) {
    const r = await apiFetch(`/activity/employee/${employeeId}/today`);
    return await r.json();
  }

  async function logWebsite(data) {
    const r = await apiFetch('/activity/website', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return await r.json();
  }

  async function logKeystrokes(keystrokeData, appName) {
    const r = await apiFetch('/activity/keystrokes', {
      method: 'POST',
      body: JSON.stringify({
        keystrokes: keystrokeData,
        active_window: appName,
      }),
    });
    return await r.json();
  }

  async function logNetwork(data) {
    const r = await apiFetch('/activity/network', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return await r.json();
  }
// Add to the public return object in api.js:
async function getWebsiteSummary(date) {
  const r = await apiFetch(`/activity/websites?target_date=${date}`);
  return await r.json();
}
async function deactivateEmployee(employeeId) {
    const r = await apiFetch(`/employees/${employeeId}`, {
      method: 'DELETE',
    });
    return await r.json();
  }
  // ─── Public API
  return {
    login, logout, getMe, isLoggedIn, clearTokens,
    clockIn, clockOut, clockStatus,
    logActivity, logWebsite, logKeystrokes, logNetwork,
    logIdleInterval, crashClockOut,
    getWebsiteSummary,
    listEmployees, createEmployee, deactivateEmployee, getEmployeeLive, getEmployeeToday,
  };
})();