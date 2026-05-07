from __future__ import annotations

import logging
import os
import time

from app.config import get_config_class, load_environment
from app.database import get_db_connection
from app.services import moderation as moderation_service

logger = logging.getLogger(__name__)


def _worker_settings(config: dict) -> dict:
    return {
        'worker_id': str(config.get('MODERATION_WORKER_ID') or 'moderation-worker'),
        'max_attempts': int(config.get('MODERATION_JOB_MAX_ATTEMPTS', 5) or 5),
        'retry_delay_seconds': int(config.get('MODERATION_JOB_RETRY_DELAY_SECONDS', 30) or 30),
        'auto_action_threshold': float(config.get('MODERATION_AUTO_ACTION_THRESHOLD', 0.85)),
        'auto_action_type': str(config.get('MODERATION_AUTO_ACTION_TYPE') or 'mute_temp').strip().lower(),
        'auto_action_ttl_seconds': int(config.get('MODERATION_AUTO_ACTION_TTL_SECONDS', 3600) or 0),
        'rate_window_seconds': int(config.get('MODERATION_REPORT_RATE_WINDOW_SECONDS', 3600) or 3600),
        'repeat_window_days': int(config.get('MODERATION_REPEAT_WINDOW_DAYS', 90) or 90),
        'rate_threshold': int(config.get('MODERATION_REPORT_RATE_THRESHOLD', 5) or 5),
        'high_risk_ip_cidrs': moderation_service.parse_csv(
            str(config.get('MODERATION_HIGH_RISK_IP_CIDRS') or '').strip()
        ),
    }


def process_one_report_job(config: dict) -> dict:
    settings = _worker_settings(config)
    conn = get_db_connection()
    try:
        result = moderation_service.process_next_report_job(conn, **settings)
    finally:
        conn.close()
    return result


def run_moderation_worker_forever(config_name: str | None = None, *, sleep_seconds: int = 2) -> None:
    load_environment()
    config = get_config_class(config_name).from_env()
    os.environ['DATABASE_BACKEND'] = 'postgres'
    database_url = str(config.get('DATABASE_URL') or '').strip()
    if database_url:
        os.environ['DATABASE_URL'] = database_url
    elif not str(os.environ.get('DATABASE_URL') or '').strip():
        raise RuntimeError('DATABASE_URL must be set for moderation worker runtime')

    sleep_interval = max(1, int(sleep_seconds))
    logger.info('Moderation worker started')
    try:
        while True:
            result = process_one_report_job(config)
            status = str(result.get('status') or '')
            if status == 'idle':
                time.sleep(sleep_interval)
                continue
            if status == 'processed':
                logger.info(
                    'Moderation job processed: job_id=%s report_id=%s case_id=%s',
                    result.get('job_id'),
                    result.get('report_id'),
                    result.get('case_id'),
                )
                continue
            logger.warning(
                'Moderation job failed: job_id=%s report_id=%s error=%s',
                result.get('job_id'),
                result.get('report_id'),
                result.get('error'),
            )
    except KeyboardInterrupt:
        logger.info('Moderation worker stopped by user.')
