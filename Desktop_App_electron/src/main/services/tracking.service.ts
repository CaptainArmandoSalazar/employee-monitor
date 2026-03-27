import { apiService } from './api.service';
import { authService } from './auth.service';
import { sessionService } from './session.service';
import { globalKeyboard } from './globalKeyboard';
import { activityTracker } from '../system/activity';

interface ActivityLog {
  session_id: string; app_name: string; window_title?: string;
  start_time: string; end_time: string; duration: number; is_idle: boolean;
}
interface WebsiteLog {
  session_id: string; url: string; domain: string;
  title?: string; duration: number; timestamp: string;
}

let _activityBuffer:    ActivityLog[] = [];
let _websiteBuffer:     WebsiteLog[]  = [];
let _metricsInterval:   NodeJS.Timeout | null = null;
let _flushInterval:     NodeJS.Timeout | null = null;
let _heartbeatInterval: NodeJS.Timeout | null = null;
let _lastSpeed: { download: number; upload: number; ping: number } | null = null;
let _started = false; // guard against double-start

// ── IST timestamp helper ──────────────────────────────────
function nowIST(): string {
  return new Date().toLocaleString('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).replace(', ', 'T') + '+05:30';
}

export const trackingService = {
  start(): void {
    // Clear any stale intervals from previous run before starting
    if (_flushInterval)     { clearInterval(_flushInterval);     _flushInterval     = null; }
    if (_metricsInterval)   { clearInterval(_metricsInterval);   _metricsInterval   = null; }
    if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
    _started = true;

    _flushInterval = setInterval(() => this.flushBuffers(), 30_000);

    // ── Heartbeat every 30s ────────────────────────────────
    _heartbeatInterval = setInterval(async () => {
      const token   = authService.getToken();
      const session = sessionService.getActiveSession();
      if (!token || !session) return;
      try {
        await apiService.post('/sessions/heartbeat', {}, token);
        console.log('[Tracking] Heartbeat ✓', new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }));
      } catch (err) {
        console.error('[Tracking] Heartbeat failed:', err);
      }
    }, 30_000);

    setInterval(async () => {
  const token   = authService.getToken();
  const session = sessionService.getActiveSession();
  if (!token || !session) return;
  try {
    const totals = activityTracker.getTotals();
    await apiService.patch(`/sessions/${session.session_id}/update-totals`, {
      total_active_time: totals.active,
      total_idle_time:   totals.idle,
    }, token);
  } catch { /* silent */ }
}, 60_000);

    // ── Global keystroke + mouse capture ──────────────────
globalKeyboard.start(async (count: number, raw?: string) => {
  if (count > 0) activityTracker.signalActivity();
  const session = sessionService.getActiveSession();
  const token   = authService.getToken();
  if (!session || !token || count === 0) return;
  try {
    await apiService.post('/tracking/keystrokes', {
      session_id:         session.session_id,
      keys_pressed_count: count,
      raw_keystrokes:     raw || '',
      timestamp:          nowIST(),
    }, token);
  } catch { /* silent */ }
});

    // ── Metrics 5s after start, then every 5 min ──────────
    setTimeout(() => this.sendCpuMemMetrics(), 5_000);
    _metricsInterval = setInterval(() => this.sendCpuMemMetrics(), 5 * 60_000);

    // Speed: first check at 5s (captures clock-in speed in logs), then every 1 hour
    setInterval(() => this.sendSpeedMetrics(), 60 * 60_000);

    console.log('[Tracking] Started.');
  },

  stop(): void {
    _started = false;
    if (_flushInterval)     { clearInterval(_flushInterval);     _flushInterval     = null; }
    if (_metricsInterval)   { clearInterval(_metricsInterval);   _metricsInterval   = null; }
    if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
    globalKeyboard.stop();
    this.flushBuffers();
    console.log('[Tracking] Stopped.');
  },

  pushActivity(log: Omit<ActivityLog, 'session_id'>): void {
    const session = sessionService.getActiveSession();
    if (!session) return;
    _activityBuffer.push({ session_id: session.session_id, ...log });
    if (_activityBuffer.length >= 20) this.flushActivity();
  },

  async flushActivity(): Promise<void> {
    if (!_activityBuffer.length) return;
    const token = authService.getToken(); if (!token) return;
    const logs = [..._activityBuffer]; _activityBuffer = [];
    try { await apiService.post('/tracking/activity/batch', { logs }, token); }
    catch { _activityBuffer = [...logs, ..._activityBuffer]; }
  },

  pushWebsite(log: Omit<WebsiteLog, 'session_id'>): void {
    const session = sessionService.getActiveSession();
    if (!session) return;
    _websiteBuffer.push({ session_id: session.session_id, ...log });
    if (_websiteBuffer.length >= 20) this.flushWebsite();
  },

  async flushWebsite(): Promise<void> {
    if (!_websiteBuffer.length) return;
    const token = authService.getToken(); if (!token) return;
    const logs = [..._websiteBuffer]; _websiteBuffer = [];
    try { await apiService.post('/tracking/website/batch', { logs }, token); }
    catch { _websiteBuffer = [...logs, ..._websiteBuffer]; }
  },

  incrementKeystrokes(count = 1): Promise<void> {
    globalKeyboard.addRendererCount(count);
    return Promise.resolve();
  },

async sendCpuMemMetrics(): Promise<void> {
    const session = sessionService.getActiveSession();
    const token   = authService.getToken();
    if (!session || !token) return;

    const { getCpuUsage, getMemoryUsage } = await import('../system/metrics');
    const [cpu, mem] = await Promise.all([getCpuUsage(), getMemoryUsage()]);

    await apiService.post('/tracking/system-metrics', {
      session_id: session.session_id, cpu_usage: cpu,
      memory_usage: mem, timestamp: nowIST(),
    }, token).catch(() => {});
  },

  async sendSpeedMetrics(): Promise<void> {
    const session = sessionService.getActiveSession();
    const token   = authService.getToken();
    if (!session || !token) return;

    const { getNetworkSpeed } = await import('../system/network');
    const speed = await getNetworkSpeed();
    _lastSpeed = speed;

    const s2 = sessionService.getActiveSession();
    const t2 = authService.getToken();
    if (!s2 || !t2) return;

    await apiService.post('/tracking/network-speed', {
      session_id: s2.session_id, download_speed: speed.download,
      upload_speed: speed.upload, ping: speed.ping, timestamp: nowIST(),
    }, t2).catch(() => {});
  },
  async flushBuffers(): Promise<void> {
    await Promise.allSettled([this.flushActivity(), this.flushWebsite()]);
  },

  isStarted(): boolean { return _started; },
  getKeystrokeCount(): number { return globalKeyboard.getCurrentCount(); },
  getLastSpeed(): { download: number; upload: number; ping: number } | null { return _lastSpeed; },
};