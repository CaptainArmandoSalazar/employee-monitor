def test_default_seed_credentials_are_not_hardcoded():
    from app.core.config import settings

    assert settings.DEFAULT_ADMIN_EMAIL.strip() != "admin@avdevs.com"
    assert settings.DEFAULT_ADMIN_PASSWORD.strip() != "1234"


from app.core.config import settings


def test_login_success(client):
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": settings.DEFAULT_ADMIN_EMAIL, "password": settings.DEFAULT_ADMIN_PASSWORD},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["employee"]["role"] == "super_admin"


def test_login_wrong_password(client):
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": settings.DEFAULT_ADMIN_EMAIL, "password": "wrong"},
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
    assert resp.json()["email"] == settings.DEFAULT_ADMIN_EMAIL


def test_me_no_token(client):
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 403  # HTTPBearer returns 403 when header missing


def test_me_invalid_uuid_subject(client):
    from app.core.security import create_access_token

    token = create_access_token({"sub": "not-a-uuid"})
    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid token payload"
