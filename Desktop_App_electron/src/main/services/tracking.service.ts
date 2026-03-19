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

let _activityBuffer: ActivityLog[] = [];
let _websiteBuffer:  WebsiteLog[]  = [];
let _metricsInterval: NodeJS.Timeout | null = null;
let _flushInterval:   NodeJS.Timeout | null = null;
let _lastSpeed: { download: number; upload: number; ping: number } | null = null;

export const trackingService = {
  start(): void {
    _flushInterval = setInterval(() => this.flushBuffers(), 30_000);

    // Start system-wide keystroke capture, flush to DB every 10s
    // Any detected keystroke also resets the idle timer via globalKeyboard internally
    globalKeyboard.start(async (count: number) => {
      // Extra safety: if global hook delivered keystrokes, user is definitely active
      if (count > 0) {
        activityTracker.signalActivity();
      }

      const session = sessionService.getActiveSession();
      const token   = authService.getToken();
      if (!session || !token || count === 0) return;
      try {
        await apiService.post('/tracking/keystrokes', {
          session_id:         session.session_id,
          keys_pressed_count: count,
          timestamp:          new Date().toISOString(),
        }, token);
      } catch { /* silent */ }
    });

    // Fire metrics 5s after clock-in, then every 5 min
    setTimeout(() => this.sendPeriodicMetrics(), 5_000);
    _metricsInterval = setInterval(() => this.sendPeriodicMetrics(), 5 * 60_000);
  },

  stop(): void {
    if (_flushInterval)   { clearInterval(_flushInterval);   _flushInterval   = null; }
    if (_metricsInterval) { clearInterval(_metricsInterval); _metricsInterval = null; }
    globalKeyboard.stop(); // flushes remaining keystrokes internally
    this.flushBuffers();
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

  // Called from IPC when renderer reports keystrokes (app focused)
  // globalKeyboard.addRendererCount is a no-op to prevent double-counting
  incrementKeystrokes(count = 1): Promise<void> {
    globalKeyboard.addRendererCount(count);
    return Promise.resolve();
  },

  async sendPeriodicMetrics(): Promise<void> {
    const session = sessionService.getActiveSession();
    const token   = authService.getToken();
    if (!session || !token) return;

    const { getCpuUsage, getMemoryUsage } = await import('../system/metrics');
    const { getNetworkSpeed }              = await import('../system/network');

    const [cpu, mem] = await Promise.all([getCpuUsage(), getMemoryUsage()]);
    await apiService.post('/tracking/system-metrics', {
      session_id: session.session_id, cpu_usage: cpu,
      memory_usage: mem, timestamp: new Date().toISOString(),
    }, token).catch(() => {});

    const speed = await getNetworkSpeed();
    _lastSpeed = speed;

    const s2 = sessionService.getActiveSession();
    const t2 = authService.getToken();
    if (!s2 || !t2) return;

    await apiService.post('/tracking/network-speed', {
      session_id: s2.session_id, download_speed: speed.download,
      upload_speed: speed.upload, ping: speed.ping,
      timestamp: new Date().toISOString(),
    }, t2).catch(() => {});
  },

  async flushBuffers(): Promise<void> {
    await Promise.allSettled([this.flushActivity(), this.flushWebsite()]);
  },

  getKeystrokeCount(): number { return globalKeyboard.getCurrentCount(); },
  getLastSpeed(): { download: number; upload: number; ping: number } | null { return _lastSpeed; },
};