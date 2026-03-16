#!/usr/bin/env python3
"""
===================================================================
  Employee Monitor – One-Shot Database Setup Script
  Run:  python setup_database.py
===================================================================
This script will:
  1. Create the PostgreSQL database if it doesn't exist
  2. Create all tables using SQLAlchemy models
  3. Seed a default Admin account
  4. Seed sample Employee accounts (optional)
===================================================================
Prerequisites:
  pip install -r requirements.txt
  PostgreSQL running with the credentials in DB_* vars below
===================================================================
"""

import os
import sys
import uuid
from datetime import datetime, timezone

# ─── Database connection config ───────────────────────────────────────────────
DB_USER     = os.getenv("DB_USER",     "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
DB_HOST     = os.getenv("DB_HOST",     "localhost")
DB_PORT     = os.getenv("DB_PORT",     "5432")
DB_NAME     = os.getenv("DB_NAME",     "employee_monitor")

DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# ─── Default seed data ────────────────────────────────────────────────────────
DEFAULT_ADMIN = {
    "email":     "admin@company.com",
    "full_name": "System Administrator",
    "password":  "Admin@123456",      # ← CHANGE IN PRODUCTION
    "role":      "admin",
    "department": "IT",
}

SAMPLE_EMPLOYEES = [
    {
        "email":     "alice@company.com",
        "full_name": "Alice Johnson",
        "password":  "Employee@123",
        "role":      "employee",
        "department": "Engineering",
    },
    {
        "email":     "bob@company.com",
        "full_name": "Bob Smith",
        "password":  "Employee@123",
        "role":      "employee",
        "department": "Marketing",
    },
]

SEED_SAMPLE_EMPLOYEES = True   # Set False to skip sample employees


# ─── Setup ────────────────────────────────────────────────────────────────────

def create_database_if_not_exists():
    """Connect to postgres db and create the target database if missing."""
    import psycopg2
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

    print(f"[1/4] Connecting to PostgreSQL as '{DB_USER}' on {DB_HOST}:{DB_PORT} ...")
    try:
        conn = psycopg2.connect(
            dbname="postgres",
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT,
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM pg_catalog.pg_database WHERE datname = %s", (DB_NAME,))
        exists = cur.fetchone()
        if not exists:
            cur.execute(f'CREATE DATABASE "{DB_NAME}"')
            print(f"    ✓ Database '{DB_NAME}' created.")
        else:
            print(f"    ✓ Database '{DB_NAME}' already exists.")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"    ✗ Failed to connect / create database: {e}")
        sys.exit(1)


def create_tables():
    """Create all tables via SQLAlchemy metadata."""
    from sqlalchemy import create_engine
    from app.db.session import Base
    from app.models.models import (  # noqa: F401
        User, RefreshToken, AttendanceRecord,
        ActivityLog, WebsiteLog, KeystrokeLog, NetworkLog
    )

    print("[2/4] Creating tables ...")
    try:
        engine = create_engine(DATABASE_URL, echo=False)
        Base.metadata.create_all(bind=engine)
        print("    ✓ All tables created (or already exist).")
        return engine
    except Exception as e:
        print(f"    ✗ Failed to create tables: {e}")
        sys.exit(1)


def seed_users(engine):
    """Insert default admin + optional sample employees."""
    from sqlalchemy.orm import sessionmaker
    from passlib.context import CryptContext
    from app.models.models import User, UserRole

    print("[3/4] Seeding users ...")
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    Session = sessionmaker(bind=engine)
    db = Session()

    users_to_create = [DEFAULT_ADMIN]
    if SEED_SAMPLE_EMPLOYEES:
        users_to_create.extend(SAMPLE_EMPLOYEES)

    created = 0
    for u in users_to_create:
        existing = db.query(User).filter(User.email == u["email"]).first()
        if existing:
            print(f"    – {u['email']} already exists, skipping.")
            continue

        role = UserRole.ADMIN if u["role"] == "admin" else UserRole.EMPLOYEE
        user = User(
            id=uuid.uuid4(),
            email=u["email"],
            full_name=u["full_name"],
            hashed_password=pwd_context.hash(u["password"]),
            role=role,
            department=u.get("department"),
            is_active=True,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(user)
        created += 1
        print(f"    ✓ Created [{u['role']}] {u['email']}")

    db.commit()
    db.close()
    print(f"    ✓ {created} new user(s) seeded.")


def print_summary():
    print("\n" + "=" * 60)
    print("  ✅  Database setup complete!")
    print("=" * 60)
    print(f"  Database   : {DB_NAME}")
    print(f"  Host       : {DB_HOST}:{DB_PORT}")
    print(f"  Admin      : {DEFAULT_ADMIN['email']}")
    print(f"  Password   : {DEFAULT_ADMIN['password']}")
    print()
    print("  Tables created:")
    tables = [
        "users", "refresh_tokens", "attendance_records",
        "activity_logs", "website_logs", "keystroke_logs", "network_logs"
    ]
    for t in tables:
        print(f"    • {t}")
    print()
    print("  Start the server:")
    print("    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000")
    print()
    print("  API Docs:")
    print("    http://localhost:8000/docs")
    print("=" * 60 + "\n")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Make sure imports work from project root
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    # Patch DATABASE_URL into environment so app.core.config picks it up
    os.environ.setdefault("DATABASE_URL", DATABASE_URL)

    print()
    print("=" * 60)
    print("  Employee Monitor – Database Setup")
    print("=" * 60)

    create_database_if_not_exists()
    engine = create_tables()
    seed_users(engine)
    print("[4/4] Finalizing ...")
    print("    ✓ Done.")
    print_summary()