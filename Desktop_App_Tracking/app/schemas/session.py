from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import date, datetime


class ClockInRequest(BaseModel):
    ip_address: Optional[str] = None
    location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    city: Optional[str] = None
    country: Optional[str] = None
    network_speed_start: Optional[float] = None
    device_id: Optional[str] = None


class ClockOutRequest(BaseModel):
    session_id: UUID
    total_active_time: Optional[int] = 0   # seconds
    total_idle_time: Optional[int] = 0     # seconds


class SessionOut(BaseModel):
    session_id: UUID
    employee_id: UUID
    date: Optional[date]
    clock_in: Optional[datetime]
    clock_out: Optional[datetime]
    total_active_time: Optional[int]
    total_idle_time: Optional[int]
    session_status: Optional[str]
    ip_address: Optional[str]
    location: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    city: Optional[str]
    country: Optional[str]
    network_speed_start: Optional[float]
    device_id: Optional[str]
    last_heartbeat: Optional[datetime]

    class Config:
        from_attributes = True
