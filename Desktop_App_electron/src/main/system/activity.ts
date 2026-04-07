import { exec } from 'child_process';
import { trackingService } from '../services/tracking.service';

export interface ActiveWindow {
  appName: string;
  windowTitle: string;
  url?: string;
  domain?: string;
}

// ── Friendly name map ─────────────────────────────────────
function getFriendlyName(rawApp: string): string {
  const nameMap: Record<string, string> = {
    'google chrome':      'Google Chrome',
    'chromium':           'Chromium',
    'firefox':            'Firefox',
    'mozilla firefox':    'Firefox',
    'microsoft edge':     'Microsoft Edge',
    'brave':              'Brave',
    'opera':              'Opera',
    'vivaldi':            'Vivaldi',
    'visual studio code': 'VS Code',
    'code':               'VS Code',
    'code - oss':         'VS Code',
    'electron':           'Electron',
    'slack':              'Slack',
    'telegram desktop':   'Telegram',
    'discord':            'Discord',
    'spotify':            'Spotify',
    'files':              'Files',
    'nautilus':           'Files',
    'gedit':              'Text Editor',
    'kate':               'Kate',
    'sublime text':       'Sublime Text',
    'atom':               'Atom',
    'terminal':           'Terminal',
    'gnome terminal':     'Terminal',
    'konsole':            'Terminal',
    'alacritty':          'Terminal',
    'kitty':              'Terminal',
    'bash':               'Terminal',
    'zsh':                'Terminal',
    'gimp':               'GIMP',
    'inkscape':           'Inkscape',
    'vlc':                'VLC',
    'mpv':                'MPV',
    'thunderbird':        'Thunderbird',
    'zoom':               'Zoom',
    'microsoft teams':    'Microsoft Teams',
    'postman':            'Postman',
    'dbeaver':            'DBeaver',
    'libreoffice':        'LibreOffice',
    'libreoffice writer': 'LibreOffice Writer',
    'libreoffice calc':   'LibreOffice Calc',
    'libreoffice impress':'LibreOffice Impress',
    'evince':             'Document Viewer',
    'eog':                'Image Viewer',
    'rhythmbox':          'Rhythmbox',
    'skype':              'Skype',
  };
  return nameMap[rawApp.toLowerCase()] || rawApp || 'Unknown';
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
        const appName = getFriendlyName(app?.trim() || '');
        resolve({ appName, windowTitle: titleParts.join('|').trim() });
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
        const appName = getFriendlyName(app?.trim() || '');
        resolve({ appName, windowTitle: titleParts.join('|').trim() });
      });

    } else {
      // Linux/Wayland — use custom GNOME Shell extension via DBus
      exec(
        `gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/WindowTracker --method org.gnome.Shell.Extensions.WindowTracker.GetActiveWindow 2>/dev/null`,
        (err, out) => {
          if (err || !out) {
            // Fallback to xdotool for X11 sessions
            exec('xdotool getactivewindow getwindowpid getwindowname 2>/dev/null', (err2, out2) => {
              if (err2 || !out2) return resolve(null);
              const lines = out2.trim().split('\n');
              const pid   = lines[0]?.trim();
              const title = lines.slice(1).join(' ').trim();
              if (!pid) return resolve({ appName: 'Unknown', windowTitle: title });
              exec(`cat /proc/${pid}/status 2>/dev/null | grep "^Name:" | awk '{print $2}'`, (e3, nameOut) => {
                const rawName = (nameOut || '').trim();
                resolve({ appName: getFriendlyName(rawName), windowTitle: title });
              });
            });
            return;
          }

          try {
            // Output format: ('{"title":"...","app":"...","pid":123}',)
            const match = out.match(/'(.+)'/);
            if (!match) return resolve(null);
            const data = JSON.parse(match[1]);
            if (!data.title && !data.app) return resolve(null);
            const appName = getFriendlyName(data.app || '');
            resolve({ appName, windowTitle: data.title || '' });
          } catch {
            resolve(null);
          }
        }
      );
    }
  });
}

// ── Extract domain from browser window title ─────────────
const BROWSER_NAMES = [
  'google chrome', 'chromium', 'firefox', 'mozilla firefox',
  'safari', 'microsoft edge', 'edge', 'opera', 'brave', 'vivaldi',
];

function extractUrl(appName: string, windowTitle: string): { url: string; domain: string } | null {
  const app = appName.toLowerCase();
  if (!BROWSER_NAMES.some(b => app.includes(b))) return null;
  if (!windowTitle) return null;

  // Pattern 1: "Page Title - domain.com - Google Chrome"
  const p1 = windowTitle.match(/[-–—]\s*((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})\s*[-–—]/);
  if (p1) {
    const domain = p1[1].toLowerCase();
    if (!domain.includes('electron') && !domain.includes('localhost') && domain.includes('.')) {
      return { url: `https://${domain}`, domain };
    }
  }

  // Pattern 2: "Page Title - domain.com" at end
  const p2 = windowTitle.match(/[-–—]\s*((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})\s*$/);
  if (p2) {
    const domain = p2[1].toLowerCase();
    if (!domain.includes('electron') && !domain.includes('localhost') && domain.includes('.')) {
      return { url: `https://${domain}`, domain };
    }
  }

  // Pattern 3: any recognizable TLD domain in title
  const p3 = windowTitle.match(/((?:[a-zA-Z0-9-]+\.)+(?:com|org|net|io|dev|co|in|uk|edu|gov|app|ai|me|info|tech))/i);
  if (p3) {
    const domain = p3[1].toLowerCase();
    if (!domain.includes('electron') && !domain.includes('localhost')) {
      return { url: `https://${domain}`, domain };
    }
  }

  return null;
}

// ── Idle detection constants ──────────────────────────────
const IDLE_THRESHOLD_SECONDS = 5 * 60;
const POLL_INTERVAL_MS       = 2000;

// ── Activity tracker state ────────────────────────────────
let _lastWindow:       ActiveWindow | null = null;
let _windowStart:      number = Date.now();
let _totalActive       = 0;
let _totalIdle         = 0;
let _pollInterval:     NodeJS.Timeout | null = null;
let _lastActivityTime: number = Date.now();
let _wasIdle           = false;

export function signalUserActivity(): void {
  _lastActivityTime = Date.now();
}

function isCurrentlyIdle(): boolean {
  return (Date.now() - _lastActivityTime) >= (IDLE_THRESHOLD_SECONDS * 1000);
}

function closeCurrentWindow(now: number): void {
  if (!_lastWindow) return;
  const elapsed = Math.floor((now - _windowStart) / 1000);
  if (elapsed > 1) {
    trackingService.pushActivity({
      app_name:     _lastWindow.appName,
      window_title: _lastWindow.windowTitle,
      start_time:   new Date(_windowStart).toISOString(),
      end_time:     new Date(now).toISOString(),
      duration:     elapsed,
      is_idle:      false,
    });

    const urlInfo = extractUrl(_lastWindow.appName, _lastWindow.windowTitle);
    if (urlInfo) {
      trackingService.pushWebsite({
        url:       urlInfo.url,
        domain:    urlInfo.domain,
        title:     _lastWindow.windowTitle,
        duration:  elapsed,
        timestamp: new Date(_windowStart).toISOString(),
      });
    }

    _totalActive += elapsed;
  }
  _windowStart = now;
}

export const activityTracker = {
  

  seedTotals(active: number, idle: number): void {
    _totalActive = active;
    _totalIdle   = idle;
    console.log(`[ActivityTracker] Seeded from DB — active: ${active}s, idle: ${idle}s`);
  },

  start(): void {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }

    _lastWindow       = null;
    _windowStart      = Date.now();
    _totalActive      = 0;
    _totalIdle        = 0;
    _wasIdle          = false;
    _lastActivityTime = Date.now();

    _pollInterval = setInterval(async () => {
      const now  = Date.now();
      const idle = isCurrentlyIdle();

      // ── IDLE ──────────────────────────────────────────────
      if (idle) {
        if (!_wasIdle) {
          closeCurrentWindow(now);
          _lastWindow = null;
          _wasIdle    = true;
        }
        _totalIdle += POLL_INTERVAL_MS / 1000;
        return;
      }

      // ── ACTIVE ────────────────────────────────────────────
      if (_wasIdle) {
        _wasIdle     = false;
        _windowStart = now;
        _lastWindow  = null;
      }

      const current = await getActiveWindow();
      if (!current) return;

      const isDifferentWindow =
        !_lastWindow ||
        _lastWindow.appName     !== current.appName ||
        _lastWindow.windowTitle !== current.windowTitle;

      if (isDifferentWindow) {
        closeCurrentWindow(now);
        _lastWindow  = current;
        _windowStart = now;
      }

    }, POLL_INTERVAL_MS);
  },

  stop(): void {
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }
    if (_lastWindow && !_wasIdle) {
      closeCurrentWindow(Date.now());
    }
  },

    getCurrentWindowElapsed(now: number = Date.now()): number {
    // If idle or no window, current window contributes 0 to active
    if (_wasIdle || !_lastWindow) return 0;
    return Math.max(0, Math.floor((now - _windowStart) / 1000));
  },

  getTotals(): { active: number; idle: number } {
    return { active: _totalActive, idle: _totalIdle };
  },

  signalActivity(): void {
    signalUserActivity();
  },
};