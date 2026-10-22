import uuid


def _create_user(client, admin_headers, role, manager_id=None):
    email = f"{role}_{uuid.uuid4().hex[:8]}@test.com"
    response = client.post(
        "/api/v1/employees",
        headers=admin_headers,
        json={
            "employee_name": f"Test {role}",
            "email": email,
            "password": "TestPass!123",
            "role": role,
            "manager_id": manager_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json(), email


def _login(client, email):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "TestPass!123"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_role_catalog_limits_manager_and_employee(client, admin_headers):
    manager = client.get(
        "/api/v1/permissions/catalog?role=manager",
        headers=admin_headers,
    )
    employee = client.get(
        "/api/v1/permissions/catalog?role=employee",
        headers=admin_headers,
    )

    assert manager.status_code == 200
    assert {
        permission["key"]
        for module in manager.json()
        for permission in module["permissions"]
    } == {
        "employee.view",
        "employee.create.employee",
        "employee.deactivate",
        "employee.reactivate",
    }
    assert manager.json()[0]["permissions"][0]["label"] == "View own and team data"

    assert employee.status_code == 200
    assert [
        permission["key"]
        for module in employee.json()
        for permission in module["permissions"]
    ] == ["employee.view"]
    assert employee.json()[0]["permissions"][0]["label"] == "View my own data"


def test_role_permission_update_rejects_global_manager_and_employee_permissions(
    client, admin_headers
):
    for role in ("manager", "employee"):
        response = client.patch(
            f"/api/v1/permissions/roles/{role}",
            headers=admin_headers,
            json={"permissions": ["employee.update"]},
        )
        assert response.status_code == 400


def test_required_data_access_cannot_be_removed(client, admin_headers):
    for role in ("manager", "employee"):
        response = client.patch(
            f"/api/v1/permissions/roles/{role}",
            headers=admin_headers,
            json={"permissions": []},
        )
        assert response.status_code == 400


def test_manager_view_permission_is_limited_to_direct_reports(
    client, admin_headers
):
    manager, manager_email = _create_user(client, admin_headers, "manager")
    team_member, _ = _create_user(
        client, admin_headers, "employee", manager["employee_id"]
    )
    manager_report, _ = _create_user(
        client, admin_headers, "manager", manager["employee_id"]
    )
    other_member, _ = _create_user(client, admin_headers, "employee")

    manager_headers = _login(client, manager_email)
    team_list = client.get(
        "/api/v1/employees?role=employee&active_only=false",
        headers=manager_headers,
    )
    assert team_list.status_code == 200
    assert [row["employee_id"] for row in team_list.json()] == [
        team_member["employee_id"]
    ]
    manager_account = client.get(
        f"/api/v1/employees/{manager_report['employee_id']}",
        headers=manager_headers,
    )
    assert manager_account.status_code == 403
    manager_delete = client.delete(
        f"/api/v1/employees/{manager_report['employee_id']}",
        headers=manager_headers,
    )
    assert manager_delete.status_code == 403

    own_team_sessions = client.get(
        f"/api/v1/admin/sessions?employee_id={team_member['employee_id']}",
        headers=manager_headers,
    )
    outside_team_sessions = client.get(
        f"/api/v1/admin/sessions?employee_id={other_member['employee_id']}",
        headers=manager_headers,
    )
    assert own_team_sessions.status_code == 200
    assert outside_team_sessions.status_code == 403


def test_employee_view_permission_does_not_expose_direct_reports(
    client, admin_headers
):
    employee, email = _create_user(client, admin_headers, "employee")
    report, _ = _create_user(client, admin_headers, "employee", employee["employee_id"])

    headers = _login(client, email)
    response = client.get(
        "/api/v1/employees?role=employee&active_only=false",
        headers=headers,
    )
    own_profile = client.get("/api/v1/employees/me", headers=headers)

    assert response.status_code == 403
    assert own_profile.status_code == 200
    assert own_profile.json()["employee_id"] == employee["employee_id"]
    assert report["employee_id"] != own_profile.json()["employee_id"]
