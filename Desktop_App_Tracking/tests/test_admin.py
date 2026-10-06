import uuid


def _create_emp_with_session(client, admin_headers):
    email = f"adm_{uuid.uuid4().hex[:6]}@test.com"
    client.post(
        "/api/v1/employees",
        json={
            "employee_name": "Admin Target",
            "email": email,
            "password": "test1234",
            "department": "Sales",
            "role": "employee",
        },
        headers=admin_headers,
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "test1234"}
    ).json()["access_token"]
    emp_headers = {"Authorization": f"Bearer {token}"}
    session = client.post("/api/v1/sessions/clock-in", json={}, headers=emp_headers).json()
    return session["employee_id"], session["session_id"], emp_headers


def test_admin_summary(client, admin_headers):
    resp = client.get("/api/v1/admin/summary", headers=admin_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_admin_employee_summary(client, admin_headers):
    emp_id, _, _ = _create_emp_with_session(client, admin_headers)
    resp = client.get(f"/api/v1/admin/summary/{emp_id}", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_active_time" in data
    assert "top_apps" in data


def test_admin_sessions(client, admin_headers):
    emp_id, _, _ = _create_emp_with_session(client, admin_headers)
    resp = client.get(f"/api/v1/admin/sessions?employee_id={emp_id}", headers=admin_headers)
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_admin_activity(client, admin_headers):
    emp_id, session_id, emp_headers = _create_emp_with_session(client, admin_headers)
    client.post(
        "/api/v1/tracking/activity",
        json={"session_id": session_id, "app_name": "Excel", "duration": 90},
        headers=emp_headers,
    )
    resp = client.get(f"/api/v1/admin/activity?employee_id={emp_id}", headers=admin_headers)
    assert resp.status_code == 200
    assert any(r["app_name"] == "Excel" for r in resp.json())


def test_admin_website(client, admin_headers):
    emp_id, session_id, emp_headers = _create_emp_with_session(client, admin_headers)
    client.post(
        "/api/v1/tracking/website",
        json={"session_id": session_id, "domain": "stackoverflow.com", "duration": 45},
        headers=emp_headers,
    )
    resp = client.get(f"/api/v1/admin/website?employee_id={emp_id}", headers=admin_headers)
    assert resp.status_code == 200
    assert any(r["domain"] == "stackoverflow.com" for r in resp.json())


def test_admin_keystrokes(client, admin_headers):
    emp_id, session_id, emp_headers = _create_emp_with_session(client, admin_headers)
    client.post(
        "/api/v1/tracking/keystrokes",
        json={"session_id": session_id, "keys_pressed_count": 500},
        headers=emp_headers,
    )
    resp = client.get(f"/api/v1/admin/keystrokes?employee_id={emp_id}", headers=admin_headers)
    assert resp.status_code == 200
    assert any(r["keys_pressed_count"] == 500 for r in resp.json())


def test_admin_system_metrics(client, admin_headers):
    emp_id, session_id, emp_headers = _create_emp_with_session(client, admin_headers)
    client.post(
        "/api/v1/tracking/system-metrics",
        json={"session_id": session_id, "cpu_usage": 72.1, "memory_usage": 55.0},
        headers=emp_headers,
    )
    resp = client.get(f"/api/v1/admin/system-metrics?employee_id={emp_id}", headers=admin_headers)
    assert resp.status_code == 200
    assert any(r["cpu_usage"] == 72.1 for r in resp.json())


def test_admin_route_blocked_for_employee(client, admin_headers):
    email = f"nonadmin_{uuid.uuid4().hex[:6]}@test.com"
    client.post(
        "/api/v1/employees",
        json={
            "employee_name": "Regular",
            "email": email,
            "password": "test1234",
            "role": "employee",
        },
        headers=admin_headers,
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "test1234"}
    ).json()["access_token"]
    resp = client.get(
        "/api/v1/admin/summary",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_admin_live_overview(client, admin_headers):
    emp_id, session_id, emp_headers = _create_emp_with_session(client, admin_headers)
    client.post(
        "/api/v1/tracking/activity",
        json={"session_id": session_id, "app_name": "Zoom", "duration": 300, "is_idle": False},
        headers=emp_headers,
    )
    resp = client.get("/api/v1/admin/live-overview", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_employees" in data
    assert "online_employees" in data
    assert "active_sessions" in data


def test_admin_activity_timeline_and_idle_analysis(client, admin_headers):
    emp_id, session_id, emp_headers = _create_emp_with_session(client, admin_headers)
    client.post(
        "/api/v1/tracking/activity",
        json={"session_id": session_id, "app_name": "Slack", "duration": 1800, "is_idle": True},
        headers=emp_headers,
    )
    timeline_resp = client.get(f"/api/v1/admin/activity-timeline?employee_id={emp_id}", headers=admin_headers)
    assert timeline_resp.status_code == 200
    assert isinstance(timeline_resp.json(), list)

    idle_resp = client.get(f"/api/v1/admin/idle-analysis?employee_id={emp_id}", headers=admin_headers)
    assert idle_resp.status_code == 200
    assert isinstance(idle_resp.json(), list)


def test_admin_network_risk_and_offline_sync(client, admin_headers):
    emp_id, session_id, emp_headers = _create_emp_with_session(client, admin_headers)
    client.post(
        "/api/v1/sessions/network-info",
        json={"session_id": session_id, "ip_address": "10.0.0.1", "connection_type": "wifi", "ssid": "public-hotspot"},
        headers=emp_headers,
    )
    risk_resp = client.get("/api/v1/admin/network-risk", headers=admin_headers)
    assert risk_resp.status_code == 200
    assert isinstance(risk_resp.json(), list)

    sync_resp = client.post(
        "/api/v1/sessions/offline-sync/queue",
        json={"event_type": "activity", "payload": {"app_name": "Browser", "duration": 30}, "device_id": "device-123"},
        headers=emp_headers,
    )
    assert sync_resp.status_code == 200
    payload = sync_resp.json()
    assert payload["status"] == "queued"
    assert payload["event_type"] == "activity"
