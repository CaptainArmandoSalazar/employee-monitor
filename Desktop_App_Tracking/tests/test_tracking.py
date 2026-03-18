import uuid
from datetime import datetime, timezone


def _setup(client, admin_headers):
    """Create employee, log in, clock in. Returns (emp_headers, session_id)."""
    email = f"track_{uuid.uuid4().hex[:6]}@test.com"
    client.post(
        "/api/v1/employees",
        json={
            "employee_name": "Tracker",
            "email": email,
            "password": "test1234",
            "department": "Dev",
            "role": "employee",
        },
        headers=admin_headers,
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "test1234"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    session_id = client.post(
        "/api/v1/sessions/clock-in", json={}, headers=headers
    ).json()["session_id"]
    return headers, session_id


def test_log_activity(client, admin_headers):
    headers, session_id = _setup(client, admin_headers)
    now = datetime.now(timezone.utc).isoformat()
    resp = client.post(
        "/api/v1/tracking/activity",
        json={
            "session_id": session_id,
            "app_name": "VS Code",
            "window_title": "main.py - employee_monitor",
            "start_time": now,
            "end_time": now,
            "duration": 120,
            "is_idle": False,
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["app_name"] == "VS Code"


def test_log_activity_batch(client, admin_headers):
    headers, session_id = _setup(client, admin_headers)
    now = datetime.now(timezone.utc).isoformat()
    resp = client.post(
        "/api/v1/tracking/activity/batch",
        json={
            "logs": [
                {"session_id": session_id, "app_name": "Chrome", "duration": 60},
                {"session_id": session_id, "app_name": "Slack",  "duration": 30},
            ]
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["saved"] == 2


def test_log_website(client, admin_headers):
    headers, session_id = _setup(client, admin_headers)
    resp = client.post(
        "/api/v1/tracking/website",
        json={
            "session_id": session_id,
            "url": "https://github.com",
            "domain": "github.com",
            "title": "GitHub",
            "duration": 200,
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["domain"] == "github.com"


def test_log_keystrokes(client, admin_headers):
    headers, session_id = _setup(client, admin_headers)
    resp = client.post(
        "/api/v1/tracking/keystrokes",
        json={"session_id": session_id, "keys_pressed_count": 342},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["keys_pressed_count"] == 342


def test_log_system_metrics(client, admin_headers):
    headers, session_id = _setup(client, admin_headers)
    resp = client.post(
        "/api/v1/tracking/system-metrics",
        json={"session_id": session_id, "cpu_usage": 34.5, "memory_usage": 61.2},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["cpu_usage"] == 34.5


def test_log_network_speed(client, admin_headers):
    headers, session_id = _setup(client, admin_headers)
    resp = client.post(
        "/api/v1/tracking/network-speed",
        json={
            "session_id": session_id,
            "download_speed": 95.3,
            "upload_speed": 48.1,
            "ping": 12.0,
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["ping"] == 12.0


def test_get_own_activity(client, admin_headers):
    headers, session_id = _setup(client, admin_headers)
    client.post(
        "/api/v1/tracking/activity",
        json={"session_id": session_id, "app_name": "Notepad", "duration": 10},
        headers=headers,
    )
    resp = client.get(f"/api/v1/tracking/activity?session_id={session_id}", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) >= 1
