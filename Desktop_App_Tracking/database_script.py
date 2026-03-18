# db_init.py

from sqlalchemy import (
    create_engine, MetaData, Table, Column,
    String, Integer, Float, Boolean, Text, Date, TIMESTAMP, ForeignKey
)
from sqlalchemy.dialects.postgresql import UUID
import uuid

# ==============================
# CONFIG (CHANGE THIS)
# ==============================
DATABASE_URL = "postgresql+psycopg2://postgres:sohamsoni22@localhost:5432/employee_monitor_newer"

engine = create_engine(DATABASE_URL)
metadata = MetaData()

# ==============================
# 1️⃣ EMPLOYEES TABLE
# ==============================
employees = Table(
    "employees",
    metadata,
    Column("employee_id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("employee_name", String),
    Column("email", String, unique=True),
    Column("password_hash", Text),
    Column("department", String),
    Column("role", String),  # admin / employee
    Column("created_by", UUID(as_uuid=True)),
    Column("date_of_joining", Date),
    Column("status", Boolean),
    Column("created_at", TIMESTAMP),
)

# ==============================
# 2️⃣ SESSIONS TABLE (CORE)
# ==============================
sessions = Table(
    "sessions",
    metadata,
    Column("session_id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("employee_id", UUID(as_uuid=True), ForeignKey("employees.employee_id")),
    Column("date", Date),
    Column("clock_in", TIMESTAMP),
    Column("clock_out", TIMESTAMP),
    Column("total_active_time", Integer),
    Column("total_idle_time", Integer),
    Column("session_status", String),

    # NEW FIELDS
    Column("ip_address", String),
    Column("location", String),
    Column("latitude", Float),
    Column("longitude", Float),
    Column("city", String),
    Column("country", String),
    Column("network_speed_start", Float),
    Column("device_id", String),
)

# ==============================
# 3️⃣ DEVICE INFO
# ==============================
device_info = Table(
    "device_info",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("session_id", UUID(as_uuid=True), ForeignKey("sessions.session_id")),
    Column("employee_id", UUID(as_uuid=True), ForeignKey("employees.employee_id")),
    Column("device_id", String),
    Column("device_name", String),
    Column("os", String),
    Column("cpu", String),
    Column("ram", String),
    Column("storage_total", Integer),
    Column("storage_free", Integer),
    Column("captured_at", TIMESTAMP),
)

# ==============================
# 4️⃣ NETWORK INFO
# ==============================
network_info = Table(
    "network_info",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("session_id", UUID(as_uuid=True), ForeignKey("sessions.session_id")),
    Column("employee_id", UUID(as_uuid=True), ForeignKey("employees.employee_id")),
    Column("ip_address", String),
    Column("connection_type", String),
    Column("ssid", String),
    Column("mac_address", String),
    Column("captured_at", TIMESTAMP),
)

# ==============================
# 5️⃣ NETWORK SPEED LOGS
# ==============================
network_speed_logs = Table(
    "network_speed_logs",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("session_id", UUID(as_uuid=True), ForeignKey("sessions.session_id")),
    Column("employee_id", UUID(as_uuid=True), ForeignKey("employees.employee_id")),
    Column("download_speed", Float),
    Column("upload_speed", Float),
    Column("ping", Float),
    Column("timestamp", TIMESTAMP),
)

# ==============================
# 6️⃣ SYSTEM METRICS
# ==============================
system_metrics = Table(
    "system_metrics",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("session_id", UUID(as_uuid=True), ForeignKey("sessions.session_id")),
    Column("employee_id", UUID(as_uuid=True), ForeignKey("employees.employee_id")),
    Column("cpu_usage", Float),
    Column("memory_usage", Float),
    Column("timestamp", TIMESTAMP),
)

# ==============================
# 7️⃣ ACTIVITY LOGS
# ==============================
activity_logs = Table(
    "activity_logs",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("session_id", UUID(as_uuid=True), ForeignKey("sessions.session_id")),
    Column("employee_id", UUID(as_uuid=True), ForeignKey("employees.employee_id")),
    Column("app_name", String),
    Column("window_title", Text),
    Column("start_time", TIMESTAMP),
    Column("end_time", TIMESTAMP),
    Column("duration", Integer),
    Column("is_idle", Boolean),
)

# ==============================
# 8️⃣ WEBSITE LOGS
# ==============================
website_logs = Table(
    "website_logs",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("session_id", UUID(as_uuid=True), ForeignKey("sessions.session_id")),
    Column("employee_id", UUID(as_uuid=True), ForeignKey("employees.employee_id")),
    Column("url", Text),
    Column("domain", String),
    Column("title", Text),
    Column("duration", Integer),
    Column("timestamp", TIMESTAMP),
)

# ==============================
# 🔟 KEYSTROKES
# ==============================
keystrokes = Table(
    "keystrokes",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("session_id", UUID(as_uuid=True), ForeignKey("sessions.session_id")),
    Column("employee_id", UUID(as_uuid=True), ForeignKey("employees.employee_id")),
    Column("keys_pressed_count", Integer),
    Column("raw_keystrokes", Text),
    Column("timestamp", TIMESTAMP),
)

# ==============================
# 11️⃣ DEVICES MASTER TABLE
# ==============================
devices = Table(
    "devices",
    metadata,
    Column("device_id", String, primary_key=True),
    Column("employee_id", UUID(as_uuid=True), ForeignKey("employees.employee_id")),
    Column("device_name", String),
    Column("os", String),
    Column("first_seen", TIMESTAMP),
    Column("last_seen", TIMESTAMP),
    Column("status", String),
)

# ==============================
# CREATE ALL TABLES
# ==============================
def create_database():
    print("🚀 Creating all tables...")
    metadata.create_all(engine)
    print("✅ Database created successfully!")


if __name__ == "__main__":
    create_database()