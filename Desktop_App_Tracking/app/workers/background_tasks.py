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

STALE_AFTER_MINUTES = 480


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
# FIND:
# REPLACE WITH:
        for s in stale:
            # The query above already selected only sessions with no heartbeat for the full wait.
            # End the session at the last moment the app was known to be alive.
            last_seen = s.last_heartbeat or s.clock_in
            s.session_status = "stale"
            s.clock_out = last_seen
            logger.warning(
                f"Auto-closed stale session {s.session_id} for employee {s.employee_id} "
                f"(ended at last heartbeat {last_seen})"
            )
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