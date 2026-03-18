import { apiService } from './api.service';
import { authService } from './auth.service';
import { sessionService } from './session.service';

interface ActivityLog {
  session_id: string;
  app_name: string;
  window_title?: string;
  start_time: string;
  end_time: string;
  duration: number;
  is_idle: boolean;
}

interface WebsiteLog {
  session_id: string;
  url: string;
  domain: string;
  title?: string;
  duration: number;
  timestamp: string;
}

let _activityBuffer: ActivityLog[] = [];
let _websiteBuffer: WebsiteLog[] = [];
let _keystrokeCount = 0;
let _metricsInterval: NodeJS.Timeout | null = null;
let _flushInterval: NodeJS.Timeout | null = null;
let _lastSpeed: { download: number; upload: number; ping: number } | null = null;

export const trackingService = {
  start(): void {
    _flushInterval = setInterval(() => this.flushBuffers(), 30_000);
    // Fire metrics 5s after clock-in (speed test takes 20-30s to complete)
    setTimeout(() => this.sendPeriodicMetrics(), 5_000);
    _metricsInterval = setInterval(() => this.sendPeriodicMetrics(), 5 * 60_000);
  },

  stop(): void {
    if (_flushInterval)   { clearInterval(_flushInterval);   _flushInterval   = null; }
    if (_metricsInterval) { clearInterval(_metricsInterval); _metricsInterval = null; }
    this.flushBuffers();
    this.sendKeystrokes();
  },

  pushActivity(log: Omit<ActivityLog, 'session_id'>): void {
    const session = sessionService.getActiveSession();
    if (!session) return;
    _activityBuffer.push({ session_id: session.session_id, ...log });
    if (_activityBuffer.length >= 20) this.flushActivity();
  },

  async flushActivity(): Promise<void> {
    if (_activityBuffer.length === 0) return;
    const token = authService.getToken();
    if (!token) return;
    const logs = [..._activityBuffer];
    _activityBuffer = [];
    try {
      await apiService.post('/tracking/activity/batch', { logs }, token);
    } catch {
      _activityBuffer = [...logs, ..._activityBuffer];
    }
  },

  pushWebsite(log: Omit<WebsiteLog, 'session_id'>): void {
    const session = sessionService.getActiveSession();
    if (!session) return;
    _websiteBuffer.push({ session_id: session.session_id, ...log });
    if (_websiteBuffer.length >= 20) this.flushWebsite();
  },

  async flushWebsite(): Promise<void> {
    if (_websiteBuffer.length === 0) return;
    const token = authService.getToken();
    if (!token) return;
    const logs = [..._websiteBuffer];
    _websiteBuffer = [];
    try {
      await apiService.post('/tracking/website/batch', { logs }, token);
    } catch {
      _websiteBuffer = [...logs, ..._websiteBuffer];
    }
  },

  incrementKeystrokes(count = 1): Promise<void> {
    _keystrokeCount += count;
    return this.sendKeystrokes().catch(() => {});
  },

  async sendKeystrokes(): Promise<void> {
    const session = sessionService.getActiveSession();
    const token   = authService.getToken();
    if (!session || !token || _keystrokeCount === 0) return;
    const count = _keystrokeCount;
    _keystrokeCount = 0;
    try {
      await apiService.post('/tracking/keystrokes', {
        session_id:         session.session_id,
        keys_pressed_count: count,
        timestamp:          new Date().toISOString(),
      }, token);
    } catch {
      _keystrokeCount += count;
    }
  },

  async sendPeriodicMetrics(): Promise<void> {
    const session = sessionService.getActiveSession();
    const token   = authService.getToken();
    if (!session || !token) return;

    const { getCpuUsage, getMemoryUsage } = await import('../system/metrics');
    const { getNetworkSpeed }              = await import('../system/network');

    // Step 1: system metrics immediately (fast ~1s)
    const [cpu, mem] = await Promise.all([getCpuUsage(), getMemoryUsage()]);
    await apiService.post('/tracking/system-metrics', {
      session_id:   session.session_id,
      cpu_usage:    cpu,
      memory_usage: mem,
      timestamp:    new Date().toISOString(),
    }, token).catch(() => {});

    this.sendKeystrokes().catch(() => {});

    // Step 2: accurate speed test (~20-30s) — runs after system metrics
    const speed = await getNetworkSpeed();
    _lastSpeed = speed;

    // Re-verify session still active after long speed test
    const liveSession = sessionService.getActiveSession();
    const liveToken   = authService.getToken();
    if (!liveSession || !liveToken) return;

    await apiService.post('/tracking/network-speed', {
      session_id:     liveSession.session_id,
      download_speed: speed.download,
      upload_speed:   speed.upload,
      ping:           speed.ping,
      timestamp:      new Date().toISOString(),
    }, liveToken).catch(() => {});
  },

  async flushBuffers(): Promise<void> {
    await Promise.allSettled([this.flushActivity(), this.flushWebsite()]);
  },

  getKeystrokeCount(): number { return _keystrokeCount; },
  getLastSpeed(): { download: number; upload: number; ping: number } | null { return _lastSpeed; },
};