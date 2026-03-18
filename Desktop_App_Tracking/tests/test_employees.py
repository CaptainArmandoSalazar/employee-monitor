import uuid


def _create_employee(client, admin_headers, email=None, role="employee"):
    email = email or f"emp_{uuid.uuid4().hex[:6]}@test.com"
    resp = client.post(
        "/api/v1/employees",
        json={
            "employee_name": "Test User",
            "email": email,
            "password": "test1234",
            "department": "Engineering",
            "role": role,
        },
        headers=admin_headers,
    )
    return resp


def test_create_employee(client, admin_headers):
    resp = _create_employee(client, admin_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["role"] == "employee"
    assert data["status"] is True


def test_create_duplicate_email(client, admin_headers):
    email = f"dup_{uuid.uuid4().hex[:6]}@test.com"
    _create_employee(client, admin_headers, email=email)
    resp = _create_employee(client, admin_headers, email=email)
    assert resp.status_code == 409


def test_list_employees_admin(client, admin_headers):
    resp = client.get("/api/v1/employees", headers=admin_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_list_employees_forbidden_for_employee(client, admin_headers):
    # Create an employee then try to list
    email = f"nolist_{uuid.uuid4().hex[:6]}@test.com"
    _create_employee(client, admin_headers, email=email)
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "test1234"})
    token = login.json()["access_token"]
    resp = client.get("/api/v1/employees", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_get_own_profile(client, admin_headers):
    email = f"self_{uuid.uuid4().hex[:6]}@test.com"
    _create_employee(client, admin_headers, email=email)
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "test1234"})
    token = login.json()["access_token"]
    resp = client.get("/api/v1/employees/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == email


def test_deactivate_employee(client, admin_headers):
    emp = _create_employee(client, admin_headers).json()
    emp_id = emp["employee_id"]
    resp = client.delete(f"/api/v1/employees/{emp_id}", headers=admin_headers)
    assert resp.status_code == 204
