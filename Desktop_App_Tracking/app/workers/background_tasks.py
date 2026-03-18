"""
Background worker — runs inside the FastAPI process using asyncio.
Every 5 minutes it's a hook the desktop client can call; the worker
here demonstrates how you'd auto-clean stale sessions (e.g., sessions
that were never clocked out after 12 hours).
"""
import asyncio
from datetime import timedelta
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.session import Session as SessionModel
from app.utils.helpers import utcnow
from app.utils.logger import get_logger

logger = get_logger(__name__)

STALE_SESSION_HOURS = 12   # auto-close sessions older than this


async def close_stale_sessions():
    """Mark active sessions as stale if clock-out was never called."""
    db: Session = SessionLocal()
    try:
        cutoff = utcnow() - timedelta(hours=STALE_SESSION_HOURS)
        stale = (
            db.query(SessionModel)
            .filter(
                SessionModel.session_status == "active",
                SessionModel.clock_in < cutoff,
            )
            .all()
        )
        for s in stale:
            s.session_status = "stale"
            s.clock_out = utcnow()
            logger.warning(f"Auto-closed stale session {s.session_id} for employee {s.employee_id}")
        if stale:
            db.commit()
    except Exception as e:
        logger.error(f"Error closing stale sessions: {e}")
    finally:
        db.close()


async def run_background_tasks():
    """Infinite loop — called once from app lifespan."""
    logger.info("🔁 Background task worker started")
    while True:
        await asyncio.sleep(300)   # every 5 minutes
        await close_stale_sessions()
