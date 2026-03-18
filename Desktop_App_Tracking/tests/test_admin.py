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
