from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    DEFAULT_ADMIN_EMAIL: str = "admin@avdevs.com"
    DEFAULT_ADMIN_PASSWORD: str = "1234"
    DEFAULT_ADMIN_NAME: str = "Super Admin"
    DEFAULT_ADMIN_DEPARTMENT: str = "IT"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()