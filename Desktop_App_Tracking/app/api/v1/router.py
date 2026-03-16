# app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.endpoints import auth, attendance, activity, employees

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(attendance.router)
api_router.include_router(activity.router)
api_router.include_router(employees.router)