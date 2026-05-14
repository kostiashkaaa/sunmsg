import logging
import time
from threading import Lock

from apscheduler.schedulers.background import BackgroundScheduler

from app.database import get_db_connection
from app.services.refresh_tokens import cleanup_expired as cleanup_expired_refresh
from app.services.disappearing_messages import cleanup_expired_messages as cleanup_disappearing

logger = logging.getLogger(__name__)

_scheduler_lock = Lock()
_scheduler_started = False
_scheduler_instance = None


def cleanup_dialog_keys():
    conn = get_db_connection()
    try:
        conn.execute(
            "DELETE FROM dialog_keys WHERE used = 1 OR created_at < (CURRENT_TIMESTAMP - INTERVAL '1 minute')"
        )
        conn.commit()
    except Exception:
        logger.exception('Dialog key cleanup failed')
    finally:
        conn.close()


def create_scheduler():
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        func=cleanup_dialog_keys,
        trigger='interval',
        seconds=60,
        id='cleanup_dialog_keys',
        replace_existing=True,
    )
    scheduler.add_job(
        func=cleanup_expired_refresh,
        trigger='interval',
        hours=6,
        id='cleanup_refresh_tokens',
        replace_existing=True,
    )
    scheduler.add_job(
        func=cleanup_disappearing,
        trigger='interval',
        seconds=30,
        id='cleanup_disappearing_messages',
        replace_existing=True,
    )
    return scheduler


def start_scheduler_if_enabled(config):
    global _scheduler_started, _scheduler_instance
    if not config.get('SCHEDULER_ENABLED', True):
        return None

    with _scheduler_lock:
        if _scheduler_started and _scheduler_instance:
            return _scheduler_instance

        scheduler = create_scheduler()
        scheduler.start()
        _scheduler_instance = scheduler
        _scheduler_started = True
        return scheduler


def run_scheduler_forever(config_name=None):
    import os

    from app.config import get_config_class, load_environment

    load_environment()
    config = get_config_class(config_name).from_env()
    os.environ['DATABASE_BACKEND'] = 'postgres'
    database_url = str(config.get('DATABASE_URL') or '').strip()
    if database_url:
        os.environ['DATABASE_URL'] = database_url
    elif not str(os.environ.get('DATABASE_URL') or '').strip():
        raise RuntimeError('DATABASE_URL must be set for scheduler runtime')
    scheduler = start_scheduler_if_enabled(config)
    if scheduler is None:
        logger.info('Scheduler is disabled by configuration.')
        return

    logger.info('Background scheduler started.')
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        logger.info('Stopping background scheduler...')
    finally:
        scheduler.shutdown(wait=False)
