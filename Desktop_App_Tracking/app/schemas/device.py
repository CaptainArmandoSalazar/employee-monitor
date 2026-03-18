from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class DeviceInfoCreate(BaseModel):
    session_id: UUID
    device_id: Optional[str] = None
    device_name: Optional[str] = None
    os: Optional[str] = None
    cpu: Optional[str] = None
    ram: Optional[str] = None
    storage_total: Optional[int] = None
    storage_free: Optional[int] = None


class DeviceInfoOut(BaseModel):
    id: UUID
    session_id: UUID
    employee_id: UUID
    device_id: Optional[str]
    device_name: Optional[str]
    os: Optional[str]
    cpu: Optional[str]
    ram: Optional[str]
    storage_total: Optional[int]
    storage_free: Optional[int]
    captured_at: Optional[datetime]

    class Config:
        from_attributes = True


class NetworkInfoCreate(BaseModel):
    session_id: UUID
    ip_address: Optional[str] = None
    connection_type: Optional[str] = None
    ssid: Optional[str] = None
    mac_address: Optional[str] = None


class NetworkInfoOut(BaseModel):
    id: UUID
    session_id: UUID
    employee_id: UUID
    ip_address: Optional[str]
    connection_type: Optional[str]
    ssid: Optional[str]
    mac_address: Optional[str]
    captured_at: Optional[datetime]

    class Config:
        from_attributes = True


class DeviceMasterOut(BaseModel):
    device_id: str
    employee_id: UUID
    device_name: Optional[str]
    os: Optional[str]
    first_seen: Optional[datetime]
    last_seen: Optional[datetime]
    status: Optional[str]

    class Config:
        from_attributes = True
