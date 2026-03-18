import uuid


def _make_employee_and_login(client, admin_headers):
    email = f"sess_{uuid.uuid4().hex[:6]}@test.com"
    client.post(
        "/api/v1/employees",
        json={
            "employee_name": "Session Tester",
            "email": email,
            "password": "test1234",
            "department": "QA",
            "role": "employee",
        },
        headers=admin_headers,
    )
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "test1234"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_clock_in(client, admin_headers):
    headers = _make_employee_and_login(client, admin_headers)
    resp = client.post(
        "/api/v1/sessions/clock-in",
        json={
            "ip_address": "192.168.1.10",
            "city": "Vadodara",
            "country": "India",
            "latitude": 22.307,
            "longitude": 73.181,
            "network_speed_start": 50.5,
            "device_id": "DEV-001",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_status"] == "active"
    assert data["city"] == "Vadodara"
    return data, headers


def test_double_clock_in_returns_same_session(client, admin_headers):
    headers = _make_employee_and_login(client, admin_headers)
    r1 = client.post("/api/v1/sessions/clock-in", json={}, headers=headers)
    r2 = client.post("/api/v1/sessions/clock-in", json={}, headers=headers)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["session_id"] == r2.json()["session_id"]


def test_get_active_session(client, admin_headers):
    headers = _make_employee_and_login(client, admin_headers)
    client.post("/api/v1/sessions/clock-in", json={}, headers=headers)
    resp = client.get("/api/v1/sessions/active", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["session_status"] == "active"


def test_clock_out(client, admin_headers):
    headers = _make_employee_and_login(client, admin_headers)
    clock_in = client.post("/api/v1/sessions/clock-in", json={}, headers=headers).json()
    session_id = clock_in["session_id"]

    resp = client.post(
        "/api/v1/sessions/clock-out",
        json={"session_id": session_id, "total_active_time": 3600, "total_idle_time": 300},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_status"] == "completed"
    assert data["total_active_time"] == 3600


def test_my_sessions(client, admin_headers):
    headers = _make_employee_and_login(client, admin_headers)
    client.post("/api/v1/sessions/clock-in", json={}, headers=headers)
    resp = client.get("/api/v1/sessions/my", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_clock_out_wrong_session(client, admin_headers):
    headers = _make_employee_and_login(client, admin_headers)
    resp = client.post(
        "/api/v1/sessions/clock-out",
        json={"session_id": str(uuid.uuid4()), "total_active_time": 0},
        headers=headers,
    )
    assert resp.status_code == 404
