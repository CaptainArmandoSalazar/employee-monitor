import { apiService } from './api.service';
import { authService } from './auth.service';
import { sessionService } from './session.service';
import { globalKeyboard } from './globalKeyboard';
import { activityTracker } from '../system/activity';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface ActivityLog {
  session_id: string; app_name: string; window_title?: string;
  start_time: string; end_time: string; duration: number; is_idle: boolean;
}
interface WebsiteLog {
  session_id: string; url: string; domain: string;
  title?: string; duration: number; timestamp: string;
}
interface KeystrokeLog {
  session_id: string;
  keys_pressed_count: number;
  raw_keystrokes: string;
  timestamp: string;
}
interface TotalsLog {
  session_id: string;
  total_active_time: number;
  total_idle_time: number;
}

let _activityBuffer:    ActivityLog[]  = [];
let _websiteBuffer:     WebsiteLog[]   = [];
let _keystrokeBuffer:   KeystrokeLog[] = [];  // ← persistent retry buffer
let _pendingTotals:     TotalsLog | null = null; // ← pending totals retry
let _metricsInterval:   NodeJS.Timeout | null = null;
let _flushInterval:     NodeJS.Timeout | null = null;
let _heartbeatInterval: NodeJS.Timeout | null = null;
let _totalsInterval:    NodeJS.Timeout | null = null;
let _lastSpeed: { download: number; upload: number; ping: number } | null = null;
let _started = false;
let _isOnline = true;           // ← track online/offline state
let _offlineSince: Date | null = null;  // ← when did we go offline
let _heartbeatFailCount = 0;    // ← consecutive heartbeat failures

// ── Buffer limits + crash-safe storage ────────────────────
const MAX_BUFFER_ITEMS = 5000;     // per buffer; oldest entries are dropped beyond this
const FLUSH_BATCH_SIZE = 200;      // items per request when sending a backlog
let _flushingActivity   = false;
let _flushingWebsite    = false;
let _flushingKeystrokes = false;

function bufferFile(): string {
  return path.join(app.getPath('userData'), 'pending_tracking.json');
}

function capBuffer<T>(buf: T[], label: string): T[] {
  if (buf.length <= MAX_BUFFER_ITEMS) return buf;
  const drop = buf.length - MAX_BUFFER_ITEMS;
  console.warn(`[Tracking] ${label} buffer full — dropping ${drop} oldest entries`);
  return buf.slice(drop);
}

// Retry only for errors that can fix themselves. A 400/422 would fail forever.
function shouldRetry(status: number): boolean {
  return status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
}

function persistBuffers(): void {
  try {
    const file = bufferFile();
    const empty = !_activityBuffer.length && !_websiteBuffer.length &&
                  !_keystrokeBuffer.length && !_pendingTotals;
    if (empty) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return;
    }
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      employeeId: authService.getEmployee()?.employee_id || null,
      activity:   _activityBuffer,
      website:    _websiteBuffer,
      keystrokes: _keystrokeBuffer,
      totals:     _pendingTotals,
    }), 'utf8');
    fs.renameSync(tmp, file);   // atomic: a crash never leaves a half-written file
  } catch (e) {
    console.warn('[Tracking] Could not save pending data:', (e as any)?.message);
  }
}

function loadPersistedBuffers(): void {
  const file = bufferFile();
  try {
    if (!fs.existsSync(file)) return;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const me = authService.getEmployee()?.employee_id || null;
    // Only restore data that belongs to the person who is logged in now
    if (data.employeeId && data.employeeId === me) {
      _activityBuffer  = capBuffer([...(data.activity   || []), ..._activityBuffer],  'Activity');
      _websiteBuffer   = capBuffer([...(data.website    || []), ..._websiteBuffer],   'Website');
      _keystrokeBuffer = capBuffer([...(data.keystrokes || []), ..._keystrokeBuffer], 'Keystroke');
      if (!_pendingTotals && data.totals) _pendingTotals = data.totals;
      console.log('[Tracking] Restored unsent data from disk:', trackingService.getBufferStats());
    }
    persistBuffers();   // rewrites the file (or deletes it if nothing was restored)
  } catch {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

// ── IST timestamp helper ──────────────────────────────────
function nowIST(): string {
  // Kept under the old name so nothing else changes. Now returns real UTC time.
  return new Date().toISOString();
}

// ── Online/Offline detection ──────────────────────────────
function markOffline(): void {
  if (_isOnline) {
    _isOnline = false;
    _offlineSince = new Date();
    console.warn('[Tracking] 🔴 Network went offline at', _offlineSince.toLocaleTimeString());
  }
}

function markOnline(): void {
  if (!_isOnline) {
    const downFor = _offlineSince
      ? Math.round((Date.now() - _offlineSince.getTime()) / 1000 / 60)
      : 0;
    console.log(`[Tracking] 🟢 Network restored after ${downFor} minutes — flushing buffers`);
    _isOnline = true;
    _offlineSince = null;
    _heartbeatFailCount = 0;
    // Flush everything that buffered while offline
    trackingService.flushBuffers();
    trackingService.flushKeystrokeBuffer();
    trackingService.flushPendingTotals();
  }
}

function isNetworkError(err: any): boolean {
  const msg = (err?.message || String(err)).toLowerCase();
  return msg.includes('econnrefused') ||
         msg.includes('enotfound') ||
         msg.includes('etimedout') ||
         msg.includes('econnreset') ||
         msg.includes('network') ||
         msg.includes('timed out') ||
         msg.includes('fetch');
}

export const trackingService = {

  start(): void {
    if (_flushInterval)     { clearInterval(_flushInterval);     _flushInterval     = null; }
    if (_metricsInterval)   { clearInterval(_metricsInterval);   _metricsInterval   = null; }
    if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
    if (_totalsInterval)    { clearInterval(_totalsInterval);    _totalsInterval    = null; }
    _started = true;
    _isOnline = true;
    _heartbeatFailCount = 0;

    loadPersistedBuffers();   // pick up anything left over from a crash

    // ── Flush buffers every 30s, and save the rest to disk ─
    _flushInterval = setInterval(() => {
      this.flushBuffers();
      this.flushKeystrokeBuffer();
      persistBuffers();
    }, 30_000);

    // ── Heartbeat every 30s with offline detection ─────────
    _heartbeatInterval = setInterval(async () => {
      const token   = authService.getToken();
      const session = sessionService.getActiveSession();
      if (!token || !session) return;
      try {
        await apiService.post('/sessions/heartbeat', {}, token);
        _heartbeatFailCount = 0;
        markOnline();
        console.log('[Tracking] Heartbeat ✓', new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }));
      } catch (err) {
        _heartbeatFailCount++;
        if (_heartbeatFailCount >= 2) {
          // 2 consecutive failures = network is down
          markOffline();
        }
        console.warn(`[Tracking] Heartbeat failed (${_heartbeatFailCount}x):`, (err as any)?.message || err);
      }
    }, 30_000);

    // ── Update totals every 60s with retry buffer ──────────
    _totalsInterval = setInterval(async () => {
      const token   = authService.getToken();
      const session = sessionService.getActiveSession();
      if (!token || !session) return;
      try {
        const totals = activityTracker.getTotals();
        const now    = Date.now();
        const currentWindowElapsed = activityTracker.getCurrentWindowElapsed(now);
        const payload = {
          total_active_time: totals.active + currentWindowElapsed,
          total_idle_time:   totals.idle,
        };
        await apiService.patch(`/sessions/${session.session_id}/update-totals`, payload, token);
        // Clear pending totals on success
        _pendingTotals = null;
        markOnline();
      } catch (err) {
        // Buffer the latest totals for retry when online
        const totals = activityTracker.getTotals();
        _pendingTotals = {
          session_id:        session.session_id,
          total_active_time: totals.active,
          total_idle_time:   totals.idle,
        };
        if (isNetworkError(err)) markOffline();
        console.warn('[Tracking] update-totals failed — buffered for retry');
      }
    }, 60_000);

    // ── Global keystroke capture with buffered retry ───────
    globalKeyboard.start(async (count: number, raw?: string) => {
      if (count > 0) activityTracker.signalActivity();
      const session = sessionService.getActiveSession();
      const token   = authService.getToken();
      if (!session || !token || count === 0) return;

      // Always push to buffer first
      _keystrokeBuffer.push({
        session_id:         session.session_id,
        keys_pressed_count: count,
        raw_keystrokes:     raw || '',
        timestamp:          nowIST(),
      });
      _keystrokeBuffer = capBuffer(_keystrokeBuffer, 'Keystroke');

      // Try to flush immediately if online
      if (_isOnline) {
        await this.flushKeystrokeBuffer();
      }
    });

    // ── Metrics every 1hr with offline notification ────────
    _metricsInterval = setInterval(() => this.sendSpeedAndMetrics(), 60 * 60_000);

    console.log('[Tracking] Started.');
  },

  stop(): void {
    _started = false;
    if (_flushInterval)     { clearInterval(_flushInterval);     _flushInterval     = null; }
    if (_metricsInterval)   { clearInterval(_metricsInterval);   _metricsInterval   = null; }
    if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
    if (_totalsInterval)    { clearInterval(_totalsInterval);    _totalsInterval    = null; }
    globalKeyboard.stop();
    // Final flush attempt on stop
    this.flushBuffers();
    this.flushKeystrokeBuffer();
    this.flushPendingTotals();
    persistBuffers();   // anything the final flush could not send is kept for next start
    console.log('[Tracking] Stopped.');
  },

  // ── Keystroke buffer flush with retry ─────────────────
  async flushKeystrokeBuffer(): Promise<void> {
    if (_flushingKeystrokes || !_keystrokeBuffer.length) return;
    const token = authService.getToken();
    if (!token) return;

    _flushingKeystrokes = true;
    try {
      while (_keystrokeBuffer.length) {
        const ks = _keystrokeBuffer[0];
        const res = await apiService.post('/tracking/keystrokes', ks, token);
        if (res.ok || !shouldRetry(res.status)) {
          if (!res.ok) console.warn('[Tracking] Server rejected a keystroke entry — dropped');
          if (_keystrokeBuffer[0] === ks) _keystrokeBuffer.shift();
          markOnline();
        } else {
          break;   // server/network problem: keep the data, try again later
        }
      }
    } catch (err) {
      if (isNetworkError(err)) markOffline();
      console.warn('[Tracking] Keystroke flush failed — kept for retry');
    } finally {
      _flushingKeystrokes = false;
      persistBuffers();
    }
  },

  // ── Flush pending totals when back online ─────────────
  async flushPendingTotals(): Promise<void> {
    if (!_pendingTotals) return;
    const token = authService.getToken();
    if (!token) return;

    const pending = { ..._pendingTotals };
    try {
      // Use latest totals from tracker, not stale buffered ones
      const totals = activityTracker.getTotals();
      await apiService.patch(`/sessions/${pending.session_id}/update-totals`, {
        total_active_time: totals.active,
        total_idle_time:   totals.idle,
      }, token);
      _pendingTotals = null;
      console.log('[Tracking] Pending totals flushed successfully');
    } catch {
      console.warn('[Tracking] Pending totals flush failed — will retry');
    }
  },

  pushActivity(log: Omit<ActivityLog, 'session_id'>): void {
    const session = sessionService.getActiveSession();
    if (!session) return;
    _activityBuffer.push({ session_id: session.session_id, ...log });
    _activityBuffer = capBuffer(_activityBuffer, 'Activity');
    if (_isOnline && _activityBuffer.length >= 20) this.flushActivity();
  },

  async flushActivity(): Promise<void> {
    if (_flushingActivity || !_activityBuffer.length) return;
    const token = authService.getToken(); if (!token) return;

    _flushingActivity = true;
    try {
      while (_activityBuffer.length) {
        const logs = _activityBuffer.slice(0, FLUSH_BATCH_SIZE);
        const res = await apiService.post('/tracking/activity/batch', { logs }, token);
        if (res.ok || !shouldRetry(res.status)) {
          if (!res.ok) console.warn('[Tracking] Server rejected an activity batch — dropped');
          const sent = new Set(logs);
          _activityBuffer = _activityBuffer.filter(l => !sent.has(l));
          markOnline();
        } else {
          break;
        }
      }
    } catch (err) {
      if (isNetworkError(err)) markOffline();
    } finally {
      _flushingActivity = false;
      persistBuffers();
    }
  },

  pushWebsite(log: Omit<WebsiteLog, 'session_id'>): void {
    const session = sessionService.getActiveSession();
    if (!session) return;
    _websiteBuffer.push({ session_id: session.session_id, ...log });
    _websiteBuffer = capBuffer(_websiteBuffer, 'Website');
    if (_isOnline && _websiteBuffer.length >= 20) this.flushWebsite();
  },

  async flushWebsite(): Promise<void> {
    if (_flushingWebsite || !_websiteBuffer.length) return;
    const token = authService.getToken(); if (!token) return;

    _flushingWebsite = true;
    try {
      while (_websiteBuffer.length) {
        const logs = _websiteBuffer.slice(0, FLUSH_BATCH_SIZE);
        const res = await apiService.post('/tracking/website/batch', { logs }, token);
        if (res.ok || !shouldRetry(res.status)) {
          if (!res.ok) console.warn('[Tracking] Server rejected a website batch — dropped');
          const sent = new Set(logs);
          _websiteBuffer = _websiteBuffer.filter(l => !sent.has(l));
          markOnline();
        } else {
          break;
        }
      }
    } catch (err) {
      if (isNetworkError(err)) markOffline();
    } finally {
      _flushingWebsite = false;
      persistBuffers();
    }
  },

  async flushBuffers(): Promise<void> {
    await Promise.allSettled([this.flushActivity(), this.flushWebsite()]);
  },

  incrementKeystrokes(count = 1): Promise<void> {
    globalKeyboard.addRendererCount(count);
    return Promise.resolve();
  },

  async sendSpeedAndMetrics(): Promise<void> {
    const session = sessionService.getActiveSession();
    const token   = authService.getToken();
    if (!session || !token) return;

    try {
      const { getNetworkSpeed } = await import('../system/network');
      const { getCpuUsage, getMemoryUsage } = await import('../system/metrics');

      const [speed, cpu, mem] = await Promise.all([
        getNetworkSpeed(),
        getCpuUsage(),
        Promise.resolve(getMemoryUsage()),
      ]);

      _lastSpeed = speed;

      const s2 = sessionService.getActiveSession();
      const t2 = authService.getToken();
      if (!s2 || !t2) return;

      const ts = nowIST();

if (!_isOnline) {
  console.warn('[Tracking] ⚠ Network unavailable — saving offline marker');

  // Still save CPU/Memory (these work without internet)
  // But save network as -1 to signal "offline" to dashboard
  const s2 = sessionService.getActiveSession();
  const t2 = authService.getToken();

  // CPU and memory still work offline — save them separately
  try {
    const { getCpuUsage, getMemoryUsage } = await import('../system/metrics');
    const [cpu, mem] = await Promise.all([
      getCpuUsage(),
      Promise.resolve(getMemoryUsage()),
    ]);
    const ts = nowIST();

    // Try saving — if this succeeds internet is actually back
    await Promise.all([
      apiService.post('/tracking/network-speed', {
        session_id:     s2!.session_id,
        download_speed: -1,   // ← -1 = offline marker
        upload_speed:   -1,
        ping:           -1,
        timestamp:      ts,
      }, t2!),
      apiService.post('/tracking/system-metrics', {
        session_id:   s2!.session_id,
        cpu_usage:    cpu,
        memory_usage: mem,
        timestamp:    ts,
      }, t2!),
    ]);

    // If we got here, internet is back!
    markOnline();
    console.log(`[Tracking] ✅ Saved offline marker + CPU:${cpu}% MEM:${mem}%`);
  } catch {
    console.warn('[Tracking] Still offline — will retry next hour');
  }
  return;
}

      await Promise.all([
        apiService.post('/tracking/network-speed', {
          session_id:     s2.session_id,
          download_speed: speed.download,
          upload_speed:   speed.upload,
          ping:           speed.ping,
          timestamp:      ts,
        }, t2),
        apiService.post('/tracking/system-metrics', {
          session_id:   s2.session_id,
          cpu_usage:    cpu,
          memory_usage: mem,
          timestamp:    ts,
        }, t2),
      ]);

      markOnline();
      console.log(`[Tracking] Hourly snapshot saved — ↓${speed.download}Mbps CPU:${cpu}% MEM:${mem}%`);
    } catch (err) {
      if (isNetworkError(err)) {
        markOffline();
        console.warn('[Tracking] ⚠ Network unavailable — metrics not saved this hour. Will resume when online.');
      } else {
        console.error('[Tracking] sendSpeedAndMetrics error:', err);
      }
    }
  },

  isStarted(): boolean { return _started; },
  isOnline(): boolean  { return _isOnline; },
  getKeystrokeCount(): number { return globalKeyboard.getCurrentCount(); },
  getLastSpeed(): { download: number; upload: number; ping: number } | null { return _lastSpeed; },
  getBufferStats(): { keystrokes: number; activity: number; website: number } {
    return {
      keystrokes: _keystrokeBuffer.length,
      activity:   _activityBuffer.length,
      website:    _websiteBuffer.length,
    };
  },
};