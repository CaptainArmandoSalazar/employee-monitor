/**
 * globalKeyboard.ts
 *
 * Cross-platform global input capture.
 * Linux → spawns a child process to read /dev/input (non-blocking)
 * Windows/macOS → uiohook-napi
 */

import { activityTracker } from '../system/activity';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fork, ChildProcess } from 'child_process';

let _count       = 0;
let _onFlush: ((n: number, raw?: string) => void) | null = null;
let _interval:   NodeJS.Timeout  | null = null;
let _running     = false;
let _hook: any   = null;
let _worker: ChildProcess | null = null;

// uiohook-napi modifier keycodes (Windows/macOS)
const IGNORED_KEYCODES_UIOHOOK = new Set([
  0xFFE1, 0xFFE2, 0xFFE3, 0xFFE4,
  0xFFE9, 0xFFEA, 0xFFEB, 0xFFEC,
  0xFFE5, 0xFF09, 0xFF7F, 0xFF14, 0xFF13,
]);

function getRelevantDevices(): string[] {
  try {
    const procContent = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    const blocks = procContent.split('\n\n').filter(b => b.trim());
    const devices: string[] = [];
    const EV_KEY = 1;

    for (const block of blocks) {
      const nameMatch     = block.match(/N: Name="(.+)"/);
      const handlersMatch = block.match(/H: Handlers=(.+)/);
      const evMatch       = block.match(/B: EV=([0-9a-f]+)/);
      if (!nameMatch || !handlersMatch || !evMatch) continue;

      const name    = nameMatch[1].toLowerCase();
      const evFlags = parseInt(evMatch[1], 16);
      if (!(evFlags & (1 << EV_KEY))) continue;

      if (
        name.includes('alsa')     || name.includes('hda')      ||
        name.includes('hdmi')     || name.includes('headphone') ||
        name.includes('mic')      || name.includes('video bus') ||
        name.includes('sleep')    || name.includes('power button')
      ) continue;

      const eventMatch = handlersMatch[1].match(/event(\d+)/);
      if (!eventMatch) continue;
      devices.push(`/dev/input/event${eventMatch[1]}`);
    }
    return devices;
  } catch {
    return [
      '/dev/input/event3',
      '/dev/input/event4',
      '/dev/input/event5',
      '/dev/input/event6',
      '/dev/input/event7',
    ];
  }
}

function startLinuxWorker(onFlush: (count: number, raw?: string) => void): void {
  const devices = getRelevantDevices();
  console.log('[GlobalKeyboard] Spawning input worker for devices:', devices);

  // Find the worker file — works in both dev and production
  const workerPath = path.join(__dirname, 'inputWorker.js');

  if (!fs.existsSync(workerPath)) {
    console.error('[GlobalKeyboard] ❌ inputWorker.js not found at:', workerPath);
    return;
  }

  _worker = fork(workerPath, devices, {
    silent: true, // worker stdout/stderr piped to parent
    detached: false,
  });

  _worker.on('message', (msg: any) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'activity') {
      activityTracker.signalActivity();
    }

    if (msg.type === 'keystroke') {
      activityTracker.signalActivity();
    }

if (msg.type === 'flush') {
  const n   = msg.count as number;
  const raw = msg.raw   as string || '';
  if (n > 0 && onFlush) {
    onFlush(n, raw); // ← pass raw to onFlush
    _count = 0;
  }
}
  });

  _worker.stderr?.on('data', (data) => {
    console.log('[InputWorker]', data.toString().trim());
  });

  _worker.on('exit', (code) => {
    console.log('[GlobalKeyboard] Worker exited with code:', code);
    _worker = null;
  });

  _worker.on('error', (err) => {
    console.error('[GlobalKeyboard] Worker error:', err);
  });

  // Override flush interval — worker handles its own 10s flush
  // We just drain _count every 10s and call onFlush
_interval = setInterval(() => {
  const n = _count;
  if (n === 0 || !_onFlush) return;
  _count = 0;
  _onFlush(n, ''); // raw not available on Windows/macOS via this path
}, 10_000);

  console.log('[GlobalKeyboard] ✅ Input worker started (non-blocking).');
}

export const globalKeyboard = {

start(onFlush: (count: number, raw?: string) => void): void {
  // Force reset any stale state from previous run (e.g. after app crash)
  if (_running) {
    console.log('[GlobalKeyboard] Was already running — forcing reset before restart.');
    try {
      if (_worker) { _worker.kill(); _worker = null; }
      if (_hook)   { _hook.stop();   _hook   = null; }
    } catch { /* ignore */ }
    if (_interval) { clearInterval(_interval); _interval = null; }
    _running = false;
  }
    _running = true;
    _count   = 0;
    _onFlush = onFlush;

    console.log('[GlobalKeyboard] Platform:', process.platform, '| Arch:', os.arch());

    if (process.platform === 'linux') {
      console.log('[GlobalKeyboard] Linux — spawning /dev/input worker process.');
      startLinuxWorker(onFlush);

    } else {
      // Windows / macOS — use uiohook-napi
      try {
        const { uIOhook } = require('uiohook-napi');
        uIOhook.on('keydown', (e: any) => {
          activityTracker.signalActivity();
          if (e.keycode && IGNORED_KEYCODES_UIOHOOK.has(e.keycode)) return;
          _count++;
        });
        uIOhook.on('mousedown', () => activityTracker.signalActivity());
        uIOhook.on('wheel',     () => activityTracker.signalActivity());
        uIOhook.start();
        _hook = uIOhook;
        console.log(`[GlobalKeyboard] ✅ uiohook-napi started on ${process.platform}.`);
      } catch (err: any) {
        console.error('[GlobalKeyboard] ❌ uiohook-napi failed:', err?.message);
      }

      _interval = setInterval(() => {
        const n = _count;
        if (n === 0 || !_onFlush) return;
        _count = 0;
        _onFlush(n);
      }, 10_000);
    }
  },

  stop(): void {
    if (!_running) return;
    _running = false;

    if (_interval) { clearInterval(_interval); _interval = null; }

    // Flush remaining
    if (_count > 0 && _onFlush) {
      _onFlush(_count);
      _count = 0;
    }

    // Stop worker
    if (_worker) {
      try { _worker.send('stop'); } catch { /* ignore */ }
      _worker.kill();
      _worker = null;
    }

    // Stop uiohook
    try {
      if (_hook) { _hook.stop(); _hook = null; }
    } catch (e) {
      console.error('[GlobalKeyboard] Error stopping uiohook:', e);
    }

    _onFlush = null;
    console.log('[GlobalKeyboard] Stopped.');
  },

  addRendererCount(_n: number): void {
    // No-op
  },

  getCurrentCount(): number { return _count; },
  isRunning(): boolean { return _running; },
};