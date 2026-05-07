import logging
import os

from app.config import get_config_class, load_environment
from app.database import (
    check_database_integrity,
    create_database_backup,
    restore_database_backup,
    run_migrations,
)

logger = logging.getLogger(__name__)


def _integrity_result_to_error(result: dict) -> str:
    integrity_rows = result.get('integrity_check') or []
    fk_rows = result.get('foreign_key_violations') or []
    return (
        f"integrity_check={integrity_rows}; "
        f"foreign_key_violations={fk_rows}"
    )


def run_database_maintenance(
    config_name=None,
    overrides=None,
    *,
    backup_dir=None,
    restore_from=None,
    integrity_only=False,
    skip_backup=False,
):
    load_environment()
    config = get_config_class(config_name).from_env()
    if overrides:
        config.update(overrides)

    os.environ['DATABASE_BACKEND'] = 'postgres'
    database_path = str(config.get('DATABASE_PATH') or '').strip()
    database_url = str(config.get('DATABASE_URL') or '').strip()
    if database_url:
        os.environ['DATABASE_URL'] = database_url

    resolved_backup_dir = ''
    if not skip_backup:
        resolved_backup_dir = str(
            backup_dir
            if backup_dir is not None
            else config.get('DATABASE_BACKUP_DIR')
            or ''
        ).strip()

    restore_target = None
    backup_path = None
    if restore_from:
        restore_target = database_path or database_url or 'postgres'
        if resolved_backup_dir and not integrity_only:
            backup_path = create_database_backup(
                database_path or None,
                backup_dir=resolved_backup_dir,
                label='pre-restore',
            )
        restore_database_backup(
            restore_from,
            target_path=database_path or None,
        )
    elif resolved_backup_dir and not integrity_only:
        backup_path = create_database_backup(
            database_path or None,
            backup_dir=resolved_backup_dir,
            label='pre-maintenance',
        )

    pre_check = check_database_integrity(database_path or None)
    if not pre_check['ok']:
        raise RuntimeError(
            'Database integrity check failed before maintenance: '
            + _integrity_result_to_error(pre_check)
        )

    if integrity_only:
        config['maintenance_report'] = {
            'restore_target': restore_target,
            'backup_path': backup_path,
            'pre_check': pre_check,
            'post_check': pre_check,
        }
        logger.info('Database integrity check completed.')
        return config

    run_migrations()
    post_check = check_database_integrity(database_path or None)
    if not post_check['ok']:
        raise RuntimeError(
            'Database integrity check failed after maintenance: '
            + _integrity_result_to_error(post_check)
        )

    config['maintenance_report'] = {
        'restore_target': restore_target,
        'backup_path': backup_path,
        'pre_check': pre_check,
        'post_check': post_check,
    }
    logger.info('Database maintenance completed.')
    return config
