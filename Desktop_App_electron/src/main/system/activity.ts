import { exec } from 'child_process';
import { trackingService } from '../services/tracking.service';

export interface ActiveWindow {
  appName: string;
  windowTitle: string;
  url?: string;
  domain?: string;
}

// ── Get active window (cross-platform) ───────────────────
function getActiveWindow(): Promise<ActiveWindow | null> {
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      const script = `
        Add-Type @"
        using System; using System.Runtime.InteropServices;
        public class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }
"@
        $h = [W]::GetForegroundWindow(); $s = New-Object System.Text.StringBuilder 256
        [W]::GetWindowText($h, $s, 256) | Out-Null; $pid = 0
        [W]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        Write-Output "$($proc.Name)|$($s.ToString())"
      `;
      exec(`powershell -Command "${script.replace(/\n/g, ' ')}"`, (err, out) => {
        if (err || !out) return resolve(null);
        const [app, ...titleParts] = out.trim().split('|');
        resolve({ appName: app?.trim() || 'Unknown', windowTitle: titleParts.join('|').trim() });
      });

    } else if (process.platform === 'darwin') {
      const script = `
        tell application "System Events"
          set fp to first application process whose frontmost is true
          set appName to name of fp
          set winTitle to ""
          try
            set winTitle to name of first window of fp
          end try
          return appName & "|" & winTitle
        end tell
      `;
      exec(`osascript -e '${script}'`, (err, out) => {
        if (err || !out) return resolve(null);
        const [app, ...titleParts] = out.trim().split('|');
        resolve({ appName: app?.trim() || 'Unknown', windowTitle: titleParts.join('|').trim() });
      });

    } else {
      exec('xdotool getactivewindow getwindowname', (err, titleOut) => {
        exec('xdotool getactivewindow getwindowpid | xargs -I{} cat /proc/{}/comm 2>/dev/null', (err2, appOut) => {
          resolve({
            appName: (appOut || 'Unknown').trim(),
            windowTitle: (titleOut || '').trim(),
          });
        });
      });
    }
  });
}

// ── Extract domain from browser window title ─────────────
const BROWSER_NAMES = ['chrome', 'firefox', 'safari', 'edge', 'opera', 'brave', 'chromium'];

function extractUrl(appName: string, windowTitle: string): { url: string; domain: string } | null {
  const app = appName.toLowerCase();
  if (!BROWSER_NAMES.some(b => app.includes(b))) return null;

  const match = windowTitle.match(/[-–—]\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*[-–—]?\s*[A-Z]/) ||
                windowTitle.match(/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (match) {
    const domain = match[1].toLowerCase();
    return { url: `https://${domain}`, domain };
  }
  return null;
}

// ── Idle detection constants ──────────────────────────────
const IDLE_THRESHOLD_SECONDS = 5 * 60; // 5 minutes of no activity = idle
const POLL_INTERVAL_MS = 2000;

// ── Activity tracker state ────────────────────────────────
let _lastWindow: ActiveWindow | null = null;
let _windowStart: number = Date.now();
let _totalActive = 0;
let _totalIdle = 0;
let _pollInterval: NodeJS.Timeout | null = null;

// Track last user activity time (keyboard/mouse activity signalled from renderer)
let _lastActivityTime: number = Date.now();

// Called from IPC when renderer detects user input
export function signalUserActivity(): void {
  _lastActivityTime = Date.now();
}

function isCurrentlyIdle(): boolean {
  return (Date.now() - _lastActivityTime) >= (IDLE_THRESHOLD_SECONDS * 1000);
}

export const activityTracker = {
  start(): void {
    _lastWindow = null;
    _windowStart = Date.now();
    _totalActive = 0;
    _totalIdle = 0;
    _lastActivityTime = Date.now(); // reset idle timer on clock-in

    _pollInterval = setInterval(async () => {
      const now = Date.now();
      const idle = isCurrentlyIdle();

      if (idle) {
        // User has been idle for >= 5 minutes — count these 2 seconds as idle
        _totalIdle += POLL_INTERVAL_MS / 1000;
        return;
      }

      // User is active
      const current = await getActiveWindow();
      if (!current) {
        _totalActive += POLL_INTERVAL_MS / 1000;
        return;
      }

      const elapsed = Math.floor((now - _windowStart) / 1000);

      const isDifferentWindow =
        !_lastWindow ||
        _lastWindow.appName !== current.appName ||
        _lastWindow.windowTitle !== current.windowTitle;

      if (isDifferentWindow && _lastWindow && elapsed > 1) {
        // Log the previous window
        trackingService.pushActivity({
          app_name: _lastWindow.appName,
          window_title: _lastWindow.windowTitle,
          start_time: new Date(_windowStart).toISOString(),
          end_time: new Date(now).toISOString(),
          duration: elapsed,
          is_idle: false,
        });

        const urlInfo = extractUrl(_lastWindow.appName, _lastWindow.windowTitle);
        if (urlInfo) {
          trackingService.pushWebsite({
            url: urlInfo.url,
            domain: urlInfo.domain,
            title: _lastWindow.windowTitle,
            duration: elapsed,
            timestamp: new Date(_windowStart).toISOString(),
          });
        }

        _totalActive += elapsed;
        _windowStart = now;
        _lastWindow = current;
      } else if (!isDifferentWindow) {
        _totalActive += POLL_INTERVAL_MS / 1000;
      } else {
        _lastWindow = current;
        _windowStart = now;
      }
    }, POLL_INTERVAL_MS);
  },

  stop(): void {
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }

    if (_lastWindow) {
      const now = Date.now();
      const elapsed = Math.floor((now - _windowStart) / 1000);
      if (elapsed > 1) {
        trackingService.pushActivity({
          app_name: _lastWindow.appName,
          window_title: _lastWindow.windowTitle,
          start_time: new Date(_windowStart).toISOString(),
          end_time: new Date(now).toISOString(),
          duration: elapsed,
          is_idle: false,
        });
        _totalActive += elapsed;
      }
    }
  },

  getTotals(): { active: number; idle: number } {
    return { active: _totalActive, idle: _totalIdle };
  },

  signalActivity(): void {
    signalUserActivity();
  },
};