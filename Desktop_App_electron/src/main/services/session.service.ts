import { apiService } from './api.service';
import { authService } from './auth.service';

export interface SessionData {
  session_id: string;
  employee_id: string;
  date: string;
  clock_in: string;
  clock_out: string | null;
  total_active_time: number;
  total_idle_time: number;
  session_status: 'active' | 'completed' | 'stale';
  city?: string;
  country?: string;
  ip_address?: string;
  latitude?: number;
  longitude?: number;
}

let _activeSession: SessionData | null = null;
let _clockInTime:   number     | null = null;

export const sessionService = {
  async clockIn(payload: {
    ip_address?: string; latitude?: number; longitude?: number;
    city?: string; country?: string; location?: string;
    network_speed_start?: number; device_id?: string;
  }): Promise<{ success: boolean; session?: SessionData; error?: string }> {
    const token = authService.getToken();
    if (!token) return { success: false, error: 'Not authenticated' };
    try {
      const res = await apiService.post<SessionData>('/sessions/clock-in', payload, token);
      if (res.ok) {
        _activeSession = res.data;
        _clockInTime   = Date.now();
        return { success: true, session: res.data };
      }
      if (res.status === 401) { authService.handleExpiredToken(); return { success: false, error: 'Session expired — please log in again' }; }
      return { success: false, error: (res.data as { detail?: string })?.detail || 'Clock-in failed' };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Clock-in failed' };
    }
  },

  resumeSession(session: SessionData): void {
  _activeSession = session;
  // Restore clock-in time from the session's actual clock_in timestamp
  if (session.clock_in) {
    const clockInStr = String(session.clock_in);
    const clockInISO = clockInStr.endsWith('Z') || clockInStr.includes('+')
      ? clockInStr
      : clockInStr + 'Z';
    _clockInTime = new Date(clockInISO).getTime();
  } else {
    _clockInTime = Date.now();
  }
  console.log('[SessionService] Session resumed. Clock-in time restored:', new Date(_clockInTime).toISOString());
},
  async clockOut(totalActiveTime: number, totalIdleTime: number): Promise<{ success: boolean; error?: string }> {
    const token = authService.getToken();
    if (!token) {
      // Token gone — clear local state gracefully without error dialog
      _activeSession = null; _clockInTime = null;
      return { success: true };
    }
    if (!_activeSession) return { success: false, error: 'No active session' };
    try {
      const res = await apiService.post('/sessions/clock-out', {
        session_id:        _activeSession.session_id,
        total_active_time: totalActiveTime,
        total_idle_time:   totalIdleTime,
      }, token);

      if (res.ok) {
        _activeSession = null; _clockInTime = null;
        return { success: true };
      }
      if (res.status === 401) {
        // Token expired — treat as success (session will be auto-staled by backend)
        authService.handleExpiredToken();
        _activeSession = null; _clockInTime = null;
        return { success: true };
      }
      return { success: false, error: (res.data as { detail?: string })?.detail || 'Clock-out failed' };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Clock-out failed' };
    }
  },

async fetchActiveSession(): Promise<SessionData | null> {
  const token = authService.getToken();
  if (!token) return null;
  try {
    const res = await apiService.get<SessionData | null>('/sessions/active', token);
    if (res.ok && res.data) {
      _activeSession = res.data;
      // DO NOT set _clockInTime here — let ipc.ts orphan check handle it
      // _clockInTime is only set by clockIn() and resumeSession()
    } else if (res.status === 401) {
      authService.handleExpiredToken();
      return null;
    } else {
      _activeSession = null;
    }
    return res.data ?? null;
  } catch { return null; }
},

  async fetchMySessions(limit = 30): Promise<SessionData[]> {
    const token = authService.getToken();
    if (!token) return [];
    try {
      const res = await apiService.get<SessionData[]>('/sessions/my', token, { limit: String(limit) });
      if (res.status === 401) { authService.handleExpiredToken(); return []; }
      return res.ok ? res.data : [];
    } catch { return []; }
  },

  async saveDeviceInfo(sessionId: string, info: Record<string, unknown>): Promise<void> {
    const token = authService.getToken();
    if (!token) return;
    await apiService.post('/sessions/device-info', { session_id: sessionId, ...info }, token);
  },

  async saveNetworkInfo(sessionId: string, info: Record<string, unknown>): Promise<void> {
    const token = authService.getToken();
    if (!token) return;
    await apiService.post('/sessions/network-info', { session_id: sessionId, ...info }, token);
  },

  getActiveSession(): SessionData | null { return _activeSession; },
  getClockInTime():   number     | null { return _clockInTime; },
  isClocked():        boolean           { return !!_activeSession; },

  /** Reset local state — called when token expires */
  clearState() { _activeSession = null; _clockInTime = null; },
};