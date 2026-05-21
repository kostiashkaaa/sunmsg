import logging

from app.bootstrap.security import (
    require_production_realtime_backing_services,
    require_production_security_baseline,
)
from app.config import get_config_class, load_environment
from app.database import validate_postgres_backup_tools
from app.services.av_scan import AVScanError, validate_scan_command

logger = logging.getLogger(__name__)


def run_security_check(config_name=None, overrides=None):
    load_environment()
    config = get_config_class(config_name).from_env()
    if overrides:
        config.update(overrides)

    env_name = str(config.get('ENV_NAME') or '').strip().lower()
    report = {
        'env': env_name,
        'status': 'ok',
    }

    if env_name != 'production':
        logger.warning(
            'Security check is most strict in production; current env=%s',
            env_name,
        )
        report['note'] = 'non-production-mode'
        return report

    require_production_security_baseline(config)
    require_production_realtime_backing_services(config)

    if bool(config.get('CHAT_MEDIA_AV_SCAN_ENABLED', False)):
        try:
            resolved_command = validate_scan_command(
                str(config.get('CHAT_MEDIA_AV_COMMAND') or '')
            )
        except AVScanError as exc:
            raise RuntimeError(str(exc)) from exc
        report['av_command'] = resolved_command
        report['av_timeout_seconds'] = int(
            config.get('CHAT_MEDIA_AV_TIMEOUT_SECONDS', 20) or 20
        )

    backup_dir = str(config.get('DATABASE_BACKUP_DIR') or '').strip()
    if backup_dir:
        report['database_backup_dir'] = backup_dir
        report['database_backup_tools'] = validate_postgres_backup_tools()

    logger.info('Security check passed for production configuration.')
    return report
