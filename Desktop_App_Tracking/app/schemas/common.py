from pydantic import BaseModel
from typing import Optional, Any


class ResponseModel(BaseModel):
    success: bool = True
    message: str = "OK"
    data: Optional[Any] = None


class PaginationParams(BaseModel):
    page: int = 1
    page_size: int = 20
