# Employee Monitor — Desktop App

Electron 28 desktop application for employee activity monitoring.
Connects to the FastAPI backend over HTTP.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 28 |
| Main process | TypeScript |
| Preload bridge | TypeScript + contextBridge |
| Renderer UI | Vanilla JavaScript + HTML/CSS |
| IPC | ipcMain / ipcRenderer (invoke/handle) |
| Packaging | electron-builder |

---

## Project Structure

```
employee-monitor-desktop/
│
├── src/
│   ├── main/                         # Electron main process (TypeScript)
│   │   ├── main.ts                   # App entry, single-instance lock
│   │   ├── window.ts                 # BrowserWindow factory (login/dashboard)
│   │   ├── ipc.ts                    # All IPC handler registrations
│   │   │
│   │   ├── services/
│   │   │   ├── api.service.ts        # HTTP client (Node http/https, no fetch)
│   │   │   ├── auth.service.ts       # Login, token storage, profile
│   │   │   ├── session.service.ts    # Clock-in/out, session state
│   │   │   └── tracking.service.ts  # Buffer + flush for all 5 tracking types
│   │   │
│   │   └── system/
│   │       ├── metrics.ts            # CPU %, memory %, device info
│   │       ├── network.ts            # IP, SSID, MAC, speed, geo-IP
│   │       └── activity.ts          # Active window polling, domain extraction
│   │
│   ├── preload/
│   │   └── preload.ts                # contextBridge API exposed to renderer
│   │
│   └── renderer/                     # UI (no Node.js access)
│       ├── login.html
│       ├── dashboard.html            # Single-page app with all views
│       ├── css/
│       │   └── styles.css            # Full design system (dark theme)
│       └── js/
│           ├── login.js              # Login page controller
│           ├── dashboard.js          # Dashboard controller (all pages)
│           ├── api.js                # Renderer-side API wrapper
│           └── tracker.js           # Stats polling UI helper
│
├── package.json
├── tsconfig.json
└── .env
```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Make sure the FastAPI backend is running on localhost:8000
#    (See employee_monitor_backend/README.md)

# 3. Start in development mode (auto-rebuild on TS changes)
npm run dev

# 4. Or build and run once
npm run start
```

---

## Environment

Edit `.env` if your backend runs on a different port or host:

```env
API_BASE_URL=http://localhost:8000/api/v1
```

---

## Building for Distribution

```bash
# Build TypeScript first
npm run build

# Package for current platform
npm run pack

# Build installer for distribution
npm run dist
```

Output is placed in `release/`.

---

## Security Architecture

| Concern | Solution |
|---|---|
| `nodeIntegration` | `false` — renderer has no Node access |
| `contextIsolation` | `true` — renderer is sandboxed |
| API bridge | `contextBridge.exposeInMainWorld('electronAPI', ...)` |
| External navigation | Blocked via `will-navigate` handler |
| New windows | Blocked via `setWindowOpenHandler` |
| HTTP calls | Only in main process, token never exposed to renderer |

The renderer communicates **exclusively** through the typed `window.electronAPI` bridge.

---

## IPC Channel Reference

All channels use `ipcRenderer.invoke` / `ipcMain.handle` (request-response).

| Channel | Direction | Description |
|---|---|---|
| `auth:login` | R→M | Login with email+password |
| `auth:logout` | R→M | Clear token and state |
| `auth:getEmployee` | R→M | Get current employee object |
| `nav:showDashboard` | R→M | Switch to dashboard window |
| `nav:showLogin` | R→M | Switch to login window |
| `nav:minimize` | R→M | Minimize window |
| `nav:close` | R→M | Close window |
| `session:clockIn` | R→M | Clock in (collects geo + device automatically) |
| `session:clockOut` | R→M | Clock out |
| `session:getActive` | R→M | Get active session or null |
| `session:getMySessions` | R→M | List own sessions |
| `session:isClocked` | R→M | Boolean — currently clocked? |
| `tracking:getStats` | R→M | Get active/idle/keystroke counters |
| `admin:listEmployees` | R→M | List all employees |
| `admin:createEmployee` | R→M | Create new employee |
| `admin:updateEmployee` | R→M | Update employee fields |
| `admin:deactivateEmployee` | R→M | Deactivate account |
| `admin:reactivateEmployee` | R→M | Reactivate account |
| `admin:resetPassword` | R→M | Admin resets employee password |
| `admin:getSessions` | R→M | All sessions (admin) |
| `admin:getActivity` | R→M | All activity logs |
| `admin:getWebsite` | R→M | All website logs |
| `admin:getKeystrokes` | R→M | All keystroke logs |
| `admin:getSystemMetrics` | R→M | All system metrics |
| `admin:getSummary` | R→M | Productivity summaries |
| `admin:getEmployeeSummary` | R→M | Single employee summary |
| `system:getDeviceInfo` | R→M | OS, CPU, RAM, storage |
| `system:getNetworkInfo` | R→M | IP, SSID, MAC, connection type |

---

## Tracking Flow

```
Clock In
  └─ geo-IP lookup (ip-api.com)      → city, country, lat, lng
  └─ getDeviceInfo()                 → OS, CPU, RAM, storage
  └─ getNetworkInfo()                → IP, SSID, MAC
  └─ getNetworkSpeed() (download)    → Mbps

After Clock In — continuous:
  └─ activityTracker polls every 2s  → active window app + title
     └─ pushActivity() → buffer → batch POST every 30s
     └─ pushWebsite()  → domain extraction → batch POST every 30s

After Clock In — every 5 minutes:
  └─ getCpuUsage()     → POST /tracking/system-metrics
  └─ getMemoryUsage()  → POST /tracking/system-metrics
  └─ getNetworkSpeed() → POST /tracking/network-speed
  └─ sendKeystrokes()  → POST /tracking/keystrokes

Clock Out
  └─ activityTracker.stop() — flushes final window segment
  └─ trackingService.stop() — flushes buffers
  └─ POST /sessions/clock-out with total_active_time + total_idle_time
```

---

## Dashboard Pages

### Both Roles
- **Overview** — Session timer card, active/idle/keystroke stats, recent sessions
- **My Sessions** — Full session history with date filter
- **My Activity** — Apps, websites, keystroke count tabs

### Admin Only
- **Team** — Employee list with create/edit/deactivate/reset-password
- **Monitor** — Daily productivity summary for all employees, online count
- **Reports** — Full filterable logs for sessions, activity, websites, keystrokes, system metrics

---

## Default Admin

```
Email:    admin@avdevs.com
Password: 1234
```

(Seeded automatically by the backend on first startup)
