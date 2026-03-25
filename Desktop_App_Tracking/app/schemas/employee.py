# REPLACE entire file:
from pydantic import BaseModel, EmailStr
from typing import Optional
from uuid import UUID
from datetime import date, datetime

VALID_ROLES = {"super_admin", "hr", "manager", "employee"}


class EmployeeCreate(BaseModel):
    employee_name: str
    email: EmailStr
    password: str
    department: Optional[str] = None
    role: str = "employee"
    date_of_joining: Optional[date] = None
    manager_id: Optional[UUID] = None


class EmployeeUpdate(BaseModel):
    employee_name: Optional[str] = None
    department: Optional[str] = None
    role: Optional[str] = None
    status: Optional[bool] = None
    date_of_joining: Optional[date] = None
    manager_id: Optional[UUID] = None


class EmployeeOut(BaseModel):
    employee_id: UUID
    employee_name: str
    email: str
    department: Optional[str]
    role: str
    status: bool
    date_of_joining: Optional[date]
    created_at: Optional[datetime]
    manager_id: Optional[UUID]

    class Config:
        from_attributes = True


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    employee: EmployeeOut