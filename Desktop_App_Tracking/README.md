# Employee Monitor — FastAPI Backend

Production-ready REST API for the Employee Monitoring desktop application.
Built with **FastAPI**, **PostgreSQL**, **SQLAlchemy 2**, and **Pydantic v2**.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Project Structure](#project-structure)
3. [Environment Variables](#environment-variables)
4. [Database Setup](#database-setup)
5. [Running the Server](#running-the-server)
6. [API Reference](#api-reference)
7. [Authentication Flow](#authentication-flow)
8. [Role-Based Access](#role-based-access)
9. [Tracking Flow (Desktop Client)](#tracking-flow-desktop-client)
10. [Alembic Migrations](#alembic-migrations)
11. [Running Tests](#running-tests)
12. [Architecture Notes](#architecture-notes)

---

## Quick Start

```bash
# 1. Clone / extract the project
cd employee_monitor_backend

# 2. Create a virtual environment
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure the environment
cp .env .env.local                # edit .env with your DB credentials

# 5. Start the server
python run.py
```

The API will be live at **http://localhost:8000**
Interactive docs: **http://localhost:8000/docs**

> **Default admin is auto-seeded on first startup:**
> Email: `admin@avdevs.com` | Password: `1234`

---

## Project Structure

```
employee_monitor_backend/
│
├── app/
│   ├── main.py                   # FastAPI app, middleware, lifespan
│   │
│   ├── core/
│   │   ├── config.py             # Pydantic settings (reads .env)
│   │   ├── database.py           # SQLAlchemy engine + session factory
│   │   ├── security.py           # JWT creation/verification, bcrypt
│   │   ├── exceptions.py         # Custom HTTP exception classes
│   │   └── middleware.py         # Request logging middleware
│   │
│   ├── models/                   # SQLAlchemy ORM models (one per table)
│   │   ├── employee.py
│   │   ├── session.py
│   │   ├── device.py             # DeviceInfo + Device (master)
│   │   ├── network.py            # NetworkInfo + NetworkSpeedLog
│   │   ├── activity.py
│   │   ├── system_metrics.py
│   │   ├── keystroke.py
│   │   └── website.py
│   │
│   ├── schemas/                  # Pydantic v2 request/response schemas
│   │   ├── employee.py
│   │   ├── session.py
│   │   ├── device.py
│   │   ├── tracking.py           # Activity, Website, Keystrokes, Metrics, Speed
│   │   ├── password.py
│   │   └── common.py
│   │
│   ├── api/
│   │   ├── deps.py               # JWT auth dependency + role guard
│   │   └── routes/
│   │       ├── auth.py           # /auth/login, /auth/me
│   │       ├── employee.py       # CRUD + password management
│   │       ├── session.py        # clock-in, clock-out, device/network info
│   │       ├── tracking.py       # All 5 tracking endpoints (+ batch)
│   │       └── admin.py          # Admin-only reports and filters
│   │
│   ├── services/                 # Business logic layer
│   │   ├── auth_service.py       # Authenticate + seed default admin
│   │   ├── employee_service.py   # Employee CRUD operations
│   │   ├── session_service.py    # Clock-in/out, device & network capture
│   │   ├── tracking_service.py   # All tracking inserts + queries
│   │   └── analytics_service.py  # Productivity summaries
│   │
│   ├── workers/
│   │   └── background_tasks.py   # Async task: auto-close stale sessions
│   │
│   └── utils/
│       ├── logger.py             # Structured stdout logger
│       └── helpers.py            # utcnow(), seconds_to_hms(), etc.
│
├── alembic/                      # Database migration scripts
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│
├── tests/
│   ├── conftest.py               # Pytest fixtures (SQLite in-memory)
│   ├── test_auth.py
│   ├── test_employees.py
│   ├── test_sessions.py
│   ├── test_tracking.py
│   └── test_admin.py
│
├── alembic.ini
├── requirements.txt
├── run.py
└── .env
```

---

## Environment Variables

Edit `.env` before running:

```env
DATABASE_URL=postgresql+psycopg2://postgres:PASSWORD@localhost:5432/employee_monitor_newer
SECRET_KEY=your-super-secret-key-change-in-production-min-32-chars
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480          # 8 hours

DEFAULT_ADMIN_EMAIL=admin@avdevs.com
DEFAULT_ADMIN_PASSWORD=1234
DEFAULT_ADMIN_NAME=Super Admin
DEFAULT_ADMIN_DEPARTMENT=IT
```

---

## Database Setup

### Option A — Let the app create tables (recommended for first run)

`Base.metadata.create_all()` is called automatically at startup.
All tables will be created if they don't exist yet.

### Option B — Alembic migrations (recommended for production)

```bash
# Generate initial migration from current models
alembic revision --autogenerate -m "initial schema"

# Apply it
alembic upgrade head
```

After any model change:

```bash
alembic revision --autogenerate -m "describe your change"
alembic upgrade head
```

Rollback one migration:

```bash
alembic downgrade -1
```

---

## Running the Server

```bash
# Development (auto-reload)
python run.py

# Production with Gunicorn + Uvicorn workers
pip install gunicorn
gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8000
```

---

## API Reference

All endpoints are prefixed with `/api/v1`.

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | Public | Login, get JWT token |
| GET | `/auth/me` | Any | Get current user profile |

**Login request:**
```json
{ "email": "admin@avdevs.com", "password": "1234" }
```

**Login response:**
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "employee": { "employee_id": "...", "role": "admin", ... }
}
```

---

### Employees

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/employees` | Admin | Create employee |
| GET | `/employees` | Admin | List all employees |
| GET | `/employees/me` | Any | Own profile |
| GET | `/employees/{id}` | Any* | Get employee by ID |
| PATCH | `/employees/{id}` | Admin | Update employee |
| DELETE | `/employees/{id}` | Admin | Deactivate employee |
| PATCH | `/employees/{id}/reactivate` | Admin | Reactivate employee |
| POST | `/employees/me/change-password` | Any | Self password change |
| POST | `/employees/{id}/reset-password` | Admin | Admin resets password |

*Employees can only fetch their own profile.

**Create employee body:**
```json
{
  "employee_name": "Jane Doe",
  "email": "jane@company.com",
  "password": "securepass",
  "department": "Engineering",
  "role": "employee"
}
```

---

### Sessions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/sessions/clock-in` | Any | Start a session |
| POST | `/sessions/clock-out` | Any | End a session |
| GET | `/sessions/active` | Any | Get own active session |
| GET | `/sessions/my` | Any | Own session history |
| GET | `/sessions` | Admin | All sessions (filterable) |
| GET | `/sessions/{id}` | Any* | Get single session |
| POST | `/sessions/device-info` | Any | Save device info at clock-in |
| POST | `/sessions/network-info` | Any | Save network info at clock-in |

**Clock-in body:**
```json
{
  "ip_address": "192.168.1.10",
  "latitude": 22.307,
  "longitude": 73.181,
  "city": "Vadodara",
  "country": "India",
  "location": "Vadodara, India",
  "network_speed_start": 95.5,
  "device_id": "DESKTOP-ABC123"
}
```

**Clock-out body:**
```json
{
  "session_id": "uuid-here",
  "total_active_time": 18000,
  "total_idle_time": 1200
}
```

---

### Tracking

All tracking endpoints require a valid JWT. Employees can only read their own data.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tracking/activity` | Log one activity window |
| POST | `/tracking/activity/batch` | Batch insert activity logs |
| GET | `/tracking/activity` | Read own activity |
| POST | `/tracking/website` | Log one website visit |
| POST | `/tracking/website/batch` | Batch insert website logs |
| GET | `/tracking/website` | Read own website logs |
| POST | `/tracking/keystrokes` | Log keystroke count |
| GET | `/tracking/keystrokes` | Read own keystroke logs |
| POST | `/tracking/system-metrics` | Log CPU/memory snapshot |
| GET | `/tracking/system-metrics` | Read own metrics |
| POST | `/tracking/network-speed` | Log network speed snapshot |
| GET | `/tracking/network-speed` | Read own speed logs |

**Activity log body:**
```json
{
  "session_id": "uuid",
  "app_name": "VS Code",
  "window_title": "main.py - my_project",
  "start_time": "2025-01-01T09:00:00Z",
  "end_time": "2025-01-01T09:05:00Z",
  "duration": 300,
  "is_idle": false
}
```

**System metrics body (send every 5 minutes):**
```json
{
  "session_id": "uuid",
  "cpu_usage": 34.5,
  "memory_usage": 61.2
}
```

**Network speed body (send every 5 minutes):**
```json
{
  "session_id": "uuid",
  "download_speed": 95.3,
  "upload_speed": 48.1,
  "ping": 12.0
}
```

---

### Admin

All admin endpoints require `role = admin`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/summary` | All employees productivity summary |
| GET | `/admin/summary/{employee_id}` | Single employee summary |
| GET | `/admin/session-metrics/{session_id}` | Avg CPU/memory for a session |
| GET | `/admin/sessions` | All sessions (filter by employee, date, status) |
| GET | `/admin/activity` | All activity logs |
| GET | `/admin/website` | All website logs |
| GET | `/admin/keystrokes` | All keystroke logs |
| GET | `/admin/system-metrics` | All system metric snapshots |
| GET | `/admin/network-speed` | All network speed logs |
| GET | `/admin/device-info` | All device info records |
| GET | `/admin/network-info` | All network info records |
| GET | `/admin/devices` | Device master registry |

**Common query params for admin list endpoints:**
- `employee_id` — filter by specific employee
- `session_id` — filter by specific session
- `skip` / `limit` — pagination

---

## Authentication Flow

```
1. POST /api/v1/auth/login
   Body: { email, password }
   Response: { access_token, employee }

2. Include in all subsequent requests:
   Header: Authorization: Bearer <access_token>

3. Token expires after ACCESS_TOKEN_EXPIRE_MINUTES (default 480 = 8h)
```

---

## Role-Based Access

| Feature | Employee | Admin |
|---------|----------|-------|
| Login | ✅ | ✅ |
| View own profile | ✅ | ✅ |
| Clock in / out | ✅ | ✅ |
| Track own activity | ✅ | ✅ |
| View own sessions | ✅ | ✅ |
| Create employees | ❌ | ✅ |
| View all employees | ❌ | ✅ |
| View all sessions | ❌ | ✅ |
| View all activity | ❌ | ✅ |
| Productivity reports | ❌ | ✅ |
| Reset any password | ❌ | ✅ |

---

## Tracking Flow (Desktop Client)

This is the recommended sequence the Electron app should follow:

```
1. POST /auth/login              → receive JWT

2. POST /sessions/clock-in       → receive session_id
   (send IP, location, device_id, network_speed_start)

3. POST /sessions/device-info    → send OS, CPU, RAM, storage
4. POST /sessions/network-info   → send SSID, MAC, connection type

── Every 5 minutes ──────────────────────────────────────────
5. POST /tracking/system-metrics  → CPU %, memory %
6. POST /tracking/network-speed   → download, upload, ping

── Continuous / on window change ────────────────────────────
7. POST /tracking/activity/batch  → array of window focus events
8. POST /tracking/website/batch   → array of URL visits
9. POST /tracking/keystrokes      → keys_pressed_count for interval

── On clock-out ─────────────────────────────────────────────
10. POST /sessions/clock-out      → send session_id, active/idle totals
```

---

## Running Tests

Tests use SQLite (no Postgres required):

```bash
pip install pytest httpx pytest-asyncio
pytest tests/ -v
```

Run a specific file:
```bash
pytest tests/test_auth.py -v
pytest tests/test_tracking.py -v
```

---

## Architecture Notes

- **Clean layering:** Routes → Services → Models. Routes never touch the DB directly.
- **No double clock-in:** `clock_in()` returns the existing active session silently.
- **Stale session cleanup:** Background worker auto-closes sessions open for 12+ hours.
- **Batch inserts:** `/tracking/activity/batch` and `/tracking/website/batch` accept arrays, reducing round trips from the desktop client.
- **Pagination:** All list endpoints support `skip` + `limit` query params.
- **Global exception handler:** Catches unhandled errors and returns clean JSON (no stack traces to client).
- **Request logging:** Every non-health request is logged with method, path, status, and duration.
