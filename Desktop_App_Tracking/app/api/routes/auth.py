from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.employee import LoginRequest, TokenResponse, EmployeeOut
from app.services.auth_service import authenticate_employee, create_token_for_employee
from app.api.deps import get_current_employee
from app.models.employee import Employee

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    employee = authenticate_employee(db, payload.email, payload.password)
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    token = create_token_for_employee(employee)
    return TokenResponse(
        access_token=token,
        employee=EmployeeOut.model_validate(employee),
    )


@router.get("/me", response_model=EmployeeOut)
def get_me(current_employee: Employee = Depends(get_current_employee)):
    return EmployeeOut.model_validate(current_employee)
