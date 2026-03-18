def test_login_success(client):
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@avdevs.com", "password": "1234"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["employee"]["role"] == "admin"


def test_login_wrong_password(client):
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@avdevs.com", "password": "wrong"},
    )
    assert resp.status_code == 401


def test_login_unknown_email(client):
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "anything"},
    )
    assert resp.status_code == 401


def test_me(client, admin_headers):
    resp = client.get("/api/v1/auth/me", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == "admin@avdevs.com"


def test_me_no_token(client):
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 403  # HTTPBearer returns 403 when header missing
