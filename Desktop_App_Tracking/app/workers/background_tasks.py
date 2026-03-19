"""
Background worker — safety net for sessions that somehow never got clocked out.
Primary clock-out happens in the Electron app via SIGINT/before-quit handlers.
"""
import asyncio
from datetime import timedelta
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.session import Session as SessionModel
from app.utils.helpers import utcnow
from app.utils.logger import get_logger

logger = get_logger(__name__)

STALE_AFTER_MINUTES = 10


async def close_stale_sessions():
    db: Session = SessionLocal()
    try:
        cutoff = utcnow() - timedelta(minutes=STALE_AFTER_MINUTES)
        stale = (
            db.query(SessionModel)
            .filter(
                SessionModel.session_status == "active",
                (
                    (SessionModel.last_heartbeat == None) &
                    (SessionModel.clock_in < cutoff)
                ) |
                (
                    (SessionModel.last_heartbeat != None) &
                    (SessionModel.last_heartbeat < cutoff)
                )
            )
            .all()
        )
        for s in stale:
            s.session_status = "stale"
            s.clock_out      = utcnow()
            logger.warning(f"Auto-closed stale session {s.session_id} for employee {s.employee_id}")
        if stale:
            db.commit()
    except Exception as e:
        logger.error(f"Stale session cleanup error: {e}")
        db.rollback()
    finally:
        db.close()


async def run_background_tasks():
    logger.info("🔁 Background task worker started")
    while True:
        await asyncio.sleep(30)
        await close_stale_sessions()